#!/bin/bash
# forgewright-lesson-migrator.sh
# Legacy framework lesson migrator. Project/session lessons remain local by default.
# Mutating shared SKILL.md files now requires an explicit framework-mutation command/flag.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGEWRIGHT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW_DIR="${FORGEWRIGHT_DIR}/forgewright"

# Detect forgewright location (submodule vs standalone)
if [ -d "$FORGEWRIGHT_DIR/.git" ]; then
    # forgewright is the project root
    PROJECT_DIR="$FORGEWRIGHT_DIR"
    SKILLS_DIR="$PROJECT_DIR/skills"
elif [ -f "$FORGEWRIGHT_DIR/.git" ] || git -C "$FORGEWRIGHT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
    # Inside a git repo — find forgewright submodule
    PROJECT_DIR="$FORGEWRIGHT_DIR"
    if [ -d "$PROJECT_DIR/forgewright" ]; then
        FW_DIR="$PROJECT_DIR/forgewright"
        SKILLS_DIR="$FW_DIR/skills"
    else
        SKILLS_DIR="$PROJECT_DIR/skills"
    fi
else
    FW_DIR="$FORGEWRIGHT_DIR"
    PROJECT_DIR="$FORGEWRIGHT_DIR"
    SKILLS_DIR="$FW_DIR/skills"
fi

LESSON_PLAN="$PROJECT_DIR/.forgewright/plan-lessons.md"
LESSON_EXEC="$PROJECT_DIR/.forgewright/execution-lessons.md"
MIGRATION_STATE="$PROJECT_DIR/.forgewright/lesson-migration-state.json"
METRICS_FILE="$PROJECT_DIR/.forgewright/asip-metrics.json"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log() { echo -e "${BLUE}[MIGRATE]${NC} $*"; }
pass() { echo -e "${GREEN}[MIGRATE]${NC} $*"; }
fail() { echo -e "${RED}[MIGRATE]${NC} $*"; }
warn() { echo -e "${YELLOW}[MIGRATE]${NC} $*"; }

# ---------------------------------------------------------------------------
# Init migration state
# ---------------------------------------------------------------------------

init_state() {
    mkdir -p "$(dirname "$MIGRATION_STATE")" 2>/dev/null || true
    if [ ! -f "$MIGRATION_STATE" ]; then
        cat > "$MIGRATION_STATE" << 'EOF'
{
  "lastMigrationPlan": null,
  "lastMigrationExec": null,
  "migratedPlanEntries": [],
  "migratedExecEntries": [],
  "totalMigrated": 0
}
EOF
    fi
}

# ---------------------------------------------------------------------------
# Read migration state
# ---------------------------------------------------------------------------

get_state() {
    local key="$1"
    if [ ! -f "$MIGRATION_STATE" ]; then
        echo ""
        return
    fi
    local val
    val=$(grep "\"$key\":" "$MIGRATION_STATE" 2>/dev/null | head -1 | sed 's/.*: *//' | tr -d ' ,')
    echo "$val"
}

