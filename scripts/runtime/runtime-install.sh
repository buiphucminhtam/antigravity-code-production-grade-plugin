#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-install.sh — Global installer for the Runtime Lifecycle Guard
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P0.5 — INSTALL, §G2)
#
# WHY THIS EXISTS
#   ~/.forgewright/scripts/ is populated by COPY, and it has already drifted
#   from the repo (cleanup.sh: global May 18 vs repo Jul 9). A copied reaper
#   would mean the script holding kill authority does not match the source
#   anyone reviews. So RLG installs by SYMLINK and verifies by checksum.
#
#   This is the ONE place in the whole design that is fail-CLOSED: if the
#   install cannot be verified, the guard must refuse to run rather than
#   execute code of unknown provenance. Everything else fails open.
#
# Usage:
#   runtime-install.sh --link      [--from REPO] [--target DIR]
#   runtime-install.sh --verify    [--quiet]
#   runtime-install.sh --status
#   runtime-install.sh --uninstall
#
# Exit codes: 0 ok · 1 problem (broken/drifted/not installed) · 2 usage
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/runtime/runtime-common.sh
. "${SCRIPT_DIR}/runtime-common.sh"

# Files that make up the guard. Append-only lists.
#   RLG_FILES      — sourced from scripts/runtime/
#   RLG_LITE_FILES — sourced from scripts/lite/ (hooks live there by repo
#                    convention, alongside stop-gate.sh / verify-gate.sh)
# Both are symlinked into the same install dir so the manifest covers every
# file that can execute with the guard's authority.
RLG_FILES="runtime-common.sh runtime_registry.py runtime-lease.sh runtime-inventory.sh runtime-install.sh runtime-hooks-install.sh runtime-reap.sh runtime-sweep.sh disk-budget.sh runtime-gc.sh port-broker.sh dev-run.sh rlg_spawn.py"
RLG_LITE_FILES="runtime-pretool-gate.sh"

DEFAULT_TARGET="$HOME/.forgewright/scripts/runtime"

ACTION=""
FROM_REPO=""
TARGET="${FORGEWRIGHT_RLG_TARGET:-$DEFAULT_TARGET}"
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --link)      ACTION="link";      shift ;;
    --verify)    ACTION="verify";    shift ;;
    --status)    ACTION="status";    shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --from)      FROM_REPO="${2:-}"; shift 2 ;;
    --target)    TARGET="${2:-}";    shift 2 ;;
    --quiet)     QUIET=1; shift ;;
    --help|-h)   sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) rlg_err "unknown arg: $1"; exit 2 ;;
  esac
