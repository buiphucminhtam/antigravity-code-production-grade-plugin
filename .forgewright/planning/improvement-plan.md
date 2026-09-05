# Forgewright Improvement Plan — Post-ECC Review

**Date:** 2026-06-02
**Source:** ECC vs Forgewright Comparative Review
**Plan Quality Score:** 7.4/10 (v1) → Target: ≥ 9.0/10
**Status:** SUPERSEDED — historical June proposal, not the active execution plan.
**Current authority:** `docs/active-roadmap.md` and `docs/project-state.json` (Product Factory PF0-PF7, reviewed 2026-09-05). Do not execute the old sprint backlog or automatic-promotion proposals below without a new scoped decision; current learning promotion follows PF5 evidence and authority gates.
**Owner:** Forgewright Core Team

---

## Strategic Framing

Forgewright has a **structural advantage** ECC lacks: canonical MCP server at `~/.forgewright/mcp-server/` — one server, all platforms. ECC uses per-harness TOML/JSON configs that drift. This is the right architectural bet.

The plan prioritizes:
1. **Highest impact gaps** where ECC is years ahead
2. **Leveraging existing strengths** (GitNexus, canonical MCP, game dev)
3. **Phasing** so each deliverable ships and provides value independently

---

## Risk Register

| ID | Phase | Risk | Likelihood | Impact | Mitigation |
|----|-------|------|------------|--------|------------|
| R1 | All | mem0 v2 API breaking change | Low | High | Pin to stable version, wrapper abstraction layer |
| R2 | 2 | AgentShield wraps ECC — external repo dependency | Medium | Medium | Fork AgentShield into forgewright-security, maintain separately |
| R3 | 2 | Hook runtime controls break existing hooks | Low | High | Add feature flag, default to existing behavior, incremental rollout |
| R4 | 3 | Gemini/Zed/OpenCode MCP config changes | Medium | Low | Abstract harness detection, version-gated configs |
| R5 | All | ECC ships equivalent features during our implementation | Medium | Medium | Accelerate Phase 1, prioritize features ECC lacks (GitNexus, game dev) |
| R6 | All | Context window overflow during long eval runs | Low | Medium | Chunked eval runner, checkpoint + resume |
| R7 | 4 | Dashboard GUI scope creep | Medium | Medium | Strict feature freeze after Phase 3, MVP-only for Phase 4 |
| R8 | 1 | Instinct System conflicts with existing mem0 patterns | Medium | Medium | Run both systems in parallel for 2 sprints, compare, then consolidate |

---

## Sprint Structure

**Total Duration:** ~7-9 weeks (1 owner)
**Parallelization:** Sprint 1 items can run in parallel. Sprint 2+ are sequential.

```
Sprint 0 (Week 0): Baseline & Setup — 0.5 day
  └── Run current eval, document baseline metrics

Sprint 1 (Week 1): Quick Wins — ZERO dev, max impact
  ├── 1.1  GitNexus expansion (all 4 harnesses) — 0.5 day
  └── 1.2  Hook Runtime Controls — 1 day

Sprint 2 (Week 2-3): Core Intelligence
  ├── 2.1  Instinct System v1 — 5 days
  └── 2.2  Eval Framework (EDD Lite) — 5 days

Sprint 3 (Week 4-5): Security & Quality
  ├── 3.1  AgentShield Integration — 5 days
  └── 3.2  Phase Acceptance Validation — 1 day

Sprint 4 (Week 6-7): Ecosystem & Scale
  ├── 4.1  Cross-Harness Expansion — 3 days
  ├── 4.2  Language-Specific Skill Variants — 5 days
  └── 4.3  Install Profiles & Lifecycle CLI — 2 days

Sprint 5 (Week 8-9): Polish & Research
  ├── 5.1  Skill Creator from Git History — 5 days
  └── 5.2  Strategic Compaction Skill — 2 days

Phase 4 (Ongoing): Nice-to-have
  └── Dashboard GUI (TUI) — TBD
```

---

## Phased Implementation Plan

### Phase 1: Core Intelligence — Sprint 2

#### 1.1 — Instinct System v1 (Continuous Learning)
**Status:** Gap — no active observation loop
**What to build:** A hook-based system that fires on every tool call, captures project context, scores confidence, and promotes patterns.

**Implementation:**
```
.forgewright/
├── instincts/
│   ├── observer.ts      # Hook: fires on every tool_use
│   ├── scorer.ts        # Confidence scoring 0.3-0.9
│   ├── promoter.ts      # Auto-promote cross-project patterns
│   └── instinct-store.ts # SQLite or JSON store
├── instincts-config.ts   # Enable/disable per project
```

