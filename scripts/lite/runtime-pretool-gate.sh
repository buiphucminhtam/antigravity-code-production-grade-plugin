#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# runtime-pretool-gate.sh — PreToolUse hook for the Runtime Lifecycle Guard
# Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 — SPAWN, §G3/§G4)
#
#   runtime-pretool-gate.sh [--platform CLAUDE|CODEX|ANTIGRAVITY]
#
# Runs before EVERY tool call, in EVERY project on this machine. Two rules
# follow from that and they outrank everything else here:
#
#   1. FAIL-OPEN. Any error, any missing file, any surprise → allow. A guard
#      that breaks the user's shell is worse than the leak it prevents.
#   2. FAST. The common case is "this command has nothing to do with dev
#      servers", and that path must cost no forks — no python, no lsof, no git.
#      Budget p95 < 100ms. (Measured: python3 startup alone is ~59ms here.)
#
# PLATFORM CONTRACTS DIFFER, and getting this wrong is dangerous:
#   CLAUDE / CODEX — silence + exit 0 means allow. Payload is snake_case
#                    {"tool_name","tool_input":{"command"},"cwd"}.
#   ANTIGRAVITY    — an explicit {"decision":"allow"} on stdout is REQUIRED.
#                    Emitting nothing is read as a refusal, so every exit path
#                    below — including the kill-switch ones — must still print
#                    it. Payload is camelCase {"toolCall":…,"workspacePaths":…}.
#
# Deliberately NOT sourcing runtime-common.sh: parsing a 250-line library on
# every tool call is exactly the cost this hook must not add.
#
# Kill-switch: FORGEWRIGHT_RLG=off · $RLG_HOME/DISABLED · <proj>/.forgewright/rlg-optout
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# No `set -e`: this hook must never abort mid-way.
set -u

PLATFORM="CLAUDE"
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="${2:-CLAUDE}"; shift 2 ;;
    *) shift ;;
  esac
done
case "$PLATFORM" in
  claude|Claude)             PLATFORM="CLAUDE" ;;
  codex|Codex)               PLATFORM="CODEX" ;;
  agy|AGY|antigravity|Antigravity) PLATFORM="ANTIGRAVITY" ;;
esac

# Every exit goes through here. For Antigravity that means printing the allow
# decision; for the others it means staying silent.
allow_and_exit() {
  [ "$PLATFORM" = "ANTIGRAVITY" ] && \
    printf '{"decision":"allow","reason":"Runtime Lifecycle Guard: observe mode"}\n'
  exit 0
}

# ── tier 1 kill-switch: env, zero cost ───────────────────────────────────────
case "${FORGEWRIGHT_RLG:-}" in
  off|OFF|0|false|disabled) allow_and_exit ;;
esac

RLG_HOME="${FORGEWRIGHT_RLG_HOME:-$HOME/.forgewright/runtime}"

# ── tier 2 kill-switch: file ─────────────────────────────────────────────────
[ -e "$RLG_HOME/DISABLED" ] && allow_and_exit

# ── read the payload (builtin only, capped) ──────────────────────────────────
# `-d ''` (read to NUL/EOF), NOT `-N`: the system bash here is 3.2.57, where
# `read -N` yields an empty string on multi-line input — and combining -N with
# -d yields empty even on one line. That would silently turn this hook into a
# no-op. Cap afterwards with a builtin substring instead.
PAYLOAD=""
IFS= read -r -d '' PAYLOAD 2>/dev/null
[ -n "$PAYLOAD" ] || allow_and_exit
[ "${#PAYLOAD}" -gt 65536 ] && PAYLOAD="${PAYLOAD:0:65536}"

# ── narrow to shell-ish tool calls ───────────────────────────────────────────
# Claude and Codex name the tool; Antigravity's payload shape varies, so there
# we skip the filter and let the command patterns below decide.
if [ "$PLATFORM" != "ANTIGRAVITY" ]; then
  case "$PAYLOAD" in
    *'"tool_name"'*'"Bash"'*) : ;;
    *) allow_and_exit ;;
  esac
fi

# ── fast reject: pure pattern match, no forks ────────────────────────────────
# Anything that starts a long-lived server, editor, emulator or watcher, plus
# the generic "backgrounded with &" shape. Kept in sync with RLG_DEV_PATTERNS
# in runtime-inventory.sh.
# `vite` is spelled out per subcommand, never as a bare substring:
#   - bare 'vite' also matches every `vitest` call (8 of 23 flags against real
#     history, all noise)
#   - 'vite ' additionally matches `vite build`, which exits on its own
# Long-lived forms are dev/preview/serve/flags, plus 'vite"' for a bare `npx vite`.
matched=""
for pat in \
  'npm run dev' 'pnpm dev' 'yarn dev' 'npm start' 'pnpm start' 'yarn start' \
  'vite --' 'vite dev' 'vite preview' 'vite serve' 'vite"' 'next dev' 'nuxt dev' 'ng serve' 'react-scripts start' 'astro dev' \
  'remix dev' 'webpack serve' 'webpack-dev-server' 'rollup -w' 'parcel ' \
  'http.server' 'live-server' 'storybook' 'expo start' 'flutter run' \
  'godot' 'Godot' 'Unity' 'emulator -avd' 'docker compose up' 'docker-compose up' \
  'jest --watch' 'vitest --watch' 'playwright test --headed' 'serve -' \
  'nodemon' 'tsx watch' 'ts-node-dev' 'uvicorn' 'gunicorn' 'turbo run dev'
