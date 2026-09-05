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
FRAMEWORK_DIR="${FORGEWRIGHT_DIR:-${HOME}/.forgewright}"
RULE_CONTEXT_HOOK="${FRAMEWORK_DIR}/scripts/lite/rule-context-hook.py"
RULE_CONTEXT_WINDOWS_HOOK="${FRAMEWORK_DIR}/scripts/lite/codex-hook-windows.ps1"
RULE_CONTEXT_MANIFEST="${FRAMEWORK_DIR}/kernel/rule-manifest.json"
SOURCE_ROOT="${FORGEWRIGHT_SOURCE_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
RULE_CONTEXT_RUNTIME_READY=false
WINDOWS_NATIVE_HOOKS=false
case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) WINDOWS_NATIVE_HOOKS=true ;;
esac
STOP_RUNTIME_FILES=(stop-gate.sh stop_gate.py continuity_check.py evidence_common.py windows_secure_io.py verify_gate.py)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASS=0 FAIL=0 WARN=0
PYTHON_BIN=""
PYTHON_SELECTOR=""

resolve_python311() {
    local candidate resolved selector
    if [[ -n "${FORGEWRIGHT_PYTHON_BIN:-}" && -x "${FORGEWRIGHT_PYTHON_BIN}" ]]; then
        if "${FORGEWRIGHT_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            PYTHON_BIN="${FORGEWRIGHT_PYTHON_BIN}"
            return 0
        fi
    fi
    for candidate in python3.13 python3.12 python3.11 python3 python; do
        resolved="$(command -v "$candidate" 2>/dev/null || true)"
        [[ -n "$resolved" ]] || continue
        if "$resolved" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            PYTHON_BIN="$resolved"
            return 0
        fi
    done
    resolved="$(command -v py.exe 2>/dev/null || command -v py 2>/dev/null || true)"
    if [[ -n "$resolved" ]]; then
        for selector in -3.13 -3.12 -3.11 -3; do
            if "$resolved" "$selector" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
                PYTHON_BIN="$resolved"
                PYTHON_SELECTOR="$selector"
                return 0
            fi
        done
    fi
    return 1
}

run_python() {
    [[ -n "$PYTHON_BIN" ]] || return 127
    if [[ -n "$PYTHON_SELECTOR" ]]; then
        "$PYTHON_BIN" "$PYTHON_SELECTOR" "$@"
    else
        "$PYTHON_BIN" "$@"
    fi
}

resolve_python311 || true

# ─── Logging Functions ────────────────────────────────────────────────────────

log_pass() { echo -e "${GREEN}  ✓${NC} $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}  ✗${NC} $1"; FAIL=$((FAIL + 1)); }
log_warn() { echo -e "${YELLOW}  ⚠${NC} $1"; WARN=$((WARN + 1)); }
log_info() { echo -e "  $1"; }
log_header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

shell_quote() {
    local value="$1"
    # Use the portable shell literal form '"'"' for embedded apostrophes.
    # Backslash escaping does not work inside single-quoted shell strings.
    value="$(printf '%s' "$value" | sed "s/'/'\\\"'\\\"'/g")"
    printf "'%s'" "$value"
}

