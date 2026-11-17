# Final handoff — Beyond Task Talk Lab

## Open and run

Local application: **http://127.0.0.1:8000**. Keep its server terminal running. The same URL serves React, REST, SSE, exports and API documentation (`/docs`). Refresh the browser after frontend changes are built.

Repository: https://github.com/UnknownGod2011/agent-social-lab . This repository was empty when inspected. Credentials, virtual environments, databases, local event downloads and dependency/build directories are excluded from Git.

Windows setup from the project root:

```powershell
.\start.ps1 -Install
```

Later starts: `.\start.ps1`. For development, run `npm --prefix web run dev` alongside the backend; http://127.0.0.1:5173 proxies API calls to port 8000.

## Implemented

- A and C paired four-agent departments; optional B private journaling uses the same controller.
- Twelve dependency-linked structured task-board milestones, role-restricted typed actions, deterministic scenario acceptance, rejected attempts, review/repair and integration.
- Condition-blind deterministic mock policy with matched initial boards and genuine synthetic blockers, handoff and repair. No programmed social advantage.
- Virtual days, persistent memory, pause/resume/stop, one-day advance, cloning, config/seed/initial-state hashes and immutable configuration. Default role prompts and token pricing are stored in newly created configs.
- Daily local calendar wake with IANA timezone, persisted deadlines and unique day claims. Server availability is required; this cannot wake a powered-off machine. Overdue days resume one at a time.
- Append-only SQLite events and linked messages, periodic snapshots, exact state-hash replay, SSE reconnection, all log filters, JSONL/CSV/config exports.
- Server-side Gemini pool with eligible credential rotation, permission failures disabled, shared quota/model cooldown, bounded retries and persisted retry deadlines. A live run never substitutes mock responses.
- Per-attempt budget reservations, uncertain request accounting, frozen token rates for new runs, paid-equivalent estimated costs and separately nullable provider charges.
- Responsive original SVG offices and creatures. Ambient blinking/breathing is decorative; walking uses actual location changes, table speech uses recorded messages, sleep follows the schedule. Reduced motion is supported.
- Full parameter comparison within a run, selectable runs/configuration matrix, compatible-group means/SD/sample counts, cost/token/runtime parameters and evidence-based cooperation graphs.
- Probe construction/scoring and isolated callback runner foundation with trace/visibility metadata and tests. Automatic live probe dispatch is deferred.

## Exact validation

