"""Persisted finite schedule and bounded, observable provider dispatch."""
import asyncio
import hashlib
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from engine.domain import ROLES, RunConfig, action_schema
from engine.world import context_for_agent, process_action
from providers.mock import MockProvider
from providers.base import ProviderError, price_estimate
from providers.deepseek import DeepSeekProvider, MODEL_PRICES, PRICING_VERSION
from engine.study import implementation, runtime_versions
from providers.gemini import GeminiProvider
from providers.openai import OpenAIProvider


def utcnow():
    return datetime.now(timezone.utc)


def next_wake(config, after=None):
    current = after or utcnow()
    local = current.astimezone(ZoneInfo(config.timezone))
    hour, minute = map(int, config.wake_time.split(":"))
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc).isoformat()


def build_steps(config):
    steps = []
    supplier = getattr(config, "environment", "") == "supplier_selection_v1"
    order = list(config.arms)
    journals_and_chat = [a for a in order if a != "A"]
    if supplier:
        # Independently permute each block's baseline, then rotate positions across turns.
        random.Random(config.seed).shuffle(order)
        random.Random(config.seed + 1).shuffle(journals_and_chat)
    for day in range(1, config.days + 1):
        def phase(name, minute):
            steps.append({"kind": "phase", "day": day, "phase": name, "minute": minute})
        phase("wake", 480)
        phase("planning", 510)
        for block in (1, 2):
            if block == 2:
                phase("break", 720)
                if (day - 1) % config.talk_frequency == 0:
                    for index, role in enumerate(ROLES):
                        offset = (index + day - 1) % len(journals_and_chat) if supplier else 0
                        for arm in journals_and_chat[offset:] + journals_and_chat[:offset]:
                            steps.append({"kind": "turn", "day": day, "phase": "break", "arm": arm,
                                          "role": role, "round": index, "block": 0, "first": False})
            phase(f"work_block_{block}", 540 if block == 1 else 720 + config.break_length)
            for round_index in range(config.work_rounds):
                arms = list(config.arms)
                if (day + round_index + config.seed) % 2:
                    arms.reverse()
                for role_index, role in enumerate(ROLES):
                    if supplier:
                        group = ((day - 1) * 2 + block - 1) * config.work_rounds + round_index
                        offset = (group * len(ROLES) + role_index) % len(order)
                        arms = order[offset:] + order[:offset]
                    for index, arm in enumerate(arms):
                        steps.append({"kind": "turn", "day": day, "phase": f"work_block_{block}",
                                      "arm": arm, "role": role, "round": round_index, "block": block, "first": index == 0})
        phase("evaluation", 1020)
        phase("sleep", 1080)
        steps.append({"kind": "day_end", "day": day, "phase": "sleep"})
    return steps


def budget_usage(events):
    started = {e["payload_json"]["attempt_id"]: e for e in events if e["event_type"] == "provider_attempt_started"}
    finished = {e["payload_json"]["attempt_id"]: e for e in events if e["event_type"] in {"provider_attempt_completed", "provider_attempt_failed"}}
    tokens = 0
    cost = 0.0
    uncertain = 0
    for attempt_id, event in started.items():
        reservation = event["payload_json"]
        outcome = finished.get(attempt_id)
        if outcome and not outcome["payload_json"].get("uncertain"):
            p = outcome["payload_json"]
            tokens += p.get("total_tokens") or ((outcome.get("input_tokens") or 0) + (outcome.get("output_tokens") or 0) + (p.get("thought_tokens") or 0))
            cost += outcome.get("estimated_cost_usd") or 0
        else:
            tokens += reservation.get("reserved_tokens", 0)
            cost += reservation.get("reserved_cost_usd", 0)
            uncertain += 1
    return {"calls": len(started), "tokens": tokens, "estimated_cost_usd": round(cost, 8), "uncertain_attempts": uncertain}


def reservation(context, config):
    if config.provider == "mock":
        return 0, 0.0
    # A conservative UTF-8 byte bound covers tokens, schema and template overhead.
    prompt_bound = len(json.dumps(context, ensure_ascii=False).encode("utf-8")) + 2048
    tokens = prompt_bound + config.max_output_tokens
    rates = config.pricing or freeze_pricing(config).pricing
    estimate = (prompt_bound * max(rates["input"], rates["cached"]) + config.max_output_tokens * rates["output"]) / 1_000_000
    return tokens, estimate