do
  case "$PAYLOAD" in
    *"$pat"*) matched="$pat"; break ;;
  esac
done

# Backgrounded launch: only the trailing "… &" shape, i.e. ` &` immediately
# before the JSON string's closing quote. The earlier, looser ' & ' also matched
# ordinary prose ("Risk & Impact", "Artifact & Approval") and accounted for 11
# of 23 flags against real history — all noise.
if [ -z "$matched" ]; then
  case "$PAYLOAD" in
    *' &\"'*|*' &"'*) matched="background-&" ;;
  esac
fi

# `npm run <name>` where <name> is project-specific. The typed command says
# nothing about lifetime — `npm run preview`, `test:watch`, `electron:start` all
# start long-lived processes — so resolve the script out of package.json. Only
# reached for npm/pnpm/yarn run commands, and only when nothing else matched.
if [ -z "$matched" ]; then
  case "$PAYLOAD" in
    *'npm run '*|*'yarn run '*) matched="__resolve__" ;;   # 'npm run ' also covers 'pnpm run '
  esac
fi

# Nothing to say — the overwhelmingly common path, reached with zero forks.
[ -n "$matched" ] || allow_and_exit

# ── from here on we already know this is rare; a little cost is fine ─────────

# tier 3 kill-switch: per-project opt-out.
CWD=""
case "$PAYLOAD" in
  *'"cwd"'*)
    rest="${PAYLOAD#*\"cwd\"}"; rest="${rest#*\"}"; CWD="${rest%%\"*}" ;;
  *'"workspacePaths"'*)
    rest="${PAYLOAD#*\"workspacePaths\"}"; rest="${rest#*\"}"; CWD="${rest%%\"*}" ;;
esac
[ -n "$CWD" ] && [ -e "$CWD/.forgewright/rlg-optout" ] && allow_and_exit

# Trim the command out of the payload — needed both for the resolve step and
# for the log line. Best effort, never fatal.
CMD=""
case "$PAYLOAD" in
  *'"command"'*) rest="${PAYLOAD#*\"command\"}"; rest="${rest#*\"}"; CMD="${rest%%\"*}" ;;
esac

# ── resolve `npm run <name>` against the project's package.json ──────────────
# Two greps, only on npm-run commands. If the script does not resolve to
# something long-lived we exit silently: a blind "flag every npm run" would
# bury the real signal under lint/build/test noise.
if [ "$matched" = "__resolve__" ]; then
  script_name=""
  # "pnpm run " ends with "npm run ", so one branch handles npm and pnpm both.
  case "$CMD" in
    *"npm run "*)  rest="${CMD#*npm run }" ;;
    *"yarn run "*) rest="${CMD#*yarn run }" ;;
    *) rest="" ;;
  esac
  script_name="${rest%% *}"
  script_name="${script_name%%;*}"
  script_name="${script_name%%&*}"

  [ -n "$script_name" ] || allow_and_exit
  pkg="${CWD:-$PWD}/package.json"
  [ -r "$pkg" ] || allow_and_exit

  resolved="$(grep -o "\"${script_name}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$pkg" 2>/dev/null | head -n1)"
  [ -n "$resolved" ] || allow_and_exit

  # Same behaviour question as above: does the resolved command return on its
  # own? `vitest run` does; bare `vitest` does not.
  if printf '%s' "$resolved" | grep -qE '(vite (dev|preview|serve|--)|vite"|next dev|nuxt dev|webpack.*serve|ng serve|react-scripts start|astro dev|remix dev|nodemon|tsx watch|ts-node-dev|http\.server|live-server|storybook|expo start|flutter run|concurrently|electron[[:space:]]|tauri dev|uvicorn|gunicorn|flask run|php -S|docker compose up|turbo run dev|vitest"|--watch|npm run dev)' 2>/dev/null; then
    matched="npm-run:${script_name}"
  else
    allow_and_exit
  fi
fi

MODE="observe"
if [ -r "$RLG_HOME/MODE" ]; then
  IFS= read -r MODE < "$RLG_HOME/MODE" 2>/dev/null || MODE="observe"
  case "$MODE" in observe|enforce) : ;; *) MODE="observe" ;; esac
fi

[ -d "$RLG_HOME" ] || mkdir -p "$RLG_HOME" 2>/dev/null || allow_and_exit

[ -n "$CMD" ] || CMD="(unparsed)"
CMD="${CMD//$'\n'/ }"
[ "${#CMD}" -gt 300 ] && CMD="${CMD:0:300}…"

printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PLATFORM" "$MODE" "$matched" "${CWD:-?}" "$CMD" \
  >> "$RLG_HOME/gate.log" 2>/dev/null

# ── decide ───────────────────────────────────────────────────────────────────
if [ "$MODE" = "enforce" ] && [ "$PLATFORM" != "ANTIGRAVITY" ]; then
  # P1 enforce is still advisory: it names the better way and gets out of the
  # way. Actually denying belongs to P2, after observe-mode evidence shows the
  # detector does not misfire.
  printf 'Runtime Lifecycle Guard: this looks like a long-running process (%s).\n' "$matched"
  printf 'Prefer: bash scripts/runtime/dev-run.sh --role <role> -- <command>\n'
  printf 'It reuses an already-running instance instead of starting a second one,\n'
  printf 'and registers it so it gets cleaned up at session end.\n'
fi

allow_and_exit
