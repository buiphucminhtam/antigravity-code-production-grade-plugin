#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ForgeWright Installer — One-Command Setup for Fresh or Existing Projects
#
# SCENARIOS HANDLED:
#   1. Fresh clone from GitHub → Full setup
#   2. Existing project → Update/fix MCP
#   3. System without ForgeWright → Install ForgeWright first
#
# USAGE:
#   bash forgewright-setup.sh              # Full setup
#   bash forgewright-setup.sh --check      # Check status
#   bash forgewright-setup.sh --diagnose   # Diagnostics
#   bash forgewright-setup.sh --force       # Reinstall everything
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

VERSION="1.0.0"
GITHUB_REPO="https://github.com/buiphucminhtam/forgewright.git"
FORGEWRIGHT_DEFAULT="${HOME}/Documents/GitHub/forgewright"
MIN_NODE_VERSION="22.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "  ${BLUE}➜${NC} $1"; }
success() { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
error()   { echo -e "  ${RED}✗${NC} $1"; }

# ═══════════════════════════════════════════════════════════════════════════════
# DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

detect_fw_dir() {
    local script_path="${BASH_SOURCE[0]}"
    local resolved
    
    # Resolve script path
    if [[ "$script_path" == /* ]]; then
        resolved="$(dirname "$script_path")"
    else
        resolved="$(pwd)/$(dirname "$script_path")"
    fi
    resolved="$(cd "$resolved" && pwd -P)"
    
    # Common locations
    local dirs=(
        "$(cd "$resolved/../.." && pwd -P)"
        "${FORGEWRIGHT_DEFAULT}"
        "${HOME}/Projects/forgewright"
        "${HOME}/code/forgewright"
        "$(dirname "$resolved")/forgewright"
        "$(dirname "$resolved")"
    )
    
    for dir in "${dirs[@]}"; do
        if [[ -f "${dir}/AGENTS.md" ]] || [[ -f "${dir}/CLAUDE.md" ]]; then
            echo "$dir"
            return 0
        fi
    done
    
    return 1
}

detect_actual_project_root() {
    local requested="${1:-$(pwd -P)}" physical git_root superproject
    if [[ ! -d "$requested" ]]; then
        error "Project path is not a directory: $requested"
        return 1
    fi
    physical="$(cd "$requested" && pwd -P)"
    if git_root="$(git -C "$physical" rev-parse --show-toplevel 2>/dev/null)"; then
        while superproject="$(git -C "$git_root" rev-parse --show-superproject-working-tree 2>/dev/null || true)" && \
            [[ -n "$superproject" ]]; do
            git_root="$(cd "$superproject" && pwd -P)"
        done
        printf '%s\n' "$(cd "$git_root" && pwd -P)"
    else
        printf '%s\n' "$physical"
    fi
}

jsonc_parser_module() {
    local fw_dir candidate
    fw_dir="$(detect_fw_dir 2>/dev/null || true)"
    for candidate in \
        "$HOME/.forgewright/mcp-server/node_modules/jsonc-parser" \
        "${fw_dir:+$fw_dir/mcp/node_modules/jsonc-parser}"; do
        if [[ -n "$candidate" ]] && [[ -f "$candidate/lib/umd/main.js" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

opencode_config_path() {
    local root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    if [[ -f "$root/opencode.jsonc" ]]; then
        printf '%s\n' "$root/opencode.jsonc"
    else
        printf '%s\n' "$root/opencode.json"
    fi
}

mcp_config_has_forgewright() {
    local path="${1:-}" parser_module schema canonical_setup fw_dir
    [[ -n "$path" ]] && [[ -f "$path" ]] || return 1

    if [[ "$path" == *.toml ]]; then
        python3 - "$path" <<'PY' >/dev/null 2>&1
import re
import sys
import tomllib

with open(sys.argv[1], "rb") as handle:
    config = tomllib.load(handle)
servers = config.get("mcp_servers", {})
configured = any(
    name == "forgewright"
    and isinstance(entry, dict)
    and isinstance(entry.get("command"), str)
    and entry.get("command") == str(__import__('pathlib').Path.home() / '.forgewright' / 'mcp-server' / 'node_modules' / '.bin' / 'tsx')
    and entry.get("args") == [str(__import__('pathlib').Path.home() / '.forgewright' / 'mcp-server' / 'src' / 'index.ts')]
    and entry.get("enabled", True) is not False
    and entry.get("disabled") is not True
    for name, entry in servers.items()
)
raise SystemExit(0 if configured else 1)
PY
        return
    fi

    local enablement_path=""
    [[ "$path" == "$HOME/.gemini/settings.json" ]] && \
        enablement_path="$HOME/.gemini/mcp-server-enablement.json"
    schema="generic"
    [[ "$path" == */opencode/opencode.json || "$path" == */opencode/opencode.jsonc ]] && schema="opencode"
    [[ "$path" == */zed/settings.json || "$path" == */Zed/settings.json ]] && schema="zed"
    fw_dir="$(detect_fw_dir 2>/dev/null || true)"
    canonical_setup="${fw_dir}/scripts/mcp/forgewright-mcp-setup.sh"
    [[ -f "$canonical_setup" ]] || return 1
    if ! bash -c 'source "$1"; jsonc_self_contained verify "$2" "" "$3" forgewright "$4" "$5"' \
        _ "$canonical_setup" "$path" "$schema" \
        "$HOME/.forgewright/mcp-server/node_modules/.bin/tsx" \
        "$HOME/.forgewright/mcp-server/src/index.ts" >/dev/null 2>&1; then
        return 1
    fi
    if [[ -n "$enablement_path" ]] && [[ -f "$enablement_path" ]]; then
        node - "$enablement_path" <<'NODE' >/dev/null 2>&1 || return 1
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!config || Array.isArray(config) || typeof config !== 'object') process.exit(1);
const managed = Object.keys(config).some((name) =>
  ['forgewright', 'gitnexus'].includes(name.toLowerCase().trim()));
process.exit(managed ? 1 : 0);
NODE
    fi
    return 0
}

