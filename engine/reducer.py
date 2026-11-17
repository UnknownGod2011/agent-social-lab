"""Pure event reducer shared by execution and historical replay."""
import copy
from engine.world import digest


def reduce_event(state: dict, event: dict) -> dict:
    state = copy.deepcopy(state)
    kind = event["event_type"]
    payload = event.get("payload_json", {})
    if isinstance(payload, str):
        import json
        payload = json.loads(payload)
    department_id, agent_id = event.get("department_id"), event.get("agent_id")
    day = event.get("virtual_day")
    if day is not None:
        state["virtual_day"] = day
    departments = ([state["departments"][department_id]] if department_id in state["departments"] else
                   list(state["departments"].values()))
    agents = [a for d in departments for a in d["agents"] if agent_id is None or a["id"] == agent_id]
    if kind == "status_changed":
        state["status"] = payload["status"]
    elif kind == "phase_started":
        state["phase"] = payload["phase"]
        state["virtual_minute"] = payload.get("virtual_minute", state["virtual_minute"])
        for agent in agents:
            agent["activity"] = payload["phase"]
    elif kind == "cursor_advanced":
        state["cursor"] = payload["cursor"]
    elif kind in {"agent_started", "agent_moving", "work_started", "talk_started", "sleep_started"}:
        activities = {"agent_started": "waking", "agent_moving": "walking", "work_started": "working", "talk_started": "talking", "sleep_started": "sleeping"}
        for agent in agents:
            agent["activity"] = activities[kind]
            agent["location"] = payload.get("location", "bed" if kind == "sleep_started" else agent["location"])
    elif kind in {"action_accepted", "action_rejected"} and department_id in state["departments"]:
        department = state["departments"][department_id]
        if kind == "action_accepted" and payload.get("task"):
            task = payload["task"]
            department["tasks"] = [copy.deepcopy(task) if t["id"] == task["id"] else t for t in department["tasks"]]
        if kind == "action_accepted" and payload.get("help_request"):
            department.setdefault("help_requests", []).append(payload["help_request"])
        for agent in agents:
            agent["memory"].append(dict(day=state["virtual_day"], channel=event.get("channel", "work"), event_type=kind,
                                        action=payload.get("action", {}),
                                        **{key: copy.deepcopy(payload[key]) for key in ("reason", "evidence") if key in payload}))
    elif kind == "message_sent":
        visibility = payload.get("visibility", "department")
        recipients = [a for d in departments for a in d["agents"]
                      if visibility == "department" or a["id"] == agent_id or
                      (visibility == "recipient" and a["id"] == payload.get("recipient_id"))]
        for agent in recipients:
            agent["memory"].append(dict(day=state["virtual_day"], channel=event.get("channel"),
                sender_id=agent_id, text=payload.get("text", ""), event_type=kind,
                **{key: payload[key] for key in ("recipient_id", "fact", "task_id", "evidence_kind", "artifact_version", "recipient_lacked_fact") if key in payload}))
            fact = payload.get("fact")
            if fact and (agent["id"] == payload.get("recipient_id") or agent["id"] == agent_id):
                fact_id = f"{fact['task_id']}:{fact['rule']}"
                if fact_id not in agent.setdefault("known_facts", []):
                    agent["known_facts"].append(fact_id)
    elif kind == "day_completed":
        state["last_completed_day"] = state["virtual_day"]
    for agent in [a for d in state["departments"].values() for a in d["agents"]]:
        agent["memory"] = agent["memory"][-200:]
    return state


__all__ = ["reduce_event", "digest"]
