# Forgewright — System Architecture

> **Version:** 8.7.0 · **Last Updated:** 2026-08-23
>
> This document describes the canonical 5-layer architecture of Forgewright. For product-level context, see [Product Overview](product-overview.md).

<link rel="stylesheet" href="assets/architecture.css">

---

## Architecture Overview

Forgewright is organized into **5 distinct layers**, from the user-facing interaction surface down to the runtime infrastructure. Each layer has a clear responsibility boundary.

<section class="architecture-diagram architecture-stack" aria-labelledby="diagram-stack-title">
  <details class="diagram-description">
    <summary id="diagram-stack-title">Architecture Overview (5 Layers)</summary>
    <p>A vertical stack of 5 architecture layers from user interaction down to runtime execution.</p>
  </details>
  <ol>
    <li>
      <article class="layer-card">
        <div class="layer-badge">1</div>
        <div class="layer-content">
          <h3>LAYER 1: INTERACTION</h3>
          <p>IDE Rules (AGENTS.md, CLAUDE.md, GEMINI.md) &middot; Console GUI</p>
        </div>
      </article>
    </li>
    <li>
      <article class="layer-card">
        <div class="layer-badge">2</div>
        <div class="layer-content">
          <h3>LAYER 2: KERNEL</h3>
          <p>ENTRY &rarr; CLARIFY &rarr; SOLVE &rarr; VERIFY &rarr; AUDIT &rarr; ESCALATE</p>
        </div>
      </article>
    </li>
    <li>
      <article class="layer-card">
        <div class="layer-badge">3</div>
        <div class="layer-content">
          <h3>LAYER 3: CAPABILITIES</h3>
          <p>84 Skills (SKILL.md + LITE.md) &middot; 24 Modes &middot; Routing Engine</p>
        </div>
      </article>
    </li>
    <li>
      <article class="layer-card">
        <div class="layer-badge">4</div>
        <div class="layer-content">
          <h3>LAYER 4: CONTROLS</h3>
          <p>40+ Protocols &middot; Guardrails &middot; Quality Gates &middot; Memory (FluxMem)</p>
        </div>
      </article>
    </li>
    <li>
      <article class="layer-card">
        <div class="layer-badge">5</div>
        <div class="layer-content">
          <h3>LAYER 5: RUNTIME</h3>
          <p>MCP Servers &middot; GitNexus &middot; Project-owned scripts &middot; State (.forgewright/)</p>
        </div>
      </article>
    </li>
  </ol>
</section>

---

## Layer 1: Interaction

The interaction layer is the boundary between the user and Forgewright. It has two surfaces:

### IDE Rule Files

When an AI-powered IDE starts a session, it reads one or more rule files from the project root. These files contain the full kernel (boot sequence, solving loop, verification contracts) and are the primary mechanism through which Forgewright controls AI behavior.

| File | IDE | Purpose |
|------|-----|---------|
| `AGENTS.md` | Cursor, Antigravity, Codex | Primary rule file with kernel + GitNexus config |
| `CLAUDE.md` | Claude Code | Identical kernel + Claude-specific hooks |
| `GEMINI.md` | Gemini CLI/IDE | Identical kernel + Gemini optimizations |

All three files are auto-generated from the same source (`kernel/`) via `scripts/lite/sync-kernel.py`. They are functionally identical except for platform-specific integration points.

### ForgeWright Console (Optional GUI)

