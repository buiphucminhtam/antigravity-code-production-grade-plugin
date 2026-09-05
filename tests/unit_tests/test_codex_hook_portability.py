"""Execute repository hooks through the native host shell, not a schema-only check."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tomllib

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("event", ["SessionStart", "SubagentStart", "Stop"])
@pytest.mark.parametrize("subdirectory", [".", "kernel"])
def test_native_codex_hook_from_root_and_subdirectory(
    tmp_path: Path, event: str, subdirectory: str
) -> None:
    config = tomllib.loads((ROOT / ".codex/config.toml").read_text(encoding="utf-8"))
    hooks = [hook for group in config["hooks"][event] for hook in group["hooks"]]
    assert len(hooks) == 1
    hook = hooks[0]
    command = hook["command_windows"] if os.name == "nt" else hook["command"]
    environment = dict(os.environ)
    for key in (
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "PYTHONHOME",
    ):
        environment.pop(key, None)
    environment["FORGEWRIGHT_WORKSPACE"] = str(tmp_path)
    environment["FORGEWRIGHT_STOP_VALIDATION_TIMEOUT"] = "5"
    # Empty separate workspace makes Stop a no-code-change check without scanning the host repo.
    payload = {
        "hook_event_name": event,
        "source": "startup",
        "agent_type": "default",
        "last_assistant_message": "No verification claim.",
    }
    argv = (
        command
        if os.name == "nt"
        else [shutil.which("bash") or "/bin/bash", "-c", command]
    )
    result = subprocess.run(
        argv,
        shell=os.name == "nt",
        cwd=ROOT / subdirectory,
        env=environment,
        input=json.dumps(payload),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, (event, subdirectory, result.stderr)
    output = json.loads(result.stdout)
    assert output["continue"] is True
    if event != "Stop":
        assert output["hookSpecificOutput"]["hookEventName"] == event
    else:
        assert output["forgewright"]["reason_code"] == "no_code_changes"
