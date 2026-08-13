---
id: quality-gate
title: Universal Quality Gate Protocol
summary: Proportional deterministic verification for changed behavior, phase boundaries, merges, and releases.
status: active
version: 2.1.0
owners: [core]
triggers: []
used_by: [all]
related:
  [
    plan-quality-loop,
    verification,
    senior-execution-contract,
    research-gate,
    consulting-risk-radar,
    visual-grounding,
  ]
supersedes: []
superseded_by: null
---

# Universal Quality Gate Protocol

The Quality Gate exists to prove the requested outcome, not to manufacture a scorecard. Every success claim needs evidence, but **gate depth is proportional to effort and risk**.

## Gate Selection

| Effort / event | Required verification                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `QUICK`        | Focused acceptance check + any safety check directly relevant to the touched surface. No numeric quality score required.     |
| `STANDARD`     | Changed-behavior tests/checks, build/lint/typecheck as applicable, regression checks for affected boundaries, normal review. |
| `DEEP`         | Full applicable levels below, independent review, compatibility/security/rollback evidence where relevant.                   |
| Parallel merge | Contract/merge validation + affected integration/regression checks.                                                          |
| Release        | Release-critical build/test/security/compatibility gates required by the project.                                            |

### Continuous Documentation Contract

The proportional default still applies generally: documentation-only or
non-material local edits do not require an unrelated application build or a
pretend full release gate. A project-configured continuous documentation
contract overrides the usual **not every local edit** default when the change
crosses that project's materiality boundary. In this repository, the contract
is mandatory for material changes.

When the contract applies, the postcondition must run
`forge docs gate [target]` (using the applicable `--staged`, `--worktree`, or
`--base-ref <ref>` view). The gate requires the configured canonical project state in the
same changeset, runs strict doctor checks in memory, builds generated HTML/CSS
in a temporary directory, verifies the output, and fails closed on any missing
or invalid condition. This does not authorize hand-editing generated HTML/CSS;
project-owned Markdown/JSON remains authoritative.

### Mandatory Payment / HARD Gate

Payment, billing, IAP/in-app purchase, receipt validation, entitlements,
subscription, and checkout are mandatory `HARD` and `DEEP` work regardless of
file count. There is no small-file `QUICK` escape. Such work cannot pass without
an independent reviewer and domain-appropriate contract, runtime, and E2E
evidence, including relevant negative paths; the reviewer state must be
`reviewer.status: independent-approved` with a current signed `review-2`
record. The review must use OpenSSH Ed25519, verify against external
`FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS` or
`~/.forgewright/reviewers.allowed_signers`, and cover the canonical final
evidence digest, exact tree/turn, every acceptance ID, and exact
`negative_path_bindings`. Review-1 or self-authored JSON is `UNVERIFIED`.

### Completion Evidence Schema

Completion evidence uses schema v2 from [kernel/VERIFY.md](../../../kernel/VERIFY.md).
Each `acceptance_criteria[]` item must map an exact ID and claim to concrete
invoked `test_refs`. The machine runner derives an execution manifest from the
exact command; it is not caller-declared text. `negative_paths` is required,
and every entry must have a `negative_path_bindings` record with an ID,
acceptance IDs, and invoked refs. The record also carries tier, exact
argv/output digest, limitations, phase, full-tree fingerprint, and reviewer
state. Narrative or marker-only VERIFY output cannot prove completion.
Schema v1 is legacy and non-completion after v2 activation.

For every fix, the gate requires observed RED evidence for the faulty behavior
followed by observed GREEN from the same command unchanged, with the same refs,
manifest, and acceptance/negative mappings. Payment fixes and all other HARD
fixes additionally require a controlled mutation/backcheck proving the restored
faulty behavior fails: `RED → pre-mutation GREEN → mutation fail → exact final
GREEN`. Restore the clean pre-mutation target tree and record final status/diff
evidence; unrelated worktree changes must not be discarded.

Read-only discovery, status reporting, handoff formatting, or documentation-only work does not need a pretend build/test score. Verify the facts/artifact that actually changed.

## Level 0 — Plan Fit (Before Implementation)

Use `plan-quality-loop.md`:

- `QUICK` → `ACTION | TARGET | CHECK`; no numeric plan score.
- `STANDARD` / `DEEP` → use the applicable complexity-scaled threshold for the actual mode.
- A low score is not by itself a reason to browse. Open `research-gate.md` only when the weakness is caused by a material knowledge/evidence gap.

