"""Control, streaming, retry, and physical-restart boundaries of the real runtime."""
import asyncio
import copy
import json

import pytest

from engine.domain import RunConfig
from engine.metrics import compute_metrics
from engine.scheduler import Scheduler, budget_usage, build_steps
from engine.world import digest
from providers.base import ProviderError
from providers.gemini import GeminiPool
from providers.mock import MockProvider
from storage.store import Store


@pytest.mark.parametrize("command", ["pause", "stop"])
def test_pending_generation_commits_once_before_control_acknowledgement(tmp_path, monkeypatch, command):
    async def exercise():
        storage = Store(tmp_path / f"pending-{command}.sqlite3")
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        entered = [asyncio.Event(), asyncio.Event()]
        released = [asyncio.Event(), asyncio.Event()]
        dispatches = []

        async def blocked_generate(self, context):
            index = len(dispatches)
            dispatches.append((context["agent_id"], context["turn_index"]))
            assert index < 2, "A control request must prevent another dispatch"
            entered[index].set()
            await released[index].wait()
            return dict(action=dict(type="wait", reason="no_available_work"), input_tokens=0,
                        output_tokens=0, estimated_cost_usd=0, elapsed_ms=0, model="mock-v1")

        monkeypatch.setattr(MockProvider, "generate", blocked_generate)
        run_id = storage.create(RunConfig(days=1, tick_ms=0))["id"]
        try:
            await scheduler.control(run_id, "start")
            await asyncio.wait_for(entered[0].wait(), 2)
            before = storage.get(run_id)["state"]["cursor"]
            initial_attempt = storage.events(run_id, event_type="provider_attempt_started")[0]
            await scheduler.control(run_id, command)
            await scheduler.control(run_id, command)
            if command == "stop":
                await scheduler.control(run_id, "pause")
            assert storage.get(run_id)["status"] == ("pausing" if command == "pause" else "stopping")
            assert not storage.events(run_id, event_type="provider_attempt_completed")
            assert storage.get(run_id)["state"]["cursor"] == before
            released[0].set()
            await asyncio.wait_for(scheduler.tasks[run_id], 2)
            assert storage.get(run_id)["status"] == ("paused" if command == "pause" else "stopped")
            assert storage.get(run_id)["state"]["cursor"] == before + 1
            assert len(dispatches) == 1
            assert len(storage.events(run_id, event_type="provider_attempt_completed")) == 1
            if command == "pause":
                await scheduler.control(run_id, "resume")
                await asyncio.wait_for(entered[1].wait(), 2)
                starts = storage.events(run_id, event_type="provider_attempt_started")
                assert len(starts) == 2
                assert starts[0]["payload_json"]["logical_id"] == initial_attempt["payload_json"]["logical_id"]
                assert starts[1]["payload_json"]["logical_id"] != starts[0]["payload_json"]["logical_id"]
                await scheduler.control(run_id, "stop")
                released[1].set()
                await asyncio.wait_for(scheduler.tasks[run_id], 2)
                assert storage.get(run_id)["status"] == "stopped"
                assert len(storage.events(run_id, event_type="provider_attempt_completed")) == 2
            else:
                with pytest.raises(ValueError, match="terminal"):
                    await scheduler.control(run_id, "resume")
        finally:
            for release in released:
                release.set()
            await scheduler.shutdown()
            await pool.close()
            storage.close()

    asyncio.run(exercise())


def test_retry_limit_preserves_failed_attempt_usage_without_advancing_turn(tmp_path, monkeypatch):
    async def exercise():
        storage = Store(tmp_path / "retry.sqlite3")
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        config = RunConfig(days=1, tick_ms=0)
        run_id = storage.create(config)["id"]
        scheduler.status(run_id, "running")
        while build_steps(config)[storage.get(run_id)["state"]["cursor"]]["kind"] != "turn":
            await scheduler.step(run_id)
        before = storage.get(run_id)["state"]["cursor"]
        arm = build_steps(config)[before]["arm"]
        requests = []

        async def failed_generate(self, context):
            requests.append(context["agent_id"])
            raise ProviderError("invalid_json", retryable=True, usage=dict(input_tokens=7, output_tokens=3,
                thought_tokens=2, cached_tokens=1, total_tokens=12, estimated_cost_usd=.002, elapsed_ms=5))

        monkeypatch.setattr(MockProvider, "generate", failed_generate)
        try:
            # step() is driven directly to avoid real retry sleeps in this bounded state-machine test.
            for index in range(4):
                await scheduler.step(run_id)
                assert storage.get(run_id)["status"] == ("waiting_provider" if index < 3 else "provider_blocked")
            assert len(requests) == 4
            assert storage.get(run_id)["state"]["cursor"] == before
            events = storage.events(run_id)
            failures = [e for e in events if e["event_type"] == "provider_attempt_failed"]
            assert len(failures) == 4
            assert len({e["payload_json"]["logical_id"] for e in failures}) == 1
            assert all(e["input_tokens"] == 7 and e["payload_json"]["cached_tokens"] == 1 for e in failures)
            assert budget_usage(events) == dict(calls=4, tokens=48, estimated_cost_usd=.008, uncertain_attempts=0)
            metric = compute_metrics(events, config)["departments"][arm]
            assert metric["model_calls"] == 4 and metric["retry_attempts"] == 3
            assert metric["input_tokens"] == 28 and metric["output_tokens"] == 12
            assert metric["thought_tokens"] == 8 and metric["total_tokens"] == 48
            assert metric["provider_elapsed_ms"] == 20
        finally:
            await scheduler.shutdown()
            await pool.close()
            storage.close()

    asyncio.run(exercise())


