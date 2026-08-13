#!/usr/bin/env bash
# Capture a platform Stop-hook payload once, then replay it to both compliance
# validators without leaking response content or emitting duplicate protocol data.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM=""
MAX_PAYLOAD_BYTES=1048576
MAX_VERIFY_STDERR_BYTES=65536

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --help|-h)
      echo "Usage: stop-gate.sh --platform CLAUDE|GEMINI|CURSOR|CODEX"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

PLATFORM="$(printf '%s' "$PLATFORM" | tr '[:lower:]' '[:upper:]')"

# A project-local Codex gate is canonical for that repository. Any external
# installed copy defers so Codex does not run the same validator twice.
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
PROJECT_LITE_DIR="${PROJECT_ROOT:+${PROJECT_ROOT}/scripts/lite}"
if [[ "$PLATFORM" == "CODEX" && -n "$PROJECT_ROOT" && "$SCRIPT_DIR" != "$PROJECT_LITE_DIR" ]]; then
  PROJECT_CODEX_CONFIG="${PROJECT_ROOT}/.codex/config.toml"
  if [[ -n "$PROJECT_CODEX_CONFIG" && -f "$PROJECT_CODEX_CONFIG" ]] &&
    grep -Eq 'command[[:space:]]*=[[:space:]]*"bash scripts/lite/stop-gate\.sh --platform CODEX([[:space:]]|"|$)' "$PROJECT_CODEX_CONFIG"; then
    printf '{"continue": true}\n'
    exit 0
  fi
fi

PAYLOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/forgewright-stop.XXXXXX")" || exit 1
VERIFY_STDERR_FILE="$(mktemp "${TMPDIR:-/tmp}/forgewright-verify-stderr.XXXXXX")" || {
  rm -f "$PAYLOAD_FILE"
  exit 1
}
chmod 600 "$PAYLOAD_FILE" 2>/dev/null || true
chmod 600 "$VERIFY_STDERR_FILE" 2>/dev/null || true
cleanup() {
  rm -f "$PAYLOAD_FILE" "$VERIFY_STDERR_FILE"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if [[ ! -t 0 ]]; then
  python3 -c 'import sys; path=sys.argv[1]; limit=int(sys.argv[2]); data=sys.stdin.buffer.read(limit + 1); open(path, "wb").write(data)' \
    "$PAYLOAD_FILE" "$MAX_PAYLOAD_BYTES" || true
else
  : > "$PAYLOAD_FILE"
fi

PAYLOAD_SIZE="$(wc -c < "$PAYLOAD_FILE" | tr -d ' ')"
OVERSIZED=0
if [[ "$PAYLOAD_SIZE" -gt "$MAX_PAYLOAD_BYTES" ]]; then
  OVERSIZED=1
fi

emit_codex_block() {
  python3 - "${1:-Forgewright stop validator rejected the response payload.}" <<'PYEOF'
import json
import sys
print(json.dumps({
    "decision": "block",
    "reason": sys.argv[1][:512],
}))
PYEOF
}

codex_block_reason() {
  python3 - "$VERIFY_STDERR_FILE" "$VALIDATOR_RC" "$VERIFY_RC" \
    "$MAX_VERIFY_STDERR_BYTES" <<'PYEOF'
import re
import sys
from pathlib import Path

stderr_path = Path(sys.argv[1])
rule_rc = int(sys.argv[2])
verify_rc = int(sys.argv[3])
stderr_limit = int(sys.argv[4])
with stderr_path.open("rb") as stderr_stream:
    text = stderr_stream.read(stderr_limit).decode("utf-8", errors="replace")
text = re.sub(r"\x1b\[[0-9;]*m", "", text)

safe_reason = ""
if rule_rc:
    safe_reason = "Forgewright rule validator rejected the response payload."
patterns = (
    (r"MISSING:", "MISSING: no current machine-written evidence was found."),
    (
        r"STALE: evidence is ([0-9]+)s old \(limit: ([0-9]+)s\)",
        lambda match: (
            f"STALE: evidence is {match.group(1)}s old "
            f"(limit: {match.group(2)}s)."
        ),
    ),
    (
        r"MISMATCH: workspace",
        "MISMATCH: evidence workspace does not match the current workspace.",
    ),
    (
        r"MISMATCH: tree_sha",
        "MISMATCH: the workspace tree changed after evidence was written.",
    ),
    (
        r"FAILED: evidence exit_code=(-?[0-9]+)",
        lambda match: f"FAILED: evidence command exited {match.group(1)}.",
    ),
    (
        r"FAILED: exit_code is not an integer",
        "FAILED: evidence exit code is invalid.",
    ),
    (
        r"SECRETS:",
        "SECRETS: evidence output contains unredacted secret material.",
    ),
    (
        r"FORGED:",
        "FORGED: evidence schema or contents failed validation.",
    ),
    (
        r"Code contains stubs:",
        "STUBS: changed code contains forbidden stubs.",
    ),
)
if not safe_reason:
    for pattern, replacement in patterns:
        match = re.search(pattern, text)
        if match:
            safe_reason = replacement(match) if callable(replacement) else replacement
            break

if not safe_reason and verify_rc:
    safe_reason = "Forgewright evidence validator rejected the response payload."
elif not safe_reason:
    safe_reason = "Forgewright stop validator rejected the response payload."

print(safe_reason[:512])
PYEOF
}

block_non_codex() {
  if [[ "$PLATFORM" == "CLAUDE" || "$PLATFORM" == "GEMINI" ]]; then
    exit 2
  fi
  exit 1
}

if [[ "$OVERSIZED" -eq 1 ]]; then
  if [[ "$PLATFORM" == "CODEX" ]]; then
    emit_codex_block
    exit 0
  fi
  echo "[STOP-GATE] Payload exceeds the 1 MiB validation limit." >&2
  block_non_codex
fi

# Claude/Codex native Stop payloads name the response
# `last_assistant_message`. Normalize it once so both downstream validators
# consume the same response. Codex's platform-native `turn_id` is routing
# metadata, not necessarily the Forgewright evidence filename: retain it as an
# exact selector only when it identifies a passing schema-v2 final record.
python3 - "$PAYLOAD_FILE" "$PROJECT_ROOT" "$PLATFORM" "$SCRIPT_DIR" <<'PYEOF'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
project_root = Path(sys.argv[2]) if sys.argv[2] else None
platform = sys.argv[3]
sys.path.insert(0, sys.argv[4])
from evidence_common import FINAL_PHASES, SCHEMA_VERSION, read_evidence_json
from verify_gate import _find_evidence

raw = path.read_text(encoding="utf-8")
try:
    payload = json.loads(raw)
except json.JSONDecodeError:
    raise SystemExit(0)
changed = False
if (
    isinstance(payload, dict)
    and not isinstance(payload.get("response_content"), str)
    and isinstance(payload.get("last_assistant_message"), str)
):
    payload["response_content"] = payload["last_assistant_message"]
    changed = True

if isinstance(payload, dict) and platform == "CODEX":
    explicit_turn = payload.get("turn")
    platform_turn = payload.get("turn_id")
    if not (isinstance(explicit_turn, str) and explicit_turn.strip()):
        selected = None
        mapped_candidate = False
        exact_final = False
    if (
        not (isinstance(explicit_turn, str) and explicit_turn.strip())
        and isinstance(platform_turn, str)
        and platform_turn.strip()
    ):
        turn_id = platform_turn.strip()
        turn_path = Path(turn_id)
        safe_id = (
            turn_path.name == turn_id
            and all(part not in {".", ".."} for part in turn_path.parts)
        )
        evidence = None
        if safe_id and project_root is not None:
            candidate = project_root / ".forgewright" / "verify" / f"{turn_id}.json"
            mapped_candidate = candidate.exists() or candidate.is_symlink()
            try:
                evidence = read_evidence_json(project_root, candidate)
            except ValueError:
                evidence = None
        exact_final = (
            isinstance(evidence, dict)
            and evidence.get("schema_version") == SCHEMA_VERSION
            and evidence.get("phase") in FINAL_PHASES
            and evidence.get("exit_code") == 0
        )
        if exact_final:
            selected = turn_id
        elif not mapped_candidate and safe_id and project_root is not None:
            discovered = _find_evidence(project_root, "")
            selected = discovered.stem if discovered is not None else None
        if selected is not None:
            payload["turn"] = selected
            payload.pop("turn_id", None)
            changed = True
    elif not (isinstance(explicit_turn, str) and explicit_turn.strip()) and project_root is not None:
        discovered = _find_evidence(project_root, "")
        if discovered is not None:
            payload["turn"] = discovered.stem
            changed = True

if changed:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
PYEOF

VALIDATOR_RC=0
if python3 - "$PAYLOAD_FILE" >/dev/null 2>&1 <<'PYEOF'
import json
import re
import sys
from pathlib import Path

raw = Path(sys.argv[1]).read_text(encoding="utf-8")
try:
    payload = json.loads(raw)
except json.JSONDecodeError:
    response = raw
else:
    response = ""
    if isinstance(payload, dict):
        for key in ("response_content", "content", "assistant_response", "output", "response"):
            candidate = payload.get(key)
            if isinstance(candidate, str):
                response = candidate
                break
            if isinstance(candidate, list):
                texts = [item.get("text") for item in candidate if isinstance(item, dict)]
                if texts and all(isinstance(item, str) for item in texts):
                    response = "\n".join(texts)
                    break

marker = re.search(
    r"(?im)^\s*(?:(?:#{1,6}\s*)?(?:CLAIM|VERIFY|VERIFICATION)\s*:|"
    r"#{1,6}\s*(?:VERIFY|VERIFICATION)\s*$|```(?:verify|verification)\b)",
    response,
)
raise SystemExit(0 if marker else 1)
PYEOF
then
  python3 "${SCRIPT_DIR}/rule-validator.py" --runtime --transcript "$PAYLOAD_FILE" \
    >/dev/null 2>/dev/null
  VALIDATOR_RC=$?
fi

if [[ "$PLATFORM" == "CODEX" ]]; then
  VERIFY_JSON="$(bash "${SCRIPT_DIR}/verify-gate.sh" --platform CODEX \
    --payload-file "$PAYLOAD_FILE" 2>"$VERIFY_STDERR_FILE")"
  VERIFY_RC=$?
  VERIFY_BLOCKED=0
  if python3 - "$VERIFY_JSON" >/dev/null 2>&1 <<'PYEOF'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except (IndexError, json.JSONDecodeError):
    raise SystemExit(1)
raise SystemExit(0 if payload.get("decision") == "block" else 1)
PYEOF
  then
    VERIFY_BLOCKED=1
  fi

  if [[ "$VALIDATOR_RC" -ne 0 || "$VERIFY_RC" -ne 0 || "$VERIFY_BLOCKED" -eq 1 ]]; then
    [[ "$VERIFY_BLOCKED" -eq 1 ]] && VERIFY_RC=1
    emit_codex_block "$(codex_block_reason)"
    exit 0
  fi

  python3 - "$VERIFY_JSON" <<'PYEOF'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
    if not isinstance(payload, dict):
        raise ValueError("hook output must be an object")
except (IndexError, json.JSONDecodeError, ValueError):
    payload = {
        "decision": "block",
        "reason": "Forgewright verify gate returned invalid protocol output.",
    }
print(json.dumps(payload))
PYEOF
  exit 0
fi

CODEX_THREAD_ID='' CODEX_CI='' bash "${SCRIPT_DIR}/verify-gate.sh" --platform "$PLATFORM" \
  --payload-file "$PAYLOAD_FILE"
VERIFY_RC=$?

if [[ "$VALIDATOR_RC" -ne 0 || "$VERIFY_RC" -ne 0 ]]; then
  if [[ "$VALIDATOR_RC" -ne 0 ]]; then
    echo "[STOP-GATE] Rule validation rejected the response payload." >&2
  fi
  block_non_codex
fi
exit 0
