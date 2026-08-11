# Mode Execution Reference

<!-- source: skills/production-grade/references/mode-execution.md -->

## Mode Execution (Non-Full-Build)

All modes share these behaviors:
- Reuse existing workspace/protocol state; create persistent scaffolding only when the task actually needs it.
- Read `.production-grade.yaml` and current workspace state when present.
- Apply senior execution, sensitive-file protection, and runtime model-tier protocols.
- `QUICK` work uses `ACTION | TARGET | CHECK`; `STANDARD`/`DEEP` use the applicable complexity-scaled plan threshold. Never force a universal 9/10 score.
- Verification matches risk: use the smallest deterministic check that proves acceptance; add broader regression/security/reliability testing when the change warrants it.
- Emit status updates for substantial/long-running work, not as noise around trivial edits.
- Use Antigravity planning only when durable multi-component/multi-team coordination or `DEEP` architecture work benefits from persistent planning artifacts.
- Ask the user only when ambiguity materially changes the contract, safety, irreversible data, or expensive direction.

### Goal Mode Execution (v8.2)

When Goal mode is triggered, Forgewright enters autonomous pursuit mode:

```
1. SET GOAL:
   - Parse condition from user message
   - Validate condition is measurable
   - Create .forgewright/active-goal.json

2. AUTONOMOUS LOOP:
   After each turn:
   a. Run evaluation:
      bash scripts/goal-evaluate.py "[condition]"
   b. Check result:
      - MET: Report completion, clear goal, exit autonomous mode
      - NOT_MET: Continue to next turn (no user prompt needed)
      - UNKNOWN: Ask user to verify

3. PROGRESS TRACKING:
   - Write progress to .forgewright/goal-progress.md
   - Update turns counter in active-goal.json
   - Emit heartbeat: "Working toward goal: [reason why not met yet]"

4. EXIT CONDITIONS:
   - Condition is met (evaluator returns MET)
   - User runs `/goal clear`
   - Explicit runtime safety guard is reached (timeout, tool-call or byte limit)
   - User explicitly stops
```

**Integration with other skills:** Goal mode wraps ANY skill execution. The underlying skill does the work; Goal mode handles the loop and evaluation.

## Self-Check Before Finishing

Before claiming completion, verify the checks that actually apply:

| Check | Required behavior |
|---|---|
| Intent/state reconciled | Latest user request and current workspace/runtime evidence agree with the work performed. |
| Effort/plan fit | `QUICK` used its mini-plan; `STANDARD` / `DEEP` passed the applicable threshold. No blanket 9/10 rule. |
| Scope | No unrequested adjacent features/process work were silently added. |
| Recovery | Failed steps followed the two-failure stop rule; research occurred only for a material unknown. |
| Verification | Run the smallest deterministic checks that prove changed acceptance criteria, plus wider regression/security/release checks when risk warrants. |
| Impact | When changing existing symbols/contracts, inspect callers/dependents with available project tools before finalizing. |
| Approval | Obtain user/human approval only where the project/safety/release/preference contract requires it. |
| Review | Independent review is required for `DEEP`, sensitive/public-contract work, or materially broad change as defined by the kernel. |
| Learning | Store useful lessons project-locally; never auto-append them to shared Forgewright skills. |

Tests are derived from acceptance and risk, not a fixed lifecycle. Test-first is preferred for meaningful behavior/regression risk; `QUICK` reversible work may use an existing focused verifier instead of manufacturing a test artifact.

## Antigravity Planning System

For large features (3+ components), use the Antigravity Planning System to structure your work.

### When to Use Antigravity

| Feature Type | Antigravity? |
|--------------|--------------|
| Single file change | ❌ No |
| Small (1-2 components) | ❌ No |
| Medium (3+ components) | ✅ Yes |
| Full Build / Game Build | ✅ Required |
| Multi-team coordination | ✅ Required |
| New integration (auth, payment) | ✅ Yes |

### Antigravity Folder Structure

