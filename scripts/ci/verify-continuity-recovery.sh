#!/usr/bin/env bash
# Deterministic proactive checkpoint, bounded continuation, and safe recovery verifier.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

run_check() {
  local name="$1"
  shift
  printf '\n==> continuity-recovery: %s\n' "$name"
  "$@"
}

run_check runtime-checkpoints \
  npm --prefix mcp test -- --no-cache \
    src/runtime/runtime-checkpoint.test.ts \
    src/runtime/mcp-runtime-lifecycle.test.ts \
    src/runtime/lifecycle-coordinator.test.ts \
    src/runtime/trajectory-ledger.test.ts

run_check agent-continuity \
  python3 -m pytest -q -p no:cacheprovider \
    tests/unit_tests/test_continuity_checkpoint.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py

run_check mcp-build npm --prefix mcp run build
run_check mcp-lint npm --prefix mcp run lint -- --no-cache
run_check mcp-format npm --prefix mcp run format:check
run_check python-lint \
  ruff check \
    scripts/memory/continuity.py \
    scripts/runtime/forgewright-orchestrator.py \
    tests/unit_tests/test_continuity_checkpoint.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py
run_check python-format \
  ruff format --check \
    scripts/memory/continuity.py \
    scripts/runtime/forgewright-orchestrator.py \
    tests/unit_tests/test_continuity_checkpoint.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py
run_check diff-check git diff --check