atomic_write_text() {
    local target="$1"
    local content
    target="$(host_path "$target")" || return 1
    content="$(cat)"
    ATOMIC_CONTENT="$content" node - "$target" <<'NODE'
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
const content = process.env.ATOMIC_CONTENT || '';
const directory = path.dirname(target);
const basename = path.basename(target);
const temporary = path.join(directory, '.' + basename + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp');
let mode = 0o600;
try { mode = fs.statSync(target).mode; } catch (_) {}
let fd;
try {
  fd = fs.openSync(temporary, 'wx', mode);
  fs.writeSync(fd, content.endsWith('\n') ? content : content + '\n', null, 'utf8');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fd = undefined;
  fs.renameSync(temporary, target);
  if (process.platform !== 'win32') {
    let directoryFd;
    try {
      directoryFd = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryFd);
    } finally {
      if (directoryFd !== undefined) fs.closeSync(directoryFd);
    }
  }
} catch (error) {
  if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  try { fs.unlinkSync(temporary); } catch (_) {}
  throw error;
}
NODE
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
    source="$(host_path "$source")" || return 1
    target="$(host_path "$target")" || return 1
    SOURCE_FILE="$source" TARGET_FILE="$target" node <<'NODE'
const fs = require('fs');
const path = require('path');
const source = process.env.SOURCE_FILE;
const target = process.env.TARGET_FILE;
const directory = path.dirname(target);
fs.mkdirSync(directory, {recursive: true});
const temporary = path.join(directory, '.' + path.basename(target) + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp');
const mode = fs.statSync(source).mode;
let fd;
try {
  fd = fs.openSync(temporary, 'wx', mode);
  fs.writeFileSync(fd, fs.readFileSync(source));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fd = undefined;
  fs.renameSync(temporary, target);
  if (process.platform !== 'win32') {
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  }
} catch (error) {
  if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  try { fs.unlinkSync(temporary); } catch (_) {}
  throw error;
}
NODE
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
                return 1
            fi
            bash_executable="$(host_path "$bash_executable")"
            gate_native="$(host_path "$gate_script")"
            [[ "$bash_executable" != *\"* && "$gate_native" != *\"* && "$bash_executable" != *%* && "$gate_native" != *%* ]] || return 1
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
            adapter_native="$(host_path "$adapter_script")" || return 1
            CODEX_WINDOWS_ADAPTER="$adapter_native" CODEX_EVENT_NAME="$event_name" run_python - <<'PYEOF'
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

stop_runtime_is_current() {
    local runtime_file
    for runtime_file in "${STOP_RUNTIME_FILES[@]}"; do
        [[ -f "${SOURCE_ROOT}/scripts/lite/${runtime_file}" ]] || return 1
        [[ -f "${FRAMEWORK_DIR}/scripts/lite/${runtime_file}" ]] || return 1
        cmp -s "${SOURCE_ROOT}/scripts/lite/${runtime_file}" "${FRAMEWORK_DIR}/scripts/lite/${runtime_file}" || return 1
    done
    [[ -x "${FRAMEWORK_DIR}/scripts/lite/stop-gate.sh" ]]
}

repair_stop_runtime() {
    local target_runtime="${FRAMEWORK_DIR}/scripts/lite"
    local runtime_file
    for runtime_file in "${STOP_RUNTIME_FILES[@]}"; do
        if [[ ! -f "${SOURCE_ROOT}/scripts/lite/${runtime_file}" ]]; then
            log_warn "Stop runtime repair source is missing: ${runtime_file}"
            return 1
        fi
    done
    mkdir -p "$target_runtime"
    for runtime_file in "${STOP_RUNTIME_FILES[@]}"; do
        atomic_copy_file "${SOURCE_ROOT}/scripts/lite/${runtime_file}" "${target_runtime}/${runtime_file}" || return 1
    done
    chmod +x "${target_runtime}/stop-gate.sh" || return 1
    stop_runtime_is_current || return 1
    log_pass "Stop runtime dependency closure repaired in framework install"
}

stop_runtime_smoke() {
    local command="$1"
    [[ -n "$PYTHON_BIN" ]] || return 1
    CODEX_STOP_COMMAND="$command" run_python - <<'PYEOF'
import json
import os
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix="forgewright-stop-smoke-") as workspace:
    environment = dict(os.environ)
    environment["FORGEWRIGHT_WORKSPACE"] = workspace
    environment["FORGEWRIGHT_STOP_VALIDATION_TIMEOUT"] = "10"
    # uv can inject its own PYTHONHOME, but the installed hook re-resolves
    # python3; leaking a different runtime home causes an SRE mismatch on Windows.
    environment.pop("PYTHONHOME", None)
    result = subprocess.run(
        os.environ["CODEX_STOP_COMMAND"],
        cwd=workspace,
        input="{}",
        text=True,
        capture_output=True,
        shell=True,
        env=environment,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        print(
            f"[STOP-RUNTIME] smoke exit={result.returncode}: {result.stderr[:512]}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    try:
        payload = json.loads(result.stdout)
    except (TypeError, ValueError, json.JSONDecodeError):
        print(
            f"[STOP-RUNTIME] smoke returned invalid JSON: {result.stdout[:512]}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    expected = {
        "continue": True,
        "forgewright": {
            "schema": "forgewright-stop-decision/v1",
            "host_action": "allow_stop",
            "completion_state": "verified",
            "retry_suppressed": False,
            "reason_code": "no_code_changes",
        },
    }
    if payload != expected:
        print("[STOP-RUNTIME] smoke returned an unexpected Stop decision", file=sys.stderr)
        raise SystemExit(1)
PYEOF
}

rule_context_command() {
    local platform="$1"
    local event="$2"
    local python_executable="$PYTHON_BIN"
    local python_selector="$PYTHON_SELECTOR"
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
        "$(shell_quote "$resolver")" "$(shell_quote "$RULE_CONTEXT_HOOK")" "$(shell_quote "$FRAMEWORK_DIR")" "$platform" "$event" \
        "$(shell_quote "$python_executable")" "$(shell_quote "$python_selector")"
}

repair_rule_context_runtime() {
    local source_hook="${SOURCE_ROOT}/scripts/lite/rule-context-hook.py"
    local source_windows_hook="${SOURCE_ROOT}/scripts/lite/codex-hook-windows.ps1"
    local source_manifest="${SOURCE_ROOT}/kernel/rule-manifest.json"
    local target_kernel="${FRAMEWORK_DIR}/kernel"
    local target_runtime="${FRAMEWORK_DIR}/scripts/lite"

    if [[ ! -f "$source_hook" || ! -f "$source_windows_hook" || ! -f "$source_manifest" ]]; then
        log_warn "Rule context repair source is unavailable under $SOURCE_ROOT"
        return 1
    fi
    local source_manifest_host source_root_host framework_dir_host
    source_manifest_host="$(host_path "$source_manifest")" || return 1
    source_root_host="$(host_path "$SOURCE_ROOT")" || return 1
    framework_dir_host="$(host_path "$FRAMEWORK_DIR")" || return 1
    if ! run_python - "$source_manifest_host" "$source_root_host" "$framework_dir_host" <<'PYEOF'
import json
import shutil
import sys
from pathlib import Path
from pathlib import PureWindowsPath

manifest_path, source_root, target_root = map(Path, sys.argv[1:])
payload = json.loads(manifest_path.read_text(encoding="utf-8"))
source_root = source_root.resolve()
target_root = target_root.resolve()
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
        log_warn "Rule context manifest validation/source copy failed; lifecycle hooks were not marked repaired"
        return 1
    fi
    if ! mkdir -p "$target_runtime" "$target_kernel" \
        || ! cp "$source_hook" "$target_runtime/rule-context-hook.py" \
        || ! cp "$source_windows_hook" "$target_runtime/codex-hook-windows.ps1" \
        || ! cp "$source_manifest" "$target_kernel/rule-manifest.json" \
        || ! chmod +x "$target_runtime/rule-context-hook.py"; then
        log_warn "Rule context runtime copy failed; lifecycle hooks were not marked repaired"
        return 1
    fi
    RULE_CONTEXT_RUNTIME_READY=true
    log_pass "Rule context runtime repaired in framework install"
    return 0
}

rule_context_windows_runtime_current() {
    [[ "$WINDOWS_NATIVE_HOOKS" == "true" ]] || return 0
    local source_windows_hook="${SOURCE_ROOT}/scripts/lite/codex-hook-windows.ps1"
    [[ -f "$source_windows_hook" && -f "$RULE_CONTEXT_WINDOWS_HOOK" ]] || return 1
    cmp -s "$source_windows_hook" "$RULE_CONTEXT_WINDOWS_HOOK"
}

rule_context_doctor_json() {
    local platform="$1"
    local file="$2"
    local command="$3"
    local auto_fix="$4"
    local command2="${5:-$command}"
    local result
    file="$(host_path "$file")" || return 1
    if result="$(RULE_CONTEXT_COMMAND="$command" RULE_CONTEXT_COMMAND_2="$command2" FORGEWRIGHT_DIR="$FRAMEWORK_DIR" node - "$platform" "$file" "$auto_fix" <<'NODE'
const fs = require('fs');
const path = require('path');
const platform = process.argv[2];
const file = process.argv[3];
const shouldFix = process.argv[4] === 'true';
const command = process.env.RULE_CONTEXT_COMMAND;
const command2 = process.env.RULE_CONTEXT_COMMAND_2 || command;
function commandFor(event) { return event === 'SubagentStart' ? command2 : command; }
function atomicWrite(file, content) {
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.tmp');
  let mode = 0o600;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  let fd;
  try {
    fd = fs.openSync(temporary, 'w', mode);
    fs.writeSync(fd, content, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}

const specs = {
  CLAUDE: [
    ['SessionStart', 'startup|resume|clear|compact', 2],
    ['SubagentStart', '*', 2]
  ],
  GEMINI: [['BeforeAgent', '*', 2000]],
  ANTIGRAVITY: [['PreInvocation', null, 2]],
  CURSOR: [['sessionStart', null, 2000]]
};
const desired = specs[platform];
if (!desired || !command) process.exit(2);

function ownedContextCommand(candidate, event) {
  if (candidate === commandFor(event)) return true;
  if (typeof candidate !== 'string' || candidate.indexOf('FORGEWRIGHT_RULE_HOOK_MODE=') !== 0 || candidate.indexOf('hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4";') === -1) return false;
  const marker = " -- '";
  const markerStart = candidate.lastIndexOf(marker);
  const tail = markerStart >= 0 ? candidate.slice(markerStart + marker.length) : "";
  const pathEnd = tail.indexOf("' '");
  if (pathEnd < 0 || !tail.endsWith(" || true")) return false;
  const normalized = path.resolve(tail.slice(0, pathEnd).replace(/\\/g, '/'));
  const framework = path.resolve(process.env.FORGEWRIGHT_DIR);
  return normalized === path.join(framework, 'rule-context-hook.py') ||
    normalized === path.join(framework, 'scripts', 'rule-context-hook.py');
}

function isContextHook(h, event) {
  return h && ownedContextCommand(h.command, event);
}

function valid(h, event, timeout) {
  return isContextHook(h, event) && h.command === commandFor(event) &&
    h.type === 'command' && (timeout === null ? h.timeout === undefined : h.timeout === timeout);
}
function mergeGroups(groups, event, matcher, timeout) {
  groups = Array.isArray(groups) ? groups : [];
  let found = false;
  let healthy = false;
  groups = groups.map(function(group) {
    if (!Array.isArray(group && group.hooks)) return group;
    const hooks = group.hooks.filter(function(hook) {
      if (!isContextHook(hook, event)) return true;
      if (!found && valid(hook, event, timeout)) {
        found = true;
        healthy = true;
        return true;
      }
      return false;
    }).map(function(hook) {
      return hook && hook.command === commandFor(event) ? Object.assign({}, hook, { type: 'command', timeout: timeout }) : hook;
    });
    return Object.assign({}, group, { hooks: hooks });
  }).filter(function(group) { return !Array.isArray(group.hooks) || group.hooks.length > 0; });
  if (!found && shouldFix) groups.push({ matcher: matcher, hooks: [{ type: 'command', command: commandFor(event), timeout: timeout }] });
  return { groups: groups, ok: healthy || found };
}
function mergeDirect(entries, event, timeout) {
  entries = Array.isArray(entries) ? entries : [];
  let found = false;
  let healthy = false;
  entries = entries.filter(function(hook) {
    if (!isContextHook(hook, event)) return true;
    if (!found && valid(hook, event, timeout)) {
      found = true;
      healthy = true;
      return true;
    }
    return false;
  });
  if (!found && shouldFix) {
    const hook = { type: 'command', command: commandFor(event) };
    if (timeout !== null) hook.timeout = timeout;
    entries.push(hook);
  }
  return { entries: entries, ok: healthy || found };
}

if (!fs.existsSync(file)) {
  if (!shouldFix) { console.log('missing'); process.exit(0); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
}
let cfg = {};
try {
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (_) {
  console.log('invalid-json');
  process.exit(2);
}
if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') {
  console.log('invalid-config');
  process.exit(2);
}

let ok = true;
if (platform === 'ANTIGRAVITY') {
  const policy = cfg['forgewright-policy'] && typeof cfg['forgewright-policy'] === 'object' && !Array.isArray(cfg['forgewright-policy']) ? cfg['forgewright-policy'] : {};
  const merged = mergeDirect(policy.PreInvocation, 'PreInvocation', 2);
  ok = merged.ok;
  if (shouldFix) {
    policy.PreInvocation = merged.entries;
    cfg['forgewright-policy'] = policy;
  }
} else if (platform === 'CURSOR') {
  cfg.hooks = cfg.hooks && typeof cfg.hooks === 'object' && !Array.isArray(cfg.hooks) ? cfg.hooks : {};
  const merged = mergeDirect(cfg.hooks.sessionStart, 'sessionStart', null);
  ok = merged.ok;
  if (shouldFix) cfg.hooks.sessionStart = merged.entries;
} else {
  cfg.hooks = cfg.hooks && typeof cfg.hooks === 'object' && !Array.isArray(cfg.hooks) ? cfg.hooks : {};
  for (const [event, matcher, timeout] of desired) {
    const merged = mergeGroups(cfg.hooks[event], event, matcher, timeout);
    ok = merged.ok && ok;
    if (shouldFix) cfg.hooks[event] = merged.groups;
  }
}
if (shouldFix && !ok) {
  atomicWrite(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log('fixed');
} else {
  console.log(ok ? 'ok' : 'missing');
}
NODE
)"; then
        case "$result" in
            ok) log_pass "$platform rule-context lifecycle hooks are valid" ;;
            missing) log_warn "$platform rule-context lifecycle hook is missing or invalid" ;;
            fixed) log_pass "$platform rule-context lifecycle hook repaired (unrelated hooks preserved)" ;;
            *) log_warn "$platform rule-context lifecycle check returned: $result" ;;
        esac
    else
        log_warn "$platform rule-context lifecycle configuration is not valid JSON"
    fi
}

rule_context_doctor_codex() {
    local file="$1"
    local session_command="$2"
    local subagent_command="$3"
    local session_windows_command="$4"
    local subagent_windows_command="$5"
    local auto_fix="$6"
    local result
    file="$(host_path "$file")" || return 1
    if result="$(CONTEXT_SESSION_CMD="$session_command" CONTEXT_SUBAGENT_CMD="$subagent_command" CONTEXT_SESSION_WINDOWS_CMD="$session_windows_command" CONTEXT_SUBAGENT_WINDOWS_CMD="$subagent_windows_command" FORGEWRIGHT_DIR="$FRAMEWORK_DIR" run_python - "$file" "$auto_fix" <<'PYEOF'
import json
import os
import posixpath
import re
import shlex
import sys
import tempfile
import tomllib
from pathlib import Path

path = Path(sys.argv[1])
should_fix = sys.argv[2] == "true"
commands = {
    "SessionStart": (
        os.environ["CONTEXT_SESSION_CMD"],
        os.environ["CONTEXT_SESSION_WINDOWS_CMD"],
    ),
    "SubagentStart": (
        os.environ["CONTEXT_SUBAGENT_CMD"],
        os.environ["CONTEXT_SUBAGENT_WINDOWS_CMD"],
    ),
}
text = path.read_text(encoding="utf-8") if path.exists() else ""

def owned_context_command(candidate: str, expected: str) -> bool:
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
    def normalized_hook_path(value: str) -> str:
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

def healthy(event, command, windows_command):
    try:
        config = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return False
    groups = config.get("hooks", {}).get(event, [])
    if not isinstance(groups, list):
        return False
    expected_matcher = "startup|resume|clear|compact" if event == "SessionStart" else "*"
    owned_count = 0
    exact_count = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
            continue
        for hook in group["hooks"]:
            if not isinstance(hook, dict) or not owned_context_command(
                hook.get("command", ""), command
            ):
                continue
            owned_count += 1
            windows_matches = not windows_command or hook.get("command_windows") == windows_command
            if (
                group.get("matcher") == expected_matcher
                and hook.get("type") == "command"
                and hook.get("command") == command
                and windows_matches
                and hook.get("timeout") == 2
            ):
                exact_count += 1
    return owned_count == 1 and exact_count == 1

def remove_context_blocks(value, event):
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
        segments = []
        for offset, start in enumerate(starts):
            stop = starts[offset + 1] if offset + 1 < len(starts) else len(chunk)
            block = "".join(chunk[start:stop])
            command_match = re.search(r'command\s*=\s*("(?:\\.|[^"\\])*")', block)
            candidate = json.loads(command_match.group(1)) if command_match else ""
            owned = bool(command_match and owned_context_command(candidate, command))
            segments.append((start, stop, owned))
        if not any(flag for _, _, flag in segments):
            output.extend(chunk)
        else:
            first_nested = starts[0]
            kept = [chunk[start:stop] for start, stop, flag in segments if not flag]
            if kept:
                output.extend(chunk[:first_nested])
                for segment in kept:
                    output.extend(segment)
        index = end
    return "".join(output)

ok = all(
    healthy(event, command, windows_command)
    for event, (command, windows_command) in commands.items()
)
if should_fix and not ok:
    if not text:
        text = "[features]\nhooks = true\n\n[hooks]\n"
    elif "[hooks]" not in text:
        text += "\n[hooks]\n"
    for event, (command, windows_command) in commands.items():
        if healthy(event, command, windows_command):
            continue
        text = remove_context_blocks(text, event)
        if not text.endswith("\n"):
            text += "\n"
        text += (
            f"\n[[hooks.{event}]]\n"
            f"matcher = {json.dumps('startup|resume|clear|compact' if event == 'SessionStart' else '*')}\n"
            f"[[hooks.{event}.hooks]]\n"
            "type = \"command\"\n"
            f"command = {json.dumps(command)}\n"
        )
        if windows_command:
            text += f"command_windows = {json.dumps(windows_command)}\n"
        text += "timeout = 2\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.chmod(temporary, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text if text.endswith("\n") else text + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    print("fixed")
else:
    print("ok" if ok else "missing")
PYEOF
)"; then
        case "$result" in
            ok) log_pass "CODEX rule-context lifecycle hooks are valid" ;;
            missing) log_warn "CODEX rule-context lifecycle hook is missing or invalid" ;;
            fixed) log_pass "CODEX rule-context lifecycle hooks repaired (unrelated hooks preserved)" ;;
            *) log_warn "CODEX rule-context lifecycle check returned: $result" ;;
        esac
    else
        log_warn "CODEX rule-context lifecycle configuration is not valid TOML"
    fi
}

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

