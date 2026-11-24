"""Surface-form validation on a held-out human split and a same-size generated sample."""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fit_dialogue_profile import BASE, surface_act
from engine.domain import ROLES, RunConfig
from engine.reducer import reduce_event
from engine.world import context_for_agent, initial_state, process_action
from providers.mock import MockProvider

SPLIT_HASH = "d14e8bde94fa5556d4aad8fd3fb666df674e4fef8b4193c8c3c06c72822a366b"


def describe(threads):
    opening, transitions = Counter(), Counter()
    lengths = []
    for thread in threads:
        moves = [surface_act(line) for line in thread]
        opening[moves[0]] += 1
        transitions.update(f"{a}/{b}" for a,b in zip(moves,moves[1:]))
        lengths.extend(len(re.findall(r"[\w’'-]+", line)) for line in thread)
    return dict(threads=len(threads),turns=len(lengths),median_words=statistics.median(lengths),
                openings=dict(opening),transitions=dict(transitions))


def distance(a,b):
    return round(sum(abs(a.get(i,0)/sum(a.values())-b.get(i,0)/sum(b.values())) for i in set(a)|set(b))/2,5)


async def validate(source):
    if hashlib.sha256(source).hexdigest()!=SPLIT_HASH:
        raise ValueError("Supply valid_freq.json from the pinned corpus revision.")
    humans=[]
    for record in json.loads(source).values():
        turns=record["content"][:4]
        if len(turns)==4 and all(t["message"].strip() for t in turns) and all(a["agent"]!=b["agent"] for a,b in zip(turns,turns[1:])):
            humans.append([t["message"] for t in turns])
    synthetic=[]
    for i in range(len(humans)):
        state=initial_state(RunConfig(seed=800000+i))
        state["phase"]="break"
        lines=[]
        for role in ROLES:
            agent_id="C-"+role
            ctx=context_for_agent(state,"C",agent_id,"break")
            response=await MockProvider().generate(ctx)
            for event in process_action(state,"C",agent_id,response["action"]):
                state=reduce_event(state,event)
                if event["event_type"]=="message_sent":
                    lines.append(event["payload_json"]["text"])
        synthetic.append(lines)
    h,s=describe(humans),describe(synthetic)
    return dict(split=BASE+"/conversations/valid_freq.json",sha256=SPLIT_HASH,synthetic_first_seed=800000,
        human=h,generated=s,opening_total_variation=distance(h["openings"],s["openings"]),
        transition_total_variation=distance(h["transitions"],s["transitions"]))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("valid_freq",type=Path)
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    report=json.dumps(asyncio.run(validate(args.valid_freq.read_bytes())),indent=2)+"\n"
    if args.output:
        args.output.write_text(report,encoding="utf-8")
    else:
        print(report)
