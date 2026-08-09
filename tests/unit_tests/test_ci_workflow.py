import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LOCAL_CI = ROOT / "scripts" / "ci" / "local-ci.py"
HOOK = ROOT / ".husky" / "pre-commit"


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