**Deliverable:** `skills/instinct-system/SKILL.md` + runtime hook
**Value:** Forgewright learns continuously — no manual "save this pattern"
**Dependencies:** Hook system (existing), mem0-v2 (existing)
**Effort:** Medium — 5 days
**Acceptance Criteria:**
- [ ] Observer fires on ≥ 95% of tool_use events
- [ ] Confidence scores generated for ≥ 80% of patterns
- [ ] Cross-project pattern promotion works (verified by eval)
- [ ] No regression in existing hook latency (max +50ms)
- [ ] Feature flag disables entire system without code changes

---

#### 1.2 — Eval Framework (EDD Lite)
**Status:** Gap — Task Validator is less structured
**What to build:** Formal pass@k capability/regression evals with baselines.

**Implementation:**
```
.claude/evals/
├── README.md
├── capabilities/
│   ├── coding-basic.yaml
│   ├── pipeline-complete.yaml
│   └── skill-routing.yaml
├── regressions/
│   └── baseline-*.json
├── run-eval.sh           # Single command runner
└── graders/
    ├── code-grader.ts
    └── human-grader.ts
```

**Deliverable:** `skills/eval-engineer/SKILL.md` + `.claude/evals/` structure
**Value:** Every PR has a quality score. Regression caught before merge.
**Baseline (before):** 0% automated eval coverage
**Target (after):** ≥ 80% of skills have at least one eval
**Dependencies:** None — greenfield
**Effort:** Medium — 5 days
**Acceptance Criteria:**
- [ ] `run-eval.sh` executes all capability evals in < 30 minutes
- [ ] pass@k metrics reported for each capability eval
- [ ] Regression baseline captures current state (pre-Phase 1)
- [ ] Code grader validates output correctness automatically
- [ ] Eval results stored in `.claude/evals/results/` with timestamp

---

### Phase 2: Security & Quality Gates — Sprint 3

#### 2.1 — AgentShield Integration
**Status:** Gap — OWASP checklist is far less mature
**What to build:** Wrap ECC's AgentShield or fork into forgewright-security.

**Implementation:**
```yaml
# Option A (RECOMMENDED): Fork into forgewright-security
.forgewright/security/
├── scanner.ts           # Core scanning engine
├── rules/               # 100+ security rules
├── github-action.yml    # Auto-run on PR
└── agent-shield/        # Forked from ECC AgentShield

# Integration via skill:
skills/security-engineer/SKILL.md  # Add AgentShield integration section
```

**Deliverable:** `skills/security-engineer/SKILL.md` updated with automated scanning
**Value:** 1282+ security tests auto-run on every code change. A-F grading.
**Baseline (before):** Manual OWASP checklist only
**Target (after):** ≥ 1000 automated security tests run on every PR
**Dependencies:** Security Engineer skill (existing)
**Effort:** Medium — 5 days
**Risk Mitigation:** Fork AgentShield into `.forgewright/security/agent-shield/` — do not depend on external ECC repo directly
**Acceptance Criteria:**
- [ ] Security scan runs automatically on PR open
- [ ] A-F security grade reported in PR comment
- [ ] Critical/High vulnerabilities block merge
- [ ] Scan completes in < 5 minutes for typical project
- [ ] No false positives on common patterns (verified by red team eval)

---

#### 2.2 — Hook Runtime Controls
**Status:** Gap — hooks are static
**What to build:** Env var controls for hook profiles.

**Implementation:**
```bash
# In .env or forgewright config
FORGEWRIGHT_HOOK_PROFILE=minimal|standard|strict
FORGEWRIGHT_DISABLED_HOOKS=memory-tick,token-check
FORGEWRIGHT_SESSION_START_MAX_CHARS=50000
```

```typescript
// hooks/index.ts
const profile = process.env.FORGEWRIGHT_HOOK_PROFILE ?? 'standard';
const disabled = process.env.FORGEWRIGHT_DISABLED_HOOKS?.split(',') ?? [];
// Filter hooks based on profile + disabled list
```

**Deliverable:** Hook profile system in `scripts/` + docs
**Value:** Teams can tune hooks per project. CI uses minimal, dev uses full.
**Dependencies:** Hook system (existing)
**Effort:** Low — 1 day
**Acceptance Criteria:**
- [ ] All existing hooks work with default profile (zero regression)
- [ ] Feature flag disables entire hook system without code changes
- [ ] CI/CD can set `FORGEWRIGHT_HOOK_PROFILE=minimal` to minimize overhead
- [ ] Documentation added to `.claude/hooks.yml`

