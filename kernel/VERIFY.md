# VERIFY — Evidence Contract

Completion requires observed current workspace/runtime evidence. Schema v2 is the only completion format; Schema v1 is legacy and non-completion after v2 activation. Prose, checkboxes, test counts, and marker-only PASS/GREEN are `UNVERIFIED`.

## QUICK — Compact Evidence
For clear local reversible work: `CHECK: <command/tool check> | EXIT: <code/result> | RESULT: PASS | FAIL`. One focused check may cover tightly coupled acceptance conditions.

## UI / Visual Evidence
A successful build alone must not prove responsiveness or visual quality. Use inspected basis, deterministic checks, and rendered evidence when applicable. Record **Project breakpoints/fallback viewports tested** and **Horizontal overflow checked**; missing basis/render is `UNVERIFIED`.

## Executable Logic Evidence
For non-obvious math/algorithms/state/concurrency, use a focused executable test or scratch script and report its result.

## Runtime Ledger
For a task-started long-running process, report reclaimed/kept status and actual PID/process state.

## Rules
1. Never report `PASS` from prose or memory. Narrative claims without current evidence are automatically FALSE.
2. Report `FAIL` evidence; never hide or narrate it into success.
3. Prefer deterministic checks; if none proves a material behavior, create one before claiming success.
4. `QUICK` may use one compact evidence line; `STANDARD`/`DEEP` reports each material behavior.
5. Requirement coverage is audited via [AUDIT.md](AUDIT.md); a full matrix is not mandatory for local reversible work.
6. UI evidence separates structural/tool verification from human aesthetic judgment.
7. Long-running processes must be cleanly reclaimed or deliberately kept.

## Evidence Schema v2 — Completion-Critical
The machine record gives exact acceptance traceability and a derived execution manifest:
```json
{"schema_version": "2", "acceptance_criteria": [{"id": "exact-id", "claim": "exact behavior", "test_refs": ["tests/file.py::test_id"]}], "command": ["exact", "argv"], "execution": {"runner": "derived-runner"}, "tier": "unit|contract|integration|runtime|e2e|security|review", "negative_paths": ["observed rejection/failure path"], "negative_path_bindings": [], "limitations": [], "implementer_id": "actor-id", "reviewer": {}, "tree_sha": "TREE:<sha256>", "output_sha256": "<sha256>"}
```
Each acceptance ID and negative paths entry maps to invoked concrete refs and bindings in the derived manifest; derive it from the command/runner, never caller text.

`tree_sha` covers HEAD/index and tracked, untracked, or ignored project content.
Only verifier-owned volatile paths are excluded; arbitrary ignored files and
same-HEAD source changes remain covered.

## Fixes and HARD
Every fix uses the same command unchanged and must show observed RED then observed GREEN. Payment, billing, IAP/in-app purchase, receipt validation, entitlements, subscription, and checkout are mandatory `HARD` and `DEEP`, regardless of file count. Other HARD fixes require controlled mutation/backcheck: `RED → pre-mutation GREEN → mutation fail → exact final GREEN`, with the clean pre-mutation target tree restored. Completion is blocked until this sequence is observed.

HARD needs contract/runtime/E2E evidence plus a
keyless `review-2` binding the canonical final-evidence digest, exact tree,
turn, workspace, acceptance IDs, and `negative_path_bindings`. It sets
`reviewer.status: independent-approved`; reviewer identity differs from
`implementer_id`. Review-1, self/same-identity records, and markers are
`UNVERIFIED`. Bindings detect mismatch, not reviewer authenticity; report the
same-user-forgery limitation.

## Proportional Evidence
`QUICK` may use one focused deterministic check; `STANDARD`/`DEEP` report every material claim. UI needs inspected/rendered evidence; logic needs executable tests; processes need reclaim/lease evidence. Keep execution local-first/provider-neutral; never store secrets or private keys.
