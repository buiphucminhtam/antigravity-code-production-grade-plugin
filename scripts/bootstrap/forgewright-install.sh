#!/usr/bin/env bash
# =============================================================================
# Forgewright Install Script
# =============================================================================
# Install Forgewright with different profile configurations
#
# Usage:
#   forgewright install              # Interactive install
#   forgewright install --profile minimal   # Core pipeline only
#   forgewright install --profile core     # + security, QA
#   forgewright install --profile full     # Everything
#   forgewright install --dry-run           # Show what would be installed
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Forgewright directory
FORGEWRIGHT_DIR="${FORGEWRIGHT_DIR:-$HOME/.forgewright}"
SKILLS_DIR="$FORGEWRIGHT_DIR/skills"
CONFIG_DIR="$FORGEWRIGHT_DIR/config"

# Profile definitions (using colon-separated string for bash 3 compatibility)
PROFILE_MINIMAL_DESC="Core pipeline only - orchestrator, memory, basic engineering"
PROFILE_CORE_DESC="Core + security, QA, code review"
PROFILE_FULL_DESC="Everything - all skills, all features"

# Core skills (minimal profile)
MINIMAL_SKILLS=(
    "production-grade"
    "business-analyst"
    "product-manager"
    "solution-architect"
    "software-engineer"
    "frontend-engineer"
    "qa-engineer"
    "polymath"
    "memory-manager"
    "mcp-generator"
)

# Core + security, QA additions
CORE_SKILLS=(
    "${MINIMAL_SKILLS[@]}"
    "security-engineer"
    "code-reviewer"
    "devops"
    "database-engineer"
    "api-designer"
)

# Full profile - all skills
FULL_SKILLS=(
    "${CORE_SKILLS[@]}"
    "ai-engineer"
    "data-engineer"
    "performance-engineer"
    "ux-researcher"
    "ui-designer"
    "interaction-designer"
    "accessibility-engineer"
    "mobile-engineer"
    "game-designer"
    "unity-engineer"
    "unreal-engineer"
    "godot-engineer"
    "roblox-engineer"
    "xr-engineer"
    "autonomous-testing"
    "growth-marketer"
    "conversion-optimizer"
    "web-scraper"
    "notebooklm-researcher"
    "prompt-engineer"
    "prompt-optimizer"
    "project-manager"
    "xlsx-engineer"
    "debugger"
    "technical-writer"
    "concept-artist"
    "art-director"
    "vision-review"
    "game-audio-engineer"
    "game-asset-vfx"
    "level-designer"
    "narrative-designer"
    "technical-artist"
    "unity-shader-artist"
    "unity-multiplayer"
    "unreal-technical-artist"
    "unreal-multiplayer"
    "godot-multiplayer"
    "phaser3-engineer"
    "threejs-engineer"
    "skill-maker"
    "parallel-dispatch"
    "goal-driven"
    "data-scientist"
)

# Language-specific skills
LANGUAGE_SKILLS=(
    "software-engineer-python"
    "software-engineer-go"
    "software-engineer-rust"
    "code-reviewer-python"
    "code-reviewer-go"
    "code-reviewer-rust"
)

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_header() {
    echo ""
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
}

show_help() {
    cat << EOF
${BOLD}forgewright install${NC}

Install Forgewright with customizable profiles.

${BOLD}USAGE${NC}
    forgewright install [options]

${BOLD}OPTIONS${NC}
    -p, --profile <profile>    Install profile: minimal, core, or full
    -d, --dry-run             Show what would be installed without installing
    -y, --yes                 Skip confirmation prompts
    -h, --help                Show this help message
    --skip-mcp                Skip MCP server installation
    --skip-skills             Skip skills installation
    --skip-config             Skip configuration files

${BOLD}PROFILES${NC}
    minimal                   Core pipeline only (orchestrator, memory, basic engineering)
                               Installs: $(echo "${MINIMAL_SKILLS[*]}" | tr ' ' ', ')

    core                      Core + security, QA (recommended)
                               Adds: security-engineer, code-reviewer, devops, database-engineer

    full                      Everything (all skills, all features)
                               Adds: game dev, XR, AI, mobile, growth, and more

${BOLD}EXAMPLES${NC}
    forgewright install                    # Interactive install
    forgewright install --profile minimal  # Install minimal profile
    forgewright install --profile full    # Install everything
    forgewright install --dry-run         # Preview what would be installed

EOF
}

select_profile() {
    log_header "Forgewright Installation"

    echo "Select installation profile:"
    echo ""
    echo "  1) minimal - Core pipeline only"
    echo "     → $(echo "${MINIMAL_SKILLS[*]:0:5}" | tr ' ' ', ')..."
    echo ""
    echo "  2) core   - Core + security, QA (recommended)"
    echo "     → security-engineer, code-reviewer, devops, + more"
    echo ""
    echo "  3) full   - Everything"
    echo "     → game-dev, XR, AI, mobile, growth, + more"
    echo ""

    while true; do
        read -p "Enter choice [1-3] (default: 2): " choice
        choice="${choice:-2}"

        case "$choice" in
            1) PROFILE="minimal"; break;;
            2) PROFILE="core"; break;;
            3) PROFILE="full"; break;;
            *) log_error "Invalid choice. Please enter 1, 2, or 3.";;
        esac
    done

    echo ""
    log_info "Selected profile: ${BOLD}$PROFILE${NC}"
    case "$PROFILE" in
        minimal) echo "  $PROFILE_MINIMAL_DESC";;
        core) echo "  $PROFILE_CORE_DESC";;
        full) echo "  $PROFILE_FULL_DESC";;
    esac
}

get_skills_for_profile() {
    local profile="$1"
    case "$profile" in
        minimal) echo "${MINIMAL_SKILLS[*]}";;
        core) echo "${CORE_SKILLS[*]}";;
        full) echo "${FULL_SKILLS[*]} ${LANGUAGE_SKILLS[*]}";;
    esac
}

