<!-- markdownlint-disable MD013 MD033 -->
# Forgewright — AI Orchestrator That Actually Learns

<p align="center">
  <img src="assets/forgewright-banner.png" alt="Forgewright Banner" width="600" />
</p>

<p align="center">
  <a href="https://github.com/buiphucminhtam/forgewright">
    <img src="https://img.shields.io/github/stars/buiphucminhtam/forgewright?style=flat-square&logo=github&label=Stars" alt="Stars" />
  </a>
  <a href="https://github.com/buiphucminhtam/forgewright/network/members">
    <img src="https://img.shields.io/github/forks/buiphucminhtam/forgewright?style=flat-square&logo=github&label=Forks" alt="Forks" />
  </a>
  <img src="https://img.shields.io/badge/version-8.7.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/skills-83-brightgreen?style=flat-square" alt="Skills" />
  <img src="https://img.shields.io/badge/MCP-Supported-purple?style=flat-square" alt="MCP Supported" />
  <img src="https://img.shields.io/badge/Architecture-Agentic_Framework-orange?style=flat-square" alt="Agentic Framework" />
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License" />
  </a>
</p>

---

> **An AI harness that records failures and reuses verified lessons.** Forgewright is designed to reduce repeated failure patterns; recurrence is measured rather than assumed away.

Forgewright is an open-source engineering harness that adds evidence-gated delivery workflows around the model provider and tools you configure. It coordinates definition, building, hardening, and shipping while keeping provider-specific execution inside that provider's native ecosystem.

---

## Roadmap and Evidence Status

The zero-cost local roadmap is implemented for all 19 deliverables from P0.1 through P3.4. The machine-readable [completion manifest](docs/roadmap-completion.json) maps every deliverable to local evidence and a rollback strategy; the [active roadmap](docs/active-roadmap.md) records the detailed scope and evidence boundaries.

- Verification runs locally and does not require GitHub Actions or paid hosted CI.
- Provider and model selection is capability-driven. The core does not require one provider, model catalog, or API.
- Provider-native execution stays within the selected provider's own CLI or ecosystem adapter.
- Live adaptive-routing gates P2.2–P2.5 remain disabled until that provider produces trustworthy native receipts. Fixtures, generic CLI probes, and local smoke markers cannot enable them.
- Gemini API integration is not part of the roadmap. Antigravity CLI may be used as one optional provider-side validation instance, not as a core dependency.

Run the roadmap contract locally:

```bash
python3 -m pytest -q tests/unit_tests/test_roadmap_completion.py
```

---

## Why Forgewright / Who It Is For

Raw language models are only a small part of a functional AI coding agent. Without a disciplined framework, agents hallucinate, lose context, and repeat errors. Forgewright wraps AI execution in an uncompromising delivery harness designed for professional engineering teams.

### Key Outcomes

- **Reduces repeated failure patterns**: The Adaptive Self-Improving Protocol (ASIP) records lessons and weakens previously failing logic paths. Effectiveness depends on memory being enabled and is evaluated through recurrence metrics.
- **Project-Specific Memory**: Can use a local SQLite-backed memory layer to retrieve project context. Retrieval quality and recurrence improvements are measured release criteria, not guarantees; see the [active roadmap](docs/active-roadmap.md).
- **Pipeline Execution**: Bypasses the "chat" paradigm. Requests undergo a strict requirements-gathering and testing lifecycle before code is written.
- **Evidence-Gated Testing**: Test and verification integrations are available where configured. They provide local evidence for the checks actually run; they do not guarantee zero escaped bugs.
- **Local-first state**: Project memory and orchestration state are stored in the workspace by default. Prompts, code excerpts, and tool results may still be sent to the model or tool providers you configure; use a local model and local tools when data must stay on-device.

### Who It Is For

- **Senior Engineers** needing an intelligent rubber-duck and rapid prototyping agent.
- **Development Teams** looking to automate repetitive boilerplate, refactoring, and test generation.
- **QA Engineers** desiring robust autonomous integration tests.

**[Read the Full Product Overview ➔](docs/product-overview.md)**

---

## 30-Second Example

Forgewright takes abstract prompts and manages the complete lifecycle autonomously.

