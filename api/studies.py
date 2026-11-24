"""Study registration never launches a model. All allocated blocks use the ordinary run controller."""
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from engine.metrics import compute_metrics
from engine.domain import RunConfig
from engine.procurement import casebook
from engine.world import initial_state
from engine.scheduler import freeze_pricing
from engine.study import Registration, implementation, manifest_for, paired_analysis, runtime_versions

router = APIRouter(prefix="/api")


def summary(row):
    m = row["manifest"]
    return dict(id=row["id"], protocol_hash=row["id"], created_at=row["created_at"], title=m["title"],
                provider=m["config"]["provider"], model=m["config"]["model"], block_count=len(m["seeds"]))


def report(store, study_id):
    rows = store.studies(study_id)
    if not rows:
        raise HTTPException(404, "Study not found")
    row = rows[0]
    blocks = store.blocks(study_id)
    m = row["manifest"]
    for b in blocks:
        events = store.events(b["run_id"], limit=b["seq"])
        metrics = compute_metrics(events, {**m["config"], "seed": b["seed"]})["departments"]
        b["ledger_head"] = events[-1].get("chain_hash") if events else None
        b["yields"] = {arm: v["decision_yield"] for arm, v in metrics.items()} if b["status"] == "completed" else None
        b["departments"] = metrics
        b["observed_models"] = sorted({(e["provider_model"], e["payload_json"].get("system_fingerprint") or "")
                                      for e in events if e["event_type"] == "provider_attempt_completed"})
    analysis = paired_analysis(blocks, m["config"]["provider"], study_id)
    return {**summary(row), "manifest": m, "blocks": blocks, "analysis": analysis,
            "implementation_matches": implementation()["hash"] == m["implementation_hash"]
            and m.get("runtime", runtime_versions()) == runtime_versions()}


@router.get("/studies")
def studies(request: Request):
    return [summary(row) for row in request.app.state.store.studies()]


@router.post("/studies", status_code=201)
def register(request: Request, body: Registration):
    try:
        config = freeze_pricing(body.config)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    manifest = manifest_for(body, config)
    configs = [config.model_copy(update={"seed": seed, "name": f"{body.title[:87]} · {seed}"}) for seed in body.seeds]
    db = request.app.state.store
    return report(db, db.register_study(manifest, configs))


@router.get("/studies/{study_id}")
def study(request: Request, study_id: str):
    return report(request.app.state.store, study_id)


@router.get("/studies/{study_id}/export")
def download(request: Request, study_id: str):
    result = report(request.app.state.store, study_id)
    return Response(json.dumps(result, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="study-{study_id[:12]}.json"'})


@router.get("/runs/{run_id}/audit")
def audit(request: Request, run_id: str):
    try:
        return request.app.state.store.audit(run_id)
    except KeyError:
        raise HTTPException(404, "Run not found") from None


@router.get("/runs/{run_id}/casebook")
def scorebook(request: Request, run_id: str):
    db = request.app.state.store
    try:
        run = db.get(run_id)
    except KeyError:
        raise HTTPException(404, "Run not found") from None
    if run["config"].get("environment") != "supplier_selection_v1":
        raise HTTPException(409, "This run uses the task-board environment.")
    payload = db.events(run_id, limit=1)[0]["payload_json"]
    if "casebook" in payload:
        return {"origin":"recorded at allocation", "cases":payload["casebook"]}
    cfg = RunConfig(**run["config"])
    if initial_state(cfg)["departments"]["A"]["initial_hash"] != run["initial_state_hash"]:
        raise HTTPException(409, "Original case generator required to recover the sealed scorecards.")
    return {"origin":"reconstructed from seed and verified against the allocation hash", "cases":casebook(cfg.seed)}
