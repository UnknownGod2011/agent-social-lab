"""A declarative task-board world: artifacts activate rules tested by fixed scenarios."""
import copy
import hashlib
import json
from pydantic import ValidationError
from engine.domain import ACTION_ADAPTER, AGENT_NAMES, CONDITIONS, ROLES, SAFE_UTTERANCES, RunConfig, action_schema

FEATURES = [
    ("schema", "Task data schema", [], ["required_fields", "status_enum"], "Tasks require id/title/status; status is todo, doing, or done."),
    ("create", "Create tasks", ["schema"], ["reject_blank_title", "unique_ids"], "Blank titles are rejected and created IDs are unique."),
    ("list", "List and filter tasks", ["create"], ["list_all", "filter_status"], "Listing returns all tasks and an exact status filter."),
    ("status", "Status transitions", ["create"], ["valid_transition", "reject_unknown_status"], "Update a known status and reject an unknown status."),
    ("assignment", "Assign a task", ["create"], ["assign_known_user", "reject_unknown_user"], "Known users can be assigned; unknown users cannot."),
    ("permissions", "Ownership permissions", ["status", "assignment"], ["owner_can_update", "reject_other_user"], "Only the task owner may change its status."),
    ("audit", "Append audit records", ["status"], ["append_audit", "preserve_history"], "Every transition appends a record without rewriting history."),
    ("export", "Export task records", ["list", "audit"], ["export_tasks", "omit_private_fields"], "Export all records while excluding private fields."),
    ("import", "Import task records", ["schema", "export"], ["import_valid", "reject_duplicate_ids"], "Valid records import and duplicate IDs are rejected."),
    ("dependencies", "Task dependency rules", ["status"], ["block_unfinished_dependency", "allow_finished_dependency"], "Incomplete prerequisites block work; finished prerequisites permit it."),
    ("regression", "Regression test manifest", ["permissions", "import", "dependencies"], ["cover_all_features", "include_negative_cases"], "Regression coverage includes all ten features and negative cases."),
    ("release", "Integrated release manifest", ["regression"], ["complete_manifest", "versioned_release"], "A versioned manifest includes all eleven preceding features."),
]
RULES = {feature[0]: feature[3] for feature in FEATURES}


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def initial_state(config: RunConfig | dict) -> dict:
    config = config if isinstance(config, RunConfig) else RunConfig.model_validate(config)
    tasks = [dict(id=key, title=title, dependencies=deps, acceptance=acceptance, required_rules=rules,
                  status="available", owner=None, artifact=None, version=0, review=None)
             for key, title, deps, rules, acceptance in FEATURES]
    initial_hash = digest(tasks)
    departments = {}
    for arm in config.arms:
        departments[arm] = dict(id=arm, condition=CONDITIONS[arm], initial_hash=initial_hash,
            tasks=copy.deepcopy(tasks), help_requests=[],
            agents=[dict(id=f"{arm}-{role}", name=AGENT_NAMES[role], role=role, activity="idle", location="desk", memory=[],
                         known_facts=[f"{task_id}:{rule}" for task_id, rules in RULES.items() for rule in rules
                                      if not (role == "builder" and task_id == "schema" and rule == "status_enum")])
                    for role in ROLES])
    return dict(status="ready", virtual_day=1, phase="ready", virtual_minute=480, cursor=0,
                seed=config.seed, config=config.model_dump(), departments=departments)