# Rule context lifecycle distribution is deliberately separate from Stop and
# security policy hooks.  Diagnosis only inspects the exact Forgewright entry;
# --fix adds/replaces that entry while retaining every unrelated user hook.
log_header "Rule Context Lifecycle"
if [[ "$AUTO_FIX" == "true" ]] && { [[ ! -f "$RULE_CONTEXT_HOOK" || ! -f "$RULE_CONTEXT_MANIFEST" ]] || ! rule_context_windows_runtime_current; }; then
    repair_rule_context_runtime || true
fi
if [[ -f "$RULE_CONTEXT_HOOK" ]]; then
    log_pass "Rule context hook exists: $RULE_CONTEXT_HOOK"
else
    log_warn "Rule context hook missing: $RULE_CONTEXT_HOOK"
fi
if [[ -f "$RULE_CONTEXT_MANIFEST" ]]; then
    log_pass "Rule context manifest exists: $RULE_CONTEXT_MANIFEST"
else
    log_warn "Rule context manifest missing: $RULE_CONTEXT_MANIFEST"
fi
if [[ "$WINDOWS_NATIVE_HOOKS" == "true" ]]; then
    if rule_context_windows_runtime_current; then
        log_pass "Codex Windows lifecycle hook is current: $RULE_CONTEXT_WINDOWS_HOOK"
    else
        log_warn "Codex Windows lifecycle hook missing or stale: $RULE_CONTEXT_WINDOWS_HOOK"
    fi
