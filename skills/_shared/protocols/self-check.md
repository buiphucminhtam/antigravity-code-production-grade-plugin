---
id: self-check
title: Self-Check Protocol
summary: Proportional pre-completion checklist grounded in current acceptance and evidence.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [senior-execution-contract, verification, quality-gate, research-gate]
supersedes: []
superseded_by: null
---
# Self-Check Protocol

Before claiming completion, verify the checks that materially apply. A checklist is not permission to manufacture work.

| Check | Senior completion rule |
|---|---|
| Current intent | Latest user instruction is reconciled with current workspace/runtime evidence. |
| Effort/plan | `QUICK` used `ACTION | TARGET | CHECK`; `STANDARD`/`DEEP` passed the applicable threshold. No universal 9/10 rule. |
| Scope | No adjacent feature, infrastructure, research, or documentation was added without requirement/risk/measured benefit. |
| Evidence | Material claims are supported by current deterministic evidence or explicitly marked `UNVERIFIED`. |
| Tests/checks | Run the smallest checks that prove acceptance, plus broader regression/security/release gates when risk warrants them. |
| Audit | Apply `kernel/AUDIT.md` proportionally: QUICK diff + acceptance, STANDARD checklist, and for DEEP use the **AUDIT coverage matrix** plus contradiction/cross-entry checks when applicable. |
| Impact | Existing symbols/contracts were checked for callers/dependents when their blast radius is material. |
| Safety | Guardrail/protected-path/security findings relevant to the change are resolved or blocking. |
| Approval | Human approval exists only where the project/safety/release/preference contract actually requires it. |
| Handoff/memory | Persist a compact handoff/durable memory only for substantial work that another session/role will need. |
| Learning | Useful lessons stay project-local. Shared Forgewright skills are not auto-mutated from session outcomes. |

## Testing Fit

Prefer test-first for bugs, public contracts, and non-trivial behavior with meaningful regression risk. For clear reversible `QUICK` work, an existing deterministic lint/typecheck/build/behavior check may be the correct verifier. Do not create test stubs or Given/When/Then artifacts solely because a template labels the task “complex.”

## Failure / Recovery

If a required verifier fails:
1. keep the exact evidence;
2. apply one evidence-supported correction and re-run the same check when appropriate;
3. after the same step fails twice, stop repeated attempts;
4. use the Research Gate only if a material unknown blocks the next decision;
5. otherwise escalate with verified completed work, blocker, options, and residual risk.

## Session Close

For substantial multi-session work, update the project’s active task/decision/handoff state using the available runtime tools. Do not require memory writes, handover files, or lesson migration for trivial turns. **Never run automatic lesson-to-`SKILL.md` migration as a session-close ritual.**

---

*Completion claims still follow `kernel/VERIFY.md`.*
