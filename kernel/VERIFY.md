# VERIFY — Evidence Contract

A success claim requires **observed current evidence**, not self-attestation. The amount of reporting scales with risk; the evidence standard does not.

## QUICK — Compact Evidence
Use for clear, local, reversible changes when one focused check proves acceptance.
```text
CHECK: <command/tool check> | EXIT: <code/result> | RESULT: PASS | FAIL
```
A single compact check may cover tightly coupled acceptance conditions. Do not manufacture multiple blocks to satisfy a template.

## STANDARD / DEEP — Command or Test Evidence
Use when the change has multiple material behaviors, broader regression surface, or elevated risk.
```text
CLAIM: <material behavior being verified>
COMMAND: <exact command/tool check>
OUTPUT: <relevant observed output>
EXIT CODE: <number/result>
VERDICT: PASS | FAIL
```

## UI / Visual Evidence
A successful build alone must not prove responsiveness or visual correctness. Verify only the states relevant to the changed UI: affected viewport(s), overflow/wrapping, interaction/focus state, design-token conformance, and screenshot/VRT evidence when available. For major/new UI, record **Project breakpoints/fallback viewports tested** and **Horizontal overflow checked**; a local UI fix does not require unrelated state inventory.

## Executable Logic Evidence
For non-obvious math/algorithms/state/concurrency, use a focused executable test or scratch script and report its observed result. Routine `QUICK` work needs no extra reasoning artifact.

## Runtime Ledger
When the task starts a long-running server/editor/emulator/watcher/container, verify it was reclaimed or deliberately kept. If runtime lease tooling is present, use it; otherwise report the actual PID/process state from the available runtime tools.

## Rules
1. Never report `PASS` from expectation, prose, or memory. **Narrative claims without current evidence are automatically FALSE.** Evidence must come from the current workspace/runtime after the change.
2. `FAIL` evidence is reported, not hidden or converted into a success narrative.
3. Prefer existing **deterministic checks**: tests/build/type/lint/runtime evidence. If no existing check can adequately prove a material behavior, **create one before claiming** success.
4. `QUICK` work may use one compact evidence line. `STANDARD`/`DEEP` work reports each **material** behavior, not every edit line.
5. Requirement coverage is audited proportionally via [AUDIT.md](AUDIT.md); a full matrix is not mandatory for local reversible work.
6. UI evidence must distinguish structural/tool verification from human aesthetic judgment where human review is genuinely required.
7. If the task started long-running processes, runtime cleanliness is part of acceptance.

