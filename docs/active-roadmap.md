# Forgewright Active Roadmap

> **North star:** cost per verified, accepted engineering task.
> **Scope:** the core engineering loop first; game, XR, research, and growth remain optional capability packs until the core loop has production evidence.
> **Status date:** 2026-07-13.

## Product Goal

Forgewright turns a base model into a reliable engineering execution system. It should understand the repository before editing, route work by measured risk, prove changed behavior mechanically, preserve useful project memory within a bounded context budget, and involve a human only at strategic or authority gates.

The product promise is:

> Every edit is impact-aware, every success is evidence-backed, and expensive models are used only when measured risk requires them.

## Operating Principles

1. Optimize cost per verified accepted task, not raw token count or single-run pass rate.
2. Keep one canonical production runtime and one model-call/tool-execution gateway.
3. Prefer deterministic checks over model self-assessment.
4. Start with the least expensive capable model and escalate only from objective evidence.
5. Give workers a bounded task contract and relevant context slice, never the full conversation by default.
6. Treat documentation claims as release artifacts: every quantitative or safety claim needs an owner and evidence.
7. Roll out routing changes in shadow and canary modes before making them default.
8. Keep execution provider-native: discovery, routing, model calls, verification, usage receipts, and credentials stay inside one provider ecosystem per run.
9. Do not require paid hosted CI; release evidence must be reproducible with local or provider-included tooling.

## Verified Baseline

| Area | Current evidence | Gap |
|---|---|---|
| Product truth | `product-manifest.json`, deterministic validator, required aggregate gate, and an explicit five-document claim inventory cover core public facts plus high-risk testing, GitNexus, ADR, and historical marketing claims | Remaining legacy/status and domain-specific documentation inventory is pending |
| Runtime | The TypeScript MCP stdio server is declared as the canonical locally-tested production path; CLI and Python/shell paths coexist | Live provider/MCP smoke and legacy-path equivalence evidence are pending |
| Safety controls | MiddlewareChain tests pass, but production construction was not found outside tests | Safety claims are not proven on the production path |
| Legacy agent loop | Local hardening now caches a bounded namespaced tool catalog and enforces turn, tool-call, context, output, response, and timeout limits | Live MCP/provider smoke evidence and legacy-path enforcement equivalence remain pending |
| Model selection | Provider-specific static tier guidance and several unrelated model environment variables | No capability/risk router or startup capability probe |
| Evaluation | Schema-v2 local validator rejects mock/incomplete/mismatched reports; a frozen 100-task routing corpus covers all required roadmap categories and reports per-category Wilson 95% confidence intervals | No reproducible paired live baseline or live provider evidence |
| Cost control | Token budgets and reports exist | Budget is not enforced at a single model-call gateway |
| State | File state persistence can log a failed write while the caller reports success | No fail-closed error propagation or concurrency control |
| CI/release | A required local aggregate gate invokes product truth, Python units, MCP lint/format/build/test/coverage, CLI tests, production dependency audit, package-content smoke checks, and a temporary worktree-snapshot `npm ci`/build check; a pinned GitHub Actions workflow mirrors the deterministic gates | Runtime smoke remains opt-in; a completed hosted run is still required before claiming hosted CI status |
| Memory | Boot injection is capped at 500 tokens | Retrieval quality, staleness, and non-ASCII query behavior lack release KPIs |

## Provider-Native Routing Policy

Forgewright exposes one provider-neutral Scout/Builder/Expert contract. Each run selects exactly one provider adapter; that adapter discovers the provider's available models, maps capabilities to tiers, resolves snapshots, performs calls and verification, and records provider-native usage/cost receipts. Model IDs are never assumed portable between providers.

| Tier | Default responsibility | Provider-native selection | Escalation rule |
|---|---|---|---|
| Scout | Classification, extraction, ranking, inventory, context compression | Least-cost discovered model satisfying the Scout capability profile | Escalate when the output is ambiguous or a deterministic check fails |
| Builder | Bounded implementation, tests, debugging, code review, subagents | Discovered model satisfying implementation and tool-use capabilities | Escalate on any HARD signal or two failed checks |
| Expert | Architecture, security, public API/schema, concurrency, cross-module decisions, independent high-risk review | Strongest eligible model exposed by the selected provider | Human authority gate when budget, policy, or unresolved disagreement requires it |

Compatibility fallback order must come from the selected provider's live capability probe. An unavailable model is a routing event, not a reason to switch providers or loop. Cross-provider fallback is opt-in and out of the default scope. A task uses one primary model by default. Parallel workers are allowed only for independent, bounded, non-overlapping workstreams. An independent reviewer uses a separate context within the same provider ecosystem and receives only the original requirements, diff, and verifier evidence.

