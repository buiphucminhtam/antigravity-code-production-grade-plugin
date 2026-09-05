#!/usr/bin/env bash
# Bounded Stop-hook entry point. All validation and retry decisions are owned
# by stop_gate.py so a single Stop event can replay completion evidence at most
# once.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP_GATE_PY="${SCRIPT_DIR}/stop_gate.py"
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    if command -v cygpath >/dev/null 2>&1; then
      STOP_GATE_PY="$(cygpath -am "$STOP_GATE_PY")"
    fi
    ;;
esac
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

if [[ -n "${FORGEWRIGHT_PYTHON_BIN:-}" && -x "${FORGEWRIGHT_PYTHON_BIN}" ]] &&
  "${FORGEWRIGHT_PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
  exec "${FORGEWRIGHT_PYTHON_BIN}" "$STOP_GATE_PY" --platform "$PLATFORM" --typed-stop-decision
fi

for candidate in python3.13 python3.12 python3.11 python3 python; do
  python_executable="$(command -v "$candidate" 2>/dev/null || true)"
  if [[ -n "$python_executable" ]] &&
    "$python_executable" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
    exec "$python_executable" "$STOP_GATE_PY" --platform "$PLATFORM" --typed-stop-decision
  fi
done

python_launcher="$(command -v py.exe 2>/dev/null || command -v py 2>/dev/null || true)"
if [[ -n "$python_launcher" ]]; then
  for selector in -3.13 -3.12 -3.11 -3; do
    if "$python_launcher" "$selector" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
      exec "$python_launcher" "$selector" "$STOP_GATE_PY" --platform "$PLATFORM" --typed-stop-decision
    fi
  done
fi

printf '%s\n' 'Forgewright Stop requires Python 3.11 or newer.' >&2
exit 1
