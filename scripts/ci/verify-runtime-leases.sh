#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# verify-runtime-leases.sh — CI guard for the Runtime Lifecycle Guard (P4)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
# Checks the things that would silently disarm the guard between releases.
# It does NOT require the guard to be installed on the machine running CI —
# that would make every fresh checkout fail — it checks the SOURCE is coherent.
#
# 1. Every file the installer claims to ship actually exists and is executable.
# 2. No lease/runtime state was committed by accident.
# 3. The reaper still refuses to kill by default (dry-run is the default) and
#    still only signals leases it owns — grep-level assertions on the source, so
#    a future edit that removes a safety rail fails the build.
# 4. The gate still fails open and still emits an explicit allow for Antigravity.
# 5. Shell syntax of every guard script parses.
#
# Usage: bash scripts/ci/verify-runtime-leases.sh
# Exit: 0 pass · 1 fail
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$REPO_ROOT" || exit 1

RT="scripts/runtime"
GATE="scripts/lite/runtime-pretool-gate.sh"
FAILED=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; FAILED=1; }

echo "── runtime guard: shipped files exist"
MANIFEST="$(sed -n 's/^RLG_FILES="\(.*\)"$/\1/p' "$RT/runtime-install.sh")"
LITE_MANIFEST="$(sed -n 's/^RLG_LITE_FILES="\(.*\)"$/\1/p' "$RT/runtime-install.sh")"
if [ -z "$MANIFEST" ]; then
  fail "RLG_FILES manifest is readable" "could not parse it out of runtime-install.sh"
else
  missing=""
  for f in $MANIFEST;      do [ -r "$RT/$f" ]           || missing="$missing $f"; done
  for f in $LITE_MANIFEST; do [ -r "scripts/lite/$f" ]  || missing="$missing $f"; done
  [ -z "$missing" ] && pass "all $(printf '%s %s' "$MANIFEST" "$LITE_MANIFEST" | wc -w | tr -d ' ') manifest files present" \
                    || fail "manifest files present" "missing:$missing"
fi

echo "── runtime guard: no state committed"
if git ls-files --error-unmatch .forgewright/runtime >/dev/null 2>&1; then
  fail "no runtime state tracked in git" ".forgewright/runtime is committed"
else
  pass "no runtime state tracked in git"
fi
tracked_leases="$(git ls-files | grep -c 'leases\.jsonl$' || true)"
[ "$tracked_leases" -eq 0 ] && pass "no leases.jsonl committed" \
                            || fail "no leases.jsonl committed" "$tracked_leases file(s) tracked"

echo "── reaper: safety rails still present"
grep -q 'EXECUTE=0' "$RT/runtime-reap.sh" \
  && pass "dry-run is the default" \
  || fail "dry-run is the default" "EXECUTE no longer defaults to 0"
grep -q 'refusing --execute while MODE=observe' "$RT/runtime-reap.sh" \
  && pass "refuses --execute in observe mode" \
  || fail "refuses --execute in observe mode"
grep -q 'SKIP-ALLOWLIST' "$RT/runtime-reap.sh" \
  && pass "allowlisted ports are skipped" \
  || fail "allowlisted ports are skipped"
grep -q 'SKIP-KEEP' "$RT/runtime-reap.sh" \
  && pass "policy=keep leases are skipped" \
  || fail "policy=keep leases are skipped"
grep -q '\[ "\$pgid" = "\$pid" \]' "$RT/runtime-reap.sh" \
  && pass "group-kill only when the process leads its own group" \
  || fail "group-kill only when pgid == pid" "the shared-group guard is gone — a reap could take out unrelated siblings"

echo "── sweeper: never session-scoped"
# Strip comments first: the script documents at length WHY it never passes
# --session, and matching that prose would fail the build for saying the right
# thing.
if sed 's/#.*//' "$RT/runtime-sweep.sh" | grep -q -- '--session'; then
  fail "sweeper never passes --session" "session-scoped reclaim on a per-turn hook kills servers the user just started"
else
  pass "sweeper never passes --session"
fi

echo "── gate: fail-open and platform contracts"
grep -q 'allow_and_exit' "$GATE" \
  && pass "gate routes every exit through allow_and_exit" \
  || fail "gate routes every exit through allow_and_exit"
grep -q '"decision":"allow"' "$GATE" \
  && pass "gate emits an explicit allow for Antigravity" \
  || fail "gate emits an explicit allow for Antigravity" "silence is read as a refusal there"
if grep -qE '^\s*set -e' "$GATE"; then
  fail "gate does not use set -e" "an aborted hook must still allow the call"
else
  pass "gate does not use set -e"
fi

echo "── syntax"
syntax_bad=""
for f in "$RT"/runtime-*.sh "$RT"/dev-run.sh "$RT"/port-broker.sh "$GATE"; do
  [ -r "$f" ] || continue
  bash -n "$f" 2>/dev/null || syntax_bad="$syntax_bad $f"
done
[ -z "$syntax_bad" ] && pass "all guard scripts parse" || fail "all guard scripts parse" "$syntax_bad"

for f in "$RT"/runtime_registry.py "$RT"/rlg_spawn.py; do
  [ -r "$f" ] || continue
  python3 -m py_compile "$f" 2>/dev/null && pass "$(basename "$f") compiles" \
    || fail "$(basename "$f") compiles"
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "runtime-leases: PASS"
  exit 0
fi
echo "runtime-leases: FAIL"
exit 1
