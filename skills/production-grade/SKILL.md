---
name: production-grade
description: >
  Orchestrates software engineering work — build apps, add features,
  fix bugs, refactor code, review PRs, write tests, deploy services,
  audit security, design architecture, generate docs, optimize performance,
  debug issues, or explore ideas. Any coding or development request gets
  routed to the right specialized skills automatically.
---

# Production Grade

!`git status 2>/dev/null || echo "No git repo detected"`
!`cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"`
!`ls .forgewright/ 2>/dev/null || echo "No existing workspace"`
!`cat .production-grade.yaml 2>/dev/null || echo "No config file — defaults apply"`

## Overview

Adaptive meta-skill orchestrator for software/product delivery. It analyzes the user's request and current project evidence, selects only the capabilities needed, builds a minimal task graph, and executes — from a single local review to a multi-role greenfield build.

**One manifest-driven orchestrator.** Resolve the current skill inventory from project truth (`product-manifest.json` / `kernel/INDEX.md`) and load only what the request needs. No forced full-pipeline execution for everyday tasks.

**All skills are bundled in this plugin. Single install, everything included.**

### ⚠️ MANDATORY: Pipeline State Management (MCP Tools)
If you are running in an environment with the Forgewright MCP Server connected, YOU MUST explicitly manage the pipeline state using the exposed `fw_*` tools. This ensures any connected IDE or Dashboard accurately tracks your progress.
1. For substantial tracked work, call `fw_start_pipeline` when starting a new goal/session.
2. Advance state only through phases the work actually enters; compressed `QUICK` work does not need artificial phase transitions.
3. Use `fw_request_gate_approval` only for an actual human-approval contract, not merely because a phase exists.
If state telemetry is unavailable, report the observability degradation when material; do not convert it into a false product failure.

### Provider / Model Runtime Policy

Keep the canonical orchestrator provider-neutral. Use `skills/_shared/protocols/model-tier.md` and runtime-advertised capabilities/IDs for provider-specific parameters. Never assume a model family, temperature, thinking parameter, or provider feature from stale prose.

### Middleware Chain (v8.0 — DeerFlow Pattern)

Every skill invocation is wrapped by an ordered middleware chain. Implementation details are in `skills/production-grade/middleware/`:

```
Pre-Skill:  ① SessionData → ② ContextLoader → ②b OperatingPreflight → ③b DryRunContext → ③ SkillRegistry → ④ Guardrail → ⑤ Summarization
            ═══ SPECIALIST SKILL EXECUTION ═══
Post-Skill: ⑥ QualityGate → ⑥b OperatingAudit → ⑦ BrownfieldSafety → ⑧ TaskTracking → ⑨ Memory → ⑩ GracefulFailure → ⑪ RecoveryResearch → ⑫ CircuitBreaker → ⑬ Bulkhead → ⑭ Verification
```

| # | Middleware | File | Hook | Purpose |
|---|-----------|------|------|---------|
| ① | SessionData | `middleware/01-session-data.md` | before_skill | Load profile, session state |
| ② | ContextLoader | `middleware/02-context-loader.md` | before_skill | Load memory, conventions |
| ②b| OperatingPreflight | `skills/_shared/protocols/pipeline-operating-contract.md` | before_skill | Build/refresh PIPELINE_CONTEXT: outcome, safe scope, risk ownership, research/visual basis |
| ③b| DryRunContext | `skills/_shared/protocols/dryrun-interceptor.md` | before_skill | Dry-run mode system prompt injection |
| ③ | SkillRegistry | `middleware/03-skill-registry.md` | before_skill | Progressive skill loading |
| ④ | Guardrail | `middleware/04-guardrail.md` | before_tool | Pre-tool authorization |
| ⑤ | Summarization | `middleware/05-summarization.md` | before_skill | Context compression |
| ⑥ | QualityGate | `middleware/06-quality-gate.md` | after_skill | Specialist/domain + acceptance validation |
| ⑥b| OperatingAudit | `skills/_shared/protocols/pipeline-operating-contract.md` | after_skill | Close cross-domain risks, visual conformance, critical audit, project-local learning |
| ⑦ | BrownfieldSafety | `middleware/07-brownfield-safety.md` | after_skill | Regression + protected paths |
| ⑧ | TaskTracking | `middleware/08-task-tracking.md` | after_skill | Update todos, emit events |
| ⑨ | Memory | `middleware/09-memory.md` | after_skill + turn_close | Persistent fact extraction |
| ⑩ | GracefulFailure | `middleware/10-graceful-failure.md` | on_error | Retry logic, stuck detection |
| ⑪ | RecoveryResearch | `skills/_shared/protocols/research-gate.md` | on_error | Research only for a material evidence/knowledge gap; no framework self-mutation |
| ⑫ | CircuitBreaker | `skills/_shared/protocols/circuit-breaker.md` | after_skill | Fault isolation + state machine |
| ⑬ | Bulkhead | `skills/_shared/protocols/bulkhead.md` | after_skill | Resource limits per worker type |
| ⑭ | Verification | `skills/_shared/protocols/verification.md` | after_skill | Evidence-First verification check |
**Middleware protocol:** `skills/_shared/protocols/middleware-chain.md`

### Progressive Skill Loading (v8.0 — DeerFlow Pattern)

Skills are loaded on-demand based on classified mode. Read `.forgewright/skills-config.json` for the mode→skill mapping.

```
Instead of loading the full current skill registry, load only skills relevant to the mode:
  Review mode  → loads 1 skill  (~3KB)
  Feature mode → loads 5 skills (~15KB)
  Full Build   → loads 10 skills (~30KB)
  Fallback     → inspect manifest/index and load the smallest safe candidate set; do not blindly load everything
```

## When to Use

- Building a new SaaS, platform, or service from scratch (full pipeline)
- Adding a feature to an existing codebase
- Hardening code before launch (security + QA + review)
- Setting up CI/CD, Docker, Terraform for existing code
- Writing tests for existing code
- Reviewing code quality or architecture conformance
- Designing architecture or API contracts
- Writing documentation for existing systems
- Performance optimization or reliability engineering
- Any task that benefits from structured, production-quality execution
- User says "build me a...", "add [feature]", "review my code", "set up CI/CD", "write tests", "harden this", "document this"

## Request Classification

Before any execution, classify the user's request into a mode. This determines which skills run and how.

### Paperclip Detection (Optional)

