"""A hidden-profile purchasing work sample with a private, deterministic evaluator."""
from __future__ import annotations

import copy
import random
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter, ValidationError

from engine.domain import ROLES, StrictModel, WaitAction

ENVIRONMENT = "supplier_selection_v1"
SUPPLIERS = ("Alder", "Birch", "Cedar", "Elm")
Supplier = Literal["Alder", "Birch", "Cedar", "Elm"]
DIMENSIONS = dict(zip(ROLES, ("delivery reliability", "total cost value", "quality assurance", "service coverage")))
CASE_TITLES = ("Office supplies (practice)", "Equipment servicing", "Library fixtures", "Repair parts",
               "Event logistics", "Workshop supplies", "Facilities maintenance")


class ShareEvidence(StrictModel):
    type: Literal["share_evidence"]
    task_id: str
    suppliers: list[Supplier] = Field(min_length=1, max_length=2)


class RequestEvidence(StrictModel):
    type: Literal["request_evidence"]
    task_id: str
    from_role: Literal["coordinator", "builder", "verifier", "integrator"]
    supplier: Supplier


class AwardContract(StrictModel):
    type: Literal["award_contract"]
    task_id: str
    supplier: Supplier


_MEMBER = TypeAdapter(Annotated[ShareEvidence | RequestEvidence | WaitAction, Field(discriminator="type")])
_CHAIR = TypeAdapter(Annotated[ShareEvidence | RequestEvidence | AwardContract | WaitAction, Field(discriminator="type")])


@lru_cache(maxsize=256)
def _scorecards(seed: int):
    """Immutable cards. The joint optimum is unique and no member's local favorite."""
    rng = random.Random(f"{ENVIRONMENT}:{seed}")
    cases = []
    while len(cases) < len(CASE_TITLES):
        rows = tuple(tuple(rng.sample(range(1, 10), len(SUPPLIERS))) for _ in ROLES)
        totals = tuple(map(sum, zip(*rows)))
        winner = totals.index(max(totals))
        if sorted(totals)[-1] - sorted(totals)[-2] >= 2 and all(row[winner] < max(row) for row in rows):
            cases.append(rows)
    return tuple(cases)


def case_baselines(seed):
    scored = _scorecards(seed)[1:]
    totals = [tuple(map(sum, zip(*cards))) for cards in scored]
    maximum = sum(max(t) for t in totals)
    local = sum(t[cards[-1].index(max(cards[-1]))] for cards, t in zip(scored, totals))
    chance = sum(sum(t) / len(t) for t in totals)
    return dict(attainable_points=maximum, solo_favorite_yield=local / maximum, uniform_choice_yield=chance / maximum)


def casebook(seed):
    return {f"case-{i}" if i else "practice": {
        "scored": bool(i), "title": CASE_TITLES[i],
        "cards": {role: dict(zip(SUPPLIERS, row)) for role, row in zip(ROLES, cards)}
    } for i, cards in enumerate(_scorecards(seed))}


def initialize(state):
    from engine.world import digest

    cards = _scorecards(state["seed"])
    tasks = [dict(id=f"case-{i}" if i else "practice", title=title, scored=bool(i), dependencies=[],
                  acceptance="Choose one supplier. The four private criteria have equal weight.",
                  status="available", owner=None, version=0, review=None, artifact=None, disclosed={}, requests=[])
             for i, title in enumerate(CASE_TITLES)]
    bank_hash = digest(dict(environment=ENVIRONMENT, tasks=tasks, cards=cards))
    for department in state["departments"].values():
        department.update(tasks=copy.deepcopy(tasks), initial_hash=bank_hash)
        for agent in department["agents"]:
            agent["known_facts"] = []
    return state


def _active(state, department):
    # Practice closes at the first break whether it was solved or left unfinished.
    scored = state["virtual_day"] > 1 or state["phase"] == "work_block_2"
    return next(((i, task) for i, task in enumerate(department["tasks"])
                 if task["scored"] == scored and task["status"] != "integrated"), (None, None))


def work_view(state, department_id, agent_id):
    dept = state["departments"][department_id]
    agent = next(a for a in dept["agents"] if a["id"] == agent_id)
    role = agent["role"]
    index, task = _active(state, dept)
    case = None
    if task:
        own = _scorecards(state["seed"])[index][ROLES.index(role)]
        case = dict(id=task["id"], title=task["title"], private_criterion=DIMENSIONS[role],
                    your_scores=dict(zip(SUPPLIERS, own)), published_scores=copy.deepcopy(task["disclosed"]),
                    available_to_share=[s for s in SUPPLIERS if s not in task["disclosed"].get(role, {})],
                    recent_rejections=[m["reason"] for m in agent["memory"] if "reason" in m
                                       and m.get("channel") == "work" and m.get("action", {}).get("task_id") == task["id"]][-2:],
                    requests=[r.copy() for r in task["requests"] if role in (r["requester"], r["from_role"])][-12:])
    instruction = ("Select the supplier maximizing the sum of four equally weighted 1–9 scores. "
                   "Each role has one private scorecard. Spend a turn to publish up to two supplier scores "
                   "from available_to_share. Never repeat a published cell. "
                   "Alternatively ask a colleague for a specific missing score or wait. The integrator alone awards "
                   "each contract once. As integrator, weigh all four criteria and make a decision before time expires. "
                   "Only published scores and your own are visible. Each outstanding scored contract earns zero. "
                   "Practice closes at the first break. The six scored tenders share one remaining time allowance. "
                   "Use wait if there is no open case.")
    custom = state["config"].get("role_prompts", {}).get(role, "")
    from engine.domain import DEFAULT_ROLE_PROMPTS
    if custom and custom != DEFAULT_ROLE_PROMPTS[role]:
        instruction += " Additional role instructions: " + custom
    return dict(environment=ENVIRONMENT, role=role, department_id=department_id, agent_id=agent_id,
                phase=state["phase"], day=state["virtual_day"], case=case, criteria=DIMENSIONS.copy(),
                role_prompt=instruction, action_schema=(_CHAIR if role == "integrator" else _MEMBER).json_schema())


