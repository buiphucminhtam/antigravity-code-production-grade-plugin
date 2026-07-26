#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-inventory.sh — Machine-wide read-only report for the RLG
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P0 — OBSERVE)
#
# Answers the three questions P0 exists to answer:
#   1. What is listening, and is any of it unaccounted for?
#   2. Which dev-server-ish processes are running, and how much RAM do they hold?
#   3. Which project directories are growing?
#
# STRICTLY READ-ONLY. Never signals a process, never deletes a file. The whole
# point of P0 is to produce numbers before P2 is ever allowed to kill anything.
#
# Usage:
#   runtime-inventory.sh [--ports] [--procs] [--disk] [--all] [--json]
#                        [--root PATH]... [--top N]
#
# With no section flag, --all is assumed.
# Exit code is always 0 — this is a report, not a gate.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

SHOW_PORTS=0; SHOW_PROCS=0; SHOW_DISK=0; AS_JSON=0; TOP=15
ROOTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --ports) SHOW_PORTS=1; shift ;;
    --procs) SHOW_PROCS=1; shift ;;
    --disk)  SHOW_DISK=1;  shift ;;
    --all)   SHOW_PORTS=1; SHOW_PROCS=1; SHOW_DISK=1; shift ;;
    --json)  AS_JSON=1; shift ;;
    --root)  ROOTS+=("${2:-}"); shift 2 ;;
    --top)   TOP="${2:-15}"; shift 2 ;;
    --help|-h) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 0 ;;
  esac
done
if [ "$SHOW_PORTS" -eq 0 ] && [ "$SHOW_PROCS" -eq 0 ] && [ "$SHOW_DISK" -eq 0 ]; then
  SHOW_PORTS=1; SHOW_PROCS=1; SHOW_DISK=1
fi

# Dev-server-ish command patterns. Used for *reporting* only in P0; the P1 gate
# reuses this list to decide what must go through dev-run.sh.
RLG_DEV_PATTERNS='vite|next dev|nuxt dev|webpack|webpack-dev-server|npm run dev|pnpm dev|yarn dev|ng serve|react-scripts|astro dev|remix dev|http\.server|live-server|serve -|serve$|rollup -w|parcel|storybook|godot|Godot|Unity|UnityEditor|emulator -avd|expo start|flutter run|playwright.*--headed|vitest|jest --watch|docker compose up|docker-compose up'

# Directories that grow without bound in game/web projects.
RLG_HEAVY_DIRS='node_modules .next .nuxt dist build out .turbo .parcel-cache .vite target Library Temp Logs .godot .import playwright-report test-results coverage .gradle Pods DerivedData'

TMPDIR_RLG="$(mktemp -d "${TMPDIR:-/tmp}/rlg-inv.XXXXXX")" || exit 0
trap 'rm -rf "$TMPDIR_RLG"' EXIT

json_rows=""
add_json() { json_rows="${json_rows}${json_rows:+,}$1"; }

