---
name: goal-driven
description: "Orchestrates hierarchical task decomposition, progress verification gates, adaptive plan refactoring, and execution path alignment. Use when the user requests multi-step autonomous plans, complex project execution roadmaps, or when resolving high-level, ambiguous product objectives."
version: 1.0.0
---

# Goal Driven (LITE)

## SOLVE Step 2: GROUND (Goal Driven Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project-specific tech stack and baseline profile are onboarded | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |
| Standard task list or target execution checklist is initialized | `cat TASKS.md \|\| cat docs/05-operations/tasks.md` | ... | run the check command and paste output |
| Live session execution graph is initialized to monitor progress | `cat .forgewright/offload/canvas.mmd` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Goal Driven Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. DEFINE | Frame the high-level objective and map baseline technology constraints | Verify target environment, budget thresholds, and success criteria match the onboarding profile.
2. DECOMPOSE | Breakdown objective into a sequential checklist of verified subtasks | Ensure each subtask has a clear target file/directory and a concrete command-based verification rule.
3. EXECUTE | Run task implementations sequentially, verifying success at each checkpoint | Verify that intermediate files pass linters, syntax checks, or testing frameworks before proceeding.
4. REFACTOR | Intercept execution bottlenecks and refactor the remaining plan | If a subtask fails twice, trigger the mandatory Research Gate fallback to update local lessons.

## Common Mistakes Checklist
- **Unverified Progress Checkpoints**: Proceeding to downstream planning steps after an intermediate task fails, compounding errors and polluting the workspace.
- **Amorphous Definition of Done**: Specifying subtasks with vague, non-testable descriptions (e.g., "make it work") instead of explicit CLI/assertion verifications.
- **Infinite Loop Brute-Forcing**: Retrying a failing implementation path more than twice without triggering the mandatory Research Gate and updating `.forgewright/lessons.md`.
- **Ignoring Token Caching Thresholds**: Running massive multi-step plan loops without utilizing context offloading, causing immediate token bloat and context memory exhaustion.
- **Sentinel Goal Budget**: Never pass a fake positive budget such as `1` when a Codex Goal bridge requires one. Use objective-only goals when supported; otherwise continue with the normal task plan without creating an app goal.
- **Non-Compliant File Names**: Storing task checklists or planning logs under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `project-roadmap.md`).

### Step 1: Ground the active project scope and baseline status
```bash
cat .forgewright/project-profile.json
```

### Step 2: Initialize a compliant, lowercase kebab-case goal-tracking checklist `docs/05-operations/tasks.md`
```bash
cat << 'EOF' > docs/05-operations/tasks.md
# Project Tasks Checklist

- [x] Ground project scope — Verify technology stacks and tool profiles
- [/] Build service layer — Implement database connection pooling
- [ ] Establish testing harness — Configure Playwright or Vitest test suits
EOF
```

### Step 3: Execute and verify the "Build service layer" subtask
```bash
# Run local build and validation check to enforce the verification gate
npm run build && npm test tests/db-service.spec.ts
```