def _scenario(feature: str, rule: str, enabled: set[str]):
    """Execute the compact feature DSL against concrete fixed example records."""
    works = rule in enabled
    records = [{"id": "t1", "title": "A", "status": "todo", "owner": "u1", "_secret": "private"},
               {"id": "t2", "title": "B", "status": "done", "owner": "u2"}]
    if feature == "schema":
        actual = ["id", "title", "status"] if rule == "required_fields" and works else (["todo", "doing", "done"] if works else [])
        expected = ["id", "title", "status"] if rule == "required_fields" else ["todo", "doing", "done"]
    elif feature == "create":
        actual = ("rejected" if works else "created") if rule == "reject_blank_title" else (["t3", "t4"] if works else ["t3", "t3"])
        expected = "rejected" if rule == "reject_blank_title" else ["t3", "t4"]
    elif feature == "list":
        actual = records if rule == "list_all" and works else ([r for r in records if r["status"] == "done"] if works else [])
        expected = records if rule == "list_all" else [records[1]]
    elif feature in {"status", "assignment", "permissions"}:
        negative = rule.startswith("reject_")
        actual = ("rejected" if negative else "updated") if works else ("updated" if negative else "rejected")
        expected = "rejected" if negative else "updated"
    elif feature == "audit":
        history = [{"status": "todo"}]
        actual = history + [{"status": "doing"}] if works else [{"status": "doing"}]
        expected = history + [{"status": "doing"}]
    elif feature == "export":
        actual = ([{k: v for k, v in r.items() if not k.startswith("_")} for r in records]
                  if rule == "omit_private_fields" and works else (records if works or rule == "omit_private_fields" else []))
        expected = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records] if rule == "omit_private_fields" else records
    elif feature == "import":
        actual = ("rejected" if works else "imported") if rule == "reject_duplicate_ids" else (len(records) if works else 0)
        expected = "rejected" if rule == "reject_duplicate_ids" else 2
    elif feature == "dependencies":
        actual = ("blocked" if works else "allowed") if rule == "block_unfinished_dependency" else ("allowed" if works else "blocked")
        expected = "blocked" if rule == "block_unfinished_dependency" else "allowed"
    elif feature == "regression":
        actual = (list(RULES)[:10] if works else []) if rule == "cover_all_features" else (2 if works else 0)
        expected = list(RULES)[:10] if rule == "cover_all_features" else 2
    else:
        actual = (list(RULES)[:11] if works else []) if rule == "complete_manifest" else ("1.0.0" if works else None)
        expected = list(RULES)[:11] if rule == "complete_manifest" else "1.0.0"
    return actual, expected


def evaluate_artifact(task_id: str, artifact: dict) -> dict:
    if task_id not in RULES or artifact.get("feature") != task_id:
        return {"passed": False, "checks": [], "missing_rules": RULES.get(task_id, []), "reason": "Artifact feature does not match its milestone."}
    enabled = set(artifact.get("rules", []))
    checks = []
    for rule in RULES[task_id]:
        actual, expected = _scenario(task_id, rule, enabled)
        checks.append(dict(name=rule, passed=actual == expected, actual=actual, expected=expected))
    return dict(passed=all(c["passed"] for c in checks), checks=checks,
                missing_rules=[c["name"] for c in checks if not c["passed"]])


def context_for_agent(state: dict, department_id: str, agent_id: str, phase: str) -> dict:
    department = state["departments"][department_id]
    agent = next(a for a in department["agents"] if a["id"] == agent_id)
    common = dict(department_id=department_id, agent_id=agent_id, role=agent["role"], phase=phase,
                  day=state["virtual_day"], seed=state.get("seed", 42), cursor=state.get("cursor", 0))
    if phase == "break":
        # No board, work memories, status, artifacts, or role prompts enter break prompts.
        context = dict(**common, condition=department["condition"], safe_utterances=SAFE_UTTERANCES,
                       instruction="Choose one safe non-task utterance ID. You may respond to a previous safe line. Do not discuss work.")
        if department_id == "C":
            speakers = {a["id"]: a for a in department["agents"]}
            context["social_messages"] = [dict(text=m["text"], sender_name=speakers[m["sender_id"]]["name"],
                sender_role=speakers[m["sender_id"]]["role"]) for m in agent["memory"]
                if m.get("channel") == "small_talk" and m.get("text") and m.get("day") == state["virtual_day"]][-12:]
        elif department_id == "B":
            context["private_notes"] = [m["text"] for m in agent["memory"]
                if m.get("channel") == "notes" and m.get("text") and m.get("sender_id") == agent_id][-12:]
        return context
    visible_tasks = copy.deepcopy(department["tasks"])
    for task in visible_tasks:
        task["required_rules"] = [rule for rule in task["required_rules"] if f"{task['id']}:{rule}" in agent.get("known_facts", [])]
    return dict(**common, condition=department["condition"], tasks=visible_tasks,
                agents=[dict(id=a["id"], role=a["role"]) for a in department["agents"]],
                memory=copy.deepcopy(agent["memory"][-30:]), help_requests=copy.deepcopy(department.get("help_requests", [])),
                role_prompt=state.get("config", {}).get("role_prompts", {}).get(agent["role"], ""),
                action_schema=action_schema(), instruction="Choose one typed action. Artifacts are declarative feature rules, not executable code.")


