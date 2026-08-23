#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# test-forgewright-mcp-setup.sh — Automated Test Suite for ForgeWright MCP Setup
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

# ─── Config ─────────────────────────────────────────────────────
FORGEWRIGHT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SCRIPT_DIR="$FORGEWRIGHT_DIR/scripts/mcp"
PROJECT_ROOT="$FORGEWRIGHT_DIR"
TEST_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/fw-test-project.XXXXXX")"
TEST_HOME="$TEST_PROJECT/home"
OPERATOR_HOME="${HOME:-}"
export HOME="$TEST_HOME"
export XDG_CONFIG_HOME="$TEST_HOME/.config"
TEMPLATE_DIR="$FORGEWRIGHT_DIR/scripts/templates"
JSONC_PARSER_MODULE="$FORGEWRIGHT_DIR/mcp/node_modules/jsonc-parser"
if [[ ! -f "$JSONC_PARSER_MODULE/lib/umd/main.js" ]]; then
    JSONC_PARSER_MODULE="$FORGEWRIGHT_DIR/node_modules/jsonc-parser"
fi

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── State ───────────────────────────────────────────────────────
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
VERBOSE=0
FAST=0

# ─── Logging ─────────────────────────────────────────────────────
pass() { echo -e "  ${GREEN}✓${NC} $1"; ((TESTS_PASSED++)) || true; }
fail() { echo -e "  ${RED}✗${NC} $1"; ((TESTS_FAILED++)) || true; }
skip() { echo -e "  ${YELLOW}⊘${NC} $1"; ((TESTS_SKIPPED++)); }
info() { echo -e "  ${BLUE}➜${NC} $1"; }

