#!/usr/bin/env bash
# Bounded Stop-hook entry point. All validation and retry decisions are owned
# by stop_gate.py so a single Stop event can replay completion evidence at most
# once.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --help|-h)
      echo "Usage: stop-gate.sh --platform CLAUDE|GEMINI|CURSOR|CODEX"
      exit 0
      ;;
    *) shift ;;
  esac
done

PLATFORM="$(printf '%s' "$PLATFORM" | tr '[:lower:]' '[:upper:]')"

# A project-local Codex gate is canonical for that repository. An installed
# global copy defers before requiring any adjacent Python modules.
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
PROJECT_LITE_DIR="${PROJECT_ROOT:+${PROJECT_ROOT}/scripts/lite}"
if [[ "$PLATFORM" == "CODEX" && -n "$PROJECT_ROOT" && "$SCRIPT_DIR" != "$PROJECT_LITE_DIR" ]]; then
  PROJECT_CODEX_CONFIG="${PROJECT_ROOT}/.codex/config.toml"
  if [[ -f "$PROJECT_CODEX_CONFIG" ]] &&
    grep -Eq 'command[[:space:]]*=[[:space:]]*"bash scripts/lite/stop-gate\.sh --platform CODEX([[:space:]]|"|$)' "$PROJECT_CODEX_CONFIG"; then
    printf '{"continue": true}\n'
    exit 0
  fi
fi

exec python3 "${SCRIPT_DIR}/stop_gate.py" --platform "$PLATFORM" --typed-stop-decision
