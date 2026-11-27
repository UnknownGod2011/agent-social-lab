"""Group existing public checkpoints for buffered playback without re-running the engine."""
import json
import sys
from pathlib import Path

PAGE_SIZE = 16


def pack(api: Path):
    for summary in json.loads((api / "runs.json").read_text(encoding="utf-8")):
        folder = api / "runs" / summary["id"]
        count = json.loads(folder.with_suffix(".json").read_bytes())["seq"] + 1
        pages = folder / "replay-pages"
        pages.mkdir(exist_ok=True)
        for start in range(0, count, PAGE_SIZE):
            frames = [(folder / "replay" / f"{seq}.json").read_bytes()
                      for seq in range(start, min(start + PAGE_SIZE, count))]
            (pages / f"{start // PAGE_SIZE}.json").write_bytes(b"[" + b",".join(frames) + b"]")


if __name__ == "__main__":
    pack(Path(sys.argv[1]))