fi

if [[ ! -f "$RULE_CONTEXT_HOOK" || ! -f "$RULE_CONTEXT_MANIFEST" ]] || ! rule_context_windows_runtime_current; then
    log_warn "Rule context lifecycle repair skipped because framework runtime is incomplete"
else
    RULE_CONTEXT_RUNTIME_READY=true
fi

if [[ "$RULE_CONTEXT_RUNTIME_READY" == "true" ]]; then
    CODEX_SESSION_WINDOWS_COMMAND="$(codex_lifecycle_windows_command "${FRAMEWORK_DIR}/scripts/lite/codex-hook-windows.ps1" SessionStart || true)"
    CODEX_SUBAGENT_WINDOWS_COMMAND="$(codex_lifecycle_windows_command "${FRAMEWORK_DIR}/scripts/lite/codex-hook-windows.ps1" SubagentStart || true)"
    rule_context_doctor_json CLAUDE "${HOME}/.claude/settings.json" \
        "$(rule_context_command CLAUDE SessionStart)" "$AUTO_FIX" \
        "$(rule_context_command CLAUDE SubagentStart)"
    rule_context_doctor_json GEMINI "${HOME}/.gemini/settings.json" \
        "$(rule_context_command GEMINI BeforeAgent)" "$AUTO_FIX"
    rule_context_doctor_json ANTIGRAVITY "${HOME}/.gemini/config/hooks.json" \
        "$(rule_context_command ANTIGRAVITY PreInvocation)" "$AUTO_FIX"
    rule_context_doctor_json CURSOR "${HOME}/.cursor/hooks.json" \
        "$(rule_context_command CURSOR sessionStart)" "$AUTO_FIX"
    rule_context_doctor_codex "${HOME}/.codex/config.toml" \
        "$(rule_context_command CODEX SessionStart)" \
        "$(rule_context_command CODEX SubagentStart)" \
        "$CODEX_SESSION_WINDOWS_COMMAND" "$CODEX_SUBAGENT_WINDOWS_COMMAND" "$AUTO_FIX"
fi

# Determine project root path
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GATE_SCRIPT="${PROJECT_ROOT}/scripts/lite/stop-gate.sh"
FRAMEWORK_GATE="${FRAMEWORK_DIR}/scripts/lite/stop-gate.sh"
CLAUDE_PROJECT_STOP_CMD="bash $(shell_quote "$GATE_SCRIPT") --platform CLAUDE"
CLAUDE_FRAMEWORK_STOP_CMD="bash $(shell_quote "$FRAMEWORK_GATE") --platform CLAUDE"
GEMINI_PROJECT_STOP_CMD="bash $(shell_quote "$GATE_SCRIPT") --platform GEMINI"
GEMINI_FRAMEWORK_STOP_CMD="bash $(shell_quote "$FRAMEWORK_GATE") --platform GEMINI"
GEMINI_PROJECT_BEFORE_CMD="bash $(shell_quote "$PROJECT_ROOT/scripts/lite/gemini-before-tool-gate.sh")"
GEMINI_FRAMEWORK_BEFORE_CMD="bash $(shell_quote "$FRAMEWORK_DIR/scripts/lite/gemini-before-tool-gate.sh")"
CURSOR_PROJECT_STOP_CMD="bash $(shell_quote "$GATE_SCRIPT") --platform CURSOR"
CURSOR_FRAMEWORK_STOP_CMD="bash $(shell_quote "$FRAMEWORK_GATE") --platform CURSOR"
CODEX_STOP_COMMAND="$(codex_stop_command "$FRAMEWORK_GATE" || true)"

