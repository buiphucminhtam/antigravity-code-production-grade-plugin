---
id: middleware-chain
title: Middleware Chain Protocol
summary: Core protocol for middleware chain.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Middleware Chain Protocol

> **Purpose:** Guarantee deterministic, ordered execution of cross-cutting concerns before and after every skill invocation. Replaces the current ad-hoc protocol reading pattern with a fixed-order chain. Inspired by DeerFlow 2.0's 12-middleware architecture.

## Overview

The Middleware Chain wraps every skill execution with ordered pre/post hooks. Unlike the current system where skills read protocols on-demand (unpredictable order), the middleware chain guarantees that safety checks, context management, and tracking always run in the same sequence.

```
User Request
├──────────────────────────────────────────────────────┤
│ MIDDLEWARE CHAIN — Pre-Skill (top to bottom)         │
│                                                      │
│  ① SessionData     Load profile, session state       │
│  ② ContextLoader   Load memory, conventions, KIs     │
│  ③b DryRunContext  System Prompt injection (if mock) │
│  ③ SkillRegistry   Progressive skill discovery       │
│  ④ Guardrail       Pre-tool authorization            │
│  ⑤ Summarization   Auto-compress if > 70% budget     │
│                                                      │
├─────────────────────────────────────────────────────┤
│ ═══════ SKILL EXECUTION ═══════                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ MIDDLEWARE CHAIN — Post-Skill (bottom to top)        │
│                                                     │
│  ⑥ QualityGate     Post-skill validation (4 levels) │
│  ⑦ BrownfieldSafety Regression + protected paths   │
│  ⑧ TaskTracking    Update todos, emit events        │
│  ⑨ Memory          Durable context when useful       │
│  ⑩ GracefulFailure Two-failure stuck/escalation     │
│  ⑪ RecoveryResearch Research only material unknowns │
│                      (project-local lessons only)    │
│  ⑫ CircuitBreaker  Fault isolation + state machine  │
│  ⑬ Bulkhead        Resource limits per worker type  │
│  ⑭ Verification    ⭐ Evidence-First Verification   │
│                                                     │
└─────────────────────────────────────────────────────┘
  │
  ▼
Result / Next Skill
```

## Chain Definition

### Pre-Skill Middleware (runs BEFORE skill)

| # | Middleware | Source Protocol | Hook | Purpose |
|---|-----------|----------------|------|---------|
| ① | **SessionData** | session-lifecycle.md §Steps 1-3 | `before_skill()` | Load project-profile.json, session-log.json, detect manual changes |
| ② | **ContextLoader** | session-lifecycle.md §Step 4 + memory-manager | `before_skill()` | Search local_memory with task keywords, load code-conventions.md |
| ③b| **DryRunContext** | dryrun-interceptor.md | `before_skill()` | Inject global system prompt instructing AI it is in test mode (Option B) |
| ③ | **SkillRegistry** | skills-config.json | `before_skill()` | Filter available skills by classified mode (progressive loading) |
| ④ | **Guardrail** | guardrail.md | `before_tool()` | Authorize each tool call against allow/blocklist rules (Option A integration) |
| ⑤ | **Summarization** | summarization.md | `before_skill()` | Compress old context if above 70% token budget |

### Post-Skill Middleware (runs AFTER skill)

