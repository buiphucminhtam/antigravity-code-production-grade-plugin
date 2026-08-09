# HARDEN Phase — Dispatcher

This phase manages tasks T5 (QA), T6a (Security), T6b (Code Review). Supports both **parallel** and **sequential** execution with strict authority boundaries.

## Pipeline HARDEN Contract

HARDEN consumes the same `PIPELINE_CONTEXT` used during DEFINE/BUILD. The control plane owns acceptance coverage, cross-domain risk closure, adversarial audit, and visual conformance; QA/Security/Code Review each provide deep domain evidence inside their authority.

## Authority Boundaries — CRITICAL

Enforce these boundaries strictly:
- **security-engineer** is SOLE authority on OWASP Top 10, STRIDE, PII, encryption
- **code-reviewer** does architecture conformance, code quality, performance — does NOT perform security review
- **code-reviewer** is READ-ONLY — produces findings and patch files, does NOT modify source code
- See `skills/_shared/protocols/conflict-resolution.md` for full authority table

## Execution Mode Check

Read `.forgewright/settings.md` to determine execution mode.

**If `Execution: parallel`:**

Read `skills/parallel-dispatch/SKILL.md` and follow its instructions for Group B (HARDEN):

```
1. Generate Task Contracts for T5, T6a, T6b
   — CRITICAL: T6a contract MUST include "SOLE OWASP authority" in constraints
   — CRITICAL: T6b contract MUST include "NO security review, READ-ONLY" in constraints
2. Create git worktrees via scripts/worktree-manager.sh
3. Dispatch workers (one per worktree)
4. Collect DELIVERY.json from each worker
5. Validate via task-validator protocol (extra checks: authority boundary violations)
6. Merge findings (workspace artifacts only — no code modifications)
```

**Authority boundaries apply even in parallel mode.** Each worker's CONTRACT.json explicitly restricts their scope. If a worker produces security findings but is NOT security-engineer, the findings are rejected.

**After parallel collection completes**, continue to Post-HARDEN: Remediation Preparation.

**If `Execution: sequential`** (or setting not found):

Execute tasks in order: T5 → T6a → T6b as described below.

---

## Sequential Execution

## T5: QA Testing

```
Update task.md: T5 status → in_progress

Read skills/qa-engineer/SKILL.md and follow its instructions.
Context:
- Read implementation: services/, frontend/ (if exists), api/
- Consume `PIPELINE_CONTEXT` acceptance, regression surfaces and owned risk signals.
- Read .production-grade.yaml for paths.tests and paths.services.
- Write tests to project root: tests/
- Write workspace artifacts to: .forgewright/qa-engineer/
- Run integration, e2e, and performance tests.
- Distinguish test bugs (fix immediately) from implementation bugs (log as findings).

Update task.md: T5 status → completed
```

## T6a: Security Audit (SOLE OWASP AUTHORITY)

```
Update task.md: T6a status → in_progress

Read skills/security-engineer/SKILL.md and follow its instructions.
Context:
- Security Engineer is the authority for formal OWASP/STRIDE/PII/encryption/agentic-security findings, exploitability assessment and remediation depth.
- Consume security `risk_signals` and affected trust boundaries from `PIPELINE_CONTEXT`; discover additional security threats using the security skill's own reconnaissance/threat-model methods.
- Read all implementation code: services/, frontend/, infrastructure/
- Perform STRIDE threat modeling + OWASP Top 10 audit + business-logic/agentic trust-boundary analysis + applicable dependency scan.
- Write findings to: .forgewright/security-engineer/
- Auto-fix Critical/High issues with regression tests.
- Document Medium/Low for remediation plan.

Update task.md: T6a status → completed
```

## T6b: Code Review (NO OWASP — architecture + quality only)

```
Update task.md: T6b status → in_progress

Read skills/code-reviewer/SKILL.md and follow its instructions.
Context:
- Architecture conformance and code quality ONLY.
- DO NOT perform OWASP, STRIDE, or any security review — security-engineer is sole authority.
- Cross-reference: "See security-engineer findings for security context."
- Read architecture: docs/architecture/, api/
- Read implementation: services/, frontend/
- Consume `PIPELINE_CONTEXT` for acceptance/non-goals and affected architecture boundaries.
- Review: SOLID/DRY/KISS, performance, N+1 queries, resource leaks, test quality.
- Write findings to: .forgewright/code-reviewer/
- READ-ONLY: produce findings only, do NOT modify source code.

Update task.md: T6b status → completed
```

## Quality Gate per HARDEN Task

After EACH harden task (T5, T6a, T6b), run the Universal Quality Gate Protocol (`skills/_shared/protocols/quality-gate.md`):

1. **Per-skill quality gate** — validate findings structure, workspace artifacts, authority compliance
2. **Session lifecycle hook** — call `TASK_COMPLETE(task_id, name, status, summary)`
3. **Display mini-scorecard** per task

## Post-HARDEN: Remediation Preparation

After all HARDEN tasks complete:
1. Collect all findings from T5, T6a, T6b workspace folders
2. Run pipeline OperatingAudit: reconcile findings against `PIPELINE_CONTEXT.risk_signals`, visual conformance (when applicable), acceptance coverage, contradictions and cross-entry consistency; newly discovered cross-domain issues must have an owner
3. Deduplicate by file:line — keep highest severity rating
4. Filter Critical/High severity findings
5. If any Critical/High exist → T8 (Remediation in SHIP phase) receives the findings list
6. Medium/Low → documented according to project risk policy; unresolved blocking pipeline risk signals still block regardless of aggregate score
7. **Run aggregate quality scoring** — compute HARDEN phase quality score
8. **Call session lifecycle hook** — `PHASE_COMPLETE("HARDEN", summary)`
   - **Memory save:** `python3 scripts/mem0-cli.py add "HARDEN complete: [N] tests, [M] security findings ([X] auto-fixed). Quality: [score]/100" --category tasks`
9. **Update quality metrics** — write to `.forgewright/quality-metrics.json`
10. Print HARDEN summary:
```
━━━ HARDEN Summary ━━━━━━━━━━━━━━━━━━━━━━
✓ QA: [N] tests passed, [M] findings
✓ Security: [N] findings ([M] Critical/High auto-fixed)
✓ Code Review: [N] findings
Remediation needed: [X] Critical/High items
Quality Score: [XX]/100 (Grade [A-F])
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

11. **Brownfield merge readiness check** (if brownfield project):
    - Read `skills/_shared/protocols/brownfield-safety.md` → merge readiness assessment
    - Verify full regression suite passes
    - Verify all protected paths intact
    - Verify quality score ≥ threshold
    - If not ready → flag issues before proceeding to SHIP

## Handoff to SHIP

Read `phases/ship.md` and begin SHIP phase.
