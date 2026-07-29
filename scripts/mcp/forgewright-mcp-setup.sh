#!/usr/bin/env bash
# =============================================================================
# forgewright-mcp-setup — Universal MCP Setup (Cursor + Claude Code + Antigravity + Codex + Gemini + Zed + OpenCode + Qwen Code)
#
# Single command to set up Forgewright MCP for ALL AI clients simultaneously.
# Works for Cursor, Claude Code, Antigravity, OpenAI Codex CLI, Google Gemini CLI, Zed AI, OpenCode, and Qwen Code.
#
# USAGE:
#   bash forgewright/scripts/forgewright-mcp-setup.sh
#
# OPTIONS:
#   --check       Check MCP status across all platforms
#   --cursor      Setup Cursor only
#   --claude-code Setup Claude Code only
#   --antigravity Setup Antigravity only
#   --codex       Setup OpenAI Codex CLI only
#   --gemini      Setup Google Gemini CLI only
#   --zed         Setup Zed AI only
#   --opencode    Setup OpenCode only
#   --all         Setup all platforms (default)
#   --force       Re-generate even if already set up
#   --uninstall   Remove MCP setup from all platforms
#   --diagnose    Show detailed diagnostics
#   --help        Show this help
#
# CONFIG PATHS:
#   Cursor:       ~/.cursor/mcp.json
#   Claude Code:  ~/.claude.json
#   Antigravity:  ~/.cursor/projects/<hash>/mcps/<server>/tools/*.json
#   Codex CLI:    ~/.codex/config.toml
#   Gemini CLI:   ~/.gemini/settings.json
#   Zed AI:      ~/Library/Application Support/Zed/settings.json (macOS)
#                ~/.config/zed/settings.json (Linux)
#   OpenCode:    ${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json
# =============================================================================

set -euo pipefail

# ─── Detect Forgewright Location ────────────────────────────────────────────────

declare FORGEWRIGHT_DIR=""
declare FORGEWRIGHT_IS_PROJECT="false"

detect_forgewright() {
    local script_path="${BASH_SOURCE[0]}"
    local resolved

    if [[ "$script_path" == /* ]]; then
        resolved="$(cd "$(dirname "$script_path")" && pwd -P)"
    else
        resolved="$(cd "$PWD" && cd "$(dirname "$script_path")" && pwd -P)"
    fi

    # If this script is in scripts/ under Antigravity plugin
    if [[ "$resolved" == */.antigravity/plugins/production-grade/scripts ]]; then
        local plugin_root="$(dirname "$(dirname "$(dirname "$resolved")")")"
        local current="$plugin_root"
        local found_forgewright=""
        while [[ "$current" != "/" ]] && [[ "$current" != "$HOME" ]]; do
            if [[ -d "${current}/forgewright" ]]; then
                found_forgewright="${current}/forgewright"
                break
            fi
            if [[ -f "${current}/AGENTS.md" ]] || [[ -f "${current}/CLAUDE.md" ]]; then
                found_forgewright="$current"
                break
            fi
            current="$(dirname "$current")"
        done

        if [[ -n "$found_forgewright" ]]; then
            FORGEWRIGHT_DIR="$found_forgewright"
            [[ "$found_forgewright" == "$plugin_root" ]] && FORGEWRIGHT_IS_PROJECT="true" || FORGEWRIGHT_IS_PROJECT="false"
        else
            FORGEWRIGHT_DIR="$plugin_root"
            FORGEWRIGHT_IS_PROJECT="false"
        fi
    elif [[ "$resolved" == */scripts/mcp ]]; then
        # Canonical repository layout after the script migration:
        # FORGEWRIGHT_ROOT/scripts/mcp/forgewright-mcp-setup.sh
        local possible_fw="$(dirname "$(dirname "$resolved")")"
        FORGEWRIGHT_DIR="$possible_fw"
        if [[ -f "${possible_fw}/AGENTS.md" ]] || [[ -f "${possible_fw}/CLAUDE.md" ]]; then
            FORGEWRIGHT_IS_PROJECT="true"
        else
            FORGEWRIGHT_IS_PROJECT="false"
        fi
    elif [[ "$resolved" == */scripts ]]; then
        local possible_fw="$(dirname "$resolved")"
        FORGEWRIGHT_DIR="$possible_fw"
        if [[ -f "${possible_fw}/AGENTS.md" ]] || [[ -f "${possible_fw}/CLAUDE.md" ]]; then
            FORGEWRIGHT_IS_PROJECT="true"
        else
            local current="$possible_fw"
            while [[ "$current" != "/" ]] && [[ "$current" != "$HOME" ]]; do
                if [[ -f "${current}/AGENTS.md" ]] || [[ -f "${current}/CLAUDE.md" ]]; then
                    FORGEWRIGHT_DIR="$current"
                    FORGEWRIGHT_IS_PROJECT="true"
                    break
                fi
                [[ -d "${current}/.git" ]] && FORGEWRIGHT_IS_PROJECT="true" && break
                current="$(dirname "$current")"
            done
            [[ "$FORGEWRIGHT_IS_PROJECT" != "true" ]] && FORGEWRIGHT_IS_PROJECT="false"
        fi
    else
        FORGEWRIGHT_DIR="$(dirname "$resolved")"
        FORGEWRIGHT_IS_PROJECT="false"
    fi
}

detect_actual_project_root() {
    local pwd_root git_root superproject
    pwd_root="$(pwd -P)"

    if git_root="$(git -C "$pwd_root" rev-parse --show-toplevel 2>/dev/null)"; then
        while superproject="$(git -C "$git_root" rev-parse --show-superproject-working-tree 2>/dev/null || true)" && \
            [[ -n "$superproject" ]]; do
            git_root="$(cd "$superproject" && pwd -P)"
        done
        printf '%s\n' "$(cd "$git_root" && pwd -P)"
        return
    fi

    echo "$pwd_root"
}

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_step()  { echo -e "${BLUE}  ➜${NC} $1"; }
log_ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
log_warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
log_error() { echo -e "${RED}  ✗${NC} $1"; }
log_info()  { echo -e "  $1"; }

# ─── CLI Args ────────────────────────────────────────────────────────────────

show_help() {
    cat << 'EOF'
forgewright-mcp-setup — Universal MCP Setup (Cursor + Claude Code + Antigravity + Codex + Gemini + Zed + OpenCode + Qwen Code)

USAGE:
  forgewright-mcp-setup.sh [OPTIONS]

OPTIONS:
  --all         Setup all platforms (Cursor + Claude Code + Antigravity + Codex + Gemini + Zed + OpenCode + Qwen Code) [DEFAULT]
  --cursor      Setup Cursor MCP only
  --claude-code Setup Claude Code MCP only
  --claude-desktop Setup Claude Desktop MCP only
  --antigravity Setup Antigravity MCP only
  --codex       Setup OpenAI Codex CLI MCP only
  --gemini      Setup Google Gemini CLI MCP only
  --zed         Setup Zed AI MCP only
  --opencode    Setup OpenCode MCP only
  --qwen        Setup Qwen Code MCP only
  --check       Check MCP status across all platforms
  --force       Re-generate even if already set up
  --uninstall   Remove MCP setup from all platforms
  --diagnose    Show detailed diagnostics
  --help        Show this help

PLATFORMS:
  Cursor        ~/.cursor/mcp.json
  Claude Code   ~/.claude.json  (mcpServers key)
  Antigravity   ~/.cursor/projects/<hash>/mcps/user-forgewright/
  Codex CLI     ~/.codex/config.toml
  Gemini CLI    ~/.gemini/settings.json
  Zed AI       ~/Library/Application Support/Zed/settings.json (macOS)
               ~/.config/zed/settings.json (Linux)
  OpenCode     ${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json
  Qwen Code    ~/.qwen/settings.json

EXAMPLES:
  # Setup all platforms
  forgewright-mcp-setup.sh

  # Check status
  forgewright-mcp-setup.sh --check

  # Setup Claude Code only
  forgewright-mcp-setup.sh --claude-code

  # Setup Claude Desktop only
  forgewright-mcp-setup.sh --claude-desktop

  # Setup Antigravity only
  forgewright-mcp-setup.sh --antigravity

  # Setup OpenAI Codex CLI only
  forgewright-mcp-setup.sh --codex

  # Setup Google Gemini CLI only
  forgewright-mcp-setup.sh --gemini

  # Setup Zed AI only
  forgewright-mcp-setup.sh --zed

  # Setup OpenCode only
  forgewright-mcp-setup.sh --opencode

  # Setup Qwen Code only
  forgewright-mcp-setup.sh --qwen
EOF
}

# ─── Prerequisite Checks ────────────────────────────────────────────────────────

node_version_is_supported() {
    local version="${1#v}" major minor patch
    IFS=. read -r major minor patch <<< "$version"
    patch="${patch%%[^0-9]*}"
    [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] && \
        [[ "$patch" =~ ^[0-9]+$ ]] || return 1
    ((major >= 20))
}

check_prerequisites() {
    log_step "Checking prerequisites..."

    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Install Node.js >= 20.0.0:"
        log_info "  macOS: brew install node"
        exit 1
    fi

    local node_version
    node_version="$(node -v)"
    if ! node_version_is_supported "$node_version"; then
        log_error "Node.js version too old (found $node_version, need >=20.0.0)"
        exit 1
    fi
    log_ok "Node.js $(node -v)"

    if ! command -v python3 &>/dev/null; then
        log_error "python3 is required for locking, TOML parsing, and atomic publication"
        exit 1
    fi
    if ! python3 - <<'PY'
import sys
import tomllib
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
    then
        log_error "Python 3.11+ with tomllib is required"
        exit 1
    fi
    log_ok "Python $(python3 --version 2>&1)"

    if ! check_atomic_exchange_support; then
        log_error "Canonical runtime cannot be updated atomically on this system"
        exit 1
    fi
    log_ok "Atomic directory exchange"

    # Check for MCP server generation script (optional)
    local script_dir
    script_dir="$(dirname "${BASH_SOURCE[0]}")"
    if [[ -f "${script_dir}/mcp-generate.sh" ]]; then
        log_ok "MCP generation script found"
    else
        log_warn "MCP generation script not found (will use existing src/index.ts)"
    fi
    log_ok "Forgewright found at $FORGEWRIGHT_DIR"
}

# ─── Platform Detection ─────────────────────────────────────────────────────────

# Detect which platforms are available/installed
detect_platforms() {
    local cursor_config="$HOME/.cursor/mcp.json"
    local claude_config="$HOME/.claude.json"

    PLATFORM_CURSOR="false"
    PLATFORM_CLAUDE_CODE="false"
    PLATFORM_ANTIGRAVITY="false"
    PLATFORM_CODEX="false"

    # Cursor: ~/.cursor/mcp.json exists and is readable
    if [[ -f "$cursor_config" ]] && grep -q "cursor" "$cursor_config" 2>/dev/null; then
        PLATFORM_CURSOR="true"
    elif [[ -d "$HOME/.cursor" ]]; then
        PLATFORM_CURSOR="true"
    fi

    # Claude Code: ~/.claude.json exists and is readable
    if [[ -f "$claude_config" ]]; then
        PLATFORM_CLAUDE_CODE="true"
    elif command -v claude &>/dev/null; then
        PLATFORM_CLAUDE_CODE="true"
    fi

    # Antigravity: MCP project folder exists
    if [[ -d "$HOME/.cursor/projects" ]]; then
        local ag_count
        ag_count=$(find "$HOME/.cursor/projects" -name "SERVER_METADATA.json" -path "*user-forgewright*" 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$ag_count" -gt 0 ]]; then
            PLATFORM_ANTIGRAVITY="true"
        fi
    fi

    # Codex CLI: ~/.codex/config.toml exists
    if [[ -f "$HOME/.codex/config.toml" ]]; then
        PLATFORM_CODEX="true"
    elif command -v codex &>/dev/null; then
        PLATFORM_CODEX="true"
    fi

    # Qwen Code: ~/.qwen/settings.json exists or qwen CLI is available
    if [[ -f "$HOME/.qwen/settings.json" ]] || command -v qwen &>/dev/null; then
        PLATFORM_QWEN="true"
    fi
}

# ─── Step 1: Generate MCP Server ───────────────────────────────────────────────

setup_mcp_server() {
    log_step "Generating MCP server..."
    local script_dir
    script_dir="$(dirname "${BASH_SOURCE[0]}")"

    if [[ -f "${script_dir}/mcp-generate.sh" ]]; then
        if FORGEWRIGHT_DIR_OVERRIDE="$FORGEWRIGHT_DIR" PROJECT_ROOT_OVERRIDE="$PROJECT_ROOT" \
            bash "${script_dir}/mcp-generate.sh"; then
            log_ok "MCP server generated"
        else
            log_error "Failed to generate MCP server"
            exit 1
        fi
    else
        log_warn "mcp-generate.sh not found, skipping regeneration (using existing src/index.ts)"
    fi

    # Copy launcher scripts to FORGEWRIGHT_DIR/scripts/
    mkdir -p "${FORGEWRIGHT_DIR}/scripts"
    if cp "${script_dir}/forgewright-mcp-launcher.sh" "${FORGEWRIGHT_DIR}/scripts/" 2>/dev/null; then
        chmod +x "${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh"
        log_ok "Copied forgewright-mcp-launcher.sh"
    fi
}

# ─── Canonical MCP Server ─────────────────────────────────────────────────────
# The canonical MCP server lives at ~/.forgewright/mcp-server/
# ALL global configs (Cursor, Claude Code) MUST point here — NEVER a submodule path.
# Submodule projects get their own .antigravity/mcp-manifest.json but the server
# they reference is always the canonical ~/.forgewright/mcp-server/src/index.ts.

CANONICAL_SERVER_DIR="$HOME/.forgewright/mcp-server"
CANONICAL_SERVER_TS="$CANONICAL_SERVER_DIR/src/index.ts"
CANONICAL_TSX="$CANONICAL_SERVER_DIR/node_modules/.bin/tsx"
INSTALLATION_OWNER_FILE="$HOME/.forgewright/.mcp-server-installation.json"
INSTALLATION_OWNER_MARKER=".forgewright-installation-owner.json"
INSTALLATION_OWNER_VERSION="1"
TRANSACTION_JOURNAL="$HOME/.forgewright/.mcp-setup-transaction.json"
TRANSACTION_DIR=""
TRANSACTION_ACTIVE="false"
TRANSACTION_TOKEN=""
TRANSACTION_MARKER=".forgewright-transaction-owner"
declare -a TRANSACTION_LOCK_DIRS=()
declare -a TRANSACTION_LOCK_TOKENS=()

validate_sensitive_path() {
    local target="$1" kind="${2:-file}"
    python3 - "$target" "$kind" "$HOME" "${PROJECT_ROOT:-}" "${XDG_CONFIG_HOME:-}" <<'PY'
import os
import stat
import sys

target, kind, home, project, xdg = sys.argv[1:]
target = os.path.abspath(target)
roots = []
for candidate in (home, project, xdg):
    if not candidate:
        continue
    candidate = os.path.abspath(candidate)
    try:
        if os.path.commonpath([target, candidate]) == candidate:
            roots.append(candidate)
    except ValueError:
        pass
anchor = max(roots, key=len) if roots else os.path.sep
if os.path.islink(anchor) or not os.path.isdir(anchor):
    raise SystemExit(f"sensitive path anchor is unsafe: {anchor}")
parent = os.path.dirname(target)
relative = os.path.relpath(parent, anchor)
current = anchor
if relative != ".":
    for component in relative.split(os.sep):
        current = os.path.join(current, component)
        if not os.path.lexists(current):
            break
        metadata = os.lstat(current)
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise SystemExit(f"sensitive path parent is unsafe: {current}")
if os.path.lexists(target):
    metadata = os.lstat(target)
    if kind == "file" and (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1):
        raise SystemExit(f"sensitive file target is unsafe: {target}")
    if kind == "directory" and (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)):
        raise SystemExit(f"sensitive directory target is unsafe: {target}")
PY
}

capture_file_state() {
    python3 - "$1" <<'PY'
import hashlib
import os
import stat
import sys

path = sys.argv[1]
if not os.path.lexists(path):
    print("missing")
    raise SystemExit(0)
metadata = os.lstat(path)
if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
    raise SystemExit(f"file state target is unsafe: {path}")
with open(path, "rb") as handle:
    print(f"present:{hashlib.file_digest(handle, 'sha256').hexdigest()}")
PY
}

validate_runtime_installation_ownership() {
    local runtime="$1" internal="${2:-$1/$INSTALLATION_OWNER_MARKER}" external="${3:-}"
    validate_sensitive_path "$runtime" directory || return 1
    validate_sensitive_path "$internal" file || return 1
    [[ -z "$external" ]] || validate_sensitive_path "$external" file || return 1
    python3 - "$runtime" "$internal" "$external" "$CANONICAL_SERVER_DIR" \
        "$INSTALLATION_OWNER_VERSION" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys

runtime, internal, external, canonical, version = sys.argv[1:]
if not os.path.isdir(runtime) or os.path.islink(runtime):
    raise SystemExit("canonical runtime is not a real directory")

def load_owner(path):
    if not os.path.lexists(path):
        raise SystemExit(f"runtime ownership marker is missing: {path}")
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise SystemExit(f"runtime ownership marker is unsafe: {path}")
    with open(path, encoding="utf-8") as handle:
        value = json.load(handle)
    expected_keys = {"kind", "version", "token", "path", "lockfile_sha256"}
    if set(value) != expected_keys:
        raise SystemExit(f"runtime ownership marker has unexpected fields: {path}")
    if value["kind"] != "forgewright-mcp-runtime" or value["version"] != int(version):
        raise SystemExit(f"runtime ownership marker identity mismatch: {path}")
    if value["path"] != canonical or not re.fullmatch(r"[0-9]+-[0-9a-f]{32}", value["token"]):
        raise SystemExit(f"runtime ownership marker path/token mismatch: {path}")
    if not re.fullmatch(r"[0-9a-f]{64}", value["lockfile_sha256"]):
        raise SystemExit(f"runtime ownership marker digest is invalid: {path}")
    return value

owner = load_owner(internal)
if external and load_owner(external) != owner:
    raise SystemExit("internal and external runtime ownership markers differ")
lockfile = os.path.join(runtime, "package-lock.json")
server = os.path.join(runtime, "src", "index.ts")
tsx = os.path.join(runtime, "node_modules", ".bin", "tsx")
for path in (lockfile, server):
    if not os.path.isfile(path) or os.path.islink(path) or os.stat(path, follow_symlinks=False).st_nlink != 1:
        raise SystemExit(f"canonical runtime verification failed: {path}")
node_modules = os.path.join(runtime, "node_modules")
dot_bin = os.path.join(node_modules, ".bin")
tsx = os.path.join(dot_bin, "tsx")

for boundary in (node_modules, dot_bin):
    if os.path.lexists(boundary) and os.path.islink(boundary):
        raise SystemExit(f"canonical runtime ownership boundary must not be a symlink: {boundary}")
if not os.path.isdir(node_modules):
    raise SystemExit(f"canonical runtime node_modules is missing")

resolved_tsx = os.path.realpath(tsx)
if not os.path.isfile(resolved_tsx) or os.path.commonpath([os.path.realpath(node_modules), resolved_tsx]) != os.path.realpath(node_modules):
    raise SystemExit(f"canonical runtime executable escapes ownership: {tsx}")
with open(lockfile, "rb") as handle:
    digest = hashlib.file_digest(handle, "sha256").hexdigest()
if digest != owner["lockfile_sha256"]:
    raise SystemExit("canonical runtime lockfile no longer matches ownership state")
PY
}

canonical_candidate_ready() {
    [[ -n "$CANONICAL_STAGE_DIR" ]] && \
        [[ -f "$CANONICAL_STAGE_DIR/src/index.ts" ]] && \
        [[ -x "$CANONICAL_STAGE_DIR/node_modules/.bin/tsx" ]]
}

resolve_gitnexus_executable() {
    local resolved
    resolved="$(command -v gitnexus 2>/dev/null || true)"
    if [[ -n "$resolved" ]] && [[ -x "$resolved" ]]; then
        printf '%s\n' "$resolved"
    else
        printf '%s\n' "gitnexus"
    fi
}

jsonc_parser_module() {
    local candidate
    for candidate in \
        "${CANONICAL_STAGE_DIR:-}/node_modules/jsonc-parser" \
        "$CANONICAL_SERVER_DIR/node_modules/jsonc-parser" \
        "$FORGEWRIGHT_DIR/mcp/node_modules/jsonc-parser"; do
        if [[ -n "$candidate" ]] && [[ -f "$candidate/lib/umd/main.js" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

jsonc_self_contained() {
    node - "$@" <<'NODE'
const fs = require('fs');
const [operation, inputPath, outputPath, schema = 'generic', name = '', expectedCommand = '', expectedArg = ''] = process.argv.slice(2);

class JsoncParser {
  constructor(text) { this.text = text; this.i = 0; }
  fail(message) { throw new Error(`${message}@${this.i}`); }
  skip() {
    while (this.i < this.text.length) {
      if (/\s/.test(this.text[this.i])) { this.i++; continue; }
      if (this.text.startsWith('//', this.i)) {
        this.i += 2;
        while (this.i < this.text.length && !/[\r\n]/.test(this.text[this.i])) this.i++;
        continue;
      }
      if (this.text.startsWith('/*', this.i)) {
        const end = this.text.indexOf('*/', this.i + 2);
        if (end < 0) this.fail('unterminated block comment');
        this.i = end + 2;
        continue;
      }
      break;
    }
  }
  string() {
    const start = this.i;
    if (this.text[this.i++] !== '"') this.fail('expected string');
    let escaped = false;
    while (this.i < this.text.length) {
      const ch = this.text[this.i++];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') {
        const raw = this.text.slice(start, this.i);
        return { start, end: this.i, value: JSON.parse(raw) };
      }
      if (ch.charCodeAt(0) < 0x20) this.fail('control character in string');
    }
    this.fail('unterminated string');
  }
  value() {
    this.skip();
    const start = this.i;
    const ch = this.text[this.i];
    if (ch === '{') return this.object();
    if (ch === '[') return this.array();
    if (ch === '"') return this.string();
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (this.text.startsWith(literal, this.i)) {
        this.i += literal.length;
        return { start, end: this.i, value };
      }
    }
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.i));
    if (match && match.index === 0) {
      this.i += match[0].length;
      return { start, end: this.i, value: Number(match[0]) };
    }
    this.fail('expected JSONC value');
  }
  object() {
    const start = this.i++;
    const value = {};
    const props = [];
    this.skip();
    if (this.text[this.i] === '}') return { start, end: ++this.i, value, props };
    while (this.i < this.text.length) {
      this.skip();
      const key = this.string();
      if (Object.prototype.hasOwnProperty.call(value, key.value)) this.fail(`duplicate key ${key.value}`);
      this.skip();
      if (this.text[this.i++] !== ':') this.fail('expected colon');
      const child = this.value();
      value[key.value] = child.value;
      this.skip();
      let comma = null;
      if (this.text[this.i] === ',') comma = this.i++;
      props.push({ key: key.value, start: key.start, end: child.end, comma, node: child });
      this.skip();
      if (this.text[this.i] === '}') return { start, end: ++this.i, value, props };
      if (comma === null) this.fail('expected comma or closing brace');
    }
    this.fail('unterminated object');
  }
  array() {
    const start = this.i++;
    const value = [];
    this.skip();
    if (this.text[this.i] === ']') return { start, end: ++this.i, value };
    while (this.i < this.text.length) {
      value.push(this.value().value);
      this.skip();
      if (this.text[this.i] === ',') {
        this.i++;
        this.skip();
        if (this.text[this.i] === ']') return { start, end: ++this.i, value };
        continue;
      }
      if (this.text[this.i] === ']') return { start, end: ++this.i, value };
      this.fail('expected comma or closing bracket');
    }
    this.fail('unterminated array');
  }
  parse() {
    const node = this.value();
    this.skip();
    if (this.i !== this.text.length) this.fail('trailing content');
    return node;
  }
}

const parse = (text) => new JsoncParser(text).parse();
const property = (node, key) => node?.props?.find((item) => item.key === key);
const crypto = require('crypto');
const ledgerInputPath = fs.realpathSync(inputPath);
let raw = fs.readFileSync(inputPath, 'utf8');
const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
if (bom) raw = raw.slice(1);

if (operation === 'verify') {
  const config = parse(raw).value;
  const servers = schema === 'zed' ? config.context_servers : schema === 'opencode' ? config.mcp : (config.mcpServers ?? config.mcp_servers);
  if (!servers || Array.isArray(servers) || typeof servers !== 'object') process.exit(1);
  const entry = servers[name];
  const disabled = new Set([...(Array.isArray(config.disabledMcpServers) ? config.disabledMcpServers : []), ...(Array.isArray(config.disabled_mcp_servers) ? config.disabled_mcp_servers : [])]);
  const exact = schema === 'opencode' ? entry?.type === 'local' && JSON.stringify(entry.command) === JSON.stringify([expectedCommand, expectedArg]) : entry?.command === expectedCommand && JSON.stringify(entry?.args) === JSON.stringify([expectedArg]);
  process.exit(exact && entry.enabled !== false && entry.disabled !== true && !disabled.has(name) ? 0 : 1);
}

if (operation !== 'remove') throw new Error(`unknown JSONC operation: ${operation}`);
if (!parse(raw).props) throw new Error('MCP config root must be an object');
const rootKeys = schema === 'zed' ? ['context_servers'] : schema === 'opencode' ? ['mcp'] : ['mcpServers', 'mcp_servers'];
for (const rootKey of rootKeys) {
  for (const managed of ['forgewright', 'gitnexus']) {
    const root = parse(raw);
    const container = property(root, rootKey);
    if (!container) continue;
    if (!container.node.props) throw new Error(`${rootKey} must be an object`);
    const props = container.node.props;
    const index = props.findIndex((item) => item.key === managed);
    if (index < 0) continue;
    const target = props[index];
    const entry = root.value[rootKey][managed];
    {
      const currFp = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
      const ledgerPath = process.env.FORGEWRIGHT_LEDGER_PATH;
      const ledgerTmp = process.env.FORGEWRIGHT_LEDGER_TMP;
      const token = process.env.FORGEWRIGHT_RUNTIME_TOKEN;
      let ledger = { kind: "forgewright-mcp-ledger", version: 1, runtime_token: token, records: {} };
      const ledgerSource = ledgerTmp && fs.existsSync(ledgerTmp) && fs.statSync(ledgerTmp).size > 0 ? ledgerTmp : ledgerPath;
      if (ledgerSource && fs.existsSync(ledgerSource)) {
        try {
          const data = JSON.parse(fs.readFileSync(ledgerSource, 'utf8'));
          if (!data || data.kind !== "forgewright-mcp-ledger" || data.version !== 1 || data.runtime_token !== token || !data.records) throw new Error('Ledger malformed or token mismatch');
          ledger = data;
        } catch(e) {
          throw new Error('Ledger malformed or token mismatch');
        }
      }
      const recordKey = crypto.createHash('sha256').update(`${ledgerInputPath}:${schema}:${managed}`).digest('hex');
      const record = ledger.records[recordKey];
      if (!record) {
        continue;
      } else if (record.normalized_value_sha256 !== currFp) {
        throw new Error(`${managed} entry was externally changed, failing closed`);
      }
      delete ledger.records[recordKey];
      if (ledgerTmp) fs.writeFileSync(ledgerTmp, JSON.stringify(ledger, null, 2));
    }
    const edits = target.comma !== null ? [[target.start, target.comma + 1]] : [[target.start, target.end]];
    if (target.comma === null && index > 0 && props[index - 1].comma !== null) edits.push([props[index - 1].comma, props[index - 1].comma + 1]);
    for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) raw = raw.slice(0, start) + raw.slice(end);
    parse(raw);
  }
}
const finalConfig = parse(raw).value;
for (const rootKey of rootKeys) {
  const servers = finalConfig[rootKey];
  if (servers !== undefined && (!servers || Array.isArray(servers) || typeof servers !== 'object')) throw new Error(`${rootKey} must be an object`);
  if (servers?.forgewright !== undefined || servers?.gitnexus !== undefined) console.warn('Note: unowned managed JSONC entries remain');
}
fs.writeFileSync(outputPath, `${bom}${raw}`, { mode: fs.statSync(inputPath).mode & 0o777 });
NODE
}

