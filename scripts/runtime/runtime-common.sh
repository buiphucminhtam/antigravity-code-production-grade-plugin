#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-common.sh — Shared helpers for the Runtime Lifecycle Guard (RLG)
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
# SOURCE THIS FILE, do not execute it.
#
# Scope: GLOBAL. State lives in $FORGEWRIGHT_RLG_HOME (default ~/.forgewright/runtime).
#
# Design constraints (from plan §G4):
#   - Pure bash, no python, no lsof/git in this file's hot paths. The P1
#     PreToolUse gate sources this and must stay under 100ms.
#   - Every helper is read-mostly and side-effect free unless named otherwise.
#   - NOTHING here ever kills a process. Reaping is P2 (runtime-reap.sh).
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Colors (respect NO_COLOR / non-tty) ──────────────────────────────────────
# shellcheck disable=SC2034  # consumed by scripts that source this file
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  RLG_RED=$'\033[0;31m'; RLG_GREEN=$'\033[0;32m'; RLG_YELLOW=$'\033[1;33m'
  RLG_BLUE=$'\033[0;34m'; RLG_DIM=$'\033[2m'; RLG_NC=$'\033[0m'
else
  RLG_RED=''; RLG_GREEN=''; RLG_YELLOW=''; RLG_BLUE=''; RLG_DIM=''; RLG_NC=''
fi

rlg_log()  { echo -e "${RLG_BLUE}[rlg]${RLG_NC} $*" >&2; }
rlg_ok()   { echo -e "${RLG_GREEN}✓${RLG_NC} $*" >&2; }
rlg_warn() { echo -e "${RLG_YELLOW}⚠${RLG_NC} $*" >&2; }
rlg_err()  { echo -e "${RLG_RED}✗${RLG_NC} $*" >&2; }

# ── Paths ────────────────────────────────────────────────────────────────────

# rlg_home — root of all RLG state. Overridable for tests.
rlg_home() {
  printf '%s' "${FORGEWRIGHT_RLG_HOME:-$HOME/.forgewright/runtime}"
}

rlg_leases_file()   { printf '%s/leases.jsonl'      "$(rlg_home)"; }
rlg_projects_index(){ printf '%s/projects.index'    "$(rlg_home)"; }
rlg_allowlist()     { printf '%s/port-allowlist.txt' "$(rlg_home)"; }
rlg_logs_dir()      { printf '%s/logs'              "$(rlg_home)"; }
rlg_locks_dir()     { printf '%s/locks'             "$(rlg_home)"; }
rlg_mode_file()     { printf '%s/MODE'              "$(rlg_home)"; }
rlg_disabled_file() { printf '%s/DISABLED'          "$(rlg_home)"; }
rlg_install_file()  { printf '%s/INSTALLED_FROM'    "$(rlg_home)"; }

rlg_init_dirs() {
  local h; h="$(rlg_home)"
  mkdir -p "$h" "$(rlg_logs_dir)" "$(rlg_locks_dir)" 2>/dev/null || return 1
  [ -f "$(rlg_leases_file)" ]    || : > "$(rlg_leases_file)"
  [ -f "$(rlg_projects_index)" ] || : > "$(rlg_projects_index)"
  [ -f "$(rlg_allowlist)" ]      || : > "$(rlg_allowlist)"
  [ -f "$(rlg_mode_file)" ]      || printf 'observe\n' > "$(rlg_mode_file)"
  chmod 700 "$h" 2>/dev/null || true
  return 0
}

# ── Kill-switch (plan §G4, 3 tầng) ───────────────────────────────────────────
# Returns 0 = RLG active, 1 = disabled. NEVER errors out; callers fail-open.
#
#   Tier 1: FORGEWRIGHT_RLG=off        (env, per-shell)
#   Tier 2: $RLG_HOME/DISABLED         (file, whole machine)
#   Tier 3: <project>/.forgewright/rlg-optout  (file, per-project)
rlg_enabled() {
  case "${FORGEWRIGHT_RLG:-}" in
    off|OFF|0|false|disabled) return 1 ;;
  esac
  [ -e "$(rlg_disabled_file)" ] && return 1
  local proj="${1:-}"
  [ -n "$proj" ] && [ -e "$proj/.forgewright/rlg-optout" ] && return 1
  return 0
}