Before classifying, check if this session is managed by [Paperclip](https://github.com/paperclipai/paperclip):

```
Paperclip indicators: ticket reference (#42, CLIP-, [paperclip]),
heartbeat context, budget mention, agent identity
```

If detected:
1. Read `skills/_shared/protocols/paperclip-integration.md`
2. Switch to **Express** engagement mode (fully autonomous)
3. Apply ticket scope discipline (stay within assigned task)
4. Use structured output format for Paperclip consumption
5. Apply cost-awareness rules

If not detected → proceed normally (no changes).

## Phase 0.B — Request Interpretation

Normalize the request before routing, but keep interpretation proportional. For a clear `QUICK` request, this may be a short internal pass rather than a separate artifact.

Capture only what affects execution:
- objective and observable acceptance;
- explicit constraints / non-goals;
- current verified project state relevant to the request;
- material assumptions or decisions still unresolved;
- the smallest appropriate mode/effort class.

Ask the user only when ambiguity can materially change the product contract, safety, irreversible data, public behavior, budget/scope, or expensive architecture direction. Do not use invented ambiguity/completeness percentages, fixed question counts, or an unbounded clarification loop.

BDD/Gherkin is useful when behavior scenarios materially improve acceptance/test handoff; it is not mandatory for text/config/status work or obvious local changes.

If `.forgewright/subagent-context/INTERPRETED_REQUEST.md` exists, treat it as a derived cache/handoff. The latest user instruction remains authoritative for intent, and current workspace/runtime evidence remains authoritative for project state. Refresh the cache when either changes.

## Enhanced Mode Classification with Fuzzy Matching (v8.7+)

Detailed classification confidence levels, fuzzy trigger matching rules, trigger patterns, fallback chains, and planning/UX suggestions are documented in [references/mode-classification.md](references/mode-classification.md).

## Coding-Level Adaptation

Read `codingLevel` from `.production-grade.yaml` (default: 8). Adapt ALL skill output accordingly:

```yaml
# .production-grade.yaml
codingLevel: 8  # 1-10 scale (default: 8 = senior/terse)
```

| Level | Style | Output Behavior |
|-------|-------|-----------------|
| **1-3** (Junior) | **Guided** | Detailed explanations for every decision. Inline comments on complex logic. Link to relevant docs/tutorials. Explain WHY, not just WHAT. Step-by-step instructions for manual steps. |
| **4-7** (Mid) | **Standard** | Balanced output — explain non-obvious decisions, skip the obvious. Standard inline comments. Focus on trade-offs and alternatives. |
| **8-10** (Senior) | **Terse** | Code-focused, minimal commentary. Only flag unexpected decisions or gotchas. Diff-style output preferred. No tutorials, no hand-holding. Assume deep familiarity with tools and patterns. |

**Rules:**
- If `codingLevel` is not set, default to **Senior (8)**
- Coding level affects **output verbosity**, NOT **code quality** — all levels produce production-grade code
- Engagement Mode (Express/Standard/Thorough/Meticulous) controls **interaction depth** — coding level controls **explanation depth**. They are independent dimensions.

## Sensitive File Protection

All skills MUST follow the sensitive file protection protocol:

!`cat skills/_shared/protocols/sensitive-file-protection.md 2>/dev/null || echo "Protocol not found — apply defaults: never read .env without user approval, redact secrets in output, check .gitignore before commit"`

## Senior Execution + Plan Quality

All roles operate under the shared senior execution contract. Senior means evidence-backed judgment and ownership, not extra ceremony or a specific provider/model.

!`cat skills/_shared/protocols/senior-execution-contract.md 2>/dev/null || echo "Protocol not found — apply defaults: senior-by-default, evidence-first, smallest adequate solution, no speculative optimization"`

Use the shared plan-quality protocol proportionally: `QUICK` work uses the mini-plan fast path; `STANDARD` / `DEEP` work uses the applicable complexity-scaled threshold. Never impose a blanket 9.0 score on routine work.

!`cat skills/_shared/protocols/plan-quality-loop.md 2>/dev/null || echo "Protocol not found — apply defaults: QUICK fast path; otherwise complexity-scaled threshold (6.0-9.0 by mode), research only for material gaps"`

## Webhook State & Telemetry Protocol

**ALL skills** and Orchestrator MUST use the Local Webhook to report state changes and token usage. OSC sequences are deprecated. You may use direct HTTP Webhook via curl OR continue using MCP Tools (which will automatically proxy to the Webhook).

!`cat skills/_shared/protocols/webhook-telemetry-protocol.md 2>/dev/null || echo "Protocol not found — apply defaults: POST to FORGEWRIGHT_WEBHOOK_URL/api/v1/telemetry and /api/v1/state instead of using OSC sequences."`

### Evidence-Driven Recovery

Use `kernel/SOLVE.md`, `skills/_shared/protocols/graceful-failure.md`, and `skills/_shared/protocols/research-gate.md`.

- `QUICK` work has no numeric plan score requirement.
- `STANDARD` / `DEEP` use the applicable plan threshold.
- After the same step fails twice, stop repeating it. Research only when a material knowledge/evidence gap blocks the next decision; otherwise escalate with the evidence and alternatives.
- Store lessons project-locally. Do **not** mutate shared Forgewright skill/protocol files unless improving Forgewright itself is the explicit task and the framework regression gates pass.
- A higher model tier may review/disagree, but it does not replace evidence.

Legacy ASIP files/metrics may remain for backward compatibility; their old mandatory-research/self-mutation semantics are deprecated by the current Research Gate and Senior Execution Contract.

## Review Intensity Mode

**Control how much design/architecture review happens at each step:**

!`cat skills/_shared/protocols/review-intensity.md 2>/dev/null || echo "Protocol not found — apply defaults: Review mode defaults to Lean (reviews only at phase gates). Set in production/review-mode.txt. Modes: full (all reviews), lean (gate reviews only), solo (no reviews)."`

User can override per-invocation with `--review [mode]` flag.

## Model Tier Assignment

Select a capability tier independently from any provider/model name. Never invent or pin a provider model that the current runtime has not advertised.

!`cat skills/_shared/protocols/model-tier.md 2>/dev/null || echo "Protocol not found — apply defaults: scout for bounded read-only discovery, builder for normal implementation/verification, expert for objectively hard/high-risk decisions or disagreement."`

If the runtime supports explicit model overrides, use only exact advertised IDs. Otherwise keep provider-managed selection.

## Optional Expert CLI Mode

**Escalate high-stakes planning/review/gates through a local Claude CLI or Codex CLI only when explicitly enabled:**

!`cat skills/_shared/protocols/expert-cli-mode.md 2>/dev/null || echo "Protocol not found — expert CLI mode disabled by default. Use forge expert status/on/off/use and forge token on/status."`

Expert CLI mode is optional, supports single-provider setups, and must not require both Claude and Codex to be installed.

## Mode Execution (Non-Full-Build)

Detailed execution instructions, QA sequences, and task flows for non-Full-Build modes are documented in [references/mode-execution.md](references/mode-execution.md).

## Chat Interpretation (Request Boundary)

Treat every new user message as a fresh instruction boundary: reconcile it with current workspace evidence and existing constraints before acting. Do **not** emit magic reset tokens or other user-visible ceremony.

Use `chat-interpreter` when the request is materially ambiguous, multi-domain, or expensive to misread. A clear `QUICK` request may be interpreted inline under the kernel boot sequence.

**Phase 0.A — Chat Interpretation (when needed):**

```
Invoke: /chat-interpreter [user's message]
```

**The chat-interpreter subagent performs:**

1. **9-Dimension Extraction** — silently extracts: Task, Target tool, Output format, Constraints, Input, Context, Audience, Success criteria, Examples

2. **Mode Detection** — maps the request to Forgewright's 24 modes with confidence level (HIGH/MEDIUM/LOW)

3. **Gap Detection** — identifies missing information (max 3 clarifying questions if needed)

4. **Default Application** — fills in reasonable defaults for unstated requirements

5. **Structured Output** — produces `INTERPRETED_REQUEST.md` with:
   - Detected mode + confidence
   - Intent (original quoted)
   - Key decisions made
   - Scope (included/excluded)
   - Constraints
   - Missing items
   - Success criteria

**If confidence is HIGH:**
```
✓ Request interpreted — [mode] mode detected
[Structured request summary — 3 lines max]
→ Proceeding to Phase 0.C
```

**If confidence is MEDIUM:**
```
Request understood. Detected [mode] but [alternative] is also possible.

1. **[mode] (Recommended)** — [reason]
2. **[alternative]** — [reason why user might want this]
3. **Chat about this** — Tell me more
```

**If confidence is LOW:**
```
I'm not sure what you want. A few quick questions:

1. [most critical unknown — max 3 questions]
2. [second most critical]
3. [third most critical — last one]

After your answers, I'll route to the right pipeline.
```

**Paperclip Detection (auto-handled):**
- If `#42`, `CLIP-`, or `[paperclip]` detected → route to **Express** engagement mode
- chat-interpreter appends `engagement_override: express` to `INTERPRETED_REQUEST.md`

**Chat Interpretation Output:**
```
.forgewright/subagent-context/INTERPRETED_REQUEST.md
  ├── mode: [detected mode]
  ├── confidence: [HIGH/MEDIUM/LOW]
  ├── intent_summary: [1 sentence]
  ├── scope: {included: [...], excluded: [...]}
  ├── constraints: [...]
  ├── missing: [...]
  ├── success_criteria: [...]
  └── engagement_override: [express/standard/thorough/meticulous if set]
```

**Reading the interpreted request before proceeding:**
`.forgewright/subagent-context/INTERPRETED_REQUEST.md` is a derived handoff/cache, not a higher authority than the current user message. If they differ, re-interpret from the current request and verified project state before continuing.

## Tool-Specific Routing (from prompt-master)

Prompts, techniques, and template mappings for supported tool surfaces are documented in [references/tool-routing.md](references/tool-routing.md).

## Auto-Initialization, Updates, and Session Lifecycle

System requirements, session loading, memory retrieval, subagent context preparation, and invocation protocols are documented in [references/initialization-and-lifecycle.md](references/initialization-and-lifecycle.md).

## Full Build Pipeline

When mode is **Full Build**, use this coordination skeleton while applying the Senior Execution Contract. Full Build means end-to-end ownership, **not that every role/task/artifact must execute**. Mark inapplicable lanes `SKIPPED` with a short evidence-based reason; never create work merely to fill the pipeline.

1. **Print kickoff banner:**
```
━━━ Production Grade Pipeline v{local_version} ━━━━━━━━━━━━━━━━━━
Project: [extracted from user's message]
⧖ Bootstrapping workspace...
```

2. **Bootstrap workspace:**
```bash
mkdir -p skills/_shared/protocols/
mkdir -p .forgewright/
```

3. **Ensure canonical shared protocols are available** in `skills/_shared/protocols/` (reuse the current Forgewright/submodule files; do not rewrite existing canonical protocols):

| Protocol File | Content |
|---------------|---------|
| `ux-protocol.md` | 6 UX rules: never open-ended questions, "Chat about this" last, recommended first, continuous execution, real-time progress, autonomy |
| `input-validation.md` | 5-step validation: read config → probe inputs in parallel → classify Critical/Degraded/Optional → print gap summary → adapt scope |
| `tool-efficiency.md` | Parallel tool calls, view_file_outline before view_file, find_by_name not find, grep_search not grep, config-aware paths |
| `conflict-resolution.md` | Authority hierarchy, dedup by file:line (keep highest severity), HARDEN→BUILD feedback loops (2 cycle max) |
| `project-onboarding.md` | 5-phase deep project analysis: fingerprint → health check → pattern analysis → risk assessment → profile generation |
| `session-lifecycle.md` | Cross-session continuity: session start/save/end hooks, resume protocol, drift detection, memory integration |
| `quality-gate.md` | Universal per-skill validation: 4 levels (build, regression, standards, traceability), quality scoring 0-100, configurable thresholds |
| `brownfield-safety.md` | Safety net for existing projects: git branching, baseline snapshots, protected paths, change manifest, regression checks, rollback |
| `quality-dashboard.md` | Quality scoring & reporting: real-time tracking, final dashboard, machine-readable JSON reports, cross-session trending, early warning |
| `graceful-failure.md` | Retry limits, stuck detection, graceful exit format, failure categories — prevents skills from looping on impossible tasks |
| `code-intelligence.md` | GitNexus-powered knowledge graph: impact analysis, 360° context, process tracing, pre-commit risk — optional enhancement for deep code awareness |
| `prompt-templates.md` | 12 prompt templates auto-selected by task type: RTF, CO-STAR, RISEN, CRISPE, Chain of Thought, Few-Shot, File-Scope, ReAct+Stop, Visual Descriptor, Reference Image, ComfyUI, Prompt Decompiler |
| `credit-killing-patterns.md` | 35 patterns that waste tokens: 7 task, 6 context, 6 format, 6 scope, 5 reasoning, 5 agentic |
| `prompt-techniques.md` | 5 safe techniques: Role Assignment, Few-Shot, XML Tags, Grounding Anchors, Chain of Thought. Also lists forbidden techniques: ToT, GoT, USC, prompt chaining, MoE |

Read these from the current Forgewright installation/submodule. Copy/link only when the target project explicitly needs local protocol files and they are absent. **Never reconstruct a missing canonical protocol from the summary table**; mark it `UNVERIFIED` and use the kernel/shared contract that is actually available.

4. **Codebase discovery — detect greenfield vs brownfield:**

   **If project onboarding already ran** (Phase 0.B loaded `.forgewright/project-profile.json`) → use cached fingerprint data. Otherwise, run scans:

   Run these scans in parallel:
   ```
   find_by_name("package.json"), find_by_name("go.mod"), find_by_name("pyproject.toml"), find_by_name("Cargo.toml"), find_by_name("pom.xml")
   find_by_name("*", "src/"), find_by_name("*", "services/"), find_by_name("*", "frontend/"), find_by_name("*", "tests/"), find_by_name("*", "docs/")
   find_by_name("Dockerfile*"), find_by_name("*", "scripts/ci/"), find_by_name("*", ".github/workflows/"), find_by_name("*", "infrastructure/"), find_by_name("*", "terraform/")
   find_by_name(".production-grade.yaml")
   ```

   **Cursor EXPLORE Enhancement (automatic):**

   Cursor's built-in `explore` subagent can be triggered naturally. When the Agent sees you need to understand the codebase structure, it automatically runs up to 10 parallel searches using the `explore` subagent — each with a fast model, consuming no context in the main conversation. The explore subagent returns only the synthesized findings.

   To leverage this explicitly in the DEFINE phase, frame your discovery queries naturally:
   ```
   Agent (you): "Explore the backend structure — find services, APIs, and database models"
   → Cursor Agent spawns explore subagent with 10 parallel searches
   → explore subagent returns: [list of services], [API endpoints], [DB schemas], [key patterns]
   → You inject results into project profile
   ```

   This replaces manual `find_by_name` calls for complex discovery with a more intelligent, semantically-driven approach. Use both — `find_by_name` for exact file discovery, explore for architectural pattern analysis.

   **Classify the project:**

   | Signal | Mode | Behavior |
   |--------|------|----------|
   | Empty/new directory, no source files | **Greenfield** | Create everything from scratch |
   | Source files exist, no `.production-grade.yaml` | **Brownfield (unmapped)** | Deep onboarding, generate config, adapt |
   | Source files + `.production-grade.yaml` exist | **Brownfield (mapped)** | Use config paths, augment existing code |

   **If Greenfield** → log `✓ Greenfield project — creating from scratch`. Write minimal `.forgewright/project-profile.json` (to be populated progressively). Continue to step 5.

   **If Brownfield** → run the enhanced adaptation sequence:

   a. **Deep project onboarding** — run full `skills/_shared/protocols/project-onboarding.md` if not already done in Phase 0.B. This produces:
      - `.forgewright/project-profile.json` — full fingerprint, health, patterns, risk
      - `.forgewright/code-conventions.md` — coding patterns for all skills to follow

   b. **Structure report** — display from project profile:
   ```
   ⧖ Existing codebase analyzed:
   Language: [fingerprint.language]  |  Framework: [fingerprint.framework]
   Architecture: [fingerprint.architecture]
   Tests: [health.test_count] ([health.test_coverage_percent]% coverage)
   Health: Build [✓/✗] | Tests [✓/✗] | Lint [✓/⚠] | CVEs [count]
   Risk Score: [risk.overall_risk_score]/10
   Patterns: [patterns.naming_convention], [patterns.component_pattern]
   ```

   c. **Path mapping** — if no `.production-grade.yaml`, generate one from discovered structure. Notify user via notify_user:

   ```
   I've analyzed your existing codebase. Here's what I found:

   [structure summary from project profile]

   I'll map the pipeline outputs to your existing structure.

   1. **Approve mapping (Recommended)** — Use detected paths, generate .production-grade.yaml
   2. **Customize paths** — Review and adjust the path mapping
   3. **Treat as greenfield** — Ignore existing code, create fresh structure
   4. **Chat about this** — Discuss how the pipeline adapts to your codebase
   ```

   d. **Write `.production-grade.yaml`** from discovered structure — map `paths.*` to actual directories found.

   e. **Set brownfield context** — write to `.forgewright/codebase-context.md`:
   ```markdown
   # Codebase Context
   Mode: brownfield
   Language: [detected]
   Framework: [detected]
   Existing paths: [mapping]
   Code conventions: .forgewright/code-conventions.md
   Project profile: .forgewright/project-profile.json

   ## Rules for all agents
   - Don't overwrite existing files without explicit user approval — blindly replacing files can destroy production-critical configuration or break existing consumers that depend on current signatures
   - READ .forgewright/code-conventions.md and MATCH existing code style
   - ADD to existing directories, don't replace them
   - If a file exists at the target path, create alongside it or extend it
   - Existing tests must still pass after changes (verified by quality-gate)
   - Check .forgewright/project-profile.json → risk.protected_paths before writing
   ```

   f. **Activate brownfield safety net** — follow `skills/_shared/protocols/brownfield-safety.md`:
      - Create session branch: `forgewright/session-{timestamp}`
      - Snapshot baseline (existing tests pass count)
      - Register protected paths
      - Log: `✓ Safety net active — branch: forgewright/session-{timestamp}, baseline: [N] tests`

   All skills read codebase-context.md and code-conventions.md before executing.

5. **Engagement mode:**

Resolve interaction depth without interrupting the client unnecessarily:
- Reuse an explicit user/project setting when present.
- Otherwise default to **Standard** internally: communicate material decisions/risks, but ask for approval only when preference, contract, safety, irreversible data, or release acceptance genuinely requires it.
- `Express`: maximum autonomy; only hard/material gates interrupt.
- `Thorough` / `Meticulous`: use only when the user explicitly requests more review depth or the engagement contract requires it.

Do not use fixed question quotas. A senior role asks the **minimum questions needed to change a decision**. Record the resolved mode in `.forgewright/settings.md` only when persistent state is useful.

5b. **Execution strategy — Scope Analysis & Recommendation:**

Before asking the user, the orchestrator should analyze the project scope and generate a data-driven recommendation — this avoids wasting the user's time with uninformed "how would you like to proceed?" questions. This runs AFTER Gate 2 (architecture approved), when the full scope is known.

**Step 5b-1: Decide Whether Strategy Analysis Is Worth It**

If fewer than two meaningful implementation lanes can run independently, use sequential execution and skip the rest of Step 5b. Do not calculate synthetic complexity scores just to justify orchestration.

For multi-lane work, inspect only facts that affect concurrency: dependency edges, write scopes, shared schemas/contracts/config, integration points, and actual local worker/resource limits.

**Step 5b-2: Contract Freeze / Dependency Check**

Before parallel work, identify which public/shared contracts must be frozen or serialized. If workers would concurrently mutate the same schema, package manifest, generated asset source, or configuration surface, either split ownership explicitly or keep that work sequential.

**Step 5b-3: Dependency & Contention Analysis**

Choose parallelism from evidence, not invented wall-clock estimates:

```
For each active task, record:
  depends_on       = required predecessor contracts/artifacts
  write_scope      = files/modules/schemas it may modify
  shared_contracts = APIs/schemas/assets/config it consumes or changes
  resource_class   = light / normal / heavy based on actual tool/runtime needs

parallel_candidate = tasks with no dependency edge and non-overlapping write_scope
contention_risk     = shared mutable contracts + overlapping write paths + limited local resources
```

Use measured historical command/runtime telemetry when available. **Never invent minute estimates or speedup factors** for agent work.

**Step 5b-4: Risk Assessment (Parallel Mode)**

Evaluate risks specific to parallel execution:

| Risk | Condition | Severity | Mitigation |
|------|-----------|----------|------------|
| **Merge conflict** | Workers overlap write scopes | Depends on overlap | Split ownership or serialize shared files; never claim auto-resolution succeeded without merge/test evidence |
| **Shared schema divergence** | Multiple workers can mutate the same schema/contract | High | Freeze contract or assign one owner before dispatch |
| **Package/config mismatch** | Multiple workers edit dependency/config files | Medium | Assign a single merge owner and re-run install/build/lockfile checks |
| **Integration failure post-merge** | Workers consume stale or incompatible contracts | Medium-High | Share a verified frozen contract snapshot and run integration checks after merge |
| **Resource exhaustion** | Concurrent workers exceed actual RAM/CPU/process policy | Environment-specific | Derive a bounded concurrency cap from runtime policy/observed resources |
| **Rollback complexity** | Merged changes are hard to isolate | Medium | Preserve lane commits/worktrees and validate merge incrementally |

Assign risk from these observed conditions; do not infer it from service count or architecture labels alone.

**Step 5b-5: Generate Recommendation**

Prefer sequential execution unless parallel work is genuinely independent and coordination overhead is justified:

```
IF count(parallel_candidate) >= 2 AND contention_risk in {LOW, MEDIUM} AND resource budget allows:
  recommendation = PARALLEL for only those independent lanes
ELSE:
  recommendation = SEQUENTIAL / bounded concurrency

Never parallelize merely because a task count or complexity score is high.
Freeze shared contracts before independent workers consume them, and serialize schema/config migrations that have ordering risk.
```

**Step 5b-6: Apply or Surface the Strategy**

For normal delivery, apply the evidence-supported strategy and report it briefly in status. Ask the user only when the choice changes cost/scope/risk they need to accept, or when they explicitly asked to choose the execution strategy.

Report measured facts only: independent lanes, shared write paths/contracts, concurrency cap, and material merge/integration risks. Do not show fabricated time savings.

**Step 5b-7: Save Decision**

Append persistent settings only when useful:
```markdown
Execution: [parallel|sequential|bounded]
Max_Workers: [derived from actual runtime/resource policy]
Independent_Lanes: [task ids]
Shared_Write_Risk: [LOW|MEDIUM|HIGH]
Reason: [evidence-based summary]
```

Write `.forgewright/scope-analysis.md` only for substantial multi-lane work where another role/session will benefit from the artifact.

When **Parallel** is selected, the BUILD and HARDEN phases use the parallel-dispatch skill (`skills/parallel-dispatch/SKILL.md`) to spawn git worktrees, distribute Task Contracts, and merge results. When **Sequential** is selected, the pipeline behaves as before.

6. **Detect existing workspace & load memory** — if `.forgewright/` has prior state, use session-lifecycle resume protocol. If `.forgewright/session-log.json` has interrupted state, offer resume. Otherwise offer clean start via notify_user.
   - **Memory load:** Run `python3 scripts/mem0-v2.py search "<project-name> <user-request-keywords>" --limit 5` to retrieve relevant project context. Inject results into your context for this session.
   - If no results or memory is empty, verify setup with `python3 scripts/mem0-v2.py stats`.

6.5. **Build the pipeline operating envelope before specialist routing:**
   - Read `skills/_shared/protocols/pipeline-operating-contract.md`.
   - Resolve desired outcome, observable acceptance, constraints/non-goals, `Minimum Safe Scope`, credible cross-domain `risk_signals` with owners, and only decision-changing unknowns.
   - If visual acceptance is material, establish `visual_basis` before UI/art implementation; if no reliable basis exists, resolve it at pipeline level rather than asking each visual skill to research independently.
   - Keep this as task state for bounded work; persist `.forgewright/pipeline-context.md` only when multi-role/session handoff benefits from it.
   - Every specialist receives `PIPELINE_CONTEXT` and returns `DOMAIN_FINDING` for newly discovered cross-domain/scope-changing facts.

7. **Polymath specialist check (only when research/decision synthesis itself is needed):**
   - If `.forgewright/polymath/handoff/context-package.md` exists → read it, pass to PM as pre-loaded context. Log: `✓ Polymath context loaded — skipping redundant discovery`
   - Generic scope clarification, hidden-risk scanning, source trust, and instruction-boundary safety are already owned by OperatingPreflight; do **not** invoke Polymath merely to replay those steps.
   - Route to Polymath when the unresolved work genuinely needs deep cross-source analysis, alternative-hypothesis comparison, unfamiliar-domain synthesis, or decision memo quality beyond the control plane.
   - If no such specialist need exists → proceed directly. Log: `✓ Pipeline context ready — no Polymath specialist required`.

7.5. **BA pre-flight check (after Polymath, before PM):**

   **Detect greenfield Full Build** (any of: Step 4 logged **Greenfield**; empty/minimal codebase with net-new product intent; user said "from scratch" / "new SaaS" / equivalent):

   - **Greenfield Full Build — BA owns requirement coherence, not a question quota:**
     - Read `skills/business-analyst/SKILL.md` when material product/contract gaps exist or when a durable BA handoff benefits downstream roles.
     - If the user already supplied a sufficiently concrete spec, validate/summarize it into a concise handoff **without forcing an elicitation round**.
     - Ask only for unknowns that can materially change product behavior, cost/scope, safety, data contracts, or expensive architecture direction.
     - Any unresolved material assumption must be explicit and traceable; do not silently guess it.
     - A BA package is useful for multi-role handoff, but its absence must not block a clearly specified build merely to satisfy ceremony.

   **Brownfield Full Build** (existing meaningful codebase):

   - If `.forgewright/business-analyst/handoff/ba-package.md` exists → read it, pass to PM. Log: `✓ BA package loaded — requirements pre-validated`
   - If no BA package: inspect material requirement gaps directly. Route to BA when gaps can change the contract; otherwise proceed with a concise verified scope handoff.
   - Do not treat a self-scored completeness number as evidence. Use the actual user spec, project state, and unresolved decisions.

   **Non–Full-Build modes** (Feature, etc.): route to BA only when material requirement ambiguity remains after grounding; do not route solely because a numeric completeness heuristic is low.

   - **Context-aware routing (v7.0):** If project-profile shows health issues, suggest addressing them:
     - `health.tests_pass == false` → suggest Harden mode first
     - `risk.known_cves > 0` (Critical/High) → warn and suggest Security audit
     - `risk.tech_debt_score > 7` → suggest addressing tech debt before new features

8. **Close pipeline-owned material unknowns before dependent dispatch** — use the Research Gate only for current/niche/technical facts that can change the decision. Domain specialists may conduct additional research only when research is intrinsic to their specialty; they must not duplicate the generic source-trust/instruction-boundary loop.

9. **Create task tracking when useful:**

Track only applicable work and dependencies. Canonical task IDs may remain for compatibility, but mark irrelevant lanes `SKIPPED` instead of inventing tasks so a fixed count is filled.

10. **Begin Phase 1** — read `phases/define.md` and start immediately. Do NOT ask "should I proceed?"
   - **Memory save (session start):** Run `python3 scripts/mem0-v2.py add "Session started: [mode] mode for [brief request]. Engagement: [level]" --category session`

**Key principle:** Ground, right-size, plan, execute, verify. Pause only at material approval gates defined by the user/project/safety contract. In Thorough/Meticulous mode, show additional phase summaries as requested; do not turn informational handoffs into mandatory approvals.

After a **substantial** user request, persist only durable decisions/progress/blockers that will matter to a later session. Do not write memory for trivial chat/status turns, and never treat remembered state as proof of the current workspace.

## Quality Gate Integration

Use the Universal Quality Gate Protocol (`skills/_shared/protocols/quality-gate.md`) proportionally:
- `QUICK`: focused acceptance + directly relevant safety checks; no scorecard required.
- `STANDARD`: changed-behavior/static/regression checks at meaningful boundaries.
- `DEEP`, merges, and releases: full applicable gate + independent review/compatibility/security evidence.

For brownfield projects, any newly introduced regression in previously passing affected behavior is blocking. For greenfield projects, prove the implemented acceptance criteria rather than inventing a historical baseline. Numeric quality scores are optional telemetry and never override hard evidence.


### Session Handoff Protocol

When context reaches 80% capacity or session needs to transfer:

```
┌─────────────────────────────────────────────────────────────────────┐
│ SESSION HANDOFF PROTOCOL │
├─────────────────────────────────────────────────────────────────────┤
│ │
│ 1. GENERATE handoff document at .forgewright/handover-[date].md │
│ │
│ 2. INCLUDE in handoff: │
│ - Goals accomplished │
│ - What was done │
│ - Key decisions made │
│ - Blockers / open questions │
│ - Next steps │
│ │
│ 3. START fresh session with only: │
│ - Handover document │
│ - Project brief │
│ - Current task context │
│ │
│ 4. VERIFY handoff completeness: │
│ - Can the new session resume without asking user to re-explain? │
│ - Are all decisions documented? │
│ - Are blockers clearly stated? │
│ │
└─────────────────────────────────────────────────────────────────────┘
```

**When to trigger handoff:**
- The runtime/tool reports material context pressure (do not guess a percentage).
- The user explicitly transfers/continues in another session.
- Work spans sessions/days and a fresh role needs a bounded resume package.
- A failure/ownership transition requires an auditable handoff.

### Token Budget Management

```
┌─────────────────────────────────────────────────────────────────────┐
│ TOKEN BUDGET MANAGEMENT │
├─────────────────────────────────────────────────────────────────────┤
│ │
│ Context Monitoring (only from runtime/tool evidence): │
│ - Rising pressure → compact verbose logs / duplicate context │
│ - Material pressure → checkpoint current task + decisions │
│ - Critical reported pressure → generate bounded handoff before continuing │
│ │
│ Compaction Strategy: │
│ - Replace verbose logs with summaries │
│ - Remove redundant context │
│ - Keep only essential decisions │
│ - Archive intermediate artifacts │
│ │
│ Preservation Priority: │
│ 1. Current task state │
│ 2. Key architectural decisions │
│ 3. Unresolved blockers │
│ 4. Recent learnings │
│ │
└─────────────────────────────────────────────────────────────────────┘
```

### Memory Integration Best Practices

**Persistent Memory (ChromaDB + sentence-transformers):**
- Store architectural decisions: `mem0-v2.py add "ARCH: [details]"`
- Store project context: `mem0-v2.py add "PROJECT: [name]"`
- Store technical learnings: `mem0-v2.py add "LESSON: [insight]"`

**Session Memory (localStorage):**
- Current task progress
- Recently modified files
- User preferences

**Cross-Session Continuity:**
- Project profile loaded at session start
- Previous session learnings available
- Long-term context preserved

### Error Recovery Patterns

| Error Type | Detection | Recovery |
|-----------|-----------|----------|
| Compilation failure | Build step fails | Read error, fix syntax, retry |
| Test failure | QA step fails | Identify test, fix code, re-run |
| Missing dependency | npm install fails | Install dependency, retry |
| File conflict | Merge fails | Manual resolution, re-merge |
| API contract violation | Integration fails | Update contract, sync teams |
| Security vulnerability | Scan finds CVE | Apply patch or workaround |

**Retry / stuck rule:** Follow `kernel/SOLVE.md`: after the same step fails twice, STOP repeated attempts and use evidence-driven escalation/research. Do not maintain a second retry-count policy here.

### Logging Standards

Substantial execution should log only what another role/session needs. `QUICK` work may use a one-line change/check record. Any timestamp/duration must come from actual tooling; never estimate it:

```markdown
## Skill Execution Log

**Skill:** [name]
**Started:** [timestamp]
**Ended:** [timestamp]
**Duration:** [X] minutes

**Actions Taken:**
- [List of major actions]

**Files Created:**
- [List]

**Files Modified:**
- [List]

**Decisions Made:**
- [List with rationale]

**Blockers Encountered:**
- [List]

**Quality Score:** [X]/100
**Passed Quality Gate:** [Yes/No]

**Handoff Notes:**
- [Any context needed for next session]
```

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

### Metrics, Performance, and Configuration Reference

Metric collection schemas, performance targets, dependency injection patterns, configuration schemas, environment variables, emergency procedures, communication protocols, test topologies, CI/CD templates, deployment checklists, and technical catalog guidance are documented in [references/technical-reference.md](references/technical-reference.md). Canonical skill/mode counts come from `product-manifest.json` / `kernel/INDEX.md`, not prose.

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

Do not use a hard-coded skill count/list here. Resolve current skills from `product-manifest.json`, `skills-registry.yaml`, and `kernel/INDEX.md`. If those sources disagree, treat the manifest/index validation as a project-truth issue and resolve it before routing.

### Session Lifecycle Hooks

Call these hooks at the appropriate lifecycle points:

| Event | Hook | Action |
|-------|------|--------|
| Phase completes | `PHASE_COMPLETE(name, summary)` | Update session-log, save to memory, update quality metrics |
| Task completes | `TASK_COMPLETE(id, name, status, summary)` | Update session-log |
| Gate decided | `GATE_DECISION(gate#, decision, feedback)` | Update session-log, save decision to memory |
| Architecture approved | `ARCH_DECISION(tech_stack, services, rationale)` | Save architecture to memory — see Gate 2.5 |
| Error occurs | `ERROR(task_id, type, details)` | Update session-log, save blocker to memory |
| Pipeline ends | Session End | Summarize, save to memory, update project profile |
| Substantial request/decision closed | `TURN_CLOSE` | Persist only durable project decisions/progress/blockers; skip trivial turns |

## User Experience Protocol

Follow the shared UX Protocol at `skills/_shared/protocols/ux-protocol.md`. Key rules:
1. **Don't** ask open-ended questions — always use notify_user with predefined numbered options (open-ended questions stall the pipeline because the model can't proceed without parsing free-text responses)
2. **"Chat about this"** always last option
3. **Recommended option first** with `(Recommended)` suffix
4. **Continuous execution** — work until next gate or completion
5. **Real-time progress** — constant ⧖/✓ progress updates via task_boundary
6. **Autonomy** — sensible defaults, self-resolve, report decisions

