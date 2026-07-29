#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# test_runtime_p1.sh — Runtime Lifecycle Guard, P1 (SPAWN) test suite
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
# Isolated: FORGEWRIGHT_RLG_HOME points into a temp dir. Real servers ARE
# started (that is the point), but only on this project's own brokered band,
# and every one of them is killed on exit.
#
# Usage: bash tests/runtime/test_runtime_p1.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
RT="$REPO_ROOT/scripts/runtime"
LEASE="$RT/runtime-lease.sh"
BROKER="$RT/port-broker.sh"
DEVRUN="$RT/dev-run.sh"
SPAWNER="$RT/rlg_spawn.py"
GATE="$REPO_ROOT/scripts/lite/runtime-pretool-gate.sh"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rlg-p1.XXXXXX")"
export FORGEWRIGHT_RLG_HOME="$SANDBOX/rlg-home"
export FORGEWRIGHT_SESSION_ID="p1-session-$$"
export NO_COLOR=1

PID_FILE="$SANDBOX/spawned.pids"   # see P0 suite: a shell array would be lost
                                   # in the subshell of $(...)
cleanup() {
  local p
  if [ -r "$PID_FILE" ]; then
    while read -r p; do
      [ -n "$p" ] || continue
      kill "$p" 2>/dev/null
      kill -- "-$p" 2>/dev/null   # detached children are group leaders
    done < "$PID_FILE"
    sleep 0.3
    while read -r p; do
      [ -n "$p" ] || continue
      kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    done < "$PID_FILE"
  fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; }
assert_eq()       { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected '$2', got '$1'"; fi; }
assert_rc()       { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected rc=$2, got rc=$1"; fi; }
assert_contains() { case "$1" in *"$2"*) ok "$3" ;; *) bad "$3" "missing '$2' in: ${1:0:120}" ;; esac; }
section()         { echo; echo "── $1"; }

track() { echo "$1" >> "$PID_FILE"; }

PROJ="$SANDBOX/webproj"; mkdir -p "$PROJ"

# ══ 1. rlg_spawn: detachment ═════════════════════════════════════════════════
section "rlg_spawn.py — new process group (macOS has no setsid)"

python3 "$SPAWNER" --log "$SANDBOX/spawn.log" -- sleep 60 &
SPAWN_PID=$!
track "$SPAWN_PID"
sleep 0.4
if kill -0 "$SPAWN_PID" 2>/dev/null; then
  ok "spawned process is alive"
  SPAWN_PGID="$(ps -o pgid= -p "$SPAWN_PID" 2>/dev/null | tr -d ' ')"
  assert_eq "$SPAWN_PGID" "$SPAWN_PID" "pid == pgid → it leads its own group (killable as a tree)"
else
  bad "spawned process is alive" "died immediately"
  bad "pid == pgid" "no process"
fi

python3 "$SPAWNER" --log "$SANDBOX/exec-fail.log" -- definitely-not-a-real-binary-xyz >/dev/null 2>&1
assert_rc "$?" "127" "exec failure reports 127"
grep -q "cannot exec" "$SANDBOX/exec-fail.log" 2>/dev/null
assert_rc "$?" "0" "exec failure is written to the log, not swallowed"

# ══ 2. port-broker ═══════════════════════════════════════════════════════════
section "port-broker — FREE / REUSE / BUSY"

PORT_WEB="$(bash "$LEASE" port --role web-dev --project "$PROJ" 2>/dev/null | tr -d '\n')"
[ -n "$PORT_WEB" ] && ok "brokered a port for the project ($PORT_WEB)" || bad "brokered a port"

status="$(bash "$BROKER" check --port "$PORT_WEB" 2>/dev/null | cut -f1)"
assert_eq "$status" "FREE" "check reports FREE on an idle port"

alloc="$(bash "$BROKER" alloc --role web-dev --project "$PROJ" 2>/dev/null)"
assert_eq "$(printf '%s' "$alloc" | cut -f1)" "FREE" "alloc reports FREE when nothing listens"
assert_eq "$(printf '%s' "$alloc" | cut -f2)" "$PORT_WEB" "alloc returns the project's stable port"