```
antigravity/
└── planning/
    └── [feature-name]/
        ├── PLAN.md          # Main planning document
        ├── SCOPE.md         # Scope definition
        ├── ARCHITECTURE.md   # Technical architecture
        ├── TASKS.md         # Task breakdown
        ├── DECISIONS.md     # Architecture decisions log
        └── RETROSPECTIVE.md # Post-completion retrospective
```

### Quick Commands

```bash
# Create new feature plan
./scripts/antigravity/antigravity.sh new <feature-name>

# Check status
./scripts/antigravity/antigravity.sh status

# Show progress
./scripts/antigravity/antigravity.sh progress <feature>

# Archive completed
./scripts/antigravity/antigravity.sh archive <feature>
```

### Feature Plan Template

Each feature plan must include:

| File | Required? | Content |
|------|-----------|---------|
| `PLAN.md` | ✅ Yes | Overview, goals, key decisions, timeline |
| `SCOPE.md` | ✅ Yes | In/out scope, constraints, risks, acceptance criteria |
| `ARCHITECTURE.md` | ⚠️ If complex | Component diagram, data models, API design |
| `TASKS.md` | ✅ Yes | Task breakdown by priority, estimates |
| `DECISIONS.md` | ⚠️ Recommended | Architecture Decision Records |
| `RETROSPECTIVE.md` | ⚠️ After completion | Lessons learned, metrics |

### Plan Quality Criteria

Each feature plan must score above the complexity-scaled threshold (≥ 8.0/10 for Feature mode) on:

| Criteria | Description |
|----------|-------------|
| Clarity | Scope clearly defined |
| Completeness | Enough info to implement |
| Feasibility | Achievable in timeframe |
| Risk Awareness | Risks identified |
| Testability | Clear acceptance criteria |
| Maintainability | Long-term viable |
| Priority | Impact vs effort clear |
| Dependencies | External deps identified |

See `antigravity/README.md` for full documentation.

### Feature Mode

Add a feature to an existing codebase. Lightweight DEFINE → BUILD → TEST.

1. **Codebase scan** — read existing code structure, framework, patterns
2. **BA pre-flight (conditional)** — Assess the user's feature description for information gaps using 6W1H. If requirements score < 6/7 completeness → run BA (Express depth) to elicit missing info. If clear → skip. Log: `✓ Requirements complete — skipping BA` or `⧖ Information gaps detected — running BA elicitation`
3. **PM (Express depth)** — 2-3 questions to scope the feature. Write a mini-BRD (user stories + acceptance criteria for this feature only). If BA ran, use `ba-package.md` to reduce questions.
4. **Architect (scoped)** — design how this feature fits the existing architecture. New endpoints, schema changes, component additions. NOT a full system redesign.
5. **Test Cases/Stubs Preparation** — QA Engineer writes test stubs based on BDD/Gherkin spec from the BA package (Mandatory for medium/large features; optional for simple fixes).
6. **Build** — Software Engineer and/or Frontend Engineer implement the feature code to satisfy requirements and test cases.
7. **⚠️ Test Verification (AUTO-RUN)** — Run and verify tests. DO NOT WAIT for user to ask. Sequence: Given/When/Then (BA) → Write Tests/Stubs (QA) → Code (Dev) → Run Tests → Pass ✓.
8. **Optional: Review** — Code Reviewer checks the new code against existing patterns

**1 gate:** After PM scoping (step 3), confirm scope before test case preparation.

**⚠️ IMPORTANT:** Step 7 (Test Verification) is MANDATORY. After building, ALWAYS run tests without waiting for user prompt.

### Harden Mode

Security + quality audit on existing code. No building, pure analysis + fixes.

1. **Codebase scan** — read all existing code
2. **Sequential:** Security Engineer → QA Engineer → Code Reviewer analyze the code
3. **Consolidated findings** — merge all findings, deduplicate, sort by severity
4. **Present findings** — show Critical/High/Medium/Low counts with top issues
5. **Remediation** — fix Critical and High issues (with user confirmation)

**1 gate:** After findings (step 4), before remediation.

### Ship Mode

Get existing code deployed. Infrastructure + reliability.

