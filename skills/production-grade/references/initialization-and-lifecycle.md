# Initialization and Session Lifecycle Reference

<!-- source: skills/production-grade/references/initialization-and-lifecycle.md -->

## Auto-Initialization Check

Run silently BEFORE any execution (all modes) to ensure project intelligence is fully configured.

**Step 0.1 — GitNexus + MCP Check:**

1. Check if `.antigravity/mcp-manifest.json` exists and is current in the project root.
2. **If missing or stale**, run ONE command to set up everything:

   **Detect forgewright path first**, then run:

   ```bash
   # If forgewright is a submodule in the project:
   bash <project-root>/forgewright/scripts/forgewright-mcp-setup.sh

   # If forgewright IS the project:
   bash scripts/forgewright-mcp-setup.sh

   # For Antigravity plugin users (universal, works from any project):
   bash <forgewright>/.antigravity/plugins/production-grade/scripts/forgewright-mcp-setup.sh
   ```

   This single command:
   - Analyzes the project (GitNexus index via `gitnexus analyze`)
   - Generates the MCP server
   - Creates the workspace manifest
   - Updates global config (Cursor/Claude)
   - Verifies installation

3. **GitNexus Setup** (if not already done):
   ```bash
   npm install -g gitnexus
   gitnexus setup  # Auto-configures all editors
   ```

4. After setup, yield a brief message:
   `ℹ MCP server ready for this workspace. Restart your AI client to activate.`

5. **If already set up**, continue normally.

**Step 0.2 — System Requirements + Power Level Check (required):**

Forgewright requires **Node.js 22+** (GitNexus/MCP runtime) and **Python 3** (local memory). Power level determines which tools are needed.

**Step 0.2.1 — System Requirements Check:**

Run these in parallel:

```
node_check:  node --version 2>/dev/null | grep -oE '[0-9]+' | head -1
python_check: python3 --version 2>/dev/null
memory_check:  [ -d .forgewright/memory_db ] && echo "ready" || echo "setup"
settings_check: [ -f .forgewright/settings.md ] && echo "exists" || echo "missing"
```

**Decision matrix:**

| node | python | memory | Action |
|------|--------|--------|--------|
| ≥18 | ≥3.8 | ready | ✅ Full Persistent — continue to Step 0.3 |
| ≥18 | ≥3.8 | setup | ⧖ Memory setup needed — run memory-local.sh |
| ≥18 | missing | — | ⚠️ Python missing — stop, tell user install Python 3 |
| <22 | — | — | ⚠️ Node.js <22 — stop, tell user upgrade Node.js |
| missing | — | — | ⚠️ Node.js missing — stop, tell user install Node.js 22+ |

**If Node.js or Python missing (blocking):**
```
notify_user:
  "⚠️ Missing required tools for Forgewright:

   Node.js 22+ required for: GitNexus code intelligence, MCP server
   Python 3.8+ required for: Local memory (ChromaDB + sentence-transformers)

   How to install:
   macOS:  brew install node python3
   Linux:  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs python3
   Windows: Download from nodejs.org + python.org

   After installing, re-run your request."
  Options:
  > "I'll install and try again (Recommended)"
  > "Chat about this"
```

**If memory needs setup (non-blocking):**
```
# Run silently
bash <path-to-forgewright>/scripts/memory-local.sh "$(pwd)" 2>/dev/null

# If failed (no python3)
Log: "⚠️ Memory init failed — install Python 3 first. Forcing: FORGEWRIGHT_SKIP_MEMORY=1"
# CI/headless exemption auto-applied
```

**If all requirements met:**
```
Log: "✓ System requirements verified:
  - Node.js: [version] ✓
  - Python 3: [version] ✓
  - Memory: [ready/setup needed] ✓"
```

**Step 0.2.2 — Power Level Check:**

```
IF .forgewright/settings.md exists:
  Read engagement + execution from settings
  Log: "✓ Power level loaded: [level]"
  Continue to Step 0.3
ELSE:
  # First-time setup — ask user
  Log: "⧖ Power level not set — prompting user"
```

**Prompt for power level (only if settings missing):**
```
notify_user:
  "Forgewright has 5 power levels. Choose based on how much capability you need:

  ⚡ Basic       — manifest-driven skill registry + proportional pipeline (Node.js only)
  ⚡⚡ Smart     — + GitNexus blast-radius analysis (Node.js only)
  ⚡⚡⚡ Persistent — + Local memory with ChromaDB (Node.js + Python 3)
  ⚡⚡⚡⚡ Research  — + NotebookLM grounded research (optional)
  ⚡⚡⚡⚡⚡ Full Power — All of the above + crawl4ai, Midscene, Paperclip

  Which level?"
  Options:
  > "⚡⚡⚡ Persistent (Recommended) — Standard for active projects"
  > "⚡⚡⚡⚡⚡ Full Power — Maximum capability"
  > "⚡⚡ Smart — Code intelligence without memory"
  > "⚡ Basic — Just the pipeline"
  > "Chat about this"
```

**After user selects:**