# ── 1. Ports ─────────────────────────────────────────────────────────────────
section_ports() {
  local leased="$TMPDIR_RLG/leased.tsv"
  bash "${SCRIPT_DIR}/runtime-lease.sh" ports 2>/dev/null > "$leased" || : > "$leased"

  if ! command -v lsof >/dev/null 2>&1; then
    [ "$AS_JSON" -eq 0 ] && rlg_warn "lsof not available — skipping port inventory"
    return 0
  fi

  local raw="$TMPDIR_RLG/ports.raw"
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | tail -n +2 > "$raw" || : > "$raw"

  local rows="$TMPDIR_RLG/ports.tsv"
  awk '
    {
      # The last field is "(LISTEN)", not the address — scan backwards for the
      # first field that actually looks like host:port.
      port = ""
      for (i = NF; i >= 1; i--) {
        if ($i ~ /:[0-9]+$/) { n = split($i, parts, ":"); port = parts[n]; break }
      }
      if (port ~ /^[0-9]+$/) print port "\t" $2 "\t" $1
    }' "$raw" | sort -u -k1,1n -k2,2 > "$rows"

  local total=0 unregistered=0
  local out="$TMPDIR_RLG/ports.out"
  : > "$out"

  while IFS=$'\t' read -r port pid comm; do
    [ -n "$port" ] || continue
    total=$((total + 1))
    local tag cmd
    if rlg_port_allowlisted "$port"; then
      tag="ALLOWLIST"
    elif awk -F'\t' -v p="$port" '$1==p {f=1} END{exit !f}' "$leased" 2>/dev/null; then
      tag="LEASED"
    elif [ "$port" -ge "$RLG_BAND_MIN" ] && [ "$port" -le $((RLG_BAND_MAX + RLG_BAND_WIDTH)) ]; then
      tag="BAND-ORPHAN"   # in our own band but no lease → the leak we hunt
      unregistered=$((unregistered + 1))
    elif [ "$port" -ge 3000 ] && [ "$port" -le 9999 ]; then
      tag="DEV-UNMANAGED" # user-run dev server, not ours — report only
      unregistered=$((unregistered + 1))
    else
      tag="OTHER"
    fi
    cmd="$(rlg_cmd_of "$pid")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$tag" "$port" "$pid" "$comm" "${cmd:0:70}" >> "$out"
    if [ "$AS_JSON" -eq 1 ]; then
      add_json "{\"kind\":\"port\",\"tag\":\"$tag\",\"port\":$port,\"pid\":$pid,\"command\":\"$(rlg_json_escape "$comm")\",\"cmdline\":\"$(rlg_json_escape "${cmd:0:200}")\"}"
    fi
  done < "$rows"

  if [ "$AS_JSON" -eq 0 ]; then
    echo
    echo "${RLG_BLUE}━━ PORTS ━━${RLG_NC} ${RLG_DIM}(listening sockets: $total, unaccounted: $unregistered)${RLG_NC}"
    if [ -s "$out" ]; then
      printf '%-14s %-7s %-8s %-14s %s\n' "TAG" "PORT" "PID" "COMMAND" "CMDLINE"
      sort -k1,1 -k2,2n "$out" | while IFS=$'\t' read -r tag port pid comm cmd; do
        local color="$RLG_NC"
        case "$tag" in
          BAND-ORPHAN)   color="$RLG_RED" ;;
          DEV-UNMANAGED) color="$RLG_YELLOW" ;;
          LEASED)        color="$RLG_GREEN" ;;
        esac
        printf "${color}%-14s${RLG_NC} %-7s %-8s %-14s ${RLG_DIM}%s${RLG_NC}\n" "$tag" "$port" "$pid" "$comm" "$cmd"
      done
    else
      echo "(no listening sockets)"
    fi
  fi
}

# ── 2. Processes ─────────────────────────────────────────────────────────────
section_procs() {
  local out="$TMPDIR_RLG/procs.tsv"
  # rss(KB) etime pid command — filtered to dev-server-ish commands.
  # shellcheck disable=SC2009  # pgrep matches names but cannot report RSS or
  # elapsed time, which is the entire point of this section: the report exists
  # to show how much memory each stray process is holding and for how long.
  ps -Ao rss=,etime=,pid=,command= 2>/dev/null \
    | grep -E "$RLG_DEV_PATTERNS" \
    | grep -v -E 'grep -E|runtime-inventory' \
    | sort -rn \
    | head -n "$TOP" > "$out" || : > "$out"

  local total_mb=0 count=0
  if [ "$AS_JSON" -eq 0 ]; then
    echo
    echo "${RLG_BLUE}━━ DEV PROCESSES ━━${RLG_NC} ${RLG_DIM}(top $TOP by RSS)${RLG_NC}"
  fi

  if [ ! -s "$out" ]; then
    [ "$AS_JSON" -eq 0 ] && echo "(none)"
    return 0
  fi

  [ "$AS_JSON" -eq 0 ] && printf '%-9s %-11s %-8s %s\n' "RSS" "UPTIME" "PID" "COMMAND"
  while read -r rss etime pid rest; do
    [ -n "$rss" ] || continue
    count=$((count + 1))
    local mb=$((rss / 1024))
    total_mb=$((total_mb + mb))
    if [ "$AS_JSON" -eq 1 ]; then
      add_json "{\"kind\":\"proc\",\"rss_mb\":$mb,\"uptime\":\"$(rlg_json_escape "$etime")\",\"pid\":$pid,\"command\":\"$(rlg_json_escape "${rest:0:200}")\"}"
    else
      printf '%-9s %-11s %-8s %s\n' "${mb} MB" "$etime" "$pid" "${rest:0:90}"
    fi
  done < "$out"

  [ "$AS_JSON" -eq 0 ] && echo "${RLG_DIM}total: ${count} process(es), ${total_mb} MB RSS${RLG_NC}"
  return 0
}

