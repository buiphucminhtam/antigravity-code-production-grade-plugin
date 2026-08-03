import importlib.util
import subprocess
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
EXECUTOR_PATH = ROOT / "skills" / "_test" / "skill-test-executor.py"
RUNNER_PATH = ROOT / "scripts" / "testing" / "test-runner.sh"


def load_executor():
    spec = importlib.util.spec_from_file_location("skill_test_executor", EXECUTOR_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_all_skill_contracts_are_valid():
    module = load_executor()
    for test_file in sorted((ROOT / "skills" / "_test" / "skills").glob("*/test.yaml")):
        document = yaml.safe_load(test_file.read_text(encoding="utf-8"))
        errors = module.validate_contract_document(
            test_file.parent.name, document, ROOT / "skills"
        )
        assert errors == [], f"{test_file}: {errors}"


def test_contract_validation_rejects_duplicate_ids_and_unknown_validators():
    module = load_executor()
    document = {
        "skill": "software-engineer",
        "version": "1.0.0",
        "tests": [
            {
                "id": "duplicate",
                "description": "first",
                "tags": ["basic"],
                "input": {},
                "expected": {"contains": ["ok"]},
                "validate": ["output_contains_all"],
                "timeout": "30s",
            },
            {
                "id": "duplicate",
                "description": "second",
                "tags": ["basic"],
                "input": {},
                "expected": {"contains": ["ok"]},
                "validate": ["invented_validator"],
                "timeout": "30s",
            },
        ],
    }
    errors = module.validate_contract_document(
        "software-engineer", document, ROOT / "skills"
    )
    assert any("duplicate test id" in error for error in errors)
    assert any("unknown validator" in error for error in errors)


def test_live_result_requires_attested_metrics():
    module = load_executor()
    test = {
        "expected": {
            "contains": ["Security report"],
            "min_findings": 2,
            "files_created": 1,
        }
    }
    errors = module.validate_live_result(
        {"output": "Security report", "metrics": {}}, test
    )
    assert "missing metric: findings" in errors
    assert "missing metric: files_created" in errors

    assert (
        module.validate_live_result(
            {
                "output": "Security report",
                "metrics": {"findings": 2, "files_created": 1},
            },
            test,
        )
        == []
    )

    errors = module.validate_live_result(
        {
            "output": "Security report",
            "metrics": {"severity_count": {"high": True}},
        },
        {"expected": {"severity_count": {"high": 1}}},
    )
    assert "metric severity_count.high True < 1" in errors


def test_cli_contract_mode_executes_without_mock_outputs():
    result = subprocess.run(
        [
            sys.executable,
            str(EXECUTOR_PATH),
            "--all",
            "--contract-only",
            "--no-color",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "Mode: contract-only" in result.stdout
    assert "Contract passed:" in result.stdout
    assert "mock output" not in result.stdout.lower()


def test_shell_runner_delegates_to_executor_without_skipping():
    result = subprocess.run(
        [
            "bash",
            str(RUNNER_PATH),
            "--all",
            "--contract-only",
            "--no-color",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "Contract passed:" in result.stdout
    assert "Test not yet implemented" not in result.stdout
    assert "[SKIP]" not in result.stdout


def test_require_live_fails_without_adapter():
    result = subprocess.run(
        [sys.executable, str(EXECUTOR_PATH), "--all", "--require-live", "--no-color"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 2
    assert "live adapter is required" in (result.stdout + result.stderr).lower()


def test_readme_documents_only_current_harness_contract():
    readme = (ROOT / "skills" / "_test" / "README.md").read_text(encoding="utf-8")
    assert "skill-test-executor.py" in readme
    assert "--report <path>" in readme
    assert "valid_syntax" not in readme
    assert "schema_valid" not in readme
    assert "test-reporter.sh" not in readme
