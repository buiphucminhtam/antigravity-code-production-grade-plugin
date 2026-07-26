#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-lease.sh — Lease CLI for the Runtime Lifecycle Guard (RLG)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P0 — OBSERVE)
#
# A "lease" is the registry record for one long-running process. The guard's
# core invariant: every long-running process an agent starts has a lease, and
# NOTHING may ever be killed unless it has one.
#
# This script is OBSERVE-ONLY. It never signals a process. Reaping is P2.
#
# Usage:
#   runtime-lease.sh acquire --role web-dev --pid 123 [--project P] [...]
#   runtime-lease.sh adopt   --pid 123 [--port 3000] [--policy keep]
#   runtime-lease.sh release --lease rlg-abc [--reason done]
#   runtime-lease.sh list    [--state open|closed|all] [--session S] [--json]
#   runtime-lease.sh status  [--session S] [--json]
#   runtime-lease.sh prune   [--dry-run]
#   runtime-lease.sh band    [project_path]
#   runtime-lease.sh port    --role web-dev [--project P]
#
# Exit codes: 0 ok · 1 usage/runtime error · 3 RLG disabled (kill-switch)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

REGISTRY_PY="${SCRIPT_DIR}/runtime_registry.py"

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

registry() {
  [ -r "$REGISTRY_PY" ] || { rlg_err "registry engine missing: $REGISTRY_PY"; return 1; }
  python3 "$REGISTRY_PY" "$@"
}

# ── acquire ──────────────────────────────────────────────────────────────────
cmd_acquire() {
  local project="" role="" pid="" port="" cmd="" session="" ttl="" policy="reap" log="" pgid=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) project="${2:-}"; shift 2 ;;
      --role)    role="${2:-}";    shift 2 ;;
      --pid)     pid="${2:-}";     shift 2 ;;
      --port)    port="${2:-}";    shift 2 ;;
      --cmd)     cmd="${2:-}";     shift 2 ;;
      --session) session="${2:-}"; shift 2 ;;
      --ttl)     ttl="${2:-}";     shift 2 ;;
      --policy)  policy="${2:-}";  shift 2 ;;
      --log)     log="${2:-}";     shift 2 ;;
      *) rlg_err "acquire: unknown arg $1"; return 1 ;;
    esac
  done

  [ -n "$role" ] || { rlg_err "acquire: --role required (valid: $RLG_ROLES)"; return 1; }
  rlg_role_valid "$role" || { rlg_err "acquire: unknown role '$role' (valid: $RLG_ROLES)"; return 1; }
  [ -n "$pid" ] || { rlg_err "acquire: --pid required"; return 1; }
  case "$pid" in ''|*[!0-9]*) rlg_err "acquire: --pid must be numeric"; return 1 ;; esac
  rlg_pid_alive "$pid" || { rlg_err "acquire: pid $pid is not alive — refusing to register a ghost"; return 1; }

  project="$(rlg_project_root "${project:-$PWD}")"
  rlg_enabled "$project" || { rlg_warn "RLG disabled — lease not recorded"; return 3; }
  rlg_init_dirs || { rlg_err "cannot initialise $(rlg_home)"; return 1; }

  [ -n "$port" ] || port="$(rlg_port_for "$project" "$role")" || return 1
  [ -n "$session" ] || session="$(rlg_session_id)"
  [ -n "$ttl" ] || ttl="${FORGEWRIGHT_RLG_TTL:-7200}"
  [ -n "$cmd" ] || cmd="$(rlg_cmd_of "$pid")"
  pgid="$(rlg_pgid_of "$pid")"

  local lease_id; lease_id="$(rlg_lease_id)"
  [ -n "$log" ] || log="$(rlg_logs_dir)/${lease_id}.log"

  local args=(append --lease-id "$lease_id" --event open
    --project "$project" --session "$session" --role "$role"
    --pid "$pid" --port "$port" --ttl "$ttl" --policy "$policy" --log "$log")
  [ -n "$pgid" ] && args+=(--pgid "$pgid")
  [ -n "$cmd" ]  && args+=(--cmd "$cmd")

  registry "${args[@]}" || return 1
  rlg_ok "lease $lease_id  role=$role port=$port pid=$pid policy=$policy" >&2
}

# ── adopt (register a process that already exists) ───────────────────────────
cmd_adopt() {
  local pid="" port="" role="aux1" project="" policy="keep" session=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pid)     pid="${2:-}";     shift 2 ;;
      --port)    port="${2:-}";    shift 2 ;;
      --role)    role="${2:-}";    shift 2 ;;
      --project) project="${2:-}"; shift 2 ;;
      --policy)  policy="${2:-}";  shift 2 ;;
      --session) session="${2:-}"; shift 2 ;;
      *) rlg_err "adopt: unknown arg $1"; return 1 ;;
    esac
  done
  [ -n "$pid" ] || { rlg_err "adopt: --pid required"; return 1; }

  # Adopted processes default to policy=keep: we did not start them, so we do
  # not get to decide when they die.
  local a=(--pid "$pid" --role "$role" --policy "$policy")
  [ -n "$port" ]    && a+=(--port "$port")
  [ -n "$project" ] && a+=(--project "$project")
  [ -n "$session" ] && a+=(--session "$session")
  cmd_acquire "${a[@]}"
}

# ── release ──────────────────────────────────────────────────────────────────
cmd_release() {
  local lease="" reason="released"
  while [ $# -gt 0 ]; do
    case "$1" in
      --lease)  lease="${2:-}";  shift 2 ;;
      --reason) reason="${2:-}"; shift 2 ;;
      *) rlg_err "release: unknown arg $1"; return 1 ;;
    esac
  done
  [ -n "$lease" ] || { rlg_err "release: --lease required"; return 1; }
  registry append --lease-id "$lease" --event close --reason "$reason" >/dev/null || return 1
  rlg_ok "released $lease ($reason)" >&2
}

# ── band / port helpers ──────────────────────────────────────────────────────
cmd_band() {
  local project; project="$(rlg_project_root "${1:-$PWD}")"
  rlg_init_dirs || return 1
  local base; base="$(rlg_port_band "$project")" || return 1
  echo "$base"
}

cmd_port() {
  local role="" project=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --role)    role="${2:-}";    shift 2 ;;
      --project) project="${2:-}"; shift 2 ;;
      *) rlg_err "port: unknown arg $1"; return 1 ;;
    esac
  done
  [ -n "$role" ] || { rlg_err "port: --role required (valid: $RLG_ROLES)"; return 1; }
  project="$(rlg_project_root "${project:-$PWD}")"
  rlg_init_dirs || return 1
  # Capture, then propagate failure: a bare call followed by `echo` would make
  # the function exit 0 even for an unknown role.
  local p
  p="$(rlg_port_for "$project" "$role")" || return 1
  [ -n "$p" ] || return 1
  echo "$p"
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
  local sub="${1:-help}"
  [ $# -gt 0 ] && shift
  case "$sub" in
    acquire) cmd_acquire "$@" ;;
    adopt)   cmd_adopt "$@" ;;
    release) cmd_release "$@" ;;
    list)    registry list "$@" ;;
    status)  registry status "$@" ;;
    prune)   registry prune "$@" ;;
    ports)   registry ports "$@" ;;
    band)    cmd_band "$@" ;;
    port)    cmd_port "$@" ;;
    help|--help|-h) usage ;;
    *) rlg_err "unknown command: $sub"; usage; return 1 ;;
  esac
}

main "$@"
