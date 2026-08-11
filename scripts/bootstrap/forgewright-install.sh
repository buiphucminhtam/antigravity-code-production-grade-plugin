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
                    cp "$config_source" "$config_dest"
                    log_success "Installed: $config -> $config_dest"
                fi
            fi
        elif [[ "$dry_run" == "false" ]]; then
            log_warn "Config source not found: $config_source"
        fi
    done

    echo ""
}

install_hooks() {
    local dry_run="$1"
    local source_dir="${FORGEWRIGHT_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    log_header "Installing Hooks"

    if [[ "$dry_run" == "true" ]]; then
        echo "  [DRY RUN] Would install settings.json and hooks.json to global paths"
        return
    fi

    # Installed (global) configs use the absolute gate path so they work from any cwd.
    local gate_script="${FORGEWRIGHT_DIR}/scripts/lite/stop-gate.sh"
    local gate_runtime_dir="${FORGEWRIGHT_DIR}/scripts/lite"
    mkdir -p "$gate_runtime_dir"
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

    # ── Claude Code Settings ──────────────────────────────────────────────────
    # Real schema: hooks.Stop is an array of matcher-group objects, each with a
    # nested hooks array of {type, command} objects.  hooks.stop (lowercase) is
    # NOT a valid key and is silently ignored by Claude Code.
    mkdir -p "$HOME/.claude"
    node -e "
var fs = require('fs');
var file = '${HOME}/.claude/settings.json';
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg.hooks) cfg.hooks = {};
// Remove any stale string-form stop key left by previous installs
delete cfg.hooks.stop;
// Idempotent merge: only add if our command is not already present
var Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
Stop = Stop.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.indexOf('verify-gate.sh') !== -1 && h.command.indexOf('CLAUDE') !== -1); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = Stop.some(function(g){
  return Array.isArray(g.hooks) && g.hooks.some(function(h){ return typeof h.command === 'string' && h.command.indexOf('stop-gate.sh') !== -1 && h.command.indexOf('CLAUDE') !== -1; });
});
if (!already) {
  Stop.push({ hooks: [{ type: 'command', command: 'bash ${gate_script} --platform CLAUDE' }] });
}
cfg.hooks.Stop = Stop;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
"
    log_success "Installed .claude/settings.json"

    # ── Gemini Settings ───────────────────────────────────────────────────────
    # Real schema (HookDefinitionArray): AfterAgent must be an array of objects
    # of the form { matcher?: string, hooks: [{ type, command, ... }] }.
    # An array of bare strings causes: "Expected object, received string".
    mkdir -p "$HOME/.gemini"
    node -e "
var fs = require('fs');
var file = '${HOME}/.gemini/settings.json';
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg.hooks) cfg.hooks = {};
// Remove stale bare-string array if present
if (Array.isArray(cfg.hooks.AfterAgent) && cfg.hooks.AfterAgent.length > 0 && typeof cfg.hooks.AfterAgent[0] === 'string') {
  cfg.hooks.AfterAgent = [];
}
var AA = Array.isArray(cfg.hooks.AfterAgent) ? cfg.hooks.AfterAgent : [];
AA = AA.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.indexOf('verify-gate.sh') !== -1 && h.command.indexOf('GEMINI') !== -1); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = AA.some(function(g){
  return Array.isArray(g.hooks) && g.hooks.some(function(h){ return typeof h.command === 'string' && h.command.indexOf('stop-gate.sh') !== -1 && h.command.indexOf('GEMINI') !== -1; });
});
if (!already) {
  AA.push({ matcher: '*', hooks: [{ type: 'command', command: 'bash ${gate_script} --platform GEMINI' }] });
}
cfg.hooks.AfterAgent = AA;
var beforeGate = '${FORGEWRIGHT_DIR}/scripts/lite/gemini-before-tool-gate.sh';
var BT = Array.isArray(cfg.hooks.BeforeTool) ? cfg.hooks.BeforeTool : [];
BT = BT.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.indexOf('gemini-before-tool-gate.sh') !== -1); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
BT.push({ matcher: '*', hooks: [{ name: 'forgewright-policy', type: 'command', command: 'bash ' + beforeGate, timeout: 5000 }] });
cfg.hooks.BeforeTool = BT;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
"
    log_success "Installed .gemini/settings.json"

    # ── Antigravity CLI Hooks ────────────────────────────────────────────────
    # Antigravity's native hook registry is ~/.gemini/config/hooks.json. It is
    # a map of named hooks, not the Gemini CLI settings.json hooks object.
    mkdir -p "$HOME/.gemini/config"
    node -e "
var fs = require('fs');
var file = '${HOME}/.gemini/config/hooks.json';
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') throw new Error('Antigravity hooks registry must be an object');
cfg['forgewright-policy'] = {
  PreToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'command',
      command: 'bash ${FORGEWRIGHT_DIR}/scripts/lite/antigravity-pre-tool-gate.sh',
      timeout: 5
    }]
  }]
};
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
"
    log_success "Installed Antigravity hook in .gemini/config/hooks.json"

    # ── Cursor Hooks ──────────────────────────────────────────────────────────
    # Real schema (version 1): hooks.stop must be an array of {command} objects,
    # not a bare string.  version field is required.
    mkdir -p "$HOME/.cursor"
    node -e "
var fs = require('fs');
var file = '${HOME}/.cursor/hooks.json';
var cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
cfg.version = 1;
if (!cfg.hooks) cfg.hooks = {};
// Remove stale string-form stop key
if (typeof cfg.hooks.stop === 'string') delete cfg.hooks.stop;
var stop = Array.isArray(cfg.hooks.stop) ? cfg.hooks.stop : [];
stop = stop.filter(function(h){ return !(typeof h.command === 'string' && h.command.indexOf('verify-gate.sh') !== -1 && h.command.indexOf('CURSOR') !== -1); });
var already = stop.some(function(h){ return typeof h.command === 'string' && h.command.indexOf('stop-gate.sh') !== -1 && h.command.indexOf('CURSOR') !== -1; });
if (!already) {
  stop.push({ command: 'bash ${gate_script} --platform CURSOR' });
}
cfg.hooks.stop = stop;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
"
    log_success "Installed .cursor/hooks.json"

    # ── Codex Config (TOML) ───────────────────────────────────────────────────
    # Idempotent: only append if stop-gate.sh is not already present.
    # Also guard against duplicating [features] and [hooks] section headers.
    mkdir -p "$HOME/.codex"
    local codex_file="${HOME}/.codex/config.toml"
    if [[ -f "$codex_file" ]] && grep -qF "verify-gate.sh --platform CODEX" "$codex_file" 2>/dev/null; then
        python3 - "$codex_file" <<'PYEOF'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
legacy = re.compile(
    r'\n?\[\[hooks\.Stop\]\]\n'
    r'(?:matcher\s*=\s*"[^"]*"\n)?'
    r'\[\[hooks\.Stop\.hooks\]\]\n'
    r'type\s*=\s*"command"\n'
    r'command\s*=\s*"[^"]*verify-gate\.sh --platform CODEX"\n?'
)
path.write_text(legacy.sub("\n", text), encoding="utf-8")
PYEOF
    fi
    if [[ ! -f "$codex_file" ]]; then
        cat <<EOF > "$codex_file"
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
        } >> "$codex_file"
    fi
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
