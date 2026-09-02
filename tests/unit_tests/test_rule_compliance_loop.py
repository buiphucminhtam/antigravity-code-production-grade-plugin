from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "lite"))
from evidence_common import (  # noqa: E402
    command_text,
    execution_manifest,
    sha256_text,
    worktree_fingerprint,
)


def run(
    *args: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    stdin: str | None = None,
) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.update(env or {})
    return subprocess.run(
        args,
        cwd=cwd or ROOT,
        env=merged,
        input=stdin,
        text=True,
        capture_output=True,
        check=False,
    )


def policy(tmp_path: Path) -> Path:
    path = tmp_path / "policy.yaml"
    path.write_text(
        """mode: strict
require_verify: true
max_escalations: 3
refresh_interval_ticks: 10
deny_patterns:
  - "git[[:space:]]+reset[[:space:]]+--hard"
""",
        encoding="utf-8",
    )
    return path


def canonical_static_workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    shutil.copytree(ROOT / "kernel", workspace / "kernel")
    return workspace


def run_static_validator(workspace: Path) -> subprocess.CompletedProcess[str]:
    return run(
        "python3",
        str(ROOT / "scripts/lite/rule-validator.py"),
        "--static",
        env={"FORGEWRIGHT_WORKSPACE": str(workspace)},
    )


def write_v2_evidence(tmp_path: Path, *, turn: str = "turn-1") -> tuple[dict, Path]:
    output = "pytest-ref passed\n"
    check_path = tmp_path / "evidence_contract_check.py"
    check_path.write_text("print('pytest-ref passed')\n", encoding="utf-8")
    command = ["python3", "evidence_contract_check.py"]
    refs = ["evidence_contract_check.py"]
    execution, errors = execution_manifest(tmp_path, command, refs)
    assert not errors and execution is not None
    evidence = {
        "schema_version": "2",
        "turn": turn,
        "acceptance_criteria": [
            {
                "id": "acceptance-one",
                "claim": "pytest-ref is verified",
                "test_refs": ["evidence_contract_check.py"],
            }
        ],
        "command": command,
        "execution": execution,
        "tier": "contract",
        "test_refs": refs,
        "negative_paths": ["the check fails when pytest-ref is absent"],
        "negative_path_bindings": [
            {
                "id": "negative-path-1",
                "claim": "the check fails when pytest-ref is absent",
                "acceptance_ids": ["acceptance-one"],
                "test_refs": ["evidence_contract_check.py"],
            }
        ],
        "limitations": [],
        "change_kind": "test",
        "phase": "verification",
        "implementer_id": "codex-implementer",
        "reviewer": {"status": "not_required"},
        "exit_code": 0,
        "output": output,
        "output_sha256": sha256_text(output),
        "output_truncated": False,
        "timestamp_utc": "2026-08-12T00:00:00Z",
        "workspace": str(tmp_path.resolve()),
        "tree_sha": worktree_fingerprint(tmp_path),
    }
    # Use a current timestamp so the test remains deterministic under the
    # repository's one-hour staleness policy.
    from datetime import datetime, timezone

    evidence["timestamp_utc"] = datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    path = tmp_path / ".forgewright" / "verify" / f"{turn}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence), encoding="utf-8")
    return evidence, path


def strict_response(evidence: dict) -> str:
    criterion = evidence["acceptance_criteria"][0]
    return "\n".join(
        [
            "VERIFY:",
            f"ACCEPTANCE: {criterion['id']}",
            f"CLAIM: {criterion['claim']}",
            f"COMMAND: {command_text(evidence['command'])}",
            f"OUTPUT: sha256:{evidence['output_sha256']}",
            "EXIT CODE: 0",
            "VERDICT: PASS",
        ]
    )


