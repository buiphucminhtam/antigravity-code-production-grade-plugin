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
