#!/usr/bin/env bash
# Isolated behavioral smoke for the rule-compliance loop.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fw-rule-loop.XXXXXX")"
cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

export FORGEWRIGHT_RULE_LEDGER="$TEST_ROOT/rule-ledger.jsonl"
export FORGEWRIGHT_TELEMETRY_DIR="$TEST_ROOT/telemetry"
export FORGEWRIGHT_SKIP_MEM0=1
export FORGEWRIGHT_CONTEXT_CHAR_CAP=2000

telemetry_record="$(bash scripts/lite/telemetry.sh emit test.event '{"token":"must-not-leak","status":"ok"}')"
printf '%s' "$telemetry_record" | jq -e '.event == "test.event" and .data.token == "***REDACTED***"' >/dev/null
[[ "$telemetry_record" != *"must-not-leak"* ]]

bash scripts/lite/rule-ledger.sh add HR1-verify hit "isolated pass" >/dev/null
bash scripts/lite/rule-ledger.sh add HR2-impact violation "isolated violation" >/dev/null
top_output="$(bash scripts/lite/rule-ledger.sh top 3 violation)"
[[ "$top_output" == *"HR2-impact"* ]]
[[ "$top_output" != *"HR1-verify"* ]]
bash scripts/lite/rule-refresh.sh >/dev/null

python3 scripts/lite/rule-validator.py --static >/dev/null
git -C "$TEST_ROOT" init -q -b main
git -C "$TEST_ROOT" config user.email test@forgewright.local
git -C "$TEST_ROOT" config user.name "Forgewright Test"
mkdir -p "$TEST_ROOT/checks"
printf '%s\n' "print('isolated-check passed')" > "$TEST_ROOT/checks/isolated_check.py"
git -C "$TEST_ROOT" add checks/isolated_check.py
git -C "$TEST_ROOT" commit -qm init

validator_response="$({
  cd "$TEST_ROOT"
  python3 "$PROJECT_ROOT/scripts/lite/run_check.py" \
    --turn isolated-validator \
    --acceptance 'isolated-validator=isolated rule validation is correlated' \
    --tier contract \
    --test-ref checks/isolated_check.py \
    --negative-path 'missing exact-turn evidence is rejected' \
    --limitations '' \
    --change-kind test \
    --phase verification \
    --implementer-id isolated-implementer \
    --reviewer-status not_required \
    -- python3 checks/isolated_check.py
})"
export FORGEWRIGHT_WORKSPACE="$TEST_ROOT"
export FORGEWRIGHT_TURN=isolated-validator
printf '%s' "$validator_response" \
  | python3 scripts/lite/rule-validator.py --runtime >/dev/null
if printf '%s\n' 'CLAIM: incomplete' 'VERDICT: PASS' \
    | python3 scripts/lite/rule-validator.py --runtime >/dev/null 2>&1; then
  echo "Expected incomplete VERIFY block to fail." >&2
  exit 1
fi
unset FORGEWRIGHT_WORKSPACE FORGEWRIGHT_TURN

python3 scripts/lite/context-manager.py load --keywords "rule compliance" > "$TEST_ROOT/context.txt"
[[ "$(wc -c < "$TEST_ROOT/context.txt" | tr -d ' ')" -le 2000 ]]

bash scripts/lite/policy-check.sh check run_command "git status --short" >/dev/null
if bash scripts/lite/policy-check.sh check run_command "command git -C . reset --hard" >/dev/null 2>&1; then
  echo "Expected destructive wrapped command to be denied." >&2
  exit 1
fi

echo "Rule compliance loop behavioral checks passed."
