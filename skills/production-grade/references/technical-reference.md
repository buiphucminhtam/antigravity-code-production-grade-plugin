# Technical Configuration and System Reference

<!-- source: skills/production-grade/references/technical-reference.md -->

## Metrics, Performance, and Configuration Reference

### Metrics Collection

Track these metrics per pipeline execution:

```json
{
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "mode": "full-build|feature|...",
  "engagement": "express|standard|thorough|meticulous",
  "execution": "sequential|parallel",
  "duration_minutes": 0,
  "skills_invoked": ["skill1", "skill2"],
  "tasks_completed": 0,
  "tasks_total": 0,
  "quality_scores": {
    "build": 0,
    "harden": 0,
    "overall": 0
  },
  "gates_approved": 0,
  "gates_rejected": 0,
  "errors_encountered": 0,
  "retry_count": 0,
  "user_approvals": 0
}
```

### Performance Benchmarks

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Context utilization | < 70% | 70-80% | > 80% |
| Task duration | < 30 min | 30-60 min | > 60 min |
| Error rate | < 5% | 5-15% | > 15% |
| Retry rate | < 10% | 10-20% | > 20% |
| Quality score | > 90 | 80-90 | < 80 |

### Dependency Injection Pattern

For skills that need shared services:

```typescript
// Service container
interface ServiceContainer {
  logger: LoggerService;
  memory: MemoryService;
  config: ConfigService;
  metrics: MetricsService;
}

// Inject via constructor
class SoftwareEngineerSkill {
  constructor(private services: ServiceContainer) {}

  execute(context: SkillContext): SkillResult {
    this.services.logger.info('Starting software engineer skill');
    // ... implementation
  }
}
```

### Configuration Schema

`.production-grade.yaml` full schema:

```yaml
# Project metadata
project:
  name: "My Project"
  version: "0.1.0"
  description: "Project description"

# Feature flags
features:
  frontend: true        # Enable frontend development
  mobile: false        # Enable mobile development
  ai_ml: false         # Enable AI/ML features
  skip_define_ba: false # Skip BA in DEFINE phase

# Path overrides
paths:
  backend: "services"
  frontend: "frontend"
  tests: "tests"
  docs: "docs"
  infrastructure: "infrastructure"

# Quality thresholds
quality:
  block_score: 60
  minimum_score: 90
  excellent_score: 95
  coverage_threshold: 80

# Pipeline settings
pipeline:
  engagement: "standard"  # express|standard|thorough|meticulous
  execution: "parallel"    # sequential|parallel
  max_workers: 3

# Native Codex subagent model preferences. Apply a value only when the active
# spawn_agent schema advertises it for the selected model.
subagents:
  codex:
    default:
      model: "gpt-5.6-luna"
      reasoning_effort: "medium"
    tiers:
      scout: { model: "gpt-5.6-luna", reasoning_effort: "low" }
      builder: { model: "gpt-5.6-terra", reasoning_effort: "medium" }
      expert: { model: "gpt-5.6-sol", reasoning_effort: "high" }
    agent_types:
      explorer: { model: "gpt-5.6-luna", reasoning_effort: "low" }
      worker: { model: "gpt-5.6-terra", reasoning_effort: "medium" }

# Review settings
review:
  mode: "lean"           # full|lean|solo
  auto_review: true

# Coding level (1-10)
codingLevel: 8

# Brownfield settings
brownfield:
  protected_paths:
    - "config/production/*"
    - "scripts/deploy.sh"
  baseline_branch: "main"

# Game-specific (for Game Build mode)
game:
  engine: "unity"         # unity|unreal|godot|phaser|three
  platform: "web"        # web|ios|android|steam
  target_fps: 60
  mobile_fps: 30

# AI/ML settings
ai:
  model: null  # resolved from current runtime capabilities
  reasoning_effort: null  # passed only when advertised for the exact model
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FORGEWRIGHT_WORKSPACE` | Project workspace path | Current directory |
| `FORGEWRIGHT_SKIP_MEMORY` | Skip memory initialization | 0 |
| `FORGEWRIGHT_LOCAL_MEMORY` | Use local memory | 1 |
| `FORGEWRIGHT_DEBUG` | Enable debug logging | 0 |
| `FORGEWRIGHT_MAX_RETRIES` | Max retry attempts | 2 |
| `FORGEWRIGHT_TIMEOUT` | Skill timeout (seconds) | 600 |

