---
id: quality-gate
title: Universal Quality Gate Protocol
summary: Proportional deterministic verification for changed behavior, phase boundaries, merges, and releases.
status: active
version: 2.1.0
owners: [core]
triggers: []
used_by: [all]
related: [plan-quality-loop, verification, senior-execution-contract, research-gate, consulting-risk-radar, visual-grounding]
supersedes: []
superseded_by: null
---
# Universal Quality Gate Protocol

The Quality Gate exists to prove the requested outcome, not to manufacture a scorecard. Every success claim needs evidence, but **gate depth is proportional to effort and risk**.

## Gate Selection

| Effort / event | Required verification |
|---|---|
| `QUICK` | Focused acceptance check + any safety check directly relevant to the touched surface. No numeric quality score required. |
| `STANDARD` | Changed-behavior tests/checks, build/lint/typecheck as applicable, regression checks for affected boundaries, normal review. |
| `DEEP` | Full applicable levels below, independent review, compatibility/security/rollback evidence where relevant. |
| Parallel merge | Contract/merge validation + affected integration/regression checks. |
| Release | Release-critical build/test/security/compatibility gates required by the project. |

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

*Acceptance claims still follow `kernel/VERIFY.md`; this protocol defines how much evidence to collect.*
