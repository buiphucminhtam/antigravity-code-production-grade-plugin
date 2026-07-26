#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-hooks-install.sh — Wire the RLG gate into Claude / Codex / Antigravity
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 — SPAWN, §G3)
#
#   runtime-hooks-install.sh --install [--platform all|claude|codex|agy] [--dry-run]
#   runtime-hooks-install.sh --verify
#   runtime-hooks-install.sh --uninstall
#   runtime-hooks-install.sh --status
#
# Each CLI keeps its hooks somewhere different, in a different format, under a
# different contract:
#
#   claude → ~/.claude/settings.json          JSON  hooks.PreToolUse[]
#   codex  → ~/.codex/config.toml             TOML  [[hooks.PreToolUse]]
#   agy    → ~/.gemini/config/hooks.json      JSON  named-hook registry
#
# Properties this script guarantees:
#   • idempotent      — re-running never adds a second copy
#   • non-destructive — existing hooks (gitnexus, forgewright-policy…) untouched
#   • backed up       — every file copied to <file>.bak-rlg-<utc> before writing
#   • reversible      — --uninstall removes exactly what --install added
#   • honest          — --dry-run shows the change without making it
#
# Paths are overridable (--claude-settings/--codex-config/--agy-hooks) so the
# test suite can exercise all of this against throwaway copies.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

# The installed (symlinked) gate — never the repo path, so the wired command
# matches what `runtime-install.sh --verify` checksums.
GATE_CMD_BASE="${FORGEWRIGHT_RLG_GATE:-$HOME/.forgewright/scripts/runtime/runtime-pretool-gate.sh}"
SWEEP_CMD_BASE="${FORGEWRIGHT_RLG_SWEEP:-$HOME/.forgewright/scripts/runtime/runtime-sweep.sh}"
MARKER="runtime-pretool-gate.sh"
SWEEP_MARKER="runtime-sweep.sh"

CLAUDE_SETTINGS="${FORGEWRIGHT_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
CODEX_CONFIG="${FORGEWRIGHT_CODEX_CONFIG:-$HOME/.codex/config.toml}"
AGY_HOOKS="${FORGEWRIGHT_AGY_HOOKS:-$HOME/.gemini/config/hooks.json}"

ACTION=""; PLATFORMS="all"; DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --install)   ACTION="install";   shift ;;
    --verify)    ACTION="verify";    shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --status)    ACTION="status";    shift ;;
    --platform)  PLATFORMS="${2:-all}"; shift 2 ;;
    --dry-run)   DRY=1; shift ;;
    --claude-settings) CLAUDE_SETTINGS="${2:-}"; shift 2 ;;
    --codex-config)    CODEX_CONFIG="${2:-}";    shift 2 ;;
    --agy-hooks)       AGY_HOOKS="${2:-}";       shift 2 ;;
    --help|-h) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 2 ;;
  esac
done
[ -n "$ACTION" ] || { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

wants() { # wants <platform>
  case "$PLATFORMS" in all|ALL) return 0 ;; esac
  case ",$PLATFORMS," in *",$1,"*) return 0 ;; esac
  return 1
}

backup() {
  local f="$1"
  [ -f "$f" ] || return 0
  [ "$DRY" -eq 1 ] && { echo "    [dry-run] would back up $f"; return 0; }
  cp "$f" "${f}.bak-rlg-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || return 1
  return 0
}

# ── claude: JSON, hooks.PreToolUse[] ─────────────────────────────────────────
claude_cmd() { printf 'bash "%s" --platform CLAUDE' "$GATE_CMD_BASE"; }

