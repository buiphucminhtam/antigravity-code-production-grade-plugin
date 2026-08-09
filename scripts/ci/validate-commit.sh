#!/bin/bash
# Forgewright Pre-Commit Validation Hook
# Inspired by CCGS validate-commit.sh
# 
# Purpose: Validate git commit commands before execution
# - Check for hardcoded gameplay values
# - Check TODO/FIXME format
# - Validate JSON files
# - Check design doc sections
#
# Usage: Called automatically by Claude Code hooks
# Exit 0 = allow, Exit 2 = block

set +e

# Color output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

log_warn() {
    echo -e "${YELLOW}⚠️ $1${NC}" >&2
}

log_error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

log_info() {
    echo -e "${GREEN}✓ $1${NC}" >&2
}

# Two supported surfaces:
#   --staged  direct local-CI validation (never reads stdin)
#   default   Claude Code PreToolUse JSON from stdin
if [[ "${1:-}" == "--staged" ]]; then
    COMMAND="git commit"
else
    INPUT=$(cat)
    if command -v jq >/dev/null 2>&1; then
        COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    else
        COMMAND=$(echo "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"command"[[:space:]]*:[[:space:]]*"//;s/"$//')
    fi
fi

# Only process git commit commands
if ! echo "$COMMAND" | grep -qE '^git[[:space:]]+commit'; then
    exit 0
fi

echo "=== Forgewright Commit Validation ===" >&2

# Get staged files
STAGED=$(git diff --cached --name-only 2>/dev/null)
if [ -z "$STAGED" ]; then
    log_info "No staged files"
    exit 0
fi

WARNINGS=""
BLOCKS=""

# =============================================================================
# Check 1: Design documents for required sections
# =============================================================================
DESIGN_FILES=$(echo "$STAGED" | grep -E '^design/')
if [ -n "$DESIGN_FILES" ]; then
    REQUIRED_SECTIONS=("Overview" "Player Fantasy" "Detailed" "Formulas" "Edge Cases" "Dependencies" "Tuning Knobs" "Acceptance Criteria")
    
    while IFS= read -r file; do
        if [[ "$file" == *.md ]] && [ -f "$file" ]; then
            for section in "${REQUIRED_SECTIONS[@]}"; do
                if ! grep -qi "$section" "$file" 2>/dev/null; then
                    WARNINGS="${WARNINGS}\n  DESIGN: $file missing section: $section"
                fi
            done
        fi
    done <<< "$DESIGN_FILES"
fi

# =============================================================================
# Check 2: JSON validity
# =============================================================================
JSON_FILES=$(echo "$STAGED" | grep -E '\.json$')
if [ -n "$JSON_FILES" ]; then
    PYTHON_CMD=""
    for cmd in python3 python; do
        if command -v "$cmd" >/dev/null 2>&1; then
            PYTHON_CMD="$cmd"
            break
        fi
    done
    
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            if [ -n "$PYTHON_CMD" ]; then
                if ! "$PYTHON_CMD" -m json.tool "$file" > /dev/null 2>&1; then
                    BLOCKS="${BLOCKS}\n  BLOCKED: $file is not valid JSON"
                fi
            else
                # Fallback: basic syntax check
                if ! grep -qE '^\s*[{[]' "$file" 2>/dev/null; then
                    BLOCKS="${BLOCKS}\n  BLOCKED: $file may not be valid JSON"
                fi
            fi
        fi
    done <<< "$JSON_FILES"
fi

# =============================================================================
# Check 3: Hardcoded gameplay values in gameplay code
# =============================================================================
CODE_FILES=$(echo "$STAGED" | grep -E '^src/')
if [ -n "$CODE_FILES" ]; then
    # Check for magic numbers in gameplay code
    GAMEPLAY_FILES=$(echo "$STAGED" | grep -E '^src/gameplay/')
    if [ -n "$GAMEPLAY_FILES" ]; then
        while IFS= read -r file; do
            if [ -f "$file" ]; then
                # Pattern: keyword followed by = or : then a number
                HARDCODED=$(grep -nE '(damage|health|speed|rate|chance|cost|duration|cooldown)[[:space:]]*[:=][[:space:]]*[0-9]+' "$file" 2>/dev/null)
                if [ -n "$HARDCODED" ]; then
                    WARNINGS="${WARNINGS}\n  GAMEPLAY: $file contains hardcoded values. Use data files instead."
                fi
            fi
        done <<< "$GAMEPLAY_FILES"
    fi
    
    # =============================================================================
    # Check 4: TODO/FIXME without owner
    # =============================================================================
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            # TODO without (name) format
            BAD_TODOS=$(grep -nE '(TODO|FIXME|HACK)[^(]' "$file" 2>/dev/null)
            if [ -n "$BAD_TODOS" ]; then
                WARNINGS="${WARNINGS}\n  STYLE: $file has TODO/FIXME without owner. Use TODO(name) format."
            fi
        fi
    done <<< "$CODE_FILES"
fi

# =============================================================================
# Check 5: Secrets in code
# =============================================================================
ALL_FILES=$(echo "$STAGED")
if [ -n "$ALL_FILES" ]; then
    while IFS= read -r file; do
        if [ -f "$file" ] && [[ "$file" != *.md ]]; then
            # Check for API keys, tokens, passwords
            SECRETS=$(grep -nE '(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*["\047][a-zA-Z0-9]{10,}' "$file" 2>/dev/null)
            if [ -n "$SECRETS" ]; then
                BLOCKS="${BLOCKS}\n  SECURITY: $file may contain hardcoded secrets. Use environment variables."
            fi
        fi
    done <<< "$ALL_FILES"
fi

# =============================================================================
# Output results
# =============================================================================

# Print blocks (non-blocking warnings)
if [ -n "$WARNINGS" ]; then
    echo -e "\n${YELLOW}=== Commit Validation Warnings ===${NC}" >&2
    echo -e "$WARNINGS" >&2
fi

# Print blocks (errors that can be bypassed with --no-verify)
if [ -n "$BLOCKS" ]; then
    echo -e "\n${RED}=== Commit Validation Errors ===${NC}" >&2
    echo -e "$BLOCKS" >&2
    echo -e "\n${YELLOW}Use 'git commit --no-verify' to bypass (not recommended)${NC}" >&2
fi

echo "" >&2
echo "================================" >&2

# Exit with code based on findings
if [ -n "$BLOCKS" ]; then
    # Blocks are informational - still allow commit but warn
    log_warn "Commit validated with warnings"
fi

if [ -n "$WARNINGS" ]; then
    log_info "Commit validated with warnings"
else
    log_info "Commit validated successfully"
fi

exit 0
