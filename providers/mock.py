"""Seeded offline policy. Social condition never changes the work policy."""
import hashlib
from engine.domain import SAFE_UTTERANCES


class MockProvider:
    async def generate(self, context: dict) -> dict:
        state = context.get("state")
        if state:
            from engine.world import context_for_agent
            context = context_for_agent(state, context["department_id"], context["agent_id"], context["phase"])
        role, arm = context["role"], context["department_id"]
        tasks = context.get("tasks", [])
        phase = context["phase"]
        action = {"type": "wait", "reason": "no_available_work"}
        salt = f"{context.get('seed', 42)}:{context.get('day', 1)}:{role}:{phase}"
        choice = int(hashlib.sha256(salt.encode()).hexdigest()[:8], 16)
        if phase == "break":
            if arm in {"B", "C"}:
                choices = list(SAFE_UTTERANCES)[:8]
                if arm == "C" and context.get("social_messages"):
                    choices = [key for key in SAFE_UTTERANCES if key.startswith("reply_")]
                action = dict(type="chat_smalltalk" if arm == "C" else "journal_non_task",
                              utterance_id=choices[choice % len(choices)])
            else:
                action = dict(type="wait", reason="rest")
        elif role == "coordinator":
            ready = [t for t in tasks if t["status"] == "available" and
                     all(next(x for x in tasks if x["id"] == dep)["status"] == "integrated" for dep in t["dependencies"])]
            # One deterministic dependency mistake demonstrates a real rejected action in both arms.
            if context.get("day", 1) == 1 and all(t["status"] == "available" for t in tasks) and not any(
                    m.get("action", {}).get("type") == "claim_task" for m in context.get("memory", [])):
                action = dict(type="claim_task", task_id=["create", "list", "status"][context.get("seed", 42) % 3])
            elif ready:
                action = dict(type="claim_task", task_id=ready[choice % len(ready)]["id"])
            else:
                pending = next((t for t in tasks if t["status"] in {"claimed", "submitted", "verified"}), None)
                if pending:
                    action = dict(type="request_help", task_id=pending["id"], recipient_id=f"{arm}-builder")
        elif role == "builder":
            pending = next((t for t in tasks if t["status"] == "claimed"), None)
            if pending:
                rules = list(pending["required_rules"])
                # The first schema artifact omits one requirement; verifier must reject and repair it.
                if pending["id"] == "schema" and pending["version"] == 0:
                    rules = rules[:1]
                action = dict(type="submit_artifact", task_id=pending["id"], artifact=dict(feature=pending["id"], rules=rules))
            else:
                pending = next((t for t in tasks if t["status"] in {"submitted", "verified"}), None)
                if pending:
                    action = dict(type="send_work_message", task_id=pending["id"], recipient_id=f"{arm}-verifier",
                        kind="handoff", artifact_version=pending["version"], text="The submitted artifact is ready for the next review.")
        elif role == "verifier":
            pending = next((t for t in tasks if t["status"] == "submitted"), None)
            if pending:
                has_handoff = any(m.get("sender_id") == f"{arm}-builder" and "artifact" in m.get("text", "").lower()
                                  for m in context.get("memory", []))
                if pending["id"] == "create" and not has_handoff:
                    action = dict(type="request_help", task_id=pending["id"], recipient_id=f"{arm}-builder")
                else:
                    action = dict(type="review_artifact", task_id=pending["id"], version=pending["version"])
            else:
                pending = next((t for t in tasks if t.get("review") and not t["review"]["passed"]), None)
                if pending:
                    action = dict(type="send_work_message", task_id=pending["id"], recipient_id=f"{arm}-builder", kind="repair",
                                  rule=pending["review"]["missing_rules"][0], text="A scenario exposed a missing requirement; please include this rule.")
        elif role == "integrator":
            pending = next((t for t in tasks if t["status"] == "verified"), None)
            if pending:
                action = dict(type="complete_milestone", task_id=pending["id"], version=pending["version"])
            else:
                pending = next((t for t in tasks if t.get("review") and not t["review"]["passed"]), None)
                if pending:
                    action = dict(type="send_work_message", task_id=pending["id"], recipient_id=f"{arm}-builder", kind="repair",
                                  rule=pending["review"]["missing_rules"][0], text="The failed check identifies the precise rule needed for a repair.")
        return dict(action=action, input_tokens=0, output_tokens=0, elapsed_ms=0,
                    model="mock-v1", estimated_cost_usd=0.0)