# claude_json_apply <mode> <event> <matcher> <cmd> <marker> <label>
claude_json_apply() {
  local mode="$1" event="$2" matcher="$3" cmd="$4" marker="$5" label="$6"
  [ -f "$CLAUDE_SETTINGS" ] || { [ "$mode" = check ] && return 1; mkdir -p "$(dirname "$CLAUDE_SETTINGS")" 2>/dev/null; printf '{}\n' > "$CLAUDE_SETTINGS"; }
  MODE="$mode" CMD="$cmd" MARKER="$marker" DRY="$DRY" \
  EVENT="$event" MATCHER="$matcher" LABEL="$label" \
  python3 - "$CLAUDE_SETTINGS" <<'PY'
import json, os, sys

path = sys.argv[1]
mode = os.environ["MODE"]
cmd = os.environ["CMD"]
marker = os.environ["MARKER"]
dry = os.environ["DRY"] == "1"

try:
    data = json.load(open(path))
except Exception:
    data = {}
if not isinstance(data, dict):
    print("CORRUPT: settings root is not an object", file=sys.stderr)
    sys.exit(2)

event = os.environ.get("EVENT", "PreToolUse")
matcher = os.environ.get("MATCHER", "Bash")
label = os.environ.get("LABEL", "Runtime Lifecycle Guard")
hooks = data.setdefault("hooks", {})
pre = hooks.setdefault(event, [])
if not isinstance(pre, list):
    print(f"CORRUPT: hooks.{event} is not a list", file=sys.stderr)
    sys.exit(2)

present = any(
    marker in h.get("command", "")
    for entry in pre if isinstance(entry, dict)
    for h in entry.get("hooks", []) if isinstance(h, dict)
)

if mode == "check":
    print("PRESENT" if present else "ABSENT")
    sys.exit(0 if present else 1)

if mode == "install":
    if present:
        print("already wired")
        sys.exit(0)
    # A separate entry rather than appending into the existing gitnexus group:
    # different matcher, independent failure domain, and removable on its own.
    entry = {"hooks": [{"type": "command", "command": cmd, "timeout": 5,
                        "statusMessage": label}]}
    # Stop hooks in this file carry no matcher (see the existing verify-gate /
    # stop-gate entries); PreToolUse ones do.
    if matcher:
        entry["matcher"] = matcher
    pre.append(entry)
elif mode == "uninstall":
    if not present:
        print("not wired")
        sys.exit(0)
    kept = []
    for entry in pre:
        if not isinstance(entry, dict):
            kept.append(entry); continue
        inner = [h for h in entry.get("hooks", [])
                 if not (isinstance(h, dict) and marker in h.get("command", ""))]
        if inner:
            entry["hooks"] = inner
            kept.append(entry)
        # entry dropped entirely when it held only our hook
    hooks[event] = kept

if dry:
    print("[dry-run] " + ("would add" if mode == "install" else "would remove") + f" Claude {event} hook")
    sys.exit(0)

tmp = path + ".rlg-tmp"
with open(tmp, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
json.load(open(tmp))          # parse-check before it replaces the real file
os.replace(tmp, path)
print("ok")
PY
}

claude_apply() {
  claude_json_apply "$1" PreToolUse Bash "$(claude_cmd)" "$MARKER" \
    "Runtime Lifecycle Guard (observe)..."
}

# Stop entries in this file carry no matcher — matching the existing
# verify-gate / stop-gate entries already present there.
claude_sweep_apply() {
  claude_json_apply "$1" Stop "" "bash \"$SWEEP_CMD_BASE\"" "$SWEEP_MARKER" \
    "Runtime Lifecycle Guard sweep..."
}

# ── agy: JSON, named-hook registry ───────────────────────────────────────────
agy_cmd() { printf 'bash "%s" --platform ANTIGRAVITY' "$GATE_CMD_BASE"; }

agy_apply() {
  local mode="$1"
  [ -f "$AGY_HOOKS" ] || { [ "$mode" = check ] && return 1; mkdir -p "$(dirname "$AGY_HOOKS")" 2>/dev/null; printf '{}\n' > "$AGY_HOOKS"; }
  MODE="$mode" CMD="$(agy_cmd)" DRY="$DRY" \
  python3 - "$AGY_HOOKS" <<'PY'
import json, os, sys

path = sys.argv[1]
mode = os.environ["MODE"]
cmd = os.environ["CMD"]
dry = os.environ["DRY"] == "1"
KEY = "forgewright-runtime-guard"   # our own key; never touch forgewright-policy

try:
    data = json.load(open(path))
except Exception:
    data = {}
if not isinstance(data, dict) or isinstance(data, list):
    print("CORRUPT: Antigravity hooks registry must be an object", file=sys.stderr)
    sys.exit(2)

present = KEY in data

if mode == "check":
    print("PRESENT" if present else "ABSENT")
    sys.exit(0 if present else 1)

if mode == "install":
    data[KEY] = {
        "PreToolUse": [{
            "matcher": "*",
            "hooks": [{"type": "command", "command": cmd, "timeout": 5}],
        }]
    }
elif mode == "uninstall":
    if not present:
        print("not wired")
        sys.exit(0)
    del data[KEY]

if dry:
    print("[dry-run] " + ("would add" if mode == "install" else "would remove") + f" Antigravity hook '{KEY}'")
    sys.exit(0)

tmp = path + ".rlg-tmp"
with open(tmp, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
json.load(open(tmp))
os.replace(tmp, path)
print("ok")
PY
}

# ── codex: TOML, append-with-guard ───────────────────────────────────────────
# No TOML writer in the stdlib, so install appends a self-contained block (the
# same approach forgewright-install.sh already uses) and uninstall strips it
# between explicit markers. Markers make removal exact instead of regex-guessy.
CODEX_BEGIN="# >>> forgewright runtime-lifecycle-guard >>>"
CODEX_END="# <<< forgewright runtime-lifecycle-guard <<<"

codex_apply() {
  local mode="$1"
  case "$mode" in
    check)
      [ -f "$CODEX_CONFIG" ] && grep -qF "$MARKER" "$CODEX_CONFIG" 2>/dev/null \
        && { echo PRESENT; return 0; }
      echo ABSENT; return 1 ;;
    install)
      if [ -f "$CODEX_CONFIG" ] && grep -qF "$MARKER" "$CODEX_CONFIG" 2>/dev/null; then
        echo "already wired"; return 0
      fi
      if [ "$DRY" -eq 1 ]; then echo "[dry-run] would append Codex [[hooks.PreToolUse]] block"; return 0; fi
      mkdir -p "$(dirname "$CODEX_CONFIG")" 2>/dev/null
      {
        printf '\n%s\n' "$CODEX_BEGIN"
        printf '[[hooks.PreToolUse]]\n'
        printf 'matcher = "Bash"\n'
        printf '[[hooks.PreToolUse.hooks]]\n'
        printf 'type = "command"\n'
        printf 'command = "bash \\"%s\\" --platform CODEX"\n' "$GATE_CMD_BASE"
        printf 'timeout = 5\n'
        printf 'statusMessage = "Runtime Lifecycle Guard (observe)..."\n'
        printf '%s\n' "$CODEX_END"
      } >> "$CODEX_CONFIG" || return 1
      echo ok; return 0 ;;
    uninstall)
      [ -f "$CODEX_CONFIG" ] || { echo "not wired"; return 0; }
      grep -qF "$MARKER" "$CODEX_CONFIG" 2>/dev/null || { echo "not wired"; return 0; }
      if [ "$DRY" -eq 1 ]; then echo "[dry-run] would strip Codex block"; return 0; fi
      BEGIN="$CODEX_BEGIN" END="$CODEX_END" python3 - "$CODEX_CONFIG" <<'PY'