Every route decision must log: task class, risk signals, selected model and snapshot, reason, input/output/cached tokens, latency, estimated cost, verifier result, retry count, and escalation count. Prompts, secrets, and full diffs must not be stored in process arguments or telemetry.

## Delivery Phases

### Phase 0 — Truth and Runtime Safety

**Outcome:** published claims match an enforced, bounded production path.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P0.1 | **Implemented locally:** ADR 0001 declares the canonical MCP runtime and scopes claims through a code/test conformance matrix | Architect / Expert | None | Local conformance evidence exists; live-provider and legacy-path equivalence remain gated |
| P0.2 | **Implemented locally:** canonical product manifest, drift validator, public truth sync, regression tests, aggregate CI wiring, and a pinned hosted workflow | Tech writer + Builder | P0.1 | Local truth gate passes; a completed hosted run and remaining internal-link cleanup remain pending |
| P0.3 | **Implemented locally:** corrected paths/model endpoint handling, workspace isolation, required-server failure, namespaced tools, and hard runtime limits; live smoke remains | Runtime engineer / Expert | P0.1 | Deterministic unit tests pass; live runtime smoke proves provider/MCP boundaries |
| P0.4 | **Implemented locally:** schema-v2 eval reports require live mode, exact task set, attempts, verifier metadata, provider, model, and resolved snapshot before comparison | QA / Builder | P0.1 | Historical reports are intentionally rejected; reproducible paired live baseline remains pending |
| P0.5 | **Expanded locally:** README/product overview claims are qualified, and an explicit regression-tested inventory now covers five high-risk public documents; universal editing, zero-bug, index-corruption, zero-overhead, and historical percentage claims are removed or classified as unverified | Product + tech writer / Scout | P0.2 | Remaining legacy/status and domain-specific documentation inventory is pending |

**Targets:** zero known false-success paths; zero unbounded model loops; clean clone to first verified task in under 10 minutes; at least 90% setup success in supported CI environments.

### Phase 1 — Unified Execution and Cost Control

**Outcome:** every production model and tool call is governed, observable, and budgeted.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P1.1 | **Implemented locally:** deterministic model-call gateway foundation with injected capability probe, Scout/Builder/Expert selection, bounded retry/backoff, circuit state, per-call timeout/output/turn caps, and privacy-safe usage telemetry with explicit `usage_unavailable` | Runtime engineer / Expert | P0.3, P0.4 | Unit evidence exists; canonical MCP does not yet originate live provider calls, so live provider evidence remains gated |
| P1.2 | **Implemented locally on the canonical MCP handler:** `ToolExecutionGateway` exposes an authorization hook and routes registered MCP calls through existing sanitization, offload, quality, verification, and telemetry hooks | Security + runtime / Expert | P0.1 | Deterministic registration traversal test exists; a production identity/authorization policy and CLI/external-tool traversal are not wired in this slice |
| P1.3 | **Implemented locally:** offloaded MCP tool output returns a compact bounded result plus a sanitized reference; dedup remains limited to `fw_get_current_phase` and `fw_check_pipeline_compliance`, with per-session cache epochs advanced only after a successful non-allowlisted canonical tool | Performance / Builder | P1.2 | Deterministic gateway tests prove a pre-mutation read hit, post-mutation miss, session isolation, failed-mutation retention, and a synthetic large-result compact-reference reduction of at least 60%; this is not an operational token-savings claim |
| P1.4 | **Implemented locally in the model gateway:** atomic in-process task/account reservations occur before provider invocation, actual cost settles reservations, terminal failures refund them, and concurrent calls cannot deterministically overshoot a budget; warnings begin at 80%, authority is required at 95%, and overage requires explicit authorization | FinOps + runtime / Expert | P1.1 | Deterministic unit evidence covers concurrency, settlement/refunds, thresholds, explicit override, and retry eligibility. The canonical MCP server does not yet originate live provider calls, so operational provider-cost/overshoot evidence remains gated. |
| P1.5 | **Implemented locally:** state writes fail closed with typed errors, schema validation, lock-backed transactions, a deterministic 100-entry history cap, and recovery/concurrency regressions | Backend / Expert | P1.2 | Deterministic tests cover typed persistence failures, same-process transaction serialization, lock recovery, oldest-first history trimming, and no pipeline-state event after a rejected transaction; evidence is local MCP/aggregate-gate execution |

**Targets:** verified-task rate at least 95%; false-success rate at most 1%; median input tokens per accepted task down 35%; cost per verified task down 30%; retry rate below 10%.

### Phase 2 — Evidence-Driven GPT Routing

