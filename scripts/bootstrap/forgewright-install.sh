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
PYTHON_CMD=()

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

host_path() {
    local value="$1"
    case "$(uname -s 2>/dev/null || true)" in
        MINGW*|MSYS*|CYGWIN*)
            command -v cygpath >/dev/null 2>&1 || return 1
            cygpath -am "$value"
            ;;
        *)
            printf '%s\n' "$value"
            ;;
    esac
}

atomic_copy_file() {
    local source="$1"
    local target="$2"
    local source_host target_host
    source_host="$(host_path "$source")" || return 1
    target_host="$(host_path "$target")" || return 1
    "${PYTHON_CMD[@]}" - "$source_host" "$target_host" <<'PYEOF'
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
    # Native Windows does not support opening/fsyncing a directory handle.
    # The file itself is still flushed before the atomic replacement.
    if os.name != "nt":
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
    local target_host
    target_host="$(host_path "$target")" || return 1
    content="$(cat)"
    ATOMIC_CONTENT="$content" "${PYTHON_CMD[@]}" - "$target_host" <<'PYEOF'
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
    # Native Windows does not support opening/fsyncing a directory handle.
    # The file itself is still flushed before the atomic replacement.
    if os.name != "nt":
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
    local source_windows_hook="$source_dir/scripts/lite/codex-hook-windows.ps1"
    local source_manifest="$source_dir/kernel/rule-manifest.json"
    local target_kernel="$FORGEWRIGHT_DIR/kernel"

    if [[ ! -f "$source_hook" || ! -f "$source_windows_hook" || ! -f "$source_manifest" ]]; then
        log_warn "Rule context runtime unavailable; lifecycle hooks remain unchanged"
        return 0
    fi

    mkdir -p "$runtime_dir" "$target_kernel"
    cp "$source_hook" "$runtime_dir/rule-context-hook.py"
    cp "$source_windows_hook" "$runtime_dir/codex-hook-windows.ps1"
    cp "$source_manifest" "$target_kernel/rule-manifest.json"
    chmod +x "$runtime_dir/rule-context-hook.py"

    local source_manifest_host source_dir_host target_root_host
    source_manifest_host="$(host_path "$source_manifest")" || return 1
    source_dir_host="$(host_path "$source_dir")" || return 1
    target_root_host="$(host_path "$FORGEWRIGHT_DIR")" || return 1
    if ! "${PYTHON_CMD[@]}" - "$source_manifest_host" "$source_dir_host" "$target_root_host" <<'PYEOF'
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

require_python311() {
    local candidate resolved selector
    if [[ -n "${FORGEWRIGHT_PYTHON_BIN:-}" && -x "${FORGEWRIGHT_PYTHON_BIN}" ]] && \
       "${FORGEWRIGHT_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
        PYTHON_CMD=("${FORGEWRIGHT_PYTHON_BIN}")
        return 0
    fi
    for candidate in python3.13 python3.12 python3.11 python3 python; do
        resolved="$(command -v "$candidate" 2>/dev/null || true)"
        [[ -n "$resolved" ]] || continue
        if "$resolved" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            PYTHON_CMD=("$resolved")
            return 0
        fi
    done
    resolved="$(command -v py.exe 2>/dev/null || command -v py 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
        for selector in -3.13 -3.12 -3.11 -3; do
            if "$resolved" "$selector" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
                PYTHON_CMD=("$resolved" "$selector")
                return 0
            fi
        done
    fi
    log_error "Python 3.11 or newer is required before Forgewright can modify installation state" >&2
    return 1
}

codex_stop_command() {
    local gate_script="$1"
    local kernel_name
    kernel_name="$(uname -s 2>/dev/null || true)"
    case "$kernel_name" in
        MINGW*|MSYS*|CYGWIN*)
            local bash_executable gate_native
            bash_executable="${EXEPATH:-}/bash.exe"
            if [[ -z "${EXEPATH:-}" || ! -x "$bash_executable" ]] || ! command -v cygpath >/dev/null 2>&1; then
                log_error "Git Bash path resolution is unavailable; cannot configure the native-Windows Codex Stop hook" >&2
                return 1
            fi
            bash_executable="$(cygpath -am "$bash_executable")"
            gate_native="$(cygpath -am "$gate_script")"
            if [[ "$bash_executable" == *\"* || "$gate_native" == *\"* || "$bash_executable" == *%* || "$gate_native" == *%* ]]; then
                log_error "Git Bash or Stop gate path contains a character that cmd.exe would expand" >&2
                return 1
            fi
            printf 'cmd /d /s /c ""%s" "%s" --platform CODEX"' "$bash_executable" "$gate_native"
            ;;
        *)
            printf 'bash %s --platform CODEX' "$(shell_quote "$gate_script")"
            ;;
    esac
}

codex_lifecycle_windows_command() {
    local adapter_script="$1"
    local event_name="$2"
    case "$(uname -s 2>/dev/null || true)" in
        MINGW*|MSYS*|CYGWIN*)
            local adapter_native
            command -v cygpath >/dev/null 2>&1 || return 1
            adapter_native="$(cygpath -am "$adapter_script")"
            CODEX_WINDOWS_ADAPTER="$adapter_native" CODEX_EVENT_NAME="$event_name" "${PYTHON_CMD[@]}" - <<'PYEOF'
import os

adapter = "'" + os.environ["CODEX_WINDOWS_ADAPTER"].replace("'", "''") + "'"
event = os.environ["CODEX_EVENT_NAME"]
print(
    "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass "
    '-Command "$root = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1); '
    "$manifest = if ($root) { Join-Path $root 'kernel/rule-manifest.json' } else { $null }; "
    f"if (-not $root -or -not (Test-Path -LiteralPath $manifest -PathType Leaf)) {{ & {adapter} -EventName {event}; exit $LASTEXITCODE }}; "
    f"& {adapter} -EventName {event} -ProjectRoot $root; exit $LASTEXITCODE\""
)
PYEOF
            ;;
        *)
            printf ''
            ;;
    esac
}

