# Forgewright — Product Overview

> **Version:** 8.7.0 · **License:** MIT · **Repository:** [github.com/buiphucminhtam/forgewright](https://github.com/buiphucminhtam/forgewright)

---

## What Is Forgewright?

Forgewright is an open-source AI orchestrator that turns raw language models (Claude, GPT, Gemini) into evidence-oriented software engineering agents. Supported runtime paths can use a structured pipeline of skills, guardrails, memory, and verification to attach evidence to completion claims and record lessons from failures. Those controls reduce risk; they do not guarantee correct output or eliminate repeated mistakes. The currently declared canonical runtime and its enforcement boundary are documented in the [canonical-runtime ADR](adr/0001-canonical-production-runtime.md). One install gives you 84 specialized AI skills covering the software lifecycle, as counted by `product-manifest.json` and checked by `npm run verify:product-truth`.

---

## Who Is Forgewright For?

| Audience | Why Forgewright Helps |
|----------|----------------------|
| **Solo developers** | Provides structured PM, architecture, QA, and DevOps-oriented workflows alongside the IDE. |
| **Small teams (2–10)** | Can apply consistent quality-gate and testing workflows when the configured runtime supports them. |
| **AI-first studios** | Provides game development skills (Unity, Unreal, Godot, Phaser 3, Three.js, Roblox) with level, narrative, and audio design agents. |
| **Enterprise engineering orgs** | Offers configurable pipeline, guardrail, security-review, and quality-scoring workflows; applicability depends on the installed surface and checks. |
| **Researchers & educators** | Enables deep research workflows (NotebookLM + Polymath), self-improving ASIP protocol, and transparent decision logging. |

---

## Core Value Propositions

### 1. Evidence-First Engineering

The documented kernel workflow requires VERIFY blocks — runnable commands with pasted output and exit codes — before a completion claim. This is a workflow and test-backed constraint, scoped to the declared runtime rather than a guarantee for every compatibility path; see the [conformance matrix](adr/0001-canonical-production-runtime.md#claim-to-enforcement-conformance-matrix).

```
CLAIM: JWT auth middleware works
COMMAND: npm test -- --grep "auth"
OUTPUT: 3 passing (120ms)
EXIT CODE: 0
VERDICT: PASS
```

### 2. Persistent Memory (GraphRAG V4 — FluxMem)

Memory-enabled configurations can maintain a SQLite cognitive graph (`memory.db`) that persists:

- **Episodic memory** — What happened in previous sessions
- **Semantic memory** — Architectural decisions, coding conventions
- **Procedural circuits** — Successful execution trajectories may be cached for later reuse
- **ASIP edge decay/reinforcement** — configured memory paths can record failed and successful trajectories; effectiveness is measured rather than guaranteed

### 3. Skill Routing & Orchestration

A configured agent surface can classify a request into one of 24 execution modes and select skills. The canonical product pipeline has six phases:

```
INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN
```

| You say... | Mode triggered | Skills activated |
|------------|---------------|-----------------|
| "Build a SaaS app" | Full Build | BA → PM → Architect → Engineers → QA → DevOps |
| "Add dark mode" | Feature | PM → FE Engineer → QA |
| "Review my code" | Review | Code Reviewer |
| "Build a Unity game" | Game Build | UX/research → Concept Artist → Art Director → UI/technical/engine handoff → Unity Engineer |
| "Deploy to Vercel" | Ship | DevOps → SRE |

### 4. Local-First State & Configurable Data Boundaries

Forgewright stores its own project state locally by default:

- **Local SQLite GraphRAG database** (`.forgewright/`) — Forgewright does not require a hosted memory service
- **Provider choice** — swap between supported hosted providers or local models (Ollama/LMStudio)
- **Explicit boundary** — local memory, budgets, and decisions remain in the workspace; prompts, code excerpts, and tool results may be transmitted to whichever model or external tool providers you configure

For an on-device-only workflow, configure a local model, local tools, and inspect each integration's network behavior. Forgewright does not override a provider's retention, billing, or telemetry policy.

### 5. MCP & GitNexus Integration

Forgewright exposes its capabilities through the **Model Context Protocol (MCP)**, giving your IDE direct access to:

- **Forgewright MCP server** — Pipeline management, skill invocation, memory operations
- **GitNexus MCP server** — Code intelligence with 19K+ symbols, impact analysis, blast radius, safe rename

For design and game work, the creative handoff is explicit: UX/research →
Concept Artist → Art Director → UI/technical/engine handoff. The corresponding
skills are `skills/concept-artist/LITE.md` and `skills/art-director/LITE.md`.

```bash
# One-command setup for all IDEs
bash scripts/forgewright-mcp-setup.sh
```

### 6. Self-Improving Protocol (ASIP)

When a plan fails twice, ASIP activates a mandatory Research Gate:

1. Check NotebookLM availability → deep research
2. Fallback to web search
3. Synthesize 1–3 actionable insights
4. Update session tracker
5. Re-plan with knowledge and retry

Lessons are persisted to `.forgewright/lessons.md` and graph memory so later runs can retrieve prior failures. This is intended to lower recurrence; the measurable target and evidence requirements are defined in `docs/active-roadmap.md`.

### 7. Built-in Cost Control

```bash
forge token on           # Enable tracking
forge token budget --daily 5 --weekly 25
forge token report       # Usage analytics
forge token dashboard    # Visual dashboard
```

Optional **Expert CLI Mode** routes only high-stakes decisions (architecture gates, security reviews) to premium models, keeping routine work on cheaper models.

Usage and cost figures are estimates derived from model-reported tokens and configured pricing. Missing usage is recorded as unavailable in production evaluation evidence; provider invoices remain authoritative, and enabling a budget does not itself guarantee a hard billing cap.

---

## The 4 Operating Levels

Forgewright is designed so you can start with zero setup and add power incrementally:

### Level 1 — Basic (Zero Setup)

Copy `AGENTS.md` and `CLAUDE.md` into your project root. Open your IDE and start talking. All 84 AI skills auto-activate through the rule files.

- **Requirements:** None beyond an AI-capable IDE
- **What you get:** Full skill routing, pipeline orchestration, quality gates

### Level 2 — Lite (Code Intelligence)

Add GitNexus for deep code understanding. The AI can now answer "What uses this function?" and "What breaks if I change X?" with graph-backed evidence.

- **Requirements:** Node.js 18+, `npm install -g gitnexus`
- **What you get:** Symbol search, impact analysis, blast radius, safe rename

### Level 3 — Memory (GraphRAG)

Enable persistent memory so the AI remembers decisions, conventions, and lessons across sessions. Ideal for long-running projects.

- **Requirements:** Python 3.8+ (for `mem0-v2.py`)
- **What you get:** Cross-session memory, ASIP learning, convention indexing, procedural circuits

### Level 4 — Full (MCP Integration)

Connect the Forgewright MCP server for maximum power: 12+ AI tools available directly in your IDE, multi-project support, and isolated per-project state.

- **Requirements:** MCP-compatible IDE, `bash scripts/forgewright-mcp-setup.sh`
- **What you get:** Full MCP toolset, multi-project workspace, real-time pipeline status

---

## What Forgewright Does NOT Do

| Misconception | Reality |
|--------------|---------|
| **Not a code generator** | Forgewright produces *systems* — with architecture, tests, security audits, infrastructure, and documentation. Not just files. |
| **Not a chatbot** | It doesn't ask 20 questions then generate a template. It researches, decides, builds, and verifies — pausing only at strategic gates. |
| **Not a cloud service** | Forgewright has no required hosted service. Local state remains local by default, while configured model and tool providers may receive prompts, code excerpts, or tool results. |
| **Not a model provider** | Forgewright is the harness, not the engine. You bring your own LLM (Claude, GPT, Gemini, or local models). |
| **Not a rigid pipeline** | The orchestrator adapts: skipping frontend for API-only projects, enabling data science for ML workloads, scaling complexity to match the problem. |
| **Not a demo** | Included artifacts and tests are versioned in the repository. A given run records only the checks it actually executes; failures remain evidence, not a guarantee of automatic repair. |

---

## Supported IDEs & Platforms

| IDE / Platform | Config File | MCP Support | Maturity | Notes |
|---------------|-------------|-------------|----------|-------|
| **Cursor** | `AGENTS.md` | ✅ Full | Stable | Primary development IDE. Uses `.cursor/mcp.json` for MCP config. |
| **Claude Code** | `CLAUDE.md` | ✅ Full | Stable | Direct Claude CLI integration. Supports hooks for auto-indexing. |
| **Antigravity** | `AGENTS.md` | ✅ Full | Stable | Gemini-powered IDE. Uses `GEMINI.md` alongside `AGENTS.md`. |
| **Gemini (CLI/IDE)** | `GEMINI.md` | ✅ Full | Stable | Gemini-native support with `thinking_level` optimization. |
| **Codex (OpenAI)** | `AGENTS.md` | ✅ Full | Stable | Codex CLI integration via `forgewright-mcp-setup.sh --codex`. |
| **Forge CLI** | `src/cli/package.json` | N/A | Beta | Agent-first command-line interface; package versioned independently. |

### Configuration Files

Each IDE reads from standardized rule files at your project root:

- **`AGENTS.md`** — The primary rule file (Cursor, Antigravity, Codex)
- **`CLAUDE.md`** — Claude Code-specific rules (identical kernel, platform-specific hooks)
- **`GEMINI.md`** — Gemini-specific rules (identical kernel, Gemini optimizations)

All three files share the same kernel content (auto-synced via `scripts/lite/sync-kernel.py`) and differ only in platform-specific integration details.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/buiphucminhtam/forgewright.git
cd forgewright

# 2. Copy config to your project
cp AGENTS.md /path/to/your/project/
cp CLAUDE.md /path/to/your/project/

# 3. Open in IDE and start talking
cursor /path/to/your/project/

# 4. (Optional) Add GitNexus for code intelligence
npm install -g gitnexus && gitnexus setup && gitnexus analyze

# 5. (Optional) Add MCP for full power
bash scripts/forgewright-mcp-setup.sh
```

---

## Further Reading

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | 5-layer system architecture with visualizations |
| [Roadmap](improvement-roadmap-v2.md) | Release history and planned features |
| [Setup Guide](SETUP.md) | Detailed installation instructions |
| [Skill Catalog](skill-catalog.md) | Full listing of 84 AI skills |
| [CHANGELOG](../CHANGELOG.md) | Detailed version history |
| [VISION](../VISION.md) | The 10 design principles |

---

*Last updated: 2026-07-09*
