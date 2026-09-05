#!/usr/bin/env bash
# scripts/lite/policy-check.sh
# Forgewright Phase 4 — execution policy gate.
# Reads .forgewright/execution-policy.yaml and checks tool arguments against
# deny_patterns. Designed to be called from guard middleware ④ before a tool
# call executes. See kernel/POLICY.md.
#
# Usage:
#   bash scripts/lite/policy-check.sh check <tool_name> [tool_args...]
#   bash scripts/lite/policy-check.sh get <key>
#   bash scripts/lite/policy-check.sh show
#
# Keys for `get`: mode | require_verify | max_escalations | refresh_interval_ticks
#
# Exit codes:
#   0 — ALLOW (also: audit-mode match)
#   1 — DENY  (pattern matched, mode=strict or unknown mode)
#   2 — WARN  (pattern matched, mode=permissive)
#   3 — usage error / missing dependency

set -euo pipefail

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[POLICY]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[POLICY] WARNING:${NC} $*" >&2; }
log_error() { echo -e "${RED}[POLICY] ERROR:${NC} $*" >&2; }

# Find project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [[ -n "${FORGEWRIGHT_WORKSPACE:-}" ]]; then
  WORKSPACE_PATH="$FORGEWRIGHT_WORKSPACE"
  if command -v cygpath >/dev/null 2>&1; then
    NORMALIZED_WORKSPACE="$(cygpath -u "$WORKSPACE_PATH" 2>/dev/null)" || {
      log_error "FORGEWRIGHT_WORKSPACE cannot be normalized; DENY (fail-closed)."
      exit 1
    }
    WORKSPACE_PATH="$NORMALIZED_WORKSPACE"
  fi
  if [[ ! -d "$WORKSPACE_PATH" ]]; then
    log_error "FORGEWRIGHT_WORKSPACE is not a readable directory; DENY (fail-closed)."
    exit 1
  fi
  PROJECT_ROOT="$(cd "$WORKSPACE_PATH" 2>/dev/null && pwd -P)" || {
    log_error "FORGEWRIGHT_WORKSPACE cannot be resolved; DENY (fail-closed)."
    exit 1
  }
  FORGEWRIGHT_WORKSPACE="$PROJECT_ROOT"
  export FORGEWRIGHT_WORKSPACE
fi
cd "$PROJECT_ROOT"

POLICY_FILE="${FORGEWRIGHT_POLICY_FILE:-.forgewright/execution-policy.yaml}"
TELEMETRY_SH="${SCRIPT_DIR}/telemetry.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  policy-check.sh check <tool_name> [tool_args...]   Gate a tool call
  policy-check.sh get <key>                          Read one policy scalar
  policy-check.sh show                               Dump effective policy
EOF
  exit 3
}

# Best-effort telemetry — must never fail the gate.
_emit() {
  [[ -f "$TELEMETRY_SH" ]] || return 0
  bash "$TELEMETRY_SH" emit "$1" "$2" >/dev/null 2>&1 || true
}

# Extract a scalar value: `key: value   # comment` → `value`.
# Values must not contain spaces (documented in the policy file header).
_scalar() {
  (grep -E "^${1}:" "$POLICY_FILE" 2>/dev/null || true) \
    | head -1 | cut -d':' -f2- | cut -d'#' -f1 | tr -d ' \t"\r'
}

# Extract deny_patterns list items: `  - "pattern"` → `pattern`.
# deny_patterns is the only list in this file, so any `- ` line belongs to it.
_deny_patterns() {
  (grep -E '^[[:space:]]*- ' "$POLICY_FILE" 2>/dev/null || true) \
    | tr -d '"\r' | sed 's/^[[:space:]]*- //'
}

_policy_error() {
  log_error "Execution policy is missing, unreadable, empty, or malformed; DENY (fail-closed)."
  return 1
}

