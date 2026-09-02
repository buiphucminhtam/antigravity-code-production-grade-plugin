#!/usr/bin/env bash
# =============================================================================
# art-pipeline.sh — Automated Art Direction Pipeline
# =============================================================================
# Usage:
#   art-pipeline.sh init                      Create project style guide scaffold
#   art-pipeline.sh generate <type> <name>   Compile a validated asset prompt
#   art-pipeline.sh review <image-path>      Run vision review on image
#   art-pipeline.sh batch <type> <count>     Print batch-review instructions
#   art-pipeline.sh register <type> <name> <asset>  Version an approved asset
#   art-pipeline.sh drift                    Check contract/content drift
#   art-pipeline.sh manifest                 Build engine import manifest
#   art-pipeline.sh handoff <target-dir>     Copy assets without overwrites
#   art-pipeline.sh style-guide              Print current style guide
#   art-pipeline.sh template <type>          Compile a prompt for type
#
# Pipeline: Style DNA Contract → Compile Prompt → Generate → Vision Review → Approve/Reject → Save
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGEWRIGHT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STYLE_GUIDE_DIR="${FORGEWRIGHT_DIR}/.forgewright/art-direction"
REVIEWS_DIR="${FORGEWRIGHT_DIR}/.forgewright/art-reviews"
VISION_REVIEW="${SCRIPT_DIR}/vision-review.sh"
STYLE_CONTRACT_TOOL="${SCRIPT_DIR}/style-contract.py"
ASSET_LIFECYCLE_TOOL="${SCRIPT_DIR}/asset-lifecycle.py"
VISUAL_EVIDENCE_TOOL="${SCRIPT_DIR}/visual_evidence.py"

# Canonical visual evidence and Style DNA inputs shared by generation and review.
VISUAL_BASIS_PATH="${VISUAL_BASIS_PATH:-"${FORGEWRIGHT_DIR}/.forgewright/visual-evidence/visual-basis.json"}"
VISUAL_EVIDENCE_CARDS_DIR="${VISUAL_EVIDENCE_CARDS_DIR:-"${FORGEWRIGHT_DIR}/.forgewright/visual-evidence/cards"}"
PROJECT_STYLE_GUIDE="${PROJECT_STYLE_GUIDE:-"${STYLE_GUIDE_DIR}/game-art-contract.json"}"
ASSET_INVENTORY="${ART_ASSET_INVENTORY:-"${STYLE_GUIDE_DIR}/asset-inventory.json"}"
ENGINE_MANIFEST="${ART_ENGINE_MANIFEST:-"${STYLE_GUIDE_DIR}/engine-import-manifest.json"}"

# ---- helpers ----------------------------------------------------------------

log()   { printf "[art-pipeline] %s\n" "$*"; }
warn()  { printf "[art-pipeline] WARNING: %s\n" "$*" >&2; }
info()  { printf "[art-pipeline] ℹ  %s\n" "$*"; }
die()   { printf "[art-pipeline] ERROR: %s\n" "$*" >&2; exit 1; }
need()  { command -v "$1" &>/dev/null || die "Required: $1 (not found in PATH)"; }

# Color codes
BOLD="\033[1m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

# ---- style guide helpers -----------------------------------------------------

style_guide_exists() {
    [[ -f "$PROJECT_STYLE_GUIDE" ]]
}

# ---- command: init ----------------------------------------------------------
# Create project style guide scaffold

cmd_init() {
    local project_type="${1:-app}"  # app | game-2d | game-3d | mixed
    local project_name="${2:-Untitled Game}"

    log "Initializing Art Direction for project type: $project_type"

    mkdir -p "$STYLE_GUIDE_DIR"/{color-palettes,typography,lighting,perspective,mood-board,prohibited}
    mkdir -p "$REVIEWS_DIR"
    mkdir -p "$VISUAL_EVIDENCE_CARDS_DIR"

    python3 "$STYLE_CONTRACT_TOOL" init "$PROJECT_STYLE_GUIDE" \
        --project-type "$project_type" --project-name "$project_name"

    log "Created draft Style DNA contract: $PROJECT_STYLE_GUIDE"
    log ""
    log "Next steps:"
    log "  1. Run the Research Gate when no approved/project visual basis exists"
    log "  2. Record evidence cards under: $VISUAL_EVIDENCE_CARDS_DIR"
    log "  3. Synthesize and validate: $VISUAL_BASIS_PATH"
    log "  4. Replace unresolved Style DNA only from the validated basis"
    log "  5. Bind evidence_basis, add STYLE references, then approve the contract"
    log "  6. Run: art-pipeline.sh generate <type> <name>"
    log ""
    log "Available generation types:"
    log "  UI:         button, icon, panel, screen, ui-kit"
    log "  Game 2D:    character, sprite, background, tile, environment, object, prop"
    log "  Game 3D:    character, environment, object, prop"
}

# ---- command: generate ------------------------------------------------------
# Generate asset: validate Style DNA and compile a deterministic prompt