```text
You: "Build a React login form with JWT auth"

Forgewright responds:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤔 INTERPRETING...
   Intent: Feature request
   Mode: Feature
   Confidence: HIGH

📋 PLANNING (Plan Quality Loop)...
   Score: 9.5/10 ✓

⚡ EXECUTING...
   [████████████████████░░░░] 85%
   
   ✓ Component created (auth/LoginForm.tsx)
   ✓ JWT middleware added
   ✓ Unit tests written (3 passing)
   ✓ Security audit passed

✅ DONE (Score: 92/100)
   • 4 files created
   • All tests passing
   • No security issues
   • Ready for production

💡 Lesson learned: JWT refresh token rotation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

For supported, configured paths, Forgewright can create files, run configured tests, and record verifier output. Whether a particular task uses those paths depends on the selected runtime and available tools; see the [canonical-runtime ADR](docs/adr/0001-canonical-production-runtime.md).

---

## Prerequisites and Quick Start

Forgewright is designed to run locally alongside your preferred IDE and development stack. It operates primarily as a Model Context Protocol (MCP) server, integrating seamlessly into modern AI-assisted editors.

### Prerequisites

Please ensure the following dependencies are installed and available in your system path:

- **Node.js**: v18.x or higher (required for GitNexus and MCP servers).
- **Git**: v2.30+ (required for repository management and history tracking).
- **Python**: v3.8+ (required for the FluxMem SQLite GraphRAG memory layer).
- **Supported IDE**: Cursor, Claude Desktop, or Codex CLI.

### Verified Install Paths for Supported IDEs

For the best experience, we recommend using Forgewright in **Cursor** or **Claude Desktop** via the Model Context Protocol (MCP). The following setup flow integrates Forgewright directly into your target repository as a submodule. This allows it to track your project's unique configuration securely and persistently across different developer machines.

#### Step 1: Clone Forgewright as a Git Submodule

Integrating Forgewright directly into your target repository allows it to maintain a project-specific memory bank and execution context. Open your terminal, navigate to the root of your project repository, and execute the following commands:

```bash
cd /path/to/your-project
git submodule add -b main https://github.com/buiphucminhtam/forgewright.git forgewright
git submodule update --init --recursive
```

#### Step 2: Install and Configure GitNexus

GitNexus powers Forgewright's static code intelligence and impact analysis. It allows the AI to understand the relationships between different modules in your codebase without needing to read every file into its context window.

```bash
npm install -g gitnexus
gitnexus setup
gitnexus analyze
```

The `analyze` step builds the initial structural graph of your project. You should re-run `gitnexus analyze` whenever you introduce significant architectural changes.

#### Step 3: Run the MCP Setup Script

The MCP setup script automatically configures your local environment to recognize Forgewright's capabilities. It modifies the necessary configuration files for Claude Desktop, Cursor, Antigravity, and Codex CLI.

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh
```

#### Step 4: Initialize the Required Rules and Constraints

Forgewright relies on strict system prompts to maintain its behavioral constraints. You must copy these rule files to the root of your project so that your IDE's AI assistant can read them automatically upon initialization.

```bash
cp forgewright/AGENTS.md .
cp forgewright/CLAUDE.md .
```

*Final Step:*
You must restart your IDE completely (e.g., CMD+Q on Mac) to force it to load the newly installed MCP servers. Once the IDE has restarted, open your AI chat panel and verify the installation by running `/onboard`.

#### Step 5: Enable Antigravity CLI (`agy`) Enforcement

Every developer or CI machine that uses `agy` must install the machine-level
Antigravity hook and the parent repository's update hooks once:

```bash
bash forgewright/scripts/forgewright-install.sh --profile minimal --yes
bash forgewright/scripts/forgewright-hook-doctor.sh --quick --fix
bash forgewright/scripts/lite/install-submodule-update-hooks.sh "$PWD"
```

The installer adds the native named `PreToolUse` policy hook to
`~/.gemini/config/hooks.json`. This is Antigravity CLI configuration and is
separate from Gemini CLI's `.gemini/settings.json`. Setup and `doctor --fix`
also seed `.forgewright/execution-policy.yaml` into the parent workspace when
it is missing; an existing file or symlink is always preserved. Confirm the installation:

```bash
bash forgewright/scripts/forgewright-hook-doctor.sh --quick
```

After this one-time setup, `post-merge` and `post-checkout` in the parent
repository automatically check `origin/main`. When the submodule is clean and
can be fast-forwarded, Forgewright updates it and refreshes the installed
Antigravity hook runtime, doctor checks, and MCP configuration. Local submodule
changes or divergent history are never overwritten. Opening `agy` itself does
not fetch Git; the automatic update happens during the preceding parent Git
pull, merge, or checkout.

Use Forgewright-managed delegation, escalation, benchmark, or parallel-dispatch
commands whenever possible. These paths invoke the real `agy` binary with an
explicit sandbox and mode, validate the global policy hook, and provide the
canonical workspace through `FORGEWRIGHT_WORKSPACE`.