Installed and tested with Python 3.12.6, Node 22.18.0, React 19, Vite 6.4.6, FastAPI 0.163.1 and SQLite from Python's standard library.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix web run build
.\.venv\Scripts\python.exe scripts/check_provider.py --generate
```

Final regression: **48 passed, one dependency deprecation warning, 107.77 seconds**. The warning comes from Starlette's httpx-based TestClient; assertions pass. No application error is suppressed by that warning. The production frontend build also passes (36 transformed modules; approximately 92 kB gzipped JavaScript and 13 kB gzipped CSS).

Backend coverage includes lifecycle/role/schema checks; matching starting hashes; real scenario failures and repair; safe non-task dialogue; private B journals; condition-blind mock work; budgets and failed/unknown usage; frozen pricing; four-attempt retries; in-flight repeated pause/stop and terminal stop precedence; restart with an unexpired dead lease; persisted quota cooldown; single-server database ownership; two-day calendar claims and a short real scheduling interval; physical SQLite close/reopen replay; raw-event metric recomputation; SSE Last-Event-ID resume; API controls, filters, comparison and exports.

The five-day A/B/C integration test reached 12/12 milestones in every arm, with 120 work turns per arm, 20 private B notes and 20 C chat messages. The three-day browser-driven mock run also reached 12/12 in A and C, with equal work opportunities. These are synthetic fixture outcomes, not evidence about real agent cooperation.

A separate fresh Git worktree, with no `.env` and zero configured provider keys, completed a three-day A/C run: 12/12 milestones in each department, 156 synthetic calls and zero network model calls. This reused the installed Python runtime/dependencies but imported application code and created its database entirely inside the fresh checkout.

Browser acceptance was performed against the rendered app, not only a compiled bundle. The reusable `output/playwright/ui-smoke.js` script checks start/pause/resume, all six notebook tabs, no-match search, department filtering, historical replay at event zero, actual JSONL download, compare/settings/usage preview, desktop/mobile page overflow and reduced motion. A prior run returned `errors: []`, both overflow flags false, and reduced motion true. Screenshots are in `output/playwright/`.

The final `ui-settings.js` walkthrough also passed: optional B rendered with private journal entries; advance-day paused exactly after day one; cloning produced a fresh ready run; stop was terminal; selecting estimated cost in the comparison worked; the comparison page had no mobile page overflow. Initial script locator/waiting issues were corrected in the browser test, rather than treating them as successful checks.

## Live Gemini evidence

All ten provided credentials authenticated for model listing. That is weaker than generation permission: four were denied generation and disabled; six successfully served requests. Credential values are only in the ignored local `.env`; opaque health IDs are safe for diagnostics. No key values are included here.

The bounded native REST generation smoke returned a schema-valid action, 71 reported tokens and a paid-equivalent estimate of $0.0000565. The service did not report an actual charge.

A full three-day A/C run (`26312e8141de`) completed through the actual scheduler with 164 attempts: 156 logical turns plus eight retries, 246,533 reported tokens and $0.0829579 estimated paid-equivalent cost. Each arm received 72 work opportunities; C recorded 12 non-task messages. Its early role-prompt setup performed poorly (A 0/12, C 1/12). That failure is preserved honestly and motivated clearer default prompts, rejection feedback and role-specific output menus. It is not a treatment-effect finding.

A final-build one-day paired Gemini smoke (`0a834f2ddfd4`) completed with 24 attempts (20 logical turns plus four permission-failure retries), 20,304 reported tokens and $0.0079502 estimated paid-equivalent cost. Each arm passed 1/12 milestones after eight work opportunities; each recorded one objectively used helpful repair, zero invalid actions and zero unresolved attempts. C additionally recorded four non-task lines. This verifies the actual live work/repair/evaluation path without claiming a social-condition benefit. Provider-reported actual charges remain unknown.

## Configuration examples

Offline three-day run:

```json
{"name":"Offline paired demo","provider":"mock","days":3,"arms":["A","C"],"seed":42}
```

Optional journaling control:

```json
{"name":"Three-condition demo","provider":"mock","days":5,"arms":["A","B","C"],"seed":7}
```

Live free-tier-designated Gemini:

```json
{"name":"Live paired pilot","provider":"gemini","model":"gemini-3.5-flash-lite","days":3,"max_calls":1000,"max_tokens":1000000,"max_cost_usd":2,"paid_confirmed":false}
```

These bodies work with `POST /api/runs`; then `POST /api/runs/{id}/control` with `{"command":"start"}`. Use the UI for normal operation. Gemini API keys alone cannot verify project billing; a free-tier designation is not a provider invoice. Unknown costs remain unknown. New runs freeze server-resolved token prices; the spend ceiling is an estimate based on those rates, not a reconciliation of external billing.

For calendar mode, add `"scheduler_mode":"calendar","wake_time":"09:00","timezone":"Asia/Kolkata"`. Keep one local server running. A process lock prevents two app servers from owning the same database. Use different `LAB_DB` paths for deliberately separate instances.

## How a programmer should maintain it

The engine, not React, owns experimental truth. `RunConfig` validates configuration and action models define the entire action surface. `world.py` checks membership, role, phase, dependencies and artifact content; it returns event drafts instead of mutating the database. `reducer.py` applies those drafts to state and authorized memories. Both normal execution and replay use this reducer.

`scheduler.py` constructs a finite step list from the frozen config. It persists a cursor after each committed step, reserves budget before external requests and waits for an in-flight response before acknowledging pause/stop. `store.py` commits event envelopes, messages and state in one short transaction, periodically recording replay snapshots. Network requests never hold a SQLite transaction.

Providers only receive an authorized observation. They propose one JSON action; they cannot mark a milestone successful. Non-task prompts receive safe dialogue/history, without board state or work notes. Gemini credentials are read server-side. Every request failure has a sanitized classification, retry delay and usage certainty. Metrics use recorded evidence and consumed facts; prose sentiment has no authority.

`api/main.py` exposes the controls and recorded data. React subscribes to SSE and refreshes state; the offices translate recorded locations and activity into animation. Compare uses backend-derived metrics and excludes incompatible configurations from a single aggregate. Never fix a UI discrepancy by fabricating a browser-only milestone or score.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete module inventory, API table, diagram, state/memory/data flow, scheduler semantics, extension recipes and test map. [EXPERIMENT_DESIGN.md](EXPERIMENT_DESIGN.md) defines controls, outcomes and replication limits. [RESEARCH_REFERENCES.md](RESEARCH_REFERENCES.md) links every inspected source and notes access limitations.

## Limitations and next steps

The software project is a deliberately small rule-activation simulation. It does not generate or execute a real repository. The evaluator is deterministic but narrow; its rule vocabulary should not be mistaken for general software engineering competence. Free-form social prose is deliberately restricted to vetted lines to guarantee off-topic separation. Recorded factual work messages remain visible to authorized recipients.

The optional OpenAI-compatible adapter has mocked HTTP tests but no live acceptance because no compatible credential was configured. Automatic model-run probes, Docker-isolated repository work, hidden pytest evaluation, a multi-user authenticated deployment, and publication-quality statistical analysis are deferred.

For research: start with independent paired pilot replications, predeclare outcomes and exclusions, estimate variability, then choose a powered preregistered sample. Include resource overhead, provider failures, incomplete runs and model-version drift. Strengthen tasks and validate isolated cooperation probes before interpreting any social-condition differences. No mock run demonstrates friendship, feelings or a causal performance benefit.
