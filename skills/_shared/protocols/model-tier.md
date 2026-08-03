---
id: model-tier
title: Capability-Aware Model Tier Protocol
summary: Select a role tier first; select a concrete model only from verified runtime capabilities.
status: active
version: 2.0.0
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

## Codex GPT-5.6 Family

When the current Codex runtime advertises matching model overrides, use this
workload mapping:

| Tier | Preferred model | Workload |
|---|---|---|
| `expert` | Sol | Hardest problems and high-stakes reasoning |
| `builder` | Terra | Everyday production work |
| `scout` | Luna | High-volume workflows and bounded mechanical tasks |

Together, the GPT-5.6 family provides a clear default for each job: Sol for the
hardest problems, Terra for everyday production work, and Luna for high-volume
workflows. These family names express routing intent, not verified model IDs.
Pass a model override only for an exact model ID advertised by the current Codex runtime.
If the preferred model is not advertised, keep `provider-managed` selection and
omit the override instead of inventing or substituting an ID.

## Capability Resolution

1. Probe the active provider in the same authorized invocation.
2. Accept only structured machine-readable model IDs from that runtime probe.
3. Match the requested tier to a supported model ID.
4. If verified, report `model_selection: verified` and pass the exact ID.
5. If the provider owns selection, report `provider-managed` and omit a model flag.
6. If runtime capability data is missing, malformed, human-readable only, or has
   no tier match, report `provider-managed` (or `unavailable` when the provider
   explicitly reports that state) and omit the model flag.

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

Record tier, selection status, capability source, reason, token budget plus
`enforcement: advisory`, enforced deadline/output caps, and stop condition. A
requested reviewer reserves one advisory token-budget slot. Do not record hidden
reasoning or secret-bearing prompts.