durable_replace_file() {
    local source="$1" target="$2" label="${3:-config}" expected_state="${4:-unchecked}"
    validate_sensitive_path "$target" file || return 1
    python3 - "$source" "$target" "$label" "$expected_state" "$HOME" "${PROJECT_ROOT:-}" \
        "${XDG_CONFIG_HOME:-}" <<'PY'
import hashlib
import os
import shutil
import signal
import stat
import sys
import tempfile

source, target, label, expected_state, home, project, xdg = sys.argv[1:]
parent = os.path.dirname(target)
backup = None
replaced = False

def inject(point):
    boundary = f"{label}:{point}"
    if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == boundary:
        os.kill(os.getppid(), signal.SIGKILL)
        os._exit(137)
    if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
        raise OSError(f"injected durability failure at {boundary}")

def fsync_file(path):
    with open(path, "rb") as handle:
        os.fsync(handle.fileno())

def fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def file_state(path):
    if not os.path.lexists(path):
        return "missing"
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise OSError(f"durable replacement target is unsafe: {path}")
    with open(path, "rb") as handle:
        return f"present:{hashlib.file_digest(handle, 'sha256').hexdigest()}"

def validate_parents(path):
    roots = []
    for candidate in (home, project, xdg):
        if not candidate:
            continue
        candidate = os.path.abspath(candidate)
        try:
            if os.path.commonpath([path, candidate]) == candidate:
                roots.append(candidate)
        except ValueError:
            pass
    anchor = max(roots, key=len) if roots else os.path.sep
    if os.path.islink(anchor) or not os.path.isdir(anchor):
        raise OSError(f"sensitive path anchor is unsafe: {anchor}")
    current = anchor
    relative = os.path.relpath(os.path.dirname(path), anchor)
    if relative != ".":
        for component in relative.split(os.sep):
            current = os.path.join(current, component)
            metadata = os.lstat(current)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise OSError(f"sensitive path parent is unsafe: {current}")

if not os.path.isfile(source) or os.path.islink(source) or os.stat(source, follow_symlinks=False).st_nlink != 1:
    raise SystemExit(f"durable replacement source is unsafe: {source}")
validate_parents(target)
if os.environ.get("FORGEWRIGHT_TEST_EXTERNAL_WRITE_AT") == label:
    payload = os.environ.get("FORGEWRIGHT_TEST_EXTERNAL_WRITE_CONTENT", "external-writer\n")
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_dir(parent)
if expected_state != "unchecked" and file_state(target) != expected_state:
    raise OSError(f"non-cooperative writer changed target before replacement: {target}")
if os.path.lexists(target):
    descriptor, backup = tempfile.mkstemp(prefix=".durability-rollback.", dir=parent)
    os.close(descriptor)
    shutil.copy2(target, backup, follow_symlinks=False)
    fsync_file(backup)
try:
    source_digest = file_state(source)
    fsync_file(source)
    inject("before-replace")
    os.replace(source, target)
    replaced = True
    inject("after-replace")
    fsync_file(target)
    inject("after-file")
    fsync_dir(parent)
    inject("after-parent")
except BaseException:
    if replaced:
        if backup is not None:
            if expected_state != "unchecked" and file_state(target) != source_digest:
                pass
            else:
                os.replace(backup, target)
                backup = None
                fsync_file(target)
        elif os.path.lexists(target):
            if expected_state != "unchecked" and file_state(target) != source_digest:
                pass
            else:
                os.unlink(target)
        fsync_dir(parent)
    raise
finally:
    if backup is not None and os.path.exists(backup):
        os.unlink(backup)
        fsync_dir(parent)
PY
}