**Outcome:** smaller models handle most work without material quality regression.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P2.1 | **Implemented locally:** the canonical frozen corpus contains 100 unique tasks across ten balanced categories, includes debug, feature, review, refactor, security, docs, and operations, and is locked by a canonical SHA-256 fingerprint | QA / Builder | P0.4 | Deterministic tests enforce task/category balance, required categories, fingerprint drift, fail-closed decision coverage, and per-category Wilson 95% confidence intervals |
| P2.2 | **Infrastructure implemented locally:** provider-native adapter protocol produces paired strong-model baseline and shadow evidence without storing prompts/outputs | QA + data / Expert | P1.1, P2.1 | Live route precision and savings remain provider-run evidence, not a fixture claim |
| P2.3 | **Infrastructure implemented locally:** deterministic exact 10% stratified canary producer and fail-closed gate | Runtime + SRE / Expert | P2.2 | A real provider run must show no category drop above 2 points and no safety regression |
| P2.4 | **Infrastructure implemented locally:** rollout gate measures initial/final tiers, escalation, re-escalation, verifier and safety outcomes | Runtime + data / Builder | P2.3 | Live provider-native rollout receipt remains required before enabling the policy by default |
| P2.5 | **Infrastructure implemented locally:** per-review avoided-defect value must exceed review cost and review provenance is hashed | QA / Expert | P2.3 | Live review precision and avoided-defect cost remain provider-run evidence |

**Targets:** P0/P1 escaped defects equal zero; p50 latency down 25%; p95 latency no worse than 10%; maximum-turn breaches below 1%.

### Phase 3 — Release and Product Credibility

**Outcome:** a release is locally reproducible, auditable, zero-hosting-cost, and understandable by a new user.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P3.1 | **Implemented locally:** required zero-cost aggregate gate covers product truth, Python units, MCP lint/format/build/test/coverage, CLI tests, dependency audit, package smoke, and clean temporary `npm ci` builds; the MCP tarball excludes tests, coverage, source, and telemetry | DevOps / Builder | P0.2, P1.1, P1.2 | Local aggregate and runtime smoke commands remain reproducible without paid hosting; the pinned hosted workflow mirrors these gates |
| P3.2 | **Implemented locally:** release dependencies/tools and active workflow actions are pinned, package/tag contracts are checked, SBOM and provenance artifacts are generated, package smoke and rollback rehearsal are automated | Security + DevOps / Expert | P3.1 | Local release-policy and artifact verifiers provide linked evidence without publishing or paid runners; supply-chain policy rejects mutable active workflow dependencies |
| P3.3 | **Implemented locally:** canonical `forge init`/`forge onboard` commands create deterministic project metadata, fail closed without a manifest, preserve existing files by default, support explicit refresh, and are documented as a ten-minute sample workflow | CLI + docs / Builder | P0.2, P3.1 | Golden tests execute locally and inside the aggregate gate |
| P3.4 | **Implemented locally:** machine-verified inventory labels every README core capability and classifies game, XR, research, and growth as optional docs-only packs | Product + architect / Expert | Local evidence inventory | Maturity tests execute each beta capability's verification command and forbid unsupported stable claims |

## Learning and Memory KPIs

Replace “never repeats a mistake” with measurable behavior:

- repeated-failure recurrence decreases at least 50% after 30 days;
- memory precision@3 is at least 80%;
- stale-memory hit rate is below 5%;
- retrieval supports non-ASCII queries and is tested with representative languages;
- tokens saved by memory reuse are measured against a no-memory control;
- no memory item can override a newer explicit requirement or security policy.

## Release Gates

A phase is complete only when all of the following are true:

1. Every deliverable has an owner, automated check, evidence path, and rollback strategy.
2. Changed symbols have pre-edit impact analysis and pre-commit `detect_changes` evidence.
3. HARD changes have an independent expert review; unavailable expert capability blocks the security-sensitive change instead of silently degrading.
4. Tests use pinned model snapshots or record the resolved snapshot and date.
5. Quality and cost are reported together; savings without comparable verifier quality do not count.
6. Documentation, package metadata, generated rule files, and release artifacts agree with the canonical product manifest.

## Current Blockers

| Blocker | Impact | Required action |
|---|---|---|
| Live provider credentials are unavailable in the current reviewer runtime | Independent model review cannot be claimed from a failed dispatch | Restore provider credentials and rerun the requirements/diff/evidence review packet |
| An existing canonical MCP runtime without a valid ownership marker cannot be adopted when its dependency-lock digest differs from the repository | Automated migration must preserve the foreign runtime rather than manufacture ownership proof | Perform a user-authorized clean reinstall or supply independently verified ownership evidence |

## Next Execution Slice

1. Add provider-native adapters only when their capability probe, resolved snapshots, usage receipts, and verifier contract can be proven locally.
2. Produce paired live reports inside one selected provider ecosystem before using lower-cost model results to justify routing.
3. Keep provider/MCP runtime smoke opt-in and local; do not add paid hosted CI as a release dependency.
4. Run the full local regression matrix, GitNexus `detect_changes`, independent diff review, and release audit.
