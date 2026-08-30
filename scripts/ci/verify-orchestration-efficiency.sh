#!/usr/bin/env bash
# Focused aggregate verifier for progressive Lite routing and benchmark records.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# MCP middleware tests append runtime-only quality events below the package cwd.
# Preserve the caller's exact state so this verifier can be replayed without
# invalidating the worktree fingerprint it is meant to prove.
metrics_file="$root/mcp/.forgewright/quality-gate-events.jsonl"
metrics_snapshot="$(mktemp)"
metrics_existed=false
if [[ -f "$metrics_file" ]]; then
  cp "$metrics_file" "$metrics_snapshot"
  metrics_existed=true
fi

restore_runtime_metrics() {
  if [[ "$metrics_existed" == true ]]; then
    mkdir -p "$(dirname "$metrics_file")"
    cp "$metrics_snapshot" "$metrics_file"
  else
    rm -f "$metrics_file"
  fi
  rm -f "$metrics_snapshot"
}
trap restore_runtime_metrics EXIT

run_check() {
  local name="$1"
  shift
  printf '\n==> orchestration-efficiency: %s\n' "$name"
  "$@"
}

run_check skill-routing \
  python3 -m pytest -q -p no:cacheprovider \
    tests/unit_tests/test_skill_routing_runtime.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_parallel_dispatch_runner.py \
    tests/unit_tests/test_subagent_model_routing_config.py \
    tests/unit_tests/test_senior_execution_contract.py
run_check on-demand-skill-overlays \
  npm --prefix mcp test -- \
    --run \
      src/parsers/skill-parser.test.ts \
      src/index.test.ts \
      src/api/prompts.test.ts \
      src/api/tools.gateway.test.ts \
      src/runtime/harness-adapter.test.ts \
      src/runtime/visual-game-harness.test.ts \
    --no-cache
run_check mcp-skill-overlay-build npm --prefix mcp run build
run_check benchmark-records \
  npm --prefix src/cli test -- \
    --run bench-runner bench-comparable bench-metrics --no-cache
run_check cli-typecheck npm --prefix src/cli run typecheck
run_check python-lint \
  ruff check \
    scripts/runtime/skill_routing.py \
    scripts/runtime/execution_contract.py \
    scripts/runtime/forgewright-orchestrator.py \
    scripts/parallel-dispatch-runner.py \
    tests/unit_tests/test_skill_routing_runtime.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_parallel_dispatch_runner.py \
    tests/unit_tests/test_subagent_model_routing_config.py
run_check python-format \
  ruff format --check \
    scripts/runtime/skill_routing.py \
    scripts/runtime/execution_contract.py \
    scripts/runtime/forgewright-orchestrator.py \
    scripts/parallel-dispatch-runner.py \
    tests/unit_tests/test_skill_routing_runtime.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_parallel_dispatch_runner.py \
    tests/unit_tests/test_subagent_model_routing_config.py
run_check typescript-format \
  npx --prefix mcp prettier --check \
    mcp/src/parsers/skill-parser.ts \
    mcp/src/parsers/skill-parser.test.ts \
    mcp/src/api/prompts.ts \
    mcp/src/api/prompts.test.ts \
    mcp/src/api/tools.ts \
    mcp/src/api/tools.gateway.test.ts \
    mcp/src/runtime/visual-game-harness.ts \
    mcp/src/runtime/visual-game-harness.test.ts \
    src/cli/src/bench/types.ts \
    src/cli/src/bench/runner.ts \
    src/cli/src/bench/compare.ts \
    src/cli/tests/bench-comparable.test.ts
run_check verifier-shellcheck \
  shellcheck scripts/ci/verify-orchestration-efficiency.sh
run_check canonical-state \
  python3 -m pytest -q -p no:cacheprovider \
    tests/unit_tests/test_docs_project_state_schema.py \
    tests/unit_tests/test_documentation_governance_protocol.py
run_check kernel-token-budget bash scripts/lite/test-kernel-tokens.sh
run_check docs-gate \
  npm --prefix src/cli exec -- tsx src/cli/src/index.ts docs gate . --worktree --json
run_check diff-check git diff --check
