# Forgewright Active Roadmap

> **North star:** cost per verified, accepted product outcome.
> **Scope:** evolve the verified engineering harness into an autonomous product factory that can understand intent, build, exercise, judge, revise, and ship web, app, and game products. Existing domain packs remain workers under one product-level control plane.
> **Status date:** 2026-09-05.

## Product Goal

Forgewright turns a base model into a reliable autonomous product-engineering system. It should understand both the user's product intent and the current repository/runtime before acting, route work by measured risk, prove changed behavior mechanically, exercise the resulting product in its real interaction environment, preserve useful project memory within a bounded context budget, and involve a human only at strategic or authority gates.

The product promise is:

> Every material decision is intent-bound, every edit is impact-aware, every success is evidence-backed, and a product is not considered complete until its critical user outcomes are exercised in the target environment.

## Operating Principles

1. Optimize cost per verified accepted **product outcome**, not raw token count, code volume, or single-run pass rate.
2. Maintain three separate truth layers: **Intent Truth** (what the user wants), **Runtime Truth** (what the product actually does), and **Outcome Truth** (whether the user can achieve the intended result).
3. Keep one canonical production runtime and one model-call/tool-execution gateway.
4. Prefer deterministic environment checks and executable scenarios over model self-assessment.
5. Treat skills as bounded specialist workers; product intent, environment state, outcome evidence, and promotion policy belong to the control plane rather than individual skills.
6. Start with the least expensive capable model and escalate only from objective evidence.
7. Give workers a bounded task contract and relevant context slice, never the full conversation by default.
8. Ask the user only when the unresolved information has material decision value and cannot be recovered from current evidence; reversible defaults remain agent-owned.
9. Treat documentation claims as release artifacts: every quantitative or safety claim needs an owner and evidence.
10. Roll out routing, learned context, and policy changes in shadow/canary evaluation before making them default.
11. Keep execution provider-native: discovery, routing, model calls, verification, usage receipts, and credentials stay inside one provider ecosystem per run.
12. Do not require paid hosted CI; release evidence must be reproducible with local or provider-included tooling.

## Verified Baseline

| Area | Current evidence | Gap |
|---|---|---|
| Product truth | `product-manifest.json`, deterministic validator, required aggregate gate, and an explicit five-document claim inventory cover core public facts plus high-risk testing, GitNexus, ADR, and historical marketing claims | Remaining legacy/status and domain-specific documentation inventory is pending |
| Runtime | The TypeScript MCP stdio server is declared as the canonical locally-tested production path; CLI and Python/shell paths coexist | Live provider/MCP smoke and legacy-path equivalence evidence are pending |
| Safety controls | Canonical MCP tools traverse the gateway with pinned trust/capability admission, contained state/filesystem paths, minimized policy execution, and deny-by-default webhook destinations | Portable kernel isolation, arbitrary child-process containment, and production host evidence remain pending |
| Legacy agent loop | Local hardening caches a bounded namespaced tool catalog, enforces turn/tool/context/output/response/timeout limits, loads deferred Lite overlays on demand, and supports privacy-safe offline full-loop replay | Live provider usage/cost evidence and legacy-path production equivalence remain pending |
| Model selection | A deterministic `ModelCallGateway` foundation implements injected capability probing and risk-tier selection in library tests | The canonical MCP path does not originate live provider calls or run the probe at startup |
| Evaluation | Schema-v2 validation rejects mock/incomplete/mismatched reports; `forge bench` now emits privacy-safe, exact-bound usage receipts, completeness counts, provider topology, settings snapshots, and reproducible paired A/B deltas | The configured live provider client rejected authentication, so live paired baseline/canary/rollback evidence remains missing |
| Cost control | The model-gateway library atomically reserves and settles in-process task/account budgets | It is not integrated into canonical live provider calls, so operational overshoot/cost evidence is missing |
| State | Canonical MCP state uses typed fail-closed persistence, schema validation, lock-backed transactions, and bounded history | Production recovery and cross-process operational evidence remain missing |
| CI/release | A required provider-neutral local control plane invokes product truth, Python units, MCP lint/format/build/test/coverage, CLI tests, production dependency audit, compatibility checks, package smoke checks, review, and clean-install evidence | Runtime smoke remains opt-in; hosted CI is not part of the canonical PASS/FAIL contract |
| Memory | Boot injection is capped at 500 tokens | Retrieval quality, staleness, and non-ASCII query behavior lack release KPIs |
| Visual direction | Local contracts now separate model prior from visual evidence: current project/user authority is preferred, greenfield external direction uses validated Evidence Cards + a GROUNDED Visual Basis, successful-product adoption is separated from causal claims, and material greenfield UI additionally uses a validated evidence-bound Style Profile so component-stack defaults cannot silently become product identity | Live image-generation aesthetics, cross-project UI style-diversity outcomes, harder gameplay-frame conformance, and non-Codex multimodal production evidence remain unverified |

## Provider-Native Routing Policy

Forgewright exposes one provider-neutral Scout/Builder/Expert contract. Each run selects exactly one provider adapter; that adapter discovers the provider's available models, maps capabilities to tiers, resolves snapshots, performs calls and verification, and records provider-native usage/cost receipts. Model IDs are never assumed portable between providers.