detect_ai_clients() {
    local found="false"
    if command -v cursor &>/dev/null || [[ -d "$HOME/.cursor" ]]; then echo "cursor"; found="true"; fi
    if command -v claude &>/dev/null || [[ -f "$HOME/.claude.json" ]]; then echo "claude-code"; found="true"; fi
    if [[ -d "$HOME/Library/Application Support/Claude" ]] || \
        [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json" ]]; then
        echo "claude-desktop"; found="true"
    fi
    if command -v codex &>/dev/null || [[ -f "$HOME/.codex/config.toml" ]]; then echo "codex"; found="true"; fi
    if command -v gemini &>/dev/null || [[ -f "$HOME/.gemini/settings.json" ]]; then echo "gemini"; found="true"; fi
    if [[ -f "$HOME/.gemini/config/mcp_config.json" ]]; then echo "antigravity"; found="true"; fi
    local zed_config="${XDG_CONFIG_HOME:-$HOME/.config}/zed/settings.json"
    [[ "$(uname -s)" == "Darwin" ]] && zed_config="$HOME/Library/Application Support/Zed/settings.json"
    if command -v zed &>/dev/null || [[ -f "$zed_config" ]]; then echo "zed"; found="true"; fi
    local opencode_config
    opencode_config="$(opencode_config_path)"
    if command -v opencode &>/dev/null || [[ -f "$opencode_config" ]]; then echo "opencode"; found="true"; fi
    [[ "$found" == "true" ]]
}

detect_ai_client() {
    local client
    client="$(detect_ai_clients | head -n 1 || true)"
    printf '%s\n' "${client:-unknown}"
}

get_mcp_config_path() {
    local client="$1"
    case "$client" in
        cursor) echo "$HOME/.cursor/mcp.json" ;;
        claude-code) echo "$HOME/.claude.json" ;;
        claude-desktop)
            if [[ "$(uname -s)" == "Darwin" ]]; then
                echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
            else
                echo "${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json"
            fi
            ;;
        codex)  echo "$HOME/.codex/config.toml" ;;
        gemini) echo "$HOME/.gemini/settings.json" ;;
        antigravity) echo "$HOME/.gemini/config/mcp_config.json" ;;
        zed)
            if [[ "$(uname -s)" == "Darwin" ]]; then
                echo "$HOME/Library/Application Support/Zed/settings.json"
            else
                echo "${XDG_CONFIG_HOME:-$HOME/.config}/zed/settings.json"
            fi
            ;;
        opencode) opencode_config_path ;;
        *)      echo "" ;;
    esac
}

# ═══════════════════════════════════════════════════════════════════════════════
# PREREQUISITES
# ═══════════════════════════════════════════════════════════════════════════════

check_node() {
    info "Checking Node.js..."
    
    if ! command -v node &> /dev/null; then
        error "Node.js not found!"
        cat << 'EOF'

    Install Node.js:
      macOS:  brew install node
      Linux:  install Node.js 22+ via your distro/package manager or https://nodejs.org
      Windows: https://nodejs.org

EOF
        return 1
    fi
    
    local node_version
    node_version="$(node -v)"

    if ! node_version_is_supported "$node_version"; then
        warn "Node.js $(node -v) is older than recommended (need >=${MIN_NODE_VERSION})"
        return 1
    fi
    
    success "Node.js $(node -v)"
    return 0
}