# Occupy the port WITHOUT a lease → foreign process.
python3 -m http.server "$PORT_WEB" --bind 127.0.0.1 >/dev/null 2>&1 &
FOREIGN_PID=$!
track "$FOREIGN_PID"
for _ in $(seq 1 40); do
  [ "$(bash "$BROKER" check --port "$PORT_WEB" 2>/dev/null | cut -f1)" = "LISTEN" ] && break
  sleep 0.25
done
status="$(bash "$BROKER" check --port "$PORT_WEB" 2>/dev/null | cut -f1)"
assert_eq "$status" "LISTEN" "check sees the occupied port"

alloc="$(bash "$BROKER" alloc --role web-dev --project "$PROJ" 2>/dev/null)"; rc=$?
assert_eq "$(printf '%s' "$alloc" | cut -f1)" "BUSY" "listening + no lease → BUSY (never assume it is ours)"
assert_rc "$rc" "1" "BUSY exits non-zero"

# Adopt it → now the same port must read as REUSE.
bash "$LEASE" adopt --pid "$FOREIGN_PID" --port "$PORT_WEB" --role web-dev --project "$PROJ" >/dev/null 2>&1
alloc="$(bash "$BROKER" alloc --role web-dev --project "$PROJ" 2>/dev/null)"
assert_eq "$(printf '%s' "$alloc" | cut -f1)" "REUSE" "listening + lease → REUSE"
assert_eq "$(printf '%s' "$alloc" | cut -f3)" "$FOREIGN_PID" "REUSE reports the owning pid"

kill "$FOREIGN_PID" 2>/dev/null
sleep 0.5
bash "$LEASE" prune >/dev/null 2>&1

# ══ 3. dev-run: the anti-spam core ═══════════════════════════════════════════
section "dev-run — starting the same thing twice must not start it twice"

PORT_API="$(bash "$LEASE" port --role api --project "$PROJ" 2>/dev/null | tr -d '\n')"

out1="$(bash "$DEVRUN" --role api --project "$PROJ" --ttl 10m --timeout 20 --json \
        -- python3 -m http.server "$PORT_API" --bind 127.0.0.1 2>/dev/null)"
pid1="$(printf '%s' "$out1" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("pid",""))' 2>/dev/null)"
[ -n "$pid1" ] && track "$pid1"

assert_contains "$out1" '"reused":false' "first run actually starts the server"
ready1="$(printf '%s' "$out1" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ready"))' 2>/dev/null)"
assert_eq "$ready1" "True" "health probe confirms the port answers"

open_after_first="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_after_first" "1" "exactly one open lease"

# Run the identical command four more times.
for _ in 1 2 3 4; do
  outN="$(bash "$DEVRUN" --role api --project "$PROJ" --json \
          -- python3 -m http.server "$PORT_API" --bind 127.0.0.1 2>/dev/null)"
done
assert_contains "$outN" '"reused":true' "repeat runs report reused=true"
pidN="$(printf '%s' "$outN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("pid",""))' 2>/dev/null)"
assert_eq "$pidN" "$pid1" "repeat runs hand back the ORIGINAL pid"

open_after_five="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_after_five" "1" "5 invocations → still exactly 1 lease (spam contained)"

listeners="$(lsof -nP -iTCP:"$PORT_API" -sTCP:LISTEN -t 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "$listeners" "1" "5 invocations → exactly 1 listening process"

log_path="$(printf '%s' "$out1" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("log",""))' 2>/dev/null)"
[ -f "$log_path" ] && ok "log file created under the guard's log dir" || bad "log file created" "$log_path"

# ══ 4. dev-run: fail-open ════════════════════════════════════════════════════
section "dev-run — fail-open when the guard is off"

marker="$SANDBOX/ran-unmanaged.txt"
FORGEWRIGHT_RLG=off bash "$DEVRUN" --role docs --project "$PROJ" \
  -- /bin/sh -c "echo ok > '$marker'" >/dev/null 2>&1
sleep 0.3
[ -f "$marker" ] && ok "guard disabled → command still runs (never blocks work)" \
                 || bad "guard disabled → command still runs" "marker not created"

