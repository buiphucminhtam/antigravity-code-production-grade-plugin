import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LOCAL_CI = ROOT / "scripts" / "ci" / "local-ci.py"
HOOK = ROOT / ".husky" / "pre-commit"
REQUIRED_CHECKS = ROOT / "scripts" / "ci" / "run-required-checks.sh"


def test_ci_is_local_first_and_host_provider_neutral():
    text = LOCAL_CI.read_text(encoding="utf-8")
    assert "run-required-checks.sh" in text
    assert "test-runner.sh" in text
    assert "validate-overlays.py" in text
    assert "test-kernel-tokens.sh" in text
    assert "NODE_MATRIX = (22, 24)" in text
    assert "detect-changes" in text
    assert "openapi-contract-check.py" in text
    assert "verify-wiki-drift.sh" in text
    assert "--workspaces=false" in text
    assert not (ROOT / ".github" / "workflows").exists()
    assert not (ROOT / ".github" / "actions").exists()
    assert not (ROOT / ".gitlab-ci.yml").exists()


def test_precommit_is_only_a_thin_local_ci_adapter():
    text = HOOK.read_text(encoding="utf-8")
    assert "scripts/ci/local-ci.mjs precommit" in text
    assert "github" not in text.lower()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["prepare"] == "git config core.hooksPath .husky"


def test_docs_continuity_is_in_docs_ci_and_required_release_checks():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    docs_ci = package["scripts"]["ci:docs"]
    assert "npm run build:cli" in docs_ci
    assert "docs gate . --worktree --json" in docs_ci
    assert "test_docs_project_state_schema.py" in docs_ci

    required = REQUIRED_CHECKS.read_text(encoding="utf-8")
    assert "run_required cli-build npm run build:cli" in required
    assert "run_required docs-continuity run_docs_continuity" in required
    assert "FORGEWRIGHT_DOCS_BASE_REF" in required
    assert "origin/main...HEAD" in required
    assert 'docs gate . --base-ref "$base_ref" --json' in required
    assert "docs gate . --worktree --json" in required