1. **Codebase scan** — read existing code, identify services, dependencies
2. **DevOps** — Dockerfiles, CI/CD pipelines, IaC (Terraform/Pulumi), monitoring
3. **SRE** — SLO definitions, runbooks, alerting, chaos experiment plan

**1 gate:** After DevOps infra plan, before applying.

### Test Mode

Write tests for existing code. Single skill.

1. Read skills/qa-engineer/SKILL.md and follow its instructions against existing code
2. QA reads code, writes test plan, implements tests, runs them
3. Report results

**0 gates.** QA operates autonomously.

### Review Mode

Code quality review. Single skill, read-only.

1. Read skills/code-reviewer/SKILL.md and follow its instructions
2. Review produces findings report
3. Present findings with severity distribution

**0 gates.** Read-only operation.

### Architect Mode

Design or redesign architecture. Single skill.

1. Read skills/solution-architect/SKILL.md and follow its instructions
2. Full discovery interview (depth based on engagement mode)
3. Produces ADRs, diagrams, tech stack, API contracts, scaffold

**1 gate:** Architecture approval before scaffold generation.

### Document Mode

Generate documentation for existing code. Single skill.

1. Read skills/technical-writer/SKILL.md and follow its instructions
2. Reads all code + existing docs
3. Generates API reference, dev guides, architecture overview

**0 gates.** Technical Writer operates autonomously.

### Explore Mode

Thinking partner. Single skill.

1. Read skills/polymath/SKILL.md and follow its instructions
2. Research, advise, ideate — whatever the user needs
3. When ready, offer to hand off to any other mode

**0 gates.** Polymath manages its own dialogue.

### Research Mode

Deep, grounded research on any topic. **NotebookLM Researcher is the primary skill** (v0.5.19, 35+ tools: research, studio, audio, quiz, flashcards, slides, cross-notebook, batch, pipelines, tags). Polymath + crawl4ai are enhancement layers.

1. Read `skills/notebooklm-researcher/SKILL.md` and follow its instructions
2. Check authentication: `nlm auth status`
3. Check for existing notebooks before creating new: `nlm notebook list`
4. **Phase 1 — Discovery:** Identify if this is a new topic (→ create notebook) or existing notebook (→ add sources)
5. **Phase 2 — Source Ingestion:** Add source URLs, text notes, or YouTube videos. Use `nlm research start --mode deep` for automatic web discovery
6. **Phase 3 — NotebookLM Synthesis:** Use `notebook describe`, `notebook query`, `cross query` to synthesize findings
7. **Phase 4 — Content Generation:** Generate study materials: audio (podcast), report (briefing doc/study guide), quiz, flashcards, slides, infographic
8. **Phase 5 — Cross-Notebook (if needed):** Query across multiple notebooks for comparative research
9. **Phase 6 — Handoff:** Format findings as research report with citations, hand off to relevant mode

**NotebookLM Capabilities (v0.5.19):**
- 35+ MCP tools: notebook, source, research, studio, audio, video, report, quiz, flashcards, mindmap, slides, infographic, data-table, download, export, chat, share, batch, cross, pipeline, tag, alias, config, doctor, skill, setup
- Batch operations: same action across multiple notebooks
- Pipelines: `ingest-and-podcast`, `research-and-report`, `multi-format`
- Drive sync: stale source detection and sync
- Multi-profile: multiple Google accounts
- Enterprise/Workspace support via `NOTEBOOKLM_BASE_URL`

**0 gates.** NotebookLM Researcher manages dialogue.

### Optimize Mode

Performance + reliability analysis. Two skills.

1. **Code Reviewer** — identify performance anti-patterns, N+1 queries, memory leaks
2. **SRE** — capacity analysis, scaling bottlenecks, SLO evaluation
3. **Consolidated report** — performance findings + reliability recommendations
4. **Remediation** — fix top issues

**1 gate:** After analysis, before fixes.

### Marketing Mode

Go-to-market strategy, content, and SEO. Primarily Growth Marketer.