If you intentionally invoke `agy` directly from a project root, provide the
workspace and select a mode explicitly:

```bash
FORGEWRIGHT_WORKSPACE="$PWD" agy --sandbox --mode accept-edits
```

Current `agy 1.1.2 --print` builds may send an empty `workspacePaths` hook
field. Without `FORGEWRIGHT_WORKSPACE`, the Forgewright hook therefore fails
closed and can deny otherwise safe tool calls. The checked-in
`.agents/hooks.json` is retained for project portability, but the tested runtime
loaded the global registry; do not remove the global hook.

---

## Four Operating Levels

Forgewright adapts to the scale of your project, offering different tiers of autonomy and intelligence based on the complexity of your requirements. You can start small and progressively enable more advanced features as your project matures.

| Level | Features | Setup Required | Best For |
| --- | --- | --- | --- |
| **Level 1**<br/>Zero Setup | Basic chat, 83 auto-activated skills | Just run your AI chat | Quick questions, single-file scripts |
| **Level 2**<br/>Code Intelligence | `gitnexus_impact`, `gitnexus_query`, `gitnexus_rename` | `gitnexus setup` | Refactoring, code reviews, debugging |
| **Level 3**<br/>GraphRAG Memory | Persistent local knowledge, automatic lesson retention | Python 3.8+ | Long-running projects, complex domains |
| **Level 4**<br/>Full Power | Parallel dispatch, multi-repo support, full pipeline orchestration | MCP Setup script | Team projects, end-to-end autonomous dev |

### How to Access Different Levels

#### Level 1: Zero Setup

By default, executing Forgewright places you in Level 1. The agent will rely primarily on its base instructions and standard conversational abilities, using standard MCP tools for basic file reads and writes.

#### Level 2: Code Intelligence

To utilize Level 2 Code Intelligence, ensure `gitnexus` is installed globally and your project is indexed. Whenever you ask the agent to refactor code, it will autonomously invoke the code intelligence layer (`gitnexus_impact`) before making changes.

#### Level 3: GraphRAG Memory

Level 3 requires Python 3.8+ and initializes the `.forgewright/memory.db` local database. This level allows the orchestrator to automatically extract architectural decisions and record them for future sessions, effectively building a persistent brain for your codebase.

#### Level 4: Full Power

Level 4 unlocks the Parallel Dispatch workflows and the complete multi-agent pipeline. It requires the MCP server to be fully configured in your IDE. At this level, the orchestrator acts as an autonomous engineering team, breaking complex tasks into sub-tasks and executing them in isolated Git worktrees.

---

## Core Capabilities

Forgewright bundles advanced software engineering workflows into focused, accessible tools that run directly inside your local environment.

### 1. Code Intelligence (GitNexus)

Forgewright can use GitNexus to construct a structural graph of a supported codebase. The documented kernel requires impact analysis before symbol edits when GitNexus is available; compatibility paths and user overrides are not universally enforced. Graph queries supplement rather than eliminate text search, and incomplete or stale indexes remain an explicit evidence boundary.
**[Read the GitNexus Guide ➔](docs/guides/gitnexus.md)**

### 2. Autonomous Testing Stack

Automated shifting-left test logic can integrate Property-Based Testing (PBT), mutation testing, and Appium/Maestro where configured. The checks that run are recorded as evidence; this repository does not claim that every runtime writes tests first or blocks every coverage decrease.
**[Read the Testing Stack Guide ➔](docs/guides/testing-stack.md)**

### 3. Persistent Cognitive Memory (FluxMem)

Memory-enabled configurations can retain project context across sessions using local SQLite-backed storage. Retrieval and staleness targets are documented in the [active roadmap](docs/active-roadmap.md); no universal recall or latency guarantee is claimed.
**[Read the FluxMem Guide ➔](docs/guides/fluxmem.md)**

### 4. Parallel Skill Dispatch

Executes independent QA, Build, and Review steps concurrently across Git worktrees. This parallelization drastically reduces waiting time and token context bloat by isolating tasks to specialized sub-agents.
**[Read the Parallel Dispatch Guide ➔](docs/guides/parallel-dispatch.md)**

### 5. Multi-Project Hub

A unified management dashboard for handling multiple projects simultaneously. Monitor agent states, active execution pipelines, and Git diffs across your entire organization from one unified web portal.
**[Read the Multica Hub Guide ➔](docs/guides/multica-hub.md)**

### 6. Token Tracking & Cost Analytics

