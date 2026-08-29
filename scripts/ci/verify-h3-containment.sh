#!/usr/bin/env bash
# Deterministic H3 application-containment verifier.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/forgewright-h3-containment.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
cd "$root"

run_check() {
  local name="$1"
  shift
  printf '\n==> h3-containment: %s\n' "$name"
  "$@"
}

run_check mcp-contract \
  npm --prefix mcp test -- --no-cache \
    src/runtime/execution-containment.test.ts \
    src/runtime/tool-execution-gateway.test.ts \
    src/infrastructure/adapters/FileSystemStateRepository.test.ts \
    src/infrastructure/adapters/HttpWebhookEventPublisher.test.ts \
    src/state/rpc-client.test.ts \
    src/middleware/guardrail.test.ts \
    src/index.test.ts

run_check python-filesystem-plane \
  python3 -m pytest -q -p no:cacheprovider \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py

run_check mcp-build npm --prefix mcp run build

mkdir -p "$temporary/workspace/.forgewright"
cp .forgewright/execution-policy.yaml "$temporary/workspace/.forgewright/execution-policy.yaml"
set +e
FORGEWRIGHT_WORKSPACE="$temporary/workspace" \
FORGEWRIGHT_RUNTIME_MODE=production \
  node mcp/build/index.js </dev/null >"$temporary/production.log" 2>&1
production_status=$?
set -e
if [[ "$production_status" -eq 0 ]]; then
  echo "production startup unexpectedly accepted missing caller identity" >&2
  exit 1
fi
if ! grep -q 'RUNTIME_TRUST_CONTEXT_INVALID' "$temporary/production.log"; then
  echo "production startup failed without the required trust-context denial" >&2
  sed -n '1,80p' "$temporary/production.log" >&2
  exit 1
fi
printf 'production_missing_identity=denied\n'

run_check mcp-lint npm --prefix mcp run lint -- --no-cache
run_check mcp-format npm --prefix mcp run format:check
run_check python-lint \
  ruff check \
    scripts/runtime/forgewright-orchestrator.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py
run_check python-format \
  ruff format --check \
    scripts/runtime/forgewright-orchestrator.py \
    tests/unit_tests/test_forgewright_orchestrator.py \
    tests/unit_tests/test_skill_routing_runtime.py
run_check diff-check git diff --check