get_array() {
    local key="$1"
    if [ ! -f "$MIGRATION_STATE" ]; then
        return
    fi
    # Extract array content between [...] for given key
    python3 -c "
import json, sys
try:
    with open('$MIGRATION_STATE') as f:
        data = json.load(f)
    arr = data.get('$key', [])
    for item in arr:
        print(item)
except: pass
" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Update migration state
# ---------------------------------------------------------------------------

mark_migrated() {
    local type="$1"   # "plan" or "exec"
    local entry_id="$2"
    local date="$3"

    python3 -c "
import json, sys

state = {}
try:
    with open('$MIGRATION_STATE') as f:
        state = json.load(f)
except:
    pass

key = 'migrated${type^}Entries'
if key not in state:
    state[key] = []

# Avoid duplicates
if entry_id not in state[key]:
    state[key].append(entry_id)

state['totalMigrated'] = len(state.get('migratedPlanEntries', [])) + len(state.get('migratedExecEntries', []))
state['lastMigration${type^}'] = '$date'

with open('$MIGRATION_STATE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Extract new lesson entries from a lesson file
# ---------------------------------------------------------------------------

extract_entries() {
    local file="$1"
    local type="$2"   # "plan" or "exec"

    if [ ! -f "$file" ]; then
        return
    fi

    # Extract entries between "## Session-Lessons" and end of file (excluding the template comment)
    # Skip the "<!-- ... -->" template block and "## Session-Lessons" header
    awk '
        /^<!-- / { skip=1 }
        /^-->$/ { skip=0; next }
        skip { next }
        /^## Session-Lessons/ { found=1; next }
        found && /^## [^ ]/ { exit }
        found && !/^$/ && !/^<!--/ && !/^-->/ { print }
    ' "$file" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Parse and migrate a single entry
# ---------------------------------------------------------------------------

migrate_entry() {
    local entry_text="$1"
    local type="$2"   # "plan" or "exec"

    if [ -z "$entry_text" ] || echo "$entry_text" | grep -qE '^[#]?[ ]*$'; then
        return
    fi

    # Extract date from "## [Date]" line
    local date
    date=$(echo "$entry_text" | grep -m1 '^##' | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || echo "$(date +%Y-%m-%d)")

    # Generate unique entry ID from date + first non-empty line
    local entry_id
    entry_id="${date}_$(echo "$entry_text" | grep -v '^##' | grep -v '^$' | head -1 | tr -d ' #' | head -c 40 | tr ' ' '_' | tr '[:upper:]' '[:lower:]')"

    # Check if already migrated
    local already_migrated=0
    while IFS= read -r mid; do
        if [ "$mid" = "$entry_id" ]; then
            already_migrated=1
            break
        fi
    done <<< "$(get_array "migrated${type^}Entries")"

    if [ "$already_migrated" = "1" ]; then
        return
    fi

    # Find target skill file
    local skill_name
    skill_name=$(echo "$entry_text" | grep -m1 '^##' | sed 's/^## *//' | awk '{print $NF}' | tr -d '-')

    local target_skill=""
    # Map common skill patterns
    case "$type" in
        plan)
            # Try to find skill name in the entry
            if echo "$entry_text" | grep -qiE 'software engineer|backend|api|service'; then
                target_skill="$SKILLS_DIR/software-engineer/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'frontend|react|ui|component'; then
                target_skill="$SKILLS_DIR/frontend-engineer/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'architect|architecture|design'; then
                target_skill="$SKILLS_DIR/solution-architect/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'product manager|pm|product'; then
                target_skill="$SKILLS_DIR/product-manager/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'devops|deploy|ci|cd|infrastructure'; then
                target_skill="$SKILLS_DIR/devops/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'qa|test|testing|quality'; then
                target_skill="$SKILLS_DIR/qa-engineer/SKILL.md"
            fi
            ;;
        exec)
            if echo "$entry_text" | grep -qiE 'software engineer|backend|api|service'; then
                target_skill="$SKILLS_DIR/software-engineer/SKILL.md"
            elif echo "$entry_text" | grep -qiE 'frontend|react|ui|component'; then
                target_skill="$SKILLS_DIR/frontend-engineer/SKILL.md"
            fi
            ;;
    esac

    if [ -z "$target_skill" ] || [ ! -f "$target_skill" ]; then
        warn "No target skill found for entry: $entry_id"
        return
    fi

    # Determine section name
    local section_name="## Planning Improvements"
    if [ "$type" = "exec" ]; then
        section_name="## Execution Learnings"
    fi

    # Check if section exists
    if ! grep -qF "$section_name" "$target_skill" 2>/dev/null; then
        # Append section to end of skill file
        echo "" >> "$target_skill"
        echo "$section_name" >> "$target_skill"
        echo "" >> "$target_skill"
        echo "> Auto-generated by ASIP. DO NOT DELETE." >> "$target_skill"
        echo "" >> "$target_skill"
    fi

    # Format entry for skill file
    local formatted=""
    formatted="${formatted}### $date — "

    if [ "$type" = "plan" ]; then
        local weak_criterion
        weak_criterion=$(echo "$entry_text" | grep -iE 'weak criterion|##.*criterion' | head -1 | sed 's/.*: *//' | tr -d '#')
        formatted="${formatted}Planning: ${weak_criterion:-Unknown}"
    else
        local blocker_type
        blocker_type=$(echo "$entry_text" | grep -iE 'blocker type|##.*type' | head -1 | sed 's/.*: *//' | tr -d '#')
        formatted="${formatted}Execution: ${blocker_type:-Unknown}"
    fi

    formatted="${formatted}\n\n"

    # Add key fields
    local problem research lesson
    problem=$(echo "$entry_text" | grep -iE 'problem:' | head -1 | sed 's/.*problem: *//i' | tr -d '#')
    research=$(echo "$entry_text" | grep -iE 'research source:|lesson:' | head -2 | sed 's/.*: *//i' | tr -d '#' | tr '\n' ';' | sed 's/;$//')
    lesson=$(echo "$entry_text" | grep -iE 'lesson:|key insight:' | head -1 | sed 's/.*: *//i' | tr -d '#')

    if [ -n "$problem" ]; then
        formatted="${formatted}- **Problem:** $problem\n"
    fi
    if [ -n "$research" ]; then
        formatted="${formatted}- **Research:** $research\n"
    fi
    if [ -n "$lesson" ]; then
        formatted="${formatted}- **Lesson:** $lesson\n"
    fi

    # Append to skill file after the "DO NOT DELETE" line
    local marker="DO NOT DELETE."
    local marker_line
    marker_line=$(grep -nF "$marker" "$target_skill" 2>/dev/null | tail -1 | cut -d: -f1 || echo "")

    if [ -n "$marker_line" ]; then
        local before after
        before=$(head -n "$marker_line" "$target_skill")
        after=$(tail -n +$((marker_line + 1)) "$target_skill")
        echo -e "$before" > "$target_skill.tmp"
        echo -e "$formatted" >> "$target_skill.tmp"
        echo "" >> "$target_skill.tmp"
        echo -e "$after" >> "$target_skill.tmp"
        mv "$target_skill.tmp" "$target_skill"
    else
        # Fallback: append to end
        echo -e "\n$formatted" >> "$target_skill"
    fi

    # Mark as migrated
    mark_migrated "$type" "$entry_id" "$date"

    # [Graph Layer] Save migrated NotebookLM lesson as Semantic Node (TSK-08)
    if command -v python3 &>/dev/null; then
        local skill_id="skill_$(basename "$(dirname "$target_skill")")"
        local clean_problem="${problem:-}"
        local clean_research="${research:-}"
        local clean_lesson="${lesson:-}"
        # Escape quotes for safety in terminal args
        clean_problem="${clean_problem//\"/\\\"}"
        clean_research="${clean_research//\"/\\\"}"
        clean_lesson="${clean_lesson//\"/\\\"}"
        
        # 1. Ensure procedural skill node exists
        python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "$skill_id" "procedural" "Skill: $(basename "$(dirname "$target_skill")")" "Procedural skill guidelines and SOPs for $(basename "$(dirname "$target_skill")")" &>/dev/null || true
        
        # 2. Add lesson node
        python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "lesson_$entry_id" "semantic" "Lesson ($type): $(basename "$(dirname "$target_skill")")" "Problem: $clean_problem | Research: $clean_research | Lesson: $clean_lesson" &>/dev/null || true
        
        # 3. Link lesson -> skill node with weight 1.5 and edge_type improves
        python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-link "lesson_$entry_id" "$skill_id" --weight 1.5 --type "improves" &>/dev/null || true
        
        # 4. Link current-session -> lesson node
        python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-link "current-session" "lesson_$entry_id" --weight 1.0 --type "learned" &>/dev/null || true
    fi

    # Cross-feedback (v8.3): execution lessons generate planning stubs
    if [ "$type" = "exec" ]; then
        local planning_gap planning_improvement
        planning_gap=$(echo "$entry_text" | grep -iA1 'planning gap:' | tail -1 | sed 's/^[ #-]*//i' | tr -d '#')
        planning_improvement=$(echo "$entry_text" | grep -iA1 'planning improvement:' | tail -1 | sed 's/^[ #-]*//i' | tr -d '#')

        if [ -n "$planning_gap" ] || [ -n "$planning_improvement" ]; then
            local cross_entry="

## $date — $skill_name (cross-link from execution)
### Weak Criterion: ImpactAssessment (cross-link)
### Problem: $planning_gap
### Lesson: $planning_improvement
### Source: Execution lesson $entry_id
"
            # Append to plan-lessons.md
            if [ -f "$LESSON_PLAN" ]; then
                # Insert before closing --> marker if present, else append
                if grep -q '^-->' "$LESSON_PLAN" 2>/dev/null; then
                    local marker_line
                    marker_line=$(grep -n '^-->' "$LESSON_PLAN" | head -1 | cut -d: -f1)
                    local before after
                    before=$(head -n $((marker_line - 1)) "$LESSON_PLAN")
                    after=$(tail -n +$marker_line "$LESSON_PLAN")
                    echo "$before" > "$LESSON_PLAN.tmp"
                    echo -e "$cross_entry" >> "$LESSON_PLAN.tmp"
                    echo "$after" >> "$LESSON_PLAN.tmp"
                    mv "$LESSON_PLAN.tmp" "$LESSON_PLAN"
                else
                    echo -e "$cross_entry" >> "$LESSON_PLAN"
                fi
                pass "Cross-link: generated planning stub from execution lesson $entry_id"
            fi
        fi
    fi

    pass "Migrated: $entry_id → $(basename "$target_skill")"
}

# ---------------------------------------------------------------------------
# Update metrics
# ---------------------------------------------------------------------------

update_metrics() {
    local type="$1"

    python3 -c "
import json

metrics = {}
try:
    with open('$METRICS_FILE') as f:
        metrics = json.load(f)
except:
    pass

if 'projectAdaptation' not in metrics:
    metrics['projectAdaptation'] = {}

pa = metrics['projectAdaptation']
pa['totalMigrations'] = pa.get('totalMigrations', 0) + 1
pa['lastMigration'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
pa['sessionsWithEvolution'] = pa.get('sessionsWithEvolution', 0) + 1

metrics['lastUpdated'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'

with open('$METRICS_FILE', 'w') as f:
    json.dump(metrics, f, indent=2)
" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

migrate() {
    local type="${1:-both}"  # "plan", "exec", or "both"

    if [ "${FORGEWRIGHT_ALLOW_FRAMEWORK_MUTATION:-0}" != "1" ]; then
        warn "Framework skill mutation is disabled by default."
        warn "Project-local lessons remain in .forgewright/plan-lessons.md and execution-lessons.md."
        warn "For explicit Forgewright framework development, use: $0 migrate-framework [plan|exec|both]"
        return 0
    fi

    init_state

    local migrated_count=0

    if [ "$type" = "plan" ] || [ "$type" = "both" ]; then
        log "Migrating plan lessons..."
        local entries
        entries=$(extract_entries "$LESSON_PLAN" "plan")
        if [ -n "$entries" ]; then
            # Split by "##" separators
            echo "$entries" | awk '/^## / {close(f); f="'$LESSON_PLAN'."NR".tmp"}
                f {print > f} END {close(f)}' 2>/dev/null || true
            for f in "$LESSON_PLAN".*.tmp; do
                [ -f "$f" ] || continue
                migrate_entry "$(cat "$f")" "plan"
                rm -f "$f"
                migrated_count=$((migrated_count + 1))
            done
        else
            pass "No new plan lessons to migrate."
        fi
    fi

    if [ "$type" = "exec" ] || [ "$type" = "both" ]; then
        log "Migrating execution lessons..."
        local entries
        entries=$(extract_entries "$LESSON_EXEC" "exec")
        if [ -n "$entries" ]; then
            echo "$entries" | awk '/^## / {close(f); f="'$LESSON_EXEC'."NR".tmp"}
                f {print > f} END {close(f)}' 2>/dev/null || true
            for f in "$LESSON_EXEC".*.tmp; do
                [ -f "$f" ] || continue
                migrate_entry "$(cat "$f")" "exec"
                rm -f "$f"
                migrated_count=$((migrated_count + 1))
            done
        else
            pass "No new execution lessons to migrate."
        fi
    fi

    if [ $migrated_count -gt 0 ]; then
        update_metrics "$type"
        pass "Migration complete. $migrated_count entry(ies) migrated."
    fi
}

show_status() {
    init_state
    echo ""
    echo "=== Lesson Migration Status ==="
    if [ -f "$MIGRATION_STATE" ]; then
        cat "$MIGRATION_STATE"
    else
        echo "No migration state found."
    fi
    echo ""
    echo "--- .forgewright/ lesson files ---"
    [ -f "$LESSON_PLAN" ] && echo "plan-lessons.md: $(wc -l < "$LESSON_PLAN") lines" || echo "plan-lessons.md: not found"
    [ -f "$LESSON_EXEC" ] && echo "execution-lessons.md: $(wc -l < "$LESSON_EXEC") lines" || echo "execution-lessons.md: not found"
}

# ---------------------------------------------------------------------------
# CLI dispatcher
# ---------------------------------------------------------------------------

case "${1:-status}" in
    migrate)           migrate "${2:-both}" ;;
    migrate-plan)      migrate "plan" ;;
    migrate-exec)      migrate "exec" ;;
    migrate-framework) FORGEWRIGHT_ALLOW_FRAMEWORK_MUTATION=1 migrate "${2:-both}" ;;
    status)            show_status ;;
    init)              init_state; echo "Migration state initialized." ;;
    *)                 echo "Usage: $0 {migrate|migrate-plan|migrate-exec|migrate-framework|status|init}"
                       echo "  migrate*        — safe by default; leaves lessons project-local"
                       echo "  migrate-framework [plan|exec|both] — EXPLICITLY mutate shared SKILL.md files; Forgewright framework development only"
                       echo "  status          — show migration state"
                       echo "  init            — initialize migration state file"
                       exit 1 ;;
esac
