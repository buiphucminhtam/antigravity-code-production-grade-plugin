#!/usr/bin/env bash
#────────────────────────────────────────────────────────────────────────────
# Forgewright Hook Doctor
#────────────────────────────────────────────────────────────────────────────
# Purpose: Diagnose hook health and configuration across all AI IDEs
#
# Usage:
#   bash forgewright/scripts/forgewright-hook-doctor.sh          # Full diagnosis
#   bash forgewright/scripts/forgewright-hook-doctor.sh --quick  # Quick check
#   bash forgewright/scripts/forgewright-hook-doctor.sh --fix     # Auto-fix issues
#
# Checks:
#   - Hook script exists and is executable
#   - Memory session script exists
#   - Environment variables configured
#   - Claude Code hooks.json configured
#   - Profile settings valid
#   - Disk space for memory storage
#────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/forgewright-memory-hook.sh"
MEMORY_SESSION="${SCRIPT_DIR}/../memory/memory-session.sh"
MEMORY_DB_DIR="${HOME}/.forgewright/sessions"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASS=0 FAIL=0 WARN=0

resolve_python311() {
    local candidate resolved
    if [[ -n "${FORGEWRIGHT_PYTHON_BIN:-}" && -x "${FORGEWRIGHT_PYTHON_BIN}" ]]; then
        if "${FORGEWRIGHT_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            printf '%s\n' "${FORGEWRIGHT_PYTHON_BIN}"
            return 0
        fi
    fi
    for candidate in python3.13 python3.12 python3.11 python3 python; do
        resolved="$(command -v "$candidate" 2>/dev/null || true)"
        [[ -n "$resolved" ]] || continue
        if "$resolved" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            printf '%s\n' "$resolved"
            return 0
        fi
    done
    return 1
}

PYTHON_BIN="$(resolve_python311 || true)"

# ─── Logging Functions ────────────────────────────────────────────────────────

log_pass() { echo -e "${GREEN}  ✓${NC} $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}  ✗${NC} $1"; FAIL=$((FAIL + 1)); }
log_warn() { echo -e "${YELLOW}  ⚠${NC} $1"; WARN=$((WARN + 1)); }
log_info() { echo -e "  $1"; }
log_header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ─── Argument Parsing ─────────────────────────────────────────────────────────

QUICK_MODE=false
AUTO_FIX=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick) QUICK_MODE=true; shift ;;
        --fix) AUTO_FIX=true; shift ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --quick   Quick health check (skip detailed tests)"
            echo "  --fix     Auto-fix detected issues"
            echo "  --help    Show this help"
            exit 0
            ;;
        *) shift ;;
    esac
done

# ─── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}⚕️  Forgewright Hook Doctor${NC}"
echo ""
echo "  Hook Script: $HOOK_SCRIPT"
echo "  Memory Session: $MEMORY_SESSION"
echo "  Profile: ${FORGEWRIGHT_HOOK_PROFILE:-standard}"
echo ""

# ─── Check 1: Script Existence ────────────────────────────────────────────────

log_header "Script Files"

# Hook script
if [[ -f "$HOOK_SCRIPT" ]]; then
    log_pass "Hook script exists: $HOOK_SCRIPT"
    if [[ -x "$HOOK_SCRIPT" ]]; then
        log_pass "Hook script is executable"
    else
        log_fail "Hook script is NOT executable"
        if [[ "$AUTO_FIX" == "true" ]]; then
            chmod +x "$HOOK_SCRIPT"
            log_info "  → Fixed: Made executable"
        fi
    fi
else
    log_fail "Hook script MISSING: $HOOK_SCRIPT"
fi

# Memory session script
if [[ -f "$MEMORY_SESSION" ]]; then
    log_pass "Memory session script exists: $MEMORY_SESSION"
    if [[ -x "$MEMORY_SESSION" ]]; then
        log_pass "Memory session script is executable"
    else
        log_fail "Memory session script is NOT executable"
        if [[ "$AUTO_FIX" == "true" ]]; then
            chmod +x "$MEMORY_SESSION"
            log_info "  → Fixed: Made executable"
        fi
    fi
else
    log_fail "Memory session script MISSING: $MEMORY_SESSION"
