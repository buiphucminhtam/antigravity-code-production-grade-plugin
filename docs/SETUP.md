# ForgeWright MCP Setup Guide

> Complete guide to setting up ForgeWright MCP (Model Context Protocol) for your AI IDE.

## Table of Contents

- [Quick Start (5 minutes)](#quick-start-5-minutes)
- [Prerequisites](#prerequisites)
- [IDE-Specific Setup](#ide-specific-setup)
  - [Cursor](#cursor)
  - [Claude Desktop](#claude-desktop)
  - [Antigravity](#antigravity)
- [Commands Reference](#commands-reference)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## Quick Start (5 minutes)

### One-Command Setup

```bash
# Navigate to your project
cd /path/to/your/project

# Run the setup wizard
bash forgewright/scripts/forgewright-mcp-setup.sh wizard

# Or use quick setup (all defaults)
bash forgewright/scripts/forgewright-mcp-setup.sh setup
```

### Verify Installation

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh --check
```

Expected output:
```
━━━ MCP Status ━━━
  ➜ Project: /path/to/project
  ✓ Manifest: ✓
  ✓ ForgeWright Launcher: ✓
  ✓ GitNexus: ✓ (16K nodes indexed)
```

---

## Prerequisites

| Tool | Required | Version | Install |
|------|----------|---------|---------|
| Node.js | Yes | 20+ | [nodejs.org](https://nodejs.org) |
| npm | Yes | 8+ | Comes with Node.js |
| git | Recommended | Any | `brew install git` |

### Verify Prerequisites

```bash
node --version    # Should show v20+
npm --version     # Should show 8+
git --version     # Should show 2.x+
```

---

## IDE-Specific Setup

### Cursor

#### Option 1: Automated Setup (Recommended)

```bash
# From your project directory
cd /path/to/project
bash forgewright/scripts/forgewright-mcp-setup.sh setup
```

This automatically:
1. Creates `.antigravity/mcp-manifest.json`
2. Updates `~/.cursor/mcp.json`

#### Option 2: Manual Setup

1. Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forgewright": {
      "command": "bash",
      "args": ["/path/to/forgewright/scripts/forgewright-mcp-launcher.sh"]
    }
  }
}
```

**Note:** GitNexus MCP is configured separately via `gitnexus setup`.

2. Setup GitNexus separately:

```bash
npm install -g gitnexus
gitnexus setup
```

3. Restart Cursor

#### Verify Cursor Setup

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh --check
```

Look for:
```
  ➜ IDE: cursor
  ✓ Config: ✓
  ✓ ForgeWright: configured
```

---

### Claude Desktop

#### Option 1: Automated Setup (Recommended)

```bash
cd /path/to/project
bash forgewright/scripts/forgewright-mcp-setup.sh setup
```

#### Option 2: Manual Setup

1. Find your config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add forgewright server:

```json
{
  "mcpServers": {
    "forgewright": {
      "command": "bash",
      "args": ["/absolute/path/to/forgewright/scripts/forgewright-mcp-launcher.sh"]
    }
  }
}
```

3. Setup GitNexus separately:

```bash
npm install -g gitnexus
gitnexus setup
```

4. Restart Claude Desktop

#### Verify Claude Setup

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh --check
```

---

### Antigravity CLI

Antigravity CLI cũng dùng **canonical MCP server** tại `~/.forgewright/mcp-server/src/index.ts`. Không có server riêng cho Antigravity.

#### Canonical Server Rule

```
~/.forgewright/mcp-server/src/index.ts  ← CANONICAL (duy nhất, shared)
│
├── ~/.cursor/mcp.json              → Cursor points here
├── ~/.claude/settings.json        → Claude Code points here
└── ~/.cursor/projects/<hash>/mcps/user-forgewright/  → Antigravity reads manifest for CONTEXT, uses canonical server
```

**Điểm quan trọng:**
- `.antigravity/mcp-manifest.json` chỉ chứa **project context** (workspace path, forgewright path) — nó KHÔNG chứa server code riêng
- Antigravity launcher sử dụng `~/.forgewright/mcp-server/src/index.ts` — canonical server
- Manifest/isolation theo project chỉ để Antigravity biết workspace hiện tại, không override global server path

#### Automated Setup

```bash
cd /path/to/project
bash forgewright/scripts/forgewright-mcp-setup.sh --antigravity
```

Hoặc setup tất cả platforms cùng lúc:

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh
```

#### How It Works

```
Antigravity reads .antigravity/mcp-manifest.json
                    ↓
        Reads workspace path + forgewright path (CONTEXT ONLY)
                    ↓
        Starts forgewright-mcp-launcher.sh
                    ↓
        Launcher uses ~/.forgewright/mcp-server/src/index.ts (CANONICAL)
                    ↓
        MCP server starts with correct workspace context
```

#### Verify Antigravity Setup

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh --check
```

Expected output:
```
━━━ MCP Status (All Platforms) ━━━
  ➜ Project: /path/to/project

  ✓ Cursor: ~/.cursor/mcp.json
    forgewright: CONFIGURED
    gitnexus: CONFIGURED

  ✓ Claude Code: ~/.claude/settings.json
    forgewright: CONFIGURED
    gitnexus: CONFIGURED

  ➜ Antigravity:
    ✓ Server: ~/.cursor/projects/<hash>/mcps/user-forgewright/
    ✓ forgewright: CONFIGURED

  ✓ Manifest: /path/to/project/.antigravity/mcp-manifest.json
```

#### Manual Config (if needed)

Nếu cần config thủ công, launcher vẫn phải dùng canonical server:

```json
{
  "mcpServers": {
    "forgewright": {
      "command": "bash",
      "args": ["/path/to/forgewright/scripts/forgewright-mcp-launcher.sh"],
      "env": {
        "FORGEWRIGHT_WORKSPACE": "${workspaceFolder}"
      }
    }
  }
}
```

**⚠️ Never point Antigravity to a submodule Forgewright path.** Luôn dùng canonical server hoặc launcher đã được setup script configure đúng.

---

### OpenAI Codex CLI

Codex CLI cũng dùng **canonical MCP server** tại `~/.forgewright/mcp-server/src/index.ts`. Config file: `~/.codex/config.toml` (TOML format).

#### Canonical Server Rule

```
~/.forgewright/mcp-server/src/index.ts  ← CANONICAL (duy nhất, shared)
│
├── ~/.cursor/mcp.json              → Cursor
├── ~/.claude/settings.json        → Claude Code
├── ~/.codex/config.toml           → OpenAI Codex CLI
└── Antigravity project workspace   → Manifest provides context, server là canonical
```

#### Setup Command

```bash
# Codex CLI only
bash forgewright/scripts/forgewright-mcp-setup.sh --codex
```

Hoặc setup tất cả platforms cùng lúc:

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh
```

#### Verify Codex Setup

```bash
bash forgewright/scripts/forgewright-mcp-setup.sh --check
```

Hoặc dùng Codex CLI native:

```bash
codex mcp list
codex mcp get forgewright
```

Expected output trong config:
```toml
[mcp_servers.forgewright]
enabled = true
transport = { type = "stdio" }
command = "~/.forgewright/mcp-server/node_modules/.bin/tsx"
args = ["~/.forgewright/mcp-server/src/index.ts"]
env = { FORGEWRIGHT_WORKSPACE = "$PROJECT_ROOT" }

[mcp_servers.gitnexus]
enabled = true
transport = { type = "stdio" }
command = "gitnexus"
args = ["mcp"]
```

**Lưu ý:** Codex CLI chỉ hỗ trợ **STDIO transport** cho local servers. Remote MCP servers (HTTP/SSE) chưa được hỗ trợ.

---

## Multi-IDE Setup (Cursor + Claude + Antigravity + Codex)

If you use multiple AI IDEs with the same project, here's how it works:

### Architecture Overview

```
Project/
├── .antigravity/mcp-manifest.json    # Antigravity reads this
├── .forgewright/                    # Shared ForgeWright state
└── .gitnexus/                       # GitNexus code graph (index)

~/.cursor/mcp.json                   # Cursor MCP config
~/.claude/settings.json             # Claude Code MCP config
~/.codex/config.toml                 # OpenAI Codex CLI MCP config
~/.gitnexus/                         # GitNexus registry
~/.forgewright/mcp-server/           # CANONICAL MCP server (shared by all)
```

### Setup Steps

#### Step 1: Run Setup Once

```bash
cd /path/to/project
bash forgewright/scripts/forgewright-mcp-setup.sh setup
```

This creates the shared files:
- `.antigravity/mcp-manifest.json`
- `.forgewright/fw-mcp-launcher.sh`
- `.gitnexus/` (GitNexus code graph index)

#### Step 2: Restart All IDEs

```
1. Quit Cursor completely (Cmd+Q)
2. Quit Claude Desktop completely
3. Restart Antigravity (if running)
```

#### Step 3: Verify All IDEs

Each IDE will automatically detect the workspace and load the correct context.

### How Each IDE Loads MCP

| IDE | Config Location | Auto-Detection |
|-----|---------------|-----------------|
| **Cursor** | `~/.cursor/mcp.json` | Updated by `forgewright-mcp-setup.sh` |
| **Claude Desktop** | `~/.config/Claude/...` | Updated by `forgewright-mcp-setup.sh` |
| **Antigravity** | `.antigravity/` | Reads manifest automatically |

### Workspace Detection Per IDE

```
┌─────────────────────────────────────────────────────────────┐
│ Cursor                                                      │
│   ↓ ~/.cursor/mcp.json → forgewright-mcp-launcher.sh      │
│   ↓ Workspace: git rev-parse --show-toplevel               │
│   ↓ Project context loaded                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Claude Desktop                                              │
│   ↓ ~/.config/Claude/... → forgewright-mcp-launcher.sh    │
│   ↓ Workspace: git rev-parse --show-toplevel               │
│   ↓ Project context loaded                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Antigravity                                                 │
│   ↓ Reads .antigravity/mcp-manifest.json                   │
│   ↓ Sets FORGEWRIGHT_WORKSPACE env var                     │
│   ↓ forgewright-mcp-launcher.sh uses this env var          │
│   ↓ Project context loaded                                 │
└─────────────────────────────────────────────────────────────┘
```

### Benefits of Shared Setup

| Feature | Benefit |
|---------|---------|
| **Shared code graph** | `.gitnexus/` index works across all IDEs |
| **Shared manifest** | Antigravity auto-detects project |
| **Same launchers** | No duplicate configs to maintain |
| **Consistent context** | All IDEs see same project state |

### Switching Between IDEs

When you switch from one IDE to another:

1. **Workspace is preserved**: All IDEs use the same git root detection
2. **Code index is shared**: No need to re-index
3. **Context is consistent**: Same project files, same skills

### Testing Multi-IDE Setup

```bash
# Check which IDEs are configured
bash forgewright/scripts/forgewright-mcp-setup.sh --check

# Run diagnostics for detailed view
bash forgewright/scripts/forgewright-mcp-setup.sh --diagnose
```

---

## Commands Reference

### forgewright-mcp-setup.sh

Unified MCP setup for Cursor + Claude Code + Antigravity + OpenAI Codex CLI.

```bash
# Setup all platforms
bash forgewright/scripts/forgewright-mcp-setup.sh

# Setup individual platform
bash forgewright/scripts/forgewright-mcp-setup.sh --cursor
bash forgewright/scripts/forgewright-mcp-setup.sh --claude-code
bash forgewright/scripts/forgewright-mcp-setup.sh --antigravity
bash forgewright/scripts/forgewright-mcp-setup.sh --codex

# Force re-generate MCP server
bash forgewright/scripts/forgewright-mcp-setup.sh --force

# Status & diagnostics
bash forgewright/scripts/forgewright-mcp-setup.sh --check
bash forgewright/scripts/forgewright-mcp-setup.sh --diagnose

# Remove MCP setup from all platforms
bash forgewright/scripts/forgewright-mcp-setup.sh --uninstall

# Help
bash forgewright/scripts/forgewright-mcp-setup.sh --help
```

### GitNexus CLI

```bash
# Install
npm install -g gitnexus

# Setup for all editors
gitnexus setup

# Analyze project
gitnexus analyze

# Check status
gitnexus status

# Clean index
gitnexus clean

# List indexed repos
gitnexus list
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FORGEWRIGHT_WORKSPACE` | Override workspace detection | Auto-detected |
| `MCP_WORKSPACE_ROOT` | MCP standard workspace | Auto-detected |
| `FW_MCP_VERBOSE` | Enable debug output | 0 |
| `FW_MCP_FORCE` | Force operations | 0 |

### Debug Mode

```bash
# Enable verbose output
FW_MCP_VERBOSE=1 bash forgewright-mcp-setup.sh --diagnose

# Or use --verbose flag
bash forgewright-mcp-setup.sh --diagnose
```

---

## Troubleshooting

### MCP Server Not Starting

**Symptoms:** Tools not appearing in IDE

**Solutions:**

1. Check status:
   ```bash
   bash forgewright-mcp-setup.sh --check
   ```

2. Run diagnostics:
   ```bash
   bash forgewright-mcp-setup.sh --diagnose
   ```

3. Restart IDE

4. Check logs in IDE console

### Windows Compatibility (Path & TSX Errors)

On Windows, path structures and command execution differ from macOS. If you encounter errors like `ERR_MODULE_NOT_FOUND` or executables not found:

1. **GitNexus Path (Global)**: 
   - **macOS**: Typically `/opt/homebrew/bin/gitnexus` or `~/.local/bin/gitnexus`.
   - **Windows**: Use `"gitnexus"` (if in PATH) or absolute node path like `"C:/Users/<YourUsername>/AppData/Roaming/npm/node_modules/gitnexus/dist/cli/index.js"` with `"command": "node"`.

2. **TypeScript Execution (tsx)**:
   - Avoid using bash-style paths `/c/Users/...` directly as the executable `command` on Windows.
   - Instead, configure the server to run with `"command": "npx"` and `"args": ["tsx", "C:/Users/<YourUsername>/.forgewright/mcp-server/src/index.ts"]`.

3. **Claude Code Hooks**:
   - For Windows environments, prefix hook script paths with `bash` to ensure they execute correctly under non-POSIX shells:
     ```json
     "hooks": {
       "PostMessage": "bash D:/path/to/forgewright/scripts/forgewright-memory-hook.sh tick",
       "PostToolUse": "bash D:/path/to/forgewright/scripts/forgewright-memory-hook.sh checkpoint"
     }
     ```

4. **OpenAI Codex CLI (`config.toml` on Windows)**:
   - Ensure the TOML configurations use Windows paths and native tools:
     ```toml
     [mcp_servers.forgewright]
     enabled = true
     transport = { type = "stdio" }
     command = "npx"
     args = ["tsx", "C:/Users/<YourUsername>/.forgewright/mcp-server/src/index.ts"]

     [mcp_servers.gitnexus]
     enabled = true
     transport = { type = "stdio" }
     command = "node"
     args = ["C:/Users/<YourUsername>/AppData/Roaming/npm/node_modules/gitnexus/dist/cli/index.js", "mcp"]
     ```

5. **Antigravity CLI & App (`mcp_config.json` on Windows)**:
   - Ensure both `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-cli/mcp_config.json` configure the servers correctly:
     ```json
     "forgewright": {
       "command": "npx",
       "args": [
         "tsx",
         "C:/Users/<YourUsername>/.forgewright/mcp-server/src/index.ts"
       ]
     },
     "gitnexus": {
       "command": "node",
       "args": [
         "C:/Users/<YourUsername>/AppData/Roaming/npm/node_modules/gitnexus/dist/cli/index.js",
         "mcp"
       ]
     }
     ```

### Workspace Detection Issues

**Symptoms:** Wrong project context

**Solutions:**

1. Set workspace explicitly:
   ```bash
   export FORGEWRIGHT_WORKSPACE=/path/to/project
   bash forgewright-mcp-setup.sh --check
   ```

2. Run from project directory:
   ```bash
   cd /path/to/project
   bash forgewright-mcp-setup.sh --check
   ```

### GitNexus Index Stale

**Symptoms:** Query returns old/outdated results

**Solution:**
```bash
# Re-analyze with GitNexus
gitnexus analyze --force
```

### Launcher Script Not Found

**Symptoms:** `launcher.sh not found` error

**Solution:** Re-run setup:
```bash
bash forgewright-mcp-setup.sh setup --force
```

### npm Install Failures

**Symptoms:** Dependencies not installing

**Solutions:**

1. Clear npm cache:
   ```bash
   npm cache clean --force
   ```

2. Use offline mode:
   ```bash
   npm install --prefer-offline
   ```

3. Check npm version:
   ```bash
   npm --version  # Should be 8+
   ```

---

## FAQ

### Q: What's the difference between ForgeWright and GitNexus?

**A:**
- **ForgeWright** provides project intelligence, skills, and orchestration
- **GitNexus** provides code graph, context analysis, and impact detection

Both work together. You typically need both.

### Q: Can I use just GitNexus without ForgeWright?

**A:** Yes. Run:
```bash
npm install -g gitnexus
gitnexus setup
```

### Q: How do I update ForgeWright MCP?

**A:**
```bash
cd forgewright
git pull origin main
bash scripts/forgewright-mcp-setup.sh setup --force
```

### Q: Multiple projects - do I need separate configs?

**A:** No! With Antigravity, one config works for all projects. With Cursor/Claude, launchers auto-detect workspace from git root.

### Q: What if I use VS Code?

**A:** VS Code has MCP support but it's preview. For now, use Cursor or Claude Desktop for best experience.

### Q: How do I uninstall MCP?

**A:**
```bash
bash forgewright-mcp-setup.sh --uninstall
```

### Q: Can I use ForgeWright with multiple IDEs simultaneously?

**A:** Yes! Setup once, use everywhere:

```bash
# Setup once
bash forgewright/scripts/forgewright-mcp-setup.sh setup

# Restart all IDEs (Cursor + Claude Desktop + Antigravity)
# They all share the same:
#   - .antigravity/mcp-manifest.json
#   - .forgewright/ (state)
#   - .gitnexus/ (code graph)
```

See [Multi-IDE Setup](#multi-ide-setup-cursor--claude--antigravity) section above for details.

### Q: Where is my data stored?

**A:**
- **Manifest**: `.antigravity/mcp-manifest.json`
- **GitNexus Index**: `.gitnexus/` (in project directory)
- **GitNexus Registry**: `~/.gitnexus/registry.json`
- **Settings**: `.forgewright/settings.env`

All are in your project directory and can be committed to git.

---

## Support

- **GitHub Issues**: [Report bugs](https://github.com/buiphucminhtam/forgewright/issues)
- **Documentation**: [docs/SETUP-REFERENCE.md](SETUP-REFERENCE.md)

---

## See Also

- [Quick Start Guide](SETUP-QUICK.md) - Fast 1-minute setup
- [Technical Reference](SETUP-REFERENCE.md) - Detailed technical docs
- [GitNexus Setup](SETUP-GITNEXUS.md) - Code intelligence setup guide
