#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.forgewright/pipeline-state.json"
MANIFEST_FILE="$PROJECT_ROOT/.antigravity/mcp-manifest.json"
STRICT=false
JSON_ONLY=false
MAX_STATE_AGE_MINUTES=120
CHECK_SESSION=false

usage() {
  cat <<'EOF'
pipeline-preflight.sh — verify Forgewright pipeline activation controls

Usage:
  bash scripts/pipeline-preflight.sh [--strict] [--json-only] [--max-state-age-minutes N] [--check-session]

Options:
  --strict                 Treat warnings as blocking failures.
  --json-only              Print JSON only.
  --max-state-age-minutes  Maximum allowed age for active pipeline state. Default: 120.
  --check-session          Require current-session plan-quality memory marker.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=true; shift ;;
    --json-only) JSON_ONLY=true; shift ;;
    --max-state-age-minutes) MAX_STATE_AGE_MINUTES="$2"; shift 2 ;;
    --check-session) CHECK_SESSION=true; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

ISSUES=()
WARNINGS=()
CHECKS=()

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

json_array() {
  local item
  printf '['
  local first=true
  for item in "$@"; do
    if [[ "$first" == true ]]; then
      first=false
    else
      printf ','
    fi
    json_escape "$item"
  done
  printf ']'
}

add_check() {
  local name="$1" status="$2" detail="$3"
  CHECKS+=("{\"name\":$(json_escape "$name"),\"status\":$(json_escape "$status"),\"detail\":$(json_escape "$detail")}")
}

add_issue() {
  ISSUES+=("$1")
}

add_warning() {
  WARNINGS+=("$1")
}

for surface in AGENTS.md CLAUDE.md GEMINI.md; do
  if [[ -f "$PROJECT_ROOT/$surface" ]] \
    && grep -q 'Senior Delivery Standard' "$PROJECT_ROOT/$surface" \
    && grep -q 'RIGHT-SIZE' "$PROJECT_ROOT/$surface"; then
    add_check "$surface kernel contract" "pass" "senior + proportional execution present"
  else
    add_issue "$surface missing current senior/proportional kernel contract"
    add_check "$surface kernel contract" "fail" "stale or missing"
  fi
done

ACTIVATION_PROTOCOL="$PROJECT_ROOT/skills/_shared/protocols/pipeline-activation.md"
if [[ -f "$ACTIVATION_PROTOCOL" ]] \
  && grep -q '`QUICK`' "$ACTIVATION_PROTOCOL" \
  && grep -q 'Do not emit magic activation tokens' "$ACTIVATION_PROTOCOL"; then
  add_check "Pipeline activation protocol" "pass" "current proportional activation contract present"
else
  add_issue "pipeline-activation protocol missing or stale"
  add_check "Pipeline activation protocol" "fail" "missing/stale"
fi

if [[ -f "$MANIFEST_FILE" ]]; then
  manifest_workspace="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(m.workspace || '')" "$MANIFEST_FILE")"
  normalized_manifest="$(cd "$manifest_workspace" 2>/dev/null && pwd -P || printf '%s' "$manifest_workspace")"
  normalized_project="$(cd "$PROJECT_ROOT" && pwd -P)"
  if [[ "$normalized_manifest" == "$normalized_project" ]]; then
    add_check "Antigravity manifest workspace" "pass" "$normalized_manifest"
  else
    add_issue "Antigravity manifest workspace mismatch: expected $normalized_project, got $normalized_manifest"
    add_check "Antigravity manifest workspace" "fail" "mismatch"
  fi

  if node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const s=(m.servers||[]).find(x=>x.type==='forgewright-mcp-server'); process.exit(s && s.auto_start === true && s.enabled !== false ? 0 : 1)" "$MANIFEST_FILE"; then
    add_check "Forgewright MCP manifest server" "pass" "auto_start enabled"
  else
    add_issue "Forgewright MCP manifest server missing auto_start/enabled configuration"
    add_check "Forgewright MCP manifest server" "fail" "invalid"
  fi
else
  add_issue "Antigravity MCP manifest missing"
  add_check "Antigravity MCP manifest" "fail" "missing"
fi

if [[ -f "$STATE_FILE" ]]; then
  state_status="$(node -e "const fs=require('fs'); const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(s.status || '')" "$STATE_FILE")"
  current_mode="$(node -e "const fs=require('fs'); const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(s.currentMode || '')" "$STATE_FILE")"
  mtime_epoch="$(stat -f %m "$STATE_FILE" 2>/dev/null || stat -c %Y "$STATE_FILE")"
  now_epoch="$(date +%s)"
  age_minutes=$(( (now_epoch - mtime_epoch) / 60 ))
  if [[ "$state_status" == "IDLE" || "$state_status" == "COMPLETED" || "$age_minutes" -le "$MAX_STATE_AGE_MINUTES" ]]; then
    add_check "Pipeline state freshness" "pass" "$state_status $current_mode age=${age_minutes}m"
  else
    add_issue "Pipeline state is stale: status=$state_status mode=$current_mode age=${age_minutes}m"
    add_check "Pipeline state freshness" "fail" "age=${age_minutes}m"
  fi
else
  add_warning "No pipeline-state.json found yet"
  add_check "Pipeline state freshness" "warning" "missing"
fi

if [[ "$CHECK_SESSION" == true ]]; then
  if { [[ -f "$PROJECT_ROOT/.forgewright/mem0/nodes.jsonl" ]] && grep -q '"id": "plan-quality"' "$PROJECT_ROOT/.forgewright/mem0/nodes.jsonl"; } \
    || [[ -f "$PROJECT_ROOT/.forgewright/subagent-context/INTERPRETED_REQUEST.md" ]]; then
    add_check "Session planning evidence" "pass" "planning/request evidence exists"
  else
    add_issue "Session planning evidence missing"
    add_check "Session planning evidence" "fail" "missing"
  fi
fi

warning_count=0
if [[ "${WARNINGS+x}" == x ]]; then
  warning_count=${#WARNINGS[@]}
fi

if [[ "$STRICT" == true && "$warning_count" -gt 0 ]]; then
  for warning in "${WARNINGS[@]}"; do
    add_issue "Strict warning: $warning"
  done
fi

issue_count=0
if [[ "${ISSUES+x}" == x ]]; then
  issue_count=${#ISSUES[@]}
fi

ok=true
if [[ "$issue_count" -gt 0 ]]; then
  ok=false
fi

if [[ "$issue_count" -gt 0 ]]; then
  issues_json="$(json_array "${ISSUES[@]}")"
else
  issues_json="[]"
fi

if [[ "$warning_count" -gt 0 ]]; then
  warnings_json="$(json_array "${WARNINGS[@]}")"
else
  warnings_json="[]"
fi
checks_json="$(IFS=,; printf '[%s]' "${CHECKS[*]}")"
json="{\"ok\":$ok,\"checks\":$checks_json,\"issues\":$issues_json,\"warnings\":$warnings_json}"

if [[ "$JSON_ONLY" == true ]]; then
  printf '%s\n' "$json"
else
  node -e "const r=JSON.parse(process.argv[1]); console.log('Pipeline Preflight: '+(r.ok?'PASS':'FAIL')); for (const c of r.checks) console.log(' - '+c.status.toUpperCase()+': '+c.name+' — '+c.detail); if (r.issues.length) { console.log('Issues:'); for (const i of r.issues) console.log(' - '+i); } if (r.warnings.length) { console.log('Warnings:'); for (const w of r.warnings) console.log(' - '+w); }" "$json"
fi

if [[ "$ok" == true ]]; then
  exit 0
fi
exit 2