---

### Phase 3: Ecosystem & Scale — Sprint 4

#### 3.1 — Cross-Harness Expansion (Gemini CLI, Zed, OpenCode)
**Status:** Gap — 4 harnesses vs ECC's 10+
**What to build:** MCP setup for Gemini CLI, Zed AI, and OpenCode.

**Deliverable:** `scripts/forgewright-mcp-setup.sh` extended with:
```bash
--gemini    # Setup for Gemini CLI
--zed       # Setup for Zed AI
--opencode  # Setup for OpenCode
```

**Value:** Forgewright reaches Gemini, Zed, OpenCode users — same canonical server.
**Dependencies:** MCP server (existing)
**Effort:** Medium — 3 days
**Acceptance Criteria:**
- [ ] All 3 new harnesses can connect to canonical MCP server
- [ ] GitNexus MCP works in all 3 new harnesses (verified by smoke test)
- [ ] Setup script detects harness automatically
- [ ] Documentation covers all 7 supported harnesses

---

#### 3.2 — Language-Specific Skill Variants
**Status:** Gap — general-purpose reviewer/resolver
**What to build:** Language-specific skills for top 3: Python, Go, Rust.

**Deliverable:**
```
skills/software-engineer-python/SKILL.md
skills/software-engineer-go/SKILL.md
skills/software-engineer-rust/SKILL.md
skills/code-reviewer-python/SKILL.md
skills/code-reviewer-go/SKILL.md
skills/code-reviewer-rust/SKILL.md
```

**Value:** Reviewers understand Python idioms, Go conventions, Rust borrow checker.
**Dependencies:** Software Engineer + Code Reviewer skills (existing)
**Effort:** Medium — 5 days
**Acceptance Criteria:**
- [ ] Each skill has ≥ 10 language-specific rules/checks
- [ ] Eval coverage: each skill has ≥ 1 pass@k eval
- [ ] Skills auto-route based on project language detection

---

#### 3.3 — Install Profiles & Lifecycle CLI
**Status:** Gap — no --profile or --uninstall
**What to build:**
```bash
forgewright install --profile minimal   # Only core pipeline
forgewright install --profile core      # + security, QA
forgewright install --profile full      # Everything

forgewright uninstall --repair          # Fix broken install
forgewright doctor                      # Diagnose issues
forgewright list-installed              # Show what's installed
```

**Deliverable:** `install.sh` with profile flags + `uninstall.sh` with doctor
**Value:** Teams can install only what they need. Faster onboarding.
**Dependencies:** forgewright-mcp-setup.sh (existing)
**Effort:** Medium — 2 days
**Acceptance Criteria:**
- [ ] `forgewright install --profile minimal` installs only core pipeline
- [ ] `forgewright install --profile full` installs everything
- [ ] `forgewright doctor` reports health of all installed components
- [ ] `forgewright uninstall` removes all Forgewright configs cleanly

---

### Phase 4: Nice-to-Have — Sprint 5 + Ongoing

#### 4.1 — Skill Creator from Git History
**Status:** ✓ COMPLETED
**Deliverables:**
- `scripts/forgewright-skill-create.sh` — Git-based skill auto-generator
- `skills/skill-maker/SKILL.md` — Updated with git analysis section
- `skills/generated/` — Generated skills output directory

**Acceptance Criteria:**
- [x] Auto-generates SKILL.md from ≥ 10 commits of a pattern
- [x] Generated skill includes trigger patterns, execution flow, examples
- [x] Script handles repos with < 5 commits gracefully (with warning)
- [x] Confidence score reflects pattern strength

---

#### 4.2 — Strategic Compaction Skill
**Status:** ✓ COMPLETED
**Deliverables:**
- `skills/strategic-compaction/SKILL.md` — Main skill file
- `skills/strategic-compaction/evals/test-cases.json` — 12 test cases
- `skills/strategic-compaction/evals/run-tests.sh` — Test runner

**Acceptance Criteria:**
- [x] Skill detects: after research milestone, after failed approach, after complex multi-file change
- [x] Triggers suggestion with `/compact` in response
- [x] Zero false positive rate on normal conversation turns (tested: 12/12 passing)

**Deliverable:** `skills/strategic-compaction/SKILL.md`
**Value:** Compaction happens at right moments, not just when context is full.
**Dependencies:** None
**Effort:** Low — 2 days
**Acceptance Criteria:**
- [ ] Skill detects: after research milestone, after failed approach, after complex multi-file change
- [ ] Triggers suggestion with `/compact` in response
- [ ] Zero false positive rate on normal conversation turns

