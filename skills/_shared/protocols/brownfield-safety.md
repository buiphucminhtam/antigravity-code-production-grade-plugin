---
id: brownfield-safety
title: Brownfield Safety Net Protocol
summary: Core protocol for brownfield safety.
status: deprecated
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Brownfield Safety Net Protocol

**Protects existing projects from unintended changes. Creates safety layers including git branching, baseline snapshots, change tracking, and rollback capability.**

## When to Activate

- **Always** when `project-profile.json` indicates brownfield (fingerprint has real values)
- **Always** when codebase-context.md mode is `brownfield`
- **Skip** for greenfield projects (no existing code to protect)
- **Configurable** via `.production-grade.yaml`:

```yaml
brownfield:
  auto_branch: true          # create session branch automatically
  baseline_tests: true       # run existing tests before pipeline
  protected_paths: []        # additional paths to protect
  change_manifest: true      # track all file changes
  rollback_on_regression: true  # auto-revert if existing tests break
```

## Pre-Pipeline Safety (runs BEFORE any skill execution)

### Step 1 — Git Branch Creation

```
IF auto_branch is true AND git repository exists:
  1. Ensure working tree is clean:
     git status --porcelain
     IF dirty → WARN user: "Uncommitted changes detected — commit or stash first?"
       1. **Auto-stash and continue (Recommended)**
       2. **Continue without stash** — changes may be mixed with pipeline output
       3. **Cancel** — I'll handle it manually

  2. Create session branch:
     git checkout -b forgewright/session-{YYYYMMDD-HHmm}
     Log: "✓ Working on branch: forgewright/session-{YYYYMMDD-HHmm}"

  3. Record branch info in session-log.json

ELSE:
  Log: "⚠ Git branching disabled — changes go directly to current branch"
  WARN: "No rollback capability without git branching"
```

### Step 2 — Baseline Snapshot

```
1. Run existing tests:
   - Detect test command from project-profile.json
   - Execute: capture pass/fail count, test names
   - Save to .forgewright/baseline-{session}.json:
     {
       "session_id": "...",
       "created_at": "ISO-8601",
       "git_branch": "forgewright/session-...",
       "git_commit": "abc123",
       "tests": {
         "total": 142,
         "passed": 140,
         "failed": 2,
         "skipped": 0,
         "pass_rate": 0.986,
         "failed_test_names": ["test_flaky_payment", "test_deprecated_api"]
       },
       "build": {
         "status": "success",
         "command": "npm run build",
         "duration_ms": 12340
       },
       "dependencies": {
         "count": 87,
         "lock_hash": "sha256:abc..."
       }
     }

2. If tests fail in baseline:
   - Record which tests already fail (known failures)
   - These tests are EXCLUDED from regression detection
   - Log: "⚠ Baseline has [N] failing tests — these are excluded from regression checks"
```

### Step 3 — Protected Path Registry

```
1. Read from project-profile.json → risk.protected_paths
2. Read from .production-grade.yaml → brownfield.protected_paths
3. Merge and deduplicate
4. Add defaults:
   - .env, .env.*, .env.local, .env.production
   - *.key, *.pem, *.cert
   - credentials/, secrets/
   - prisma/migrations/ (existing migrations, new ones OK)
   - scripts/ci/ (canonical local automation — extend carefully, do not replace blindly)
   - hosted-provider CI configs when present (optional adapters — preserve existing project choices)
5. Write combined list to session context
6. Log: "✓ Protected [N] path patterns from modification"
```

## During Pipeline — Continuous Safety Checks

### Regression Check Points

Run regression checks at these points:

| After | Check | Action on Regression |
|-------|-------|---------------------|
| T3a (Backend) | Run backend tests | Revert T3a changes, retry with constraint |
| T3b (Frontend) | Run frontend tests | Revert T3b changes, retry with constraint |
| T3c (Mobile) | Run mobile tests | Revert T3c, continue without mobile |
| T5 (QA - new tests) | Run ALL tests (old + new) | Fix new test conflicts |
| T8 (Remediation) | Run ALL tests | Verify fixes don't break other things |
| Pre-Gate 3 | Full regression suite | Must pass before shipping |

