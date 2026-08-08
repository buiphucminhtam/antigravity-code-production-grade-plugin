---
id: research-gate
title: Research Gate Protocol
summary: Evidence-driven research only when a material knowledge gap blocks a correct decision or recovery.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [plan-quality-loop, senior-execution-contract]
supersedes: []
superseded_by: null
---
# Research Gate Protocol

<!-- source: skills/_shared/protocols/research-gate.md -->

Research is a tool for closing a **material knowledge or evidence gap**. It is not a ritual for increasing a numeric score.

## Trigger

Open the Research Gate when at least one is true:
- a `STANDARD` / `DEEP` plan is below its applicable threshold **because a material fact/pattern is unknown**;
- the same execution step failed twice and the evidence points to an unknown API/tool/platform behavior;
- the task depends on current, niche, security-sensitive, compatibility, or external facts that cannot be established from the workspace;
- an expert disagreement cannot be resolved from current project evidence.

Do **not** trigger research merely because:
- a `QUICK` task has not been numerically scored;
- a template says “best practices” might exist;
- the current verified project facts are already sufficient to act;
- extra research would only optimize an already acceptable solution.

## Source Order

Use the cheapest authoritative evidence first:
1. current workspace/runtime/config/tests/logs;
2. official project/framework/API documentation or primary technical sources;
3. verified external research/search when the answer is genuinely external or current;
4. secondary sources only when primary sources do not answer the question.

NotebookLM or another research tool is optional, never a prerequisite. Never invent availability.

## Flow

1. State the exact unknown in one sentence.
2. State what decision would change based on the answer.
3. Gather the minimum evidence needed from the source order above.
4. Synthesize 1–3 actionable findings and cite/store the evidence location.
5. Re-plan or retry only the affected work.
6. Re-run the relevant deterministic check.
7. If the same step is still unresolved after two failed attempts, follow the kernel Stuck/Escalation rule instead of looping.

## Learning Boundary

Store project-specific lessons in project-local state such as `.forgewright/plan-lessons.md`, decision logs, or handoff state. **Do not mutate shared Forgewright `SKILL.md` or protocol files during an unrelated delivery task.** Framework self-improvement is a separate Forgewright-development task and must pass its own tests/review.

## Output

A useful research gate produces:
- `UNKNOWN`: the material question;
- `EVIDENCE`: what was verified and where;
- `DECISION`: what changed (or “no change”);
- `CHECK`: the next deterministic verifier.

If research does not change a decision, stop researching and execute the already-supported plan.