codex_stop_command_present() {
    local config_file="$1"
    local expected_command="$2"
    config_file="$(host_path "$config_file")" || return 1
    CODEX_STOP_COMMAND="$expected_command" "${PYTHON_CMD[@]}" - "$config_file" <<'PYEOF'
import os
import sys

try:
    import tomllib
except ImportError:
    raise SystemExit(1)

try:
    with open(sys.argv[1], "rb") as handle:
        config = tomllib.load(handle)
    groups = config.get("hooks", {}).get("Stop", [])
    present = isinstance(groups, list) and sum(
        1
        for group in groups
        if isinstance(group, dict)
        and group.get("matcher") == "*"
        for hook in group.get("hooks", [])
        if isinstance(hook, dict)
        and hook.get("type") == "command"
        and hook.get("command") == os.environ["CODEX_STOP_COMMAND"]
        and hook.get("command_windows") in (None, os.environ["CODEX_STOP_COMMAND"])
    ) == 1
except (OSError, TypeError, tomllib.TOMLDecodeError):
    present = False
raise SystemExit(0 if present else 1)
PYEOF
}

rule_context_command() {
    local hook_path="$1"
    local fallback_workspace="$2"
    local platform="$3"
    local event="$4"
    local python_executable="${PYTHON_CMD[0]}"
    local python_selector="${PYTHON_CMD[1]:-}"
    # Global lifecycle configs are invoked from arbitrary project directories.
    # Resolve the project at invocation time, and only select its manifest after
    # the installed runtime has validated it.  The framework install remains a
    # safe fallback for non-project directories and malformed project state.
    local resolver=''
    resolver+='hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4"; python_executable="$5"; python_selector="$6"; '
    resolver+='run_python() { if [ -n "$python_selector" ]; then "$python_executable" "$python_selector" "$@"; else "$python_executable" "$@"; fi; }; '
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
    resolver+='if [ -f "$hook_path" ] && [ -n "$candidate" ] && [ -f "$candidate/kernel/rule-manifest.json" ] && run_python - "$hook_path" "$candidate" <<'"'"'PYEOF'"'"'
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
    resolver+='run_python "$runtime" --platform "$platform" --event "$event" --workspace "$workspace" || printf "%s\\n" "{\"continue\":true}"'
    printf 'FORGEWRIGHT_RULE_HOOK_MODE="${FORGEWRIGHT_RULE_HOOK_MODE:-observe}" sh -c %s -- %s %s %s %s %s %s || true' \
        "$(shell_quote "$resolver")" "$(shell_quote "$hook_path")" "$(shell_quote "$fallback_workspace")" "$platform" "$event" \
        "$(shell_quote "$python_executable")" "$(shell_quote "$python_selector")"
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
    for gate_runtime_file in stop-gate.sh stop_gate.py continuity_check.py evidence_common.py windows_secure_io.py \
        gemini-before-tool-gate.sh antigravity-pre-tool-gate.sh verify-gate.sh verify_gate.py \
        run-check.sh run_check.py rule-validator.py rule-ledger.sh policy-check.sh telemetry.sh; do
        atomic_copy_file "${source_dir}/scripts/lite/${gate_runtime_file}" "${gate_runtime_dir}/${gate_runtime_file}"
    done
    chmod +x "$gate_runtime_dir/stop-gate.sh" "$gate_runtime_dir/gemini-before-tool-gate.sh" \
        "$gate_runtime_dir/antigravity-pre-tool-gate.sh" \
        "$gate_runtime_dir/verify-gate.sh" "$gate_runtime_dir/rule-validator.py" \
        "$gate_runtime_dir/run-check.sh" "$gate_runtime_dir/run_check.py" \
        "$gate_runtime_dir/rule-ledger.sh" "$gate_runtime_dir/policy-check.sh" \
        "$gate_runtime_dir/telemetry.sh"

    local claude_stop_cmd claude_session_cmd claude_subagent_cmd gemini_stop_cmd gemini_policy_cmd gemini_before_agent_cmd antigravity_pre_invocation_cmd antigravity_policy_cmd cursor_stop_cmd cursor_session_cmd codex_session_cmd codex_subagent_cmd codex_session_windows_cmd codex_subagent_windows_cmd
    claude_stop_cmd="bash $(shell_quote "$gate_script") --platform CLAUDE"
    claude_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CLAUDE SessionStart)"
    claude_subagent_cmd="$(rule_context_command "$context_hook" "$context_workspace" CLAUDE SubagentStart)"
    gemini_stop_cmd="bash $(shell_quote "$gate_script") --platform GEMINI"
    gemini_policy_cmd="bash $(shell_quote "$gate_runtime_dir/gemini-before-tool-gate.sh")"
    gemini_before_agent_cmd="$(rule_context_command "$context_hook" "$context_workspace" GEMINI BeforeAgent)"
    antigravity_pre_invocation_cmd="$(rule_context_command "$context_hook" "$context_workspace" ANTIGRAVITY PreInvocation)"
    antigravity_policy_cmd="bash $(shell_quote "$gate_runtime_dir/antigravity-pre-tool-gate.sh")"
    cursor_stop_cmd="bash $(shell_quote "$gate_script") --platform CURSOR"
    cursor_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CURSOR sessionStart)"
    codex_session_cmd="$(rule_context_command "$context_hook" "$context_workspace" CODEX SessionStart)"
    codex_subagent_cmd="$(rule_context_command "$context_hook" "$context_workspace" CODEX SubagentStart)"
    codex_session_windows_cmd="$(codex_lifecycle_windows_command "$gate_runtime_dir/codex-hook-windows.ps1" SessionStart)"
    codex_subagent_windows_cmd="$(codex_lifecycle_windows_command "$gate_runtime_dir/codex-hook-windows.ps1" SubagentStart)"

    # ── Claude Code Settings ──────────────────────────────────────────────────
    # Real schema: hooks.Stop is an array of matcher-group objects, each with a
    # nested hooks array of {type, command} objects.  hooks.stop (lowercase) is
    # NOT a valid key and is silently ignored by Claude Code.
    mkdir -p "$HOME/.claude"
    CLAUDE_STOP_CMD="$claude_stop_cmd" CLAUDE_SESSION_CMD="$claude_session_cmd" CLAUDE_SUBAGENT_CMD="$claude_subagent_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "$(host_path "${HOME}/.claude/settings.json")" <<'NODE'
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
  if (command === process.env.CLAUDE_STOP_CMD) return true;
  var candidate = gateCommand(command, platform);
  return candidate !== null && path.resolve(candidate) === path.resolve(process.env.GATE_SCRIPT);
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
  Stop.push({ hooks: [{ type: 'command', command: process.env.CLAUDE_STOP_CMD }] });
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
    var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+(?:\s+'[^']*'){2}\s+\|\|\s*true\s*$/);
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
    GEMINI_STOP_CMD="$gemini_stop_cmd" GEMINI_POLICY_CMD="$gemini_policy_cmd" GEMINI_BEFORE_AGENT_CMD="$gemini_before_agent_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "$(host_path "${HOME}/.gemini/settings.json")" <<'NODE'
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
  if (command === process.env.GEMINI_STOP_CMD) return true;
  var candidate = gateCommand(command, platform);
  return candidate !== null && path.resolve(candidate) === path.resolve(process.env.GATE_SCRIPT);
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
  AA.push({ matcher: '*', hooks: [{ type: 'command', command: process.env.GEMINI_STOP_CMD }] });
}
cfg.hooks.AfterAgent = AA;
var beforeGate = process.env.FORGEWRIGHT_DIR + '/scripts/lite/gemini-before-tool-gate.sh';
var desiredBeforeGate = process.env.GEMINI_POLICY_CMD;
var BT = Array.isArray(cfg.hooks.BeforeTool) ? cfg.hooks.BeforeTool : [];
BT = BT.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !h || typeof h.command !== 'string' || (h.command !== desiredBeforeGate && h.command !== 'bash ' + beforeGate); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
if (!BT.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return h && h.command === desiredBeforeGate; }); })) {
  BT.push({ matcher: '*', hooks: [{ name: 'forgewright-policy', type: 'command', command: desiredBeforeGate, timeout: 5000 }] });
}
cfg.hooks.BeforeTool = BT;
var groups = Array.isArray(cfg.hooks.BeforeAgent) ? cfg.hooks.BeforeAgent : [];
var found = false;
function ownedContext(commandValue) {
  if (commandValue === process.env.GEMINI_BEFORE_AGENT_CMD) return true;
  if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+(?:\s+'[^']*'){2}\s+\|\|\s*true\s*$/);
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
    ANTIGRAVITY_PRE_INVOCATION_CMD="$antigravity_pre_invocation_cmd" ANTIGRAVITY_POLICY_CMD="$antigravity_policy_cmd" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "$(host_path "${HOME}/.gemini/config/hooks.json")" <<'NODE'
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
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+(?:\s+'[^']*'){2}\s+\|\|\s*true\s*$/);
  if (!match) return false;
  var normalized = path.posix.normalize(match[1].replace(/\\/g, '/'));
  var framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return path.resolve(normalized) === path.join(framework, 'rule-context-hook.py') ||
    path.resolve(normalized) === path.join(framework, 'scripts', 'rule-context-hook.py');
}
var policy = cfg['forgewright-policy'];
if (!policy || Array.isArray(policy) || typeof policy !== 'object') policy = {};
policy.enabled = true;
var policyGroups = Array.isArray(policy.PreToolUse) ? policy.PreToolUse : [];
var hasPolicyGate = policyGroups.some(function(group) {
  return group && group.matcher === '*' && Array.isArray(group.hooks) && group.hooks.some(function(hook) {
    return hook && hook.type === 'command' && hook.command === process.env.ANTIGRAVITY_POLICY_CMD && hook.timeout === 5;
  });
});
if (!hasPolicyGate) policyGroups.push({ matcher: '*', hooks: [{ type: 'command', command: process.env.ANTIGRAVITY_POLICY_CMD, timeout: 5 }] });
policy.PreToolUse = policyGroups;
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
    CURSOR_STOP_CMD="$cursor_stop_cmd" CURSOR_SESSION_CMD="$cursor_session_cmd" GATE_SCRIPT="$gate_script" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" node - "$(host_path "${HOME}/.cursor/hooks.json")" <<'NODE'
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
  if (command === process.env.CURSOR_STOP_CMD) return true;
  var candidate = gateCommand(command, platform);
  return candidate !== null && path.resolve(candidate) === path.resolve(process.env.GATE_SCRIPT);
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
  stop.push({ command: process.env.CURSOR_STOP_CMD });
}
cfg.hooks.stop = stop;
var sessions = Array.isArray(cfg.hooks.sessionStart) ? cfg.hooks.sessionStart : [];
var foundSession = false;
function ownedContext(commandValue) {
  if (commandValue === process.env.CURSOR_SESSION_CMD) return true;
  if (typeof commandValue !== 'string' || commandValue.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || commandValue.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  var match = commandValue.match(/\s--\s+'([^']+)'\s+'[^']+'\s+(?:CLAUDE|GEMINI|ANTIGRAVITY|CURSOR|CODEX)\s+[^\s]+(?:\s+'[^']*'){2}\s+\|\|\s*true\s*$/);
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
    local codex_file_host
    codex_file_host="$(host_path "$codex_file")" || return 1
    local codex_stop_cmd codex_stop_toml
    codex_stop_cmd="$(codex_stop_command "$gate_script")"
    codex_stop_toml="$(CODEX_STOP_COMMAND="$codex_stop_cmd" "${PYTHON_CMD[@]}" -c 'import json, os; print(json.dumps(os.environ["CODEX_STOP_COMMAND"]))')"
    if [[ -f "$codex_file" ]]; then
        CODEX_STOP_COMMAND="$codex_stop_cmd" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" FORGEWRIGHT_SOURCE_DIR="$source_dir" "${PYTHON_CMD[@]}" - "$codex_file_host" <<'PYEOF'
import json
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

# Upgrade only a trusted Forgewright Stop command. Unrelated user commands,
# including commands that merely contain the same filename, are preserved.
installed_stop = (Path(os.environ["FORGEWRIGHT_DIR"]) / "scripts" / "lite" / "stop-gate.sh").resolve()
project_stop = (Path(os.environ["FORGEWRIGHT_SOURCE_DIR"]) / "scripts" / "lite" / "stop-gate.sh").resolve()
desired_stop = os.environ["CODEX_STOP_COMMAND"]
command_line = re.compile(r'(?m)^(command\s*=\s*)("(?:\\.|[^"\\])*")[ \t]*$')

def owned_stop(command: str) -> bool:
    try:
        parts = shlex.split(command)
    except (TypeError, ValueError):
        parts = []
    gate = None
    if len(parts) == 4 and parts[0] == "bash" and parts[2:] == ["--platform", "CODEX"]:
        gate = Path(parts[1].replace("\\", "/")).resolve()
    else:
        wrapper = re.fullmatch(
            r'cmd(?:\.exe)?\s+/d\s+/s\s+/c\s+""[^"]+"\s+"([^"]+)"\s+--platform\s+CODEX"',
            command,
            flags=re.IGNORECASE,
        )
        if wrapper:
            gate = Path(wrapper.group(1).replace("\\", "/")).resolve()
    return gate in {installed_stop, project_stop}

def replace_owned_stop(match: re.Match[str]) -> str:
    try:
        command = json.loads(match.group(2))
    except (TypeError, ValueError, json.JSONDecodeError):
        return match.group(0)
    if not owned_stop(command):
        return match.group(0)
    return f"{match.group(1)}{json.dumps(desired_stop)}"

updated = command_line.sub(replace_owned_stop, updated)
stop_hook = re.compile(
    r'\r?\n?\[\[hooks\.Stop\]\]\r?\n'
    r'(?:matcher\s*=\s*"[^"]*"\r?\n)?'
    r'\[\[hooks\.Stop\.hooks\]\]\r?\n'
    r'type\s*=\s*"[^"]*"\r?\n'
    r'command\s*=\s*(?P<command>"(?:\\.|[^"\\])*")\r?\n?'
    r'(?:command_windows\s*=\s*"(?:\\.|[^"\\])*"\r?\n?)?'
    r'(?:timeout\s*=\s*\d+\s*\r?\n?)?'
)
owned_seen = False

def remove_owned_stop(match: re.Match[str]) -> str:
    global owned_seen
    try:
        command = json.loads(match.group("command"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return match.group(0)
    if not owned_stop(command):
        return match.group(0)
    block = match.group(0)
    windows_match = re.search(
        r'(?m)^command_windows\s*=\s*("(?:\\.|[^"\\])*")[ \t]*\r?$',
        block,
    )
    windows_valid = windows_match is None
    if windows_match is not None:
        try:
            windows_valid = json.loads(windows_match.group(1)) == desired_stop
        except (TypeError, ValueError, json.JSONDecodeError):
            windows_valid = False
    canonical = (
        re.search(r'(?m)^matcher\s*=\s*"\*"[ \t]*\r?$', block) is not None
        and re.search(r'(?m)^type\s*=\s*"command"[ \t]*\r?$', block) is not None
        and command == desired_stop
        and windows_valid
    )
    if canonical and not owned_seen:
        owned_seen = True
        return block
    return "\n"

updated = stop_hook.sub(remove_owned_stop, updated)
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

def enable_hooks_feature(value: str) -> str:
    lines = value.splitlines(keepends=True)
    feature_index = next(
        (
            index
            for index, line in enumerate(lines)
            if re.fullmatch(r"\[features\][ \t]*(?:#.*)?", line.strip())
        ),
        None,
    )
    if feature_index is None:
        return "[features]\nhooks = true\n\n" + value
    section_end = next(
        (
            index
            for index in range(feature_index + 1, len(lines))
            if lines[index].lstrip().startswith("[")
        ),
        len(lines),
    )
    for index in range(feature_index + 1, section_end):
        match = re.match(
            r"^(\s*hooks\s*=\s*)(?:true|false)([ \t]*(?:#.*)?)(\r?\n)?$",
            lines[index],
        )
        if match:
            lines[index] = (
                f"{match.group(1)}true{match.group(2)}{match.group(3) or ''}"
            )
            return "".join(lines)
        if re.match(r"^\s*hooks\s*=", lines[index]):
            newline = "\r\n" if lines[index].endswith("\r\n") else "\n"
            lines[index] = f"hooks = true{newline}"
            return "".join(lines)
    newline = "\r\n" if lines[feature_index].endswith("\r\n") else "\n"
    if not lines[feature_index].endswith(("\n", "\r")):
        lines[feature_index] += newline
    lines.insert(feature_index + 1, f"hooks = true{newline}")
    return "".join(lines)

updated = enable_hooks_feature(updated)
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
command = ${codex_stop_toml}
EOF
    elif ! codex_stop_command_present "$codex_file" "$codex_stop_cmd"; then
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
            echo "command = ${codex_stop_toml}"
        } | atomic_write_text "$codex_file"
    fi
    CONTEXT_SESSION_CMD="$codex_session_cmd" CONTEXT_SUBAGENT_CMD="$codex_subagent_cmd" CONTEXT_SESSION_WINDOWS_CMD="$codex_session_windows_cmd" CONTEXT_SUBAGENT_WINDOWS_CMD="$codex_subagent_windows_cmd" FORGEWRIGHT_DIR="$FORGEWRIGHT_DIR" "${PYTHON_CMD[@]}" - "$codex_file_host" <<'PYEOF'
import json
import os
import posixpath
import re
import shlex
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
    try:
        parts = shlex.split(candidate, posix=True)
        expected_parts = shlex.split(expected, posix=True)
        separator = parts.index("--")
        expected_separator = expected_parts.index("--")
        arguments = parts[separator + 1 :]
        expected_arguments = expected_parts[expected_separator + 1 :]
    except (ValueError, IndexError):
        return False
    if separator != 4 or parts[1:3] != ["sh", "-c"]:
        return False
    if len(arguments) not in (6, 8) or arguments[-2:] != ["||", "true"]:
        return False
    hook_path, _workspace, platform, event = arguments[:4]
    if len(expected_arguments) < 4 or [platform, event] != expected_arguments[2:4]:
        return False
    def normalized_hook_path(value):
        value = value.replace("\\", "/")
        if os.name != "nt":
            return Path(value).resolve().as_posix()
        drive = re.match(r"^/([A-Za-z])(?=/|$)", value)
        if drive:
            value = f"{drive.group(1)}:{value[2:]}"
        return posixpath.normpath(value).casefold()

    normalized = normalized_hook_path(hook_path)
    framework = os.environ["FORGEWRIGHT_DIR"].rstrip("/\\")
    return normalized in {
        normalized_hook_path(f"{framework}/rule-context-hook.py"),
        normalized_hook_path(f"{framework}/scripts/rule-context-hook.py"),
        normalized_hook_path(f"{framework}/scripts/lite/rule-context-hook.py"),
    }

def replace_context_blocks(value, event, matcher, command, windows_command):
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
    )
    if windows_command:
        value += f"command_windows = {json.dumps(windows_command)}\n"
    value += "timeout = 2\n"
    return value

for event, matcher, command, windows_command in (
    (
        "SessionStart",
        "startup|resume|clear|compact",
        os.environ["CONTEXT_SESSION_CMD"],
        os.environ["CONTEXT_SESSION_WINDOWS_CMD"],
    ),
    (
        "SubagentStart",
        "*",
        os.environ["CONTEXT_SUBAGENT_CMD"],
        os.environ["CONTEXT_SUBAGENT_WINDOWS_CMD"],
    ),
):
    text = replace_context_blocks(text, event, matcher, command, windows_command)
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

# All installation modes execute Python-backed publication and hook logic.
# Fail before creating or modifying installation state when the runtime is old.
require_python311

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
