"""Git maintenance hooks must never mutate shared runtimes or other projects."""

from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ("post-merge", "post-checkout")


@pytest.mark.parametrize("hook", HOOKS)
def test_maintenance_hook_has_native_interpreter_and_no_implicit_install(
    hook: str,
) -> None:
    source = (ROOT / ".husky" / hook).read_bytes()
    assert source.startswith(b"#!/bin/sh\n")
    assert b"mcp-sync-needed" in source
    assert b"mcp-setup.sh" not in source
    assert b"submodule-auto-update.sh" not in source
    assert b"\r" not in source


@pytest.mark.parametrize("hook", HOOKS)
def test_maintenance_hook_only_marks_project_local_work(
    tmp_path: Path, hook: str
) -> None:
    bash = shutil.which("bash")
    assert bash is not None, (
        "Git Bash or a native Bash is required for hook verification"
    )
    # These sentinels reproduce the old hook's optional maintenance targets.
    # A hook must not execute either target, even when both are executable.
    for relative in (
        "scripts/forgewright-mcp-setup.sh",
        "scripts/lite/submodule-auto-update.sh",
    ):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            "#!/bin/sh\nprintf 'unexpected maintenance' > forbidden-side-effect\n",
            encoding="utf-8",
        )
        target.chmod(0o755)
    result = subprocess.run(
        [bash, (ROOT / ".husky" / hook).as_posix(), "old-head", "new-head", "1"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert not (tmp_path / "forbidden-side-effect").exists()
    cache = tmp_path / ".forgewright/cache"
    for marker in (
        "mcp-sync-needed",
        "wiki-sync-needed",
        "reindex-needed",
        "submodule-update-needed",
    ):
        assert (cache / marker).is_file(), marker
