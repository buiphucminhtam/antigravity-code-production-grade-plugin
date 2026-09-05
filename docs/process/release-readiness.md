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

### Dependency security baseline — 2026-09-05

The root workspace and standalone MCP package pin `fast-uri` to `3.1.7` and `qs` to `6.16.0`, with matching registry integrity values in both lockfiles. These updates address the upstream URI authority/host-confusion and query-string denial-of-service advisories; no runtime contract, test oracle, or audit threshold is relaxed. Run `npm run ci:security` against the selected release tree, then replay the affected MCP/CLI and real-browser checks after a clean dependency install. A source merge with passing local checks does not complete PF6/PF7 or enable production activation.

Upstream advisories: [fast-uri authority validation](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3), [fast-uri security releases](https://github.com/fastify/fast-uri/releases), and [qs denial of service](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g).

**PF2 replay-quality repair:** the initial full precommit run on 2026-09-05 reported one PF2 serialization/recovery failure inside the 33-deliverable roadmap replay. Its historical scheduler state was not recorded. A controlled 80 ms host pause before the fake adapter registers its 2 ms sleep reproduces the same PASS assertion failure against the unchanged 50 ms operation deadline. The fixture now holds the first reset with an explicit started/release barrier, checks that the second coordinator cannot enter while it is held, and retains the prior serialization, monotonic sequence, rejection and recovery assertions. The same reproduction command and all 64 PF2 adapter tests pass after this fixture-only repair. Production source and deadlines are unchanged; real timeout/quarantine tests remain required. Preserve the historical failure evidence, require a broken-serialization mutation to fail, and replay the full release gates before source integration. This closes the demonstrated wall-clock fixture race, not an unobserved reconstruction of the original scheduler state.

## 5. Rollback and Recovery
- [ ] Rollback plan is documented and tested (e.g., ability to revert to previous stable tag seamlessly).
- [ ] Failure policies are communicated and mitigation steps are ready.

## Approval
The release is complete only when evidence is linked for every item and unresolved gaps (if any) have tracked owners and remediation plans.