Track reported LLM usage, estimate API costs from configured pricing, and surface optimization opportunities. Budgets and alerts reduce runaway-loop risk, but provider billing remains authoritative and must be reconciled when usage metadata or prices are unavailable.
**[Read the Token Management Guide ➔](docs/guides/token-management.md)**

### 7. MCP Tool Sandbox

The Tool Sandbox (DeerFlow IV) automatically intercepts all tool output, strips ANSI colors, scans for prompt injections, and redacts credentials or secrets before they enter the model context or cache.
**[Read the Tool Sandbox Guide ➔](docs/guides/tool-sandbox.md)**

### 8. The Adaptive Self-Improving Protocol (ASIP)

ASIP automatically detects plan and execution failures, triggers deep research using NotebookLM or web fallbacks, and adapts the system's operational procedures.
**[Read the ASIP Guide ➔](docs/guides/asip.md)**

### 9. Runtime Lifecycle Guard

Agent sessions start dev servers, game editors, emulators and watchers — and forget to stop them. Ports pile up, RAM climbs, build caches grow without bound. The Runtime Lifecycle Guard closes that loop machine-wide, across Claude Code, Codex and Antigravity:

- **Reuse instead of respawn.** `dev-run.sh` gives each project a stable port band and hands back the running instance rather than starting a second copy.
- **Every long-running process holds a lease.** The reaper may only ever signal a process that has one; anything it did not start is out of bounds by construction, and infrastructure ports are allowlisted at install time.
- **Reclaim by TTL.** A throttled sweep on the `Stop` hook reclaims expired leases — including those left behind by a session that crashed.
- **Disk budgets and artifact TTLs** report per-project footprint and age out the pipeline's own evidence files.
- **Reversible by design.** Observe mode by default, dry-run defaults on anything destructive, and a three-tier kill switch (`FORGEWRIGHT_RLG=off`, a `DISABLED` file, a per-project opt-out).

```bash
bash scripts/runtime/dev-run.sh --role web-dev --ttl 2h -- npm run dev   # sanctioned launch
bash scripts/runtime/runtime-inventory.sh --all                          # what is running, machine-wide
bash scripts/runtime/runtime-reap.sh                                     # dry-run: what would be reclaimed
bash scripts/runtime/disk-budget.sh                                      # footprint vs budget
touch ~/.forgewright/runtime/DISABLED                                    # stop the guard, instantly
```

**[Read ADR-010 ➔](docs/adr/ADR-010-runtime-lifecycle-guard.md)**

### 10. Game Studio Control Plane

Game Build mode now uses a seven-phase, artifact-gated operating model from
concept through release:

```text
Concept → Systems Design → Technical Setup → Pre-Production
        → Production → Polish → Release & Sustain
```

- **Phase-aware handoffs:** design-ready, implementation-ready, done, playtest,
  build, and release evidence are required only when their phase makes them
  applicable.
- **Dependency-driven orchestration:** work stays serial when dependent and may
  use bounded `pipeline`, `fan-out/fan-in`, or `hierarchical` topologies only for
  genuinely independent scopes.
- **Capability-aware subagents:** the control plane assigns `scout`, `builder`,
  or `expert` tiers first, then resolves an optional concrete model from the
  active runtime's verified capabilities. Model IDs are never hard-coded.
- **Quality-preserving fan-in:** workers have explicit path ownership, checks,
  budgets, deadlines, and stop conditions; high-risk work and independent
  review stay on the expert tier.
- **Release evidence:** a shipped milestone records artifact identity,
  checksum, publish/deployment proof, telemetry and crash-reporting smoke
  evidence, rollback readiness, and a post-release checkpoint.

Start with the
[Game Studio workflow](workflows/game-studio-build.md) and use the
[control-plane protocol](skills/_shared/protocols/game-studio-pipeline.md) as
the source of truth for gates, role lanes, model-aware dispatch, and evidence.

---

## Architecture and Safety Model

The Forgewright pipeline revolves around predictable constraint enforcement, operating on a rigid loop designed to prevent AI hallucinations from polluting the main branch:
`INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN`

### Verification and Safety Layers