import os, sys
path = sys.argv[1]
begin, end = os.environ["BEGIN"], os.environ["END"]
out, skip = [], False
for line in open(path).read().splitlines(keepends=True):
    if line.strip() == begin:
        skip = True
        # drop the blank separator line we wrote before the marker
        while out and out[-1].strip() == "":
            out.pop()
        continue
    if line.strip() == end:
        skip = False
        continue
    if not skip:
        out.append(line)
tmp = path + ".rlg-tmp"
open(tmp, "w").write("".join(out))
os.replace(tmp, path)
print("ok")
PY
      return 0 ;;
  esac
}

CODEX_SWEEP_BEGIN="# >>> forgewright runtime-lifecycle-guard sweep >>>"
CODEX_SWEEP_END="# <<< forgewright runtime-lifecycle-guard sweep <<<"

codex_sweep_apply() {
  local mode="$1"
  case "$mode" in
    check)
      [ -f "$CODEX_CONFIG" ] && grep -qF "$SWEEP_MARKER" "$CODEX_CONFIG" 2>/dev/null \
        && { echo PRESENT; return 0; }
      echo ABSENT; return 1 ;;
    install)
      if [ -f "$CODEX_CONFIG" ] && grep -qF "$SWEEP_MARKER" "$CODEX_CONFIG" 2>/dev/null; then
        echo "already wired"; return 0
      fi
      if [ "$DRY" -eq 1 ]; then echo "[dry-run] would append Codex [[hooks.Stop]] sweep block"; return 0; fi
      mkdir -p "$(dirname "$CODEX_CONFIG")" 2>/dev/null
      {
        printf '\n%s\n' "$CODEX_SWEEP_BEGIN"
        printf '[[hooks.Stop]]\n'
        printf '[[hooks.Stop.hooks]]\n'
        printf 'type = "command"\n'
        printf 'command = "bash \\"%s\\""\n' "$SWEEP_CMD_BASE"
        printf 'timeout = 5\n'
        printf '%s\n' "$CODEX_SWEEP_END"
      } >> "$CODEX_CONFIG" || return 1
      echo ok; return 0 ;;
    uninstall)
      [ -f "$CODEX_CONFIG" ] || { echo "not wired"; return 0; }
      grep -qF "$SWEEP_MARKER" "$CODEX_CONFIG" 2>/dev/null || { echo "not wired"; return 0; }
      if [ "$DRY" -eq 1 ]; then echo "[dry-run] would strip Codex sweep block"; return 0; fi
      BEGIN="$CODEX_SWEEP_BEGIN" END="$CODEX_SWEEP_END" python3 - "$CODEX_CONFIG" <<'PYSWEEP'