# rlg_mode — observe (default) | enforce
rlg_mode() {
  local f; f="$(rlg_mode_file)"
  if [ -r "$f" ]; then
    local m; m="$(head -n1 "$f" 2>/dev/null | tr -d '[:space:]')"
    case "$m" in observe|enforce) printf '%s' "$m"; return 0 ;; esac
  fi
  printf 'observe'
}

# ── Locking (portable: no flock on macOS) ────────────────────────────────────
RLG_LOCK_HELD=""

rlg_lock() {
  local name="${1:-registry}" d tries=0
  mkdir -p "$(rlg_locks_dir)" 2>/dev/null || return 1
  d="$(rlg_locks_dir)/${name}.lock"

  # Break a stale lock (>60s old) — a crashed writer must not wedge the machine.
  if [ -d "$d" ]; then
    local age; age="$(rlg_file_age_secs "$d")"
    if [ -n "$age" ] && [ "$age" -gt 60 ]; then
      rmdir "$d" 2>/dev/null || true
    fi
  fi

  while ! mkdir "$d" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -gt 100 ] && return 1
    sleep 0.05
  done
  RLG_LOCK_HELD="$d"
  return 0
}

rlg_unlock() {
  [ -n "$RLG_LOCK_HELD" ] && rmdir "$RLG_LOCK_HELD" 2>/dev/null
  RLG_LOCK_HELD=""
  return 0
}

# rlg_file_age_secs <path> — seconds since mtime; empty on failure.
rlg_file_age_secs() {
  local p="$1" mtime now
  [ -e "$p" ] || return 1
  mtime="$(stat -f %m "$p" 2>/dev/null || stat -c %Y "$p" 2>/dev/null)" || return 1
  [ -n "$mtime" ] || return 1
  now="$(date +%s)"
  printf '%s' "$(( now - mtime ))"
}

# ── Identity / time ──────────────────────────────────────────────────────────

rlg_now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

rlg_lease_id() {
  # 16 hex chars, no python (hot-path safe).
  local raw
  raw="$(dd if=/dev/urandom bs=8 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  [ -n "$raw" ] || raw="$(date +%s)$$"
  printf 'rlg-%s' "${raw:0:16}"
}

# rlg_session_id — best-effort owner id for the current agent session.
rlg_session_id() {
  printf '%s' "${FORGEWRIGHT_SESSION_ID:-${CLAUDE_SESSION_ID:-shell-$PPID}}"
}

# ── Project resolution ───────────────────────────────────────────────────────

# rlg_project_root [path] — git toplevel if available, else realpath of dir.
rlg_project_root() {
  local p="${1:-$PWD}" root
  [ -d "$p" ] || p="$(dirname "$p")"
  root="$(cd "$p" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$root" ]; then printf '%s' "$root"; return 0; fi
  (cd "$p" 2>/dev/null && pwd -P)
}

# ── Port bands (plan §3.2) ───────────────────────────────────────────────────
# A project always gets the same 10-port band, persisted in projects.index.
# Band range 20000..23990 — above the usual dev ports so we never fight
# whatever the user already runs on 3000/5432/8080.

RLG_BAND_MIN=20000
RLG_BAND_MAX=23990
RLG_BAND_WIDTH=10

# Role → offset within the band. Order is contractual; append only.
RLG_ROLES="web-dev web-preview api game-editor emulator test-runner storybook docs aux1 aux2"

rlg_role_offset() {
  local want="$1" i=0 r
  for r in $RLG_ROLES; do
    [ "$r" = "$want" ] && { printf '%s' "$i"; return 0; }
    i=$((i + 1))
  done
  return 1
}