fi

# ─── Check 2: Directory Structure ──────────────────────────────────────────────

log_header "Directory Structure"

# Forgewright directories
for dir in \
    "${HOME}/.forgewright" \
    "${HOME}/.forgewright/sessions" \
    "${SCRIPT_DIR}/../.." \
    "${HOME}/.claude" \
    "${HOME}/.gemini" \
    "${HOME}/.cursor" \
    "${HOME}/.codex"
do
    if [[ -d "$dir" ]]; then
        log_pass "Directory exists: $dir"
    else
        log_warn "Directory missing: $dir"
        if [[ "$AUTO_FIX" == "true" ]]; then
            mkdir -p "$dir"
            log_info "  → Fixed: Created directory"
        fi
    fi
done

# ─── Check 3: Environment Variables ───────────────────────────────────────────

log_header "Environment Configuration"

# Profile
if [[ -n "${FORGEWRIGHT_HOOK_PROFILE:-}" ]]; then
    case "$FORGEWRIGHT_HOOK_PROFILE" in
        minimal|standard|strict)
            log_pass "Profile set: $FORGEWRIGHT_HOOK_PROFILE"
            ;;
        *)
            log_warn "Profile invalid: $FORGEWRIGHT_HOOK_PROFILE (expected: minimal|standard|strict)"
            ;;
    esac
else
    log_info "Profile not set (default: standard)"
fi

# Tick interval
if [[ -n "${FORGEWRIGHT_MEMORY_TICK_INTERVAL:-}" ]]; then
    log_pass "Tick interval: $FORGEWRIGHT_MEMORY_TICK_INTERVAL"
elif [[ -n "${MEMORY_CHECKPOINT_INTERVAL:-}" ]]; then
    log_pass "Legacy tick interval (MEMORY_CHECKPOINT_INTERVAL): $MEMORY_CHECKPOINT_INTERVAL"
else
    log_info "Tick interval not set (default: 3)"
fi

# Disabled hooks
if [[ -n "${FORGEWRIGHT_DISABLED_HOOKS:-}" ]]; then
    log_pass "Disabled hooks: $FORGEWRIGHT_DISABLED_HOOKS"
else
    log_info "No disabled hooks"
fi

# Session start max chars
if [[ -n "${FORGEWRIGHT_SESSION_START_MAX_CHARS:-}" ]]; then
    log_pass "Session start max chars: $FORGEWRIGHT_SESSION_START_MAX_CHARS"
else
    log_info "Session start max chars not set (default: 50000)"
fi

# ─── Check 4: Platform Hook Configurations ─────────────────────────────────────

log_header "Platform Hook Configurations"

# Determine project root path
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GATE_SCRIPT="${PROJECT_ROOT}/scripts/lite/stop-gate.sh"

# 1. Claude Code Hook Configuration
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
if [[ -f "$CLAUDE_SETTINGS" ]]; then
    log_pass "Claude Code settings file exists"
    claude_schema=$(node -e "try { var c=JSON.parse(require('fs').readFileSync('$CLAUDE_SETTINGS')); var ok=c.hooks && !('stop' in c.hooks) && Array.isArray(c.hooks.Stop) && c.hooks.Stop.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return h.type === 'command' && typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform CLAUDE'); }); }); console.log(Boolean(ok)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$claude_schema" == "true" ]]; then
        log_pass "Claude Stop hook uses the native matcher-group schema"
    else
        log_warn "Claude Stop hook schema is invalid or stop-gate.sh is missing"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
            node -e "
var fs = require('fs');
var cfg = JSON.parse(fs.readFileSync('$CLAUDE_SETTINGS', 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
delete cfg.hooks.stop;
var Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
Stop = Stop.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.includes('verify-gate.sh --platform CLAUDE')); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = Stop.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform CLAUDE'); }); });
if (!already) Stop.push({ hooks: [{ type: 'command', command: 'bash $GATE_SCRIPT --platform CLAUDE' }] });
cfg.hooks.Stop = Stop;
fs.writeFileSync('$CLAUDE_SETTINGS', JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Installed native Claude Stop hook schema"
        fi
    fi
else
    log_warn "Claude Code settings file not found: $CLAUDE_SETTINGS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
        cat <<EOF > "$CLAUDE_SETTINGS"
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash $GATE_SCRIPT --platform CLAUDE"
          }
        ]
      }
    ]
  }
}
EOF
        log_info "  → Fixed: Created Claude settings with native Stop hook"
    fi