1. **Growth Marketer** — market analysis, positioning, content strategy, SEO audit, copywriting, launch campaign, analytics setup
2. **Conversion Optimizer** (if CRO explicitly mentioned) — funnel audit, CRO recommendations alongside marketing strategy
3. **Frontend Engineer** (if SEO code changes needed) — implement meta tags, schema markup, page speed fixes

**1 gate:** After strategy, before content creation.

### Grow Mode

Conversion optimization, experimentation, and growth engineering. Primarily Conversion Optimizer.

1. **Conversion Optimizer** — funnel audit, CRO implementation, A/B test design, growth loops, churn prevention
2. **Growth Marketer** (if strategy context needed) — provide positioning, messaging, and traffic analysis
3. **Frontend Engineer** (if code changes needed) — implement CRO changes, experiment infrastructure
4. **QA Engineer** (if A/B test infrastructure) — verify experiment implementation

**1 gate:** After audit, before implementation.

### Analyze Mode

Standalone requirements analysis and validation. Single skill.

1. Read `skills/business-analyst/SKILL.md` and follow its instructions
2. BA receives client information, applies 6W1H framework, evaluates completeness
3. BA challenges assumptions, checks feasibility, detects contradictions
4. BA generates `ba-package.md` with validated requirements
5. When complete, offer handoff options:

```
Analysis complete. What next?

1. **Hand off to PM — write BRD from this analysis (Recommended)**
2. **Start Feature mode — build what was analyzed**
3. **Start Full Build — full pipeline from this analysis**
4. **Done — I just needed the analysis**
5. **Chat about this** — Free-form input
```

**0 gates.** BA operates autonomously. Handoff is optional.

### Custom Mode

User picks skills from a menu. Present via notify_user:

```
Which skills do you need? (list the numbers separated by commas)

--- Core Engineering ---
1. **Business Analyst** — Requirements elicitation, feasibility analysis, critical evaluation, information gatekeeping
2. **Product Manager** — Requirements, user stories, BRD
3. **Solution Architect** — System design, API contracts, tech stack
4. **Software Engineer** — Backend implementation
5. **Frontend Engineer** — UI components, pages, design system
6. **QA Engineer** — Tests — unit, integration, e2e, performance
7. **Security Engineer** — OWASP audit, STRIDE, AI security, runtime detection
8. **Code Reviewer** — Architecture conformance, code quality, git workflow
9. **DevOps** — Docker, CI/CD, Terraform, monitoring
10. **SRE** — SLOs, chaos engineering, runbooks
11. **Technical Writer** — API docs, dev guides, architecture docs
12. **Data Scientist** — AI/ML systems, RAG pipelines, agent orchestration
13. **Debugger** — Bug investigation, root cause analysis, regression testing
14. **Prompt Engineer** — Prompt design, evaluation, optimization
15. **API Designer** — REST/GraphQL design, endpoints, error taxonomy
16. **Database Engineer** — Schema design, migrations, query optimization
17. **AI Engineer** — MLOps, model serving, fine-tuning, evaluation
18. **Accessibility Engineer** — WCAG compliance, a11y audit, screen reader
19. **Performance Engineer** — Load testing, profiling, Core Web Vitals
20. **UX Researcher** — User research, usability testing, personas
21. **Data Engineer** — ETL pipelines, data warehouse, dbt, data quality
22. **Project Manager** — Sprint planning, velocity, risk management
23. **XLSX Engineer** — Excel spreadsheet creation, financial models, formula-driven reports, data formatting

--- Game Development ---
24. **Game Designer** — GDD, gameplay loops, economy, mechanic specs
25. **Unity Engineer** — C# ScriptableObjects, Editor tools, URP
26. **Unreal Engineer** — C++/Blueprint, GAS, Nanite/Lumen
27. **Godot Engineer** — GDScript, scene tree, signals, cross-platform
28. **Godot Multiplayer** — MultiplayerSpawner, ENet, prediction, dedicated server
29. **Roblox Engineer** — Luau, DataStore, Roblox Studio, experience design
30. **Phaser 3 Engineer** — TypeScript, modular scenes, ECS-optional, WebGL/Canvas, shared vfx/ui helpers
31. **Three.js Engineer** — ECS, WebGPU/WebGL, Rapier physics, performance budgets, post-processing
32. **Level Designer** — Spatial design, encounters, pacing, environmental storytelling
33. **Narrative Designer** — Branching dialogue, character voice, lore
34. **Technical Artist** — Shaders, VFX, LOD, performance budgets
35. **Game Audio Engineer** — Spatial audio, adaptive music, SFX, mix
36. **Unity Shader Artist** — Shader Graph, HLSL, VFX Graph, post-processing
37. **Unity Multiplayer** — Netcode for GameObjects, relay, prediction
38. **Unreal Technical Artist** — Niagara, Material Editor, Lumen/Nanite
39. **Unreal Multiplayer** — Replication, dedicated server, GAS networking
40. **XR Engineer** — AR/VR/MR, spatial UI, hand tracking, comfort

--- Growth ---
41. **Growth Marketer** — Launch strategy, content, channels, SEO
42. **Conversion Optimizer** — CRO, funnel analysis, A/B testing, retention

--- Data Acquisition ---
43. **Web Scraper** — Secure web crawling (crawl4ai), URL validation, output sanitization, CSS/LLM extraction

--- Integration ---
44. **Paperclip** (optional) — Multi-agent orchestration, ticket management, budget control, heartbeat scheduling

45. **Chat about this** — Free-form input
```

