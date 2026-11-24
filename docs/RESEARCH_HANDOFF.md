# Research release handoff

Open the [local study registry](http://127.0.0.1:8000/#studies). Register an offline study to inspect all researcher controls, or open [the three-day DeepSeek calibration](http://127.0.0.1:8000/?study=8bb64292a7337384c7fd9b0c40f185191c6e672b9255f804d8242d4d317366d3#studies) on the original workstation. In the Live Lab, **Goals** exposes a role-specific supplier scorecard, **Message paths** traces recorded disclosures and requests, and **Replay** reconstructs state at a particular event. Character poses are presentation cues for observed actions.

## Implementation map

```text
api/          Run controls, study registry, replay, export and integrity checks
engine/       Scheduling, private supplier work sample, dialogue and paired analysis
providers/    Gemini pool, OpenAI-compatible transport, DeepSeek and offline reference policy
storage/      SQLite allocations, event ledger and snapshots
web/          Original animated office, evidence viewer, registry and comparisons
scripts/      Provider smoke test, corpus validation and independent archive recalc
tests/        Work rules, isolation, providers, replay, study allocation and analysis
docs/         Architecture, literature, paper design and verification
```

The scheduler selects a role and projects its authorized view. The provider returns a typed proposal. The environment validates it and grades awards against the complete casebook. The store commits the state, event hashes, cursor and snapshots. Research reports use only recorded outcomes. New supplier cases and controls are scoped by the study manifest. See [architecture and maintenance](ARCHITECTURE.md).

## Live DeepSeek calibration

| Seed | Days and rounds per work block | A / B / C awards | Attempts | Reported tokens | Peak-rate cost estimate |
|---|---|---|---:|---:|---:|
| 71221 | 1 day, 2 rounds | 0 / 0 / 1 | 56 | 31,510 | $0.00543052 |
| 71222 | 1 day, 2 rounds, revised disclosure prompts | 0 / 0 / 0 | 56 | 36,781 | $0.00727012 |
| 71223 | 2 days, 2 rounds, revised disclosure prompts | 2 / 2 / 2 | 112 | 77,624 | $0.01534730 |
| 71224 | 3 days, 3 rounds, final backend | 5 / 5 / 6 | 240 | 174,371 | $0.03421758 |

The supplied credential passed model listing and structured generation. The first one-day pilot exposed 23 duplicate-disclosure rejections. The second exposed insufficient deliberation time even with zero rejected actions. In the two-day calibration all departments yielded 30% and each made one optimal award. The final three-day calibration yielded 74.83% for A, 72.79% for B, and 88.44% for C. B and C each recorded 12 break entries, each team received 72 work turns, and all attempts resolved. Costs use the frozen estimates from reported token and cache usage. Invoice amounts are unavailable. These sequential pilots used different case seeds and settings to calibrate the instrument. Pre-registered inference requires an independent cohort.

## Reproduce the checks

```powershell
.\start.ps1 -Install
.\.venv\Scripts\python.exe -m pytest -q --tb=short
npm --prefix web run build
.\.venv\Scripts\python.exe scripts/check_provider.py --provider deepseek
.\.venv\Scripts\python.exe scripts/fit_dialogue_profile.py --input path/to/train.json --check
.\.venv\Scripts\python.exe scripts/validate_dialogue.py path/to/valid_freq.json
.\.venv\Scripts\python.exe scripts/study_packet.py export STUDY_ID evidence.zip
.\.venv\Scripts\python.exe scripts/study_packet.py verify evidence.zip
npx --yes --package @playwright/cli playwright-cli open http://127.0.0.1:8000
npx --yes --package @playwright/cli playwright-cli run-code --filename=output/playwright/ui-research.js
```

The two-day and three-day pilots were independently re-scored from their exported award actions and scorecards. The three-day audit verified 1,740 events and 45 snapshots. Its local packet at `.verification/final-deepseek-calibration.zip` has SHA-256 `9b972eff3d8851d47836071e258e7b59d6f9aaf66260a326a47e939341a8d468`. The local database, archives and credentials stay outside source control. The registry export remains usable for historical blocks registered on earlier engine builds.

The backend suite passed 67 tests, with one Starlette TestClient deprecation warning. The production React build passed. The Chromium walkthrough verified registration, opening a block, the office and real recorded speaking pose, message-path replay, evaluator scorecards, comparison, DeepSeek selection, a study JSON download, 1440-pixel desktop and 390-pixel mobile layouts, and reduced-motion behavior. Browser screenshots show the [recorded break](../output/playwright/research-break.png), [role evidence](../output/playwright/research-office.png), [desktop registry](../output/playwright/study-registry.png) and [mobile registry](../output/playwright/study-mobile.png).

A clean staged-source archive installed the Python and npm locks through `start.ps1 -Install -Port 8010` without credentials. Its mock block completed with 457 verified events, zero tokens and zero cost. The sequential runner completed two additional offline blocks on the main instance. All six tenders were awarded optimally in each department, and the standalone verifier checked all 36 case results.

## Remaining research work

Calibrate the work horizon and manipulation fidelity across independent pilot seeds, choose a practical effect threshold and use pilot variance to power a preregistered live study. The paper protocol proposes a post-break purchasing sample with C−B as its primary contrast. A withheld-memory replication tests whether the break text channel carries the effect. Human-rated conversational naturalness, a powered confirmatory cohort, model-family replication and real purchasing validation remain open. [Study and paper protocol](RESEARCH_PROTOCOL.md) · [Dialogue dataset and validation](HUMAN_DIALOGUE.md)
