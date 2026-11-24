import asyncio
import copy
import pytest
from pydantic import ValidationError
from engine.domain import ROLES, RunConfig
from engine.world import context_for_agent, digest, evaluate_artifact, initial_state, process_action, RULES
from engine.reducer import reduce_event
from engine.metrics import compute_metrics
from providers.mock import MockProvider


def apply(state, arm, role, action, events=None):
    drafts = process_action(state, arm, f"{arm}-{role}", action)
    for event in drafts:
        event["virtual_day"] = state["virtual_day"]
        state = reduce_event(state, event)
        if events is not None:
            events.append(event)
    return state, drafts


def work_state(arms=None):
    state = initial_state(RunConfig(arms=arms or ["A", "C"]))
    return reduce_event(state, dict(event_type="phase_started", department_id=None,
                                  payload_json=dict(phase="work_block_1", virtual_minute=540), virtual_day=1))


def test_configuration_rejects_unmatched_arms_and_bad_timezones():
    with pytest.raises(ValidationError):
        RunConfig(arms=["C"])
    with pytest.raises(ValidationError):
        RunConfig(timezone="Not/A/Zone")
    with pytest.raises(ValidationError):
        RunConfig(days=6)


def test_initial_board_is_matched_and_independent():
    state = work_state()
    assert state["departments"]["A"]["initial_hash"] == state["departments"]["C"]["initial_hash"]
    state["departments"]["A"]["tasks"][0]["status"] = "changed"
    assert state["departments"]["C"]["tasks"][0]["status"] == "available"


def test_world_never_mutates_input_and_enforces_lifecycle():
    state = work_state()
    before = digest(state)
    drafts = process_action(state, "A", "A-coordinator", dict(type="claim_task", task_id="create"))
    assert drafts[0]["event_type"] == "action_rejected"
    assert drafts[0]["payload_json"]["evidence"]["blocked"]
    assert digest(state) == before
    rejected = reduce_event(state, drafts[0])
    coordinator_memory = rejected["departments"]["A"]["agents"][0]["memory"][-1]
    assert "Dependencies" in coordinator_memory["reason"] and coordinator_memory["evidence"]["blocked"]
    state, _ = apply(state, "A", "coordinator", dict(type="claim_task", task_id="schema"))
    state, _ = apply(state, "A", "builder", dict(type="submit_artifact", task_id="schema", artifact=dict(feature="schema", rules=RULES["schema"])))
    state, _ = apply(state, "A", "verifier", dict(type="review_artifact", task_id="schema", version=1))
    state, _ = apply(state, "A", "integrator", dict(type="complete_milestone", task_id="schema", version=1))
    assert state["departments"]["A"]["tasks"][0]["status"] == "integrated"
    assert state["departments"]["C"]["tasks"][0]["status"] == "available"


def test_evaluator_requires_behavior_and_rejects_self_declared_success():
    for feature, rules in RULES.items():
        assert evaluate_artifact(feature, dict(feature=feature, rules=rules))["passed"]
        assert not evaluate_artifact(feature, dict(feature=feature, rules=rules[1:], passed=True))["passed"]
    state = work_state()
    _, events = apply(state, "A", "builder", dict(type="submit_artifact", task_id="schema", artifact=dict(feature="schema", rules=RULES["schema"], passed=True)))
    assert events[0]["event_type"] == "action_rejected"


def test_failed_review_requires_repair_and_current_version():
    state = work_state()
    state, _ = apply(state, "A", "coordinator", dict(type="claim_task", task_id="schema"))
    state, _ = apply(state, "A", "builder", dict(type="submit_artifact", task_id="schema", artifact=dict(feature="schema", rules=["required_fields"])))
    state, _ = apply(state, "A", "verifier", dict(type="review_artifact", task_id="schema", version=1))
    assert state["departments"]["A"]["tasks"][0]["status"] == "claimed"
    _, events = apply(state, "A", "integrator", dict(type="complete_milestone", task_id="schema", version=1))
    assert events[0]["event_type"] == "action_rejected"
    state, _ = apply(state, "A", "builder", dict(type="submit_artifact", task_id="schema", artifact=dict(feature="schema", rules=RULES["schema"])))
    _, events = apply(state, "A", "verifier", dict(type="review_artifact", task_id="schema", version=1))
    assert events[0]["event_type"] == "action_rejected"