def test_policy_fails_closed_for_missing_empty_and_malformed_files(
    tmp_path: Path,
) -> None:
    script = ROOT / "scripts/lite/policy-check.sh"
    cases = [
        tmp_path / "missing.yaml",
        tmp_path / "empty.yaml",
        tmp_path / "bad.yaml",
        tmp_path / "duplicate.yaml",
        tmp_path / "invalid-regex.yaml",
    ]
    cases[1].write_text("", encoding="utf-8")
    cases[2].write_text("mode: definitely-not-valid\n", encoding="utf-8")
    cases[3].write_text(
        policy(tmp_path).read_text(encoding="utf-8") + "mode: strict\n",
        encoding="utf-8",
    )
    cases[4].write_text(
        policy(tmp_path)
        .read_text(encoding="utf-8")
        .replace('"git[[:space:]]+reset[[:space:]]+--hard"', '"[invalid"'),
        encoding="utf-8",
    )

    for path in cases:
        result = run(
            "bash",
            str(script),
            "check",
            "run_command",
            "git status",
            env={
                "FORGEWRIGHT_POLICY_FILE": str(path),
                "FORGEWRIGHT_TELEMETRY_DIR": str(tmp_path / "telemetry"),
            },
        )
        assert result.returncode != 0, (path, result.stdout, result.stderr)


def test_policy_blocks_wrappers_git_global_options_and_split_rm_flags(
    tmp_path: Path,
) -> None:
    script = ROOT / "scripts/lite/policy-check.sh"
    env = {
        "FORGEWRIGHT_POLICY_FILE": str(policy(tmp_path)),
        "FORGEWRIGHT_TELEMETRY_DIR": str(tmp_path / "telemetry"),
    }
    destructive = [
        "command git -C . reset --hard",
        "/usr/bin/env git reset --hard",
        "sudo /usr/bin/git -c advice.detachedHead=false reset --hard",
        "/bin/rm -r -f target",
        "command rm -f -r target",
    ]
    for command in destructive:
        result = run("bash", str(script), "check", "run_command", command, env=env)
        assert result.returncode == 1, (command, result.stdout, result.stderr)


def test_validator_requires_one_complete_adjacent_passing_verify_block(
    tmp_path: Path,
) -> None:
    script = ROOT / "scripts/lite/rule-validator.py"
    ledger = tmp_path / "ledger.jsonl"
    evidence, _ = write_v2_evidence(tmp_path)
    env = {
        "FORGEWRIGHT_RULE_LEDGER": str(ledger),
        "FORGEWRIGHT_WORKSPACE": str(tmp_path),
        "FORGEWRIGHT_TURN": evidence["turn"],
    }
    valid = strict_response(evidence)
    result = run("python3", str(script), "--runtime", env=env, stdin=valid)
    assert result.returncode == 0, result.stderr

    valid_multiline_output = valid.replace(
        f"OUTPUT: sha256:{evidence['output_sha256']}",
        f"OUTPUT: sha256:{evidence['output_sha256']}",
    )
    result = run(
        "python3", str(script), "--runtime", env=env, stdin=valid_multiline_output
    )
    assert result.returncode == 0, result.stderr

    invalid_payloads = [
        "VERIFY:\n",
        "```verify\n" + valid + "\n```",
        valid.replace("ACCEPTANCE: acceptance-one", "ACCEPTANCE: unrelated"),
        valid.replace("CLAIM: pytest-ref is verified", "CLAIM: unrelated claim"),
        valid.replace("OUTPUT: sha256:", "OUTPUT: sha256:" + ("0" * 64)),
        "",
    ]
    for payload in invalid_payloads:
        result = run("python3", str(script), "--runtime", env=env, stdin=payload)
        assert result.returncode != 0, (payload, result.stdout, result.stderr)


def test_validator_accepts_json_hook_payload_and_propagates_ledger_failure(
    tmp_path: Path,
) -> None:
    script = ROOT / "scripts/lite/rule-validator.py"
    evidence, _ = write_v2_evidence(tmp_path, turn="json-turn")
    response = strict_response(evidence)
    payload = json.dumps({"response_content": response, "turn": evidence["turn"]})
    ok = run(
        "python3",
        str(script),
        "--runtime",
        env={
            "FORGEWRIGHT_RULE_LEDGER": str(tmp_path / "ledger.jsonl"),
            "FORGEWRIGHT_WORKSPACE": str(tmp_path),
        },
        stdin=payload,
    )
    assert ok.returncode == 0, ok.stderr

    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("x", encoding="utf-8")
    failed = run(
        "python3",
        str(script),
        "--runtime",
        env={"FORGEWRIGHT_RULE_LEDGER": str(blocked_parent / "ledger.jsonl")},
        stdin="VERIFY:\n",
    )
    assert failed.returncode != 0


