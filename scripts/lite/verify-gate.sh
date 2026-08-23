#!/usr/bin/env bash
# Compatibility wrapper for direct verify-gate callers. The same canonical
# engine serves Stop hooks and this CLI; the wrapper intentionally does not add
# a second evidence replay.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/stop_gate.py" "$@"
