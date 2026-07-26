#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# test_runtime_p2_sim.sh — Accelerated lifecycle simulation for the reaper
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
# The P2 gate said "watch observe mode for a week, then decide". Waiting is not
# the only way to reach that decision: the states that matter (TTL expiry, a
# session that ended, a process that died, an adopted process, an infrastructure
# port) can all be constructed directly. This builds every one of them with
# BACKDATED timestamps and asserts what the reaper decides — including, above
# all, what it refuses to touch.
#
# Nothing outside the sandbox is ever signalled: every process here is this
# script's own `sleep`, and the registry is a temp file.
#
# Usage: bash tests/runtime/test_runtime_p2_sim.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
RT="$REPO_ROOT/scripts/runtime"
REAP="$RT/runtime-reap.sh"
LEASE="$RT/runtime-lease.sh"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rlg-p2.XXXXXX")"
export FORGEWRIGHT_RLG_HOME="$SANDBOX/rlg-home"
export NO_COLOR=1
mkdir -p "$FORGEWRIGHT_RLG_HOME"
printf 'observe\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
printf '# allowlist\n5432\t# postgres\n' > "$FORGEWRIGHT_RLG_HOME/port-allowlist.txt"

PID_FILE="$SANDBOX/spawned.pids"
cleanup() {
  local p
  [ -r "$PID_FILE" ] && while read -r p; do
    [ -n "$p" ] && { kill "$p" 2>/dev/null; kill -- "-$p" 2>/dev/null; }
  done < "$PID_FILE"
  sleep 0.3
  [ -r "$PID_FILE" ] && while read -r p; do
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  done < "$PID_FILE"
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; }
assert_eq() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected '$2', got '$1'"; fi; }
section()   { echo; echo "── $1"; }

# Detached spawn — models what dev-run.sh does (own process group, pgid == pid).
spawn() {
  python3 "$RT/rlg_spawn.py" --log /dev/null -- sleep 300 >/dev/null 2>&1 &
  local p=$!
  echo "$p" >> "$PID_FILE"
  # give setsid+exec a moment so `ps -o pgid=` reports the new group
  local i=0
  while [ "$i" -lt 20 ]; do
    [ "$(ps -o pgid= -p "$p" 2>/dev/null | tr -d " ")" = "$p" ] && break
    i=$((i+1)); sleep 0.05
  done
  echo "$p"
}

# Attached spawn — shares this script's process group, like an adopted process.
# Used to prove the reaper will NOT group-kill something it does not lead.
spawn_attached() { sleep 300 >/dev/null 2>&1 & local p=$!; echo "$p" >> "$PID_FILE"; echo "$p"; }

