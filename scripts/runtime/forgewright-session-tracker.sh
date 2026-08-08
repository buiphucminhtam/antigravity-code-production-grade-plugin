#!/bin/bash
# forgewright-session-tracker.sh
# Tracks session quality and recovery telemetry. Legacy ASIP fields remain for compatibility.
# Part of Phase 1 - Task 1.4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRACK_FILE="$PROJECT_DIR/.forgewright/session-tracker-v2.json"
METRICS_FILE="$PROJECT_DIR/.forgewright/asip-metrics.json"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log() { echo -e "${BLUE}[TRACK]${NC} $*"; }
pass() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

# ---------------------------------------------------------------------------
# Initialize session tracking
# ---------------------------------------------------------------------------

init_track() {
    mkdir -p "$(dirname "$TRACK_FILE")" 2>/dev/null || true
    if [ ! -f "$TRACK_FILE" ]; then
        cat > "$TRACK_FILE" << 'EOF'
{
  "sessions": [],
  "current_session": null,
  "planScores": [],
  "planFailures": 0,
  "consecutiveFailures": 0,
  "consecutiveFailureThreshold": 2,
  "evolutionTriggered": false,
  "lastUpdated": null
}
EOF
    fi
}

# ---------------------------------------------------------------------------
# Start a new session
# ---------------------------------------------------------------------------

