# Scope Definition: Forgewright Docs Hub

## Users

- Project owner managing multiple Forgewright workspaces.
- Engineer reading architecture, runbooks, ADRs, and verification status.
- AI agent retrieving deterministic project context.
- Reviewer tracing requirements to code, tests, and evidence.

## In Scope

### Project configuration

- `.forgewright/docs-manifest.json`
- `$FORGEWRIGHT_HOME/docs-hub/projects.json`
- Manifest fallback for legacy projects.
- Schema versioning and explicit migration errors.

### Collection and normalization

- Markdown, JSON, YAML, SVG, PNG, and explicitly allowed assets.
- Git metadata and curated Forgewright profile fields.
- GitNexus process/symbol references.
- Safe evidence summaries without raw secret-bearing output.
- Stable project, document, relation, and diagram IDs.

### Portal

- Global project dashboard.
- Project overview.
- Document tree, breadcrumbs, heading outline, backlinks, and related content.
- Light/dark semantic tokens.
- Static search.
- Diagram and traceability views.
- Responsive and print layouts.

### Diagnostics and export

- Broken links, missing anchors, case collisions, invalid diagrams, stale index,
  missing truth files, and privacy violations.
- Machine-readable doctor output and exit codes.
- Optional Obsidian export.

## Out of Scope

- Editing source documents through the portal.
- Cloud-hosted user accounts or collaboration.
- LLM-required classification, generation, or summarization.
- Automatic deletion, rename, or movement of project documents.
- Raw ingestion of credentials, transcripts, memory databases, audits, or
  arbitrary `.forgewright/artifacts/**`.
- Replacing GitNexus as the code graph.

## User Stories

| ID | Story | Acceptance |
|---|---|---|
| US-01 | Register multiple projects | No hardcoded project root is required |
| US-02 | Build docs without moving files | `Docs/`, `docs/`, README-only, and manifest roots work |
| US-03 | Find information across projects | Search returns project-aware deep links |
| US-04 | Inspect architecture and flows | Diagrams have accessible SVG or text fallback |
| US-05 | Diagnose documentation health | Doctor reports actionable file-level findings |
| US-06 | Preserve privacy | Excluded paths never enter catalog, HTML, or search |
| US-07 | Keep Obsidian workflow | Export remains optional and source-preserving |

## Constraints

| Area | Constraint |
|---|---|
| Runtime | Node.js 22+ and project-owned local commands |
| Persistence | JSON first; add a database only after measured need |
| Rendering | Static HTML/CSS with progressive enhancement |
| Security | Allowlist ingestion and project-root containment |
| Compatibility | macOS/Linux and case-sensitive/case-insensitive filesystems |
| Migration | Legacy docs build with warnings before frontmatter adoption |
| Operations | One project failure must not delete another project's output |

## Acceptance Criteria

| ID | Criterion | Verification |
|---|---|---|
| AC-01 | Manifest is versioned and validates | Schema and CLI unit tests |
| AC-02 | Init is idempotent and non-destructive | Golden CLI test |
| AC-03 | Registry has no machine-specific default root | Config unit test |
| AC-04 | `Docs/`, `docs/`, README-only, and empty projects are supported | Fixture integration tests |
| AC-05 | Traversal outside the project root is rejected | Security unit test |
| AC-06 | Excluded sensitive paths never enter generated artifacts | Privacy integration test |
| AC-07 | Normalized IDs are stable across repeated scans | Determinism test |
| AC-08 | Broken links, anchors, images, and case collisions are reported | Doctor fixture test |
| AC-09 | Static portal builds without a runtime backend | Build integration test |
| AC-10 | Core content is readable with JavaScript disabled | Browser structural test |
| AC-11 | Search is project-aware and offline | Search integration test |
| AC-12 | Diagrams validate and have accessible fallback | Diagram integration test |
| AC-13 | GitNexus stale/unavailable degrades explicitly | Adapter failure test |
| AC-14 | Obsidian export never writes into source docs | Export containment test |
| AC-15 | No horizontal overflow at target viewports | Browser screenshot/layout test |
| AC-16 | Keyboard focus, landmarks, and reduced motion are present | Accessibility test |
| AC-17 | Same input produces equivalent catalog and page routes | Golden determinism test |
| AC-18 | One project failure preserves successful project output | Batch failure test |

## Definition of Done

- All acceptance criteria pass with current workspace evidence.
- Public schema and CLI help are documented.
- Changed symbols pass GitNexus impact and detect-changes review.
- Unit, integration, golden, browser, accessibility, and privacy checks pass.
- Generated output ownership and cleanup behavior are documented.
- Migration shims do not silently alter source files.
