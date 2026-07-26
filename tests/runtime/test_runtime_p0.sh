#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# test_runtime_p0.sh — Runtime Lifecycle Guard, P0 + P0.5 test suite
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md
#
# Runs fully isolated: FORGEWRIGHT_RLG_HOME and the install target both point
# into a temp dir, so the suite never touches ~/.forgewright or real processes.
# Every process it creates is its own `sleep`, and it cleans them up.
#
# Usage: bash tests/runtime/test_runtime_p0.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
RT="$REPO_ROOT/scripts/runtime"
LEASE="$RT/runtime-lease.sh"
INSTALL="$RT/runtime-install.sh"
INVENTORY="$RT/runtime-inventory.sh"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rlg-test.XXXXXX")"
export FORGEWRIGHT_RLG_HOME="$SANDBOX/rlg-home"
export FORGEWRIGHT_SESSION_ID="test-session-$$"
export NO_COLOR=1

# Spawned pids are tracked in a FILE, not a shell array. spawn() runs inside a
# command substitution — an array append there happens in a subshell and is
# lost, so the trap would silently reap nothing and the suite would leak every
# process it started. (Which is, of course, the exact bug class this guard is
# being built to prevent.)
PID_FILE="$SANDBOX/spawned.pids"

cleanup() {
  local p
  if [ -r "$PID_FILE" ]; then
    while read -r p; do
      [ -n "$p" ] || continue
      kill "$p" 2>/dev/null
    done < "$PID_FILE"
    sleep 0.2
    while read -r p; do
      [ -n "$p" ] || continue
      kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    done < "$PID_FILE"
  fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; }

assert_eq() { # <actual> <expected> <label>
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected '$2', got '$1'"; fi
}
assert_ne() {
  if [ "$1" != "$2" ]; then ok "$3"; else bad "$3" "expected difference, both '$1'"; fi
}
assert_rc() { # <actual_rc> <expected_rc> <label>
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected rc=$2, got rc=$1"; fi
}
assert_contains() { # <haystack> <needle> <label>
  case "$1" in *"$2"*) ok "$3" ;; *) bad "$3" "output missing '$2'" ;; esac
}

spawn() { # spawn a harmless long-lived process, echo its pid
  # stdout/stderr MUST be redirected: this runs inside a command substitution,
  # and a background child holding the inherited pipe open would block $( )
  # until the child exits.
  sleep 300 >/dev/null 2>&1 &
  local p=$!
  echo "$p" >> "$PID_FILE"
  echo "$p"
}

reap_test_pid() { # kill a test process and block until it is really gone
  local p="$1" i=0
  kill "$p" 2>/dev/null
  while kill -0 "$p" 2>/dev/null; do
    i=$((i + 1)); [ "$i" -gt 100 ] && break
    sleep 0.05
  done
}

section() { echo; echo "── $1"; }

# ══ 1. Port bands ════════════════════════════════════════════════════════════
section "port bands (deterministic, collision-free)"

PROJ_A="$SANDBOX/proj-a"; mkdir -p "$PROJ_A"
PROJ_B="$SANDBOX/proj-b"; mkdir -p "$PROJ_B"

band_a1="$(bash "$LEASE" band "$PROJ_A" 2>/dev/null)"
band_a2="$(bash "$LEASE" band "$PROJ_A" 2>/dev/null)"
band_b="$(bash "$LEASE" band "$PROJ_B" 2>/dev/null)"

assert_eq "$band_a1" "$band_a2" "same project → same band across calls"
assert_ne "$band_a1" "$band_b"  "different projects → different bands"

if [ "$band_a1" -ge 20000 ] && [ "$band_a1" -le 24000 ]; then
  ok "band inside reserved range 20000-24000 (avoids user dev ports)"
else
  bad "band inside reserved range" "got $band_a1"
fi

port_web="$(bash "$LEASE" port --role web-dev --project "$PROJ_A" 2>/dev/null | tr -d '\n')"
port_api="$(bash "$LEASE" port --role api --project "$PROJ_A" 2>/dev/null | tr -d '\n')"
assert_eq "$port_web" "$band_a1"          "role web-dev → band+0"
assert_eq "$port_api" "$((band_a1 + 2))"  "role api → band+2"

bash "$LEASE" port --role bogus-role --project "$PROJ_A" >/dev/null 2>&1
assert_rc "$?" "1" "unknown role rejected"

# ══ 2. Lease lifecycle ═══════════════════════════════════════════════════════
section "lease lifecycle (acquire → list → release)"

PID1="$(spawn)"
lease1="$(bash "$LEASE" acquire --role web-dev --project "$PROJ_A" --pid "$PID1" 2>/dev/null)"
assert_contains "$lease1" "rlg-" "acquire returns a lease id"

open_count="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_count" "1" "status reports 1 open lease"

listing="$(bash "$LEASE" list --json 2>/dev/null)"
health="$(echo "$listing" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["health"])')"
assert_eq "$health" "live" "live process → health=live"

