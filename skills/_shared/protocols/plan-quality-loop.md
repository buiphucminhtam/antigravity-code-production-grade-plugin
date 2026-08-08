---
id: plan-quality-loop
title: Plan Quality Loop Protocol
summary: Core protocol for plan quality loop.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Plan Quality Loop Protocol

<!-- source: skills/_shared/protocols/plan-quality-loop.md -->
<!-- This is the single source of truth for the Plan Quality Loop -->

**MANDATORY: Right-size planning before execution.** Use the effort class from the Senior Execution Contract / kernel.

### `QUICK` fast path
For clear, reversible, low-risk work, use a three-field mini-plan: `ACTION | TARGET | CHECK`. Do not numeric-score the plan or trigger research merely to improve a score. Escalate to the full loop if grounding reveals a HARD signal or materially wider blast radius.

### `STANDARD` / `DEEP` loop
1. **PLAN** — Create a plan against the rubric below
2. **SCORE** — Score against the applicable mode-specific threshold
3. **META-EVALUATE** — Check the complexity-scaled threshold
4. **IMPROVE** (if materially below threshold) — close evidence/constraint gaps, research only when needed, then re-plan
5. **EXECUTE** — Only after the applicable threshold passes

## 10-Criteria Rubric

| Criterion | Default Weight | Description |
|-----------|---------------|-------------|
| **Completeness** | 1.0 | Plan covers all required elements |
| **Specificity** | 1.0 | Plan has concrete, actionable steps |
| **Feasibility** | 1.0 | Plan can realistically be executed |
| **Risk Awareness** | 1.0 | Plan identifies and mitigates risks |
| **Scope Control** | 1.0 | Plan maintains clear scope boundaries |
| **Dependency Ordering** | 1.0 | Tasks are in correct dependency order |
| **Testability** | 1.0 | Plan can be verified with concrete criteria |
| **Impact Assessment** | 1.0 | Plan considers downstream effects |
| **Evidence Verification** | 1.0 | Plan lists assumptions and details how they will be verified (Evidence-First) |
| **Verification Fit** | 1.0 | Plan chooses deterministic evidence proportional to risk and states any residual uncertainty honestly |

## Complexity-Scaled Thresholds (P1-1)

**Pass threshold adapts to task complexity — simple tasks don't need Full Build rigor. `QUICK` work uses the fast path above and skips numeric scoring.**

```
┌──────────────────────────────────────────────────────────────────┐
│ COMPLEXITY-SCALED PLAN THRESHOLDS                                │
├──────────────────────────────────────────────────────────────────┤
│ Mode                    │ Threshold │ Max Iterations │ Rationale │
│ ────────────────────────│───────────│────────────────│───────────│
│ Explore, Research       │ ≥ 6.0/10  │ 1              │ Discovery │
│ Review, Test, Document  │ ≥ 7.0/10  │ 1              │ Focused   │
│ Feature, Debug, Optimize│ ≥ 8.0/10  │ 2              │ Scoped    │
│ Full Build, Ship, Game  │ ≥ 9.0/10  │ 3              │ Critical  │
│ XR Build, AI Build      │ ≥ 9.0/10  │ 3              │ Critical  │
│ Harden, Migrate         │ ≥ 8.5/10  │ 2              │ High risk │
└──────────────────────────────────────────────────────────────────┘
```

**Rules:**
- Default threshold (mode not listed): **≥ 8.0/10, max 2 iterations**
- If `.production-grade.yaml` overrides `planQuality.threshold`, that value takes precedence
- Session tracker still applies: ≥2 consecutive failures → Research Gate MANDATORY regardless of mode

## Mode-Specific Criteria Weights (P1-2)

**Different modes prioritize different criteria.** Weighted score = Σ(criterion × weight) / Σ(weights).

| Criterion | Review/Test | Feature | Full Build | Explore |
|-----------|:-----------:|:-------:|:----------:|:-------:|
| Completeness | 1.0 | 1.0 | 1.0 | 0.5 |
| Specificity | 1.0 | 1.0 | 1.0 | 0.5 |
| Feasibility | 0.5 | 1.0 | **1.5** | 0.3 |
| Risk Awareness | 0.3 | 0.8 | **1.5** | 0.3 |
| Scope Control | 0.5 | **1.2** | 1.0 | 0.3 |
| Dependency Ordering | 0.3 | 1.0 | **1.5** | 0.3 |
| Testability | **1.5** | 1.0 | 1.0 | 0.3 |
| Impact Assessment | **1.5** | 1.0 | 0.8 | 0.3 |
| Evidence Verification | 1.0 | 1.0 | 1.0 | 0.5 |
| Verification Fit | 1.0 | 1.2 | 1.2 | 0.5 |