# Write a lease event directly, with a chosen timestamp — this is the time
# machine. `ts` is what the registry uses to compute TTL expiry.
mk_lease() { # <lease_id> <pid> <port> <policy> <ttl> <age_seconds> <session>
  local lid="$1" pid="$2" port="$3" policy="$4" ttl="$5" age="$6" sess="$7"
  local pgid; pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  LID="$lid" PID="$pid" PGID="${pgid:-0}" PORT="$port" POLICY="$policy" \
  TTL="$ttl" AGE="$age" SESS="$sess" \
  python3 - "$FORGEWRIGHT_RLG_HOME/leases.jsonl" <<'PY'
import json, os, sys, time
from datetime import datetime, timezone
ts = datetime.fromtimestamp(time.time() - int(os.environ["AGE"]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
rec = {
    "schema_version": "1", "lease_id": os.environ["LID"], "ts": ts, "event": "open",
    "project": "/tmp/simproj", "session_id": os.environ["SESS"], "role": "web-dev",
    "pid": int(os.environ["PID"]), "pgid": int(os.environ["PGID"]),
    "port": int(os.environ["PORT"]), "cmd": "sim", "log": "/dev/null",
    "ttl_sec": int(os.environ["TTL"]), "policy": os.environ["POLICY"], "reason": None,
}
with open(sys.argv[1], "a") as fh:
    fh.write(json.dumps(rec, sort_keys=True) + "\n")
PY
}

decision_for() { # <lease_id> — read the reaper's verdict from its JSON output
  bash "$REAP" --json 2>/dev/null | python3 -c '
import json, sys
lid = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    print("PARSE-ERROR"); sys.exit(0)
for it in d.get("items", []):
    if it.get("lease_id") == lid:
        print(it.get("decision")); sys.exit(0)
print("ABSENT")
' "$1"
}

# ══ build the population ═════════════════════════════════════════════════════
section "constructing a week's worth of lease states, backdated"

P_LIVE="$(spawn)";    mk_lease sim-live    "$P_LIVE"    20001 reap 7200 60    sess-current
P_EXPIRED="$(spawn)"; mk_lease sim-expired "$P_EXPIRED" 20002 reap 3600 90000 sess-old      # 25h old, 1h TTL
P_KEEP="$(spawn)";    mk_lease sim-keep    "$P_KEEP"    20003 keep 7200 90000 sess-old
P_INFRA="$(spawn)";   mk_lease sim-infra   "$P_INFRA"    5432 reap 3600 90000 sess-old      # allowlisted port
P_DEAD="$(spawn)";    mk_lease sim-dead    "$P_DEAD"    20005 reap 7200 60    sess-current
kill "$P_DEAD" 2>/dev/null; while kill -0 "$P_DEAD" 2>/dev/null; do sleep 0.05; done
ok "5 leases created: live / TTL-expired / policy=keep / allowlisted port / dead process"

# ══ decisions ════════════════════════════════════════════════════════════════
section "reaper decisions (dry-run)"
assert_eq "$(decision_for sim-live)"    "HOLD"           "live and inside TTL → HOLD"
assert_eq "$(decision_for sim-expired)" "REAP"           "25h old with a 1h TTL → REAP"
assert_eq "$(decision_for sim-keep)"    "SKIP-KEEP"      "policy=keep → never reaped, even when long expired"
assert_eq "$(decision_for sim-infra)"   "SKIP-ALLOWLIST" "allowlisted port → never reaped, even when leased+expired"
assert_eq "$(decision_for sim-dead)"    "PRUNE"          "process already gone → registry-only cleanup"

# ══ dry-run really is dry ════════════════════════════════════════════════════
section "dry-run touches nothing"
bash "$REAP" >/dev/null 2>&1
alive=0
for p in "$P_LIVE" "$P_EXPIRED" "$P_KEEP" "$P_INFRA"; do kill -0 "$p" 2>/dev/null && alive=$((alive+1)); done
assert_eq "$alive" "4" "all 4 surviving processes still alive after a dry-run"

# ══ observe mode refuses to execute ══════════════════════════════════════════
section "safety interlocks"
bash "$REAP" --execute >/dev/null 2>&1
assert_eq "$?" "1" "--execute is refused while MODE=observe"
kill -0 "$P_EXPIRED" 2>/dev/null
assert_eq "$?" "0" "the expired process survived the refused --execute"

printf 'x\n' > "$FORGEWRIGHT_RLG_HOME/DISABLED"
bash "$REAP" >/dev/null 2>&1
assert_eq "$?" "3" "kill-switch stops the reaper entirely"
rm -f "$FORGEWRIGHT_RLG_HOME/DISABLED"

# ══ enforce mode: the real thing, on our own sandbox processes ═══════════════
section "enforce mode reaps ONLY what it should"
printf 'enforce\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
bash "$REAP" --execute >/dev/null 2>&1
sleep 1

kill -0 "$P_EXPIRED" 2>/dev/null
assert_eq "$?" "1" "expired process WAS terminated"
kill -0 "$P_KEEP" 2>/dev/null
assert_eq "$?" "0" "policy=keep process untouched"
kill -0 "$P_INFRA" 2>/dev/null
assert_eq "$?" "0" "allowlisted-port process untouched"
kill -0 "$P_LIVE" 2>/dev/null
assert_eq "$?" "0" "live in-TTL process untouched"

open_now="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_now" "3" "registry closed the reaped and dead leases, kept the other 3"

# ══ a pid with no lease is never touched ════════════════════════════════════
section "unregistered processes are out of bounds"
P_FOREIGN="$(spawn)"
printf 'enforce\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
bash "$REAP" --execute >/dev/null 2>&1
sleep 0.5
kill -0 "$P_FOREIGN" 2>/dev/null
assert_eq "$?" "0" "process with no lease survives --execute (core invariant)"

# ══ never group-kill a group we do not lead ══════════════════════════════════
section "a lease whose pgid is a shared group must not take the group down"
P_ATT="$(spawn_attached)"
P_SIBLING="$(spawn_attached)"          # innocent bystander in the same group
mk_lease sim-attached "$P_ATT" 20021 reap 3600 90000 sess-old
printf 'enforce\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
bash "$REAP" --execute >/dev/null 2>&1
sleep 1
kill -0 "$P_ATT" 2>/dev/null
assert_eq "$?" "1" "the leased process itself was terminated"
kill -0 "$P_SIBLING" 2>/dev/null
assert_eq "$?" "0" "its process-group sibling survived (no blind kill -PGID)"

# ══ session-scoped reclaim ═══════════════════════════════════════════════════
section "session-scoped reclaim (what SessionEnd would do)"
P_S1="$(spawn)"; mk_lease sim-s1 "$P_S1" 20011 reap 7200 30 sess-ending
P_S2="$(spawn)"; mk_lease sim-s2 "$P_S2" 20012 reap 7200 30 sess-other
bash "$REAP" --session sess-ending --execute >/dev/null 2>&1
sleep 1
kill -0 "$P_S1" 2>/dev/null
assert_eq "$?" "1" "lease of the ending session was reaped"
kill -0 "$P_S2" 2>/dev/null
assert_eq "$?" "0" "another session's lease untouched"

# ══ the sweeper: throttle + mode interlock ═══════════════════════════════════
section "runtime-sweep.sh — throttled periodic reclaim"
SWEEP="$RT/runtime-sweep.sh"

printf 'observe\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
rm -f "$FORGEWRIGHT_RLG_HOME/last-sweep"
bash "$SWEEP" >/dev/null 2>&1
assert_eq "$?" "0" "sweep exits 0 in observe mode (hooks must never block)"
stamped=0; [ -e "$FORGEWRIGHT_RLG_HOME/last-sweep" ] && stamped=1
assert_eq "$stamped" "0" "observe mode does not even stamp — no reclaim happened"

P_SWEEP="$(spawn)"; mk_lease sim-sweep "$P_SWEEP" 20031 reap 3600 90000 sess-old
printf 'enforce\n' > "$FORGEWRIGHT_RLG_HOME/MODE"
bash "$SWEEP" >/dev/null 2>&1
sleep 2
kill -0 "$P_SWEEP" 2>/dev/null
assert_eq "$?" "1" "enforce mode: sweep reclaimed the expired lease"
stamped=0; [ -e "$FORGEWRIGHT_RLG_HOME/last-sweep" ] && stamped=1
assert_eq "$stamped" "1" "sweep wrote its throttle stamp"

P_SWEEP2="$(spawn)"; mk_lease sim-sweep2 "$P_SWEEP2" 20032 reap 3600 90000 sess-old
bash "$SWEEP" >/dev/null 2>&1
sleep 1.5
kill -0 "$P_SWEEP2" 2>/dev/null
assert_eq "$?" "0" "second sweep inside the interval is throttled (no reclaim)"

bash "$SWEEP" --now >/dev/null 2>&1
sleep 2
kill -0 "$P_SWEEP2" 2>/dev/null
assert_eq "$?" "1" "--now bypasses the throttle"

printf 'x\n' > "$FORGEWRIGHT_RLG_HOME/DISABLED"
P_SWEEP3="$(spawn)"; mk_lease sim-sweep3 "$P_SWEEP3" 20033 reap 3600 90000 sess-old
bash "$SWEEP" --now >/dev/null 2>&1
sleep 1
kill -0 "$P_SWEEP3" 2>/dev/null
assert_eq "$?" "0" "kill-switch stops the sweep even with --now"
rm -f "$FORGEWRIGHT_RLG_HOME/DISABLED"

echo
echo "════════════════════════════════════════"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
