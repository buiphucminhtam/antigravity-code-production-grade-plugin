#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# port-broker.sh — Deterministic port allocation for the RLG
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 — SPAWN)
#
# Fixes root cause R2 (ports drift 3000 → 3001 → 3002 …) and, together with
# dev-run.sh, root cause R1 (spawning a second copy of something already up).
#
# A project always gets the same 10-port band (see runtime-common.sh), so the
# question "is this project's dev server already running?" has a stable answer
# instead of depending on which port the last attempt happened to land on.
#
# Usage:
#   port-broker.sh alloc --role web-dev [--project P] [--port N]
#   port-broker.sh check --port N
#   port-broker.sh band  [--project P]
#
# `alloc` prints one TSV line: STATUS<TAB>PORT<TAB>PID<TAB>LEASE
#   FREE   port is idle             → caller may start
#   REUSE  already up, has a lease  → caller MUST NOT start a second copy
#   BUSY   already up, NO lease     → foreign process, refuse to touch it
#
# Never kills, never binds — read-only inspection plus registry lookups.
# Exit: 0 FREE/REUSE · 1 BUSY or error · 3 RLG disabled
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

REGISTRY_PY="${SCRIPT_DIR}/runtime_registry.py"

# rlg_port_listener <port> — echo the listening pid(s), empty if free.
port_listener() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 5 | tr '\n' ' ' | sed 's/ $//'
}

# lease_for_port <port> — echo "lease_id<TAB>pid" of the open lease on that
# port, empty if none.
lease_for_port() {
  local port="$1"
  [ -r "$REGISTRY_PY" ] || return 0
  python3 "$REGISTRY_PY" list --state open --json 2>/dev/null | python3 -c '
import json, sys
want = int(sys.argv[1])
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for r in rows:
    if r.get("port") == want:
        # Plain concatenation, not an f-string: a backslash-escaped quote
        # inside an f-string expression is a SyntaxError, and embedded in a
        # shell single-quoted block it fails silently to an empty result.
        print(str(r.get("lease_id", "")) + "\t" + str(r.get("pid", "")))
        break
' "$port" 2>/dev/null
}

cmd_alloc() {
  local project="" role="" port=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) project="${2:-}"; shift 2 ;;
      --role)    role="${2:-}";    shift 2 ;;
      --port)    port="${2:-}";    shift 2 ;;
      *) rlg_err "alloc: unknown arg $1"; return 1 ;;
    esac
  done
  [ -n "$role" ] || { rlg_err "alloc: --role required (valid: $RLG_ROLES)"; return 1; }

  project="$(rlg_project_root "${project:-$PWD}")"
  rlg_enabled "$project" || { printf 'DISABLED\t\t\t\n'; return 3; }
  rlg_init_dirs || return 1

  if [ -z "$port" ]; then
    port="$(rlg_port_for "$project" "$role")" || return 1
  fi

  local pids; pids="$(port_listener "$port")"
  if [ -z "$pids" ]; then
    printf 'FREE\t%s\t\t\n' "$port"
    return 0
  fi

  local hit lease_id lease_pid
  hit="$(lease_for_port "$port")"
  if [ -n "$hit" ]; then
    lease_id="${hit%%	*}"
    lease_pid="${hit##*	}"
    printf 'REUSE\t%s\t%s\t%s\n' "$port" "$lease_pid" "$lease_id"
    return 0
  fi

  # Listening, but nothing in the registry claims it. Could be the user's own
  # server or a leak from before the guard existed. Either way it is not ours.
  printf 'BUSY\t%s\t%s\t\n' "$port" "${pids%% *}"
  return 1
}

cmd_check() {
  local port=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="${2:-}"; shift 2 ;;
      *) rlg_err "check: unknown arg $1"; return 1 ;;
    esac
  done
  [ -n "$port" ] || { rlg_err "check: --port required"; return 1; }
  local pids; pids="$(port_listener "$port")"
  if [ -n "$pids" ]; then printf 'LISTEN\t%s\t%s\n' "$port" "${pids%% *}"; return 0; fi
  printf 'FREE\t%s\t\n' "$port"
  return 0
}

cmd_band() {
  local project=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) project="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done
  project="$(rlg_project_root "${project:-$PWD}")"
  rlg_init_dirs || return 1
  local base; base="$(rlg_port_band "$project")" || return 1
  echo "$base"
  local i=0 r
  for r in $RLG_ROLES; do
    printf '  %-13s %s\n' "$r" "$(( base + i ))"
    i=$((i + 1))
  done
}

main() {
  local sub="${1:-help}"
  [ $# -gt 0 ] && shift
  case "$sub" in
    alloc) cmd_alloc "$@" ;;
    check) cmd_check "$@" ;;
    band)  cmd_band "$@" ;;
    help|--help|-h) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
    *) rlg_err "unknown command: $sub"; return 1 ;;
  esac
}

main "$@"
