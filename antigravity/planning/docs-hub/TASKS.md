# Task Breakdown: Forgewright Docs Hub

## P0 — Contracts and safety

| ID | Task | Check | Status |
|---|---|---|---|
| P0-01 | Add ADR and Antigravity artifacts | Required files exist and cross-link | Completed |
| P0-02 | Add `docs-manifest` JSON Schema | Schema fixture validation | Completed |
| P0-03 | Add goal no-quota regression guard | Focused pytest | Completed |
| P0-04 | Define privacy deny patterns and containment rules | Security unit tests | Completed |

## P1 — CLI and normalized catalog

| ID | Task | Check | Status |
|---|---|---|---|
| P1-01 | Register `forge docs` command group | CLI help/golden test | Completed |
| P1-02 | Implement manifest init/load/validate | Unit and idempotency tests | Completed |
| P1-03 | Implement global registry | Add/list/remove tests | Completed |
| P1-04 | Implement legacy source discovery | Mixed-case fixture tests | Completed |
| P1-05 | Implement scanner and stable IDs | Determinism tests | Completed |
| P1-06 | Emit normalized catalog and diagnostics | Golden catalog snapshots | Completed |

## P2 — Static portal

| ID | Task | Check | Status |
|---|---|---|---|
| P2-01 | Implement safe Markdown rendering | Renderer unit tests | Completed |
| P2-02 | Implement global/project/document pages | Static build test | Completed |
| P2-03 | Add shared CSS tokens and components | Token conformance test | Completed |
| P2-04 | Add responsive navigation and print styles | Browser layout tests | Completed |
| P2-05 | Add offline search index | Search fixture test | Completed |

## P3 — Relations and integrations

| ID | Task | Check | Status |
|---|---|---|---|
| P3-01 | Resolve links, anchors, assets, and backlinks | Doctor integration test | Completed |
| P3-02 | Add diagram validation and accessible fallback | Diagram fixture tests | Completed |
| P3-03 | Add bounded GitNexus adapter | Available/stale/unavailable tests | Completed |
| P3-04 | Add traceability views | Golden relation pages | Completed |
| P3-05 | Add Obsidian export | Containment and source-preservation tests | Completed |

## P4 — Hardening and migration

| ID | Task | Check | Status |
|---|---|---|---|
| P4-01 | Add `forge docs doctor` checks and exit codes | Unit/integration tests | Completed |
| P4-02 | Convert wiki-sync scripts to compatibility shims | Existing script tests | Completed — existing scripts remain documented shims |
| P4-03 | Add Forgewright and Pixelworld golden fixtures | Golden CI | Completed |
| P4-04 | Add browser and accessibility verification | Browser DOM/screenshot audit | Completed — direct tab traversal is adapter-limited |
| P4-05 | Run detect-changes and independent review | Review verdict | Completed — no P0/P1 findings remain |

## Execution Rule

Each task uses:

```text
ACTION | TARGET | CHECK
```

No dependent task advances after a failed material check. The same approach is
not retried more than twice without isolating the failed assumption.
