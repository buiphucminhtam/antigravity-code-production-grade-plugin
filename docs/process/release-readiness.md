# Release Readiness Checklist

**Version:** [e.g., 1.2.0]
**Date:** [YYYY-MM-DD]
**Approver:** [Name]
**Evidence Links:** [PR/CI links]

Before any stable release is published, the following criteria must be met and checked off. All evidence of passing checks must be linked.

## 1. Truth and Consistency
- [ ] Version truth across package files (`package.json`), documentation (`README.md`, `CHANGELOG.md`), and generated rule files.
- [ ] Generated catalog freshness: Protocol and script catalogs are fully up-to-date and pass drift checks in CI.

## 2. Installation and Portability
- [ ] Clean-install tests succeed from a new, relocated path (no machine-specific absolute dependency paths).
- [ ] MCP package starts successfully in a clean, relocated environment.
- [ ] The installed Stop bundle contains adjacent `stop-gate.sh`, `stop_gate.py`, `verify_gate.py`, `evidence_common.py`, `continuity_check.py`, and `windows_secure_io.py`; doctor repair restores missing or drifted members.
- [ ] An actual installed Stop entrypoint smoke succeeds on every claimed OS/interpreter; configuration-schema checks alone are insufficient. Claimed Windows support requires observed Git Bash plus native Windows Python 3.11+ evidence from the release tree.
- [ ] Native hooks run from both the repository root and a nested working directory; Unicode transport and immutable baseline digests survive the checkout unchanged.
- [ ] CI uses each component's lint/format configuration and exposes resolved Git Bash to Windows child verifiers without changing the host's global PATH.
- [ ] MCP test execution uses at most two isolated fork workers on shared native hosts. Operation-timeout tests wait for actual operation startup, not a single microtask; runtime deadlines and storage-uncertainty checks remain unchanged.
- [ ] Node-based npm invocations use the native Node executable plus npm's JavaScript entrypoint on Windows, preserving literal argv without batch-shell reinterpretation. Test builds must use this same path.
- [ ] MCP formatting accepts consistent host LF/CRLF line endings, but still rejects other formatting drift. POSIX executable hooks retain explicit LF through Git attributes; immutable digest-bound inputs remain byte-preserved.
- [ ] Git maintenance hooks retain LF and an explicit interpreter. Pulling or switching a branch only writes project-local maintenance markers; it never implicitly updates shared MCP runtimes, submodules, or another project.
- [ ] Pre-commit test fixtures do not inherit the parent repository's Git context or temporary partial-commit index. The actual staging/Docs gates still validate the selected commit index.
- [ ] File-symlink security cases report an explicit capability skip only after native Windows rejects creation with EPERM; normal bounded-input, atomic-output and CLI-validation cases still execute. A normal-user run cannot certify privileged file-symlink behavior.

Run `npm run verify:platform -- --browser --report .forgewright/reports/native-platform.json` on each claimed host after installing the declared project-local dependencies. It executes native hook/evidence tests, Product Factory conformance, MCP tests/lint/format, CLI tests, and the actual-browser reference. Keep each host report separate. A passing native-platform report has `production_eligible: false`: source synchronization for testing does not replace independent release review, trusted production evidence, or owner activation authority.

## 3. Documentation and Experience
- [ ] README quick-start smoke test runs successfully from a clean clone.
- [ ] Documentation link checks pass (no broken links).
- [ ] Architecture visual checks and responsive/accessibility requirements pass (HTML+CSS-only diagrams render correctly at all required viewports).

## 4. Automation and Security
- [ ] Security scanner working-tree integration tests and glob expansion tests pass.
- [ ] Security and dependency review completed with no P0/P1 findings.
- [ ] Script compatibility-shim status is documented (no breaking removals without deprecation warnings).

## 5. Rollback and Recovery
- [ ] Rollback plan is documented and tested (e.g., ability to revert to previous stable tag seamlessly).
- [ ] Failure policies are communicated and mitigation steps are ready.

## Approval
The release is complete only when evidence is linked for every item and unresolved gaps (if any) have tracked owners and remediation plans.
