import copy
import json

import pytest

from engine import dialogue
from engine.domain import ROLES, RunConfig
from engine.reducer import reduce_event
from engine.world import context_for_agent, initial_state, process_action
from providers.base import prompt_for, provider_schema
from scripts.fit_dialogue_profile import fit, surface_act


def setup_break(seed=123):
    state = initial_state(RunConfig(seed=seed, arms=["A", "B", "C"]))
    return reduce_event(state, {"event_type": "phase_started", "payload_json": {"phase": "break"}})


def play_line(state, arm, role, choice):
    kind = "journal_non_task" if arm == "B" else "chat_smalltalk"
    events = process_action(state, arm, f"{arm}-{role}", {"type": kind, "utterance_id": choice})
    assert [e["event_type"] for e in events] == ["action_accepted", "message_sent"]
    for event in events:
        state = reduce_event(state, event)
    return state, events[-1]["payload_json"]


def test_profile_calculation_skips_incomplete_threads_and_matches_transition_definition():
    messages = [{"agent": str(i % 2), "message": text} for i, text in
                enumerate(["Tea?", "Oh, definitely.", "I like mint.", "Yeah, which kind?"])]
    records = {"a": {"content": messages}, "b": {"content": messages[:3]},
               "c": {"content": [messages[0]] * 4}}
    profile = fit(records)
    assert profile["eligible_dialogues"] == 1
    assert profile["opening_counts"] == {"question": 1}
    assert profile["transition_counts"]["statement"] == {"question": 1}
    published = dialogue.PROFILE
    assert sum(published["opening_counts"].values()) == published["eligible_dialogues"] == 8628
    assert sum(sum(row.values()) for row in published["transition_counts"].values()) == 25884


def test_matched_styles_private_journal_public_response_and_later_work_visibility():
    state = setup_break()
    untouched = copy.deepcopy(state)
    lines = {"B": [], "C": []}
    for i, role in enumerate(ROLES):
        for arm in ("B", "C"):
            view = context_for_agent(state, arm, f"{arm}-{role}", "break")
            assert list(view["safe_utterances"]) == ["one", "two", "three"]
            assert set(provider_schema(view)["properties"]["type"]["enum"]) == {
                "journal_non_task" if arm == "B" else "chat_smalltalk"}
            assert all(surface_act(t) == dialogue.style_plan(123, 1)[i] for t in view["safe_utterances"].values())
            state, payload = play_line(state, arm, role, dialogue.SLOTS[i % 3])
            lines[arm].append(payload)
        assert lines["B"][-1]["break_turn"] == lines["C"][-1]["break_turn"]
    for arm in "ABC":
        for i, role in enumerate(ROLES):
            view = context_for_agent(state, arm, f"{arm}-{role}", "work_block_2")
            remembered = view["break_memory"]
            expected = lines["B"][i:i + 1] if arm == "B" else lines.get(arm, [])
            assert [m["text"] for m in remembered] == [e["text"] for e in expected]
            assert all(m["speaker"] in ROLES for m in remembered)
            assert view["memory"] == []
    assert state["departments"]["B"]["tasks"] == untouched["departments"]["B"]["tasks"]
    assert state["departments"]["C"]["tasks"] == untouched["departments"]["C"]["tasks"]
    assert state["departments"]["A"] == untouched["departments"]["A"]


def test_next_table_menu_depends_on_actual_previous_choice():
    original = setup_break()
    first, _ = play_line(original, "C", "coordinator", "one")
    second, _ = play_line(original, "C", "coordinator", "two")
    one = context_for_agent(first, "C", "C-builder", "break")
    two = context_for_agent(second, "C", "C-builder", "break")
    assert one["safe_utterances"] != two["safe_utterances"]
    assert one["social_messages"] != two["social_messages"]
    assert context_for_agent(first, "B", "B-builder", "break") == context_for_agent(second, "B", "B-builder", "break")


@pytest.mark.parametrize(("arm", "proposal"), [
    ("A", {"type": "chat_smalltalk", "utterance_id": "one"}),
    ("B", {"type": "chat_smalltalk", "utterance_id": "one"}),
    ("C", {"type": "chat_smalltalk", "utterance_id": "one", "text": "SENTINEL"}),
    ("C", {"type": "send_work_message", "text": "SENTINEL"}),
    ("C", {"type": "chat_smalltalk", "utterance_id": "SENTINEL"}),
])
def test_leak_attempts_cannot_reach_messages_or_work_memory(arm, proposal):
    state = setup_break()
    events = process_action(state, arm, f"{arm}-builder", proposal)
    assert [e["event_type"] for e in events] == ["action_rejected"]
    assert "SENTINEL" not in json.dumps(events)
    assert events[0]["channel"] != "work"
    updated = reduce_event(state, events[0])
    assert context_for_agent(updated, arm, f"{arm}-builder", "work_block_2")["memory"] == []


def test_break_prompt_projection_discards_secret_work_material_and_condition_labels():
    state = setup_break()
    agent = state["departments"]["C"]["agents"][0]
    agent["memory"].append({"channel": "work", "text": "SENTINEL", "event_type": "message_sent"})
    state["config"]["role_prompts"]["coordinator"] = "SENTINEL"
    view = context_for_agent(state, "C", agent["id"], "break")
    system, text, _ = prompt_for({**view, "tasks": ["SENTINEL"], "role_prompt": "SENTINEL"})
    assert "SENTINEL" not in system + text
    assert not set(json.loads(text)).intersection({"department_id", "agent_id", "cursor", "seed", "condition"})


def test_supplier_wire_prompt_excludes_arm_labels_and_respects_environment_schema():
    view = {"phase": "work_block_1", "environment": "supplier_selection_v1", "role": "builder",
            "department_id": "C", "agent_id": "C-builder", "condition": "small_talk", "seed": 123,
            "cursor": 4, "turn_index": 3, "paid_confirmed": False,
            "action_schema": {"oneOf": [{"type": "object", "properties": {"type": {"const": "unique_case_action"}}}]}}
    _, text, _ = prompt_for(view)
    assert json.loads(text) == {"phase": "work_block_1", "environment": "supplier_selection_v1", "role": "builder"}
    assert provider_schema(view)["anyOf"][0]["properties"]["type"]["enum"] == ["unique_case_action"]