- **Evidence-Gated Logic**: The documented kernel workflow requires script-layer verification before a success claim. Enforcement is scoped to the declared runtime and tests in the [canonical-runtime ADR](docs/adr/0001-canonical-production-runtime.md); legacy paths are not represented as universally enforced.
- **Strict Guardrails**: Middleware behavior has local unit coverage on the MCP surface. The current production construction evidence does not establish that every legacy tool path traverses it; see the [conformance matrix](docs/adr/0001-canonical-production-runtime.md#claim-to-enforcement-conformance-matrix).
- **Execution Blockers**: When the AI encounters the same error multiple times, the orchestration kernel halts the active thread and forces a context reset, breaking infinite loops.
- **Visual Validation**: For UI changes, the AI must explicitly capture layout regressions and perform visual verification against established design tokens.

**[Read the Full Architecture Document ➔](docs/architecture.md)**

---

## Common Workflows

Forgewright automates extensive routine workflows via slash commands and integrated CLI tools.

### Generate a Project Profile

Once setup is complete, run the onboarding workflow to establish a baseline. In your AI chat, type:

```text
/onboard
```

*Creates a `.forgewright/project-profile.json` detailing your stack, coding conventions, and existing tech debt.*

For a deterministic, model-free CLI path, use `forge --json init .` followed by `forge --json onboard .`. The [CLI init/onboard golden-path guide](docs/guides/forge-init-onboard.md) documents idempotency, overwrite behavior, recorded facts, and the required under-ten-minute test.

### Parallel AI Worktrees

Run multiple tasks concurrently via the command line manager to speed up large refactors.

```bash
bash scripts/worktree-manager.sh --parallel 4 "build,test,deploy"
```

### Check Quality Gate Status

Score your repository health locally before committing changes to the main branch.

```bash
bash scripts/forge-validate.sh
```

### Sync Documentation to Shared Obsidian Wiki

Easily publish your architectural records to a centralized Obsidian vault for your team.

```bash
./scripts/forgewright-wiki-sync.sh
```

### Analyze Token Budget

Review your LLM expenditures and current usage limits.

```bash
forge token report --period week
```

---

## Troubleshooting and FAQ

### MCP server not responding in Cursor/Claude

- Restart your IDE completely. Ensure no background zombie node processes are locking the socket.
- Run `bash scripts/forgewright-mcp-setup.sh --force` to regenerate configuration files.
- Verify Node v18+ is installed via `node -v` and accessible in your default path.

### The GitNexus index is stale / Impact analysis fails

- Run `gitnexus analyze` manually in your terminal to refresh the static index, then retry the command in your IDE.

### How do I disable automatic memory persistence?

- You can clear your active context by running `bash scripts/memory-hygiene.sh` or deleting the `.forgewright/memory.db` file.

### The Orchestrator is stuck in a loop trying to fix a bug

- The ASIP protocol should catch this after 2-3 failures and enforce research. If it doesn't, tell the agent directly: `"Stop. Reset context and read the ASIP lessons."`

### Dependencies missing during parallel execution

- Ensure you have executed `npm install` inside the root workspace and that `.gitignore` permits sharing `node_modules` via symlink in the worktree configuration.

**[See Full Troubleshooting Guide ➔](docs/troubleshooting/common-issues.md)**

---

## Documentation Map

- **[Product Overview](docs/product-overview.md)**: Product capabilities and long-term vision.
- **[Architecture](docs/architecture.md)**: Deep dive into the orchestrator pipeline and safety model.
- **[Active Roadmap](docs/active-roadmap.md)**: Upcoming features and planned upgrades.
- **[Script Catalog](docs/reference/script-catalog.md)**: List of available utility scripts.
- **[Protocol Catalog](docs/reference/protocol-catalog.md)**: Standardized interaction models and constraints.
- **[Security Practices](.forgewright/security/README.md)**: Security scanner and vulnerability detection.
- **[Advanced Guides](docs/guides/gitnexus.md)**: Detailed instructions for GitNexus, parallel dispatch, and testing.
- **[ADR-010: Runtime Lifecycle Guard](docs/adr/ADR-010-runtime-lifecycle-guard.md)**: Port/process/disk reclamation across Claude, Codex and Antigravity.
- **[Changelog](CHANGELOG.md)**: Release history.

---

## Contributing, Support, License

**Contributing:**

We welcome contributions! Please check the [good first issues](https://github.com/buiphucminhtam/forgewright/issues) and read the contributor guidelines.

1. Fork the repo and create a branch.
2. Commit your changes via `git commit -m 'feat: description'`.
3. Open a Pull Request for review.

**Support & Analytics:**

If Forgewright has accelerated your workflow or saved your team time, consider supporting the project:

<p align="left">
  <img src="assets/donate/give-me-a-coffee-international.png" width="200" alt="Buy Me a Coffee" />
</p>

**License:**

Forgewright is released under the [MIT License](https://opensource.org/licenses/MIT).

<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
<!-- padding -->
