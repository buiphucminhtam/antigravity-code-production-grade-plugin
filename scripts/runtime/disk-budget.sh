#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# disk-budget.sh — Measure project disk footprint against declared budgets (P3)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
#   disk-budget.sh [--root PATH]... [--json] [--strict]
#
# Answers root cause R5: build output, caches, logs and evidence artifacts grow
# without bound because nothing ever states how big they are allowed to get.
#
# Thresholds come from budget.yaml — global at $RLG_HOME/budget.yaml, and a
# project may override with its own .forgewright/budget.yaml. Reporting only;
# deletion lives in runtime-gc.sh, deliberately a separate script so measuring
# can never remove anything by accident.
#
# With no --root, every project the guard already knows (projects.index) is
# measured.
#
# Exit: 0 all within budget · 1 at least one project over warn (with --strict)
#       · 2 at least one project over block
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

AS_JSON=0; STRICT=0
ROOTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --root)   ROOTS+=("${2:-}"); shift 2 ;;
    --json)   AS_JSON=1; shift ;;
    --strict) STRICT=1; shift ;;
    --help|-h) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 2 ;;
  esac
done

# Same list the inventory uses — kept identical on purpose so "what is big" and
# "what is measured" never diverge.
RLG_HEAVY_DIRS='node_modules .next .nuxt dist build out .turbo .parcel-cache .vite target Library Temp Logs .godot .import playwright-report test-results coverage .gradle Pods DerivedData'

# read_budget <project_dir> <key> <default>
# Project budget.yaml wins over the global one; both are optional.
read_budget() {
  local proj="$1" key="$2" def="$3"
  PROJ="$proj" GLOBAL="$(rlg_home)/budget.yaml" KEY="$key" DEF="$def" python3 <<'PY'
import os, sys
try:
    import yaml
except ImportError:
    print(os.environ["DEF"]); sys.exit(0)

key = os.environ["KEY"]
val = None
for path in (os.environ["GLOBAL"], os.path.join(os.environ["PROJ"], ".forgewright", "budget.yaml")):
    try:
        with open(path) as fh:
            data = yaml.safe_load(fh) or {}
    except Exception:
        continue
    node = data
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            node = None
            break
        node = node[part]
    if node is not None:
        val = node          # later file (project) overrides earlier (global)
print(val if val is not None else os.environ["DEF"])
PY
}

targets=()
if [ "${#ROOTS[@]}" -gt 0 ]; then
  targets=("${ROOTS[@]}")
elif [ -r "$(rlg_projects_index)" ]; then
  while IFS=$'\t' read -r _ proj; do
    [ -n "$proj" ] && [ -d "$proj" ] && targets+=("$proj")
  done < "$(rlg_projects_index)"
fi

if [ "${#targets[@]}" -eq 0 ]; then
  [ "$AS_JSON" -eq 1 ] && echo '{"projects":[],"note":"no known projects"}' \
    || echo "(no projects known yet — pass --root PATH)"
  exit 0
fi

find_expr=(); first=1
for d in $RLG_HEAVY_DIRS; do
  [ "$first" -eq 1 ] && first=0 || find_expr+=(-o)
  find_expr+=(-iname "$d")
done

worst=0
json_rows=""

[ "$AS_JSON" -eq 0 ] && {
  echo "${RLG_BLUE}Disk budget${RLG_NC}  ${RLG_DIM}$(rlg_now_utc)${RLG_NC}"
}

for proj in "${targets[@]}"; do
  warn_gb="$(read_budget "$proj" disk.warn_project_gb 5)"
  block_gb="$(read_budget "$proj" disk.block_project_gb 15)"

  total_mb=0; detail=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    kb="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
    [ -n "$kb" ] || continue
    mb=$((kb / 1024))
    [ "$mb" -ge 1 ] || continue
    total_mb=$((total_mb + mb))
    rel="${path#"$proj"/}"
    detail="${detail}    ${mb} MB\t${rel}\n"
  done < <(find "$proj" -maxdepth 2 \
             \( -name .git -o -name .svn -o -name .hg \) -prune -o \
             \( "${find_expr[@]}" \) -type d -prune -print 2>/dev/null)

  warn_mb=$(awk -v g="$warn_gb" 'BEGIN{printf "%d", g*1024}')
  block_mb=$(awk -v g="$block_gb" 'BEGIN{printf "%d", g*1024}')

  verdict="OK"; level=0
  if [ "$total_mb" -ge "$block_mb" ]; then verdict="BLOCK"; level=2
  elif [ "$total_mb" -ge "$warn_mb" ]; then verdict="WARN"; level=1
  fi
  [ "$level" -gt "$worst" ] && worst="$level"

  if [ "$AS_JSON" -eq 1 ]; then
    json_rows="${json_rows}${json_rows:+,}{\"project\":\"$(rlg_json_escape "$proj")\",\"total_mb\":$total_mb,\"warn_mb\":$warn_mb,\"block_mb\":$block_mb,\"verdict\":\"$verdict\"}"
  else
    short="$proj"; case "$proj" in "$HOME"/*) short="~${proj#"$HOME"}" ;; esac
    color="$RLG_GREEN"
    [ "$verdict" = "WARN" ]  && color="$RLG_YELLOW"
    [ "$verdict" = "BLOCK" ] && color="$RLG_RED"
    printf "  ${color}%-5s${RLG_NC} %-42s %6s MB  ${RLG_DIM}(warn %s / block %s GB)${RLG_NC}\n" \
      "$verdict" "$short" "$total_mb" "$warn_gb" "$block_gb"
    [ "$level" -gt 0 ] && [ -n "$detail" ] && printf "%b" "$detail" | sort -rn | head -n 4
  fi
done

if [ "$AS_JSON" -eq 1 ]; then
  printf '{"generated_at":"%s","worst":%d,"projects":[%s]}\n' "$(rlg_now_utc)" "$worst" "$json_rows"
fi

case "$worst" in
  2) exit 2 ;;
  1) [ "$STRICT" -eq 1 ] && exit 1 ;;
esac
exit 0
