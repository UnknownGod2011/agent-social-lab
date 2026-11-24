"""Run registered blocks sequentially or export and independently re-score a paper's evidence packet."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import random
import statistics
import tempfile
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile, ZIP_DEFLATED


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fetch(base, path, data=None):
    req = Request(base.rstrip("/") + "/api/" + path, data=canonical(data) if data else None,
                  headers={"Content-Type":"application/json"})
    with urlopen(req, timeout=90) as response:
        return json.load(response)


def outcomes(events, cases, arms):
    decisions = {}
    for e in events:
        p = e["payload_json"]
        if e["event_type"] == "action_accepted" and p["action"]["type"] == "award_contract":
            key = (e["department_id"], p["action"]["task_id"])
            if key in decisions:
                raise ValueError(f"Duplicate award at event {e['seq']}")
            decisions[key] = p["action"]["supplier"]
    for arm in arms:
        for case_id, case in cases.items():
            if not case["scored"]:
                continue
            supplier = decisions.get((arm, case_id))
            cards = case["cards"]
            totals = {s: sum(card[s] for card in cards.values()) for s in next(iter(cards.values()))}
            best = max(totals.values())
            earned = totals[supplier] if supplier else 0
            yield dict(arm=arm, case_id=case_id, chosen=supplier, earned_points=earned, attainable_points=best,
                       optimal=earned == best)


def verify(path):
    """Uses only the standard library, the immutable action, and four numeric scorecards."""
    with ZipFile(path) as archive:
        study = json.loads(archive.read("study.json"))
        if digest(study["manifest"]) != study["id"]:
            raise ValueError("Protocol digest mismatch")
        if [b["seed"] for b in study["blocks"]] != study["manifest"]["seeds"]:
            raise ValueError("Allocation list differs from the frozen protocol")
        rows = []
        differences = []
        for block in study["blocks"]:
            folder = block["run_id"] + "/"
            config = json.loads(archive.read(folder+"config.json"))
            template = {key: value for key, value in config["config"].items() if key not in {"name", "seed"}}
            if (digest(config["config"]) != block["config_hash"] or config["config"]["seed"] != block["seed"]
                    or template != study["manifest"]["config"]):
                raise ValueError("Configuration or allocation mismatch")
            events = [json.loads(line) for line in archive.read(folder+"events.jsonl").splitlines()]
            head = None
            for i, e in enumerate(events, 1):
                claimed = e.get("chain_hash")
                fields = {k:v for k,v in e.items() if k != "chain_hash"}
                if (e["seq"] != i or e["run_id"] != block["run_id"] or e.get("previous_hash") != head or digest(fields) != claimed):
                    raise ValueError(f"{folder} event integrity mismatch at {i}")
                head = claimed
            if head != block["ledger_head"] or len(events) != block["seq"]:
                raise ValueError("Study export and event ledger have different endpoints")
            status = next((event["payload_json"]["status"] for event in reversed(events)
                           if event["event_type"] == "status_changed"), "ready")
            if status != block["status"]:
                raise ValueError("Block status differs from the recorded status")
            case_file = json.loads(archive.read(folder+"casebook.json"))
            cases = case_file["cases"]
            genesis = events[0]["payload_json"]
            if genesis.get("casebook") is not None and genesis["casebook"] != cases:
                raise ValueError("Casebook differs from the allocation ledger")
            if genesis["initial_state_hash"] != block["initial_state_hash"] or genesis["config_hash"] != block["config_hash"]:
                raise ValueError("Genesis does not match study allocation")
            arms = study["manifest"]["config"]["arms"]
            arm_rows = list(outcomes(events,cases,arms))
            if set(block["departments"]) != set(arms):
                raise ValueError("Reported metrics omit or add an experimental arm")
            actual_yields = {}
            for arm in arms:
                completed = [r for r in arm_rows if r["arm"] == arm]
                estimate = sum(r["earned_points"] for r in completed) / sum(r["attainable_points"] for r in completed)
                metrics = block["departments"][arm]
                if abs(estimate - metrics["decision_yield"]) > 1e-12:
                    raise ValueError(f"Independent scoring differs for {folder}{arm}")
                actual_yields[arm] = estimate
            if block["yields"] != (actual_yields if status == "completed" else None):
                raise ValueError("Block contrast inputs differ from recomputed yields")
            if status == "completed":
                differences.append(actual_yields["C"] - actual_yields["B"])
            rows += [dict(seed=block["seed"],run_id=block["run_id"],status=block["status"],**r) for r in arm_rows]
        report = study["analysis"]
        n, total = len(differences), len(study["blocks"])
        missing = total - n
        usable = [b["yields"] for b in study["blocks"] if b["status"] == "completed"]
        expected = dict(planned=total, completed=n, missing=missing, contrast="C − B",
                        mean_difference=statistics.mean(differences) if n else None,
                        paired_sd=statistics.stdev(differences) if n > 1 else None,
                        attrition_bounds=[(sum(differences) - missing) / total, (sum(differences) + missing) / total],
                        secondary={f"{a} − {b}": statistics.mean(x[a]-x[b] for x in usable) if n else None
                                   for a, b in (("C","A"), ("B","A"))},
                        ci95=None)
        if n >= 10 and study["manifest"]["config"]["provider"] != "mock":
            rng = random.Random(f"paired-percentile-v1:{study['id']}")
            bootstrap = sorted(sum(rng.choices(differences, k=n)) / n for _ in range(5000))
            expected["ci95"] = [bootstrap[124], bootstrap[4874]]
        if any(report[key] != value for key, value in expected.items()):
            raise ValueError("Paired analysis differs from the observed block outcomes")
        if "case_outcomes.csv" in archive.namelist():
            exported = list(csv.DictReader(io.StringIO(archive.read("case_outcomes.csv").decode())))
            expected = [{k:"" if v is None else str(v) for k,v in r.items()} for r in rows]
            if exported != expected:
                raise ValueError("Published case CSV differs from the sealed awards")
        return rows


def export(base, study_id, output):
    study = fetch(base, "studies/"+study_id+"/export")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Choose a new output filename to preserve existing evidence.")
    with tempfile.TemporaryDirectory(dir=output.parent) as folder:
        packet = Path(folder)/"packet.zip"
        with ZipFile(packet,"w",compression=ZIP_DEFLATED) as archive:
            archive.writestr("study.json",canonical(study))
            for block in study["blocks"]:
                rid = block["run_id"]
                for name, endpoint in [("config.json","export/config.json"),("casebook.json","casebook")]:
                    archive.writestr(rid+"/"+name,canonical(fetch(base,f"runs/{rid}/{endpoint}")))
                after = 0
                with archive.open(rid+"/events.jsonl","w") as stream:
                    while after < block["seq"]:
                        events = fetch(base,f"runs/{rid}/events?after={after}&limit={min(250,block['seq']-after)}")
                        if not events:
                            raise ValueError("Missing event page")
                        for event in events:
                            stream.write(canonical(event)+b"\n")
                        after = events[-1]["seq"]
        rows = verify(packet)
        table = io.StringIO(newline="")
        writer = csv.DictWriter(table,fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        with ZipFile(packet,"a",compression=ZIP_DEFLATED) as archive:
            archive.writestr("case_outcomes.csv",table.getvalue())
        # Exclusive publication also protects concurrent exports.
        with output.open("xb") as dest, packet.open("rb") as src:
            import shutil
            shutil.copyfileobj(src, dest)
    print(f"Verified {len(rows)} arm/case rows. Wrote {output}.")


def execute(base, study_id, allow_live):
    study = fetch(base,"studies/"+study_id)
    if study["provider"] != "mock" and not allow_live:
        raise ValueError("Pass --live to execute the live budgets in this registered manifest.")
    for b in study["blocks"]:
        path = "runs/"+b["run_id"]
        status = fetch(base,path)["status"]
        if status == "ready":
            status = fetch(base,path+"/control",{"command":"start"})["status"]
        while status in {"waiting","waiting_provider","running","pausing","stopping"}:
            time.sleep(1)
            status = fetch(base,path)["status"]
        print(f"Seed {b['seed']} · {status}",flush=True)
        if status != "completed":
            raise SystemExit("Execution paused at this block. Its recorded data and allocation are preserved.")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server",default="http://127.0.0.1:8000")
    commands=parser.add_subparsers(dest="mode",required=True)
    bundle=commands.add_parser("export")
    bundle.add_argument("study_id")
    bundle.add_argument("output",type=Path)
    check=commands.add_parser("verify")
    check.add_argument("packet",type=Path)
    run=commands.add_parser("run")
    run.add_argument("study_id")
    run.add_argument("--live",action="store_true")
    args=parser.parse_args()
    if args.mode=="verify":
        print(f"Verified {len(verify(args.packet))} arm/case rows.")
    elif args.mode=="export":
        export(args.server,args.study_id,args.output)
    else:
        execute(args.server,args.study_id,args.live)


if __name__=="__main__":
    main()
