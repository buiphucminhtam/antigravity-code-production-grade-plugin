# VERIFY Block Contract

A `VERIFY` block is required before any claim of success.

## Template 1: Standard Command / Test Check
Use this for unit/integration/E2E test runs, compiler output, or command exit code checks.
```text
CLAIM: <what you claim now works>
COMMAND: <the exact command you ran to check/test>
OUTPUT: <pasted stdout/stderr, last lines>
EXIT CODE: <number>
VERDICT: PASS | FAIL
```

## Template 2: UI / Visual Verification
Use this for frontend, HTML/CSS, or user interface modifications. A successful build alone must not prove responsiveness.
```text
CLAIM: <what layout/DOM changes were made>
DOM CHECK COMMAND: <command or Chrome DevTools query to verify elements exist>
DOM OUTPUT: <pasted DOM query result/HTML snippet>
EVIDENCE:
- Project breakpoints/fallback viewports tested: <details>
- Horizontal overflow checked: <details>
- Content wrapping and hierarchy verified: <details>
- Keyboard/focus behavior verified: <details>
- Component states (loading, empty, error, disabled) verified: <details>
- Token/design-system conformance verified: <details>
- Screenshots/VRT results: <details>
VISUAL VERDICT: STRUCTURALLY VERIFIED (requires user visual confirmation)
```

## Template 3: Program-of-Thought (PoT) Script Verification
Use this when verifying math, complex logic, or algorithms in isolation.
```text
CLAIM: <what algorithm or logic was verified>
POT SCRIPT PATH: <path to temporary verification script>
RUN COMMAND: <command to run the script>
OUTPUT: <pasted output showing correctness of calculations>
EXIT CODE: <number>
VERDICT: PASS | FAIL
```

## Template 4: Runtime Ledger
Use this whenever the task started anything long-running — a dev server, game editor, emulator, watcher, container. A leaked process is invisible in every other template: the tests pass, the build is green, and RAM keeps climbing.
```text
RUNTIME LEDGER
OPENED:  <lease_id> role=<..> port=<..> pid=<..>
CLOSED:  <lease_id> exit=<..>
LEAKED:  none | <lease_id list>
COMMAND: bash scripts/runtime/runtime-lease.sh status
OUTPUT:  <pasted status output>
VERDICT: CLEAN | LEAKED
```
Rules for this block:
- Start long-running processes with `bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an already-running instance instead of starting a second one, and registers a lease so the process can be reclaimed.
- `LEAKED` is only acceptable when the lease is deliberately `policy=keep`; say why.
- A process you started with no lease at all is a `LEAKED` verdict, not an exemption.

## Rules
1. A claim of success without a pasted `OUTPUT` and `EXIT CODE` / `DOM OUTPUT` is automatically FALSE.
2. For UI/visual changes: cap confidence at "structurally verified" and ask the user to confirm the actual visual appearance.
3. Provide exactly one block per changed behavior.
4. `FAIL` verdicts must be reported immediately and never hidden.
5. VERIFY proves code works. [AUDIT.md](AUDIT.md) proves all requirements are covered. Both are mandatory.
6. Narrative claims ("I updated the file", "this should work now") without a VERIFY block are automatically FALSE. The check must be a runnable command whose output you paste.
7. Prefer deterministic checks (test suites, linters, build exit codes) over manual inspection. If no automated check exists, create one before claiming success.
8. If the task started any long-running process, emit Template 4 as well. "The tests passed" is not evidence that the machine was left clean.

