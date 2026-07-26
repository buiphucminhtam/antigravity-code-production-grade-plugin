#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# dev-run.sh — The sanctioned way to start anything long-running
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 — SPAWN)
#
#   bash scripts/runtime/dev-run.sh --role web-dev --ttl 2h -- npm run dev
#
# What it does, in order:
#   1. Ask the broker for this project's stable port for this role.
#   2. If something is ALREADY serving that port under a lease → print it and
#      exit 0 WITHOUT starting anything. This is the anti-spam core: running
#      the same command five times leaves one process, not five.
#   3. Otherwise detach the command into its own process group (rlg_spawn.py),
#      send output to a size-capped log, register a lease, and wait until the
#      port actually answers.
#
# Fail-open: if the guard is disabled or its own machinery breaks, the command
# is executed normally rather than blocked. A broken guard must never stop work.
#
# Options:
#   --role R        one of: web-dev web-preview api game-editor emulator
#                   test-runner storybook docs aux1 aux2   (required)
#   --project P     project root (default: git root of $PWD)
#   --port N        override the brokered port
#   --ttl D         lease TTL, e.g. 30m / 2h / 7200 (default 2h)
#   --policy P      reap (default) | keep
#   --no-wait       do not health-probe the port
#   --timeout S     health-probe timeout in seconds (default 30)
#   --json          machine-readable output only
#
# Exit: 0 started or reused · 1 error/BUSY · 127 command not found
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

BROKER="${SCRIPT_DIR}/port-broker.sh"
LEASE_CLI="${SCRIPT_DIR}/runtime-lease.sh"
SPAWNER="${SCRIPT_DIR}/rlg_spawn.py"

LOG_MAX_BYTES="${FORGEWRIGHT_RLG_LOG_MAX:-10485760}"   # 10 MB
LOG_KEEP=3

ROLE=""; PROJECT=""; PORT=""; TTL=""; POLICY="reap"
WAIT=1; TIMEOUT=30; AS_JSON=0
CMD=()

while [ $# -gt 0 ]; do
  case "$1" in
    --role)     ROLE="${2:-}";    shift 2 ;;
    --project)  PROJECT="${2:-}"; shift 2 ;;
    --port)     PORT="${2:-}";    shift 2 ;;
    --ttl)      TTL="${2:-}";     shift 2 ;;
    --policy)   POLICY="${2:-}";  shift 2 ;;
    --no-wait)  WAIT=0; shift ;;
    --timeout)  TIMEOUT="${2:-30}"; shift 2 ;;
    --json)     AS_JSON=1; shift ;;
    --help|-h)  sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --)         shift; CMD=("$@"); break ;;
    *) rlg_err "unknown arg: $1 (did you forget -- before the command?)"; exit 1 ;;
  esac
done

[ "${#CMD[@]}" -gt 0 ] || { rlg_err "no command given — use: dev-run.sh --role R -- <command>"; exit 1; }
[ -n "$ROLE" ] || { rlg_err "--role required (valid: $RLG_ROLES)"; exit 1; }

say() { [ "$AS_JSON" -eq 1 ] || echo -e "$*" >&2; }

# ── fail-open escape hatch ───────────────────────────────────────────────────
# Guard off, or its machinery missing → run the command plainly. Losing the
# lease is bad; blocking the user's work is worse.
run_unmanaged() {
  local why="$1"
  say "${RLG_YELLOW}⚠${RLG_NC} running unmanaged ($why)"
  exec "${CMD[@]}"
}

PROJECT="$(rlg_project_root "${PROJECT:-$PWD}")"
rlg_enabled "$PROJECT" || run_unmanaged "RLG disabled"
[ -r "$BROKER" ] && [ -r "$SPAWNER" ] || run_unmanaged "guard scripts missing"
rlg_init_dirs || run_unmanaged "cannot initialise $(rlg_home)"

# ── ttl: accept 30m / 2h / 7200 ──────────────────────────────────────────────
parse_ttl() {
  local v="${1:-}"
  case "$v" in
    "")         printf '7200' ;;
    *[!0-9smhd]*) printf '7200' ;;
    *s)         printf '%s' "${v%s}" ;;
    *m)         printf '%s' "$(( ${v%m} * 60 ))" ;;
    *h)         printf '%s' "$(( ${v%h} * 3600 ))" ;;
    *d)         printf '%s' "$(( ${v%d} * 86400 ))" ;;
    *)          printf '%s' "$v" ;;
  esac
}
TTL_SEC="$(parse_ttl "$TTL")"

# ── 1 + 2. broker: reuse beats respawn ───────────────────────────────────────
broker_args=(alloc --role "$ROLE" --project "$PROJECT")
[ -n "$PORT" ] && broker_args+=(--port "$PORT")
alloc_line="$(bash "$BROKER" "${broker_args[@]}" 2>/dev/null)"
alloc_rc=$?

