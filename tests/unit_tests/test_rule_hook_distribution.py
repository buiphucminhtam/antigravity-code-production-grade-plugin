import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts" / "bootstrap" / "forgewright-install.sh"
DOCTOR = ROOT / "scripts" / "hooks" / "forgewright-hook-doctor.sh"


def find_bash() -> str:
    discovered = shutil.which("bash")
    if discovered:
        return discovered
    if os.name == "nt":
        for base in dict.fromkeys(
            filter(
                None,
                (
                    os.environ.get("ProgramFiles"),
                    os.environ.get("ProgramW6432"),
                    os.environ.get("ProgramFiles(x86)"),
                ),
            )
        ):
            candidate = Path(base) / "Git" / "bin" / "bash.exe"
            if candidate.is_file():
                return str(candidate)
    return "/bin/bash" if os.name != "nt" else "bash"


BASH = find_bash()


def git_bash_path(path: Path) -> str:
    posix = path.resolve().as_posix()
    if os.name == "nt" and re.match(r"^[A-Za-z]:/", posix):
        return f"/{posix[0].lower()}{posix[2:]}"
    return posix


def run_installer(
    home: Path, framework: Path, *, extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [
            BASH,
            str(INSTALLER),
            "--profile",
            "minimal",
            "--yes",
            "--skip-mcp",
            "--skip-skills",
            "--skip-config",
        ],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def run_doctor(
    home: Path, framework: Path, *arguments: str
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    return subprocess.run(
        [BASH, str(DOCTOR), *arguments],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def toml_commands(path: Path) -> list[str]:
    pattern = re.compile(r'(?m)^command\s*=\s*("(?:\\.|[^"\\])*")\s*$')
    return [
        json.loads(match.group(1))
        for match in pattern.finditer(path.read_text(encoding="utf-8"))
    ]


def installed_stop_commands(path: Path, framework: Path) -> list[str]:
    expected = (framework / "scripts" / "lite" / "stop-gate.sh").as_posix()
    matches = []
    for command in toml_commands(path):
        if os.name == "nt":
            owned = "stop-gate.sh" in command and expected in command.replace("\\", "/")
        else:
            try:
                owned = shlex.split(command) == [
                    "bash",
                    expected,
                    "--platform",
                    "CODEX",
                ]
            except ValueError:
                owned = False
        if owned:
            matches.append(command)
    return matches


def lifecycle_commands(config: dict, event: str) -> list[dict]:
    groups = config.get(event, config.get("hooks", {}).get(event, []))
    result = []
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("hooks"), list):
            result.extend(hook for hook in group["hooks"] if isinstance(hook, dict))
        elif isinstance(group, dict):
            result.append(group)
    return result


def assert_context_command(hook: dict, framework: Path, event: str) -> None:
    command = hook["command"]
    hook_path = framework / "scripts" / "lite" / "rule-context-hook.py"
    words = shlex.split(command, posix=True)
    arguments = words[words.index("--") + 1 :]
    assert len(arguments) == 8 and arguments[-2:] == ["||", "true"]
    runtime, fallback_workspace = arguments[:2]
    assert runtime.replace("\\", "/") in (
        hook_path.as_posix(),
        git_bash_path(hook_path),
    )
    assert '--event "$event"' in command
    assert '--workspace "$workspace"' in command
    assert "git -C" in command and "rev-parse --show-toplevel" in command
    assert "FORGEWRIGHT_PROJECT_ROOT" in command
    assert "FORGEWRIGHT_WORKSPACE" in command
    assert fallback_workspace.replace("\\", "/") in (
        framework.as_posix(),
        git_bash_path(framework),
    )
    assert (
        'FORGEWRIGHT_RULE_HOOK_MODE="${FORGEWRIGHT_RULE_HOOK_MODE:-observe}"' in command
    )
    assert "|| true" in command
    if event == "sessionStart":
        assert "timeout" not in hook
    else:
        assert hook.get("timeout") in (2, 2000)


def seed_user_configs(home: Path) -> None:
    (home / ".claude").mkdir(parents=True)
    (home / ".gemini" / "config").mkdir(parents=True)
    (home / ".cursor").mkdir(parents=True)
    (home / ".codex").mkdir(parents=True)
    (home / ".claude" / "settings.json").write_text(
        json.dumps(
            {
                "userSetting": {"keep": True},
                "hooks": {
                    "SessionStart": [
                        {"hooks": [{"type": "command", "command": "user-claude-start"}]}
                    ],
                    "Stop": [
                        {"hooks": [{"type": "command", "command": "user-claude-stop"}]}
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    (home / ".gemini" / "settings.json").write_text(
        json.dumps(
            {
                "userSetting": {"keep": True},
                "hooks": {
                    "BeforeAgent": [
                        {"hooks": [{"type": "command", "command": "user-gemini-start"}]}
                    ],
                    "BeforeTool": [
                        {
                            "matcher": "*",
                            "hooks": [{"type": "command", "command": "user-policy"}],
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    (home / ".gemini" / "config" / "hooks.json").write_text(
        json.dumps(
            {
                "userSetting": {"keep": True},
                "forgewright-policy": {
                    "enabled": False,
                    "PreToolUse": [
                        {
                            "matcher": "*",
                            "hooks": [{"type": "command", "command": "user-security"}],
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    (home / ".cursor" / "hooks.json").write_text(
        json.dumps(
            {
                "version": 1,
                "userSetting": {"keep": True},
                "hooks": {
                    "stop": [{"command": "user-cursor-stop"}],
                    "sessionStart": [{"command": "user-cursor-start"}],
                },
            }
        ),
        encoding="utf-8",
    )
    (home / ".codex" / "config.toml").write_text(
        """[features]\nhooks = true\n\n[hooks]\n\n[[hooks.Stop]]\nmatcher = \"*\"\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"user-codex-stop\"\n""",
        encoding="utf-8",
    )


def test_installer_distributes_rule_runtime_and_preserves_user_hooks(
    tmp_path: Path,
) -> None:
    home = tmp_path / "o'connor home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)

    first = run_installer(home, framework)
    assert first.returncode == 0, first.stdout + first.stderr

    runtime = framework / "scripts" / "lite" / "rule-context-hook.py"
    windows_runtime = framework / "scripts" / "lite" / "codex-hook-windows.ps1"
    manifest = framework / "kernel" / "rule-manifest.json"
    assert runtime.is_file() and os.access(runtime, os.X_OK)
    assert (
        windows_runtime.read_bytes()
        == (ROOT / "scripts" / "lite" / "codex-hook-windows.ps1").read_bytes()
    )
    assert manifest.is_file()
    payload = load_json(manifest)
    for rule in payload["rules"]:
        if rule.get("status") == "active" and rule.get("canonical", True):
            assert (framework / rule["source"]).is_file(), rule["source"]

    stop_runtime = framework / "scripts" / "lite"
    for name in (
        "stop-gate.sh",
        "stop_gate.py",
        "continuity_check.py",
        "evidence_common.py",
        "windows_secure_io.py",
        "verify_gate.py",
    ):
        installed_file = stop_runtime / name
        assert (
            installed_file.read_bytes()
            == (ROOT / "scripts" / "lite" / name).read_bytes()
        )

    claude = load_json(home / ".claude" / "settings.json")
    assert any(
        hook.get("command") == "user-claude-start"
        for hook in lifecycle_commands(claude, "SessionStart")
    )
    assert any(
        hook.get("command") == "user-claude-stop"
        for hook in lifecycle_commands(claude, "Stop")
    )
    assert_context_command(
        next(
            hook
            for hook in lifecycle_commands(claude, "SessionStart")
            if "rule-context-hook.py" in hook.get("command", "")
        ),
        framework,
        "SessionStart",
    )
    assert any(
        "rule-context-hook.py" in hook.get("command", "")
        for hook in lifecycle_commands(claude, "SubagentStart")
    )

    gemini = load_json(home / ".gemini" / "settings.json")
    assert any(
        hook.get("command") == "user-gemini-start"
        for hook in lifecycle_commands(gemini, "BeforeAgent")
    )
    assert_context_command(
        next(
            hook
            for hook in lifecycle_commands(gemini, "BeforeAgent")
            if "rule-context-hook.py" in hook.get("command", "")
        ),
        framework,
        "BeforeAgent",
    )
    assert any(
        hook.get("command") == "user-policy"
        for hook in lifecycle_commands(gemini, "BeforeTool")
    )

    antigravity = load_json(home / ".gemini" / "config" / "hooks.json")
    named = antigravity["forgewright-policy"]
    assert named["enabled"] is True
    assert any(
        hook.get("command") == "user-security"
        for hook in lifecycle_commands(named, "PreToolUse")
    )
    expected_policy_gate = git_bash_path(
        framework / "scripts" / "lite" / "antigravity-pre-tool-gate.sh"
    )
    assert any(
        hook.get("type") == "command"
        and shlex.split(hook.get("command", ""), posix=True)
        == ["bash", expected_policy_gate]
        and hook.get("timeout") == 5
        for hook in lifecycle_commands(named, "PreToolUse")
    )
    assert_context_command(
        next(
            hook
            for hook in lifecycle_commands(named, "PreInvocation")
            if "rule-context-hook.py" in hook.get("command", "")
        ),
        framework,
        "PreInvocation",
    )

    cursor = load_json(home / ".cursor" / "hooks.json")
    assert any(
        hook.get("command") == "user-cursor-stop" for hook in cursor["hooks"]["stop"]
    )
    cursor_context = next(
        hook
        for hook in cursor["hooks"]["sessionStart"]
        if "rule-context-hook.py" in hook.get("command", "")
    )
    assert_context_command(cursor_context, framework, "sessionStart")

    codex_path = home / ".codex" / "config.toml"
    codex = codex_path.read_text(encoding="utf-8")
    assert "user-codex-stop" in codex
    assert codex.count(" CODEX SessionStart ") == 1
    assert codex.count(" CODEX SubagentStart ") == 1
    parsed_codex = tomllib.loads(codex)
    for event in ("SessionStart", "SubagentStart"):
        codex_context = next(
            hook
            for hook in lifecycle_commands(parsed_codex, event)
            if "rule-context-hook.py" in hook.get("command", "")
        )
        assert_context_command(codex_context, framework, event)
    assert (
        "FORGEWRIGHT_RULE_HOOK_MODE=" in codex
        and ":-observe" in codex
        and "|| true" in codex
    )
    stop_commands = installed_stop_commands(home / ".codex" / "config.toml", framework)
    assert len(stop_commands) == 1
    if os.name == "nt":
        assert stop_commands[0].startswith('cmd /d /s /c ""')
        assert "bash.exe" in stop_commands[0]
        normalized_stop_command = stop_commands[0].replace("\\", "/").lower()
        assert "/bin/bash.exe" in normalized_stop_command
        assert "/usr/bin/bash.exe" not in normalized_stop_command
    else:
        assert stop_commands[0].startswith("bash ")

    if os.name == "nt":
        plain_git = tmp_path / "plain-git"
        initialized = subprocess.run(
            ["git", "init", str(plain_git)],
            text=True,
            capture_output=True,
            check=False,
        )
        assert initialized.returncode == 0, initialized.stderr
        lifecycle_payloads = {
            "SessionStart": {"source": "startup"},
            "SubagentStart": {"agent_type": "default"},
        }
        for event, payload in lifecycle_payloads.items():
            hook = next(
                item
                for item in lifecycle_commands(parsed_codex, event)
                if "rule-context-hook.py" in item.get("command", "")
            )
            windows_command = hook["command_windows"]
            assert "codex-hook-windows.ps1" in windows_command
            assert "bash" not in windows_command.lower()
            for cwd in (ROOT / "kernel", tmp_path, plain_git):
                result = subprocess.run(
                    windows_command,
                    cwd=cwd,
                    input=json.dumps(payload),
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    capture_output=True,
                    shell=True,
                    timeout=20,
                    check=False,
                )
                assert result.returncode == 0, (event, cwd, result.stderr)
                native_payload = json.loads(result.stdout)
                assert native_payload["continue"] is True
                context = native_payload["hookSpecificOutput"]["additionalContext"]
                assert "kernel-entry" in context

    smoke_workspace = tmp_path / "stop-smoke"
    smoke_workspace.mkdir()
    smoke_env = os.environ.copy()
    smoke_env["FORGEWRIGHT_WORKSPACE"] = git_bash_path(smoke_workspace)
    smoke = subprocess.run(
        stop_commands[0],
        cwd=smoke_workspace,
        env=smoke_env,
        input="{}",
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        shell=True,
        check=False,
    )
    assert smoke.returncode == 0, smoke.stderr
    stop_payload = json.loads(smoke.stdout)
    assert stop_payload == {
        "continue": True,
        "forgewright": {
            "schema": "forgewright-stop-decision/v1",
            "host_action": "allow_stop",
            "completion_state": "verified",
            "retry_suppressed": False,
            "reason_code": "no_code_changes",
        },
    }

    before = {
        path: path.read_bytes()
        for path in (
            home / ".claude" / "settings.json",
            home / ".gemini" / "settings.json",
            home / ".gemini" / "config" / "hooks.json",
            home / ".cursor" / "hooks.json",
            home / ".codex" / "config.toml",
        )
    }
    second = run_installer(home, framework)
    assert second.returncode == 0, second.stdout + second.stderr
    assert all(path.read_bytes() == contents for path, contents in before.items())

    claude_context_command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".claude" / "settings.json"), "SessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )
    off_env = os.environ.copy()
    off_env["FORGEWRIGHT_RULE_HOOK_MODE"] = "off"
    off = subprocess.run(
        [BASH, "-lc", claude_context_command],
        cwd=tmp_path,
        env=off_env,
        input="{}",
        text=True,
        capture_output=True,
        check=False,
    )
    assert off.returncode == 0, off.stderr
    assert "additionalContext" not in json.loads(off.stdout)


def test_installer_keeps_unrelated_codex_stop_gate_and_adds_owned_hook(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    codex_path = home / ".codex" / "config.toml"
    unrelated = "bash /opt/team/stop-gate.sh --platform CODEX"
    codex_path.write_text(
        codex_path.read_text(encoding="utf-8").replace("user-codex-stop", unrelated),
        encoding="utf-8",
    )

    first = run_installer(home, framework)
    assert first.returncode == 0, first.stdout + first.stderr
    assert unrelated in toml_commands(codex_path)
    assert len(installed_stop_commands(codex_path, framework)) == 1

    second = run_installer(home, framework)
    assert second.returncode == 0, second.stdout + second.stderr
    assert toml_commands(codex_path).count(unrelated) == 1
    assert len(installed_stop_commands(codex_path, framework)) == 1


@pytest.mark.skipif(os.name != "nt", reason="cmd.exe expansion applies on Windows")
def test_installer_rejects_percent_expansion_in_windows_stop_path(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / "%FORGEWRIGHT_EXPANDED%" / ".forgewright"
    home.mkdir()
    seed_user_configs(home)

    installed = run_installer(home, framework)
    assert installed.returncode != 0
    assert "cmd.exe would expand" in installed.stdout + installed.stderr


def test_installer_and_doctor_enable_codex_hooks_feature(tmp_path: Path) -> None:
    import tomllib

    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    codex_path = home / ".codex" / "config.toml"
    codex_path.write_text(
        codex_path.read_text(encoding="utf-8").replace(
            "hooks = true", "telemetry = false", 1
        ),
        encoding="utf-8",
    )

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    config = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert config["features"]["hooks"] is True
    assert config["features"]["telemetry"] is False
    assert len(installed_stop_commands(codex_path, framework)) == 1

    unrelated = "user-codex-stop"
    codex_path.write_text(
        "[features]\nhooks = false\ntelemetry = false\n\n[hooks]\n\n"
        '[[hooks.Stop]]\nmatcher = "*"\n[[hooks.Stop.hooks]]\n'
        f'type = "command"\ncommand = {json.dumps(unrelated)}\n',
        encoding="utf-8",
    )
    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    diagnosed = subprocess.run(
        [BASH, str(DOCTOR), "--quick"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert "Codex Stop hook NOT configured correctly" in diagnosed.stdout

    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    repaired = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert repaired["features"]["hooks"] is True
    assert repaired["features"]["telemetry"] is False
    assert unrelated in toml_commands(codex_path)
    assert len(installed_stop_commands(codex_path, framework)) == 1


def test_hook_doctor_reports_and_repairs_only_rule_lifecycle_hooks(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    claude_path = home / ".claude" / "settings.json"
    claude = load_json(claude_path)
    claude["hooks"]["SessionStart"] = []
    claude_path.write_text(json.dumps(claude), encoding="utf-8")
    gemini_path = home / ".gemini" / "settings.json"
    gemini = load_json(gemini_path)
    gemini["hooks"].pop("BeforeAgent", None)
    gemini_path.write_text(json.dumps(gemini), encoding="utf-8")
    cursor_path = home / ".cursor" / "hooks.json"
    cursor = load_json(cursor_path)
    cursor["hooks"]["sessionStart"] = [{"command": "user-cursor-start"}]
    cursor_path.write_text(json.dumps(cursor), encoding="utf-8")
    antigravity_path = home / ".gemini" / "config" / "hooks.json"
    antigravity = load_json(antigravity_path)
    pre_invocation_before = antigravity["forgewright-policy"]["PreInvocation"]
    installed_policy_group = next(
        group
        for group in antigravity["forgewright-policy"]["PreToolUse"]
        if any(
            "antigravity-pre-tool-gate.sh" in hook.get("command", "")
            for hook in group.get("hooks", [])
        )
    )
    installed_policy_command = next(
        hook["command"]
        for hook in installed_policy_group["hooks"]
        if "antigravity-pre-tool-gate.sh" in hook.get("command", "")
    )
    owned_policy_wrapper = f"true || {installed_policy_command}"
    duplicate_policy_group = {
        "matcher": "*",
        "hooks": [
            {
                "type": "command",
                "command": installed_policy_command,
                "timeout": 11,
            }
        ],
    }
    empty_user_group = {"matcher": "empty-user", "hooks": []}
    user_pre_tool_group = {
        "matcher": "user-tool",
        "hooks": [
            {
                "type": "command",
                "command": "user-antigravity-pre-tool",
                "timeout": 17,
            },
            {
                "type": "command",
                "command": "bash /opt/team/antigravity-pre-tool-gate.sh",
                "timeout": 9,
            },
        ],
    }
    antigravity["forgewright-policy"]["enabled"] = False
    antigravity["forgewright-policy"]["PreToolUse"] = [
        installed_policy_group,
        duplicate_policy_group,
        {"matcher": "run_command", "hooks": [{"command": owned_policy_wrapper}]},
        empty_user_group,
        user_pre_tool_group,
    ]
    antigravity_path.write_text(json.dumps(antigravity), encoding="utf-8")

    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    diagnose = subprocess.run(
        [BASH, str(DOCTOR), "--quick"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert "Rule context" in diagnose.stdout
    assert (
        "Antigravity PreToolUse policy hook is not configured correctly"
        in diagnose.stdout
    )
    assert diagnose.returncode in (0, 1)

    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1)
    assert any(
        "rule-context-hook.py" in hook.get("command", "")
        for hook in lifecycle_commands(load_json(claude_path), "SessionStart")
    )
    assert any(
        "rule-context-hook.py" in hook.get("command", "")
        for hook in lifecycle_commands(load_json(gemini_path), "BeforeAgent")
    )
    cursor_after = load_json(cursor_path)
    assert any(
        "rule-context-hook.py" in hook.get("command", "")
        for hook in cursor_after["hooks"]["sessionStart"]
    )
    assert any(
        hook.get("command") == "user-cursor-stop"
        for hook in cursor_after["hooks"]["stop"]
    )
    assert load_json(home / ".gemini" / "config" / "hooks.json")["userSetting"] == {
        "keep": True
    }
    repaired_antigravity = load_json(antigravity_path)["forgewright-policy"]
    assert repaired_antigravity["PreInvocation"] == pre_invocation_before
    assert repaired_antigravity.get("enabled") is not False
    assert empty_user_group in repaired_antigravity["PreToolUse"]
    assert user_pre_tool_group in repaired_antigravity["PreToolUse"]
    repaired_policy_hooks = lifecycle_commands(repaired_antigravity, "PreToolUse")
    assert (
        sum(
            hook.get("command") == installed_policy_command
            and hook.get("type") == "command"
            and hook.get("timeout") == 5
            for hook in repaired_policy_hooks
        )
        == 1
    )
    assert all(
        hook.get("command") != owned_policy_wrapper for hook in repaired_policy_hooks
    )
    repaired_registry = antigravity_path.read_bytes()
    rechecked = subprocess.run(
        [BASH, str(DOCTOR), "--quick"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert rechecked.returncode == 0, rechecked.stdout + rechecked.stderr
    assert (
        "Antigravity PreToolUse policy hook uses the native named-hook schema"
        in rechecked.stdout
    )
    assert antigravity_path.read_bytes() == repaired_registry


def test_hook_doctor_repairs_missing_framework_runtime(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    (framework / "scripts" / "lite" / "rule-context-hook.py").unlink()
    (framework / "scripts" / "lite" / "evidence_common.py").unlink()
    (framework / "kernel" / "rule-manifest.json").unlink()
    (framework / "kernel" / "ENTRY.md").unlink()

    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert "Rule context runtime repaired" in fixed.stdout
    assert "Stop runtime dependency closure repaired" in fixed.stdout
    assert "Installed Stop runtime smoke passed" in fixed.stdout, (
        fixed.stdout + fixed.stderr
    )
    assert (framework / "scripts" / "lite" / "rule-context-hook.py").is_file()
    assert (framework / "scripts" / "lite" / "evidence_common.py").read_bytes() == (
        ROOT / "scripts" / "lite" / "evidence_common.py"
    ).read_bytes()
    assert (framework / "kernel" / "rule-manifest.json").is_file()
    assert (framework / "kernel" / "ENTRY.md").is_file()


@pytest.mark.skipif(os.name != "nt", reason="native Windows lifecycle adapter")
def test_hook_doctor_repairs_only_missing_windows_adapter(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    adapter = framework / "scripts" / "lite" / "codex-hook-windows.ps1"
    adapter.unlink()
    fixed = run_doctor(home, framework, "--quick", "--fix")
    assert "Rule context runtime repaired" in fixed.stdout
    assert (
        adapter.read_bytes()
        == (ROOT / "scripts" / "lite" / "codex-hook-windows.ps1").read_bytes()
    )

    repaired = adapter.read_bytes()
    checked = run_doctor(home, framework, "--quick")
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert "Codex Windows lifecycle hook is current" in checked.stdout
    assert adapter.read_bytes() == repaired


def test_installer_migrates_old_codex_context_path_without_duplicates(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    codex = codex_path.read_text(encoding="utf-8")
    current_runtime = framework / "scripts" / "lite" / "rule-context-hook.py"
    legacy_runtime = framework / "rule-context-hook.py"
    runtime_forms = (
        (git_bash_path(current_runtime), git_bash_path(legacy_runtime)),
        (current_runtime.as_posix(), legacy_runtime.as_posix()),
        (str(current_runtime), str(legacy_runtime)),
    )
    current_form, legacy_form = next(
        (current, legacy) for current, legacy in runtime_forms if current in codex
    )
    legacy_codex = codex.replace(current_form, legacy_form)
    assert legacy_codex != codex
    codex_path.write_text(legacy_codex, encoding="utf-8")

    migrated = run_installer(home, framework)
    assert migrated.returncode == 0, migrated.stdout + migrated.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert all(legacy not in result for _, legacy in runtime_forms)
    assert result.count(" CODEX SessionStart ") == 1
    assert result.count(" CODEX SubagentStart ") == 1
    assert str(current_runtime) in result or git_bash_path(current_runtime) in result

    before = codex_path.read_bytes()
    repeated = run_installer(home, framework)
    assert repeated.returncode == 0, repeated.stdout + repeated.stderr
    assert codex_path.read_bytes() == before


@pytest.mark.parametrize("repairer", ["installer", "doctor"])
def test_codex_lifecycle_migration_removes_legacy_python3_duplicates(
    tmp_path: Path, repairer: str
) -> None:
    import tomllib

    home = tmp_path / "o'connor home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    config = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    additions = []
    expected_commands = {}
    legacy_commands = {}
    unrelated_commands = {}
    resolver_prefix = (
        'hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4"; '
        'python_executable="$5"; python_selector="$6"; '
        'run_python() { if [ -n "$python_selector" ]; then "$python_executable" '
        '"$python_selector" "$@"; else "$python_executable" "$@"; fi; }; '
    )
    for event, matcher in (
        ("SessionStart", "startup|resume|clear|compact"),
        ("SubagentStart", "*"),
    ):
        current_hook = next(
            hook
            for group in config["hooks"][event]
            for hook in group.get("hooks", [])
            if f" CODEX {event} " in hook.get("command", "")
        )
        current = current_hook["command"]
        assert resolver_prefix in current
        legacy = current.replace(
            resolver_prefix,
            'hook_path="$1"; fallback_workspace="$2"; platform="$3"; event="$4"; ',
            1,
        )
        legacy = legacy.replace(
            'run_python - "$hook_path"', 'python3 - "$hook_path"', 1
        ).replace('run_python "$runtime"', 'python3 "$runtime"', 1)
        head, separator, _arguments = legacy.rpartition(f" CODEX {event} ")
        assert separator
        legacy = head + separator + "|| true"
        unrelated = f"python3 /opt/team/rule-context-hook.py --event {event}"
        expected_commands[event] = current
        legacy_commands[event] = legacy
        unrelated_commands[event] = unrelated
        for command in (legacy, unrelated):
            additions.append(
                f"\n[[hooks.{event}]]\n"
                f"matcher = {json.dumps(matcher)}\n"
                f"[[hooks.{event}.hooks]]\n"
                'type = "command"\n'
                f"command = {json.dumps(command)}\n"
                "timeout = 2\n"
            )
    codex_path.write_text(
        codex_path.read_text(encoding="utf-8") + "".join(additions),
        encoding="utf-8",
    )

    if repairer == "installer":
        repaired = run_installer(home, framework)
    else:
        before = codex_path.read_bytes()
        diagnosed = run_doctor(home, framework, "--quick")
        assert (
            "CODEX rule-context lifecycle hook is missing or invalid"
            in diagnosed.stdout
        ), diagnosed.stdout + diagnosed.stderr
        assert codex_path.read_bytes() == before
        repaired = run_doctor(home, framework, "--quick", "--fix")
    assert repaired.returncode == 0, repaired.stdout + repaired.stderr

    migrated = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    for event, expected_command in expected_commands.items():
        hooks = [
            hook
            for group in migrated["hooks"][event]
            for hook in group.get("hooks", [])
        ]
        commands = [hook["command"] for hook in hooks]
        assert len(hooks) == 2
        assert commands.count(expected_command) == 1
        assert legacy_commands[event] not in commands
        assert unrelated_commands[event] in commands
        owned = next(hook for hook in hooks if hook["command"] == expected_command)
        if os.name == "nt":
            assert owned["command_windows"].startswith("powershell.exe ")
        else:
            assert "command_windows" not in owned
        assert owned["timeout"] == 2


def test_installer_preserves_unrelated_verify_and_context_hooks(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)

    unrelated_verify = "bash /opt/team/verify-gate.sh --platform CLAUDE"
    unrelated_relative_verify = "bash tools/verify-gate.sh --platform CLAUDE"
    unrelated_context = "python3 /opt/team/rule-context-hook.py --custom"
    claude_path = home / ".claude" / "settings.json"
    claude = load_json(claude_path)
    claude["hooks"]["Stop"].append(
        {"hooks": [{"type": "command", "command": unrelated_verify}]}
    )
    claude["hooks"]["Stop"].append(
        {"hooks": [{"type": "command", "command": unrelated_relative_verify}]}
    )
    claude["hooks"]["SessionStart"].append(
        {"hooks": [{"type": "command", "command": unrelated_context}]}
    )
    claude_path.write_text(json.dumps(claude), encoding="utf-8")

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    result = load_json(claude_path)
    assert any(
        hook.get("command") == unrelated_verify
        for hook in lifecycle_commands(result, "Stop")
    )
    assert any(
        hook.get("command") == unrelated_relative_verify
        for hook in lifecycle_commands(result, "Stop")
    )
    assert any(
        hook.get("command") == unrelated_context
        for hook in lifecycle_commands(result, "SessionStart")
    )


def test_hook_doctor_preserves_unrelated_verify_and_context_hooks(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    unrelated_verify = "bash /opt/team/verify-gate.sh --platform CLAUDE"
    unrelated_context = "python3 /opt/team/rule-context-hook.py --custom"
    claude_path = home / ".claude" / "settings.json"
    claude = load_json(claude_path)
    claude["hooks"]["Stop"] = [
        {"hooks": [{"type": "command", "command": unrelated_verify}]}
    ]
    claude["hooks"]["SessionStart"] = [
        {"hooks": [{"type": "command", "command": unrelated_context}]}
    ]
    claude_path.write_text(json.dumps(claude), encoding="utf-8")

    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr

    result = load_json(claude_path)
    assert any(
        hook.get("command") == unrelated_verify
        for hook in lifecycle_commands(result, "Stop")
    )
    assert any(
        hook.get("command") == unrelated_context
        for hook in lifecycle_commands(result, "SessionStart")
    )
    assert any(
        "rule-context-hook.py" in hook.get("command", "")
        and hook.get("command") != unrelated_context
        for hook in lifecycle_commands(result, "SessionStart")
    )


def test_hook_doctor_preserves_unrelated_codex_verify_hook(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    codex_path = home / ".codex" / "config.toml"
    unrelated = "bash /opt/team/verify-gate.sh --platform CODEX"
    codex_path.write_text(
        "[features]\nhooks = true\n\n[hooks]\n\n"
        '[[hooks.Stop]]\nmatcher = "*"\n[[hooks.Stop.hooks]]\n'
        'type = "command"\ncommand = "' + unrelated + '"\n',
        encoding="utf-8",
    )

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    # Replace the installer's trusted stop hook with the unrelated hook so the
    # doctor must repair Codex while preserving the user's command.
    installed_command = installed_stop_commands(codex_path, framework)[0]
    codex_path.write_text(
        codex_path.read_text(encoding="utf-8").replace(
            json.dumps(installed_command), json.dumps(unrelated), 1
        ),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert f'command = "{unrelated}"' in result
    assert len(installed_stop_commands(codex_path, framework)) == 1


def test_hook_doctor_migrates_trusted_legacy_codex_verify_hook(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    installed_command = installed_stop_commands(codex_path, framework)[0]
    legacy_command = f"bash {framework / 'verify-gate.sh'} --platform CODEX"
    codex = codex_path.read_text(encoding="utf-8").replace(
        json.dumps(installed_command), json.dumps(legacy_command), 1
    )
    codex_path.write_text(codex, encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "HOME": git_bash_path(home),
            "FORGEWRIGHT_DIR": git_bash_path(framework),
            "FORGEWRIGHT_SOURCE_DIR": git_bash_path(ROOT),
        }
    )
    fixed = subprocess.run(
        [BASH, str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert f"bash {framework / 'verify-gate.sh'} --platform CODEX" not in result
    assert len(installed_stop_commands(codex_path, framework)) == 1


def custom_manifest(project: Path, *, malformed: bool = False) -> None:
    (project / "kernel").mkdir(parents=True)
    (project / "rules").mkdir(parents=True)
    (project / "rules" / "custom.md").write_text(
        "# Project-owned rule\n\nThis rule belongs to the active project.\n",
        encoding="utf-8",
    )
    manifest = project / "kernel" / "rule-manifest.json"
    if malformed:
        manifest.write_text("{not-json", encoding="utf-8")
        return
    manifest.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "defaults": {"max_context_chars": 6000, "max_rules": 1},
                "rules": [
                    {
                        "id": "project-custom",
                        "status": "active",
                        "canonical": True,
                        "source": "rules/custom.md",
                        "priority": 1,
                        "platforms": ["CLAUDE"],
                        "events": ["SessionStart"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def run_context_command(
    command: str, project: Path, env: dict[str, str]
) -> subprocess.CompletedProcess[str]:
    clean_env = env.copy()
    clean_env.pop("FORGEWRIGHT_PROJECT_ROOT", None)
    clean_env.pop("FORGEWRIGHT_WORKSPACE", None)
    return subprocess.run(
        [BASH, "-lc", command],
        cwd=project,
        env=clean_env,
        input="{}",
        text=True,
        capture_output=True,
        check=False,
    )


def test_global_lifecycle_hook_uses_project_manifest_from_git_root(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    custom_manifest(project)
    subprocess.run(["git", "init", "-q", str(project)], check=True)

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".claude" / "settings.json"), "SessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )

    result = run_context_command(command, project, os.environ.copy())
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    context = payload["hookSpecificOutput"]["additionalContext"]
    assert "project-custom" in context
    assert "Project-owned rule" in context
    assert "kernel-entry" not in context
    assert (
        project
        / ".forgewright"
        / "runtime"
        / "rule-context"
        / "CLAUDE-SessionStart.json"
    ).is_file()


def test_global_lifecycle_hook_falls_back_to_framework_on_invalid_project_manifest(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    custom_manifest(project, malformed=True)

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".claude" / "settings.json"), "SessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )

    result = run_context_command(command, project, os.environ.copy())
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    context = payload["hookSpecificOutput"]["additionalContext"]
    assert "kernel-entry" in context
    assert "project-custom" not in context


def test_cursor_project_dir_precedes_cwd_and_git_resolution(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    project = tmp_path / "cursor-project"
    invocation_dir = tmp_path / "invocation"
    home.mkdir()
    project.mkdir()
    invocation_dir.mkdir()
    custom_manifest(project)
    manifest_path = project / "kernel" / "rule-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["rules"][0]["platforms"] = ["CURSOR"]
    manifest["rules"][0]["events"] = ["sessionStart"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".cursor" / "hooks.json"), "sessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )
    env = os.environ.copy()
    env["CURSOR_PROJECT_DIR"] = str(project)
    result = run_context_command(command, invocation_dir, env)
    assert result.returncode == 0, result.stderr
    context = json.loads(result.stdout)["additional_context"]
    assert "project-custom" in context
    assert "kernel-entry" not in context


def test_codex_legacy_migration_removes_orphan_parent_timeout(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    codex_path = home / ".codex" / "config.toml"
    legacy_command = f"bash {framework / 'verify-gate.sh'} --platform CODEX"
    codex_path.write_text(
        "[features]\nhooks = true\n\n[hooks]\ntimeout = 2\n\n"
        '[[hooks.Stop]]\nmatcher = "*"\n[[hooks.Stop.hooks]]\n'
        'type = "command"\ncommand = ' + json.dumps(legacy_command) + "\ntimeout = 2\n",
        encoding="utf-8",
    )
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    import tomllib

    config = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert "timeout" not in config["hooks"]
    assert config["hooks"]["SessionStart"][0]["hooks"][0]["timeout"] == 2


def test_distribution_config_mutations_use_atomic_publication() -> None:
    installer = INSTALLER.read_text(encoding="utf-8")
    doctor = DOCTOR.read_text(encoding="utf-8")
    for source in (installer, doctor):
        assert '>> "$CODEX_CONFIG"' not in source
        assert 'cat <<EOF > "$' not in source
    assert 'atomic_write_text "$codex_file"' in installer
    assert 'atomic_write_text "$CODEX_CONFIG"' in doctor
    assert 'if os.name != "nt":' in installer
    assert "process.platform !== 'win32'" in doctor


def test_global_lifecycle_hook_is_fail_open_when_framework_runtime_breaks(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".claude" / "settings.json"), "SessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )
    (framework / "scripts" / "lite" / "rule-context-hook.py").unlink()

    result = run_context_command(command, project, os.environ.copy())
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"continue": True}


def test_global_lifecycle_hook_never_executes_project_runtime_when_global_runtime_is_missing(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    custom_manifest(project)
    local_runtime = project / "scripts" / "lite" / "rule-context-hook.py"
    local_runtime.parent.mkdir(parents=True)
    sentinel = project / "project-runtime-executed"
    local_runtime.write_text(
        "from pathlib import Path\n"
        f"Path({str(sentinel)!r}).write_text('executed', encoding='utf-8')\n",
        encoding="utf-8",
    )

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = next(
        hook["command"]
        for hook in lifecycle_commands(
            load_json(home / ".claude" / "settings.json"), "SessionStart"
        )
        if "rule-context-hook.py" in hook.get("command", "")
    )
    (framework / "scripts" / "lite" / "rule-context-hook.py").unlink()

    result = run_context_command(command, project, os.environ.copy())
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"continue": True}
    assert not sentinel.exists()


def test_distribution_scripts_have_valid_shell_syntax() -> None:
    for script in (INSTALLER, DOCTOR):
        result = subprocess.run([BASH, "-n", str(script)], check=False)
        assert result.returncode == 0, script


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_installer_and_doctor_collapse_duplicate_codex_stop_hooks(
    tmp_path: Path, newline: str
) -> None:
    import tomllib

    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    desired = installed_stop_commands(codex_path, framework)[0]
    duplicate = newline + newline.join(
        (
            "[[hooks.Stop]]",
            'matcher = "*"',
            "[[hooks.Stop.hooks]]",
            'type = "command"',
            f"command = {json.dumps(desired)}",
            'command_windows = "powershell.exe -Command exit 9"',
            "",
        )
    )
    original = codex_path.read_text(encoding="utf-8")
    if newline == "\r\n":
        original = original.replace("\n", "\r\n")
    codex_path.write_bytes((original + duplicate).encode("utf-8"))

    reinstalled = run_installer(home, framework)
    assert reinstalled.returncode == 0, reinstalled.stdout + reinstalled.stderr
    parsed = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert len(installed_stop_commands(codex_path, framework)) == 1
    installed_hook = next(
        hook
        for group in parsed["hooks"]["Stop"]
        for hook in group.get("hooks", [])
        if hook.get("command") == desired
    )
    assert installed_hook.get("command_windows") in (None, desired)

    codex_path.write_bytes(
        (codex_path.read_text(encoding="utf-8") + duplicate).encode("utf-8")
    )
    diagnosed = run_doctor(home, framework, "--quick")
    assert "Codex Stop hook NOT configured correctly" in diagnosed.stdout
    fixed = run_doctor(home, framework, "--quick", "--fix")
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert len(installed_stop_commands(codex_path, framework)) == 1


def test_installer_canonicalizes_owned_stop_matcher_and_type(tmp_path: Path) -> None:
    import tomllib

    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    desired = installed_stop_commands(codex_path, framework)[0]
    text = codex_path.read_text(encoding="utf-8")
    canonical = (
        '[[hooks.Stop]]\nmatcher = "*"\n[[hooks.Stop.hooks]]\n'
        f'type = "command"\ncommand = {json.dumps(desired)}'
    )
    broken = (
        '[[hooks.Stop]]\nmatcher = "never"\n[[hooks.Stop.hooks]]\n'
        f'type = "prompt"\ncommand = {json.dumps(desired)}'
    )
    assert canonical in text
    codex_path.write_text(text.replace(canonical, broken, 1), encoding="utf-8")

    repaired = run_installer(home, framework)
    assert repaired.returncode == 0, repaired.stdout + repaired.stderr
    config = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    owned = [
        (group, hook)
        for group in config["hooks"]["Stop"]
        for hook in group.get("hooks", [])
        if hook.get("command") == desired
    ]
    assert len(owned) == 1
    assert owned[0][0].get("matcher") == "*"
    assert owned[0][1].get("type") == "command"

    before = codex_path.read_bytes()
    repeated = run_installer(home, framework)
    assert repeated.returncode == 0, repeated.stdout + repeated.stderr
    assert codex_path.read_bytes() == before


@pytest.mark.parametrize("header", ["[features]", "[features] # retained"])
def test_installer_and_doctor_handle_terminal_features_header_without_newline(
    tmp_path: Path, header: str
) -> None:
    import tomllib

    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    codex_path = home / ".codex" / "config.toml"
    codex_path.write_text(header, encoding="utf-8")

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    config = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert config["features"]["hooks"] is True
    assert ("# retained" in codex_path.read_text(encoding="utf-8")) == ("#" in header)

    codex_path.write_text(header, encoding="utf-8")
    fixed = run_doctor(home, framework, "--quick", "--fix")
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    repaired = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    assert repaired["features"]["hooks"] is True


@pytest.mark.skipif(os.name == "nt", reason="POSIX shell quoting")
def test_installer_quotes_posix_codex_stop_path_with_spaces(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / "framework with space"
    home.mkdir()
    seed_user_configs(home)

    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    command = installed_stop_commands(home / ".codex" / "config.toml", framework)[0]
    assert command.startswith("bash '")
    smoke_workspace = tmp_path / "smoke"
    smoke_workspace.mkdir()
    result = subprocess.run(
        command,
        cwd=smoke_workspace,
        env={**os.environ, "FORGEWRIGHT_WORKSPACE": str(smoke_workspace)},
        input="{}",
        text=True,
        capture_output=True,
        shell=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["continue"] is True


@pytest.mark.skipif(os.name != "nt", reason="native Windows launcher fallback")
def test_codex_windows_hook_falls_back_after_broken_py_launcher(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "py.exe").write_bytes(b"not-an-executable")
    python_link = fake_bin / "python3.exe"
    try:
        os.link(sys.executable, python_link)
    except OSError:
        import shutil

        shutil.copy2(sys.executable, python_link)
    environment = os.environ.copy()
    environment["PATH"] = os.pathsep.join(
        (str(fake_bin), str(Path(sys.executable).parent), environment.get("PATH", ""))
    )
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT / "scripts" / "lite" / "codex-hook-windows.ps1"),
            "-EventName",
            "SessionStart",
            "-ProjectRoot",
            str(ROOT),
        ],
        cwd=ROOT / "kernel",
        env=environment,
        input=json.dumps({"source": "startup"}),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["continue"] is True


@pytest.mark.skipif(os.name != "nt", reason="native Windows Python command names")
def test_installer_and_stop_runtime_accept_python_exe_without_python3(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "python-only-bin"
    fake_bin.mkdir()
    for name in ("python3.13.exe", "python3.12.exe", "python3.11.exe", "python3.exe"):
        (fake_bin / name).write_bytes(b"not-an-executable")
    python_executable = fake_bin / "python.exe"
    try:
        os.link(sys.executable, python_executable)
    except OSError:
        import shutil

        shutil.copy2(sys.executable, python_executable)

    isolated_path = os.pathsep.join(
        (str(fake_bin), str(Path(sys.executable).parent), os.environ.get("PATH", ""))
    )
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(
        home,
        framework,
        extra_env={"PATH": isolated_path},
    )
    assert installed.returncode == 0, installed.stdout + installed.stderr

    smoke_workspace = tmp_path / "python-only-smoke"
    smoke_workspace.mkdir()
    result = subprocess.run(
        [
            BASH,
            str(framework / "scripts" / "lite" / "stop-gate.sh"),
            "--platform",
            "CODEX",
        ],
        cwd=smoke_workspace,
        env={**os.environ, "PATH": isolated_path},
        input="{}",
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["forgewright"]["reason_code"] == "no_code_changes"