def freeze_pricing(config):
    if config.provider == "mock":
        return config.model_copy(update={"pricing": {"input": 0.0, "output": 0.0, "cached": 0.0}})
    if config.provider == "deepseek":
        if config.model not in MODEL_PRICES:
            raise ValueError("Select a DeepSeek model with published token prices: " + ", ".join(MODEL_PRICES))
        return config.model_copy(update={"pricing": MODEL_PRICES[config.model].copy(), "pricing_version": PRICING_VERSION})
    prefix = "GEMINI" if config.provider == "gemini" else "OPENAI"
    prices = {"input": price_estimate(config.model, 1_000_000, 0, prefix=prefix),
              "output": price_estimate(config.model, 0, 1_000_000, prefix=prefix),
              "cached": price_estimate(config.model, 1_000_000, 0, cached_tokens=1_000_000, prefix=prefix)}
    if any(value is None for value in prices.values()):
        raise ValueError("This live model needs known server-side token prices before its cost cap can be enforced.")
    return config.model_copy(update={"pricing": prices, "pricing_version": "2026-11-17"})


def make_provider(config, pool):
    if config.provider == "mock":
        return MockProvider()
    if config.provider == "gemini":
        return GeminiProvider(pool, config.model, config.max_output_tokens)
    adapter = DeepSeekProvider if config.provider == "deepseek" else OpenAIProvider
    return adapter(config.model, max_output_tokens=config.max_output_tokens)


def frozen_cost(usage, config):
    if not config.pricing or usage.get("input_tokens") is None or usage.get("output_tokens") is None:
        return usage.get("estimated_cost_usd")
    cached = min(usage.get("cached_tokens") or 0, usage["input_tokens"])
    # OpenAI-compatible output includes reasoning; Gemini reports reasoning separately.
    output = usage["output_tokens"] + ((usage.get("thought_tokens") or 0) if config.provider == "gemini" else 0)
    return ((usage["input_tokens"] - cached) * config.pricing["input"] + cached * config.pricing["cached"] + output * config.pricing["output"]) / 1_000_000


def preview(config):
    work = config.days * 2 * config.work_rounds * 4 * len(config.arms)
    breaks = len(range(1, config.days + 1, config.talk_frequency)) * 4 * sum(a != "A" for a in config.arms)
    logical = work + breaks
    return {"logical_calls": logical, "max_attempts": min(config.max_calls, logical * 4),
            "upper_bound_tokens": config.max_tokens, "estimated_cost_usd": 0 if config.provider == "mock" else config.max_cost_usd,
            "work_calls_per_arm": config.days * 2 * config.work_rounds * 4,
            "note": "Configured hard ceilings; real charges are unknown unless reported by the provider. Mock makes no network requests."}