STATUS="$(printf '%s' "$alloc_line" | cut -f1)"
PORT="$(printf '%s' "$alloc_line" | cut -f2)"
EX_PID="$(printf '%s' "$alloc_line" | cut -f3)"
EX_LEASE="$(printf '%s' "$alloc_line" | cut -f4)"

case "$STATUS" in
  REUSE)
    say "${RLG_GREEN}✓${RLG_NC} already running — reusing instead of starting a second copy"
    say "   port=$PORT pid=$EX_PID lease=$EX_LEASE"
    if [ "$AS_JSON" -eq 1 ]; then
      printf '{"reused":true,"port":%s,"pid":%s,"lease_id":"%s","url":"http://localhost:%s"}\n' \
        "$PORT" "${EX_PID:-0}" "$EX_LEASE" "$PORT"
    else
      echo "http://localhost:$PORT"
    fi
    exit 0
    ;;
  BUSY)
    rlg_err "port $PORT is held by pid ${EX_PID:-?} which has no lease — not ours to touch"
    rlg_err "either stop it yourself, or adopt it: $LEASE_CLI adopt --pid ${EX_PID:-PID} --port $PORT"
    exit 1
    ;;
  DISABLED) run_unmanaged "broker reports guard disabled" ;;
  FREE)     : ;;
  *)        [ "$alloc_rc" -ne 0 ] && run_unmanaged "broker error"; : ;;
esac

# ── 3. log with a size cap ───────────────────────────────────────────────────
LEASE_ID_HINT="$(rlg_lease_id)"
LOG="$(rlg_logs_dir)/${LEASE_ID_HINT}.log"

rotate_log() {
  local f="$1" i
  [ -f "$f" ] || return 0
  local size; size="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
  [ -n "$size" ] && [ "$size" -lt "$LOG_MAX_BYTES" ] && return 0
  i="$LOG_KEEP"
  while [ "$i" -gt 1 ]; do
    [ -f "${f}.$((i - 1))" ] && mv -f "${f}.$((i - 1))" "${f}.${i}"
    i=$((i - 1))
  done
  mv -f "$f" "${f}.1"
}
rotate_log "$LOG"

# ── spawn detached ───────────────────────────────────────────────────────────
python3 "$SPAWNER" --log "$LOG" --cwd "$PROJECT" \
  --env "PORT=$PORT" --env "RLG_PORT=$PORT" --env "RLG_ROLE=$ROLE" \
  -- "${CMD[@]}" &
CHILD_PID=$!

# Give exec a moment to either take hold or fail outright.
sleep 0.3
if ! rlg_pid_alive "$CHILD_PID"; then
  rlg_err "command exited immediately — see $LOG"
  [ -s "$LOG" ] && tail -n 5 "$LOG" >&2
  exit 127
fi

# ── register the lease ───────────────────────────────────────────────────────
LEASE_ID="$(bash "$LEASE_CLI" acquire \
  --role "$ROLE" --project "$PROJECT" --pid "$CHILD_PID" --port "$PORT" \
  --ttl "$TTL_SEC" --policy "$POLICY" --log "$LOG" \
  --cmd "${CMD[*]}" 2>/dev/null)"

if [ -z "$LEASE_ID" ]; then
  # The process is up but unregistered — say so loudly rather than pretend.
  rlg_warn "process started (pid $CHILD_PID) but lease registration FAILED — it will not be reaped automatically"
fi

# ── health probe ─────────────────────────────────────────────────────────────
READY=0
if [ "$WAIT" -eq 1 ]; then
  waited=0
  while [ "$waited" -lt "$((TIMEOUT * 4))" ]; do
    if [ -n "$(bash "$BROKER" check --port "$PORT" 2>/dev/null | grep '^LISTEN' || true)" ]; then
      READY=1; break
    fi
    rlg_pid_alive "$CHILD_PID" || break
    sleep 0.25
    waited=$((waited + 1))
  done
fi

if [ "$AS_JSON" -eq 1 ]; then
  printf '{"reused":false,"port":%s,"pid":%s,"lease_id":"%s","log":"%s","ready":%s,"url":"http://localhost:%s"}\n' \
    "$PORT" "$CHILD_PID" "$LEASE_ID" "$(rlg_json_escape "$LOG")" \
    "$([ "$READY" -eq 1 ] && echo true || echo false)" "$PORT"
else
  if [ "$WAIT" -eq 1 ] && [ "$READY" -eq 0 ]; then
    rlg_warn "started (pid $CHILD_PID, lease $LEASE_ID) but port $PORT did not answer within ${TIMEOUT}s — lease kept so it stays tracked"
  else
    rlg_ok "started  port=$PORT pid=$CHILD_PID lease=$LEASE_ID"
  fi
  say "   log: $LOG"
  echo "http://localhost:$PORT"
fi
exit 0