If the same planning/execution step fails twice, follow the kernel Stuck/Escalation rule. Do not loop until an arbitrary score rises.

## Level 1 — Syntax / Build / Static Correctness

Run only checks supported by the project and relevant to the changed surface, for example:

- compile/typecheck for compiled/typed code;
- parser/static validation for configuration/data formats;
- lint on changed files or the project when that is the established gate;
- build when the acceptance/release contract depends on a build artifact.

A `QUICK` documentation/text/config edit does not need an unrelated application build merely for ceremony. A release or public-contract change usually does.

**Failure:** fix the evidenced cause and re-run the same check. If the same step fails twice, stop repeated attempts and escalate/research according to the kernel.

## Level 2 — Regression / Compatibility

For brownfield work:

1. Protect previously passing behavior in the affected area.
2. Prefer changed/targeted tests first; run the wider suite when blast radius or release policy warrants it.
3. Check scope with `git diff` / changed-file evidence.
4. Preserve public contracts unless the user explicitly approved a breaking change and migration path.

Typical compatibility rules when applicable:

- REST/OpenAPI: do not silently remove/rename existing endpoints or required response fields;
- GraphQL: do not silently remove/rename public types/fields or change incompatible field types;
- Protobuf/gRPC: preserve field numbers/types and RPC compatibility;
- persistent schemas/data: prove migration and rollback/forward-compatibility as required.

Greenfield work has no historical regression baseline, but still needs acceptance tests for implemented behavior.

## Level 3 — Security / Reliability / Project Standards

Always enforce material safety properties on touched surfaces:

- no real hardcoded credentials/secrets;
- imports/dependencies resolve;
- project conventions and protected paths are respected;
- auth/authorization, billing, destructive data operations, tenancy, concurrency, and other sensitive boundaries receive deeper checks when touched.
- payment-domain completion follows the mandatory `HARD` / `DEEP` gate above;
  file count and documentation-only surface size do not downgrade it.

Do not require tenant filters, circuit breakers, retries, idempotency, caches, or other infrastructure unless the verified architecture/failure semantics require them.

## Level 4 — Acceptance Traceability

Each material output should map to a current acceptance criterion or explicit maintenance objective.

- Tests are selected from behavior/risk, not quotas.
- Documentation is required when the change creates a durable public/operational contract or the user asked for it; it is not mandatory for every local edit.
- Workspace artifacts/handoffs are created only when another role/session needs them.

Unmapped extra work belongs under `Out of scope` / `Later` instead of being silently implemented.

## Scoring (Optional Telemetry)

A project may compute a 0–100 quality score for dashboards on `STANDARD` / `DEEP` work, but **the score is telemetry, not truth**:

- hard evidence failures cannot be offset by a high aggregate score;
- passing acceptance should not trigger make-work merely to raise an already acceptable score;
- `QUICK` work should not be delayed to produce a scorecard.

If configured, preserve project-specific thresholds in `.production-grade.yaml`; do not assume one universal threshold across all projects/modes.

## Recovery

When a gate fails:

1. record the exact failing check and evidence;
2. apply the smallest evidence-supported correction;
3. re-run the same check;
4. after two failures on the same step, STOP repeated attempts;
5. use `research-gate.md` only if a material unknown blocks the next decision; otherwise escalate with options and residual risk.

Never “improve quality” by expanding scope unrelated to the failed acceptance criterion.

## UI / Visual Verification

Follow `visual-grounding.md`. Material visual work uses a **two-layer gate**:

1. deterministic/structural checks for the properties tooling can prove (tokens, states, layout, accessibility, dimensions, alpha/frame bounds, engine/import constraints, VRT where stable);
2. rendered reference-conformance review for hierarchy/style/readability/art quality against an inspected design system/reference contract.

The gate must not approve a visual solely from a model’s aggregate aesthetic score or a generic style heuristic. A concrete reference mismatch beats a high score. Existing brand/design-system choices override generic “AI aesthetic” rules. Use human approval only for genuine preference/brand decisions or explicit approval gates; otherwise report residual visual uncertainty as `UNVERIFIED`, never as a fabricated confidence percentage.

## Metrics Storage

When quality telemetry is useful, record only measured facts (commands, exit codes, test counts, findings, changed files, timestamps/durations from actual tooling). Never invent duration, coverage, score, or pass evidence.

---

_Acceptance claims still follow `kernel/VERIFY.md`; this protocol defines how much evidence to collect._