| Tier | Default responsibility | Provider-native selection | Escalation rule |
|---|---|---|---|
| Scout | Classification, extraction, ranking, inventory, context compression | Least-cost discovered model satisfying the Scout capability profile | Escalate when the output is ambiguous or a deterministic check fails |
| Builder | Bounded implementation, tests, debugging, code review, subagents | Discovered model satisfying implementation and tool-use capabilities | Escalate on any HARD signal or two failed checks |
| Expert | Architecture, security, public API/schema, concurrency, cross-module decisions, independent high-risk review | Strongest eligible model exposed by the selected provider | Human authority gate when budget, policy, or unresolved disagreement requires it |

Compatibility fallback order must come from the selected provider's live capability probe. An unavailable model is a routing event, not a reason to switch providers or loop. Cross-provider fallback is opt-in and out of the default scope. A task uses one primary model by default. Parallel workers are allowed only for independent, bounded, non-overlapping workstreams. An independent reviewer uses a separate context within the same provider ecosystem and receives only the original requirements, diff, and verifier evidence.

Every route decision must log: task class, risk signals, selected model and snapshot, reason, input/output/cached tokens, latency, estimated cost, verifier result, retry count, and escalation count. Prompts, secrets, and full diffs must not be stored in process arguments or telemetry.

## Completion Semantics

Roadmap completion is recorded on five independent axes in `docs/roadmap-completion.json`:

| Axis | Question answered | Does not imply |
|---|---|---|
| Implementation | Does the declared artifact exist? | Canonical integration, enablement, production use, or outcome |
| Integration | Is it on the canonical path, partially connected, or isolated? | Activation or production evidence |
| Activation | Where is it enabled: local, opt-in, library-only, canonical MCP, or not enabled? | Production use or outcome |
| Production evidence | Is current provider/production evidence verified, missing, or not required for the bounded local claim? | KPI attainment outside the measured evidence |
| Outcome | Is the intended result measured, met only locally, partial, unmeasured, or not met? | Completion of any other axis |

**Verification environment:** install the version-locked `requirements-ci.txt` into a project-local virtual environment and activate it before replaying local gates. On this Mac Air checkout the prepared environment is `.forgewright/runtime/ci-venv` (`source .forgewright/runtime/ci-venv/bin/activate`). A bare system Python without the declared MCP SDK fails H3/H4 at import time; do not weaken those verifiers or interpret a missing dependency as a containment pass.

There is no aggregate `implemented` status. The P0–P3 tables below inventory the historical foundation and its intended target outcomes; their prose labels cannot override the machine-readable axes. Each local evidence claim declares exact verifier argv, acceptance IDs, concrete test refs, negative paths, and the report producer. `npm run verify:roadmap` replays those commands fail-closed and rejects a verifier that fails, times out, or mutates the worktree.

## Product Factory Upgrade Program

This program supersedes feature-count growth as the primary product direction. The existing kernel, evidence-v2, GitNexus, visual grounding, security controls, skills, and harness work are retained as the engineering substrate. The upgrade adds product-level state and environment interaction above them rather than duplicating them inside more skills.

### Target architecture

```text
User request
  -> Product Intent Graph
  -> Product Goal / Scenario Graph
  -> Forgewright engineering workers
  -> Environment ACI (Web | Mobile | Game)
  -> Product Outcome Judge
  -> revise / replan when evidence fails
  -> ship only after outcome evidence
  -> trajectory learning -> ForgeBench -> gated promotion
```

### Truth model

| Truth | Authority | What it prevents |
|---|---|---|
| **Intent Truth** | Current explicit user decisions, approved product artifacts, and evidence-bound research | Building a technically correct product that solves the wrong problem |
| **Runtime Truth** | Current browser/device/engine state, executable checks, telemetry, and rendered evidence | Concluding from source code or model confidence that the product behaves correctly |
| **Outcome Truth** | Executed user scenarios and product-level acceptance evidence | Treating green unit/integration tests as proof that users can actually achieve their goal |

### Dependency order

`PF0 -> PF1 -> PF2 -> PF3 -> PF4 -> (PF5 || PF6) -> PF7`

PF5 learning may be developed in parallel with PF6 isolation after ForgeBench exists. PF7 cannot enable high-autonomy product execution until both promotion safety and the applicable containment backend pass their own gates.

### PF0 — Product-truth reset and instruction-entropy baseline

**Target outcome:** establish the product-factory contract without weakening the verified engineering baseline.

| Deliverable | Required result |
|---|---|
| North-star reset | Product outcome becomes the optimization target while existing engineering evidence remains required. |
| Core instruction audit | Detect contradictory or obsolete instructions across kernel, shared protocols, and routed LITE/SKILL overlays; current higher-authority rules win deterministically. |
| Heuristic provenance audit | Domain constants, ratios, thresholds, and “best-practice” values that are not current project/primary evidence are labeled hypothesis/default rather than truth. |
| Baseline suite | Record current engineering, intent-resolution, clarification burden, environment coverage, and false-success baselines before changing behavior. |
| Product-factory completion contract | Reserve one final local verifier entry point: `npm run verify:product-factory`. Until it exists and passes on the final tree, the product-factory goal remains incomplete. |

**Exit:** canonical local CI remains green; the instruction/provenance audits have deterministic tests; no roadmap status is upgraded from artifact presence alone.