### Gate Companion — Polymath Integration

When the user selects **"Chat about this"** at any gate, invoke the polymath in translate mode:

```
Read skills/polymath/SKILL.md and follow its instructions in translate mode.
The polymath reads the gate artifacts, explains in plain language,
answers the user's questions via structured options,
then re-presents the original gate options when the user is ready.
```

This ensures non-technical users can understand what they're approving without the orchestrator needing to be the translator.

### Review Mode Integration

At each gate, adapt behavior based on `production/review-mode.txt`:

| Mode | Gate Behavior |
|------|--------------|
| **Full** | Run director reviews, show detailed findings, longer approval flow |
| **Lean** | Quick validation, abbreviated findings, streamlined approval |
| **Solo** | Skip gate pause, auto-proceed with quality gate score only |

```
REVIEW_MODE=$(cat production/review-mode.txt 2>/dev/null || echo "lean")
if [ "$REVIEW_MODE" = "solo" ]; then
  # Skip gate pause, log quality score
  Log: "Quality Gate Score: [X]/100 — Auto-proceeding (Solo mode)"
else
  # Show gate options as normal
fi
```

### Strategic Gates (4 total — 3 user-facing + 1 automated)

**Gate 1 — BRD Approval** (after T1):

Notify user via notify_user:
```
BRD complete: [X] user stories, [Y] acceptance criteria. Approve?

1. **Approve — start architecture (Recommended)** — BRD locked, proceed to Solution Architect
2. **Show BRD details** — Display the full BRD before deciding
3. **I have changes** — Request modifications to requirements
4. **Chat about this** — Free-form input about the BRD
```

