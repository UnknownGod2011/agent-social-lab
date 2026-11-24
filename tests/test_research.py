import json
import sqlite3
from collections import Counter

import httpx
import pytest
from fastapi.testclient import TestClient

from api.main import app
from engine.domain import ROLES, RunConfig
from engine.procurement import SUPPLIERS, _scorecards, case_baselines
from engine.reducer import reduce_event
from engine.scheduler import build_steps
from engine.study import paired_analysis
from engine.world import context_for_agent, initial_state, process_action
from providers.base import prompt_for
from providers.deepseek import DeepSeekProvider
from storage.store import Store


def config(**more):
    return RunConfig(environment="supplier_selection_v1", arms=["A", "B", "C"], **more)


def test_cards_require_integration_and_block_order_is_balanced():
    for seed in range(16):
        for rows in _scorecards(seed):
            totals = tuple(map(sum, zip(*rows)))
            best = totals.index(max(totals))
            assert totals.count(max(totals)) == 1
            assert all(row.index(max(row)) != best for row in rows)
        assert case_baselines(seed)["solo_favorite_yield"] < 1
    cfg = config(days=3, work_rounds=2)
    steps = build_steps(cfg)
    work = [s for s in steps if s["kind"] == "turn" and s["phase"] != "break"]
    assert len(set(Counter(s["arm"] for s in work if s["first"]).values())) == 1
    assert Counter(s["arm"] for s in steps if s["kind"] == "turn" and s["phase"] == "break") == {"B":12,"C":12}


def test_procurement_roles_score_from_private_data_and_seal_award():
    state = initial_state(config(seed=23))
    state["phase"] = "work_block_1"
    assert len({d["initial_hash"] for d in state["departments"].values()}) == 1
    view = context_for_agent(state, "C", "C-verifier", state["phase"])
    assert view["case"]["id"] == "practice" and view["case"]["published_scores"] == {}
    state["phase"] = "work_block_2"
    def act(role, action):
        nonlocal state
        events = process_action(state,"C","C-"+role,action)
        for event in events:
            state = reduce_event(state,event)
        return events
    action = dict(type="award_contract",task_id="case-1",supplier="Cedar")
    assert act("builder", action)[0]["event_type"] == "action_rejected"
    share = dict(type="share_evidence",task_id="case-1",suppliers=["Alder","Cedar"])
    assert act("verifier", {**share,"fake_scores":[42]})[0]["event_type"] == "action_rejected"
    assert act("verifier", share)[1]["payload_json"]["facts"]["Cedar"] == _scorecards(23)[1][2][2]
    assert act("verifier", share)[0]["event_type"] == "action_rejected"
    public = context_for_agent(state,"C","C-integrator",state["phase"])["case"]["published_scores"]
    assert set(public)=={"verifier"} and set(public["verifier"])=={"Alder","Cedar"}
    assert context_for_agent(state,"B","B-integrator",state["phase"])["case"]["published_scores"] == {}
    review = act("integrator", action)[0]["payload_json"]["task"]["review"]
    scores = tuple(map(sum, zip(*_scorecards(23)[1])))
    assert review["earned_points"]==scores[SUPPLIERS.index("Cedar")] and review["max_points"]==max(scores)
    assert act("integrator", action)[0]["event_type"] == "action_rejected"
    wire=prompt_for(context_for_agent(state,"C","C-builder",state["phase"]))[1]
    assert "earned_points" not in wire and "case-1" not in wire and "department_id" not in wire


@pytest.mark.parametrize("mode", ["attributed","anonymous","withheld"])
def test_work_memory_ablation_does_not_change_treatment_delivery(mode):
    state=initial_state(config(break_memory_mode=mode))
    state["phase"]="break"
    for role in ROLES:
        for e in process_action(state,"C","C-"+role,dict(type="chat_smalltalk",utterance_id="one")):
            state=reduce_event(state,e)
    state["phase"]="work_block_2"
    c=context_for_agent(state,"C","C-builder",state["phase"])
    a=context_for_agent(state,"A","A-builder",state["phase"])
    assert len(c["break_memory"])==(0 if mode=="withheld" else 4)
    if mode=="withheld":
        assert prompt_for(a)==prompt_for(c)
    elif mode=="anonymous":
        assert {m["speaker"] for m in c["break_memory"]}=={"participant"}
    else:
        assert set(ROLES)=={m["speaker"] for m in c["break_memory"]}


def test_paired_analysis_uses_blocks_and_reports_missingness():
    blocks=[dict(status="completed",yields={"A":.1,"B":.25,"C":.75})]*10
    blocks += [dict(status="budget_exhausted",yields=None)]*2
    analysis=paired_analysis(blocks,"deepseek","fixed")
    assert analysis["mean_difference"]==.5 and analysis["ci95"]==[.5,.5]
    assert analysis["attrition_bounds"]==pytest.approx([3/12,7/12])
    assert paired_analysis(blocks,"mock","fixed")["ci95"] is None


