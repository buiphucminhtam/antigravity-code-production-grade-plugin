import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GIT_LOCAL_ENV_KEYS = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
)


def load_json(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def hook_commands(groups: list[dict]) -> list[str]:
    return [
        hook["command"]
        for group in groups
        for hook in group.get("hooks", [])
        if hook.get("type") == "command"
    ]


def clean_git_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in GIT_LOCAL_ENV_KEYS:
        environment.pop(key, None)
    return environment


def test_checked_in_claude_stop_hook_uses_native_schema() -> None:
    config = load_json(".claude/settings.json")

    assert "stop" not in config["hooks"]
    assert isinstance(config["hooks"]["Stop"], list)
    commands = hook_commands(config["hooks"]["Stop"])
    assert any("stop-gate.sh --platform CLAUDE" in command for command in commands)


def test_checked_in_gemini_after_agent_preserves_payload_flow() -> None:
    config = load_json(".gemini/settings.json")

    assert isinstance(config["hooks"]["AfterAgent"], list)
    commands = hook_commands(config["hooks"]["AfterAgent"])
    assert any("stop-gate.sh --platform GEMINI" in command for command in commands)

    assert isinstance(config["hooks"]["BeforeTool"], list)
    before_tool = config["hooks"]["BeforeTool"][0]
    assert before_tool["matcher"] == "*"
    hook = before_tool["hooks"][0]
    assert hook["name"] == "forgewright-policy"
    assert hook["type"] == "command"
    assert "gemini-before-tool-gate.sh" in hook["command"]
    assert isinstance(hook["timeout"], int)


def test_checked_in_antigravity_pre_tool_hook_uses_named_hook_schema() -> None:
    config = load_json(".agents/hooks.json")

    named_hook = config["forgewright-policy"]
    assert isinstance(named_hook["PreToolUse"], list)
    group = named_hook["PreToolUse"][0]
    assert group["matcher"] == "*"
    hook = group["hooks"][0]
    assert hook["type"] == "command"
    assert hook["command"] == "bash scripts/lite/antigravity-pre-tool-gate.sh"
    assert isinstance(hook["timeout"], int)
    assert hook["timeout"] > 0


def test_checked_in_cursor_stop_hook_uses_v1_schema() -> None:
    config = load_json(".cursor/hooks.json")

    assert config["version"] == 1
    assert isinstance(config["hooks"]["stop"], list)
    assert any(
        "stop-gate.sh --platform CURSOR" in hook.get("command", "")
        for hook in config["hooks"]["stop"]
    )


def test_checked_in_codex_stop_hook_uses_native_schema() -> None:
    config = tomllib.loads((ROOT / ".codex/config.toml").read_text(encoding="utf-8"))

    assert isinstance(config["hooks"]["Stop"], list)
    commands = hook_commands(config["hooks"]["Stop"])
    assert any("stop-gate.sh --platform CODEX" in command for command in commands)


def test_global_codex_stop_gate_defers_to_project_gate(tmp_path: Path) -> None:
    clean_git_workspace(tmp_path)
    project_config = tmp_path / ".codex" / "config.toml"
    project_config.parent.mkdir(parents=True)
    project_config.write_text(
        """[features]
hooks = true

[hooks]

[[hooks.Stop]]
matcher = "*"
[[hooks.Stop.hooks]]
type = "command"
command = "bash scripts/lite/stop-gate.sh --platform CODEX"
""",
        encoding="utf-8",
    )

    fake_home = tmp_path / "home"
    global_lite = fake_home / ".forgewright" / "scripts" / "lite"
    global_lite.mkdir(parents=True)
    global_gate = global_lite / "stop-gate.sh"
    shutil.copy2(ROOT / "scripts" / "lite" / "stop-gate.sh", global_gate)

    env = clean_git_environment()
    env["HOME"] = str(fake_home)
    env["FORGEWRIGHT_DIR"] = str(fake_home / ".forgewright")
    payload = json.dumps(
        {
            "last_assistant_message": "No verification block in this response.",
            "turn_id": "duplicate-stop-turn",
        }
    )
    result = subprocess.run(
        ["bash", str(global_gate), "--platform", "CODEX"],
        cwd=tmp_path,
        env=env,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"continue": True}


def clean_git_workspace(path: Path) -> None:
    git_env = clean_git_environment()

    subprocess.run(["git", "init", "-q"], cwd=path, env=git_env, check=True)
    subprocess.run(
        ["git", "config", "user.email", "tests@example.com"],
        cwd=path,
        env=git_env,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Tests"], cwd=path, env=git_env, check=True
    )
    (path / "README.md").write_text("test\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=path, env=git_env, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "fixture"], cwd=path, env=git_env, check=True
    )


def run_stop_gate(
    tmp_path: Path,
    platform: str,
    response: str,
    files: list[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    clean_git_workspace(tmp_path)
    response_field = (
        "last_assistant_message" if platform == "CLAUDE" else "response_content"
    )
    payload = json.dumps({response_field: response, "files": files or []})
    env = clean_git_environment()
    env["FORGEWRIGHT_RULE_LEDGER"] = str(tmp_path / "rule-ledger.jsonl")
    return subprocess.run(
        ["bash", str(ROOT / "scripts/lite/stop-gate.sh"), "--platform", platform],
        cwd=tmp_path,
        env=env,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )


VALID_VERIFY = """CLAIM: hooks are valid
COMMAND: python3 -m pytest
OUTPUT: 4 passed
EXIT CODE: 0
VERDICT: PASS
"""


def test_stop_gate_accepts_valid_no_code_payload(tmp_path: Path) -> None:
    result = run_stop_gate(tmp_path, "CLAUDE", "No code changes were made.")

    assert result.returncode == 0


def test_stop_gate_accepts_plain_no_code_response_without_verify(
    tmp_path: Path,
) -> None:
    result = run_stop_gate(
        tmp_path, "CLAUDE", "I need the target environment before continuing."
    )

    assert result.returncode == 0


def test_stop_gate_blocks_incomplete_verify_even_without_code_changes(
    tmp_path: Path,
) -> None:
    result = run_stop_gate(tmp_path, "CURSOR", "CLAIM: incomplete")

    assert result.returncode != 0


def test_verify_gate_blocks_code_change_without_verify_marker(tmp_path: Path) -> None:
    result = run_stop_gate(
        tmp_path,
        "CLAUDE",
        "Implemented the requested change.",
        files=["src/app.ts"],
    )

    assert result.returncode == 2
    assert "VERIFY-GATE" in result.stderr
    assert "Rule validation rejected" not in result.stderr


def test_claude_incomplete_claim_blocks_with_native_exit_code(tmp_path: Path) -> None:
    result = run_stop_gate(tmp_path, "CLAUDE", "CLAIM: incomplete")

    assert result.returncode == 2


def test_codex_stop_gate_emits_one_parseable_continue_json(tmp_path: Path) -> None:
    result = run_stop_gate(tmp_path, "CODEX", "No code changes were made.")

    assert result.returncode == 0
    assert json.loads(result.stdout) == {
        "continue": True,
        "forgewright": {
            "schema": "forgewright-stop-decision/v1",
            "host_action": "allow_stop",
            "completion_state": "verified",
            "retry_suppressed": False,
            "reason_code": "no_code_changes",
        },
    }


def test_codex_plain_no_code_response_emits_continue_json(tmp_path: Path) -> None:
    result = run_stop_gate(tmp_path, "CODEX", "Waiting for the requested log file.")

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["continue"] is True
    assert payload["forgewright"] == {
        "schema": "forgewright-stop-decision/v1",
        "host_action": "allow_stop",
        "completion_state": "verified",
        "retry_suppressed": False,
        "reason_code": "no_code_changes",
    }


def test_codex_stop_gate_emits_one_parseable_block_json(tmp_path: Path) -> None:
    result = run_stop_gate(tmp_path, "CODEX", "CLAIM: incomplete")

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["decision"] == "block"
    assert "validator" in payload["reason"].lower()


def test_codex_stop_gate_surfaces_bounded_redacted_evidence_reason(
    tmp_path: Path,
) -> None:
    fake_secret = "sk-" + ("a" * 32)
    result = run_stop_gate(
        tmp_path,
        "CODEX",
        f"{VALID_VERIFY}\nDiagnostic fixture: {fake_secret}",
        files=["src/app.ts"],
    )

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["decision"] == "block"
    assert (
        payload["reason"] == "Forgewright rule validator rejected the response payload."
    )
    assert len(payload["reason"]) <= 512
    assert fake_secret not in payload["reason"]


def test_codex_stop_gate_bounds_evidence_stderr_input(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    clean_git_workspace(workspace)

    scripts_dir = tmp_path / "scripts" / "lite"
    shutil.copytree(ROOT / "scripts/lite", scripts_dir)
    fake_secret = "sk-" + ("z" * 32)
    (scripts_dir / "verify-gate.sh").write_text(
        """#!/usr/bin/env bash
python3 - "$1" <<'PYEOF'
import json
import sys

sys.stderr.write("x" * 65536)
sys.stderr.write("\\nMISSING: hidden diagnostic " + "sk-" + ("z" * 32))
print(json.dumps({"decision": "block", "reason": "fixture"}))
PYEOF
""",
        encoding="utf-8",
    )

    payload = json.dumps({"response_content": VALID_VERIFY, "files": ["src/app.ts"]})
    env = clean_git_environment()
    env["FORGEWRIGHT_RULE_LEDGER"] = str(workspace / "rule-ledger.jsonl")
    result = subprocess.run(
        ["bash", str(scripts_dir / "stop-gate.sh"), "--platform", "CODEX"],
        cwd=workspace,
        env=env,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    parsed = json.loads(result.stdout)
    assert parsed["decision"] == "block"
    assert parsed["reason"] == (
        "Forgewright rule validator rejected the response payload."
    )
    assert len(parsed["reason"]) <= 512
    assert fake_secret not in parsed["reason"]


def test_codex_stop_gate_rejects_oversized_payload_with_parseable_json(
    tmp_path: Path,
) -> None:
    result = run_stop_gate(tmp_path, "CODEX", "x" * 1_048_577)

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "block"


def write_policy(workspace: Path, *, malformed: bool = False) -> None:
    policy_dir = workspace / ".forgewright"
    policy_dir.mkdir(exist_ok=True)
    if malformed:
        content = "mode: broken\n"
    else:
        content = (ROOT / ".forgewright/execution-policy.yaml").read_text(
            encoding="utf-8"
        )
    (policy_dir / "execution-policy.yaml").write_text(content, encoding="utf-8")


def run_gemini_before_tool(
    tmp_path: Path,
    payload: dict,
    *,
    malformed_policy: bool = False,
) -> subprocess.CompletedProcess[str]:
    write_policy(tmp_path, malformed=malformed_policy)
    return subprocess.run(
        ["bash", str(ROOT / "scripts/lite/gemini-before-tool-gate.sh")],
        cwd=tmp_path,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )


def test_gemini_before_tool_allows_safe_command_with_json(tmp_path: Path) -> None:
    result = run_gemini_before_tool(
        tmp_path,
        {"tool_name": "run_shell_command", "tool_input": {"command": "echo safe"}},
    )

    assert result.returncode == 0
    assert json.loads(result.stdout) == {}


def test_gemini_before_tool_denies_destructive_command_without_echoing_input(
    tmp_path: Path,
) -> None:
    dangerous = "rm -rf /tmp/example"
    result = run_gemini_before_tool(
        tmp_path,
        {"tool_name": "run_shell_command", "tool_input": {"command": dangerous}},
    )

    assert result.returncode == 2
    assert result.stdout == ""
    assert dangerous not in result.stderr


def test_gemini_before_tool_fails_closed_on_bad_payload_or_policy(
    tmp_path: Path,
) -> None:
    bad_payload = run_gemini_before_tool(
        tmp_path, {"tool_input": {"command": "echo safe"}}
    )
    bad_policy = run_gemini_before_tool(
        tmp_path,
        {"tool_name": "run_shell_command", "tool_input": {"command": "echo safe"}},
        malformed_policy=True,
    )

    assert bad_payload.returncode == 2
    assert bad_policy.returncode == 2


def run_antigravity_pre_tool(
    tmp_path: Path,
    payload: dict | str,
    *,
    malformed_policy: bool = False,
) -> subprocess.CompletedProcess[str]:
    write_policy(tmp_path, malformed=malformed_policy)
    stdin = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run(
        ["bash", str(ROOT / "scripts/lite/antigravity-pre-tool-gate.sh")],
        cwd=tmp_path,
        input=stdin,
        text=True,
        capture_output=True,
        check=False,
    )


def antigravity_payload(tmp_path: Path, args: dict) -> dict:
    return {
        "workspacePaths": [str(tmp_path)],
        "toolCall": {"name": "run_command", "args": args},
    }


def test_antigravity_pre_tool_allows_safe_command(tmp_path: Path) -> None:
    result = run_antigravity_pre_tool(
        tmp_path,
        antigravity_payload(tmp_path, {"command": "echo safe"}),
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "allow"


def test_antigravity_pre_tool_selects_workspace_with_policy(tmp_path: Path) -> None:
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    payload = antigravity_payload(tmp_path, {"command": "echo safe"})
    payload["workspacePaths"] = [str(unrelated), str(tmp_path)]

    result = run_antigravity_pre_tool(tmp_path, payload)

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "allow"


def test_antigravity_pre_tool_uses_cwd_when_runtime_omits_workspace_paths(
    tmp_path: Path,
) -> None:
    write_policy(tmp_path)
    hook_cwd = tmp_path / "hook-cwd"
    hook_cwd.mkdir()
    payload = {
        "cwd": str(tmp_path),
        "toolCall": {"name": "run_command", "args": {"command": "echo safe"}},
    }

    result = subprocess.run(
        ["bash", str(ROOT / "scripts/lite/antigravity-pre-tool-gate.sh")],
        cwd=hook_cwd,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "allow"


def test_antigravity_pre_tool_uses_delegated_workspace_context(
    tmp_path: Path,
) -> None:
    write_policy(tmp_path)
    hook_cwd = tmp_path / "hook-cwd"
    hook_cwd.mkdir()
    payload = {
        "workspacePaths": [],
        "toolCall": {"name": "run_command", "args": {"command": "echo safe"}},
    }

    result = subprocess.run(
        ["bash", str(ROOT / "scripts/lite/antigravity-pre-tool-gate.sh")],
        cwd=hook_cwd,
        env={**os.environ, "FORGEWRIGHT_WORKSPACE": str(tmp_path)},
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "allow"


def test_antigravity_pre_tool_denies_destructive_command_without_leaking_payload(
    tmp_path: Path,
) -> None:
    secret = "secret-token-rm -rf /tmp/example"
    result = run_antigravity_pre_tool(
        tmp_path,
        antigravity_payload(tmp_path, {"command": secret}),
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "deny"
    assert secret not in result.stdout
    assert secret not in result.stderr


def test_antigravity_pre_tool_compacts_non_command_args_for_policy(
    tmp_path: Path,
) -> None:
    result = run_antigravity_pre_tool(
        tmp_path,
        antigravity_payload(tmp_path, {"CommandLine": "rm -rf /tmp/example"}),
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "deny"


def test_antigravity_pre_tool_maps_policy_warning_to_force_ask(tmp_path: Path) -> None:
    write_policy(tmp_path)
    policy = tmp_path / ".forgewright/execution-policy.yaml"
    policy.write_text(
        policy.read_text(encoding="utf-8").replace("mode: strict", "mode: permissive"),
        encoding="utf-8",
    )
    payload = antigravity_payload(tmp_path, {"cmd": "rm -rf /tmp/example"})
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/lite/antigravity-pre-tool-gate.sh")],
        cwd=tmp_path,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "force_ask"


def test_antigravity_pre_tool_fails_closed_on_bad_input_and_policy(
    tmp_path: Path,
) -> None:
    malformed = run_antigravity_pre_tool(tmp_path, "not-json")
    missing_fields = run_antigravity_pre_tool(tmp_path, {"toolCall": {}})
    bad_policy = run_antigravity_pre_tool(
        tmp_path,
        antigravity_payload(tmp_path, {"command": "echo safe"}),
        malformed_policy=True,
    )

    for result in (malformed, missing_fields, bad_policy):
        assert result.returncode == 0
        assert json.loads(result.stdout)["decision"] == "deny"


def test_antigravity_pre_tool_rejects_oversized_payload(tmp_path: Path) -> None:
    result = run_antigravity_pre_tool(tmp_path, "x" * 1_048_577)

    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "deny"
