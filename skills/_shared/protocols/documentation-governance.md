---
id: documentation-governance
title: Documentation Governance Protocol
summary: Pre-write and post-change governance that prevents duplicate, out-of-scope, transient, and stale project documentation.
status: active
version: 1.0.0
owners: [core, documentation]
triggers: [documentation-write, material-project-change]
used_by: [pipeline, guardrail, technical-writer, docs-hub]
related: [pipeline-operating-contract, guardrail, quality-gate]
supersedes: []
superseded_by: null
---

# Documentation Governance Protocol

Project documentation exists to preserve durable truth for a named audience.
It is not a by-product of every task. This protocol runs before any
project-owned documentation write and again when a material project change can
make existing truth stale.

## Non-Negotiable Rules

1. **No document without a durable need.** A document must map to an explicit
   user requirement, an accepted product/architecture decision, a public or
   operational contract, or a reusable guide required by a named audience.
2. **Update before create.** Search the manifest, truth set, approved docs roots,
   and current workspace first. If an existing authoritative document covers
   the scope, update the existing canonical source instead of creating another
   file.
3. **Scope is binding.** Do not create or expand durable documentation outside
   the current scope merely to record work performed, summarize the chat, or
   make the repository appear complete.
4. **Current evidence outranks prose.** Code, schemas, tests, runtime evidence,
   and the canonical project state decide whether documentation is still true.
5. **One active authority per fact.** Supporting documents link to canonical
   truth; they do not copy and silently fork it.
6. **Generated output is never source.** HTML/CSS portals, search indexes,
   reports, and exports are disposable views and must not be hand-edited.

## Documentation Lifecycle Classes

| Class | Purpose | Durable source? | Governance |
|---|---|---:|---|
| **Canonical** | Authoritative current requirement, decision, state, contract, or runbook | Yes | Must be manifest-approved, owned, current, and uniquely authoritative |
| **Supporting** | Explanation or guide that links to canonical truth | Yes | Must declare a distinct audience/purpose and avoid copying authoritative state |
| **Transient** | Task plan, scratch analysis, chat summary, test output, handoff, or working note | No | Keep in task/runtime state or an ignored `.forgewright/` area; never add to the Docs Hub truth set |
| **Generated** | Portal page, index, diagram render, report, or export derived from sources | No | Rebuild from source; never edit or accept as project truth |
| **Archived** | Historical document retained for context | Historical only | Mark non-current, identify its replacement when one exists, and exclude it from active truth |

## Pre-Write Gate

Before creating, renaming, moving, updating, archiving, or deleting a durable
documentation source:

1. Bind the change to the current requirement, acceptance criterion, decision,
   or operational risk.
2. Inspect the Docs Hub manifest/truth set and search existing documentation for
   the same topic, audience, and authority.
3. Verify the proposed content against current workspace/runtime evidence.
4. Identify any canonical documents made stale by the project change.
5. Select exactly one decision below. Keep the decision in task state; do not
   create another planning document just to record it.

```text
DOCUMENTATION_WRITE_DECISION
decision: NO_DOC | UPDATE_CANONICAL | CREATE_CANONICAL | ARCHIVE_OR_SUPERSEDE | TRANSIENT_ONLY
scope_basis: <requirement/acceptance/decision/risk reference>
audience_and_durable_need: <named audience + why this must persist, or none>
existing_docs_checked: <manifest/catalog/search evidence>
canonical_target: <existing or proposed project-relative source path, or none>
stale_truth_impact: <impacted canonical paths, none, or unresolved>
supersedes: <paths replaced by this change, or none>
```

### Decision Meaning

- `NO_DOC`: no durable documentation change is justified.
- `UPDATE_CANONICAL`: modify the existing authoritative source; this is the
  default when the topic already exists.
- `CREATE_CANONICAL`: create a new durable source only when the need, audience,
  lifecycle, or authority is materially distinct and no existing source can
  own it cleanly.
- `ARCHIVE_OR_SUPERSEDE`: retire incorrect or duplicate active content without
  leaving two competing truths. Preserve history according to project policy;
  do not delete material documentation without authorization.
- `TRANSIENT_ONLY`: keep short-lived material out of approved documentation
  roots and out of the truth set.

If `scope_basis`, `existing_docs_checked`, or `stale_truth_impact` is missing,
durable documentation writes are `UNVERIFIED` and must not proceed.

## Spam and Scope Denials

Deny a new durable document when any of these conditions apply:

- an existing canonical source already covers the topic;
- the content is a duplicate, paraphrase, or format-only copy of active truth;
- it is outside the current scope or lacks a named durable audience;
- it is a task log, scratch plan, execution transcript, test output, status
  snapshot, chat recap, or completion report that belongs in task/runtime state;
- it documents speculative behavior not accepted as a current requirement;
- it is generated output presented as source;
- it is placed outside project-approved documentation roots or bypasses the
  manifest/privacy allowlist;
- it would leave an older active document contradicting the new one.

Do not create a new file merely because a skill template contains one. A
template shapes an already-authorized document; it never authorizes the
artifact.

## Standard for Durable Sources

For a newly authorized durable document, and for legacy documents when they are
materially revised:

- follow the repository's existing layout and naming convention; do not impose
  a generic directory migration;
- use one clear purpose, audience, and authority boundary per document;
- include or preserve discoverable metadata for `title`, `status`, `owner`,
  `scope`, `last_reviewed`, and whether the document is canonical;
- link to canonical state/requirements instead of copying volatile status;
- keep examples explicitly non-authoritative when they can drift from runtime;
- register active sources through the Docs Hub manifest rather than relying on
  broad unreviewed discovery.

Existing documents are not bulk-rewritten solely to add metadata. Migrate them
when touched or when the documentation owner approves a bounded cleanup.

## Freshness and Contradiction Handling

Freshness is event-driven first and time-based second:

1. A material behavior, schema, interface, workflow, architecture, operations,
   or roadmap change must identify impacted canonical documentation.
2. Impacted truth is updated in the same changeset, or completion blocks with an
   explicit unresolved documentation decision.
3. An active document that contradicts current evidence must be corrected,
   archived, or marked superseded before it can be used as truth.
4. Unrelated stale documentation discovered during a bounded task is reported
   as documentation debt. Do not silently expand scope; block only when that
   stale source is authoritative for, or materially affected by, the current
   change.
5. Never refresh timestamps or rewrite prose without reviewing the underlying
   truth. Timestamp-only churn is not a freshness fix.

The canonical `project_docs.state` remains the live summary for structure,
roadmap, flows, backlog, blockers, risks, and next actions. Topic documents link
to it instead of maintaining competing status copies.

## Completion Conditions

A documentation-affecting change is complete only when:

- the pre-write decision is valid and mapped to current scope;
- no duplicate or competing active truth was introduced;
- all materially impacted canonical sources are current or explicitly blocked;
- transient/generated material remains outside durable source sets;
- archived/superseded content is visibly non-current and points to replacement
  truth when applicable; and
- the configured Docs Hub doctor/gate passes for the selected changeset.
