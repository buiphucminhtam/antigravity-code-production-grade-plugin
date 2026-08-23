#!/usr/bin/env bash
# Focused, provider-neutral verifier for the harness runtime upgrade.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

npm --prefix mcp test -- --reporter=basic --no-cache \
  src/runtime/harness-adapter.test.ts \
  src/runtime/lifecycle-lease.test.ts

python3 -m pytest -q -p no:cacheprovider \
  tests/lite/test_gate.py \
  tests/unit_tests/test_continuity_checkpoint.py

node scripts/ci/verify-clean-install.mjs
