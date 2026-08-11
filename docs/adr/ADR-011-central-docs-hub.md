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
- Security tests prove root containment and excluded-path handling.
- Forgewright and Pixelworld fixtures prove mixed project compatibility.
- Browser tests prove static navigation, responsiveness, and accessibility.
- Detect-changes and independent review gate public-contract modifications.
