# Game Studio Control Plane

> A Codex-native, artifact-driven operating model for taking a game from an idea
> to a verified release without pretending that a fixed roster of agents or an
> external swarm runtime is available.

Use this protocol whenever Game Build mode spans more than one discipline or
phase. A small, single-system edit may enter at the relevant phase, but it must
still preserve the phase's inputs, evidence, and handoff contract.

## Operating Principles

1. **One source of truth** — keep the current phase, active milestone, decisions,
   owners, blockers, and evidence in the resolved studio state path (default:
   `production/session-state/game-studio.md`).
2. **Artifacts before activity** — a phase advances because its required
   artifacts and evidence exist, not because an agent says the work is done.
3. **Vertical responsibility, horizontal review** — a producer/control-plane
   lens coordinates; discipline leads own decisions; specialists implement;
   peer disciplines review cross-domain effects.
4. **Dependency-driven orchestration** — topology follows task dependencies and
   file ownership. Agent count never determines topology by itself.
5. **Codex-native roles** — studio roles are role lenses applied by the current
   agent. Do not claim that named subagents exist. Use actual subagents only when
   the user explicitly requests delegation or parallel agent work. The host owns
   the native `spawn_agent` tool; this repository owns only the routing contract
   and dispatch packet.
6. **Bounded autonomy** — implementation within an approved design can proceed
   end to end. Major creative direction, architecture, scope, monetization, and
   release-risk decisions remain user decisions.
7. **Evidence closes work** — tests, builds, playtests, performance captures,
   screenshots, and acceptance-criteria mappings are the completion record.

## State Path Resolution

Before reading or writing studio state:

1. Read `.production-grade.yaml` and use an existing project-specific
   production or session-state path override when one is defined.
2. Otherwise, preserve an established game-studio state convention discovered
   in the repository.
3. Only when neither exists, use the default
   `production/session-state/game-studio.md`.

Record the resolved path in the turn plan. Do not invent a new configuration key
or create a second state file when the project already has a source of truth.

## Entry Routing

Classify the request before creating work:

| Starting point | Route |
|---|---|
| No concept or a vague idea | Begin at Concept |
| Clear concept, no implementation | Ground engine/platform, then Concept |
| Existing project | Detect current artifacts and enter at the earliest incomplete phase |
| Isolated feature | Enter Production only after design-ready and implementation-ready handoffs exist |
| Bug or hotfix | Use DEBUG/SHIP rules, then attach evidence to the active Production or Release milestone |

Select a review mode and record it in the state file:

- `solo` — minimum required artifacts, one owner may cover several role lenses.
- `lean` — default; required artifacts plus cross-domain review at phase gates.
- `full` — independent discipline reviews and explicit user approval at every
  gate.

Do not create empty ceremony. Only genuinely non-applicable evidence may be
marked `N/A`, and the gate record must explain why the phase outcome is still
proved. Missing applicable required evidence is never a skip.

## Seven-Phase Lifecycle

| # | Phase | Required outcome | Minimum evidence | Gate owner |
|---|---|---|---|---|
| 1 | Concept | A scoped game promise, audience, platform, engine, pillars, core loop, and art direction | Concept/GDD, engine decision, target budgets, approved Style DNA contract | Creative + technical + user |
| 2 | Systems Design | MVP systems are decomposed with dependencies, states, balance inputs, UX flows, and acceptance criteria | Systems index, per-system specs, cross-system review, accessibility targets | Game design |
| 3 | Technical Setup | The game can be built and tested on the chosen stack with explicit architectural boundaries | Architecture, ADRs, control manifest, test scaffold, build command, performance budgets | Technical |
| 4 | Pre-Production | The riskiest assumptions are playable before full production commitment | Throwaway prototype where needed, vertical slice, playtest report, asset/UX inventory, ready epics/stories | Producer + user |
| 5 | Production | Stories move through readiness, implementation, review, QA, and done without losing traceability | Story records, acceptance-criteria evidence, automated tests, smoke builds, design-change log | Producer + discipline leads |
| 6 | Polish | The complete experience meets feel, balance, accessibility, stability, content, and performance targets | Regression results, performance captures, asset audit, balance evidence, representative playtests | QA + creative + technical |
| 7 | Release & Sustain | A reproducible player build is approved, shipped, observable, and supportable | Release candidate plus release artifact identity and checksum, publish/deployment evidence, telemetry and crash-reporting smoke evidence, rollback/hotfix rehearsal, post-release measurement and triage checkpoint | Release + user |

