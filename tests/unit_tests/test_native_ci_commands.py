from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "native_ci_commands_test", ROOT / "scripts/ci/native_commands.py"
)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def test_posix_preserves_verbatim_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "WINDOWS", False)
    argv = ["npm", "test", "--", "a name & spaces"]
    assert module.native_argv(argv) == argv


@pytest.mark.parametrize("name", ["npm", "npx"])
def test_windows_uses_node_entrypoint_not_batch_shell(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.setattr(module, "WINDOWS", True)
    entry = tmp_path / "node_modules/npm/bin" / f"{name}-cli.js"
    entry.parent.mkdir(parents=True)
    entry.write_text("// fixed CLI test entrypoint", encoding="utf-8")
    paths = {name: str(tmp_path / f"{name}.cmd"), "node": str(tmp_path / "node.exe")}
    monkeypatch.setattr(module.shutil, "which", lambda value: paths.get(value))
    assert module.native_argv([name, "test", "--", "a&b"]) == [
        paths["node"],
        str(entry),
        "test",
        "--",
        "a&b",
    ]


def test_windows_missing_entrypoint_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "WINDOWS", True)
    monkeypatch.setattr(module.shutil, "which", lambda _value: None)
    with pytest.raises(FileNotFoundError):
        module.native_argv(["npm", "test"])


def test_windows_keeps_current_virtual_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "WINDOWS", True)
    assert module.native_argv(["python3", "-m", "pytest"]) == [
        sys.executable,
        "-m",
        "pytest",
    ]
    environment = module.native_environment(
        {"PATH": "old", "PYTHONIOENCODING": "cp1252"}
    )
    assert environment["PYTHONIOENCODING"] == "utf-8"
    assert environment["PYTHONUTF8"] == "1"
    assert environment["PATH"].startswith(str(Path(sys.executable).parent))
