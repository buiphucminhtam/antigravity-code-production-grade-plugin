#!/bin/bash
# forgewright-evolution-init.sh
# Bootstraps the ASIP self-evolution infrastructure. Creates baseline files,
# initializes state, and registers the lesson migration hook in the MCP setup.
#
# Usage:
#   bash scripts/forgewright-evolution-init.sh              # full init
#   bash scripts/forgewright-evolution-init.sh --check     # status only
#   bash scripts/forgewright-evolution-init.sh --update-metrics [type] [value]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGEWRIGHT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Detect forgewright location (submodule vs standalone)
if [ -f "$FORGEWRIGHT_DIR/VERSION" ] || [ -f "$FORGEWRIGHT_DIR/skills/production-grade/SKILL.md" ]; then
    # forgewright is the project root
    PROJECT_DIR="$FORGEWRIGHT_DIR"
    FW_DIR="$FORGEWRIGHT_DIR"
elif [ -d "$FORGEWRIGHT_DIR/forgewright" ]; then
    # forgewright is a submodule inside the project
    PROJECT_DIR="$FORGEWRIGHT_DIR"
    FW_DIR="$PROJECT_DIR/forgewright"
else
    echo "ERROR: Cannot detect forgewright location. Run from within the forgewright directory." >&2
    exit 1
fi

FW_DIR="${FORGEWRIGHT_DIR}"  # always point to forgewright root for file ops

STATE_FILE="$FW_DIR/.forgewright/asip-state.json"
METRICS_FILE="$FW_DIR/.forgewright/asip-metrics.json"
LESSON_PLAN="$FW_DIR/.forgewright/plan-lessons.md"
LESSON_EXEC="$FW_DIR/.forgewright/execution-lessons.md"
SESSION_TRACK="$FW_DIR/.forgewright/session-track.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${BLUE}[INIT]${NC}  $*"; }
ok()   { echo -e "${GREEN}[INIT]${NC}  $*"; }
warn() { echo -e "${YELLOW}[INIT]${NC}  $*" >&2; }
err()  { echo -e "${RED}[INIT]${NC}  $*" >&2; }

# ---------------------------------------------------------------------------
# Check utilities
# ---------------------------------------------------------------------------

