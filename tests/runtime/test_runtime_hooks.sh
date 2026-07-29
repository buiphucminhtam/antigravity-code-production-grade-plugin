#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# test_runtime_hooks.sh — RLG hook wiring for Claude / Codex / Antigravity
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 §G3)
#
# Runs entirely against COPIES of the real config files in a temp dir. The
# user's actual ~/.claude, ~/.codex and ~/.gemini are never touched — copies
# are used precisely so the tests exercise real-world content (existing
# gitnexus hooks, existing forgewright-policy entries) rather than a toy.
#
# Usage: bash tests/runtime/test_runtime_hooks.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
INSTALLER="$REPO_ROOT/scripts/runtime/runtime-hooks-install.sh"
GATE="$REPO_ROOT/scripts/lite/runtime-pretool-gate.sh"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/rlg-hooks.XXXXXX")"
export FORGEWRIGHT_RLG_HOME="$SANDBOX/rlg-home"
export NO_COLOR=1
mkdir -p "$FORGEWRIGHT_RLG_HOME"
trap 'rm -rf "$SANDBOX"' EXIT

C_JSON="$SANDBOX/claude-settings.json"
X_TOML="$SANDBOX/codex-config.toml"
A_JSON="$SANDBOX/agy-hooks.json"

# Seed from the real files when present so we test against real structure.
if [ -f "$HOME/.claude/settings.json" ]; then cp "$HOME/.claude/settings.json" "$C_JSON"
else printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node other.cjs"}]}]}}\n' > "$C_JSON"; fi
if [ -f "$HOME/.codex/config.toml" ]; then cp "$HOME/.codex/config.toml" "$X_TOML"
else printf '[hooks]\nenabled = true\n' > "$X_TOML"; fi
if [ -f "$HOME/.gemini/config/hooks.json" ]; then cp "$HOME/.gemini/config/hooks.json" "$A_JSON"
else printf '{"forgewright-policy":{"PreToolUse":[]}}\n' > "$A_JSON"; fi

# Seed the preservation invariant explicitly instead of assuming the developer's
# real Claude configuration already contains a GitNexus hook.
python3 - "$C_JSON" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
hooks = data.setdefault("hooks", {})
pre_tool = hooks.get("PreToolUse")
if not isinstance(pre_tool, list):
    pre_tool = []
    hooks["PreToolUse"] = pre_tool
pre_tool.append(
    {
        "matcher": "Bash",
        "hooks": [
            {
                "type": "command",
                "command": "gitnexus mcp",
            }
        ],
    }
)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
PY

INST=(bash "$INSTALLER" --claude-settings "$C_JSON" --codex-config "$X_TOML" --agy-hooks "$A_JSON")