cmd_generate() {
    local asset_type="${1:-}"    # button, character, etc.
    local asset_name="${2:-}"    # custom name

    if [[ -z "$asset_type" ]] || [[ -z "$asset_name" ]]; then
        die "Usage: art-pipeline.sh generate <asset-type> <name>"
    fi

    if ! style_guide_exists; then
        die "No Style DNA contract found at $PROJECT_STYLE_GUIDE. Run 'art-pipeline.sh init' first."
    fi

    log "${BOLD}Generating:${RESET} $asset_type / $asset_name"
    log "Style guide: $PROJECT_STYLE_GUIDE"

    # Compile from the approved contract. Validation and unresolved-placeholder
    # rejection are fail-closed inside style-contract.py.
    local prompt
    if ! prompt=$(python3 "$STYLE_CONTRACT_TOOL" compile "$PROJECT_STYLE_GUIDE" \
        --asset-type "$asset_type" --name "$asset_name" \
        --visual-basis "$VISUAL_BASIS_PATH" --cards-dir "$VISUAL_EVIDENCE_CARDS_DIR"); then
        die "Style DNA contract is not generation-ready"
    fi

    log "Prompt generated (first 500 chars):"
    echo "$prompt" | head -c 500 | sed 's/^/  /'
    echo ""

    log "${YELLOW}Generation adapter is provider-managed; this P0 command emits the validated prompt.${RESET}"
    log "${BOLD}${CYAN}--- GENERATION PROMPT ---${RESET}"
    echo "$prompt"
    log "${BOLD}${CYAN}--- END PROMPT ---${RESET}"
    log "After generation: art-pipeline.sh review <path-to-generated-image> --type <ui|game-2d|game-3d>"
}

# ---- command: review --------------------------------------------------------

cmd_review() {
    local image_path="${1:-}"
    shift || true

    if [[ -z "$image_path" ]]; then
        die "Usage: art-pipeline.sh review <image-path>"
    fi

    if [[ ! -f "$image_path" ]]; then
        die "Image not found: $image_path"
    fi

    if [[ ! -x "$VISION_REVIEW" ]]; then
        chmod +x "$VISION_REVIEW"
    fi

    "$VISION_REVIEW" review "$image_path" --style-guide "$PROJECT_STYLE_GUIDE" "$@"
}

# ---- command: batch ---------------------------------------------------------

cmd_batch() {
    local asset_type="${1:-}"
    local count="${2:-8}"

    if [[ -z "$asset_type" ]]; then
        die "Usage: art-pipeline.sh batch <asset-type> <count>"
    fi

    if ! command -v claude &>/dev/null; then
        die "Batch review requires Claude CLI. Install from https://claude.ai"
    fi

    log "Batch review instructions: $asset_type (target count: $count)"
    log "Generation remains provider-managed in P0."
    log ""
    log "To batch review existing images:"
    log "  ./vision-review.sh batch './assets/*.png' --report"
}

# ---- commands: asset lifecycle ---------------------------------------------

cmd_register() {
    local asset_type="${1:-}"
    local asset_name="${2:-}"
    local asset_path="${3:-}"
    if [[ -z "$asset_type" ]] || [[ -z "$asset_name" ]] || [[ -z "$asset_path" ]]; then
        die "Usage: art-pipeline.sh register <asset-type> <name> <asset-path>"
    fi
    python3 "$ASSET_LIFECYCLE_TOOL" register \
        --contract "$PROJECT_STYLE_GUIDE" \
        --visual-basis "$VISUAL_BASIS_PATH" \
        --cards-dir "$VISUAL_EVIDENCE_CARDS_DIR" \
        --inventory "$ASSET_INVENTORY" \
        --asset-type "$asset_type" \
        --name "$asset_name" \
        --asset "$asset_path"
}

cmd_drift() {
    python3 "$ASSET_LIFECYCLE_TOOL" drift \
        --contract "$PROJECT_STYLE_GUIDE" \
        --visual-basis "$VISUAL_BASIS_PATH" \
        --cards-dir "$VISUAL_EVIDENCE_CARDS_DIR" \
        --inventory "$ASSET_INVENTORY"
}

cmd_manifest() {
    local output="${1:-$ENGINE_MANIFEST}"
    python3 "$ASSET_LIFECYCLE_TOOL" manifest \
        --contract "$PROJECT_STYLE_GUIDE" \
        --visual-basis "$VISUAL_BASIS_PATH" \
        --cards-dir "$VISUAL_EVIDENCE_CARDS_DIR" \
        --inventory "$ASSET_INVENTORY" \
        --output "$output"
}

cmd_handoff() {
    local target_dir="${1:-}"
    local manifest="${2:-$ENGINE_MANIFEST}"
    if [[ -z "$target_dir" ]]; then
        die "Usage: art-pipeline.sh handoff <target-dir> [manifest-path]"
    fi
    python3 "$ASSET_LIFECYCLE_TOOL" handoff \
        --manifest "$manifest" \
        --target-dir "$target_dir"
}

# ---- command: style-guide ---------------------------------------------------

cmd_style_guide() {
    if style_guide_exists; then
        cat "$PROJECT_STYLE_GUIDE" | python3 -m json.tool 2>/dev/null || cat "$PROJECT_STYLE_GUIDE"
    else
        info "No style guide found. Run: art-pipeline.sh init"
    fi
}