fi

# 2. Gemini Hook Configuration
GEMINI_SETTINGS="${HOME}/.gemini/settings.json"
if [[ -f "$GEMINI_SETTINGS" ]]; then
    log_pass "Gemini settings file exists"
    gemini_schema=$(node -e "try { var c=JSON.parse(require('fs').readFileSync('$GEMINI_SETTINGS')); var afterOk=c.hooks && Array.isArray(c.hooks.AfterAgent) && c.hooks.AfterAgent.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return h.type === 'command' && typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform GEMINI'); }); }); var beforeOk=c.hooks && Array.isArray(c.hooks.BeforeTool) && c.hooks.BeforeTool.some(function(g){ return g.matcher === '*' && Array.isArray(g.hooks) && g.hooks.some(function(h){ return h.name === 'forgewright-policy' && h.type === 'command' && typeof h.command === 'string' && h.command.includes('gemini-before-tool-gate.sh') && typeof h.timeout === 'number'; }); }); console.log(Boolean(afterOk && beforeOk)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$gemini_schema" == "true" ]]; then
        log_pass "Gemini BeforeTool and AfterAgent hooks use native schemas"
    else
        log_warn "Gemini BeforeTool or AfterAgent hook is not configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$GEMINI_SETTINGS" "${GEMINI_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
            node -e "
var fs = require('fs');
var cfg = JSON.parse(fs.readFileSync('$GEMINI_SETTINGS', 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
if (Array.isArray(cfg.hooks.AfterAgent) && cfg.hooks.AfterAgent.length > 0 && typeof cfg.hooks.AfterAgent[0] === 'string') cfg.hooks.AfterAgent = [];
var AA = Array.isArray(cfg.hooks.AfterAgent) ? cfg.hooks.AfterAgent : [];
AA = AA.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.includes('verify-gate.sh --platform GEMINI')); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = AA.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform GEMINI'); }); });
if (!already) AA.push({ matcher: '*', hooks: [{ type: 'command', command: 'bash $GATE_SCRIPT --platform GEMINI' }] });
cfg.hooks.AfterAgent = AA;
var BT = Array.isArray(cfg.hooks.BeforeTool) ? cfg.hooks.BeforeTool : [];
BT = BT.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !(typeof h.command === 'string' && h.command.includes('gemini-before-tool-gate.sh')); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
BT.push({ matcher: '*', hooks: [{ name: 'forgewright-policy', type: 'command', command: 'bash $PROJECT_ROOT/scripts/lite/gemini-before-tool-gate.sh', timeout: 5000 }] });
cfg.hooks.BeforeTool = BT;
fs.writeFileSync('$GEMINI_SETTINGS', JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Added Gemini BeforeTool and AfterAgent hooks"
        fi
    fi
else
    log_warn "Gemini settings file not found: $GEMINI_SETTINGS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$GEMINI_SETTINGS")"
        cat <<EOF > "$GEMINI_SETTINGS"
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "forgewright-policy",
            "type": "command",
            "command": "bash $PROJECT_ROOT/scripts/lite/gemini-before-tool-gate.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash $GATE_SCRIPT --platform GEMINI"
          }
        ]
      }
    ]
  }
}
EOF
        log_info "  → Fixed: Created Gemini settings with BeforeTool and AfterAgent hooks"
    fi
fi