def apply_action(state, department_id, agent_id, raw):
    def event(kind, payload, task_id=None):
        return dict(event_type=kind, department_id=department_id, agent_id=agent_id, channel="work",
                    task_id=task_id, payload_json=payload)

    def reject(reason):
        return [event("action_rejected", dict(action=raw, reason=reason))]

    dept = state["departments"].get(department_id)
    role = next((a["role"] for a in (dept or {}).get("agents", []) if a["id"] == agent_id), None)
    if not role or state["phase"] not in {"work_block_1", "work_block_2"}:
        return reject("Only a department member in a work block may act.")
    try:
        action = (_CHAIR if role == "integrator" else _MEMBER).validate_python(raw)
    except ValidationError:
        return reject("This role needs a valid procurement action.")
    payload = dict(action=action.model_dump())
    if isinstance(action, WaitAction):
        return [event("action_accepted", payload)]
    index, current = _active(state, dept)
    if current is None or current["id"] != action.task_id:
        return reject("This contract is closed or has not been released.")
    task = copy.deepcopy(current)
    cards = _scorecards(state["seed"])[index]
    extra = []
    if isinstance(action, ShareEvidence):
        shared = task["disclosed"].setdefault(role, {})
        if len(set(action.suppliers)) != len(action.suppliers) or any(s in shared for s in action.suppliers):
            return reject("Publish one or two distinct scores that you have not already disclosed.")
        facts = {s: cards[ROLES.index(role)][SUPPLIERS.index(s)] for s in action.suppliers}
        shared.update(facts)
        text = f"{DIMENSIONS[role].capitalize()} scores: " + ", ".join(f"{s} {v}/9" for s, v in facts.items()) + "."
        extra.append(event("message_sent", dict(text=text, visibility="department", evidence_kind="scorecard",
            facts=facts, scored_case=task["scored"], recipient_id=f"{department_id}-integrator" if role != "integrator" else None), task["id"]))
    elif isinstance(action, RequestEvidence):
        request = dict(requester=role, from_role=action.from_role, supplier=action.supplier)
        if role == action.from_role or action.supplier in task["disclosed"].get(action.from_role, {}) or request in task["requests"]:
            return reject("Request one outstanding score from another role.")
        task["requests"].append(request)
        extra.append(event("message_sent", dict(text=f"Please share the {DIMENSIONS[action.from_role]} score for {action.supplier}.",
            visibility="recipient", recipient_id=f"{department_id}-{action.from_role}", evidence_kind="score_request"), task["id"]))
    else:
        totals = dict(zip(SUPPLIERS, map(sum, zip(*cards))))
        chosen = totals[action.supplier]
        oracle = max(totals.values())
        task.update(status="integrated", version=1, artifact=dict(supplier=action.supplier),
                    review=dict(scored=task["scored"], earned_points=chosen, max_points=oracle, optimal=chosen == oracle,
                                disclosed_external_cells=sum(len(v) for k, v in task["disclosed"].items() if k != "integrator")))
    payload["task"] = task
    return [event("action_accepted", payload, task["id"]), *extra]


def scripted_action(context):
    """A full-information-seeking baseline; each policy sees exactly the live agent view."""
    case, role = context["case"], context["role"]
    wait = dict(type="wait", reason="no_available_work")
    if case is None:
        return wait
    published, own = case["published_scores"], case["your_scores"]
    missing = [s for s in SUPPLIERS if s not in published.get(role, {})]
    if role != "integrator" and missing:
        wanted = [r["supplier"] for r in case["requests"] if r["from_role"] == role and r["supplier"] in missing]
        ordered = list(dict.fromkeys(wanted + sorted(missing, key=own.get, reverse=True)))
        return dict(type="share_evidence", task_id=case["id"], suppliers=ordered[:2])
    if role == "integrator":
        for other in ROLES[:-1]:
            for supplier in SUPPLIERS:
                if supplier not in published.get(other, {}):
                    request = dict(requester=role, from_role=other, supplier=supplier)
                    if request in case["requests"]:
                        return wait
                    return dict(type="request_evidence", task_id=case["id"], from_role=other, supplier=supplier)
        total = {s: own[s] + sum(published[r][s] for r in ROLES[:-1]) for s in SUPPLIERS}
        return dict(type="award_contract", task_id=case["id"], supplier=max(total, key=total.get))
    return wait