tree_digest() {
    python3 - "$1" <<'PY'
import hashlib
import os
import sys

root = os.path.realpath(sys.argv[1])
digest = hashlib.sha256()
for current, directories, files in os.walk(root):
    directories.sort()
    files.sort()
    for name in files:
        path = os.path.join(current, name)
        relative = os.path.relpath(path, root)
        digest.update(relative.encode())
        if os.path.islink(path):
            digest.update(b"symlink\0" + os.fsencode(os.readlink(path)))
        else:
            digest.update(b"file\0")
            with open(path, "rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
print(digest.hexdigest())
PY
}

# ─── Setup ─────────────────────────────────────────────────────
setup_test_project() {
    rm -rf "$TEST_PROJECT"
    mkdir -p "$TEST_PROJECT"
    cd "$TEST_PROJECT"
    git init -q
    echo "# Test" > README.md
}

seed_canonical_dependencies() {
    local target_server="$TEST_HOME/.forgewright/mcp-server"
    mkdir -p "$target_server/src"
    cp -a "$FORGEWRIGHT_DIR/mcp/node_modules" "$target_server/node_modules" || true
    cp "$FORGEWRIGHT_DIR/mcp/package-lock.json" "$target_server/" || true
    touch "$target_server/src/index.ts"
    mkdir -p "$target_server/node_modules/.bin"
    touch "$target_server/node_modules/.bin/tsx"
    local sha256
    sha256=$(shasum -a 256 "$target_server/package-lock.json" | awk '{print $1}')
    cat > "$target_server/.forgewright-installation-owner.json" <<EOF
{"kind": "forgewright-mcp-runtime", "version": 1, "token": "12345-00000000000000000000000000000000", "path": "$target_server", "lockfile_sha256": "$sha256"}
EOF
    mkdir -p "$TEST_HOME/.forgewright"
    cp "$target_server/.forgewright-installation-owner.json" \
        "$TEST_HOME/.forgewright/.mcp-server-installation.json"
}

mark_owned_test_runtime() {
    local home="$1" runtime="$1/.forgewright/mcp-server" digest token
    mkdir -p "$runtime/src" "$runtime/node_modules/.bin" "$runtime/node_modules/tsx/dist"
    cp "$FORGEWRIGHT_DIR/mcp/package-lock.json" "$runtime/package-lock.json"
    printf 'export {};\n' > "$runtime/src/index.ts"
    printf '#!/usr/bin/env node\n' > "$runtime/node_modules/tsx/dist/cli.mjs"
    chmod 755 "$runtime/node_modules/tsx/dist/cli.mjs"
    ln -sfn ../tsx/dist/cli.mjs "$runtime/node_modules/.bin/tsx"
    digest="$(shasum -a 256 "$runtime/package-lock.json" | awk '{print $1}')"
    token="12345-0123456789abcdef0123456789abcdef"
    python3 - "$runtime/.forgewright-installation-owner.json" \
        "$home/.forgewright/.mcp-server-installation.json" "$runtime" "$digest" "$token" <<'PY'
import json
import os
import sys
internal, external, runtime, digest, token = sys.argv[1:]
owner = {"kind": "forgewright-mcp-runtime", "version": 1, "token": token,
         "path": runtime, "lockfile_sha256": digest}
payload = json.dumps(owner, sort_keys=True) + "\n"
for path in (internal, external):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(payload)
PY
}

cleanup() {
    cd "$SCRIPT_DIR"
    rm -rf "$TEST_PROJECT"
}
# The trap command assigns status before reading it in the same shell.
# shellcheck disable=SC2154
trap 'status=$?; cleanup; exit $status' EXIT HUP INT TERM

# ─── Tests ─────────────────────────────────────────────────────
test_help() {
    echo ""
    echo -e "${CYAN}━━━ Help Commands ━━━${NC}"

    bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --help > /dev/null 2>&1
    [[ $? -eq 0 ]] && pass "forgewright-mcp-setup.sh --help" || fail "forgewright-mcp-setup.sh --help"
}

test_check() {
    echo ""
    echo -e "${CYAN}━━━ Check Command ━━━${NC}"

    cd "$PROJECT_ROOT"
    mkdir -p "$TEST_HOME"
    info "Testing forgewright-mcp-setup.sh --check"
    HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check > /dev/null 2>&1 && pass "forgewright-mcp-setup.sh --check" || fail "forgewright-mcp-setup.sh --check"
}

test_diagnose() {
    echo ""
    echo -e "${CYAN}━━━ Diagnose Command ━━━${NC}"

    cd "$PROJECT_ROOT"
    info "Testing forgewright-mcp-setup.sh --diagnose"
    local output
    if output="$(bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --diagnose 2>&1)"; then
        pass "forgewright-mcp-setup.sh --diagnose"
    else
        fail "forgewright-mcp-setup.sh --diagnose"
        return
    fi
    grep -Fq "DIR:     ${FORGEWRIGHT_DIR}" <<< "$output" && pass "diagnose: repository root" || fail "diagnose: wrong repository root"
    grep -Fq "forgewright: ${FORGEWRIGHT_DIR}/scripts/forgewright-mcp-launcher.sh" <<< "$output" && pass "diagnose: canonical launcher path" || fail "diagnose: wrong launcher path"
    grep -Fq "PATH:  ${FORGEWRIGHT_DIR}/mcp" <<< "$output" && pass "diagnose: canonical MCP path" || fail "diagnose: wrong MCP path"
    if grep -Fq "/scripts/scripts/" <<< "$output"; then
        fail "diagnose: duplicated scripts path"
    else
        pass "diagnose: no duplicated scripts path"
    fi
}

test_setup() {
    [[ "$FAST" == "1" ]] && { skip "Setup test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Setup Command ━━━${NC}"

    setup_test_project
    cd "$TEST_PROJECT"
    local project_root_real manifest_path expected_manifest
    project_root_real="$(pwd -P)"
    manifest_path="${TEST_PROJECT}/.antigravity/mcp-manifest.json"
    expected_manifest="${TEST_PROJECT}/expected-mcp-manifest.json"
    mkdir -p "$TEST_HOME"
    seed_canonical_dependencies

    info "Testing fresh setup (--cursor only)"
    local output
    if output="$(HOME="$TEST_HOME" FORGEWRIGHT_MANIFEST_GENERATED_AT="2026-01-01T00:00:00Z" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor 2>&1)"; then
        pass "Setup completed"
    else
        fail "Setup failed:
$output"
        return
    fi

    [[ -f "${TEST_PROJECT}/.antigravity/mcp-manifest.json" ]] && pass "Manifest created" || fail "Manifest not created"
    [[ -x "${TEST_HOME}/.forgewright/mcp-server/node_modules/.bin/tsx" ]] && pass "Canonical tsx executable" || fail "Canonical tsx executable missing"
    [[ -s "${TEST_HOME}/.forgewright/mcp-server/node_modules/.forgewright-package-lock.sha256" ]] && pass "Dependency lock digest recorded" || fail "Dependency lock digest missing"
    if node - "$FORGEWRIGHT_DIR/mcp/package.json" "$FORGEWRIGHT_DIR/mcp/package-lock.json" <<'NODE'
const [manifestPath, lockPath] = process.argv.slice(2);
const manifest = require(manifestPath);
const lock = require(lockPath);
if (manifest.engines?.node !== '>=22.0.0' ||
    lock.packages?.['']?.engines?.node !== manifest.engines.node) process.exit(1);
for (const name of Object.keys(manifest.dependencies || {})) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (typeof entry?.resolved !== 'string' || !entry.resolved ||
      typeof entry?.integrity !== 'string' || !entry.integrity) process.exit(1);
}
NODE
    then
        pass "Every direct production dependency has locked resolution and integrity"
    else
        fail "Direct production dependency lock provenance is incomplete"
    fi
    [[ -f "${TEST_HOME}/.forgewright/mcp-server/build/runtime/tool-execution-gateway.js" ]] && pass "Gateway build artifact" || fail "Gateway build artifact missing"
    if grep -Fq "Server dir missing" <<< "$output"; then
        fail "Canonical server directory was reported missing"
    else
        pass "Canonical server verification reports the first check correctly"
    fi
    grep -Fq "${TEST_HOME}/.forgewright/mcp-server/node_modules/.bin/tsx" "${TEST_HOME}/.cursor/mcp.json" && pass "Cursor uses canonical tsx" || fail "Cursor does not use canonical tsx"
    grep -Fq "${TEST_HOME}/.forgewright/mcp-server/src/index.ts" "${TEST_HOME}/.cursor/mcp.json" && pass "Cursor uses canonical server source" || fail "Cursor does not use canonical server source"
    if grep -Fq "Claude Code (~/.claude.json)" <<< "$output"; then
        fail "Skipped Claude Code reported as configured"
    else
        pass "Skipped platforms are not reported as configured"
    fi

    local runtime_before manifest_before fake_npm_bin malformed_before portable_bin
    runtime_before="${TEST_PROJECT}/runtime-before-failure"
    cp -a "${TEST_HOME}/.forgewright/mcp-server" "$runtime_before"
    manifest_before="${TEST_PROJECT}/manifest-before-failure.json"
    cp "${TEST_PROJECT}/.antigravity/mcp-manifest.json" "$manifest_before"
    fake_npm_bin="${TEST_PROJECT}/fake-npm-bin"
    mkdir -p "$fake_npm_bin"
    printf '#!/usr/bin/env sh\nexit 42\n' > "$fake_npm_bin/npm"
    chmod +x "$fake_npm_bin/npm"
    if HOME="$TEST_HOME" PATH="$fake_npm_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ; then
        fail "Failed staged install unexpectedly succeeded"
    elif diff -qr "$runtime_before" "${TEST_HOME}/.forgewright/mcp-server" >/dev/null && \
        cmp -s "$manifest_before" "${TEST_PROJECT}/.antigravity/mcp-manifest.json" && \
        [[ ! -e "${TEST_HOME}/.forgewright/.mcp-server.setup.lock" ]] && \
        ! find "${TEST_HOME}/.forgewright" -maxdepth 1 -name '.mcp-server.stage.*' -print -quit | grep -q .; then
        pass "Failed staged build leaves runtime and manifest byte-identical"
    else
        fail "Failed staged build changed active state or leaked setup state"
    fi

    printf '{"unrelated":true,"mcpServers":{' > "${TEST_HOME}/.cursor/mcp.json"
    malformed_before="${TEST_PROJECT}/malformed-cursor.json"
    cp "${TEST_HOME}/.cursor/mcp.json" "$malformed_before"
    if HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor ; then
        fail "Malformed Cursor config was accepted"
    elif cmp -s "$malformed_before" "${TEST_HOME}/.cursor/mcp.json"; then
        pass "Malformed Cursor config fails closed without overwrite"
    else
        fail "Malformed Cursor config was overwritten"
    fi

    portable_bin="${TEST_PROJECT}/portable-bin"
    mkdir -p "$portable_bin"
    cat > "$portable_bin/gitnexus" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
    chmod +x "$portable_bin/gitnexus"
    cat > "${TEST_HOME}/.cursor/mcp.json" <<'EOF'
{
  // Strict JSON policy must not erase this comment.
  "theme": "high-contrast",
  "mcpServers": {
    "other": { "command": "other-server", },
  },
}
EOF
    cp "${TEST_HOME}/.cursor/mcp.json" "${TEST_PROJECT}/jsonc-before.json"
    if HOME="$TEST_HOME" PATH="$portable_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor  && \
        grep -Fq 'Strict JSON policy must not erase this comment.' "${TEST_HOME}/.cursor/mcp.json" && \
        grep -Fq '"theme": "high-contrast"' "${TEST_HOME}/.cursor/mcp.json"; then
        pass "Valid JSONC config is structurally edited without erasing comments"
    else
        fail "Valid JSONC config was rejected or lost unrelated formatting"
    fi

    printf '{\n  /* unterminated JSONC comment\n  "mcpServers": {}\n}\n' > "${TEST_HOME}/.cursor/mcp.json"
    cp "${TEST_HOME}/.cursor/mcp.json" "${TEST_PROJECT}/malformed-jsonc-before.json"
    if HOME="$TEST_HOME" PATH="$portable_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor ; then
        fail "Malformed JSONC config was accepted"
    elif cmp -s "${TEST_PROJECT}/malformed-jsonc-before.json" "${TEST_HOME}/.cursor/mcp.json"; then
        pass "Malformed JSONC fails closed byte-identical"
    else
        fail "Malformed JSONC changed during failed setup"
    fi

    cat > "${TEST_HOME}/.cursor/mcp.json" <<'EOF'
{
  "theme": "high-contrast",
  "disabledMcpServers": ["other", "forgewright", "gitnexus"],
  "disabled_mcp_servers": ["gitnexus", "keep-disabled"],
  "mcpServers": {"other": {"command": "other-server"}}
}
EOF
    if HOME="$TEST_HOME" PATH="$portable_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor  && \
        node - "${TEST_HOME}/.cursor/mcp.json" "$portable_bin/gitnexus" <<'NODE'
const fs = require('fs');
const [path, gitnexus] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
const disabled = [...config.disabledMcpServers, ...config.disabled_mcp_servers];
process.exit(
  config.theme === 'high-contrast' &&
  config.mcpServers.other.command === 'other-server' &&
  config.mcpServers.gitnexus.command === gitnexus &&
  !disabled.includes('forgewright') && !disabled.includes('gitnexus') &&
  disabled.includes('other') && disabled.includes('keep-disabled') ? 0 : 1
);
NODE
    then
        pass "Setup enables managed servers and preserves unrelated JSON settings"
    else
        fail "Disabled server cleanup or portable GitNexus resolution failed"
    fi

    cp -a "${TEST_HOME}/.forgewright/mcp-server" "${TEST_PROJECT}/runtime-before-preflight"
    cp "$manifest_path" "${TEST_PROJECT}/manifest-before-preflight.json"
    cp "${TEST_HOME}/.cursor/mcp.json" "${TEST_PROJECT}/cursor-before-preflight.json"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_UNSUPPORTED_ATOMIC=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ; then
        fail "Unsupported atomic exchange preflight was accepted"
    elif diff -qr "${TEST_PROJECT}/runtime-before-preflight" "${TEST_HOME}/.forgewright/mcp-server" >/dev/null && \
        cmp -s "${TEST_PROJECT}/manifest-before-preflight.json" "$manifest_path" && \
        cmp -s "${TEST_PROJECT}/cursor-before-preflight.json" "${TEST_HOME}/.cursor/mcp.json"; then
        pass "Unsupported publication fails before runtime, manifest, or config changes"
    else
        fail "Unsupported publication preflight caused side effects"
    fi

    cp -a "${TEST_HOME}/.forgewright/mcp-server" "${TEST_PROJECT}/runtime-before-manifest-failure"
    cp "$manifest_path" "${TEST_PROJECT}/manifest-before-publish-failure.json"
    cp "${TEST_HOME}/.cursor/mcp.json" "${TEST_PROJECT}/cursor-before-publish-failure.json"
    printf 'transaction-settings-sentinel\n' > "${TEST_PROJECT}/.forgewright/settings.env"
    cp "${TEST_PROJECT}/.forgewright/settings.env" "${TEST_PROJECT}/settings-before-publish-failure.env"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_FAIL_MANIFEST=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ; then
        fail "Injected manifest publication failure unexpectedly succeeded"
    elif diff -qr "${TEST_PROJECT}/runtime-before-manifest-failure" "${TEST_HOME}/.forgewright/mcp-server" >/dev/null && \
        cmp -s "${TEST_PROJECT}/manifest-before-publish-failure.json" "$manifest_path" && \
        cmp -s "${TEST_PROJECT}/cursor-before-publish-failure.json" "${TEST_HOME}/.cursor/mcp.json" && \
        cmp -s "${TEST_PROJECT}/settings-before-publish-failure.env" \
            "${TEST_PROJECT}/.forgewright/settings.env"; then
        pass "Manifest failure rolls settings, config, runtime, and manifest back byte-identically"
    else
        fail "Manifest publication failure left transaction state inconsistent"
    fi

    node - "${TEST_HOME}/.cursor/mcp.json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.crashRecoverySentinel = 'preserve-byte-identically';
fs.writeFileSync(path, JSON.stringify(config));
NODE
    touch "${TEST_HOME}/.forgewright/mcp-server/runtime-before-crash.marker"
    cp -a "${TEST_HOME}/.forgewright/mcp-server" "${TEST_PROJECT}/runtime-before-crash"
    cp "$manifest_path" "${TEST_PROJECT}/manifest-before-crash.json"
    cp "${TEST_HOME}/.cursor/mcp.json" "${TEST_PROJECT}/cursor-before-crash.json"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_SIGKILL_AFTER_EXCHANGE=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ; then
        fail "SIGKILL-after-exchange injection unexpectedly succeeded"
    elif [[ -f "${TEST_HOME}/.forgewright/.mcp-setup-transaction.json" ]] && \
        [[ ! -e "${TEST_HOME}/.forgewright/mcp-server/runtime-before-crash.marker" ]]; then
        pass "SIGKILL leaves a durable recovery journal after runtime exchange"
    else
        fail "SIGKILL injection did not leave the expected recoverable state"
    fi
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_SIGKILL_AFTER_RECOVERY_RUNTIME=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check ; then
        fail "SIGKILL-during-recovery injection unexpectedly succeeded"
    elif [[ -f "${TEST_HOME}/.forgewright/.mcp-setup-transaction.json" ]] && \
        [[ -e "${TEST_HOME}/.forgewright/mcp-server/runtime-before-crash.marker" ]] && \
        ! find "${TEST_HOME}/.forgewright" -maxdepth 1 -name '.mcp-server.stage.*' -print -quit | grep -q . && \
        ! cmp -s "${TEST_PROJECT}/cursor-before-crash.json" "${TEST_HOME}/.cursor/mcp.json"; then
        pass "Second SIGKILL leaves an already-restored runtime with file recovery pending"
    else
        fail "Recovery SIGKILL did not stop at the already-restored state"
    fi
    local recovery_token recovery_trash foreign_trash foreign_target
    recovery_token="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).token" \
        "${TEST_HOME}/.forgewright/.mcp-setup-transaction.json")"
    recovery_trash="${TEST_HOME}/.forgewright/.mcp-trash/runtime-${recovery_token}"
    foreign_trash="${TEST_HOME}/.forgewright/.mcp-trash/runtime-999-abcdef"
    foreign_target="${TEST_PROJECT}/foreign-cleanup-target"
    mkdir -p "$foreign_trash" "$foreign_target"
    printf '{"kind":"mcp-runtime-trash","token":"999-wrong"}\n' > "$foreign_trash/owner.json"
    printf 'must-survive\n' > "$foreign_target/sentinel"
    ln -s "$foreign_target" "$foreign_trash/runtime"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_SIGKILL_DURING_TRASH_CLEANUP=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check ; then
        fail "SIGKILL-during-trash-cleanup injection unexpectedly succeeded"
    elif [[ ! -e "${TEST_HOME}/.forgewright/.mcp-setup-transaction.json" ]] && \
        [[ -f "$recovery_trash/owner.json" ]] && [[ -e "$recovery_trash/runtime" ]] && \
        [[ -f "$foreign_target/sentinel" ]] && [[ -L "$foreign_trash/runtime" ]]; then
        pass "SIGKILL during recursive cleanup leaves durable external ownership state"
    else
        fail "Cleanup SIGKILL lost recovery ownership or touched foreign state"
    fi
    if HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check  && \
        diff -qr "${TEST_PROJECT}/runtime-before-crash" "${TEST_HOME}/.forgewright/mcp-server" >/dev/null && \
        cmp -s "${TEST_PROJECT}/manifest-before-crash.json" "$manifest_path" && \
        cmp -s "${TEST_PROJECT}/cursor-before-crash.json" "${TEST_HOME}/.cursor/mcp.json" && \
        [[ ! -e "${TEST_HOME}/.forgewright/.mcp-setup-transaction.json" ]] && \
        [[ ! -e "$recovery_trash" ]] && [[ -f "$foreign_target/sentinel" ]] && \
        [[ -L "$foreign_trash/runtime" ]] && \
        ! find "${TEST_HOME}/.forgewright" -maxdepth 1 -name '.mcp-server.stage.*' -print -quit | grep -q . && \
        ! find "${TEST_HOME}/.forgewright/.transactions" -mindepth 1 -print -quit 2>/dev/null | grep -q . && \
        ! find "${TEST_HOME}/.forgewright" -type d -name '*.lock' -print -quit | grep -q .; then
        pass "Later invocation resumes partial trash cleanup without deleting a foreign path"
    else
        fail "Repeated crash recovery did not restore a byte-identical transaction"
    fi

    mkdir -p "${TEST_PROJECT}/.antigravity/cache/intermediate"
    if (cd "${TEST_PROJECT}/.antigravity/cache/intermediate" && \
        HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ) && \
        [[ -f "${TEST_PROJECT}/.antigravity/mcp-manifest.json" ]] && \
        [[ ! -e "${TEST_PROJECT}/.antigravity/.antigravity/mcp-manifest.json" ]]; then
        pass "Intermediate .antigravity invocation resolves Git project root"
    else
        fail "Intermediate .antigravity invocation created a nested manifest"
    fi
    cd "$TEST_PROJECT"

    cp "$manifest_path" "$expected_manifest"
    if node - "$manifest_path" "$project_root_real" <<'NODE'
const fs = require('fs');
const [path, workspace] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
let formatted = `${JSON.stringify(manifest, null, 2)}\n`.replace(
  /"args": \[\n\s+"mcp"\n\s+\]/,
  '"args": ["mcp"]',
);
formatted = formatted.replace(
  `"workspace": "${workspace}"`,
  `"workspace": "/untrusted/duplicate",\n  "workspace": "${workspace}"`,
);
if ((formatted.match(/"workspace":/g) || []).length !== 2) {
  throw new Error('duplicate workspace fixture was not created');
}
fs.writeFileSync(path, formatted);
NODE
    then
        pass "Equivalent legacy fixture contains a duplicate key"
    else
        fail "Equivalent legacy duplicate-key fixture was not created"
    fi
    if cmp -s "$manifest_path" "$expected_manifest"; then
        fail "Equivalent legacy manifest fixture was not mutated"
    else
        pass "Equivalent legacy manifest fixture differs byte-for-byte"
    fi
    mkdir -p "${TEST_HOME}/.forgewright/mcp-server/src/stale"
    touch "${TEST_HOME}/.forgewright/mcp-server/src/stale/removed.ts"
    if HOME="$TEST_HOME" FORGEWRIGHT_FORCE_PYTHON_SYNC=1 \
        FORGEWRIGHT_MANIFEST_GENERATED_AT="2030-01-01T00:00:00Z" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor  && \
        [[ ! -e "${TEST_HOME}/.forgewright/mcp-server/src/stale/removed.ts" ]]; then
        pass "Python canonical refresh removes nested stale source files"
    else
        fail "Python canonical refresh retained nested stale source files"
    fi
    if cmp -s "$manifest_path" "$expected_manifest"; then
        pass "Forced setup canonicalizes equivalent JSON without timestamp churn"
    else
        fail "Forced setup changed the canonical equivalent manifest"
    fi
    if [[ "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).generated_at" "$manifest_path")" == \
        "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).generated_at" "$expected_manifest")" ]]; then
        pass "Equivalent manifest preserves generated_at"
    else
        fail "Equivalent manifest changed generated_at"
    fi

    node - "$manifest_path" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
manifest.workspace = '/changed/semantic/workspace';
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
    if HOME="$TEST_HOME" FORGEWRIGHT_MANIFEST_GENERATED_AT="2040-01-01T00:00:00Z" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor  && \
        node - "$manifest_path" "$project_root_real" <<'NODE'
