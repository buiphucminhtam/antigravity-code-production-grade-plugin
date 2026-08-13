#!/usr/bin/env bash
# scripts/lite/verify-gate.sh
# Forgewright turn-completion verify-gate.
# Works on macOS and Linux/Git-Bash.
#
# Shared contract:
#   Hook configs and CI call:
#     bash scripts/lite/verify-gate.sh --platform claude|gemini|cursor|codex
#   with the platform hook JSON payload on stdin.
#
# Platform payload (stdin JSON) fields consumed:
#   response_content / last_assistant_message
#                     - AI response text (to check for VERIFY block)
#   turn / turn_id    - optional turn/session ID (forwarded to evidence lookup)
#   files             - optional array of changed file paths
#
# Exit codes:
#   0 — gate OPEN (all checks passed or no code changes)
#   1 — gate BLOCKED (see stderr for reason)

set -uo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[VERIFY-GATE]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[VERIFY-GATE] WARNING:${NC} $*" >&2; }
log_error() { echo -e "${RED}[VERIFY-GATE] ERROR:${NC} $*" >&2; }

# ── resolve project root (dynamic, no hardcoded repo) ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALLER_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$CALLER_ROOT" ]]; then
  PROJECT_ROOT="$CALLER_ROOT"
else
  PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi
cd "${PROJECT_ROOT}"

# ── parse --platform flag and any other flags ─────────────────────────────────
PLATFORM=""
PAYLOAD_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --payload-file)
      PAYLOAD_FILE="${2:-}"
      shift 2
      ;;
    --help|-h)
      grep '^#' "${BASH_SOURCE[0]}" | head -30 | sed 's/^# \?//'
      exit 0
      ;;
    *)
      log_warn "Unknown flag: $1 (ignored)"
      shift
      ;;
  esac
done

# Normalize platform labels. Installed hook configs have historically used
# uppercase values (CODEX/CLAUDE/etc.); keep the script tolerant so old cached
# hook commands do not fail before reaching the validator.
if [[ -n "$PLATFORM" ]]; then
  PLATFORM="$(printf '%s' "$PLATFORM" | tr '[:upper:]' '[:lower:]')"
fi

# Codex Stop hooks require a JSON object on stdout. Human-readable logs on
# stdout make Codex report "invalid stop hook JSON output". Detect Codex either
# from --platform codex or from CODEX_* env vars for older cached commands that
# invoked this script without --platform.
CODEX_HOOK=0
if [[ "$PLATFORM" == "codex" || -n "${CODEX_THREAD_ID:-}" || -n "${CODEX_CI:-}" ]]; then
  CODEX_HOOK=1
  exec 3>&1
  exec 1>&2
fi

_codex_json() {
  local decision="$1"
  local reason="${2:-}"
  python3 - "$decision" "$reason" <<'PYEOF'
import json
import sys

decision = sys.argv[1]
reason = sys.argv[2] if len(sys.argv) > 2 else ""
if decision == "continue":
    print(json.dumps({"continue": True}))
else:
    print(json.dumps({"decision": "block", "reason": reason or "Forgewright verify gate blocked stop."}))
PYEOF
}

gate_continue() {
  if [[ "$CODEX_HOOK" -eq 1 ]]; then
    _codex_json continue >&3
  fi
  exit 0
}

gate_block() {
  local reason="${1:-Forgewright verify gate blocked stop.}"
  if [[ "$CODEX_HOOK" -eq 1 ]]; then
    _codex_json block "$reason" >&3
    exit 0
  fi
  exit 1
}

# Validate platform
VALID_PLATFORMS=("claude" "gemini" "cursor" "codex" "")
PLATFORM_VALID=0
for p in "${VALID_PLATFORMS[@]}"; do
  [[ "$PLATFORM" == "$p" ]] && PLATFORM_VALID=1 && break
done
if [[ "$PLATFORM_VALID" -eq 0 ]]; then
  log_error "Unknown platform '${PLATFORM}'. Valid: claude, gemini, cursor, codex"
  gate_block "Unknown verify-gate platform '${PLATFORM}'."
fi

[[ -n "$PLATFORM" ]] && log_info "Platform: ${PLATFORM}"

# ── read and parse stdin JSON payload (with loop cap) ─────────────────────────
RESPONSE_CONTENT=""
TURN_FROM_PAYLOAD=""
FILES_FROM_PAYLOAD=()

read_payload() {
  local raw_json=""
  if [[ -n "$PAYLOAD_FILE" && -f "$PAYLOAD_FILE" ]]; then
    raw_json="$(cat "$PAYLOAD_FILE")"
  elif [[ ! -t 0 ]]; then
    # Read stdin with a 1 MB cap. dd handles payloads without trailing newline
    # and avoids Bash 3.2 read -N edge cases under subprocess-provided stdin.
    raw_json="$(dd bs=1048576 count=1 2>/dev/null || true)"
    if [[ ${#raw_json} -ge 1048576 ]]; then
      log_warn "Stdin JSON payload truncated at 1 MB"
    fi
  fi

  if [[ -z "$raw_json" ]]; then
    return 0  # No payload — that's fine
  fi

  # Parse JSON fields using Python (handles unicode, nested keys, arrays)
  local parsed
  parsed="$(python3 - "${raw_json}" <<'PYEOF'
import json, sys, os

raw = sys.argv[1] if len(sys.argv) > 1 else ''
if not raw.strip():
    sys.exit(0)

try:
    payload = json.loads(raw)
except json.JSONDecodeError:
    # Tolerate non-JSON payloads (treat as plain response text)
    payload = {"response_content": raw}

response_content = payload.get("response_content")
if not isinstance(response_content, str):
    response_content = payload.get("last_assistant_message")
if not isinstance(response_content, str):
    response_content = payload.get("content", "")
if not isinstance(response_content, str):
    response_content = ""

turn = payload.get("turn")
if not isinstance(turn, str) or not turn.strip():
    turn = payload.get("turn_id", "")
if not isinstance(turn, str):
    turn = ""

fields = {
    "response_content": response_content,
    "turn":             turn,
    "files":            payload.get("files", payload.get("changed_files", [])),
}
# Normalize files to newline-separated string for easy bash consumption
files_str = "\n".join(str(f) for f in fields["files"] if f)
print(json.dumps({
    "response_content": fields["response_content"],
    "turn":             fields["turn"],
    "files_str":        files_str,
}))
PYEOF
)" || true

  if [[ -n "$parsed" ]]; then
    RESPONSE_CONTENT="$(  echo "$parsed" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('response_content',''))")"
    TURN_FROM_PAYLOAD="$( echo "$parsed" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('turn',''))")"
    local files_nl
    files_nl="$(           echo "$parsed" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('files_str',''))")"
    if [[ -n "$files_nl" ]]; then
      while IFS= read -r f; do
        [[ -n "$f" ]] && FILES_FROM_PAYLOAD+=("$f")
      done <<< "$files_nl"
    fi
  fi
}