durable_remove_file() {
    local target="$1" label="${2:-config-remove}" expected_state="${3:-unchecked}"
    validate_sensitive_path "$target" file || return 1
    python3 - "$target" "$label" "$expected_state" <<'PY'
import hashlib
import os
import signal
import stat
import sys

target, label, expected = sys.argv[1:]
parent = os.path.dirname(target)

def state():
    if not os.path.lexists(target):
        return "missing"
    metadata = os.lstat(target)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise OSError(f"durable removal target is unsafe: {target}")
    with open(target, "rb") as handle:
        return f"present:{hashlib.file_digest(handle, 'sha256').hexdigest()}"

if os.environ.get("FORGEWRIGHT_TEST_EXTERNAL_WRITE_AT") == label:
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(os.environ.get("FORGEWRIGHT_TEST_EXTERNAL_WRITE_CONTENT", "external-writer\n"))
        handle.flush()
        os.fsync(handle.fileno())
if expected != "unchecked" and state() != expected:
    raise OSError(f"non-cooperative writer changed target before removal: {target}")
if not os.path.lexists(target):
    raise OSError(f"durable removal target disappeared: {target}")
if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == f"{label}:before-unlink":
    raise OSError(f"injected durability failure at {label}:before-unlink")
if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == f"{label}:before-unlink":
    os.kill(os.getppid(), signal.SIGKILL)
    os._exit(137)
os.unlink(target)
descriptor = os.open(parent, os.O_RDONLY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

durability_sync_tree() {
    local root="$1" label="${2:-runtime}"
    validate_sensitive_path "$root" directory || return 1
    python3 - "$root" "$label" <<'PY'
import os
import signal
import stat
import sys

root, label = sys.argv[1:]

def inject(point):
    boundary = f"{label}:{point}"
    if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == boundary:
        os.kill(os.getppid(), signal.SIGKILL)
        os._exit(137)
    if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
        raise OSError(f"injected durability failure at {boundary}")

def fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

if not os.path.isdir(root) or os.path.islink(root):
    raise SystemExit(f"durability tree is unsafe: {root}")
for current, directories, files in os.walk(root, topdown=False, followlinks=False):
    for name in files:
        path = os.path.join(current, name)
        metadata = os.lstat(path)
        if stat.S_ISREG(metadata.st_mode):
            with open(path, "rb") as handle:
                os.fsync(handle.fileno())
        elif not stat.S_ISLNK(metadata.st_mode):
            raise SystemExit(f"unsupported runtime payload type: {path}")
    for name in directories:
        path = os.path.join(current, name)
        if not os.path.islink(path):
            fsync_dir(path)
    fsync_dir(current)
inject("after-tree")
fsync_dir(os.path.dirname(root))
inject("after-parent")
PY
}

durable_publish_directory() {
    local source="$1" target="$2" label="${3:-runtime-publication}"
    validate_sensitive_path "$source" directory || return 1
    validate_sensitive_path "$target" directory || return 1
    durability_sync_tree "$source" "runtime-payload" || return 1
    python3 - "$source" "$target" "$label" <<'PY'
import os
import signal
import sys

source, target, label = sys.argv[1:]
os.rename(source, target)
boundary = f"{label}:after-move"
if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == boundary:
    os.kill(os.getppid(), signal.SIGKILL)
    os._exit(137)
if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
    raise OSError(f"injected durability failure at {boundary}")
for directory in (target, os.path.dirname(target)):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
boundary = f"{label}:after-parent"
if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
    raise OSError(f"injected durability failure at {boundary}")
PY
}

opencode_config_path() {
    local root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    if [[ -f "$root/opencode.jsonc" ]]; then
        printf '%s\n' "$root/opencode.jsonc"
    else
        printf '%s\n' "$root/opencode.json"
    fi
}

claude_desktop_config_path() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        printf '%s\n' "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    else
        printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json"
    fi
}

new_owner_token() {
    python3 - <<'PY'
import os
import secrets
print(f"{os.getpid()}-{secrets.token_hex(16)}")
PY
}

config_lock_path() {
    python3 - "$1" "$HOME/.forgewright/locks" <<'PY'
import hashlib
import os
import sys
path, root = sys.argv[1:]
print(os.path.join(root, f"config-{hashlib.sha256(os.fsencode(path)).hexdigest()}.lock"))
PY
}

acquire_owned_lock() {
    local lock_dir="$1" owner_token="$2" attempt result
    validate_sensitive_path "$lock_dir" directory || return 1
    for ((attempt = 0; attempt < 600; attempt += 1)); do
        if python3 - "$lock_dir" "$owner_token" "$$" "$HOME" "${PROJECT_ROOT:-}" <<'PY'
import fcntl
import json
import os
import platform
import shutil
import subprocess
import sys
import uuid

lock, token, pid_text, home, project = sys.argv[1:]
pid = int(pid_text)
parent = os.path.dirname(lock)
os.makedirs(parent, exist_ok=True)

roots = []
for candidate in (home, project):
    if not candidate:
        continue
    candidate = os.path.abspath(candidate)
    try:
        if os.path.commonpath([lock, candidate]) == candidate:
            roots.append(candidate)
    except ValueError:
        pass
anchor = max(roots, key=len) if roots else os.path.sep
current = anchor
relative = os.path.relpath(parent, anchor)
for component in (() if relative == "." else relative.split(os.sep)):
    current = os.path.join(current, component)
    if os.path.islink(current) or not os.path.isdir(current):
        raise SystemExit(f"lock parent is unsafe: {current}")
guard_path = f"{lock}.guard"

def process_identity(candidate):
    overrides = os.environ.get("FORGEWRIGHT_TEST_PROCESS_IDENTITIES")
    if overrides:
        value = json.loads(overrides).get(str(candidate))
        if value is not None:
            return value.get("birth"), value.get("state", "")
    if platform.system() == "Linux":
        try:
            raw = open(f"/proc/{candidate}/stat", encoding="utf-8").read()
            fields = raw[raw.rfind(")") + 2:].split()
            return fields[19], fields[0]
        except (FileNotFoundError, PermissionError, IndexError, OSError):
            return None, ""
    try:
        result = subprocess.run(
            ["ps", "-o", "state=", "-o", "lstart=", "-p", str(candidate)],
            check=False, capture_output=True, text=True,
        )
    except OSError:
        return None, ""
    line = result.stdout.strip()
    if result.returncode != 0 or not line:
        return None, ""
    state, _, birth = line.partition(" ")
    return birth.strip(), state

birth, state = process_identity(pid)
if not birth or state.startswith("Z"):
    raise SystemExit("could not establish live lock owner identity")
with open(guard_path, "a+", encoding="utf-8") as guard:
    fcntl.flock(guard, fcntl.LOCK_EX)
    if os.path.lexists(lock):
        owner = {}
        try:
            with open(os.path.join(lock, "owner.json"), encoding="utf-8") as handle:
                owner = json.load(handle)
        except (OSError, ValueError, TypeError):
            pass
        owner_pid = owner.get("pid")
        alive = False
        if isinstance(owner_pid, int) and owner_pid > 0:
            owner_birth, owner_state = process_identity(owner_pid)
            alive = bool(owner_birth) and not owner_state.startswith("Z") and owner_birth == owner.get("birth")
        if alive:
            if owner.get("token") == token:
                sys.exit(0)
            raise SystemExit(75)
        quarantine = f"{lock}.stale.{uuid.uuid4().hex}"
        os.rename(lock, quarantine)
        shutil.rmtree(quarantine, ignore_errors=True)
    os.mkdir(lock, 0o700)
    owner_tmp = os.path.join(lock, ".owner.tmp")
    with open(owner_tmp, "w", encoding="utf-8") as handle:
        json.dump({"token": token, "pid": pid, "birth": birth}, handle)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(owner_tmp, os.path.join(lock, "owner.json"))
    lock_fd = os.open(lock, os.O_RDONLY)
    try:
        os.fsync(lock_fd)
    finally:
        os.close(lock_fd)
    parent_fd = os.open(parent, os.O_RDONLY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
PY
        then
            return 0
        else
            result=$?
        fi
        if [[ "$result" -ne 75 ]]; then
            return "$result"
        fi
        sleep 0.1
    done
    log_error "Timed out waiting for owned lock: $lock_dir"
    return 1
}

release_owned_lock() {
    local lock_dir="$1" owner_token="$2"
    validate_sensitive_path "$lock_dir" directory || return 1
    python3 - "$lock_dir" "$owner_token" <<'PY'
import fcntl
import json
import os
import shutil
import sys
import uuid

lock, token = sys.argv[1:]
parent = os.path.dirname(lock)
os.makedirs(parent, exist_ok=True)
quarantine = ""
with open(f"{lock}.guard", "a+", encoding="utf-8") as guard:
    fcntl.flock(guard, fcntl.LOCK_EX)
    if os.path.isdir(lock):
        try:
            with open(os.path.join(lock, "owner.json"), encoding="utf-8") as handle:
                owner = json.load(handle)
        except (OSError, ValueError, TypeError):
            owner = {}
        if owner.get("token") == token:
            quarantine = f"{lock}.released.{uuid.uuid4().hex}"
            os.rename(lock, quarantine)
if quarantine:
    shutil.rmtree(quarantine, ignore_errors=True)
PY
}

journal_update() {
    local operation="$1"
    shift
    python3 - "$TRANSACTION_JOURNAL" "$operation" "$@" <<'PY'
import json
import os
import sys

journal, operation, *args = sys.argv[1:]
with open(journal, encoding="utf-8") as handle:
    data = json.load(handle)

if operation == "add-file":
    if len(args) == 6:
        path, backup, had_active, mode, original_digest, expected_stat = args
    else:
        path, backup, had_active, mode, original_digest = args
        expected_stat = None
    if had_active == "true" and expected_stat:
        current_st = os.lstat(path)
        if f"{current_st.st_dev}:{current_st.st_ino}:{current_st.st_mtime_ns}:{current_st.st_ctime_ns}:{current_st.st_size}" != expected_stat:
            raise SystemExit(f"non-cooperative writer changed target before journal ownership: {path}")
    elif had_active == "false" and expected_stat == "missing" and os.path.lexists(path):
        raise SystemExit(f"non-cooperative writer created target before journal ownership: {path}")
    if any(item["path"] == path for item in data["files"]):
        raise SystemExit(f"duplicate transaction file: {path}")
    data["files"].append({
        "path": path,
        "backup": backup or None,
        "had_active": had_active == "true",
        "mode": int(mode, 8) if mode else None,
        "original_sha256": original_digest or None,
        "expected_sha256": None,
        "expected_absent": False,
    })
elif operation == "expect-file":
    path, digest = args
    for item in data["files"]:
        if item["path"] == path:
            item["expected_sha256"] = digest
            item["expected_absent"] = False
            break
    else:
        raise SystemExit(f"transaction file is not snapshotted: {path}")
elif operation == "clear-expect-file":
    path = args[0]
    for item in data["files"]:
        if item["path"] == path:
            item["expected_sha256"] = None
            item["expected_absent"] = False
            break
    else:
        raise SystemExit(f"transaction file is not snapshotted: {path}")
elif operation == "expect-absent":
    path = args[0]
    for item in data["files"]:
        if item["path"] == path:
            item["expected_sha256"] = None
            item["expected_absent"] = True
            break
    else:
        raise SystemExit(f"transaction file is not snapshotted: {path}")
elif operation == "runtime":
    had_active, action = args
    data["runtime"]["had_active"] = had_active == "true"
    data["runtime"]["action"] = action
elif operation == "status":
    data["status"] = args[0]
else:
    raise SystemExit(f"unknown journal operation: {operation}")

temporary = f"{journal}.tmp.{os.getpid()}"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temporary, journal)
directory_fd = os.open(os.path.dirname(journal), os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
}

journal_value() {
    python3 - "$TRANSACTION_JOURNAL" "$@" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
for key in sys.argv[2:]:
    value = value[key]
if isinstance(value, bool):
    print("true" if value else "false")
elif value is not None:
    print(value)
PY
}

initialize_runtime_transaction() {
    local canonical_parent
    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    TRANSACTION_TOKEN="$CANONICAL_LOCK_TOKEN"
    TRANSACTION_DIR="$canonical_parent/.transactions/$TRANSACTION_TOKEN"
    CANONICAL_STAGE_DIR="$canonical_parent/.mcp-server.stage.$TRANSACTION_TOKEN"
    validate_sensitive_path "$CANONICAL_SERVER_DIR" directory || return 1
    validate_sensitive_path "$TRANSACTION_DIR" directory || return 1
    validate_sensitive_path "$CANONICAL_STAGE_DIR" directory || return 1
    python3 - "$TRANSACTION_JOURNAL" "$TRANSACTION_DIR" "$TRANSACTION_TOKEN" "$$" \
        "$PROJECT_ROOT" "$CANONICAL_SERVER_DIR" "$CANONICAL_STAGE_DIR" <<'PY'
import json
import os
import sys

journal, transaction_dir, token, pid, project, active, stage = sys.argv[1:]
if os.path.lexists(journal):
    raise SystemExit(f"pending MCP transaction was not recovered: {journal}")
os.makedirs(os.path.dirname(transaction_dir), mode=0o700, exist_ok=True)
data = {
    "version": 1,
    "status": "active",
    "token": token,
    "pid": int(pid),
    "project_root": project,
    "transaction_dir": transaction_dir,
    "runtime": {
        "active": active,
        "stage": stage,
        "had_active": None,
        "action": "staged",
    },
    "files": [],
}
temporary = f"{journal}.tmp.{os.getpid()}"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temporary, journal)
directory_fd = os.open(os.path.dirname(journal), os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
os.mkdir(transaction_dir, mode=0o700)
transactions_fd = os.open(os.path.dirname(transaction_dir), os.O_RDONLY)
try:
    os.fsync(transactions_fd)
finally:
    os.close(transactions_fd)
PY
    TRANSACTION_ACTIVE="true"
    TRANSACTION_LOCK_DIRS=()
    TRANSACTION_LOCK_TOKENS=()
}

transaction_file_is_snapshotted() {
    python3 - "$TRANSACTION_JOURNAL" "$1" <<'PY' >/dev/null
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
raise SystemExit(0 if any(item["path"] == sys.argv[2] for item in data["files"]) else 1)
PY
}

transaction_snapshot_file() {
    local target="$1" lock_dir owner_token backup="" had_active="false" mode="" original_digest=""
    [[ "$TRANSACTION_ACTIVE" == "true" ]] || return 1
    transaction_file_is_snapshotted "$target" && return 0
    validate_sensitive_path "$target" file || return 1

    lock_dir="$(config_lock_path "$target")"
    owner_token="$(new_owner_token)"
    acquire_owned_lock "$lock_dir" "$owner_token" || return 1
    validate_sensitive_path "$target" file || {
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    }
    if { [[ -e "$target" ]] || [[ -L "$target" ]]; } && \
        { [[ ! -f "$target" ]] || [[ -L "$target" ]]; }; then
        log_error "Transaction target must be a regular, non-symlink file: $target"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    if [[ -f "$target" ]] && [[ "$(python3 - "$target" <<'PY'
import os
import sys
print(os.stat(sys.argv[1], follow_symlinks=False).st_nlink)
PY
)" != "1" ]]; then
        log_error "Transaction target must not be hard-linked: $target"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    local expected_stat="missing"
    if [[ -f "$target" ]]; then
        had_active="true"
        backup="$(mktemp "$TRANSACTION_DIR/file.XXXXXX")"
        local snapshot_result
        snapshot_result="$(python3 - "$target" "$backup" <<'PY'
import hashlib
import os
import stat
import sys

target, backup = sys.argv[1:3]
try:
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
except OSError:
    raise SystemExit(1)
try:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise SystemExit(1)
    mode = stat.S_IMODE(st.st_mode)
    digest = hashlib.sha256()
    with open(backup, "wb") as dst:
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            dst.write(chunk)
            digest.update(chunk)
        dst.flush()
        os.fsync(dst.fileno())
    os.chmod(backup, mode)
    try:
        os.utime(backup, ns=(st.st_atime_ns, st.st_mtime_ns))
    except Exception:
        pass
    dir_fd = os.open(os.path.dirname(backup), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
    print(f"{digest.hexdigest()}:{mode:o}:{st.st_dev}:{st.st_ino}:{st.st_mtime_ns}:{st.st_ctime_ns}:{st.st_size}")
finally:
    os.close(fd)
PY
)"
        if [[ $? -ne 0 ]]; then
            log_error "Failed to snapshot file: $target"
            [[ -n "$backup" ]] && rm -f -- "$backup"
            release_owned_lock "$lock_dir" "$owner_token"
            return 1
        fi
        original_digest="${snapshot_result%%:*}"
        local rest="${snapshot_result#*:}"
        mode="${rest%%:*}"
        expected_stat="${rest#*:}"
    fi
    if [[ -n "${FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_PATH:-}" ]] && \
        [[ -z "${FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_TARGET:-}" || "$target" == "$FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_TARGET" ]]; then
        cat "$FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_PATH" > "$target"
    fi
    if ! journal_update add-file "$target" "$backup" "$had_active" "$mode" "$original_digest" "$expected_stat"; then
        [[ -n "$backup" ]] && rm -f -- "$backup"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    TRANSACTION_LOCK_DIRS+=("$lock_dir")
    TRANSACTION_LOCK_TOKENS+=("$owner_token")
}

transaction_original_file_state() {
    python3 - "$TRANSACTION_JOURNAL" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for item in data["files"]:
    if item["path"] == sys.argv[2]:
        print(f"present:{item['original_sha256']}" if item["had_active"] else "missing")
        raise SystemExit(0)
raise SystemExit("transaction file is not snapshotted")
PY
}

transaction_original_file_backup() {
    python3 - "$TRANSACTION_JOURNAL" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for item in data["files"]:
    if item["path"] == sys.argv[2] and item["had_active"] and item["backup"]:
        print(item["backup"])
        raise SystemExit(0)
raise SystemExit("transaction file has no original backup")
PY
}

transaction_current_file_state() {
    python3 - "$TRANSACTION_JOURNAL" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for item in data["files"]:
    if item["path"] != sys.argv[2]:
        continue
    if item.get("expected_sha256"):
        print(f'present:{item["expected_sha256"]}')
    elif item.get("expected_absent"):
        print("missing")
    else:
        print(f'present:{item["original_sha256"]}' if item["had_active"] else "missing")
    raise SystemExit(0)
raise SystemExit("transaction file is not snapshotted")
PY
}

transaction_expect_file() {
    local target="$1" candidate="$2" digest
    [[ "$TRANSACTION_ACTIVE" == "true" ]] || return 0
    digest="$(python3 - "$candidate" <<'PY'
import hashlib
import sys
with open(sys.argv[1], "rb") as handle:
    print(hashlib.file_digest(handle, "sha256").hexdigest())
PY
)"
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    journal_update expect-file "$target" "$digest"
}

transaction_clear_expect_file() {
    [[ "$TRANSACTION_ACTIVE" == "true" ]] || return 0
    journal_update clear-expect-file "$1"
}

transaction_expect_absent() {
    [[ "$TRANSACTION_ACTIVE" == "true" ]] || return 0
    journal_update expect-absent "$1"
}

release_transaction_file_locks() {
    local index
    for ((index = ${#TRANSACTION_LOCK_DIRS[@]} - 1; index >= 0; index -= 1)); do
        release_owned_lock "${TRANSACTION_LOCK_DIRS[index]}" "${TRANSACTION_LOCK_TOKENS[index]}" || true
    done
    TRANSACTION_LOCK_DIRS=()
    TRANSACTION_LOCK_TOKENS=()
}

restore_transaction_files() {
    python3 - "$TRANSACTION_JOURNAL" <<'PY'
import hashlib
import json
import os
import stat
import sys

journal = sys.argv[1]
with open(journal, encoding="utf-8") as handle:
    data = json.load(handle)
transaction_dir = os.path.realpath(data["transaction_dir"])
failures = []

def digest(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()

for item in reversed(data["files"]):
    expected = item.get("expected_sha256")
    expected_absent = item.get("expected_absent", False)
    if not expected and not expected_absent:
        continue
    target = item["path"]
    if item["had_active"] and os.path.isfile(target) and not os.path.islink(target) and \
            digest(target) == item.get("original_sha256"):
        continue
    if not item["had_active"] and not os.path.lexists(target):
        continue
    if expected_absent:
        if os.path.lexists(target):
            failures.append(f"deleted transaction target was recreated externally: {target}")
            continue
    elif not os.path.isfile(target) or os.path.islink(target) or digest(target) != expected:
        failures.append(f"not transaction-owned at recovery: {target}")
        continue
    if item["had_active"]:
        backup = item.get("backup")
        if not backup or os.path.commonpath([transaction_dir, os.path.realpath(backup)]) != transaction_dir:
            failures.append(f"invalid transaction backup: {target}")
            continue
        if not os.path.isfile(backup) or os.path.islink(backup):
            failures.append(f"missing transaction backup: {target}")
            continue
        os.replace(backup, target)
        with open(target, "rb") as handle:
            os.fsync(handle.fileno())
    else:
        os.unlink(target)
    directory_fd = os.open(os.path.dirname(target), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)

for failure in failures:
    print(f"CRITICAL: {failure}", file=sys.stderr)
raise SystemExit(1 if failures else 0)
PY
}

journal_file_paths() {
    python3 - "$TRANSACTION_JOURNAL" <<'PY'
import base64
import json
import os
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for item in data["files"]:
    print(base64.b64encode(os.fsencode(item["path"])).decode("ascii"))
PY
}

decode_path() {
    python3 - "$1" <<'PY'
import base64
import os
import sys
sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))
PY
}

runtime_trash_dir() {
    local token="$1"
    printf '%s/.mcp-trash/runtime-%s\n' "$(dirname "$CANONICAL_SERVER_DIR")" "$token"
}

runtime_trash_is_owned() {
    local token="$1" trash_dir
    trash_dir="$(runtime_trash_dir "$token")"
    python3 - "$trash_dir" "$token" <<'PY' >/dev/null 2>&1
import json
import os
import sys

trash, token = sys.argv[1:]
if not os.path.isdir(trash) or os.path.islink(trash):
    raise SystemExit(1)
owner_path = os.path.join(trash, "owner.json")
if not os.path.isfile(owner_path) or os.path.islink(owner_path):
    raise SystemExit(1)
with open(owner_path, encoding="utf-8") as handle:
    owner = json.load(handle)
raise SystemExit(0 if owner == {"kind": "mcp-runtime-trash", "token": token} else 1)
PY
}

restore_installation_runtime_from_trash() {
    local token="$1" trash_dir runtime
    trash_dir="$(runtime_trash_dir "$token")"
    runtime="$trash_dir/runtime"
    runtime_trash_is_owned "$token" || return 1
    validate_sensitive_path "$CANONICAL_SERVER_DIR" directory || return 1
    validate_sensitive_path "$runtime" directory || return 1
    [[ ! -e "$CANONICAL_SERVER_DIR" ]] && [[ ! -L "$CANONICAL_SERVER_DIR" ]] || return 1
    validate_runtime_installation_ownership \
        "$runtime" "$runtime/$INSTALLATION_OWNER_MARKER" || return 1
    python3 - "$runtime" "$CANONICAL_SERVER_DIR" "$trash_dir" <<'PY'
import os
import sys

runtime, active, envelope = sys.argv[1:]
os.rename(runtime, active)
for directory in (os.path.dirname(active), envelope):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
owner = os.path.join(envelope, "owner.json")
os.unlink(owner)
os.rmdir(envelope)
descriptor = os.open(os.path.dirname(envelope), os.O_RDONLY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

quarantine_runtime_path() {
    local source="$1" token="$2" marker_mode="${3:-transaction}" external_owner="${4:-}" trash_dir
    trash_dir="$(runtime_trash_dir "$token")"
    validate_sensitive_path "$source" directory || return 1
    validate_sensitive_path "$trash_dir" directory || return 1
    [[ -z "$external_owner" ]] || validate_sensitive_path "$external_owner" file || return 1
    python3 - "$source" "$trash_dir" "$token" "$TRANSACTION_MARKER" "$marker_mode" \
        "$external_owner" "$INSTALLATION_OWNER_MARKER" "$INSTALLATION_OWNER_VERSION" \
        "$CANONICAL_SERVER_DIR" <<'PY'
import json
import os
import re
import sys

source, trash, token, marker_name, marker_mode, external_owner, installation_marker, \
    installation_version, canonical = sys.argv[1:]
if not re.fullmatch(r"[0-9]+-[0-9a-f]+", token):
    raise SystemExit("invalid runtime trash token")
trash_root = os.path.dirname(trash)
os.makedirs(trash_root, mode=0o700, exist_ok=True)
if os.path.islink(trash_root):
    raise SystemExit("runtime trash root must not be a symlink")
if not os.path.exists(trash):
    os.mkdir(trash, mode=0o700)
elif not os.path.isdir(trash) or os.path.islink(trash):
    raise SystemExit("runtime trash envelope is unsafe")

owner = {"kind": "mcp-runtime-trash", "token": token}
owner_path = os.path.join(trash, "owner.json")
if os.path.exists(owner_path):
    if not os.path.isfile(owner_path) or os.path.islink(owner_path):
        raise SystemExit("runtime trash ownership state is unsafe")
    with open(owner_path, encoding="utf-8") as handle:
        if json.load(handle) != owner:
            raise SystemExit("runtime trash ownership mismatch")
else:
    temporary = os.path.join(trash, f".owner.{os.getpid()}.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(owner, handle, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, owner_path)
    trash_fd = os.open(trash, os.O_RDONLY)
    try:
        os.fsync(trash_fd)
    finally:
        os.close(trash_fd)

runtime = os.path.join(trash, "runtime")
if os.path.lexists(runtime):
    if not os.path.isdir(runtime) or os.path.islink(runtime) or os.path.lexists(source):
        raise SystemExit("runtime trash publication is inconsistent")
    raise SystemExit(0)
if not os.path.isdir(source) or os.path.islink(source):
    raise SystemExit("owned runtime source is missing or unsafe")
if marker_mode == "transaction":
    marker = os.path.join(source, marker_name)
    if not os.path.isfile(marker) or os.path.islink(marker):
        raise SystemExit("owned runtime marker is missing")
    with open(marker, encoding="utf-8") as handle:
        if handle.read().strip() != token:
            raise SystemExit("owned runtime marker mismatch")
elif marker_mode == "installation":
    internal = os.path.join(source, installation_marker)
    if not external_owner or not os.path.isfile(internal) or os.path.islink(internal):
        raise SystemExit("installation ownership marker is missing")
    if not os.path.isfile(external_owner) or os.path.islink(external_owner):
        raise SystemExit("external installation ownership marker is missing")
    with open(internal, encoding="utf-8") as handle:
        inside = json.load(handle)
    with open(external_owner, encoding="utf-8") as handle:
        outside = json.load(handle)
    expected_keys = {"kind", "version", "token", "path", "lockfile_sha256"}
    valid = (
        inside == outside and set(inside) == expected_keys and
        inside.get("kind") == "forgewright-mcp-runtime" and
        inside.get("version") == int(installation_version) and
        inside.get("path") == canonical == source and
        isinstance(inside.get("token"), str) and
        re.fullmatch(r"[0-9]+-[0-9a-f]{32}", inside["token"]) and
        isinstance(inside.get("lockfile_sha256"), str) and
        re.fullmatch(r"[0-9a-f]{64}", inside["lockfile_sha256"])
    )
    if not valid:
        raise SystemExit("installation ownership identity mismatch")
    import hashlib
    lockfile = os.path.join(source, "package-lock.json")
    server = os.path.join(source, "src", "index.ts")
    tsx = os.path.join(source, "node_modules", ".bin", "tsx")
    for path in (lockfile, server):
        if not os.path.isfile(path) or os.path.islink(path) or os.stat(path, follow_symlinks=False).st_nlink != 1:
            raise SystemExit(f"installation runtime payload is unsafe: {path}")
    node_modules = os.path.realpath(os.path.join(source, "node_modules"))
    resolved_tsx = os.path.realpath(tsx)
    if not os.path.isfile(resolved_tsx) or os.path.commonpath([node_modules, resolved_tsx]) != node_modules:
        raise SystemExit("installation runtime executable escapes ownership")
    with open(lockfile, "rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != inside["lockfile_sha256"]:
            raise SystemExit("installation runtime lockfile digest mismatch")
elif marker_mode != "journal":
    raise SystemExit("invalid runtime ownership mode")
os.rename(source, runtime)
for directory in {os.path.dirname(source), trash}:
    directory_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
PY
}

cleanup_owned_runtime_trash() {
    local canonical_parent cleanup_lock cleanup_token
    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    cleanup_lock="$canonical_parent/.mcp-trash-cleanup.lock"
    cleanup_token="$(new_owner_token)"
    acquire_owned_lock "$cleanup_lock" "$cleanup_token" || return 1
    if ! python3 - "$canonical_parent/.mcp-trash" <<'PY'
import json
import os
import re
import shutil
import signal
import sys

root = sys.argv[1]
if not os.path.exists(root):
    raise SystemExit(0)
if not os.path.isdir(root) or os.path.islink(root):
    raise SystemExit("runtime trash root is unsafe")
inject = os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURING_TRASH_CLEANUP") == "1"
injected = False
for name in sorted(os.listdir(root)):
    match = re.fullmatch(r"runtime-([0-9]+-[0-9a-f]+)", name)
    if not match:
        continue
    token = match.group(1)
    envelope = os.path.join(root, name)
    owner_path = os.path.join(envelope, "owner.json")
    if not os.path.isdir(envelope) or os.path.islink(envelope):
        continue
    try:
        if not os.path.isfile(owner_path) or os.path.islink(owner_path):
            continue
        with open(owner_path, encoding="utf-8") as handle:
            owner = json.load(handle)
    except (OSError, ValueError, TypeError):
        continue
    if owner != {"kind": "mcp-runtime-trash", "token": token}:
        continue
    runtime = os.path.join(envelope, "runtime")
    if os.path.lexists(runtime):
        if not os.path.isdir(runtime) or os.path.islink(runtime):
            continue
        children = sorted(os.listdir(runtime))
        if inject and not injected and children:
            first = os.path.join(runtime, children[0])
            if os.path.isdir(first) and not os.path.islink(first):
                shutil.rmtree(first)
            else:
                os.unlink(first)
            injected = True
            os.kill(os.getppid(), signal.SIGKILL)
            os._exit(137)
        shutil.rmtree(runtime)
    os.unlink(owner_path)
    os.rmdir(envelope)
try:
    os.rmdir(root)
except OSError:
    pass
PY
    then
        release_owned_lock "$cleanup_lock" "$cleanup_token" || true
        return 1
    fi
    release_owned_lock "$cleanup_lock" "$cleanup_token" || true
}

cleanup_transaction_journal() {
    local transaction_dir token canonical_parent
    transaction_dir="$(journal_value transaction_dir)"
    token="$(journal_value token)"
    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    if [[ "$transaction_dir" != "$canonical_parent/.transactions/$token" ]] || \
        [[ ! "$token" =~ ^[0-9]+-[0-9a-f]+$ ]]; then
        log_error "Refusing to clean an invalid MCP transaction journal"
        return 1
    fi
    rm -rf -- "$transaction_dir"
    rm -f -- "$TRANSACTION_JOURNAL"
    python3 - "$(dirname "$transaction_dir")" "$(dirname "$TRANSACTION_JOURNAL")" <<'PY'
import os
import sys
for directory in dict.fromkeys(sys.argv[1:]):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
}

restore_transaction_runtime() {
    local status token active stage had_active action marker canonical_parent
    status="$(journal_value status)"
    token="$(journal_value token)"
    active="$(journal_value runtime active)"
    stage="$(journal_value runtime stage)"
    had_active="$(journal_value runtime had_active)"
    action="$(journal_value runtime action)"
    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    marker="$active/$TRANSACTION_MARKER"
    if [[ "$active" != "$CANONICAL_SERVER_DIR" ]] || \
        [[ "$stage" != "$canonical_parent/.mcp-server.stage.$token" ]] || \
        [[ ! "$token" =~ ^[0-9]+-[0-9a-f]+$ ]]; then
        log_error "Refusing to recover an invalid MCP runtime transaction"
        return 1
    fi

    if [[ "$status" == "committed" ]]; then
        case "$action:$had_active" in
            exchange:true|restoring:true)
                if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$token" ]] && [[ -d "$stage" ]]; then
                    quarantine_runtime_path "$stage" "$token" journal || return 1
                elif [[ ! -e "$stage" ]] && runtime_trash_is_owned "$token"; then
                    :
                else
                    log_error "CRITICAL: committed runtime is not transaction-owned at recovery"
                    return 1
                fi
                ;;
            move:false)
                if [[ ! -f "$marker" ]] || [[ "$(cat "$marker")" != "$token" ]]; then
                    log_error "CRITICAL: committed runtime move lost transaction ownership"
                    return 1
                fi
                ;;
            uninstall:true)
                if [[ -e "$active" ]] || [[ -L "$active" ]] || ! runtime_trash_is_owned "$token"; then
                    log_error "CRITICAL: committed runtime uninstall lost quarantine ownership"
                    return 1
                fi
                return 0
                ;;
            uninstall:false)
                [[ ! -e "$active" ]] && [[ ! -L "$active" ]] || return 1
                return 0
                ;;
            *)
                log_error "CRITICAL: invalid committed runtime action: $action"
                return 1
                ;;
        esac
        rm -f -- "$marker"
        python3 - "$active" "$(dirname "$active")" <<'PY'
import os
import sys
for directory in sys.argv[1:]:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
        return 0
    fi
    case "$action:$had_active" in
        uninstall:false)
            [[ ! -e "$active" ]] && [[ ! -L "$active" ]] || return 1
            ;;
        uninstall:true)
            if [[ -d "$active" ]] && [[ ! -L "$active" ]]; then
                validate_runtime_installation_ownership \
                    "$active" "$active/$INSTALLATION_OWNER_MARKER" || return 1
            elif runtime_trash_is_owned "$token"; then
                restore_installation_runtime_from_trash "$token" || return 1
            else
                log_error "CRITICAL: uncommitted runtime uninstall lost ownership"
                return 1
            fi
            ;;
        exchange:true|restoring:true)
            if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$token" ]] && [[ -d "$stage" ]]; then
                journal_update runtime true restoring || return 1
                atomic_exchange_directories "$stage" "$active" || return 1
                if [[ ! -f "$stage/$TRANSACTION_MARKER" ]] || \
                    [[ "$(cat "$stage/$TRANSACTION_MARKER")" != "$token" ]]; then
                    log_error "CRITICAL: recovered runtime exchange lost transaction ownership"
                    return 1
                fi
                quarantine_runtime_path "$stage" "$token" transaction || return 1
            elif [[ -f "$stage/$TRANSACTION_MARKER" ]] && [[ "$(cat "$stage/$TRANSACTION_MARKER")" == "$token" ]]; then
                quarantine_runtime_path "$stage" "$token" transaction || return 1
            elif [[ "$action" == "restoring" ]] && [[ -d "$active" ]] && \
                [[ ! -e "$stage" ]] && [[ ! -e "$marker" ]] && runtime_trash_is_owned "$token"; then
                : # A prior recovery restored the old runtime and died before journal cleanup.
            else
                log_error "CRITICAL: runtime exchange is not transaction-owned at recovery"
                return 1
            fi
            if [[ "${FORGEWRIGHT_TEST_SIGKILL_AFTER_RECOVERY_RUNTIME:-0}" == "1" ]]; then
                kill -9 "$$"
            fi
            ;;
        move:false)
            if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$token" ]]; then
                quarantine_runtime_path "$active" "$token" transaction || return 1
            elif [[ -f "$stage/$TRANSACTION_MARKER" ]] && [[ "$(cat "$stage/$TRANSACTION_MARKER")" == "$token" ]]; then
                quarantine_runtime_path "$stage" "$token" transaction || return 1
            elif runtime_trash_is_owned "$token"; then
                :
            else
                log_error "CRITICAL: moved runtime is not transaction-owned at recovery"
                return 1
            fi
            ;;
        staged:*)
            if [[ -f "$stage/$TRANSACTION_MARKER" ]] && [[ "$(cat "$stage/$TRANSACTION_MARKER")" == "$token" ]]; then
                quarantine_runtime_path "$stage" "$token" transaction || return 1
            elif runtime_trash_is_owned "$token"; then
                :
            elif [[ ! -e "$stage" ]] && [[ ! -e "$marker" ]]; then
                : # The owner died before publishing its prepared stage directory.
            else
                log_error "CRITICAL: staged runtime is not transaction-owned at recovery"
                return 1
            fi
            ;;
        *)
            log_error "CRITICAL: unknown MCP runtime recovery action: $action"
            return 1
            ;;
    esac
}

recover_transaction_under_runtime_lock() {
    local acquire_file_locks="${1:-true}" quiet="${2:-false}" encoded path lock_dir owner_token
    local -a recovery_lock_dirs=() recovery_lock_tokens=()
    [[ -f "$TRANSACTION_JOURNAL" ]] || return 0
    [[ "$quiet" == "true" ]] || log_warn "Recovering interrupted MCP setup transaction"
    if [[ "$acquire_file_locks" == "true" ]]; then
        while IFS= read -r encoded; do
            [[ -n "$encoded" ]] || continue
            path="$(decode_path "$encoded")"
            lock_dir="$(config_lock_path "$path")"
            owner_token="$(new_owner_token)"
            acquire_owned_lock "$lock_dir" "$owner_token" || return 1
            recovery_lock_dirs+=("$lock_dir")
            recovery_lock_tokens+=("$owner_token")
        done < <(journal_file_paths)
    fi

    local status recovery_failed="false" index
    status="$(journal_value status)"
    restore_transaction_runtime || recovery_failed="true"
    if [[ "$status" != "committed" ]] && [[ "$recovery_failed" == "false" ]]; then
        restore_transaction_files || recovery_failed="true"
    fi
    if [[ "$recovery_failed" == "false" ]]; then
        cleanup_transaction_journal || recovery_failed="true"
    fi
    for ((index = ${#recovery_lock_dirs[@]} - 1; index >= 0; index -= 1)); do
        release_owned_lock "${recovery_lock_dirs[index]}" "${recovery_lock_tokens[index]}" || true
    done
    [[ "$recovery_failed" == "false" ]]
}

recover_pending_transaction() {
    if [[ -f "$TRANSACTION_JOURNAL" ]]; then
        local lock_dir="$(dirname "$CANONICAL_SERVER_DIR")/.mcp-server.setup.lock"
        local owner_token
        owner_token="$(new_owner_token)"
        acquire_owned_lock "$lock_dir" "$owner_token" || return 1
        if ! recover_transaction_under_runtime_lock true; then
            release_owned_lock "$lock_dir" "$owner_token"
            return 1
        fi
        release_owned_lock "$lock_dir" "$owner_token"
    fi
    cleanup_owned_runtime_trash
}

atomic_exchange_directories() {
    python3 - "$1" "$2" "${3:-}" <<'PY'
import ctypes
import os
import platform
import signal
import sys

left, right, label = sys.argv[1:]
system = platform.system()
libc = ctypes.CDLL(None, use_errno=True)
if system == "Darwin" and hasattr(libc, "renameatx_np"):
    result = libc.renameatx_np(-2, os.fsencode(left), -2, os.fsencode(right), 0x00000002)
elif system == "Linux" and hasattr(libc, "renameat2"):
    result = libc.renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 0x2)
else:
    raise SystemExit(f"atomic directory exchange is unsupported on {system}")
if result != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error), right)
if label:
    boundary = f"{label}:after-exchange"
    if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == boundary:
        os.kill(os.getppid(), signal.SIGKILL)
        os._exit(137)
    if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
        raise OSError(f"injected durability failure at {boundary}")
for directory in (left, right, os.path.dirname(left)):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
if label:
    boundary = f"{label}:after-parent"
    if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
        raise OSError(f"injected durability failure at {boundary}")
PY
}

