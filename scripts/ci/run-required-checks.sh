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

run_docs_continuity() {
  local base_ref="${FORGEWRIGHT_DOCS_BASE_REF:-}"
  if [[ -z "$base_ref" ]] \
    && git rev-parse --verify --quiet origin/main >/dev/null \
    && ! git diff --quiet origin/main...HEAD; then
    base_ref="origin/main"
  fi

  if [[ -n "$base_ref" ]]; then
    node src/cli/dist/index.js docs gate . --base-ref "$base_ref" --json
  else
    node src/cli/dist/index.js docs gate . --worktree --json
  fi
}

run_required product-truth python3 scripts/ci/verify-product-truth.py
run_required roadmap-completion-evidence npm run verify:roadmap
run_required stop-gate-regression python3 -m pytest -q tests/lite/test_gate.py
run_required continuity-regression python3 -m pytest -q tests/unit_tests/test_continuity_checkpoint.py
run_required python-unit-tests python3 -m pytest tests/unit_tests/
run_required adversarial-weak-model-rails python3 evals/adversarial-weak-model/run-evals.py --self-test
run_required root-production-audit npm audit --package-lock-only --omit=dev --audit-level=high
run_required standalone-mcp-production-audit npm --prefix mcp audit --package-lock-only --omit=dev --workspaces=false --audit-level=high
run_required mcp-lint npm --prefix mcp run lint
run_required mcp-format npm --prefix mcp run format:check
run_required mcp-build npm --prefix mcp run build
run_required mcp-tests npm --prefix mcp run test
run_required harness-lifecycle-contract npm --prefix mcp test -- src/runtime/harness-adapter.test.ts src/runtime/lifecycle-lease.test.ts
run_required harness-upgrade-evidence bash scripts/ci/verify-harness-upgrade.sh
run_required mcp-coverage npm --prefix mcp run test:coverage
run_required mcp-launcher-security bash tests/test-forgewright-mcp-launcher.sh
run_required mcp-setup bash tests/setup/test-forgewright-mcp-setup.sh
run_required hook-installation bash tests/test_hooks.sh
run_required runtime-lifecycle-guard bash scripts/ci/verify-runtime-leases.sh
run_required cli-tests npm --prefix src/cli test
run_required cli-build npm run build:cli
run_required docs-continuity run_docs_continuity
run_required cli-init-onboard-golden npm run test:golden
run_required release-evidence-policy-tests node --test scripts/ci/release-evidence-policy.test.mjs
run_required release-supply-chain-policy-tests node --test scripts/ci/release-supply-chain-policy.test.mjs
run_required local-automation-policy python3 scripts/ci/verify-local-automation-policy.py
run_required release-evidence node scripts/ci/verify-release-evidence.mjs
run_required clean-install-evidence node scripts/ci/verify-clean-install.mjs
