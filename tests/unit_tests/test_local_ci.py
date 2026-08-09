import importlib.util
import os
import sys
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ci" / "local-ci.py"


def _module():
    spec = importlib.util.spec_from_file_location("forgewright_local_ci", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_local_ci_exposes_provider_neutral_modes() -> None:
    module = _module()
    choices = next(
        action.choices for action in module.parser()._actions if action.dest == "mode"
    )
    assert {
        "bootstrap",
        "quick",
        "full",
        "security",
        "compat",
        "review",
        "reindex",
        "wiki",
        "deps",
        "precommit",
        "all",
    } <= set(choices)
    assert module.MIN_NODE_MAJOR == 22
    assert module.NODE_MATRIX == (22, 24)


def test_hosted_ci_is_not_a_canonical_runtime_dependency() -> None:
    assert not (ROOT / ".github" / "workflows").exists()
    assert not (ROOT / ".github" / "actions").exists()
    assert not (ROOT / ".github" / "dependabot.yml").exists()
    assert not (ROOT / ".gitlab-ci.yml").exists()


def test_local_ci_dry_run_can_plan_without_hosted_provider() -> None:
    text = MODULE_PATH.read_text(encoding="utf-8")
    assert "GITHUB_OUTPUT" not in text
    assert "GITHUB_TOKEN" not in text
    assert "gitlab-ci" not in text.lower()
    assert "forgewright-local-ci/v1" in text


def test_timeout_terminates_spawned_process_tree(tmp_path: Path) -> None:
    module = _module()
    runner = module.LocalCI(dry_run=False, keep_going=True, timeout=1, base_ref=None)
    marker = tmp_path / "child-survived"
    child = (
        "import time,pathlib; time.sleep(2); "
        f"pathlib.Path({str(marker)!r}).write_text('bad')"
    )
    parent = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
    )
    code = runner.run("timeout-tree", [sys.executable, "-c", parent], check=False)
    assert code == 124
    time.sleep(2.5)
    assert not marker.exists()


@pytest.mark.skipif(
    os.name == "nt",
    reason="PATH/shebang semantics are validated by Windows integration",
)
def test_effective_env_prepends_resolved_node_directory() -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    runner.primary_node = "/tmp/fake-node/bin/node"
    env = runner._effective_env()
    path_parts = env["PATH"].split(os.pathsep)
    assert path_parts[0] == str(Path(runner.python).resolve().parent)
    assert str(Path("/tmp/fake-node/bin").resolve()) in path_parts[:6]
