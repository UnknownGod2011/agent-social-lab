"""Outcome, usage, and evidence-backed cooperation counts from immutable events."""
import json
from datetime import datetime
from engine.world import FEATURES


def compute_metrics(events: list[dict], config=None) -> dict:
    cfg = config.model_dump() if hasattr(config, "model_dump") else (config or {})
    arms = cfg.get("arms", sorted({e.get("department_id") for e in events if e.get("department_id")})) or ["A", "C"]
    departments = {arm: dict(completed=0, total=len(FEATURES), completion=0.0, invalid_actions=0,
        blocked_actions=0, help_given=0, help_received=0, handoffs=0, repairs=0, duplicates_avoided=0,
        duplicate_claims_prevented=0, work_turns=0, messages=0, small_talk_messages=0, journal_entries=0,
        input_tokens=0, output_tokens=0, thought_tokens=0, cached_tokens=0, total_tokens=0,
        model_calls=0, retry_attempts=0, failed_attempts=0, uncertain_attempts=0,
        reserved_uncertain_tokens=0, reserved_uncertain_cost_usd=0.0,
        estimated_cost_usd=0.0, actual_cost_usd=None, simulated_minutes=0, wall_clock_ms=0,
        provider_elapsed_ms=0, cooperation_edges=[]) for arm in arms}
    tasks = {arm: {} for arm in arms}
    attempts, logical_counts = {}, {}
    bounds, uses = {arm: [] for arm in arms}, {arm: [] for arm in arms}
    virtual_end = 480
    actual_known, completed_usage = {arm: 0 for arm in arms}, {arm: 0 for arm in arms}
    for event in events:
        arm, kind = event.get("department_id"), event["event_type"]
        payload = event.get("payload_json", {})
        if isinstance(payload, str):
            payload = json.loads(payload)
        if kind == "phase_started":
            virtual_end = max(virtual_end, (event.get("virtual_day", 1) - 1) * 1440 + payload.get("virtual_minute", 480))
        if arm not in departments:
            continue
        metric = departments[arm]
        if event.get("ts_utc"):
            try:
                bounds[arm].append(datetime.fromisoformat(event["ts_utc"].replace("Z", "+00:00")))
            except (ValueError, TypeError):
                pass
        if kind == "provider_attempt_started":
            metric["model_calls"] += 1
            logical = (arm, payload.get("logical_id", payload.get("attempt_id", str(event.get("event_id")))))
            logical_counts[logical] = logical_counts.get(logical, 0) + 1
            metric["retry_attempts"] += int(logical_counts[logical] > 1)
            attempts[payload.get("attempt_id")] = dict(arm=arm, payload=payload, resolved=False)
        if kind in {"provider_attempt_completed", "provider_attempt_failed"}:
            started = attempts.get(payload.get("attempt_id"))
            if started:
                started["resolved"] = True
            metric["failed_attempts"] += int(kind == "provider_attempt_failed")
            usage = payload.get("usage", payload)
            def value(name):
                envelope = event.get(name)
                return envelope if envelope is not None else usage.get(name, 0)
            for name in ("input_tokens", "output_tokens", "estimated_cost_usd"):
                metric[name] += value(name) or 0
            for name in ("thought_tokens", "cached_tokens"):
                metric[name] += usage.get(name, 0) or 0
            metric["total_tokens"] += usage.get("total_tokens") or ((value("input_tokens") or 0) + (value("output_tokens") or 0) + (usage.get("thought_tokens", 0) or 0))
            metric["provider_elapsed_ms"] += value("elapsed_ms") or 0
            if kind == "provider_attempt_completed" or any(usage.get(k) for k in ("input_tokens", "output_tokens", "estimated_cost_usd")):
                completed_usage[arm] += 1
                actual = usage.get("actual_cost_usd")
                if actual is not None:
                    actual_known[arm] += 1
                    metric["actual_cost_usd"] = (metric["actual_cost_usd"] or 0) + actual
            if payload.get("uncertain") or usage.get("uncertain"):
                metric["uncertain_attempts"] += 1
                reservation = started["payload"] if started else payload
                metric["reserved_uncertain_tokens"] += reservation.get("reserved_tokens", 0)
                metric["reserved_uncertain_cost_usd"] += reservation.get("reserved_cost_usd", 0)
        if kind == "work_started":
            metric["work_turns"] += 1
        if kind == "message_sent":
            metric["messages"] += 1
            metric["small_talk_messages"] += int(event.get("channel") == "small_talk")
            metric["journal_entries"] += int(event.get("channel") == "notes")
        if kind == "action_rejected":
            metric["invalid_actions"] += 1
            evidence = payload.get("evidence", {})
            metric["blocked_actions"] += int(bool(evidence.get("blocked")))
            metric["duplicate_claims_prevented"] += int(bool(evidence.get("duplicate_avoided")))
        if kind == "action_accepted":
            if payload.get("task"):
                tasks[arm][payload["task"]["id"]] = payload["task"]
            uses[arm].extend(payload.get("cooperation_uses", []))
    for attempt in attempts.values():
        if not attempt["resolved"]:
            metric = departments[attempt["arm"]]
            metric["uncertain_attempts"] += 1
            metric["reserved_uncertain_tokens"] += attempt["payload"].get("reserved_tokens", 0)
            metric["reserved_uncertain_cost_usd"] += attempt["payload"].get("reserved_cost_usd", 0)
    for arm, metric in departments.items():
        metric["completed"] = sum(t["status"] == "integrated" for t in tasks[arm].values())
        if cfg.get("environment") == "supplier_selection_v1":
            from engine.procurement import case_baselines, CASE_TITLES
            recorded = next((e["payload_json"].get("baselines") for e in events if e["event_type"] == "run_created"), None)
            baselines = recorded or case_baselines(cfg["seed"])
            scored = [t for t in tasks[arm].values() if t.get("scored")]
            reviews = [t["review"] for t in scored if t.get("review")]
            points = sum(r["earned_points"] for r in reviews)
            metric.update(**baselines, total=len(CASE_TITLES) - 1, completed=len(reviews),
                decided_cases=len(reviews), optimal_decisions=sum(r["optimal"] for r in reviews),
                earned_points=points, decision_yield=points / baselines["attainable_points"],
                external_scores_at_award=sum(r["disclosed_external_cells"] for r in reviews),
                disclosed_score_cells=sum(len(v) for t in scored for v in t.get("disclosed", {}).values()),
                decision_regret_points=baselines["attainable_points"] - points)
        metric["completion"] = metric["completed"] / metric["total"]
        metric["simulated_minutes"] = max(0, virtual_end - 480)
        if len(bounds[arm]) >= 2:
            metric["wall_clock_ms"] = round((max(bounds[arm]) - min(bounds[arm])).total_seconds() * 1000)
        if actual_known[arm] != completed_usage[arm] or completed_usage[arm] == 0 or metric["uncertain_attempts"]:
            metric["actual_cost_usd"] = None
        edges, counted = {}, set()
        for use in uses[arm]:
            kind = use.get("kind")
            key = (kind, use.get("task_id"), use.get("sender_id"), use.get("recipient_id"),
                   use.get("artifact_version") if kind == "handoff" else use.get("rule"))
            if key in counted or kind not in {"help", "repair", "handoff"}:
                continue
            counted.add(key)
            if kind == "handoff":
                metric["handoffs"] += 1
            else:
                metric["help_given"] += 1
                metric["help_received"] += 1
                metric["repairs"] += int(kind == "repair")
            pair = (use["sender_id"], use["recipient_id"])
            edges[pair] = edges.get(pair, 0) + 1
        metric["cooperation_edges"] = [dict(source=a, target=b, count=n) for (a, b), n in edges.items()]
        metric["duplicates_avoided"] = metric["duplicate_claims_prevented"]
        metric["tokens"] = metric["total_tokens"]
        metric["estimated_cost_usd"] = round(metric["estimated_cost_usd"], 8)
    return dict(departments=departments, sample_count=1,
                proxies_label="Observable behavioral proxies; not feelings or friendship.",
                proxy_definitions=dict(help="A sender-known formal rule was new to the recipient and subsequently passed its scenario in the recipient's artifact.",
                    handoff="A matching artifact-version handoff was subsequently consumed by a verifier review.",
                    repair="Previously unknown corrective rule from a failed scenario was transferred and correctly used.",
                    duplicate_claims_prevented="Duplicate claims rejected by the engine; not a cooperation measure."),
                warning="A handful of demonstrations supports no scientific conclusion. Mock runs are synthetic.")
