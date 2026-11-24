"""Rebuild the Topical-Chat break profile from its original, pinned training split."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from urllib.request import urlopen


REVISION = "7c939229cbcf6f55f6977b341a5a2f2fe982d53f"
BASE = f"https://raw.githubusercontent.com/alexa/Topical-Chat/{REVISION}"
SOURCE_HASH = "39a079d8464ea5f44f0fd78dbc85fd4eed96303347cbf4f9301f823e3c0f437f"
ACTS = ("question", "acknowledgment", "statement")
ACK = re.compile(r"^\s*(?:oh|wow|yeah|yes|yep|right|okay|ok|sure|exactly|absolutely|interesting|cool|nice)\b", re.I)
DEST = Path(__file__).resolve().parents[1] / "engine" / "topical_chat_v1.json"


def surface_act(text):
    if "?" in text:
        return "question"
    return "acknowledgment" if ACK.search(text) else "statement"


def fit(data):
    opening = Counter()
    transitions = {act: Counter() for act in ACTS}
    dialogs = 0
    for record in data.values():
        turns = record["content"][:4]
        if len(turns) != 4 or any(not t["message"].strip() for t in turns):
            continue
        if any(a["agent"] == b["agent"] for a, b in zip(turns, turns[1:])):
            continue
        acts = [surface_act(t["message"]) for t in turns]
        opening[acts[0]] += 1
        for before, after in zip(acts, acts[1:]):
            transitions[before][after] += 1
        dialogs += 1
    return {
        "protocol": "topical_chat_v1", "source": f"{BASE}/conversations/train.json",
        "source_sha256": SOURCE_HASH, "license": "CDLA-Sharing-1.0", "license_url": f"{BASE}/DATALICENSE",
        "corpus": "Topical-Chat", "split": "train", "available_dialogues": len(data),
        "eligible_dialogues": dialogs, "turns_measured": dialogs * 4,
        "opening_counts": dict(opening), "transition_counts": transitions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Existing pinned train.json; otherwise download it.")
    parser.add_argument("--check", action="store_true", help="Compare the regenerated profile to the repository.")
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urlopen(f"{BASE}/conversations/train.json", timeout=120) as response:
            raw = response.read()
    if hashlib.sha256(raw).hexdigest() != SOURCE_HASH:
        raise SystemExit("Training file differs from the pinned SHA-256.")
    profile = fit(json.loads(raw))
    if args.check:
        if profile != json.loads(DEST.read_text(encoding="utf-8")):
            raise SystemExit("Checked-in profile differs from the pinned corpus calculation.")
    else:
        DEST.write_text(json.dumps(profile, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{profile['eligible_dialogues']} eligible dialogues; {profile['turns_measured']} measured turns.")


if __name__ == "__main__":
    main()
