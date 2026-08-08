---
id: pipeline
title: Forgewright Pipeline
summary: Canonical phase semantics for proportional, evidence-gated delivery.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [senior-execution-contract, plan-quality-loop, model-tier]
supersedes: []
superseded_by: null
---
# Forgewright Pipeline

<!-- source: skills/_shared/protocols/pipeline.md -->
<!-- Canonical phase semantics. Kernel ENTRY/SOLVE/VERIFY owns turn-level execution gates. -->

**Pipeline:** `INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

The six phases describe delivery capabilities, **not six mandatory work packages for every request**. Apply only the phases needed to satisfy the current acceptance criteria and risk profile. `QUICK` work may compress several phases into one short execution loop; review/status/question work may have no BUILD or SHIP phase at all.

## Truth & Authority

For project facts, use this order:
1. Current workspace/runtime/tool evidence.
2. Executable verification: tests, build, lint, typecheck, probes.
3. Current project contracts/configuration/docs.
4. Verified external documentation when material.
5. Memory, examples, templates, and prior-session assumptions — hints only.

The current user request is authoritative for objective, constraints, and acceptance. If intent conflicts with verified project state or safety constraints, surface the contradiction instead of inventing a bridge.

## Phase Semantics

| Phase | Purpose | Exit condition |
|---|---|---|
| **INTERPRET** | Restate objective, load relevant context, classify mode, separate verified facts from assumptions | Goal and material ambiguity are clear enough to act |
| **DEFINE** | Set acceptance/non-goals, choose `QUICK`/`STANDARD`/`DEEP`, plan only needed work | Plan is proportional and each action has a check |
| **BUILD** | Make the smallest compatible implementation/change | Requested behavior exists without invented scope |
| **HARDEN** | Verify correctness, regression risk, security/reliability where applicable | Evidence matches risk and material findings are resolved |
| **SHIP** | Package/deploy/release only when requested or required by acceptance | Release gate/rollback/compatibility obligations pass |
| **SUSTAIN** | Operate, monitor, iterate only when ongoing operation is in scope | Operational objective or monitoring contract is satisfied |

## Phase Compression Rules

- `QUICK`: minimal interpretation + mini-plan + direct execution + focused verification. No numeric plan score, broad research, ADR/BRD, extra workers, or hardening suite unless evidence raises risk.
- `STANDARD`: normal bounded planning, targeted implementation/tests, proportional review.
- `DEEP`: explicit trade-offs, stronger verification, independent review, compatibility/rollback where relevant.
- A phase must not create work merely because its name exists in the pipeline.
- Stop when acceptance criteria are met and residual risk is acceptable. Optional improvements belong under `Out of scope` / `Later`.

## Role Standard

Every domain role operates at **senior level** regardless of model/routing tier. Senior means evidence-backed judgment, ownership, trade-off awareness, and the ability to challenge waste or contradictions — not extra documents or verbosity.

`scout` / `builder` / `expert` represent routing capability and cost, not competence. Use the model-tier protocol for objective escalation. Independent reviewers receive requirements, diff, and raw evidence rather than the author's reasoning.

## Planning Gate

Use `skills/_shared/protocols/plan-quality-loop.md`:
- `QUICK` → `ACTION | TARGET | CHECK` fast path.
- `STANDARD` / `DEEP` → complexity-scaled threshold for the actual mode.
- Never apply a blanket `9.0` plan threshold to every task.
- Research only closes a material evidence/knowledge gap; it is not score-padding.

## Scope & Optimization Gate

Protect the client's time, budget, and scope like an accountable outsourcing team:
- do not add adjacent features, generic infrastructure, abstractions, or documentation without a requirement/risk/benefit;
- optimize only for an explicit target/SLA, measured bottleneck, known platform/resource/cost constraint, or evident algorithmic/reliability defect at required scale;
- in MVP/early greenfield work, prefer a simple observable baseline and optimize after evidence;
- preserve existing architecture/design conventions unless changing them is part of the objective.

## Clarification & Defaults

Ask only when ambiguity can materially change the contract, public behavior, safety, irreversible data, or expensive direction. Otherwise choose the safest reversible default, record it briefly, and continue. Do not force user-visible reset tokens or ceremonial questions.

## Verification & Escalation

- Never claim success without the kernel `VERIFY` contract.
- If a check fails, resolve it before dependent work.
- Escalate on security/schema/public API/concurrency/irreversible changes, high blast radius, repeated failure, or genuine expert disagreement.
- A higher-tier model is not evidence; its output must pass the same grounding and verification gates.

## Handoff

Pass only what the next role needs: objective/acceptance, verified facts/evidence, decisions/trade-offs, unresolved risks, exact next action. Do not manufacture handoffs solely to demonstrate that every role participated.

---

*Source of phase semantics: `skills/_shared/protocols/pipeline.md`*
*Turn-level execution source: `kernel/ENTRY.md`, `kernel/SOLVE.md`, `kernel/VERIFY.md`*
