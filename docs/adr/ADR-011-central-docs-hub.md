# ADR-011: Central, Local-First Documentation Hub

**Status:** Accepted
**Date:** 2026-08-10

## Context

Forgewright currently has project documentation, a static landing page,
specialized dashboards, GitNexus-generated flow material, and Obsidian/LLM Wiki
sync scripts. These capabilities are useful but fragmented:

- the static server does not compile project Markdown into a coherent portal;
- sync scripts contain machine-specific assumptions;
- project profiles have evolved beyond the minimal CLI-created schema;
- real projects use mixed documentation roots and limited metadata;
- `.forgewright/` can contain large, private execution artifact sets;
- visual tokens and navigation patterns are not shared across surfaces.

## Decision

Build a local-first documentation hub with four boundaries:

1. **Project-owned sources:** Markdown, JSON, ADRs, GDDs, runbooks, and approved
   metadata remain authoritative.
2. **Manifest-aware collection:** a versioned per-project manifest and global
   registry select content without hardcoded workspace roots.
3. **Privacy-safe normalization:** every path is contained within the project
   root and filtered through an allowlist before entering a deterministic JSON
   catalog.
4. **Static presentation:** HTML/CSS, search artifacts, and SVG diagrams are
   generated outputs. Obsidian remains an optional export.

Every project is compatible with manifest schema v1. The optional-compatible
`project_docs` block is required in manifests produced by new initialization:

```json
{
  "project_docs": {
    "schema_version": 1,
    "state": "docs/project-state.json",
    "max_stale_days": 30
  }
}
```

The referenced `project-state.json` is the canonical state for project
structure, roadmap, flows, backlog, and live status. It is project-owned JSON,
not a generated catalog or a renderer cache.

When `forge docs init` finds an existing valid v1 manifest without this block,
it migrates the manifest in place without replacing existing sources and
creates the referenced state only when absent. Read compatibility does not
weaken the mandatory strict gate.

For material changes, continuity is enforced by the executable
`forge docs gate [target]`. The gate accepts `--staged`, `--worktree`, and
`--base-ref <ref>` views; detects material changes; requires the canonical state
file in the same changeset; runs an in-memory strict doctor; builds HTML/CSS in
a temporary directory; verifies the generated output; and fails closed on
failure. Enforcement is a postcondition guard/local CI/precommit/release
responsibility. It is not a policy-check deny regex, and generated HTML/CSS is
never hand-edited.

The staged view is materialized from the Git index and the base-ref view from
`HEAD`; neither may borrow a cleaner unstaged worktree state. Rename discovery
retains both old and new paths for materiality classification. The portable
draft-07 schema validates shape, while cross-record and filesystem semantics
remain mandatory CLI validation performed by strict doctor/gate.

GitNexus remains authoritative for code-symbol and execution-flow
relationships. Docs Hub imports bounded references rather than copying or
replacing its graph.

## Consequences

### Positive

- Projects can be documented centrally without moving source files.
- Portal output works offline and can be hosted statically.
- Privacy and source ownership are explicit.
- Existing projects can migrate gradually.
- Search, links, diagrams, and traceability share one normalized model.

### Negative

- A new public schema and CLI surface require migration discipline.
- Legacy documents without metadata produce lower-quality classification.
- Diagram and GitNexus adapters require explicit degradation states.
- Generated output requires deterministic cleanup and cache ownership rules.
- A project that has not migrated can still scan and build readable legacy
  documentation, but the strict continuity gate remains failing until the
  manifest and canonical project state are present and valid.

### Materiality and migration

The general quality policy remains proportional, but a project's configured
continuous documentation contract overrides the usual not-every-local-edit
default. In this repository, the contract is mandatory for material changes.
Migration is source-preserving: run `forge docs init [target]`, review the
generated v1 manifest and `docs/project-state.json`, then run the readable scan
or build and resolve strict doctor diagnostics. Do not migrate by copying
generated HTML/CSS back into source or by editing generated output.

### Safety and failure behavior

Collection remains allowlist-only and root-contained. The gate validates the
selected change view and state freshness, keeps the strict doctor/build in
memory or temporary output, and does not publish partially verified generated
artifacts. Missing, invalid, stale, out-of-root, or absent-in-the-changeset
state fails closed for a material change. Legacy scan/build diagnostics remain
available so migration can proceed without making legacy content unreadable.

## Rejected Alternatives

### Obsidian vault as the sole canonical store

Rejected because it creates a second source location and makes the core
experience dependent on symlinks or a specific desktop application.

### Cloud-first documentation service

Rejected because Forgewright requires project-owned, provider-neutral local
commands and projects can contain private artifacts.

### Scan the entire repository and filter after ingestion

Rejected because sensitive files and high-volume execution artifacts must not
enter the catalog or renderer in the first place.

### Mandatory physical docs migration

Rejected because existing projects use valid mixed roots and moving files would
break links and increase adoption cost.

## Verification

- Schema and CLI tests validate manifest compatibility and idempotency.
- Manifest tests validate that new initialization includes the optional-
  compatible v1 `project_docs` contract and canonical project state.
- The Docs Hub gate tests staged, worktree, and base-ref change views, same-
  changeset state requirements, strict in-memory doctor behavior, temporary
  HTML/CSS output verification, and fail-closed diagnostics.
- Security tests prove root containment and excluded-path handling.
- Forgewright and Pixelworld fixtures prove mixed project compatibility.
- Browser tests prove static navigation, responsiveness, and accessibility.
- Detect-changes and independent review gate public-contract modifications.
