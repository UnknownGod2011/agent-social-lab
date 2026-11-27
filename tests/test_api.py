import json
from fastapi.testclient import TestClient
from api.main import app


def test_api_controls_config_exports_and_comparison(tmp_path, monkeypatch):
    monkeypatch.setenv("LAB_DB", str(tmp_path / "api.sqlite3"))
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/runs").json() == []
        run = client.post("/api/runs", json={"days": 1, "tick_ms": 0}).json()
        run_id = run["id"]
        assert run["state"]["departments"]["A"]["initial_hash"] == run["state"]["departments"]["C"]["initial_hash"]
        assert client.post("/api/runs/" + run_id + "/control", json={"command": "start"}).status_code == 200
        import time
        for _ in range(100):
            if client.get("/api/runs/" + run_id).json()["status"] == "completed":
                break
            time.sleep(.02)
        final = client.get("/api/runs/" + run_id).json()
        assert final["status"] == "completed"
        assert final["config_hash"] == run["config_hash"]
        assert client.patch("/api/runs/" + run_id, json={"seed": 4}).status_code == 405
        for kind in ("events.jsonl", "messages.csv", "metrics.csv", "config.json"):
            response = client.get(f"/api/runs/{run_id}/export/{kind}")
            assert response.status_code == 200
            assert response.content
            assert "attachment" in response.headers["content-disposition"]
            assert b"GEMINI_API_KEYS" not in response.content
        replay = client.get(f"/api/runs/{run_id}/replay?seq={final['seq']}").json()
        assert replay["state"] == final["state"]
        cloned = client.post(f"/api/runs/{run_id}/clone").json()
        assert cloned["status"] == "ready" and cloned["config_hash"] == final["config_hash"]
        assert client.get("/api/compare", params={"ids": run_id + "," + cloned["id"]}).json()["summary"][0]["departments"]["A"]["n"] == 1
        assert client.get("/api/runs/missing").status_code == 404
        assert client.post("/api/runs", json={"provider": "openai"}).status_code == 400
        assert client.post("/api/runs", json={"days": 99}).status_code == 422
        assert client.post("/api/runs", json={}, headers={"Origin": "https://other.example"}).status_code == 403