There are **7 phase gates**. Gate checks use this verdict vocabulary:

```text
PASS | CONCERNS | FAIL
```

- `PASS` — required evidence exists and no material unresolved risk remains.
- `CONCERNS` — evidence is sufficient to proceed only if named risks are
  explicitly accepted.
- `FAIL` — required evidence or a blocking decision is missing; do not advance.

Apply evidence status consistently:

- Only genuinely non-applicable evidence may be marked `N/A`; state the
  applicability rule and replacement proof.
- Missing applicable required evidence is always `FAIL`.
- A `FAIL` cannot be accepted or waived. Fix the blocker and rerun the gate.
- Only non-blocking residual risks may receive `CONCERNS`, and each concern needs
  an owner and explicit user acceptance before advancement.

The user approves major direction and any accepted concerns. A passing gate
updates the state file; it does not erase prior evidence.

## Phase Gate Record

Append this record to `production/session-state/game-studio.md`:

```markdown
## Gate: <current phase> -> <next phase>
- Date:
- Review mode: solo | lean | full
- Verdict: PASS | CONCERNS | FAIL
- Required artifacts: <paths and status>
- Evidence commands: <exact commands and exit codes>
- Playtest/build evidence: <paths or not applicable>
- Accepted concerns: <risk, owner, user decision>
- Blockers:
- Next milestone:
```

The state file is coordination state, not a substitute for GDDs, ADRs, story
files, test output, or release records.

## Studio Responsibility Lanes

Use the smallest set of role lenses that covers the work:

| Lane | Forgewright skills | Owns | Must not decide alone |
|---|---|---|---|
| Control plane | `production-grade`, `project-manager` | Phase, milestone, dependency graph, scope, risk, change propagation | Creative or technical domain decisions |
| Creative direction | `game-designer`, `concept-artist`, `art-director`, `level-designer`, `narrative-designer`, `game-audio-engineer` | Player promise, mechanics, concept exploration, content, presentation, feel | Architecture, release acceptance |
| Technical direction | `solution-architect`, `game-engineer`, engine-specific skills, `technical-artist` | Architecture, engine integration, runtime budgets, tools | Product scope or player-facing design intent |
| Quality | `qa-engineer`, `game-accessibility-engineer`, `performance-engineer`, `security-engineer` | Test strategy, evidence, regression, performance, accessibility, abuse cases | Waiving release risk |
| Release and sustain | `build-release-engineer`, `devops`, `sre`, `liveops-engineer` | Reproducible builds, packaging, rollout, observability, hotfix readiness | Shipping with any gate failure or unaccepted concern |

For a solo developer, one agent may apply multiple lenses sequentially. It must
label the lens change and preserve independent evidence; it must not manufacture
agreement between roles.

## Handoff Applicability

Handoffs are phase-conditional. Greenfield work does not need downstream inputs
before the phase that creates them.

| Phase | Required at entry | Completion record |
|---|---|---|
| Concept | None | Phase gate record |
| Systems Design | Passed Concept gate | Design-ready handoff + phase gate record |
| Technical Setup | Design-ready handoff | Implementation-ready handoff + phase gate record |
| Pre-Production | Implementation-ready handoff only for prototype/vertical-slice code | Phase gate record + slice evidence |
| Production | Design-ready and implementation-ready per story | Done handoff per story + phase gate record |
| Polish | Passed Production gate and complete story evidence | Phase gate record + regression/playtest evidence |
| Release & Sustain | Passed Polish gate and identified release candidate | Phase gate record + publish/operate evidence |

Non-code phases close with their phase gate record. A done handoff applies to an
implemented story or code-bearing deliverable, not to Concept or Systems Design
work.

## Handoff Contracts

### Creative routing and executable dispatch contract

Design and Game Build work use the same ordered creative handoff:

```text
UX/research -> Concept Artist -> Art Director -> UI/technical/engine handoff
```

The named skill files are `skills/concept-artist/LITE.md` and
`skills/art-director/LITE.md`; downstream handoff paths include
`skills/ui-designer/LITE.md`, `skills/technical-artist/LITE.md`, and the
selected engine skill. Before dispatching a creative or downstream scope, run
the repository-owned executables in this order:

1. Resolve ordered, verified skill paths with
   `python3 scripts/runtime/skill_routing.py --mode "$MODE" --config .forgewright/skills-config.json`.
