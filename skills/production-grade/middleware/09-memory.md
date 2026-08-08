# Middleware 09 — Memory

> **Source:** `memory-manager.md` / session lifecycle
> **Hook:** `after_skill()` and `turn_close()` when durable state exists
> **Purpose:** Preserve useful cross-session context without confusing memory with current project truth.

## Principles

- Current workspace/runtime evidence outranks memory.
- Memory is optional support, not a hard dependency for ordinary delivery.
- Persist only facts likely to matter later: durable decisions, verified architecture/contracts, unresolved blockers, release state, or substantial progress.
- Skip trivial chat/status turns and routine `QUICK` edits unless continuity genuinely benefits.
- Never store secrets or unverified guesses as facts.
- Never migrate project/session lessons automatically into shared Forgewright `SKILL.md` files.

## After a Substantial Skill / Decision

When memory tooling is available:
1. extract only verified durable facts and decisions;
2. include evidence/source context when useful;
3. store blockers as unresolved, not as conclusions;
4. avoid duplicating facts already represented in project files/state.

## Turn Close

For a substantial request, persist a compact continuation record when another session is likely to need it. A valid record may contain:
- objective / acceptance state;
- verified completed work;
- important decisions and why;
- unresolved blockers/risks;
- exact next action.

Do not write a mandatory “session memory” entry on every user message.

## Project Lessons

Research/debugging lessons stay in project-local state such as:
- `.forgewright/plan-lessons.md`;
- `.forgewright/execution-lessons.md`;
- decision logs / handoffs.

Legacy `forgewright-lesson-migrator.sh` must **not** mutate framework skills by default. Explicit framework-learning/mutation requires Forgewright itself to be the task scope and a separate reviewed command/flag.

## Failure Handling

If memory/SQLite tooling is missing or fails:
- continue the product task when memory is not an acceptance/safety requirement;
- report the observability/continuity degradation when material;
- never fabricate recovered memory;
- never override an explicit memory-disable setting merely to satisfy middleware ceremony.

If the task explicitly concerns memory infrastructure itself, then memory-tool failure is part of the task and should be verified/debugged normally.
