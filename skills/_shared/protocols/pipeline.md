---
id: pipeline
title: Forgewright Pipeline
summary: Canonical phase semantics for proportional, evidence-gated delivery.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [senior-execution-contract, plan-quality-loop, model-tier, pipeline-operating-contract, skill-specialization-contract]
supersedes: []
superseded_by: null
---
# Forgewright Pipeline

<!-- source: skills/_shared/protocols/pipeline.md -->
<!-- Canonical phase semantics. Kernel ENTRY/SOLVE/VERIFY owns turn-level execution gates. -->

**Pipeline:** `INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

The six phases describe delivery capabilities, **not six mandatory work packages for every request**. Apply only the phases needed to satisfy the current acceptance criteria and risk profile. `QUICK` work may compress several phases into one short execution loop; review/status/question work may have no BUILD or SHIP phase at all.

## Pipeline-Owned Operating Contract

`skills/_shared/protocols/pipeline-operating-contract.md` is the canonical owner of the elite-team behavior applied across **every route**, whether or not a specialist skill is loaded:
- outcome-first consulting and safe scope;
- hidden/cross-domain risk anticipation and specialist routing;
- adversarial research, instruction-boundary safety, verification/audit/learning;
- reference-grounded visual basis and conformance when visual acceptance is material.

Before specialist dispatch, the pipeline prepares the compact `PIPELINE_CONTEXT` envelope. Skills consume that envelope and apply domain expertise under `skill-specialization-contract.md`; they do not each recreate the generic operating loop.

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
| **INTERPRET** | Resolve desired outcome, authority/truth, constraints and instruction boundary | Goal and material ambiguity are clear enough to act |
| **DEFINE** | Build `PIPELINE_CONTEXT`: acceptance/non-goals, safe scope, cross-domain risk owners, material research, visual basis when applicable; choose effort/plan | Context envelope is decision-ready and plan is proportional |
| **BUILD** | Dispatch specialists with the envelope; make the smallest compatible implementation/change | Specialist output exists without silent scope/authority drift |
| **HARDEN** | Domain verification plus pipeline acceptance/risk/visual/audit closure | Evidence matches risk and material findings/signals are resolved |
| **SHIP** | Package/deploy/release only when requested or required by acceptance | Release gate/rollback/compatibility obligations pass |
| **SUSTAIN** | Operate, monitor, iterate only when ongoing operation is in scope | Operational objective or monitoring contract is satisfied |

## Phase Compression Rules

- `QUICK`: minimal interpretation + mini-plan + direct execution + focused verification. No numeric plan score, broad research, ADR/BRD, extra workers, or hardening suite unless evidence raises risk.
- `STANDARD`: normal bounded planning, targeted implementation/tests, proportional review.
- `DEEP`: explicit trade-offs, stronger verification, independent review, compatibility/rollback where relevant.
- A phase must not create work merely because its name exists in the pipeline.
- Stop when acceptance criteria are met and residual risk is acceptable. Optional improvements belong under `Out of scope` / `Later`.

## Role Standard

Every domain role operates at **senior level** regardless of model/routing tier. Senior means evidence-backed domain judgment, ownership, trade-off awareness, and the ability to challenge contradictions inside its authority — not extra documents or verbosity.

Skills follow `skill-specialization-contract.md`: domain authority, specialist inputs/heuristics/artifacts/failure modes/verifiers/handoff. Cross-domain operating behavior remains owned by the pipeline. A specialist returns `DOMAIN_FINDING` for newly discovered scope/risk dependencies instead of silently becoming the orchestrator.

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
