"""Local-only research API, recorded-data exports and reconnectable event stream."""
import asyncio
import csv
import io
import json
import os
import statistics
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from engine.domain import RunConfig
from engine.metrics import compute_metrics
from engine.scheduler import Scheduler, budget_usage, preview, freeze_pricing
from engine.world import digest
from providers.gemini import GeminiPool
from providers.deepseek import DeepSeekProvider, DEFAULT_MODEL, MODEL_PRICES
from storage.store import Store
from api.studies import router as study_router
from engine.study import implementation


@asynccontextmanager
async def lifespan(app):
    implementation()
    app.state.store = Store(os.environ.get("LAB_DB", "data/lab.sqlite3"), exclusive=True)
    app.state.pool = GeminiPool()
    app.state.scheduler = Scheduler(app.state.store, app.state.pool)
    await app.state.scheduler.recover()
    if not app.state.store.list():
        app.state.store.create(RunConfig(name="Purchasing lab · offline", environment="supplier_selection_v1",
                                         arms=["A","B","C"], model="mock-v1"))
    yield
    await app.state.scheduler.shutdown()
    await app.state.pool.close()
    app.state.store.close()


app = FastAPI(title="Beyond Task Talk Lab", version="2.0.0", lifespan=lifespan)
app.include_router(study_router)


