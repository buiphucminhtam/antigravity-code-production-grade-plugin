#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# fw-ext-gen.sh — Claude Desktop Extension Generator
#
# Generates .mcpb (MCP Bundle) files for one-click Claude Desktop
# installation. No terminal, no JSON editing needed.
#
# USAGE:
#   bash fw-ext-gen.sh                    # Generate extension
#   bash fw-ext-gen.sh --check            # Check requirements
#   bash fw-ext-gen.sh --install          # Generate + install
#   bash fw-ext-gen.sh --help            # Show help
#
# EXIT CODES:
#   0 = success
#   1 = error
#   2 = invalid arguments
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Version ─────────────────────────────────────────────────────
VERSION="1.0.0"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# ─── Logging ─────────────────────────────────────────────────────
log_step()  { echo -e "  ${BLUE}➜${NC} $1"; }
log_ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
log_warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "  ${RED}✗${NC} $1"; }
log_info()  { echo -e "  $1"; }

# ─── Detect ForgeWright ────────────────────────────────────────────
detect_forgewright() {
    local script="${BASH_SOURCE[0]}"
    local resolved

    if [[ "$script" == /* ]]; then
        resolved="$(cd "$(dirname "$script")" && pwd -P)"
    else
        resolved="$(cd "$PWD" && cd "$(dirname "$script")" && pwd -P)"
    fi

    if [[ "$resolved" == */scripts ]]; then
        local possible_fw="$(dirname "$resolved")"
        if [[ -f "${possible_fw}/AGENTS.md" ]]; then
            echo "$possible_fw"
            return
        fi
    fi

    echo "$(dirname "$resolved")"
}

FORGEWRIGHT_DIR="$(detect_forgewright)"
PROJECT_ROOT="$(pwd -P)"
OUTPUT_DIR="${PROJECT_ROOT}/.forgewright/extensions"

# ─── CLI ──────────────────────────────────────────────────────────
show_help() {
    cat << 'EOF'
fw-ext-gen.sh — Claude Desktop Extension Generator

Generates .mcpb files for one-click MCP installation.

USAGE:
  fw-ext-gen.sh [options]

OPTIONS:
  --install    Generate and install extension
  --check      Check requirements
  --verbose    Enable debug output
  --help       Show this help

EXAMPLES:
  # Generate extension bundle
  bash fw-ext-gen.sh

  # Generate and install
  bash fw-ext-gen.sh --install

  # Check requirements
  bash fw-ext-gen.sh --check

For more information, see: docs/SETUP.md
EOF
}

# ─── Check Requirements ──────────────────────────────────────────
check_requirements() {
    echo ""
    echo -e "${CYAN}━━━ Requirements Check ━━━${NC}"
    echo ""

    local checks=0
    local passed=0

    # ForgeWright
    ((checks++))
    if [[ -d "$FORGEWRIGHT_DIR" ]] && [[ -f "${FORGEWRIGHT_DIR}/AGENTS.md" ]]; then
        ((passed++))
        log_ok "ForgeWright: $FORGEWRIGHT_DIR"
    else
        log_error "ForgeWright: not found"
    fi

    # Node.js
    ((checks++))
    if command -v node &> /dev/null; then
        ((passed++))
        log_ok "Node.js: $(node -v)"
    else
        log_error "Node.js: not found"
    fi

    # npm
    ((checks++))
    if command -v npm &> /dev/null; then
        ((passed++))
        log_ok "npm: $(npm -v)"
    else
        log_error "npm: not found"
    fi

    # zip
    ((checks++))
    if command -v zip &> /dev/null; then
        ((passed++))
        log_ok "zip: available"
    else
        log_warn "zip: not found (will try to install)"
    fi

    # Launchers
    ((checks++))
    if [[ -f "${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh" ]]; then
        ((passed++))
        log_ok "ForgeWright Launcher: exists"
    else
        log_error "ForgeWright Launcher: not found"
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━"
    echo "  $passed/$checks checks passed"

    [[ $passed -eq $checks ]]
}

