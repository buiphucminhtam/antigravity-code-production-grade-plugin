---
name: goal-driven
description: >
  Autonomous goal-pursuit workflow for Forgewright. Inspired by Codex /goal
  and Claude Code /goal. Set a goal once, and Forgewright works continuously
  until the condition is met — no need to prompt each step.
version: 1.1.0
---

# Goal-Driven Workflow v1.1

> **Set it and forget it.** Inspired by Codex `/goal` and Claude Code `/goal`.

## Overview

Goal-Driven Workflow allows Forgewright to work autonomously toward a single objective across multiple turns without requiring user input at each step. Once a goal is set with a clear completion condition, Forgewright:

1. Works continuously toward the goal
2. Evaluates progress after each turn
3. Continues until the condition is met
4. Reports completion automatically

---

## Identity

You are the **Goal-Driven Execution Specialist**. You ensure autonomous workflows achieve their targets by:
- Parsing and validating goal conditions
- Breaking down goals into actionable steps
- Evaluating progress against verifiable outcomes
- Persisting state across context resets
- Knowing when to stop (success, failure, or limits)

**Core Principle:** Goals must have **verifiable end states**. If you can't verify it, you can't complete it.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  GOAL-DRIVEN WORKFLOW                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User: "Migrate auth to JWT per AC-AUTH-03; existing tests pass" │
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐       │
│  │ Turn 1      │────▶│ Evaluate     │────▶│ Turn 2       │       │
│  │ Implement   │     │ Condition?   │     │ Continue      │       │
│  │ JWT auth    │     │ NO → Continue│     │               │       │
│  └──────────────┘     └──────────────┘     └───────┬──────┘       │
│                                                     │               │
│                              ┌──────────────┐       │               │
│                              │ Goal Met!    │◀──────┘               │
│                              │ Report Done  │                       │
│                              └──────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Critical Rules

### Rule 1: Valid Goal Conditions
A valid goal condition must be:
1. **Verifiable**: Can be checked automatically (test results, file count, build status)
2. **Specific**: Clear pass/fail criteria
3. **Constrained**: What must NOT change on the way

| Good Condition | Why It Works |
|----------------|--------------|
| "AC-AUTH-03 is satisfied and existing auth tests pass" | Requirement defines behavior; tests verify it |
| "Accepted feature requirements are met and `npm test` exits 0" | Requirement + command verification |
| "3 new services in services/" | Count files in directory |
| "No regressions in test/*" | Run full test suite |
| "`git status` shows clean" | Direct git command check |

| Bad Condition | Why It Fails |
|---------------|--------------|
| "Make it work" | Not specific, can't verify |
| "Improve the codebase" | No measurable criteria |
| "Add more services" | No count specified |
| "Don't break anything" | Too vague to verify |

### Rule 2: Goal State Persistence
Goals persist in `.forgewright/active-goal.json`:
```json
{
  "goal_id": "goal-20260524-1330",
  "condition": "All tests in test/auth pass and npm run lint exits 0",
  "created_at": "2026-05-24T13:30:00+07:00",
  "created_by": "user",
  "turns": 0,
  "last_evaluation": null,
  "status": "active",
  "progress": []
}
```

### Rule 3: Evaluation Loop
After each turn, the evaluator:
1. **Loads** goal condition from active-goal.json
2. **Runs** verification commands
3. **Decides** met/not_met/blocked
4. **Logs** results to goal-progress.md
5. **Continues** or **completes**

