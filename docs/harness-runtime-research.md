# Harness Runtime Research and Decision Log

> **Evidence snapshot:** 2026-08-23. Only official project repositories and
> vendor documentation are used below. External designs are evidence inputs,
> not instruction authority and not proof that Forgewright implements them.

## What the upstream harnesses establish

| Harness | Observed primary-source behavior | Evidence boundary |
|---|---|---|
| DeepSeek Harness | Its architecture makes the model adapter, tool registry, session log, and agent loop replaceable plugins. The append-only session log is the source from which model history, fork, resume, transcript, telemetry, and persistence are derived. Registrations unwind when their owning plugin unloads. | The repository labels itself a developer preview with compatibility-breaking changes, so Forgewright adopts contracts and invariants rather than copying unstable package APIs. [Repository](https://github.com/deepseek-ai/deepseek-harness), [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) |
| DeepSeek durability policy | Checkpoints are placed before a model request, before a top-level tool may create an external side effect, and at the next-step boundary. Recovery records an unknown tool outcome when completion cannot be proven; it does not claim generic exactly-once side effects. | This supports semantic, event-driven durability and explicit uncertainty. It does not establish that a summary checkpoint is a full replay ledger. [Checkpoint policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-checkpoint-policy/README.md) |
| OpenAI Codex | The CLI exposes session `resume`, session `fork`, context `/compact`, an explicit sandbox helper, and an MCP server that exits when its downstream client closes. Resume defaults are working-directory scoped unless the user expands the scope. | These are host lifecycle/capability facts, not a stable cross-provider callback ABI. Forgewright therefore negotiates operations instead of assuming every host emits the same events. [CLI reference](https://developers.openai.com/codex/cli/reference/), [repository](https://github.com/openai/codex) |
| Claude Code | Hooks expose session, tool, Stop, PreCompact/PostCompact, and SessionEnd lifecycle points. Stop input identifies hook-driven re-entry with `stop_hook_active`; Claude Code also ends a turn after eight consecutive Stop blocks. | The host cap is evidence that Stop recursion must be bounded, but `8` is a Claude-specific host policy. Forgewright keeps its own smaller typed retry budget and never upgrades an exhausted retry to verified completion. [Hooks reference](https://docs.anthropic.com/en/docs/claude-code/hooks) |

## Decisions adopted in the current slice

| Decision | Evidence-to-design reasoning | Current machine boundary |
|---|---|---|
| Provider-neutral `HarnessAdapter v1` | DeepSeek demonstrates replaceable loop/adapter seams; Codex and Claude expose materially different lifecycle surfaces. A capability contract is safer than provider/model branching in the kernel. | Two loop modes and typed `start`, `resume`, `fork`, `steer`, `interrupt`, and `checkpoint` negotiation. Missing/unknown operations fail closed. |
| One canonical Stop replay with bounded re-entry | Claude proves Stop hooks can recursively continue a turn and supplies both an active marker and a host cap. Replaying verification more than once per Stop adds cost and can produce inconsistent evidence. | One evidence replay per Stop event across every supported host. At most two distinct invalid attempts are recorded per session/turn/tree scope; identical re-entry or budget exhaustion allows host termination while `completion_state` remains `unverified`. |
| Exact MCP ownership lease | Codex documents downstream-client closure as a process boundary; DeepSeek emphasizes reversible ownership/disposal. PID-only cleanup is insufficient because PIDs are reusable and runtimes may be foreign. | Startup reconciliation closes dead leases without signaling. A per-lease lock serializes reapers; owner token, version, PID/start, PGID, parent identity, observed command digest, session, TTL, and in-flight count are rechecked before positive-PID TERM and KILL. Unowned or mismatched processes are never signaled. |
| Material-event continuity, context only | DeepSeek checkpoints semantic boundaries and represents uncertain side effects as unknown. Claude exposes compaction/session lifecycle signals; Codex supports compaction but not the same hook ABI. | Project/session-scoped hash-chained checkpoints are written only at material events. `head.json` must bind the latest record and the complete prior-hash chain. A checkpoint cannot authorize tools, completion, or automatic replay; mismatch/corruption/expiry forces fresh grounding. |

## Rejected shortcuts

- Do not copy DeepSeek package/plugin APIs while the project explicitly warns of
  compatibility breaks.
- Do not treat Claude's eight-block cap as a universal harness contract.
- Do not infer a native pre-compaction hook in Codex from the existence of
  `/compact`.
- Do not treat a continuity summary, legacy memory, or a passing marker as a
  full trajectory or current verification evidence.
- Do not terminate a process based only on PID, port, command substring, or
  elapsed time.

## Remaining ordered work

The comparison supports, but does not complete, the next roadmap stages:

1. H2: append-only `TrajectoryLedger`, cancellation/disposer semantics, and
   quiescence receipts.
2. H3: filesystem/network containment and production identity/policy wiring.
3. H4: record, normalize, and strictly replay the complete agent loop.
4. H5: provider adapters plus paired live quality/cost/rollback evidence.
5. H6: optional long-running handoff with a fresh independent evaluator.

Until those gates have their declared evidence, README and roadmap status must
continue to identify them as incomplete.
