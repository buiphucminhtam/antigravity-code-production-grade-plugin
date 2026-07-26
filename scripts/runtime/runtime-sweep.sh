#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-sweep.sh — Throttled periodic reclaim, wired to the Stop hook
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P2)
#
# WHY A TTL SWEEP INSTEAD OF SESSION-END RECLAIM
#   The original design reclaimed at SessionEnd. Checking the three CLIs' live
#   configs showed none of them actually has a SessionEnd hook wired: Claude and
#   Codex expose `Stop`, Antigravity's registry only takes `PreToolUse`. Guessing
#   an event name that does not exist yields a hook that silently never runs —
#   worse than not wiring one.
#
#   So reclaim is driven by lease TTL instead, on the `Stop` hook. That is
#   strictly more robust:
#     • it does not depend on any session lifecycle event existing
#     • it reclaims leaks from a session that CRASHED (no clean end ever fires)
#     • the registry is machine-global, so a sweep from any CLI reclaims leases
#       opened by every CLI — Antigravity gets covered without its own hook
#
#   The trade: a leaked server lives until its TTL (default 2h, per-launch via
#   `dev-run.sh --ttl`) rather than dying the instant a session ends.
#
# THIS NEVER PASSES --session. Session-scoped reclaim kills a session's leases
# regardless of TTL, which is only correct at a true session end. On a per-turn
# hook it would kill a dev server the user just started.
#
# Runs the reaper in the BACKGROUND and returns immediately: the Stop hook must
# not add latency, and reaping can take a grace period per process.
#
# Usage: runtime-sweep.sh [--interval SECONDS] [--now] [--status]
# Exit: always 0 — a hook must never block the CLI.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh" 2>/dev/null || exit 0

REAPER="${SCRIPT_DIR}/runtime-reap.sh"
INTERVAL="${FORGEWRIGHT_RLG_SWEEP_INTERVAL:-300}"
FORCE_NOW=0
STATUS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="${2:-300}"; shift 2 ;;
    --now)      FORCE_NOW=1; shift ;;
    --status)   STATUS=1; shift ;;
    --help|-h)  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

STAMP="$(rlg_home)/last-sweep"

if [ "$STATUS" -eq 1 ]; then
  age="$(rlg_file_age_secs "$STAMP" 2>/dev/null)"
  echo "mode:      $(rlg_mode)"
  echo "interval:  ${INTERVAL}s"
  echo "last sweep: ${age:-never}${age:+s ago}"
  exit 0
fi

# Kill-switch and mode. A sweep that can kill must never run while the guard is
# only meant to be watching.
rlg_enabled || exit 0
[ "$(rlg_mode)" = "enforce" ] || exit 0
[ -x "$REAPER" ] || [ -r "$REAPER" ] || exit 0

# Throttle: at most one sweep per interval, no matter how many turns end.
if [ "$FORCE_NOW" -eq 0 ] && [ -e "$STAMP" ]; then
  age="$(rlg_file_age_secs "$STAMP" 2>/dev/null)"
  if [ -n "$age" ] && [ "$age" -lt "$INTERVAL" ]; then
    exit 0
  fi
fi

rlg_init_dirs 2>/dev/null || exit 0
: > "$STAMP" 2>/dev/null

# Background, detached, output to the sweep log. Deliberately no --session.
# A reclaim that actually had something to reclaim means a lease leaked — record
# it in the rule ledger so the self-healing loop sees the pattern rather than
# the leak being silently cleaned up forever.
{
  out="$(bash "$REAPER" --execute 2>&1)"
  printf '%s\n' "$out" >> "$(rlg_home)/sweep.log"
  case "$out" in
    *"REAP "*)
      ledger="${FORGEWRIGHT_ROOT:-$HOME/GitHub/forgewright}/scripts/lite/rule-ledger.sh"
      [ -r "$ledger" ] && bash "$ledger" add RLG-01 violation \
        "leaked lease reclaimed by TTL sweep" >/dev/null 2>&1
      ;;
  esac
} &

exit 0
