#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-reap.sh — Reclaim leased processes (P2)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
#   runtime-reap.sh [--session ID] [--execute] [--force] [--json]
#
# THIS IS THE ONLY SCRIPT IN THE GUARD THAT CAN KILL ANYTHING, so it is built
# to refuse by default and to make every refusal visible:
#
#   • DRY-RUN IS THE DEFAULT. Without --execute it only prints decisions.
#   • --execute is refused while MODE=observe unless --force is also given.
#   • It signals ONLY pids that hold an open lease with policy=reap. A pid that
#     is not in the registry is never touched, no matter what port it holds.
#   • A lease whose port is on the allowlist is never reaped, even if leased.
#   • Signalling goes to the process GROUP (-PGID) so child processes die with
#     the parent instead of being orphaned — that is why dev-run.sh detaches
#     every launch into its own group.
#   • TERM first, then KILL only after a grace period.
#
# Decisions:
#   REAP           open · policy=reap · expired TTL or owning session ended
#   HOLD           open · still live and inside its TTL
#   PRUNE          open in the registry but the process is already gone
#   SKIP-KEEP      policy=keep — we did not start it, we do not stop it
#   SKIP-ALLOWLIST port is infrastructure (see port-allowlist.txt)
#
# Exit: 0 ok · 1 error · 3 RLG disabled
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

REGISTRY_PY="${SCRIPT_DIR}/runtime_registry.py"
LEASE_CLI="${SCRIPT_DIR}/runtime-lease.sh"

SESSION=""; EXECUTE=0; FORCE=0; AS_JSON=0; GRACE="${FORGEWRIGHT_RLG_GRACE:-5}"

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="${2:-}"; shift 2 ;;
    --execute) EXECUTE=1; shift ;;
    --force)   FORCE=1; shift ;;
    --json)    AS_JSON=1; shift ;;
    --grace)   GRACE="${2:-5}"; shift 2 ;;
    --help|-h) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 1 ;;
  esac
done

rlg_enabled || { rlg_warn "RLG disabled — nothing to do"; exit 3; }

# Refuse to kill while the guard is only supposed to be watching.
if [ "$EXECUTE" -eq 1 ] && [ "$(rlg_mode)" = "observe" ] && [ "$FORCE" -eq 0 ]; then
  rlg_err "refusing --execute while MODE=observe"
  rlg_err "either switch modes (echo enforce > $(rlg_mode_file)) or pass --force"
  exit 1
fi

[ -r "$REGISTRY_PY" ] || { rlg_err "registry engine missing"; exit 1; }

rows="$(mktemp "${TMPDIR:-/tmp}/rlg-reap.XXXXXX")" || exit 1
trap 'rm -f "$rows"' EXIT

args=(list --state open --json)
[ -n "$SESSION" ] && args+=(--session "$SESSION")
python3 "$REGISTRY_PY" "${args[@]}" 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for r in data:
    print("\t".join(str(r.get(k, "")) for k in
          ("lease_id", "pid", "pgid", "port", "policy", "health", "role", "project")))
' > "$rows" 2>/dev/null

n_reap=0; n_hold=0; n_prune=0; n_keep=0; n_allow=0; json_items=""

emit() { # <decision> <lease> <pid> <port> <note>
  if [ "$AS_JSON" -eq 1 ]; then
    json_items="${json_items}${json_items:+,}{\"decision\":\"$1\",\"lease_id\":\"$2\",\"pid\":\"$3\",\"port\":\"$4\",\"note\":\"$(rlg_json_escape "$5")\"}"
  else
    local color="$RLG_NC"
    case "$1" in
      REAP)  color="$RLG_YELLOW" ;;
      PRUNE) color="$RLG_DIM" ;;
      SKIP-KEEP|SKIP-ALLOWLIST) color="$RLG_GREEN" ;;
    esac
    printf "  ${color}%-15s${RLG_NC} lease=%s pid=%-7s port=%-6s %s\n" "$1" "$2" "$3" "$4" "$5"
  fi
}