log_header "Installed Stop Runtime"
if ! stop_runtime_is_current && [[ "$AUTO_FIX" == "true" ]]; then
    repair_stop_runtime || log_warn "Stop runtime dependency closure could not be repaired"
fi
if stop_runtime_is_current; then
    log_pass "Stop runtime dependency closure is current"
    if [[ -n "$CODEX_STOP_COMMAND" ]] && stop_runtime_smoke "$CODEX_STOP_COMMAND"; then
        log_pass "Installed Stop runtime smoke passed"
    else
        log_warn "Installed Stop runtime smoke failed"
    fi
else
    log_warn "Stop runtime dependency closure is missing or stale"
fi

# 1. Claude Code Hook Configuration
CLAUDE_SETTINGS="$(host_path "${HOME}/.claude/settings.json")"
if [[ -f "$CLAUDE_SETTINGS" ]]; then
    log_pass "Claude Code settings file exists"
    claude_schema=$(CONFIG_FILE="$CLAUDE_SETTINGS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$CLAUDE_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$CLAUDE_FRAMEWORK_STOP_CMD" node -e "try { var fs=require('fs'), c=JSON.parse(fs.readFileSync(process.env.CONFIG_FILE)); var expected=[process.env.PROJECT_STOP_CMD,process.env.FRAMEWORK_STOP_CMD,'bash '+process.env.GATE_SCRIPT+' --platform CLAUDE','bash '+process.env.FRAMEWORK_GATE+' --platform CLAUDE']; function current(h){ return Boolean(h && h.type === 'command' && typeof h.command === 'string' && expected.includes(h.command)); } var ok=c.hooks && !('stop' in c.hooks) && Array.isArray(c.hooks.Stop) && c.hooks.Stop.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(current); }); console.log(Boolean(ok)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$claude_schema" == "true" ]]; then
        log_pass "Claude Stop hook uses the native matcher-group schema"
    else
        log_warn "Claude Stop hook schema is invalid or stop-gate.sh is missing"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
            CONFIG_FILE="$CLAUDE_SETTINGS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$CLAUDE_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$CLAUDE_FRAMEWORK_STOP_CMD" node -e "
var fs = require('fs');
var path = require('path');
function atomicWrite(file, content) {
  var temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  var fd;
  try { fd = fs.openSync(temporary, 'w', mode); fs.writeSync(fd, content, null, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, file); }
  catch (error) { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} } try { fs.unlinkSync(temporary); } catch (_) {} throw error; }
}
var cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
delete cfg.hooks.stop;
function gatePath(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\\s+([^\\s]+)\\s+--platform\\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[2] !== platform) return null;
  return match[1];
}
var currentCommands = [process.env.PROJECT_STOP_CMD, process.env.FRAMEWORK_STOP_CMD, 'bash ' + process.env.GATE_SCRIPT + ' --platform CLAUDE', 'bash ' + process.env.FRAMEWORK_GATE + ' --platform CLAUDE'];
function currentGate(command) { return currentCommands.includes(command); }
function legacyGate(command, platform) {
  var script = gatePath(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  var normalized = path.resolve(script);
  var framework = path.resolve(process.env.FRAMEWORK_GATE, '..', '..', '..');
  return normalized === path.join(framework, 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'lite', 'verify-gate.sh');
}
var Stop = Array.isArray(cfg.hooks.Stop) ? cfg.hooks.Stop : [];
Stop = Stop.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !legacyGate(h && h.command, 'CLAUDE'); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = Stop.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return currentGate(h && h.command); }); });
if (!already) Stop.push({ hooks: [{ type: 'command', command: process.env.PROJECT_STOP_CMD }] });
cfg.hooks.Stop = Stop;
atomicWrite(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Installed native Claude Stop hook schema"
        fi
    fi
else
    log_warn "Claude Code settings file not found: $CLAUDE_SETTINGS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
        atomic_write_text "$CLAUDE_SETTINGS" <<EOF
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
GEMINI_SETTINGS="$(host_path "${HOME}/.gemini/settings.json")"
if [[ -f "$GEMINI_SETTINGS" ]]; then
    log_pass "Gemini settings file exists"
    gemini_schema=$(CONFIG_FILE="$GEMINI_SETTINGS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$GEMINI_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$GEMINI_FRAMEWORK_STOP_CMD" PROJECT_BEFORE_CMD="$GEMINI_PROJECT_BEFORE_CMD" FRAMEWORK_BEFORE_CMD="$GEMINI_FRAMEWORK_BEFORE_CMD" FRAMEWORK_BEFORE_GATE="$FRAMEWORK_DIR/scripts/lite/gemini-before-tool-gate.sh" PROJECT_BEFORE_GATE="$PROJECT_ROOT/scripts/lite/gemini-before-tool-gate.sh" node -e "try { var fs=require('fs'), c=JSON.parse(fs.readFileSync(process.env.CONFIG_FILE)); var stopCommands=[process.env.PROJECT_STOP_CMD,process.env.FRAMEWORK_STOP_CMD,'bash '+process.env.GATE_SCRIPT+' --platform GEMINI','bash '+process.env.FRAMEWORK_GATE+' --platform GEMINI']; var beforeCommands=[process.env.PROJECT_BEFORE_CMD,process.env.FRAMEWORK_BEFORE_CMD,'bash '+process.env.PROJECT_BEFORE_GATE,'bash '+process.env.FRAMEWORK_BEFORE_GATE]; function gate(h){ return Boolean(h && h.type === 'command' && typeof h.command === 'string' && stopCommands.includes(h.command)); } function before(h){ return Boolean(h && h.name === 'forgewright-policy' && h.type === 'command' && typeof h.command === 'string' && typeof h.timeout === 'number' && beforeCommands.includes(h.command)); } var afterOk=c.hooks && Array.isArray(c.hooks.AfterAgent) && c.hooks.AfterAgent.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(gate); }); var beforeOk=c.hooks && Array.isArray(c.hooks.BeforeTool) && c.hooks.BeforeTool.some(function(g){ return g.matcher === '*' && Array.isArray(g.hooks) && g.hooks.some(before); }); console.log(Boolean(afterOk && beforeOk)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$gemini_schema" == "true" ]]; then
        log_pass "Gemini BeforeTool and AfterAgent hooks use native schemas"
    else
        log_warn "Gemini BeforeTool or AfterAgent hook is not configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$GEMINI_SETTINGS" "${GEMINI_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
            CONFIG_FILE="$GEMINI_SETTINGS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$GEMINI_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$GEMINI_FRAMEWORK_STOP_CMD" PROJECT_BEFORE_CMD="$GEMINI_PROJECT_BEFORE_CMD" FRAMEWORK_BEFORE_CMD="$GEMINI_FRAMEWORK_BEFORE_CMD" FRAMEWORK_BEFORE_GATE="$FRAMEWORK_DIR/scripts/lite/gemini-before-tool-gate.sh" PROJECT_BEFORE_GATE="$PROJECT_ROOT/scripts/lite/gemini-before-tool-gate.sh" node -e "
