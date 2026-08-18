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

## Planning and optimization

`QUICK` work uses `ACTION | TARGET | CHECK` and no numeric plan score. `STANDARD`/`DEEP` use the complexity-scaled thresholds in `skills/_shared/protocols/plan-quality-loop.md`. There is no universal 9/10 gate.

Optimization needs an explicit target/SLA, measurement, a known platform/resource/cost constraint, or an evident algorithmic/reliability defect at required scale. Otherwise prefer a simple observable baseline and defer speculative optimization.

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
   separate signed `review-2` using OpenSSH Ed25519.
7. `review-2` must bind the canonical SHA-256 digest of final evidence, exact
   final tree, turn, acceptance IDs, and `negative_path_bindings`. Trust comes
   only from external `FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS`, or fallback
   `~/.forgewright/reviewers.allowed_signers`; review-1/self-authored JSON is
   `UNVERIFIED`.

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

Local-first/provider-neutral operation is the default. Keep private keys and
other secrets outside the workspace. Attest a final record with:

```sh
FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS=/absolute/path/reviewers.allowed_signers \
python3 scripts/lite/review_attest.py sign \
  --evidence .forgewright/verify/<turn>.json \
  --private-key /absolute/path/reviewer_ed25519
```

Generated evidence files are local runtime artifacts. Project source, tests, and this documented contract remain the durable source of truth.

---

*Updated: 2026-08-18*