| # | Middleware | Source Protocol | Hook | Purpose |
|---|-----------|----------------|------|---------|
| ⑥ | **QualityGate** | quality-gate.md | `after_skill()` | Run verification proportional to `QUICK` / `STANDARD` / `DEEP`; score only when useful telemetry |
| ⑦ | **BrownfieldSafety** | brownfield-safety.md | `after_skill()` | Regression check, protected path enforcement, change manifest |
| ⑧ | **TaskTracking** | session-lifecycle.md §Hooks | `after_skill()` | Emit SKILL_COMPLETED event, update task.md |
| ⑨ | **Memory** | memory-manager.md + middleware/09-memory.md | `after_skill()` / `turn_close()` when useful | Persist verified durable decisions/progress/blockers for substantial work; memory is optional support, not project truth |
| ⑩ | **GracefulFailure** | graceful-failure.md | `on_error()` | Detect stuck states and enforce the kernel two-failure stop/escalation rule. |
| ⑪ | **RecoveryResearch** | research-gate.md | `on_error()` | No-op unless a material knowledge/evidence gap exists; research the minimum evidence needed, never self-modify shared skills. |
| ⑫ | **CircuitBreaker** | circuit-breaker.md | `after_skill()` when remote/tool failure isolation applies | Fault isolation for repeated remote/tool failures; provider-specific call requirements belong in verified runtime adapters, not this generic protocol |
| ⑬ | **Bulkhead** | bulkhead.md | `after_skill()` | Enforce resource limits per worker type |
| ⑭ | **Verification** | verification.md | `after_skill()` | Verify all assumptions using Evidence-First Thinking |

## Execution Rules

### Rule 1 — Fixed Order, No Skipping

```
ALWAYS: Traverse middleware in deterministic order.
A slot may be a deliberate no-op when it is not applicable to the current effort/risk class; do not manufacture artifacts merely to prove the slot ran.

If middleware is disabled in `.production-grade.yaml`, its slot is recorded as skipped so ordering remains deterministic.
```

### Rule 2 — Fail-Fast for Pre-Skill, Continue for Post-Skill

```
Pre-Skill (①-⑤):
  IF middleware fails:
    - ① SessionData: WARN and continue with empty profile (new project)
    - ② ContextLoader: WARN and continue without memory
    - ③b DryRunContext: WARN and continue without prompt injection
    - ③ SkillRegistry: inspect manifest/index and load the smallest safe candidate set; do not blindly load the whole registry
    - ④ Guardrail: BLOCK — do not proceed to skill (security-critical)
    - ⑤ Summarization: WARN and continue (non-critical)

Post-Skill:
  IF an observability-only middleware fails: log degradation and continue.
  IF verification, security, brownfield safety, or an acceptance-critical gate fails: do not claim success; preserve/revert according to the relevant protocol and resolve/escalate.
```

### Rule 3 — Guardrail Is the Kill Switch

Middleware ④ (Guardrail) is the ONLY middleware that can BLOCK skill execution:

```
IF Guardrail returns DENY:
  → Stop middleware chain immediately
  → Do NOT execute the skill
  → Return error to user: "Blocked by guardrail: [reason]"
  → Log to session-log.json

IF Guardrail returns WARN:
  → Log warning but continue
  → Proceed to skill execution

IF Guardrail returns WARN_DRYRUN_MOCK:
  → Log interception
  → MOCK tool execution without touching disk
  → Return simulated success to agent

IF Guardrail returns ALLOW:
  → Continue normally
```

### Rule 4 — Per-Tool vs Per-Skill Hooks

```
Per-Skill hooks (run once per skill invocation):
  ① SessionData.before_skill()
  ② ContextLoader.before_skill()
  ③b DryRunContext.before_skill()
  ③ SkillRegistry.before_skill()
  ⑤ Summarization.before_skill()
  ⑥ QualityGate.after_skill()
  ⑦ BrownfieldSafety.after_skill()
  ⑧ TaskTracking.after_skill()
  ⑨ Memory.after_skill() / Memory.turn_close() when durable state exists
  ⑩ GracefulFailure.on_error()
  ⑪ RecoveryResearch.on_error() only for a material unknown after failure

Per-Tool hooks (run on EVERY tool call within a skill):
  ④ Guardrail.before_tool()    ← runs before each write_to_file, run_command, etc.
  ⑦ BrownfieldSafety.before_write()  ← runs before each file write
```

## Configuration