node_version_is_supported() {
    local version="${1#v}" major minor patch
    IFS=. read -r major minor patch <<< "$version"
    patch="${patch%%[^0-9]*}"
    [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] && \
        [[ "$patch" =~ ^[0-9]+$ ]] || return 1
    ((major >= 22))
}

check_prerequisites() {
    check_node
}

# ═══════════════════════════════════════════════════════════════════════════════
# FORGEWRIGHT MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

install_forgewright() {
    info "Installing ForgeWright to ${FORGEWRIGHT_DEFAULT}..."
    
    if [[ -d "${FORGEWRIGHT_DEFAULT}" ]]; then
        warn "ForgeWright already exists at ${FORGEWRIGHT_DEFAULT}"
        read -p "  Update existing? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Keeping existing installation"
            return 0
        fi
        
        cd "${FORGEWRIGHT_DEFAULT}"
        git pull origin main
        git submodule update --init --recursive
    else
        mkdir -p "$(dirname "${FORGEWRIGHT_DEFAULT}")"
        git clone --recursive "$GITHUB_REPO" "${FORGEWRIGHT_DEFAULT}"
        cd "${FORGEWRIGHT_DEFAULT}"
    fi
    
    success "ForgeWright installed"
}

ensure_forgewright() {
    local fw_dir="$1"
    
    if [[ -z "$fw_dir" ]] || [[ ! -d "$fw_dir" ]]; then
        warn "ForgeWright not found!"
        read -p "  Install ForgeWright now? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            error "Cannot proceed without ForgeWright"
            exit 1
        fi
        install_forgewright
        fw_dir="${FORGEWRIGHT_DEFAULT}"
    fi
    
    echo "$fw_dir"
}

# ═══════════════════════════════════════════════════════════════════════════════
# BUILD
# ═══════════════════════════════════════════════════════════════════════════════