rlg_role_valid() { rlg_role_offset "$1" >/dev/null 2>&1; }

# rlg_port_band <project_root> — deterministic base port; assigns + persists
# on first sight, resolves collisions by linear probe.
rlg_port_band() {
  local project="$1" idx found crc base candidate guard=0
  [ -n "$project" ] || return 1
  idx="$(rlg_projects_index)"

  if [ -r "$idx" ]; then
    found="$(awk -F'\t' -v p="$project" '$2==p {print $1; exit}' "$idx" 2>/dev/null)"
    [ -n "$found" ] && { printf '%s' "$found"; return 0; }
  fi

  rlg_init_dirs || return 1
  rlg_lock "index" || return 1

  # Re-read under lock — another writer may have won the race.
  found="$(awk -F'\t' -v p="$project" '$2==p {print $1; exit}' "$idx" 2>/dev/null)"
  if [ -n "$found" ]; then rlg_unlock; printf '%s' "$found"; return 0; fi

  crc="$(printf '%s' "$project" | cksum | awk '{print $1}')"
  base=$(( RLG_BAND_MIN + (crc % 400) * RLG_BAND_WIDTH ))
  candidate="$base"
  while awk -F'\t' -v b="$candidate" '$1==b {f=1} END{exit !f}' "$idx" 2>/dev/null; do
    candidate=$(( candidate + RLG_BAND_WIDTH ))
    [ "$candidate" -gt "$RLG_BAND_MAX" ] && candidate="$RLG_BAND_MIN"
    guard=$((guard + 1))
    if [ "$guard" -gt 400 ]; then rlg_unlock; rlg_err "port band space exhausted"; return 1; fi
  done

  printf '%s\t%s\n' "$candidate" "$project" >> "$idx"
  rlg_unlock
  printf '%s' "$candidate"
}

# rlg_port_for <project_root> <role>
rlg_port_for() {
  local project="$1" role="$2" base off
  base="$(rlg_port_band "$project")" || return 1
  off="$(rlg_role_offset "$role")" || { rlg_err "unknown role: $role (valid: $RLG_ROLES)"; return 1; }
  printf '%s' "$(( base + off ))"
}

# ── Process / port introspection (read-only) ─────────────────────────────────

rlg_pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

rlg_pgid_of() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
}

rlg_cmd_of() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  ps -o command= -p "$pid" 2>/dev/null | head -n1
}

# rlg_port_allowlisted <port> — infrastructure we must never touch (plan §G7).
rlg_port_allowlisted() {
  local port="${1:-}" f
  [ -n "$port" ] || return 1
  f="$(rlg_allowlist)"
  [ -r "$f" ] || return 1
  awk -v p="$port" '
    /^[[:space:]]*#/ { next }
    { gsub(/#.*/, ""); gsub(/[[:space:]]+$/, "") }
    $1 == p { found = 1 }
    END { exit !found }
  ' "$f" 2>/dev/null
}

# rlg_count_entries <file> — non-blank, non-comment lines. Always prints a
# number. (`grep -c` exits 1 on zero matches, which makes `... || echo 0`
# print twice — hence awk.)
rlg_count_entries() {
  local f="${1:-}"
  [ -r "$f" ] || { printf '0'; return 0; }
  awk 'BEGIN{c=0} !/^[[:space:]]*($|#)/ {c++} END{printf "%d", c}' "$f" 2>/dev/null || printf '0'
}

# rlg_sha256 <file>
rlg_sha256() {
  local f="$1"
  [ -r "$f" ] || return 1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" 2>/dev/null | awk '{print $1}'
  else
    return 1
  fi
}

# rlg_json_escape <string> — minimal JSON string escaping, no python.
rlg_json_escape() {
  printf '%s' "${1:-}" | awk '
    BEGIN { RS="\0" }
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      gsub(/\n/, "\\n")
      printf "%s", $0
    }'
}