signal_group() { # <pid> <pgid>
  local pid="$1" pgid="$2" target
  # Group-kill ONLY when the process actually leads its own group (pgid == pid),
  # which is what rlg_spawn.py guarantees for anything dev-run.sh started.
  #
  # Otherwise the pgid belongs to somebody else's group — an adopted process
  # inherits the shell's group, for instance — and `kill -<pgid>` would take
  # down every unrelated sibling in it. The P2 simulation found this the hard
  # way: the reaper killed the test harness that was supervising it.
  if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
    target="-$pgid"
  else
    target="$pid"
  fi
  kill -TERM "$target" 2>/dev/null
  local waited=0
  while [ "$waited" -lt $((GRACE * 4)) ]; do
    rlg_pid_alive "$pid" || return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  kill -KILL "$target" 2>/dev/null
  return 0
}

[ "$AS_JSON" -eq 0 ] && {
  echo "${RLG_BLUE}Runtime Lifecycle Guard — reap${RLG_NC}  ${RLG_DIM}mode=$(rlg_mode) $([ "$EXECUTE" -eq 1 ] && echo EXECUTE || echo DRY-RUN)${RLG_NC}"
  [ -n "$SESSION" ] && echo "${RLG_DIM}session: $SESSION${RLG_NC}"
}

# `_project` is read to consume the column; the decision does not use it.
while IFS=$'\t' read -r lease pid pgid port policy health role _project; do
  [ -n "$lease" ] || continue
  note="role=$role"

  if [ -n "$port" ] && rlg_port_allowlisted "$port"; then
    emit "SKIP-ALLOWLIST" "$lease" "$pid" "$port" "infrastructure port — never reaped"
    n_allow=$((n_allow + 1)); continue
  fi
  if [ "$policy" = "keep" ]; then
    emit "SKIP-KEEP" "$lease" "$pid" "$port" "policy=keep (adopted, not ours to stop)"
    n_keep=$((n_keep + 1)); continue
  fi
  if [ "$health" = "dead" ]; then
    emit "PRUNE" "$lease" "$pid" "$port" "process already gone — closing record only"
    n_prune=$((n_prune + 1))
    [ "$EXECUTE" -eq 1 ] && bash "$LEASE_CLI" release --lease "$lease" --reason "reaped-dead" >/dev/null 2>&1
    continue
  fi
  if [ "$health" = "expired" ] || [ -n "$SESSION" ]; then
    reason="$([ "$health" = "expired" ] && echo "TTL expired" || echo "owning session ended")"
    emit "REAP" "$lease" "$pid" "$port" "$reason ($note)"
    n_reap=$((n_reap + 1))
    if [ "$EXECUTE" -eq 1 ]; then
      signal_group "$pid" "$pgid"
      bash "$LEASE_CLI" release --lease "$lease" --reason "reaped-$([ "$health" = expired ] && echo ttl || echo session)" >/dev/null 2>&1
    fi
    continue
  fi
  emit "HOLD" "$lease" "$pid" "$port" "live, inside TTL ($note)"
  n_hold=$((n_hold + 1))
done < "$rows"

if [ "$AS_JSON" -eq 1 ]; then
  printf '{"mode":"%s","execute":%s,"reap":%d,"hold":%d,"prune":%d,"skip_keep":%d,"skip_allowlist":%d,"items":[%s]}\n' \
    "$(rlg_mode)" "$([ "$EXECUTE" -eq 1 ] && echo true || echo false)" \
    "$n_reap" "$n_hold" "$n_prune" "$n_keep" "$n_allow" "$json_items"
else
  echo
  echo "  ${RLG_DIM}reap=$n_reap hold=$n_hold prune=$n_prune skip-keep=$n_keep skip-allowlist=$n_allow${RLG_NC}"
  [ "$EXECUTE" -eq 0 ] && [ "$n_reap" -gt 0 ] && \
    echo "  ${RLG_YELLOW}dry-run — nothing was signalled. Add --execute to act.${RLG_NC}"
fi
exit 0