2. Validate the concept and art artifacts with
   `python3 scripts/art-direction/creative-handoff.py validate-handoff "$CONCEPT_PACKET" "$ART_DIRECTION_GATES"`.
3. Freeze a skill-aware dispatch packet containing each item's skill name,
   `skill_path`, validated artifact paths, owned paths, checks, tier, and stop
   conditions. Do not dispatch from an unfrozen or path-only packet.
4. Resolve verified model fields by calling
   `python3 scripts/runtime/codex-subagent-routing.py --config .production-grade.yaml --capabilities-json "$CODEX_SPAWN_CAPABILITIES_JSON" --tier "$TIER" --agent-type "$AGENT_TYPE" --overrides-json "$EXPLICIT_OVERRIDES_JSON"`.
5. Give the frozen skill item/path and the resolver's emitted
   `spawn_agent_args` to the **host-owned native `spawn_agent`** tool. The
   repository does not provide, invoke, or own that native tool; when the host
   does not expose it, keep the work local and report the boundary.

### Design-ready handoff

Required before architecture or story creation:

- player problem and game pillar served;
- mechanic state/flow and failure cases;
- tunable values stored as data, not literals embedded in implementation;
- UX, art, audio, accessibility, analytics, and platform implications;
- measurable acceptance criteria and out-of-scope boundary;
- unresolved questions and decision owner.

### Implementation-ready handoff

Required before code changes:

- approved design-ready handoff;
- governing ADR/control-manifest rules;
- dependency stories and target paths;
- path ownership and protected paths;
- automated checks plus manual playtest evidence where feel is involved;
- performance/build budgets and rollback strategy for risky changes.

### Done handoff

Required before a story closes:

- every acceptance criterion mapped to code and evidence;
- relevant tests/builds pass with exact commands;
- manual playtest evidence covers non-automatable feel or visuals;
- GDD/ADR deviations are recorded and propagated;
- known defects and follow-up work are owned.

## Topology Decision

Choose topology from the dependency graph:

| Topology | Use when | Control |
|---|---|---|
| `serial-local` | One lane, one file scope, or each output is needed by the next step | Work locally in dependency order |
| `pipeline` | Design → architecture → implementation → QA has strict handoffs | Each stage consumes a versioned handoff; blocked stages stop downstream work |
| `fan-out/fan-in` | Independent research or reviews share immutable inputs | Freeze the review packet, collect every result, then synthesize disagreements |
| `hierarchical` | A milestone spans multiple independent, path-disjoint lanes | One control-plane owner, bounded workers, explicit ownership, scheduled fan-in |

Before any multi-agent dispatch, run the deterministic decision contract in
`scripts/runtime/orchestration_policy.py`. Follow its worker cap, reviewer
reservation, risk routing, stop conditions, and advisory budget. Never add
workers solely because a task touches three files.

Rules for every dispatched worker:

- one bounded deliverable and one path ownership scope;
- immutable requirements and dependency inputs;
- no recursive spawn;
- no edits outside owned paths without a control-plane handoff;
- exact verification command and a completion/blocker message;
- partial results remain usable when another worker blocks.

For security, schema, public API, concurrency, release-risk, or unresolved
creative/technical disagreement, use an expert or independent review. Do not
claim that a textual `raft`, `consensus`, or `anti_drift` setting provides
runtime guarantees. In Forgewright, anti-drift comes from bounded scope, file
ownership, shared state, checkpoints, evidence, and explicit fan-in.

## Model-Aware Subagent Dispatch

When the deterministic policy selects one or more workers and the user has
authorized delegation or parallel work, apply
`skills/_shared/protocols/model-tier.md` before spawning. Tier selection and
concrete model selection are separate:

| Tier | Game-studio work | Quality boundary |
|---|---|---|
| `scout` | Mechanical inventory, bounded repository search, asset/status extraction | Read-only evidence; no design or architecture decisions |
| `builder` | Normal implementation, content production, tests, and bounded synthesis | Own one disjoint path scope and its exact checks |
| `expert` | Security, schema, public API, concurrency, release risk, unresolved creative/technical disagreement, or independent review | Do not downgrade the tier to save tokens |

Use the tier to optimize cost before selecting a model: scouts handle narrow
mechanical work, builders handle normal production, and experts are reserved for
high-risk judgment and fresh review. Keep the parent agent as control-plane
owner; it coordinates, verifies, and synthesizes instead of duplicating worker
implementation.

Resolve a concrete model only from a same-invocation structured capability probe:

1. For the native Codex collaboration runtime, read `subagents.codex` from
   `.production-grade.yaml`, resolve explicit task override → agent type → tier
   → default, then inspect the active `spawn_agent` schema and validate its
   advertised model overrides and reasoning controls.
   Immediately before each native spawn, run:
   `python3 scripts/runtime/codex-subagent-routing.py --config .production-grade.yaml --capabilities-json "$CODEX_SPAWN_CAPABILITIES_JSON" --tier "$TIER" --agent-type "$AGENT_TYPE" --overrides-json "$EXPLICIT_OVERRIDES_JSON"`.
   Pass only its emitted `spawn_agent_args` JSON object to the host-owned native
   `spawn_agent`; the repository does not own that tool.
2. For the external read-only adapter, use
   `scripts/parallel-dispatch-runner.py`, which probes the active provider and
   enforces the capability rules in `model-tier.md`.
3. Pass a concrete model or reasoning override only when that runtime
   capability is verified and matches the selected tier.
4. If a safe match is absent, use `provider-managed` selection and omit the
   override. Do not hard-code model IDs, infer them from prose, or silently
   lower an `expert` assignment.

Before spawning, freeze a dispatch packet containing the task requirements,
dependency inputs, owned paths, tier, advisory token budget, deadline, stop
conditions, and exact checks. Spawn selected independent workers concurrently;
never start a dependent scope early. Every worker returns a bounded result,
evidence, changed paths when writes were authorized, and blockers.

At fan-in:

- wait for every selected worker or an explicit stop condition;
- reject out-of-scope edits and rerun each scope's exact checks;
- compare overlapping conclusions and escalate unresolved disagreement to
  `expert`;
- reserve one advisory token-budget slot when independent review is requested;
- give the independent reviewer only immutable requirements, diff, and raw
  evidence, never worker reasoning or mutable synthesis context;
- run parent-level integration, playtest, and phase-gate checks after merging
  results.

Parallel completion is not a quality verdict. A faster worker result may enter
the milestone only after its evidence passes and fan-in finds no unresolved
cross-lane conflict.

## Production Story Loop

Each story follows:

```text
READY -> IN PROGRESS -> REVIEW -> QA -> PLAYTEST (when needed) -> DONE
```

1. **READY** — validate design-ready and implementation-ready handoffs.
2. **IN PROGRESS** — implement only the accepted scope and update tests.
3. **REVIEW** — check architecture, design fidelity, cross-domain effects, and
   unintended changes.
4. **QA** — execute `game-test-protocol.md` at the appropriate engine layer.
5. **PLAYTEST** — required for feel, difficulty, UX, level flow, audio, and
   accessibility outcomes that automated tests cannot prove.
6. **DONE** — attach the done handoff; never mark done from implementation alone.

Design changes discovered mid-story go back to the owning design artifact. The
control-plane lane identifies downstream GDDs, ADRs, stories, assets, tests, and
release notes that need propagation before work resumes.

## Verification Stack

Use the existing Forgewright controls rather than duplicating them:

1. `skills/_shared/protocols/game-test-protocol.md` — mechanics, balance, state,
   performance, integration, platform, visual, and build evidence.
2. `skills/_shared/protocols/quality-gate.md` — repository-wide test, lint,
   coverage, security, build, and visual requirements.
3. `skills/_shared/protocols/task-validator.md` — delivery versus task contract.
4. `skills/_shared/protocols/game-studio-pipeline.md` — phase readiness,
   cross-domain handoffs, playtest evidence, and accepted risk.

Build success does not prove playability, fun, legibility, accessibility, or
performance. A visual review does not prove mechanics or state correctness.
Both forms of evidence are required when the acceptance criteria span both.

## Session Close

Before ending game-studio work:

1. Update `production/session-state/game-studio.md`.
2. Record changed artifacts, active phase/milestone, next dependency, and
   blockers.
3. Persist design or architecture decisions in their owning documents.
4. Release runtime leases per the Runtime Lifecycle Guard.
5. Report exact verification evidence and any accepted concerns.

## Research Basis

This control plane synthesizes the lifecycle and studio hierarchy patterns from
Donchitos/Claude-Code-Game-Studios, dependency-aware swarm patterns from
benedek-dev/RGS-Framework, and the explicit Codex adaptation rules from
eiichimo/Codex-Game-Studios. It intentionally reuses Forgewright's existing
orchestration policy, verification contracts, memory, guardrails, and engine
skills instead of importing another runtime or duplicating an agent roster.