var fs = require('fs');
var path = require('path');
function atomicWrite(file, content) {
  var temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  var fd;
  try { fd = fs.openSync(temporary, 'w', mode); fs.writeSync(fd, content, null, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, file); }
  catch (error) { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} } try { fs.unlinkSync(temporary); } catch (_) {} throw error; }
}
var cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
function gatePath(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\\s+([^\\s]+)\\s+--platform\\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[2] !== platform) return null;
  return match[1];
}
var currentCommands = [process.env.PROJECT_STOP_CMD, process.env.FRAMEWORK_STOP_CMD, 'bash ' + process.env.GATE_SCRIPT + ' --platform GEMINI', 'bash ' + process.env.FRAMEWORK_GATE + ' --platform GEMINI'];
function currentGate(command) { return currentCommands.includes(command); }
function legacyGate(command, platform) {
  var script = gatePath(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  var normalized = path.resolve(script);
  var framework = path.resolve(process.env.FRAMEWORK_GATE, '..', '..', '..');
  return normalized === path.join(framework, 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'lite', 'verify-gate.sh');
}
if (Array.isArray(cfg.hooks.AfterAgent) && cfg.hooks.AfterAgent.length > 0 && typeof cfg.hooks.AfterAgent[0] === 'string') cfg.hooks.AfterAgent = [];
var AA = Array.isArray(cfg.hooks.AfterAgent) ? cfg.hooks.AfterAgent : [];
AA = AA.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !legacyGate(h && h.command, 'GEMINI'); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
var already = AA.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return currentGate(h && h.command); }); });
if (!already) AA.push({ matcher: '*', hooks: [{ type: 'command', command: process.env.PROJECT_STOP_CMD }] });
cfg.hooks.AfterAgent = AA;
var BT = Array.isArray(cfg.hooks.BeforeTool) ? cfg.hooks.BeforeTool : [];
BT = BT.map(function(g){
  if (!Array.isArray(g.hooks)) return g;
  return Object.assign({}, g, { hooks: g.hooks.filter(function(h){ return !h || typeof h.command !== 'string' || ![process.env.FRAMEWORK_BEFORE_CMD, process.env.PROJECT_BEFORE_CMD, 'bash ' + process.env.FRAMEWORK_BEFORE_GATE, 'bash ' + process.env.PROJECT_BEFORE_GATE].includes(h.command); }) });
}).filter(function(g){ return !Array.isArray(g.hooks) || g.hooks.length > 0; });
if (!BT.some(function(g){ return Array.isArray(g.hooks) && g.hooks.some(function(h){ return h && h.command === process.env.PROJECT_BEFORE_CMD; }); })) BT.push({ matcher: '*', hooks: [{ name: 'forgewright-policy', type: 'command', command: process.env.PROJECT_BEFORE_CMD, timeout: 5000 }] });
cfg.hooks.BeforeTool = BT;
atomicWrite(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Added Gemini BeforeTool and AfterAgent hooks"
        fi
    fi
else
    log_warn "Gemini settings file not found: $GEMINI_SETTINGS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$GEMINI_SETTINGS")"
        atomic_write_text "$GEMINI_SETTINGS" <<EOF
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

antigravity_policy_registry() {
    local action="$1"
    local registry="$2"
    local expected_command="$3"
    local framework_gate="$4"
    local project_gate="$5"
    node - "$action" "$registry" "$expected_command" "$framework_gate" "$project_gate" <<'NODE'
var fs = require('fs');
var path = require('path');
var action = process.argv[2];
var file = process.argv[3];
var expectedCommand = process.argv[4];
var frameworkGate = process.argv[5];
var projectGate = process.argv[6];
var projectRelativeGate = 'scripts/lite/antigravity-pre-tool-gate.sh';

function normalizeGatePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  var normalized = path.posix.normalize(candidate.replace(/\\/g, '/'));
  var msysDrive = process.platform === 'win32' ? normalized.match(/^\/([A-Za-z])\/(.*)$/) : null;
  if (msysDrive) normalized = msysDrive[1].toLowerCase() + ':/' + msysDrive[2];
  if (/^[A-Z]:\//.test(normalized)) normalized = normalized[0].toLowerCase() + normalized.slice(1);
  return normalized;
}

var trustedGates = [
  normalizeGatePath(frameworkGate),
  normalizeGatePath(projectGate),
  projectRelativeGate
];

function ownedPolicyGate(commandValue) {
  if (typeof commandValue !== 'string') return false;
  if (commandValue === expectedCommand) return true;
  var match = commandValue.trim().match(/^(?:true\s*\|\|\s*)?bash\s+(?:"([^"]+)"|'([^']+)'|([^\s"'|&;]+))$/);
  if (!match) return false;
  var candidate = normalizeGatePath(match[1] || match[2] || match[3]);
  return candidate !== null && trustedGates.indexOf(candidate) !== -1;
}

function healthyExact(group, hook) {
  return group && group.matcher === '*' && hook && hook.type === 'command' &&
    hook.command === expectedCommand && hook.timeout === 5;
}

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

var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') throw new Error('Antigravity hooks registry must be an object');
var policy = cfg['forgewright-policy'];
if (!policy || Array.isArray(policy) || typeof policy !== 'object') policy = {};
var policyGroups = Array.isArray(policy.PreToolUse) ? policy.PreToolUse : [];

if (action === 'check') {
  var ownedCount = 0;
  var healthyExactCount = 0;
  policyGroups.forEach(function(group) {
    if (!group || !Array.isArray(group.hooks)) return;
    group.hooks.forEach(function(hook) {
      if (hook && ownedPolicyGate(hook.command)) ownedCount += 1;
      if (healthyExact(group, hook)) healthyExactCount += 1;
    });
  });
  console.log(Boolean(policy.enabled !== false && ownedCount === 1 && healthyExactCount === 1));
} else if (action === 'fix') {
  var foundPolicyGate = false;
  var repairedGroups = [];
  policyGroups.forEach(function(group) {
    if (!group || !Array.isArray(group.hooks)) {
      repairedGroups.push(group);
      return;
    }
    var removedOwned = false;
    var hooks = [];
    group.hooks.forEach(function(hook) {
      if (!hook || !ownedPolicyGate(hook.command)) {
        hooks.push(hook);
        return;
      }
      removedOwned = true;
      if (!foundPolicyGate && group.matcher === '*' && hook.command === expectedCommand) {
        foundPolicyGate = true;
        hooks.push(Object.assign({}, hook, { type: 'command', timeout: 5 }));
      }
    });
    if (!(removedOwned && group.hooks.length > 0 && hooks.length === 0)) {
      repairedGroups.push(Object.assign({}, group, { hooks: hooks }));
    }
  });
  if (!foundPolicyGate) repairedGroups.push({ matcher: '*', hooks: [{ type: 'command', command: expectedCommand, timeout: 5 }] });
  policy.enabled = true;
  policy.PreToolUse = repairedGroups;
  cfg['forgewright-policy'] = policy;
  atomicWrite(file, JSON.stringify(cfg, null, 2));
} else {
  throw new Error('Unsupported Antigravity policy registry action: ' + action);
}
NODE
}

