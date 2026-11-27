# Does participating in small talk change how AI teams use evidence?

Status as of 27 November 2026. The application can run the existing three-arm study. A transcript-exposure control, a multi-seed live pilot, and a confirmatory study remain proposed work. The previous DeepSeek calibration covers one matched block.

## Goal and contribution

The study asks whether four-agent teams that participate in task-irrelevant dialogue make better decisions afterward than equally resourced teams that see comparable dialogue without participating in it. The primary test concerns a timed decision with verifiable consequences. The mechanism tests examine how information reaches the decision and whether the team relies on it appropriately.

Prior work narrows the claim. Buyl and colleagues already tested generated rapport, including small talk, and prewritten context with investment and persuasion outcomes. Chen examined costly verification, partner effects and recovery. Toxtli and Delaflor tested hidden-profile decisions in LLM groups. A plausible contribution is to test **participation in reciprocal non-task dialogue versus matched dialogue exposure**, with downstream objective decision quality in persistent teams and a credible measure of whether the team integrates private evidence. Establishing priority would require a fuller literature review before preregistration. [Buyl et al.](https://arxiv.org/html/2508.15858v1) · [Chen](https://arxiv.org/abs/2606.14923) · [Toxtli and Delaflor](https://zenodo.org/records/24179025) · [CollabSim](https://arxiv.org/abs/2606.06399)

## Task

Use a controlled purchasing simulation. In every case, four agents must recommend a supplier by a fixed deadline. Each sees a different scorecard, covering delivery, quality, cost or service. As an example, one supplier might look best on price while a teammate's reliability evidence makes a different supplier optimal overall. Teams have a limited number of work turns to disclose and request evidence before the integrator seals the award.

Use one practice case before the first break, then a fixed set of new scored cases. Every arm in a block receives the same cases, role prompts, work tools and score weights. Grade with the full casebook withheld from the agents. Generate pilot and confirmation cases from separate seed lists. Verify that optimal suppliers are distributed across positions, a single role rarely has enough information to identify the answer, and each case has a unique optimum with a meaningful gap. Compare against a single-role heuristic and an all-information solver during calibration. If teams hit a floor or ceiling, change task difficulty or the work horizon before freezing the protocol.

The primary outcome is **earned utility divided by total attainable utility over all scheduled cases**. Every case without a sealed award earns zero, including cases the team never reached. Report coverage and correctness of completed awards alongside this outcome. Those measures explain whether a gain came from finishing more cases or choosing better suppliers.

## Treatments

| Arm | Break assignment | What the comparison helps estimate |
|---|---|---|
| A | Silent break | Practical baseline |
| B | Private non-task journaling | Additional non-task generation and self-authored context |
| C | Contingent non-task dialogue with assigned teammates | The intervention |
| D | Matching non-task dialogue from an independent donor team | Transcript exposure without influencing the dialogue |

Use **C minus D** as the primary contrast. C minus A is the effect of adopting the whole break practice in this lab. C minus B compares sharing the break with private writing. D minus B is exploratory because it also changes transcript contents and source.

Build a donor transcript bank before confirmation. Match the model, topic, roles, day, turn count, and memory rules used in C. Choose and log donor IDs before observing recipient outcomes. D agents have the same scheduled generation calls and output ceilings. Their private break responses do not affect the donor transcript or become extra work memory. Match the transcript format and token allowance. Measure residual differences in observed tokens, validity, and length. If budget parity and transcript comparability cannot be achieved, narrow the claim to the operational difference between the two specified interventions.

Use a second experiment to vary memory carryover. Withhold the same break history from the work prompts while preserving work memory. A separate planned arm can relabel partners while preserving message text. Comparing these conditions helps distinguish carryover and attribution from general exposure. Treat the comparison as an experimental ablation, with comparisons and multiplicity declared in advance. Current utterance choices are bounded, off-task stimuli. Human-rated naturalness and any broader dialogue protocol require separate validation.

## What to record

| Priority | Measure |
|---|---|
| Primary | Team decision yield over every scheduled post-break case, with captured denominator and oracle score |
| Task quality | Cases awarded, optimal awards, coverage, regret from best feasible choice, and invalid or unverified actions |
| Information transfer | Unique relevant facts disclosed, received and demonstrably used before the decision, plus time or turns to first useful disclosure |
| Reliance and repair | Evidence checking rates, decisions that use or reject planted incorrect evidence, repair success, and completed handoffs |
| Treatment fidelity | Delivered topic and turns, who authored each line, donor ID, speaker label policy, accidental task leakage, and actual text visible at work |
| Resources | Separate work and break calls, input and output tokens, cached tokens, retries, latency, estimated and reported cost, and observed model version |
| Failures | Missing blocks and cases, provider errors, budget stops, exceptions, and any exclusion reason linked to a registered rule |

Define *received* as present in the decision-maker's recorded work context. Define *used* as explicitly cited by a typed decision when possible. Evaluate correctly using that evidence separately. If testing verification, use a small, separate fixed-work probe with reliable and deliberately incorrect task evidence and a verifiable answer. Support both an appropriate reliance finding and an overreliance finding. Keep natural-language sentiment and avatar state out of the main outcome.

## Evidence milestones

1. Implement and test arm D, transcript permissions, donor integrity, matched work-turn accounting, and independent audit of each score. Record expected arm visibility with paired fixture tests. Review who can see hidden targets and which events enter each prompt.
2. Run an exploratory live pilot of roughly 10–15 fresh matched blocks, subject to a provider budget. Check manipulation fidelity, coverage, floor and ceiling effects, missingness, paired variance, and estimated cost. Use human raters blinded to arm if naturalness becomes a claim. Set all cutoffs before confirmation.
3. Choose the smallest decision-yield change worth interpreting and size the cohort from the paired pilot variance, with an allowance for missing blocks. For illustration, a five-percentage-point target and 15-point paired SD imply roughly 71 complete blocks under the usual normal approximation for 80% power and two-sided 5% significance. Replace those illustrative inputs with the pilot estimates or a simulation-based design. The independent unit is the matched team block. Agents, cases, messages, and days within it are correlated observations.
4. Preregister one primary contrast and outcome, the randomization schedule, model versions, stopping rule, failure handling, and secondary analyses. Use fresh case seeds and transcript assignments for confirmation. Report a paired effect estimate and interval, with missing-block bounds and condition delivery rates. Distinguish a small, precise effect from an inconclusive estimate. Replicate on a second model before claiming the effect transfers across models. [Center for Open Science preregistration](https://www.cos.io/initiatives/prereg)
5. Release a configuration and seed manifest, anonymized or synthetic materials, ledger fingerprints, scorer, and analysis code. A credible null or detrimental effect is informative if the intervention was delivered and the estimate is precise enough to test a practically meaningful benefit.

## Hosting and interface

Use Vercel to share the UI and synthetic traces. If the study moves online, put live runs behind an authenticated researcher workspace with a durable database and worker able to resume after a crash. Keep provider keys server-side. Add an idempotent job ID, a budget reservation record, and a write-once event record for each dispatch and result. Keep the scorer independent of model calls and the UI. Save sealed condition assignments, model and prompt versions, inputs, evidence access and replay alongside the results. The local backend already has configuration freezing, replay, and scoring. The hosted preview is a read-only release of a synthetic fixture. [Vercel runtime filesystem limits](https://vercel.com/docs/functions/runtimes#file-system-support)

The interface should expose the treatment, who can see each clue, how the eventual award was scored, and where a result sits in the research lifecycle. Give reviewers separate screens for the trace, experimental design, and block-level uncertainty. Implement visual feedback users request without changing condition logic.

## Where Instagram fits

Use Instagram as a separate field replication if the controlled effect warrants it. Two accounts have different audiences and histories, while a shared account carries exposure from one condition into the next. Meta describes personalized ranking, and Instagram experiment data has been used to study network interference. Those factors make raw follower growth an ambiguous primary outcome for this question. [Meta feed ranking](https://ai.meta.com/tools/system-cards/instagram-feed-ranking/) · [Primary Instagram experiment analysis](https://arxiv.org/html/2308.09790v2)

An intermediate test can ask teams to create an event campaign from the same brief and budget, with arm-blinded raters scoring fact coverage, brand constraints, and quality. A real campaign would need authorized posts, independently randomized exposure or enough independent account clusters, a fixed creative and spend budget, and a predeclared outcome such as verified sign-ups per thousand impressions. Treat follower growth as secondary.