# ── 3. Disk ──────────────────────────────────────────────────────────────────
section_disk() {
  local targets=()
  if [ "${#ROOTS[@]}" -gt 0 ]; then
    targets=("${ROOTS[@]}")
  elif [ -r "$(rlg_projects_index)" ]; then
    while IFS=$'\t' read -r _ proj; do
      [ -n "$proj" ] && [ -d "$proj" ] && targets+=("$proj")
    done < "$(rlg_projects_index)"
  fi

  if [ "$AS_JSON" -eq 0 ]; then
    echo
    echo "${RLG_BLUE}━━ DISK ━━${RLG_NC} ${RLG_DIM}(heavy dirs in ${#targets[@]} known project(s))${RLG_NC}"
  fi

  if [ "${#targets[@]}" -eq 0 ]; then
    [ "$AS_JSON" -eq 0 ] && echo "(no projects known yet — pass --root PATH, or they register on first lease)"
    return 0
  fi

  # Build the find predicate once: -iname a -o -iname b -o ...
  # -iname, not -name: macOS filesystems are case-insensitive by default, so a
  # dir listed as "Logs" may really be "logs" and a case-sensitive match silently
  # misses it — while `[ -d ... ]` would have found it. Same for Library/Temp/Pods.
  local find_expr=() first=1
  for d in $RLG_HEAVY_DIRS; do
    [ "$first" -eq 1 ] && first=0 || find_expr+=(-o)
    find_expr+=(-iname "$d")
  done

  local grand=0
  for proj in "${targets[@]}"; do
    local proj_total=0 lines=""
    # maxdepth 2 so monorepo subpackages count too (mobile/node_modules,
    # apps/web/.next, …). -prune stops find descending into what it matched.
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      local kb; kb="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
      [ -n "$kb" ] || continue
      local mb=$((kb / 1024))
      [ "$mb" -ge 1 ] || continue
      proj_total=$((proj_total + mb))
      local rel="${path#"$proj"/}"
      lines="${lines}    ${mb} MB\t${rel}\n"
      if [ "$AS_JSON" -eq 1 ]; then
        add_json "{\"kind\":\"disk\",\"project\":\"$(rlg_json_escape "$proj")\",\"dir\":\"$(rlg_json_escape "$rel")\",\"mb\":$mb}"
      fi
    done < <(find "$proj" -maxdepth 2 \
               \( -name .git -o -name .svn -o -name .hg \) -prune -o \
               \( "${find_expr[@]}" \) -type d -prune -print 2>/dev/null)

    grand=$((grand + proj_total))
    if [ "$AS_JSON" -eq 0 ] && [ "$proj_total" -gt 0 ]; then
      local short="$proj"
      case "$proj" in "$HOME"/*) short="~${proj#"$HOME"}" ;; esac
      echo "  ${short}  ${RLG_YELLOW}${proj_total} MB${RLG_NC}"
      [ -n "$lines" ] && printf "%b" "$lines" | sort -rn | head -n 6
    fi
  done
  [ "$AS_JSON" -eq 0 ] && echo "${RLG_DIM}grand total: ${grand} MB${RLG_NC}"
  return 0
}

# ── main ─────────────────────────────────────────────────────────────────────
if [ "$AS_JSON" -eq 0 ]; then
  state="active"; rlg_enabled || state="${RLG_YELLOW}DISABLED${RLG_NC}"
  echo "${RLG_BLUE}Runtime Lifecycle Guard — inventory${RLG_NC}  ${RLG_DIM}$(rlg_now_utc)${RLG_NC}"
  echo "${RLG_DIM}home: $(rlg_home) · mode: $(rlg_mode) · guard: ${state}${RLG_NC}"
fi

[ "$SHOW_PORTS" -eq 1 ] && section_ports
[ "$SHOW_PROCS" -eq 1 ] && section_procs
[ "$SHOW_DISK"  -eq 1 ] && section_disk

if [ "$AS_JSON" -eq 1 ]; then
  printf '{"generated_at":"%s","home":"%s","mode":"%s","items":[%s]}\n' \
    "$(rlg_now_utc)" "$(rlg_json_escape "$(rlg_home)")" "$(rlg_mode)" "$json_rows"
else
  echo
fi
exit 0