_validate_policy() {
  [[ -f "$POLICY_FILE" && -r "$POLICY_FILE" && -s "$POLICY_FILE" ]] || return 1

  local line pattern_count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi
    case "$line" in
      mode:*|require_verify:*|max_escalations:*|refresh_interval_ticks:*)
        [[ "$line" =~ ^(mode|require_verify|max_escalations|refresh_interval_ticks):[[:space:]]*[^[:space:]#]+([[:space:]]*#.*)?$ ]] || return 1
        ;;
      deny_patterns:) ;;
      [[:space:]]*'- '*)
        [[ "$line" =~ ^[[:space:]]*-[[:space:]]\"[^\"]+\"[[:space:]]*$ ]] || return 1
        pattern_count=$((pattern_count + 1))
        ;;
      *) return 1 ;;
    esac
  done < "$POLICY_FILE"

  [[ "$(grep -Ec '^mode:' "$POLICY_FILE")" -eq 1 ]] || return 1
  [[ "$(grep -Ec '^require_verify:' "$POLICY_FILE")" -eq 1 ]] || return 1
  [[ "$(grep -Ec '^max_escalations:' "$POLICY_FILE")" -eq 1 ]] || return 1
  [[ "$(grep -Ec '^refresh_interval_ticks:' "$POLICY_FILE")" -eq 1 ]] || return 1
  [[ "$(grep -Ec '^deny_patterns:[[:space:]]*$' "$POLICY_FILE")" -eq 1 ]] || return 1

  local regex_rc pattern
  while IFS= read -r pattern; do
    if printf '' | grep -Eq -- "$pattern" 2>/dev/null; then
      :
    else
      regex_rc=$?
      [[ "$regex_rc" -eq 1 ]] || return 1
    fi
  done < <(_deny_patterns)

  local mode require_verify max_escalations refresh_ticks
  mode="$(_scalar mode)"
  require_verify="$(_scalar require_verify)"
  max_escalations="$(_scalar max_escalations)"
  refresh_ticks="$(_scalar refresh_interval_ticks)"
  [[ "$mode" =~ ^(strict|permissive|audit)$ ]] || return 1
  [[ "$require_verify" =~ ^(true|false)$ ]] || return 1
  [[ "$max_escalations" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$refresh_ticks" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$pattern_count" -gt 0 ]] || return 1
}

# Detect destructive commands structurally so wrappers, executable paths, git
# global options, and split short flags cannot bypass the configurable regexes.
_builtin_deny() {
  python3 - "$1" <<'PYEOF'
import os
import shlex
import sys

subject = sys.argv[1]
try:
    lexer = shlex.shlex(subject, posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    tokens = list(lexer)
except ValueError:
    print("malformed-command")
    raise SystemExit(0)

stops = {";", "&&", "||", "|", "&"}

def base(token: str) -> str:
    return os.path.basename(token)

for i, token in enumerate(tokens):
    command = base(token)
    segment = []
    for item in tokens[i + 1 :]:
        if item in stops:
            break
        segment.append(item)

    if command == "rm":
        flags = ""
        long_flags = set()
        for arg in segment:
            if arg.startswith("--"):
                long_flags.add(arg)
            elif arg.startswith("-"):
                flags += arg[1:]
        recursive = "r" in flags or "R" in flags or "--recursive" in long_flags
        force = "f" in flags or "--force" in long_flags
        if recursive and force:
            print("builtin:rm-recursive-force")
            raise SystemExit(0)

    if command == "git":
        j = 0
        options_with_value = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}
        while j < len(segment):
            arg = segment[j]
            if arg in options_with_value:
                j += 2
                continue
            if any(arg.startswith(prefix + "=") for prefix in options_with_value if prefix.startswith("--")):
                j += 1
                continue
            if arg == "--":
                j += 1
                break
            if arg.startswith("-"):
                j += 1
                continue
            break
        args = segment[j:]
        if args[:1] == ["reset"] and "--hard" in args[1:]:
            print("builtin:git-reset-hard")
            raise SystemExit(0)
        if args[:1] == ["clean"] and any(
            arg == "--force" or (arg.startswith("-") and "f" in arg[1:]) for arg in args[1:]
        ):
            print("builtin:git-clean-force")
            raise SystemExit(0)
        if args[:1] == ["push"] and any(
            arg in {"--force", "-f"} or arg.startswith("--force=") for arg in args[1:]
        ):
            print("builtin:git-push-force")
            raise SystemExit(0)

    if command == "chmod" and "777" in segment:
        print("builtin:chmod-777")
        raise SystemExit(0)

print("")
PYEOF
}

_default_for() {
  case "$1" in
    mode)                    echo "strict" ;;
    require_verify)          echo "true" ;;
    max_escalations)         echo "3" ;;
    refresh_interval_ticks)  echo "10" ;;
    *)                       echo "" ;;
  esac
}