Execute selected skills in dependency order. If user picks conflicting skills, resolve via the authority hierarchy.

### Debug Mode

Systematic bug investigation. Single skill (+ optional fix).

1. Read `skills/debugger/SKILL.md` and follow its instructions
2. Debugger performs triage using the **MANDATORY Iceberg Assessment** (Static vs Dynamic, Cascade Failure Scanning, Sensitive Domains check).
3. If classified as dynamic or suspicious, proceeds with full hypothesis-driven investigation to find root cause. If a simple/static bypass is aborted due to underlying dynamic complexity, triggers the **Auto-escalation Protocol**.
4. Present root cause and proposed fix
5. If user approves fix → apply fix + regression test
6. If fix touches backend code → Software Engineer applies it
7. If fix touches frontend code → Frontend Engineer applies it

**1 gate:** After root cause identified (step 4), before applying fix.

### AI Build Mode

Build or integrate AI-powered features. Multi-skill.

1. **Codebase scan** — identify existing AI infrastructure (LLM clients, embeddings, RAG, agents)
2. **PM (Express depth)** — scope the AI feature. User stories focused on AI behavior.
3. **Data Scientist** — select model, design RAG pipeline/agent architecture (if needed)
4. **Prompt Engineer** — design and evaluate prompts for the feature
5. **Architect (scoped)** — API contracts for AI endpoints, vector DB schema
6. **Build** — Software Engineer + Frontend Engineer implement
7. **Test** — QA + evaluation framework for AI quality

**2 gates:** After AI architecture design (step 3-4), and after prompt evaluation (step 7).

### Migrate Mode

Database migration, framework upgrade, or large-scale code migration.

1. **Codebase scan** — understand current state (schema, framework version, code patterns)
2. **Database Engineer** — design migration: new schema, zero-downtime migration scripts, data transformation
3. **Software Engineer** — update code to work with new schema/framework
4. **QA** — regression tests, data integrity verification
5. **Optional: Rollback plan** — reversible migrations, feature flags for gradual rollout

**2 gates:** After migration plan (step 2), and after migration scripts generated (before execution).

### Game Build Mode

Build a game from concept to a verified release using the control plane in
`skills/_shared/protocols/game-studio-pipeline.md` and the entrypoint in
`workflows/game-studio-build.md`.

1. **Detect entry and review mode** — classify greenfield, existing-project
   adoption, isolated feature, or hotfix; select `solo`, `lean`, or `full`.
