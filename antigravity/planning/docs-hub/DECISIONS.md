# Architecture Decisions: Forgewright Docs Hub

## D-001 — Source documents remain authoritative

**Status:** Accepted
**Date:** 2026-08-10

Generated HTML, catalogs, search indexes, and diagrams are build outputs. The
portal does not become an editor or second source of truth.

## D-002 — Privacy defaults to allowlist

**Status:** Accepted
**Date:** 2026-08-10

Only manifest-approved documentation roots and safe metadata are scanned.
Credential-like paths, raw execution logs, memory databases, and arbitrary
artifact trees remain excluded unless explicitly authorized.

## D-003 — Legacy projects do not require immediate migration

**Status:** Accepted
**Date:** 2026-08-10

The scanner supports `Docs/`, `docs/`, `documentation/`, `wiki/`, and root
README files. Missing frontmatter produces diagnostics rather than blocking the
MVP build.

## D-004 — Static HTML/CSS is the primary presentation output

**Status:** Accepted
**Date:** 2026-08-10

Core navigation and content must work without a long-running backend and remain
readable when client-side JavaScript is disabled.

## D-005 — JSON is the initial normalized store

**Status:** Accepted
**Date:** 2026-08-10

A database is deferred until measurements show JSON scanning/building is a
material bottleneck.

## D-006 — GitNexus remains code-graph authority

**Status:** Accepted
**Date:** 2026-08-10

Docs Hub imports bounded references and health state; it does not duplicate the
GitNexus graph database or infer unsupported code relationships.

## D-007 — Codex tasks do not use sentinel goal budgets

**Status:** Accepted
**Date:** 2026-08-10

Use objective-only Codex goals when the runtime supports an unset/null token
budget. If the bridge requires a positive budget, continue with the normal task
plan and do not create an app goal.
