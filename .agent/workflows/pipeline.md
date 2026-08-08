---
description: Show the canonical Forgewright pipeline, effort classes, modes, and routing rules
---

# Forgewright Pipeline Reference

Canonical pipeline:

`INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

Source of truth: `product-manifest.json` (phase inventory), `skills/_shared/protocols/pipeline.md` (phase semantics), and `kernel/ENTRY.md` / `kernel/SOLVE.md` / `kernel/VERIFY.md` (turn-level enforcement).

## Execution principle

Do not run every phase as a mandatory work package. Choose the smallest flow that satisfies acceptance and risk:
- `QUICK`: local/reversible/low-risk → mini-plan + focused verifier; compress phases.
- `STANDARD`: bounded normal work → targeted implementation/tests/review.
- `DEEP`: security/public contract/schema/concurrency/irreversible/release-critical/high-blast work → stronger evidence + independent review/rollback when relevant.

All domain roles are senior by judgment/ownership/evidence. `scout`, `builder`, `expert` are routing capability tiers, not seniority tiers.

## Common mode routing

| Mode | Typical skill path |
|---|---|
| Full Build | PM/BA → UI/Architect as needed → implementation specialists → QA/Security/Review → DevOps/SRE when shipping |
| Feature | PM only if scope is ambiguous/material → Architect only for durable contract choices → relevant engineer → QA/review proportional to risk |
| Debug | Debugger → relevant engineer → focused regression verification |
| Harden | Security + QA + Code Reviewer as applicable |
| Ship | DevOps/Build Release → SRE when operational reliability is in scope |
| Test | QA Engineer |
| Review | Code Reviewer (+ Security for security-sensitive scope) |
| Architect | Solution Architect |
| Document | Technical Writer |
| Explore / Research | Polymath / Research specialist as appropriate |
| Optimize | Performance specialist only after target/measurement/constraint is established |
| Design | UI/Interaction/Art specialists as applicable |
| Mobile / Game / XR / AI | Relevant domain specialists; add other roles only when acceptance/risk requires them |

The full 24-mode inventory is in `docs/mode-reference.md`.

## Planning gate

`QUICK` uses `ACTION | TARGET | CHECK` without numeric scoring. `STANDARD`/`DEEP` use the complexity-scaled threshold in `skills/_shared/protocols/plan-quality-loop.md`. Never force a universal 9/10 score or research gate.

## Grounding

Current workspace/runtime evidence outranks prose, memory, examples, and templates for project facts. Never pin provider/model names in skill frontmatter; runtime routing follows `skills/_shared/protocols/model-tier.md`.

## How to invoke

Describe the desired outcome naturally. The orchestrator should infer the smallest adequate route, surface only material ambiguity/risk, execute, verify, and stop when acceptance is met.