check_atomic_exchange_support() {
    if [[ "${FORGEWRIGHT_TEST_UNSUPPORTED_ATOMIC:-0}" == "1" ]]; then
        log_error "Atomic directory exchange support was disabled for validation"
        return 1
    fi
    local parent left right
    parent="$(dirname "$CANONICAL_SERVER_DIR")"
    validate_sensitive_path "$CANONICAL_SERVER_DIR" directory || return 1
    mkdir -p "$parent"
    validate_sensitive_path "$CANONICAL_SERVER_DIR" directory || return 1
    left="$(mktemp -d "$parent/.atomic-check-left.XXXXXX")"
    right="$(mktemp -d "$parent/.atomic-check-right.XXXXXX")"
    printf 'left\n' > "$left/probe"
    printf 'right\n' > "$right/probe"
    if ! atomic_exchange_directories "$left" "$right"; then
        rm -rf -- "$left" "$right"
        log_error "Atomic directory exchange is unavailable for $parent"
        return 1
    fi
    if [[ "$(cat "$left/probe" 2>/dev/null)" != "right" ]] || \
        [[ "$(cat "$right/probe" 2>/dev/null)" != "left" ]]; then
        rm -rf -- "$left" "$right"
        log_error "Atomic directory exchange validation failed for $parent"
        return 1
    fi
    rm -rf -- "$left" "$right"
}



export_runtime_token() {
    if [[ -n "${FORGEWRIGHT_RUNTIME_TOKEN:-}" ]]; then
        return 0
    fi
    local internal="$CANONICAL_SERVER_DIR/$INSTALLATION_OWNER_MARKER"
    local external="$INSTALLATION_OWNER_FILE"

    if [[ -d "$CANONICAL_SERVER_DIR" ]] && [[ ! -L "$CANONICAL_SERVER_DIR" ]]; then
        # Upgrade or existing installation: must validate both markers and preserve token
        if [[ ! -f "$internal" ]] || [[ ! -f "$external" ]]; then
            log_error "Installation ownership markers are missing for existing runtime"
            return 1
        fi
        local token
        token="$(python3 - "$internal" "$external" <<'PY'
import json, sys, re
try:
    with open(sys.argv[1], encoding="utf-8") as f1, open(sys.argv[2], encoding="utf-8") as f2:
        inside = json.load(f1)
        outside = json.load(f2)
    if inside != outside or not inside.get("token") or not isinstance(inside["token"], str):
        sys.exit(1)
    if not re.fullmatch(r"[0-9]+-[0-9a-f]{32}", inside["token"]):
        sys.exit(1)
    print(inside["token"])
except Exception:
    sys.exit(1)
PY
)" || {
            log_error "Failed to validate canonical ownership markers"
            return 1
        }
        export FORGEWRIGHT_RUNTIME_TOKEN="$token"
    else
        # Fresh install
        export FORGEWRIGHT_RUNTIME_TOKEN="$(new_owner_token)"
    fi
    return 0
}

snapshot_ledger() {
    export FORGEWRIGHT_LEDGER_PATH="$HOME/.forgewright/.mcp-config-ledger.json"
    validate_sensitive_path "$FORGEWRIGHT_LEDGER_PATH" file || return 1
    export_runtime_token || return 1

    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        if ! transaction_original_file_state "$FORGEWRIGHT_LEDGER_PATH" >/dev/null 2>&1; then
            transaction_snapshot_file "$FORGEWRIGHT_LEDGER_PATH" || return 1
        fi
    else
        acquire_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || return 1
    fi

    if [[ -f "$FORGEWRIGHT_LEDGER_PATH" ]]; then
        python3 - "$FORGEWRIGHT_LEDGER_PATH" "$FORGEWRIGHT_RUNTIME_TOKEN" <<'PY' || return 1
import sys, json, os, re
path, token = sys.argv[1:3]
if not os.path.isfile(path) or os.path.islink(path):
    print("CRITICAL: Ledger path is unsafe", file=sys.stderr)
    sys.exit(1)
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    print("CRITICAL: Ledger is malformed JSON", file=sys.stderr)
    sys.exit(1)
if not isinstance(data, dict):
    print("CRITICAL: Ledger root is not an object", file=sys.stderr)
    sys.exit(1)
if set(data.keys()) != {"kind", "version", "runtime_token", "records"}:
    print("CRITICAL: Ledger schema mismatch", file=sys.stderr)
    sys.exit(1)
if data.get("kind") != "forgewright-mcp-ledger" or data.get("version") != 1:
    print("CRITICAL: Ledger version/kind mismatch", file=sys.stderr)
    sys.exit(1)
if data.get("runtime_token") != token:
    print("CRITICAL: Ledger runtime_token mismatch", file=sys.stderr)
    sys.exit(1)
if not isinstance(data.get("records"), dict):
    print("CRITICAL: Ledger records is not an object", file=sys.stderr)
    sys.exit(1)
allowed_roots = {
    os.path.realpath(os.environ.get("HOME", "")),
    os.path.realpath(os.environ.get("XDG_CONFIG_HOME", os.path.join(os.environ.get("HOME", ""), ".config"))),
}
for key, record in data["records"].items():
    if not isinstance(record, dict) or set(record.keys()) != {"canonical_path", "schema", "managed_name", "created", "owned", "normalized_value_sha256"}:
        print(f"CRITICAL: Ledger record {key} schema mismatch", file=sys.stderr)
        sys.exit(1)
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        print(f"CRITICAL: Ledger record {key} has non-deterministic key", file=sys.stderr)
        sys.exit(1)
    cpath = record.get("canonical_path", "")
    if (os.path.realpath(cpath) != cpath or ".." in cpath or
            not any(cpath.startswith(root + "/") for root in allowed_roots if root)):
        print(f"CRITICAL: Ledger record {key} has unsafe canonical_path", file=sys.stderr)
        sys.exit(1)
    if record.get("schema") not in [
        "cursor", "claude", "claude-desktop", "antigravity", "gemini",
        "toml", "qwen", "zed", "opencode", "json-config", "codex", "enablement",
    ]:
        print(f"CRITICAL: Ledger record {key} has unsupported schema", file=sys.stderr)
        sys.exit(1)
    if record.get("managed_name") not in ["forgewright", "gitnexus"]:
        print(f"CRITICAL: Ledger record {key} has invalid managed_name", file=sys.stderr)
        sys.exit(1)
    expected_key = __import__("hashlib").sha256(
        f'{cpath}:{record.get("schema")}:{record.get("managed_name")}'.encode()
    ).hexdigest()
    if key != expected_key:
        print(f"CRITICAL: Ledger record {key} is not bound to its ownership identity", file=sys.stderr)
        sys.exit(1)
    if not isinstance(record.get("created"), bool) or record.get("owned") is not True:
        print(f"CRITICAL: Ledger record {key} has non-boolean created/owned", file=sys.stderr)
        sys.exit(1)
    if not re.fullmatch(r"[a-f0-9]{64}", record.get("normalized_value_sha256", "")):
        print(f"CRITICAL: Ledger record {key} has invalid SHA256 format", file=sys.stderr)
        sys.exit(1)
sys.exit(0)
PY
    fi
    return 0
}

commit_ledger() {
    local ledger_tmp="$1"
    if [[ ! -s "$ledger_tmp" ]]; then
        if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
            if [[ -f "$FORGEWRIGHT_LEDGER_PATH" ]]; then
                transaction_expect_file "$FORGEWRIGHT_LEDGER_PATH" "$FORGEWRIGHT_LEDGER_PATH" || return 1
            else
                transaction_expect_absent "$FORGEWRIGHT_LEDGER_PATH" || return 1
            fi
        fi
        return 0
    fi
    if [[ -f "$FORGEWRIGHT_LEDGER_PATH" ]] && cmp -s "$ledger_tmp" "$FORGEWRIGHT_LEDGER_PATH"; then
        if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
            transaction_expect_file "$FORGEWRIGHT_LEDGER_PATH" "$ledger_tmp" || return 1
        fi
        return 0
    fi
    local source_state
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        source_state="$(transaction_current_file_state "$FORGEWRIGHT_LEDGER_PATH")" || return 1
    else
        source_state="$(capture_file_state "$FORGEWRIGHT_LEDGER_PATH")" || return 1
    fi
    chmod 600 "$ledger_tmp"
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        transaction_expect_file "$FORGEWRIGHT_LEDGER_PATH" "$ledger_tmp" || return 1
    fi
    durable_replace_file "$ledger_tmp" "$FORGEWRIGHT_LEDGER_PATH" "ledger" "$source_state" || return 1
}


write_json_mcp_config() {
    local target_config="$1" platform="$2" workspace="${3:-}"
    local patch_key="${4:-}" patch_value="${5:-}"
    local target_dir target_tmp gitnexus_path parser_module source_state lock_dir="" owner_token="" release_after="false"
    validate_sensitive_path "$target_config" file || return 1
    export_runtime_token || return 1
    if [[ "$TRANSACTION_ACTIVE" != "true" ]]; then
        lock_dir="$(config_lock_path "$target_config")"
        owner_token="$(new_owner_token)"
        acquire_owned_lock "$lock_dir" "$owner_token" || return 1
        release_after="true"
    fi
    snapshot_ledger || {
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        transaction_snapshot_file "$target_config" || return 1
    fi

    target_dir="$(dirname "$target_config")"
    mkdir -p "$target_dir"
    validate_sensitive_path "$target_config" file || {
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    if { [[ -e "$target_config" ]] || [[ -L "$target_config" ]]; } && \
        { [[ ! -f "$target_config" ]] || [[ -L "$target_config" ]]; }; then
        log_error "MCP config must be a regular, non-symlink file: $target_config"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi

    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        source_state="$(transaction_original_file_state "$target_config")" || return 1
    else
        if ! source_state="$(capture_file_state "$target_config")"; then
            release_owned_lock "$lock_dir" "$owner_token"
            return 1
        fi
    fi
    target_tmp="$(mktemp "$target_dir/.mcp-config.XXXXXX")"
    gitnexus_path="$(resolve_gitnexus_executable)"
    local ledger_tmp
    ledger_tmp="$(mktemp "$target_dir/.ledger.XXXXXX")"
    export FORGEWRIGHT_LEDGER_TMP="$ledger_tmp"
    if ! parser_module="$(jsonc_parser_module)"; then
        rm -f -- "$target_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        log_error "jsonc-parser production dependency is unavailable"
        return 1
    fi
    if ! node - "$target_config" "$target_tmp" "$platform" "$CANONICAL_TSX" \
        "$CANONICAL_SERVER_TS" "$gitnexus_path" "$workspace" "$patch_key" "$patch_value" \
        "$parser_module" <<'NODE'
const fs = require('fs');
const path = require('path');
const [inputPath, outputPath, platform, tsx, server, gitnexus, workspace, patchKey, patchValue, parserModule] = process.argv.slice(2);
const ledgerInputPath = fs.existsSync(inputPath) ? fs.realpathSync(inputPath) :
  path.join(fs.realpathSync(path.dirname(inputPath)), path.basename(inputPath));
const { applyEdits, modify, parse, parseTree, printParseErrorCode } = require(parserModule);
let raw = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '{}\n';
const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
if (bom) raw = raw.slice(1);
if (!raw.trim()) raw = '{}\n';
const parseConfig = (text) => {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const detail = errors.map((error) => `${printParseErrorCode(error.error)}@${error.offset}`).join(', ');
    throw new Error(`malformed JSONC: ${detail}`);
  }
  return value;
};
let config = parseConfig(raw);
if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('MCP config root must be an object');
const rootKey = platform === 'zed' ? 'context_servers' : platform === 'opencode' ? 'mcp' : 'mcpServers';
if (config[rootKey] !== undefined && (!config[rootKey] || Array.isArray(config[rootKey]) || typeof config[rootKey] !== 'object')) {
  throw new Error(`${rootKey} must be an object`);
}
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const indent = raw.match(/\r?\n([ \t]+)"/)?.[1] || '  ';
const formattingOptions = indent.includes('\t') ? { insertSpaces: false, tabSize: 1, eol } :
  { insertSpaces: true, tabSize: indent.length, eol };
const setValue = (path, value) => {
  raw = applyEdits(raw, modify(raw, path, value, { formattingOptions }));
};
const serversObj = config[rootKey] || {};
const ledgerPath = process.env.FORGEWRIGHT_LEDGER_PATH;
const ledgerTmp = process.env.FORGEWRIGHT_LEDGER_TMP;
const token = process.env.FORGEWRIGHT_RUNTIME_TOKEN;
let ledger = { kind: "forgewright-mcp-ledger", version: 1, runtime_token: token, records: {} };
if (ledgerPath && fs.existsSync(ledgerPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!data || data.kind !== "forgewright-mcp-ledger" || data.version !== 1 || data.runtime_token !== token || !data.records) throw new Error('Ledger malformed or token mismatch');
    ledger = data;
  } catch(e) {
    throw new Error('Ledger malformed or token mismatch');
  }
}
let ledgerChanged = false;
const crypto = require('crypto');
const getFingerprint = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

const fwDesired = platform === 'opencode' ? { type: 'local', command: [tsx, server], enabled: true } : { command: tsx, args: [server] };
if (platform === 'cursor') fwDesired.env = { FORGEWRIGHT_WORKSPACE: '${workspaceFolder}', AGENTS_WORKSPACE: '${workspaceFolder}' };
else if (workspace && platform !== 'opencode') fwDesired.env = { FORGEWRIGHT_WORKSPACE: workspace, AGENTS_WORKSPACE: workspace };
const gnDesired = platform === 'opencode' ? { type: 'local', command: [gitnexus, 'mcp'], enabled: true } : { command: gitnexus, args: ['mcp'] };

for (const managed of ['forgewright', 'gitnexus']) {
  const entry = serversObj[managed];
  const entryExists = Object.prototype.hasOwnProperty.call(serversObj, managed);
  const desired = managed === 'forgewright' ? fwDesired : gnDesired;
  const desiredFp = getFingerprint(desired);
  const recordHashKey = crypto.createHash('sha256').update(`${ledgerInputPath}:${platform}:${managed}`).digest('hex');
  if (entryExists) {
    const currFp = getFingerprint(entry);
    if (currFp === desiredFp) continue;
    const record = ledger.records[recordHashKey];
    if (!record || record.normalized_value_sha256 !== currFp) {
      throw new Error(`${managed} entry belongs to another client, failing closed`);
    }
  }
  ledger.records[recordHashKey] = { canonical_path: ledgerInputPath, schema: platform, managed_name: managed, created: true, owned: true, normalized_value_sha256: desiredFp };
  ledgerChanged = true;
}
if (ledgerChanged && ledgerTmp) fs.writeFileSync(ledgerTmp, JSON.stringify(ledger, null, 2));

const forgewright = {};
if (platform === 'opencode') {
  Object.assign(forgewright, { type: 'local', command: [tsx, server], enabled: true });
  setValue([rootKey, 'forgewright'], forgewright);
  setValue([rootKey, 'gitnexus'], { type: 'local', command: [gitnexus, 'mcp'], enabled: true });
} else {
  Object.assign(forgewright, { command: tsx, args: [server] });
  if (platform === 'cursor') {
    forgewright.env = { FORGEWRIGHT_WORKSPACE: '${workspaceFolder}', AGENTS_WORKSPACE: '${workspaceFolder}' };
  } else if (workspace) {
    forgewright.env = { FORGEWRIGHT_WORKSPACE: workspace, AGENTS_WORKSPACE: workspace };
  }
  setValue([rootKey, 'forgewright'], forgewright);
  setValue([rootKey, 'gitnexus'], { command: gitnexus, args: ['mcp'] });
}
if (platform !== 'zed' && platform !== 'opencode') {
  config = parseConfig(raw);
  for (const key of ['disabledMcpServers', 'disabled_mcp_servers']) {
    if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error(`${key} must be an array`);
    if (Array.isArray(config[key])) {
      const tree = parseTree(raw);
      const node = tree?.children?.find(c => c.children?.[0]?.value === key)?.children?.[1];
      if (node && node.type === 'array' && node.children) {
        const edits = [];
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child.value === 'forgewright' || child.value === 'gitnexus') {
            let start = child.offset;
            let end = child.offset + child.length;
            const before = raw.slice(0, start);
            const matchBefore = before.match(/,\s*$/);
            if (matchBefore) {
              start -= matchBefore[0].length;
            } else {
              const after = raw.slice(end);
              const matchAfter = after.match(/^\s*,/);
              if (matchAfter) {
                end += matchAfter[0].length;
              }
            }
            edits.push({ offset: start, length: end - start, content: '' });
          }
        }
        edits.sort((a, b) => a.offset - b.offset);
        const merged = [];
        for (const edit of edits) {
          if (merged.length > 0) {
            const last = merged[merged.length - 1];
            if (last.offset + last.length >= edit.offset) {
              const newEnd = Math.max(last.offset + last.length, edit.offset + edit.length);
              last.length = newEnd - last.offset;
              continue;
            }
          }
          merged.push(edit);
        }
        raw = applyEdits(raw, merged);
      }
    }
  }
}
if (patchKey) setValue([patchKey], patchValue);
config = parseConfig(raw);
const servers = config[rootKey];
const fw = servers?.forgewright;
const gn = servers?.gitnexus;
const valid = platform === 'opencode' ?
  fw?.type === 'local' && fw.enabled === true && JSON.stringify(fw.command) === JSON.stringify([tsx, server]) &&
    gn?.type === 'local' && gn.enabled === true && JSON.stringify(gn.command) === JSON.stringify([gitnexus, 'mcp']) :
  fw?.command === tsx && JSON.stringify(fw.args) === JSON.stringify([server]) &&
    gn?.command === gitnexus && JSON.stringify(gn.args) === JSON.stringify(['mcp']);
if (!valid) throw new Error('generated MCP JSONC entry failed structural verification');
fs.writeFileSync(outputPath, `${bom}${raw}`, { mode: 0o600 });
NODE
    then
        rm -f -- "$target_tmp" "$ledger_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        log_error "Refusing to overwrite malformed or structurally invalid JSON/JSONC MCP config: $target_config"
        return 1
    fi
    chmod 600 "$target_tmp"
    if ! transaction_expect_file "$target_config" "$target_tmp"; then
        rm -f -- "$target_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    if ! durable_replace_file "$target_tmp" "$target_config" "json-config" "$source_state"; then
        rm -f -- "$target_tmp" "$ledger_tmp"
        transaction_clear_expect_file "$target_config" || true
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    commit_ledger "$ledger_tmp" || {
        rm -f -- "$ledger_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    rm -f -- "$ledger_tmp"
    if [[ "$release_after" == "true" ]]; then
        release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
        release_owned_lock "$lock_dir" "$owner_token" || true
    fi
    log_ok "Updated $target_config"
}

write_gemini_enablement_config() {
    local target_config="$1" target_dir target_tmp source_state
    local lock_dir="" owner_token="" release_after="false"
    validate_sensitive_path "$target_config" file || return 1
    export_runtime_token || return 1
    if [[ "$TRANSACTION_ACTIVE" != "true" ]]; then
        lock_dir="$(config_lock_path "$target_config")"
        owner_token="$(new_owner_token)"
        acquire_owned_lock "$lock_dir" "$owner_token" || return 1
        release_after="true"
    fi
    snapshot_ledger || {
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        transaction_snapshot_file "$target_config" || return 1
    fi

    target_dir="$(dirname "$target_config")"
    mkdir -p "$target_dir"
    validate_sensitive_path "$target_config" file || {
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    if { [[ -e "$target_config" ]] || [[ -L "$target_config" ]]; } && \
        { [[ ! -f "$target_config" ]] || [[ -L "$target_config" ]]; }; then
        log_error "Gemini enablement config must be a regular, non-symlink file: $target_config"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi

    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        source_state="$(transaction_original_file_state "$target_config")" || return 1
    elif ! source_state="$(capture_file_state "$target_config")"; then
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    target_tmp="$(mktemp "$target_dir/.mcp-enablement.XXXXXX")"
    local ledger_tmp
    ledger_tmp="$(mktemp "$target_dir/.ledger.XXXXXX")"
    export FORGEWRIGHT_LEDGER_TMP="$ledger_tmp"
    if ! node - "$target_config" "$target_tmp" <<'NODE'
const fs = require('fs');
const path = require('path');
const [inputPath, outputPath] = process.argv.slice(2);
const ledgerInputPath = fs.existsSync(inputPath) ? fs.realpathSync(inputPath) :
  path.join(fs.realpathSync(path.dirname(inputPath)), path.basename(inputPath));
let config = {};
if (fs.existsSync(inputPath)) config = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!config || Array.isArray(config) || typeof config !== 'object') {
  throw new Error('Gemini MCP enablement root must be an object');
}

const ledgerPath = process.env.FORGEWRIGHT_LEDGER_PATH;
const ledgerTmp = process.env.FORGEWRIGHT_LEDGER_TMP;
const token = process.env.FORGEWRIGHT_RUNTIME_TOKEN;
let ledger = { kind: "forgewright-mcp-ledger", version: 1, runtime_token: token, records: {} };
if (ledgerPath && fs.existsSync(ledgerPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!data || data.kind !== "forgewright-mcp-ledger" || data.version !== 1 || data.runtime_token !== token || !data.records) throw new Error('Ledger malformed or token mismatch');
    ledger = data;
  } catch(e) {
    throw new Error('Ledger malformed or token mismatch');
  }
}
let ledgerChanged = false;

const crypto = require('crypto');
const enabledFingerprint = crypto.createHash('sha256').update('enabled').digest('hex');
for (const managed of ['forgewright', 'gitnexus']) {
  const matches = Object.keys(config).filter((key) => key.toLowerCase().trim() === managed);
  if (matches.length > 1) throw new Error(`duplicate ${managed} enablement entries`);
  const recordKey = crypto.createHash('sha256').update(`${ledgerInputPath}:enablement:${managed}`).digest('hex');
  const record = ledger.records[recordKey];
  if (record && record.normalized_value_sha256 !== enabledFingerprint) {
    throw new Error(`${managed} ownership record is malformed`);
  }
  if (matches.length === 1) {
    if (record) throw new Error(`${managed} entry was externally recreated, failing closed`);
    delete config[matches[0]];
  }
  if (!record || matches.length === 1) {
    ledger.records[recordKey] = { canonical_path: ledgerInputPath, schema: 'enablement', managed_name: managed, created: true, owned: true, normalized_value_sha256: enabledFingerprint };
    ledgerChanged = true;
  }
}
if (ledgerChanged && ledgerTmp) fs.writeFileSync(ledgerTmp, JSON.stringify(ledger, null, 2));
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE
    then
        rm -f -- "$target_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        log_error "Refusing to overwrite malformed Gemini MCP enablement config: $target_config"
        return 1
    fi
    chmod 600 "$target_tmp"
    if ! transaction_expect_file "$target_config" "$target_tmp"; then
        rm -f -- "$target_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    if ! durable_replace_file "$target_tmp" "$target_config" "gemini-enablement" "$source_state"; then
        rm -f -- "$target_tmp" "$ledger_tmp"
        transaction_clear_expect_file "$target_config" || true
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    commit_ledger "$ledger_tmp" || {
        rm -f -- "$ledger_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    rm -f -- "$ledger_tmp"
    if [[ "$release_after" == "true" ]]; then
        release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
        release_owned_lock "$lock_dir" "$owner_token" || true
    fi
    log_ok "Updated $target_config"
}

gemini_managed_servers_enabled() {
    local enablement_config="$1"
    [[ -f "$enablement_config" ]] || return 0
    node - "$enablement_config" <<'NODE' >/dev/null 2>&1
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!config || Array.isArray(config) || typeof config !== 'object') process.exit(1);
const managed = Object.keys(config).filter((key) =>
  ['forgewright', 'gitnexus'].includes(key.toLowerCase().trim()));
process.exit(managed.length === 0 ? 0 : 1);
NODE
}