bash "$LEASE" release --lease "$lease1" --reason test-done >/dev/null 2>&1
open_count="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_count" "0" "release → 0 open leases"

# ══ 3. Ghost / dead-process handling ═════════════════════════════════════════
section "dead process handling (registry never trusts a stale pid)"

DEAD_PID="$(spawn)"
reap_test_pid "$DEAD_PID"
bash "$LEASE" acquire --role api --project "$PROJ_A" --pid "$DEAD_PID" >/dev/null 2>&1
assert_rc "$?" "1" "acquire refuses a pid that is already dead"

PID2="$(spawn)"
bash "$LEASE" acquire --role api --project "$PROJ_B" --pid "$PID2" >/dev/null 2>&1
reap_test_pid "$PID2"

health="$(bash "$LEASE" list --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["health"])')"
assert_eq "$health" "dead" "process died → health=dead while lease still open"

dry="$(bash "$LEASE" prune --dry-run 2>/dev/null)"
assert_contains "$dry" "WOULD PRUNE" "prune --dry-run reports without changing state"
open_count="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_count" "1" "dry-run left the lease open"

bash "$LEASE" prune >/dev/null 2>&1
open_count="$(bash "$LEASE" status --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["open"])')"
assert_eq "$open_count" "0" "prune closed the dead lease"

# ══ 4. Adopt ═════════════════════════════════════════════════════════════════
section "adopt (pre-existing process → policy=keep)"

PID3="$(spawn)"
lease3="$(bash "$LEASE" adopt --pid "$PID3" --port 4321 --project "$PROJ_A" 2>/dev/null)"
policy="$(bash "$LEASE" list --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["policy"])')"
assert_eq "$policy" "keep" "adopted process defaults to policy=keep (we did not start it)"
port="$(bash "$LEASE" list --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["port"])')"
assert_eq "$port" "4321" "adopt honours the explicit --port"
bash "$LEASE" release --lease "$lease3" >/dev/null 2>&1

# ══ 5. Kill-switch (plan §G4) ════════════════════════════════════════════════
section "kill-switch, 3 tiers"

PID4="$(spawn)"
FORGEWRIGHT_RLG=off bash "$LEASE" acquire --role web-dev --project "$PROJ_A" --pid "$PID4" >/dev/null 2>&1
assert_rc "$?" "3" "tier 1: FORGEWRIGHT_RLG=off disables the guard"

touch "$FORGEWRIGHT_RLG_HOME/DISABLED"
bash "$LEASE" acquire --role web-dev --project "$PROJ_A" --pid "$PID4" >/dev/null 2>&1
assert_rc "$?" "3" "tier 2: DISABLED file disables the guard"
rm -f "$FORGEWRIGHT_RLG_HOME/DISABLED"

mkdir -p "$PROJ_A/.forgewright" && touch "$PROJ_A/.forgewright/rlg-optout"
bash "$LEASE" acquire --role web-dev --project "$PROJ_A" --pid "$PID4" >/dev/null 2>&1
assert_rc "$?" "3" "tier 3: per-project rlg-optout disables the guard"
rm -f "$PROJ_A/.forgewright/rlg-optout"

bash "$LEASE" acquire --role web-dev --project "$PROJ_A" --pid "$PID4" >/dev/null 2>&1
assert_rc "$?" "0" "guard active again once switches are cleared"

# ══ 6. Install + drift detection (plan §G2) ══════════════════════════════════
section "install by symlink, verify by checksum"

FAKE_REPO="$SANDBOX/fake-repo"
mkdir -p "$FAKE_REPO/scripts/runtime" "$FAKE_REPO/scripts/lite"
# Copy whatever the installer currently declares, rather than a hardcoded list
# that silently goes stale as files are added to the guard.
# Copy exactly what the installer's manifest declares, so adding a file to the
# guard cannot leave this fixture silently stale.
# shellcheck disable=SC2013  # word-splitting is the intent: RLG_FILES is a
# single space-separated line, and each word is one filename.
for _f in $(sed -n 's/^RLG_FILES="\(.*\)"$/\1/p' "$RT/runtime-install.sh"); do
  cp "$RT/$_f" "$FAKE_REPO/scripts/runtime/" 2>/dev/null
done
cp "$REPO_ROOT"/scripts/lite/runtime-pretool-gate.sh "$FAKE_REPO/scripts/lite/" 2>/dev/null
TARGET="$SANDBOX/install-target"

bash "$INSTALL" --link --from "$FAKE_REPO" --target "$TARGET" >/dev/null 2>&1
assert_rc "$?" "0" "--link succeeds"

if [ -L "$TARGET/runtime-lease.sh" ]; then
  ok "installed entry is a SYMLINK, not a copy"
else
  bad "installed entry is a symlink" "$TARGET/runtime-lease.sh is not a symlink"
fi

bash "$TARGET/runtime-install.sh" --verify --quiet >/dev/null 2>&1
assert_rc "$?" "0" "--verify passes on a clean install"