# 3. Antigravity CLI Hook Configuration
ANTIGRAVITY_HOOKS="${HOME}/.gemini/config/hooks.json"
ANTIGRAVITY_GATE="${PROJECT_ROOT}/scripts/lite/antigravity-pre-tool-gate.sh"
if [[ -f "$ANTIGRAVITY_HOOKS" ]]; then
    log_pass "Antigravity hook registry exists"
    antigravity_schema=$(node -e "try { var fs=require('fs'), path=require('path'); var c=JSON.parse(fs.readFileSync('$ANTIGRAVITY_HOOKS')); var n=c['forgewright-policy']; var home=fs.realpathSync('$HOME'); function exactGate(h){ if ((h.type !== undefined && h.type !== 'command') || typeof h.command !== 'string') return false; var m=h.command.trim().match(/^bash\\s+(?:\"([^\"]+)\"|'([^']+)'|([^\\s\"']+))$/); if (!m) return false; var gate=fs.realpathSync(m[1] || m[2] || m[3]); return path.basename(gate)==='antigravity-pre-tool-gate.sh' && (gate===home || gate.startsWith(home+path.sep)); } var ok=n && n.enabled !== false && Array.isArray(n.PreToolUse) && n.PreToolUse.some(function(g){ return g.matcher === '*' && Array.isArray(g.hooks) && g.hooks.some(function(h){ return exactGate(h) && Number.isInteger(h.timeout) && h.timeout > 0; }); }); console.log(Boolean(ok)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$antigravity_schema" == "true" ]]; then
        log_pass "Antigravity PreToolUse policy hook uses the native named-hook schema"
    else
        log_warn "Antigravity PreToolUse policy hook is not configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$ANTIGRAVITY_HOOKS" "${ANTIGRAVITY_HOOKS}.bak.$(date +%Y%m%d%H%M%S)"
            node -e "
var fs = require('fs');
var file = '$ANTIGRAVITY_HOOKS';
var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') throw new Error('Antigravity hooks registry must be an object');
cfg['forgewright-policy'] = { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash $ANTIGRAVITY_GATE', timeout: 5 }] }] };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Installed native Antigravity PreToolUse hook"
        fi
    fi
else
    log_warn "Antigravity hook registry not found: $ANTIGRAVITY_HOOKS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$ANTIGRAVITY_HOOKS")"
        cat <<EOF > "$ANTIGRAVITY_HOOKS"
{
  "forgewright-policy": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash $ANTIGRAVITY_GATE",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
        log_info "  → Fixed: Created Antigravity hook registry"
    fi
fi

ANTIGRAVITY_SETTINGS="${HOME}/.gemini/antigravity-cli/settings.json"
if [[ -f "$ANTIGRAVITY_SETTINGS" ]]; then
    antigravity_always_proceed=$(node -e "try { var c=JSON.parse(require('fs').readFileSync('$ANTIGRAVITY_SETTINGS')); console.log(c.toolPermission === 'always-proceed'); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$antigravity_always_proceed" == "true" ]]; then
        log_warn "Antigravity toolPermission is always-proceed; Forgewright still gates tools, but native permission prompts are disabled"
    fi
fi

# 4. Cursor Hook Configuration
CURSOR_HOOKS="${HOME}/.cursor/hooks.json"
if [[ -f "$CURSOR_HOOKS" ]]; then
    log_pass "Cursor hooks file exists"
    cursor_schema=$(node -e "try { var c=JSON.parse(require('fs').readFileSync('$CURSOR_HOOKS')); var ok=c.version === 1 && c.hooks && Array.isArray(c.hooks.stop) && c.hooks.stop.some(function(h){ return typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform CURSOR'); }); console.log(Boolean(ok)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$cursor_schema" == "true" ]]; then
        log_pass "Cursor stop hook uses the version 1 array schema"
    else
        log_warn "Cursor stop hook NOT configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$CURSOR_HOOKS" "${CURSOR_HOOKS}.bak.$(date +%Y%m%d%H%M%S)"
            node -e "
var fs = require('fs');
var cfg = JSON.parse(fs.readFileSync('$CURSOR_HOOKS', 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
cfg.version = 1;
if (typeof cfg.hooks.stop === 'string') delete cfg.hooks.stop;
var stop = Array.isArray(cfg.hooks.stop) ? cfg.hooks.stop : [];
stop = stop.filter(function(h){ return !(typeof h.command === 'string' && h.command.includes('verify-gate.sh --platform CURSOR')); });
var already = stop.some(function(h){ return typeof h.command === 'string' && h.command.includes('stop-gate.sh --platform CURSOR'); });
if (!already) stop.push({ command: 'bash $GATE_SCRIPT --platform CURSOR' });
cfg.hooks.stop = stop;
fs.writeFileSync('$CURSOR_HOOKS', JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Installed Cursor version 1 stop hook schema"
        fi
    fi
else
    log_warn "Cursor hooks file not found: $CURSOR_HOOKS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$CURSOR_HOOKS")"
        cat <<EOF > "$CURSOR_HOOKS"
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "bash $GATE_SCRIPT --platform CURSOR"
      }
    ]
  }
}
EOF
        log_info "  → Fixed: Created Cursor hooks settings"
    fi