```
IF Full Power:
  Log: "✓ Power level: Full Power"
  # Prompt user about optional Full Power tools (required acknowledgment)
  notify_user:
    "⚡ Full Power selected! You have everything you need:

     MANDATORY (auto-verified): Node.js 22+, Python 3.8+, local memory ✓

     OPTIONAL — install anytime to unlock more capability:

     📚 Research Mode
        pip install notebooklm-mcp
        (Grounded AI with zero hallucinations, citations from your sources)

     🌐 Web Intelligence
        pip install crawl4ai>=0.8.0
        (Scrape & crawl any website for RAG or research)

     📱 Mobile Testing
        npm install -g @anthropic-ai/midscene
        (AI-powered UI testing on real Android/iOS devices)

     Which optional tools would you like to install now?"
    Options:
    > "Install all optional tools now (Recommended)"
    > "Install [specific tool] only — I'll do others later"
    > "Skip — I'll install manually later"
    > "Chat about this"

  IF user selects "Install all":
    Log: "Installing optional Full Power tools..."
    # Try pip tools first (each tool independently — if one fails, continue others)
    Run: pip install notebooklm-mcp 2>/dev/null && Log: "  ✓ notebooklm-mcp" || Log: "  ⚠ notebooklm-mcp skipped (pip error)"
    Run: pip install crawl4ai>=0.8.0 2>/dev/null && Log: "  ✓ crawl4ai" || Log: "  ⚠ crawl4ai skipped (pip error)"
    # npm tool last (requires node)
    Run: npm install -g @anthropic-ai/midscene 2>/dev/null && Log: "  ✓ Midscene" || Log: "  ⚠ Midscene skipped (npm error)"
    # Verify which tools are now importable / executable
    Run: python3 -c "import notebooklm_mcp" 2>/dev/null && npb="✓" || npb="⚠"
    Run: python3 -c "import crawl4ai" 2>/dev/null && crw="✓" || crw="⚠"
    Run: which midscene >/dev/null 2>&1 && mids="✓" || mids="⚠"
    Log: "✓ Optional tools status: notebooklm-mcp [$npb]  crawl4ai [$crw]  Midscene [$mids]"
    Log: "  Full install commands (if any skipped):"
    Log: "    pip install notebooklm-mcp crawl4ai>=0.8.0"
    Log: "    npm install -g @anthropic-ai/midscene"
  IF user selects specific tool:
    Log: "Installing [selected tool]..."
    Run: [corresponding install command]
    Log: "✓ [tool] installed"
  IF user selects skip:
    Log: "⧖ Optional tools deferred — run install commands manually when ready"

IF Research:
  Log: "✓ Power level: Research"
  Log: "Optional: pip install notebooklm-mcp"

IF Persistent:
  Log: "✓ Power level: Persistent — Local memory ready"

IF Smart:
  Log: "✓ Power level: Smart — GitNexus ready"

IF Basic:
  Log: "✓ Power level: Basic"
```

**Write settings file:**

```bash
mkdir -p .forgewright production
cat > .forgewright/settings.md << 'EOF'
# Pipeline Settings
Power_Level: [selected]
Engagement: [express/standard/thorough/meticulous — default: standard]
Execution: [parallel/sequential — default: parallel]
Review_Mode: [full/lean/solo — default: lean]
EOF
```

**Review Mode Configuration:**

Follow `skills/_shared/protocols/review-intensity.md` for review mode selection:
- **Full** — Director specialists review at every step
- **Lean** (default) — Reviews only at phase gate transitions
- **Solo** — No reviews, maximum speed

```bash
mkdir -p production
echo "lean" > production/review-mode.txt
```

User can override per-invocation with `--review [mode]` flag.

**Log checkpoint:**
```
Log: "✓ System init complete:
  - Node.js: [version] ✓
  - Python 3: [version] ✓
  - Memory: [ready] ✓
  - Power level: [level] ✓
  - Review mode: [mode] ✓
  - Settings: written to .forgewright/settings.md"
```

## Auto-Update Check

Run BEFORE any execution (all modes). Silent if current. One prompt max if update exists.

**Step 0 — version check:**

1. Check current version from plugin metadata
2. Use `read_url_content` to fetch `https://raw.githubusercontent.com/buiphucminhtam/forgewright/main/VERSION` → read the version string (this is the remote version)
3. **If fetch fails** (offline, timeout, 404) → silently continue. Never block the pipeline over an update check.
4. **If remote ≤ local** → continue silently (user sees nothing)
5. **If remote > local** → prompt via notify_user:

```
production-grade v{remote} is available (you have v{local})

Update now?
1. **Yes (Recommended)** — download and install immediately
2. **Later** — continue with current version
3. **Show changelog** — read CHANGELOG.md first
4. **Chat about this**
```

**If user selects Yes:**
- Fetch the repository zip / source files
- Copy updated files to the skills directory
- Clean up: `rm -rf /tmp/pg-update`
- Print: `✓ Updated to v{remote_version}. Re-invoke /production-grade to use the new version.`
- **STOP** — do not continue pipeline. The user must re-invoke to pick up new content.