def test_static_validator_rejects_manifest_inventory_and_source_mapping_drift(
    tmp_path: Path,
) -> None:
    mutations = {
        "all-entry": lambda rules: [
            rule.update(source="kernel/ENTRY.md") for rule in rules
        ],
        "duplicate-source": lambda rules: rules.__setitem__(
            1, {**rules[1], "source": "kernel/ENTRY.md"}
        ),
        "wrong-source": lambda rules: rules.__setitem__(
            1, {**rules[1], "source": "kernel/VERIFY.md"}
        ),
        "missing-id": lambda rules: rules.pop(5),
        "extra-id": lambda rules: rules.append(
            {
                **rules[0],
                "id": "kernel-extra",
                "source": "kernel/ENTRY.md",
            }
        ),
    }
    for label, mutate in mutations.items():
        workspace = canonical_static_workspace(tmp_path / label)
        manifest_path = workspace / "kernel" / "rule-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        mutate(manifest["rules"])
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        result = run_static_validator(workspace)

        assert result.returncode != 0, (label, result.stdout, result.stderr)
        assert "Static validation failed" in result.stderr


def test_static_validator_rejects_canonical_defaults_platform_and_event_drift(
    tmp_path: Path,
) -> None:
    mutations = {
        "defaults": lambda manifest: manifest["defaults"].update(max_rules=6),
        "platforms": lambda manifest: manifest["rules"][0].update(platforms=["CODEX"]),
        "events": lambda manifest: manifest["rules"][0].update(events=["SessionStart"]),
    }
    for label, mutate in mutations.items():
        workspace = canonical_static_workspace(tmp_path / label)
        manifest_path = workspace / "kernel" / "rule-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        mutate(manifest)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        result = run_static_validator(workspace)

        assert result.returncode != 0, (label, result.stdout, result.stderr)
        assert "Static validation failed" in result.stderr


