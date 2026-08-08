---
id: graceful-failure
title: Graceful Failure Protocol
summary: Evidence-based stuck detection, bounded retry behavior, and honest escalation.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [research-gate, senior-execution-contract, verification]
supersedes: []
superseded_by: null
---
# Graceful Failure Protocol

A clear, evidenced failure is better than a fabricated success or an agent loop that burns client time.

## Core Rules

1. Never retry the same action without new evidence or a corrected parameter/assumption.
2. After the **same step fails twice**, stop repeated attempts and follow `kernel/SOLVE.md` Stuck/Escalation.
3. Open `research-gate.md` only when a material knowledge/evidence gap blocks the next decision. Failure alone does not mandate browsing/research.
4. Preserve useful partial results and verified findings.
5. Never turn a local failure into a new framework rule automatically. Lessons stay project-local unless Forgewright itself is the explicit improvement scope.
6. A higher-tier model may provide an independent hypothesis/review, but its output still requires evidence.

## Evidence-Driven Recovery

For a failed step:

1. Capture the exact command/tool action, expected result, actual result, and relevant state.
2. Classify the cause from evidence:
   - implementation/local logic;
   - environment/tooling/dependency;
   - external/knowledge gap;
   - contract/scope ambiguity;
   - safety/permission boundary.
3. If the cause is known and the correction is local/reversible, make **one** targeted correction and run the same verifier again.
4. If the second attempt fails:
   - research only if an unknown blocks the next decision;
   - otherwise escalate with the evidence, remaining options, and residual risk.

An alternate approach counts as progress only when it tests a distinct hypothesis or uses new evidence. Renaming the same guess is still a retry.

## Stuck Signals

Stop immediately when any applies:
- the same tool call/parameters are being repeated without new evidence;
- two approaches oscillate without changing the hypothesis;
- failures reveal a safety/permission/credential boundary the agent cannot legitimately cross;
- a required external service/runtime is unavailable and cannot be repaired within current permissions;
- the next action would be speculative, destructive, or outside the agreed scope.

Do not invent token-budget percentages, progress percentages, retry budgets, or time estimates. Use runtime/tool telemetry only when it actually exists.

## Failure Categories

| Category | Senior behavior |
|---|---|
| User/input mismatch | State the concrete mismatch and the smallest correction needed. |
| Environment/tooling | Verify the missing tool/dependency/runtime. Use approved install/config actions if in scope; otherwise report the blocker. Do not auto-run repeated installs. |
| Knowledge gap | State the exact unknown and use the Research Gate only if the answer changes the next decision. |
| Safety/permission | Stop the prohibited action; preserve state and explain the required authorized path. |
| Scope/contract ambiguity | Ask only the material decision; do not widen scope to make progress. |
| Partial completion | Report verified completed work, exact blocker, and next executable action. |

## Exit Report

When work cannot continue, provide:
- **Objective:** what acceptance was being pursued;
- **Evidence:** failed verifier/tool output and verified state;
- **Cause:** known root cause or `UNVERIFIED` hypothesis;
- **Completed:** useful work already verified;
- **Blocked:** what cannot proceed and why;
- **Next action:** one or more evidence-supported options.

Do not label the overall task successful when a required acceptance criterion remains blocked.

---

*Research is optional and evidence-driven: `skills/_shared/protocols/research-gate.md`.*