install_skills() {
    local profile="$1"
    local dry_run="$2"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing Skills"

    # Always install language-specific skills with any profile
    local all_skills=($(get_skills_for_profile "$profile") "${LANGUAGE_SKILLS[@]}")

    log_info "Installing ${#all_skills[@]} skills for profile: $profile"
    echo ""

    for skill in "${all_skills[@]}"; do
        local skill_source="$source_dir/skills/$skill"
        local skill_dest="$SKILLS_DIR/$skill"

        if [[ -d "$skill_source" ]]; then
            if [[ "$dry_run" == "true" ]]; then
                echo "  [DRY RUN] Would install: $skill"
            else
                mkdir -p "$(dirname "$skill_dest")"
                if [[ -L "$skill_dest" ]]; then
                    rm "$skill_dest"
                elif [[ -d "$skill_dest" ]]; then
                    log_warn "Skill already exists: $skill (skipping)"
                    continue
                fi
                ln -sf "$skill_source" "$skill_dest"
                log_success "Installed: $skill"
            fi
        else
            if [[ "$dry_run" == "false" ]]; then
                log_warn "Skill not found: $skill"
            fi
        fi
    done

    echo ""
}

install_mcp() {
    local dry_run="$1"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing MCP Server"

    local mcp_source="$source_dir/.forgewright/mcp-server"
    local mcp_dest="$FORGEWRIGHT_DIR/mcp-server"

    if [[ "$dry_run" == "true" ]]; then
        echo "  [DRY RUN] Would install MCP server to: $mcp_dest"
        return
    fi

    if [[ -d "$mcp_source" ]]; then
        mkdir -p "$(dirname "$mcp_dest")"
        if [[ -d "$mcp_dest" ]]; then
            log_warn "MCP server already exists (skipping)"
        else
            cp -r "$mcp_source" "$mcp_dest"
            log_success "Installed MCP server"
        fi
    else
        log_warn "MCP server source not found at: $mcp_source"
    fi

    echo ""
    log_info "Setting up MCP configurations..."

    # Setup for Claude Code
    if command -v claude &> /dev/null || [[ -f "$HOME/.claude/settings.json" ]]; then
        log_info "Setting up Claude Code MCP..."
        "$source_dir/scripts/forgewright-mcp-setup.sh" --claude-code 2>/dev/null || true
    fi

    # Setup for Cursor
    if command -v cursor &> /dev/null || [[ -f "$HOME/.cursor/mcp.json" ]]; then
        log_info "Setting up Cursor MCP..."
        "$source_dir/scripts/forgewright-mcp-setup.sh" --cursor 2>/dev/null || true
    fi

    log_success "MCP configuration complete"
    echo ""
}

install_config() {
    local dry_run="$1"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing Configuration"

    local config_sources=(
        ".production-grade.yaml"
        "CLAUDE.md"
        "AGENTS.md"
        ".forgewright/skills-config.json"
    )
    local config_dests=(
        "$FORGEWRIGHT_DIR/.production-grade.yaml"
        "$FORGEWRIGHT_DIR/CLAUDE.md"
        "$FORGEWRIGHT_DIR/AGENTS.md"
        "$CONFIG_DIR/skills-config.json"
    )

    for index in "${!config_sources[@]}"; do
        local config="${config_sources[$index]}"
        local config_source="$source_dir/$config"
        local config_dest="${config_dests[$index]}"

        if [[ -f "$config_source" ]]; then
            if [[ "$dry_run" == "true" ]]; then
                echo "  [DRY RUN] Would install: $config -> $config_dest"
            else
                mkdir -p "$(dirname "$config_dest")"
                # Never replace a project/user-owned file or symlink. This keeps
                # reruns idempotent and prevents a fresh bundle from clobbering
                # executable-router settings that a user has customized.
                if [[ -e "$config_dest" || -L "$config_dest" ]]; then
                    log_warn "Config already exists: $config_dest (skipping)"
                else
                    atomic_copy_file "$config_source" "$config_dest"
                    log_success "Installed: $config -> $config_dest"
                fi
            fi
        elif [[ "$dry_run" == "false" ]]; then
            log_warn "Config source not found: $config_source"
        fi
    done

    echo ""
}

