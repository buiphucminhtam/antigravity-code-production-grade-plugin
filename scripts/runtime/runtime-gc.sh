#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-gc.sh — Age out the guard's own artifacts (P3)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
#   runtime-gc.sh [--execute] [--days N] [--project PATH]... [--json]
#
# Deletion is the dangerous half of P3, so this is deliberately narrow:
#
#   • DRY-RUN BY DEFAULT — prints what would go, removes nothing.
#   • Only ever touches an explicit ALLOWLIST of directories that the guard and
#     the pipeline generate themselves. It never walks a project tree looking
#     for things that look disposable, and it never touches source, builds,
#     node_modules or anything a human put there.
#   • Only regular files, only ones older than the TTL, never directories.
#   • The log of a lease that is still OPEN is never removed, however old — it
#     belongs to a process that is still running.
#
# What it ages out:
#   $RLG_HOME/logs/*.log         launch logs from dev-run.sh
#   $RLG_HOME/sweep.log          reclaim log        (rotated, not deleted)
#   $RLG_HOME/gate.log           detector log       (rotated, not deleted)
#   <project>/.forgewright/verify/*.json    machine-written evidence
#   <project>/.forgewright/reports/*        generated reports
#   <project>/.forgewright/escalations/*    escalation transcripts
#
# TTL comes from budget.yaml (disk.artifact_ttl_days), default 7.
# Exit: always 0 unless an explicit removal failed.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

EXECUTE=0; DAYS=""; AS_JSON=0
PROJECTS=()
LOG_ROTATE_BYTES="${FORGEWRIGHT_RLG_LOG_MAX:-10485760}"

while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1; shift ;;
    --days)    DAYS="${2:-}"; shift 2 ;;
    --project) PROJECTS+=("${2:-}"); shift 2 ;;
    --json)    AS_JSON=1; shift ;;
    --help|-h) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 2 ;;
  esac
done

if [ -z "$DAYS" ]; then
  DAYS="$(GLOBAL="$(rlg_home)/budget.yaml" python3 - <<'PY'
import os
try:
    import yaml
    with open(os.environ["GLOBAL"]) as fh:
        data = yaml.safe_load(fh) or {}
    print(data.get("disk", {}).get("artifact_ttl_days", 7))
except Exception:
    print(7)
PY
)"
fi
case "$DAYS" in ''|*[!0-9]*) DAYS=7 ;; esac

# Logs belonging to leases that are still open must survive regardless of age.
LIVE_LOGS="$(mktemp "${TMPDIR:-/tmp}/rlg-gc.XXXXXX")" || exit 1
trap 'rm -f "$LIVE_LOGS"' EXIT
bash "${SCRIPT_DIR}/runtime-lease.sh" list --state open --json 2>/dev/null | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for r in rows:
    if r.get("log"):
        print(r["log"])
' > "$LIVE_LOGS" 2>/dev/null || : > "$LIVE_LOGS"

n_files=0; n_bytes=0; json_rows=""

short_path() { # <path> — ~ prefix without the literal backslash that
                 # ${f/#$HOME/\~} would emit
  case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac
}

consider() { # <file>
  local f="$1" sz
  [ -f "$f" ] || return 0
  if grep -qxF "$f" "$LIVE_LOGS" 2>/dev/null; then
    [ "$AS_JSON" -eq 0 ] && printf "  ${RLG_GREEN}KEEP${RLG_NC}   %s ${RLG_DIM}(lease still open)${RLG_NC}\n" "$(short_path "$f")"
    return 0
  fi
  sz="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
  [ -n "$sz" ] || sz=0
  n_files=$((n_files + 1)); n_bytes=$((n_bytes + sz))
  if [ "$AS_JSON" -eq 1 ]; then
    json_rows="${json_rows}${json_rows:+,}{\"file\":\"$(rlg_json_escape "$f")\",\"bytes\":$sz}"
  else
    printf "  %s %s ${RLG_DIM}(%s KB)${RLG_NC}\n" \
      "$([ "$EXECUTE" -eq 1 ] && printf "${RLG_YELLOW}REMOVE${RLG_NC}" || printf "${RLG_DIM}would${RLG_NC} ")" \
      "$(short_path "$f")" "$((sz / 1024))"
  fi
  [ "$EXECUTE" -eq 1 ] && { rm -f "$f" || { rlg_err "cannot remove $f"; return 1; }; }
  return 0
}

