# Beyond Task Talk Lab

A local research console comparing four-agent departments working on the same persistent task-board project. Watch original SVG creatures move between desks, a shared table, and beds while the server records their actual decisions, conversations, milestones, usage, and replay history.

**This is a structured task-board simulation, not executable code generation. Mock runs are synthetic demonstrations, not evidence that small talk improves performance. Cooperation measures are behavioral proxies, not feelings or friendship.**

## Run locally

Requirements: Windows PowerShell, Python 3.12 (`py -3.12`), and Node.js 20.19+ or 22.12+. From the project folder:

```powershell
.\start.ps1 -Install
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)**. The command installs the Python environment, installs/builds the frontend, and serves everything from one local address. Later starts use:

```powershell
.\start.ps1
```

Mock mode needs no keys or internet access after dependency installation. The SQLite database is created automatically at `data/lab.sqlite3`; it survives browser refreshes and server restarts. Keep the terminal running. Stop the server with Ctrl+C. Run only one Uvicorn worker for this local MVP.

![Desktop research console](output/playwright/desktop.png)

The creatures blink and breathe decoratively; location changes, work activity, speech and sleep follow recorded engine state. A compact [mobile screenshot](output/playwright/mobile.png) shows the stacked layout.

For manual setup on another platform, create a Python 3.11+ virtual environment, install `requirements.txt`, run `npm --prefix web install` and `npm --prefix web run build`, then start `python -m uvicorn api.main:app --host 127.0.0.1 --port 8000` from the repository root. Python needs IANA timezone data, supplied by the `tzdata` dependency.

## Try the experiment

1. Start the default **MOCK / DEMONSTRATION** run. Departments A and C begin with identical task-state hashes and four matched roles: Coordinator, Builder, Verifier, and Integrator.
2. Open Goals to inspect the 12 objective requirements and their dependencies. The mock policy makes a dependency mistake, submits an incomplete artifact, receives a correction, and performs an accurate handoff. Both departments use the same work policy; C is not programmed to win.
3. Open Conversations. A exchanges work information; C additionally has bounded safe non-task dialogue during scheduled breaks. Optional B writes private non-task notes with the same number of extra call opportunities.
4. Pause/resume, advance one virtual day, or stop. An in-flight model request finishes at a safe recorded boundary. Stop and budget exhaustion are terminal; clone to start again.
5. Open Metrics and Compare for objective completion, cooperation evidence, calls, tokens, costs, and run comparisons. Replay reconstructs any recorded event without changing the live run.
6. Export complete JSONL events, CSV messages, CSV metrics, or the versioned configuration JSON. Reset demo creates a fresh mock run and preserves previous records.

Experiment settings create a new immutable configuration. Change role prompts, seed, provider/model, days, schedules, optional B, and budgets before creating that run. Cloning preserves settings; repeated identical mock seeds are not independent research replications.

## Gemini and optional live providers

Keys stay in a server-side `.env` file, which is ignored by Git. Do not put credentials in `web/`, `VITE_` variables, prompts, screenshots, or exported research configuration. `.env.example` lists supported settings; copy it only if an existing `.env` does not already contain your configuration.

```dotenv
GEMINI_API_KEYS=your_first_key,your_second_key
GEMINI_MODEL=gemini-3.5-flash-lite
LAB_DB=data/lab.sqlite3
```

Restart the server after changing `.env`. Select Gemini and an available model when creating a run. The provider check lists sanitized credential IDs and model availability; it never returns keys. A safe command-line preflight is:

```powershell
.\.venv\Scripts\python.exe scripts/check_provider.py
```

Adding `--generate` makes one bounded real generation request. A successful preflight alone does not prove generation or a full experiment works. See [the final handoff](docs/FINAL_HANDOFF.md) for the exact live verification achieved in this checkout.

The pool rotates eligible credentials, disables invalid ones, respects Retry-After/Google RetryInfo, and uses bounded retries and a shared cooldown for unknown project ownership. **Multiple keys do not multiply a project's quota.** Daily quota exhaustion waits for reset instead of cycling around the limit. Errors pause/block the live run honestly; live runs never silently become mock runs.

Token costs are paid-equivalent estimates from configured rates, not proof that Google charged your account. The app cannot certify a key's billing tier. Provider-reported actual charges remain unavailable when the provider does not supply them. Every request attempt, including retries, consumes call allowance; uncertain requests retain their conservative reservation.

The optional OpenAI-compatible adapter uses `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and explicit input/output rates from `.env`. It requires admin paid-call confirmation. Do not treat adapter unit tests as successful live acceptance for an unconfigured endpoint.

New run configurations freeze server-resolved token prices and the complete shared role prompts. `requirements.lock.txt` records the exact tested Python dependency versions; `requirements.txt` contains the small direct dependency list.

## Scheduling and persistence

Virtual mode runs the finite day schedule quickly: wake → planning → work → break → work → evaluation → sleep. The same board and episodic memories persist across days. Sleep stores memory; it does not train or update model weights.

Calendar mode stores an IANA timezone, local wake time, next UTC deadline, cursor, and day claims. The local server must remain running; this app cannot wake a sleeping or powered-off computer. After downtime it handles one overdue day, not an unbounded catch-up burst. Use virtual mode for reproducible accelerated experiments.

## Verification and maintenance

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix web run build
```

The backend tests exercise transitions, machine checks, condition isolation, safe dialogue, private memory, matching hashes, deterministic mock behavior, replay/snapshots, metrics, budget caps, scheduling, API exports, and provider failure handling. Browser layout and interaction checks are described separately in the final handoff. Tests use temporary databases and mocked HTTP where appropriate.

For frontend development, start the backend on port 8000, then run `npm --prefix web run dev` in a second terminal. Vite serves port 5173 and proxies `/api` to the backend.

| Area | Location |
| --- | --- |
| Types, rules, event reducer, scheduler, metrics, probe extension | `engine/` |
| Offline policy and live HTTP adapters | `providers/` |
| SQLite events, snapshots, messages, run settings | `storage/` |
| FastAPI controls, SSE, queries, exports | `api/` |
| React console and original SVG office | `web/` |
| Automated checks | `tests/` |
| Architecture and message flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Scientific controls and limitations | [docs/EXPERIMENT_DESIGN.md](docs/EXPERIMENT_DESIGN.md) |
| Inspected research sources | [docs/RESEARCH_REFERENCES.md](docs/RESEARCH_REFERENCES.md) |
| Exact verification and remaining work | [docs/FINAL_HANDOFF.md](docs/FINAL_HANDOFF.md) |

This MVP binds to loopback and is a local admin tool, not an authenticated multi-user service. Do not expose it publicly without authentication, authorization, stronger deployment controls, and a separate security review. Probe task construction/scoring is an isolated extension foundation; automatic model-run probes, real Docker-isolated repository maintenance, hidden executable tests, and publication-quality causal claims remain future work.
