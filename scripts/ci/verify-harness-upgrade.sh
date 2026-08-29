#!/usr/bin/env bash
# Focused, provider-neutral verifier for the harness runtime upgrade.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

npm --prefix mcp test -- --reporter=basic --no-cache \
  src/runtime/harness-adapter.test.ts \
  src/runtime/lifecycle-lease.test.ts \
  src/runtime/trajectory-ledger.test.ts \
  src/runtime/lifecycle-coordinator.test.ts \
  src/runtime/mcp-runtime-lifecycle.test.ts \
  src/runtime/tool-execution-gateway.test.ts \
  src/api/tools.gateway.test.ts

npm --prefix mcp run build
node tests/golden/runtime-smoke.test.mjs --skip-build

python3 -m pytest -q -p no:cacheprovider \
  tests/lite/test_gate.py \
  tests/unit_tests/test_continuity_checkpoint.py \
  tests/unit_tests/test_agent_loop_replay.py

bash scripts/ci/verify-h4-replay.sh

node scripts/ci/verify-clean-install.mjs
