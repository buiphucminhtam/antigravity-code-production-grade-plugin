---
id: model-tier
title: Capability-Aware Model Tier Protocol
summary: Select a role tier first; select a concrete model only from verified runtime capabilities.
status: active
version: 4.0.0
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

## Task-start Runtime and Token Economics Preflight

At the start of every request, identify the active execution surface—Codex,
Claude Code, Antigravity, Cursor, or another runtime—from current system/tool
evidence. Record the surface, provider, capability source, advertised models and
reasoning controls, and available concurrency. Do not infer them from branding,
examples, environment variable names, earlier sessions, or a pricing page.

Every request makes an explicit dispatch-economics decision before deciding
whether to dispatch:

1. Shape the work first. Small, coupled, or serial work records a no-spawn
   decision and stays parent-owned; do not add research or dispatch overhead that
   cannot shorten the critical path or improve acceptance confidence.
2. For any candidate spawn, research the current official input, cached-input,
   and output token rates for each exact advertised model under consideration.
   Record the first-party URL, retrieval date, currency/unit, context threshold,
   and any billed reasoning/intermediate tokens that materially affect the
   estimate. Evidence fetched earlier on the same date may be reused only when
   the provider, exact model, and billing mode are unchanged; otherwise refresh
   it. Missing or unpublished prices are `UNVERIFIED`, never guessed.
3. API list price is not proof of subscription, quota, or credit cost. Record the
   observed billing mode when available; otherwise use list price only as a
   comparison basis and label actual spend `UNVERIFIED`.
4. Estimate candidate input/output tokens, retry risk, parallel critical path,
   and token cost as a range. Avoid false precision when prompt size, reasoning
   tokens, cache hits, or tool-loop depth are unknown.
5. Select in this order: effectiveness first, then wall-clock speed, then total
   tokens and estimated token cost. A cheaper model must not be selected when it
   is likely to increase retries, miss acceptance, weaken required verification,
   or delay the critical path. Use the smallest model/tier that is still likely
   to finish its bounded role correctly and quickly.

The parent owns the final topology and records the considered models, price
evidence, estimated ranges, role fit, spawn/no-spawn decision, and stop condition.
This record is compact task state, not a new durable report.

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
dispatch. This project keeps the provider-validated default moderate, uses low
reasoning for bounded discovery, medium reasoning for implementation, and high
reasoning only for expert/audit work:

```yaml
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
