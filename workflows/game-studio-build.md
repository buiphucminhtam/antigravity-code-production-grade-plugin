---
description: Run an artifact-gated, Codex-native game studio workflow from concept or existing project through release
---

# Game Studio Build Workflow

Use this workflow for a full game, a milestone, or a feature that spans design,
engineering, content, QA, and release responsibilities.

## Control Plane

Read `skills/_shared/protocols/game-studio-pipeline.md` first. It is the source
of truth for phases, role lenses, handoffs, topology, gate verdicts, and session
state.

Do not assume slash commands, named agents, or an external swarm runtime exist.
Apply the required role lenses locally unless the user explicitly requests
delegation or parallel work.

## Ordered Creative Handoff and Dispatch

Design and Game Build work share this handoff order:

```text
UX/research -> Concept Artist -> Art Director -> UI/technical/engine handoff
```

Use the explicit skill files `skills/concept-artist/LITE.md` and
`skills/art-director/LITE.md`, followed by the applicable
`skills/ui-designer/LITE.md`, `skills/technical-artist/LITE.md`, or engine skill.
For each creative/downstream dispatch, execute this repository-owned chain:

1. `python3 scripts/runtime/skill_routing.py --mode "$MODE" --config .forgewright/skills-config.json`
   returns ordered, verified skill paths.
2. `python3 scripts/art-direction/creative-handoff.py validate-handoff "$CONCEPT_PACKET" "$ART_DIRECTION_GATES"`
   validates the concept and art artifacts.
3. Freeze the skill-aware dispatch packet with the selected skill item/path,
   validated artifacts, ownership, checks, tier, and stop conditions.
4. Call `python3 scripts/runtime/codex-subagent-routing.py --config .production-grade.yaml --capabilities-json "$CODEX_SPAWN_CAPABILITIES_JSON" --tier "$TIER" --agent-type "$AGENT_TYPE" --overrides-json "$EXPLICIT_OVERRIDES_JSON"`.
5. The host then invokes its **host-owned native `spawn_agent`** with the frozen
   skill item/path and emitted `spawn_agent_args`. The repository does not own or
   provide the native tool; if the host does not expose it, keep the work local.

## Steps

1. **Detect the entry point**
   - Inspect the project profile, engine files, design artifacts, architecture,
     tests, production records, and release evidence.
   - Classify as greenfield, existing-project adoption, isolated feature, or
     hotfix.
   - Enter at the earliest incomplete phase; do not recreate valid artifacts.

2. **Open the studio state**
   - Resolve `.production-grade.yaml` path overrides and any existing project
     convention first; use `production/session-state/game-studio.md` only as the
     default.
   - Read or create the single resolved studio state file.
   - Record review mode (`solo`, `lean`, or `full`), current phase, milestone,
     decisions, owners, blockers, and evidence links.

3. **Plan the milestone**
   - Produce only the handoff required by the active phase, using the Handoff
     Applicability table in the control-plane protocol.
   - Concept has no handoff prerequisite; Systems Design produces design-ready;
     Technical Setup produces implementation-ready; Production stories produce
     done handoffs.
   - Build a dependency graph with exact path ownership and checks.
   - Use `serial-local` for dependent local work.
   - Before any multi-agent dispatch, run the deterministic contract in
     `scripts/runtime/orchestration_policy.py`; honor its worker cap, reviewer
     reservation, risk routing, and stop conditions.
   - Read `skills/_shared/protocols/model-tier.md`; record each selected scope's
     `scout`, `builder`, or `expert` tier before resolving any concrete model.
   - Read `subagents.codex` from `.production-grade.yaml`. Resolve explicit task
     override → agent type → tier → default, then validate the exact model and
     reasoning effort against the active runtime's structured capabilities.
     Immediately before each native spawn, run the exact command:
     `python3 scripts/runtime/codex-subagent-routing.py --config .production-grade.yaml --capabilities-json "$CODEX_SPAWN_CAPABILITIES_JSON" --tier "$TIER" --agent-type "$AGENT_TYPE" --overrides-json "$EXPLICIT_OVERRIDES_JSON"`.
     Pass only its emitted `spawn_agent_args` object to `spawn_agent`; otherwise
     keep selection `provider-managed` and omit unsupported fields.
   - Freeze requirements, dependencies, owned paths, checks, advisory token
     budgets, deadlines, and stop conditions in the dispatch packet.
   - If the policy returns workers and delegation is authorized, ask the host-owned
     native `spawn_agent` adapter to run all independent scopes concurrently. Set
     explicit ownership, forbid recursive spawn, and do not dispatch dependent
     scopes.
     Use `scripts/parallel-dispatch-runner.py` only for its explicitly authorized
     read-only external adapter.
   - Wait for every selected result, verify its owned scope, then fan-in. Resolve
     disagreement before integration and run an isolated expert reviewer from
     requirements, diff, and raw evidence when the policy reserves one.

4. **Execute the active phase**
   - Concept: game promise, engine/platform, pillars, core loop, budgets,
     divergent visual concepts, selected concept packet, and approved Style DNA.
   - Systems Design: systems map, per-system specifications, dependencies,
     balance, UX, accessibility, acceptance criteria.
   - Technical Setup: architecture, ADRs, control manifest, test/build scaffold.
   - Pre-Production: prototype risky assumptions, build and playtest a vertical
     slice, prepare epics/stories.
   - Production: run each story through readiness, implementation, review, QA,
     playtest where needed, and done evidence.
   - Polish: regression, performance, balance, accessibility, content, art/audio
     integration, representative playtests.
   - Release & Sustain: identify the release artifact and checksum. Publish or
     deploy the approved artifact; smoke telemetry and crash reporting; rehearse
     rollback/hotfix; run a post-release measurement and triage checkpoint.

5. **Verify**
   - Run `skills/_shared/protocols/game-test-protocol.md`.
   - Run `skills/_shared/protocols/quality-gate.md`.
   - Run `skills/_shared/protocols/task-validator.md`.
   - Attach exact commands, exit codes, build artifacts, and playtest evidence.

6. **Gate and persist**
   - Issue `PASS`, `CONCERNS`, or `FAIL` using the control-plane criteria.
   - Advance only on `PASS`, or on `CONCERNS` after the user accepts each risk.
   - Update studio state and propagate design/architecture changes to every
     affected artifact before starting dependent work.

## Completion

The workflow is complete only when the requested outcome has its phase-appropriate
completion record, all applicable evidence is attached, accepted concerns are
explicit, runtime leases are reconciled, and the next milestone or support owner
is named. Non-code phases close with a phase gate record; implemented stories
also require a done handoff. A Release & Sustain outcome additionally requires
publish/deployment evidence and the post-release measurement checkpoint.
