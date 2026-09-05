import importlib.util
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

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
    assert module.PRECOMMIT_PYTHON_UNIT_TIMEOUT_SECONDS == 1800


@pytest.mark.skipif(os.name != "nt", reason="Git Bash discovery is Windows-specific")
def test_local_ci_discovers_git_bash_outside_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _module()
    program_files = tmp_path / "Program Files"
    git_bash = program_files / "Git" / "bin" / "bash.exe"
    git_bash.parent.mkdir(parents=True)
    git_bash.write_bytes(b"fixture")

    monkeypatch.setenv("ProgramFiles", str(program_files))
    monkeypatch.delenv("ProgramW6432", raising=False)
    monkeypatch.delenv("ProgramFiles(x86)", raising=False)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.delenv("FORGEWRIGHT_BASH", raising=False)
    original_which = module._which
    monkeypatch.setattr(
        module,
        "_which",
        lambda name: None if name in {"bash", "git"} else original_which(name),
    )

    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    assert runner.bash == str(git_bash)


def test_windows_child_environment_exposes_resolved_git_bash_without_global_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    bash = tmp_path / "Git/bin/bash.exe"
    original_path = os.environ.get("PATH", "")
    # Simulate only this module's host choice; pathlib keeps the actual host semantics.
    monkeypatch.setattr(
        module, "os", SimpleNamespace(name="nt", environ=os.environ, pathsep=os.pathsep)
    )
    monkeypatch.setattr(module.LocalCI, "bash", property(lambda self: str(bash)))
    environment = runner._effective_env()
    assert str(bash.parent) in environment["PATH"].split(os.pathsep)
    assert os.environ.get("PATH", "") == original_path


def test_fixture_git_environment_isolated_without_changing_hook_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    for key in module.TEST_GIT_ENV:
        monkeypatch.setenv(key, "parent-commit-context")
    # The actual docs/staging gate must still see the selected commit index.
    assert runner._effective_env()["GIT_INDEX_FILE"] == "parent-commit-context"
    isolated = runner._effective_env(module.TEST_GIT_ENV)
    assert not (set(module.TEST_GIT_ENV) & isolated.keys())
    assert os.environ["GIT_INDEX_FILE"] == "parent-commit-context"
    assert (
        runner._effective_env({"FORGEWRIGHT_TEST": "yes"})["FORGEWRIGHT_TEST"] == "yes"
    )


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


def test_precommit_runs_mandatory_docs_continuity_gate() -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    runner._require_node_dependencies = lambda: None
    runner._require_python_dependencies = lambda *packages: None
    runner.review = lambda: None
    runner._format_staged = lambda: None
    runner.primary_node = "/tmp/fake-node/bin/node"
    runner._node_bin = lambda component, name: f"/{component}/{name}"
    runner._node_module_file = lambda component, relative: Path(
        f"/{component}/{relative}"
    )

    runner.precommit()

    steps = {result.name: result.argv for result in runner.results}
    assert steps["cli-build"][-2:] == ["run", "build:cli"]
    assert steps["docs-continuity"][-2:] == ["--staged", "--json"]
    assert "src/cli/dist/index.js" in steps["docs-continuity"]
    assert steps["python-unit-tests"][-3:] == [
        "-p",
        "no:cacheprovider",
        "tests/unit_tests/",
    ]
    assert "timeout=PRECOMMIT_PYTHON_UNIT_TIMEOUT_SECONDS" in MODULE_PATH.read_text(
        encoding="utf-8"
    )


def test_staged_formatters_use_their_component_configuration() -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    runner._staged_files = lambda: [
        ROOT / "mcp/src/index.ts",
        ROOT / "src/cli/src/index.ts",
    ]
    runner._node_bin = lambda component, name: f"/{component}/{name}"

    runner._format_staged()

    steps = {result.name: result for result in runner.results}
    assert Path(steps["mcp-eslint-staged"].cwd) == ROOT / "mcp"
    assert Path(steps["mcp-prettier-staged"].cwd) == ROOT / "mcp"
    assert Path(steps["cli-prettier-staged"].cwd) == ROOT / "src/cli"
    assert "--fix" in steps["mcp-eslint-staged"].argv
    assert "--write" in steps["mcp-prettier-staged"].argv


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
def test_effective_env_prepends_venv_python_and_resolved_node_directories() -> None:
    module = _module()
    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    runner.primary_node = "/tmp/fake-node/bin/node"
    env = runner._effective_env()
    path_parts = env["PATH"].split(os.pathsep)
    assert path_parts[0] == str(Path(runner.python).parent.absolute())
    assert path_parts[1] == str(Path("/tmp/fake-node/bin").resolve())


@pytest.mark.skipif(
    os.name == "nt",
    reason="PATH/shebang semantics are validated by Windows integration",
)
def test_effective_env_deduplicates_workspace_bins_in_deterministic_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _module()
    workspace = tmp_path / "workspace"
    root_modules = workspace / "node_modules"
    mcp_modules = workspace / "mcp" / "node_modules"
    cli_modules = workspace / "src" / "cli" / "node_modules"
    for node_modules in (root_modules, mcp_modules, cli_modules):
        (node_modules / ".bin").mkdir(parents=True)

    monkeypatch.setattr(module, "ROOT", workspace)
    monkeypatch.setenv("FORGEWRIGHT_ROOT_NODE_MODULES", str(root_modules))
    monkeypatch.setenv("FORGEWRIGHT_MCP_NODE_MODULES", str(mcp_modules))
    monkeypatch.setenv("FORGEWRIGHT_CLI_NODE_MODULES", str(cli_modules))
    parent_path = [str(tmp_path / "parent-bin"), str(tmp_path / "parent-other")]
    monkeypatch.setenv("PATH", os.pathsep.join(parent_path))

    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    runner.primary_node = str(tmp_path / "node" / "bin" / "node")
    env = runner._effective_env()
    path_parts = env["PATH"].split(os.pathsep)
    local_prefix = [
        str(Path(runner.python).parent.absolute()),
        str(Path(runner.primary_node).resolve().parent),
        str(root_modules / ".bin"),
        str(mcp_modules / ".bin"),
        str(cli_modules / ".bin"),
    ]

    assert path_parts == local_prefix + parent_path
    assert len(local_prefix) == len(set(local_prefix))
    assert env["FORGEWRIGHT_EFFECTIVE_NODE_BIN"] == runner.primary_node


@pytest.mark.skipif(
    os.name == "nt",
    reason="PATH/shebang semantics are validated by Windows integration",
)
def test_effective_env_omits_absent_local_bins_and_primary_node(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _module()
    monkeypatch.setattr(module, "ROOT", tmp_path / "workspace")
    for variable in (
        "FORGEWRIGHT_ROOT_NODE_MODULES",
        "FORGEWRIGHT_MCP_NODE_MODULES",
        "FORGEWRIGHT_CLI_NODE_MODULES",
        "FORGEWRIGHT_EFFECTIVE_NODE_BIN",
    ):
        monkeypatch.delenv(variable, raising=False)
    parent_path = str(tmp_path / "parent-bin")
    monkeypatch.setenv("PATH", parent_path)

    runner = module.LocalCI(dry_run=True, keep_going=False, timeout=1, base_ref=None)
    env = runner._effective_env()

    assert env["PATH"].split(os.pathsep) == [
        str(Path(runner.python).parent.absolute()),
        parent_path,
    ]
    assert "FORGEWRIGHT_EFFECTIVE_NODE_BIN" not in env