---

### Phase 5: TUI Dashboard (Future)

**Status:** Gap — no visual interface
**Scope:** Strict MVP — skills explorer + session state viewer only

**Implementation:**
```bash
npm run dashboard   # Launches TUI
```

**Value:** Non-technical users can explore Forgewright capabilities visually.
**Effort:** High — separate project
**Acceptance Criteria:**
- [ ] Displays all 57 skills with descriptions
- [ ] Shows current session state (mode, phase, skill chain)
- [ ] No feature creep beyond MVP scope (enforced by Phase 4 feature freeze)

---

## Owner Assignments

| Phase | Owner | Notes |
|-------|-------|-------|
| Sprint 0 | All | Baseline measurement |
| Sprint 1 | Any | Quick wins, zero dev |
| Sprint 2 | Skill Authors | Instinct + Eval (parallel possible) |
| Sprint 3 | Security + QA | AgentShield (depends on Sprint 2) |
| Sprint 4 | DevOps + Polymath | Ecosystem (depends on Sprint 3) |
| Sprint 5 | Skill Maker + Polymath | Research (depends on Sprint 4) |
| Phase 5 | TBD | Future work |

---

## Priority Matrix (Updated)

| # | Improvement | Priority | Effort | Impact | Phase | Dependencies |
|---|-------------|----------|--------|--------|-------|-------------|
| 0 | Sprint 0: Baseline Measurement | **CRITICAL** | 0.5 day | — | Sprint 0 | None |
| 1a | GitNexus — all harnesses | **HIGH** | 0.5 day | High | Sprint 1 | None |
| 1b | Hook Runtime Controls | HIGH | 1 day | Medium | Sprint 1 | None |
| 2a | Instinct System v1 | HIGH | 5 days | High | Sprint 2 | Sprint 0 baseline |
| 2b | Eval Framework | HIGH | 5 days | High | Sprint 2 | Sprint 0 baseline |
| 3a | AgentShield | HIGH | 5 days | High | Sprint 3 | Instinct System (confidence scoring) |
| 3b | Phase Validation | HIGH | 1 day | High | Sprint 3 | AgentShield |
| 4a | Cross-Harness Expansion | MEDIUM | 3 days | High | Sprint 4 | Sprint 3 |
| 4b | Language Variants | MEDIUM | 5 days | Medium | Sprint 4 | Sprint 3 |
| 4c | Install Profiles | MEDIUM | 2 days | Medium | Sprint 4 | Sprint 3 |
| 5a | Skill Creator | LOW | 5 days | Medium | Sprint 5 | Sprint 4 |
| 5b | Strategic Compaction | LOW | 2 days | Low | Sprint 5 | None |
| 6 | Dashboard GUI | LOW | TBD | Low | Future | Sprint 5 |

---

## Baseline Metrics (Sprint 0 — To Be Measured)

| Metric | Current State | Target After Phase 1 |
|--------|--------------|---------------------|
| Automated eval coverage | **0%** | ≥ 80% of skills |
| Security test count | ~50 (manual checklist) | ≥ 1000 automated |
| Harness count | 4 | 7 |
| Language-specific skills | 0 | 6 |
| Install profiles | 0 | 3 |
| GitNexus coverage | Partial | Full (all harnesses) |

---

## Recommended Starting Point

**Today (Sprint 0):** Measure baseline metrics
**Week 1 (Sprint 1):** GitNexus expansion + Hook Controls — ship in 1.5 days, zero regression risk
**Week 2-3 (Sprint 2):** Instinct System + Eval Framework — core intelligence
**Week 4-5 (Sprint 3):** AgentShield + Validation
**Week 6-7 (Sprint 4):** Ecosystem & Scale
**Week 8-9 (Sprint 5):** Research & Polish

---

## Success Metrics

| Improvement | Metric | Baseline | Target |
|-------------|--------|----------|--------|
| GitNexus | Active harnesses with GitNexus MCP | TBD (Sprint 0) | 4 → 7 |
| Hook Controls | Projects using non-default profile | 0 | ≥ 10 |
| Instinct System | % tool calls triggering pattern suggestions | 0% | ≥ 20% |
| Eval Framework | Skills with ≥ 1 pass@k eval | 0% | ≥ 80% |
| AgentShield | Security tests run per PR | 0 | ≥ 1000 |
| Cross-Harness | Active harnesses | 4 | 7 |
| Language Variants | Language-specific skills | 0 | 6 |
| Install Profiles | New installs using --profile | 0% | ≥ 50% |
| Skill Creator | Skills auto-generated from git | 0 | ≥ 3 |