atomic_copy_file() {
    local source="$1"
    local target="$2"
    python3 - "$source" "$target" <<'PYEOF'
import os
import shutil
import sys
import tempfile
from pathlib import Path

source, target = map(Path, sys.argv[1:])
target.parent.mkdir(parents=True, exist_ok=True)
mode = source.stat().st_mode & 0o777
fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
try:
    os.chmod(temporary, mode)
    with os.fdopen(fd, "wb") as handle, source.open("rb") as source_handle:
        fd = None
        shutil.copyfileobj(source_handle, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
    directory_fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
except BaseException:
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
PYEOF
}

atomic_write_text() {
    local target="$1"
    local content
    content="$(cat)"
    ATOMIC_CONTENT="$content" python3 - "$target" <<'PYEOF'
import os
import sys
import tempfile
from pathlib import Path

target = Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
content = os.environ.get("ATOMIC_CONTENT", "")
mode = target.stat().st_mode & 0o777 if target.exists() else 0o600
fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
try:
    os.chmod(temporary, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        fd = None
        handle.write(content if content.endswith("\n") else content + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
    directory_fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
except BaseException:
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
PYEOF
}

install_rule_context_runtime() {
    local source_dir="$1"
    local runtime_dir="$FORGEWRIGHT_DIR/scripts/lite"
    local source_hook="$source_dir/scripts/lite/rule-context-hook.py"
    local source_manifest="$source_dir/kernel/rule-manifest.json"
    local target_kernel="$FORGEWRIGHT_DIR/kernel"

    if [[ ! -f "$source_hook" || ! -f "$source_manifest" ]]; then
        log_warn "Rule context runtime unavailable; lifecycle hooks remain unchanged"
        return 0
    fi

    mkdir -p "$runtime_dir" "$target_kernel"
    cp "$source_hook" "$runtime_dir/rule-context-hook.py"
    cp "$source_manifest" "$target_kernel/rule-manifest.json"
    chmod +x "$runtime_dir/rule-context-hook.py"

    if ! python3 - "$source_manifest" "$source_dir" "$FORGEWRIGHT_DIR" <<'PYEOF'
import json
import shutil
import sys
from pathlib import Path
from pathlib import PureWindowsPath

manifest_path, source_root, target_root = map(Path, sys.argv[1:])
payload = json.loads(manifest_path.read_text(encoding="utf-8"))
source_root = source_root.resolve()
for rule in payload.get("rules", []):
    if rule.get("status") != "active" or rule.get("canonical", True) is False:
        continue
    source = rule.get("source")
    if not isinstance(source, str) or not source or "\x00" in source:
        raise ValueError(f"invalid active rule source: {source!r}")
    normalized = source.replace("\\", "/")
    relative = Path(normalized)
    windows = PureWindowsPath(normalized)
    if relative.is_absolute() or windows.is_absolute() or windows.drive or ".." in relative.parts or "." in relative.parts:
        raise ValueError(f"unsafe active rule source: {source!r}")
    source_file = (source_root / relative).resolve(strict=True)
    source_file.relative_to(source_root)
    if not source_file.is_file():
        raise ValueError(f"active rule source is not a file: {source!r}")
    destination = target_root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_file, destination)
PYEOF
    then
        log_warn "Could not copy active rule sources; lifecycle hooks remain fail-open"
    fi
}

shell_quote() {
    local value="$1"
    # Use the portable shell literal form '"'"' for embedded apostrophes.
    # Backslash escaping does not work inside single-quoted shell strings.
    value="$(printf '%s' "$value" | sed "s/'/'\\\"'\\\"'/g")"
    printf "'%s'" "$value"
}

rule_context_command() {
    local hook_path="$1"
    local fallback_workspace="$2"
    local platform="$3"
    local event="$4"
    # Global lifecycle configs are invoked from arbitrary project directories.
    # Resolve the project at invocation time, and only select its manifest after
    # the installed runtime has validated it.  The framework install remains a
    # safe fallback for non-project directories and malformed project state.
    local resolver=''
    resolver+='hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4"; '
    resolver+='if [ "${FORGEWRIGHT_RULE_HOOK_MODE:-observe}" = "off" ]; then printf "%s\\n" "{\"continue\":true}"; exit 0; fi; '
    resolver+='hint="${FORGEWRIGHT_PROJECT_ROOT:-${FORGEWRIGHT_WORKSPACE:-}}"; '
    resolver+='host_hint=""; if [ -z "$hint" ]; then case "$platform" in '
    resolver+='CLAUDE) host_hint="${CLAUDE_PROJECT_DIR:-}";; '
    resolver+='CURSOR) host_hint="${CURSOR_PROJECT_DIR:-}";; '
    resolver+='esac; hint="$host_hint"; fi; '
    resolver+='if [ -z "$hint" ]; then hint="${PWD:-}"; fi; '
    resolver+='candidate=""; if [ -d "$hint" ]; then candidate="$(cd "$hint" 2>/dev/null && pwd -P || true)"; fi; '
    resolver+='if [ -z "${FORGEWRIGHT_PROJECT_ROOT:-}" ] && [ -z "${FORGEWRIGHT_WORKSPACE:-}" ] && [ -z "$host_hint" ] && command -v git >/dev/null 2>&1; then '
    resolver+='git_root="$(git -C "${candidate:-${PWD:-.}}" rev-parse --show-toplevel 2>/dev/null || true)"; '
    resolver+='case "$git_root" in /*) candidate="$git_root";; esac; fi; '
    resolver+='runtime="$hook_path"; workspace="$fallback_workspace"; '
    resolver+='if [ -f "$hook_path" ] && [ -n "$candidate" ] && [ -f "$candidate/kernel/rule-manifest.json" ] && python3 - "$hook_path" "$candidate" <<'"'"'PYEOF'"'"'
import importlib.util
import sys
from pathlib import Path

try:
    spec = importlib.util.spec_from_file_location("forgewright_rule_context_hook", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    module.load_manifest(Path(sys.argv[2]))
except Exception:
    raise SystemExit(1)
PYEOF
    then workspace="$candidate"; fi; '
    resolver+='if [ ! -f "$runtime" ]; then printf "%s\\n" "{\"continue\":true}"; exit 0; fi; '
    resolver+='python3 "$runtime" --platform "$platform" --event "$event" --workspace "$workspace" || printf "%s\\n" "{\"continue\":true}"'
    printf 'FORGEWRIGHT_RULE_HOOK_MODE="${FORGEWRIGHT_RULE_HOOK_MODE:-observe}" sh -c %s -- %s %s %s %s || true' \
        "$(shell_quote "$resolver")" "$(shell_quote "$hook_path")" "$(shell_quote "$fallback_workspace")" "$platform" "$event"
}

install_hooks() {
    local dry_run="$1"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing Hooks"

    if [[ "$dry_run" == "true" ]]; then
        echo "  [DRY RUN] Would install settings.json and hooks.json to global paths"
        return
    fi

    # Installed (global) configs use absolute paths so they work from any cwd.
    local gate_script="${FORGEWRIGHT_DIR}/scripts/lite/stop-gate.sh"
    local gate_runtime_dir="${FORGEWRIGHT_DIR}/scripts/lite"
    mkdir -p "$gate_runtime_dir"
    install_rule_context_runtime "$source_dir"
    local context_hook="${FORGEWRIGHT_DIR}/scripts/lite/rule-context-hook.py"
    local context_workspace="${FORGEWRIGHT_DIR}"
    local gate_runtime_file
    for gate_runtime_file in stop-gate.sh gemini-before-tool-gate.sh antigravity-pre-tool-gate.sh verify-gate.sh verify_gate.py \
        run-check.sh run_check.py rule-validator.py rule-ledger.sh policy-check.sh telemetry.sh; do
        cp "${source_dir}/scripts/lite/${gate_runtime_file}" "${gate_runtime_dir}/${gate_runtime_file}"
    done
    chmod +x "$gate_runtime_dir/stop-gate.sh" "$gate_runtime_dir/gemini-before-tool-gate.sh" \
        "$gate_runtime_dir/antigravity-pre-tool-gate.sh" \
        "$gate_runtime_dir/verify-gate.sh" "$gate_runtime_dir/rule-validator.py" \
        "$gate_runtime_dir/run-check.sh" "$gate_runtime_dir/run_check.py" \
        "$gate_runtime_dir/rule-ledger.sh" "$gate_runtime_dir/policy-check.sh" \
        "$gate_runtime_dir/telemetry.sh"

    local claude_session_cmd claude_subagent_cmd gemini_before_agent_cmd antigravity_pre_invocation_cmd cursor_session_cmd codex_session_cmd codex_subagent_cmd
    claude_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CLAUDE SessionStart)"
    claude_subagent_cmd="$(rule_context_command "$context_hook" "$context_workspace" CLAUDE SubagentStart)"
    gemini_before_agent_cmd="$(rule_context_command "$context_hook" "$context_workspace" GEMINI BeforeAgent)"
    antigravity_pre_invocation_cmd="$(rule_context_command "$context_hook" "$context_workspace" ANTIGRAVITY PreInvocation)"
    cursor_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CURSOR sessionStart)"
    codex_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CODEX SessionStart)"
    codex_subagent_cmd="$(rule_context_command "$context_hook" "$context_workspace" CODEX SubagentStart)"

    # ── Claude Code Settings ──────────────────────────────────────────────────
    # Real schema: hooks.Stop is an array of matcher-group objects, each with a
    # nested hooks array of {type, command} objects.  hooks.stop (lowercase) is
    # NOT a valid key and is silently ignored by Claude Code.
    mkdir -p "$HOME/.claude"
    CLAUDE_SESSION_CMD="$claude_session_cmd" CLAUDE_SUBAGENT_CMD="$claude_subagent_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "${HOME}/.claude/settings.json" <<'NODE'