**Current local status (2026-09-04):** PF0 is met locally and independently approved. The recursive tracked-source inventory matches runtime discovery, deterministic authority/conflict and bounded heuristic-provenance audits pass adversarial cases, and the privacy-safe baseline receipt binds a tracked canonical pre-change evidence record. `npm run verify:product-factory` is the fail-closed aggregate entry point and includes the PF0 contract. At this PF0 checkpoint, intent, clarification, environment coverage, and false-success metrics were `unavailable` or `not_measured`; subsequent phase status is recorded independently below.

### PF1 — Product Intent Kernel

**Target outcome:** make user intent a machine-readable first-class state rather than a transient BRD/chat interpretation.

| Component | Contract |
|---|---|
| `product-intent/v1` | Problem, target actors, JTBD, desired outcomes, constraints, non-goals, preferences, scenarios, uncertainty, decisions, and acceptance references. |
| Authority resolver | Explicit current user decision > approved project truth > current workspace/runtime evidence > authoritative research > bounded inference. Memory/model prior cannot override a newer authority. |
| Uncertainty ledger | Every material unknown records decision impact, evidence, reversibility, owner, and resolution state. |
| Value-of-information clarification gate | Ask only when an unresolved fact can materially change outcome/cost/risk/public contract and cannot be safely defaulted or researched. No fixed question quota or completeness score may force an interview. |
| Product delta contract | Separate **current product truth** from the **proposed change** so iterations do not rewrite history or rebuild the product model from scratch. |
| Product Goal Graph | `Outcome -> Capability -> Scenario -> Feature/Evidence/Metric` dependencies replace a single flat goal string for product work while remaining compatible with the current goal-driven runtime. |

**Exit:** adversarial tests cover vague prompts, “you decide”, conflicting preferences, changed requirements, irrelevant unknowns, and stale memory. The same intent contract can route web, mobile, and game work without domain-specific forks.

**Current local status (2026-09-04):** PF1 is met locally and independently approved. A strict bounded `product-intent/v1` aggregate now owns authority-ranked provenance, material uncertainty and clarification, immutable base-bound deltas, typed web/mobile/game scenarios, and the validated Product Goal Graph. Workspace persistence uses the existing atomic repository without changing its CRITICAL shared implementation. Five canonical MCP tools expose initialize/read/delta/projection/clarification through `ToolExecutionGateway`; containment recognizes only those exact state effects, mutation event delivery is acknowledged separately from durable commit, and stable errors do not leak underlying paths or secrets. The local aggregate covers the approved core, concurrency, API, gateway, and containment tests; production product-outcome evidence remains downstream.

### PF2 — Cross-domain Agent-Computer Interface (ACI)

**Target outcome:** give product agents a common way to observe and manipulate the product itself, not only its files.

Canonical provider-neutral interface:

```text
observe()
act(action)
reset()
snapshot()
restore(snapshot)
runScenario(scenario)
collectEvidence()
```

Adapters are capability-driven and may expose richer domain operations without changing the common contract:

- **Web ACI:** semantic DOM/accessibility state first, browser actions, network/console evidence, deterministic viewport state, and vision for appearance when needed.
- **Mobile ACI:** Android emulator/device first, UI hierarchy + gestures + screenshots/runtime state; iOS remains capability-gated rather than assumed.
- **Game ACI:** Unity first using available engine tooling, then Godot/Unreal adapters; deterministic time/input stepping, inspectable gameplay state, frame/video evidence, and resettable scenarios are the target semantics.

**Exit:** each enabled lane can launch or attach, observe, act, reset, execute at least one locked scenario, and return attributable evidence. Missing capabilities return `UNVERIFIED`; they are never filled by model imagination.

**Current local status (2026-09-04):** PF2 is met at the implementation/conformance layer and independently approved. The strict seven-operation `environment-aci/v1` contract binds environment/session/scenario identity, monotonic sequence, deadlines, snapshots, frozen artifact hashes, and derived PASS/FAIL/UNVERIFIED receipts. Shared session quarantine prevents timed-out late operations from overlapping cleanup or later work. Port-backed Web, Android, and Unity adapters enforce domain actions, globally routable web destinations, secret redaction, capability-kind truth, immutable bounded snapshots, and trusted artifact validation. The combined local suite passes without a live target. Production activation and evidence remain missing. The September 5 continuation adds an opt-in actual Chromium driver for an owned offline reference, described under the Web reference checkpoint below; it does not supply deployed-host evidence. Android/device and Unity production evidence remain unavailable on this host.

### PF3 — Product Outcome Verification

**Target outcome:** extend acceptance from implementation correctness to real product usability/behavior.

| Capability | Required behavior |
|---|---|
| `product-outcome-contract/v1` | Binds intent outcome/scenario IDs to environment adapter, actions, assertions, evidence, negative paths, and limitations. |
| Product Judge | Composes requirement, environment scenario, visual/reference, accessibility, performance, security, reliability, and release evidence without replacing specialist verifiers. |
| Critical-journey runner | Executes the actions a target user must perform and verifies the end state in the target environment. |
| Synthetic user lane | Supports hidden-intent/preferences for benchmark evaluation; simulator output is test evidence, never production user research. |
| Game quality boundary | “Fun”, taste, and commercial appeal cannot be self-certified. Agent-verifiable proxies such as discoverability, feedback latency, retry/friction patterns, difficulty/runtime state, HUD occlusion, and progression behavior may be measured and clearly labeled. |

