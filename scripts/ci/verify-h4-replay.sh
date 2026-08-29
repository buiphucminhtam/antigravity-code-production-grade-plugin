#!/usr/bin/env bash
# Focused offline verifier for the provider-neutral H4 loop journal.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

tests=("$@")
if [[ ${#tests[@]} -eq 0 ]]; then
  tests=(
    tests/unit_tests/test_agent_loop_replay.py
    tests/unit_tests/test_forgewright_orchestrator.py
  )
fi

python3 -m pytest -q -p no:cacheprovider "${tests[@]}"
python3 -m ruff check \
  scripts/runtime/agent_loop_replay.py \
  scripts/runtime/forgewright-orchestrator.py \
  tests/unit_tests/test_agent_loop_replay.py \
  tests/unit_tests/test_forgewright_orchestrator.py
echo "H4 record/replay verifier: PASS"