### Emergency Procedures

**When pipeline encounters critical failure:**

1. **Assess scope:** Isolate the failure point
2. **Preserve state:** Save all progress to handoff document
3. **Evaluate options:**
   - Retry with fixes
   - Skip failed task
   - Abort and escalate
4. **Communicate:** Report to user with options
5. **Decide:** User selects course of action

**Escalation criteria:**
- Security vulnerability discovered
- Data corruption risk
- Budget/time overrun > 50%
- Unresolvable blocker after 2 failed attempts

### Cross-Skill Communication Protocol

When a material cross-skill handoff requires durable structure, use a bounded
artifact; one-step or parent-owned work keeps state in context:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ARTIFACT CONTRACT                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Authorized handoff artifacts live at:                               │
│ .forgewright/<skill-name>/<artifact-name>.json                      │
│                                                                     │
│ Artifact structure:                                                 │
│ {                                                                   │
│   "version": "1.0",                                                 │
│   "skill": "skill-name",                                            │
│   "timestamp": "ISO8601",                                           │
│   "data": { ... skill-specific data ... }                           │
│ }                                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Standard artifacts:**

| Artifact | From | To | Content |
|----------|------|-----|---------|
| `brd.json` | PM | Architect, BE, FE | User stories, acceptance criteria |
| `architecture.json` | Architect | BE, FE, DevOps | Services, API contracts, data models |
| `api-contracts.json` | Architect | BE, FE | Endpoint definitions, request/response schemas |
| `test-plan.json` | QA | QA | Test cases, coverage targets |
| `security-report.json` | Security | Security | Vulnerabilities, severity, recommendations |
| `quality-report.json` | Review | Review | Code quality findings, patterns |
| `delivery.json` | Any skill | Orchestrator | Task completion status |

### Skill Invocation Patterns

**Sequential pattern** (skills run one after another):
```
Skill A → Artifact A → Skill B → Artifact B → Skill C
```

**Parallel pattern** (skills run simultaneously):
```
┌─────────────┐
│ Artifact A   │
└─────────────┘
       │
   ┌───┴───┐
   ▼       ▼
┌───────┐ ┌───────┐
│Skill A│ │Skill B│
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
┌───────┐ ┌───────┐
│Artifact│ │Artifact│
│   A   │ │   B   │
└───┬───┘ └───┬───┘
    │         │
    └────┬────┘
         ▼
    ┌────────┐
    │Merge   │
    │Arbiter │
    └────────┘
```

**Sequential with feedback:**
```
Skill A → Artifact A → Skill B → Test B → [Fail] → Skill B fix → Artifact B updated
                                            ↓
                                          [Pass]
                                            ↓
                                       Skill C
```

### Skill Health Monitoring

Track skill performance over time:

```json
{
  "skill_health": {
    "software-engineer": {
      "invocations": 15,
      "avg_duration_minutes": 25,
      "success_rate": 0.93,
      "avg_quality_score": 88,
      "last_failure": {
        "timestamp": "2026-05-20",
        "reason": "Timeout on large service",
        "resolution": "Increased timeout, split service"
      }
    }
  }
}
```

**Health thresholds:**
- Success rate < 80%: Investigate skill
- Avg quality < 70%: Update skill guidance
- Avg duration > 60 min: Optimize skill

### Test Portfolio Guidance

