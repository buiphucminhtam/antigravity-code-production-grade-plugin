---
id: parallel-protocol
title: Parallel Subagent Protocol
summary: Core protocol for parallel protocol.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Parallel Subagent Protocol

> **Purpose:** Formalize how to spawn and coordinate subagents based on dependency analysis. Inspired by CCGS `coordination-rules.md`.

## Core Principles

1. **Independent first** — Spawn all independent tasks before waiting
2. **Block surfacing** — Never silently skip blocked agents
3. **Partial reports** — Always report what succeeded and what failed
4. **Explicit dependencies** — Never assume one task's output

## Bounded Peer Advisory Mode

The worker waves below describe parent-dispatched tasks. They do not authorize
peer-to-peer chat or shared mutable state. When `PIPELINE_CONTEXT` explicitly
requests `collaboration.mode: bounded-advisory`, apply
[`peer-collaboration.md`](peer-collaboration.md) instead of inventing a mesh.

- The parent/orchestrator remains broker, policy owner, observer, and final
  arbiter.
- The same-process `TrustedParentHostAdapter` and its out-of-band
  `TrustedHostCapability` belong to the parent TCB and are never peer-provided or
  manifest-loaded. Participant callbacks receive JSON-compatible assignments,
  never a broker, controller, channel, callable, or capability; they return
  untrusted event mappings for private parent validation/publication.
- Enforce finite hard limits for participants, rounds, events, bytes, and the
  deadline. The peer protocol adds no token, cost, or goal quota and no recursive
  spawn.
- Unsupported capability, malformed event, stale artifact, deadline expiry, or
  unresolved disagreement closes the advisory attempt and falls back to the
  equivalent parent-serial handoff. Without a parent serial executor, execution
  records `parent-serial-required` and returns nonzero.

The implemented path is a serial, thread-safe `InProcessBroker` with a bounded,
hash-chained, parent-owned JSONL event log. Adapter callbacks share the policy
deadline; a timed-out daemon thread cannot be portably killed, so trusted
adapters must honor `cancel(reason)` and late results are discarded.

## Dependency Analysis

### Step 1: Identify Tasks

List all tasks in the current phase:

```
Phase: BUILD
Tasks:
  - T3a: software-engineer → outputs: services/, libs/
  - T3b: frontend-engineer → outputs: frontend/
  - T3c: mobile-engineer → outputs: mobile/  [conditional]
  - T4: devops → inputs: services/ → outputs: Dockerfile*
```

### Step 2: Build Dependency Graph

For each task, identify:
- **Inputs**: What does this task need from other tasks?
- **Outputs**: What does this task produce?
- **Dependencies**: Which tasks must complete before this one starts?

```
Dependency Graph:
  T3a ─┬─→ T4 (T4 needs services from T3a)
  T3b ─┘
  T3c ──→ (independent)
```

### Step 3: Group by Dependency Level

| Level | Description | Execution |
|-------|-------------|-----------|
| 0 | No dependencies | Parallel |
| 1 | Depends on Level 0 | Wait for parallel group |
| 2+ | Depends on Level 1+ | Sequential |

### Step 4: Wave Planning

```
Wave 1 (Level 0 — Parallel):
  - T3a: software-engineer
  - T3b: frontend-engineer
  - T3c: mobile-engineer  [if enabled]

Wave 2 (Level 1 — After Wave 1):
  - T4: devops  [needs T3a services]
  - T5: qa-engineer  [needs T3a + T3b code]

Wave 3 (Level 2 — After Wave 2):
  - T6a: security-engineer
  - T6b: code-reviewer
```

## Parallel Execution Rules

### Rule 1: Issue All Before Waiting

```
❌ BAD:
  result1 = spawn Task(task_a)  # Wait for result
  result2 = spawn Task(task_b)  # Too late!

✅ GOOD:
  spawn Task(task_a)  # Fire all at once
  spawn Task(task_b)
  spawn Task(task_c)
  result1 = wait for task_a
  result2 = wait for task_b
  result3 = wait for task_c
```

### Rule 2: Surface Blocks Immediately

```
❌ BAD:
  # Agent blocked but we continue silently
  log: "Phase complete"

✅ GOOD:
  if agent.status == BLOCKED:
    log: "⚠️ AGENT BLOCKED: [agent-name]"
    log: "  Reason: [reason]"
    log: "  Action: [recommended action]"
    # Still collect results from non-blocked agents
```

### Rule 3: Partial Reports

Even if some agents fail, report what succeeded:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Parallel Execution Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ T3a: Software Engineer — Complete (services/auth, services/users)
✅ T3b: Frontend Engineer — Complete (frontend/dashboard)
⏳ T3c: Mobile Engineer — Pending (waiting for T3a API)
❌ T4: DevOps — Blocked (missing service discovery)

⚠️ 1 blocked, 1 pending
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Rule 4: Explicit Output Dependencies

Never assume one task's output:

```
❌ BAD:
  # Assumes T3a completed before starting T4
  start DevOps()

✅ GOOD:
  if T3a.is_complete():
    services = read_output(T3a)
    start DevOps(services)
  else:
    log: "Cannot start DevOps — T3a not complete"
    block
```

## Implementation Checklist

### Before Spawning

- [ ] List all tasks
- [ ] Identify inputs and outputs for each
- [ ] Build dependency graph
- [ ] Group by dependency level
- [ ] Plan waves
- [ ] Check MAX_WORKERS limit

### During Execution

- [ ] Spawn all Level 0 tasks simultaneously
- [ ] Monitor for BLOCKED status
- [ ] Surface blocks immediately
- [ ] Collect partial results
- [ ] Wait for wave completion before next

### After Wave

- [ ] Verify all outputs exist
- [ ] Check for merge conflicts
- [ ] Run merge arbiter if needed
- [ ] Start next wave if dependencies met

## Quality Gates

### Wave Completion Check

Before starting the next wave:

```
1. Count completed tasks in wave
2. Count blocked tasks in wave
3. If blocked > 0:
   - Log warning
   - Decide: retry, skip, or escalate
4. If dependencies not met:
   - Log: "Waiting for [task] output"
   - Block until ready
5. If all complete:
   - Log: "Wave [N] complete — starting Wave [N+1]"
   - Start next wave
```

## Risk Matrix

| Risk | Condition | Severity | Mitigation |
|------|-----------|----------|------------|
| Merge conflict | shared_deps > 2 | Medium | Merge Arbiter auto-resolves |
| Schema divergence | Multiple workers same schema | Medium | Contract locks schema readonly |
| Version mismatch | Conflicting package versions | Low | Union + dedupe |
| Integration fail | Workers build against stale API | Medium | Shared frozen API snapshot |
| Resource exhaustion | 4+ concurrent processes | Low | MAX_WORKERS cap |

## Integration with Forgewright

This protocol is automatically used when:
1. `execution: parallel` in `.forgewright/settings.md`
2. Phase has 2+ independent tasks
3. Using parallel-dispatch skill

See `skills/parallel-dispatch/SKILL.md` for full implementation.

## History

- v1.0 — Initial protocol (inspired by CCGS parallel task protocol)
