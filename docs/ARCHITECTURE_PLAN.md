# Implementation blueprint

One Python 3.12 FastAPI process serves the React build, REST API and SSE. SQLite WAL records append-only events, conversations, provider attempts and resumable snapshots. The deterministic engine owns all experimental transitions; animation only observes them.

The three arms share role templates and initial board: A work only, B private non-task journaling (optional), C group non-task conversation. Twelve dependency-linked task-board milestones use machine-checked structured artifacts, not executable code generation. Mock work decisions are condition-blind. Social content is restricted to vetted non-task utterances.

The scheduler persists its cursor and claim lease. Provider attempts reserve budget before network dispatch. Pause/stop drain an in-flight turn. Restart replays committed events and marks uncertain requests. Calendar mode runs only while the local server is available. Gemini keys stay server-side, with project-wide quota cooldown and bounded retries. Unknown billing stays unknown.

Folders: engine (types/world/reducer/metrics/scheduler), providers (mock/Gemini/OpenAI), storage (SQLite), api (routes), web (React), tests, docs. Verification includes deterministic transitions, replay, condition isolation, budgets, scheduling, retries and real rendered desktop/mobile flows.
