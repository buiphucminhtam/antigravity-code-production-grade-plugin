---
id: skill-specialization-contract
title: Skill Specialization Contract
summary: Keeps each skill deeply domain-specific while pipeline middleware owns cross-cutting operating behavior.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [skill-maker, skill-upgrader, skill-registry]
related: [pipeline-operating-contract]
supersedes: []
superseded_by: null
---

# Skill Specialization Contract

A Forgewright skill is a **senior specialist capability**, not a miniature orchestrator. The pipeline owns generic consulting, cross-domain risk anticipation, generic research/instruction-boundary enforcement, self-audit/learning, and cross-cutting visual gates. Skills deepen the answer with domain expertise.

## Required Specialist Shape

A mature skill should make these seven things explicit, either in `SKILL.md` or its referenced phases:

1. **Domain Authority** — decisions this skill owns, and decisions it must not override.
2. **Specialist Inputs** — project/domain artifacts needed beyond the pipeline context envelope.
3. **Specialist Heuristics** — theories, frameworks, trade-offs, failure patterns, and judgment rules unique to the discipline.
4. **Domain Artifacts** — the concrete outputs this specialty creates or updates.
5. **Domain Failure Modes** — mistakes a non-specialist or weak model commonly misses in this discipline.
6. **Domain Verifiers** — tests, measurements, inspections, simulations, or review evidence that can prove specialist quality.
7. **Handoff Contract** — what downstream roles receive and what remains outside this skill's authority.

A `LITE.md` overlay distills only the highest-value specialist checks/actions from this shape. It must not restate the whole pipeline.

## Pipeline vs Skill Boundary

The skill receives `PIPELINE_CONTEXT` containing objective, acceptance, constraints/non-goals, scope, verified facts, cross-domain risk signals, relevant research, and visual basis when applicable.

The skill **consumes** that context. It does not normally recreate:
- `Minimum Safe Scope / Value Scope / Later / Non-goals`;
- the generic hidden-risk radar across every discipline;
- the generic research trigger/source-trust/instruction-boundary loop;
- the generic VERIFY → AUDIT → LEARN loop;
- the generic visual-basis gate for non-visual skills.

When specialist work reveals a scope-changing or cross-domain fact, return it as a `DOMAIN_FINDING` to the pipeline. The pipeline decides whether to re-scope, research, or route another specialist.

## What Domain Depth Looks Like

Good specialization uses the discipline's actual vocabulary and decision machinery:
- Product Manager: JTBD/problem framing, segmentation, value proposition, prioritization, metrics trees, experiments, packaging/economics, acceptance traceability.
- Security Engineer: assets/actors/trust boundaries, STRIDE/OWASP, abuse cases, exploit preconditions, reachability, severity, remediation, residual risk, agentic/tool security.
- UI Designer: information hierarchy, typography, spacing/grid, semantic tokens, component anatomy/states, responsive/safe-area behavior, accessibility, visual rhythm.
- Art Director: style DNA, silhouette/shape language, palette/color script, materials, lighting, camera, asset-family consistency, generation/review contracts.
- UX Researcher: research questions, method selection, sampling/segments, task analysis, qualitative coding, behavioral vs attitudinal evidence, bias/confounds, severity.
- Frontend Engineer: component boundaries, rendering/data-fetching model, state ownership, typed API integration, accessibility semantics, performance/hydration, frontend tests.
- Game Designer: player promise, core loop, MDA/system dynamics, progression/economy, balance/tunables, onboarding, difficulty, reward schedules, game feel, playtest hypotheses.

A skill that mostly says "research first, check security, verify, audit, learn" is not specialized enough; the pipeline already does that.

## LITE Overlay Standard

Prefer:
- 3–6 **domain grounding checks** that inspect specialist inputs;
- 3–7 **domain actions** expressed as `ACTION | TARGET | CHECK`;
- 4–8 **domain mistakes/failure modes**;
- no fabricated PASS output, fake paths, or pretend measurements;
- no provider/model pinning unless the specialty is explicitly a provider adapter.

For a visual skill, reference fidelity can be specialist content because visual judgment is the domain. For a security skill, prompt/tool/memory injection can be specialist content because exploitability is the domain. The distinction is **domain depth**, not keyword prohibition.

## Authoring Review

Before accepting a new or upgraded skill, ask:
- Could most of this text be pasted unchanged into an unrelated skill? If yes, move it to pipeline/shared protocols.
- Does the skill contain real domain decisions and failure modes that a generalist would miss?
- Are its artifacts and verifiers specific enough that another role can consume them without guessing?
- Does it respect authority boundaries and return cross-domain findings to the pipeline instead of silently owning them?

If these checks fail, the skill is an orchestrator prompt wearing a specialist name; revise it.
