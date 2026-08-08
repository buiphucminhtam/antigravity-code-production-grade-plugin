#!/usr/bin/env bash
# Deterministic aggregate gate: each required suite is invoked here; set -e
# means a missing executable, failed suite, or skipped command fails the gate.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

run_required() {
  local name="$1"
  shift
  printf '\n==> required: %s\n' "$name"
  "$@"
}

run_required product-truth python3 scripts/ci/verify-product-truth.py
run_required python-unit-tests python3 -m pytest tests/unit_tests/
run_required adversarial-weak-model-rails python3 evals/adversarial-weak-model/run-evals.py --self-test
run_required mcp-lint npm --prefix mcp run lint
run_required mcp-format npm --prefix mcp run format:check
run_required mcp-build npm --prefix mcp run build
run_required mcp-tests npm --prefix mcp run test
run_required mcp-coverage npm --prefix mcp run test:coverage
run_required mcp-launcher-security bash tests/test-forgewright-mcp-launcher.sh
run_required mcp-setup bash tests/setup/test-forgewright-mcp-setup.sh
run_required hook-installation bash tests/test_hooks.sh
run_required runtime-lifecycle-guard bash scripts/ci/verify-runtime-leases.sh
run_required cli-tests npm --prefix src/cli test
run_required cli-init-onboard-golden npm run test:golden
run_required release-evidence-policy-tests node --test scripts/ci/release-evidence-policy.test.mjs
run_required release-supply-chain-policy-tests node --test scripts/ci/release-supply-chain-policy.test.mjs
run_required supply-chain-policy node scripts/ci/verify-supply-chain-policy.mjs
run_required release-evidence node scripts/ci/verify-release-evidence.mjs
run_required clean-install-evidence node scripts/ci/verify-clean-install.mjs