def test_legacy_break_restrictions_and_private_journals():
    state = work_state(["A", "B", "C"])
    state["config"].pop("dialogue_protocol")  # A pre-versioning, persisted run.
    state = reduce_event(state, dict(event_type="phase_started", payload_json=dict(phase="break")))
    for arm in ["A", "B"]:
        _, events = apply(state, arm, "builder", dict(type="chat_smalltalk", utterance_id="tea"))
        assert events[0]["event_type"] == "action_rejected"
    _, events = apply(state, "C", "builder", dict(type="chat_smalltalk", utterance_id="tea", text="The schema is broken"))
    assert events[0]["event_type"] == "action_rejected"
    state, _ = apply(state, "B", "builder", dict(type="journal_non_task", utterance_id="tea"))
    agents = state["departments"]["B"]["agents"]
    assert next(a for a in agents if a["role"] == "builder")["memory"][-1]["channel"] == "notes"
    assert not next(a for a in agents if a["role"] == "verifier")["memory"]
    context = context_for_agent(state, "C", "C-builder", "break")
    assert not {"tasks", "memory", "state", "role_prompt"} & context.keys()
    state, _ = apply(state, "C", "coordinator", dict(type="chat_smalltalk", utterance_id="tea"))
    context = context_for_agent(state, "C", "C-builder", "break")
    assert context["social_messages"] == [dict(text="A warm cup of mint tea sounds lovely this afternoon.", sender_name="Pip", sender_role="coordinator")]
    answer = asyncio.run(MockProvider().generate(context))["action"]
    assert answer["utterance_id"].startswith("reply_")
    builder_notes = context_for_agent(state, "B", "B-builder", "break")
    verifier_notes = context_for_agent(state, "B", "B-verifier", "break")
    assert len(builder_notes["private_notes"]) == 1 and verifier_notes["private_notes"] == []
    assert "social_messages" not in builder_notes and "private_notes" not in context


def test_cross_arm_information_and_role_escalation_rejected():
    state = work_state()
    _, events = apply(state, "A", "coordinator", dict(type="send_work_message", task_id="schema", recipient_id="C-builder", text="Hello"))
    assert events[0]["event_type"] == "action_rejected"
    _, events = apply(state, "A", "builder", dict(type="claim_task", task_id="schema"))
    assert events[0]["event_type"] == "action_rejected"
    context = context_for_agent(state, "A", "A-builder", "work_block_1")
    assert "departments" not in context
    assert all(a["id"].startswith("A-") for a in context["agents"])


def run_mock():
    async def execute():
        state, events, provider = initial_state(RunConfig()), [], MockProvider()
        for day in range(1, 4):
            for phase in ["work_block_1", "break", "work_block_2"]:
                event = dict(event_type="phase_started", payload_json=dict(phase=phase), virtual_day=day)
                state = reduce_event(state, event)
                events.append(event)
                for _ in range(1 if phase == "break" else 3):
                    for arm in ["A", "C"]:
                        if phase == "break" and arm == "A":
                            continue
                        for role in ROLES:
                            context = context_for_agent(state, arm, f"{arm}-{role}", phase)
                            result = await provider.generate(context)
                            state, _ = apply(state, arm, role, result["action"], events)
        return state, events
    return asyncio.run(execute())


def test_mock_determinism_condition_blind_work_and_different_traces():
    state, events = run_mock()
    state2, events2 = run_mock()
    assert state == state2 and events == events2
    a_tasks = copy.deepcopy(state["departments"]["A"]["tasks"])
    c_tasks = copy.deepcopy(state["departments"]["C"]["tasks"])
    for task in a_tasks + c_tasks:
        task["owner"] = task["owner"].split("-", 1)[-1] if task["owner"] else None
    assert a_tasks == c_tasks
    assert any(e["channel"] == "small_talk" for e in events if e.get("channel"))
    assert not any(e.get("channel") == "small_talk" and e.get("department_id") == "A" for e in events)
    assert sum(t["status"] == "integrated" for t in state["departments"]["A"]["tasks"]) == 12


def test_replay_from_initial_and_checkpoint_matches_state_hash():
    state, events = run_mock()
    replayed = initial_state(RunConfig())
    halfway = len(events) // 2
    snapshot = None
    for index, event in enumerate(events):
        replayed = reduce_event(replayed, event)
        if index == halfway:
            snapshot = copy.deepcopy(replayed)
    assert digest(replayed) == digest(state)
    for event in events[halfway + 1:]:
        snapshot = reduce_event(snapshot, event)
    assert digest(snapshot) == digest(state)