fi

# 5. Codex CLI Hook Configuration
CODEX_CONFIG="${HOME}/.codex/config.toml"
if [[ -f "$CODEX_CONFIG" ]]; then
    log_pass "Codex config file exists"
    if [[ -z "$PYTHON_BIN" ]]; then
        codex_schema="false"
        log_warn "Python >= 3.11 not found; Codex TOML hook validation skipped"
    else
        codex_schema=$("$PYTHON_BIN" - "$CODEX_CONFIG" <<'PYEOF'
import sys
import tomllib

try:
    with open(sys.argv[1], "rb") as handle:
        config = tomllib.load(handle)
    groups = config.get("hooks", {}).get("Stop", [])
    ok = isinstance(groups, list) and any(
        isinstance(group, dict)
        and any(
            isinstance(hook, dict)
            and hook.get("type") == "command"
            and "stop-gate.sh --platform CODEX" in hook.get("command", "")
            for hook in group.get("hooks", [])
        )
        for group in groups
    )
except (OSError, tomllib.TOMLDecodeError):
    ok = False
print(str(ok).lower())
PYEOF
)
    fi
    if [[ "$codex_schema" == "true" ]]; then
        log_pass "Codex Stop hook uses the native matcher-group schema"
    else
        log_warn "Codex Stop hook NOT configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$CODEX_CONFIG" "${CODEX_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
            if [[ -z "$PYTHON_BIN" ]]; then
                log_warn "Python >= 3.11 not found; cannot auto-fix Codex TOML hook"
            else
                "$PYTHON_BIN" - "$CODEX_CONFIG" <<'PYEOF'
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
            needs_features=true
            needs_hooks=true
            grep -qF '[features]' "$CODEX_CONFIG" 2>/dev/null && needs_features=false
            grep -qF '[hooks]' "$CODEX_CONFIG" 2>/dev/null && needs_hooks=false
            {
                echo ""
                $needs_features && echo '[features]' && echo 'hooks = true' && echo ""
                $needs_hooks && echo '[hooks]' && echo ""
                cat <<EOF
[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = "bash $GATE_SCRIPT --platform CODEX"
EOF
            } >> "$CODEX_CONFIG"
            log_info "  → Fixed: Added hooks block to Codex config"
        fi
    fi
else
    log_warn "Codex config file not found: $CODEX_CONFIG"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$CODEX_CONFIG")"
        cat <<EOF > "$CODEX_CONFIG"
[features]
hooks = true

[hooks]

[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = "bash $GATE_SCRIPT --platform CODEX"
EOF
        log_info "  → Fixed: Created Codex config with Stop hook"
    fi
fi

# ─── Check 5: Project Execution Policy ────────────────────────────────────────

log_header "Project Execution Policy"

POLICY_SEEDER="${PROJECT_ROOT}/scripts/lite/ensure-project-policy.sh"
SUPERPROJECT_ROOT="$(git -C "$PROJECT_ROOT" rev-parse --show-superproject-working-tree 2>/dev/null || true)"

if [[ -z "$SUPERPROJECT_ROOT" ]]; then
    log_info "Forgewright is not running as a submodule; no parent policy to seed"
else
    PARENT_POLICY="${SUPERPROJECT_ROOT}/.forgewright/execution-policy.yaml"
    if [[ -f "$PARENT_POLICY" || -L "$PARENT_POLICY" ]]; then
        log_pass "Parent workspace execution policy exists: $PARENT_POLICY"
    elif [[ "$AUTO_FIX" != "true" ]]; then
        log_fail "Parent workspace execution policy is missing: $PARENT_POLICY"
        log_info "  → Run this doctor with --fix before opening AGY in the parent workspace"
    elif [[ ! -x "$POLICY_SEEDER" ]]; then
        log_fail "Execution-policy seeder is missing: $POLICY_SEEDER"
    else
        policy_result=""
        if policy_result=$(bash "$POLICY_SEEDER" "$PROJECT_ROOT" "$SUPERPROJECT_ROOT") \
            && [[ -f "$PARENT_POLICY" || -L "$PARENT_POLICY" ]]; then
            log_pass "Fixed: Seeded execution policy into parent workspace: $PARENT_POLICY"
        else
            log_fail "Could not seed execution policy into parent workspace: ${policy_result:-unknown error}"
        fi
    fi
fi

# ─── Check 6: Memory Session Status ───────────────────────────────────────────

if [[ "$QUICK_MODE" == "false" ]]; then
    log_header "Memory Session Status"

    if [[ -f "$MEMORY_SESSION" ]]; then
        # Run status check
        status_output=$("$MEMORY_SESSION" status 2>&1) || true

        if [[ -n "$status_output" ]]; then
            log_info "Session status:"
            echo "$status_output" | while IFS= read -r line; do
                log_info "  $line"
            done
        else
            log_warn "Could not get session status"
        fi
    fi

    # ─── Check 6: Disk Space ──────────────────────────────────────────────────

    log_header "Disk Space"

    session_size=$(du -sh "$MEMORY_DB_DIR" 2>/dev/null | cut -f1 || echo "unknown")
    log_info "Memory database size: $session_size"

    # Check available disk space
    available=$(df -h "$HOME" 2>/dev/null | tail -1 | awk '{print $4}')
    log_info "Available disk space: $available"

    # ─── Check 7: Hook Initialization State ────────────────────────────────────

    log_header "Hook Initialization"

    init_file="${HOME}/.forgewright/hooks-initialized-standard"
    if [[ -f "$init_file" ]]; then
        log_pass "Hooks initialized (standard profile)"
        log_info "  Last init: $(stat -f "%Sm" "$init_file" 2>/dev/null || stat -c "%y" "$init_file" 2>/dev/null || echo "unknown")"
    else
        log_warn "Hooks not yet initialized (first run after config)"
    fi
fi

# ─── Check 8: Profile Validation ─────────────────────────────────────────────

log_header "Profile Validation"

get_profile_hooks() {
    local profile="$1"
    case "$profile" in
        minimal) echo "tick" ;;
        standard) echo "tick checkpoint status" ;;
        strict) echo "tick checkpoint status verbose token_warn" ;;
        *) echo "" ;;
    esac
}