def process_action(state: dict, department_id: str, agent_id: str, raw: dict) -> list[dict]:
    def draft(kind, payload, channel="work", task_id=None):
        return dict(event_type=kind, department_id=department_id, agent_id=agent_id,
                    channel=channel, task_id=task_id, payload_json=payload)

    def reject(reason, **evidence):
        return [draft("action_rejected", dict(action=raw, reason=reason, evidence=evidence),
                      task_id=raw.get("task_id") if isinstance(raw, dict) else None)]

    try:
        action = ACTION_ADAPTER.validate_python(raw).model_dump()
    except ValidationError as error:
        return reject("Typed action schema rejected the request: " + str(error.errors(include_input=False)[0]["msg"]))
    department = state["departments"].get(department_id)
    if not department:
        return reject("Unknown department.")
    agent = next((a for a in department["agents"] if a["id"] == agent_id), None)
    if not agent:
        return reject("Agent is not a member of this department.")
    kind = action["type"]
    if kind in {"chat_smalltalk", "journal_non_task"}:
        expected = "C" if kind == "chat_smalltalk" else "B"
        if state["phase"] != "break" or department_id != expected:
            return reject("This non-task channel is unavailable in this condition or phase.", restricted=True)
        channel = "small_talk" if expected == "C" else "notes"
        return [draft("action_accepted", {"action": action}, channel),
                draft("message_sent", dict(text=SAFE_UTTERANCES[action["utterance_id"]],
                    visibility="department" if expected == "C" else "private", recipient_id=None), channel)]
    if state["phase"] not in {"planning", "work_1", "work_2", "work_block_1", "work_block_2", "work"}:
        return reject("Work actions are allowed only during planning or work blocks.")
    if kind == "wait":
        return [draft("action_accepted", {"action": action})]
    task = next((t for t in department["tasks"] if t["id"] == action.get("task_id")), None)
    if not task:
        return reject("Unknown milestone.")
    task = copy.deepcopy(task)
    tasks = {t["id"]: t for t in department["tasks"]}
    unfinished = [dep for dep in task["dependencies"] if tasks[dep]["status"] != "integrated"]
    role = agent["role"]
    payload = dict(action=action)
    messages = []
    if kind == "claim_task":
        if role != "coordinator":
            return reject("Only the coordinator assigns a milestone.")
        if unfinished:
            return reject("Dependencies are not integrated: " + ", ".join(unfinished), blocked=True)
        if task["status"] != "available":
            return reject("This milestone already has an assignment.", duplicate_avoided=True)
        task.update(status="claimed", owner=f"{department_id}-builder")
    elif kind == "submit_artifact":
        if role != "builder" or task["owner"] != agent_id:
            return reject("Only the assigned builder can submit this artifact.")
        if task["status"] != "claimed":
            return reject("Submission requires an assigned milestone.")
        if unfinished:
            return reject("Dependencies are not integrated.", blocked=True)
        if action["artifact"]["feature"] != task["id"] or set(action["artifact"]["rules"]) - set(RULES[task["id"]]):
            return reject("Artifact contains an unknown feature rule.")
        task.update(status="submitted", artifact=action["artifact"], version=task["version"] + 1, review=None)
        uses = []
        for memory in agent["memory"]:
            fact = memory.get("fact")
            if fact and memory.get("sender_id") != agent_id and memory.get("recipient_id") == agent_id and memory.get("recipient_lacked_fact") and fact.get("task_id") == task["id"] and fact.get("rule") in action["artifact"]["rules"]:
                actual, expected = _scenario(task["id"], fact["rule"], set(action["artifact"]["rules"]))
                if actual == expected:
                    uses.append(dict(kind=memory.get("evidence_kind"), sender_id=memory["sender_id"], recipient_id=agent_id,
                                     task_id=task["id"], rule=fact["rule"], artifact_version=task["version"]))
        payload["cooperation_uses"] = uses
    elif kind == "review_artifact":
        if role != "verifier" or task["status"] != "submitted" or task["version"] != action["version"]:
            return reject("Review requires a submitted artifact, current version, and the verifier role.")
        review = evaluate_artifact(task["id"], task["artifact"])
        task.update(status="verified" if review["passed"] else "claimed", review=review)
        payload["evidence"] = {"review_passed": review["passed"], "checks": review["checks"]}
        payload["cooperation_uses"] = [dict(kind="handoff", sender_id=m["sender_id"], recipient_id=agent_id,
            task_id=task["id"], artifact_version=task["version"])
            for m in agent["memory"] if m.get("evidence_kind") == "handoff" and
            m.get("task_id") == task["id"] and m.get("artifact_version") == task["version"]]
    elif kind == "complete_milestone":
        if role != "integrator" or task["status"] != "verified" or task["version"] != action["version"]:
            return reject("Integration requires a verified current artifact and the integrator role.")
        if unfinished or not task.get("review", {}).get("passed"):
            return reject("Integration requires all dependencies and machine checks to pass.", blocked=True)
        task["status"] = "integrated"
    elif kind in {"request_help", "send_work_message"}:
        recipient = action["recipient_id"]
        if recipient == agent_id or not any(a["id"] == recipient for a in department["agents"]):
            return reject("Work messages must address another agent in the same department.")
        if kind == "request_help":
            payload["help_request"] = dict(task_id=task["id"], sender_id=agent_id, recipient_id=recipient)
            text = f"Please help with {task['title']}; I need an accurate requirement or dependency handoff."
        else:
            evidence_kind = action["kind"]
            rule_valid = action["rule"] in RULES[task["id"]]
            accurate_version = bool(task["artifact"]) and action["artifact_version"] == task["version"]
            missing = task.get("review", {}).get("missing_rules", []) if task.get("review") else []
            recipient_agent = next(a for a in department["agents"] if a["id"] == recipient)
            fact_id = f"{task['id']}:{action['rule']}"
            recipient_lacked_fact = rule_valid and fact_id not in recipient_agent.get("known_facts", [])
            sender_knows_fact = fact_id in agent.get("known_facts", [])
            valid = ((evidence_kind == "information") or
                     (evidence_kind == "handoff" and accurate_version and role in {"builder", "verifier"}) or
                     (evidence_kind == "help" and rule_valid and sender_knows_fact) or
                     (evidence_kind == "repair" and rule_valid and sender_knows_fact and action["rule"] in missing))
            if not valid:
                return reject("The cooperation claim does not match the artifact version or objective requirement.")
            payload["evidence"] = dict(kind=evidence_kind, correct=True, rule=action["rule"],
                artifact_version=action["artifact_version"], recipient_id=recipient, task_id=task["id"])
            payload["evidence"]["recipient_lacked_fact"] = recipient_lacked_fact
            # Evidence-bearing information is constructed from verified fields, not inferred from prose.
            suffix = f" Required rule: {action['rule']}." if action["rule"] else (f" Artifact version: {action['artifact_version']}." if accurate_version else "")
            text = action["text"] + suffix
        message = dict(text=text, recipient_id=recipient, visibility="recipient")
        if kind == "send_work_message":
            message.update(evidence_kind=action["kind"], artifact_version=action["artifact_version"], task_id=task["id"],
                           recipient_lacked_fact=recipient_lacked_fact,
                           fact=dict(task_id=task["id"], rule=action["rule"]) if rule_valid else None)
        messages.append(draft("message_sent", message, task_id=task["id"]))
    else:
        return reject("Unsupported action.")
    if kind not in {"request_help", "send_work_message"}:
        payload["task"] = task
    return [draft("action_accepted", payload, task_id=task["id"]), *messages]
