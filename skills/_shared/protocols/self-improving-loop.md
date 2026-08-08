---
id: self-improving-loop
title: Adaptive Self-Improving Loop Protocol (ASIP)
summary: Deprecated compatibility entry; recovery now uses kernel Stuck/Escalation plus the evidence-driven Research Gate.
status: deprecated
version: 2.0.0
owners: [core]
triggers: []
used_by: []
related: [research-gate, plan-quality-loop, senior-execution-contract]
supersedes: []
superseded_by: research-gate
---
# Adaptive Self-Improving Loop — Deprecated Compatibility Entry

ASIP previously combined plan scoring, mandatory research, retries, and direct mutation of shared skill files. That behavior is deprecated because it can amplify a weak model's wrong assumption and create process work unrelated to the client outcome.

Use these current contracts instead:
- `kernel/SOLVE.md` — two failures on the same step trigger the Stuck/Escalation rule;
- `skills/_shared/protocols/plan-quality-loop.md` — `QUICK` fast path and applicable `STANDARD` / `DEEP` thresholds;
- `skills/_shared/protocols/research-gate.md` — research only for a material knowledge/evidence gap;
- `skills/_shared/protocols/senior-execution-contract.md` — evidence hierarchy, proportional engineering, and client/outsource posture.

## Compatibility Recovery Flow

1. Capture the failing command/check and exact evidence.
2. Determine whether the failure is implementation-local or caused by an unknown external/project fact.
3. If local and the next fix is evidence-supported, make one targeted correction and re-run the same check.
4. If the same step has failed twice, STOP repeated attempts. Use the Research Gate only when a material unknown exists; otherwise escalate with the evidence and alternatives.
5. Store project-specific lessons in project-local state. Do **not** rewrite shared `SKILL.md`/protocol files as part of an unrelated client task.
6. Any future framework-level learning change must be an explicit Forgewright change with deterministic regression tests and independent review.

A higher model tier is not a recovery mechanism by itself; its output is subject to the same grounding and verification gates.
