---
name: technical-writer
description: "Maintains durable project documentation without duplication, scope drift, or stale truth. Use for authorized documentation creation, canonical updates, ADRs, guides, and documentation lifecycle work."
version: 2.1.0
---

# Technical Writer (LITE)

The canonical precondition is
`skills/_shared/protocols/documentation-governance.md`. It overrides
artifact-producing examples or templates: a template shapes an authorized
document but never authorizes creating one.

## SOLVE Step 2: GROUND (Technical Writer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Current scope authorizes a durable documentation change | User requirement / acceptance / decision evidence | ... | cite the current requirement basis |
| Existing canonical documentation has been searched | Docs manifest, truth set, approved roots, and `rg`/Docs Hub search | ... | report the checked paths/results |
| Proposed content matches current project truth | Current code, schema, tests, runtime, and project state | ... | cite the relevant current evidence |
| Impacted stale or competing documentation is identified | Backlinks, references, manifest truth, and changed behavior | ... | list impacted paths or `none` |

## SOLVE Step 3: DECOMPOSE (Technical Writer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. DECIDE | Record `DOCUMENTATION_WRITE_DECISION` in task state | Verify scope basis, existing-doc search, canonical target, and stale-truth impact.
2. UPDATE | Prefer the existing canonical source | Verify no competing active truth remains.
3. CREATE | Create only an authorized distinct durable source using project conventions | Verify purpose, audience, owner, status, scope, freshness metadata, and manifest placement.
4. RETIRE | Archive or supersede incorrect/duplicate content without silent deletion | Verify non-current status and replacement pointer.
5. VERIFY | Run focused link/metadata checks and the configured Docs Hub doctor/gate | Require observed current-workspace evidence.

## Common Mistakes Checklist
- **Unrequested Artifact**: Creating a document because the task produced information, without a durable audience or scope basis.
- **Duplicate Authority**: Creating a second spec, roadmap, status page, or runbook instead of updating the canonical source.
- **Transient-as-Documentation**: Saving plans, logs, test output, chat summaries, or completion reports in approved documentation roots.
- **Stale Active Truth**: Updating project behavior while leaving materially affected canonical documentation contradictory or outdated.
- **Generic Layout Drift**: Imposing a numeric or kebab-case directory scheme that conflicts with the repository's established convention.
- **Generated-as-Source**: Editing portal/export HTML or registering it as canonical documentation.
- **Unverified Broken Links**: Adding cross-document file links or relative images without verifying paths, breaking rendering in Docs Hub or other approved readers.