cmd_get() {
  [[ $# -eq 1 ]] || usage
  _validate_policy || { _policy_error; exit 1; }
  local key="$1"
  local default
  default="$(_default_for "$key")"
  if [[ -z "$default" ]]; then
    log_error "Unknown policy key: ${key}"
    exit 3
  fi
  local value
  value="$(_scalar "$key")"
  echo "${value:-$default}"
}

cmd_show() {
  _validate_policy || { _policy_error; exit 1; }
  echo "── Effective execution policy ─────────────────────────────"
  echo "File: ${POLICY_FILE} $([[ -f "$POLICY_FILE" ]] && echo '(present)' || echo '(MISSING — built-in defaults)')"
  local key
  for key in mode require_verify max_escalations refresh_interval_ticks; do
    printf "  %-24s %s\n" "$key" "$(cmd_get "$key")"
  done
  echo "  deny_patterns:"
  _deny_patterns | while IFS= read -r p; do
    [[ -n "$p" ]] && printf "    - %s\n" "$p"
  done
}

cmd_check() {
  [[ $# -ge 1 ]] || usage
  local tool="$1"
  shift
  local args="$*"
  local subject="${tool} ${args}"

  _validate_policy || { _policy_error; exit 1; }

  local mode
  mode="$(_scalar mode)"
  mode="${mode:-strict}"

  local matched=""
  matched="$(_builtin_deny "$subject")"
  while IFS= read -r pattern; do
    [[ -n "$matched" ]] && break
    [[ -z "$pattern" ]] && continue
    if printf '%s' "$subject" | grep -Eiq -- "$pattern"; then
      matched="$pattern"
      break
    fi
  done < <(_deny_patterns)

  if [[ -z "$matched" ]]; then
    log_info "ALLOW ${tool}"
    exit 0
  fi

  local payload
  payload="$(jq -cn --arg tool "$tool" --arg pattern "$matched" --arg mode "$mode" \
                    '{tool: $tool, pattern: $pattern, mode: $mode}')"

  case "$mode" in
    permissive)
      _emit "policy.warn" "$payload"
      log_warn "WARN ${tool}: args match deny pattern [${matched}] — allowed (mode=permissive)."
      exit 2
      ;;
    audit)
      _emit "policy.audit" "$payload"
      log_info "AUDIT ${tool}: args match deny pattern [${matched}] — logged only (mode=audit)."
      exit 0
      ;;
    strict|*)
      # Unknown modes fail closed.
      _emit "policy.deny" "$payload"
      log_error "DENY ${tool}: args match deny pattern [${matched}] (mode=${mode})."
      exit 1
      ;;
  esac
}

command -v jq >/dev/null 2>&1 || { log_error "jq is required but not found in PATH."; exit 3; }
command -v python3 >/dev/null 2>&1 || { log_error "python3 is required but not found in PATH."; exit 3; }

[[ $# -ge 1 ]] || usage
cmd="$1"; shift
case "$cmd" in
  check) cmd_check "$@" ;;
  get)   cmd_get "$@" ;;
  show)  cmd_show "$@" ;;
  *)     usage ;;
esac
