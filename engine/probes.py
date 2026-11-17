"""Isolated probe foundation; scheduler does not yet dispatch model probe sessions."""
import copy
import inspect
from engine.world import digest

PROBE_TYPES = ("information_transfer", "costly_help", "misunderstanding_repair", "handoff_accuracy")
PROBE_DAYS = (1, 3, 5)


def build_probe(state: dict, department_id: str, probe_type: str, hidden_from_agents=True) -> dict:
    if probe_type not in PROBE_TYPES:
        raise ValueError("Unknown probe type.")
    seed = state.get("seed", 42)
    specifications = {
        "information_transfer": dict(instruction="The coordinator privately receives a code; transmit it accurately to the integrator.",
                                     private_inputs={"coordinator": {"code": f"LIME-{seed % 1000:03d}"}}, expected={"code": f"LIME-{seed % 1000:03d}"}),
        "costly_help": dict(instruction="A builder needs two simulation budget units; donate exactly two of your four units.",
                            private_inputs={"coordinator": {"available_units": 4}}, expected={"donated_units": 2}),
        "misunderstanding_repair": dict(instruction="Correct a mistaken handoff saying status is done; the true status is doing.",
                                        private_inputs={"verifier": {"true_status": "doing"}}, expected={"corrected_status": "doing"}),
        "handoff_accuracy": dict(instruction="Transfer the exact artifact identifier and current version to the verifier.",
                                 private_inputs={"builder": {"artifact_id": "probe-artifact", "version": 3}},
                                 expected={"artifact_id": "probe-artifact", "version": 3}),
    }
    specification = specifications[probe_type]
    task_hash = digest(dict(type=probe_type, specification=specification))
    return dict(probe_id=f"{department_id}-{state['virtual_day']}-{probe_type}", probe_type=probe_type,
                department_id=department_id, virtual_day=state["virtual_day"], task_hash=task_hash,
                hidden_from_main_agents=hidden_from_agents, instruction=specification["instruction"],
                private_inputs=specification["private_inputs"], expected=specification["expected"],
                isolated_agents=copy.deepcopy(state["departments"][department_id]["agents"]))


def score_probe(probe: dict, response: dict) -> dict:
    checks = [dict(field=key, passed=response.get(key) == value) for key, value in probe["expected"].items()]
    return dict(probe_id=probe["probe_id"], score=sum(c["passed"] for c in checks) / len(checks),
                passed=all(c["passed"] for c in checks), checks=checks,
                hidden_from_main_agents=probe["hidden_from_main_agents"], injected_into_team_memory=False)


async def run_isolated_probe(state: dict, department_id: str, probe_type: str, respond, hidden_from_agents=True) -> list[dict]:
    """An explicit evaluator callback receives a copy, never the mutable experimental state.

    This is an extension API, not a claim that autonomous model probes are implemented.
    The callback orchestrates isolated agents and returns the typed answer mapping.
    """
    probe = build_probe(state, department_id, probe_type, hidden_from_agents)
    observation = copy.deepcopy(probe)
    observation.pop("expected")
    response = respond(observation)
    if inspect.isawaitable(response):
        response = await response
    result = score_probe(probe, response)
    envelope = dict(department_id=department_id, agent_id=None, channel="probe", task_id=probe["probe_id"])
    return [dict(**envelope, event_type="probe_started", payload_json={k: v for k, v in probe.items() if k != "isolated_agents"}),
            dict(**envelope, event_type="probe_scored", payload_json=dict(**result, response=response))]