current_profile="${FORGEWRIGHT_HOOK_PROFILE:-standard}"
profile_hooks=$(get_profile_hooks "$current_profile")

if [[ -n "$profile_hooks" ]]; then
    log_pass "Profile '$current_profile' is valid"
    log_info "  Enabled hooks: $profile_hooks"
else
    log_fail "Profile '$current_profile' is invalid"
    log_info "  Valid profiles: minimal standard strict"
fi

# ─── Check 9: Quick Syntax Check ─────────────────────────────────────────────

if [[ "$QUICK_MODE" == "false" ]]; then
    log_header "Script Syntax"

    if bash -n "$HOOK_SCRIPT" 2>/dev/null; then
        log_pass "Hook script syntax is valid"
    else
        log_fail "Hook script has syntax errors"
    fi

    if bash -n "$MEMORY_SESSION" 2>/dev/null; then
        log_pass "Memory session script syntax is valid"
    else
        log_fail "Memory session script has syntax errors"
    fi
fi

# ─── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${CYAN}Summary${NC}"

total=$((PASS + FAIL + WARN))
echo "  Total checks: $total"
echo -e "  ${GREEN}Passed${NC}: $PASS"
echo -e "  ${RED}Failed${NC}: $FAIL"
echo -e "  ${YELLOW}Warnings${NC}: $WARN"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}⚠️  Some checks failed. Run with --fix to attempt auto-repair.${NC}"
    exit 1
elif [[ $WARN -gt 0 ]]; then
    echo -e "${YELLOW}⚠️  Some warnings - review above.${NC}"
    exit 0
else
    echo -e "${GREEN}✓ All checks passed! Hooks are healthy.${NC}"
    exit 0
fi