# ─── Create Manifest ─────────────────────────────────────────────
create_manifest() {
    local name="${1:-forgewright}"
    local project_name
    project_name=$(basename "$PROJECT_ROOT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')

    cat << EOF
{
  "mcpb_version": "0.1",
  "name": "${name}",
  "display_name": "ForgeWright",
  "version": "${VERSION}",
  "description": "ForgeWright AI orchestrator with 56 skills for full-stack development, game dev, and AI/ML",
  "author": {
    "name": "Buu Phuc Minh Tam",
    "url": "https://github.com/buiphucminhtam/forgewright"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/buiphucminhtam/forgewright"
  },
  "homepage": "https://github.com/buiphucminhtam/forgewright",
  "documentation": "https://github.com/buiphucminhtam/forgewright/blob/main/docs/SETUP.md",
  "server": {
    "type": "binary",
    "entry_point": "launcher.sh",
    "mcp_config": {
      "command": "bash",
      "args": ["launcher.sh"]
    }
  },
  "platform": ["darwin", "linux"],
  "requirements": {
    "nodejs": ">=22"
  }
}
EOF
}

# ─── Create Launcher ──────────────────────────────────────────────
create_launcher() {
    local fw_path="$FORGEWRIGHT_DIR"

    # Get relative path if possible
    if [[ "$fw_path" == "$HOME"* ]]; then
        fw_path="\${HOME}${fw_path#$HOME}"
    fi

    cat << EOF
#!/usr/bin/env bash
# ForgeWright MCP Launcher for Claude Desktop Extension
# Auto-generated by fw-ext-gen.sh

set -euo pipefail

# Detect workspace from git root
if git rev-parse --show-toplevel 2>/dev/null | grep -q '^/'; then
    WORKSPACE="\$(git rev-parse --show-toplevel)"
else
    WORKSPACE="\$(pwd)"
fi

# Set ForgeWright path
FORGEWRIGHT_DIR="$fw_path"

# Export workspace
export FORGEWRIGHT_WORKSPACE="\$WORKSPACE"

# Run MCP servers via launcher
exec bash "\${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh"
EOF
}

# ─── Create README ────────────────────────────────────────────────
create_readme() {
    cat << 'EOF'
# ForgeWright MCP Extension

One-click MCP installation for Claude Desktop.

## What is ForgeWright?

ForgeWright is an adaptive AI orchestrator with 56 skills covering:
- Full-stack development
- Game development (Unity, Unreal, Godot, Phaser, Three.js)
- AI/ML and data engineering
- DevOps and SRE

## Features

- **56 AI Skills** for every development phase
- **Code Intelligence** via GitNexus graph analysis
- **Memory** that persists across sessions
- **Quality Gates** with automatic scoring

## Installation

1. Download `forgewright.mcpb`
2. Double-click to open with Claude Desktop
3. Click "Install"
4. Restart Claude Desktop

## Requirements

- Node.js 22+
- macOS or Linux
- Claude Desktop

## Documentation

https://github.com/buiphucminhtam/forgewright/blob/main/docs/SETUP.md
EOF
}

# ─── Generate Extension ──────────────────────────────────────────
generate_extension() {
    echo ""
    echo -e "${CYAN}⚡ ForgeWright Extension Generator${NC} v$VERSION"
    echo ""

    # Check requirements first
    if ! check_requirements; then
        log_error "Requirements not met"
        exit 1
    fi

    echo ""

    # Create output directory
    log_step "Creating extension directory..."
    mkdir -p "$OUTPUT_DIR"
    log_ok "Created: $OUTPUT_DIR"

    # Create temp directory for bundle contents
    local temp_dir
    temp_dir=$(mktemp -d)
    mkdir -p "$temp_dir/forgewright-extension"

    log_step "Generating extension files..."

    # Create manifest
    create_manifest > "$temp_dir/forgewright-extension/manifest.json"
    log_ok "manifest.json"

    # Create launcher
    create_launcher > "$temp_dir/forgewright-extension/launcher.sh"
    chmod +x "$temp_dir/forgewright-extension/launcher.sh"
    log_ok "launcher.sh"

    # Create README
    create_readme > "$temp_dir/forgewright-extension/README.md"
    log_ok "README.md"

    # Copy ForgeWright scripts
    log_step "Bundling ForgeWright..."
    mkdir -p "$temp_dir/forgewright-extension/forgewright/scripts"
    cp "${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh" "$temp_dir/forgewright-extension/forgewright/scripts/"

    # Copy launchers
    cp "$temp_dir/forgewright-extension/launcher.sh" "$temp_dir/forgewright-extension/forgewright/scripts/"

    log_ok "ForgeWright scripts bundled"

    # Create bundle
    log_step "Creating .mcpb bundle..."
    local output_file="${PROJECT_ROOT}/forgewright.mcpb"

    cd "$temp_dir"
    zip -r "$output_file" forgewright-extension -q

    cd "$PROJECT_ROOT"
    rm -rf "$temp_dir"

    if [[ -f "$output_file" ]]; then
        log_ok "Extension created: $output_file"
        local size
        size=$(du -h "$output_file" | cut -f1)
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e " ${GREEN}✓ Extension Generated Successfully${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "  File: $(basename "$output_file")"
        echo "  Size: $size"
        echo ""
        echo "  To install:"
        echo "    1. Double-click forgewright.mcpb"
        echo "    2. Claude Desktop will open"
        echo "    3. Click 'Install'"
        echo "    4. Restart Claude Desktop"
        echo ""
        echo "  Or run with --install to install directly:"
        echo "    bash fw-ext-gen.sh --install"
        echo ""
    else
        log_error "Failed to create extension bundle"
        exit 1
    fi
}

# ─── Install Extension ─────────────────────────────────────────────
install_extension() {
    log_step "Generating extension..."
    generate_extension

    local mcpb_file="${PROJECT_ROOT}/forgewright.mcpb"

    if [[ ! -f "$mcpb_file" ]]; then
        log_error "Extension not found: $mcpb_file"
        exit 1
    fi

    echo ""
    log_step "Installing extension..."

    case "$(uname -s)" in
        Darwin)
            open "$mcpb_file"
            ;;
        Linux)
            xdg-open "$mcpb_file" 2>/dev/null || {
                log_info "Open this file with Claude Desktop:"
                echo "  $mcpb_file"
            }
            ;;
        *)
            log_info "Open this file with Claude Desktop:"
            echo "  $mcpb_file"
            ;;
    esac

    log_ok "Extension ready for installation"
    log_info "Click 'Install' in Claude Desktop when prompted"
}

# ─── Main ───────────────────────────────────────────────────────
main() {
    local command="generate"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h)
                show_help
                exit 0
                ;;
            --check)
                command="check"
                shift
                ;;
            --install)
                command="install"
                shift
                ;;
            --verbose)
                set -x
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    case "$command" in
        check)
            check_requirements
            ;;
        install)
            install_extension
            ;;
        generate)
            generate_extension
            ;;
    esac
}

main "$@"