# ══ 5. gate hook ═════════════════════════════════════════════════════════════
section "PreToolUse gate — observe mode"

GATELOG="$FORGEWRIGHT_RLG_HOME/gate.log"
: > "$GATELOG"
mk_payload() { printf '{"session_id":"s","cwd":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$PROJ" "$1"; }

before="$(wc -l < "$GATELOG" 2>/dev/null | tr -d ' ')"
mk_payload "git status --short" | bash "$GATE" >/dev/null 2>&1
assert_rc "$?" "0" "non-matching command → rc 0"
after="$(wc -l < "$GATELOG" 2>/dev/null | tr -d ' ')"
assert_eq "$after" "$before" "non-matching command is not logged (fast reject)"

mk_payload "npm run dev" | bash "$GATE" >/dev/null 2>&1
after="$(wc -l < "$GATELOG" 2>/dev/null | tr -d ' ')"
assert_eq "$after" "$((before + 1))" "dev-server command IS logged"
assert_contains "$(tail -1 "$GATELOG")" "npm run dev" "log records the command"

printf '{"session_id":"s","cwd":"%s","tool_name":"Bash",\n"tool_input":{"command":"vite --host"}}' "$PROJ" | bash "$GATE" >/dev/null 2>&1
assert_contains "$(tail -1 "$GATELOG")" "vite" "multi-line payload parses (bash 3.2 read -d '')"

before="$(wc -l < "$GATELOG" | tr -d ' ')"
mk_payload "npm run dev" | FORGEWRIGHT_RLG=off bash "$GATE" >/dev/null 2>&1
assert_eq "$(wc -l < "$GATELOG" | tr -d ' ')" "$before" "kill-switch tier 1 silences the gate"

touch "$FORGEWRIGHT_RLG_HOME/DISABLED"
mk_payload "npm run dev" | bash "$GATE" >/dev/null 2>&1
assert_eq "$(wc -l < "$GATELOG" | tr -d ' ')" "$before" "kill-switch tier 2 silences the gate"
rm -f "$FORGEWRIGHT_RLG_HOME/DISABLED"

mkdir -p "$PROJ/.forgewright" && touch "$PROJ/.forgewright/rlg-optout"
mk_payload "npm run dev" | bash "$GATE" >/dev/null 2>&1
assert_eq "$(wc -l < "$GATELOG" | tr -d ' ')" "$before" "kill-switch tier 3 (project opt-out) silences the gate"
rm -f "$PROJ/.forgewright/rlg-optout"

# Non-Bash tools must be ignored entirely.
printf '{"tool_name":"Read","tool_input":{"file_path":"/tmp/npm run dev"}}' | bash "$GATE" >/dev/null 2>&1
assert_eq "$(wc -l < "$GATELOG" | tr -d ' ')" "$before" "non-Bash tool calls are ignored"

# Latency budget (plan §G4: p95 < 100ms), measured on the reject path.
p="$(mk_payload 'git status')"
: > "$SANDBOX/times.txt"
now_ns() {
  local timestamp
  timestamp="$(date +%s%N 2>/dev/null)"
  case "$timestamp" in
    ''|*[!0-9]*) python3 -c 'import time; print(time.monotonic_ns())' ;;
    *) printf '%s\n' "$timestamp" ;;
  esac
}
for _ in $(seq 1 30); do
  t0="$(now_ns)"
  printf '%s' "$p" | bash "$GATE" >/dev/null 2>&1
  t1="$(now_ns)"
  echo $(( (t1 - t0) / 1000000 )) >> "$SANDBOX/times.txt"
done
p95="$(sort -n "$SANDBOX/times.txt" | awk '{a[c++]=$1} END{print a[int(c*0.95)]}')"
if [ "$p95" -lt 100 ]; then ok "gate p95 latency ${p95}ms < 100ms budget"
else bad "gate p95 latency < 100ms" "measured ${p95}ms"; fi

# ══ summary ══════════════════════════════════════════════════════════════════
echo
echo "════════════════════════════════════════"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
