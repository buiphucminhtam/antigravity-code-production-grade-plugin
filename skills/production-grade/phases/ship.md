# SHIP Phase — Dispatcher

This phase manages tasks T7 (DevOps IaC), T8 (Remediation), T9 (SRE), T10 (Data Scientist). Sequential execution with authority boundaries.

SHIP consumes `PIPELINE_CONTEXT` and the HARDEN OperatingAudit. Release cannot bypass unresolved blocking risk signals, compatibility/rollback obligations, or material visual/release acceptance just because an individual specialist reports PASS.

## Authority Boundaries

- **devops** owns infrastructure provisioning, CI/CD, monitoring setup — does NOT define SLOs
- **sre** owns SLO/SLI definitions, error budgets, runbooks, chaos engineering — does NOT provision infrastructure
- See `skills/_shared/protocols/conflict-resolution.md`

## T7: DevOps IaC + CI/CD

```
Update task.md: T7 status → in_progress

Read skills/devops/SKILL.md and follow its instructions.
Context:
- Read architecture: docs/architecture/
- Read implementation: services/, frontend/
- Consume `PIPELINE_CONTEXT` release/operations constraints, non-goals and owned risk signals.
- Read .production-grade.yaml for paths and preferences.
- Generate: Terraform/Pulumi, K8s manifests (if microservices), CI/CD pipelines, monitoring dashboards.
- Write canonical automation to project root: infrastructure/, scripts/ci/, scripts/; hosted-provider adapters only when explicitly requested
- Write workspace artifacts to: .forgewright/devops/
- DO NOT define SLOs — add placeholder: "SLO thresholds defined by SRE."
- DO NOT write runbooks — SRE writes runbooks to docs/runbooks/.
- Validate: terraform validate, pipeline syntax lint.

Update task.md: T7 status → completed
```

## T8: Remediation (fix HARDEN findings)

```
Update task.md: T8 status → in_progress

Context:
- Read HARDEN findings from workspace: .forgewright/security-engineer/, code-reviewer/, qa-engineer/
- Focus on Critical and High severity findings only.
- For each finding:
  1. Read the affected file
  2. Apply the fix
  3. Run affected tests to verify no regressions
  4. Re-scan the affected code
- If findings persist after 2 fix-rescan cycles → document and escalate.
- Medium/Low findings: document but do not block.

Update task.md: T8 status → completed
```

## T9: SRE — Production Readiness (SOLE SLO AUTHORITY)

```
Update task.md: T9 status → in_progress

Read skills/sre/SKILL.md and follow its instructions.
Context:
- SOLE authority on SLO definitions, error budgets, runbooks, capacity planning.
- Read all prior outputs: architecture, implementation, infrastructure, HARDEN findings.
- Consume `PIPELINE_CONTEXT` availability/operations expectations and unresolved production risk signals.
- Perform production readiness review (checklist).
- Define SLIs/SLOs per service, error budgets, burn-rate alerts.
- Design chaos engineering scenarios and game-day playbook.
- Write runbooks to project root: docs/runbooks/
- Write workspace artifacts to: .forgewright/sre/

Update task.md: T9 status → completed
```

## T10: Data Scientist (conditional — auto-detect LLM/ML usage)

Scan imports for: openai, anthropic, langchain, transformers, torch, tensorflow.

**If detected OR features.ai_ml is true:**
```
Update task.md: T10 status → in_progress

Read skills/data-scientist/SKILL.md and follow its instructions.
Context:
- Read implementation for LLM/ML usage patterns (imports, API calls, prompts).
- Consume `PIPELINE_CONTEXT` product metrics/cost/quality constraints and AI-related risk signals.
- Optimize: prompt engineering, token usage, semantic caching, fallback chains.
- Design: A/B testing infrastructure, experiment framework, data pipeline.
- Write workspace artifacts to: .forgewright/data-scientist/

Update task.md: T10 status → completed
```

**If NOT detected AND features.ai_ml is false:**
```
Update task.md: T10 status → completed (skipped — no AI/ML usage detected)
```

## Gate 3 — Production Readiness

After T9 completes, present Gate 3 using the orchestrator's gate pattern.

On approval → read `phases/sustain.md` and begin SUSTAIN phase.
On "Fix issues first" → create additional remediation tasks.