var fs = require('fs');
var path = require('path');
var file = process.argv[2];
function atomicWrite(target, content) {
  var temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(target).mode; } catch (_) {}
  var fd;
  try {
    fd = fs.openSync(temporary, 'w', mode);
    fs.writeSync(fd, content, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg.hooks) cfg.hooks = {};
function gateCommand(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+--platform\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[4] !== platform) return null;
  return match[1] || match[2] || match[3];
}
function currentGate(command, platform) {
  return gateCommand(command, platform) === path.resolve(process.env.GATE_SCRIPT);
}
function legacyVerifyGate(command, platform) {
  var script = gateCommand(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  if (!path.isAbsolute(script)) {
    var relative = path.posix.normalize(script.replace(/\\/g, '/'));
    return ['verify-gate.sh', 'legacy/verify-gate.sh', 'scripts/verify-gate.sh', 'scripts/lite/verify-gate.sh', '.forgewright/scripts/lite/verify-gate.sh'].includes(relative);
  }
  var normalized = path.posix.normalize(script.replace(/\\/g, '/'));
  var installedLegacy = path.posix.normalize(path.dirname(process.env.GATE_SCRIPT).replace(/\\/g, '/') + '/verify-gate.sh');
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return normalized === installedLegacy ||
    normalized === path.posix.join(framework, 'verify-gate.sh') ||
    normalized === path.posix.join(framework, 'scripts', 'verify-gate.sh');
}
// Remove any stale string-form stop key left by previous installs
delete cfg.hooks.stop;
// Idempotent merge: only add if our command is not already present
var Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
Stop = Stop.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !legacyVerifyGate(h && h.command, 'CLAUDE'); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = Stop.some(function(g){
  return Array.isArray(g.hooks) && g.hooks.some(function(h){ return currentGate(h && h.command, 'CLAUDE'); });
});
if (!already) {
  Stop.push({ hooks: [{ type: 'command', command: 'bash ' + process.env.GATE_SCRIPT + ' --platform CLAUDE' }] });
}
cfg.hooks.Stop = Stop;
[
  ['SessionStart', 'startup|resume|clear|compact', process.env.CLAUDE_SESSION_CMD],
  ['SubagentStart', '*', process.env.CLAUDE_SUBAGENT_CMD]
].forEach(function(item) {
  var name = item[0], matcher = item[1], command = item[2];
  var groups = Array.isArray(cfg.hooks[name]) ? cfg.hooks[name] : [];
  var found = false;
  function ownedContext(commandValue) {
    if (commandValue === command) return true;
    if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
    var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+\s+\|\|\s*true\s*$/);
    if (!match) return false;
    var normalized = path.posix.normalize(match[1].replace(/\\/g, '/'));
    var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
    return path.resolve(normalized) === path.join(framework, 'rule-context-hook.py') ||
      path.resolve(normalized) === path.join(framework, 'scripts', 'rule-context-hook.py');
  }
  groups = groups.map(function(g) {
    if (!Array.isArray(g.hooks)) return g;
    var hooks = g.hooks.filter(function(h) {
      if (!h || !ownedContext(h.command)) return true;
      if (!found && h.command === command) { found = true; return true; }
      return false;
    }).map(function(h) {
      return h && h.command === command ? Object.assign({}, h, { type: 'command', timeout: 2 }) : h;
    });
    return Object.assign({}, g, { hooks: hooks });
  }).filter(function(g) { return !Array.isArray(g.hooks) || g.hooks.length > 0; });
  if (!found) groups.push({ matcher: matcher, hooks: [{ type: 'command', command: command, timeout: 2 }] });
  cfg.hooks[name] = groups;
});
atomicWrite(file, JSON.stringify(cfg, null, 2));
NODE
    log_success "Installed .claude/settings.json"

    # ── Gemini Settings ───────────────────────────────────────────────────────
    # Real schema (HookDefinitionArray): AfterAgent must be an array of objects
    # of the form { matcher?: string, hooks: [{ type, command, ... }] }.
    # An array of bare strings causes: "Expected object, received string".
    mkdir -p "$HOME/.gemini"
    GEMINI_BEFORE_AGENT_CMD="$gemini_before_agent_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "${HOME}/.gemini/settings.json" <<'NODE'