def test_telemetry_emits_one_redacted_json_object(tmp_path: Path) -> None:
    script = ROOT / "scripts/lite/telemetry.sh"
    result = run(
        "bash",
        str(script),
        "emit",
        "audit.event",
        json.dumps(
            {"token": "super-secret", "nested": {"password": "hidden"}, "ok": True}
        ),
        env={"FORGEWRIGHT_TELEMETRY_DIR": str(tmp_path / "telemetry")},
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["data"] == {
        "token": "***REDACTED***",
        "nested": {"password": "***REDACTED***"},
        "ok": True,
    }
    assert "super-secret" not in result.stdout + result.stderr
    assert "hidden" not in result.stdout + result.stderr


def test_telemetry_rejects_non_object_empty_and_multiple_documents(
    tmp_path: Path,
) -> None:
    script = ROOT / "scripts/lite/telemetry.sh"
    env = {"FORGEWRIGHT_TELEMETRY_DIR": str(tmp_path / "telemetry")}
    for payload in ("", "[]", '"scalar"', "1", "{}\n{}"):
        result = run("bash", str(script), "emit", "audit.event", payload, env=env)
        assert result.returncode != 0, (payload, result.stdout, result.stderr)
        assert result.stdout == ""
    assert not list((tmp_path / "telemetry").glob("*.jsonl"))


def test_ledger_filters_outcomes_and_refresh_shows_recent_violations(
    tmp_path: Path,
) -> None:
    ledger = tmp_path / "ledger.jsonl"
    entries = [
        {"ts": "2026-01-01T00:00:00Z", "rule": "HR1", "outcome": "hit", "note": "ok"},
        {
            "ts": "2026-01-02T00:00:00Z",
            "rule": "HR2",
            "outcome": "violation",
            "note": "old",
        },
        {
            "ts": "2026-01-03T00:00:00Z",
            "rule": "HR3",
            "outcome": "violation",
            "note": "new",
        },
    ]
    ledger.write_text(
        "".join(json.dumps(item) + "\n" for item in entries), encoding="utf-8"
    )
    env = {"FORGEWRIGHT_RULE_LEDGER": str(ledger)}
    top = run(
        "bash",
        str(ROOT / "scripts/lite/rule-ledger.sh"),
        "top",
        "5",
        "violation",
        env=env,
    )
    assert top.returncode == 0
    assert "HR1" not in top.stdout
    assert "HR2" in top.stdout and "HR3" in top.stdout

    refresh = run("bash", str(ROOT / "scripts/lite/rule-refresh.sh"), env=env)
    assert refresh.returncode == 0
    assert refresh.stdout.index("HR3") < refresh.stdout.index("HR2")
    assert "HR1" not in refresh.stdout


def test_context_manager_uses_project_root_tail_keywords_and_global_cap(
    tmp_path: Path,
) -> None:
    fake_root = tmp_path / "project"
    script_dir = fake_root / "scripts" / "lite"
    script_dir.mkdir(parents=True)
    source = ROOT / "scripts/lite/context-manager.py"
    copied = script_dir / source.name
    copied.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    memory = fake_root / ".forgewright" / "memory-bank"
    summary_dir = fake_root / ".forgewright" / "subagent-context"
    memory.mkdir(parents=True)
    summary_dir.mkdir(parents=True)
    (memory / "activeContext.md").write_text("A" * 3000, encoding="utf-8")
    summary = [f"old-{index}" for index in range(30)] + ["LATEST-MARKER"]
    (summary_dir / "CONVERSATION_SUMMARY.md").write_text(
        "\n".join(summary), encoding="utf-8"
    )

    result = run(
        "python3",
        str(copied),
        "load",
        "--keywords",
        "rule routing",
        cwd=tmp_path,
        env={"FORGEWRIGHT_SKIP_MEM0": "1", "FORGEWRIGHT_CONTEXT_CHAR_CAP": "2000"},
    )
    assert result.returncode == 0, result.stderr
    assert "LATEST-MARKER" in result.stdout
    assert "old-0" not in result.stdout
    assert len(result.stdout) <= 2000


def test_canonical_scripts_target_validated_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    fw_dir = workspace / ".forgewright"
    memory_dir = fw_dir / "memory-bank"
    fw_dir.mkdir(parents=True)
    memory_dir.mkdir(parents=True)
    (fw_dir / "execution-policy.yaml").write_text(
        policy(tmp_path).read_text(encoding="utf-8"), encoding="utf-8"
    )
    (memory_dir / "activeContext.md").write_text(
        "FAKE-WORKSPACE-MARKER", encoding="utf-8"
    )
    env = {
        "FORGEWRIGHT_WORKSPACE": str(workspace),
        "FORGEWRIGHT_SKIP_MEM0": "1",
    }

    checked = run(
        "bash",
        str(ROOT / "scripts/lite/policy-check.sh"),
        "check",
        "run_command",
        "git status",
        env=env,
    )
    assert checked.returncode == 0, checked.stderr

    added = run(
        "bash",
        str(ROOT / "scripts/lite/rule-ledger.sh"),
        "add",
        "HR2",
        "hit",
        "workspace",
        env=env,
    )
    assert added.returncode == 0, added.stderr
    ledger = fw_dir / "rule-ledger.jsonl"
    assert ledger.is_file()

    emitted = run(
        "bash",
        str(ROOT / "scripts/lite/telemetry.sh"),
        "emit",
        "workspace.event",
        "{}",
        env=env,
    )
    assert emitted.returncode == 0, emitted.stderr
    assert list((fw_dir / "telemetry").glob("events-*.jsonl"))

    invalid = run(
        "python3",
        str(ROOT / "scripts/lite/rule-validator.py"),
        "--runtime",
        env=env,
        stdin="CLAIM: incomplete\nVERDICT: PASS",
    )
    assert invalid.returncode != 0
    assert "HR1-verify" in ledger.read_text(encoding="utf-8")

    context = run(
        "python3", str(ROOT / "scripts/lite/context-manager.py"), "load", env=env
    )
    assert context.returncode == 0, context.stderr
    assert "FAKE-WORKSPACE-MARKER" in context.stdout


def test_canonical_scripts_reject_invalid_workspace(tmp_path: Path) -> None:
    env = {"FORGEWRIGHT_WORKSPACE": str(tmp_path / "missing-workspace")}
    commands = (
        ("bash", str(ROOT / "scripts/lite/policy-check.sh"), "show"),
        ("bash", str(ROOT / "scripts/lite/rule-ledger.sh"), "top", "1"),
        ("bash", str(ROOT / "scripts/lite/telemetry.sh"), "emit", "test.event", "{}"),
        ("python3", str(ROOT / "scripts/lite/rule-validator.py"), "--runtime"),
        ("python3", str(ROOT / "scripts/lite/context-manager.py"), "load"),
    )
    for command in commands:
        result = run(*command, env=env, stdin="")
        assert result.returncode != 0, (command, result.stdout, result.stderr)


def test_ledger_and_telemetry_concurrent_appends_are_complete(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    env = {"FORGEWRIGHT_WORKSPACE": str(workspace)}
    ledger_script = ROOT / "scripts/lite/rule-ledger.sh"
    telemetry_script = ROOT / "scripts/lite/telemetry.sh"

    def add_ledger(index: int) -> subprocess.CompletedProcess[str]:
        return run(
            "bash",
            str(ledger_script),
            "add",
            f"HR{index}",
            "hit",
            f"note-{index}",
            env=env,
        )

    def add_event(index: int) -> subprocess.CompletedProcess[str]:
        return run(
            "bash",
            str(telemetry_script),
            "emit",
            "parallel.event",
            json.dumps({"i": index}),
            env=env,
        )

    with ThreadPoolExecutor(max_workers=10) as pool:
        ledger_results = list(pool.map(add_ledger, range(20)))
        event_results = list(pool.map(add_event, range(20)))
    assert all(result.returncode == 0 for result in ledger_results)
    assert all(result.returncode == 0 for result in event_results)

    ledger_path = workspace / ".forgewright" / "rule-ledger.jsonl"
    ledger_records = [
        json.loads(line)
        for line in ledger_path.read_text(encoding="utf-8").splitlines()
    ]
    event_path = next((workspace / ".forgewright" / "telemetry").glob("events-*.jsonl"))
    event_records = [
        json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines()
    ]
    assert len(ledger_records) == 20
    assert len(event_records) == 20
    assert not Path(f"{ledger_path}.lock").exists()
    assert not Path(f"{event_path}.lock").exists()


def test_worktree_fingerprint_ignores_runtime_offload_but_not_project_files(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    run("git", "init", "-q", cwd=workspace)
    (workspace / "source.txt").write_text("v1\n", encoding="utf-8")
    run("git", "add", "source.txt", cwd=workspace)
    run(
        "git",
        "-c",
        "user.name=Forgewright Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
        cwd=workspace,
    )

    baseline = worktree_fingerprint(workspace)
    runtime_files = {
        workspace
        / ".forgewright"
        / "offload"
        / "runtime-call"
        / "events.jsonl": "{}\n",
        workspace / "mcp" / ".forgewright" / "verification-events.jsonl": "{}\n",
        workspace
        / "mcp"
        / "node_modules"
        / ".vite"
        / "vitest"
        / "results.json": "{}\n",
        workspace
        / "src"
        / "cli"
        / "node_modules"
        / ".vite"
        / "vitest"
        / "results.json": "{}\n",
    }
    for path, payload in runtime_files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload, encoding="utf-8")
    assert worktree_fingerprint(workspace) == baseline

    (workspace / "source.txt").write_text("v2\n", encoding="utf-8")
    assert worktree_fingerprint(workspace) != baseline


def test_worktree_fingerprint_explicit_exclusion_is_bounded(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace-exclusion"
    workspace.mkdir()
    run("git", "init", "-q", cwd=workspace)
    (workspace / "source.txt").write_text("source\n", encoding="utf-8")
    run("git", "add", "source.txt", cwd=workspace)
    run(
        "git",
        "-c",
        "user.name=Forgewright Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
        cwd=workspace,
    )

    baseline = worktree_fingerprint(workspace, excluded_paths=("generated",))
    generated = workspace / "generated"
    generated.mkdir()
    (generated / "artifact.js").write_text("build-v1\n", encoding="utf-8")
    assert worktree_fingerprint(workspace, excluded_paths=("generated",)) == baseline
    assert worktree_fingerprint(workspace) != baseline

    (workspace / "other.txt").write_text("material\n", encoding="utf-8")
    assert worktree_fingerprint(workspace, excluded_paths=("generated",)) != baseline


def test_isolated_rule_loop_does_not_touch_tracked_runtime_files(
    tmp_path: Path,
) -> None:
    tracked_ledger = ROOT / ".forgewright" / "rule-ledger.jsonl"
    tracked_events = ROOT / ".forgewright" / "telemetry" / "events-202607.jsonl"
    before = {
        path: path.read_bytes() if path.exists() else None
        for path in (tracked_ledger, tracked_events)
    }
    result = run(
        "bash",
        str(ROOT / "scripts/lite/test-rule-loop.sh"),
        env={"TMPDIR": str(tmp_path)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    after = {path: path.read_bytes() if path.exists() else None for path in before}
    assert after == before
