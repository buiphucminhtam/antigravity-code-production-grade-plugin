---
id: verification
title: Verification Protocol (Evidence-First)
summary: Proportional evidence collection before any completion or correctness claim.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [quality-gate, research-gate, senior-execution-contract]
supersedes: []
superseded_by: null
---
# Verification Protocol (Evidence-First)

Verification prevents a plausible narrative from being mistaken for current project truth. It is Slot ⑭ in the post-skill chain and supports `kernel/VERIFY.md`.

## Evidence Hierarchy

For project facts, prefer:
1. current workspace/runtime/tool output;
2. executable checks: test/build/lint/typecheck/probe;
3. current project contracts/config/docs;
4. verified external/official sources when material;
5. memory/examples/templates only as hints.

A higher-tier model's statement is still a claim until checked.

## Proportional Workflow

1. Identify the **material claims** needed to close the current acceptance criteria. Do not enumerate every trivial assumption for ceremony.
2. Reuse direct evidence already gathered in the current state/turn when it is still valid.
3. For missing material evidence, choose the smallest deterministic verifier:
   - inspect/search current files for structure/config;
   - run a focused command/script for runtime/state;
   - run targeted tests for changed behavior;
   - run integration/E2E/build/release checks when blast radius or acceptance requires them.
4. Execute and record enough of the output to support the conclusion.
5. Decide:
   - **PASS:** evidence supports all required claims;
   - **FAIL:** evidence contradicts a required claim;
   - **UNVERIFIED:** a material claim cannot be checked in the current environment.

Do not convert `UNVERIFIED` into PASS.

## Effort Fit

- `QUICK`: one or a few focused checks proving the local acceptance criterion.
- `STANDARD`: targeted changed-behavior/static/regression checks across affected boundaries.
- `DEEP`: stronger integration/security/compatibility/release evidence plus independent review when required by kernel/quality gate.

Do not run an unrelated full build/test suite for a trivial docs/text edit unless project policy explicitly requires it. Conversely, do not use a lint pass as proof of business behavior for a release-critical change.

## Failure Handling

When a verifier fails:
1. keep the exact failing evidence;
2. reject the contradicted assumption/claim;
3. make one evidence-supported correction and re-run the same verifier when appropriate;
4. if the same step fails twice, follow the Graceful Failure / kernel Stuck rule;
5. open the Research Gate only when a material unknown blocks the next decision.

Never trigger automatic shared-skill mutation from a failed verifier.

## UI / Visual Work

For material UI/art/layout changes, inspect rendered visual evidence when the environment supports it. Structural checks can prove presence/layout rules/accessibility but not subjective polish.

A screenshot/visual-review gate is **not mandatory for every file that happens to touch UI**. Require it when visual appearance is part of acceptance, a regression is visually observable, or the project/release contract calls for it. Report any remaining subjective uncertainty plainly.

## Evidence Report

A completion report should be compact:

```text
CLAIM: <what is being asserted>
EVIDENCE: <command/file/tool + relevant result>
VERDICT: PASS | FAIL | UNVERIFIED
```

For multiple claims, list only those that materially support acceptance or residual risk.

---

*Quality depth: `skills/_shared/protocols/quality-gate.md`; success claim format: `kernel/VERIFY.md`.*