# Normalise the copies to "not wired" before measuring anything. The seeds come
# from the live configs, which may or may not already have the guard installed —
# without this the whole suite's results depend on the machine's current state
# rather than on the code under test.
"${INST[@]}" --uninstall >/dev/null 2>&1

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; }
assert_eq()  { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected '$2', got '$1'"; fi; }
assert_rc()  { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "expected rc=$2, got rc=$1"; fi; }
section()    { echo; echo "── $1"; }

json_ok()   { python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$1" 2>/dev/null; }
toml_ok()   { python3 -c 'import tomllib,sys;tomllib.load(open(sys.argv[1],"rb"))' "$1" 2>/dev/null; }
count_pre() { python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(sum(len(e.get("hooks",[])) for e in d.get("hooks",{}).get("PreToolUse",[])))' "$1" 2>/dev/null; }
has_marker(){ grep -qF "runtime-pretool-gate.sh" "$1" 2>/dev/null; }

# ══ baselines ════════════════════════════════════════════════════════════════
section "baseline configs are valid before we touch them"
json_ok "$C_JSON"; assert_rc "$?" "0" "claude settings.json parses"
toml_ok "$X_TOML"; assert_rc "$?" "0" "codex config.toml parses"
json_ok "$A_JSON"; assert_rc "$?" "0" "agy hooks.json parses"
PRE_BEFORE="$(count_pre "$C_JSON")"
AGY_KEYS_BEFORE="$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$A_JSON")"
CODEX_LINES_BEFORE="$(wc -l < "$X_TOML" | tr -d ' ')"

# ══ dry-run changes nothing ══════════════════════════════════════════════════
section "--dry-run writes nothing"
"${INST[@]}" --install --dry-run >/dev/null 2>&1
assert_rc "$?" "0" "dry-run exits 0"
has_marker "$C_JSON"; assert_rc "$?" "1" "claude untouched after dry-run"
has_marker "$X_TOML"; assert_rc "$?" "1" "codex untouched after dry-run"
has_marker "$A_JSON"; assert_rc "$?" "1" "agy untouched after dry-run"

# ══ install ══════════════════════════════════════════════════════════════════
section "--install wires all three"
"${INST[@]}" --install >/dev/null 2>&1
assert_rc "$?" "0" "install exits 0"

json_ok "$C_JSON"; assert_rc "$?" "0" "claude settings.json still parses"
toml_ok "$X_TOML"; assert_rc "$?" "0" "codex config.toml still parses (valid TOML)"
json_ok "$A_JSON"; assert_rc "$?" "0" "agy hooks.json still parses"

has_marker "$C_JSON"; assert_rc "$?" "0" "claude has the gate"
has_marker "$X_TOML"; assert_rc "$?" "0" "codex has the gate"
has_marker "$A_JSON"; assert_rc "$?" "0" "agy has the gate"

assert_eq "$(count_pre "$C_JSON")" "$((PRE_BEFORE + 1))" "claude gained exactly ONE hook (existing ones kept)"
assert_eq "$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$A_JSON")" \
          "$((AGY_KEYS_BEFORE + 1))" "agy gained exactly one registry key"

python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
ok=any("gitnexus" in h.get("command","") for e in d["hooks"]["PreToolUse"] for h in e.get("hooks",[]))
sys.exit(0 if ok else 1)' "$C_JSON" 2>/dev/null
assert_rc "$?" "0" "pre-existing gitnexus hook survived"

python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
sys.exit(0 if "forgewright-policy" in d else 1)' "$A_JSON" 2>/dev/null
assert_rc "$?" "0" "pre-existing forgewright-policy key survived"

# Platform flag must be right per CLI — a Claude-shaped call into Antigravity
# would be read as a refusal.
grep -q 'platform CLAUDE' "$C_JSON";      assert_rc "$?" "0" "claude wired with --platform CLAUDE"
grep -q 'platform CODEX' "$X_TOML";       assert_rc "$?" "0" "codex wired with --platform CODEX"
grep -q 'platform ANTIGRAVITY' "$A_JSON"; assert_rc "$?" "0" "agy wired with --platform ANTIGRAVITY"

ls "$C_JSON".bak-rlg-* >/dev/null 2>&1; assert_rc "$?" "0" "a backup was written before modifying"

# ══ idempotency ══════════════════════════════════════════════════════════════
section "re-running never duplicates"
for _ in 1 2 3; do "${INST[@]}" --install >/dev/null 2>&1; done
assert_eq "$(count_pre "$C_JSON")" "$((PRE_BEFORE + 1))" "claude still has exactly one gate hook after 4 installs"
assert_eq "$(grep -cF 'runtime-pretool-gate.sh' "$X_TOML")" "1" "codex block appears exactly once"
assert_eq "$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$A_JSON")" \
          "$((AGY_KEYS_BEFORE + 1))" "agy still has one key"

"${INST[@]}" --verify >/dev/null 2>&1
assert_rc "$?" "0" "--verify reports all three wired"

# ══ uninstall ════════════════════════════════════════════════════════════════
section "--uninstall restores the original shape"
"${INST[@]}" --uninstall >/dev/null 2>&1
assert_rc "$?" "0" "uninstall exits 0"
json_ok "$C_JSON"; assert_rc "$?" "0" "claude still parses after removal"
toml_ok "$X_TOML"; assert_rc "$?" "0" "codex still parses after removal"
json_ok "$A_JSON"; assert_rc "$?" "0" "agy still parses after removal"
has_marker "$C_JSON"; assert_rc "$?" "1" "claude gate removed"
has_marker "$X_TOML"; assert_rc "$?" "1" "codex gate removed"
has_marker "$A_JSON"; assert_rc "$?" "1" "agy gate removed"
assert_eq "$(count_pre "$C_JSON")" "$PRE_BEFORE" "claude hook count back to baseline"
assert_eq "$(wc -l < "$X_TOML" | tr -d ' ')" "$CODEX_LINES_BEFORE" "codex line count back to baseline"

"${INST[@]}" --verify >/dev/null 2>&1
assert_rc "$?" "3" "--verify reports all three unwired"

# ══ reclaim sweep on Stop ════════════════════════════════════════════════════
section "reclaim sweep wired to Stop (no CLI here exposes SessionEnd)"