# ---- command: template -------------------------------------------------------

cmd_template() {
    local template_type="${1:-}"

    if [[ -z "$template_type" ]]; then
        log "Compiler asset types: background, button, character, environment, icon, object, panel, prop, screen, sprite, tile, ui-kit"
        echo "Usage: art-pipeline.sh template <type>"
        return 0
    fi

    if ! style_guide_exists; then
        die "No Style DNA contract found at $PROJECT_STYLE_GUIDE"
    fi
    python3 "$STYLE_CONTRACT_TOOL" compile "$PROJECT_STYLE_GUIDE" \
        --asset-type "$template_type" --name "${template_type}-template"
}

# ---- command: update-style --------------------------------------------------
# Update a specific style token

cmd_update_style() {
    local key="$1"
    local value="$2"

    if [[ -z "$key" ]] || [[ -z "$value" ]]; then
        die "Usage: art-pipeline.sh update-style <key> <value>"
    fi

    if ! style_guide_exists; then
        die "No style guide found. Run 'art-pipeline.sh init' first."
    fi

    python3 - "$PROJECT_STYLE_GUIDE" "$key" "$value" <<'PYEOF'
import json
import sys

path, dotted, raw_value = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    document = json.load(handle)
parts = dotted.split(".")
target = document
for part in parts[:-1]:
    if not isinstance(target, dict) or part not in target:
        raise SystemExit(f"Unknown contract path: {dotted}")
    target = target[part]
if not isinstance(target, dict) or parts[-1] not in target:
    raise SystemExit(f"Unknown contract path: {dotted}")
try:
    value = json.loads(raw_value)
except json.JSONDecodeError:
    value = raw_value
target[parts[-1]] = value
with open(path, "w", encoding="utf-8") as handle:
    json.dump(document, handle, indent=2)
    handle.write("\n")
print(f"Updated: {dotted} = {value}")
PYEOF

    python3 "$STYLE_CONTRACT_TOOL" validate "$PROJECT_STYLE_GUIDE" --stage draft
    log "Style contract updated: $key = $value"
}

# ---- main -------------------------------------------------------------------

main() {
    local cmd="${1:-}"
    shift || true

    # Ensure directories exist
    mkdir -p "$STYLE_GUIDE_DIR" "$REVIEWS_DIR"

    case "$cmd" in
        init)
            cmd_init "$@"
            ;;
        generate|gen)
            cmd_generate "$@"
            ;;
        review)
            cmd_review "$@"
            ;;
        batch)
            cmd_batch "$@"
            ;;
        register)
            cmd_register "$@"
            ;;
        drift)
            cmd_drift
            ;;
        manifest)
            cmd_manifest "$@"
            ;;
        handoff)
            cmd_handoff "$@"
            ;;
        style-guide|sg)
            cmd_style_guide
            ;;
        template|t)
            cmd_template "$@"
            ;;
        update-style|set)
            cmd_update_style "$@"
            ;;
        help|-h|--help|"")
            cat <<'EOF'
art-pipeline.sh — Art Direction Pipeline

  Initialize project style guide:
    art-pipeline.sh init [app|game-2d|game-3d|mixed] [project-name]

  Generate asset with style constraints:
    art-pipeline.sh generate <type> <name>

  Run vision review on generated image:
    art-pipeline.sh review <image-path>

  Print instructions for batch-reviewing existing assets:
    art-pipeline.sh batch <asset-type> <count>

  Version an approved asset in the inventory:
    art-pipeline.sh register <asset-type> <name> <asset-path>

  Detect Style DNA, content, or missing-file drift:
    art-pipeline.sh drift

  Build a deterministic engine import manifest:
    art-pipeline.sh manifest [output-path]

  Hand off manifest assets without overwriting local changes:
    art-pipeline.sh handoff <target-dir> [manifest-path]

  Show current style guide:
    art-pipeline.sh style-guide

  Compile an asset prompt:
    art-pipeline.sh template <type>

  Update style token:
    art-pipeline.sh update-style <dotted-key> <json-or-string-value>

  Asset types:
    UI:       button, icon, panel, screen, ui-kit
    Game 2D:  character, sprite, background, tile, environment, object, prop
    Game 3D:  character, environment, object, prop

Examples:
  art-pipeline.sh init game-2d
  art-pipeline.sh generate button primary-cta
  art-pipeline.sh generate character knight
  art-pipeline.sh review ./output/button-1.png
  art-pipeline.sh register character knight ./output/knight.png
  art-pipeline.sh drift
  art-pipeline.sh manifest
  art-pipeline.sh handoff ../my-game
  art-pipeline.sh update-style approval.status approved

Environment:
  PROJECT_STYLE_GUIDE   Path to game-art-contract/v2 JSON
  ART_ASSET_INVENTORY   Path to game-art-inventory/v1 JSON
  ART_ENGINE_MANIFEST   Path to game-art-engine-import/v1 JSON
EOF
            ;;
        *)
            die "Unknown command: $cmd. Use 'help' for usage."
            ;;
    esac
}

main "$@"