build_mcp_server() {
    local fw_dir="$1"
    local mcp_dir="${fw_dir}/mcp"
    
    info "Building Forgewright MCP Server..."
    
    if [[ ! -f "${mcp_dir}/package.json" ]]; then
        error "MCP server not found at ${mcp_dir}"
        return 1
    fi
    
    cd "$mcp_dir"
    
    if [[ ! -s "${mcp_dir}/package-lock.json" ]]; then
        error "Tracked MCP package lock missing: ${mcp_dir}/package-lock.json"
        cd - > /dev/null
        return 1
    fi

    # Install exactly from the tracked lock, with retries for transient registry failures.
    local retries=3 deps_installed="false"
    for i in $(seq 1 $retries); do
        info "Installing deps (attempt $i/$retries)..."
        if npm ci --prefer-offline 2>&1 | tail -3; then
            deps_installed="true"
            break
        fi
        if [[ $i -lt $retries ]]; then
            warn "Retrying in 3s..."
            sleep 3
        fi
    done
    if [[ "$deps_installed" != "true" ]]; then
        error "Dependency installation failed"
        cd - > /dev/null
        return 1
    fi
    
    # Build
    info "Compiling..."
    if npm run build 2>&1 | tail -5; then
        success "Forgewright MCP Server built"
    else
        error "Compilation failed"
        return 1
    fi
    
    cd - > /dev/null
    return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# MCP SETUP
# ═══════════════════════════════════════════════════════════════════════════════

setup_mcp() {
    local project_root="$1"
    local fw_dir="$2"
    local force_refresh="$3"
    shift 3
    local canonical_setup="${fw_dir}/scripts/mcp/forgewright-mcp-setup.sh"
    local client platform_flag
    local canonical_args=()
    
    info "Setting up MCP for: $(basename "$project_root")"

    if [[ ! -f "$canonical_setup" ]]; then
        error "Canonical MCP setup not found: $canonical_setup"
        return 1
    fi
    for client in "$@"; do
        case "$client" in
            cursor) platform_flag="--cursor" ;;
            claude-code) platform_flag="--claude-code" ;;
            claude-desktop) platform_flag="--claude-desktop" ;;
            codex) platform_flag="--codex" ;;
            gemini) platform_flag="--gemini" ;;
            antigravity) platform_flag="--antigravity" ;;
            zed) platform_flag="--zed" ;;
            opencode) platform_flag="--opencode" ;;
            *) error "Unsupported MCP client delegation: $client"; return 1 ;;
        esac
        canonical_args+=("$platform_flag")
    done
    [[ ${#canonical_args[@]} -gt 0 ]] || return 0
    [[ "$force_refresh" == "true" ]] && canonical_args+=("--force")

    if (cd "$project_root" && bash "$canonical_setup" "${canonical_args[@]}"); then
        success "Canonical MCP runtime and manifest configured"
    else
        error "Canonical MCP setup failed; malformed client configs were not overwritten"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# COPY FILES
# ═══════════════════════════════════════════════════════════════════════════════

copy_project_files() {
    local project_root="$1"
    local fw_dir="$2"
    local policy_seeder="${fw_dir}/scripts/lite/ensure-project-policy.sh"
    local policy_result
    
    info "Setting up project files..."

    if [[ ! -x "$policy_seeder" ]]; then
        error "Execution-policy seeder not found: $policy_seeder"
        return 1
    fi
    if ! policy_result=$(bash "$policy_seeder" "$fw_dir" "$project_root"); then
        error "Could not seed the project execution policy"
        return 1
    fi
    case "$policy_result" in
        created:*) success "Seeded .forgewright/execution-policy.yaml" ;;
        preserved:*) info "Preserved existing .forgewright/execution-policy.yaml" ;;
        *) error "Unexpected policy-seeder result: $policy_result"; return 1 ;;
    esac
    
    if [[ -f "${fw_dir}/AGENTS.md" ]] && [[ ! -f "${project_root}/AGENTS.md" ]]; then
        cp "${fw_dir}/AGENTS.md" "${project_root}/"
        success "Copied AGENTS.md"
    fi
    
    if [[ -f "${fw_dir}/CLAUDE.md" ]] && [[ ! -f "${project_root}/CLAUDE.md" ]]; then
        cp "${fw_dir}/CLAUDE.md" "${project_root}/"
        success "Copied CLAUDE.md"
    fi
    
    if [[ -f "${fw_dir}/.cursorrules" ]] && [[ ! -f "${project_root}/.cursorrules" ]]; then
        cp "${fw_dir}/.cursorrules" "${project_root}/"
        success "Copied .cursorrules"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# STATUS & DIAGNOSTICS
# ═══════════════════════════════════════════════════════════════════════════════

cmd_check() {
    local project_root="${1:-$(pwd)}"
    local fw_dir
    fw_dir=$(detect_fw_dir) || fw_dir=""
    
    echo ""
    echo -e "${BOLD}${CYAN}━━━ ForgeWright Status ━━━${NC}"
    echo ""
    
    info "Project: ${project_root}"
    echo ""
    
    if [[ -n "$fw_dir" ]]; then
        success "ForgeWright: ${fw_dir}"
        if [[ -f "${fw_dir}/mcp/build/index.js" ]]; then
            success "MCP Server: Built"
        else
            warn "MCP Server: Not built"
        fi
    else
        error "ForgeWright: Not found"
    fi
    echo ""
    
    if [[ -f "${project_root}/.antigravity/mcp-manifest.json" ]]; then
        success "Manifest: Present"
    else
        warn "Manifest: Missing"
    fi
    echo ""
    
    local clients client config_path
    clients="$(detect_ai_clients || true)"
    if [[ -z "$clients" ]]; then
        warn "AI Client: Unknown"
    else
        while IFS= read -r client; do
            [[ -n "$client" ]] || continue
            config_path="$(get_mcp_config_path "$client")"
            success "AI Client: ${client}"
            if mcp_config_has_forgewright "$config_path"; then
                success "MCP Config: Configured (${config_path})"
            else
                warn "MCP Config: No enabled ForgeWright entry (${config_path})"
            fi
        done <<< "$clients"
    fi
    
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

cmd_diagnose() {
    local project_root="${1:-$(pwd)}"
    local fw_dir
    fw_dir=$(detect_fw_dir) || fw_dir=""
    
    echo ""
    echo -e "${BOLD}${CYAN}━━━ Diagnostics ━━━${NC}"
    echo ""
    
    info "Environment:"
    echo "  PWD:        ${project_root}"
    echo "  NODE:       $(command -v node || echo 'not found')"
    echo "  NPM:        $(command -v npm || echo 'not found')"
    echo ""
    
    info "ForgeWright:"
    echo "  Searched:   ${FORGEWRIGHT_DEFAULT}"
    echo "  Found:      ${fw_dir:-<not found>}"
    echo ""
    
    info "Files:"
    for f in \
        "${fw_dir}/AGENTS.md" \
        "${fw_dir}/mcp/build/index.js" \
        "$HOME/.forgewright/mcp-server/src/index.ts" \
        "${project_root}/.antigravity/mcp-manifest.json"; do
        if [[ -f "$f" ]]; then
            echo "  ✓ ${f}"
        else
            echo "  ✗ ${f}"
        fi
    done
    echo ""
    
    info "Detected MCP Configs:"
    local clients client config_path
    clients="$(detect_ai_clients || true)"
    if [[ -z "$clients" ]]; then
        echo "  <none>"
    else
        while IFS= read -r client; do
            [[ -n "$client" ]] || continue
            config_path="$(get_mcp_config_path "$client")"
            if mcp_config_has_forgewright "$config_path"; then
                echo "  ${client}: enabled (${config_path})"
            else
                echo "  ${client}: not configured or disabled (${config_path})"
            fi
        done <<< "$clients"
    fi
    echo ""
    
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

show_help() {
    cat << 'EOF'
ForgeWright Setup — One-command setup for any project

USAGE:
  forgewright-setup.sh [OPTIONS] [PROJECT_PATH]

OPTIONS:
  --check         Check status only
  --diagnose      Show diagnostics
  --install-fw    Install ForgeWright first
  --force         Reinstall everything
  --help          Show this help

EXAMPLES:
  bash forgewright-setup.sh                  # Full setup
  bash forgewright-setup.sh --check         # Check status
  bash forgewright-setup.sh --diagnose     # Diagnostics
  bash forgewright-setup.sh --install-fw   # Install FW then setup
EOF
}

main() {
    local mode="install"
    local force=false
    local install_fw=false
    local project_path=""
    
    # Parse args
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --check)      mode="check"; shift ;;
            --diagnose)   mode="diagnose"; shift ;;
            --install-fw) install_fw=true; shift ;;
            --force)      force=true; shift ;;
            --help|-h)    show_help; exit 0 ;;
            -*)
                warn "Unknown option: $1"
                shift
                ;;
            *)
                project_path="$1"
                shift
                ;;
        esac
    done
    
    # Determine paths
    [[ -z "$project_path" ]] && project_path="$(pwd -P)"
    project_path="$(detect_actual_project_root "$project_path")" || exit 1
    local fw_dir
    fw_dir=$(detect_fw_dir) || fw_dir=""
    
    # ── Header ──────────────────────────────────────────────────────────────
    
    echo ""
    echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║${NC}  ${BOLD}ForgeWright Setup v${VERSION}${NC}                                       ${BOLD}${CYAN}║${NC}"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Project: ${BOLD}${project_path}${NC}"
    echo ""
    
    # ── Check/Diagnose Mode ────────────────────────────────────────────────
    
    if [[ "$mode" == "check" ]]; then
        cmd_check "$project_path"
        exit 0
    fi
    
    if [[ "$mode" == "diagnose" ]]; then
        cmd_diagnose "$project_path"
        exit 0
    fi
    
    # ── Prerequisites ──────────────────────────────────────────────────────
    
    if ! check_prerequisites; then
        error "Prerequisites check failed"
        exit 1
    fi
    echo ""
    
    # ── ForgeWright Installation ────────────────────────────────────────────
    
    if [[ "$install_fw" == "true" ]] || [[ -z "$fw_dir" ]]; then
        fw_dir=$(ensure_forgewright "$fw_dir")
    fi
    
    echo ""
    success "ForgeWright: ${fw_dir}"
    
    # ── Copy Project Files ──────────────────────────────────────────────────
    
    copy_project_files "$project_path" "$fw_dir"
    echo ""
    
    # ── Setup MCP ───────────────────────────────────────────────────────────
    
    local clients client configured_clients=0
    local -a detected_clients=()
    clients="$(detect_ai_clients || true)"
    if [[ -z "$clients" ]]; then
        warn "No supported AI clients detected; MCP setup was not delegated"
    else
        while IFS= read -r client; do
            [[ -n "$client" ]] || continue
            detected_clients+=("$client")
            configured_clients=$((configured_clients + 1))
        done <<< "$clients"
        setup_mcp "$project_path" "$fw_dir" "$force" "${detected_clients[@]}"
    fi
    echo ""
    
    # ── Summary ─────────────────────────────────────────────────────────────
    
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}${GREEN}✓ Setup Complete${NC}                                             ${BOLD}${GREEN}║${NC}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [[ "$configured_clients" -gt 0 ]]; then
        echo "  Next steps:"
        echo "    1. ${BOLD}Restart${NC} your AI client (Cursor/Claude)"
        echo "    2. Verify: bash $0 --check"
    else
        echo "  Note: AI client not detected"
        echo "  MCP config may need manual setup"
    fi
    echo ""
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