read_payload

# Forward parsed turn to evidence validator
if [[ -n "$TURN_FROM_PAYLOAD" ]]; then
  export FORGEWRIGHT_TURN="$TURN_FROM_PAYLOAD"
fi

# ── collect changed files from git (staged, unstaged, untracked) ──────────────
_collect_git_files() {
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    return 0
  fi
  # Use printf to handle filenames with spaces and special chars
  while IFS= read -r -d $'\0' file; do
    [[ -n "$file" ]] && echo "$file"
  done < <(
    git diff --name-only -z
    git diff --name-only -z --cached
    git status --porcelain -z | while IFS= read -r -d $'\0' entry; do
      status="${entry:0:2}"
      file="${entry:3}"
      [[ "$status" == '??' ]] && printf '%s\0' "$file"
    done
  )
}

# Merge: payload files + git files (deduplicated).
# Keep this Bash 3.2 compatible for macOS system bash: no associative arrays.
FILES_TO_CHECK=()

add_file() {
  local f="$1"
  [[ -z "$f" ]] && return
  local existing
  if [[ ${#FILES_TO_CHECK[@]} -gt 0 ]]; then
    for existing in "${FILES_TO_CHECK[@]}"; do
      [[ "$existing" == "$f" ]] && return
    done
  fi
  FILES_TO_CHECK+=("$f")
}

if [[ ${#FILES_FROM_PAYLOAD[@]} -gt 0 ]]; then
  for f in "${FILES_FROM_PAYLOAD[@]}"; do add_file "$f"; done
fi
while IFS= read -r f; do add_file "$f"; done < <(_collect_git_files)

# ── classify: does the changeset contain code edits? ──────────────────────────
_SKIP_PATTERNS=(
  "*.md" "*.txt"
  ".gitignore" ".gitattributes" ".memignore" ".cursorignore"
  ".forgewright/*" "memory.db*" ".gitnexus/*" ".forgenexus/*"
)

_is_skip() {
  local f="${1#./}"  # strip leading ./
  for pat in "${_SKIP_PATTERNS[@]}"; do
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0;; esac
    if [[ "$pat" == *"/*" ]]; then
      local dir="${pat%/*}"
      [[ "$f" == "$dir"/* || "$f" == "$dir" ]] && return 0
    fi
  done
  return 1
}

has_code_edits() {
  if [[ ${#FILES_TO_CHECK[@]} -gt 0 ]]; then
    for f in "${FILES_TO_CHECK[@]}"; do
      _is_skip "$f" || return 0
    done
  fi
  return 1
}

if ! has_code_edits; then
  log_info "No code changes detected — gate OPEN (no VERIFY block required)"
  gate_continue
fi

log_info "Code changes detected. Running verification gate checks..."

# ── export context for Python validator ───────────────────────────────────────
export RESPONSE_CONTENT
# Newline-separated filenames. This preserves spaces; filenames containing
# literal newlines are intentionally unsupported by this hook interface.
FILES_TO_CHECK_STR="$(printf '%s\n' "${FILES_TO_CHECK[@]}")"
export FILES_TO_CHECK_STR
unset FILES_TO_CHECK_NUL

python3 "${SCRIPT_DIR}/verify_gate.py"
GATE_RC=$?

if [[ $GATE_RC -ne 0 ]]; then
  log_error "Evidence validation FAILED — gate BLOCKED"
  gate_block "Forgewright evidence validation failed. Review hook stderr for details."
fi

# ── strict response/evidence correlation ─────────────────────────────────────
# Do not accept marker-only VERIFY headings or fenced markers. The Python
# validator loads the exact-turn v2 record and checks every acceptance, claim,
# shlex-rendered command, output digest, exit code, and verdict.
if [[ -z "$RESPONSE_CONTENT" ]]; then
  log_warn "No response content provided (stdin was empty / no payload)."
  log_error "VERIFY block REQUIRED when code changes exist."
  gate_block "VERIFY block required when code changes exist."
fi

log_info "Checking strict VERIFY response correlation..."
if ! printf '%s' "$RESPONSE_CONTENT" | python3 "${SCRIPT_DIR}/rule-validator.py" --runtime >/dev/null; then
  log_error "Strict VERIFY response correlation failed."
  gate_block "Forgewright strict VERIFY validation failed."
else
  log_info "Strict VERIFY response correlation passed — gate OPEN"
  gate_continue
fi
