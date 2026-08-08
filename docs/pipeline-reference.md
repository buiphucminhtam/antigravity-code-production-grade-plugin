# Pipeline Reference

Forgewright uses six canonical delivery phases:

`INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

The phase inventory is pinned by `product-manifest.json`. Detailed phase semantics live in `skills/_shared/protocols/pipeline.md`; turn-level behavior and verification are enforced by `kernel/ENTRY.md`, `kernel/SOLVE.md`, and `kernel/VERIFY.md`.

## Proportional execution

The pipeline is not a checklist that manufactures work. Classify effort before expanding the plan:

| Effort | Typical use | Delivery behavior |
|---|---|---|
| `QUICK` | Clear, local, reversible, low risk | Mini-plan, direct change, focused verifier; phases may be compressed |
| `STANDARD` | Normal bounded feature/debug/refactor | Scoped plan, targeted tests, normal review |
| `DEEP` | Security, public contract/schema, concurrency, irreversible/release-critical or high-blast-radius work | Explicit trade-offs, stronger evidence, independent review/rollback where relevant |

A status check or review may need only INTERPRET/DEFINE/HARDEN. A local fix may compress INTERPRET/DEFINE/BUILD/HARDEN. SHIP and SUSTAIN run only when the user objective requires them.

## Phase reference

| Phase | Responsibility |
|---|---|
| **INTERPRET** | Clarify objective, relevant context, constraints, verified facts vs assumptions |
| **DEFINE** | Acceptance criteria, non-goals, effort class, executable plan |
| **BUILD** | Smallest compatible implementation that meets the agreed contract |
| **HARDEN** | Verification proportional to regression/security/reliability risk |
| **SHIP** | Packaging/deployment/release gates only when in scope |
| **SUSTAIN** | Monitoring/operations/iteration only when ongoing operation is in scope |

## Senior role contract

Every routed domain role is senior by behavior, not by provider/model name: it owns outcomes, grounds claims in current evidence, reasons about trade-offs, challenges contradictions and unnecessary work, and protects client scope/time/budget. See `skills/_shared/protocols/senior-execution-contract.md`.

Routing tiers (`scout`, `builder`, `expert`) express capability/cost, not competence. Provider/model selection follows `skills/_shared/protocols/model-tier.md`; skill frontmatter must not pin a provider model.

## Planning and optimization

`QUICK` work uses `ACTION | TARGET | CHECK` and no numeric plan score. `STANDARD`/`DEEP` use the complexity-scaled thresholds in `skills/_shared/protocols/plan-quality-loop.md`. There is no universal 9/10 gate.

Optimization needs an explicit target/SLA, measurement, a known platform/resource/cost constraint, or an evident algorithmic/reliability defect at required scale. Otherwise prefer a simple observable baseline and defer speculative optimization.

## Evidence hierarchy

For project facts: current workspace/runtime evidence → executable tests/build/lint/typecheck/probes → current project contracts/docs → verified external docs → memory/examples/templates. The latter are context hints, not proof of current state.

A success claim must satisfy the kernel `VERIFY` contract. Higher-tier model output is still an unverified claim until checked.

---

*Updated: 2026-08-08*
