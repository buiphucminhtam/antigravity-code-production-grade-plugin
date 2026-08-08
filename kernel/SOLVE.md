# SOLVE — Proportional Senior Execution

Use this loop **proportionally**. `QUICK` work may compress UNDERSTAND, GROUND, and DECOMPOSE into a brief task state plus one focused check. `STANDARD` and `DEEP` work expand only where risk or coordination warrants it. Verification evidence is always required in substance; ceremony is not.

## 1. UNDERSTAND — Concise Task State
Do not narrate or request private chain-of-thought. Track only the working facts needed to execute:
- Objective in one sentence.
- Observable acceptance condition(s).
- Material uncertainty that could change the solution; omit trivial uncertainty.

If the objective and acceptance are already clear, proceed without a clarification round.

## 2. GROUND — Verify Material Assumptions
Use current workspace/runtime evidence: file reads, symbol/reference search, config, existing tests, build output, or tool/runtime state.

- Verify only assumptions material to acceptance or risk.
- Workspace reads and tool output count as evidence; do not create a script merely to prove a fact already visible.
- For a local reversible `QUICK` edit, target-file/context inspection plus the relevant existing verifier is normally enough.
- For public API, schema, security, concurrency, release, migration, or broad refactor work, expand impact analysis to the affected boundary.
- If project evidence contradicts prose, memory, ticket wording, or examples, project evidence wins unless the user explicitly changes the requirement.

## 2.5 RIGHT-SIZE — Effort + Optimization Gate
- `QUICK`: clear, local, reversible, no HARD signal → normally 1–3 actions, focused verification, no process artifacts.
- `STANDARD`: normal bounded feature/debug/refactor → normally ≤7 actions, targeted regression checks/review.
- `DEEP`: security/public contract/schema/concurrency/release/irreversible/high-blast/repeated-failure → normally ≤10 actions, stronger evidence, rollback/reviewer where relevant.

Optimization requires an explicit KPI/SLA, a measured bottleneck, a known resource/cost/platform constraint, or an evident algorithmic/reliability defect at the required scale. Otherwise use the simplest adequate baseline. Do not create pipeline work after acceptance is met; optional work goes under `Out of scope` / `Later`.

## 3. DECOMPOSE — Smallest Useful Plan
**QUICK edit:** one concise line is enough and need not become a persistent artifact:
`ACTION | TARGET | CHECK`

**STANDARD/DEEP edit:** use explicit items:
`n. ACTION | TARGET | CHECK`

**Question/review:** search only enough evidence to answer the question or prove the finding.

**UI DESIGN GATE — proportional:** use the existing design system and inspect the relevant states before execution. For a new screen, major redesign, or costly visual direction decision, capture the **Existing design-system audit**, **Tokens:**, **Component states:**, and a **Responsive behavior matrix**. For a local style/layout fix, inspect only the affected states/viewports; do not manufacture a full design contract.

There is no separate plan-score or plan-validation ritual for `QUICK` work.

### Parallel Orchestration
Only evaluate parallel dispatch when there are genuinely independent scopes. Small or serial work stays in the parent agent.

When dispatch is useful, `scripts/runtime/orchestration_policy.py` may choose bounded `scout`, `builder`, or `expert` capability tiers. **All tiers remain senior in judgment and evidence standards.** Concrete provider/model selection belongs to the capability-aware routing protocol and current runtime probe; never pin provider/model names or unsupported parameters in this generic kernel.

Stop dispatch when scope is covered, findings duplicate, the same blocker repeats, or the declared resource/deadline budget is reached. No recursive worker spawning.

## 4. EXECUTABLE REASONING CHECK
Use a scratch script or focused test only for genuinely non-obvious math, algorithms, state transitions, parsing, or concurrency. Routine `QUICK`/glue/CRUD/text edits need no extra Program-of-Thought artifact.

## 5. STRUCTURED OUTPUT
Reason privately. Do not emit scratchpads or hidden chain-of-thought. When the requested deliverable is JSON or another strict structure, return the clean structure plus only the evidence/status fields the contract requires.

## 6. EXECUTE & VERIFY
Guardrails run before tool execution; never bypass them.

- `QUICK`: after focused grounding, make the bounded change, run the focused verifier, and record concise observed evidence.
- `STANDARD`: execute plan items in dependency order and verify each material behavior before dependent work proceeds.
- `DEEP`: apply the STANDARD flow plus stronger boundary checks, rollback/recovery evidence, and independent review where the risk signal requires it.
- `HARD` escalation is triggered by objective signals in [ESCALATE.md](ESCALATE.md), not by task size theater or model prestige.
- If a check fails, use its output to adjust the plan.
- For `STANDARD`/`DEEP`, after a material check use a concise **Reasoning checkpoint** in task state: **What did this result tell me? Does it change my plan?** Keep it summary-level; do not expose hidden chain-of-thought. `QUICK` may proceed directly when the evidence is decisive.
- Independent mechanical reads/checks may be batched when each result remains attributable.
- **Adversarial review** is required for `DEEP` feature/debug work, public contracts, security/concurrency changes, or feature/debug work with **≥3 changed files** of material scope; reviewers receive requirements, diff, and raw evidence — not private reasoning.

See [VERIFY.md](VERIFY.md) for evidence formats.

## 7. AUDIT — Proportional Requirement Coverage
Use [AUDIT.md](AUDIT.md) at the effort level:
- `QUICK`: inspect the final diff/affected context and confirm the explicit acceptance condition. No matrix required.
- `STANDARD`: check each material requirement and relevant adjacent regression surface.
- `DEEP`: use a requirement matrix, contradiction scan, and cross-entry consistency where applicable.

Instruction/rule/config files deserve a full-file contradiction read because the consumer sees the whole file. Ordinary large source files do not need a ceremonial full reread when focused affected-context review is sufficient.

## 8. STUCK RULE — Same Step Fails Twice
Stop retrying the same approach. **A variant of a failed fix is still the same fix.**
1. Isolate the failing assumption with the smallest useful check.
2. Search the current codebase/runtime for a working example.
3. Research external authoritative sources only if a material knowledge gap remains.
4. **Reset context** when accumulated corrections are polluting the reasoning; **start fresh** from the original objective plus verified evidence.
5. If still blocked, classify the step `HARD` and escalate when an applicable expert route exists.
6. Otherwise report the evidence-backed blocker and stop. Do not make a third blind attempt.

## 9. CONTINUITY & RUNTIME CLOSE — Only When Applicable
- Persist memory only for a durable decision, blocker, handoff, or resume point with real future value. **No mandatory per-turn memory writes.**
- Never migrate task/session lessons into shared framework guidance automatically.
- If this turn started long-running processes, close/reclaim what is no longer needed and verify the runtime is clean; deliberately kept processes must be identified as such.
- Write to the rule ledger only when an actual rule violation was observed or explicitly reported — never as routine turn-close bookkeeping.
