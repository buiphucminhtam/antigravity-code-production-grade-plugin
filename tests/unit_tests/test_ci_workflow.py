from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def test_ci_workflow_is_pinned_and_runs_required_gates():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in text
    assert "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020" in text
    assert "actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065" in text
    assert 'node-version: "20.20.2"' in text
    assert 'python-version: "3.12.11"' in text
    assert "python -m pip install -r requirements-ci.txt" in text
    assert "bash scripts/ci/run-required-checks.sh" in text
    assert (
        "bash scripts/testing/test-runner.sh --all --contract-only --no-color" in text
    )
    assert "bash scripts/lite/test-kernel-tokens.sh" in text
    assert "python scripts/lite/validate-overlays.py" in text