**If any update step fails**, print a warning and continue with the current version. Never let the updater break the pipeline.

## Session Lifecycle Pre-Flight

Run AFTER update check, BEFORE mode classification. Follows `skills/_shared/protocols/session-lifecycle.md`.

**Step 0.5 — session start:**

1. **Load project profile:**
   - If `.forgewright/project-profile.json` exists and is fresh (<24h) → load context, skip re-onboarding
   - If stale → re-run health check only (project-onboarding Phase 2)
   - If missing → run full project onboarding (see `skills/_shared/protocols/project-onboarding.md`)

2. **Load last session state:**
   - If `.forgewright/session-log.json` exists with interrupted session → offer resume via notify_user
   - If last session completed → log summary, continue to new request
   - If first session → continue normally

3. **Load memory context (required for Persistent power level — Step 0.2):**
   - Run `bash <path-to-forgewright>/scripts/memory-retrieve.sh "<user-request>"` OR
   - Run `python3 <path-to-forgewright>/scripts/mem0-v2.py search "<project-name> <user-request-keywords>" --limit 5`
   - Also load:
     - `.forgewright/subagent-context/CONVERSATION_SUMMARY.md`
     - `.forgewright/memory-bank/activeContext.md`
     - `.forgewright/business-analyst/handoff/ba-package.md` (if exists)

4. **Detect manual changes:**
   - If git available → check commits since last session
   - If structural changes detected → re-run onboarding fingerprint + patterns

5. **Display quality trend** (if history exists):
   - Read `.forgewright/quality-history.json` → show trend of last 5 sessions

Log: `✓ Session context loaded — [project name], last session: [summary or "first session"]`

**Step 0.6 — Cursor Subagent Context Preparation:**

Run AFTER session context is loaded, AFTER chat-interpreter (Step -1), BEFORE any skill or phase execution. This ensures subagents have clean, bounded context.

1. **Ensure subagent context directory exists:**
   ```
   mkdir -p .forgewright/subagent-context/
   ```

2. **Read chat-interpreter output when present:**
   ```
   Read .forgewright/subagent-context/INTERPRETED_REQUEST.md
   → Treat it as a bounded derived handoff/cache.
   → The latest user instruction remains authoritative for intent; current workspace/runtime evidence remains authoritative for project state.
   → If the cache conflicts with either, re-interpret and refresh it before delegating.
   ```

3. **Write PIPELINE_SUMMARY.md** (refresh for each new phase):
   - Read `.forgewright/project-profile.json` if exists
   - Read current phase status from `.forgewright/task.md`
   - Read approved architecture from `docs/architecture/` (if exists)
   - Read BRD summary from `product-manager/BRD/` (if exists)
   - Compress to ≤ 2,000 tokens
   - Write to `.forgewright/subagent-context/PIPELINE_SUMMARY.md`

4. **Write REVIEWER_CONTRACT.md** (per-review, generated dynamically):
   ```
   For each review task, write:
   - REVIEWER_CONTRACT.md with scope, acceptance criteria, forbidden paths
   - Reference: .forgewright/subagent-context/REVIEWER_CONTRACT_TEMPLATE.md
   ```

5. **Update SECURITY_STANDARDS.md** (refresh for HARDEN phase):
   - Run security-engineer skill output through SECURITY_STANDARDS template
   - Write to `.forgewright/subagent-context/SECURITY_STANDARDS.md`

6. **Log:**
   ```
   ✓ Subagent context prepared — [N] files in .forgewright/subagent-context/
   ```

**Cursor Subagent Invocation Convention:**

When invoking a Cursor subagent, use the exact pattern below:

```
Invoke: /[subagent-name] [task context]
Example: /verifier Review the T3a backend services delivery
Example: /spec-reviewer Check T3b frontend against CONTRACT.json
Example: /quality-reviewer Assess T3a services code quality
Example: /security-auditor Perform read-only OWASP audit on T3a auth code
```

**Built-in Cursor EXPLORE subagent** (automatic, no explicit invocation needed):

The Cursor built-in `explore` subagent runs 10 parallel searches simultaneously using a fast model. This is automatically used by Cursor's Agent for context-heavy exploration. In the DEFINE phase (Step 4: Codebase Discovery), use natural language and the explore subagent handles parallel search automatically — you do NOT need to manually invoke it.

**Available Cursor Subagents:**

| Subagent | Model | Best For | Invocation |
|----------|-------|---------|-----------|
| `chat-interpreter` | fast | Translates chat to structured request | `/chat-interpreter [message]` |
| `explore` | fast (built-in) | 10 parallel codebase searches | Automatic (Cursor Agent) |
| `verifier` | fast | Confirm deliverables actually work | `/verifier [task]` |
| `spec-reviewer` | fast | Verify spec compliance | `/spec-reviewer [task]` |
| `quality-reviewer` | inherit | Deep quality/architecture review | `/quality-reviewer [task]` |
| `security-auditor` | inherit | OWASP read-only audit | `/security-auditor [task]` |