prepare_toml_mcp_removal() {
    python3 - "$1" "$2" <<'PY'
import os
import stat
import sys
import tomllib

source, output = sys.argv[1:]
source = os.path.realpath(source)
with open(source, encoding="utf-8") as handle:
    raw = handle.read()
orig_parsed = tomllib.loads(raw)

import hashlib
import json
ledger_path = os.environ.get("FORGEWRIGHT_LEDGER_PATH")
ledger_tmp = os.environ.get("FORGEWRIGHT_LEDGER_TMP")
token = os.environ.get("FORGEWRIGHT_RUNTIME_TOKEN")
ledger = {"kind": "forgewright-mcp-ledger", "version": 1, "runtime_token": token, "records": {}}
ledger_source = ledger_tmp if ledger_tmp and os.path.isfile(ledger_tmp) and os.path.getsize(ledger_tmp) else ledger_path
if ledger_source and os.path.exists(ledger_source):
    try:
        with open(ledger_source, encoding="utf-8") as handle:
            data = json.load(handle)
        if (not data or data.get("kind") != "forgewright-mcp-ledger" or
                data.get("version") != 1 or data.get("runtime_token") != token or
                not isinstance(data.get("records"), dict)):
            raise ValueError
        ledger = data
    except Exception:
        raise SystemExit("Ledger malformed or token mismatch")

def fingerprint(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()

orig_servers = orig_parsed.get("mcp_servers", {})
if not isinstance(orig_servers, dict):
    raise SystemExit("mcp_servers must be a table")
owned_managed = set()
ledger_changed = False
for managed in ("forgewright", "gitnexus"):
    if managed not in orig_servers:
        continue
    record_key = hashlib.sha256(f"{source}:codex:{managed}".encode()).hexdigest()
    record = ledger["records"].get(record_key)
    if not record:
        continue
    if record.get("normalized_value_sha256") != fingerprint(orig_servers[managed]):
        raise SystemExit(f"{managed} entry was externally changed, failing closed")
    owned_managed.add(managed)
    ledger["records"].pop(record_key)
    ledger_changed = True

def parse_key(text):
    parts = []
    index = 0
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            break
        if text[index] in {'"', "'"}:
            quote = text[index]
            start = index
            index += 1
            escaped = False
            while index < len(text):
                char = text[index]
                index += 1
                if quote == '"' and escaped:
                    escaped = False
                elif quote == '"' and char == '\\':
                    escaped = True
                elif char == quote:
                    break
            else:
                raise ValueError("unterminated quoted TOML key")
            token = text[start:index]
            if quote == '"':
                import json
                parts.append(json.loads(token))
            else:
                parts.append(token[1:-1])
        else:
            start = index
            while index < len(text) and (text[index].isalnum() or text[index] in '_-'):
                index += 1
            if start == index:
                raise ValueError("invalid bare TOML key")
            parts.append(text[start:index])
        while index < len(text) and text[index].isspace():
            index += 1
        if index == len(text):
            break
        if text[index] != '.':
            raise ValueError("invalid dotted TOML key")
        index += 1
    return tuple(parts)

def header_path(line):
    stripped = line.lstrip()
    array = stripped.startswith('[[')
    if not stripped.startswith('['):
        return None
    opening = 2 if array else 1
    closing = ']]' if array else ']'
    quote = None
    escaped = False
    index = opening
    while index < len(stripped):
        char = stripped[index]
        if quote:
            if quote == '"' and escaped:
                escaped = False
            elif quote == '"' and char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            index += 1
            continue
        if stripped.startswith(closing, index):
            tail = stripped[index + len(closing):].strip()
            if tail and not tail.startswith('#'):
                raise ValueError("invalid TOML table suffix")
            return parse_key(stripped[opening:index])
        index += 1
    raise ValueError("unterminated TOML table")

def is_managed(path):
    return len(path) >= 2 and path[0] == 'mcp_servers' and path[1] in owned_managed

def line_end(index):
    newline = raw.find('\n', index)
    return len(raw) if newline < 0 else newline + 1

def assignment_span(start):
    index = start
    equal = None
    string = None
    triple = False
    escaped = False
    comment = False
    square = 0
    curly = 0
    while index < len(raw):
        if comment:
            if raw[index] == '\n':
                comment = False
                if equal is not None and square == 0 and curly == 0:
                    return equal, index + 1
            index += 1
            continue
        if string:
            char = raw[index]
            if string == '"' and escaped:
                escaped = False
                index += 1
                continue
            if string == '"' and char == '\\':
                escaped = True
                index += 1
                continue
            delimiter = string * (3 if triple else 1)
            if raw.startswith(delimiter, index):
                index += len(delimiter)
                string = None
                triple = False
                continue
            index += 1
            continue
        if raw.startswith('"""', index) or raw.startswith("'''", index):
            string = raw[index]
            triple = True
            index += 3
            continue
        char = raw[index]
        if char in {'"', "'"}:
            string = char
            triple = False
            index += 1
            continue
        if char == '#':
            comment = True
            index += 1
            continue
        if char == '[':
            square += 1
        elif char == ']':
            square -= 1
        elif char == '{':
            curly += 1
        elif char == '}':
            curly -= 1
        elif char == '=' and equal is None and square == 0 and curly == 0:
            equal = index
        elif char == '\n' and equal is not None and square == 0 and curly == 0:
            return equal, index + 1
        if square < 0 or curly < 0:
            raise ValueError("unbalanced TOML container")
        index += 1
    if equal is None:
        raise ValueError("TOML statement has no assignment")
    if string or square or curly:
        raise ValueError("unterminated TOML assignment")
    return equal, len(raw)

context = ()
remove = []
index = 0
while index < len(raw):
    end = line_end(index)
    line = raw[index:end]
    stripped = line.lstrip(' \t')
    if not stripped or stripped.startswith(('\n', '\r', '#')):
        index = end
        continue
    if stripped.startswith('['):
        table = header_path(line.rstrip('\r\n'))
        context = table
        if is_managed(table):
            remove.append((index, end))
        index = end
        continue
    equal, statement_end = assignment_span(index)
    key = parse_key(raw[index:equal])
    if is_managed(context) or is_managed(context + key):
        remove.append((index, statement_end))
    index = statement_end

result = raw
for start, end in reversed(remove):
    result = result[:start] + result[end:]
parsed = tomllib.loads(result)
servers = parsed.get('mcp_servers', {})
if not isinstance(servers, dict):
    raise SystemExit("mcp_servers must be a table")
if any(name in servers for name in ('forgewright', 'gitnexus')):
    print("Note: unowned managed TOML entries remain", file=sys.stderr)

if ledger_changed and ledger_tmp:
    with open(ledger_tmp, "w") as f: json.dump(ledger, f)

with open(output, 'w', encoding='utf-8') as handle:
    handle.write(result)
os.chmod(output, stat.S_IMODE(os.stat(source, follow_symlinks=False).st_mode))
PY
}

write_toml_mcp_config() {
    local target_config="$1" target_dir target_tmp clean_tmp gitnexus_path source_state
    local lock_dir="" owner_token="" release_after="false"
    validate_sensitive_path "$target_config" file || return 1
    export_runtime_token || return 1
    snapshot_ledger || return 1
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        transaction_snapshot_file "$target_config" || return 1
    else
        lock_dir="$(config_lock_path "$target_config")"
        owner_token="$(new_owner_token)"
        acquire_owned_lock "$lock_dir" "$owner_token" || return 1

        release_after="true"
    fi

    target_dir="$(dirname "$target_config")"
    mkdir -p "$target_dir"
    validate_sensitive_path "$target_config" file || {
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    if { [[ -e "$target_config" ]] || [[ -L "$target_config" ]]; } && \
        { [[ ! -f "$target_config" ]] || [[ -L "$target_config" ]]; }; then
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        log_error "MCP config must be a regular, non-symlink file: $target_config"
        return 1
    fi
    if [[ "$TRANSACTION_ACTIVE" == "true" ]]; then
        source_state="$(transaction_original_file_state "$target_config")" || return 1
    elif ! source_state="$(capture_file_state "$target_config")"; then
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    local ledger_tmp
    ledger_tmp="$(mktemp "$target_dir/.ledger.XXXXXX")"
    export FORGEWRIGHT_LEDGER_TMP="$ledger_tmp"
    clean_tmp="$(mktemp "$target_dir/.mcp-clean.XXXXXX")"
    target_tmp="$(mktemp "$target_dir/.mcp-config.XXXXXX")"
    if [[ -f "$target_config" ]]; then
        if ! prepare_toml_mcp_removal "$target_config" "$clean_tmp"; then
            rm -f -- "$clean_tmp" "$target_tmp" "$ledger_tmp"
            if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
            log_error "Refusing to overwrite malformed TOML MCP config: $target_config"
            return 1
        fi
    else
        : > "$clean_tmp"
    fi
    gitnexus_path="$(resolve_gitnexus_executable)"
    if ! python3 - "$clean_tmp" "$target_tmp" "$CANONICAL_TSX" \
        "$CANONICAL_SERVER_TS" "$gitnexus_path" "$target_config" <<'PY'
import json
import sys
import tomllib
import os

source, output, tsx, server, gitnexus, target_config = sys.argv[1:]
target_config = os.path.realpath(target_config)
ledger_path = os.environ.get("FORGEWRIGHT_LEDGER_PATH")
ledger_tmp = os.environ.get("FORGEWRIGHT_LEDGER_TMP")
token = os.environ.get("FORGEWRIGHT_RUNTIME_TOKEN")

ledger = {"kind": "forgewright-mcp-ledger", "version": 1, "runtime_token": token, "records": {}}
ledger_source = ledger_tmp if ledger_tmp and os.path.isfile(ledger_tmp) and os.path.getsize(ledger_tmp) else ledger_path
if ledger_source and os.path.exists(ledger_source):
    try:
        with open(ledger_source, "r") as f:
            data = json.load(f)
            if not data or data.get("kind") != "forgewright-mcp-ledger" or data.get("version") != 1 or data.get("runtime_token") != token or "records" not in data:
                raise SystemExit("Ledger malformed or token mismatch")
            ledger = data
    except SystemExit: raise
    except Exception: raise SystemExit("Ledger malformed or token mismatch")

with open(source, encoding="utf-8") as handle:
    original_text = handle.read()
prefix = original_text.rstrip()
parsed_prefix = tomllib.loads(original_text)
quoted = lambda value: json.dumps(value, ensure_ascii=True)
managed_sections = {
    "forgewright": f'''[mcp_servers.forgewright]
enabled = true
transport = {{ type = "stdio" }}
command = {quoted(tsx)}
args = [{quoted(server)}]
''',
    "gitnexus": f'''[mcp_servers.gitnexus]
enabled = true
transport = {{ type = "stdio" }}
command = {quoted(gitnexus)}
args = ["mcp"]
''',
}

import hashlib
fw_desired = {"enabled": True, "transport": {"type": "stdio"}, "command": tsx, "args": [server]}
gn_desired = {"enabled": True, "transport": {"type": "stdio"}, "command": gitnexus, "args": ["mcp"]}
ledger_changed = False
def fingerprint(obj): return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()

existing_servers = parsed_prefix.get("mcp_servers", {})
if not isinstance(existing_servers, dict):
    raise SystemExit("mcp_servers must be a table")
created = []
for managed, desired in [("forgewright", fw_desired), ("gitnexus", gn_desired)]:
    if managed in existing_servers:
        if existing_servers[managed] != desired:
            raise SystemExit(f"unowned {managed} entry conflicts with the desired configuration")
        continue
    created.append(managed)
    record_key = hashlib.sha256(f"{target_config}:codex:{managed}".encode()).hexdigest()
    ledger["records"][record_key] = {"canonical_path": target_config, "schema": "codex", "managed_name": managed, "created": True, "owned": True, "normalized_value_sha256": fingerprint(desired)}
    ledger_changed = True

managed_text = "\n".join(managed_sections[name].rstrip() for name in created)
result = original_text if not managed_text else (
    f"{prefix}\n\n{managed_text}" if prefix else managed_text
)

if ledger_changed and ledger_tmp:
    with open(ledger_tmp, "w") as f: json.dump(ledger, f)

parsed = tomllib.loads(result)
servers = parsed.get("mcp_servers", {})
fw = servers.get("forgewright", {})
gn = servers.get("gitnexus", {})
if not (fw.get("enabled") is True and fw.get("command") == tsx and fw.get("args") == [server]):
    raise SystemExit("generated Forgewright TOML entry failed verification")
if not (gn.get("enabled") is True and gn.get("command") == gitnexus and gn.get("args") == ["mcp"]):
    raise SystemExit("generated GitNexus TOML entry failed verification")
with open(output, "w", encoding="utf-8") as handle:
    handle.write(result)
PY
    then
        rm -f -- "$clean_tmp" "$target_tmp" "$ledger_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        log_error "Refusing to overwrite malformed TOML MCP config: $target_config"
        return 1
    fi
    rm -f -- "$clean_tmp"
    chmod 600 "$target_tmp"
    if ! transaction_expect_file "$target_config" "$target_tmp"; then
        rm -f -- "$target_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    if ! durable_replace_file "$target_tmp" "$target_config" "toml-config" "$source_state"; then
        rm -f -- "$target_tmp" "$ledger_tmp"
        transaction_clear_expect_file "$target_config" || true
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    fi
    commit_ledger "$ledger_tmp" || {
        rm -f -- "$ledger_tmp"
        if [[ "$release_after" == "true" ]]; then
            release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
            release_owned_lock "$lock_dir" "$owner_token" || true
        fi
        return 1
    }
    rm -f -- "$ledger_tmp"
    if [[ "$release_after" == "true" ]]; then
        release_owned_lock "$(config_lock_path "$FORGEWRIGHT_LEDGER_PATH")" "$FORGEWRIGHT_RUNTIME_TOKEN" || true
        release_owned_lock "$lock_dir" "$owner_token" || true
    fi
    log_ok "Updated $target_config"
}

CANONICAL_STAGE_DIR=""
CANONICAL_LOCK_DIR=""
CANONICAL_LOCK_TOKEN=""

rollback_runtime_transaction() {
    trap - EXIT HUP INT TERM
    if [[ "$TRANSACTION_ACTIVE" == "true" ]] && [[ -f "$TRANSACTION_JOURNAL" ]]; then
        recover_transaction_under_runtime_lock false || \
            log_error "CRITICAL: interrupted MCP transaction requires recovery"
    fi
    release_transaction_file_locks
    if [[ -n "$CANONICAL_LOCK_DIR" ]] && [[ -n "$CANONICAL_LOCK_TOKEN" ]]; then
        release_owned_lock "$CANONICAL_LOCK_DIR" "$CANONICAL_LOCK_TOKEN" || true
    fi
    CANONICAL_STAGE_DIR=""
    CANONICAL_LOCK_TOKEN=""
    TRANSACTION_ACTIVE="false"
    TRANSACTION_DIR=""
    TRANSACTION_TOKEN=""
    cleanup_owned_runtime_trash || log_warn "Deferred runtime trash cleanup until the next invocation"
}

ensure_transaction_payload_durable() {
    python3 - "$TRANSACTION_JOURNAL" "$TRANSACTION_MARKER" <<'PY'
import hashlib
import json
import os
import signal
import stat
import sys

journal, marker_name = sys.argv[1:]
with open(journal, encoding="utf-8") as handle:
    data = json.load(handle)

def digest(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()

def fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

for item in data["files"]:
    path = item["path"]
    expected = item.get("expected_sha256")
    if item.get("expected_absent"):
        if os.path.lexists(path):
            raise SystemExit(f"transaction absent payload was recreated: {path}")
        fsync_dir(os.path.dirname(path))
        continue
    if not expected or not os.path.isfile(path) or os.path.islink(path):
        raise SystemExit(f"transaction payload is missing or unsafe: {path}")
    if os.stat(path, follow_symlinks=False).st_nlink != 1 or digest(path) != expected:
        raise SystemExit(f"transaction payload changed before commit: {path}")
    with open(path, "rb") as handle:
        os.fsync(handle.fileno())
    fsync_dir(os.path.dirname(path))

active = data["runtime"]["active"]
token = data["token"]
marker = os.path.join(active, marker_name)
if not os.path.isdir(active) or os.path.islink(active):
    raise SystemExit("published runtime is missing or unsafe")
if not os.path.isfile(marker) or os.path.islink(marker):
    raise SystemExit("published runtime ownership marker is missing")
with open(marker, encoding="utf-8") as handle:
    if handle.read().strip() != token:
        raise SystemExit("published runtime ownership marker mismatch")
for current, directories, files in os.walk(active, topdown=False, followlinks=False):
    for name in files:
        path = os.path.join(current, name)
        metadata = os.lstat(path)
        if stat.S_ISREG(metadata.st_mode):
            with open(path, "rb") as handle:
                os.fsync(handle.fileno())
        elif not stat.S_ISLNK(metadata.st_mode):
            raise SystemExit(f"unsupported runtime payload type: {path}")
    for name in directories:
        path = os.path.join(current, name)
        if not os.path.islink(path):
            fsync_dir(path)
    fsync_dir(current)
fsync_dir(os.path.dirname(active))

boundary = "commit:before-journal"
if os.environ.get("FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT") == boundary:
    os.kill(os.getppid(), signal.SIGKILL)
    os._exit(137)
if os.environ.get("FORGEWRIGHT_TEST_DURABILITY_FAIL_AT") == boundary:
    raise OSError(f"injected durability failure at {boundary}")
PY
}

commit_runtime_transaction() {
    local lock_dir="$CANONICAL_LOCK_DIR" lock_token="$CANONICAL_LOCK_TOKEN"
    ensure_transaction_payload_durable || return 1
    journal_update status committed || return 1
    if ! recover_transaction_under_runtime_lock false true; then
        return 1
    fi
    trap - EXIT HUP INT TERM
    release_transaction_file_locks
    CANONICAL_STAGE_DIR=""
    CANONICAL_LOCK_TOKEN=""
    TRANSACTION_ACTIVE="false"
    TRANSACTION_DIR=""
    TRANSACTION_TOKEN=""
    release_owned_lock "$lock_dir" "$lock_token" || \
        log_warn "Published successfully, but the setup lock could not be released cleanly"
    cleanup_owned_runtime_trash || log_warn "Deferred runtime trash cleanup until the next invocation"
}

sync_canonical_server() {
    local src_dir="${FORGEWRIGHT_DIR}/mcp" canonical_parent
    if [[ ! -d "$src_dir" ]]; then
        log_error "Source MCP server not found: $src_dir"
        return 1
    fi

    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    CANONICAL_LOCK_DIR="${canonical_parent}/.mcp-server.setup.lock"
    CANONICAL_LOCK_TOKEN="$(new_owner_token)"
    acquire_owned_lock "$CANONICAL_LOCK_DIR" "$CANONICAL_LOCK_TOKEN" || return 1
    if ! recover_transaction_under_runtime_lock true; then
        release_owned_lock "$CANONICAL_LOCK_DIR" "$CANONICAL_LOCK_TOKEN"
        return 1
    fi
    initialize_runtime_transaction || {
        release_owned_lock "$CANONICAL_LOCK_DIR" "$CANONICAL_LOCK_TOKEN"
        return 1
    }
    trap rollback_runtime_transaction EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [[ -n "${FORGEWRIGHT_TEST_HOLD_RUNTIME_LOCK_SECONDS:-}" ]]; then
        sleep "$FORGEWRIGHT_TEST_HOLD_RUNTIME_LOCK_SECONDS"
    fi

    log_step "Staging canonical MCP server..."
    local prepared_stage="$TRANSACTION_DIR/stage"
    mkdir -m 700 "$prepared_stage"
    printf '%s\n' "$TRANSACTION_TOKEN" > "$prepared_stage/$TRANSACTION_MARKER"
    python3 - "$prepared_stage/$TRANSACTION_MARKER" <<'PY'
import os
import sys
with open(sys.argv[1], "rb") as handle:
    os.fsync(handle.fileno())
directory_fd = os.open(os.path.dirname(sys.argv[1]), os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
    durable_publish_directory "$prepared_stage" "$CANONICAL_STAGE_DIR" "runtime-stage" || return 1

    # The staging directory starts empty, so both copy paths produce an exact
    # source mirror without ever deleting files from the active runtime.
    if [[ "${FORGEWRIGHT_FORCE_PYTHON_SYNC:-0}" != "1" ]] && command -v rsync >/dev/null 2>&1; then
        rsync -a --exclude='node_modules' --exclude='.forgewright' \
            "$src_dir/" "$CANONICAL_STAGE_DIR/"
    else
        python3 - "$src_dir" "$CANONICAL_STAGE_DIR" <<'PYEOF'
from pathlib import Path
import shutil
import sys

source, destination = map(Path, sys.argv[1:])
preserved = {"node_modules", ".forgewright", ".forgewright-transaction-owner"}
for path in source.iterdir():
    if path.name in preserved:
        continue
    target = destination / path.name
    if path.is_dir() and not path.is_symlink():
        shutil.copytree(path, target, symlinks=True)
    else:
        shutil.copy2(path, target, follow_symlinks=False)
PYEOF
    fi

    if [[ -d "$CANONICAL_SERVER_DIR/.forgewright" ]]; then
        cp -a "$CANONICAL_SERVER_DIR/.forgewright" "$CANONICAL_STAGE_DIR/"
    fi

    if [[ ! -s "$CANONICAL_STAGE_DIR/package-lock.json" ]]; then
        log_error "Tracked MCP package lock is missing or empty: $src_dir/package-lock.json"
        return 1
    fi

    log_info "  Installing dependencies from package-lock.json..."
    if ! (cd "$CANONICAL_STAGE_DIR" && npm ci --silent); then
        log_error "npm ci failed in staged MCP runtime"
        return 1
    fi

    local lock_digest marker="$CANONICAL_STAGE_DIR/node_modules/.forgewright-package-lock.sha256"
    if command -v sha256sum >/dev/null 2>&1; then
        lock_digest="$(sha256sum "$CANONICAL_STAGE_DIR/package-lock.json" | awk '{print $1}')"
    else
        lock_digest="$(shasum -a 256 "$CANONICAL_STAGE_DIR/package-lock.json" | awk '{print $1}')"
    fi
    if [[ ! "$lock_digest" =~ ^[0-9a-fA-F]{64}$ ]]; then
        log_error "Could not compute a strict package-lock digest"
        return 1
    fi
    cat > "$marker" <<EOF
format=1
installer=npm-ci
lockfile_sha256=$lock_digest
node=$(node --version)
npm=$(npm --version)
EOF
    if [[ ! -s "$marker" ]] || ! grep -Eq '^lockfile_sha256=[0-9a-fA-F]{64}$' "$marker"; then
        log_error "Dependency installation marker is invalid"
        return 1
    fi

    if [[ ! -x "$CANONICAL_STAGE_DIR/node_modules/.bin/tsx" ]]; then
        log_error "Staged tsx executable missing"
        return 1
    fi
    if ! (cd "$CANONICAL_STAGE_DIR" && npm run build --silent); then
        log_error "Failed to build staged MCP server"
        return 1
    fi

    if [[ ! -f "$CANONICAL_STAGE_DIR/src/index.ts" ]] || \
        [[ ! -f "$CANONICAL_STAGE_DIR/build/runtime/tool-execution-gateway.js" ]] || \
        ! (cd "$CANONICAL_STAGE_DIR" && npm ls --silent >/dev/null 2>&1); then
        log_error "Staged MCP runtime validation failed"
        return 1
    fi

    export_runtime_token || return 1
    python3 - "$CANONICAL_STAGE_DIR/$INSTALLATION_OWNER_MARKER" "$FORGEWRIGHT_RUNTIME_TOKEN" \
        "$INSTALLATION_OWNER_VERSION" "$CANONICAL_SERVER_DIR" "$lock_digest" <<'PY'
import json
import os
import sys

path, token, version, runtime, lock_digest = sys.argv[1:]
owner = {
    "kind": "forgewright-mcp-runtime",
    "version": int(version),
    "token": token,
    "path": runtime,
    "lockfile_sha256": lock_digest.lower(),
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(owner, handle, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
directory = os.open(os.path.dirname(path), os.O_RDONLY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY

    log_ok "Canonical MCP server staged and validated"
}

publish_canonical_server() {
    durability_sync_tree "$CANONICAL_STAGE_DIR" "runtime-payload" || return 1
    if [[ -e "$CANONICAL_SERVER_DIR" ]]; then
        [[ -d "$CANONICAL_SERVER_DIR" ]] && [[ ! -L "$CANONICAL_SERVER_DIR" ]] || return 1
        if ! validate_runtime_installation_ownership "$CANONICAL_SERVER_DIR" "$CANONICAL_SERVER_DIR/$INSTALLATION_OWNER_MARKER" ""; then
            log_error "Unmarked/foreign canonical runtime detected. Failing closed byte-identically."
            return 1
        fi
        journal_update runtime true exchange || return 1
        atomic_exchange_directories "$CANONICAL_STAGE_DIR" "$CANONICAL_SERVER_DIR" \
            "runtime-publication" || return 1
    else
        journal_update runtime false move || return 1
        durable_publish_directory "$CANONICAL_STAGE_DIR" "$CANONICAL_SERVER_DIR" \
            "runtime-publication" || return 1
    fi
    if [[ "${FORGEWRIGHT_TEST_SIGKILL_AFTER_EXCHANGE:-0}" == "1" ]]; then
        kill -9 "$$"
    fi
    log_ok "Canonical MCP server published atomically → $CANONICAL_SERVER_DIR"
}

publish_runtime_ownership() {
    local internal="$CANONICAL_SERVER_DIR/$INSTALLATION_OWNER_MARKER"
    local owner_dir owner_tmp source_state
    validate_runtime_installation_ownership "$CANONICAL_SERVER_DIR" "$internal" || return 1
    transaction_snapshot_file "$INSTALLATION_OWNER_FILE" || return 1
    source_state="$(transaction_original_file_state "$INSTALLATION_OWNER_FILE")" || return 1
    owner_dir="$(dirname "$INSTALLATION_OWNER_FILE")"
    validate_sensitive_path "$INSTALLATION_OWNER_FILE" file || return 1
    mkdir -p "$owner_dir"
    validate_sensitive_path "$INSTALLATION_OWNER_FILE" file || return 1
    owner_tmp="$(mktemp "$owner_dir/.mcp-installation.XXXXXX")"
    cp -p -- "$internal" "$owner_tmp"
    chmod 600 "$owner_tmp"
    transaction_expect_file "$INSTALLATION_OWNER_FILE" "$owner_tmp" || {
        rm -f -- "$owner_tmp"
        return 1
    }
    if ! durable_replace_file "$owner_tmp" "$INSTALLATION_OWNER_FILE" \
        "runtime-ownership" "$source_state"; then
        rm -f -- "$owner_tmp"
        transaction_clear_expect_file "$INSTALLATION_OWNER_FILE" || true
        return 1
    fi
}

publish_manifest() {
    local cursor_path="${1:-}" claude_path="${2:-}" claude_desktop_path="${3:-}"
    local antigravity_path="${4:-}" codex_path="${5:-}" gemini_path="${6:-}"
    local zed_path="${7:-}" opencode_path="${8:-}"
    local qwen_path="${9:-}"
    local manifest="${PROJECT_ROOT}/.antigravity/mcp-manifest.json"
    local manifest_dir manifest_tmp existing_manifest generated_at fw_version gitnexus_path source_state

    validate_sensitive_path "$manifest" file || return 1
    transaction_snapshot_file "$manifest" || return 1
    source_state="$(transaction_original_file_state "$manifest")" || return 1
    [[ "${FORGEWRIGHT_TEST_FAIL_MANIFEST:-0}" != "1" ]] || return 1
    manifest_dir="$(dirname "$manifest")"
    mkdir -p "$manifest_dir"
    validate_sensitive_path "$manifest" file || return 1
    if { [[ -e "$manifest" ]] || [[ -L "$manifest" ]]; } && \
        { [[ ! -f "$manifest" ]] || [[ -L "$manifest" ]]; }; then
        log_error "MCP manifest target must be a regular, non-symlink file: $manifest"
        return 1
    fi

    manifest_tmp="$(mktemp "$manifest_dir/.mcp-manifest.XXXXXX")"
    existing_manifest=""
    [[ -f "$manifest" ]] && existing_manifest="$manifest"
    generated_at="${FORGEWRIGHT_MANIFEST_GENERATED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    fw_version="$(cat "${FORGEWRIGHT_DIR}/VERSION" 2>/dev/null || echo "8.0.0")"
    gitnexus_path="$(resolve_gitnexus_executable)"

    if ! node - "$manifest_tmp" "$existing_manifest" "$PROJECT_ROOT" "$fw_version" \
        "$HOME/.forgewright" "$CANONICAL_SERVER_TS" "$gitnexus_path" "$generated_at" \
        "$cursor_path" "$claude_path" "$claude_desktop_path" "$antigravity_path" \
        "$codex_path" "$gemini_path" "$zed_path" "$opencode_path" "$qwen_path" <<'NODE'
const fs = require('fs');
const [
  outputPath, existingPath, workspace, version, canonical, serverPath,
  gitnexusCommand, generatedAt, cursor, claudeCode, claudeDesktop,
  antigravity, codex, gemini, zed, opencode, qwen,
] = process.argv.slice(2);
const platforms = {};
for (const [name, path] of Object.entries({
  cursor, claude_code: claudeCode, claude_desktop: claudeDesktop,
  antigravity, codex, gemini, qwen, zed, opencode,
})) {
  if (path) platforms[name] = path;
}
const manifest = {
  manifest_version: '1.0',
  workspace,
  forgewright: { version, canonical, server: serverPath },
  servers: [
    { name: 'forgewright', type: 'forgewright-mcp-server', path: serverPath, enabled: true, auto_start: true },
    { name: 'gitnexus', type: 'gitnexus', command: gitnexusCommand, args: ['mcp'], enabled: true, auto_start: true },
  ],
  settings: { mcp_compatibility: 'loose', workspace_detection: 'git-root' },
  platforms,
  generated_at: generatedAt,
};
function semanticJson(value, atRoot = true) {
  if (Array.isArray(value)) return value.map((item) => semanticJson(item, false));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !(atRoot && key === 'generated_at'))
    .sort()
    .map((key) => [key, semanticJson(value[key], false)]));
}
if (existingPath) {
  try {
    const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    if (JSON.stringify(semanticJson(existing)) === JSON.stringify(semanticJson(manifest)) &&
        typeof existing.generated_at === 'string' && existing.generated_at) {
      manifest.generated_at = existing.generated_at;
    }
  } catch {}
}
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
    then
        rm -f -- "$manifest_tmp"
        return 1
    fi
    chmod 644 "$manifest_tmp"
    if ! transaction_expect_file "$manifest" "$manifest_tmp"; then
        rm -f -- "$manifest_tmp"
        return 1
    fi
    if ! durable_replace_file "$manifest_tmp" "$manifest" "manifest" "$source_state"; then
        rm -f -- "$manifest_tmp"
        transaction_clear_expect_file "$manifest" || true
        return 1
    fi
    log_ok "Manifest published at $manifest"
}

# ─── Platform: Cursor ──────────────────────────────────────────────────────────

CURSOR_CONFIG=""

setup_cursor() {
    CURSOR_CONFIG="$HOME/.cursor/mcp.json"
    log_step "Setting up Cursor MCP..."

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    write_json_mcp_config "$CURSOR_CONFIG" cursor || return 1
    CONFIGURED_CURSOR="$CURSOR_CONFIG"
    log_info "  forgewright → canonical tsx (~/.forgewright/mcp-server/)"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Platform: Claude Code ─────────────────────────────────────────────────────

CLAUDE_CODE_CONFIG=""

setup_claude_code() {
    CLAUDE_CODE_CONFIG="$HOME/.claude.json"
    log_step "Setting up Claude Code MCP..."

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    write_json_mcp_config "$CLAUDE_CODE_CONFIG" claude || return 1
    CONFIGURED_CLAUDE_CODE="$CLAUDE_CODE_CONFIG"
    log_info "  forgewright → canonical tsx (~/.forgewright/mcp-server/)"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

setup_claude_desktop() {
    local claude_desktop_config
    claude_desktop_config="$(claude_desktop_config_path)"
    log_step "Setting up Claude Desktop MCP..."
    canonical_candidate_ready || return 1
    write_json_mcp_config "$claude_desktop_config" claude-desktop || return 1
    CONFIGURED_CLAUDE_DESKTOP="$claude_desktop_config"
    log_info "  forgewright → canonical tsx (~/.forgewright/mcp-server/)"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Platform: Antigravity ─────────────────────────────────────────────────────

ANTIGRAVITY_CONFIG=""

setup_antigravity() {
    log_step "Setting up Antigravity MCP..."

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    ANTIGRAVITY_CLI_CONFIG="$HOME/.gemini/config/mcp_config.json"
    write_json_mcp_config "$ANTIGRAVITY_CLI_CONFIG" antigravity "$PROJECT_ROOT" || return 1
    CONFIGURED_ANTIGRAVITY="$ANTIGRAVITY_CLI_CONFIG"

    # Find existing Antigravity MCP server folder for forgewright
    local ag_server_dir=""

    if [[ -d "$HOME/.cursor/projects" ]]; then
        # Look for user-forgewright server directory
        while IFS= read -r -d '' dir; do
            if [[ -d "${dir}/tools" ]] && [[ -f "${dir}/SERVER_METADATA.json" ]]; then
                # Check if it's the forgewright server
                local meta
                meta=$(cat "${dir}/SERVER_METADATA.json" 2>/dev/null)
                if echo "$meta" | grep -q "forgewright"; then
                    ag_server_dir="$dir"
                    break
                fi
            fi
        done < <(find "$HOME/.cursor/projects" -type d -name "user-forgewright" -print0 2>/dev/null)
    fi

    if [[ -z "$ag_server_dir" ]]; then
        log_warn "Antigravity forgewright server not found in ~/.cursor/projects/"
        log_info "Looking for: ~/.cursor/projects/<hash>/mcps/user-forgewright/"
        log_info "You may need to reinstall the Antigravity plugin to register the server."
        ANTIGRAVITY_CONFIG="not_found"
        return 0
    fi

    ANTIGRAVITY_CONFIG="$ag_server_dir"
    log_ok "Found Antigravity server: $ag_server_dir"

    # The Antigravity launcher also uses CANONICAL_SERVER_TS
    local launcher="${ag_server_dir}/launcher.sh" launcher_tmp launcher_state
    if [[ ! -f "$launcher" ]] || [[ "${force:-}" == "true" ]]; then
        validate_sensitive_path "$launcher" file || return 1
        transaction_snapshot_file "$launcher" || return 1
        launcher_state="$(transaction_original_file_state "$launcher")" || return 1
        launcher_tmp="$(mktemp "$ag_server_dir/.launcher.XXXXXX")"
        # Create launcher that uses the CANONICAL MCP server (never a submodule path)
        cat > "$launcher_tmp" <<LAUNCHER_EOF
#!/usr/bin/env bash
# Antigravity Forgewright MCP Launcher
# Uses CANONICAL server at ~/.forgewright/mcp-server/ (never a submodule path)
set -euo pipefail

# Auto-detect workspace
if [[ -n "\${FORGEWRIGHT_WORKSPACE:-}" ]]; then
    WORKSPACE="\$FORGEWRIGHT_WORKSPACE"
elif [[ -n "\${MCP_WORKSPACE_ROOT:-}" ]]; then
    WORKSPACE="\$MCP_WORKSPACE_ROOT"
elif [[ -d ".git" ]]; then
    WORKSPACE="\$(pwd)"
else
    WORKSPACE="$PROJECT_ROOT"
fi

export FORGEWRIGHT_WORKSPACE="\$WORKSPACE"
export FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR"

exec "$CANONICAL_TSX" "$CANONICAL_SERVER_TS"
LAUNCHER_EOF
        chmod 755 "$launcher_tmp"
        transaction_expect_file "$launcher" "$launcher_tmp" || {
            rm -f -- "$launcher_tmp"
            return 1
        }
        durable_replace_file "$launcher_tmp" "$launcher" "antigravity-launcher" \
            "$launcher_state" || {
            rm -f -- "$launcher_tmp"
            transaction_clear_expect_file "$launcher" || true
            return 1
        }
        log_ok "Created Antigravity launcher: $launcher"
    fi

    log_ok "Antigravity MCP setup complete"
    log_info "  Server dir: $ag_server_dir"
    log_info "  Workspace: auto-detected from git root"
    if [[ ! -x "$launcher" ]] || ! grep -Fq "$CANONICAL_TSX" "$launcher" || \
        ! grep -Fq "$CANONICAL_SERVER_TS" "$launcher"; then
        log_error "Antigravity launcher failed verification: $launcher"
        return 1
    fi
}

# ─── Platform: OpenAI Codex CLI ─────────────────────────────────────────────

CODEX_CONFIG=""

setup_codex() {
    CODEX_CONFIG="$HOME/.codex/config.toml"
    log_step "Setting up OpenAI Codex CLI MCP..."

    # Check if Codex CLI is installed
    if ! command -v codex &>/dev/null; then
        log_warn "Codex CLI not found in PATH"
        log_info "  Install: https://openai.com/index/openai-codex"
        log_info "  Or: npm install -g @openai/codex"
        return 0
    fi

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    write_toml_mcp_config "$CODEX_CONFIG" || return 1
    has_canonical_mcp_config "$CODEX_CONFIG" || return 1
    mcp_config_has_enabled_entry "$CODEX_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp || return 1
    CONFIGURED_CODEX="$CODEX_CONFIG"
    log_info "  forgewright → canonical tsx ~/.forgewright/mcp-server/"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Platform: Google Gemini CLI ───────────────────────────────────────────

GEMINI_CONFIG=""
GEMINI_ENABLEMENT_CONFIG=""

setup_gemini() {
    GEMINI_CONFIG="$HOME/.gemini/settings.json"
    GEMINI_ENABLEMENT_CONFIG="$HOME/.gemini/mcp-server-enablement.json"
    log_step "Setting up Google Gemini CLI MCP..."

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    write_json_mcp_config "$GEMINI_CONFIG" gemini "$PROJECT_ROOT" || return 1
    write_gemini_enablement_config "$GEMINI_ENABLEMENT_CONFIG" || return 1

    has_canonical_mcp_config "$GEMINI_CONFIG" || return 1
    mcp_config_has_enabled_entry "$GEMINI_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp || return 1
    gemini_managed_servers_enabled "$GEMINI_ENABLEMENT_CONFIG" || return 1
    CONFIGURED_GEMINI="$GEMINI_CONFIG"

    log_info "  forgewright → canonical tsx ~/.forgewright/mcp-server/"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Platform: Zed AI ─────────────────────────────────────────────────────

ZED_CONFIG=""

setup_zed() {
    # Zed stores MCP config in its settings JSON
    # Primary: ~/.config/zed/settings.json (or equivalent based on OS)
    local zed_settings_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zed"
    local os_type
    os_type=$(uname -s)

    # On macOS, Zed uses ~/Library/Application Support/Zed
    if [[ "$os_type" == "Darwin" ]]; then
        zed_settings_dir="$HOME/Library/Application Support/Zed"
    fi

    ZED_CONFIG="${zed_settings_dir}/settings.json"
    log_step "Setting up Zed AI MCP..."

    # Check if Zed directory exists or is expected
    if [[ ! -d "$(dirname "$ZED_CONFIG")" ]]; then
        log_warn "Zed settings directory not found"
        log_info "  Expected: $(dirname "$ZED_CONFIG")"
        log_info "  Zed may not be installed."
        log_info "  Install: https://zed.dev"
        return 0
    fi

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    write_json_mcp_config "$ZED_CONFIG" zed || return 1
    has_canonical_mcp_config "$ZED_CONFIG" zed || return 1
    mcp_config_has_enabled_entry "$ZED_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp zed || return 1
    CONFIGURED_ZED="$ZED_CONFIG"
    log_info "  forgewright → canonical tsx ~/.forgewright/mcp-server/"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Platform: OpenCode ────────────────────────────────────────────────────

OPENCODE_CONFIG=""

setup_opencode() {
    OPENCODE_CONFIG="$(opencode_config_path)"
    log_step "Setting up OpenCode MCP..."

    # Check if OpenCode directory exists or is expected
    if [[ ! -d "$(dirname "$OPENCODE_CONFIG")" ]]; then
        log_warn "OpenCode config directory not found"
        log_info "  Expected: $(dirname "$OPENCODE_CONFIG")"
        log_info "  OpenCode may not be installed."
        log_info "  Install: https://github.com/smolbananya/opencode"
        return 0
    fi

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    local gitnexus_path
    gitnexus_path="$(resolve_gitnexus_executable)"

    write_json_mcp_config "$OPENCODE_CONFIG" opencode || return 1
    has_canonical_mcp_config "$OPENCODE_CONFIG" opencode || return 1
    mcp_config_has_enabled_entry "$OPENCODE_CONFIG" gitnexus "$gitnexus_path" mcp opencode || return 1
    CONFIGURED_OPENCODE="$OPENCODE_CONFIG"
    log_info "  forgewright → canonical tsx ~/.forgewright/mcp-server/"
    log_info "  gitnexus    → $gitnexus_path"
}

# ─── Platform: Qwen Code ────────────────────────────────────────────────────────────

QWEN_CONFIG=""

setup_qwen() {
    QWEN_CONFIG="$HOME/.qwen/settings.json"
    log_step "Setting up Qwen Code MCP..."

    if ! canonical_candidate_ready; then
        log_error "Staged canonical MCP server is not ready"
        return 1
    fi

    # Ensure ~/.qwen/ directory exists
    if [[ ! -d "$HOME/.qwen" ]]; then
        mkdir -p "$HOME/.qwen"
        log_info "  Created directory: $HOME/.qwen/"
    fi

    write_json_mcp_config "$QWEN_CONFIG" qwen "$PROJECT_ROOT" || return 1

    has_canonical_mcp_config "$QWEN_CONFIG" || return 1
    mcp_config_has_enabled_entry "$QWEN_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp || return 1
    CONFIGURED_QWEN="$QWEN_CONFIG"

    log_info "  forgewright → canonical tsx ~/.forgewright/mcp-server/"
    log_info "  gitnexus    → $(resolve_gitnexus_executable)"
}

# ─── Verify Manifest ────────────────────────────────────────────────────────────

verify_manifest() {
    local manifest="${PROJECT_ROOT}/.antigravity/mcp-manifest.json"
    if [[ ! -f "$manifest" ]]; then
        log_error "Manifest not found: $manifest"
        return 1
    fi
    local ws_path
    ws_path=$(node - "$manifest" <<'NODE'
try {
  const manifest = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(typeof manifest.workspace === 'string' ? manifest.workspace : '');
} catch (error) {
  process.exit(1);
}
NODE
    ) || ws_path=""
    if [[ "$ws_path" != "$PROJECT_ROOT" ]]; then
        log_warn "Manifest workspace mismatch: expected $PROJECT_ROOT, got $ws_path"
        return 1
    fi
    log_ok "Manifest verified"
}

# ─── Write Settings ─────────────────────────────────────────────────────────────

write_forgewright_settings() {
    log_step "Writing Forgewright settings..."
    local settings_dir="${PROJECT_ROOT}/.forgewright" settings target_tmp source_state
    settings="${settings_dir}/settings.env"
    validate_sensitive_path "$settings" file || return 1
    if [[ -L "$settings_dir" ]] || { [[ -e "$settings_dir" ]] && [[ ! -d "$settings_dir" ]]; }; then
        log_error "Forgewright settings directory must be a real directory: $settings_dir"
        return 1
    fi
    mkdir -p "$settings_dir"
    validate_sensitive_path "$settings" file || return 1
    transaction_snapshot_file "$settings" || return 1
    source_state="$(transaction_original_file_state "$settings")" || return 1

    local SHELL_COMPRESSOR=""
    if command -v rtk &> /dev/null; then SHELL_COMPRESSOR="rtk"
    elif command -v chop &> /dev/null; then SHELL_COMPRESSOR="chop"
    elif command -v snip &> /dev/null; then SHELL_COMPRESSOR="snip"
    elif command -v ctx &> /dev/null; then SHELL_COMPRESSOR="ctx"
    elif command -v tkill &> /dev/null; then SHELL_COMPRESSOR="tkill"
    else SHELL_COMPRESSOR="forgewright-shell-filter"; fi

    target_tmp="$(mktemp "$settings_dir/.settings.env.XXXXXX")"
    python3 - "$SHELL_COMPRESSOR" "$FORGEWRIGHT_DIR" "$target_tmp" <<'PY' || { rm -f -- "$target_tmp"; return 1; }
import sys
import re

shell_compressor, fw_dir, target = sys.argv[1:]

def safe_quote(value):
    if re.search(r'[\x00\n\r]', value):
        raise SystemExit(f"unsafe value: {value!r}")
    return "'" + value.replace("'", "'\\''") + "'"

with open(target, "w", encoding="utf-8") as f:
    f.write("# Forgewright Settings — Generated by forgewright-mcp-setup.sh\n")
    f.write(f"export FORGEWRIGHT_SHELL_COMPRESSOR={safe_quote(shell_compressor)}\n")
    f.write(f"export FORGEWRIGHT_SHELL_FILTER_PATH={safe_quote(fw_dir + '/scripts/forgewright-shell-filter.sh')}\n")
    f.write("export FORGEWRIGHT_TOKEN_BUDGET='120000'\n")
    f.write("export FORGEWRIGHT_DEDUP_WINDOW='10'\n")
    f.write("export FORGEWRIGHT_SESSION_DEDUP='true'\n")
    f.write("export FORGEWRIGHT_TOOL_SANDBOX='true'\n")
    f.write("export FORGEWRIGHT_MEMORY_ENABLED='true'\n")
    f.write("if command -v token-savior &> /dev/null; then\n")
    f.write("    export FORGEWRIGHT_CODE_NAV='token-savior'\n")
    f.write("else\n")
    f.write("    export FORGEWRIGHT_CODE_NAV='gitnexus'\n")
    f.write("fi\n")
PY
    chmod 644 "$target_tmp"
    transaction_expect_file "$settings" "$target_tmp" || {
        rm -f -- "$target_tmp"
        return 1
    }
    durable_replace_file "$target_tmp" "$settings" "settings-env" "$source_state" || {
        rm -f -- "$target_tmp"
        transaction_clear_expect_file "$settings" || true
        return 1
    }
    log_ok "Settings written"
}

# ─── Verify Installation ────────────────────────────────────────────────────────

mcp_config_has_enabled_entry() {
    local config_path="$1" entry_name="$2" expected_command="${3:-}" expected_arg="${4:-}"
    local schema="${5:-generic}"
    [[ -f "$config_path" ]] || return 1

    if [[ "$config_path" == *.toml ]]; then
        python3 - "$config_path" "$entry_name" "$expected_command" "$expected_arg" <<'PY' >/dev/null 2>&1
import sys
import tomllib

path, name, expected_command, expected_arg = sys.argv[1:]
with open(path, "rb") as handle:
    config = tomllib.load(handle)
entry = config.get("mcp_servers", {}).get(name)
command = entry.get("command") if isinstance(entry, dict) else None
args = entry.get("args", []) if isinstance(entry, dict) else []
shape_ok = isinstance(command, str) and bool(command) and isinstance(args, list) and all(
    isinstance(arg, str) and bool(arg) for arg in args
)
enabled = shape_ok and entry.get("enabled", True) is not False and entry.get("disabled") is not True
command_ok = not expected_command or command == expected_command
arg_ok = not expected_arg or args == [expected_arg]
raise SystemExit(0 if enabled and command_ok and arg_ok else 1)
PY
        return
    fi
    jsonc_self_contained verify "$config_path" "" "$schema" "$entry_name" \
        "$expected_command" "$expected_arg" >/dev/null 2>&1
}

has_canonical_mcp_config() {
    mcp_config_has_enabled_entry "$1" forgewright "$CANONICAL_TSX" "$CANONICAL_SERVER_TS" "${2:-generic}"
}

report_platform_configuration() {
    local platform="$1"
    local config_path="$2"
    local schema="${3:-generic}"
    [[ -n "$config_path" ]] || return 0
    if has_canonical_mcp_config "$config_path" "$schema"; then
        log_ok "$platform configured: $config_path"
    else
        log_info "$platform not configured (not installed or skipped)"
    fi
}

report_managed_config_status() {
    local platform="$1" config_path="$2" schema="${3:-generic}" enablement_path="${4:-}"
    if [[ ! -f "$config_path" ]]; then
        log_warn "$platform: NOT FOUND ($config_path)"
        return 0
    fi
    log_ok "$platform: $config_path"
    if has_canonical_mcp_config "$config_path" "$schema"; then
        log_ok "  forgewright: CONFIGURED"
    else
        log_warn "  forgewright: NOT configured with canonical server"
    fi
    if mcp_config_has_enabled_entry "$config_path" gitnexus "$(resolve_gitnexus_executable)" mcp "$schema"; then
        log_ok "  gitnexus: CONFIGURED"
    else
        log_warn "  gitnexus: NOT configured"
    fi
    if [[ -n "$enablement_path" ]]; then
        if gemini_managed_servers_enabled "$enablement_path"; then
            log_ok "  persistent enablement: ENABLED"
        else
            log_warn "  persistent enablement: DISABLED"
        fi
    fi
}

verify_installation() {
    log_step "Verifying installation..."

    local checks=0 passed=0
    local server_dir="$CANONICAL_SERVER_DIR"

    ((checks += 1)); if [[ -d "$server_dir" ]]; then ((passed += 1)); log_ok "Server dir"; else log_error "Server dir missing"; fi
    ((checks += 1)); if [[ -f "$server_dir/src/index.ts" ]]; then ((passed += 1)); log_ok "src/index.ts"; else log_error "src/index.ts missing"; fi
    ((checks += 1)); if [[ -x "$CANONICAL_TSX" ]]; then ((passed += 1)); log_ok "tsx executable"; else log_error "tsx executable missing"; fi
    ((checks += 1)); if [[ -f "$server_dir/build/runtime/tool-execution-gateway.js" ]]; then ((passed += 1)); log_ok "tool-execution gateway build artifact"; else log_error "tool-execution gateway build artifact missing"; fi
    ((checks += 1)); if [[ -f "${PROJECT_ROOT}/.antigravity/mcp-manifest.json" ]]; then ((passed += 1)); log_ok "Manifest"; else log_error "Manifest missing"; fi

    report_platform_configuration "Cursor" "$CONFIGURED_CURSOR"
    report_platform_configuration "Claude Code" "$CONFIGURED_CLAUDE_CODE"
    report_platform_configuration "Claude Desktop" "$CONFIGURED_CLAUDE_DESKTOP"
    report_platform_configuration "Antigravity" "$CONFIGURED_ANTIGRAVITY"
    report_platform_configuration "Codex CLI" "$CONFIGURED_CODEX"
    report_platform_configuration "Gemini CLI" "$CONFIGURED_GEMINI"
    report_platform_configuration "Qwen Code" "$CONFIGURED_QWEN"
    report_platform_configuration "Zed AI" "$CONFIGURED_ZED" zed
    report_platform_configuration "OpenCode" "$CONFIGURED_OPENCODE" opencode

    echo ""
    log_info "Passed: $passed/$checks checks"
    [[ "$passed" -eq "$checks" ]]
}

# ─── Built-in Research MCPs ───────────────────────────────────────────────

install_builtin_mcps() {
    echo ""
    log_step "Checking built-in research MCPs..."
    echo ""

    local mcp_count=0

    # Exa Web Search
    echo -n "  Exa (web search): "
    if command -v npx &>/dev/null && npx --no-install @exa/search-mcp-server --help &>/dev/null 2>&1; then
        echo -e "${GREEN}available${NC}"
        ((mcp_count++))
    else
        echo -e "${YELLOW}not installed (optional)${NC}"
    fi

    # Context7 Docs
    echo -n "  Context7 (official docs): "
    if command -v npx &>/dev/null && npx --no-install @context7/mcp-server --help &>/dev/null 2>&1; then
        echo -e "${GREEN}available${NC}"
        ((mcp_count++))
    else
        echo -e "${YELLOW}not installed (optional)${NC}"
    fi

    # Grep.app GitHub Search
    echo -n "  Grep.app (GitHub code search): "
    if command -v npx &>/dev/null && npx --no-install @grepapp/mcp-server --help &>/dev/null 2>&1; then
        echo -e "${GREEN}available${NC}"
        ((mcp_count++))
    else
        echo -e "${YELLOW}not installed (optional)${NC}"
    fi

    echo ""
    if [[ $mcp_count -gt 0 ]]; then
        log_ok "$mcp_count built-in MCP(s) available"
        echo ""
        echo "  Usage:"
        echo "    npx @exa/search-mcp-server          # Web search"
        echo "    npx @context7/mcp-server             # Official docs"
        echo "    npx @grepapp/mcp-server             # GitHub search"
    else
        log_info "No built-in MCPs installed. To add:"
        echo "    npm install -g @exa/search-mcp-server"
        echo "    npm install -g @context7/mcp-server"
        echo "    npm install -g @grepapp/mcp-server"
    fi
}

# ─── Check Command ──────────────────────────────────────────────────────────────

cmd_check() {
    echo ""
    echo "━━━ MCP Status (All Platforms) ━━━"
    echo ""
    log_step "Project: $PROJECT_ROOT"
    echo ""

    # Cursor
    if [[ -f "$CURSOR_CONFIG" ]]; then
        log_ok "Cursor: $CURSOR_CONFIG"
        if has_canonical_mcp_config "$CURSOR_CONFIG"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$CURSOR_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_error "Cursor: NOT FOUND"
    fi
    echo ""

    # Claude Code
    if [[ -f "$CLAUDE_CODE_CONFIG" ]]; then
        log_ok "Claude Code: $CLAUDE_CODE_CONFIG"
        if has_canonical_mcp_config "$CLAUDE_CODE_CONFIG"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$CLAUDE_CODE_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_error "Claude Code: NOT FOUND"
    fi
    echo ""

    # Claude Desktop
    local claude_desktop_config
    claude_desktop_config="$(claude_desktop_config_path)"
    report_managed_config_status "Claude Desktop" "$claude_desktop_config"
    echo ""

    # Antigravity
    local ag_config="$HOME/.gemini/config/mcp_config.json"
    log_step "Antigravity:"
    if [[ "$ANTIGRAVITY_CONFIG" != "not_found" ]] && [[ -d "$ANTIGRAVITY_CONFIG" ]]; then
        log_ok "  Server: $ANTIGRAVITY_CONFIG"
        if [[ -x "${ANTIGRAVITY_CONFIG}/launcher.sh" ]] && \
            grep -Fq "$CANONICAL_TSX" "${ANTIGRAVITY_CONFIG}/launcher.sh" && \
            grep -Fq "$CANONICAL_SERVER_TS" "${ANTIGRAVITY_CONFIG}/launcher.sh" && \
            has_canonical_mcp_config "$ag_config" && \
            mcp_config_has_enabled_entry "$ag_config" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server and launcher"
        fi
    else
        log_warn "  Antigravity forgewright server not found"
        log_info "  (Install Antigravity plugin to register)"
    fi
    echo ""

    # Manifest
    local manifest="${PROJECT_ROOT}/.antigravity/mcp-manifest.json"
    if [[ -f "$manifest" ]]; then
        log_ok "Manifest: $manifest"
    else
        log_error "Manifest: NOT FOUND (run setup)"
    fi
    echo ""

    # Codex CLI
    CODEX_CONFIG="$HOME/.codex/config.toml"
    if [[ -f "$CODEX_CONFIG" ]]; then
        log_ok "Codex CLI: $CODEX_CONFIG"
        if has_canonical_mcp_config "$CODEX_CONFIG"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$CODEX_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_warn "Codex CLI: NOT FOUND (~/.codex/config.toml)"
    fi
    echo ""

    # Gemini CLI
    GEMINI_CONFIG="$HOME/.gemini/settings.json"
    if [[ -f "$GEMINI_CONFIG" ]]; then
        log_ok "Gemini CLI: $GEMINI_CONFIG"
        if has_canonical_mcp_config "$GEMINI_CONFIG"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$GEMINI_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
        if gemini_managed_servers_enabled "$HOME/.gemini/mcp-server-enablement.json"; then
            log_ok "  persistent enablement: ENABLED"
        else
            log_warn "  persistent enablement: DISABLED"
        fi
    else
        log_warn "Gemini CLI: NOT FOUND (~/.gemini/settings.json)"
    fi
    echo ""

    # Antigravity CLI
    if [[ -f "$ag_config" ]]; then
        log_ok "Antigravity CLI: $ag_config"
        if has_canonical_mcp_config "$ag_config"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$ag_config" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_warn "Antigravity CLI: NOT FOUND (~/.gemini/config/mcp_config.json)"
    fi
    echo ""

    # Zed AI
    local zed_settings_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zed"
    local os_type
    os_type=$(uname -s)
    if [[ "$os_type" == "Darwin" ]]; then
        zed_settings_dir="$HOME/Library/Application Support/Zed"
    fi
    ZED_CONFIG="${zed_settings_dir}/settings.json"
    if [[ -f "$ZED_CONFIG" ]]; then
        log_ok "Zed AI: $ZED_CONFIG"
        if has_canonical_mcp_config "$ZED_CONFIG" zed; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$ZED_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp zed; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_warn "Zed AI: NOT FOUND (${zed_settings_dir}/settings.json)"
    fi
    echo ""

    # OpenCode
    OPENCODE_CONFIG="$(opencode_config_path)"
    if [[ -f "$OPENCODE_CONFIG" ]]; then
        log_ok "OpenCode: $OPENCODE_CONFIG"
        if has_canonical_mcp_config "$OPENCODE_CONFIG" opencode; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$OPENCODE_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp opencode; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_warn "OpenCode: NOT FOUND ($OPENCODE_CONFIG)"
    fi
    echo ""

    # Qwen Code
    QWEN_CONFIG="$HOME/.qwen/settings.json"
    if [[ -f "$QWEN_CONFIG" ]]; then
        log_ok "Qwen Code: $QWEN_CONFIG"
        if has_canonical_mcp_config "$QWEN_CONFIG"; then
            log_ok "  forgewright: CONFIGURED"
        else
            log_warn "  forgewright: NOT configured with canonical server"
        fi
        if mcp_config_has_enabled_entry "$QWEN_CONFIG" gitnexus "$(resolve_gitnexus_executable)" mcp; then
            log_ok "  gitnexus: CONFIGURED"
        else
            log_warn "  gitnexus: NOT configured"
        fi
    else
        log_warn "Qwen Code: NOT FOUND (~/.qwen/settings.json)"
    fi
    echo ""

    # Built-in research MCPs
    install_builtin_mcps

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Diagnose Command ──────────────────────────────────────────────────────────

cmd_diagnose() {
    echo ""
    echo "━━━ MCP Diagnostics ━━━"
    echo ""
    log_step "Environment"
    echo "  PWD:        $(pwd)"
    echo "  FORGEWRIGHT_WORKSPACE: ${FORGEWRIGHT_WORKSPACE:-<not set>}"
    echo "  MCP_WORKSPACE_ROOT:   ${MCP_WORKSPACE_ROOT:-<not set>}"
    echo ""

    log_step "Forgewright"
    echo "  DIR:     $FORGEWRIGHT_DIR"
    echo "  PROJECT: $PROJECT_ROOT"
    echo "  EXISTS:  $([ -d "$FORGEWRIGHT_DIR" ] && echo YES || echo NO)"
    echo ""

    log_step "Launchers"
    echo "  forgewright: ${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh"
    echo "  EXISTS: $([ -f "${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh" ] && echo YES || echo NO)"
    echo ""

    log_step "MCP Server"
    local server_dir="${FORGEWRIGHT_DIR}/mcp"
    echo "  PATH:  $server_dir"
    echo "  EXISTS: $([ -d "$server_dir" ] && echo YES || echo NO)"
    echo ""

    log_step "Platform Configs"
    echo "  Cursor:       $CURSOR_CONFIG ($(ls -la "$CURSOR_CONFIG" 2>/dev/null | awk '{print $5" "$9}')"
    echo "  Claude Code:  $CLAUDE_CODE_CONFIG ($(ls -la "$CLAUDE_CODE_CONFIG" 2>/dev/null | awk '{print $5" "$9}')"
    echo "  Claude Desktop: $(claude_desktop_config_path)"
    echo "  Antigravity:  $ANTIGRAVITY_CONFIG"
    echo "  Antigravity CLI: $HOME/.gemini/config/mcp_config.json"
    echo "  Codex CLI:    $HOME/.codex/config.toml"
    echo "  Gemini CLI:   $HOME/.gemini/settings.json"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        echo "  Zed AI:       $HOME/Library/Application Support/Zed/settings.json"
    else
        echo "  Zed AI:       ${XDG_CONFIG_HOME:-$HOME/.config}/zed/settings.json"
    fi
    echo "  OpenCode:     $(opencode_config_path)"
    echo "  Qwen Code:    $HOME/.qwen/settings.json"
    echo ""

    log_step "Structural MCP Status"
    report_managed_config_status "Cursor" "$CURSOR_CONFIG"
    report_managed_config_status "Claude Code" "$CLAUDE_CODE_CONFIG"
    report_managed_config_status "Claude Desktop" "$(claude_desktop_config_path)"
    report_managed_config_status "Antigravity CLI" "$HOME/.gemini/config/mcp_config.json"
    report_managed_config_status "Codex CLI" "$HOME/.codex/config.toml"
    report_managed_config_status "Gemini CLI" "$HOME/.gemini/settings.json" generic "$HOME/.gemini/mcp-server-enablement.json"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        report_managed_config_status "Zed AI" "$HOME/Library/Application Support/Zed/settings.json" zed
    else
        report_managed_config_status "Zed AI" "${XDG_CONFIG_HOME:-$HOME/.config}/zed/settings.json" zed
    fi
    report_managed_config_status "OpenCode" "$(opencode_config_path)" opencode
    report_managed_config_status "Qwen Code" "$HOME/.qwen/settings.json"
    echo ""

    echo "━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Uninstall ────────────────────────────────────────────────────────────────

remove_json_mcp_entries() {
    local target="$1" schema="${2:-generic}" target_dir target_tmp lock_dir owner_token parser_module source_state
    [[ -f "$target" ]] || return 0
    validate_sensitive_path "$target" file || return 1
    lock_dir="$(config_lock_path "$target")"
    owner_token="$(new_owner_token)"
    acquire_owned_lock "$lock_dir" "$owner_token" || return 1
    source_state="$(capture_file_state "$target")" || {
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    }
    target_dir="$(dirname "$target")"
    target_tmp="$(mktemp "$target_dir/.mcp-uninstall.XXXXXX")"
    if ! jsonc_self_contained remove "$target" "$target_tmp" "$schema"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    if ! durable_replace_file "$target_tmp" "$target" "json-uninstall" "$source_state"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    release_owned_lock "$lock_dir" "$owner_token"
    return 0

    # shellcheck disable=SC2317 # Retained legacy fallback below the self-contained path.
    if ! parser_module="$(jsonc_parser_module)"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    # shellcheck disable=SC2317 # Retained legacy fallback below the self-contained path.
    if ! node - "$target" "$target_tmp" "$schema" "$parser_module" <<'NODE'
const fs = require('fs');
const [inputPath, outputPath, schema, parserModule] = process.argv.slice(2);
const { applyEdits, modify, parse, printParseErrorCode } = require(parserModule);
let raw = fs.readFileSync(inputPath, 'utf8');
const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
if (bom) raw = raw.slice(1);
const parseConfig = (text) => {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    throw new Error(errors.map((error) => `${printParseErrorCode(error.error)}@${error.offset}`).join(', '));
  }
  return value;
};
let config = parseConfig(raw);
if (!config || Array.isArray(config) || typeof config !== 'object') {
  throw new Error('MCP config root must be an object');
}
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const indent = raw.match(/\r?\n([ \t]+)"/)?.[1] || '  ';
const formattingOptions = indent.includes('\t') ? { insertSpaces: false, tabSize: 1, eol } :
  { insertSpaces: true, tabSize: indent.length, eol };
const rootKeys = schema === 'zed' ? ['context_servers'] :
  schema === 'opencode' ? ['mcp'] : ['mcpServers', 'mcp_servers'];
for (const key of rootKeys) {
  config = parseConfig(raw);
  if (config[key] === undefined) continue;
  if (!config[key] || Array.isArray(config[key]) || typeof config[key] !== 'object') {
    throw new Error(`${key} must be an object`);
  }
  for (const name of ['forgewright', 'gitnexus']) {
    if (config[key][name] !== undefined) {
      raw = applyEdits(raw, modify(raw, [key, name], undefined, { formattingOptions }));
      config = parseConfig(raw);
    }
  }
}
config = parseConfig(raw);
for (const key of rootKeys) {
  if (config[key]?.forgewright !== undefined || config[key]?.gitnexus !== undefined) {
    throw new Error('managed JSONC entries remain after uninstall');
  }
}
fs.writeFileSync(outputPath, `${bom}${raw}`, {
  mode: fs.statSync(inputPath).mode & 0o777,
});
NODE
    then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    # shellcheck disable=SC2317 # Retained legacy fallback below the self-contained path.
    if ! durable_replace_file "$target_tmp" "$target" "json-uninstall"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    # shellcheck disable=SC2317 # Retained legacy fallback below the self-contained path.
    release_owned_lock "$lock_dir" "$owner_token"
}

remove_toml_mcp_entries() {
    local target="$1" target_dir target_tmp lock_dir owner_token source_state
    [[ -f "$target" ]] || return 0
    validate_sensitive_path "$target" file || return 1
    lock_dir="$(config_lock_path "$target")"
    owner_token="$(new_owner_token)"
    acquire_owned_lock "$lock_dir" "$owner_token" || return 1
    source_state="$(capture_file_state "$target")" || {
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    }
    target_dir="$(dirname "$target")"
    target_tmp="$(mktemp "$target_dir/.mcp-uninstall.XXXXXX")"
    if ! prepare_toml_mcp_removal "$target" "$target_tmp"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    if ! durable_replace_file "$target_tmp" "$target" "toml-uninstall" "$source_state"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    release_owned_lock "$lock_dir" "$owner_token"
    return 0

    # shellcheck disable=SC2317 # Retained legacy fallback below the ledger-aware path.
    if ! python3 - "$target" "$target_tmp" <<'PY'
import os
import re
import stat
import sys
import tomllib

source, output = sys.argv[1:]
with open(source, encoding="utf-8") as handle:
    raw = handle.read()
tomllib.loads(raw)

def parse_key(text):
    parts = []
    index = 0
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            break
        if text[index] in {'"', "'"}:
            quote = text[index]
            index += 1
            value = []
            escaped = False
            while index < len(text):
                char = text[index]
                index += 1
                if quote == '"' and escaped:
                    escapes = {'b': '\b', 't': '\t', 'n': '\n', 'f': '\f', 'r': '\r', '"': '"', '\\': '\\'}
                    if char not in escapes:
                        raise ValueError("unsupported quoted TOML key escape")
                    value.append(escapes[char])
                    escaped = False
                elif quote == '"' and char == '\\':
                    escaped = True
                elif char == quote:
                    break
                else:
                    value.append(char)
            else:
                raise ValueError("unterminated quoted TOML key")
            parts.append("".join(value))
        else:
            start = index
            while index < len(text) and (text[index].isalnum() or text[index] in '_-'):
                index += 1
            if start == index:
                raise ValueError("invalid bare TOML key")
            parts.append(text[start:index])
        while index < len(text) and text[index].isspace():
            index += 1
        if index == len(text):
            break
        if text[index] != '.':
            raise ValueError("invalid dotted TOML key")
        index += 1
    return tuple(parts)

def header_path(line):
    stripped = line.lstrip()
    if not stripped.startswith('['):
        return None
    array = stripped.startswith('[[')
    opening = 2 if array else 1
    closing = ']]' if array else ']'
    quote = None
    escaped = False
    index = opening
    while index < len(stripped):
        char = stripped[index]
        if quote:
            if quote == '"' and escaped:
                escaped = False
            elif quote == '"' and char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            index += 1
            continue
        if stripped.startswith(closing, index):
            tail = stripped[index + len(closing):].strip()
            if tail and not tail.startswith('#'):
                raise ValueError("invalid TOML table suffix")
            return parse_key(stripped[opening:index])
        index += 1
    raise ValueError("unterminated TOML table")

def assignment_key(line):
    quote = None
    escaped = False
    for index, char in enumerate(line):
        if quote:
            if quote == '"' and escaped:
                escaped = False
            elif quote == '"' and char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == '#':
            return None
        elif char == '=':
            return parse_key(line[:index])
    return None

def is_managed(path):
    return len(path) >= 2 and path[0] == 'mcp_servers' and path[1] in {'forgewright', 'gitnexus'}

lines = raw.splitlines(keepends=True)
kept = []
context = ()
index = 0
while index < len(lines):
    line = lines[index]
    table = header_path(line)
    if table is not None:
        context = table
        if is_managed(table):
            index += 1
            while index < len(lines) and header_path(lines[index]) is None:
                if not lines[index].strip() or lines[index].lstrip().startswith('#'):
                    kept.append(lines[index])
                index += 1
            continue
        kept.append(line)
        index += 1
        continue
    key = assignment_key(line)
    if key is None:
        kept.append(line)
        index += 1
        continue
    statement = line
    end = index + 1
    while True:
        try:
            tomllib.loads(statement)
            break
        except tomllib.TOMLDecodeError:
            if end >= len(lines) or header_path(lines[end]) is not None:
                raise
            statement += lines[end]
            end += 1
    if not is_managed(context + key):
        kept.extend(lines[index:end])
    index = end

result = "".join(kept)
parsed = tomllib.loads(result)
servers = parsed.get("mcp_servers", {})
if not isinstance(servers, dict) or any(name in servers for name in ("forgewright", "gitnexus")):
    raise SystemExit("managed TOML entries remain after uninstall")
with open(output, "w", encoding="utf-8") as handle:
    handle.write(result)
os.chmod(output, stat.S_IMODE(os.stat(source, follow_symlinks=False).st_mode))
PY
    then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    # shellcheck disable=SC2317 # Retained legacy fallback below the ledger-aware path.
    if ! durable_replace_file "$target_tmp" "$target" "toml-uninstall"; then
        rm -f -- "$target_tmp"
        release_owned_lock "$lock_dir" "$owner_token"
        return 1
    fi
    # shellcheck disable=SC2317 # Retained legacy fallback below the ledger-aware path.
    release_owned_lock "$lock_dir" "$owner_token"
}

declare -a UNINSTALL_TARGETS=()
declare -a UNINSTALL_CANDIDATES=()
declare -a UNINSTALL_LABELS=()
declare -a UNINSTALL_STATES=()

prepare_uninstall_candidate() {
    local target="$1" kind="$2" schema="${3:-generic}" candidate state
    [[ -f "$target" ]] || return 0
    validate_sensitive_path "$target" file || return 1
    transaction_snapshot_file "$target" || return 1
    state="$(transaction_original_file_state "$target")" || return 1
    candidate="$(mktemp "$TRANSACTION_DIR/uninstall.XXXXXX")"
    export_runtime_token || return 1
    export FORGEWRIGHT_LEDGER_PATH="$HOME/.forgewright/.mcp-config-ledger.json"
    if [[ -z "${FORGEWRIGHT_LEDGER_TMP:-}" ]]; then
        export FORGEWRIGHT_LEDGER_TMP="$(mktemp "$TRANSACTION_DIR/ledger.XXXXXX")"
    fi
    case "$kind" in
        jsonc)
            jsonc_self_contained remove "$target" "$candidate" "$schema" || return 1
            ;;
        toml)
            prepare_toml_mcp_removal "$target" "$candidate" || return 1
            ;;
        enablement)
            node - "$target" "$candidate" <<'NODE' || return 1
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const ledgerInput = fs.realpathSync(input);
const config = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('enablement root must be an object');

const ledgerPath = process.env.FORGEWRIGHT_LEDGER_PATH;
const ledgerTmp = process.env.FORGEWRIGHT_LEDGER_TMP;
const token = process.env.FORGEWRIGHT_RUNTIME_TOKEN;
let ledger = { kind: "forgewright-mcp-ledger", version: 1, runtime_token: token, records: {} };
const ledgerSource = ledgerTmp && fs.existsSync(ledgerTmp) && fs.statSync(ledgerTmp).size > 0 ? ledgerTmp : ledgerPath;
if (ledgerSource && fs.existsSync(ledgerSource)) {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerSource, 'utf8'));
    if (!data || data.kind !== "forgewright-mcp-ledger" || data.version !== 1 || data.runtime_token !== token || !data.records) throw new Error('Ledger malformed or token mismatch');
    ledger = data;
  } catch(e) {
    throw new Error('Ledger malformed or token mismatch');
  }
}
let ledgerChanged = false;

const crypto = require('crypto');
const enabledFingerprint = crypto.createHash('sha256').update('enabled').digest('hex');
for (const managed of ['forgewright', 'gitnexus']) {
  const matches = Object.keys(config).filter((key) => key.toLowerCase().trim() === managed);
  if (matches.length > 1) throw new Error(`duplicate ${managed} enablement entries`);
  const recordKey = crypto.createHash('sha256').update(`${ledgerInput}:enablement:${managed}`).digest('hex');
  const record = ledger.records[recordKey];
  if (!record) continue;
  if (record.normalized_value_sha256 !== enabledFingerprint) {
    throw new Error(`${managed} ownership record is malformed`);
  }
  if (matches.length !== 0) throw new Error(`${managed} entry was externally recreated, failing closed`);
  delete ledger.records[recordKey];
  ledgerChanged = true;
}
if (ledgerChanged && ledgerTmp) fs.writeFileSync(ledgerTmp, JSON.stringify(ledger, null, 2));
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, {mode: fs.statSync(input).mode & 0o777});
NODE
            ;;
        *)
            log_error "Unknown uninstall candidate kind: $kind"
            return 1
            ;;
    esac
    UNINSTALL_TARGETS+=("$target")
    UNINSTALL_CANDIDATES+=("$candidate")
    UNINSTALL_LABELS+=("uninstall-$kind")
    UNINSTALL_STATES+=("$state")
}

commit_uninstall_candidates() {
    local index target candidate label state
    for ((index = 0; index < ${#UNINSTALL_TARGETS[@]}; index += 1)); do
        target="${UNINSTALL_TARGETS[index]}"
        candidate="${UNINSTALL_CANDIDATES[index]}"
        label="${UNINSTALL_LABELS[index]}"
        state="${UNINSTALL_STATES[index]}"
        transaction_expect_file "$target" "$candidate" || return 1
        if ! durable_replace_file "$candidate" "$target" "$label" "$state"; then
            transaction_clear_expect_file "$target" || true
            return 1
        fi
    done
    if [[ -n "$FORGEWRIGHT_LEDGER_TMP" ]] && [[ -f "$FORGEWRIGHT_LEDGER_TMP" ]]; then
        commit_ledger "$FORGEWRIGHT_LEDGER_TMP" || return 1
        rm -f -- "$FORGEWRIGHT_LEDGER_TMP"
    fi
}

commit_uninstall_removal() {
    local target="$1" label="$2" required="${3:-false}" state
    if [[ ! -f "$target" ]]; then
        [[ "$required" != "true" ]] && return 0
        log_error "Required uninstall target disappeared: $target"
        return 1
    fi
    transaction_snapshot_file "$target" || return 1
    state="$(transaction_current_file_state "$target")" || return 1
    if [[ "$required" == "true" ]] && [[ "$state" != present:* ]]; then
        log_error "Required uninstall target changed before removal: $target"
        return 1
    fi
    transaction_expect_absent "$target" || return 1
    if ! durable_remove_file "$target" "$label" "$state"; then
        transaction_clear_expect_file "$target" || true
        return 1
    fi
}

cmd_uninstall() {
    log_step "Preparing transactional MCP removal from all platforms..."
    local canonical_parent manifest runtime_present="false" ledger_present="false"
    local claude_desktop_config codex_config gemini_config gemini_enablement ag_config
    local zed_dir zed_config opencode_root opencode_config qwen_config lock_dir lock_token

    canonical_parent="$(dirname "$CANONICAL_SERVER_DIR")"
    lock_dir="$canonical_parent/.mcp-server.setup.lock"
    lock_token="$(new_owner_token)"
    CANONICAL_LOCK_DIR="$lock_dir"
    CANONICAL_LOCK_TOKEN="$lock_token"
    acquire_owned_lock "$lock_dir" "$lock_token" || return 1
    recover_transaction_under_runtime_lock true || {
        release_owned_lock "$lock_dir" "$lock_token" || true
        return 1
    }

    if [[ -e "$CANONICAL_SERVER_DIR" ]] || [[ -L "$CANONICAL_SERVER_DIR" ]]; then
        validate_runtime_installation_ownership "$CANONICAL_SERVER_DIR" \
            "$CANONICAL_SERVER_DIR/$INSTALLATION_OWNER_MARKER" "$INSTALLATION_OWNER_FILE" || {
            log_error "Canonical runtime is unmarked or ownership verification failed; preserving it"
            release_owned_lock "$lock_dir" "$lock_token" || true
            return 1
        }
        runtime_present="true"
    elif [[ -e "$INSTALLATION_OWNER_FILE" ]] || [[ -L "$INSTALLATION_OWNER_FILE" ]]; then
        log_error "Runtime ownership record exists without its canonical runtime; refusing uninstall"
        release_owned_lock "$lock_dir" "$lock_token" || true
        return 1
    fi

    initialize_runtime_transaction || {
        release_owned_lock "$lock_dir" "$lock_token" || true
        return 1
    }
    journal_update runtime "$runtime_present" uninstall || return 1
    trap rollback_runtime_transaction EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    UNINSTALL_TARGETS=()
    UNINSTALL_CANDIDATES=()
    UNINSTALL_LABELS=()
    UNINSTALL_STATES=()
    claude_desktop_config="$(claude_desktop_config_path)"
    codex_config="$HOME/.codex/config.toml"
    gemini_config="$HOME/.gemini/settings.json"
    gemini_enablement="$HOME/.gemini/mcp-server-enablement.json"
    ag_config="$HOME/.gemini/config/mcp_config.json"
    qwen_config="$HOME/.qwen/settings.json"
    zed_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zed"
    [[ "$(uname -s)" != "Darwin" ]] || zed_dir="$HOME/Library/Application Support/Zed"
    zed_config="$zed_dir/settings.json"
    opencode_root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    opencode_config="$(opencode_config_path)"
    manifest="${PROJECT_ROOT}/.antigravity/mcp-manifest.json"

    snapshot_ledger || return 1
    if [[ "${FORGEWRIGHT_TEST_UNLINK_LEDGER_AFTER_SNAPSHOT:-0}" == "1" ]]; then
        rm -f -- "$FORGEWRIGHT_LEDGER_PATH"
    fi
    FORGEWRIGHT_LEDGER_TMP=""
    local ledger_state ledger_backup
    ledger_state="$(transaction_original_file_state "$FORGEWRIGHT_LEDGER_PATH")" || return 1
    if [[ "$ledger_state" == present:* ]]; then
        ledger_present="true"
        ledger_backup="$(transaction_original_file_backup "$FORGEWRIGHT_LEDGER_PATH")" || return 1
        FORGEWRIGHT_LEDGER_TMP="$(mktemp "$TRANSACTION_DIR/ledger.XXXXXX")"
        cp "$ledger_backup" "$FORGEWRIGHT_LEDGER_TMP" || return 1
        chmod 600 "$FORGEWRIGHT_LEDGER_TMP"
    fi
    export FORGEWRIGHT_LEDGER_TMP
    prepare_uninstall_candidate "$CURSOR_CONFIG" jsonc cursor || return 1
    prepare_uninstall_candidate "$CLAUDE_CODE_CONFIG" jsonc claude || return 1
    prepare_uninstall_candidate "$claude_desktop_config" jsonc claude-desktop || return 1
    prepare_uninstall_candidate "$codex_config" toml || return 1
    prepare_uninstall_candidate "$gemini_config" jsonc gemini || return 1
    prepare_uninstall_candidate "$gemini_enablement" enablement || return 1
    prepare_uninstall_candidate "$ag_config" jsonc antigravity || return 1
    prepare_uninstall_candidate "$zed_config" jsonc zed || return 1
    prepare_uninstall_candidate "$opencode_config" jsonc opencode || return 1
    prepare_uninstall_candidate "$qwen_config" jsonc qwen || return 1
    prepare_uninstall_candidate "$opencode_root/config.toml" toml || return 1
    prepare_uninstall_candidate "$opencode_root/config.json" jsonc json-config || return 1
    [[ ! -f "$manifest" ]] || transaction_snapshot_file "$manifest" || return 1
    [[ "$runtime_present" != "true" ]] || transaction_snapshot_file "$INSTALLATION_OWNER_FILE" || return 1

    if [[ "$ledger_present" == "true" ]] && ! python3 - \
        "$FORGEWRIGHT_LEDGER_TMP" "$FORGEWRIGHT_RUNTIME_TOKEN" <<'PY'
import json
import os
import sys
path, token = sys.argv[1:]
if not os.path.isfile(path) or os.path.islink(path) or os.stat(path, follow_symlinks=False).st_nlink != 1:
    raise SystemExit(1)
with open(path, encoding="utf-8") as handle:
    ledger = json.load(handle)
valid = (
    isinstance(ledger, dict) and
    set(ledger) == {"kind", "version", "runtime_token", "records"} and
    ledger.get("kind") == "forgewright-mcp-ledger" and
    ledger.get("version") == 1 and
    ledger.get("runtime_token") == token and
    ledger.get("records") == {}
)
raise SystemExit(0 if valid else 1)
PY
    then
        log_error "Ownership ledger still contains managed records or is invalid; preserving runtime and rolling back uninstall"
        return 1
    fi

    commit_uninstall_candidates || return 1
    if [[ "$ledger_present" == "true" ]] && \
        [[ "${FORGEWRIGHT_TEST_UNLINK_LEDGER_AFTER_CANDIDATES:-0}" == "1" ]]; then
        rm -f -- "$FORGEWRIGHT_LEDGER_PATH"
    fi
    if [[ "$ledger_present" == "true" ]]; then
        commit_uninstall_removal "$FORGEWRIGHT_LEDGER_PATH" uninstall-ledger true || return 1
    fi
    if [[ "$runtime_present" == "true" ]]; then
        quarantine_runtime_path "$CANONICAL_SERVER_DIR" "$TRANSACTION_TOKEN" \
            installation "$INSTALLATION_OWNER_FILE" || return 1
    fi
    commit_uninstall_removal "$manifest" uninstall-manifest || return 1
    if [[ "$runtime_present" == "true" ]]; then
        commit_uninstall_removal "$INSTALLATION_OWNER_FILE" uninstall-ownership || return 1
    fi
    journal_update status committed || return 1
    recover_transaction_under_runtime_lock false true || return 1

    trap - EXIT HUP INT TERM
    release_transaction_file_locks
    TRANSACTION_ACTIVE="false"
    TRANSACTION_DIR=""
    TRANSACTION_TOKEN=""
    CANONICAL_STAGE_DIR=""
    CANONICAL_LOCK_TOKEN=""
    release_owned_lock "$lock_dir" "$lock_token" || return 1
    cleanup_owned_runtime_trash || log_warn "Runtime deletion will resume on the next invocation"
    log_ok "Uninstall complete. Canonical runtime removal is ownership-verified and transactional."
}

# ─── Main ─────────────────────────────────────────────────────────────────────

declare PLATFORM_CURSOR="false"
declare PLATFORM_CLAUDE_CODE="false"
declare PLATFORM_ANTIGRAVITY="false"
declare PLATFORM_CODEX="false"
declare PLATFORM_GEMINI="false"
declare PLATFORM_QWEN="false"
declare PLATFORM_ZED="false"
declare PLATFORM_OPENCODE="false"
declare CODEX_CONFIG=""
declare GEMINI_CONFIG=""
declare GEMINI_ENABLEMENT_CONFIG=""
declare QWEN_CONFIG=""
declare ZED_CONFIG=""
declare OPENCODE_CONFIG=""
declare CONFIGURED_CURSOR=""
declare CONFIGURED_CLAUDE_CODE=""
declare CONFIGURED_CLAUDE_DESKTOP=""
declare CONFIGURED_ANTIGRAVITY=""
declare CONFIGURED_CODEX=""
declare CONFIGURED_GEMINI=""
declare CONFIGURED_QWEN=""
declare CONFIGURED_ZED=""
declare CONFIGURED_OPENCODE=""

main() {
    local mode="install"
    local force=false
    local skip_mcp_generate=false
    local requested_platforms=""

    # Parse args
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all)           mode="install"; requested_platforms=""; shift ;;
            --cursor)        mode="selected"; requested_platforms+="|cursor"; shift ;;
            --claude-code)   mode="selected"; requested_platforms+="|claude-code"; shift ;;
            --claude-desktop) mode="selected"; requested_platforms+="|claude-desktop"; shift ;;
            --antigravity)   mode="selected"; requested_platforms+="|antigravity"; shift ;;
            --codex)         mode="selected"; requested_platforms+="|codex"; shift ;;
            --gemini)        mode="selected"; requested_platforms+="|gemini"; shift ;;
            --zed)           mode="selected"; requested_platforms+="|zed"; shift ;;
            --opencode)      mode="selected"; requested_platforms+="|opencode"; shift ;;
            --qwen)          mode="selected"; requested_platforms+="|qwen"; shift ;;
            --check)         mode="check"; shift ;;
            --force)         force=true; shift ;;
            --uninstall)     mode="uninstall"; shift ;;
            --diagnose)      mode="diagnose"; shift ;;
            --help|-h)      show_help; exit 0 ;;
            *)               shift ;;
        esac
    done

    # Detect paths
    detect_forgewright
    PROJECT_ROOT="$(detect_actual_project_root)"
    recover_pending_transaction

    # Submodule update check (runs when setup is executed in a parent project)
    if [[ "$FORGEWRIGHT_IS_PROJECT" == "false" ]] && [[ -f "${FORGEWRIGHT_DIR}/scripts/forgewright-submodule-check.sh" ]]; then
        bash "${FORGEWRIGHT_DIR}/scripts/forgewright-submodule-check.sh" || true
    fi

    # Set default config paths
    CURSOR_CONFIG="$HOME/.cursor/mcp.json"
    CLAUDE_CODE_CONFIG="$HOME/.claude.json"
    ANTIGRAVITY_CONFIG=""

    # Auto-detect Antigravity
    if [[ -d "$HOME/.cursor/projects" ]]; then
        while IFS= read -r -d '' dir; do
            if [[ -d "${dir}/tools" ]] && grep -q "forgewright" "${dir}/SERVER_METADATA.json" 2>/dev/null; then
                ANTIGRAVITY_CONFIG="$dir"
                break
            fi
        done < <(find "$HOME/.cursor/projects" -type d -name "user-forgewright" -print0 2>/dev/null)
    fi
    [[ -z "$ANTIGRAVITY_CONFIG" ]] && ANTIGRAVITY_CONFIG="not_found"

    echo ""
    echo -e "${CYAN}⚡ Forgewright Universal MCP Setup${NC}"
    echo ""
    echo "  Forgewright: $FORGEWRIGHT_DIR"
    echo "  Project:     $PROJECT_ROOT"
    echo "  Mode:        $mode"
    echo ""

    case "$mode" in
        check)
            cmd_check
            ;;
        diagnose)
            cmd_diagnose
            ;;
        uninstall)
            cmd_uninstall
            ;;
        install|selected)
            # Preflight every mutating mode before runtime, manifest, or client config changes.
            check_prerequisites

            # Determine which platforms to setup
            local do_cursor=false do_claude=false do_claude_desktop=false do_antigravity=false do_codex=false do_gemini=false do_qwen=false do_zed=false do_opencode=false

            case "$mode" in
                install)
                    do_cursor=true; do_claude=true; do_claude_desktop=true; do_antigravity=true; do_codex=true; do_gemini=true; do_qwen=true; do_zed=true; do_opencode=true
                    ;;
                selected)
                    [[ "$requested_platforms|" != *"|cursor|"* ]] || do_cursor=true
                    [[ "$requested_platforms|" != *"|claude-code|"* ]] || do_claude=true
                    [[ "$requested_platforms|" != *"|claude-desktop|"* ]] || do_claude_desktop=true
                    [[ "$requested_platforms|" != *"|antigravity|"* ]] || do_antigravity=true
                    [[ "$requested_platforms|" != *"|codex|"* ]] || do_codex=true
                    [[ "$requested_platforms|" != *"|gemini|"* ]] || do_gemini=true
                    [[ "$requested_platforms|" != *"|qwen|"* ]] || do_qwen=true
                    [[ "$requested_platforms|" != *"|zed|"* ]] || do_zed=true
                    [[ "$requested_platforms|" != *"|opencode|"* ]] || do_opencode=true
                    ;;
            esac

            CONFIGURED_CURSOR=""
            CONFIGURED_CLAUDE_CODE=""
            CONFIGURED_CLAUDE_DESKTOP=""
            CONFIGURED_ANTIGRAVITY=""
            CONFIGURED_CODEX=""
            CONFIGURED_GEMINI=""
            CONFIGURED_QWEN=""
            CONFIGURED_ZED=""
            CONFIGURED_OPENCODE=""

            # Skip MCP server regen if already exists and not forced
            if [[ "$force" == "false" ]] && [[ -f "${PROJECT_ROOT}/.antigravity/mcp-manifest.json" ]]; then
                skip_mcp_generate=true
            fi

            # Stage and validate the candidate runtime before touching client configs.
            if [[ "$skip_mcp_generate" == "false" ]]; then
                setup_mcp_server || return 1
                sync_canonical_server || return 1
                echo ""
                write_forgewright_settings || return 1
                echo ""
            else
                log_ok "MCP server already exists (use --force to re-generate)"
                sync_canonical_server || return 1
                echo ""
            fi

            # Setup platforms
            if [[ "$do_cursor" == "true" ]]; then
                setup_cursor || return 1
                echo ""
            fi

            if [[ "$do_claude" == "true" ]]; then
                setup_claude_code || return 1
                echo ""
            fi

            if [[ "$do_claude_desktop" == "true" ]]; then
                setup_claude_desktop || return 1
                echo ""
            fi

            if [[ "$do_antigravity" == "true" ]]; then
                setup_antigravity || return 1
                echo ""
            fi

            if [[ "$do_codex" == "true" ]]; then
                setup_codex || return 1
                echo ""
            fi

            if [[ "$do_gemini" == "true" ]]; then
                setup_gemini || return 1
                echo ""
            fi

            if [[ "$do_qwen" == "true" ]]; then
                setup_qwen || return 1
                echo ""
            fi

            if [[ "$do_zed" == "true" ]]; then
                setup_zed || return 1
                echo ""
            fi

            if [[ "$do_opencode" == "true" ]]; then
                setup_opencode || return 1
                echo ""
            fi

            # Publish only after the candidate and every selected client config pass.
            publish_canonical_server || return 1
            publish_runtime_ownership || return 1
            publish_manifest \
                "$CONFIGURED_CURSOR" "$CONFIGURED_CLAUDE_CODE" "$CONFIGURED_CLAUDE_DESKTOP" \
                "$CONFIGURED_ANTIGRAVITY" "$CONFIGURED_CODEX" "$CONFIGURED_GEMINI" \
                "$CONFIGURED_ZED" "$CONFIGURED_OPENCODE" "$CONFIGURED_QWEN" || return 1
            verify_manifest || return 1
            commit_runtime_transaction || return 1
            echo ""

            # Built-in research MCPs (non-blocking check)
            install_builtin_mcps || log_warn "Built-in research MCP setup was incomplete"
            echo ""

            verify_installation || return 1
            echo ""

            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo -e " ${GREEN}✓ Universal MCP Setup Complete${NC}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "  Configured for:"
            [[ -n "$CONFIGURED_CURSOR" ]] && has_canonical_mcp_config "$CONFIGURED_CURSOR" && echo "    ✓ Cursor ($CONFIGURED_CURSOR)"
            [[ -n "$CONFIGURED_CLAUDE_CODE" ]] && has_canonical_mcp_config "$CONFIGURED_CLAUDE_CODE" && echo "    ✓ Claude Code ($CONFIGURED_CLAUDE_CODE)"
            [[ -n "$CONFIGURED_CLAUDE_DESKTOP" ]] && has_canonical_mcp_config "$CONFIGURED_CLAUDE_DESKTOP" && echo "    ✓ Claude Desktop ($CONFIGURED_CLAUDE_DESKTOP)"
            [[ -n "$CONFIGURED_ANTIGRAVITY" ]] && has_canonical_mcp_config "$CONFIGURED_ANTIGRAVITY" && echo "    ✓ Antigravity ($CONFIGURED_ANTIGRAVITY)"
            [[ -n "$CONFIGURED_CODEX" ]] && has_canonical_mcp_config "$CONFIGURED_CODEX" && echo "    ✓ OpenAI Codex CLI ($CONFIGURED_CODEX)"
            [[ -n "$CONFIGURED_GEMINI" ]] && has_canonical_mcp_config "$CONFIGURED_GEMINI" && echo "    ✓ Google Gemini CLI ($CONFIGURED_GEMINI)"
            [[ -n "$CONFIGURED_QWEN" ]] && has_canonical_mcp_config "$CONFIGURED_QWEN" && echo "    ✓ Qwen Code ($CONFIGURED_QWEN)"
            [[ -n "$CONFIGURED_ZED" ]] && has_canonical_mcp_config "$CONFIGURED_ZED" zed && echo "    ✓ Zed AI ($CONFIGURED_ZED)"
            [[ -n "$CONFIGURED_OPENCODE" ]] && has_canonical_mcp_config "$CONFIGURED_OPENCODE" opencode && echo "    ✓ OpenCode ($CONFIGURED_OPENCODE)"
            echo ""
            echo "  Next: Restart your AI clients to activate MCP servers"
            echo "        Verify: bash ${BASH_SOURCE[0]} --check"
            echo ""
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