# 3. Antigravity CLI Hook Configuration
ANTIGRAVITY_HOOKS="$(host_path "${HOME}/.gemini/config/hooks.json")"
ANTIGRAVITY_GATE="${FRAMEWORK_DIR}/scripts/lite/antigravity-pre-tool-gate.sh"
ANTIGRAVITY_PROJECT_GATE="$PROJECT_ROOT/scripts/lite/antigravity-pre-tool-gate.sh"
ANTIGRAVITY_POLICY_CMD="bash $(shell_quote "$ANTIGRAVITY_GATE")"
if [[ -f "$ANTIGRAVITY_HOOKS" ]]; then
    log_pass "Antigravity hook registry exists"
    antigravity_schema="$(antigravity_policy_registry check "$ANTIGRAVITY_HOOKS" "$ANTIGRAVITY_POLICY_CMD" "$ANTIGRAVITY_GATE" "$ANTIGRAVITY_PROJECT_GATE" 2>/dev/null || echo "false")"
    if [[ "$antigravity_schema" == "true" ]]; then
        log_pass "Antigravity PreToolUse policy hook uses the native named-hook schema"
    else
        log_warn "Antigravity PreToolUse policy hook is not configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$ANTIGRAVITY_HOOKS" "${ANTIGRAVITY_HOOKS}.bak.$(date +%Y%m%d%H%M%S)"
            antigravity_policy_registry fix "$ANTIGRAVITY_HOOKS" "$ANTIGRAVITY_POLICY_CMD" "$ANTIGRAVITY_GATE" "$ANTIGRAVITY_PROJECT_GATE"
            log_info "  → Fixed: Installed native Antigravity PreToolUse hook"
        fi
    fi
else
    log_warn "Antigravity hook registry not found: $ANTIGRAVITY_HOOKS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$ANTIGRAVITY_HOOKS")"
        atomic_write_text "$ANTIGRAVITY_HOOKS" <<EOF
{
  "forgewright-policy": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$ANTIGRAVITY_POLICY_CMD",
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

ANTIGRAVITY_SETTINGS="$(host_path "${HOME}/.gemini/antigravity-cli/settings.json")"
if [[ -f "$ANTIGRAVITY_SETTINGS" ]]; then
    antigravity_always_proceed=$(CONFIG_FILE="$ANTIGRAVITY_SETTINGS" node -e "try { var c=JSON.parse(require('fs').readFileSync(process.env.CONFIG_FILE)); console.log(c.toolPermission === 'always-proceed'); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$antigravity_always_proceed" == "true" ]]; then
        log_warn "Antigravity toolPermission is always-proceed; Forgewright still gates tools, but native permission prompts are disabled"
    fi
fi

# 4. Cursor Hook Configuration
CURSOR_HOOKS="$(host_path "${HOME}/.cursor/hooks.json")"
if [[ -f "$CURSOR_HOOKS" ]]; then
    log_pass "Cursor hooks file exists"
    cursor_schema=$(CONFIG_FILE="$CURSOR_HOOKS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$CURSOR_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$CURSOR_FRAMEWORK_STOP_CMD" node -e "try { var fs=require('fs'), c=JSON.parse(fs.readFileSync(process.env.CONFIG_FILE)); var expected=[process.env.PROJECT_STOP_CMD,process.env.FRAMEWORK_STOP_CMD,'bash '+process.env.GATE_SCRIPT+' --platform CURSOR','bash '+process.env.FRAMEWORK_GATE+' --platform CURSOR']; function current(h){ return Boolean(h && typeof h.command === 'string' && expected.includes(h.command)); } var ok=c.version === 1 && c.hooks && Array.isArray(c.hooks.stop) && c.hooks.stop.some(current); console.log(Boolean(ok)); } catch (_) { console.log(false); }" 2>/dev/null || echo "false")
    if [[ "$cursor_schema" == "true" ]]; then
        log_pass "Cursor stop hook uses the version 1 array schema"
    else
        log_warn "Cursor stop hook NOT configured correctly"
        if [[ "$AUTO_FIX" == "true" ]]; then
            cp "$CURSOR_HOOKS" "${CURSOR_HOOKS}.bak.$(date +%Y%m%d%H%M%S)"
            CONFIG_FILE="$CURSOR_HOOKS" GATE_SCRIPT="$GATE_SCRIPT" FRAMEWORK_GATE="$FRAMEWORK_GATE" PROJECT_STOP_CMD="$CURSOR_PROJECT_STOP_CMD" FRAMEWORK_STOP_CMD="$CURSOR_FRAMEWORK_STOP_CMD" node -e "
var fs = require('fs');
var path = require('path');
function atomicWrite(file, content) {
  var temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.tmp');
  var mode = 0o600;
  try { mode = fs.statSync(file).mode; } catch (_) {}
  var fd;
  try { fd = fs.openSync(temporary, 'w', mode); fs.writeSync(fd, content, null, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, file); }
  catch (error) { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} } try { fs.unlinkSync(temporary); } catch (_) {} throw error; }
}
var cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
if (!cfg.hooks) cfg.hooks = {};
cfg.version = 1;
if (typeof cfg.hooks.stop === 'string') delete cfg.hooks.stop;
function gatePath(command, platform) {
  if (typeof command !== 'string') return null;
  var match = command.trim().match(/^bash\\s+([^\\s]+)\\s+--platform\\s+(CLAUDE|GEMINI|CURSOR|CODEX)$/);
  if (!match || match[2] !== platform) return null;
  return match[1];
}
var currentCommands = [process.env.PROJECT_STOP_CMD, process.env.FRAMEWORK_STOP_CMD, 'bash ' + process.env.GATE_SCRIPT + ' --platform CURSOR', 'bash ' + process.env.FRAMEWORK_GATE + ' --platform CURSOR'];
function currentGate(command) { return currentCommands.includes(command); }
function legacyGate(command, platform) {
  var script = gatePath(command, platform);
  if (!script || path.basename(script) !== 'verify-gate.sh') return false;
  var normalized = path.resolve(script);
  var framework = path.resolve(process.env.FRAMEWORK_GATE, '..', '..', '..');
  return normalized === path.join(framework, 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'verify-gate.sh') ||
    normalized === path.join(framework, 'scripts', 'lite', 'verify-gate.sh');
}
var stop = Array.isArray(cfg.hooks.stop) ? cfg.hooks.stop : [];
stop = stop.filter(function(h){ return !legacyGate(h && h.command, 'CURSOR'); });
var already = stop.some(function(h){ return currentGate(h && h.command); });
if (!already) stop.push({ command: process.env.PROJECT_STOP_CMD });
cfg.hooks.stop = stop;
atomicWrite(process.env.CONFIG_FILE, JSON.stringify(cfg, null, 2));
"
            log_info "  → Fixed: Installed Cursor version 1 stop hook schema"
        fi
    fi
