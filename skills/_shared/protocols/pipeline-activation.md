---
id: pipeline-activation
title: Pipeline Activation Protocol
summary: Proportional activation and state tracking across supported Forgewright clients.
status: active
version: 2.0.0
owners: [core]
triggers: []
used_by: [all]
related: [pipeline, senior-execution-contract, plan-quality-loop]
supersedes: []
superseded_by: null
---
# Pipeline Activation Protocol

<!-- source: skills/_shared/protocols/pipeline-activation.md -->

This protocol defines how a request enters Forgewright across Antigravity, Codex, Claude Code, Cursor, Gemini CLI, and OpenCode. Activation must improve grounding and continuity without adding user-visible ceremony or work that the request does not need.

## Activation Contract

For each new user request:

1. Treat the message as a fresh instruction boundary and reconcile it with the current user objective, workspace/runtime evidence, and active safety constraints.
2. Load bounded relevant memory/context using the kernel boot contract. Memory is context, never proof of current project state.
3. Classify task/mode and effort: `QUICK`, `STANDARD`, or `DEEP`.
4. Plan proportionally:
   - `QUICK` → `ACTION | TARGET | CHECK`, no numeric plan score.
   - `STANDARD` / `DEEP` → use the applicable complexity-scaled plan threshold.
5. If Forgewright MCP/state tracking is available and the work is substantial enough to benefit from it, start/update pipeline state. Do not fail a trivial local task merely because telemetry/state tracking is unavailable.
6. Advance phases only when the work actually changes phase. Review/status/question tasks may never enter BUILD or SHIP.
7. Before closing substantial work, verify acceptance and pipeline state consistency. Success claims still require the kernel `VERIFY` contract.

Do not emit magic activation tokens such as reset banners. Internal state transitions should stay internal unless the user needs the information.

## Failure Rules

Activation is invalid when it causes or accepts any of the following:
- invented current project state, file/API/version/capability claims;
- stale pipeline state presented as current truth;
- a derived request artifact that contradicts the latest user instruction;
- a blanket plan threshold or research gate applied to `QUICK` work;
- phases/roles/tasks created only to demonstrate process compliance;
- model/provider names assumed without current runtime evidence;
- a success claim without deterministic verification.

MCP setup drift or unavailable telemetry is reported as an observability/tooling issue, not silently converted into a product failure.

## Verification Commands

```bash
bash scripts/pipeline-preflight.sh --strict
bash scripts/forgewright-mcp-setup.sh --check
bash scripts/verify-mcp-manifest.sh .
```

Use only the checks relevant to the current environment. A repository may support multiple clients without requiring every client/runtime to be installed on every machine.

## State Tracking Guidance

- `QUICK`: state tracking optional unless an active goal/session already relies on it.
- `STANDARD`: track current mode/phase when MCP or local state exists.
- `DEEP`: track phase, material decisions, verification evidence, and unresolved risks so another senior role can resume safely.
- Stale state must be reconciled with git/workspace/runtime evidence before reuse.

---

*Canonical phase semantics: `skills/_shared/protocols/pipeline.md`*
*Turn-level execution: `kernel/ENTRY.md`, `kernel/SOLVE.md`, `kernel/VERIFY.md`*