import os, sys
path = sys.argv[1]
begin, end = os.environ["BEGIN"], os.environ["END"]
out, skip = [], False
for line in open(path).read().splitlines(keepends=True):
    if line.strip() == begin:
        skip = True
        while out and out[-1].strip() == "":
            out.pop()
        continue
    if line.strip() == end:
        skip = False
        continue
    if not skip:
        out.append(line)
tmp = path + ".rlg-tmp"
open(tmp, "w").write("".join(out))
os.replace(tmp, path)
print("ok")
PYSWEEP
      return 0 ;;
  esac
}

# ── drivers ──────────────────────────────────────────────────────────────────
run_for() { # <label> <file> <fn> <mode>
  local label="$1" file="$2" fn="$3" mode="$4" out
  printf '  %-6s %s\n' "$label" "$file"
  if [ "$mode" != "check" ] && [ "$DRY" -eq 0 ]; then
    backup "$file" || { rlg_err "    backup failed — refusing to modify"; return 1; }
  fi
  out="$("$fn" "$mode" 2>&1)"; local rc=$?
  printf '         %s\n' "${out:-（no output）}"
  return $rc
}

do_install() {
  local fails=0
  echo "${RLG_BLUE}Wiring Runtime Lifecycle Guard into CLI hooks${RLG_NC}"
  echo "  gate: $GATE_CMD_BASE"
  [ -e "$GATE_CMD_BASE" ] || rlg_warn "gate not found at that path — run runtime-install.sh --link first"
  [ "$DRY" -eq 1 ] && echo "  ${RLG_YELLOW}DRY RUN — nothing will be written${RLG_NC}"
  echo
  wants claude && { run_for claude "$CLAUDE_SETTINGS" claude_apply install || fails=$((fails+1)); }
  wants codex  && { run_for codex  "$CODEX_CONFIG"    codex_apply  install || fails=$((fails+1)); }
  wants agy    && { run_for agy    "$AGY_HOOKS"       agy_apply    install || fails=$((fails+1)); }
  # Reclaim sweep on Stop. Antigravity's registry exposes no Stop/SessionEnd
  # event, but the registry is machine-global so Claude's and Codex's sweeps
  # reclaim leases opened under Antigravity too.
  echo "  ${RLG_DIM}reclaim sweep (Stop hook):${RLG_NC}"
  wants claude && { run_for claude "$CLAUDE_SETTINGS" claude_sweep_apply install || fails=$((fails+1)); }
  wants codex  && { run_for codex  "$CODEX_CONFIG"    codex_sweep_apply  install || fails=$((fails+1)); }
  echo
  [ "$fails" -eq 0 ] && rlg_ok "done — mode is $(rlg_mode); disable anytime with: touch $(rlg_disabled_file)"
  return "$fails"
}

