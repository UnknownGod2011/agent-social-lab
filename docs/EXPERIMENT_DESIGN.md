# Beyond Task Talk: experimental design

The registered supplier-selection study, control conditions, power planning, missing-data policy and manuscript outline are described in the [research protocol](RESEARCH_PROTOCOL.md). The following design describes the original task-board instrument.

## Question and conditions

Does scheduled non-task interaction change objective task outcomes or observable cooperation in otherwise matched LLM teams? The software demonstrates and records an experiment; it does not establish that AI agents experience friendship, trust, fatigue or emotion.

| Arm | Work period | Break | Purpose |
|---|---|---|---|
| A | Four fixed roles with shared work messages | Silent rest; no model call | Work-only baseline. |
| B, optional | Identical roles and work opportunities | One private non-task journal turn per agent | Control for additional calls and output opportunity without interpersonal exchange. |
| C | Identical roles and work opportunities | One bounded non-task turn per agent at the shared table | Social-interaction condition. |

The role templates are coordinator, builder, verifier and integrator. The initial project board is copied, and its hash is identical across arms. The seed and immutable run-config hash are visible. Equal seeds make mock runs reproducible; remote model sampling and service behavior can remain nondeterministic.

Each virtual day follows wake, planning, first work block, break, second work block, evaluation and sleep. The same project and authorized memories carry into the next day. Sleep saves local data; it does not update model weights. The office animation follows recorded events and never changes action validity, work opportunities or outcomes.

## What stays fixed

Within each experiment keep model/version, provider, role prompts, starting board, evaluator, number/order of role opportunities, work-round limits, memory policy, maximum output setting, day count and schedule fixed across conditions. The scheduler alternates department dispatch order to reduce consistent first-mover service effects. Failed requests and retries are logged separately from logical turns. A provider blockage pauses progress; it must not substitute mock actions into a live run.

C and B have the same scheduled number of non-task calls and output-token ceilings. This matches call/output **opportunity**, not actual generated tokens, latency or model effort. Include measured tokens and costs as outcomes/covariates; never describe B as perfectly compute-matched. A intentionally has no extra break calls. A/C alone confounds interpersonal interaction with additional calls and non-task context; include B before making a claim specific to interpersonal exchange.

Break contexts exclude board state, artifact content, task status, work messages, work memories and editable work-role prompts. The MVP uses a whitelist of safe utterance IDs instead of unconstrained model-written chatter. The engine rejects task actions during breaks. This strongly enforces non-task content but sharply limits ecological validity. B notes remain private to the agent and the researcher; they are not work or small-talk messages. Researcher visibility does not imply agent visibility.

## Outcomes and evidence

The environment is a declarative miniature task-board world, **not real code generation**. Twelve milestones cover schema, creation, listing, status, assignment, permissions, audit, export/import, dependencies, regression and release. Agents submit structured feature rules. Fixed machine checks and prerequisite/review rules decide whether a milestone passes. Prompts can describe claims; only validated actions change state.

Report these outcomes before collaboration indicators:

- Passed milestones/total, acceptance-test results and completion at the allotted horizon.
- Rejected and retried actions, dependency blocks and duplicate claims/work.
- Work opportunities consumed, virtual days/minutes and wall-clock runtime separately.
- Logical turns, HTTP attempts, failures, input/output/thought/cached tokens and unresolved usage.
- Estimated paid-equivalent USD and provider-reported actual charge as separate fields. An unavailable actual charge is unknown, not zero. Mock network cost is zero; mock token illustrations are synthetic.

Collaboration indicators are **behavioral proxies** with action-level evidence:

- Useful help: a sender-known rule was new to its recipient and subsequently passed its scenario in the recipient's submitted artifact. Sending a fluent message alone earns no count.
- Accurate handoff: a matching artifact-version handoff was subsequently consumed by a verifier review.
- Repaired misunderstanding: a corrective rule for a failed check was transferred, learned and subsequently used correctly.
- Prevented duplicate claims: the engine rejected a redundant assignment. This is an engine-control count, **not** evidence that agents voluntarily cooperated or intended to avoid work.
- Pairwise graph: edges count distinct validated downstream help/handoff/repair uses; names and raw counts remain inspectable.

These definitions measure narrow task-world behaviors. They cannot infer friendship, felt trust, motivation or a percentage “relationship score.” Message sentiment and eloquence are not scoring inputs. A model can learn to satisfy these operational checks without generalizing to useful human cooperation.

## Replication and analysis

One independent four-agent department completing one configured project is one **team-run**. Four agents, many messages and repeated days within that run are not independent samples. Compare paired A/B/C team-runs under a shared configuration/seed; record a distinct run ID for every replication. Separate mock from live datasets and separate incompatible configs/models.

Start with **10 paired pilot replications** to characterize completion rates, cost, failure rates and variability. This is an engineering pilot, not a claim that ten is statistically sufficient. Use pilot variability and a predeclared meaningful effect to plan a larger preregistered sample with a qualified statistical analysis. Report exclusions, provider outages, budget stops and incomplete runs. Counterbalance order and repeat over multiple seeds/tasks before claiming generality. Check for model-version drift across collection dates.

For dashboard descriptive comparisons, show independent completed `n`, individual values and mean/standard deviation when `n >= 2`. At `n < 2`, variability is unavailable. Do not produce mock p-values or treat an animated demonstration as scientific evidence. Budget-stopped runs belong in the accounting and completion analysis; do not quietly drop unfavorable runs. Prefer paired differences and confidence intervals in a separately reviewed analysis once an adequate live dataset exists.

## Probes, costs and limitations

The probe interface is a foundation for isolation-based information transfer, costly help, misunderstanding repair and handoff accuracy at days 1, 3 and 5 when those days exist. A probe must have its own task ID, raw trace, scoring rule, visibility flag and version. Probe state/results never enter main-agent memory or the main board. They should not alter the allotted work schedule. Any shipped deterministic reference probe is a synthetic fixture check, not evidence of a separately isolated live-agent capability; confirm implemented coverage in `FINAL_HANDOFF.md`.

Break overhead is approximately `4 × scheduled break days` extra logical calls for each of B and C; work overhead is fixed by role rounds. Every HTTP retry also consumes a call allowance and may consume tokens. A reservation before dispatch enforces configured caps; uncertain responses retain a conservative reservation. Pooling credentials does not create more project quota. Free-tier access and actual billing cannot be established from the appearance of an API key.

The MVP lacks realistic software maintenance, Docker-isolated repositories, hidden pytest suites, independent evaluator replication, unconstrained natural dialogue and validated human-relevant cooperation measures. Vetted break choices may produce visibly different traces without changing task performance. The mock work policy must remain condition-blind: no built-in social productivity bonus. Real LLM runs still only establish performance in this narrow world. Publication requires stronger environments, controlled probes, preregistration, sufficient independent replications and careful contamination/cost audits.

See [research references](RESEARCH_REFERENCES.md) for the architectures inspected and human-study access limits; see [final handoff](FINAL_HANDOFF.md) for exact tests and current implementation status.