def test_immutable_ledger_detects_payload_change_even_when_state_identical(tmp_path):
    store=Store(tmp_path/"audit.sqlite")
    try:
        rid=store.create(config())["id"]
        store.append(rid,[dict(event_type="observation",payload_json={"count":1})])
        assert store.audit(rid)["valid"]
        with pytest.raises(sqlite3.IntegrityError):
            store.db.execute("UPDATE events SET seq=seq")
        # Fault injection into this disposable database models an edited archive.
        store.db.execute("DROP TRIGGER immutable_events_update")
        store.db.execute("UPDATE events SET envelope_json=json_set(envelope_json,'$.payload_json.count',2) WHERE seq=2")
        assert "Event chain mismatch" in store.audit(rid)["errors"][0]
    finally:
        store.close()


def test_prospective_registration_idempotent_and_complete_replay(tmp_path,monkeypatch):
    import time
    monkeypatch.setenv("LAB_DB",str(tmp_path/"registry.sqlite"))
    payload=dict(title="Held-out blocks",seeds=[601,602],config=config(days=1,work_rounds=2,tick_ms=0).model_dump())
    with TestClient(app) as client:
        first=client.post("/api/studies",json=payload)
        assert first.status_code==201,first.text
        study=first.json()
        assert client.post("/api/studies",json=payload).json()["blocks"]==study["blocks"]
        assert client.post("/api/studies",json={**payload,"seeds":[601,601]}).status_code==422
        assert client.post("/api/studies",json={**payload,"config":{**payload["config"],"provider":"deepseek"}}).status_code==422
        rid=study["blocks"][0]["run_id"]
        assert client.post(f"/api/runs/{rid}/control",json={"command":"start"}).is_success
        for _ in range(250):
            if client.get(f"/api/runs/{rid}").json()["status"]=="completed":
                break
            time.sleep(.05)
        final=client.get("/api/studies/"+study["id"]+"/export").json()
        assert final["analysis"]["completed"]==1 and final["analysis"]["missing"]==1
        assert len(set(final["blocks"][0]["yields"].values())) == 1
        assert final["blocks"][0]["departments"]["A"]["optimal_decisions"] == 1
        assert client.get(f"/api/runs/{rid}/audit").json()["valid"]
        assert final["blocks"][1]["status"]=="ready"
        from scripts import study_packet
        monkeypatch.setattr(study_packet, "fetch", lambda base, endpoint: client.get("/api/"+endpoint).json())
        packet = tmp_path / "verified.zip"
        study_packet.export("", study["id"], packet)
        assert len(study_packet.verify(packet)) == 36
        from zipfile import ZipFile
        with ZipFile(packet) as original:
            for defect, message in [("status", "recorded status"), ("arms", "experimental arm"),
                                    ("interval", "Paired analysis")]:
                report = json.loads(original.read("study.json"))
                if defect == "status":
                    report["blocks"][1]["status"] = "completed"
                elif defect == "arms":
                    del report["blocks"][0]["departments"]["C"]
                else:
                    report["analysis"]["ci95"] = [.4, .6]
                edited = tmp_path / f"{defect}.zip"
                with ZipFile(edited, "w") as archive:
                    for key in original.namelist():
                        archive.writestr(key, json.dumps(report) if key == "study.json" else original.read(key))
                with pytest.raises(ValueError, match=message):
                    study_packet.verify(edited)
        long_title = client.post("/api/studies", json={**payload, "title": "T"*90, "seeds": [2147483647]}).json()
        cfg = client.get("/api/runs/"+long_title["blocks"][0]["run_id"]).json()["config"]
        assert len(RunConfig.model_validate(cfg).name) == 100
        monkeypatch.setattr("engine.scheduler.implementation",lambda:{"hash":"other"})
        other=final["blocks"][1]["run_id"]
        assert client.post(f"/api/runs/{other}/control",json={"command":"start"}).status_code==409
    with TestClient(app) as client:
        assert client.get("/api/studies/"+study["id"]).json()["blocks"][0]["ledger_head"]==final["blocks"][0]["ledger_head"]


def test_deepseek_wire_and_cache_cost():
    import asyncio
    def reply(req):
        assert req.url.host=="api.deepseek.com" and req.headers["authorization"]=="Bearer fixture"
        payload=json.loads(req.content)
        assert payload["thinking"]=={"type":"disabled"} and "json" in payload["messages"][0]["content"].lower()
        return httpx.Response(200,json={"model":"deepseek-flash","system_fingerprint":"test-fp","usage":{
            "prompt_tokens":100,"prompt_cache_hit_tokens":40,"completion_tokens":10},
            "choices":[{"finish_reason":"stop","message":{"content":'{"type":"wait","reason":"rest"}'}}]})
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as wire:
            provider=DeepSeekProvider(api_key="fixture",client=wire)
            result=await provider.generate({"paid_confirmed":True})
            assert result["estimated_cost_usd"]==pytest.approx((60*.3+40*.006+10*1.2)/1e6)
            assert result["system_fingerprint"]=="test-fp" and result["actual_cost_usd"] is None
    asyncio.run(exercise())
