---
id: self-healing-execution
title: Self-Healing Execution Protocol (Autonomous Sandbox)
summary: Core protocol for self healing execution.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Self-Healing Execution Protocol

> **Purpose:** Resolve bounded execution failures autonomously while preserving
> user work, the kernel Stuck rule, and explicit guardrails.

## When to Apply
When an execution skill observes a relevant command failure that it can safely
diagnose inside the authorized workspace.

## The Self-Healing Loop

Do not ask the user to run commands the agent can safely run. Do not create an
unrequested checkpoint commit. Capture the initial status/diff and follow this
loop at most twice for the same step, as required by `kernel/SOLVE.md`:

1. **Read the Error:** Capture the stderr/stdout from the terminal execution. Use tools to read logs if they are long.
2. **Ground Locally First:** inspect current code, configuration, dependencies,
   and a working project example. Browse authoritative sources only when a
   decision-changing knowledge gap remains.
3. **Analyze the Root Cause:** identify whether it is:
   - A missing dependency (e.g., `Module not found`, `ImportError`).
   - A syntax/type error (e.g., `TS2322`, `SyntaxError`).
   - A configuration mismatch (e.g., `wrong Node version`, `missing environment variable`).
   - A behavioral test failure against a known requirement/acceptance criterion.
3. **Formulate a Fix:**
   - If missing dependency: run `npm install <package>`, `pip install <package>`, etc.
   - If code error: patch production/source code that violates the established requirement.
   - If config issue: create or modify the necessary config files (e.g., `.env`, `tsconfig.json`).
   - If a behavioral test fails and the requirement is clear: keep the test oracle read-only and fix the implementation.
   - If the requirement is missing, ambiguous, or contradicts the test: stop that healing branch, mark it blocked, and ask the user/product owner. Do not autonomously rewrite the assertion/expected output.
   - A behavioral test case may change only after an explicit current requirement change is established. Test-runner/setup plumbing may be repaired only when expected behavior and coverage are unchanged.
4. **Retry Execution:** Run the exact same command that failed originally.
5. **Verify:** If the exact command succeeds, proceed. If the same step fails
   twice, stop retrying and follow the kernel Stuck/escalation protocol.

## Rules of Engagement

- **Preserve user work:** never use `git reset --hard`, broad checkout/restore,
  stash, clean, or an unrequested commit as an automatic recovery mechanism.
  Restore only files deliberately mutated by the current controlled check and
  prove unrelated status/diff is unchanged.
- **Transparent blocker:** report the bounded evidence-backed blocker when safe
  autonomous progress is no longer possible; do not hide material diagnostics.
- **Test-oracle integrity:** never turn a red behavioral test green by weakening,
  skipping, deleting, regenerating, or rewriting its expected result unless an
  explicit current requirement/acceptance change authorizes that mutation.
- **Isolation when available:** use an authorized worktree or temporary fixture
  for destructive experiments, but do not assume one exists.