**Exit:** a green build/test suite alone cannot complete a material product acceptance when a critical environment scenario is applicable and runnable.

**Current local status (2026-09-04):** PF3 is met locally and independently approved. `product-outcome-contract/v1` binds canonical Product Intent and Environment ACI identities, actions, assertions, evidence requirements, negatives, applicability, and evidence authority. The critical-journey runner rejects stale or altered ACI receipts, requires trusted production attestation, fences synthetic users as test-only, deduplicates evidence, and routes subjective game claims to human review. The Product Judge revalidates runner output through its authoritative context, requires independently verified specialist receipts, never upgrades test-only or non-PASS results, and cannot substitute build/test evidence for an applicable environment journey. The original checkpoint uses deterministic ports and fixtures. The September 5 Web reference additionally exercises an actual browser through the canonical adapter/runner and exposes two integration defects: semantic Web action payloads did not match the outcome schema, and global first-action-only artifact association lost valid repeated-content evidence. The bounded corrections preserve legacy payloads and global alias counts, add action-scoped association, and retain exact receipt validation. Independent review of these corrections remains pending; no production product outcome is claimed.

### Web reference integration checkpoint — actual browser, local authority only

The maintained executable specimen is `product-factory/web-reference/`: a minimal focus-list product, a narrow Playwright driver, and one sequential integration test. It composes `ProductIntent -> product-outcome-contract -> WebEnvironmentAciAdapter -> CriticalJourneyRunner -> ProductJudge` without substituting handwritten observations or outcome receipts. The driver uses an owned ephemeral Chrome process with the Chromium sandbox enabled, offline page content, blocked external requests, real semantic role/name interaction, actual DOM observations, and immutable PNG/JSON files validated by the existing ACI artifact boundary. Remote navigation is deliberately unavailable; no localhost exception or fabricated DNS result is introduced.

The observed exercise is baseline desktop PASS -> controlled faulty product FAIL -> restored desktop PASS -> restored mobile-viewport PASS (1280 x 800 and 390 x 844). ACI actions succeed in the deliberately faulty product while outcome assertions fail, demonstrating the distinction between successful tool execution and successful user outcome. Intent and the assertion oracle stay unchanged; restored source bytes match the baseline. Snapshot/restore, snapshot replay rejection, empty/duplicate input handling, horizontal overflow and owned-page/process cleanup are checked. The mutation is injected by the deterministic verifier and restored from the maintained source; this does **not** demonstrate an autonomous model finding or implementing the repair, Android/iOS execution, or commercial product quality.

The outcome runner can report PASS for the local task while the Product Judge remains UNVERIFIED because authority is `test-only`; the deliberately faulty product yields FAIL. PF7 remains blocked. No production attestation, specialist review, benchmark threshold, token-cost observation or deployment is fabricated.

Run the optional browser gate from the main repository after root dependencies are installed and the Chrome channel is available:

```bash
npm --prefix product-factory/web-reference ci --ignore-scripts --no-audit --no-fund --workspaces=false
npm run verify:web-reference
```

Missing Chrome or optional dependencies fail this command explicitly. The required Product Factory aggregate includes the semantic-action and per-action-evidence regressions but does not silently install a browser or make this optional package a core runtime dependency. Each browser execution writes an owned run folder under `.forgewright/reports/web-reference/` with a summary, full canonical receipts, PNG/JSON artifacts and process/page leases. These are bounded test-run artifacts, not canonical source documentation; remove only positively owned completed runs under the project's cleanup policy.

### PF4 — ForgeBench

**Target outcome:** benchmark the entire path from ambiguous product request to verified usable product rather than only isolated coding tasks.

Initial lanes:

1. **Intent:** vague request + hidden requirements/preferences; measure wrong-product rate and unnecessary clarification.
2. **Web:** task completion in a real browser plus structural, visual, accessibility, performance, and release evidence.
3. **Mobile:** resettable Android scenarios with randomized state/data where safe.
4. **Game:** deterministic gameplay scenarios plus runtime-state and rendered evidence.

Canonical metrics include product-outcome success, false-success rate, user-intervention count, clarification burden, retries, wall time, tokens/cost when available, and per-lane limitations. Benchmark thresholds are frozen only after PF0 baseline evidence; they are not invented in advance.

**Exit:** baseline/candidate comparison is reproducible and privacy-safe; `npm run verify:product-factory` includes the required product-factory contract tests and refuses incomplete/mismatched lane evidence.

**Current local status (2026-09-04):** PF4 is met locally and independently approved. ForgeBench now has strict four-lane intent/Web/Android/game task, receipt, report, metric, threshold, and paired-comparison contracts. Lane receipts remain untrusted until an injected verifier confirms PF3 outcome, judgment, environment, authority, and production evidence; missing verification normalizes to `UNVERIFIED`. Reports require exact task/attempt coverage and keep incomplete usage null. Experiment role, chronology, baseline hash, environment capability sets, and provider/settings topology are pair-bound. Thresholds remain `unfrozen` because the PF0 outcome baseline was not measured; promotion requires a separately verified frozen-threshold record. The canonical CLI can ingest structural product receipts safely, but deliberately writes an `UNVERIFIED` report and exits nonzero because the standalone CLI has no trusted host verifier.

