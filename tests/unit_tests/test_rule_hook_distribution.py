import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts" / "bootstrap" / "forgewright-install.sh"
DOCTOR = ROOT / "scripts" / "hooks" / "forgewright-hook-doctor.sh"


def run_installer(home: Path, framework: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    return subprocess.run(
        [
            "bash",
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
        capture_output=True,
        check=False,
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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
    assert str(hook_path) in command
    assert '--event "$event"' in command
    assert '--workspace "$workspace"' in command
    assert "git -C" in command and "rev-parse --show-toplevel" in command
    assert "FORGEWRIGHT_PROJECT_ROOT" in command
    assert "FORGEWRIGHT_WORKSPACE" in command
    assert str(framework) in command
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
                    "PreToolUse": [
                        {
                            "matcher": "*",
                            "hooks": [{"type": "command", "command": "user-security"}],
                        }
                    ]
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
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)

    first = run_installer(home, framework)
    assert first.returncode == 0, first.stdout + first.stderr

    runtime = framework / "scripts" / "lite" / "rule-context-hook.py"
    manifest = framework / "kernel" / "rule-manifest.json"
    assert runtime.is_file() and os.access(runtime, os.X_OK)
    assert manifest.is_file()
    payload = load_json(manifest)
    for rule in payload["rules"]:
        if rule.get("status") == "active" and rule.get("canonical", True):
            assert (framework / rule["source"]).is_file(), rule["source"]

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
    assert any(
        hook.get("command") == "user-security"
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

    codex = (home / ".codex" / "config.toml").read_text(encoding="utf-8")
    assert "user-codex-stop" in codex
    assert codex.count(" CODEX SessionStart || true") == 1
    assert codex.count(" CODEX SubagentStart || true") == 1
    assert str(runtime) in codex and "--workspace" in codex and str(framework) in codex
    assert (
        "FORGEWRIGHT_RULE_HOOK_MODE=" in codex
        and ":-observe" in codex
        and "|| true" in codex
    )

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
        claude_context_command,
        cwd=tmp_path,
        env=off_env,
        input="{}",
        text=True,
        capture_output=True,
        shell=True,
        check=False,
    )
    assert off.returncode == 0, off.stderr
    assert "additionalContext" not in json.loads(off.stdout)


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

    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    diagnose = subprocess.run(
        ["bash", str(DOCTOR), "--quick"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert "Rule context" in diagnose.stdout
    assert diagnose.returncode in (0, 1)

    fixed = subprocess.run(
        ["bash", str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
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


def test_hook_doctor_repairs_missing_framework_runtime(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    (framework / "scripts" / "lite" / "rule-context-hook.py").unlink()
    (framework / "kernel" / "rule-manifest.json").unlink()
    (framework / "kernel" / "ENTRY.md").unlink()

    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    fixed = subprocess.run(
        ["bash", str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert "Rule context runtime repaired" in fixed.stdout
    assert (framework / "scripts" / "lite" / "rule-context-hook.py").is_file()
    assert (framework / "kernel" / "rule-manifest.json").is_file()
    assert (framework / "kernel" / "ENTRY.md").is_file()


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
    codex = codex.replace(
        str(framework / "scripts" / "lite" / "rule-context-hook.py"),
        str(framework / "rule-context-hook.py"),
    )
    codex_path.write_text(codex, encoding="utf-8")

    migrated = run_installer(home, framework)
    assert migrated.returncode == 0, migrated.stdout + migrated.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert str(framework / "rule-context-hook.py") not in result
    assert result.count(" CODEX SessionStart || true") == 1
    assert result.count(" CODEX SubagentStart || true") == 1
    assert str(framework / "scripts" / "lite" / "rule-context-hook.py") in result


def test_installer_preserves_unrelated_verify_and_context_hooks(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)

    unrelated_verify = "bash /opt/team/verify-gate.sh --platform CLAUDE"
    unrelated_context = "python3 /opt/team/rule-context-hook.py --custom"
    claude_path = home / ".claude" / "settings.json"
    claude = load_json(claude_path)
    claude["hooks"]["Stop"].append(
        {"hooks": [{"type": "command", "command": unrelated_verify}]}
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
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    fixed = subprocess.run(
        ["bash", str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
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
    codex_path.write_text(
        codex_path.read_text(encoding="utf-8").replace(
            f"bash {framework / 'scripts' / 'lite' / 'stop-gate.sh'} --platform CODEX",
            unrelated,
        ),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    fixed = subprocess.run(
        ["bash", str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert f'command = "{unrelated}"' in result
    assert (
        f'command = "bash {ROOT / "scripts" / "lite" / "stop-gate.sh"} --platform CODEX"'
        in result
    )


def test_hook_doctor_migrates_trusted_legacy_codex_verify_hook(tmp_path: Path) -> None:
    home = tmp_path / "home"
    framework = home / ".forgewright"
    home.mkdir()
    seed_user_configs(home)
    installed = run_installer(home, framework)
    assert installed.returncode == 0, installed.stdout + installed.stderr

    codex_path = home / ".codex" / "config.toml"
    codex = codex_path.read_text(encoding="utf-8").replace(
        f"bash {framework / 'scripts' / 'lite' / 'stop-gate.sh'} --platform CODEX",
        f"bash {framework / 'verify-gate.sh'} --platform CODEX",
    )
    codex_path.write_text(codex, encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "FORGEWRIGHT_DIR": str(framework),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
        }
    )
    fixed = subprocess.run(
        ["bash", str(DOCTOR), "--quick", "--fix"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert fixed.returncode in (0, 1), fixed.stdout + fixed.stderr
    result = codex_path.read_text(encoding="utf-8")
    assert f"bash {framework / 'verify-gate.sh'} --platform CODEX" not in result
    assert (
        f'command = "bash {ROOT / "scripts" / "lite" / "stop-gate.sh"} --platform CODEX"'
        in result
    )


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
        command,
        cwd=project,
        env=clean_env,
        input="{}",
        text=True,
        capture_output=True,
        shell=True,
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
    codex_path.write_text(
        "[features]\nhooks = true\n\n[hooks]\ntimeout = 2\n\n"
        '[[hooks.Stop]]\nmatcher = "*"\n[[hooks.Stop.hooks]]\n'
        'type = "command"\ncommand = "bash '
        + str(framework / "verify-gate.sh")
        + ' --platform CODEX"\ntimeout = 2\n',
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
        result = subprocess.run(["bash", "-n", str(script)], check=False)
        assert result.returncode == 0, script
