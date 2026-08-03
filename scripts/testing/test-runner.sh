#!/usr/bin/env bash
# Stable shell entrypoint for the skill contract/live test executor.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$root/skills/_test/skill-test-executor.py" "$@"