### PF5 — Evidence-gated Learning Foundry

**Target outcome:** learn from completed trajectories without allowing a running agent to rewrite shared intelligence.

Pipeline:

```text
trajectory -> cluster -> candidate lesson delta
           -> offline ForgeBench replay
           -> baseline/candidate A/B
           -> independent review
           -> versioned promotion or rejection
```

Rules:

- no hot-patching kernel/shared skills during client execution;
- candidate lessons carry observed context, root cause, correction, applicability boundary, and verifier/source;
- useful/harmful counters and regression history accumulate incrementally rather than rewriting the whole context from one episode;
- promotion requires no material safety/quality regression and remains reversible/versioned.

**Exit:** intentionally harmful/stale candidate lessons are rejected; promoted lessons improve at least one frozen benchmark outcome without violating protected acceptance/safety metrics.

**Current local status (2026-09-05):** PF5 is met at the local implementation/conformance layer and independently approved. The Learning Foundry consumes concrete terminal trajectory ledgers, enforces freshness and lifecycle completeness, clusters sanitized evidence, derives stable semantic lesson identities independently of changing evidence membership, and gates versioned promotion/rollback through exact benchmark and independent-review projections. Promotion is maintenance-only, registry-bound, replay-safe across rollback/rebase, and serialized through repository CAS; the bundled in-memory repository provides same-process serialization only. Public capability issuance is deliberately restricted to local test authority. Production/shared promotion remains unavailable and unverified, and PF4 thresholds remain unfrozen, so no production learning-outcome claim is made.

### PF6 — Secure Autonomous Runtime

**Owner disposition (2026-09-05):** `done` (administrative closure only), temporarily accepted at the owner's explicit request with this caveat. Production OS-isolation verification is deferred and `UNVERIFIED`; this disposition does not waive the production exit criteria or certify a container/sandbox backend. The independent completion axes remain `integration: partial`, `activation: not-enabled`, `production_evidence: missing`, and `outcome: partially-met`. Reopen PF6 before enabling arbitrary child-process or production autonomy and obtain the required real-backend evidence. PF7 remains `blocked`; this roadmap status alone cannot satisfy its isolation or release gates.

**Target outcome:** close the gap between application-level containment and the process isolation needed for high-autonomy product building.

Deliverables:

- provider-neutral disposable-environment backend contract;
- local container/sandbox backend first where supported; optional external backends are adapters, not core dependencies;
- explicit filesystem/network/process/secret/resource capabilities;
- snapshot/restore and deterministic teardown;
- egress and private-network policy tests;
- artifact export through a narrow controlled boundary.

**Exit:** escape, secret-access, resource-exhaustion, stale-snapshot, process-orphan, and unauthorized-network negative paths fail closed. Arbitrary child-process autonomy remains disabled on hosts without a verified backend.

**Current local status (2026-09-05):** PF6 is met at the local implementation/conformance layer and independently approved after adversarial HARD review. The disposable-runtime contract uses shared cross-instance sequencing and replay state, fixed local-test-only authority, strict attestation/projection binding, a frozen IANA allocated-prefix IPv6 allowlist with special/transition ranges denied, bounded filesystem/artifact identities, a total artifact-disposition matrix, timeout quarantine, and independent teardown reconciliation. The current `npm run verify:product-factory` checkpoint passes PF0-PF7 local checks, including the PF7 semantic contract and release-truthfulness guard; required local CI invokes that verifier. This restores local regression coverage but does not supply independent final-tree PF7 approval or production evidence. Production trust issuance, a verified container/sandbox backend, and OS-isolation evidence remain unavailable, so every simulated success stays `UNVERIFIED` and production-ineligible.

### PF7 — End-to-end Autonomous Product Factory release

**Target outcome:** demonstrate the same product control plane across web, app, and game.

Release candidates must include at least one maintained reference product per lane:

- a web product exercised through Web ACI;
- a mobile product exercised through the supported mobile ACI;
- a game product exercised through the supported game ACI.

For each reference run the system must preserve the user's locked intent, produce the product, exercise critical journeys, revise on observed failures, pass applicable engineering/security/visual/runtime gates, produce rollback/release evidence, and keep unresolved subjective/user-research questions explicit rather than self-approving them.

**Program completion:** PF0-PF7 are complete on their independent implementation/integration/activation/production-evidence/outcome axes as applicable, the final tree passes `npm run verify:product-factory`, and no domain lane is presented as production-capable without its own current environment evidence.

**Current local status (2026-09-05):** the bounded `product-factory-release/v2` semantic suite passes 20 tests after repairing outdated candidate fixtures, canonical local-test attestation identities, and same-intent failure/retry evidence. MCP and CLI typechecks and the Product Factory aggregate pass. The evaluator consumes canonical PF3/PF5/PF6 evidence, preserves negative evidence precedence, requires all three reference lanes and five local security probes, and rejects malformed/replayed/forged inputs. It has no production activation path: every decision has `activationEligible: false`. Independent exact-tree review remains pending; PF4/gate references are still opaque, security-probe receipts are local simulations, and replay reservations are process-local rather than durable across restarts. PF7 remains **blocked** with partial implementation/integration, activation disabled, production evidence missing, and outcome not measured. The semantic suite is now the PF7 roadmap verifier; the separate documentation-status guard remains in the aggregate.

