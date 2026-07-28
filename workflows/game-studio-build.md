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
   - Resolve model/reasoning overrides only from the active runtime's structured
     capabilities. Otherwise keep selection `provider-managed` and omit the
     override.
   - Freeze requirements, dependencies, owned paths, checks, advisory token
     budgets, deadlines, and stop conditions in the dispatch packet.
   - If the policy returns workers and delegation is authorized, call the native
     `spawn_agent` adapter for all independent scopes concurrently. Set explicit
     ownership, forbid recursive spawn, and do not dispatch dependent scopes.
     Use `scripts/parallel-dispatch-runner.py` only for its explicitly authorized
     read-only external adapter.
   - Wait for every selected result, verify its owned scope, then fan-in. Resolve
     disagreement before integration and run an isolated expert reviewer from
     requirements, diff, and raw evidence when the policy reserves one.

4. **Execute the active phase**
   - Concept: game promise, engine/platform, pillars, core loop, budgets, Style
     DNA.
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