Use more low-cost deterministic tests where branching logic exists, integration tests at material boundaries, and a small set of E2E tests for release-critical journeys. **Counts and coverage percentages come from risk and acceptance criteria, not fixed quotas.**

- Unit/property tests: pure logic, formulas, parsers, state machines, edge cases.
- Integration tests: persistence, messaging, SDK/API boundaries, scene/service interactions.
- E2E: only the user journeys whose failure would materially block release or revenue/core use.

Coverage is diagnostic telemetry. Prefer meaningful branch/behavior coverage over chasing a universal percentage. Raise rigor for security, billing, destructive data, public contracts, concurrency, and historically fragile code.

### Continuous Integration Template

Canonical CI is provider-neutral and local:

```bash
# scripts/ci/local-ci.sh or equivalent project-owned entrypoint
set -euo pipefail
npm ci
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
npm audit --omit=dev --audit-level=high
npm run build
```

Attach this command to local git hooks and/or an OS-native scheduler as appropriate. A hosted provider may invoke the same script only when explicitly requested; do not duplicate the gate logic into provider YAML.

### Deployment Checklist

Before any deployment:

- [ ] All tests passing
- [ ] Security scan clean
- [ ] Code review approved
- [ ] Documentation updated
- [ ] Rollback plan ready
- [ ] Monitoring configured
- [ ] Runbooks updated
- [ ] Stakeholders notified

### Monitoring & Observability

**Metrics to track:**

| Category | Metrics |
|----------|---------|
| **Business** | DAU, MAU, retention, conversion rate, revenue |
| **Performance** | Response time, throughput, error rate |
| **Reliability** | Availability, MTTR, MTBF |
| **Quality** | Test coverage, bug count, tech debt |

**Alert thresholds:**

| Alert | Threshold | Severity |
|-------|-----------|----------|
| Error rate | > 1% | Warning |
| Error rate | > 5% | Critical |
| Response time | > 500ms p95 | Warning |
| Response time | > 2000ms p95 | Critical |
| Availability | < 99.9% | Critical |
| CPU | > 80% | Warning |
| Memory | > 90% | Critical |

### Knowledge Transfer Protocol

When transitioning between sessions:

```
1. EXECUTIVE SUMMARY (3 sentences)
   - What was the goal?
   - What was accomplished?
   - What remains?

2. TECHNICAL STATE
   - Architecture decisions (key ones)
   - Current blockers
   - Next actions

3. FILE INVENTORY
   - Created/modified files
   - Their purposes

4. TESTING STATUS
   - Tests passing/failing
   - Coverage percentage

5. OPEN QUESTIONS
   - Decisions pending
   - Ambiguities unresolved

6. CONTEXT FOR CONTINUATION
   - Exact command to resume
   - Files to examine first
```

### Skill Catalog

Resolve the live skill inventory from `product-manifest.json`, `skills-registry.yaml`, and `kernel/INDEX.md`. Do not duplicate a numbered skill list here: a stale catalog can cause weak models to route to removed/renamed roles or invent missing capabilities.

### Session Lifecycle Hooks

Call only the hooks required by the active scope and durable state:

| Event | Hook | Action |
|-------|------|--------|
| Phase completes | `PHASE_COMPLETE(name, summary)` | Update durable phase state only when the project contract requires it |
| Task completes | `TASK_COMPLETE(id, name, status, summary)` | Update the active task state |
| Gate decided | `GATE_DECISION(gate#, decision, feedback)` | Persist a material gate decision |
| Architecture approved | `ARCH_DECISION(tech_stack, services, rationale)` | Persist an accepted architecture decision when durable |
| Error occurs | `ERROR(task_id, type, details)` | Persist a blocker only when needed for recovery/handoff |
| Pipeline ends | Session End | Persist only durable decisions, blockers, or resume state |
| User request answered | `TURN_CLOSE` | No mandatory memory write; close normally when no durable state changed |
