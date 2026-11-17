import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from engine.domain import RunConfig
from engine.scheduler import Scheduler, budget_usage, build_steps, next_wake, preview, freeze_pricing, frozen_cost
from engine.world import digest
from providers.gemini import GeminiPool
from storage.store import Store


@pytest.fixture
def storage(tmp_path):
    result = Store(tmp_path / "lab.sqlite3")
    yield result
    result.close()


def test_event_immutability_and_historical_replay(storage):
    run = storage.create(RunConfig())
    storage.append(run["id"], [{"event_type": "status_changed", "payload_json": {"status": "running"}}])
    assert storage.replay(run["id"], 0)["state"]["status"] == "ready"
    assert storage.replay(run["id"])["state"] == storage.get(run["id"])["state"]
    with pytest.raises(sqlite3.IntegrityError):
        storage.db.execute("DELETE FROM events")
    storage.db.rollback()
    with pytest.raises(sqlite3.IntegrityError):
        storage.db.execute("UPDATE events SET seq=99")
    storage.db.rollback()


def test_calendar_claim_and_lease(storage):
    run_id = storage.create(RunConfig())["id"]
    assert storage.claim_day(run_id, 1)
    assert not storage.claim_day(run_id, 1)
    until = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
    assert storage.acquire_lease(run_id, "one", until)
    assert not storage.acquire_lease(run_id, "two", until)


def test_single_server_owns_database(tmp_path):
    path = tmp_path / "exclusive.sqlite3"
    owner = Store(path, exclusive=True)
    with pytest.raises(RuntimeError, match="one server"):
        Store(path, exclusive=True)
    owner.close()
    replacement = Store(path, exclusive=True)
    replacement.close()


def test_next_wake_timezone_and_schedule():
    config = RunConfig(wake_time="09:00", timezone="Asia/Kolkata")
    assert next_wake(config, datetime(2026, 11, 17, 2, tzinfo=timezone.utc)).startswith("2026-11-17T03:30")
    assert next_wake(config, datetime(2026, 11, 17, 4, tzinfo=timezone.utc)).startswith("2026-11-18T03:30")
    steps = build_steps(config)
    assert sum(s["kind"] == "turn" and s.get("arm") == "A" for s in steps) == 72
    assert sum(s["kind"] == "turn" and s.get("arm") == "C" for s in steps) == 84
    assert preview(config)["logical_calls"] == 156
    assert not any(s.get("arm") == "A" and s["kind"] == "turn" and s["phase"] == "break" for s in steps)


def test_unknown_attempt_retains_reservation():
    events = [{"event_type": "provider_attempt_started", "payload_json": {"attempt_id": "a", "reserved_tokens": 100, "reserved_cost_usd": .2}}]
    assert budget_usage(events) == {"calls": 1, "tokens": 100, "estimated_cost_usd": .2, "uncertain_attempts": 1}
    events.append({"event_type": "provider_attempt_failed", "payload_json": {"attempt_id": "a", "uncertain": True}})
    assert budget_usage(events)["tokens"] == 100
    events[-1] = {"event_type": "provider_attempt_completed", "input_tokens": 10, "output_tokens": 5, "estimated_cost_usd": .01, "payload_json": {"attempt_id": "a", "total_tokens": 17}}
    assert budget_usage(events)["tokens"] == 17


def test_frozen_rates_do_not_change_when_environment_changes(monkeypatch):
    config = freeze_pricing(RunConfig(provider="gemini"))
    monkeypatch.setenv("GEMINI_INPUT_USD_PER_MILLION", "900")
    usage = {"input_tokens": 1000, "output_tokens": 100, "thought_tokens": 10}
    assert frozen_cost(usage, config) == pytest.approx(.000575)
    assert config.pricing["input"] == .30