**Gate 2 — Architecture Approval** (after T2):

Notify user via notify_user:
```
Architecture complete: [tech stack summary]. Approve to start building?

1. **Approve — start building (Recommended)** — Architecture locked, begin autonomous BUILD phase
2. **Show architecture details** — Walk through ADRs, diagrams, and API spec
3. **I have concerns** — Flag issues with architecture decisions
4. **Chat about this** — Free-form input about the architecture
```

**Gate 2.5 — Architecture Memory Persistence** (auto, no user interaction):

After Gate 2 is approved, automatically persist architecture decisions to memory:

```
1. Extract key architecture decisions:
   - Tech stack (language, framework, key libraries)
   - Service decomposition (services, modules)
   - API style (REST, GraphQL, etc.)
   - Database choices
   - Key architectural patterns

2. Run memory persistence commands:
   # Main architecture
   python3 scripts/mem0-v2.py add "ARCH: [tech stack] | SERVICES: [service list] | REASON: [key rationale]" --category architecture
   
   # Individual ADRs
   python3 scripts/mem0-v2.py add "DECISION: [ADR title] | ALTERNATIVE: [rejected options] | REASON: [why chosen]" --category decisions
   
   # Project scope
   python3 scripts/mem0-v2.py add "PROJECT: [project name] | SCOPE: [feature list] | STATUS: active" --category project

3. Log: "✓ Architecture decisions persisted to memory — [N] decisions saved"
```