else
    log_warn "Cursor hooks file not found: $CURSOR_HOOKS"
    if [[ "$AUTO_FIX" == "true" ]]; then
        mkdir -p "$(dirname "$CURSOR_HOOKS")"
        atomic_write_text "$CURSOR_HOOKS" <<EOF
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
CODEX_CONFIG="$(host_path "${HOME}/.codex/config.toml")"
CODEX_STOP_TOML=""
if [[ -n "$PYTHON_BIN" && -n "$CODEX_STOP_COMMAND" ]]; then
    CODEX_STOP_TOML="$(CODEX_STOP_COMMAND="$CODEX_STOP_COMMAND" run_python -c 'import json, os; print(json.dumps(os.environ["CODEX_STOP_COMMAND"]))')"
fi
if [[ -f "$CODEX_CONFIG" ]]; then
    log_pass "Codex config file exists"
    if [[ -z "$PYTHON_BIN" ]]; then
        codex_schema="false"
        log_warn "Python >= 3.11 not found; Codex TOML hook validation skipped"
    else
        codex_schema=$(CODEX_STOP_COMMAND="$CODEX_STOP_COMMAND" FORGEWRIGHT_DIR="$FRAMEWORK_DIR" FORGEWRIGHT_PROJECT_ROOT="$PROJECT_ROOT" run_python - "$CODEX_CONFIG" <<'PYEOF'
import json
import os
import re
import shlex
import sys
import tomllib
from pathlib import Path

def current_gate(command):
    expected = os.environ.get("CODEX_STOP_COMMAND", "")
    return bool(expected) and command == expected

def owned_gate(command):
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
    roots = [
        Path(os.environ["FORGEWRIGHT_DIR"]).resolve(),
        Path(os.environ["FORGEWRIGHT_PROJECT_ROOT"]).resolve(),
    ]
    return gate in {root / "scripts" / "lite" / "stop-gate.sh" for root in roots}

try:
    with open(sys.argv[1], "rb") as handle:
        config = tomllib.load(handle)
    features = config.get("features", {})
    feature_enabled = isinstance(features, dict) and features.get("hooks") is True
    groups = config.get("hooks", {}).get("Stop", [])
    owned_count = 0
    exact_count = 0
    if isinstance(groups, list):
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                continue
            for hook in group["hooks"]:
                if not isinstance(hook, dict):
                    continue
                command = hook.get("command", "")
                if owned_gate(command):
                    owned_count += 1
                if (
                    group.get("matcher") == "*"
                    and hook.get("type") == "command"
                    and current_gate(command)
                    and hook.get("command_windows") in (None, command)
                ):
                    exact_count += 1
    ok = feature_enabled and owned_count == 1 and exact_count == 1
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
            if [[ -z "$PYTHON_BIN" || -z "$CODEX_STOP_COMMAND" || -z "$CODEX_STOP_TOML" ]]; then
                log_warn "Python >= 3.11 or Git Bash path unavailable; cannot auto-fix Codex TOML hook"
            else
                FORGEWRIGHT_DIR="$FRAMEWORK_DIR" FORGEWRIGHT_PROJECT_ROOT="$PROJECT_ROOT" run_python - "$CODEX_CONFIG" <<'PYEOF'
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
    except (TypeError, ValueError):
        return False
    if len(parts) != 4 or parts[0] != "bash" or parts[2] != "--platform" or parts[3] != "CODEX":
        return False
    script = Path(parts[1]).resolve()
    roots = [
        Path(os.environ["FORGEWRIGHT_DIR"]).resolve(),
        Path(os.environ["FORGEWRIGHT_PROJECT_ROOT"]).resolve(),
    ]
    trusted = {
        root / "verify-gate.sh"
        for root in roots
    } | {
        root / "scripts" / "verify-gate.sh"
        for root in roots
    } | {
        root / "scripts" / "lite" / "verify-gate.sh"
        for root in roots
    }
    return script in trusted

legacy = re.compile(
    r'(?:\r?\n)?\[\[hooks\.Stop\]\]\r?\n'
    r'(?:matcher\s*=\s*"[^"]*"\r?\n)?'
    r'\[\[hooks\.Stop\.hooks\]\]\r?\n'
    r'type\s*=\s*"command"\r?\n'
    r'command\s*=\s*"(?P<command>[^"]*verify-gate\.sh --platform CODEX)"\r?\n'
    r'(?:timeout\s*=\s*\d+\s*\r?\n)?'
)
updated = legacy.sub(lambda match: "\n" if owned_legacy_verify(match.group("command")) else match.group(0), text)

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
    roots = [
        Path(os.environ["FORGEWRIGHT_DIR"]).resolve(),
        Path(os.environ["FORGEWRIGHT_PROJECT_ROOT"]).resolve(),
    ]
    return gate in {root / "scripts" / "lite" / "stop-gate.sh" for root in roots}

stop_hook = re.compile(
    r'(?:\r?\n)?\[\[hooks\.Stop\]\]\r?\n'
    r'(?:matcher\s*=\s*"[^"]*"\r?\n)?'
    r'\[\[hooks\.Stop\.hooks\]\]\r?\n'
    r'type\s*=\s*"command"\r?\n'
    r'command\s*=\s*(?P<command>"(?:\\.|[^"\\])*")\r?\n'
    r'(?:command_windows\s*=\s*"(?:\\.|[^"\\])*"\r?\n)?'
    r'(?:timeout\s*=\s*\d+\s*\r?\n)?'
)

def remove_owned_stop(match: re.Match[str]) -> str:
    try:
        command = json.loads(match.group("command"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return match.group(0)
    return "\n" if owned_stop(command) else match.group(0)

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
    if os.name != "nt":
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
except BaseException:
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
PYEOF
            fi
            needs_features=true
            needs_hooks=true
            grep -qF '[features]' "$CODEX_CONFIG" 2>/dev/null && needs_features=false
            grep -qF '[hooks]' "$CODEX_CONFIG" 2>/dev/null && needs_hooks=false
            {
                cat "$CODEX_CONFIG"
                echo ""
                $needs_features && echo '[features]' && echo 'hooks = true' && echo ""
                $needs_hooks && echo '[hooks]' && echo ""
                cat <<EOF
[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = ${CODEX_STOP_TOML}
EOF
            } | atomic_write_text "$CODEX_CONFIG"
            log_info "  → Fixed: Added hooks block to Codex config"
        fi
    fi
else
    log_warn "Codex config file not found: $CODEX_CONFIG"
    if [[ "$AUTO_FIX" == "true" ]]; then
        if [[ -z "$PYTHON_BIN" || -z "$CODEX_STOP_COMMAND" || -z "$CODEX_STOP_TOML" ]]; then
            log_warn "Python >= 3.11 or Git Bash path unavailable; cannot create Codex TOML hook"
        else
            mkdir -p "$(dirname "$CODEX_CONFIG")"
            atomic_write_text "$CODEX_CONFIG" <<EOF
[features]
hooks = true

[hooks]

[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = ${CODEX_STOP_TOML}
EOF
            log_info "  → Fixed: Created Codex config with Stop hook"
        fi
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