### Delivery audit and execution policy

The main delivery gap is no longer the number of contracts or skills: it is the absence of an authority-bound run against a maintained product. Preserve the existing contracts rather than adding another orchestration layer. An actual-browser offline Web scenario now exercises the integration. Next bind a maintained deployed Web target to trusted production authority, then repeat the proven path on supported Mobile and Game hosts. A Web-only success never completes the three-lane PF7 release.

Report local conformance, independent review, live host activation, production evidence, and product outcomes separately. Until live runs exist, accepted-outcome cost, clarification burden, false-success rate, and revision effectiveness remain **not measured**. Record a baseline and preregister acceptance criteria before comparing a candidate; do not invent thresholds from fixtures or tune them to a candidate result. The June improvement plan under `.forgewright/planning/` is historical and no longer an execution source.

### External design references — mindset only

The implementation may study these architectures without making them mandatory runtime dependencies: GitHub Spec Kit/OpenSpec for intent/spec deltas, SWE-agent for Agent-Computer Interface design, Magentic-One for task/progress ledgers, AndroidWorld and GameDevBench for environment benchmarks, ACE-style incremental context learning, and disposable-sandbox systems such as Daytona for isolation. Every adopted mechanism still requires a Forgewright-specific threat, compatibility, and benchmark justification.

## Historical Foundation Phases

### Phase 0 — Truth and Runtime Safety

**Target outcome:** published claims match an enforced, bounded production path.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P0.1 | **Implemented locally:** ADR 0001 declares the canonical MCP runtime and scopes claims through a code/test conformance matrix | Architect / Expert | None | Local conformance evidence exists; live-provider and legacy-path equivalence remain gated |
| P0.2 | **Implemented locally:** canonical product manifest, drift validator, public truth sync, regression tests, and provider-neutral local aggregate CI wiring | Tech writer + Builder | P0.1 | Local truth gate passes; remaining internal-link cleanup is independent of any hosted runner |
| P0.3 | **Implemented locally:** corrected paths/model endpoint handling, workspace isolation, required-server failure, namespaced tools, and hard runtime limits; live smoke remains | Runtime engineer / Expert | P0.1 | Deterministic unit tests pass; live runtime smoke proves provider/MCP boundaries |
| P0.4 | **Implemented locally:** schema-v2 eval reports require live mode, exact task set, attempts, verifier metadata, provider, model, and resolved snapshot before comparison | QA / Builder | P0.1 | Historical reports are intentionally rejected; reproducible paired live baseline remains pending |
| P0.5 | **Expanded locally:** README/product overview claims are qualified, and an explicit regression-tested inventory now covers five high-risk public documents; universal editing, zero-bug, index-corruption, zero-overhead, and historical percentage claims are removed or classified as unverified | Product + tech writer / Scout | P0.2 | Remaining legacy/status and domain-specific documentation inventory is pending |

**Targets:** zero known false-success paths; zero unbounded model loops; clean clone to first verified task in under 10 minutes; at least 90% setup success in supported CI environments.

### Phase 1 — Unified Execution and Cost Control

**Target outcome:** every production model and tool call is governed, observable, and budgeted.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P1.1 | **Implemented locally:** deterministic model-call gateway foundation with injected capability probe, Scout/Builder/Expert selection, bounded retry/backoff, circuit state, per-call timeout/output/turn caps, and privacy-safe usage telemetry with explicit `usage_unavailable` | Runtime engineer / Expert | P0.3, P0.4 | Unit evidence exists; canonical MCP does not yet originate live provider calls, so live provider evidence remains gated |
| P1.2 | **Implemented locally on the canonical MCP handler:** `ToolExecutionGateway` exposes an authorization hook and routes registered MCP calls through existing sanitization, offload, quality, verification, and telemetry hooks | Security + runtime / Expert | P0.1 | Deterministic registration traversal test exists; a production identity/authorization policy and CLI/external-tool traversal are not wired in this slice |
| P1.3 | **Implemented locally:** offloaded MCP tool output returns a compact bounded result plus a sanitized reference; dedup remains limited to `fw_get_current_phase` and `fw_check_pipeline_compliance`, with per-session cache epochs advanced only after a successful non-allowlisted canonical tool | Performance / Builder | P1.2 | Deterministic gateway tests prove a pre-mutation read hit, post-mutation miss, session isolation, failed-mutation retention, and a synthetic large-result compact-reference reduction of at least 60%; this is not an operational token-savings claim |
| P1.4 | **Implemented locally in the model gateway:** atomic in-process task/account reservations occur before provider invocation, actual cost settles reservations, terminal failures refund them, and concurrent calls cannot deterministically overshoot a budget; warnings begin at 80%, authority is required at 95%, and overage requires explicit authorization | FinOps + runtime / Expert | P1.1 | Deterministic unit evidence covers concurrency, settlement/refunds, thresholds, explicit override, and retry eligibility. The canonical MCP server does not yet originate live provider calls, so operational provider-cost/overshoot evidence remains gated. |
| P1.5 | **Implemented locally:** state writes fail closed with typed errors, schema validation, lock-backed transactions, a deterministic 100-entry history cap, and recovery/concurrency regressions | Backend / Expert | P1.2 | Deterministic tests cover typed persistence failures, same-process transaction serialization, lock recovery, oldest-first history trimming, and no pipeline-state event after a rejected transaction; evidence is local MCP/aggregate-gate execution |