The ForgeWright Console is a premium native desktop application ([feedmycode.com](https://feedmycode.com/)) that provides visual dashboards, SQLite exploration, settings management, and background task monitoring. It is optional — Forgewright works fully without it.

### User Requests

All user interactions enter through natural language. The kernel's CLARIFY module handles vague requests by asking structured MCQs (maximum 3 questions). Clear, specific requests proceed directly to execution.

---

## Layer 2: Kernel

The kernel is the reasoning engine. It defines **how** the AI thinks, plans, and validates its work. The kernel is deliberately small (≤7,000 tokens boot budget) and lives in `kernel/`.

### Kernel Files

| File | Responsibility |
|------|---------------|
| `ENTRY.md` | Boot sequence (6 hard rules, skill routing table, optional continuity context) |
| `CLARIFY.md` | Vague requirement resolution (trigger table + 5 MCQs) |
| `SOLVE.md` | The reasoning loop (9 steps: UNDERSTAND → GROUND → DECOMPOSE → EXECUTE → AUDIT) |
| `VERIFY.md` | Schema-v2 evidence, exact-tree replay, UI/runtime evidence, and HARD review contracts |
| `AUDIT.md` | Post-execution requirement coverage matrix |
| `ESCALATE.md` | EASY/HARD classification and escalation protocol |
| `INDEX.md` | Full skill index (loaded on-demand, not at boot) |

### The Kernel Loop

The kernel enforces a strict reasoning loop for every task:

<section class="architecture-diagram architecture-flow" aria-labelledby="diagram-flow-title">
  <details class="diagram-description">
    <summary id="diagram-flow-title">The Kernel Loop</summary>
    <p>A sequential flow from User Request through Clarify, Understand, Ground, Decompose, Execute &amp; Verify, Audit, and an optional material-event continuity checkpoint.</p>
  </details>
  <ol class="flow-list">
    <li class="flow-step">
      <div class="step-box">User Request</div>
    </li>
    <li class="flow-step">
      <div class="step-box">1. CLARIFY</div>
      <aside class="step-annotation">Vague? Ask MCQ (max 3)</aside>
    </li>
    <li class="flow-step">
      <div class="step-box">2. UNDERSTAND</div>
      <aside class="step-annotation">Concise task state: objective, acceptance, material uncertainty</aside>
    </li>
    <li class="flow-step">
      <div class="step-box">3. GROUND</div>
      <aside class="step-annotation">Verify assumptions (files, APIs, versions)</aside>
    </li>
    <li class="flow-step">
      <div class="step-box">4. DECOMPOSE</div>
      <aside class="step-annotation">Plan items: ACTION | TARGET | CHECK</aside>
    </li>
    <li class="flow-step">
      <div class="step-box large-box">
        <strong>5. EXECUTE &amp; VERIFY</strong>
        <ul class="sub-tasks">
          <li>Tag EASY/HARD</li>
          <li>Execute &rarr; CHECK</li>
          <li>Reasoning checkpoint</li>
          <li>If FAIL &rarr; fix or STUCK</li>
          <li>Schema-v2 evidence for completion claims</li>
        </ul>
      </div>
      <aside class="step-annotation">"What did this tell me?"</aside>
    </li>
    <li class="flow-step">
      <div class="step-box">6. AUDIT</div>
      <aside class="step-annotation">Requirement coverage matrix</aside>
    </li>
    <li class="flow-step">
      <div class="step-box">7. CONTINUITY IF MATERIAL</div>
      <aside class="step-annotation">Context-only checkpoint; re-ground on resume</aside>
    </li>
  </ol>
</section>

### Hard Rules (The 6 Laws)

1. Never claim something works without a VERIFY block.
2. Never edit a symbol before running impact analysis.
3. Never invent file paths, APIs, or version numbers.
4. If the same step fails twice, STOP and follow the STUCK rule.
5. Stay inside the user's stated scope.
6. Never bypass guardrail rules for destructive operations.

### STUCK Rule

After 2 failures on the same item:
1. Write an isolation script to test the assumption
2. Search codebase for a working pattern
4. Reset context (start fresh with lessons learned)
5. Escalate as HARD
6. Report blocker with evidence

---

## Layer 3: Capabilities

The capabilities layer contains the 84 canonical AI skills and the routing engine that dispatches requests to the right skills.

### Skill Structure

Each skill is a directory under `skills/` containing:

- `skills/<skill-name>/`
  - `SKILL.md` — Full instructions (read by full-model sessions)
  - `LITE.md` — Distilled overlay (read by Lite/Flash sessions)
  - `phases/` — Phase-specific instructions (optional)
  - `scripts/` — Helper scripts (optional)
  - `examples/` — Reference implementations (optional)

- **SKILL.md** — The canonical, complete instruction set for the skill. Defines the skill's authority, phases, inputs, outputs, and verification criteria.
- **LITE.md** — A distilled version (≤2K tokens) for the lightweight kernel (Forgewright Lite). Contains only triggers, checklist, and essential instructions.

### Skill Categories (84 Skills)

| Category | Skills | Examples |
|----------|--------|----------|
| **Orchestration & Meta** | 6 | Orchestrator, Polymath, Parallel Dispatch, Memory Manager, Skill Maker, MCP Generator |
| **Engineering** | 18 | BA, PM, Solution Architect, Software Engineer, Frontend, Backend, QA, Security, DevOps, SRE, API Designer, Database, Debugger, Code Reviewer, Tech Writer, Mobile, Performance, Accessibility |
| **AI / Data** | 6 | AI Engineer, Data Scientist, Data Engineer, Prompt Engineer, Prompt Optimizer, XLSX Engineer |
| **Design** | 3 | UI Designer, UX Researcher, Project Manager |
| **Growth** | 2 | Growth Marketer, Conversion Optimizer |
| **Game Development** | 13 | Game Designer, Unity, Unreal, Godot, Roblox, Phaser 3, Three.js, Level Designer, Narrative Designer, Technical Artist, Game Asset & VFX, Audio, Unity Shader |
| **Game Multiplayer** | 3 | Unity Multiplayer, Godot Multiplayer, Unreal Multiplayer |
| **XR** | 1 | XR Engineer |
| **Testing** | 2 | Autonomous Testing, Mobile Tester |
| **Research** | 2 | NotebookLM Researcher, Web Scraper |
| **Workflow** | 1 | Goal-Driven |

### Mode Routing (24 Modes)

The orchestrator classifies each request into a mode, which determines which skills are activated:

| Mode | Trigger Example | Skills Activated | Gates |
|------|----------------|-----------------|-------|
| Full Build | "Build a SaaS for..." | All engineering skills | 3 |
| Feature | "Add [feature]..." | PM → Architect → Engineers → QA | 1 |
| Review | "Review my code" | Code Reviewer | 0 |
| Test | "Write tests" | QA Engineer | 0 |
| Ship | "Deploy / CI/CD" | DevOps → SRE | 1 |
| Debug | "Fix the bug" | Debugger → Engineer → QA | 0 |
| Design | "Design UI for..." | UX Researcher → UI Designer | 0 |
| Game Build | "Build a Unity game" | Game Designer → Engine → Level/Audio | 2 |
| XR Build | "Build VR app..." | XR Engineer (+ Game pipeline) | 2 |
| AI Build | "Build AI feature..." | AI Engineer + Prompt + Data | 1 |
| Research | "Deep research on..." | NotebookLM + Polymath | 0 |
| Explore | "Help me think about..." | Polymath | 0 |
| Marketing | "Marketing strategy..." | Growth Marketer → Conversion | 0 |
| Optimize | "Make it faster" | Performance Engineer + SRE | 0 |
| Mobile | "Build mobile app" | Mobile Engineer (+ PM, Architect) | 1 |

### Compact Routing (Boot-Time)

At boot, the kernel uses a compact 6-row routing table to avoid loading the full skill index:

| Task Class | Skill Overlay |
|-----------|--------------|
| `DEBUG` | `skills/debugger/LITE.md` |
| `FEATURE` affecting UI | `skills/ui-designer/LITE.md` |
| `FEATURE` otherwise | `skills/software-engineer/LITE.md` |
| `REVIEW` | `skills/code-reviewer/LITE.md` |
| `TEST` | `skills/qa-engineer/LITE.md` |
| `SHIP` | `skills/devops/LITE.md` |

`kernel/INDEX.md` is loaded on-demand only when no compact match applies.

---

## Layer 4: Controls

The controls layer enforces quality, safety, and consistency across all skill executions.

### Protocol System (40+ Protocols)

Shared protocols live in `skills/_shared/protocols/` and define cross-cutting behaviors:

| Protocol | Responsibility |
|----------|---------------|
| `plan-quality-loop.md` | Score plans (8 criteria, threshold ≥9.0), iterate until passing |
| `guardrail.md` | Block destructive operations, enforce authority boundaries |
| `quality-gate.md` | Per-skill validation (4 levels, 0–100 scoring) |
| `task-contract.md` | JSON-based contracts for parallel workers (inputs/outputs/constraints) |
| `task-validator.md` | 7-step post-execution validation |
| `merge-arbiter.md` | Ordered merge strategy with auto-resolution |
| `brownfield-safety.md` | Auto git branching, baselines, protected paths, rollback |
| `session-lifecycle.md` | Cross-session continuity (start/save/end hooks) |
| `project-onboarding.md` | 5-phase deep project analysis |
| `circuit-breaker.md` | CLOSED → OPEN → HALF_OPEN for parallel dispatch |
| `bulkhead.md` | Resource limits per worker (memory, CPU, duration) |
| `verification.md` | 4-level verification framework |
| `self-healing-execution.md` | Error classify → retry (max 3) → rollback → escrow |

### Middleware Chain (14 Stages)

Every skill execution is wrapped by the middleware chain defined in `skills/production-grade/middleware/`:

```
01 Session Data → 02 Context Load → 03 DryRun Check → 04 Guardrail
→ 04b Plan Quality → 04c Tool Sandbox → 04d Context Offload
→ 05 Skill Execute → 06 Verify → 07 Quality Gate → 08 Optional Context
→ 09 Session Update → 10 Graceful Failure
```

Key middleware behaviors:
- **Tool Sandbox (④c):** Strips ANSI, detects prompt injection, redacts credentials
- **Context Offload (④d):** Offloads tool output >1200 tokens to disk, injects trace handles
- **Guardrail (④):** Runs `before_tool()` on every tool call, blocks destructive operations
- **Quality Gate (⑦):** Runs after every skill, produces mini-scorecard

### Continuity and Optional Memory

<section class="architecture-diagram architecture-fluxmem" aria-labelledby="diagram-fluxmem-title">
  <details class="diagram-description">
    <summary id="diagram-fluxmem-title">Continuity and Optional Retrieval Memory</summary>
    <p>The canonical continuity checkpoint binds current project/session evidence. Optional SQLite and Markdown memory remain context-only inputs.</p>
  </details>
  <div class="fluxmem-grid">
    <article class="fluxmem-panel">
      <h3>Canonical checkpoint</h3>
      <ul>
        <li><code>forgewright-continuity/v1</code></li>
        <li>Project + session + turn + monotonic sequence</li>
        <li>Exact tree, ledger offset/head, prior checkpoint hash</li>
        <li>Objective, acceptance IDs, verified fact bindings, next action</li>
      </ul>
    </article>
    <article class="fluxmem-panel">
      <h3>Material event triggers</h3>
      <ul>
        <li>Scope or durable decision changes</li>
        <li>Material verifier results</li>
        <li>Supported pre-compaction event or handoff</li>
        <li>STUCK/block or terminal boundary</li>
      </ul>
    </article>
    <article class="fluxmem-panel">
      <h3>Resume gate</h3>
      <ul>
        <li>Verify checksum/hash chain and expiry</li>
        <li>Require exact workspace, session, tree, and ledger head</li>
        <li>Corrupt/mismatched state &rarr; explicit fresh start</li>
        <li>Always re-ground against current workspace/runtime</li>
      </ul>
    </article>
    <article class="fluxmem-panel">
      <h3>Optional retrieval context</h3>
      <ul>
        <li><code>memory.db</code>, <code>activeContext.md</code>, and handovers</li>
        <li>Never authorize tools, resume execution, or completion</li>
        <li>No raw chain-of-thought, secrets, or tool dumps</li>
        <li>Same-OS-user malicious tampering is outside the threat model</li>
      </ul>
    </article>
  </div>
</section>

### Quality Gate Scoring

| Score | Grade | Status |
|-------|-------|--------|
| 90–100 | A | ✅ Production ready |
| 80–89 | B | ⚠️ Minor issues |
| 70–79 | C | 🔶 Should review |
| 60–69 | D | 🔴 Fix before deploy |
| < 60 | F | 🚫 Blocked |

---

## Layer 5: Runtime

The runtime layer provides the infrastructure that skills, protocols, and the kernel operate on.

### MCP Servers

Forgewright exposes two MCP servers for IDE integration:

| Server | Transport | Tools | Purpose |
|--------|-----------|-------|---------|
| `forgewright` | stdio (npx tsx) | Pipeline mgmt, skill invocation, memory ops | Orchestration |
| `gitnexus` | stdio | 16 tools: query, context, impact, detect_changes, rename, cypher, etc. | Code Intelligence |

The canonical Forgewright MCP process acquires an external
`forgewright-mcp-lifecycle-lease/v1` record before connecting the stdio
transport. The lease binds a 256-bit owner token, monotonic version, workspace,
session, PID start, PGID, parent PID/start, command digest, TTL, and in-flight
count. EOF, SIGINT, and SIGTERM close the exact owned lease idempotently. A
startup reconciliation pass closes dead leases without a signal. For an expired
live lease, the reaper holds a per-lease lock and rechecks identity, command
digest, ownership, version, and in-flight state immediately before TERM and
KILL. It signals only the positive leased PID; PID reuse, token rotation,
in-flight work, or an unowned process produces no signal.

### Harness Host Contract

`HarnessAdapter v1` keeps the core provider-neutral while making host lifecycle
support explicit:

| Contract field | Values / behavior |
|---|---|
| Loop mode | `forgewright-owned-loop` or `native-host-loop` |
| Lifecycle operations | `start`, `resume`, `fork`, `steer`, `interrupt`, `checkpoint` |
| Pre-compaction | Native signal, material-event fallback, or unsupported |
| Resume binding | Workspace, session, turn, checkpoint hash, ledger offset/head, capability snapshot, issue/expiry |
| Failure policy | Unknown schema, operation, or capability fails closed |

This contract does not yet complete the planned `TrajectoryLedger`, execution
containment, full-loop record/replay, or live provider certification.

Configuration via `~/.cursor/mcp.json` (Cursor) or equivalent:

```json
{
  "mcpServers": {
    "forgewright": {
      "command": "npx",
      "args": ["tsx", "/path/to/forgewright/mcp/src/index.ts"],
      "env": { "FORGEWRIGHT_WORKSPACE": "${workspaceFolder}" }
    }
  }
}
```

### GitNexus Code Intelligence

GitNexus maintains a workspace-indexed graph of code symbols, relationships,
and execution flows. Counts are runtime/index state and are intentionally not
frozen in this architecture document.

| Tool | Purpose |
|------|---------|
| `query` | Semantic code search by concept |
| `context` | 360° symbol view (callers, callees, execution flows) |
| `impact` | Blast radius analysis before editing |
| `detect_changes` | Pre-commit scope verification |
| `rename` | Call-graph-aware multi-file rename |
| `explain` | Taint analysis (source → sink flows) |

### Project-Owned Runtime Scripts

| Category | Key Scripts |
|----------|-------------|
| **Setup** | `forgewright-mcp-setup.sh`, `setup-project.sh`, `setup.sh` |
| **Memory** | `mem0-v2.py`, `memory-trace.py`, `memory-consolidate.py`, `memory-hygiene.sh` |
| **Quality** | `forge-validate.sh`, `forgewright-session-tracker.sh` |
| **CI/CD** | `test-cli.sh`, `forgewright-submodule-check.sh` |
| **Kernel** | `lite/sync-kernel.py`, `lite/escalate.sh` |
| **Analysis** | `convention-indexer.sh`, `checkpoint-extract.sh` |
| **Parallel** | `worktree-manager.sh` |

### Project State (`.forgewright/`)

All persistent project state lives under `.forgewright/` at the project root:

| File / Directory | Committed | Purpose |
|-----------------|-----------|---------|
| `project-profile.json` | ✅ | Project fingerprint, health, patterns, risk |
| `code-conventions.md` | ✅ | Detected coding patterns |
| `runtime/continuity/{workspace}/{session}/` | ❌ | Hash-chained context-only checkpoints and quarantine |
| `runtime/stop-attempts/` | ❌ | Hashed bounded Stop retry state; no response payloads |
| `session-log.json` | ❌ | Legacy session context; not resume or completion authority |
| `quality-history.json` | ❌ | Quality score trending |
| `quality-report-{session}.json` | ❌ | Per-session quality reports |
| `baseline-{session}.json` | ❌ | Brownfield test baselines |
| `change-manifest-{session}.json` | ❌ | File change tracking |
| `memory-bank/` | Mixed | Optional legacy context (activeContext, handover, persona) |
| `verify/{turn}.json` | ❌ | Evidence files for Lite kernel verification |
| `offload/{session}/refs/` | ❌ | Offloaded large tool outputs |
| `mcp-server/` | ❌ | Generated MCP server files |

### Configuration

| File | Location | Purpose |
|------|----------|---------|
| `.production-grade.yaml` | Project root | Project-level overrides (guardrail mode, plan threshold, etc.) |
| `.production-grade.yaml.example` | Project root | Full config template with all options |
| `.forgewright/budget.yaml` | Project root | Token tracking budget thresholds |

---

## Pipeline Flow and Exit Boundaries

The delivery model has six canonical phases. Work is proportional: phases and
approval gates apply only when the scope/risk requires them, while verification
and Stop-loop bounds remain machine-enforced on the canonical hook path.

<section class="architecture-diagram architecture-pipeline" aria-labelledby="diagram-pipeline-title">
  <details class="diagram-description">
    <summary id="diagram-pipeline-title">Canonical Delivery and Verification Flow</summary>
    <p>Six delivery phases feed schema-v2 evidence and one canonical Stop replay. Invalid completion can request a bounded retry without manufacturing verified state.</p>
  </details>
  <ol class="pipeline-list">
    <li class="pipeline-step"><div class="step-box node-start">User Request</div></li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>1. INTERPRET</strong>
        <ul><li>Classify mode</li><li>Ask MCQ if vague</li></ul>
      </div>
    </li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>2. DEFINE</strong>
        <ul><li>BA scope (BDD)</li><li>PM requirements</li><li>Architect design</li></ul>
      </div>
    </li>
    <li class="pipeline-step gate-step">
      <div class="gate-box">═══ GATE 1 ═══</div>
      <aside class="step-annotation">User approves direction</aside>
    </li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>3. BUILD</strong>
        <ul><li>Route to skills</li><li>Parallel dispatch</li><li>Impact analysis</li></ul>
      </div>
    </li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>4. HARDEN</strong>
        <ul><li>QA auto-test</li><li>Mutation testing</li><li>Security audit</li></ul>
      </div>
    </li>
    <li class="pipeline-step gate-step">
      <div class="gate-box">═══ GATE 2 ═══</div>
      <aside class="step-annotation">Material behavior has current executable evidence</aside>
    </li>
    <li class="pipeline-retry">
      <aside class="retry-loop">
        <p>Schema-v2 evidence + strict response correlation</p>
        <div class="step-box asip-box">
          <strong>Canonical Stop Gate</strong>
        </div>
        <p class="retry-annotation">One replay per Stop; up to two distinct invalid attempts per scope; duplicate/budget exhaustion allows host stop but stays UNVERIFIED</p>
      </aside>
    </li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>5. SHIP</strong>
        <ul><li>DevOps deploy</li><li>CI/CD pipeline</li></ul>
      </div>
    </li>
    <li class="pipeline-step gate-step">
      <div class="gate-box">═══ GATE 3 ═══</div>
      <aside class="step-annotation">Production readiness</aside>
    </li>
    <li class="pipeline-step">
      <div class="step-box">
        <strong>6. SUSTAIN</strong>
        <ul><li>Monitor &amp; learn</li><li>Wiki/index sync</li><li>Reinforce memory</li></ul>
      </div>
    </li>
    <li class="pipeline-step"><div class="step-box node-end">Task Done &check;</div></li>
  </ol>
</section>

### Loop Boundaries and Exit Conditions

<section class="architecture-diagram architecture-flow" aria-labelledby="diagram-loop-boundaries-title">
  <details class="diagram-description">
    <summary id="diagram-loop-boundaries-title">Loop Boundaries and Exit Conditions</summary>
    <p>Independent caps prevent Stop hooks, tool execution, model calls, peer exchange, and failure recovery from recursively extending one another.</p>
  </details>
  <ol class="flow-list">
    <li class="flow-step">
      <div class="step-box"><strong>Stop hook</strong><br>1 canonical replay per event<br>2 invalid attempts per session/turn/tree scope</div>
      <aside class="step-annotation">Duplicate/budget exhaustion: host may stop; completion remains unverified</aside>
    </li>
    <li class="flow-step">
      <div class="step-box"><strong>Agent runtime</strong><br>8 tool calls per turn<br>40 total tool calls<br>3600s default runtime</div>
      <aside class="step-annotation">Environment overrides remain bounded positive integers</aside>
    </li>
    <li class="flow-step">
      <div class="step-box"><strong>STUCK rule</strong><br>Same step fails twice</div>
      <aside class="step-annotation">Isolate, find evidence, reset/escalate; no third blind retry</aside>
    </li>
    <li class="flow-step">
      <div class="step-box"><strong>Lifecycle</strong><br>Startup reconciliation<br>exact-PID TERM then bounded KILL</div>
      <aside class="step-annotation">Dead lease closes without signal; identity/command/owner/in-flight mismatch preserves the process</aside>
    </li>
    <li class="flow-step">
      <div class="step-box"><strong>Continuity</strong><br>Material events only<br>64 KiB checkpoint cap</div>
      <aside class="step-annotation">Head or full-chain mismatch, corruption, or expiry exits to fresh re-grounding</aside>
    </li>
  </ol>
</section>

---

## Cross-Layer Interactions

### Request Lifecycle (Example: "Add JWT auth")

1. **Layer 1 (Interaction):** User types request in Cursor → `AGENTS.md` loads kernel
2. **Layer 2 (Kernel):** CLARIFY identifies auth → asks MCQ 4 (auth mechanism)
3. **Layer 2 (Kernel):** After user selects JWT → UNDERSTAND/GROUND/DECOMPOSE
4. **Layer 3 (Capabilities):** Mode = Feature → Skills: PM, Architect, Backend, QA
5. **Layer 5 (Runtime):** GitNexus `impact()` on auth-related symbols
6. **Layer 3 (Capabilities):** Software Engineer executes code changes
7. **Layer 4 (Controls):** Quality Gate scores output, Guardrail checks for hardcoded secrets
8. **Layer 2 (Kernel):** Schema-v2 evidence binds exact tests/tree → AUDIT covers requirements
9. **Layer 4 (Controls):** A material boundary may write a context-only continuity checkpoint; a later session must re-ground it

### Parallel Dispatch

For multi-skill tasks, Forgewright uses git worktrees for parallel execution:

<article class="architecture-diagram architecture-worktrees" aria-labelledby="diagram-worktrees-title">
  <details class="diagram-description">
    <summary id="diagram-worktrees-title">Parallel Dispatch via Worktrees</summary>
    <p>Main branch forks into multiple task-specific worktrees (e.g. Frontend, Backend, Database), which converge via Merge Arbiter Protocol back to the merged main branch.</p>
  </details>
  <div class="worktree-flow">
    <div class="worktree-node main-node">main branch</div>
    <div class="worktree-branches">
      <div class="worktree-node branch-node">worktree/task-1 (Frontend)</div>
      <div class="worktree-node branch-node">worktree/task-2 (Backend)</div>
      <div class="worktree-node branch-node">worktree/task-3 (Database)</div>
    </div>
    <div class="worktree-node arbiter-node">Merge Arbiter Protocol</div>
    <div class="worktree-node main-node end-node">main branch (merged)</div>
  </div>
</article>

Each worker receives a Task Contract (JSON) defining:
- Allowed input files (read-only)
- Allowed output directories (write)
- Forbidden patterns (grep-checked)
- Build/test commands (exit code verified)

---

## Design Principles

The architecture is governed by the [10 Principles](../VISION.md), summarized:

1. **Superalignment** — All agents align on shared artifacts as source of truth
2. **Production Grade** — No TODOs, no stubs; everything compiles and passes tests
3. **On Behalf of the User** — Do the work, don't describe the work
4. **Interactive When Needed** — Max 3 strategic gates; structured options, not open-ended prompts
5. **Efficiency Through Parallelism** — Never serialize independent work

---

*Last updated: 2026-08-23*