check_shell_deps() {
    local missing=()
    for cmd in python3 git; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing dependencies: ${missing[*]}"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Bootstrap: create all baseline infrastructure files
# ---------------------------------------------------------------------------

bootstrap_asip_state() {
    mkdir -p "$(dirname "$STATE_FILE")"
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'EOF'
{
  "sessionId": null,
  "planAttempts": {},
  "executionAttempts": {},
  "totalResearchGates": 0,
  "skillUpdates": [],
  "lastUpdated": null
}
EOF
        ok "Created asip-state.json"
    else
        ok "asip-state.json already exists"
    fi
}

bootstrap_asip_metrics() {
    mkdir -p "$(dirname "$METRICS_FILE")"
    if [ ! -f "$METRICS_FILE" ]; then
        cat > "$METRICS_FILE" << 'EOF'
{
  "projectAdaptation": {
    "totalResearchGates": 0,
    "totalSkillUpdates": 0,
    "uniquePatterns": 0,
    "lessonsLearned": 0,
    "failuresAvoided": 0,
    "sessionsWithEvolution": 0,
    "totalMigrations": 0,
    "lastUpdated": null
  },
  "bySkill": {},
  "byBlockerType": {
    "Technical": 0,
    "Architectural": 0,
    "Tooling": 0,
    "External": 0,
    "Performance": 0,
    "Knowledge": 0,
    "Unknown": 0
  },
  "byWeakCriterion": {
    "Completeness": 0,
    "Specificity": 0,
    "Feasibility": 0,
    "RiskAwareness": 0,
    "ScopeControl": 0,
    "DependencyOrdering": 0,
    "Testability": 0,
    "ImpactAssessment": 0
  },
  "lastUpdated": null
}
EOF
        ok "Created asip-metrics.json"
    else
        ok "asip-metrics.json already exists"
    fi
}

bootstrap_lesson_files() {
    mkdir -p "$(dirname "$LESSON_PLAN")"

    if [ ! -f "$LESSON_PLAN" ]; then
        cat > "$LESSON_PLAN" << 'EOF'
# Plan Lessons — cross-session planning knowledge

> Project-local planning lessons. Keep entries here for reviewed reuse.
> Shared Forgewright skills are not auto-mutated from session lessons.

## Session-Lessons

<!-- Append new entries below. Format:
## [Date] — [Skill Name]
### Weak Criterion: [Criterion Name] (Score: X/1.25)
### Problem: [What the plan missed]
### Research Source: [NotebookLM notebook URL]
### Lesson: [What to always include when planning this type of work]
### Example:
  - BAD: [vague example]
  - GOOD: [specific example]
-->
EOF
        ok "Created plan-lessons.md"
    else
        ok "plan-lessons.md already exists"
    fi

    if [ ! -f "$LESSON_EXEC" ]; then
        cat > "$LESSON_EXEC" << 'EOF'
# Execution Lessons — cross-session implementation knowledge

> Project-local execution lessons. Keep entries here for reviewed reuse.
> Shared Forgewright skills are not auto-mutated from session lessons.

## Session-Lessons

<!-- Append new entries below. Format:
## [Date] — [Skill Name]
### Blocker Type: [Technical/Architectural/Tooling/External]
### Problem: [What was blocking]
### Failed Attempts: [What was tried and failed]
### Research Source: [NotebookLM notebook URL]
### Solution: [What fixed it]
### Key Insight: [1-sentence takeaway]
### Apply When: [When to apply this pattern]
-->
EOF
        ok "Created execution-lessons.md"
    else
        ok "execution-lessons.md already exists"
    fi
}

bootstrap_migration_state() {
    local mig_file="$FW_DIR/.forgewright/lesson-migration-state.json"
    mkdir -p "$(dirname "$mig_file")"
    if [ ! -f "$mig_file" ]; then
        cat > "$mig_file" << 'EOF'
{
  "lastMigrationPlan": null,
  "lastMigrationExec": null,
  "migratedPlanEntries": [],
  "migratedExecEntries": [],
  "totalMigrated": 0
}
EOF
        ok "Created lesson-migration-state.json"
    else
        ok "lesson-migration-state.json already exists"
    fi
}

bootstrap_session_tracker() {
    if [ -f "$SESSION_TRACK" ]; then
        ok "session-track.json already exists"
    else
        # Re-initialize via forgewright-session-tracker.sh
        if [ -x "$SCRIPT_DIR/forgewright-session-tracker.sh" ]; then
            bash "$SCRIPT_DIR/forgewright-session-tracker.sh" init 2>/dev/null || true
            ok "Initialized session-track.json"
        else
            # Fallback: create manually
            mkdir -p "$(dirname "$SESSION_TRACK")"
            echo '{"plan_failures":0,"execution_failures":0,"last_plan_score":null,"last_execution_result":null,"last_update":null,"research_gate_triggered":false}' > "$SESSION_TRACK"
            ok "Created session-track.json (fallback)"
        fi
    fi
}

bootstrap_scripts() {
    local required_scripts=(
        "asip-deterministic-check.sh"
        "forgewright-lesson-migrator.sh"
        "forgewright-session-tracker.sh"
    )

    for script in "${required_scripts[@]}"; do
        local path="$SCRIPT_DIR/$script"
        if [ -f "$path" ]; then
            # Ensure executable
            chmod +x "$path" 2>/dev/null || true
            ok "Script $script: present"
        else
            warn "Script $script: MISSING (expected at $path)"
        fi
    done
}

# ---------------------------------------------------------------------------
# Update metrics (for post-ASIP-cycle calls)
# ---------------------------------------------------------------------------

update_metrics() {
    local type="$1"   # research_gate | skill_update | lesson_learned | failure_avoided
    local skill="${2:-}"
    local value="${3:-1}"

    if [ ! -f "$METRICS_FILE" ]; then
        bootstrap_asip_metrics
    fi

    python3 -c "
import json
from datetime import datetime

try:
    with open('$METRICS_FILE') as f:
        m = json.load(f)
except:
    m = {'projectAdaptation': {}, 'bySkill': {}, 'byBlockerType': {}, 'byWeakCriterion': {}}

pa = m.get('projectAdaptation', {})
pa['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

if '$type' == 'research_gate':
    pa['totalResearchGates'] = pa.get('totalResearchGates', 0) + int('$value')
    pa['sessionsWithEvolution'] = pa.get('sessionsWithEvolution', 0) + 1
elif '$type' == 'skill_update':
    pa['totalSkillUpdates'] = pa.get('totalSkillUpdates', 0) + int('$value')
elif '$type' == 'lesson_learned':
    pa['lessonsLearned'] = pa.get('lessonsLearned', 0) + int('$value')
elif '$type' == 'failure_avoided':
    pa['failuresAvoided'] = pa.get('failuresAvoided', 0) + int('$value')

if '$skill':
    if '$skill' not in m.get('bySkill', {}):
        m.setdefault('bySkill', {})['$skill'] = {'researchGates': 0, 'skillUpdates': 0}
    s = m['bySkill']['$skill']
    if '$type' == 'research_gate':
        s['researchGates'] = s.get('researchGates', 0) + 1
    elif '$type' == 'skill_update':
        s['skillUpdates'] = s.get('skillUpdates', 0) + 1

m['projectAdaptation'] = pa
m['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

with open('$METRICS_FILE', 'w') as f:
    json.dump(m, f, indent=2)
" 2>/dev/null

    ok "Metrics updated: $type (+$value)"
}

# ---------------------------------------------------------------------------
# Update asip-state (for middleware/skill calls)
# ---------------------------------------------------------------------------

update_state() {
    local action="$1"  # init | record_plan | record_exec | clear
    local skill="$2"
    local task="$3"
    local score="${4:-}"
    local result="${5:-}"

    mkdir -p "$(dirname "$STATE_FILE")"

    if [ "$action" = "init" ]; then
        bootstrap_asip_state
        python3 -c "
import json
from datetime import datetime
try:
    with open('$STATE_FILE') as f: m = json.load(f)
except: m = {}
m['sessionId'] = datetime.utcnow().isoformat() + 'Z'
m['lastUpdated'] = m['sessionId']
with open('$STATE_FILE', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null
        ok "ASIP state initialized"
        return
    fi

    python3 -c "
import json
from datetime import datetime

try:
    with open('$STATE_FILE') as f: m = json.load(f)
except:
    m = {'sessionId': datetime.utcnow().isoformat() + 'Z', 'planAttempts': {}, 'executionAttempts': {}, 'totalResearchGates': 0}

m['lastUpdated'] = datetime.utcnow().isoformat() + 'Z'

if '$action' == 'record_plan':
    key = 'planAttempts'
    if '$skill' not in m.get(key, {}): m.setdefault(key, {})['$skill'] = {}
    if '$task' not in m[key]['$skill']: m[key]['$skill']['$task'] = {'attempts': 0, 'lastScore': None, 'researchGateTriggered': False}
    t = m[key]['$skill']['$task']
    t['attempts'] = t.get('attempts', 0) + 1
    t['lastScore'] = float('$score') if '$score' else t.get('lastScore')
    if t['attempts'] >= 2: t['researchGateTriggered'] = True

elif '$action' == 'record_exec':
    key = 'executionAttempts'
    if '$skill' not in m.get(key, {}): m.setdefault(key, {})['$skill'] = {}
    if '$task' not in m[key]['$skill']: m[key]['$skill']['$task'] = {'attempts': 0, 'lastResult': None, 'researchGateTriggered': False}
    t = m[key]['$skill']['$task']
    t['attempts'] = t.get('attempts', 0) + 1
    t['lastResult'] = '$result'
    if t['attempts'] >= 2: t['researchGateTriggered'] = True

elif '$action' == 'clear':
    for key in ['planAttempts', 'executionAttempts']:
        if '$skill' in m.get(key, {}):
            if '$task' in m[key]['$skill']:
                del m[key]['$skill']['$task']

with open('$STATE_FILE', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null

    ok "ASIP state updated: $action / $skill / $task"
}

# ---------------------------------------------------------------------------
# Check status
# ---------------------------------------------------------------------------

check_status() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ASIP Infrastructure Status"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local all_ok=true

    # Check files
    for item in "asip-state.json:$STATE_FILE" "asip-metrics.json:$METRICS_FILE" "plan-lessons.md:$LESSON_PLAN" "execution-lessons.md:$LESSON_EXEC"; do
        local name="${item%:*}"
        local path="${item#*:}"
        if [ -f "$path" ]; then
            local lines
            lines=$(wc -l < "$path" | tr -d ' ')
            echo -e "  ${GREEN}✓${NC} $name ($lines lines)"
        else
            echo -e "  ${RED}✗${NC} $name (MISSING — run init)"
            all_ok=false
        fi
    done

    # Check scripts
    echo ""
    echo "  Scripts:"
    for script in "asip-deterministic-check.sh" "forgewright-lesson-migrator.sh" "forgewright-session-tracker.sh"; do
        local path="$SCRIPT_DIR/$script"
        if [ -f "$path" ] && [ -x "$path" ]; then
            echo -e "  ${GREEN}✓${NC} $script (executable)"
        elif [ -f "$path" ]; then
            echo -e "  ${YELLOW}⚠${NC} $script (not executable)"
        else
            echo -e "  ${RED}✗${NC} $script (MISSING)"
        fi
    done

    # Check session-track.json
    if [ -f "$SESSION_TRACK" ]; then
        echo -e "  ${GREEN}✓${NC} session-track.json"
    else
        echo -e "  ${YELLOW}⚠${NC} session-track.json (not found)"
    fi

    # Metrics summary (handle JSON with markdown comments)
    if [ -f "$METRICS_FILE" ]; then
        echo ""
        echo "  Metrics summary:"
        python3 -c "
import json, re
try:
    with open('$METRICS_FILE') as f:
        content = f.read()
    # Strip markdown comments (lines starting with #)
    content = re.sub(r'^#.*$', '', content, flags=re.MULTILINE)
    m = json.loads(content)
    pa = m.get('projectAdaptation', {})
    print(f\"    Research gates: {pa.get('totalResearchGates', 0)}\")
    print(f\"    Skill updates:  {pa.get('totalSkillUpdates', 0)}\")
    print(f\"    Lessons learned: {pa.get('lessonsLearned', 0)}\")
    print(f\"    Sessions evolved: {pa.get('sessionsWithEvolution', 0)}\")
    print(f\"    Failures avoided: {pa.get('failuresAvoided', 0)}\")
    print(f\"    Total migrations: {pa.get('totalMigrations', 0)}\")
except Exception as e:
    print(f'    (could not parse metrics: {e})')
" 2>/dev/null
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if $all_ok; then
        echo -e "  Status: ${GREEN}ALL SYSTEMS OK${NC}"
    else
        echo -e "  Status: ${RED}INCOMPLETE — run: bash scripts/forgewright-evolution-init.sh${NC}"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# ---------------------------------------------------------------------------
# Verify: run deterministic check on itself
# ---------------------------------------------------------------------------

self_verify() {
    log "Self-verification: checking this script's shell syntax..."
    if bash -n "$0" 2>/dev/null; then
        ok "Shell syntax: valid"
    else
        err "Shell syntax: INVALID"
        return 1
    fi

    log "Self-verification: checking referenced scripts..."
    for script in asip-deterministic-check.sh forgewright-lesson-migrator.sh forgewright-session-tracker.sh; do
        if [ -f "$SCRIPT_DIR/$script" ]; then
            if bash -n "$SCRIPT_DIR/$script" 2>/dev/null; then
                ok "  $script: valid"
            else
                err "  $script: INVALID syntax"
                return 1
            fi
        fi
    done

    ok "Self-verification: all checks passed"
}

# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

main() {
    check_shell_deps || exit 1

    case "${1:-init}" in
        init|--init)
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  ASIP Infrastructure Bootstrap"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            bootstrap_asip_state
            bootstrap_asip_metrics
            bootstrap_lesson_files
            bootstrap_migration_state
            bootstrap_session_tracker
            bootstrap_scripts
            echo ""
            self_verify
            echo ""
            ok "Bootstrap complete!"
            ok "Run: bash scripts/forgewright-evolution-init.sh --check  (to verify)"
            echo ""
            ;;
        --check|check|status)
            check_status
            ;;
        --update-metrics)
            if [ -z "${2:-}" ]; then
                echo "Usage: $0 --update-metrics <type> [skill] [value]"
                echo "  type: research_gate | skill_update | lesson_learned | failure_avoided"
                exit 1
            fi
            update_metrics "$2" "${3:-}" "${4:-1}"
            ;;
        --update-state)
            update_state "${2:-init}" "${3:-}" "${4:-}" "${5:-}" "${6:-}"
            ;;
        --verify|verify)
            self_verify
            ;;
        *)
            echo "Usage: $0 {init|check|status|verify}"
            echo "       $0 --update-metrics <type> [skill] [value]"
            echo "       $0 --update-state <action> [skill] [task] [score] [result]"
            exit 1
            ;;
    esac
}

main "$@"
