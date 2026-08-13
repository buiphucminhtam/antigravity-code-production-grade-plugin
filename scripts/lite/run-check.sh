#!/usr/bin/env bash
# scripts/lite/run-check.sh
#
# Usage:
#   bash scripts/lite/run-check.sh [v2 metadata flags] -- <real-check-command>
#
# The Python runner owns option parsing so shell quoting and repeated metadata
# flags have one canonical implementation. It rejects missing metadata and
# trivial commands before starting the requested command.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/run_check.py" "$@"