@app.middleware("http")
async def local_controls(request: Request, call_next):
    # Bind to loopback; reject browser cross-origin writes to this local admin app.
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        allowed = {"http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:5173", "http://localhost:5173"}
        if origin and origin not in allowed:
            return Response("Cross-origin writes are disabled", status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def store():
    return app.state.store


def get_run(run_id):
    try:
        return store().get(run_id)
    except KeyError:
        raise HTTPException(404, "Run not found") from None


def detail(run_id):
    run = get_run(run_id)
    events = store().events(run_id)
    run["metrics"] = compute_metrics(events, run["config"])
    run["budget"] = budget_usage(events)
    run["metrics"]["budget"] = run["budget"]
    run["metrics"]["mode"] = "mock" if run["config"]["provider"] == "mock" else "live"
    return {k: v for k, v in run.items() if k not in {"lease_owner", "lease_until", "control"}}


@app.get("/api/health")
def health():
    keys = app.state.pool.health()
    return {"status": "ok", "version": "2.0.0", "providers": {
        "mock": True, "gemini": {"configured_keys": len(keys), "model": os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
            "credentials": keys, "quota_scope": "Project-wide; unknown credentials conservatively share a cooldown"},
        "deepseek": {"configured": bool(os.environ.get("DEEPSEEK_API_KEY")), "model": DEFAULT_MODEL,
                    "models": list(MODEL_PRICES), "pricing_basis": "Frozen peak USD per million tokens"},
        "openai": {"configured": bool(os.environ.get("OPENAI_API_KEY")), "live_verified": False}},
        "environments": ["task_board_v1", "supplier_selection_v1"],
        "calendar": "Local server must remain running. One overdue day resumes after restart."}


@app.post("/api/providers/check")
async def check_providers(body: dict | None = None):
    selected = (body or {}).get("provider", "gemini")
    if selected == "deepseek":
        provider = DeepSeekProvider((body or {}).get("model", DEFAULT_MODEL))
        try:
            return await provider.preflight()
        finally:
            await provider.close()
    if selected != "gemini":
        raise HTTPException(400, "Model catalog checks are available for Gemini and DeepSeek.")
    model = (body or {}).get("model", os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"))
    return await app.state.pool.preflight(model)


@app.get("/api/runs")
def runs():
    return [{k: r[k] for k in ("id", "config", "status", "created_at", "config_hash", "initial_state_hash", "seq")} for r in store().list()]


@app.post("/api/preview")
def preview_config(config: RunConfig):
    return preview(config)


@app.post("/api/runs", status_code=201)
def create_run(config: RunConfig):
    if config.provider in {"deepseek", "openai"} and not config.paid_confirmed:
        raise HTTPException(400, "Explicit admin confirmation is required for paid model calls.")
    try:
        config = freeze_pricing(config)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return detail(store().create(config)["id"])


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str):
    return detail(run_id)


class Control(BaseModel):
    command: str


@app.post("/api/runs/{run_id}/control")
async def control(run_id: str, body: Control):
    run = get_run(run_id)
    if body.command in {"start", "resume", "advance_day"} and run["config"]["provider"] == "deepseek" and not os.environ.get("DEEPSEEK_API_KEY"):
        raise HTTPException(400, "No DeepSeek credential is configured in the server environment.")
    if body.command in {"start", "resume", "advance_day"} and run["config"]["provider"] == "gemini":
        if not app.state.pool.health():
            raise HTTPException(400, "No Gemini keys are configured server-side. Clone into mock mode or configure .env.")
    try:
        await app.state.scheduler.control(run_id, body.command)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return detail(run_id)


@app.post("/api/runs/{run_id}/clone", status_code=201)
def clone(run_id: str):
    run = get_run(run_id)
    config = RunConfig(**{"dialogue_protocol": "catalog_v1", **run["config"]})
    return detail(store().create(config)["id"])


@app.get("/api/runs/{run_id}/events")
def events(run_id: str, department_id: str | None = None, day: int | None = None,
           agent_id: str | None = None, channel: str | None = None, task_id: str | None = None,
           event_type: str | None = None, severity: str | None = None, q: str | None = None,
           after: int = 0, limit: int = Query(1000, ge=1, le=100000)):
    get_run(run_id)
    return store().events(run_id, after=after, limit=limit, department_id=department_id, virtual_day=day,
                          agent_id=agent_id, channel=channel, task_id=task_id, event_type=event_type, severity=severity, q=q)


@app.get("/api/runs/{run_id}/messages")
def messages(run_id: str):
    get_run(run_id)
    return store().events(run_id, event_type="message_sent")


@app.get("/api/runs/{run_id}/metrics")
def metrics(run_id: str):
    return detail(run_id)["metrics"]


@app.get("/api/runs/{run_id}/replay")
def replay(run_id: str, seq: int | None = None):
    get_run(run_id)
    result = store().replay(run_id, seq)
    result["metrics"] = compute_metrics([e for e in store().events(run_id) if e["seq"] <= result["seq"]], get_run(run_id)["config"])
    return result


@app.get("/api/runs/{run_id}/stream")
async def stream(run_id: str, request: Request, after: int = 0):
    get_run(run_id)
    try:
        cursor = max(after, int(request.headers.get("last-event-id", 0)))
    except ValueError:
        cursor = after

    async def generate():
        nonlocal cursor
        idle = 0
        while not await request.is_disconnected():
            pending = store().events(run_id, after=cursor, limit=250)
            for event in pending:
                cursor = event["seq"]
                yield f"id: {cursor}\ndata: {json.dumps(event)}\n\n"
            idle += 1
            if idle % 20 == 0:
                yield ": heartbeat\n\n"
            await asyncio.sleep(0.25)
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def csv_data(rows):
    output = io.StringIO(newline="")
    if rows:
        fields = list(dict.fromkeys(k for row in rows for k in row))
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            # CSV cells containing model text must not execute spreadsheet formulas.
            writer.writerow({k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@")) else v) for k, v in row.items()})
    return output.getvalue()


@app.get("/api/runs/{run_id}/export/{kind}")
def export(run_id: str, kind: str):
    run = detail(run_id)
    events = store().events(run_id)
    if kind == "events.jsonl":
        data, mime = "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events), "application/x-ndjson"
    elif kind == "messages.csv":
        rows = [{**{k: e[k] for k in ("event_id", "seq", "department_id", "virtual_day", "agent_id", "channel", "task_id", "ts_utc")},
                 "text": e["payload_json"].get("text", ""), "visibility": e["payload_json"].get("visibility", "department"), "recipient_id": e["payload_json"].get("recipient_id")} for e in events if e["event_type"] == "message_sent"]
        data, mime = csv_data(rows), "text/csv"
    elif kind == "metrics.csv":
        rows = [{"run_id": run_id, "department_id": arm, "provider": run["config"]["provider"], "sample_count": 1,
                 **{k: json.dumps(v) if isinstance(v, list) else v for k, v in m.items()}} for arm, m in run["metrics"]["departments"].items()]
        data, mime = csv_data(rows), "text/csv"
    elif kind == "config.json":
        data = json.dumps({"schema_version": 1, "run_id": run_id, "config": run["config"], "config_hash": run["config_hash"],
                           "initial_state_hash": run["initial_state_hash"], "pricing_version": run["config"].get("pricing_version"),
                           "environment": run["config"].get("environment","task_board_v1"),
                           "semantics": "Rule-scored work sample. Cost estimates use the stored model price table."}, indent=2)
        mime = "application/json"
    else:
        raise HTTPException(404, "Unknown export format")
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{run_id}-{kind}"'})


@app.get("/api/compare")
def compare(ids: str = ""):
    selected = [detail(i) for i in dict.fromkeys(i for i in ids.split(",") if i)][:20]
    groups = {}
    for run in selected:
        cfg = {k: v for k, v in run["config"].items() if k not in {"seed", "name", "tick_ms"}}
        key = digest(cfg)
        groups.setdefault(key, []).append(run)
    summaries = []
    for key, group in groups.items():
        completed = [r for r in group if r["status"] == "completed"]
        if group[0]["config"]["provider"] == "mock":
            completed = list({r["config"]["seed"]: r for r in completed}.values())
        arms = group[0]["config"]["arms"]
        values = {}
        for arm in arms:
            scores = [r["metrics"]["departments"][arm]["completed"] for r in completed]
            numeric = {}
            for field, example in group[0]["metrics"]["departments"][arm].items():
                if not isinstance(example, (int, float)) or isinstance(example, bool):
                    continue
                samples = [r["metrics"]["departments"][arm][field] for r in completed
                           if isinstance(r["metrics"]["departments"][arm].get(field), (int, float))]
                numeric[field] = {"n": len(samples), "mean": statistics.mean(samples) if samples else None,
                                  "sd": statistics.stdev(samples) if len(samples) > 1 else None}
            values[arm] = {"n": len(scores), "mean_milestones": statistics.mean(scores) if scores else None,
                          "sd_milestones": statistics.stdev(scores) if len(scores) > 1 else None, "metrics": numeric}
        summaries.append({"configuration_group": key, "provider": group[0]["config"]["provider"], "departments": values})
    return {"runs": selected, "summary": summaries,
            "warning": "n counts independent completed team-runs. Repeated deterministic seeds are not independent replications. Mock runs support no scientific conclusions."}


WEB_DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
if (WEB_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/{path:path}")
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "API route not found")
    if (WEB_DIST / "index.html").exists():
        return FileResponse(WEB_DIST / "index.html")
    return Response("Frontend not built. Run npm --prefix web install, then npm --prefix web run build.", status_code=503)