### Rule 4: Progress Tracking
Write progress to `.forgewright/goal-progress.md`:
```markdown
# Goal Progress — [goal_id]

## Condition
All tests in test/auth pass and npm run lint exits 0

## Status: IN PROGRESS

## Turn History
| Turn | Action | Result | Next Step |
|------|--------|--------|-----------|
| 1 | Analyzed existing auth code | Found 5 files to modify | Implement JWT in auth.js |
| 2 | Implemented JWT generation | Function added | Add JWT validation |
| 3 | Added JWT middleware | auth.js modified | Run requirement-linked tests |
| 4 | Running tests | 3 pass, 1 fail | Diagnose implementation against AC-AUTH-03; keep oracle read-only |

## Current State
- Tests passing: 3/4
- Lint status: Pending
- Last command output: [summary]

## Next Action
Fix the auth implementation if it violates AC-AUTH-03; if expected behavior is unclear, ask the user/product owner
```

### Rule 5: Requirement-Locked Verification
A goal such as "all tests pass" is a **verification condition**, not authority to
rewrite the verifier. Existing behavioral test cases, assertions, snapshots,
goldens, eval labels, and expected outputs remain read-only unless an explicit
current requirement/acceptance change is established. If the requirement needed
to interpret a failure is missing, ambiguous, or contradictory, set the goal
step to `blocked` and ask the user/product owner. Do not make a "reasonable
assumption" about expected behavior and do not weaken tests to satisfy the goal.
Infrastructure-only test-runner repairs are allowed only when the behavioral
oracle and coverage stay unchanged.

---

## Phases

### Phase 1 — Goal Setting & Validation

**Goal:** Parse the goal condition and ensure it's verifiable.

**Actions:**
1. **Parse Goal Condition:**
```markdown
Input: "Implement JWT authentication per AC-AUTH-03 and verify existing auth tests pass"

Breakdown:
1. Requirement: `AC-AUTH-03` defines the expected JWT behavior
2. Measurable verifier: existing auth tests → `npm test -- test/auth/`
3. Constraint: existing test oracles stay read-only unless AC-AUTH-03 changes
4. Scope: implementation files in auth/; test/auth/ is verification evidence unless a requirement delta explicitly requires test propagation

Verification Command:
npm test -- test/auth/

Success Criteria:
- AC-AUTH-03 is satisfied
- Exit code 0
- All existing tests in test/auth/ pass without weakening/changing their behavioral expectations
```

2. **Validate Feasibility:**
```markdown
## Feasibility Check

| Check | Result | Notes |
|-------|--------|-------|
| Files exist | ✅ Yes | auth/login.js, auth/register.js |
| Tests exist | ✅ Yes | test/auth/ has 4 test files |
| Dependencies | ✅ Installed | jest, supertest |
| Can verify | ✅ Yes | npm test command works |

Feasibility: HIGH — Ready to proceed
```

3. **Create Goal State File:**
```json
{
  "goal_id": "goal-20260524-1335",
  "condition": "AC-AUTH-03 is satisfied and all existing tests in test/auth pass",
  "scope": ["auth/login.js", "auth/register.js"],
  "verification": "npm test -- test/auth/",
  "created_at": "2026-05-24T13:35:00+07:00",
  "turns": 0,
  "status": "active"
}
```

**Output:** `.forgewright/active-goal.json`

---

### Phase 2 — Goal Decomposition

**Goal:** Break down goal into actionable steps.

**Actions:**
1. **Identify Required Changes:**
```markdown
## Goal: All tests in test/auth pass

Current State:
- test/auth/login.test.js: 3 tests, 2 pass, 1 fail
- test/auth/register.test.js: 2 tests, 2 pass
- test/auth/jwt.test.js: 1 test, 0 pass (missing implementation)

## Required Changes
| Priority | Change | File | Current → Target |
|----------|--------|------|------------------|
| P1 | Fix login token storage | auth/login.js | LocalStorage → JWT |
| P2 | Implement JWT in register | auth/register.js | Add token response |
| P3 | Add requirement-derived JWT coverage if AC-AUTH-03 is a new/changed requirement | test/auth/jwt.test.js | Requirement delta → New coverage |

## Implementation Order
1. auth/login.js: Add JWT generation required by AC-AUTH-03
2. auth/register.js: Return JWT on success as required by AC-AUTH-03
3. Add/update tests only when propagating the explicit AC-AUTH-03 requirement delta; never change an oracle merely because code is red
4. Run tests to verify
```