**Targets:** verified-task rate at least 95%; false-success rate at most 1%; median input tokens per accepted task down 35%; cost per verified task down 30%; retry rate below 10%.

### Phase 2 — Evidence-Driven GPT Routing

**Target outcome:** smaller models handle most work without material quality regression.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P2.1 | **Implemented locally:** the canonical frozen corpus contains 100 unique tasks across ten balanced categories, includes debug, feature, review, refactor, security, docs, and operations, and is locked by a canonical SHA-256 fingerprint | QA / Builder | P0.4 | Deterministic tests enforce task/category balance, required categories, fingerprint drift, fail-closed decision coverage, and per-category Wilson 95% confidence intervals |
| P2.2 | **Infrastructure implemented locally:** provider-native adapter protocol produces paired strong-model baseline and shadow evidence without storing prompts/outputs | QA + data / Expert | P1.1, P2.1 | Live route precision and savings remain provider-run evidence, not a fixture claim |
| P2.3 | **Infrastructure implemented locally:** deterministic exact 10% stratified canary producer and fail-closed gate | Runtime + SRE / Expert | P2.2 | A real provider run must show no category drop above 2 points and no safety regression |
| P2.4 | **Infrastructure implemented locally:** rollout gate measures initial/final tiers, escalation, re-escalation, verifier and safety outcomes | Runtime + data / Builder | P2.3 | Live provider-native rollout receipt remains required before enabling the policy by default |
| P2.5 | **Infrastructure implemented locally:** per-review avoided-defect value must exceed review cost and review provenance is hashed | QA / Expert | P2.3 | Live review precision and avoided-defect cost remain provider-run evidence |

**Targets:** P0/P1 escaped defects equal zero; p50 latency down 25%; p95 latency no worse than 10%; maximum-turn breaches below 1%.

### Phase 3 — Release and Product Credibility

**Target outcome:** a release is locally reproducible, auditable, zero-hosting-cost, and understandable by a new user.

| ID | Deliverable | Owner / model tier | Dependencies | Exit evidence |
|---|---|---|---|---|
| P3.1 | **Implemented locally:** required zero-cost local control plane covers product truth, Python units, MCP lint/format/build/test/coverage, CLI tests, dependency audit, Node compatibility, contract review, package smoke, and clean-install evidence; hosted provider configs are optional adapters only | DevOps / Builder | P0.2, P1.1, P1.2 | Local receipts and deterministic commands are the release evidence; no hosted workflow is required |
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

## Harness Upgrade Sequence

This dependency order supersedes the old priority of building live provider adapters first. A live routing result is not accepted until the host lifecycle, trajectory, containment, and replay boundaries it depends on are mechanically verifiable.

Current local status (2026-08-29): H0 through H4 have executable local
evidence. H2 is integrated on the canonical MCP path; H3 adds pinned runtime
trust, fail-closed tool capabilities, workspace/state path containment,
filesystem-MCP admission, minimized policy subprocess environment, and
deny-by-default webhook destinations. The runtime opens a provider-neutral append-only
trajectory, accounts tool scopes/operations, persists cancellation and
child-before-parent LIFO disposer outcomes, records confirmed or unconfirmed
quiescence, seals one terminal event, and only then attempts lease/server
shutdown. H3 is application-level containment for canonical handlers, not a
portable kernel sandbox for arbitrary child processes. Production evidence and
automatic production resume and arbitrary disposer rebinding remain missing;
proactive context-only checkpoints, bounded continuation, quiescent
writer-epoch recovery, and offline H4 journal replay pass locally. H5 now has
privacy-safe structured usage receipts and paired A/B comparison infrastructure,
but live provider evidence remains blocked; H6 fresh evaluation remains ordered
downstream work. H2 local evidence includes capacity,
predecessor-binding, gateway-drain, shutdown-bound, Docs, and keyless exact-tree
review gates; reviewer identity is not cryptographically authenticated.

