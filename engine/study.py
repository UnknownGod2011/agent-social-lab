"""Prospective block allocation and paired analysis at the team-run level."""
import hashlib
import random
import statistics
import platform
import sqlite3
from importlib.metadata import version
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from engine.dialogue import PROFILE_HASH
from engine.domain import RunConfig
from engine.procurement import ENVIRONMENT
from engine.world import digest


class Registration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=90)
    config: RunConfig
    seeds: list[Annotated[int, Field(strict=True, ge=0, le=2147483647)]] = Field(min_length=1, max_length=256)

    @field_validator("seeds")
    @classmethod
    def unique(cls, seeds):
        if len(set(seeds)) != len(seeds):
            raise ValueError("Each block needs a distinct case seed.")
        return seeds

    @model_validator(mode="after")
    def matched_design(self):
        c = self.config
        if (c.environment, c.dialogue_protocol, c.arms, c.scheduler_mode, c.talk_frequency) != (
                ENVIRONMENT, "topical_chat_v1", ["A", "B", "C"], "virtual", 1):
            raise ValueError("Studies require supplier selection, the corpus protocol, A/B/C and a break every virtual day.")
        if c.provider != "mock" and not c.paid_confirmed:
            raise ValueError("Confirm the per-block live model budget before registering a study.")
        return self


@lru_cache(maxsize=1)
def implementation():
    """Hash experiment code and inputs at server startup, independent of checkout location or CRLF."""
    root = Path(__file__).resolve().parents[1]
    files = [p for folder in ("engine", "providers", "storage", "api") for p in (root / folder).iterdir()
             if p.suffix in {".py", ".json"}] + [root / "requirements.lock.txt"]
    hashes = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
              for p in sorted(files)}
    return dict(hash=digest(hashes), files=hashes)


@lru_cache(maxsize=1)
def runtime_versions():
    return {"python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
            **{package: version(package) for package in ("httpx", "fastapi", "pydantic", "tzdata")}}


def manifest_for(registration, config):
    # Seed in the template has no experimental meaning. All block seeds are frozen below.
    cfg = config.model_dump(exclude={"seed", "name"})
    return dict(version=1, title=registration.title, config=cfg, seeds=registration.seeds,
                implementation_hash=implementation()["hash"], implementation_files=implementation()["files"],
                dialogue_profile_hash=PROFILE_HASH,
                runtime=runtime_versions(),
                primary_outcome="decision_yield", primary_unit="one matched team-run block per case seed",
                contrast="C − B", secondary_contrasts=["C − A", "B − A"],
                estimand="Mean paired difference in earned/attainable points for all six post-break tenders per block.",
                missing_rule="Unawarded contracts score zero within a finished run. Unfinished blocks remain in the denominator for attrition bounds.",
                interval="5000 paired block bootstrap draws, percentile 95%, live data with at least 10 complete blocks.",
                budget_scope="Limits apply per block across its A/B/C departments. Registration sends no provider requests.")


def paired_analysis(blocks, provider, protocol_hash):
    values = [b["yields"] for b in blocks if b["status"] == "completed" and b["yields"] is not None]
    primary = [v["C"] - v["B"] for v in values]
    total, n = len(blocks), len(values)
    missing = total - n
    # Each arm yield lies in [0,1], so each missing contrast lies in [-1,1].
    bounds = [(sum(primary) + sign * missing) / total for sign in (-1, 1)]
    ci = None
    if n >= 10 and provider != "mock":
        rng = random.Random(f"paired-percentile-v1:{protocol_hash}")
        draws = sorted(sum(rng.choices(primary, k=n)) / n for _ in range(5000))
        ci = [draws[124], draws[4874]]
    return dict(planned=total, completed=n, missing=missing, contrast="C − B",
                mean_difference=statistics.mean(primary) if n else None, ci95=ci, attrition_bounds=bounds,
                paired_sd=statistics.stdev(primary) if n > 1 else None,
                secondary={k: statistics.mean(v[a] - v[b] for v in values) if n else None
                           for k, a, b in [("C − A", "C", "A"), ("B − A", "B", "A")]},
                interpretation=("Synthetic policy check. These results verify the instrument only." if provider == "mock"
                                else "Complete-block estimate. Interpret with missing-block bounds and the preregistered stopping rule."))
