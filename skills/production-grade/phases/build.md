# BUILD Phase — Dispatcher

This phase manages tasks T3a (Backend), T3b (Frontend), T3c (Mobile, conditional), and T4 (DevOps Containerization). Supports both **parallel** and **sequential** execution.

## Pre-Flight

Every BUILD lane receives the approved `PIPELINE_CONTEXT` plus its upstream specialist artifacts. BUILD skills implement inside those contracts; they do not recreate generic consulting, hidden-risk, research, or visual-basis gates. Newly discovered cross-domain facts return as `DOMAIN_FINDING` to the control plane.

Read `.production-grade.yaml` to determine:
- `features.frontend` → if false, skip T3b
- `features.mobile` → if false, skip T3c (also skip if BRD has no mobile requirements)
- `project.architecture` → monolith vs microservices (affects containerization)
- `paths.services`, `paths.frontend`, `paths.mobile`, `paths.shared_libs` → output locations

Read `.forgewright/settings.md` to determine execution mode.

## Execution Mode Check

**If `Execution: parallel`:**

Read `skills/parallel-dispatch/SKILL.md` and follow its instructions for Group A (BUILD):

```
1. Generate Task Contracts for T3a, T3b, T3c (based on skip conditions)
2. Create git worktrees via scripts/worktree-manager.sh
3. Dispatch workers (one Gemini CLI instance per worktree)
4. Collect DELIVERY.json from each worker
5. Validate via task-validator protocol
6. Merge via merge-arbiter protocol
7. After merge: execute T4 (DevOps) sequentially (depends on T3a output)
```

Contract inputs for each task are defined in parallel-dispatch/SKILL.md § Phase 2.

**After parallel merge completes**, continue to T4 below, then to Completion section.

**If `Execution: sequential`** (or setting not found):

Execute tasks in order: T3a → T3b → T3c → T4 as described below.

---

## Sequential Execution (or T4 after parallel merge)

## T3a: Backend Engineering

Execute backend implementation:

```
Update task.md: T3a status → in_progress

Read skills/software-engineer/SKILL.md and follow its instructions.
Context:
- Read architecture from: api/, schemas/, docs/architecture/
- Consume `PIPELINE_CONTEXT` for accepted scope, constraints/non-goals, risk ownership and verified facts.
- Read .production-grade.yaml for paths and preferences.
- Write services to project root: services/, libs/shared/
- Write workspace artifacts to: .forgewright/software-engineer/
- TDD enforced: write test → watch fail → implement → watch pass → refactor.

Update task.md: T3a status → completed
```

## T3b: Frontend Engineering (skip if features.frontend is false)

Execute frontend implementation:

```
Update task.md: T3b status → in_progress

Read skills/frontend-engineer/SKILL.md and follow its instructions.
Context:
- Read API contracts from: api/
- Read BRD user stories from: .forgewright/product-manager/BRD/
- Read design specs from: .forgewright/ui-designer/ (if T1.5 ran)
- Read design tokens from: docs/design/design-tokens.json (if T1.5 ran)
- Consume `PIPELINE_CONTEXT`, especially `visual_basis`, constraints/non-goals and owned risk signals.
- Frontend implements the approved UI contract; it does not invent or rerun the visual direction gate.
- Read .production-grade.yaml for framework and styling preferences.
- Write frontend to project root: frontend/
- Write workspace artifacts to: .forgewright/frontend-engineer/

Update task.md: T3b status → completed
```

## T3c: Mobile Engineering (Conditional — skip if no mobile requirements)

**Activation:** Runs only if:
1. BRD explicitly mentions mobile app, iOS, Android, or mobile-first requirements
2. `features.mobile` is true in `.production-grade.yaml`
3. User explicitly requested mobile development

Execute mobile implementation:

```
Update task.md: T3c status → in_progress

Read skills/mobile-engineer/SKILL.md and follow its instructions.
Context:
- Read API contracts from: api/
- Read BRD user stories from: .forgewright/product-manager/BRD/
- Read design specs from: .forgewright/ui-designer/ (if T1.5 ran)
- Read design tokens from: docs/design/design-tokens.json (if T1.5 ran)
- Consume `PIPELINE_CONTEXT`, especially target platform, visual basis, constraints/non-goals and owned risk signals.
- Read .production-grade.yaml for mobile framework and preferences.
- Write mobile to project root: mobile/
- Write workspace artifacts to: .forgewright/mobile-engineer/

Update task.md: T3c status → completed
```

## T4: DevOps Containerization

Execute containerization after backend is done:

```
Update task.md: T4 status → in_progress

Read skills/devops/SKILL.md and follow its instructions.
Context:
- Read services from: services/
- Read architecture from: docs/architecture/
- Consume `PIPELINE_CONTEXT` for release/operations constraints and assigned risk signals.
- Read .production-grade.yaml for paths and preferences.
- Write Dockerfiles per service, docker-compose.yml at project root.
- Write workspace artifacts to: .forgewright/devops/containers/
- Validate: docker build succeeds for each service, docker-compose up starts all.

Update task.md: T4 status → completed
```

## Quality Gate & Regression Checks

After EACH build task (T3a, T3b, T3c, T4), run domain verification then the pipeline-owned Universal Quality Gate + OperatingAudit (`quality-gate.md`, `pipeline-operating-contract.md`):

1. **Per-skill quality gate** — verify build, regression, standards, traceability
2. **Brownfield regression check** — if brownfield project:
   - Run existing test suite
   - Compare with baseline from `.forgewright/baseline-{session}.json`
   - If any previously-passing test now fails → REGRESSION → skill must fix before proceeding
3. **Change manifest update** — log all file operations to `.forgewright/change-manifest-{session}.json`
4. **Session lifecycle hook** — call `TASK_COMPLETE(task_id, name, status, summary)`

Display mini-scorecard after each task:
```
┌─ Quality Gate: T3a Backend ──────────┐
│ Build: ✓ | Regression: ✓ | Score: 92 │
└──────────────────────────────────────┘
```

## Completion

When all BUILD tasks complete:
1. Verify all services compile and start
2. Verify docker-compose brings up the full stack
3. If T3c ran, verify mobile project builds for both platforms
4. **Run aggregate quality check** — display BUILD phase quality summary
5. **Call session lifecycle hook** — `PHASE_COMPLETE("BUILD", summary)`
   - **Memory save:** `python3 scripts/mem0-cli.py add "BUILD complete: [tasks done]. Services: [list]. Tests: [count] pass" --category tasks`
6. **Brownfield: full regression suite** — verify ALL existing tests still pass
7. Log BUILD completion to workspace
8. Read `phases/harden.md` and begin HARDEN phase

## Failure Handling

- Build failure after 3 retries → escalate to user via notify_user
- **Self-healing loop** (up to 5 attempts): read error → web search (site filter) → analyze root cause → formulate fix → retry. After 5 failures: git rollback + escrow report. See `skills/_shared/protocols/self-healing-execution.md`
- Frontend fails but backend succeeds → continue backend-only pipeline
- Mobile fails but web succeeds → continue web-only pipeline, flag mobile issues
- Self-debug: read errors, fix, retry before escalating
- **Regression detected** → revert task changes, retry with constraints (brownfield-safety.md)
- **Quality score below threshold** → pause, show scorecard, ask user to continue or fix