| ID | Deliverable | Dependencies | Exit evidence |
|---|---|---|---|
| H0 | Roadmap truth reset: independent completion axes, exact executable verifier contracts, and cross-document status alignment | None | Manifest v2 contract passes; all declared verifier argv replay green; Docs Hub gate passes; independent diff/evidence review approves the exact tree |
| H1 | `HarnessAdapter v1` with explicit `forgewright-owned-loop` and `native-host-loop` modes plus typed start/resume/fork/steer/interrupt capability negotiation | H0 | Contract tests reject unsupported lifecycle operations and prevent provider-specific model IDs from leaking into the core contract |
| H2 | **Met locally:** append-only `TrajectoryLedger`, cancellation propagation, reversible/LIFO disposers, bounded quiescence, gateway accounting, and finalize-before-lease/server shutdown | H1 | Dynamic capacity, predecessor validation, gateway drain, shutdown-wide deadline, local process replay, Docs gate, and keyless exact-tree review pass; production/restart evidence remains missing |
| H3 | **Met locally at application layer:** retain output filtering as a named firewall; add pinned trust context, capability admission, application-level filesystem/network containment for state/filesystem paths and webhooks, production identity/policy hooks, and explicit trust gates | H1, H2 | Escape, unauthorized/unknown tool, IPv4/IPv6 private-transition and rebinding deny, live-owner lock preservation, filesystem deny/symlink, policy drift/environment, missing-production-identity, and lifecycle-denial tests pass; arbitrary process OS sandbox remains unavailable |
| H4 | **Met locally, offline:** record → normalize → replay the agent-loop fixture without provider keys, with strict consumption checks | H2, H3 | Versioned hash-chain replay covers lifecycle/model/tool/approval/evidence events and rejects missing, extra, reordered, corrupt, secret-bearing, or oversized records; it is not live-provider evidence |
| H5 | **Provider adapters infrastructure met locally; live outcome pending:** provider-neutral usage receipts, paired A/B comparison, and a capability-verified visual/game render-inspect-revise harness on `HarnessAdapter v1` | H4 | Local tests bind suite/verifier/provider topology/settings, hide raw prompts/outputs, reject invalid pairs, cap visual iterations/media/workers, and compute quality/cost/latency deltas; capability probe, live canary, rollback, and production receipts remain missing |
| H6 | Optional long-running handoff mode with structured checkpoint and fresh evaluator | H5 | Interrupted work resumes from a bounded handoff, and a fresh evaluator independently accepts or rejects the final evidence |

## Current Blockers

| Blocker | Impact | Required action |
|---|---|---|
| PF7 local semantic checks pass, but independent exact-tree review is missing | Local conformance cannot be represented as an approved release | Review canonical evidence linkage, security-probe scope, learning history, replay/expiry behavior, and negative evidence precedence; rerun full release gates before committing the existing multi-phase worktree |
| The actual-browser Web reference has local test authority only; deployed Web, Mobile and Game evidence is still missing | Local interaction conformance does not establish production outcomes or comparative cost | Independently review the new integration, then bind a maintained deployed Web target and trusted evidence authority; preserve separate status per lane |
| PF6 has no verified production sandbox backend and PF5 has no production promotion authority | Arbitrary child-process autonomy and shared learning promotion must stay disabled | Capability-probe the host, add and adversarially verify a supported backend, and prove trusted issuance, teardown, rollback, and recovery before enablement |
| PF4 thresholds and release gate references lack trusted measured evidence | Local contract PASS cannot certify production or competitive product quality | Capture live baseline and candidate runs under preregistered criteria; replace opaque references only through an independently reviewed authority integration |
| The configured live provider client rejects authentication as an unsupported client and requires migration | Paired live routing, usage, canary, and rollback receipts cannot be certified | Migrate to a supported provider runtime/account under explicit authorization; do not add another key-check workflow or upgrade fixture evidence |
| An existing canonical MCP runtime without a valid ownership marker cannot be adopted when its dependency-lock digest differs from the repository | Automated migration must preserve the foreign runtime rather than manufacture ownership proof | Perform a user-authorized clean reinstall or supply independently verified ownership evidence |

## Next Execution Slice

Preserve PF0-PF6 local conformance and their existing authority boundaries throughout these slices. Order work by executable exit evidence, not assumed dates or percentage-complete estimates.

| Order / action | Owner | Exit evidence | Boundary |
|---|---|---|---|
| 1. `pf7-release-readiness` — finish independent exact-tree review of the recovered PF7 contract | Release maintainers / independent reviewer | The semantic suite, aggregate, roadmap replay, Docs gates, adversarial backcheck, and exact-tree independent review all pass; existing dirty phase changes are reviewed before commit | Local checks are passing; independent approval and the full release gate are not implied |
| 2. `pf-web-live-integration` — extend the passing offline Chromium reference to a maintained deployed Web target | Product + runtime maintainers | Independent review of additive action compatibility and per-action evidence binding; then capability probe, immutable target identity, actual browser scenarios, attributable artifacts, cleanup and trusted live authority | Local reference passes; no production attestation, model repair, private-network exception or deployed-host evidence is implied |
| 3. `pf-runtime-isolation` — implement a capability-supported disposable backend | Runtime + security maintainers | Escape/secret/private-egress/quota/stale-snapshot/orphan probes run on the real backend; narrow artifact export, independent reconciliation, teardown and recovery are verified | May be prepared alongside Web integration; high-autonomy execution remains disabled until this gate passes |
| 4. `pf-live-outcome-baseline` — demonstrate a Web outcome and failure/revision loop, then repeat on supported Android and Unity hosts | Product + QA maintainers | Same locked intent survives failure and correction; observed outcome and false-success evidence, usage/cost availability, preregistered baseline/candidate comparison, and per-lane maintenance ownership | A partial or Web-only run does not certify Mobile/Game or freeze unsupported benchmark thresholds |
| 5. `pf-production-authority` — review trusted production learning/release authority and bounded rollout | Release + learning maintainers | Trusted PF4/gate evidence, durable replay/recovery rules, review-bound learning promotion/rollback, canary and rollback receipts, and explicit authority approval | No production activation, shared promotion, or release mutations are performed by the current PF7 contract |

H5/H6 provider evidence remains supporting work. An unsupported client or missing provider receipt stays an explicit blocker; local fixture success must never be used as its substitute.