**Why this matters:** Future sessions can search `mem0-v2.py search "architecture"` to retrieve the approved stack without re-reading all architecture files.

**Gate 3 — Production Readiness** (after T9):

**Read review mode first:**
```
REVIEW_MODE=$(cat production/review-mode.txt 2>/dev/null || echo "lean")
```

**Solo mode: Auto-proceed with quality gate score:**
```
if [ "$REVIEW_MODE" = "solo" ]; then
  Log: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  Log: "Phase 5 — SUSTAIN Complete [Review: Solo]"
  Log: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  Log: "Quality Gate Score: [X]/100"
  Log: "All phases complete — auto-proceeding (Solo mode)"
  Log: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # Skip to final summary
fi
```

**Step G3.1 — Run VERIFIER subagent (before showing Gate 3 to user):**

Before presenting Gate 3 options to the user, run the Cursor `verifier` subagent to confirm all work is actually complete:

```
Invoke: /verifier Confirm all pipeline deliverables are complete and functional for [project-name]
```

The verifier subagent:
1. Reads `.forgewright/subagent-context/PIPELINE_SUMMARY.md` for scope
2. Reads all DELIVERY.json from completed tasks
3. Runs compilation and tests for each deliverable
4. Scans for TODOs, secrets, and obvious bugs
5. Writes report to `.forgewright/subagent-context/VERIFIER_REPORT.md`