done
[ -n "$ACTION" ] || { sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

say() { [ "$QUIET" -eq 1 ] || echo -e "$*"; }

# repo_src_dir — where the canonical scripts live.
repo_src_dir() {
  if [ -n "$FROM_REPO" ]; then
    printf '%s/scripts/runtime' "$(cd "$FROM_REPO" 2>/dev/null && pwd -P)"
  else
    printf '%s' "$SCRIPT_DIR"
  fi
}

repo_root_of() {
  local src="$1"
  (cd "$src/../.." 2>/dev/null && pwd -P) || printf '%s' "$src"
}

git_sha_of() {
  local root="$1"
  (cd "$root" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null) || printf 'NOGIT'
}

# ── seed the allowlist from whatever is already running (plan §G7) ───────────
# Everything listening at install time predates the guard, therefore it is
# infrastructure and must never be touched. This is the safety floor for P2.
seed_allowlist() {
  local f; f="$(rlg_allowlist)"
  if [ -s "$f" ]; then
    say "  allowlist: kept (already has $(rlg_count_entries "$f") entries)"
    return 0
  fi
  command -v lsof >/dev/null 2>&1 || { say "  allowlist: lsof unavailable, left empty"; return 0; }

  {
    echo "# RLG port allowlist — ports here are NEVER reaped."
    echo "# Seeded at install from processes already listening on $(rlg_now_utc)."
    echo "# Format: <port>   # <comment>"
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '
      {
        # The last field is "(LISTEN)", not the address — scan backwards for
        # the first field that actually looks like host:port.
        port = ""
        for (i = NF; i >= 1; i--) {
          if ($i ~ /:[0-9]+$/) { n = split($i, parts, ":"); port = parts[n]; break }
        }
        if (port ~ /^[0-9]+$/ && !(port in seen)) { seen[port] = $1 }
      }
      END { for (p in seen) printf "%s\t# %s (pre-existing at install)\n", p, seen[p] }
    ' | sort -n
  } > "$f"
  say "  allowlist: seeded $(rlg_count_entries "$f") pre-existing port(s)"
}

# ── link ─────────────────────────────────────────────────────────────────────
do_link() {
  local src root sha
  src="$(repo_src_dir)"
  [ -d "$src" ] || { rlg_err "source dir not found: $src"; return 1; }
  root="$(repo_root_of "$src")"
  sha="$(git_sha_of "$root")"

  say "${RLG_BLUE}Installing Runtime Lifecycle Guard${RLG_NC}"
  say "  source: $src ($sha)"
  say "  target: $TARGET"

  rlg_init_dirs || { rlg_err "cannot initialise $(rlg_home)"; return 1; }
  mkdir -p "$TARGET" || { rlg_err "cannot create $TARGET"; return 1; }

  local lite_src="$root/scripts/lite"
  local entries="" missing=0 f s h

  link_one() { # <source_dir> <filename>
    s="$1/$2"
    if [ ! -r "$s" ]; then rlg_err "missing source file: $s"; missing=1; return 1; fi
    ln -sfn "$s" "$TARGET/$2" || { rlg_err "cannot symlink $2"; missing=1; return 1; }
    h="$(rlg_sha256 "$s")"
    # src_dir is recorded per file: the hook comes from scripts/lite/ while the
    # rest come from scripts/runtime/, and verify must know which is which or a
    # file could be swapped for one from another directory undetected.
    entries="${entries}${entries:+,}{\"name\":\"$2\",\"src_dir\":\"$(rlg_json_escape "$1")\",\"sha256\":\"$h\"}"
    say "  ${RLG_GREEN}link${RLG_NC} $2"
    return 0
  }

  for f in $RLG_FILES;      do link_one "$src" "$f"; done
  for f in $RLG_LITE_FILES; do link_one "$lite_src" "$f"; done
  [ "$missing" -eq 0 ] || { rlg_err "install incomplete"; return 1; }

  printf '{"schema_version":"1","repo":"%s","src":"%s","git_sha":"%s","installed_at":"%s","target":"%s","files":[%s]}\n' \
    "$(rlg_json_escape "$root")" "$(rlg_json_escape "$src")" "$sha" \
    "$(rlg_now_utc)" "$(rlg_json_escape "$TARGET")" "$entries" \
    > "$(rlg_install_file)" || { rlg_err "cannot write $(rlg_install_file)"; return 1; }

  seed_allowlist
  say "  mode: $(rlg_mode) ${RLG_DIM}(observe = report only, nothing is killed)${RLG_NC}"
  rlg_ok "installed — verify with: bash $TARGET/runtime-install.sh --verify"
  return 0
}

# ── verify (FAIL-CLOSED) ─────────────────────────────────────────────────────
do_verify() {
  local rec; rec="$(rlg_install_file)"
  if [ ! -r "$rec" ]; then
    say "${RLG_RED}NOT INSTALLED${RLG_NC} — no $(rlg_install_file)"
    return 1
  fi

  local target src problems=0 checked=0
  target="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["target"])' "$rec" 2>/dev/null)"
  src="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["src"])' "$rec" 2>/dev/null)"
  if [ -z "$target" ] || [ -z "$src" ]; then
    say "${RLG_RED}CORRUPT${RLG_NC} — cannot parse $rec"
    return 1
  fi

  say "${RLG_BLUE}Verifying RLG install${RLG_NC}"
  say "  ${RLG_DIM}target: $target${RLG_NC}"
  say "  ${RLG_DIM}source: $src${RLG_NC}"

  # Extract the recorded manifest to a temp file first. It is deliberately NOT
  # a `< <(python3 ...)` process substitution: a failing extractor there yields
  # an empty stream, the loop silently does nothing, and verify reports PASS
  # having checked nothing. Fail-closed means an empty manifest is a failure.
  local manifest; manifest="$(mktemp "${TMPDIR:-/tmp}/rlg-manifest.XXXXXX")" || return 1
  python3 - "$rec" > "$manifest" 2>/dev/null <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
fallback = data.get("src", "")
for entry in data.get("files", []):
    print(entry["name"] + "\t" + entry.get("src_dir", fallback) + "\t" + entry["sha256"])
PY
  if [ ! -s "$manifest" ]; then
    rm -f "$manifest"
    say "  ${RLG_RED}EMPTY  ${RLG_NC} manifest lists no files — refusing to report a vacuous PASS"
    say "${RLG_RED}✗ verify FAILED — install record unusable. Guard must not run.${RLG_NC}"
    return 1
  fi

  # Walk the recorded manifest: name<TAB>src_dir<TAB>sha256
  while IFS=$'\t' read -r name src_dir want; do
    [ -n "$name" ] || continue
    [ -n "$src_dir" ] || src_dir="$src"
    local link="$target/$name" got

    if [ ! -L "$link" ]; then
      say "  ${RLG_RED}BROKEN ${RLG_NC} $name — not a symlink (copy? deleted?)"
      problems=$((problems + 1)); continue
    fi
    if [ ! -e "$link" ]; then
      say "  ${RLG_RED}DANGLING${RLG_NC} $name — symlink target gone"
      problems=$((problems + 1)); continue
    fi

    local real; real="$(cd "$(dirname "$link")" && readlink "$name")"
    case "$real" in
      "$src_dir/$name") : ;;
      *) say "  ${RLG_RED}FOREIGN${RLG_NC} $name — points at $real, expected $src_dir/$name"
         problems=$((problems + 1)); continue ;;
    esac

    got="$(rlg_sha256 "$link")"
    if [ "$got" != "$want" ]; then
      say "  ${RLG_YELLOW}DRIFT  ${RLG_NC} $name — source changed since install"
      say "           ${RLG_DIM}want ${want:0:12}… got ${got:0:12}… → re-run --link${RLG_NC}"
      problems=$((problems + 1)); continue
    fi
    say "  ${RLG_GREEN}OK     ${RLG_NC} $name"
    checked=$((checked + 1))
  done < "$manifest"
  rm -f "$manifest"

  if [ "$checked" -eq 0 ] && [ "$problems" -eq 0 ]; then
    say "  ${RLG_RED}EMPTY  ${RLG_NC} no file was actually checked"
    problems=$((problems + 1))
  fi

  # Anything in the target dir we did not put there is suspect.
  if [ -d "$target" ]; then
    for extra in "$target"/*; do
      [ -e "$extra" ] || continue
      local base; base="$(basename "$extra")"
      case " $RLG_FILES $RLG_LITE_FILES " in
        *" $base "*) : ;;
        *) say "  ${RLG_YELLOW}EXTRA  ${RLG_NC} $base — unmanaged file in install dir"
           problems=$((problems + 1)) ;;
      esac
    done
  fi

  if [ "$problems" -gt 0 ]; then
    say "${RLG_RED}✗ verify FAILED — $problems problem(s). Guard must not run.${RLG_NC}"
    return 1
  fi
  say "${RLG_GREEN}✓ verify PASSED — install matches source${RLG_NC}"
  return 0
}

# ── status ───────────────────────────────────────────────────────────────────
do_status() {
  local state="active"; rlg_enabled || state="DISABLED"
  echo "${RLG_BLUE}Runtime Lifecycle Guard — status${RLG_NC}"
  echo "  home:      $(rlg_home)"
  echo "  guard:     $state"
  echo "  mode:      $(rlg_mode)"
  echo "  installed: $([ -r "$(rlg_install_file)" ] && echo yes || echo no)"
  if [ -r "$(rlg_install_file)" ]; then
    echo "  from:      $(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["repo"],d["git_sha"])' "$(rlg_install_file)" 2>/dev/null)"
    echo "  at:        $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["installed_at"])' "$(rlg_install_file)" 2>/dev/null)"
  fi
  echo "  allowlist: $(rlg_count_entries "$(rlg_allowlist)") port(s)"
  echo "  projects:  $(rlg_count_entries "$(rlg_projects_index)") project(s)"
  echo
  bash "${SCRIPT_DIR}/runtime-lease.sh" status 2>/dev/null
  echo
  echo "${RLG_DIM}kill-switch: FORGEWRIGHT_RLG=off · touch $(rlg_disabled_file) · <project>/.forgewright/rlg-optout${RLG_NC}"
  return 0
}

# ── uninstall ────────────────────────────────────────────────────────────────
do_uninstall() {
  local rec; rec="$(rlg_install_file)"
  local target="$TARGET"
  [ -r "$rec" ] && target="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["target"])' "$rec" 2>/dev/null || printf '%s' "$TARGET")"

  for f in $RLG_FILES $RLG_LITE_FILES; do
    [ -L "$target/$f" ] && rm -f "$target/$f" && say "  unlink $f"
  done
  rmdir "$target" 2>/dev/null || true
  rm -f "$rec"
  rlg_ok "uninstalled symlinks — state under $(rlg_home) left untouched"
  return 0
}

case "$ACTION" in
  link)      do_link ;;
  verify)    do_verify ;;
  status)    do_status ;;
  uninstall) do_uninstall ;;
esac