const fs = require('fs');
const [path, workspace] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
process.exit(manifest.workspace === workspace && manifest.generated_at === '2040-01-01T00:00:00Z' ? 0 : 1);
NODE
    then
        pass "Semantic manifest changes adopt the new timestamp"
    else
        fail "Semantic manifest changes did not replace legacy values"
    fi

    rm -f "$manifest_path"
    mkdir "$manifest_path"
    if HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor ; then
        fail "Directory manifest target was accepted"
    else
        pass "Directory manifest target is rejected"
    fi
    rmdir "$manifest_path"
    cp "$expected_manifest" "$manifest_path"

    local concurrent_one concurrent_two
    HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor  &
    concurrent_one=$!
    HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor  &
    concurrent_two=$!
    if wait "$concurrent_one" && wait "$concurrent_two" && \
        [[ -f "${TEST_HOME}/.forgewright/mcp-server/build/runtime/tool-execution-gateway.js" ]] && \
        [[ ! -e "${TEST_HOME}/.forgewright/.mcp-server.setup.lock" ]]; then
        pass "Concurrent refreshes serialize and publish a usable runtime"
    else
        fail "Concurrent refresh locking failed"
    fi

    local config_one config_two concurrent_config="${TEST_HOME}/.cursor/concurrent.json"
    printf '{"mcpServers":{},"keep":"setting"}\n' > "$concurrent_config"
    HOME="$TEST_HOME" bash -c \
        'source "$1"; write_json_mcp_config "$2" cursor "" alpha one' \
        _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$concurrent_config"  &
    config_one=$!
    HOME="$TEST_HOME" bash -c \
        'source "$1"; write_json_mcp_config "$2" cursor "" beta two' \
        _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$concurrent_config"  &
    config_two=$!
    if wait "$config_one" && wait "$config_two" && \
        node - "$concurrent_config" <<'NODE'
const config = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.exit(config.keep === 'setting' && config.alpha === 'one' && config.beta === 'two' &&
  config.mcpServers.forgewright && config.mcpServers.gitnexus ? 0 : 1);
NODE
    then
        pass "Concurrent config updates serialize without losing unrelated settings"
    else
        fail "Concurrent config updates lost a distinct setting"
    fi

    local identity_lock="$TEST_HOME/.forgewright/identity.lock"
    mkdir -p "$identity_lock"
    printf '{"token":"stale","pid":%s,"birth":"definitely-not-this-process"}\n' "$$" \
        > "$identity_lock/owner.json"
    if HOME="$TEST_HOME" bash -c '
        source "$1"
        token="$(new_owner_token)"
        acquire_owned_lock "$2" "$token"
        release_owned_lock "$2" "$token"
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$identity_lock"  && \
        [[ ! -e "$identity_lock" ]]; then
        pass "PID-reuse identity mismatch is reclaimed without trusting a live numeric PID"
    else
        fail "PID-reuse identity mismatch wedged the owned lock"
    fi

    mkdir -p "$identity_lock"
    printf '{"token":"zombie","pid":%s,"birth":"fixture-birth"}\n' "$$" \
        > "$identity_lock/owner.json"
    local identity_overrides
    identity_overrides="{\"$$\":{\"birth\":\"fixture-birth\",\"state\":\"Z\"}}"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_PROCESS_IDENTITIES="$identity_overrides" bash -c '
        source "$1"
        token="$(new_owner_token)"
        acquire_owned_lock "$2" "$token"
        release_owned_lock "$2" "$token"
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$identity_lock"  && \
        [[ ! -e "$identity_lock" ]]; then
        pass "Zombie process identity is reclaimed deterministically"
    else
        fail "Zombie process identity was treated as a live lock owner"
    fi

    local abandoned_owner waiter_one waiter_two lock_owner
    HOME="$TEST_HOME" FORGEWRIGHT_TEST_HOLD_RUNTIME_LOCK_SECONDS=30 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor  &
    abandoned_owner=$!
    lock_owner="${TEST_HOME}/.forgewright/.mcp-server.setup.lock/owner.json"
    for _ in {1..100}; do
        [[ -f "$lock_owner" ]] && break
        sleep 0.05
    done
    kill -9 "$abandoned_owner"  || true
    wait "$abandoned_owner"  || true
    HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor \
        >"${TEST_PROJECT}/waiter-one.log" 2>&1 &
    waiter_one=$!
    HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --cursor \
        >"${TEST_PROJECT}/waiter-two.log" 2>&1 &
    waiter_two=$!
    local waiter_one_status=0 waiter_two_status=0
    wait "$waiter_one" || waiter_one_status=$?
    wait "$waiter_two" || waiter_two_status=$?
    if [[ "$waiter_one_status" -eq 0 ]] && [[ "$waiter_two_status" -eq 0 ]] && \
        [[ -f "${TEST_HOME}/.forgewright/mcp-server/build/runtime/tool-execution-gateway.js" ]] && \
        [[ ! -e "${TEST_HOME}/.forgewright/.mcp-server.setup.lock" ]]; then
        pass "Competing waiters reclaim a stale owner without deleting the live lock"
    else
        [[ "$VERBOSE" == "1" ]] && sed -n '1,240p' "${TEST_PROJECT}/waiter-one.log"
        [[ "$VERBOSE" == "1" ]] && sed -n '1,240p' "${TEST_PROJECT}/waiter-two.log"
        fail "Stale-lock waiter race broke lock ownership or runtime publication"
    fi

    cleanup
}

