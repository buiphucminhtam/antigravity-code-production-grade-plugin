---
id: model-tier
title: Capability-Aware Model Tier Protocol
summary: Select a role tier first; select a concrete model only from verified runtime capabilities.
status: active
version: 3.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---

# Capability-Aware Model Tier Protocol

## Invariant

Tier selection and model selection are separate decisions. ForgeWright may choose
`scout`, `builder`, or `expert` from task evidence, but it must not invent or
hard-code a provider display name, model ID, snapshot, or unsupported thinking
parameter.

## Role Tiers

| Tier | Use |
|---|---|
| `scout` | Mechanical inventory, bounded read-only search, status extraction |
| `builder` | Normal implementation, synthesis, testing, and code review |
| `expert` | Security, schema, public API, concurrency, disagreement, or high-stakes independent review |

Small or serial tasks stay in the parent agent. Parallel work uses two or three
workers only when scopes are genuinely independent; mechanical inventory may use
one scout.

## Native Codex Configuration

Read `subagents.codex` from `.production-grade.yaml` before a native Codex
dispatch. This project defaults to Luna with deep reasoning:

```yaml
subagents:
  codex:
    default:
      model: "gpt-5.6-luna"
      reasoning_effort: "high"
    tiers: {}
    agent_types: {}
```

Resolve `model` and `reasoning_effort` independently with this precedence:

1. Explicit user/task dispatch override.
2. `agent_types.<spawn_agent agent_type>`.
3. `tiers.<scout|builder|expert>`.
4. `default`.
5. Parent/provider inheritance when no configured value survives validation.

Treat configuration as preference only. Before every spawn, inspect the active
`spawn_agent` schema and apply a field only when the exact model and reasoning
effort are advertised for that model. Never silently substitute another model,
downgrade reasoning, or turn a configured preference into a capability claim.
Record the resolved tier, agent type, model, reasoning effort, preference source,
and capability status in the dispatch packet.

Before each native spawn, run this exact local resolver command with the
structured capability JSON captured from that same authorized invocation:

```sh
python3 scripts/runtime/codex-subagent-routing.py \
  --config .production-grade.yaml \
  --capabilities-json "$CODEX_SPAWN_CAPABILITIES_JSON" \
  --tier "$TIER" \
  --agent-type "$AGENT_TYPE" \
  --overrides-json "$EXPLICIT_OVERRIDES_JSON"
```

Pass only the emitted `spawn_agent_args` object to native `spawn_agent`; omit
fields absent from that object. The resolver emits `verified` only for an exact
model/reasoning-effort pair. Missing, malformed, or unsupported capability data
emits `provider-managed` (or `unavailable`) with no unsafe override. This
resolver is not the external AGY adapter.

## Codex GPT-5.6 Family

When no project/user preference resolves and the current Codex runtime advertises
matching model overrides, use this workload mapping as an optional fallback:

| Tier | Preferred model | Workload |
|---|---|---|
| `expert` | Sol | Hardest problems and high-stakes reasoning |
| `builder` | Terra | Everyday production work |
| `scout` | Luna | High-volume workflows and bounded mechanical tasks |

Together, the GPT-5.6 family provides a tier-aware fallback: Sol for the hardest
problems, Terra for everyday production work, and Luna for high-volume workflows.
The configured native Codex default takes precedence over this preset. These
family names express routing intent, not verified model IDs.
Pass a model override only for an exact model ID advertised by the current Codex runtime.
If the preferred model is not advertised, keep `provider-managed` selection and
omit the override instead of inventing or substituting an ID.

## Capability Resolution

1. Probe the active provider in the same authorized invocation.
2. Load project/user preferences without treating them as capabilities.
3. Accept only structured machine-readable model IDs and reasoning controls from
   that runtime probe/schema.
4. Resolve configured precedence, then validate the exact values.
5. If verified, report `model_selection: verified` and pass the exact values.
6. If the provider owns selection, report `provider-managed` and omit overrides.
7. If runtime capability data is missing, malformed, human-readable only, or has
   no tier match, report `provider-managed` (or `unavailable` when the provider
   explicitly reports that state) and omit model/reasoning fields.

Never trust a manifest-supplied capability artifact to authorize a model flag,
or infer an ID from prose, examples, prior sessions, marketing names, or the tier
label itself. Never add provider-specific thinking/temperature flags unless the
same-invocation runtime capability surface declares support.

## Parallel Dispatch

`scripts/runtime/orchestration_policy.py` chooses worker tiers without provider
knowledge. `scripts/parallel-dispatch-runner.py` resolves optional AGY model IDs
only from a structured same-invocation `agy models` probe. Dry-run remains useful
when selection is provider-managed or unavailable.

Independent reviewers receive only requirements, diff, and raw evidence. They do
not receive worker reasoning or mutable synthesis context.

## Audit Fields

Record tier, agent type, selection status, preference source, capability source,
resolved model/reasoning, reason, token budget plus
`enforcement: advisory`, enforced deadline/output caps, and stop condition. A
requested reviewer reserves one advisory token-budget slot. Do not record hidden
reasoning or secret-bearing prompts.