sweep_dir() { # <dir> <glob>
  local dir="$1" pat="$2"
  [ -d "$dir" ] || return 0
  while IFS= read -r f; do
    [ -n "$f" ] && consider "$f"
  done < <(find "$dir" -maxdepth 1 -type f -name "$pat" -mtime "+${DAYS}" 2>/dev/null)
}

rotate_if_big() { # <file>
  local f="$1" sz
  [ -f "$f" ] || return 0
  sz="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
  [ -n "$sz" ] && [ "$sz" -lt "$LOG_ROTATE_BYTES" ] && return 0
  if [ "$AS_JSON" -eq 0 ]; then
    printf "  ${RLG_YELLOW}ROTATE${RLG_NC} %s ${RLG_DIM}(%s MB)${RLG_NC}\n" "$(short_path "$f")" "$((sz / 1048576))"
  fi
  [ "$EXECUTE" -eq 1 ] && mv -f "$f" "${f}.1" 2>/dev/null
  return 0
}

[ "$AS_JSON" -eq 0 ] && {
  echo "${RLG_BLUE}Runtime GC${RLG_NC}  ${RLG_DIM}ttl=${DAYS}d $([ "$EXECUTE" -eq 1 ] && echo EXECUTE || echo DRY-RUN)${RLG_NC}"
}

# ── the guard's own home ─────────────────────────────────────────────────────
sweep_dir "$(rlg_logs_dir)" '*.log'
sweep_dir "$(rlg_logs_dir)" '*.log.[0-9]'
rotate_if_big "$(rlg_home)/sweep.log"
rotate_if_big "$(rlg_home)/gate.log"

# ── per-project pipeline artifacts ───────────────────────────────────────────
targets=()
if [ "${#PROJECTS[@]}" -gt 0 ]; then
  targets=("${PROJECTS[@]}")
elif [ -r "$(rlg_projects_index)" ]; then
  while IFS=$'\t' read -r _ proj; do
    [ -n "$proj" ] && [ -d "$proj" ] && targets+=("$proj")
  done < "$(rlg_projects_index)"
fi

# `"${targets[@]}"` on an empty array is an "unbound variable" error under
# `set -u` in bash 3.2 (the system bash here), so guard the count first.
[ "${#targets[@]}" -gt 0 ] && for proj in "${targets[@]}"; do
  # Explicit allowlist. Nothing outside these three directories is ever a
  # candidate, so a wrong --project can at worst age out old evidence files.
  sweep_dir "$proj/.forgewright/verify"       '*.json'
  sweep_dir "$proj/.forgewright/reports"      '*'
  sweep_dir "$proj/.forgewright/escalations"  '*'
done

if [ "$AS_JSON" -eq 1 ]; then
  printf '{"ttl_days":%s,"execute":%s,"files":%d,"bytes":%d,"items":[%s]}\n' \
    "$DAYS" "$([ "$EXECUTE" -eq 1 ] && echo true || echo false)" "$n_files" "$n_bytes" "$json_rows"
else
  echo
  printf "  ${RLG_DIM}%d file(s), %d KB %s${RLG_NC}\n" "$n_files" "$((n_bytes / 1024))" \
    "$([ "$EXECUTE" -eq 1 ] && echo removed || echo "would be removed")"
  [ "$EXECUTE" -eq 0 ] && [ "$n_files" -gt 0 ] && \
    echo "  ${RLG_YELLOW}dry-run — nothing deleted. Add --execute to act.${RLG_NC}"
fi
exit 0