def test_complete_mock_snapshot_restart_and_filters(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        config = RunConfig(tick_ms=0)
        run_id = storage.create(config)["id"]
        scheduler.status(run_id, "running")
        for _ in range(len(build_steps(config))):
            await scheduler.step(run_id)
        run = storage.get(run_id)
        assert run["status"] == "completed"
        assert storage.replay(run_id)["state"] == run["state"]
        assert all(sum(t["status"] == "integrated" for t in d["tasks"]) == 12 for d in run["state"]["departments"].values())
        assert storage.events(run_id, channel="small_talk")
        assert not storage.events(run_id, department_id="A", channel="small_talk")
        assert all(e["department_id"] == "C" for e in storage.events(run_id, department_id="C", q="message_sent"))
        seq = run["seq"] // 2
        historical = storage.replay(run_id, seq)
        expected = next(e for e in storage.events(run_id) if e["seq"] == seq)["state_hash"]
        assert historical["state_hash"] == expected
        await scheduler.shutdown()
        await pool.close()
    asyncio.run(exercise())


def test_budget_hard_stop_before_unmatched_group(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        config = RunConfig(days=1, max_calls=1, tick_ms=0)
        run_id = storage.create(config)["id"]
        scheduler.status(run_id, "running")
        for _ in range(5):
            await scheduler.step(run_id)
        assert storage.get(run_id)["status"] == "budget_exhausted"
        assert budget_usage(storage.events(run_id))["calls"] == 0
        await pool.close()
    asyncio.run(exercise())


def test_controls_and_short_calendar_interval(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        run_id = storage.create(RunConfig(days=1, scheduler_mode="calendar", tick_ms=0, work_rounds=1))["id"]
        await scheduler.control(run_id, "start")
        assert storage.get(run_id)["status"] == "waiting"
        storage.runtime(run_id, next_due=(datetime.now(timezone.utc) + timedelta(milliseconds=100)).isoformat())
        for _ in range(150):
            if storage.get(run_id)["status"] == "completed":
                break
            await asyncio.sleep(.02)
        assert storage.get(run_id)["status"] == "completed"
        count = storage.db.execute("SELECT COUNT(*) FROM day_jobs WHERE run_id=?", (run_id,)).fetchone()[0]
        assert count == 1
        other = storage.create(RunConfig(tick_ms=30))["id"]
        await scheduler.control(other, "start")
        await asyncio.sleep(.05)
        await scheduler.control(other, "pause")
        await asyncio.sleep(.1)
        paused = storage.get(other)
        assert paused["status"] == "paused"
        cursor = paused["state"]["cursor"]
        await asyncio.sleep(.05)
        assert storage.get(other)["state"]["cursor"] == cursor
        await scheduler.control(other, "resume")
        await asyncio.sleep(.05)
        await scheduler.control(other, "stop")
        await asyncio.sleep(.1)
        assert storage.get(other)["status"] == "stopped"
        await scheduler.shutdown()
        await pool.close()
    asyncio.run(exercise())


def test_restart_recovers_cursor_and_uncertain_attempt(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        run_id = storage.create(RunConfig())["id"]
        scheduler.status(run_id, "running")
        storage.append(run_id, [{"event_type": "provider_attempt_started", "payload_json": {"attempt_id": "lost", "reserved_tokens": 1000, "reserved_cost_usd": .2}}], cursor=2)
        await scheduler.recover()
        assert storage.get(run_id)["status"] == "paused"
        assert storage.get(run_id)["state"]["cursor"] == 2
        assert budget_usage(storage.events(run_id))["uncertain_attempts"] == 1
        await pool.close()
    asyncio.run(exercise())


def test_restart_recovers_after_dead_owner_lease_expires(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        run_id = storage.create(RunConfig())["id"]
        scheduler.status(run_id, "running")
        storage.runtime(run_id, lease_owner="dead-process", lease_until=(datetime.now(timezone.utc) + timedelta(milliseconds=50)).isoformat())
        await scheduler.recover()
        await asyncio.sleep(.35)
        assert storage.get(run_id)["status"] == "paused"
        await scheduler.shutdown()
        await pool.close()
    asyncio.run(exercise())


def test_quota_cooldown_survives_server_restart(storage):
    async def exercise():
        from providers.base import ProviderError
        run_id = storage.create(RunConfig(provider="gemini"))["id"]
        storage.append(run_id, [{"event_type": "provider_attempt_failed", "payload_json": {
            "attempt_id": "rate", "classification": "rate_limited", "retry_after_seconds": 60}}])
        pool = GeminiPool(["test-credential"])
        scheduler = Scheduler(storage, pool)
        await scheduler.recover()
        with pytest.raises(ProviderError, match="cooldown"):
            pool.acquire()
        await scheduler.shutdown()
        await pool.close()
    asyncio.run(exercise())


def test_calendar_second_day_uses_next_day_claim(storage):
    async def exercise():
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        config = RunConfig(days=2, scheduler_mode="calendar", tick_ms=0, work_rounds=1)
        run_id = storage.create(config)["id"]
        await scheduler.control(run_id, "start")
        for expected_day in (1, 2):
            storage.runtime(run_id, next_due=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
            for _ in range(150):
                run = storage.get(run_id)
                if run["status"] == "completed" or (run["status"] == "waiting" and run["state"].get("last_completed_day") == expected_day):
                    break
                await asyncio.sleep(.02)
            assert storage.get(run_id)["state"].get("last_completed_day") == expected_day
        jobs = storage.db.execute("SELECT virtual_day FROM day_jobs WHERE run_id=? ORDER BY virtual_day", (run_id,)).fetchall()
        assert [row[0] for row in jobs] == [1, 2]
        await scheduler.shutdown()
        await pool.close()
    asyncio.run(exercise())
