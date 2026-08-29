#!/usr/bin/env bash
# Focused local verifier for structured usage and paired A/B receipts.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

tests=("$@")
if [[ ${#tests[@]} -eq 0 ]]; then
  tests=(
    src/cli/tests/bench-comparable.test.ts
    src/cli/tests/bench-runner.test.ts
  )
fi

cli_tests=()
for test_path in "${tests[@]}"; do
  if [[ "$test_path" != src/cli/* ]]; then
    echo "H5 verifier rejects test outside src/cli: $test_path" >&2
    exit 2
  fi
  cli_tests+=("${test_path#src/cli/}")
done

npm --prefix src/cli test -- --run "${cli_tests[@]}"
npm --prefix src/cli run typecheck
echo "H5 measurement/A-B verifier: PASS"