**Step G3.2 — Present Gate 3 options (using verifier report):**

Notify user via notify_user (with verifier report summary):
```
All phases complete. Ship it?

## Verifier Report Summary
[VERIFIER_REPORT.md summary — PASS/FAIL count]

1. **Ship it — production ready (Recommended)** — Verifier confirmed ✓
2. **Show full report** — Display complete pipeline summary + verifier details
3. **Fix issues first** — Address remaining findings before shipping
4. **Chat about this** — Free-form input about production readiness
```

If verifier returned **FAIL** or **PARTIAL**:
```
⚠️ Verifier found issues. Review before shipping.

## Verifier Report
[FAIL/PARTIAL findings from VERIFIER_REPORT.md]

1. **Fix and retry verifier** — Address issues, re-run /verifier
2. **Show full report** — See all findings in detail
3. **Override — ship anyway** — Proceed with known issues (not recommended)
4. **Chat about this** — Discuss the findings
```

## Task Dependency Graph

Task execution with clear dependency tracking. The orchestrator reads the architecture output (number of services, pages, modules) and generates tasks accordingly. Supports both **sequential** and **parallel** execution based on `settings.md`.

### Sequential Mode (default)
```
T1: product-manager (BRD)
    ↓ [GATE 1]
T2: solution-architect (Architecture)
    ↓ [GATE 2]
T3a: software-engineer — implement backend services (1 per service)
T3b: frontend-engineer — implement frontend pages (1 per page group)
T4a: devops — Dockerfiles + CI skeleton
    ↓ (code written)
T5: qa-engineer — implement tests (unit/integ/e2e/perf)
T6a: security-engineer — STRIDE + code audit + dep scan
T6b: code-reviewer — arch conformance + quality review
    ↓
T7: devops (IaC + CI/CD)
T8: remediation (HARDEN fixes)
T9: sre (SLOs + chaos + capacity)
T10: data-scientist (conditional on AI/ML)
    ↓ [GATE 3]
T11: technical-writer (API ref + dev guides)
T12: skill-maker
    ↓
T13: Compound Learning + Assembly
```