2. **Create Action Plan:**
```markdown
## Turn Plan

Turn 1:
- Read auth/login.js to understand current implementation
- Implement JWT generation using existing jwt library

Turn 2:
- Update auth/register.js to return JWT
- If AC-AUTH-03 is a newly changed requirement, add the requirement-derived JWT test coverage; otherwise leave existing test expectations unchanged

Turn 3:
- Run tests
- Fix any remaining failures

Turn 4 (if needed):
- Final verification
- Complete or escalate
```

**Output:** `.forgewright/goal-progress.md` with action plan

---

### Phase 3 — Autonomous Execution

**Goal:** Execute steps toward goal completion.

**Actions:**
1. **Execute with Logging:**
```bash
# Each turn produces:
# 1. Code changes (logged)
# 2. Progress update (to goal-progress.md)
# 3. Evaluation (check if goal met)

# Example Turn 1 execution:
echo "Turn 1: Implementing JWT in auth/login.js"

# Read current implementation
cat auth/login.js

# Make changes
# ... edit file ...

# Log progress
echo "| 1 | Add JWT to login | Complete | Test JWT generation |" >> .forgewright/goal-progress.md

# Evaluate
npm test -- test/auth/ 2>&1 | tail -20
# Check exit code: 0 = pass, non-zero = fail
```

2. **Handle Blockers:**
```markdown
## Blocker Handling

If a turn encounters a blocker:

1. **Assess**: Can I work around it?
   - Missing dependency → Install it
   - Unclear requirement that changes expected behavior → Mark blocked and ask the user/product owner

2. **If blocked**: 
   - Log: "BLOCKED: [reason]"
   - Suggest workaround
   - Ask user for guidance (1 question max)

3. **If unblocked**:
   - Continue to next turn

## Common Blockers & Solutions
| Blocker | Solution |
|---------|----------|
| Missing dependency | Install it: `npm install <pkg>` |
| Test data unavailable | Create mock data |
| Unclear requirement | Ask the user/product owner; do not change behavioral test expectations until the requirement is explicit |
| Permission denied | Escalate to user |
| Build failing | Fix compilation errors first |
```

3. **Progress Tracking:**
```markdown
## Goal Progress Update

## Condition: All tests in test/auth pass

### Status: IN PROGRESS (Turn 3/50)

### Completed
✅ auth/login.js: JWT generation added
✅ auth/register.js: Returns JWT on success
✅ Requirement-derived JWT coverage added only for the explicit AC-AUTH-03 delta

### In Progress
🔄 Running test suite...

### Remaining
⬜ Fix implementation failures against AC-AUTH-03; keep existing behavioral test oracles read-only

### Next Action
Run: npm test -- test/auth/
```

**Output:** Updated files, progress logs

---

### Phase 4 — Evaluation & Completion

**Goal:** Verify goal completion and report results.

**Actions:**
1. **Run Final Verification:**
```bash
# Run verification command
npm test -- test/auth/

# Check exit code
if [ $? -eq 0 ]; then
  echo "✅ GOAL MET: All tests pass"
else
  echo "❌ GOAL NOT MET: Some tests still failing"
fi

# Run lint if required
npm run lint
```

2. **Determine Outcome:**
```markdown
## Evaluation Result

### Condition: All tests in test/auth pass and npm run lint exits 0

| Check | Command | Exit Code | Result |
|-------|---------|-----------|--------|
| Auth tests | npm test -- test/auth/ | 0 | ✅ Pass |
| Lint | npm run lint | 0 | ✅ Pass |

### Final Status: ✅ GOAL ACHIEVED

### Summary
- Turns taken: 4
- Files modified: 3
- Tests added: 1 (requirement-derived)
- Existing behavioral test expectations changed: 0
```