class Scheduler:
    def __init__(self, store, pool):
        self.store, self.pool = store, pool
        self.owner = uuid.uuid4().hex
        self.tasks = {}
        self.generation_lock = asyncio.Lock()
        self.closed = False

    def status(self, run_id, status, **payload):
        return self.store.append(run_id, [{"event_type": "status_changed", "payload_json": {"status": status, **payload}}])

    async def recover(self):
        for run in self.store.list():
            if run["config"]["provider"] == "gemini":
                for event in self.store.events(run["id"], event_type="provider_attempt_failed"):
                    p = event["payload_json"]
                    if p.get("classification") in {"rate_limited", "daily_quota_exhausted", "pool_cooldown", "provider_unavailable", "provider_timeout"}:
                        deadline = datetime.fromisoformat(event["ts_utc"]) + timedelta(seconds=p.get("retry_after_seconds") or 0)
                        self.pool.restore_cooldown(deadline.timestamp())
            if run["status"] in {"running", "pausing", "stopping"}:
                if run.get("lease_until") and run["lease_until"] > utcnow().isoformat():
                    self.tasks[run["id"]] = asyncio.create_task(self.recover_after_lease(run["id"]))
                    continue
                self.recover_run(run["id"])
            if run["status"] in {"waiting", "waiting_provider"}:
                if self.protocol_matches(run["id"]):
                    self.launch(run["id"])
                else:
                    self.status(run["id"], "paused", reason="Study code fingerprint changed")

    def recover_run(self, run_id):
        events = self.store.events(run_id)
        completed = {e["payload_json"].get("attempt_id") for e in events if e["event_type"] in {"provider_attempt_completed", "provider_attempt_failed"}}
        for event in events:
            if event["event_type"] == "provider_attempt_started" and event["payload_json"]["attempt_id"] not in completed:
                self.store.append(run_id, [{"event_type": "provider_attempt_failed", "department_id": event["department_id"], "agent_id": event["agent_id"], "severity": "warning", "payload_json": {"attempt_id": event["payload_json"]["attempt_id"], "uncertain": True, "classification": "interrupted_request", "reason": "Server restart: provider usage is unknown; reservation retained."}}])
        self.status(run_id, "paused", reason="Recovered checkpoint after server restart")
        self.store.runtime(run_id, control=None, lease_owner=None, lease_until=None)

    async def recover_after_lease(self, run_id):
        while not self.closed:
            run = self.store.get(run_id)
            if run["status"] not in {"running", "pausing", "stopping"}:
                return
            if not run.get("lease_until") or run["lease_until"] <= utcnow().isoformat():
                self.recover_run(run_id)
                return
            await asyncio.sleep(.25)

    def launch(self, run_id):
        if run_id not in self.tasks or self.tasks[run_id].done():
            self.tasks[run_id] = asyncio.create_task(self.loop(run_id))

    def protocol_matches(self, run_id):
        protocol = self.store.registered_protocol(run_id)
        return protocol is None or (protocol["implementation_hash"] == implementation()["hash"]
                                    and protocol.get("runtime", runtime_versions()) == runtime_versions())

    async def control(self, run_id, command):
        run = self.store.get(run_id)
        status = run["status"]
        config = RunConfig(**run["config"])
        if command in {"start", "resume", "advance_day"}:
            if not self.protocol_matches(run_id):
                raise ValueError("Study implementation changed. Restore the registered code to execute this block.")
            if status in {"running", "pausing", "stopping"}:
                return run
            if status in {"completed", "stopped", "budget_exhausted"}:
                raise ValueError("This run is terminal. Clone it to start another experiment.")
            if command == "start" and status != "ready":
                raise ValueError("Use resume for an existing run.")
            if command == "advance_day" and config.scheduler_mode != "virtual":
                raise ValueError("Advance day is available only in virtual-time mode.")
            self.store.runtime(run_id, control=None, retry_at=None, stop_day=run["state"]["virtual_day"] if command == "advance_day" else None)
            if config.scheduler_mode == "calendar" and command == "start":
                self.store.runtime(run_id, next_due=next_wake(config))
                self.status(run_id, "waiting")
            else:
                self.status(run_id, "running", manual=True)
            self.launch(run_id)
        elif command in {"pause", "stop"}:
            if status in {"completed", "stopped", "budget_exhausted"}:
                return run
            if command == "pause" and (status == "stopping" or run.get("control") == "stop"):
                return run
            pending = run_id in self.tasks and not self.tasks[run_id].done() and status in {"running", "pausing", "stopping"}
            self.store.runtime(run_id, control=command)
            self.status(run_id, ("pausing" if command == "pause" else "stopping") if pending else ("paused" if command == "pause" else "stopped"))
        else:
            raise ValueError("Unknown control command")
        return self.store.get(run_id)

    async def loop(self, run_id):
        try:
            while not self.closed:
                run = self.store.get(run_id)
                command = run.get("control")
                if command:
                    self.status(run_id, "paused" if command == "pause" else "stopped")
                    self.store.runtime(run_id, control=None)
                    return
                if run["status"] == "waiting":
                    if not run["next_due"] or run["next_due"] > utcnow().isoformat():
                        await asyncio.sleep(0.25)
                        continue
                    planned = build_steps(RunConfig(**run["config"]))
                    if run["state"]["cursor"] >= len(planned):
                        self.status(run_id, "completed")
                        return
                    day = planned[run["state"]["cursor"]]["day"]
                    if not self.store.acquire_lease(run_id, self.owner, (utcnow() + timedelta(seconds=90)).isoformat()):
                        await asyncio.sleep(0.5)
                        continue
                    claimed = self.store.claim_day(run_id, day)
                    if claimed:
                        self.store.append(run_id, [{"event_type": "scheduled_day_started", "virtual_day": day, "payload_json": {"day": day}}])
                    self.status(run_id, "running")
                elif run["status"] == "waiting_provider":
                    if run.get("retry_at") and run["retry_at"] > utcnow().isoformat():
                        await asyncio.sleep(0.25)
                        continue
                    self.status(run_id, "running")
                elif run["status"] != "running":
                    return
                if not self.store.acquire_lease(run_id, self.owner, (utcnow() + timedelta(seconds=90)).isoformat()):
                    return
                await self.step(run_id)
                config = self.store.get(run_id)["config"]
                await asyncio.sleep(config["tick_ms"] / 1000)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Never write raw provider exception text or request headers.
            self.store.append(run_id, [{"event_type": "engine_error", "severity": "error", "payload_json": {"reason": "Internal execution error", "exception_type": type(exc).__name__}}])
            self.status(run_id, "paused", reason="Execution error; inspect event log")
        finally:
            self.store.runtime(run_id, lease_owner=None, lease_until=None)

    async def step(self, run_id):
        run = self.store.get(run_id)
        config = RunConfig(**run["config"])
        state = run["state"]
        steps = build_steps(config)
        cursor = state["cursor"]
        if cursor >= len(steps):
            self.status(run_id, "completed")
            return
        step = steps[cursor]
        day, kind = step["day"], step["kind"]
        if kind == "phase":
            phase = step["phase"]
            drafts = [{"event_type": "phase_started", "virtual_day": day, "payload_json": {"phase": phase, "virtual_minute": step["minute"]}}]
            for arm, dept in state["departments"].items():
                for agent in dept["agents"]:
                    location = "bed" if phase == "sleep" else ("table" if phase == "break" and arm == "C" else "desk")
                    drafts.append({"event_type": "agent_moving", "virtual_day": day, "department_id": arm, "agent_id": agent["id"], "payload_json": {"location": location}})
                    if phase in {"wake", "sleep"}:
                        drafts.append({"event_type": "agent_started" if phase == "wake" else "sleep_started", "virtual_day": day, "department_id": arm, "agent_id": agent["id"], "payload_json": {"location": location}})
            self.store.append(run_id, drafts, cursor=cursor + 1)
        elif kind == "day_end":
            self.store.append(run_id, [{"event_type": "day_completed", "virtual_day": day, "payload_json": {"day": day, "memory_persisted": True}}], cursor=cursor + 1)
            if day == config.days:
                self.status(run_id, "completed")
            elif run.get("stop_day") and day >= run["stop_day"]:
                self.status(run_id, "paused")
                self.store.runtime(run_id, stop_day=None)
            elif config.scheduler_mode == "calendar":
                self.store.runtime(run_id, next_due=next_wake(config))
                self.status(run_id, "waiting")
        else:
            await self.turn(run, config, step, cursor)

    async def turn(self, run, config, step, cursor):
        run_id, arm = run["id"], step["arm"]
        agent_id = f"{arm}-{step['role']}"
        context = context_for_agent(run["state"], arm, agent_id, step["phase"])
        context.setdefault("action_schema", action_schema())
        if not context.get("role_prompt"):
            context["role_prompt"] = ("Choose one safe non-task utterance ID." if step["phase"] == "break"
                                      else config.role_prompts[step["role"]])
        context.pop("condition", None)
        context.update({"seed": config.seed, "day": step["day"], "round": step["round"], "block": step["block"],
                        "turn_index": (step["day"] - 1) * config.work_rounds * 2 + max(step["block"] - 1, 0) * config.work_rounds + step["round"],
                        "department_id": arm, "agent_id": agent_id, "role": step["role"], "phase": step["phase"],
                        "max_output_tokens": config.max_output_tokens, "paid_confirmed": config.paid_confirmed})
        if config.environment == "supplier_selection_v1" and step["phase"] != "break":
            context["role_turns_left_including_this_turn"] = (
                config.work_rounds - step["round"] if step["day"] == 1 and step["block"] == 1
                else config.days * 2 * config.work_rounds - context["turn_index"])
        reserved_tokens, reserved_cost = reservation(context, config)
        events = self.store.events(run_id)
        usage = budget_usage(events)
        # Before the first member of a matched work group, allow for all arms and retries.
        multiplier = len(config.arms) * 4 if step.get("first") else 1
        if usage["calls"] + multiplier > config.max_calls or usage["tokens"] + reserved_tokens * multiplier > config.max_tokens or usage["estimated_cost_usd"] + reserved_cost * multiplier > config.max_cost_usd:
            self.status(run_id, "budget_exhausted", reason="Insufficient allowance for the next matched work group")
            return
        logical_id = f"{run_id}:{cursor}"
        attempts = [e for e in events if e["event_type"] == "provider_attempt_failed" and e["payload_json"].get("logical_id") == logical_id]
        last_resume = max((e["seq"] for e in events if e["event_type"] == "status_changed" and e["payload_json"].get("status") == "running" and e["payload_json"].get("manual")), default=0)
        attempts = [e for e in attempts if e["seq"] > last_resume]
        attempt_id = uuid.uuid4().hex
        common = {"virtual_day": step["day"], "department_id": arm, "agent_id": agent_id,
                  "channel": ("small_talk" if arm == "C" else "notes") if step["phase"] == "break" else "work"}
        started = {**common, "event_type": "provider_attempt_started", "prompt_hash": hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest(),
                   "payload_json": {"attempt_id": attempt_id, "logical_id": logical_id, "reserved_tokens": reserved_tokens, "reserved_cost_usd": reserved_cost}}
        async with self.generation_lock:
            current = self.store.get(run_id)
            if current.get("control"):
                return
            self.store.append(run_id, [started])
            try:
                provider = make_provider(config, self.pool)
                response = await provider.generate(context)
            except ProviderError as exc:
                count = len(attempts) + 1
                delay = max(exc.retry_after or 0, min(60, 2 ** (count - 1) + random.Random(attempt_id).random()))
                used = exc.usage
                if used:
                    used["estimated_cost_usd"] = frozen_cost(used, config)
                unknown = exc.uncertain or bool(used and (used.get("input_tokens") is None or used.get("output_tokens") is None or used.get("estimated_cost_usd") is None))
                self.store.append(run_id, [{**common, "event_type": "provider_attempt_failed", "severity": "warning",
                    "input_tokens": used.get("input_tokens"), "output_tokens": used.get("output_tokens"), "elapsed_ms": used.get("elapsed_ms"),
                    "provider_model": used.get("model", config.model), "prompt_hash": used.get("prompt_hash", started["prompt_hash"]),
                    "estimated_cost_usd": used.get("estimated_cost_usd", None if unknown else 0),
                    "payload_json": {"attempt_id": attempt_id, "logical_id": logical_id, "classification": exc.classification, "uncertain": unknown,
                        "total_tokens": used.get("total_tokens"), "thought_tokens": used.get("thought_tokens"), "cached_tokens": used.get("cached_tokens"),
                        "system_fingerprint": used.get("system_fingerprint"), "retry_after_seconds": delay, "key_id": exc.key_id}}])
                if exc.retryable and count < 4:
                    self.store.runtime(run_id, retry_at=(utcnow() + timedelta(seconds=delay)).isoformat())
                    self.status(run_id, "waiting_provider", reason=exc.classification)
                else:
                    self.status(run_id, "provider_blocked", reason=exc.classification)
                return
            except Exception as exc:
                self.store.append(run_id, [{**common, "event_type": "provider_attempt_failed", "severity": "error", "payload_json": {"attempt_id": attempt_id, "logical_id": logical_id, "classification": "adapter_error", "uncertain": True, "exception_type": type(exc).__name__}}])
                self.status(run_id, "provider_blocked", reason="Adapter failed; reservation retained")
                return
            finally:
                if config.provider in {"openai", "deepseek"} and "provider" in locals():
                    await provider.close()
            response["estimated_cost_usd"] = frozen_cost(response, config)
            done = {**common, "event_type": "provider_attempt_completed", "provider_model": response.get("model", config.model),
                    "prompt_hash": response.get("prompt_hash", started["prompt_hash"]),
                    "input_tokens": response.get("input_tokens"), "output_tokens": response.get("output_tokens"),
                    "estimated_cost_usd": response.get("estimated_cost_usd"), "elapsed_ms": response.get("elapsed_ms"),
                    "payload_json": {"attempt_id": attempt_id, "logical_id": logical_id,
                        "thought_tokens": response.get("thought_tokens"), "cached_tokens": response.get("cached_tokens"), "total_tokens": response.get("total_tokens"),
                        "system_fingerprint": response.get("system_fingerprint"), "actual_cost_usd": response.get("actual_cost_usd"), "key_id": response.get("key_id"), "uncertain": response.get("input_tokens") is None or response.get("output_tokens") is None or response.get("estimated_cost_usd") is None}}
            latest = self.store.get(run_id)["state"]
            drafts = process_action(latest, arm, agent_id, response["action"])
            activity = {**common, "event_type": "talk_started" if step["phase"] == "break" else "work_started", "payload_json": {"location": "table" if arm == "C" and step["phase"] == "break" else "desk"}}
            self.store.append(run_id, [activity, done, *drafts], cursor=cursor + 1)

    async def shutdown(self):
        self.closed = True
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        # Mark graceful interrupted runs resumable; attempt reservations remain in events.
        for run in self.store.list():
            if run["status"] in {"running", "pausing", "stopping"} and run.get("lease_owner") in {None, self.owner}:
                self.status(run["id"], "paused", reason="Server stopped; resume from checkpoint")
                self.store.runtime(run["id"], lease_owner=None, lease_until=None, control=None)