```yaml
# .production-grade.yaml
middleware:
  enabled: true
  chain:
    - name: session-data
      enabled: true
    - name: context-loader
      enabled: true
    - name: dry-run-context
      enabled: true
    - name: skill-registry
      enabled: true
      fallback: load_all  # if classification fails
    - name: guardrail
      enabled: true
      mode: warn  # warn | deny | disabled | dry_run (start with warn, graduate to deny; use dry_run for testing)
    - name: summarization
      enabled: true
      threshold: 0.7
    - name: quality-gate
      enabled: true
    - name: brownfield-safety
      enabled: true  # auto-disabled for greenfield
    - name: task-tracking
      enabled: true
    - name: memory
      enabled: true
    - name: graceful-failure
      enabled: true
    - name: asip
      enabled: true
      enforceResearchGate: true  # Cannot be disabled - safety critical
      planQuality:
        threshold: 9.0
        mandatoryResearchAfter: 2
      executionBlocker:
        failureThreshold: 2
    - name: circuit-breaker
      enabled: true
      failure_threshold: 3
      timeout_duration: 60
      recovery_timeout: 120
    - name: bulkhead
      enabled: true
      max_concurrency: 5
    - name: verification
      enabled: true
      enforceEvidenceFirst: true
```

## Integration with Existing Protocols

The middleware chain does NOT replace existing protocol files — it **orders their execution**:

| Current (ad-hoc) | Middleware Chain (ordered) |
|-------------------|---------------------------|
| Skills read quality-gate.md whenever they want | ⑥ QualityGate always runs after skill completes |
| brownfield-safety.md checked "always" but not enforced | ⑦ BrownfieldSafety runs in post-skill chain, consistently |
| session-lifecycle.md has 5 steps at start | ①② cover those 5 steps, guaranteed before any skill |
| graceful-failure.md read on error | ⑩ GracefulFailure catches errors with unified handler |
| No guardrail concept exists | ④ NEW — Guardrail blocks dangerous operations |
| No summarization concept exists | ⑤ NEW — Summarization manages context budget |

## Lifecycle Events

The middleware chain emits structured events (consumed by TaskTracking middleware ⑧):

```
CHAIN_STARTED     { session_id, mode, timestamp }
MIDDLEWARE_RUN     { middleware_name, hook, duration_ms, status }
SKILL_STARTED     { skill_id, mode, timestamp }
SKILL_COMPLETED   { skill_id, quality_score, files_changed, timestamp }
SKILL_FAILED      { skill_id, error_type, retry_count, timestamp }
CHAIN_COMPLETED   { session_id, total_duration_ms, skills_run, timestamp }
```

## Monitoring

After each middleware chain execution, log summary:

```
━━━ Middleware Chain Summary ━━━━━━━━━━━━━━━━━━━━
  ① SessionData:      ✓ 12ms   (profile loaded)
  ② ContextLoader:    ✓ 45ms   (3 memories retrieved)
  ③ SkillRegistry:    ✓ 8ms    (loaded 5/52 skills)
  ④ Guardrail:        ✓ 2ms    (0 blocked, 0 warned)
  ⑤ Summarization:    ⊘ skip   (context within budget)
  ═══ Skill: qa-engineer (42.3s) ═══
  ⑥ QualityGate:      ✓ 180ms  (score: 87/100)
  ⑦ BrownfieldSafety: ✓ 320ms  (0 regressions)
  ⑧ TaskTracking:     ✓ 5ms    (SKILL_COMPLETED emitted)
  ⑨ Memory:           ✓ 15ms   (2 facts extracted)
  ⑩ GracefulFailure:  ✓ 1ms    (no errors)
  ⑪ ASIP:             ✓ 2ms    (no errors)
  ⑫ CircuitBreaker:   ✓ 1ms    (state: CLOSED)
  ⑬ Bulkhead:         ✓ 2ms    (concurrency: 1)
  ⑭ Verification:     ✓ 12ms   (all evidence verified)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