**Regression check procedure:**
```
1. Run test suite
2. Parse results
3. Compare with baseline:
   - New failures (not in baseline.failed_test_names) → REGRESSION
   - Same failures as baseline → KNOWN, OK
   - Fewer failures than baseline → IMPROVEMENT, OK
4. If REGRESSION detected:
   IF rollback_on_regression is true:
     git stash (save current changes)
     Notify skill to re-implement with constraint: "Do not modify [affected files]"
     Retry (max 2 times)
   ELSE:
     WARN user via quality gate
```

### Change Manifest Tracking

Track every file operation during the pipeline:

```json
// .forgewright/change-manifest-{session}.json
{
  "session_id": "session-20260314-1324",
  "changes": [
    {
      "task_id": "T3a",
      "skill": "software-engineer",
      "timestamp": "ISO-8601",
      "operation": "create",
      "path": "services/auth/src/handler.ts",
      "size_bytes": 2340
    },
    {
      "task_id": "T3b",
      "skill": "frontend-engineer",
      "timestamp": "ISO-8601",
      "operation": "modify",
      "path": "frontend/src/components/Header.tsx",
      "original_hash": "sha256:abc...",
      "new_hash": "sha256:def..."
    }
  ],
  "summary": {
    "files_created": 24,
    "files_modified": 8,
    "files_deleted": 0,
    "total_changes": 32
  }
}
```

### Protected Path Enforcement

Before ANY file write by ANY skill:

```
1. Check if target path matches any protected pattern
2. IF match:
   a. IF operation is CREATE and path is in "add-ok" zone (e.g., new migration file):
      → ALLOW (creating alongside existing is OK)
   b. IF operation is MODIFY:
      → BLOCK
      → Log: "BLOCKED: [skill] attempted to modify protected path [path]"
      → Notify skill to find alternative approach
   c. IF operation is DELETE:
      → BLOCK + ESCALATE to user
      → Log: "BLOCKED + ESCALATED: [skill] attempted to delete protected path [path]"
```

## Post-Pipeline Safety

### Merge Readiness Assessment

Before offering to merge session branch back to main:

```
Assessment Checklist:
  1. [ ] Full test suite passes (all tests, not just new ones)
  2. [ ] No regression from baseline (pass_count >= baseline_pass_count, excluding known failures)
  3. [ ] All protected paths intact (diff shows no changes to protected paths)
  4. [ ] Quality score >= minimum threshold (from quality-gate.md)
  5. [ ] Change manifest reviewed (no unexpected file operations)
  6. [ ] Build succeeds on full project

IF all pass:
  → Ready to merge
  → Present at Gate 3 or pipeline completion:
    "Session branch is ready to merge. [N] files changed, all tests pass."
    1. **Merge to [main] (Recommended)** — merge and clean up session branch
    2. **Create Pull Request** — push branch for code review
    3. **Keep branch** — review changes manually first
    4. **Chat about this** — discuss the changes

IF any fail:
  → Show specific failures
  → Offer remediation or manual review
```

### Rollback Procedure

If issues are found post-pipeline:

```
1. Targeted rollback (preferred):
   - Read change-manifest → identify files from problematic task
   - git checkout main -- [list of files affected by that task]
   - Re-run tests to verify rollback worked

2. Full session rollback:
   - git checkout main
   - Session branch preserved for reference
   - Log: "Rolled back to pre-pipeline state. Session branch: forgewright/session-..."

3. Session branch cleanup:
   - Auto-delete after 7 days (configurable)
   - Or on explicit user command
   - Always preserve if errors occurred (for debugging)
```

## Greenfield Bypass

For greenfield projects, this entire protocol is skipped:
- No baseline to snapshot (no existing tests)
- No protected paths (no existing code)
- No regression checks (nothing to regress against)
- Git branching still recommended but optional

The quality-gate protocol still runs in full for greenfield — it just skips Level 2 (Regression).