2. **Open studio state** — resolve `.production-grade.yaml` path overrides and
   existing project conventions first; use
   `production/session-state/game-studio.md` only as the default. Keep phase,
   milestone, decisions, owners, blockers, and evidence in that single resolved
   state file.
3. **Run the seven phases** — Concept → Systems Design → Technical Setup →
   Pre-Production → Production → Polish → Release & Sustain. Existing projects
   enter at the earliest incomplete phase instead of recreating valid artifacts.
4. **Use role lanes, not a fictional roster**:
   - Control plane: `production-grade`, `project-manager`
   - Creative order: UX/research → `concept-artist` → `art-director` → UI/technical/engine handoff
   - Creative files: `skills/concept-artist/LITE.md`, then `skills/art-director/LITE.md`
   - Creative: `game-designer`, `concept-artist`, `art-director`, `level-designer`,
     `narrative-designer`, `game-audio-engineer`
   - Technical: `solution-architect`, `game-engineer`, engine-specific skills,
     `technical-artist`
   - Quality/release: `qa-engineer`, `game-accessibility-engineer`,
     `performance-engineer`, `build-release-engineer`, `liveops-engineer`
5. **Select the engine from evidence** — read `.production-grade.yaml`, the
   project profile, and engine files. If genuinely unset, recommend Unity,
   Unreal, Godot, Phaser 3, or Three.js from platform and production constraints
   and ask only when the choice materially changes architecture.
6. **Preserve the concept and Style DNA gates** — call
   `python3 scripts/runtime/skill_routing.py --mode game-build --config .forgewright/skills-config.json`
   for ordered verified paths, use `concept-artist` to produce
   structurally distinct visual directions and a selected concept packet, then
   validate the concept/art artifacts with
   `python3 scripts/art-direction/creative-handoff.py validate-handoff "$CONCEPT_PACKET" "$ART_DIRECTION_GATES"`,
   freeze the skill-aware dispatch packet, and then initialize and validate
   `.forgewright/art-direction/game-art-contract.json` using the Art Director
   protocol. Asset generation and engine handoff require approved style,
   confidence resolution, drift validation, manifest, and handoff evidence.
7. **Require a vertical slice before scale-up** — prototype risky assumptions,
   exercise the complete core loop in-engine, and attach playtest evidence before
   committing the production backlog.
8. **Run the production story loop** — design-ready handoff →
   implementation-ready handoff → implementation → review → QA → playtest when
   needed → done handoff. Propagate design changes to affected GDDs, ADRs,
   stories, assets, tests, and release notes.
9. **Use bounded orchestration** — topology follows dependencies
   (`serial-local`, `pipeline`, `fan-out/fan-in`, or `hierarchical`). Before any
   dispatch, run `scripts/runtime/orchestration_policy.py`; enforce its path
   scopes, worker cap, reviewer reservation, risk routing, and stop conditions.
10. **Verify on the existing stack**:
    - `skills/_shared/protocols/game-test-protocol.md`
    - `skills/_shared/protocols/quality-gate.md`
    - `skills/_shared/protocols/task-validator.md`
    - the active phase gate in `game-studio-pipeline.md`

**7 phase gates:** Concept, Systems Design, Technical Setup, Pre-Production,
Production, Polish, and Release & Sustain. Verdicts are `PASS`, `CONCERNS`, or
`FAIL`; concerns require explicit risk acceptance and failures never advance.

### XR Build Mode

Build AR/VR/MR applications. XR Engineer + optional game development pipeline.

1. **Concept analysis** — determine XR type (VR game, AR tool, MR experience), platform (Quest, Vision Pro, PCVR, WebXR)
2. **XR Engineer** — `skills/xr-engineer/SKILL.md` — XR setup, spatial interaction, comfort, spatial UI
3. **If game-like XR** (VR game, interactive experience) — run Game Build pipeline steps 3-8 within XR context
4. **If tool/productivity XR** — route to standard Feature/Full Build pipeline with XR Engineer leading spatial design
5. **QA** — comfort testing, frame rate validation, input model coverage

**2 gates:** After XR architecture (step 2), and after spatial interaction playable (step 3-4).