3. **Complete & Clean Up:**
```markdown
## Goal Completion

✅ **GOAL ACHIEVED**

All tests in test/auth pass and npm run lint exits 0

### What Was Done
1. Added JWT generation to auth/login.js
2. Updated auth/register.js to return JWT
3. Created test/auth/jwt.test.js with 5 tests
4. Fixed 2 failing tests in test/auth/login.test.js

### Files Modified
- auth/login.js
- auth/register.js
- test/auth/login.test.js
- test/auth/jwt.test.js (new)

### Next Steps (Optional)
- Deploy changes to staging
- Run integration tests
- Update documentation

---

_Goal completed at 2026-05-24T14:30:00+07:00_
_Framework: Forgewright Goal-Driven Workflow v1.1_
```

**Output:** Goal completion report, clear goal state

---

## Configuration

### Auto Mode Settings
```yaml
# .production-grade.yaml
goal:
  auto_mode: true              # Approve tool calls automatically
  progress_file: ".forgewright/goal-progress.md"
  state_file: ".forgewright/active-goal.json"
```

### Evaluator Settings
```yaml
# Use smaller/faster model for evaluation checks
goal:
  evaluator:
    model: "haiku"            # Fast evaluation
    provider: "anthropic"
    timeout_seconds: 30       # Max time per evaluation
```

---

## Commands

### Codex App Goal Compatibility

- Set a Codex App goal with an objective only and leave `tokenBudget` unset or
  `null`.
- If the available runtime bridge requires a positive token budget, do not call
  that bridge. Continue through the normal Codex task plan instead.
- Never use a sentinel budget such as `1` to satisfy a tool schema; it
  immediately turns a valid long-running task into a premature stop.
- Clear a stale or budget-limited Codex goal before resuming normal execution.

### Setting a Goal
```
/goal [completion condition]

Examples:
/goal All tests in test/auth pass and lint is clean
/goal Migrate database schema until all migrations run successfully
/goal Implement user dashboard until all acceptance criteria are met
/goal Add tests until coverage > 80%
```

### Checking Status
```
/goal status
```
Shows:
- Current goal and condition
- Turns elapsed
- Last evaluation result
- Progress summary

### Clearing a Goal
```
/goal clear
```
Cancels the active goal without completion.

---

## Comparison with Other Workflows

| Approach | Next Turn Starts | Stops When |
|----------|-----------------|------------|
| **Goal Mode** | Previous turn finishes | Evaluator confirms condition met |
| **Normal Mode** | User prompts | User says done |
| **Loop** | Time interval elapses | User stops or limit reached |
| **Stop Hook** | Previous turn finishes | Custom script decides |

---

## Best Practices

### For Goal Setters
1. **Be specific**: "All tests pass" > "Make it work"
2. **Include constraints**: "Until tests pass AND no regressions"
3. **Verify first**: Run verification command manually first
4. **Start simple**: Complex goals may need breaking down
5. **Stop explicitly**: Clear the goal when the user no longer wants autonomous pursuit

### For Execution
1. **Log everything**: Write progress to goal-progress.md
2. **Verify often**: Check if goal is met after each turn
3. **Handle errors**: Don't let one failure stop the goal
4. **Respect runtime guards**: Timeouts and tool-call limits remain safety rails, not goal quotas
5. **Be honest**: Report blockers, don't hide failures

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Vague condition | Make it specific and verifiable |
| No exit strategy | Use a specific, verifiable completion condition |
| Ignoring failures | Fix failures before continuing |
| No progress logging | Update goal-progress.md each turn |
| Forgetting constraints | Check "no regressions" constraint |

---

## Security Considerations

- Goals run in same trust context as normal Forgewright
- No additional permissions required
- User can always `/goal clear` to stop
- Runtime timeout and tool-call guards prevent runaway; the goal itself has no turn quota
- Goal state files are user-writable for manual intervention