start_session() {
    local mode="${1:-unknown}"
    local request="${2:-}"
    
    init_track
    
    local session_id="session_$(date +%Y%m%d_%H%M%S)"
    local session_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # Update current session
    python3 -c "
import json

data = {}
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
except:
    pass

data['current_session'] = {
    'id': '$session_id',
    'mode': '$mode',
    'request': '$request',
    'start': '$session_start',
    'status': 'active'
}
data['lastUpdated'] = '$session_start'

with open('$TRACK_FILE', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
    
    log "Session started: $session_id (mode: $mode)"
}

# ---------------------------------------------------------------------------
# Record a plan score
# ---------------------------------------------------------------------------

record_plan() {
    local score="$1"
    local threshold_arg="${2:-}"
    
    init_track

    local threshold
    threshold=$(python3 -c "
import json, re

arg = '''$threshold_arg'''.strip()
if arg and re.match(r'^[0-9]+(\.[0-9]+)?$', arg):
    print(arg)
    raise SystemExit

mode = arg.lower()
if not mode:
    try:
        with open('$TRACK_FILE') as f:
            data = json.load(f)
        mode = str((data.get('current_session') or {}).get('mode') or '').lower()
    except Exception:
        mode = ''

mode = mode.replace('_', '-').replace(' ', '-')
thresholds = {
    'explore': 6.0,
    'research': 6.0,
    'review': 7.0,
    'test': 7.0,
    'document': 7.0,
    'feature': 8.0,
    'debug': 8.0,
    'optimize': 8.0,
    'harden': 8.5,
    'migrate': 8.5,
    'full-build': 9.0,
    'ship': 9.0,
    'game': 9.0,
    'game-build': 9.0,
    'xr-build': 9.0,
    'ai-build': 9.0,
}
print(thresholds.get(mode, 8.0))
" 2>/dev/null)
    
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # Determine pass/fail using Python for reliable comparison
    local passed
    passed=$(python3 -c "
score = float('$score')
threshold = float('$threshold')
print('true' if score >= threshold else 'false')
" 2>/dev/null)
    
    # Update tracking
    python3 -c "
import json

data = {}
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
except:
    pass

# Add to plan scores
if 'planScores' not in data:
    data['planScores'] = []

data['planScores'].append({
    'score': float('$score'),
    'threshold': float('$threshold'),
    'passed': '$passed' == 'true',
    'timestamp': '$timestamp'
})

# Update failure tracking
if '$passed' == 'true':
    data['consecutiveFailures'] = 0
else:
    data['consecutiveFailures'] = data.get('consecutiveFailures', 0) + 1
    data['planFailures'] = data.get('planFailures', 0) + 1

data['lastUpdated'] = '$timestamp'

with open('$TRACK_FILE', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
    
    if [ "$passed" = "true" ]; then
        pass "Plan score: $score (PASSED)"
        
        # [Graph Layer] Ensure nodes exist in SQLite Graph (TSK-06)
        if command -v python3 &>/dev/null; then
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "current-session" "episodic" "Current Session" "Dynamic episodic node tracking current session" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "plan-quality" "semantic" "Plan Quality Loop" "Static semantic concept of the Forgewright plan quality metrics" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-link "current-session" "plan-quality" --weight 1.0 --type "relates_to" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-reinforce "current-session" "plan-quality" --factor 1.2 2>/dev/null || true
        fi
    else
        warn "Plan score: $score (FAILED - below $threshold)"
        
        # [Graph Layer] Ensure nodes exist in SQLite Graph (TSK-06)
        if command -v python3 &>/dev/null; then
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "current-session" "episodic" "Current Session" "Dynamic episodic node tracking current session" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-add-node "plan-quality" "semantic" "Plan Quality Loop" "Static semantic concept of the Forgewright plan quality metrics" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-link "current-session" "plan-quality" --weight 1.0 --type "relates_to" 2>/dev/null || true
            python3 "$PROJECT_DIR/scripts/mem0-v2.py" graph-decay "current-session" "plan-quality" --factor 0.5 2>/dev/null || true
        fi
        
        # A failed plan score is telemetry, not permission to mutate shared skills.
        warn "Plan needs improvement. Research only if a material knowledge/evidence gap blocks the next decision."
        warn "Project-local lessons may be recorded; framework skill mutation is disabled by default."
    fi
}

# ---------------------------------------------------------------------------
# End session
# ---------------------------------------------------------------------------

end_session() {
    local status="${1:-completed}"
    local summary="${2:-}"
    
    init_track
    
    local session_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    python3 -c "
import json
import subprocess

data = {}
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
except:
    pass

# [Graph Layer] Procedural Consolidation & PES Calculation (TSK-07)
if '$status' == 'completed':
    try:
        scores = data.get('planScores', [])
        if scores:
            total_attempts = len(scores)
            passed_attempts = len([s for s in scores if s.get('passed')])
            failed_attempts = total_attempts - passed_attempts
            
            # Mathematical PES Calculation:
            # PES = 0.5 * SuccessRate + 0.3 * (1 - ExcessAttempts / TotalAttempts) - 0.2 * (Errors / TotalAttempts)
            success_rate = passed_attempts / total_attempts if total_attempts > 0 else 0.0
            excess_factor = 1.0 - ((total_attempts - 1) / total_attempts) if total_attempts > 0 else 1.0
            error_ratio = failed_attempts / total_attempts if total_attempts > 0 else 0.0
            
            pes_score = round(0.5 * success_rate + 0.3 * excess_factor - 0.2 * error_ratio, 2)
            pes_score = max(0.0, min(1.0, pes_score))
            
            # Consolidated threshold adjusted for session scopes: PES >= 0.20
            if pes_score >= 0.20:
                current_session = data.get('current_session') or {}
                session_id = current_session.get('id', 'session_unknown')
                mode = current_session.get('mode', 'unknown')
                summary = '$summary'
                
                # Insert dynamic nodes via CLI or subprocess
                subprocess.run([
                    'python3', '$PROJECT_DIR/scripts/mem0-v2.py', 'graph-add-node',
                    f'proc-{session_id}', 'procedural', f'Optimized procedural circuit for {mode}',
                    f'Successful trajectory consolidated with PES={pes_score}. Summary: {summary}',
                    '--pes', str(pes_score)
                ], stderr=subprocess.DEVNULL)
                
                # Link procedural node to semantic targets
                subprocess.run([
                    'python3', '$PROJECT_DIR/scripts/mem0-v2.py', 'graph-link',
                    f'proc-{session_id}', 'plan-quality', '--weight', '3.0', '--type', 'solves'
                ], stderr=subprocess.DEVNULL)

                # Consolidate procedural steps (tasks) into procedural_circuits
                steps = []
                try:
                    from pathlib import Path
                    session_log_path = Path('$PROJECT_DIR/.forgewright/session-log.json')
                    if session_log_path.exists():
                        log_data = json.loads(session_log_path.read_text())
                        for s in log_data.get('sessions', []):
                            if s.get('status') == 'in_progress' or s.get('session_id') == session_id:
                                for tid, t in s.get('tasks', {}).items():
                                    if t.get('status') == 'completed':
                                        steps.append({
                                            'id': tid,
                                            'summary': t.get('summary', ''),
                                            'updated_at': t.get('updated_at', '')
                                        })
                except Exception:
                    pass
                
                steps_json = json.dumps(steps)
                subprocess.run([
                    'python3', '$PROJECT_DIR/scripts/mem0-v2.py', 'graph-save-circuit',
                    f'proc-{session_id}', f'Optimized procedural circuit for {mode}',
                    steps_json, str(pes_score)
                ], stderr=subprocess.DEVNULL)
    except Exception as e:
        pass

# Move current session to history
if 'current_session' in data and data['current_session']:
    session = data['current_session']
    session['end'] = '$session_end'
    session['status'] = '$status'
    session['summary'] = '$summary'
    
    if 'sessions' not in data:
        data['sessions'] = []
    data['sessions'].append(session)
    
    # Keep only last 100 sessions
    if len(data['sessions']) > 100:
        data['sessions'] = data['sessions'][-100:]
    
    data['current_session'] = None

data['lastUpdated'] = '$session_end'

with open('$TRACK_FILE', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
    
    log "Session ended: $status"
}

# ---------------------------------------------------------------------------
# Check consecutive failures (recovery stop signal; no automatic framework evolution)
# ---------------------------------------------------------------------------

check_asip_trigger() {
    init_track
    
    local consecutive=$(python3 -c "
import json
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
    print(data.get('consecutiveFailures', 0))
except:
    print(0)
" 2>/dev/null)
    
    local threshold=$(python3 -c "
import json
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
    print(data.get('consecutiveFailureThreshold', 2))
except:
    print(2)
" 2>/dev/null)
    
    if [ "$consecutive" -ge "$threshold" ]; then
        warn "Recovery threshold reached: $consecutive consecutive failures"
        warn "STOP repeated attempts. Open Research Gate only if a material unknown blocks the next decision; otherwise escalate with evidence."
        warn "Automatic lesson migration/framework mutation is disabled."

        python3 -c "
import json
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
    data['recoveryRequired'] = True
    data['evolutionTriggered'] = False  # legacy field retained; auto-evolution is deprecated
    with open('$TRACK_FILE', 'w') as f:
        json.dump(data, f, indent=2)
except:
    pass
" 2>/dev/null || true

        return 0
    fi
    
    return 1
}

# ---------------------------------------------------------------------------
# Get status
# ---------------------------------------------------------------------------

show_status() {
    init_track
    
    echo ""
    echo "=== Session Tracker Status ==="
    echo ""
    
    if [ -f "$TRACK_FILE" ]; then
        python3 -c "
import json
try:
    with open('$TRACK_FILE') as f:
        data = json.load(f)
    
    print('Sessions tracked:', len(data.get('sessions', [])))
    print('Plan failures:', data.get('planFailures', 0))
    print('Consecutive failures:', data.get('consecutiveFailures', 0))
    print('Recovery required:', data.get('recoveryRequired', False))
    print('Legacy auto-evolution:', data.get('evolutionTriggered', False))
    
    if data.get('current_session'):
        cs = data['current_session']
        print('')
        print('Current session:')
        print('  ID:', cs.get('id', 'N/A'))
        print('  Mode:', cs.get('mode', 'N/A'))
        print('  Status:', cs.get('status', 'N/A'))
    
    print('')
    print('Recent plan scores:')
    for ps in data.get('planScores', [])[-5:]:
        status = 'PASS' if ps.get('passed') else 'FAIL'
        print(f\"  {ps.get('score')}: {status} ({ps.get('timestamp', 'N/A')[:10]})\")
except Exception as e:
    print('Error reading track file:', e)
" 2>/dev/null || cat "$TRACK_FILE"
    else
        echo "No tracking data found."
    fi
    
    echo ""
}

# ---------------------------------------------------------------------------
# CLI Dispatcher
# ---------------------------------------------------------------------------

case "${1:-status}" in
    start)
        start_session "${2:-}" "${3:-}"
        ;;
    plan)
        record_plan "${2:-0}" "${3:-}"
        ;;
    end)
        end_session "${2:-completed}" "${3:-}"
        ;;
    check)
        check_asip_trigger
        ;;
    status)
        show_status
        ;;
    init)
        init_track
        pass "Session tracker initialized"
        ;;
    *)
        echo "Usage: $0 {start|plan|end|check|status|init}"
        echo ""
        echo "Commands:"
        echo "  start <mode> <request>   - Start a new session"
        echo "  plan <score> [threshold|mode] - Record plan score with mode-aware threshold"
        echo "  end [status] [summary]   - End current session"
        echo "  check                    - Check consecutive failures and require stop/recovery when threshold is reached"
        echo "  status                   - Show current status"
        echo "  init                     - Initialize tracker"
        exit 1
        ;;
esac