**Calculation example (Review mode):**
```
Raw scores:   [9, 8, 10, 7, 9, 8, 9, 10, 8, 9]
Weights:      [1.0, 1.0, 0.5, 0.3, 0.5, 0.3, 1.5, 1.5, 1.0, 1.0]
Weighted sum: 9×1.0 + 8×1.0 + 10×0.5 + 7×0.3 + 9×0.5 + 8×0.3 + 9×1.5 + 10×1.5 + 8×1.0 + 9×1.0
            = 9 + 8 + 5 + 2.1 + 4.5 + 2.4 + 13.5 + 15 + 8 + 9 = 76.5
Sum weights:  1.0 + 1.0 + 0.5 + 0.3 + 0.5 + 0.3 + 1.5 + 1.5 + 1.0 + 1.0 = 8.6
Final score:  76.5 / 8.6 = 8.89 → check against Review threshold (≥ 7.0) → ✅ PASS
```

**If mode not listed:** Use default weights (all 1.0).

## Scoring Calibration Examples (P1-3)

**Use these examples to calibrate scoring consistency across sessions.**

### Completeness (Does the plan cover everything needed?)

| Score | Example |
|:-----:|---------|
| 5/10 | "Add user authentication" — no details on which auth method, storage, or flows |
| 7/10 | "Implement JWT auth with bcrypt hashing, login/register endpoints" — missing password reset, rate limiting |
| 9/10 | "Implement JWT auth with bcrypt, refresh token rotation, rate limiting (100/min), password reset via email, account lockout after 5 failed attempts" |

### Specificity (Are steps concrete and actionable?)

| Score | Example |
|:-----:|---------|
| 5/10 | "Set up the database" — which database? what schema? |
| 7/10 | "Create PostgreSQL tables for users and orders with indexes" — missing specific columns, constraints |
| 9/10 | "Create PostgreSQL: `users` table (id UUID PK, email UNIQUE, password_hash VARCHAR(60), created_at TIMESTAMPTZ), `orders` table (id UUID PK, user_id FK → users, status ENUM, total DECIMAL(10,2)), index on orders.user_id" |

### Feasibility (Can this realistically be executed?)

| Score | Example |
|:-----:|---------|
| 5/10 | "Build a real-time collaborative editor" — for a 1-person team in 2 days |
| 7/10 | "Build a REST API with CRUD operations" — feasible but no time/resource consideration |
| 9/10 | "Build REST API: 4 endpoints, estimated 3 hours, using existing Express setup. Risk: if auth middleware is complex, may take 4 hours. Fallback: use simple API key auth first" |

### Risk Awareness (Does the plan identify and mitigate risks?)

| Score | Example |
|:-----:|---------|
| 5/10 | "Deploy to production" — no mention of what could go wrong |
| 7/10 | "Deploy to production. Rollback plan: revert to previous version" — identifies rollback but not specific failure scenarios |
| 9/10 | "Deploy to production. Risks: (1) DB migration may lock tables → run during low-traffic window, (2) New auth flow may break existing sessions → deploy with feature flag, (3) CDN cache invalidation → pre-warm critical paths" |

### Evidence Verification (Are assumptions listed and verifiable?)

| Score | Example |
|:-----:|---------|
| 5/10 | Plan uses assumptions without stating them |
| 7/10 | "Assumption: API uses REST" — stated but not verified |
| 9/10 | "Assumption: API uses REST → VERIFY by reading `routes.ts`. Assumption: DB supports JSON columns → VERIFY by checking PostgreSQL version ≥ 9.4" |

## Research Flow

Research is for a **material knowledge/evidence gap**, not for cosmetic score inflation. A `STANDARD` / `DEEP` plan below threshold should first identify *why* it is weak. If current workspace/project evidence already answers the issue, improve the plan directly without browsing.

Open `research-gate.md` only when an unknown fact can change the next decision. Use the cheapest authoritative source first; NotebookLM or web search are optional tools, not mandatory stages.

Session tracking may record actual `STANDARD` / `DEEP` plan scores for telemetry, but an attempt counter does not itself mandate research or framework mutation. `QUICK` work should not be numerically scored solely for tracking.

## BA / Clarification Boundary

Route to BA or ask a user question only when unresolved requirements can materially change the product contract, scope/cost, safety, irreversible data, public behavior, or expensive architecture direction. Do not force elicitation merely because a numeric completeness score is low.

Max iterations per mode apply to `STANDARD` / `DEEP` work (see threshold table above). `QUICK` work must still ground and verify, but uses the fast path instead of the numeric loop.

---

*Source: skills/_shared/protocols/plan-quality-loop.md*
*Synced to: AGENTS.md, CLAUDE.md*