### Parallel Mode
```
T1: product-manager (BRD)
    ↓ [GATE 1]
T2: solution-architect (Architecture)
    ↓ [GATE 2]
    ┌────────────────────── Parallel Group A (BUILD) ─────────────────┐
    │ T3a: software-engineer ──── worktree: .worktrees/T3a           │
    │ T3b: frontend-engineer ──── worktree: .worktrees/T3b           │
    │ T3c: mobile-engineer   ──── worktree: .worktrees/T3c  [cond.] │
    └────────────────── validate → merge → integration test ─────────┘
    T4a: devops (depends on merged T3a output)
    ↓ (code written)
    ┌────────────────────── Parallel Group B (HARDEN) ────────────────┐
    │ T5:  qa-engineer       ──── worktree: .worktrees/T5            │
    │ T6a: security-engineer ──── worktree: .worktrees/T6a           │
    │ T6b: code-reviewer     ──── worktree: .worktrees/T6b           │
    └────────────────── validate → merge → integration test ─────────┘
    ↓
T7: devops (IaC + CI/CD)
T8: remediation (HARDEN fixes)
T9: sre (SLOs + chaos + capacity)
T10: data-scientist (conditional on AI/ML)
    ↓ [GATE 3]
T11: technical-writer (API ref + dev guides)
T12: skill-maker
    ↓
T13: Compound Learning + Assembly
```

When parallel mode is active, the orchestrator reads `skills/parallel-dispatch/SKILL.md` for the dispatch flow.

### Task Dependencies

| Task | Blocked By | Notes |
|------|-----------|-------|
| T1 | — | First task, no blockers |
| T2 | T1 | Needs BRD |
| T3a | T2 | Backend — implement services from architecture |
| T3b | T2 | Frontend — implement pages from BRD |
| T4a | T2 | DevOps — Dockerfiles + CI skeleton |
| T5 | T3a, T3b | QA — needs code + test plan |
| T6a | T3a, T3b | Security — needs code + threat model |
| T6b | T3a, T3b | Review — needs code + checklist |
| T7 | T5, T6a, T6b | IaC + CI/CD — needs HARDEN output |
| T8 | T5, T6a, T6b | Remediation — needs HARDEN findings |
| T9 | T7, T8 | SRE — needs infra + fixes |
| T10 | T7, T8 | Conditional on AI/ML usage |
| T11 | T9 | Docs — needs all prior output |
| T12 | T9 | Skills — needs all prior output |
| T13 | T11, T12 | Final step |

### Dynamic Task Generation

After Gate 2 (architecture approved), the orchestrator reads the architecture output to determine work units:

1. **Count services** — Read `docs/architecture/` service list or `api/` specs. For each service, note it for sequential implementation in T3a.
2. **Count pages** — Read BRD user stories. Group into page clusters (auth, dashboard, settings, etc.). Note for T3b.
3. **Execute sequentially** — Each service and page group is implemented one at a time, reading the SKILL.md for the relevant skill.

### Conditional Tasks

- **T3b (Frontend):** Skip if `.production-grade.yaml` has `features.frontend: false`
- **T10 (Data Scientist):** Auto-detect by scanning for `openai`, `anthropic`, `langchain`, `transformers`, `torch`, `tensorflow` imports. If not detected and `features.ai_ml: false`, mark as completed immediately.

## Phase Execution

Each phase loads its dispatcher file for task management. In parallel mode, BUILD and HARDEN phases additionally invoke the parallel-dispatch skill.

| Phase | File | Tasks | Parallel Support |
|-------|------|-------|------------------|
| DEFINE | `phases/define.md` | T1, T2 | No (gate-protected) |
| BUILD | `phases/build.md` | T3a, T3b, T3c, T4a | Yes (Group A) |
| HARDEN | `phases/harden.md` | T5, T6a, T6b | Yes (Group B) |
| SHIP | `phases/ship.md` | T7, T8, T9, T10 |
| SUSTAIN | `phases/sustain.md` | T11, T12, T13 |

**Read the phase file BEFORE starting that phase. Never load all phase files at once.**

**Internal skill architecture** — each skill's internal phase structure (executed sequentially in Antigravity):

| Skill | Internal Phases |
|-------|----------------|
| software-engineer | Shared foundations first (Phase 2a), then per-service implementation (Phase 2b). Foundations ensure consistency. |
| frontend-engineer | UI Primitives first (Phase 3a), then Layout + Features (Phase 3b), then Pages (Phase 4). Primitives are foundational atoms. |
| qa-engineer | Unit, integration, e2e, performance tests — sequential by test type |
| security-engineer | Code audit, auth review, data security, supply chain — sequential by domain |
| code-reviewer | Architecture conformance, code quality, performance review — sequential by focus |
| devops | IaC, CI/CD, container orchestration — sequential by layer |
| sre | Chaos engineering, incident management, capacity planning — sequential |
| technical-writer | API reference, developer guides — sequential |

### Skill Dispatch Method

Read the skill's SKILL.md file and follow its instructions directly:

```
Read skills/<skill-name>/SKILL.md and follow its instructions.
Provide context: architecture files, BRD, workspace paths, etc.
```

## Conflict Resolution

Follow the shared protocol at `skills/_shared/protocols/conflict-resolution.md`.

| Artifact | Sole Authority | Others Must NOT |
|----------|---------------|-----------------|
| OWASP, STRIDE, PII, encryption | **security-engineer** | code-reviewer must NOT do security review |
| SLO, error budgets, runbooks | **sre** | devops must NOT define SLOs |
| Code quality, arch conformance | **code-reviewer** | — |
| Infrastructure, CI/CD, monitoring setup | **devops** | sre reviews but doesn't provision |
| Requirements (WHAT) | **product-manager** | architect flags gaps, doesn't change requirements |
| Architecture (HOW) | **solution-architect** | — |

### Remediation Feedback Loop

When HARDEN skills find Critical/High issues:
1. Orchestrator creates T8 (Remediation) task with findings
2. Fix code in `services/`, `frontend/`
3. Re-scan affected files after fixes
4. If still failing after **2 cycles** → escalate to user via notify_user

## Context Bridging

