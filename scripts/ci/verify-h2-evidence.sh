#!/usr/bin/env bash
# Stable aggregate verifier for H2 contract, runtime, and process E2E evidence.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/forgewright-h2-evidence.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
cd "$root"

npm --prefix mcp run build
python3 scripts/ci/verify-roadmap-completion.py \
  --only H0 --only H1 --only H2 \
  --report "$temporary/roadmap.json"
node tests/golden/runtime-smoke.test.mjs --skip-build