var fs = require('fs');
var path = require('path');
var file = process.argv[2];
function atomicWrite(target, content) {
  var temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(target).mode; } catch (_) {}
  var fd;
  try {
    fd = fs.openSync(temporary, 'w', mode);
    fs.writeSync(fd, content, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg.hooks) cfg.hooks = {};
function gateCommand(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+--platform\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[4] !== platform) return null;
  return match[1] || match[2] || match[3];
}
function currentGate(command, platform) {
  return gateCommand(command, platform) === path.resolve(process.env.GATE_SCRIPT);
}
function legacyVerifyGate(command, platform) {
  var script = gateCommand(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  if (!path.isAbsolute(script)) {
    var relative = path.posix.normalize(script.replace(/\\/g, '/'));
    return ['verify-gate.sh', 'legacy/verify-gate.sh', 'scripts/verify-gate.sh', 'scripts/lite/verify-gate.sh', '.forgewright/scripts/lite/verify-gate.sh'].includes(relative);
  }
  var normalized = path.posix.normalize(script.replace(/\\/g, '/'));
  var installedLegacy = path.posix.normalize(path.dirname(process.env.GATE_SCRIPT).replace(/\\/g, '/') + '/verify-gate.sh');
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return normalized === installedLegacy ||
    normalized === path.posix.join(framework, 'verify-gate.sh') ||
    normalized === path.posix.join(framework, 'scripts', 'verify-gate.sh');
}
// Remove stale bare-string array if present
if (Array.isArray(cfg.hooks.AfterAgent) && cfg.hooks.AfterAgent.length > 0 && typeof cfg.hooks.AfterAgent[0] === 'string') {
  cfg.hooks.AfterAgent = [];
}
var AA = Array.isArray(cfg.hooks.AfterAgent) ? cfg.hooks.AfterAgent : [];
AA = AA.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !legacyVerifyGate(h && h.command, 'GEMINI'); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = AA.some(function(g){
  return Array.isArray(g.hooks) && g.hooks.some(function(h){ return currentGate(h && h.command, 'GEMINI'); });
});
if (!already) {
  AA.push({ matcher: '*', hooks: [{ type: 'command', command: 'bash ' + process.env.GATE_SCRIPT + ' --platform GEMINI' }] });
}
cfg.hooks.AfterAgent = AA;
var beforeGate = process.env.FORGEWRIGHT_DIR + '/scripts/lite/gemini-before-tool-gate.sh';
var BT = Array.isArray(cfg.hooks.BeforeTool) ? cfg.hooks.BeforeTool : [];
BT = BT.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !h || typeof h.command !== 'string' || h.command !== 'bash ' + beforeGate; }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
if (!BT.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return h && h.command === 'bash ' + beforeGate; }); })) {
  BT.push({ matcher: '*', hooks: [{ name: 'forgewright-policy', type: 'command', command: 'bash ' + beforeGate, timeout: 5000 }] });
}
cfg.hooks.BeforeTool = BT;
var groups = Array.isArray(cfg.hooks.BeforeAgent) ? cfg.hooks.BeforeAgent : [];
var found = false;
function ownedContext(commandValue) {
  if (commandValue === process.env.GEMINI_BEFORE_AGENT_CMD) return true;
  if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+\s+\|\|\s*true\s*$/);
  if (!match) return false;
  var normalized = path.posix.normalize(match[1].replace(/\\/g, '/'));
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return path.resolve(normalized) === path.join(framework, 'rule-context-hook.py') ||
    path.resolve(normalized) === path.join(framework, 'scripts', 'rule-context-hook.py');
}
groups = groups.map(function(g) {
  if (!Array.isArray(g.hooks)) return g;
  var hooks = g.hooks.filter(function(h) {
    if (!h || !ownedContext(h.command)) return true;
    if (!found && h.command === process.env.GEMINI_BEFORE_AGENT_CMD) { found = true; return true; }
    return false;
  }).map(function(h) {
    return h && h.command === process.env.GEMINI_BEFORE_AGENT_CMD ? Object.assign({}, h, { type: 'command', timeout: 2000 }) : h;
  });
  return Object.assign({}, g, { hooks: hooks });
}).filter(function(g) { return !Array.isArray(g.hooks) || g.hooks.length > 0; });
if (!found) groups.push({ matcher: '*', hooks: [{ name: 'forgewright-rule-context', type: 'command', command: process.env.GEMINI_BEFORE_AGENT_CMD, timeout: 2000 }] });
cfg.hooks.BeforeAgent = groups;
atomicWrite(file, JSON.stringify(cfg, null, 2));
NODE
    log_success "Installed .gemini/settings.json"

    # ── Antigravity CLI Hooks ────────────────────────────────────────────────
    # Antigravity's native hook registry is ~/.gemini/config/hooks.json. It is
    # a map of named hooks, not the Gemini CLI settings.json hooks object.
    mkdir -p "$HOME/.gemini/config"
    ANTIGRAVITY_PRE_INVOCATION_CMD="$antigravity_pre_invocation_cmd" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "${HOME}/.gemini/config/hooks.json" <<'NODE'