def test_sse_last_event_id_reconnect_emits_only_new_records(tmp_path, monkeypatch):
    from api.main import app, stream

    class Request:
        def __init__(self, last_event_id):
            self.headers = {"last-event-id": str(last_event_id)}
            self.disconnected = False

        async def is_disconnected(self):
            return self.disconnected

    def sequence(chunk):
        if isinstance(chunk, bytes):
            chunk = chunk.decode()
        lines = chunk.splitlines()
        seq = int(lines[0].removeprefix("id: "))
        event = json.loads(lines[1].removeprefix("data: "))
        assert event["seq"] == seq
        return seq

    async def exercise():
        storage = Store(tmp_path / "stream.sqlite3")
        monkeypatch.setattr(app.state, "store", storage, raising=False)
        run_id = storage.create(RunConfig())["id"]
        storage.append(run_id, [{"event_type": "test_marker", "payload_json": {"number": i}} for i in range(3)])
        first_request = Request(1)
        response = await stream(run_id, first_request, after=0)
        iterator = response.body_iterator
        try:
            observed = [sequence(await asyncio.wait_for(anext(iterator), 1)) for _ in range(2)]
        finally:
            await iterator.aclose()
        assert observed == [2, 3]
        reconnect = Request(3)
        response = await stream(run_id, reconnect, after=1)
        iterator = response.body_iterator
        try:
            observed.append(sequence(await asyncio.wait_for(anext(iterator), 1)))
            storage.append(run_id, [{"event_type": "test_marker", "payload_json": {"number": 4}}])
            observed.append(sequence(await asyncio.wait_for(anext(iterator), 1)))
            assert observed == [2, 3, 4, 5]
            reconnect.disconnected = True
            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(anext(iterator), 1)
        finally:
            await iterator.aclose()
            storage.close()

    asyncio.run(exercise())


def test_five_day_three_arm_scheduler_and_exact_replay_after_physical_reopen(tmp_path):
    path = tmp_path / "five-days.sqlite3"

    async def exercise():
        storage = Store(path)
        pool = GeminiPool([])
        scheduler = Scheduler(storage, pool)
        config = RunConfig(days=5, arms=["A", "B", "C"], tick_ms=0)
        run_id = storage.create(config)["id"]
        scheduler.status(run_id, "running")
        try:
            for _ in build_steps(config):
                await scheduler.step(run_id)
            run = storage.get(run_id)
            assert run["status"] == "completed" and run["state"]["last_completed_day"] == 5
            expected = digest(run["state"])
            events = storage.events(run_id)
            metric = compute_metrics(events, config)["departments"]
            assert all(metric[arm]["completed"] == 12 for arm in config.arms)
            assert {metric[arm]["work_turns"] for arm in config.arms} == {120}
            assert metric["B"]["journal_entries"] == 20 and metric["C"]["small_talk_messages"] == 20
            assert metric["A"]["journal_entries"] == metric["A"]["small_talk_messages"] == 0
            normalized = []
            for arm in config.arms:
                tasks = copy.deepcopy(run["state"]["departments"][arm]["tasks"])
                for task in tasks:
                    task["owner"] = task["owner"].split("-", 1)[1] if task["owner"] else None
                normalized.append(tasks)
            assert normalized[0] == normalized[1] == normalized[2]
            for agent in run["state"]["departments"]["B"]["agents"]:
                assert all(m.get("sender_id") == agent["id"] for m in agent["memory"] if m.get("channel") == "notes" and m.get("text"))
            target = events[len(events) // 2]["seq"]
            target_hash = next(e["state_hash"] for e in events if e["seq"] == target)
            assert storage.db.execute("SELECT COUNT(*) FROM snapshots WHERE run_id=?", (run_id,)).fetchone()[0] > 5
        finally:
            await scheduler.shutdown()
            await pool.close()
            storage.close()
        reopened = Store(path)
        try:
            assert digest(reopened.get(run_id)["state"]) == expected
            assert reopened.replay(run_id)["state_hash"] == expected
            assert reopened.replay(run_id, target)["state_hash"] == target_hash
        finally:
            reopened.close()

    asyncio.run(exercise())