"${INST[@]}" --install >/dev/null 2>&1
grep -q "runtime-sweep.sh" "$C_JSON"; assert_rc "$?" "0" "claude Stop hook has the sweep"
grep -q "runtime-sweep.sh" "$X_TOML"; assert_rc "$?" "0" "codex Stop hook has the sweep"
grep -q "runtime-sweep.sh" "$A_JSON"; assert_rc "$?" "1" "agy has no sweep (registry has no Stop event)"

json_ok "$C_JSON"; assert_rc "$?" "0" "claude settings still parse with the sweep added"
toml_ok "$X_TOML"; assert_rc "$?" "0" "codex config still valid TOML with the sweep added"

python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
stop=d.get("hooks",{}).get("Stop",[])
ours=[h for e in stop for h in e.get("hooks",[]) if "runtime-sweep" in h.get("command","")]
others=[h for e in stop for h in e.get("hooks",[]) if "stop-gate" in h.get("command","") or "verify-gate" in h.get("command","")]
sys.exit(0 if len(ours)==1 and len(others)>=1 else 1)' "$C_JSON" 2>/dev/null
assert_rc "$?" "0" "exactly one sweep hook, existing stop-gate/verify-gate preserved"

for _ in 1 2 3; do "${INST[@]}" --install >/dev/null 2>&1; done
assert_eq "$(grep -cF 'runtime-sweep.sh' "$X_TOML")" "1" "sweep block stays unique across repeat installs"

"${INST[@]}" --uninstall >/dev/null 2>&1
grep -q "runtime-sweep.sh" "$C_JSON"; assert_rc "$?" "1" "uninstall removes the claude sweep"
grep -q "runtime-sweep.sh" "$X_TOML"; assert_rc "$?" "1" "uninstall removes the codex sweep"
toml_ok "$X_TOML"; assert_rc "$?" "0" "codex config still valid TOML after sweep removal"
assert_eq "$(wc -l < "$X_TOML" | tr -d ' ')" "$CODEX_LINES_BEFORE" "codex back to baseline line count"

# ══ gate platform contracts ══════════════════════════════════════════════════
section "gate honours each platform's allow contract"

mk() { printf '{"session_id":"s","cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"; }

out="$(mk 'git status' | bash "$GATE" --platform CLAUDE 2>/dev/null)"
assert_eq "$out" "" "CLAUDE: silence means allow"

out="$(mk 'git status' | bash "$GATE" --platform CODEX 2>/dev/null)"
assert_eq "$out" "" "CODEX: silence means allow"

# The dangerous one: Antigravity treats no output as a refusal, so EVERY path
# must emit an explicit allow — including the fast-reject and kill-switch ones.
out="$(mk 'git status' | bash "$GATE" --platform ANTIGRAVITY 2>/dev/null)"
echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("decision")=="allow" else 1)' 2>/dev/null
assert_rc "$?" "0" "ANTIGRAVITY: non-matching command still emits decision=allow"

out="$(mk 'npm run dev' | bash "$GATE" --platform ANTIGRAVITY 2>/dev/null)"
echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("decision")=="allow" else 1)' 2>/dev/null
assert_rc "$?" "0" "ANTIGRAVITY: matching command still emits decision=allow"

out="$(mk 'npm run dev' | FORGEWRIGHT_RLG=off bash "$GATE" --platform ANTIGRAVITY 2>/dev/null)"
echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("decision")=="allow" else 1)' 2>/dev/null
assert_rc "$?" "0" "ANTIGRAVITY: kill-switch OFF still emits allow (disabling must not block tools)"

touch "$FORGEWRIGHT_RLG_HOME/DISABLED"
out="$(mk 'npm run dev' | bash "$GATE" --platform ANTIGRAVITY 2>/dev/null)"
echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("decision")=="allow" else 1)' 2>/dev/null
assert_rc "$?" "0" "ANTIGRAVITY: DISABLED file still emits allow"
rm -f "$FORGEWRIGHT_RLG_HOME/DISABLED"

out="$(printf '' | bash "$GATE" --platform ANTIGRAVITY 2>/dev/null)"
echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("decision")=="allow" else 1)' 2>/dev/null
assert_rc "$?" "0" "ANTIGRAVITY: empty payload still emits allow"

: > "$FORGEWRIGHT_RLG_HOME/gate.log"
mk 'npm run dev' | bash "$GATE" --platform CODEX >/dev/null 2>&1
grep -q "CODEX" "$FORGEWRIGHT_RLG_HOME/gate.log" 2>/dev/null
assert_rc "$?" "0" "gate.log records which platform the event came from"

echo
echo "════════════════════════════════════════"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
