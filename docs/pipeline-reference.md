# Pipeline Reference

Forgewright uses six canonical delivery phases:

`INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

The phase inventory is pinned by `product-manifest.json`. Detailed phase semantics live in `skills/_shared/protocols/pipeline.md`; turn-level behavior and verification are enforced by `kernel/ENTRY.md`, `kernel/SOLVE.md`, and `kernel/VERIFY.md`.

## Proportional execution

The pipeline is not a checklist that manufactures work. Classify effort before expanding the plan:

| Effort | Typical use | Delivery behavior |
|---|---|---|
| `QUICK` | Clear, local, reversible, low risk | Mini-plan, direct change, focused verifier; phases may be compressed |
| `STANDARD` | Normal bounded feature/debug/refactor | Scoped plan, targeted tests, normal review |
| `DEEP` | Security, public contract/schema, concurrency, irreversible/release-critical or high-blast-radius work | Explicit trade-offs, stronger evidence, independent review/rollback where relevant |

A status check or review may need only INTERPRET/DEFINE/HARDEN. A local fix may compress INTERPRET/DEFINE/BUILD/HARDEN. SHIP and SUSTAIN run only when the user objective requires them.

## Phase reference

| Phase | Responsibility |
|---|---|
| **INTERPRET** | Clarify objective, relevant context, constraints, verified facts vs assumptions |
| **DEFINE** | Acceptance criteria, non-goals, effort class, executable plan |
| **BUILD** | Smallest compatible implementation that meets the agreed contract |
| **HARDEN** | Verification proportional to regression/security/reliability risk |
| **SHIP** | Packaging/deployment/release gates only when in scope |
| **SUSTAIN** | Monitoring/operations/iteration only when ongoing operation is in scope |

## Senior role contract

Every routed domain role is senior by behavior, not by provider/model name: it owns outcomes, grounds claims in current evidence, reasons about trade-offs, challenges contradictions and unnecessary work, and protects client scope/time/budget. See `skills/_shared/protocols/senior-execution-contract.md`.

Routing tiers (`scout`, `builder`, `expert`) express capability/cost, not competence. Provider/model selection follows `skills/_shared/protocols/model-tier.md`; skill frontmatter must not pin a provider model.

## Runtime and subagent economics

Every request starts by identifying the active execution surface and provider
from current runtime/tool evidence—for example Codex, Claude Code, Antigravity,
Cursor, or another supported host. A display name, old session, config preference,
or marketing page is not capability evidence.

Small, coupled, or serial work stays with the parent and records `no-spawn`.
When delegation could improve the outcome or shorten the critical path, the
orchestrator checks current first-party input, cached-input, and output token
prices for the exact models advertised by the active runtime. It records source,
retrieval date, units, billing mode, expected token range, retry risk, and likely
critical-path latency. API list prices are comparison evidence, not proof of the
actual cost of a subscription, quota, or credit-backed host.

Selection order is fixed: acceptance effectiveness, wall-clock speed, total
tokens, then estimated token cost. A cheaper model is not an optimization if it
increases retries, delays synthesis, weakens verification, or is unlikely to
complete its bounded role. The chosen topology uses the fewest independent
workers and the smallest capable model/tier that can finish correctly and fast.

The Lite runtime also bounds skill-overlay context before prompt assembly.
`context_budget.max_skill_descriptions_tokens` applies an ordered-prefix budget
using the deterministic `utf8_bytes_div_4_ceil` estimate over each exact
rendered `LITE.md` overlay. Every configured skill path is still validated
before either the skill-count cap or context budget can defer it. Routing output
reports the estimated usage and deferred skill names. This is a local,
provider-neutral estimate, not an exact provider token count or a measured
token-savings claim.

Deferred overlay bodies are not read during budget selection: the router uses
the verified `LITE.md` file byte size for its conservative estimate and reads
only admitted startup overlays. MCP skill discovery is metadata-only. The
canonical `fw_load_skill_overlay` tool resolves one exact discovered skill name,
rejects traversal, symlinks, missing or ambiguous names, and caps the returned
overlay at 48 KiB and 12,000 estimated tokens while reporting a SHA-256 digest
and size metadata. In Lite mode the agent loop advertises only the current
deferred inventory and the exact namespaced loader, permits one successful load
per deferred skill, and rejects speculative, unlisted, or duplicate loads. If
the loader is unavailable, the prompt records that limitation instead of
claiming the overlay was loaded. These are deterministic local controls; live
provider token savings remain unverified until structured usage is available.

## Trajectory lifecycle and quiescence

The canonical MCP runtime opens one contained `forgewright-trajectory-event/v1`
ledger after acquiring its process lease. Persisted events use canonical
safe-integer JSON, contiguous sequence numbers, causal references, SHA-256
previous-hash links, bounded record/ledger sizes, private paths, fsynced atomic
commits, and whole-chain fail-closed reconstruction. The advisory head is
rebuildable; the event chain remains authoritative.

Each MCP tool call receives a child scope and operation record. Only a digest of
deterministically ordered JSON arguments is persisted. Authorization denials,
middleware blocks, returned errors, cached success, thrown errors, and normal
success all traverse lifecycle accounting. Cancellation is persisted before
abort propagation. Disposers persist descriptors before becoming visible, run
child-before-parent and LIFO, coalesce duplicate finalization, and continue
after normalized cleanup failures.

Finalization closes admissions, drains admitted cooperative operations until a
bounded deadline, fences late non-cooperative results, closes scopes, runs every
trusted disposer, binds the ledger predecessor tip into a quiescence record,
and, while durable storage remains available, appends exactly one terminal
event. Only zero unresolved operations, scopes, and disposers may claim
`confirmed`; timeout, storage uncertainty, or uncertain cancellation remains
`not_confirmed` and cannot manufacture a terminal success. Runtime shutdown
then attempts lease release and server close in order. Hash chaining detects
corruption but is not same-user authenticity. Explicit trajectory reuse is
accepted only through the validated checkpoint-store recovery API with exact
tip and writer-epoch fencing; automatic production startup resume remains
disabled, and pending disposer callbacks are rejected rather than rebound.

## Execution containment and runtime trust

The canonical MCP startup pins a real workspace, regular owner-controlled
execution-policy file identity and digest, deployment mode, containment profile,
and optional production caller identity. Production mode fails closed without a
safe caller ID and the `application` profile; unknown modes, broad/symlinked
roots, policy replacement, or policy content drift are rejected. Every
published `fw_*` tool has a declared effect. Unknown tools and undeclared
filesystem, process, or network effects are denied before handlers while still
settling through H2 lifecycle accounting. The bounded skill overlay is a
separate exact-name read capability rather than a general filesystem grant.

Actual state writes validate no-follow workspace/`.forgewright` ancestry,
safe filenames, private modes, bounded state/lock sizes, exclusive temporary
files, fsync, and atomic replacement. The Python filesystem MCP plane exposes
only known methods and validates every path/source/destination against the
canonical workspace, rejecting traversal, outside roots, malformed arguments,
and symlinks before `call_tool`. The policy subprocess receives a minimized
environment instead of inherited credentials.

Webhook networking is absent by default. Loopback needs an explicit port;
external delivery requires exact-host HTTPS allowlisting plus the validated
production trust context. DNS answers must all be public, the transport pins the
selected address, rejects redirects and remote-address mismatch, and omits raw
workspace paths from payloads. These controls are application-level admission
for canonical paths, not kernel egress blocking or a portable sandbox for
arbitrary child processes. Same-user/root bypass and foreign tools remain
explicit limitations; process effects stay disabled without a verified OS or
container backend.

## Proactive continuity and safe recovery

The agent loop writes context-only checkpoints at semantic boundaries rather
than timer or message-count thresholds: before model work, before material
effects, after tool steps, pre-compaction, and handoff. Each checkpoint is
project/session scoped, capped at 64 KiB, secret/scratchpad filtered, and bound
to the current tree, rule-ledger head, optional trajectory/writer epoch, and
capability hash. Hash-chained files and heads reject corruption or replay.

Continuation carries explicit remaining step/tool counts and an expiry. Each
consume request has a unique ID and nonce-bound append-only receipt; cumulative
overrun, duplicate request, wrong nonce, stale tree/ledger/trajectory, or expiry
fails fresh. Resume content is labeled `context-only` and always requires
workspace re-grounding; it cannot authorize tools or completion.

The TypeScript runtime adds a parallel private checkpoint store bound to the
exact trajectory tip and a quiescent coordinator snapshot. Recovery advances
the writer epoch by exactly one, uses expected-tip append fencing, restores only
the original root scope, and refuses terminal, active, cancelled, finalizing,
or pending-disposer state. Arbitrary cleanup callbacks are never deserialized or
replayed; a checkpoint requiring disposer rebinding is rejected. Process lease
ownership remains the outer single-writer fence.

## Offline loop replay

H4 journals versioned lifecycle, checkpoint, model, tool, approval, evidence,
and terminal metadata as a bounded hash chain. Replay is offline and consumes
the exact event order; it rejects missing, extra, reordered, corrupt, secret,
or raw-reasoning records. The journal retains digests and normalized metadata,
not raw prompts, provider responses, or tool payloads. Hashes detect mismatch
but do not authenticate same-user rewrites; H5 remains the live-provider gate.

## Planning and optimization

`QUICK` work uses `ACTION | TARGET | CHECK` and no numeric plan score. `STANDARD`/`DEEP` use the complexity-scaled thresholds in `skills/_shared/protocols/plan-quality-loop.md`. There is no universal 9/10 gate.

Optimization needs an explicit target/SLA, measurement, a known platform/resource/cost constraint, or an evident algorithmic/reliability defect at required scale. Otherwise prefer a simple observable baseline and defer speculative optimization.

`forge bench` measurement record v1 binds canonical task/verifier fingerprints,
resolved settings, per-task provider topology, run identity, timestamps,
end-to-end wall time, and a receipt for every attempt. Reports persist only
SHA-256/byte counts for model and verifier output, never raw prompts or output.
Usage is `reported` only when every attempt supplies a validated receipt;
reported/unavailable counts expose partial coverage while aggregate totals stay
`null` when incomplete. The strict paired path requires distinct runs, the same
provider ecosystem/task topology/verifier contract, and permits a candidate
model only through a separately bound settings snapshot. It computes quality,
cost, provider-latency, and wall-time deltas and rejects self-pairs, mixed
providers, or mismatched receipts. Local fixtures remain
`production_evidence: missing`; the configured provider client rejected the
live probe, so H5 production/canary/rollback evidence is not claimed.

## Evidence hierarchy

For project facts: current workspace/runtime evidence → executable tests/build/lint/typecheck/probes → current project contracts/docs → verified external docs → memory/examples/templates. The latter are context hints, not proof of current state.

A success claim must satisfy the kernel `VERIFY` contract. Higher-tier model output is still an unverified claim until checked.

## Evidence schema v2

Code-change completion is fail-closed and exact-turn correlated:

1. Each material acceptance ID and claim maps to exact concrete project-owned
   test/check refs. The runner derives `execution` (`runner`, `entrypoints`,
   invoked `test_refs`) from the exact command; caller-declared manifests do not
   count.
2. `negative_paths` is required. Every entry has a required
   `negative_path_bindings` record: binding ID, exact claim, acceptance IDs, and
   concrete refs that the execution manifest shows were invoked.
3. The record preserves tier, exact argv/output digest, limitations, phase,
   reviewer state, and a full-worktree fingerprint over HEAD, index, tracked
   and untracked project files including ignored content. A narrow explicit
   allowlist excludes only verifier-owned evidence and volatile runtime memory,
   session, telemetry, cache, and review-handoff state so verification cannot
   stale its own record; project configuration and arbitrary ignored files stay
   covered.
   The response must match this exact
   machine record; marker-only output and schema v1 cannot complete code.
4. Before completion, the gate replays every final-tree verifier from its exact
   stored argv with a bounded timeout and reduced environment. The observed
   exit code must be zero and the full-worktree fingerprint must remain
   unchanged, so hand-authored PASS records and mutating checks fail closed.
   When a hook provides no Forgewright evidence turn, discovery considers only
   structurally valid, fresh, current-workspace/current-tree schema-v2 final
   records; newer review, RED, mutation, malformed, stale, wrong-workspace, or
   legacy JSON cannot shadow the completion record. A Codex platform-native
   `turn_id` is treated as routing metadata unless it names an existing
   evidence record. An opaque ID is replaced once with the discovered evidence
   turn, freezing both validators onto the same record; a mapped-but-invalid ID
   blocks. Removing unrelated routing metadata does not open the gate: the
   response must still correlate exactly with the selected current record.
   Every evidence read is size-bounded, uses no-follow file descriptors, rejects
   symlinked directories/files, and binds schema-v2 `turn` to the filename.
5. Every fix proves RED → GREEN with the same command, refs, tier, manifest,
   acceptance IDs, and negative bindings. A HARD fix proves
   `RED → pre-mutation GREEN → mutation fail → exact final GREEN`, restoring the
   clean pre-mutation target tree without discarding unrelated changes.
6. Payment, billing, IAP/in-app purchase, receipt validation, entitlements,
   subscription, and checkout are always `HARD` / `DEEP`, regardless of file
   count. Completion requires contract, runtime, and E2E evidence plus a
   separate keyless `review-2` from a reviewer identity different from the
   implementer.
7. `review-2` must bind the canonical SHA-256 digest of final evidence, exact
   final tree, turn, workspace, acceptance IDs, and `negative_path_bindings`.
   Review-1, same-identity, malformed, stale, replayed, or mismatched JSON is
   `UNVERIFIED`. The keyless record detects evidence mismatch but does not
   authenticate reviewer identity against same-user forgery; the record must
   disclose that limitation.

## Requirement-locked test oracles

Behavioral tests are executable acceptance contracts, not a mechanism for making
CI green. Current requirements and acceptance criteria define expected behavior;
a failing test, current implementation, or goal such as “all tests pass” does
not authorize changing the oracle. When the expected behavior is clear, fix the
implementation. When it is missing, ambiguous, or contradictory, preserve the
behavioral test and block for user/product-owner clarification instead of
inventing an expectation.

Assertions, expected outputs, snapshots/goldens, eval labels, skips/xfails,
scenarios, and behavioral tolerances change only after an explicit current
requirement or acceptance-criteria change. Test runner, configuration,
setup/teardown, locator, or other infrastructure repairs are allowed only when
they preserve the behavioral oracle and coverage. Deterministic adversarial
replay protects this contract, and the focused live weak-model smoke must leave
the test unchanged and report `REQUIREMENT_BLOCKED` when the product decision is
unresolved.

Local-first/provider-neutral operation is the default. Create the bounded
review record with no key or external trust file:

```sh
python3 scripts/lite/review_attest.py create \
  --evidence .forgewright/verify/<turn>.json
```

Generated evidence files are local runtime artifacts. Project source, tests, and this documented contract remain the durable source of truth.

---

*Updated: 2026-08-24*