| Task | Reads From | Writes To (Project Root) | Writes To (Workspace) |
|------|-----------|--------------------------|----------------------|
| Polymath | User dialogue, web research | — | `polymath/context/`, `polymath/handoff/` |
| T1: PM | User input, polymath context, web research | — | `product-manager/BRD/` |
| T2: Architect | `product-manager/BRD/` | `api/`, `schemas/`, `docs/architecture/` | `solution-architect/` |
| T3a: Backend | `api/`, `schemas/`, `docs/architecture/` | `services/`, `libs/shared/` | `software-engineer/` |
| T3b: Frontend | `api/`, `product-manager/BRD/` | `frontend/` | `frontend-engineer/` |
| T4: DevOps | `services/`, `docs/architecture/` | Dockerfiles at root | `devops/containers/` |
| T5: QA | `services/`, `frontend/`, `api/` | `tests/` | `qa-engineer/` |
| T6a: Security | All implementation code | — | `security-engineer/` |
| T6b: Review | All implementation + architecture | — | `code-reviewer/` |
| T7: DevOps IaC | Architecture, implementation | `infrastructure/`, `scripts/ci/`, `scripts/` | `devops/` |
| T8: Remediation | HARDEN findings | Fixes in `services/`, `frontend/` | — |
| T9: SRE | All prior outputs | `docs/runbooks/` | `sre/` |
| T10: Data Sci | Implementation (LLM usage) | — | `data-scientist/` |
| T11: Tech Writer | ALL workspace + project | `docs/` | `technical-writer/` |
| T12: Skill Maker | ALL workspace | `skills/` | `skill-maker/` |

**Deliverables** go to project root (respecting `.production-grade.yaml` path overrides). **Workspace artifacts** go to `.forgewright/<skill-name>/`.

## Workspace Architecture

```
.forgewright/
├── .protocols/              # Shared protocols (written at bootstrap)
├── .orchestrator/           # Pipeline state via task.md
├── product-manager/         # BRD, research
├── solution-architect/      # Architecture artifacts
├── software-engineer/       # Backend logs/artifacts
├── frontend-engineer/       # Frontend logs/artifacts
├── qa-engineer/             # Test artifacts
├── security-engineer/       # Security findings
├── code-reviewer/           # Quality findings
├── devops/                  # Infrastructure artifacts
├── sre/                     # Readiness artifacts
├── data-scientist/          # AI/ML artifacts (conditional)
├── technical-writer/        # Documentation artifacts
└── skill-maker/             # Custom skills
```

## Adaptive Rules

| Situation | Action |
|-----------|--------|
| No frontend needed | Skip T3b, simplify DevOps |
| Monolith architecture | Single Dockerfile, skip K8s/service mesh |
| LLM/ML APIs detected | Auto-enable T10 (Data Scientist) |
| Critical security finding | Create remediation task (T8) |
| QA failures > 20% | Flag to user |
| Architecture drift detected | Warn user (arch decisions are user-approved) |
| `features.frontend: false` | Skip T3b entirely |
| `features.ai_ml: false` | Skip T10 unless auto-detected |

## Security Hooks (Continuous)

Security runs during ALL phases:
- Block `rm -rf /`, `chmod 777`, destructive operations
- Block `.env`, `.key`, `.pem`, `credentials.json` from git
- Scan staged files for API keys, tokens, passwords
- Engineers scan for hardcoded secrets as they write code

## Autonomous Behavior

Every skill execution follows:
1. **Build and verify** — after writing code, run it. After writing tests, execute them.
2. **Quality gate** — run `skills/_shared/protocols/quality-gate.md` after each skill output. Score must meet threshold.
3. **Validation loop** — `while not valid: fix(errors); validate()`
4. **Self-debug** — read errors, identify root cause. After 3 failures: stop and report.
5. **Quality bar** — no TODOs, no stubs. All code compiles. All tests pass. Quality score ≥ 90.
6. **TDD enforced** — write test first, watch fail, implement, watch pass, refactor.
7. **Convention compliance** — read `.forgewright/code-conventions.md` (if brownfield) and match existing patterns.

## Partial Execution

| Command | Tasks Run |
|---------|----------|
| `just define` | T1, T2 only |
| `just build` | T3a, T3b, T4 (requires T2 output) |
| `just harden` | T5, T6a, T6b (requires BUILD output) |
| `just ship` | T7-T10 (requires HARDEN output) |
| `just document` | T11 only |
| `skip frontend` | Omit T3b |
| `start from architecture` | Skip T1, start at T2 |
| `just onboard` | Run project-onboarding only (no pipeline) |

## Final Summary — Quality Dashboard

At pipeline completion, generate the Quality Dashboard from `skills/_shared/protocols/quality-dashboard.md`. This replaces the legacy text banner with a comprehensive, machine-readable quality report.

The dashboard includes:
- **Overall quality score** (0-100) with grade (A-F)
- **Build health** — compilation, Docker, dependencies, lint
- **Test coverage** — unit, integration, E2E, contract, performance, regression
- **Security** — OWASP, STRIDE, CVEs, secrets scan
- **Code quality** — architecture conformance, conventions, stubs, imports
- **Acceptance** — BRD criteria coverage, traceability
- **Pipeline stats** — mode, duration, skills run, files changed

**Machine-readable output:** `.forgewright/quality-report-{session}.json`
**Quality trending:** `.forgewright/quality-history.json` (appended each session)

Also display the legacy summary for backward compatibility:
```
╔══════════════════════════════════════════════════════════════╗
║          Forgewright v{local_version} — COMPLETE                    ║
╠══════════════════════════════════════════════════════════════╣
║  Project: <name>                                             ║
║  Quality Score: [XX]/100 (Grade [A-F])                       ║
║                                                              ║
║  DEFINE:  ✓ BRD (<X> stories) ✓ Architecture (<pattern>)     ║
║  BUILD:   ✓ Backend (<N> services) ✓ Tests (<N> passing)     ║
║  HARDEN:  ✓ Security (<N> fixed) ✓ Code Review (<N> fixed)   ║
║  SHIP:    ✓ Docker ✓ CI/CD ✓ Terraform ✓ SRE approved       ║
║  SUSTAIN: ✓ Docs ✓ Skills (<N> created) ✓ Learnings captured ║
║                                                              ║
║  Workspace: .forgewright/              ║
║  Config: .production-grade.yaml                              ║
║  Report: .forgewright/quality-report-{session}.json              ║
╚══════════════════════════════════════════════════════════════╝
```

## Brownfield Safety Net

For ALL brownfield projects (any mode, not just Full Build), activate the safety net from `skills/_shared/protocols/brownfield-safety.md`:

| Safety Layer | When | Action |
|-------------|------|--------|
| Git branch | Pre-pipeline | Create `forgewright/session-{timestamp}` branch |
| Baseline snapshot | Pre-pipeline | Run existing tests, record pass count |
| Protected paths | Pre-pipeline | Register paths that must not be modified |
| Regression checks | After T3a, T3b, T5 | Verify existing tests still pass |
| Change manifest | During pipeline | Track every file create/modify/delete |
| Merge readiness | Pre-Gate 3 | Full regression + quality check |
| Rollback | On failure | Revert via session branch |

## Common Mistakes

A comprehensive table of common operational/architectural mistakes and their resolutions is documented in [references/common-mistakes.md](references/common-mistakes.md).

## Execution Learnings

> Auto-generated by ASIP. DO NOT DELETE.

### 2026-04-24 — Architectural: Self-Improving Agentic System Design
- **Problem:** Needed to design ASIP protocol for adaptive skill improvement
- **Failed Attempts:** N/A (initial design)
- **Research Source:** https://notebooklm.google.com/notebook/ca68602f-fcf2-4ab9-b8e9-9743868e18b6
- **Solution:** ASIP design combines ACE (incremental delta updates) + Multi-Agent Reflexion (diverse perspectives) + HyperAgents (self-modification)
- **Key Insight:** Self-improvement should be persistent (in code files), human-readable, and transferable. Avoid context collapse by using incremental updates.
- **Apply When:** Designing any self-improvement loop, skill adaptation, or knowledge retention system