var fs = require('fs');
var path = require('path');
var file = process.argv[2];
function atomicWrite(target, content) {
  var temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(target).mode; } catch (_) {}
  var fd;
  try {
    fd = fs.openSync(temporary, 'w', mode);
    fs.writeSync(fd, content, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') throw new Error('Antigravity hooks registry must be an object');
function ownedContext(commandValue) {
  if (commandValue === process.env.ANTIGRAVITY_PRE_INVOCATION_CMD) return true;
  if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+\s+\|\|\s*true\s*$/);
  if (!match) return false;
  var normalized = path.posix.normalize(match[1].replace(/\\/g, '/'));
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return path.resolve(normalized) === path.join(framework, 'rule-context-hook.py') ||
    path.resolve(normalized) === path.join(framework, 'scripts', 'rule-context-hook.py');
}
var policy = cfg['forgewright-policy'];
if (!policy || Array.isArray(policy) || typeof policy !== 'object') policy = {};
if (!Object.prototype.hasOwnProperty.call(policy, 'PreToolUse')) {
  policy.PreToolUse = [{ matcher: '*', hooks: [{ type: 'command', command: 'bash ' + process.env.FORGEWRIGHT_DIR + '/scripts/lite/antigravity-pre-tool-gate.sh', timeout: 5 }] }];
}
var groups = Array.isArray(policy.PreInvocation) ? policy.PreInvocation : [];
var found = false;
groups = groups.filter(function(h) {
  if (!h || !ownedContext(h.command)) return true;
  if (!found && h.command === process.env.ANTIGRAVITY_PRE_INVOCATION_CMD) { found = true; h.timeout = 2; return true; }
  return false;
});
if (!found) groups.push({ type: 'command', command: process.env.ANTIGRAVITY_PRE_INVOCATION_CMD, timeout: 2 });
policy.PreInvocation = groups;
cfg['forgewright-policy'] = policy;
atomicWrite(file, JSON.stringify(cfg, null, 2));
NODE
    log_success "Installed Antigravity hook in .gemini/config/hooks.json"

    # ── Cursor Hooks ──────────────────────────────────────────────────────────
    # Real schema (version 1): hooks.stop must be an array of {command} objects,
    # not a bare string.  version field is required.
    mkdir -p "$HOME/.cursor"
    CURSOR_SESSION_CMD="$cursor_session_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "${HOME}/.cursor/hooks.json" <<'NODE'
var fs = require('fs');
var path = require('path');
var file = process.argv[2];
function atomicWrite(target, content) {
  var temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(target).mode; } catch (_) {}
  var fd;
  try {
    fd = fs.openSync(temporary, 'w', mode);
    fs.writeSync(fd, content, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
cfg.version = 1;
if (!cfg.hooks) cfg.hooks = {};
function gateCommand(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+--platform\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[4] !== platform) return null;
  return match[1] || match[2] || match[3];
}
function currentGate(command, platform) {
  return gateCommand(command, platform) === path.resolve(process.env.GATE_SCRIPT);
}
function legacyVerifyGate(command, platform) {
  var script = gateCommand(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  if (!path.isAbsolute(script)) {
    var relative = path.posix.normalize(script.replace(/\\/g, '/'));
    return ['verify-gate.sh', 'legacy/verify-gate.sh', 'scripts/verify-gate.sh', 'scripts/lite/verify-gate.sh', '.forgewright/scripts/lite/verify-gate.sh'].includes(relative);
  }
  var normalized = path.posix.normalize(script.replace(/\\/g, '/'));
  var installedLegacy = path.posix.normalize(path.dirname(process.env.GATE_SCRIPT).replace(/\\/g, '/') + '/verify-gate.sh');
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return normalized === installedLegacy ||
    normalized === path.posix.join(framework, 'verify-gate.sh') ||
    normalized === path.posix.join(framework, 'scripts', 'verify-gate.sh');
}
// Remove stale string-form stop key
if (typeof cfg.hooks.stop === 'string') delete cfg.hooks.stop;
var stop = Array.isArray(cfg.hooks.stop) ? cfg.hooks.stop : [];
stop = stop.filter(function(h){ return !legacyVerifyGate(h && h.command, 'CURSOR'); });
var already = stop.some(function(h){ return currentGate(h && h.command, 'CURSOR'); });
if (!already) {
  stop.push({ command: 'bash ' + process.env.GATE_SCRIPT + ' --platform CURSOR' });
}
cfg.hooks.stop = stop;
var sessions = Array.isArray(cfg.hooks.sessionStart) ? cfg.hooks.sessionStart : [];
var foundSession = false;
function ownedContext(commandValue) {
  if (commandValue === process.env.CURSOR_SESSION_CMD) return true;
  if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+\s+\|\|\s*true\s*$/);
  if (!match) return false;
  var normalized = path.posix.normalize(match[1].replace(/\\/g, '/'));
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return path.resolve(normalized) === path.join(framework, 'rule-context-hook.py') ||
    path.resolve(normalized) === path.join(framework, 'scripts', 'rule-context-hook.py');
}
sessions = sessions.filter(function(h) {
  if (!h || !ownedContext(h.command)) return true;
  if (!foundSession && h.command === process.env.CURSOR_SESSION_CMD) { foundSession = true; return true; }
  return false;
});
if (!foundSession) sessions.push({ command: process.env.CURSOR_SESSION_CMD });
cfg.hooks.sessionStart = sessions;
atomicWrite(file, JSON.stringify(cfg, null, 2));
NODE
    log_success "Installed .cursor/hooks.json"

    # ── Codex Config (TOML) ───────────────────────────────────────────────────
    # Idempotent: only append if stop-gate.sh is not already present.
    # Also guard against duplicating [features] and [hooks] section headers.
    mkdir -p "$HOME/.codex"
    local codex_file="${HOME}/.codex/config.toml"
    if [[ -f "$codex_file" ]]; then
        FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" python3 - "$codex_file" <<'PYEOF'
import os
import re
import shlex
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
def owned_legacy_verify(command: str) -> bool:
    try:
        parts = shlex.split(command)
    except ValueError:
        return False
    if len(parts) != 4 or parts[0] != "bash" or parts[2] != "--platform" or parts[3] != "CODEX":
        return False
    script = Path(parts[1].replace("\\", "/"))
    if script.name != "verify-gate.sh":
        return False
    if not script.is_absolute():
        return script.as_posix() in {
            "verify-gate.sh",
            "legacy/verify-gate.sh",
            "scripts/verify-gate.sh",
            "scripts/lite/verify-gate.sh",
            ".forgewright/scripts/lite/verify-gate.sh",
        }
    normalized = script.as_posix()
    installed = (Path(os.environ["FORGEWRIGHT_DIR"]) / "scripts" / "lite" / "verify-gate.sh").as_posix()
    framework = Path(os.environ["FORGEWRIGHT_DIR"]).resolve().as_posix()
    return normalized == installed or normalized == f"{framework}/verify-gate.sh" or normalized == f"{framework}/scripts/verify-gate.sh"
legacy = re.compile(
    r'\n?\[\[hooks\.Stop\]\]\n'
    r'(?:matcher\s*=\s*"[^"]*"\n)?'
    r'\[\[hooks\.Stop\.hooks\]\]\n'
    r'type\s*=\s*"command"\n'
    r'command\s*=\s*"(?P<command>[^"]*verify-gate\.sh --platform CODEX)"\n'
    r'(?:timeout\s*=\s*\d+\s*\n)?'
)
updated = legacy.sub(lambda match: "\n" if owned_legacy_verify(match.group("command")) else match.group(0), text)
# Older installers left the hook timeout in the parent [hooks] table after
# removing the legacy hook array.  It is only valid on the nested hook object.
lines = updated.splitlines(keepends=True)
cleaned = []
in_hooks = False
for line in lines:
    stripped = line.strip()
    if stripped == "[hooks]":
        in_hooks = True
    elif stripped.startswith("["):
        in_hooks = False
    if in_hooks and re.fullmatch(r"timeout\s*=\s*\d+", stripped):
        continue
    cleaned.append(line)
updated = "".join(cleaned)
if updated == text:
    raise SystemExit(0)
mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
try:
    os.chmod(temporary, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
except BaseException:
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
PYEOF
    fi
    if [[ ! -f "$codex_file" ]]; then
        atomic_write_text "$codex_file" <<EOF
[features]
hooks = true

[hooks]

[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = "bash ${gate_script} --platform CODEX"
EOF
    elif ! grep -qF "stop-gate.sh" "$codex_file" 2>/dev/null; then
        # File exists but our hook is not present yet.
        # Only append the [[hooks.Stop]] stanza; skip [features]/[hooks] headers
        # if they already exist to avoid TOML duplicate-key errors.
        local needs_features=true needs_hooks=true
        grep -qF '[features]' "$codex_file" 2>/dev/null && needs_features=false
        grep -qF '[hooks]' "$codex_file" 2>/dev/null && needs_hooks=false
        {
            cat "$codex_file"
            echo ""
            $needs_features && echo '[features]' && echo 'hooks = true' && echo ""
            $needs_hooks && echo '[hooks]' && echo ""
            cat <<'HOOKBLOCK'
[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
HOOKBLOCK
            echo "command = \"bash ${gate_script} --platform CODEX\""
        } | atomic_write_text "$codex_file"
    fi
    CONTEXT_SESSION_CMD="$codex_session_cmd" CONTEXT_SUBAGENT_CMD="$codex_subagent_cmd" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" python3 - "$codex_file" <<'PYEOF'
import json
import os
import re
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8") if path.exists() else ""
if "[hooks]" not in text:
    text += "\n[hooks]\n"

def owned_context_command(candidate, expected):
    if candidate == expected:
        return True
    marker = 'hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";'
    if not candidate.startswith("FORGEWRIGHT_RULE_HOOK_MODE=") or marker not in candidate:
        return False
    match = re.search(r"\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+\s+\|\|\s*true\s*$", candidate)
    if not match:
        return False
    normalized = Path(match.group(1).replace("\\", "/")).resolve()
    framework = Path(os.environ["FORGEWRIGHT_DIR"]).resolve()
    return normalized in (framework / "rule-context-hook.py", framework / "scripts" / "rule-context-hook.py")

def replace_context_blocks(value, event, matcher, command):
    lines = value.splitlines(keepends=True)
    outer = f"[[hooks.{event}]]"
    nested = f"[[hooks.{event}.hooks]]"
    output = []
    index = 0
    while index < len(lines):
        if lines[index].strip() != outer:
            output.append(lines[index])
            index += 1
            continue
        end = index + 1
        while end < len(lines):
            stripped = lines[end].strip()
            if (stripped.startswith("[[hooks.") and stripped != nested) or (stripped.startswith("[") and not stripped.startswith("[[")):
                break
            end += 1
        chunk = lines[index:end]
        starts = [offset for offset, line in enumerate(chunk) if line.strip() == nested]
        context_segments = []
        for offset, start in enumerate(starts):
            stop = starts[offset + 1] if offset + 1 < len(starts) else len(chunk)
            block = "".join(chunk[start:stop])
            command_match = re.search(r'command\s*=\s*("(?:\\.|[^"\\])*")', block)
            candidate = json.loads(command_match.group(1)) if command_match else ""
            owned = bool(command_match and owned_context_command(candidate, command))
            context_segments.append((start, stop, owned))
        if not any(flag for _, _, flag in context_segments):
            output.extend(chunk)
        else:
            first_nested = starts[0]
            kept = [chunk[start:stop] for start, stop, flag in context_segments if not flag]
            if kept:
                output.extend(chunk[:first_nested])
                for segment in kept:
                    output.extend(segment)
        index = end
    value = "".join(output)
    if not value.endswith("\n"):
        value += "\n"
    value += (
        f"\n[[hooks.{event}]]\n"
        f"matcher = {json.dumps(matcher)}\n"
        f"[[hooks.{event}.hooks]]\n"
        "type = \"command\"\n"
        f"command = {json.dumps(command)}\n"
        "timeout = 2\n"
    )
    return value

for event, matcher, command in (
    ("SessionStart", "startup|resume|clear|compact", os.environ["CONTEXT_SESSION_CMD"]),
    ("SubagentStart", "*", os.environ["CONTEXT_SUBAGENT_CMD"]),
):
    text = replace_context_blocks(text, event, matcher, command)
def atomic_write(target: Path, value: str) -> None:
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o600
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        os.chmod(temporary, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value if value.endswith("\n") else value + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise

atomic_write(path, text)
PYEOF
    log_success "Installed .codex/config.toml"
    echo ""
}

install_scripts() {
    local dry_run="$1"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing Scripts"

    local bin_dir="$FORGEWRIGHT_DIR/bin"
    mkdir -p "$bin_dir"

    local scripts=(
        "bootstrap/forgewright-install.sh"
        "runtime/forgewright-lifecycle.sh"
        "bootstrap/forgewright-update.sh"
        "mcp/forgewright-mcp-setup.sh"
        "memory/memory-middleware.py"
        "memory/mem0-v2.py"
        "runtime/forgewright-session-tracker.sh"
        "skills/forgewright-lesson-migrator.sh"
    )

    for script_path in "${scripts[@]}"; do
        local script="$(basename "$script_path")"
        local script_source="$source_dir/scripts/$script_path"
        local script_dest="$bin_dir/$script"

        if [[ -f "$script_source" ]]; then
            if [[ "$dry_run" == "true" ]]; then
                echo "  [DRY RUN] Would install: $script"
            else
                cp "$script_source" "$script_dest"
                chmod +x "$script_dest"
                log_success "Installed: $script"
            fi
        fi
    done

    echo ""
}

create_alias() {
    local dry_run="$1"

    if [[ "$dry_run" == "true" ]]; then
        echo "  [DRY RUN] Would create shell alias"
        return
    fi

    log_header "Creating Shell Alias"

    local shell_rc=""
    local alias_line='alias forgewright="'"$FORGEWRIGHT_DIR"'/bin/forgewright-lifecycle.sh"'

    # Detect shell
    if [[ -n "${BASH_VERSION:-}" ]]; then
        if [[ -f "$HOME/.bashrc" ]]; then
            shell_rc="$HOME/.bashrc"
        fi
    elif [[ -n "${ZSH_VERSION:-}" ]]; then
        if [[ -f "$HOME/.zshrc" ]]; then
            shell_rc="$HOME/.zshrc"
        fi
    fi

    if [[ -n "$shell_rc" ]]; then
        if ! grep -q "forgewright-lifecycle" "$shell_rc" 2>/dev/null; then
            echo "" >> "$shell_rc"
            echo "# Forgewright CLI" >> "$shell_rc"
            echo "$alias_line" >> "$shell_rc"
            echo "" >> "$shell_rc"
            echo "# Add forgewright to PATH" >> "$shell_rc"
            echo 'export PATH="'"$FORGEWRIGHT_DIR"'/bin:\$PATH"' >> "$shell_rc"
            log_success "Added alias to $shell_rc"
            echo ""
            echo "  Please run: source $shell_rc"
            echo "  Or restart your terminal"
        else
            log_info "Alias already exists in $shell_rc"
        fi
    fi

    # Also add to PATH in profile
    mkdir -p "$FORGEWRIGHT_DIR/bin"

    echo ""
}

confirm_install() {
    local profile="$1"
    local total_skills=$((${#MINIMAL_SKILLS[@]}))

    case "$profile" in
        minimal) total_skills=${#MINIMAL_SKILLS[@]};;
        core) total_skills=${#CORE_SKILLS[@]};;
        full) total_skills=$((${#FULL_SKILLS[@]} + ${#LANGUAGE_SKILLS[@]}));;
    esac

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  Installation Summary"
    echo "════════════════════════════════════════════════════════════"
    echo "  Profile:      $profile"
    echo "  Skills:       $total_skills"
    echo "  Install dir:  $FORGEWRIGHT_DIR"
    echo "════════════════════════════════════════════════════════════"
    echo ""
}

# Parse arguments
PROFILE=""
DRY_RUN="false"
YES="false"
SKIP_MCP="false"
SKIP_SKILLS="false"
SKIP_CONFIG="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN="true"
            shift
            ;;
        -y|--yes)
            YES="true"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        --skip-mcp)
            SKIP_MCP="true"
            shift
            ;;
        --skip-skills)
            SKIP_SKILLS="true"
            shift
            ;;
        --skip-config)
            SKIP_CONFIG="true"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate profile
if [[ -z "$PROFILE" ]]; then
    select_profile
elif [[ "$PROFILE" != "minimal" && "$PROFILE" != "core" && "$PROFILE" != "full" ]]; then
    log_error "Invalid profile: $PROFILE"
    echo "Valid profiles: minimal, core, full"
    exit 1
fi

# Dry run mode
if [[ "$DRY_RUN" == "true" ]]; then
    log_header "DRY RUN MODE"
    log_info "This will show what would be installed without making changes"
    echo ""
fi

# Show summary and get confirmation
confirm_install "$PROFILE"

if [[ "$DRY_RUN" == "false" && "$YES" == "false" ]]; then
    read -p "Continue with installation? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
fi

# Create directories
if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p "$FORGEWRIGHT_DIR" "$SKILLS_DIR" "$CONFIG_DIR"
fi

# Install components
if [[ "$SKIP_SKILLS" == "false" ]]; then
    install_skills "$PROFILE" "$DRY_RUN"
fi

if [[ "$SKIP_MCP" == "false" ]]; then
    install_mcp "$DRY_RUN"
fi

if [[ "$SKIP_CONFIG" == "false" ]]; then
    install_config "$DRY_RUN"
fi

install_hooks "$DRY_RUN"
install_scripts "$DRY_RUN"
create_alias "$DRY_RUN"

# Summary
if [[ "$DRY_RUN" == "false" ]]; then
    log_header "Installation Complete!"

    echo "  Profile: $PROFILE"
    echo "  Location: $FORGEWRIGHT_DIR"
    echo ""
    echo "  Installed skills: $(ls -1 "$SKILLS_DIR" 2>/dev/null | wc -l | tr -d ' ')"
    echo ""
    echo "  To use Forgewright, restart your terminal or run:"
    echo "    source ~/.bashrc   # or ~/.zshrc"
    echo ""
    echo "  Quick start:"
    echo "    forgewright doctor          # Check installation"
    echo "    forgewright list            # Show installed components"
    echo "    forgewright install --help  # See install options"
    echo ""
else
    echo ""
    log_info "Dry run complete. Run without --dry-run to install."
fi