test_settings_and_durability_transactions() {
    [[ "$FAST" == "1" ]] && { skip "Settings transaction test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Settings and Durability Transactions ━━━${NC}"
    setup_test_project
    mkdir -p "$TEST_HOME" "$TEST_PROJECT/.forgewright"
    local settings="$TEST_PROJECT/.forgewright/settings.env"
    local external="$TEST_PROJECT/external-settings.env"
    printf 'external-must-survive\n' > "$external"
    ln -s "$external" "$settings"
    if HOME="$TEST_HOME" bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        CANONICAL_LOCK_TOKEN="$(new_owner_token)"
        initialize_runtime_transaction
        write_forgewright_settings
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_PROJECT" "$FORGEWRIGHT_DIR" \
        ; then
        fail "Symlinked settings.env was accepted"
    elif [[ "$(cat "$external")" == "external-must-survive" ]] && [[ -L "$settings" ]]; then
        pass "Transactional settings reject symlinks without modifying external targets"
    else
        fail "Symlinked settings.env modified its external target"
    fi
    rm -rf "$TEST_HOME/.forgewright" "$settings"

    printf 'external-hardlink-must-survive\n' > "$external"
    ln "$external" "$settings"
    if HOME="$TEST_HOME" bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        CANONICAL_LOCK_TOKEN="$(new_owner_token)"
        initialize_runtime_transaction
        write_forgewright_settings
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_PROJECT" "$FORGEWRIGHT_DIR" \
        ; then
        fail "Hard-linked settings.env was accepted"
    elif [[ "$(cat "$external")" == "external-hardlink-must-survive" ]] && \
        [[ "$(cat "$settings")" == "external-hardlink-must-survive" ]]; then
        pass "Transactional settings reject hardlinks without modifying external targets"
    else
        fail "Hard-linked settings.env modified shared external content"
    fi
    rm -rf "$TEST_HOME/.forgewright" "$settings"

    printf 'rollback-original\n' > "$settings"
    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_DURABILITY_FAIL_AT="settings-env:after-replace" \
        bash -c '
            source "$1"
            PROJECT_ROOT="$2"
            FORGEWRIGHT_DIR="$3"
            CANONICAL_LOCK_TOKEN="$(new_owner_token)"
            initialize_runtime_transaction
            write_forgewright_settings
        ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_PROJECT" "$FORGEWRIGHT_DIR" \
        ; then
        fail "Injected fsync boundary failure unexpectedly succeeded"
    elif HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check \
         && [[ "$(cat "$settings")" == "rollback-original" ]]; then
        pass "Injected durability failure rolls settings back byte-identically"
    else
        fail "Durability failure left settings or transaction recovery inconsistent"
    fi

    if HOME="$TEST_HOME" FORGEWRIGHT_TEST_SIGKILL_DURABILITY_AT="settings-env:after-replace" \
        bash -c '
            source "$1"
            PROJECT_ROOT="$2"
            FORGEWRIGHT_DIR="$3"
            CANONICAL_LOCK_TOKEN="$(new_owner_token)"
            initialize_runtime_transaction
            write_forgewright_settings
        ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_PROJECT" "$FORGEWRIGHT_DIR" \
        ; then
        fail "Injected power-loss boundary unexpectedly succeeded"
    elif [[ -f "$TEST_HOME/.forgewright/.mcp-setup-transaction.json" ]] && \
        HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check \
             && [[ "$(cat "$settings")" == "rollback-original" ]] && \
        [[ ! -e "$TEST_HOME/.forgewright/.mcp-setup-transaction.json" ]]; then
        pass "Power loss after replacement is recovered from the durable journal"
    else
        fail "Power-loss boundary could not be resumed safely"
    fi
    cleanup
}

test_platform_flags() {
    [[ "$FAST" == "1" ]] && { skip "Platform Flags test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Platform Flags ━━━${NC}"

    setup_test_project
    mkdir -p "$TEST_HOME"
    seed_canonical_dependencies
    cd "$TEST_PROJECT"
    if HOME="$TEST_HOME" bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --cursor \
        >"${TEST_PROJECT}/cursor-flag.log" 2>&1; then
        pass "--cursor flag"
    else
        [[ "$VERBOSE" == "1" ]] && sed -n '1,240p' "${TEST_PROJECT}/cursor-flag.log"
        fail "--cursor flag"
    fi
    local platform_bin
    platform_bin="${TEST_PROJECT}/platform-bin"
    mkdir -p "$platform_bin" "$TEST_HOME/.claude"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$platform_bin/gitnexus"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$platform_bin/codex"
    chmod +x "$platform_bin/gitnexus" "$platform_bin/codex"
    printf '{"hooks":{"Stop":[]},"keep":"hook-setting"}\n' > "$TEST_HOME/.claude/settings.json"
    cp "$TEST_HOME/.claude/settings.json" "$TEST_PROJECT/claude-settings-before.json"
    printf '{"mcpServers":{},"keep":"claude-user-state"}\n' > "$TEST_HOME/.claude.json"
    HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --claude-code > /dev/null 2>&1 && \
        node - "$TEST_HOME/.claude.json" "$platform_bin/gitnexus" <<'NODE'
const fs = require('fs');
const [path, gitnexus] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
process.exit(config.keep === 'claude-user-state' && config.mcpServers.gitnexus.command === gitnexus ? 0 : 1);
NODE
    if [[ $? -eq 0 ]] && cmp -s "$TEST_PROJECT/claude-settings-before.json" "$TEST_HOME/.claude/settings.json"; then
        pass "--claude-code uses ~/.claude.json and preserves hook settings byte-identically"
    else
        fail "--claude-code flag"
    fi
    mkdir -p "$TEST_HOME/.codex"
    cat > "$TEST_HOME/.codex/config.toml" <<'EOF'
# Preserve this unrelated comment.
[ui]
theme = "light"
description = """keep this text exactly:
[mcp_servers.forgewright]
command = "not-a-table-inside-a-string"
"""
nested = [["[mcp_servers.gitnexus]", "keep"], ["# not a comment"]]

mcp_servers.gitnexus.command = "stale-gitnexus"
mcp_servers.gitnexus.args = ["remove-dotted-assignment"]

[mcp_servers.forgewright]
command = "stale"
args = ["stale.ts"]

[mcp_servers.forgewright.env]
STALE = "remove-me"

[[mcp_servers.forgewright.targets]]
name = "remove-array-descendant"

# Preserve this table comment.
[unrelated]
value = 7
description = """literal-looking TOML must remain:
[mcp_servers.forgewright.env]
TOKEN = "inside-multiline-string"
"""
nested = [["[[mcp_servers.gitnexus.targets]]"], ["keep", "array"]]
EOF
    if HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --codex > /dev/null 2>&1 && \
        python3 - "$TEST_HOME/.codex/config.toml" "$TEST_HOME/.forgewright/mcp-server" "$platform_bin/gitnexus" <<'PY'
import sys, tomllib
path, runtime, gitnexus = sys.argv[1:]
with open(path, "rb") as handle:
    root = tomllib.load(handle)
config = root["mcp_servers"]
fw, gn = config["forgewright"], config["gitnexus"]
raise SystemExit(0 if fw["command"] == f"{runtime}/node_modules/.bin/tsx" and
                 fw["args"] == [f"{runtime}/src/index.ts"] and
                 "env" not in fw and "targets" not in fw and gn["command"] == gitnexus and
                 gn["args"] == ["mcp"] and
                 root["unrelated"]["value"] == 7 and root["ui"]["theme"] == "light" and
                 "not-a-table-inside-a-string" in root["ui"]["description"] and
                 root["ui"]["nested"][0][1] == "keep" else 1)
PY
    then
        if grep -Fq '# Preserve this unrelated comment.' "$TEST_HOME/.codex/config.toml" && \
            grep -Fq '# Preserve this table comment.' "$TEST_HOME/.codex/config.toml"; then
            pass "TOML upgrade removes tables, descendants, arrays, and dotted assignments"
        else
            fail "TOML replacement dropped unrelated comments"
        fi
    else
        fail "--codex flag"
    fi
    local zed_dir
    if [[ "$(uname -s)" == "Darwin" ]]; then
        zed_dir="$TEST_HOME/Library/Application Support/Zed"
    else
        zed_dir="$TEST_HOME/.config/zed"
    fi
    mkdir -p "$zed_dir"
    cat > "$zed_dir/settings.json" <<'EOF'
{
  // Preserve Zed theme and this comment.
  "theme": "solarized",
  "mcpServers": { "legacy": { "keep": true, }, },
  "context_servers": {
    "other": { "command": "other", "args": [], },
  },
}
EOF
    if HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --zed > /dev/null 2>&1 && \
        node - "$zed_dir/settings.json" "$TEST_HOME/.forgewright/mcp-server" "$platform_bin/gitnexus" \
            "$TEST_HOME/.forgewright/mcp-server/node_modules/jsonc-parser" <<'NODE'
const fs = require('fs');
const [path, runtime, gitnexus, parserModule] = process.argv.slice(2);
const errors = [];
const config = require(parserModule).parse(fs.readFileSync(path, 'utf8'), errors, { allowTrailingComma: true });
if (errors.length) process.exit(1);
const fw = config.context_servers?.forgewright;
const gn = config.context_servers?.gitnexus;
process.exit(config.theme === 'solarized' && config.mcpServers.legacy.keep === true &&
  config.context_servers.other.command === 'other' &&
  fw.command === `${runtime}/node_modules/.bin/tsx` && fw.args[0] === `${runtime}/src/index.ts` &&
  gn.command === gitnexus && gn.args[0] === 'mcp' ? 0 : 1);
NODE
    then
        if grep -Fq 'Preserve Zed theme and this comment.' "$zed_dir/settings.json"; then
            pass "--zed structurally edits JSONC and preserves comments/trailing-comma content"
        else
            fail "--zed erased an unrelated JSONC comment"
        fi
    else
        fail "--zed real settings contract"
    fi

    mkdir -p "$TEST_HOME/.config/opencode"
    printf '{"conflict":"must-remain-byte-identical"}\n' > "$TEST_HOME/.config/opencode/opencode.json"
    cp "$TEST_HOME/.config/opencode/opencode.json" "$TEST_PROJECT/opencode-json-before.json"
    cat > "$TEST_HOME/.config/opencode/opencode.jsonc" <<'EOF'
{
  // Preserve the active OpenCode JSONC schema setting.
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "mcp": {
    "other": { "type": "remote", "url": "https://example.invalid/mcp", },
  },
  "mcpServers": { "legacy": { "keep": true, }, },
}
EOF
    if HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --opencode > /dev/null 2>&1 && \
        node - "$TEST_HOME/.config/opencode/opencode.jsonc" "$TEST_HOME/.forgewright/mcp-server" \
            "$platform_bin/gitnexus" "$TEST_HOME/.forgewright/mcp-server/node_modules/jsonc-parser" \
            "$TEST_PROJECT/.antigravity/mcp-manifest.json" <<'NODE' && \
        cmp -s "$TEST_PROJECT/opencode-json-before.json" "$TEST_HOME/.config/opencode/opencode.json" && \
        grep -Fq 'Preserve the active OpenCode JSONC schema setting.' "$TEST_HOME/.config/opencode/opencode.jsonc"
const fs = require('fs');
const [path, runtime, gitnexus, parserModule, manifestPath] = process.argv.slice(2);
const errors = [];
const config = require(parserModule).parse(fs.readFileSync(path, 'utf8'), errors, { allowTrailingComma: true });
if (errors.length) process.exit(1);
const fw = config.mcp?.forgewright;
const gn = config.mcp?.gitnexus;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
process.exit(config.theme === 'system' && config.mcpServers.legacy.keep === true &&
  config.mcp.other.type === 'remote' && fw.type === 'local' && fw.enabled === true &&
  JSON.stringify(fw.command) === JSON.stringify([`${runtime}/node_modules/.bin/tsx`, `${runtime}/src/index.ts`]) &&
  gn.type === 'local' && JSON.stringify(gn.command) === JSON.stringify([gitnexus, 'mcp']) &&
  manifest.platforms.opencode === path ? 0 : 1);
NODE
    then
        pass "--opencode prefers JSONC, preserves comments, and snapshots the selected manifest path"
    else
        fail "--opencode real config contract"
    fi
    cp "$TEST_HOME/.config/opencode/opencode.jsonc" "$TEST_PROJECT/opencode-jsonc-before-rollback.jsonc"
    if HOME="$TEST_HOME" PATH="$platform_bin:$PATH" FORGEWRIGHT_TEST_FAIL_MANIFEST=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --opencode ; then
        fail "Injected OpenCode JSONC rollback failure unexpectedly succeeded"
    elif cmp -s "$TEST_PROJECT/opencode-jsonc-before-rollback.jsonc" \
        "$TEST_HOME/.config/opencode/opencode.jsonc"; then
        pass "OpenCode JSONC participates in byte-identical transaction rollback"
    else
        fail "OpenCode JSONC rollback snapshot was not restored byte-identically"
    fi

    cat > "$TEST_HOME/.codex/comment-only.toml" <<EOF
# [mcp_servers.forgewright]
# command = "$TEST_HOME/.forgewright/mcp-server/node_modules/.bin/tsx"
# args = ["$TEST_HOME/.forgewright/mcp-server/src/index.ts"]
EOF
    if HOME="$TEST_HOME" bash -c \
        'source "$1"; has_canonical_mcp_config "$2"' \
        _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_HOME/.codex/comment-only.toml"; then
        fail "TOML comments were mistaken for a configured MCP server"
    else
        pass "TOML verification ignores comment-only false positives"
    fi

    local quoted_home="${TEST_PROJECT}/home-\"quoted\\path"
    mkdir -p "$quoted_home/.codex"
    if HOME="$quoted_home" PATH="$platform_bin:$PATH" bash -c \
        'source "$1"; write_toml_mcp_config "$2"' \
        _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$quoted_home/.codex/config.toml"  && \
        python3 - "$quoted_home/.codex/config.toml" "$quoted_home/.forgewright/mcp-server" <<'PY'
import sys, tomllib
path, runtime = sys.argv[1:]
with open(path, "rb") as handle:
    fw = tomllib.load(handle)["mcp_servers"]["forgewright"]
raise SystemExit(0 if fw["command"] == f"{runtime}/node_modules/.bin/tsx" and
                 fw["args"] == [f"{runtime}/src/index.ts"] else 1)
PY
    then
        pass "TOML writer structurally escapes quotes and backslashes in paths"
    else
        fail "TOML path quoting failed structural parsing"
    fi

    mkdir -p "$TEST_HOME/.cursor" "$TEST_HOME/.gemini/config" "$TEST_HOME/.codex"
    local unusable='{"mcpServers":{"forgewright":{"command":"","args":[]},"gitnexus":{"command":"","args":[]}}}'
    printf '%s\n' "$unusable" > "$TEST_HOME/.cursor/mcp.json"
    printf '%s\n' "$unusable" > "$TEST_HOME/.claude.json"
    printf '%s\n' "$unusable" > "$TEST_HOME/.gemini/settings.json"
    printf '%s\n' "$unusable" > "$TEST_HOME/.gemini/config/mcp_config.json"
    printf '{}\n' > "$TEST_HOME/.gemini/mcp-server-enablement.json"
    printf '[mcp_servers.forgewright]\ncommand = ""\nargs = []\n[mcp_servers.gitnexus]\ncommand = ""\nargs = []\n' \
        > "$TEST_HOME/.codex/config.toml"
    printf '{"context_servers":{"forgewright":{"command":"","args":[]},"gitnexus":{"command":"","args":[]},},}\n' \
        > "$zed_dir/settings.json"
    printf '{"mcp":{"forgewright":{"type":"local","command":[],},"gitnexus":{"type":"local","command":[],},},}\n' \
        > "$TEST_HOME/.config/opencode/opencode.jsonc"
    local check_output diagnose_output
    check_output="$(HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --check 2>&1)"
    diagnose_output="$(HOME="$TEST_HOME" PATH="$platform_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --diagnose 2>&1)"
    if ! grep -Fq 'forgewright: CONFIGURED' <<< "$check_output" && \
        ! grep -Fq 'forgewright: CONFIGURED' <<< "$diagnose_output" && \
        grep -Fq 'forgewright: NOT configured with canonical server' <<< "$check_output" && \
        grep -Fq 'forgewright: NOT configured with canonical server' <<< "$diagnose_output"; then
        pass "Check and diagnose reject unusable entries across every client schema"
    else
        fail "Check or diagnose reported an empty client entry as configured"
    fi

    local canonical_tsx="$TEST_HOME/.forgewright/mcp-server/node_modules/.bin/tsx"
    local canonical_server="$TEST_HOME/.forgewright/mcp-server/src/index.ts"
    local desktop_config
    if [[ "$(uname -s)" == "Darwin" ]]; then
        desktop_config="$TEST_HOME/Library/Application Support/Claude/claude_desktop_config.json"
    else
        desktop_config="$TEST_HOME/.config/Claude/claude_desktop_config.json"
    fi
    mkdir -p "$(dirname "$desktop_config")"
    node - "$canonical_tsx" "$canonical_server" "$TEST_HOME" "$zed_dir/settings.json" \
        "$TEST_HOME/.config/opencode/opencode.jsonc" "$desktop_config" <<'NODE'
const fs = require('fs');
const [tsx, server, home, zed, opencode, desktop] = process.argv.slice(2);
const generic = {mcpServers:{forgewright:{command:tsx,args:[server,'--unexpected']}}};
for (const path of [`${home}/.cursor/mcp.json`, `${home}/.claude.json`,
                    `${home}/.gemini/settings.json`, `${home}/.gemini/config/mcp_config.json`, desktop]) {
  fs.mkdirSync(require('path').dirname(path), {recursive:true});
  fs.writeFileSync(path, JSON.stringify(generic));
}
fs.writeFileSync(zed, JSON.stringify({context_servers:{forgewright:{command:tsx,args:[server,'--unexpected']}}}));
fs.writeFileSync(opencode, JSON.stringify({mcp:{forgewright:{type:'local',command:[tsx,server,'--unexpected']}}}));
NODE
    cat > "$TEST_HOME/.codex/config.toml" <<EOF
[mcp_servers.forgewright]
command = "$canonical_tsx"
args = ["$canonical_server", "--unexpected"]
EOF
    if HOME="$TEST_HOME" bash -c '
        source "$1"
        ! has_canonical_mcp_config "$2" &&
        ! has_canonical_mcp_config "$3" &&
        ! has_canonical_mcp_config "$4" zed &&
        ! has_canonical_mcp_config "$5" opencode &&
        ! has_canonical_mcp_config "$6" &&
        ! has_canonical_mcp_config "$7" &&
        ! has_canonical_mcp_config "$8"
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" \
        "$TEST_HOME/.codex/config.toml" "$TEST_HOME/.cursor/mcp.json" \
        "$zed_dir/settings.json" "$TEST_HOME/.config/opencode/opencode.jsonc" \
        "$TEST_HOME/.gemini/settings.json" "$TEST_HOME/.gemini/config/mcp_config.json" \
        "$desktop_config"; then
        pass "Canonical status rejects behavior-changing extra argv across every schema"
    else
        fail "Canonical status accepted extra argv for at least one client"
    fi
    cleanup
}

test_gemini_isolated() {
    [[ "$FAST" == "1" ]] && { skip "Gemini isolated test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Isolated Gemini ━━━${NC}"
    setup_test_project
    local gemini_home="$TEST_PROJECT/gemini-home" gemini_bin="$TEST_PROJECT/gemini-bin" project_real
    project_real="$(cd "$TEST_PROJECT" && pwd -P)"
    mkdir -p "$gemini_home/.gemini/config" "$gemini_bin"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$gemini_bin/gemini"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$gemini_bin/gitnexus"
    chmod +x "$gemini_bin/gemini" "$gemini_bin/gitnexus"
    printf '{"forgewright":{"enabled":false},"gitnexus":{"enabled":false},"other":{"enabled":false},"custom":{"keep":7}}\n' \
        > "$gemini_home/.gemini/mcp-server-enablement.json"
    printf '{"mcpServers":{"existing":{"command":"keep"}},"antigravitySetting":true}\n' \
        > "$gemini_home/.gemini/config/mcp_config.json"
    cp "$gemini_home/.gemini/config/mcp_config.json" "$TEST_PROJECT/antigravity-before.json"
    local output
    if output="$(HOME="$gemini_home" PATH="$gemini_bin:$PATH" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --gemini 2>&1)" && \
        node - "$gemini_home/.gemini/settings.json" \
            "$gemini_home/.gemini/mcp-server-enablement.json" \
            "$project_real" "$gemini_bin/gitnexus" "$TEST_PROJECT/.antigravity/mcp-manifest.json" <<'NODE' &&
const fs = require('fs');
const [settingsPath, enablementPath, project, gitnexus, manifestPath] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const enablement = JSON.parse(fs.readFileSync(enablementPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
process.exit(
  settings.mcpServers.forgewright.env.FORGEWRIGHT_WORKSPACE === project &&
  settings.mcpServers.gitnexus.command === gitnexus &&
  !('forgewright' in enablement) && !('gitnexus' in enablement) &&
  enablement.other.enabled === false && enablement.custom.keep === 7 &&
  JSON.stringify(Object.keys(manifest.platforms)) === JSON.stringify(['gemini']) ? 0 : 1
);
NODE
        cmp -s "$TEST_PROJECT/antigravity-before.json" "$gemini_home/.gemini/config/mcp_config.json" && \
        ! grep -Fq "Antigravity (" <<< "$output"
    then
        pass "--gemini mutates and reports only Gemini while preserving Antigravity byte-identically"
    else
        fail "Isolated --gemini setup or config verification failed"
    fi
    cleanup
}

test_all_isolated() {
    [[ "$FAST" == "1" ]] && { skip "All-platform isolated test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Isolated All Platforms ━━━${NC}"
    setup_test_project
    local all_home="$TEST_PROJECT/all-home" all_bin="$TEST_PROJECT/all-bin"
    local zed_dir desktop_dir antigravity_dir="$TEST_PROJECT/all-home/.cursor/projects/hash/mcps/user-forgewright"
    mkdir -p "$all_home" "$all_bin" "$all_home/.claude" "$all_home/.config/opencode" "$antigravity_dir/tools"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$all_bin/codex"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$all_bin/gemini"
    printf '#!/usr/bin/env sh\nexit 0\n' > "$all_bin/gitnexus"
    chmod +x "$all_bin/codex" "$all_bin/gemini" "$all_bin/gitnexus"
    printf '{"hooks":{"Stop":[]},"claudeSetting":true}\n' > "$all_home/.claude/settings.json"
    cp "$all_home/.claude/settings.json" "$TEST_PROJECT/all-claude-settings-before.json"
    printf '{"mcpServers":{},"claudeUserState":true}\n' > "$all_home/.claude.json"
    printf '{"name":"forgewright"}\n' > "$antigravity_dir/SERVER_METADATA.json"
    printf '{"opencodeSetting":true,"mcp":{"other":{"type":"remote","url":"https://example.invalid"}}}\n' \
        > "$all_home/.config/opencode/opencode.json"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        zed_dir="$all_home/Library/Application Support/Zed"
        desktop_dir="$all_home/Library/Application Support/Claude"
    else
        zed_dir="$all_home/.config/zed"
        desktop_dir="$all_home/.config/Claude"
    fi
    mkdir -p "$zed_dir" "$desktop_dir"
    printf '{"zedSetting":true}\n' > "$zed_dir/settings.json"
    printf '{"desktopSetting":true}\n' > "$desktop_dir/claude_desktop_config.json"

    if HOME="$all_home" PATH="$all_bin:$PATH" XDG_CONFIG_HOME="$all_home/.config" \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --all  && \
        node - "$all_home" "$zed_dir/settings.json" "$desktop_dir/claude_desktop_config.json" \
            "$TEST_PROJECT/.antigravity/mcp-manifest.json" <<'NODE' && \
        python3 - "$all_home/.codex/config.toml" <<'PY'
const fs = require('fs');
const [home, zed, desktop, manifestPath] = process.argv.slice(2);
for (const path of [`${home}/.cursor/mcp.json`, `${home}/.claude.json`,
                    `${home}/.gemini/settings.json`, `${home}/.gemini/config/mcp_config.json`,
                    `${home}/.qwen/settings.json`, desktop]) {
  const config = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!config.mcpServers?.forgewright || !config.mcpServers?.gitnexus) process.exit(1);
}
const zedConfig = JSON.parse(fs.readFileSync(zed, 'utf8'));
if (zedConfig.zedSetting !== true || !zedConfig.context_servers?.forgewright ||
    !zedConfig.context_servers?.gitnexus || zedConfig.mcpServers) process.exit(1);
const opencode = JSON.parse(fs.readFileSync(`${home}/.config/opencode/opencode.json`, 'utf8'));
if (opencode.opencodeSetting !== true || opencode.mcp.other.type !== 'remote' ||
    opencode.mcp.forgewright.type !== 'local' || !Array.isArray(opencode.mcp.forgewright.command) ||
    opencode.mcp.gitnexus.type !== 'local' || !Array.isArray(opencode.mcp.gitnexus.command)) process.exit(1);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expected = ['antigravity', 'claude_code', 'claude_desktop', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'zed'];
const expectedPaths = {
  qwen: `${home}/.qwen/settings.json`,
  zed,
  opencode: `${home}/.config/opencode/opencode.json`,
};
process.exit(
  JSON.stringify(Object.keys(manifest.platforms).sort()) === JSON.stringify(expected) &&
  Object.entries(expectedPaths).every(([name, path]) => manifest.platforms[name] === path) ? 0 : 1
);
NODE
import sys, tomllib
with open(sys.argv[1], "rb") as handle:
    servers = tomllib.load(handle)["mcp_servers"]
raise SystemExit(0 if {"forgewright", "gitnexus"}.issubset(servers) else 1)
PY
    then
        if cmp -s "$TEST_PROJECT/all-claude-settings-before.json" "$all_home/.claude/settings.json"; then
            pass "--all configures every client without touching Claude hook settings"
        else
            fail "--all modified ~/.claude/settings.json"
        fi
    else
        fail "Isolated --all platform configuration failed"
    fi
    cat > "$desktop_dir/claude_desktop_config.json" <<EOF
{
  // Preserve Claude Desktop rollback state.
  "desktopSetting": true,
  "mcpServers": {
    "forgewright": {
      "command": "$all_home/.forgewright/mcp-server/node_modules/.bin/tsx",
      "args": ["$all_home/.forgewright/mcp-server/src/index.ts"],
    },
    "gitnexus": { "command": "$all_bin/gitnexus", "args": ["mcp"], },
  },
}
EOF
    cp "$desktop_dir/claude_desktop_config.json" "$TEST_PROJECT/desktop-before-rollback.jsonc"
    if HOME="$all_home" PATH="$all_bin:$PATH" FORGEWRIGHT_TEST_FAIL_MANIFEST=1 \
        bash "${SCRIPT_DIR}/forgewright-mcp-setup.sh" --force --claude-desktop ; then
        fail "Injected Claude Desktop rollback failure unexpectedly succeeded"
    elif cmp -s "$TEST_PROJECT/desktop-before-rollback.jsonc" \
        "$desktop_dir/claude_desktop_config.json"; then
        pass "Claude Desktop JSONC participates in byte-identical transaction rollback"
    else
        fail "Claude Desktop rollback snapshot was not restored byte-identically"
    fi
    [[ -x "$antigravity_dir/launcher.sh" ]] && pass "--all publishes verified Antigravity launcher" || fail "--all Antigravity launcher missing"
    cleanup
}

test_uninstall_contracts() {
    [[ "$FAST" == "1" ]] && { skip "Uninstall contract test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Uninstall Contracts ━━━${NC}"
    setup_test_project
    local uninstall_home="${TEST_PROJECT}/home-o'clock"
    local uninstall_xdg="${TEST_PROJECT}/xdg-o'clock"
    local zed_config desktop_config opencode_root="$uninstall_xdg/opencode"
    local fresh_root="$TEST_PROJECT/fresh-checkout" fresh_script
    fresh_script="$fresh_root/scripts/mcp/forgewright-mcp-setup.sh"
    mkdir -p "$(dirname "$fresh_script")"
    cp "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$fresh_script"
    mkdir -p "$uninstall_home/.cursor" "$uninstall_home/.gemini/config" \
        "$uninstall_home/.codex" "$opencode_root" "${TEST_PROJECT}/.antigravity"
    uninstall_home="$(cd "$uninstall_home" && pwd -P)"
    uninstall_xdg="$(cd "$uninstall_xdg" && pwd -P)"
    opencode_root="$uninstall_xdg/opencode"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        zed_config="$uninstall_home/Library/Application Support/Zed/settings.json"
        desktop_config="$uninstall_home/Library/Application Support/Claude/claude_desktop_config.json"
    else
        zed_config="$uninstall_xdg/zed/settings.json"
        desktop_config="$uninstall_xdg/Claude/claude_desktop_config.json"
    fi
    mkdir -p "$(dirname "$zed_config")" "$(dirname "$desktop_config")"

    local generic_fixture='{"keep":"unchanged","mcpServers":{"forgewright":{"command":"'$uninstall_home'/.forgewright/mcp-server/node_modules/.bin/tsx"},"gitnexus":{"command":"'$uninstall_home'/.forgewright/gitnexus"},"other":{"command":"keep"}}}'
    printf '%s\n' "$generic_fixture" > "$uninstall_home/.cursor/mcp.json"
    printf '%s\n' "$generic_fixture" > "$uninstall_home/.claude.json"
    printf '%s\n' "$generic_fixture" > "$uninstall_home/.gemini/settings.json"
    printf '%s\n' "$generic_fixture" > "$uninstall_home/.gemini/config/mcp_config.json"
    printf '%s\n' "$generic_fixture" > "$opencode_root/config.json"
    cat > "$desktop_config" <<'EOF'
{
  // Preserve Claude Desktop JSONC state.
  "desktopKeep": true,
  "mcpServers": {
    "forgewright": { "command": "stale", },
    "gitnexus": { "command": "stale", },
    "other": { "command": "keep", "args": [], },
  },
}
EOF
    printf '{"keep":"zed","context_servers":{"forgewright":{"command":"'$uninstall_home'/.forgewright/mcp-server/node_modules/.bin/tsx"},"gitnexus":{"command":"'$uninstall_home'/.forgewright/gitnexus"},"other":{"command":"keep"}}}\n' \
        > "$zed_config"
    printf '{"conflict":"preserve"}\n' > "$opencode_root/opencode.json"
    cp "$opencode_root/opencode.json" "$TEST_PROJECT/uninstall-opencode-json-before.json"
    cat > "$opencode_root/opencode.jsonc" <<'EOF'
{
  // Preserve OpenCode JSONC state.
  "keep": "opencode",
  "mcp": {
    "forgewright": { "type": "local", "command": ["'$uninstall_home'/.forgewright/mcp-server/node_modules/.bin/tsx"], },
    "gitnexus": { "type": "local", "command": ["'$uninstall_home'/.forgewright/gitnexus"], },
    "other": { "type": "remote", "url": "https://example.invalid", },
  },
}
EOF
    cat > "$uninstall_home/.codex/config.toml" <<'EOF'
# Preserve Codex header.
[mcp_servers.forgewright]
command = "'$uninstall_home'/.forgewright/mcp-server/node_modules/.bin/tsx"
[mcp_servers.forgewright.env]
TOKEN = "must-not-be-reparented"
[mcp_servers.forgewright.env.deep]
value = 1
[[mcp_servers.forgewright.targets]]
name = "remove-array-descendant"
[mcp_servers.gitnexus]
command = "'$uninstall_home'/.forgewright/gitnexus"
[mcp_servers.gitnexus.auth]
token = "must-not-be-reparented"
[[mcp_servers.gitnexus.targets]]
name = "remove-array-descendant"
# Preserve Codex unrelated comment.
[unrelated]
value = 7
description = """literal-looking TOML must remain:
[mcp_servers.forgewright.env]
TOKEN = "inside-multiline-string"
"""
nested = [["[[mcp_servers.gitnexus.targets]]"], ["keep", "array"]]
EOF
    cat > "$opencode_root/config.toml" <<'EOF'
# Preserve legacy OpenCode header.
mcp_servers.forgewright.command = "'$uninstall_home'/.forgewright/mcp-server/node_modules/.bin/tsx"
mcp_servers.forgewright.args = [
  "must-not-be-reparented",
]
mcp_servers.gitnexus.command = "'$uninstall_home'/.forgewright/gitnexus"
mcp_servers.gitnexus.args = ["must-not-be-reparented"]
# Preserve legacy unrelated comment.
[legacy_unrelated]
value = 9
EOF
    printf '{}\n' > "${TEST_PROJECT}/.antigravity/mcp-manifest.json"
    mkdir -p "$uninstall_home/.forgewright/mcp-server/large-owned-payload/chunks"
    for index in {1..64}; do
        printf 'owned-runtime-%s\n' "$index" \
            > "$uninstall_home/.forgewright/mcp-server/large-owned-payload/chunks/$index"
    done
    mark_owned_test_runtime "$uninstall_home"
    local uninstall_ledger="$uninstall_home/.forgewright/.mcp-config-ledger.json"
    node - "$uninstall_ledger" "$uninstall_home" "$opencode_root" "$zed_config" \
        "$desktop_config" "$JSONC_PARSER_MODULE" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const [ledgerPath, home, opencodeRoot, zedPath, desktopPath, parserModule] = process.argv.slice(2);
const token = '12345-0123456789abcdef0123456789abcdef';
const records = {};
const parseJsonc = (raw) => require(parserModule).parse(raw, [], {allowTrailingComma: true});
const add = (path, schema, root, parser = JSON.parse) => {
  path = fs.realpathSync(path);
  const config = parser(fs.readFileSync(path, 'utf8'));
  for (const managed of ['forgewright', 'gitnexus']) {
    const entry = config[root]?.[managed];
    if (entry === undefined) continue;
    const key = crypto.createHash('sha256').update(`${path}:${schema}:${managed}`).digest('hex');
    records[key] = {canonical_path: path, schema, managed_name: managed, created: true, owned: true,
      normalized_value_sha256: crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex')};
  }
};
add(`${home}/.cursor/mcp.json`, 'cursor', 'mcpServers');
add(`${home}/.claude.json`, 'claude', 'mcpServers');
add(`${home}/.gemini/settings.json`, 'gemini', 'mcpServers');
add(`${home}/.gemini/config/mcp_config.json`, 'antigravity', 'mcpServers');
add(`${opencodeRoot}/config.json`, 'json-config', 'mcpServers');
add(zedPath, 'zed', 'context_servers');
add(desktopPath, 'claude-desktop', 'mcpServers', parseJsonc);
add(`${opencodeRoot}/opencode.jsonc`, 'opencode', 'mcp', parseJsonc);
fs.mkdirSync(require('path').dirname(ledgerPath), {recursive: true});
fs.writeFileSync(ledgerPath, JSON.stringify({kind: 'forgewright-mcp-ledger', version: 1, runtime_token: token, records}, null, 2));
NODE
    python3 - "$uninstall_ledger" "$uninstall_home/.codex/config.toml" \
        "$opencode_root/config.toml" <<'PY'
import hashlib, json, os, sys, tomllib
ledger_path, *paths = sys.argv[1:]
with open(ledger_path, encoding="utf-8") as handle:
    ledger = json.load(handle)
for path in paths:
    path = os.path.realpath(path)
    with open(path, "rb") as handle:
        servers = tomllib.load(handle).get("mcp_servers", {})
    for managed in ("forgewright", "gitnexus"):
        if managed not in servers:
            continue
        key = hashlib.sha256(f"{path}:codex:{managed}".encode()).hexdigest()
        value = hashlib.sha256(json.dumps(servers[managed], sort_keys=True).encode()).hexdigest()
        ledger["records"][key] = {"canonical_path": path, "schema": "codex", "managed_name": managed,
            "created": True, "owned": True, "normalized_value_sha256": value}
with open(ledger_path, "w", encoding="utf-8") as handle:
    json.dump(ledger, handle, indent=2)
PY

    if HOME="$uninstall_home" XDG_CONFIG_HOME="$uninstall_xdg" \
        FORGEWRIGHT_TEST_SIGKILL_DURING_TRASH_CLEANUP=1 \
        bash "$fresh_script" --uninstall ; then
        fail "Runtime uninstall cleanup SIGKILL unexpectedly succeeded"
    elif [[ ! -e "$uninstall_home/.forgewright/mcp-server" ]] && \
        find "$uninstall_home/.forgewright/.mcp-trash" -name owner.json -print -quit | grep -q .; then
        pass "Runtime uninstall quarantines ownership before interruptible recursive cleanup"
    else
        fail "Interrupted runtime uninstall lost durable trash ownership"
    fi

    if HOME="$uninstall_home" XDG_CONFIG_HOME="$uninstall_xdg" \
        bash "$fresh_script" --uninstall  && \
        node - "$uninstall_home" "$opencode_root" "$zed_config" "$desktop_config" \
            "$JSONC_PARSER_MODULE" <<'NODE' &&
const fs = require('fs');
const [home, opencodeRoot, zedPath, desktopPath, parserModule] = process.argv.slice(2);
for (const path of [`${home}/.cursor/mcp.json`, `${home}/.claude.json`,
                    `${home}/.gemini/settings.json`, `${home}/.gemini/config/mcp_config.json`,
                    `${opencodeRoot}/config.json`]) {
  const config = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (config.keep !== 'unchanged' || config.mcpServers.other.command !== 'keep' ||
      config.mcpServers.forgewright || config.mcpServers.gitnexus) process.exit(1);
}
const zed = JSON.parse(fs.readFileSync(zedPath, 'utf8'));
if (zed.keep !== 'zed' || zed.context_servers.other.command !== 'keep' ||
    zed.context_servers.forgewright || zed.context_servers.gitnexus) process.exit(1);
const parseJsonc = (path) => {
  const errors = [];
  const value = require(parserModule).parse(fs.readFileSync(path, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length) process.exit(1);
  return value;
};
const desktop = parseJsonc(desktopPath);
if (desktop.desktopKeep !== true || desktop.mcpServers.other.command !== 'keep' ||
    desktop.mcpServers.forgewright || desktop.mcpServers.gitnexus) process.exit(1);
const opencode = parseJsonc(`${opencodeRoot}/opencode.jsonc`);
if (opencode.keep !== 'opencode' || opencode.mcp.other.type !== 'remote' ||
    opencode.mcp.forgewright || opencode.mcp.gitnexus) process.exit(1);
NODE
        python3 - "$uninstall_home/.codex/config.toml" "$opencode_root/config.toml" <<'PY'
import sys
import tomllib
codex_path, legacy_path = sys.argv[1:]
with open(codex_path, "rb") as handle:
    codex = tomllib.load(handle)
with open(legacy_path, "rb") as handle:
    legacy = tomllib.load(handle)
if (codex.get("mcp_servers") or codex["unrelated"]["value"] != 7 or
        "inside-multiline-string" not in codex["unrelated"]["description"] or
        codex["unrelated"]["nested"][1] != ["keep", "array"]):
    raise SystemExit(1)
if legacy.get("mcp_servers") or legacy["legacy_unrelated"]["value"] != 9:
    raise SystemExit(1)
PY
    then
        if grep -Fq '# Preserve Codex unrelated comment.' "$uninstall_home/.codex/config.toml" && \
            grep -Fq '# Preserve legacy unrelated comment.' "$opencode_root/config.toml" && \
            grep -Fq 'Preserve Claude Desktop JSONC state.' "$desktop_config" && \
            grep -Fq 'Preserve OpenCode JSONC state.' "$opencode_root/opencode.jsonc" && \
            cmp -s "$TEST_PROJECT/uninstall-opencode-json-before.json" "$opencode_root/opencode.json" && \
            ! grep -Fq 'must-not-be-reparented' "$uninstall_home/.codex/config.toml" && \
            ! grep -Fq 'must-not-be-reparented' "$opencode_root/config.toml" && \
            [[ ! -e "${TEST_PROJECT}/.antigravity/mcp-manifest.json" ]] && \
            [[ ! -e "$uninstall_home/.forgewright/mcp-server" ]] && \
            [[ ! -d "$fresh_root/mcp/node_modules" ]]; then
            pass "Fresh-checkout uninstall handles JSONC/TOML and removes canonical runtime safely"
        else
            fail "Uninstall dropped unrelated comments or reparented managed TOML bodies"
        fi
    else
        fail "Uninstall current/legacy contract cleanup failed"
    fi

    mkdir -p "$uninstall_home/.forgewright/mcp-server/from-home"
    printf 'remove-from-home\n' > "$uninstall_home/.forgewright/mcp-server/from-home/sentinel"
    mark_owned_test_runtime "$uninstall_home"
    if (cd "$uninstall_home" && HOME="$uninstall_home" XDG_CONFIG_HOME="$uninstall_xdg" \
        bash "$fresh_script" --uninstall ) && \
        [[ ! -e "$uninstall_home/.forgewright/mcp-server" ]]; then
        pass "Canonical runtime uninstall is independent of the caller working directory"
    else
        fail "Canonical runtime uninstall depended on project cwd"
    fi

    printf '{"mcpServers":{' > "$uninstall_home/.cursor/mcp.json"
    cp "$uninstall_home/.cursor/mcp.json" "$TEST_PROJECT/malformed-uninstall-before.json"
    mkdir -p "$uninstall_home/.forgewright/mcp-server"
    printf 'runtime-must-stay\n' > "$uninstall_home/.forgewright/mcp-server/runtime-sentinel"
    mark_owned_test_runtime "$uninstall_home"
    local output
    if output="$(HOME="$uninstall_home" XDG_CONFIG_HOME="$uninstall_xdg" \
        bash "$fresh_script" --uninstall 2>&1)"; then
        fail "Malformed uninstall config unexpectedly succeeded"
    elif grep -Fq "Uninstall complete" <<< "$output"; then
        fail "Incomplete uninstall falsely reported completion"
    elif cmp -s "$TEST_PROJECT/malformed-uninstall-before.json" "$uninstall_home/.cursor/mcp.json" && \
        [[ "$(cat "$uninstall_home/.forgewright/mcp-server/runtime-sentinel")" == "runtime-must-stay" ]] && \
        [[ -f "$uninstall_home/.forgewright/.mcp-server-installation.json" ]]; then
        pass "Uninstall preflight failure preserves malformed config and marked runtime byte-identically"
    else
        fail "Failed uninstall overwrote malformed JSON"
    fi

    local race_home="$TEST_PROJECT/race-home"
    mkdir -p "$race_home/.cursor" "$race_home/.forgewright/mcp-server"
    printf '%s\n' "$generic_fixture" > "$race_home/.cursor/mcp.json"
    printf 'runtime-must-survive-conflict\n' > "$race_home/.forgewright/mcp-server/sentinel"
    mark_owned_test_runtime "$race_home"
    if HOME="$race_home" XDG_CONFIG_HOME="$TEST_PROJECT/race-xdg" \
        FORGEWRIGHT_TEST_EXTERNAL_WRITE_AT=uninstall-jsonc \
        FORGEWRIGHT_TEST_EXTERNAL_WRITE_CONTENT='{"external":"wins"}' \
        bash "$fresh_script" --uninstall ; then
        fail "Uninstall overwrote a non-cooperative client writer"
    elif [[ "$(cat "$race_home/.cursor/mcp.json")" == '{"external":"wins"}' ]] && \
        [[ "$(cat "$race_home/.forgewright/mcp-server/sentinel")" == "runtime-must-survive-conflict" ]] && \
        [[ -f "$race_home/.forgewright/.mcp-server-installation.json" ]]; then
        pass "Uninstall conflict preserves external client bytes and restores the marked runtime"
    else
        fail "Uninstall optimistic conflict left config/runtime state inconsistent"
    fi

    local foreign_home="$TEST_PROJECT/foreign-home"
    mkdir -p "$foreign_home/.forgewright/mcp-server" "$foreign_home/.cursor"
    printf 'foreign-runtime\n' > "$foreign_home/.forgewright/mcp-server/sentinel"
    printf '%s\n' "$generic_fixture" > "$foreign_home/.cursor/mcp.json"
    cp "$foreign_home/.cursor/mcp.json" "$TEST_PROJECT/foreign-config-before.json"
    if HOME="$foreign_home" XDG_CONFIG_HOME="$uninstall_xdg" \
        bash "$fresh_script" --uninstall ; then
        fail "Unmarked foreign runtime was accepted for recursive removal"
    elif [[ "$(cat "$foreign_home/.forgewright/mcp-server/sentinel")" == "foreign-runtime" ]] && \
        cmp -s "$TEST_PROJECT/foreign-config-before.json" "$foreign_home/.cursor/mcp.json"; then
        pass "Unmarked foreign runtime and client config are preserved fail-closed"
    else
        fail "Foreign runtime ownership failure modified unrelated state"
    fi
    cleanup
}

test_round7_safety_boundaries() {
    echo ""
    echo -e "${CYAN}━━━ Round 7 Safety Boundaries ━━━${NC}"
    setup_test_project
    local safety_home="$TEST_PROJECT/safety-home" external="$TEST_PROJECT/external"
    local project="$TEST_PROJECT/project" json_parent="$TEST_PROJECT/json-parent"
    mkdir -p "$safety_home" "$external" "$project" "$json_parent"

    printf 'external-project-state\n' > "$external/project-sentinel"
    ln -s "$external" "$project/.antigravity"
    if HOME="$safety_home" bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        CANONICAL_LOCK_TOKEN="$(new_owner_token)"
        initialize_runtime_transaction
        publish_manifest
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$project" "$FORGEWRIGHT_DIR" ; then
        fail "Symlinked project .antigravity parent accepted a manifest write"
    elif [[ "$(cat "$external/project-sentinel")" == "external-project-state" ]] && \
        [[ ! -e "$external/mcp-manifest.json" ]]; then
        pass "Symlinked project .antigravity parent cannot redirect sensitive writes"
    else
        fail "Rejected project parent symlink modified its external target"
    fi

    printf 'external-client-state\n' > "$external/client-sentinel"
    ln -s "$external" "$json_parent/config"
    if HOME="$safety_home" bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        write_json_mcp_config "$4" cursor
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$project" "$FORGEWRIGHT_DIR" \
        "$json_parent/config/mcp.json" ; then
        fail "Symlinked client config parent accepted a write"
    elif [[ "$(cat "$external/client-sentinel")" == "external-client-state" ]] && \
        [[ ! -e "$external/mcp.json" ]]; then
        pass "Symlinked client config parent cannot redirect sensitive writes"
    else
        fail "Rejected client parent symlink modified its external target"
    fi

    mkdir -p "$safety_home/.cursor" "$safety_home/.codex"
    printf '{"keep":"original","mcpServers":{}}\n' > "$safety_home/.cursor/mcp.json"
    if HOME="$safety_home" FORGEWRIGHT_TEST_EXTERNAL_WRITE_AT=json-config \
        FORGEWRIGHT_TEST_EXTERNAL_WRITE_CONTENT='{"external":true}' bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        write_json_mcp_config "$4" cursor
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$project" "$FORGEWRIGHT_DIR" \
        "$safety_home/.cursor/mcp.json" ; then
        fail "JSON writer overwrote a non-cooperative external update"
    elif [[ "$(cat "$safety_home/.cursor/mcp.json")" == '{"external":true}' ]]; then
        pass "JSON optimistic replace aborts without overwriting an external writer"
    else
        fail "JSON optimistic conflict did not preserve the external bytes"
    fi

    printf '[unrelated]\nvalue = "original"\n' > "$safety_home/.codex/config.toml"
    if HOME="$safety_home" FORGEWRIGHT_TEST_EXTERNAL_WRITE_AT=toml-config \
        FORGEWRIGHT_TEST_EXTERNAL_WRITE_CONTENT=$'[external]\nvalue = "wins"\n' bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        write_toml_mcp_config "$4"
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$project" "$FORGEWRIGHT_DIR" \
        "$safety_home/.codex/config.toml" ; then
        fail "TOML writer overwrote a non-cooperative external update"
    elif grep -Fq '[external]' "$safety_home/.codex/config.toml" && \
        ! grep -Fq 'mcp_servers.forgewright' "$safety_home/.codex/config.toml"; then
        pass "TOML optimistic replace aborts without overwriting an external writer"
    else
        fail "TOML optimistic conflict did not preserve the external bytes"
    fi

    if bash -c '
        source "$1"
        node_version_is_supported v22.0.0
        node_version_is_supported v22.0.1
        node_version_is_supported v24.0.0
        ! node_version_is_supported v21.99.99
        ! node_version_is_supported v22.0
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" && bash -c '
        source "$1"
        node_version_is_supported v22.0.0
        ! node_version_is_supported v21.99.99
        ! node_version_is_supported invalid
    ' _ "$FORGEWRIGHT_DIR/scripts/bootstrap/forgewright-setup.sh"; then
        pass "Canonical and bootstrap Node preflights enforce exact >=22.0.0 semantics"
    else
        fail "Node minimum-version comparison is inconsistent"
    fi
    cleanup
}

test_gitnexus() {
    [[ "$FAST" == "1" ]] && { skip "GitNexus test (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ GitNexus ━━━${NC}"

    cd "$PROJECT_ROOT"
    info "Testing gitnexus binary"
    if which gitnexus > /dev/null 2>&1; then
        pass "gitnexus is installed"
    else
        skip "gitnexus is not installed locally"
    fi
}

test_docs() {
    echo ""
    echo -e "${CYAN}━━━ Documentation ━━━${NC}"

    [[ -f "${FORGEWRIGHT_DIR}/docs/SETUP.md" ]] && pass "SETUP.md exists" || fail "SETUP.md missing"
    [[ -f "${FORGEWRIGHT_DIR}/docs/SETUP-QUICK.md" ]] && pass "SETUP-QUICK.md exists" || fail "SETUP-QUICK.md missing"
    [[ -f "${FORGEWRIGHT_DIR}/docs/SETUP-REFERENCE.md" ]] && pass "SETUP-REFERENCE.md exists" || fail "SETUP-REFERENCE.md missing"

    info "Checking SETUP.md uses correct script name"
    grep -q "forgewright-mcp-setup.sh" "${FORGEWRIGHT_DIR}/docs/SETUP.md" && pass "SETUP.md: forgewright-mcp-setup.sh" || fail "SETUP.md: wrong script name"

    info "Checking SETUP-QUICK.md uses correct script name"
    grep -q "forgewright-mcp-setup.sh" "${FORGEWRIGHT_DIR}/docs/SETUP-QUICK.md" && pass "SETUP-QUICK.md: forgewright-mcp-setup.sh" || fail "SETUP-QUICK.md: wrong script name"
}

test_templates() {
    echo ""
    echo -e "${CYAN}━━━ Config Templates ━━━${NC}"

    [[ -f "${TEMPLATE_DIR}/mcp.cursor.json" ]] && pass "mcp.cursor.json exists" || fail "mcp.cursor.json missing"
    [[ -f "${TEMPLATE_DIR}/mcp.claude.json" ]] && pass "mcp.claude.json exists" || fail "mcp.claude.json missing"
    [[ -f "${TEMPLATE_DIR}/mcp.antigravity.json" ]] && pass "mcp.antigravity.json exists" || fail "mcp.antigravity.json missing"

    info "Checking templates use correct script name"
    grep -q "forgewright-mcp-setup.sh" "${TEMPLATE_DIR}/mcp.cursor.json" && pass "mcp.cursor.json: correct script name" || fail "mcp.cursor.json: wrong script name"
}

# ─── Main ─────────────────────────────────────────────────────
test_round8_fixes() {
    [[ "$FAST" == "1" ]] && { skip "Round 8 fixes (--fast mode)"; return; }

    echo ""
    echo -e "${CYAN}━━━ Round 8 Fixes ━━━${NC}"
    setup_test_project

    # 1. P1 sourceable settings serialization
    local settings_env="${TEST_PROJECT}/.forgewright/settings.env"
    HOME="$TEST_PROJECT" bash -c '
        source "$1"
        PROJECT_ROOT="$2"
        FORGEWRIGHT_DIR="$3"
        CANONICAL_LOCK_TOKEN="$(new_owner_token)"
        initialize_runtime_transaction
        write_forgewright_settings
    ' _ "${SCRIPT_DIR}/forgewright-mcp-setup.sh" "$TEST_PROJECT" 'a;$(echo bad)>sentinel'  || true
    if [[ ! -f "$settings_env" ]]; then
        fail "Settings env was not created"
    else
        bash -c "source '$settings_env'"  || fail "Sourced settings.env failed"
        if [[ -f sentinel ]] || [[ -f side_effect ]]; then
            fail "Settings env had side effects"
        fi
        local filter_val
        filter_val="$(bash -c "source '$settings_env'; echo \"\$FORGEWRIGHT_SHELL_FILTER_PATH\"")"
        if [[ "$filter_val" != 'a;$(echo bad)>sentinel/scripts/forgewright-shell-filter.sh' ]]; then
            fail "Settings env value round trip failed: $filter_val"
        fi
        pass "Settings serialization is shell-safe and round-trips correctly"
    fi

    # 2. Successful install foreign runtime preservation
    local foreign_server="$HOME/.forgewright/mcp-server"
    if [[ "$foreign_server" != "$TEST_HOME"* ]]; then
        fail "foreign_server does not resolve under TEST_HOME"
    fi
    if [[ "$foreign_server" == "$OPERATOR_HOME"* ]]; then
        fail "foreign_server prefixes OPERATOR_HOME"
    fi
    mkdir -p "$foreign_server/src" "$foreign_server/node_modules/.bin"
    touch "$foreign_server/src/index.ts" "$foreign_server/package-lock.json" "$foreign_server/node_modules/.bin/tsx"
    echo "foreign content" > "$foreign_server/src/index.ts"
    if bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" >/dev/null 2>&1; then
        fail "Setup succeeded on unmarked foreign runtime"
    else
        if [[ "$(cat "$foreign_server/src/index.ts")" != "foreign content" ]]; then
            fail "Setup mutated unmarked foreign runtime"
        else
            pass "Foreign runtime preservation works (failed closed)"
        fi
    fi
    rm -r "$foreign_server"

    # 3. Reject symlinked node_modules
    mkdir -p "$foreign_server/src" "$foreign_server/real_node_modules/.bin"
    ln -s real_node_modules "$foreign_server/node_modules"
    touch "$foreign_server/src/index.ts" "$foreign_server/package-lock.json" "$foreign_server/real_node_modules/.bin/tsx"
    local marker_file="$foreign_server/.forgewright-installation-owner.json"
    local sha256
    sha256=$(shasum -a 256 "$foreign_server/package-lock.json" | awk '{print $1}')
    cat > "$marker_file" <<EOF
{"kind": "forgewright-mcp-runtime", "version": 1, "token": "12345-00000000000000000000000000000000", "path": "$foreign_server", "lockfile_sha256": "$sha256"}
EOF
    if bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" >/dev/null 2>&1; then
        fail "Setup succeeded with symlinked node_modules"
    else
        pass "Setup rejected symlinked node_modules"
    fi
    rm -r "$foreign_server"

    # 4. TOML lexical scanner multiline edge coverage
    local toml_target="${TEST_PROJECT}/config.toml"
    cat > "$toml_target" <<'EOF'
# Unrelated comment
[mcp_servers.forgewright]
command = "stale"

[unrelated]
multiline = """
escaped triple \""" quote
escaped quote \"
backslashes \\
"""
literal_multiline = '''
triple ''\' doesn't escape but is parsed correctly
'''
nested = [{a = 1}, {b = """
multi
"""}]
EOF
    local toml_tmp="${TEST_PROJECT}/config_tmp.toml"
    source "$SCRIPT_DIR/forgewright-mcp-setup.sh"  || true
    export FORGEWRIGHT_RUNTIME_TOKEN="12345-0123456789abcdef0123456789abcdef"
    export FORGEWRIGHT_LEDGER_PATH="${TEST_PROJECT}/toml-ledger.json"
    export FORGEWRIGHT_LEDGER_TMP="${TEST_PROJECT}/toml-ledger.tmp.json"
    python3 - "$toml_target" "$FORGEWRIGHT_LEDGER_PATH" "$FORGEWRIGHT_RUNTIME_TOKEN" <<'PY'
import hashlib, json, os, sys, tomllib
target, ledger_path, token = sys.argv[1:]
target = os.path.realpath(target)
with open(target, "rb") as handle:
    entry = tomllib.load(handle)["mcp_servers"]["forgewright"]
key = hashlib.sha256(f"{target}:codex:forgewright".encode()).hexdigest()
fingerprint = hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest()
record = {"canonical_path": target, "schema": "codex", "managed_name": "forgewright",
          "created": True, "owned": True, "normalized_value_sha256": fingerprint}
with open(ledger_path, "w", encoding="utf-8") as handle:
    json.dump({"kind": "forgewright-mcp-ledger", "version": 1, "runtime_token": token,
               "records": {key: record}}, handle)
PY
    if prepare_toml_mcp_removal "$toml_target" "$toml_tmp" ; then
        local toml_ok="true"
        if grep -q "mcp_servers.forgewright" "$toml_tmp"; then
            fail "TOML removal didn't remove forgewright"
            toml_ok="false"
        fi
        if ! grep -q 'escaped triple \\""" quote' "$toml_tmp"; then
            fail "TOML removal damaged multiline basic string"
            toml_ok="false"
        fi
        [[ "$toml_ok" != "true" ]] || pass "TOML lexical scanner correctly processed multiline edges"
    else
        fail "TOML lexical scanner failed on multiline edge coverage"
    fi
}

test_snapshot_toctou_race() {
    [[ $VERBOSE -eq 1 ]] && echo -e "\n${BLUE}▶ Testing Snapshot TOCTOU Race${NC}"
    setup_test_project

    # 1. Setup initial state
    mkdir -p "$TEST_HOME/.cursor"
    local config_file="$TEST_HOME/.cursor/mcp.json"
    printf '{"mcpServers":{"gitnexus":{"command":"gitnexus","args":["mcp"]}}}\n' > "$config_file"

    # 2. Inject race condition during snapshot
    # The setup script will attempt to add "forgewright" to the config.
    # While it is snapshotting, we will replace the file as a noncooperative writer.
    export FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_PATH="$TEST_PROJECT/race-content"
    export FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_TARGET="$config_file"
    printf '{"mcpServers":{"hacker":{}}}' > "$FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_PATH"

    if bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --cursor >/dev/null 2>&1; then
        fail "Setup should have failed due to snapshot TOCTOU detection"
    else
        pass "Setup rejected transaction with noncooperative writer"
    fi

    if grep -Fq '"hacker"' "$config_file" && ! grep -Fq '"forgewright"' "$config_file"; then
        pass "Noncooperative write survived, stale backup was not restored"
    else
        fail "Noncooperative write was overwritten by stale backup or unexpected state!"
    fi

    unset FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_PATH
    unset FORGEWRIGHT_TEST_INJECT_SNAPSHOT_RACE_TARGET
}


test_ledger() {
    [[ $VERBOSE -eq 1 ]] && echo -e "
${BLUE}▶ Testing Durable Client-Config Ownership Ledger${NC}"
    setup_test_project
    seed_canonical_dependencies

    local ledger_path="$TEST_HOME/.forgewright/.mcp-config-ledger.json"
    local cursor_config="$TEST_HOME/.cursor/mcp.json"
    local gemini_config="$TEST_HOME/.gemini/mcp-server-enablement.json"

    # Falsey foreign values are still present entries and must never be claimed.
    mkdir -p "$(dirname "$cursor_config")"
    printf '{"mcpServers":{"forgewright":null,"unrelated":false}}\n' > "$cursor_config"
    cp "$cursor_config" "$TEST_PROJECT/falsey-cursor-before.json"
    if bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --cursor >/dev/null 2>&1; then
        fail "Setup claimed a falsey foreign managed entry"
        return
    elif ! cmp -s "$cursor_config" "$TEST_PROJECT/falsey-cursor-before.json"; then
        fail "Setup mutated a falsey foreign managed entry"
        return
    fi
    rm -f "$cursor_config"

    # An exact pre-existing Codex entry is usable, but remains foreign-owned.
    local codex_config="$TEST_HOME/.codex/config.toml"
    local canonical_tsx="$TEST_HOME/.forgewright/mcp-server/node_modules/.bin/tsx"
    local canonical_server="$TEST_HOME/.forgewright/mcp-server/src/index.ts"
    local gitnexus_path
    gitnexus_path="$(command -v gitnexus)"
    mkdir -p "$(dirname "$codex_config")"
    cat > "$codex_config" <<EOF
[mcp_servers.forgewright]
enabled = true
transport = { type = "stdio" }
command = "$canonical_tsx"
args = ["$canonical_server"]

[mcp_servers.gitnexus]
enabled = true
transport = { type = "stdio" }
command = "$gitnexus_path"
args = ["mcp"]
EOF
    cp "$codex_config" "$TEST_PROJECT/unowned-codex-before.toml"
    if ! bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --codex >/dev/null 2>&1; then
        fail "Setup rejected exact foreign Codex entries"
        return
    elif ! cmp -s "$codex_config" "$TEST_PROJECT/unowned-codex-before.toml"; then
        fail "Setup rewrote exact foreign Codex entries"
        return
    elif python3 - "$ledger_path" "$codex_config" <<'PY'
import json, os, sys
ledger_path, config = sys.argv[1:]
if not os.path.exists(ledger_path):
    raise SystemExit(1)
with open(ledger_path, encoding="utf-8") as handle:
    records = json.load(handle)["records"].values()
raise SystemExit(0 if any(record["canonical_path"] == os.path.realpath(config) for record in records) else 1)
PY
    then
        fail "Setup claimed exact foreign Codex entries"
        return
    fi
    rm -rf "$TEST_HOME/.forgewright" "$TEST_HOME/.codex"

    # Install initial config
    bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --cursor --gemini >/dev/null 2>&1 || fail "Initial setup failed"

    # Verify the strict, deterministic ownership ledger contract.
    if [[ ! -f "$ledger_path" ]]; then
        fail "Ledger was not created"
        return
    fi
    if ! python3 - "$ledger_path" <<'PY'
import hashlib
import json
import os
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    ledger = json.load(handle)
assert set(ledger) == {"kind", "version", "runtime_token", "records"}
assert ledger["kind"] == "forgewright-mcp-ledger"
assert ledger["version"] == 1
assert re.fullmatch(r"[0-9]+-[0-9a-f]{32}", ledger["runtime_token"])
assert isinstance(ledger["records"], dict) and ledger["records"]
required = {
    "canonical_path", "schema", "managed_name", "created", "owned",
    "normalized_value_sha256",
}
for key, record in ledger["records"].items():
    assert re.fullmatch(r"[0-9a-f]{64}", key)
    assert set(record) == required
    assert os.path.isabs(record["canonical_path"])
    assert record["managed_name"] in {"forgewright", "gitnexus"}
    assert isinstance(record["created"], bool)
    assert record["owned"] is True
    assert re.fullmatch(r"[0-9a-f]{64}", record["normalized_value_sha256"])
    identity = f'{record["canonical_path"]}:{record["schema"]}:{record["managed_name"]}'
    assert hashlib.sha256(identity.encode()).hexdigest() == key
PY
    then
        fail "Ledger violates the strict schema or deterministic key contract"
        return
    fi

    # A valid but unresolved ownership record must block runtime removal and roll back.
    cp "$ledger_path" "$TEST_PROJECT/ledger-before-stale-record.json"
    cp "$cursor_config" "$TEST_PROJECT/cursor-before-stale-record.json"
    local runtime_before
    runtime_before="$(tree_digest "$TEST_HOME/.forgewright/mcp-server")"
    python3 - "$ledger_path" "$TEST_HOME/.cursor/missing-owned.json" <<'PY'
import hashlib, json, os, sys
ledger_path, target = sys.argv[1:]
target = os.path.realpath(target)
with open(ledger_path, encoding="utf-8") as handle:
    ledger = json.load(handle)
managed = "forgewright"
schema = "cursor"
key = hashlib.sha256(f"{target}:{schema}:{managed}".encode()).hexdigest()
ledger["records"][key] = {
    "canonical_path": target, "schema": schema, "managed_name": managed,
    "created": True, "owned": True, "normalized_value_sha256": "0" * 64,
}
with open(ledger_path, "w", encoding="utf-8") as handle:
    json.dump(ledger, handle)
PY
    cp "$ledger_path" "$TEST_PROJECT/ledger-with-stale-record.json"
    if bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --uninstall >/dev/null 2>&1; then
        fail "Uninstall removed runtime while ownership ledger still had records"
        return
    elif [[ ! -d "$TEST_HOME/.forgewright/mcp-server" ]] || \
        ! cmp -s "$cursor_config" "$TEST_PROJECT/cursor-before-stale-record.json" || \
        ! cmp -s "$ledger_path" "$TEST_PROJECT/ledger-with-stale-record.json" || \
        [[ "$runtime_before" != "$(tree_digest "$TEST_HOME/.forgewright/mcp-server")" ]]; then
        fail "Blocked uninstall did not roll runtime, config, and ledger back"
        return
    fi
    cp "$TEST_PROJECT/ledger-before-stale-record.json" "$ledger_path"

    # Presence and candidate bytes must come from the journaled snapshot, not a live re-read.
    if FORGEWRIGHT_TEST_UNLINK_LEDGER_AFTER_SNAPSHOT=1 \
        bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --uninstall >/dev/null 2>&1; then
        fail "Ledger unlink after snapshot bypassed required removal CAS"
        return
    elif [[ ! -d "$TEST_HOME/.forgewright/mcp-server" ]] || \
        ! cmp -s "$cursor_config" "$TEST_PROJECT/cursor-before-stale-record.json" || \
        [[ -e "$ledger_path" ]]; then
        fail "Post-snapshot ledger unlink did not preserve runtime, config, and external absence"
        return
    fi
    cp "$TEST_PROJECT/ledger-before-stale-record.json" "$ledger_path"

    # An external unlink after candidate publication must not bypass the empty-ledger gate.
    if FORGEWRIGHT_TEST_UNLINK_LEDGER_AFTER_CANDIDATES=1 \
        bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --uninstall >/dev/null 2>&1; then
        fail "External ledger unlink bypassed required removal CAS"
        return
    elif [[ ! -d "$TEST_HOME/.forgewright/mcp-server" ]] || \
        ! cmp -s "$cursor_config" "$TEST_PROJECT/cursor-before-stale-record.json" || \
        [[ -e "$ledger_path" ]]; then
        fail "Ledger unlink conflict did not preserve runtime, config, and external absence"
        return
    fi
    cp "$TEST_PROJECT/ledger-before-stale-record.json" "$ledger_path"

    # Test that uninstall removes owned entries
    bash "$SCRIPT_DIR/forgewright-mcp-setup.sh" --uninstall >/dev/null 2>&1 || fail "Uninstall failed"
    if grep -Fq "forgewright" "$cursor_config" 2>/dev/null; then
        fail "Uninstall did not remove forgewright from cursor config"
        return
    fi
    if [[ -f "$ledger_path" ]]; then
        fail "Uninstall did not remove ledger or its entries correctly"
    fi

    pass "Ledger implementation works correctly"
}

main() {
    if [[ -z "$TEST_HOME" ]] || [[ "$TEST_HOME" == "$OPERATOR_HOME" ]]; then
        echo -e "${RED}CRITICAL: Test harness failed to isolate HOME. TEST_HOME ($TEST_HOME) matches OPERATOR_HOME ($OPERATOR_HOME).${NC}"
        exit 1
    fi
    local operator_state
    operator_state="$(python3 - "$OPERATOR_HOME/.forgewright/mcp-server" "$OPERATOR_HOME/.cursor/mcp.json" <<'PY'
import os, hashlib, sys, json
def snapshot(path):
    if not os.path.lexists(path): return "missing"
    if os.path.islink(path): return "symlink"
    if os.path.isdir(path):
        h = hashlib.sha256()
        for root, dirs, files in os.walk(path):
            dirs.sort()
            for f in sorted(files):
                p = os.path.join(root, f)
                if not os.path.islink(p) and os.path.isfile(p):
                    h.update(f.encode())
                    try:
                        with open(p, "rb") as fh: h.update(fh.read())
                    except: pass
        return "dir:" + h.hexdigest()
    if os.path.isfile(path):
        try:
            with open(path, "rb") as fh: return "file:" + hashlib.sha256(fh.read()).hexdigest()
        except: pass
    return "unknown"
print(json.dumps({"mcp": snapshot(sys.argv[1]), "cursor": snapshot(sys.argv[2])}))
PY
)"

    # Parse args
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --fast|-f) FAST=1 ;;
            --verbose|-v) VERBOSE=1 ;;
            --help|-h)
                echo "Usage: test-forgewright-mcp-setup.sh [--fast] [--verbose]"
                exit 0
                ;;
        esac
        shift
    done

    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  ForgeWright MCP Setup Test Suite              ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"

    echo ""
    echo -e "${CYAN}━━━ Syntax Checks ━━━${NC}"
    if bash -n "$SCRIPT_DIR/forgewright-mcp-setup.sh"; then
        pass "bash -n forgewright-mcp-setup.sh"
    else
        fail "bash -n forgewright-mcp-setup.sh failed"
        exit 1
    fi

    test_help
    test_check
    test_diagnose
    test_setup
    test_settings_and_durability_transactions
    test_gemini_isolated
    test_all_isolated
    test_uninstall_contracts
    test_round7_safety_boundaries
    test_gitnexus
    test_docs
    test_templates
    test_round8_fixes
    test_snapshot_toctou_race
    test_ledger

    cleanup > /dev/null 2>&1

    local current_state
    current_state="$(python3 - "$OPERATOR_HOME/.forgewright/mcp-server" "$OPERATOR_HOME/.cursor/mcp.json" <<'PY'
import os, hashlib, sys, json
def snapshot(path):
    if not os.path.lexists(path): return "missing"
    if os.path.islink(path): return "symlink"
    if os.path.isdir(path):
        h = hashlib.sha256()
        for root, dirs, files in os.walk(path):
            dirs.sort()
            for f in sorted(files):
                p = os.path.join(root, f)
                if not os.path.islink(p) and os.path.isfile(p):
                    h.update(f.encode())
                    try:
                        with open(p, "rb") as fh: h.update(fh.read())
                    except: pass
        return "dir:" + h.hexdigest()
    if os.path.isfile(path):
        try:
            with open(path, "rb") as fh: return "file:" + hashlib.sha256(fh.read()).hexdigest()
        except: pass
    return "unknown"
print(json.dumps({"mcp": snapshot(sys.argv[1]), "cursor": snapshot(sys.argv[2])}))
PY
)"
    if [[ "$operator_state" != "$current_state" ]]; then
        echo -e "${RED}CRITICAL: Real OPERATOR_HOME was mutated! Isolation failed.${NC}"
        echo "Before: $operator_state"
        echo "After: $current_state"
        exit 1
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${GREEN}Passed:  ${TESTS_PASSED}${NC}"
    echo -e "  ${RED}Failed:  ${TESTS_FAILED}${NC}"
    echo -e "  ${YELLOW}Skipped: ${TESTS_SKIPPED}${NC}"
    echo ""

    [[ $TESTS_FAILED -eq 0 ]] && echo -e "  ${GREEN}✓ All tests passed!${NC}" || echo -e "  ${RED}✗ Some tests failed${NC}"
    echo ""

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