def test_raw_event_metrics_do_not_invent_social_advantage():
    _, events = run_mock()
    metrics = compute_metrics(events, RunConfig())["departments"]
    assert metrics["A"]["completed"] == metrics["C"]["completed"] == 12
    assert metrics["A"]["blocked_actions"] >= 1
    assert metrics["C"]["small_talk_messages"] == 12
    assert metrics["A"]["small_talk_messages"] == 0
    assert metrics["A"]["handoffs"] >= 1
    assert metrics["A"]["repairs"] >= 1
    assert metrics["A"]["actual_cost_usd"] is None


def test_usage_metrics_include_retries_uncertainty_latency_and_virtual_clock():
    events = [
        dict(event_type="phase_started", virtual_day=3, payload_json=dict(virtual_minute=900)),
        dict(event_type="provider_attempt_started", department_id="A", ts_utc="2026-11-17T00:00:00+00:00",
             payload_json=dict(attempt_id="one", logical_id="turn", reserved_tokens=100, reserved_cost_usd=0.01)),
        dict(event_type="provider_attempt_failed", department_id="A", ts_utc="2026-11-17T00:00:01+00:00",
             payload_json=dict(attempt_id="one", logical_id="turn", uncertain=True)),
        dict(event_type="provider_attempt_started", department_id="A", ts_utc="2026-11-17T00:00:02+00:00",
             payload_json=dict(attempt_id="two", logical_id="turn", reserved_tokens=100, reserved_cost_usd=0.01)),
        dict(event_type="provider_attempt_completed", department_id="A", ts_utc="2026-11-17T00:00:04+00:00",
             input_tokens=10, output_tokens=5, elapsed_ms=2000, estimated_cost_usd=0.0001,
             payload_json=dict(attempt_id="two", logical_id="turn", thought_tokens=3, cached_tokens=2, total_tokens=18)),
    ]
    metric = compute_metrics(events, RunConfig())["departments"]["A"]
    assert metric["model_calls"] == 2 and metric["retry_attempts"] == 1
    assert metric["failed_attempts"] == 1 and metric["uncertain_attempts"] == 1
    assert metric["total_tokens"] == 18 and metric["thought_tokens"] == 3 and metric["cached_tokens"] == 2
    assert metric["wall_clock_ms"] == 4000 and metric["provider_elapsed_ms"] == 2000
    assert metric["simulated_minutes"] == 3300
    assert metric["actual_cost_usd"] is None and metric["reserved_uncertain_tokens"] == 100


def test_help_is_counted_only_after_previously_unknown_rule_is_correctly_used():
    state, events = work_state(), []
    state, _ = apply(state, "A", "coordinator", dict(type="claim_task", task_id="schema"), events)
    state, _ = apply(state, "A", "integrator", dict(type="send_work_message", task_id="schema", recipient_id="A-builder",
        text="This formal requirement is needed.", kind="help", rule="status_enum"), events)
    assert compute_metrics(events, RunConfig())["departments"]["A"]["help_given"] == 0
    state, _ = apply(state, "A", "builder", dict(type="submit_artifact", task_id="schema",
        artifact=dict(feature="schema", rules=RULES["schema"])), events)
    assert compute_metrics(events, RunConfig())["departments"]["A"]["help_given"] == 1
    # Repeating an already-known fact cannot create another useful transfer.
    state, _ = apply(state, "A", "integrator", dict(type="send_work_message", task_id="schema", recipient_id="A-builder",
        text="The same rule again.", kind="help", rule="status_enum"), events)
    assert not events[-2]["payload_json"]["evidence"]["recipient_lacked_fact"]


def test_probe_foundation_uses_matched_isolated_copies_and_never_injects_scores():
    from engine.probes import build_probe, run_isolated_probe
    state = work_state()
    before = digest(state)
    assert build_probe(state, "A", "information_transfer")["task_hash"] == build_probe(state, "C", "information_transfer")["task_hash"]

    def respond(context):
        context["isolated_agents"][0]["memory"].append({"text": "local only"})
        return context["private_inputs"]["coordinator"]

    events = asyncio.run(run_isolated_probe(state, "A", "information_transfer", respond))
    assert events[-1]["payload_json"]["score"] == 1
    assert events[-1]["payload_json"]["hidden_from_main_agents"]
    for event in events:
        state = reduce_event(state, event)
    assert digest(state) == before
