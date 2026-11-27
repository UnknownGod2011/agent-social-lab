"""Build the public, read-only API fixture from one isolated offline experiment."""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.pack_public_replay import pack
from engine.metrics import compute_metrics
from engine.reducer import reduce_event
from engine.world import digest


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def fetch(client, path):
    response = client.get("/api/" + path)
    response.raise_for_status()
    return response


def capture(client, api, endpoint, filename=None):
    path = api / (filename or (endpoint + ".json"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(fetch(client, endpoint).content)


def record(client):
    config = {
        "model": "mock-v1", "provider": "mock", "environment": "supplier_selection_v1",
        "dialogue_protocol": "topical_chat_v1", "arms": ["A", "B", "C"],
        "days": 1, "work_rounds": 2, "tick_ms": 0, "max_cost_usd": 0,
    }
    registration = client.post("/api/studies", json={
        "title": "Purchasing lab · recorded demonstration", "seeds": [42], "config": config,
    })
    registration.raise_for_status()
    study = registration.json()
    run_id = study["blocks"][0]["run_id"]
    client.post(f"/api/runs/{run_id}/control", json={"command": "start"}).raise_for_status()
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        run = fetch(client, "runs/" + run_id).json()
        if run["status"] == "completed":
            return study["id"], run
        if run["status"] not in {"ready", "running"}:
            raise RuntimeError(f"Fixture experiment ended unexpectedly: {run['status']}")
        time.sleep(0.2)
    raise TimeoutError("Offline experiment did not finish within three minutes")


def export_demo(client, api, study_id, run):
    run_path = "runs/" + run["id"]
    study_path = "studies/" + study_id
    listed = [r for r in fetch(client, "runs").json() if r["id"] == run["id"]]
    if len(listed) != 1:
        raise ValueError("Registered demonstration missing from run list")
    write_json(api / "runs.json", listed)
    write_json(api / (run_path + ".json"), run)
    for endpoint in ("health", "studies", study_path, study_path + "/export",
                     run_path + "/casebook", run_path + "/metrics", run_path + "/messages", run_path + "/audit"):
        capture(client, api, endpoint)
    capture(client, api, "compare?ids=" + run["id"], "compare/" + run["id"] + ".json")
    for filename in ("events.jsonl", "messages.csv", "metrics.csv", "config.json"):
        path = f"{run_path}/export/{filename}"
        capture(client, api, path, path)

    events = fetch(client, run_path + "/events?limit=100000").json()
    if run["seq"] != len(events):
        raise ValueError("Incomplete event export")
    write_json(api / run_path / "events.json", events)
    replay = fetch(client, run_path + "/replay?seq=0").json()
    write_json(api / run_path / "replay/0.json", replay)
    for seq, event in enumerate(events, start=1):
        state = reduce_event(replay["state"], event)
        if event["seq"] != seq or digest(state) != event["state_hash"]:
            raise ValueError(f"Event {seq} failed replay verification")
        replay = {
            "state": state, "seq": seq, "state_hash": event["state_hash"], "read_only": True,
            "metrics": compute_metrics(events[:seq], run["config"]),
        }
        write_json(api / run_path / "replay" / f"{seq}.json", replay)
    if replay != fetch(client, run_path + "/replay").json() or replay["state"] != run["state"]:
        raise ValueError("Static replay differs from the final API state")
    return len(events)


def build(output):
    # Set before importing api.main, which normally reads the local researcher's .env.
    # Blank explicit overrides also isolate hosts that inject keys directly.
    with tempfile.TemporaryDirectory(prefix="agent-lab-public-") as tmp, patch.dict(os.environ, {
        "LAB_DB": str(Path(tmp) / "fixture.sqlite3"), "PYTHON_DOTENV_DISABLED": "1",
        "GEMINI_API_KEYS": "", "GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "DEEPSEEK_API_KEY": "",
        "GEMINI_MODEL": "gemini-3.5-flash-lite",
    }):
        from api.main import app
        with TestClient(app) as client:
            study_id, run = record(client)
            output.mkdir(parents=True, exist_ok=True)
            # Publishing metadata last keeps the prior run selected until the new files exist.
            with tempfile.TemporaryDirectory(dir=output, prefix=".building-") as stage:
                staged = Path(stage)
                count = export_demo(client, staged, study_id, run)
                pack(staged)
                files = sorted((p for p in staged.rglob("*") if p.is_file()),
                               key=lambda p: (p.parent == staged, p.name == "runs.json"))
                size = sum(p.stat().st_size for p in files)
                for path in files:
                    target = output / "api" / path.relative_to(staged)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    path.replace(target)
    print(f"Mock run {run['id']}: {count} events, {len(files)} files, {size:,} bytes at {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "web" / "dist" / "demo",
                        help="Demo directory; the generated API documents go beneath api/")
    build(parser.parse_args().output.resolve())