# Source edited after install → must be reported as DRIFT.
echo "# drift $(date +%s)" >> "$FAKE_REPO/scripts/runtime/runtime-lease.sh"
out="$(bash "$INSTALL" --verify 2>&1)"; rc=$?
assert_rc "$rc" "1" "--verify FAILS when source drifts after install"
assert_contains "$out" "DRIFT" "drift is named explicitly in the report"

bash "$INSTALL" --link --from "$FAKE_REPO" --target "$TARGET" >/dev/null 2>&1
bash "$INSTALL" --verify --quiet >/dev/null 2>&1
assert_rc "$?" "0" "re-running --link clears the drift"

# Symlink replaced by a copy → the exact failure mode that motivated P0.5.
rm -f "$TARGET/runtime-lease.sh"
cp "$FAKE_REPO/scripts/runtime/runtime-lease.sh" "$TARGET/runtime-lease.sh"
out="$(bash "$INSTALL" --verify 2>&1)"; rc=$?
assert_rc "$rc" "1" "--verify FAILS when a symlink is replaced by a copy"
assert_contains "$out" "BROKEN" "copy-instead-of-symlink is named explicitly"

bash "$INSTALL" --link --from "$FAKE_REPO" --target "$TARGET" >/dev/null 2>&1

# Regression: a manifest that yields no entries must FAIL, never report a
# vacuous PASS. The first version of --verify had a broken extractor and
# "passed" while checking nothing.
cp "$FORGEWRIGHT_RLG_HOME/INSTALLED_FROM" "$SANDBOX/installed.bak"
python3 - "$FORGEWRIGHT_RLG_HOME/INSTALLED_FROM" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["files"] = []
json.dump(d, open(p, "w"))
PY
out="$(bash "$INSTALL" --verify 2>&1)"; rc=$?
assert_rc "$rc" "1" "--verify FAILS on an empty manifest (no vacuous PASS)"
assert_contains "$out" "EMPTY" "empty manifest is named explicitly"
cp "$SANDBOX/installed.bak" "$FORGEWRIGHT_RLG_HOME/INSTALLED_FROM"

# Unmanaged file dropped into the install dir.
touch "$TARGET/rogue-script.sh"
out="$(bash "$INSTALL" --verify 2>&1)"; rc=$?
assert_rc "$rc" "1" "--verify FAILS on an unmanaged file in the install dir"
assert_contains "$out" "EXTRA" "unmanaged file is named explicitly"
rm -f "$TARGET/rogue-script.sh"

# ══ 7. Allowlist ═════════════════════════════════════════════════════════════
section "allowlist"

printf '# comment\n5432\t# postgres\n3040\n' > "$FORGEWRIGHT_RLG_HOME/port-allowlist.txt"
(
  # shellcheck source=scripts/runtime/runtime-common.sh
  . "$RT/runtime-common.sh"
  rlg_port_allowlisted 5432 && exit 0 || exit 1
)
assert_rc "$?" "0" "allowlisted port with trailing comment matches"
(
  . "$RT/runtime-common.sh"
  rlg_port_allowlisted 9999 && exit 0 || exit 1
)
assert_rc "$?" "1" "non-allowlisted port does not match"

# ══ 8. Inventory ═════════════════════════════════════════════════════════════
section "inventory (read-only report)"

bash "$INVENTORY" --ports --procs >/dev/null 2>&1
assert_rc "$?" "0" "inventory exits 0"

json="$(bash "$INVENTORY" --ports --json 2>/dev/null)"
echo "$json" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null
assert_rc "$?" "0" "inventory --json emits valid JSON"

# The guard must never take an action of its own. Assert on OUR OWN processes,
# not a global count — unrelated processes come and go on a live machine and
# would make this flaky.
WITNESS_A="$(spawn)"; WITNESS_B="$(spawn)"
bash "$LEASE" acquire --role web-dev --project "$PROJ_B" --pid "$WITNESS_A" >/dev/null 2>&1
bash "$INVENTORY" --all >/dev/null 2>&1
if kill -0 "$WITNESS_A" 2>/dev/null && kill -0 "$WITNESS_B" 2>/dev/null; then
  ok "inventory killed nothing (leased and unleased witnesses both alive)"
else
  bad "inventory killed nothing" "witness died: A=$(kill -0 "$WITNESS_A" 2>/dev/null && echo alive || echo dead) B=$(kill -0 "$WITNESS_B" 2>/dev/null && echo alive || echo dead)"
fi

# Same for prune: it closes registry records, it does not signal processes.
bash "$LEASE" prune >/dev/null 2>&1
if kill -0 "$WITNESS_A" 2>/dev/null; then
  ok "prune killed nothing (registry-only operation)"
else
  bad "prune killed nothing" "leased witness was signalled"
fi

# ══ summary ══════════════════════════════════════════════════════════════════
echo
echo "════════════════════════════════════════"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