do_uninstall() {
  local fails=0
  echo "${RLG_BLUE}Removing Runtime Lifecycle Guard CLI hooks${RLG_NC}"
  wants claude && { run_for claude "$CLAUDE_SETTINGS" claude_sweep_apply uninstall || fails=$((fails+1)); }
  wants codex  && { run_for codex  "$CODEX_CONFIG"    codex_sweep_apply  uninstall || fails=$((fails+1)); }
  wants claude && { run_for claude "$CLAUDE_SETTINGS" claude_apply uninstall || fails=$((fails+1)); }
  wants codex  && { run_for codex  "$CODEX_CONFIG"    codex_apply  uninstall || fails=$((fails+1)); }
  wants agy    && { run_for agy    "$AGY_HOOKS"       agy_apply    uninstall || fails=$((fails+1)); }
  return "$fails"
}

do_verify() {
  local missing=0 state sweep f
  echo "${RLG_BLUE}RLG CLI hook wiring${RLG_NC}"
  for p in claude codex agy; do
    wants "$p" || continue
    case "$p" in
      claude) state="$(claude_apply check 2>/dev/null)"; f="$CLAUDE_SETTINGS" ;;
      codex)  state="$(codex_apply  check 2>/dev/null)"; f="$CODEX_CONFIG" ;;
      agy)    state="$(agy_apply    check 2>/dev/null)"; f="$AGY_HOOKS" ;;
    esac
    sweep="n/a"
    case "$p" in
      claude) sweep="$(claude_sweep_apply check 2>/dev/null)" ;;
      codex)  sweep="$(codex_sweep_apply  check 2>/dev/null)" ;;
    esac
    if [ "$state" = "PRESENT" ]; then
      printf "  %s %-6s gate ${RLG_DIM}·${RLG_NC} sweep %-8s %s\n" \
        "${RLG_GREEN}✓${RLG_NC}" "$p" \
        "$([ "$sweep" = "PRESENT" ] && printf "%b" "${RLG_GREEN}on${RLG_NC}" || printf "%b" "${RLG_DIM}$sweep${RLG_NC}")" "$f"
    else
      printf '  %s %-6s %s ${RLG_DIM}(not wired)${RLG_NC}\n' "${RLG_YELLOW}○${RLG_NC}" "$p" "$f"
      missing=$((missing + 1))
    fi
  done
  return "$missing"
}

do_status() { do_verify; echo; bash "${SCRIPT_DIR}/runtime-install.sh" --status 2>/dev/null; }

case "$ACTION" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  verify)    do_verify ;;
  status)    do_status ;;
esac
