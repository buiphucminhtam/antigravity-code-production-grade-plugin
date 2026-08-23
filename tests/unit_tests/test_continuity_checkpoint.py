import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTINUITY = ROOT / "scripts" / "memory" / "continuity.py"
MEMORY_MIDDLEWARE = ROOT / "scripts" / "memory" / "memory-middleware.py"


def _git_workspace(path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "tests@example.com"], cwd=path, check=True
    )
    subprocess.run(["git", "config", "user.name", "Tests"], cwd=path, check=True)
    (path / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=path, check=True)


def _run(workspace: Path, *args: str, payload: dict | None = None):
    env = {**os.environ, "FORGEWRIGHT_WORKSPACE": str(workspace)}
    return subprocess.run(
        [sys.executable, str(CONTINUITY), *args],
        cwd=workspace,
        env=env,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        check=False,
    )


def _payload() -> dict:
    return {
        "objective": "Finish the bounded harness upgrade",
        "acceptance_ids": ["stop-bounded", "continuity-grounded"],
        "non_goals": ["provider live certification"],
        "plan": [{"step": "verify", "status": "in_progress"}],
        "verified_facts": [
            {
                "claim": "focused RED fixture failed",
                "source": "pytest tests/unit_tests/test_continuity_checkpoint.py",
                "digest": "a" * 64,
                "observed_at": "2026-08-22T00:00:00Z",
            }
        ],
        "assumptions": [],
        "limitations": ["same-OS-user malicious tampering is out of scope"],
        "change_refs": ["scripts/memory/continuity.py"],
        "command_refs": [],
        "evidence_refs": [],
        "blockers": [],
        "next_action": "Run the exact GREEN verifier",
        "owned_process_leases": [],
    }


def test_checkpoint_round_trip_is_project_and_session_scoped(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)

    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "session-a",
        "--turn",
        "turn-1",
        "--reason",
        "material-verifier",
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    checkpoint = json.loads(written.stdout)
    assert checkpoint["schema"] == "forgewright-continuity/v1"
    assert checkpoint["authority"] == "context-only"
    assert checkpoint["session_id"] == "session-a"
    assert checkpoint["workspace_id"]
    assert checkpoint["tree_sha"].startswith("TREE:")
    assert checkpoint["ledger"]["offset"] >= 0

    resumed = _run(workspace, "resume", "--session", "session-a")
    assert resumed.returncode == 0, resumed.stderr
    result = json.loads(resumed.stdout)
    assert result["status"] == "resumable-context"
    assert result["checkpoint"]["checkpoint_hash"] == checkpoint["checkpoint_hash"]
    assert "authorization" not in json.dumps(result).lower()
    assert "completion_state" not in result


def test_resume_fails_fresh_on_cross_project_or_tree_mismatch(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    other = tmp_path / "other"
    workspace.mkdir()
    other.mkdir()
    _git_workspace(workspace)
    _git_workspace(other)
    state_root = tmp_path / "continuity-state"
    env = {**os.environ, "FORGEWRIGHT_CONTINUITY_ROOT": str(state_root)}

    written = subprocess.run(
        [
            sys.executable,
            str(CONTINUITY),
            "checkpoint",
            "--session",
            "shared-session",
            "--turn",
            "turn-1",
            "--reason",
            "handoff",
        ],
        cwd=workspace,
        env={**env, "FORGEWRIGHT_WORKSPACE": str(workspace)},
        input=json.dumps(_payload()),
        text=True,
        capture_output=True,
        check=False,
    )
    assert written.returncode == 0, written.stderr

    cross = subprocess.run(
        [sys.executable, str(CONTINUITY), "resume", "--session", "shared-session"],
        cwd=other,
        env={**env, "FORGEWRIGHT_WORKSPACE": str(other)},
        text=True,
        capture_output=True,
        check=False,
    )
    assert json.loads(cross.stdout)["status"] == "fresh-start"

    (workspace / "README.md").write_text("tree changed\n", encoding="utf-8")
    mismatched = subprocess.run(
        [sys.executable, str(CONTINUITY), "resume", "--session", "shared-session"],
        cwd=workspace,
        env={**env, "FORGEWRIGHT_WORKSPACE": str(workspace)},
        text=True,
        capture_output=True,
        check=False,
    )
    parsed = json.loads(mismatched.stdout)
    assert parsed["status"] == "fresh-start"
    assert "tree_mismatch" in parsed["reasons"]


def test_corrupt_checkpoint_is_quarantined_and_never_injected(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "corrupt-session",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    checkpoint = json.loads(written.stdout)
    path = Path(checkpoint["storage_path"])
    path.write_text("{truncated", encoding="utf-8")

    resumed = _run(workspace, "resume", "--session", "corrupt-session")
    parsed = json.loads(resumed.stdout)
    assert parsed["status"] == "fresh-start"
    assert "corrupt_checkpoint" in parsed["reasons"]
    assert list(path.parent.glob("quarantine/*"))


def _checkpoint_hash(payload: dict) -> str:
    unsigned = dict(payload)
    unsigned.pop("checkpoint_hash", None)
    encoded = json.dumps(
        unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def test_resume_rejects_a_self_valid_checkpoint_with_a_broken_prior_hash(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    first = _run(
        workspace,
        "checkpoint",
        "--session",
        "chain-session",
        "--turn",
        "turn-1",
        "--reason",
        "material-decision",
        payload=_payload(),
    )
    second = _run(
        workspace,
        "checkpoint",
        "--session",
        "chain-session",
        "--turn",
        "turn-2",
        "--reason",
        "material-verifier",
        payload=_payload(),
    )
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    latest = json.loads(second.stdout)
    latest_path = Path(latest["storage_path"])
    tampered = json.loads(latest_path.read_text(encoding="utf-8"))
    tampered["ledger"]["previous_checkpoint_hash"] = "f" * 64
    tampered["checkpoint_hash"] = _checkpoint_hash(tampered)
    latest_path.write_text(json.dumps(tampered), encoding="utf-8")
    head_path = latest_path.parent / "head.json"
    head = json.loads(head_path.read_text(encoding="utf-8"))
    head["checkpoint_hash"] = tampered["checkpoint_hash"]
    head_path.write_text(json.dumps(head), encoding="utf-8")

    resumed = _run(workspace, "resume", "--session", "chain-session")
    parsed = json.loads(resumed.stdout)
    assert parsed["status"] == "fresh-start"
    assert "checkpoint_chain_broken" in parsed["reasons"]


def test_resume_rejects_a_head_that_does_not_bind_the_latest_checkpoint(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "head-session",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    checkpoint = json.loads(written.stdout)
    head_path = Path(checkpoint["storage_path"]).parent / "head.json"
    head = json.loads(head_path.read_text(encoding="utf-8"))
    head["checkpoint_hash"] = "0" * 64
    head_path.write_text(json.dumps(head), encoding="utf-8")

    resumed = _run(workspace, "resume", "--session", "head-session")
    parsed = json.loads(resumed.stdout)
    assert parsed["status"] == "fresh-start"
    assert "checkpoint_head_mismatch" in parsed["reasons"]


def test_checkpoint_redacts_secrets_and_rejects_reasoning_dump_keys(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    payload = _payload()
    payload["objective"] = "Use sk-" + ("x" * 32)
    payload["chain_of_thought"] = "private scratchpad"

    rejected = _run(
        workspace,
        "checkpoint",
        "--session",
        "redaction-session",
        "--turn",
        "turn-1",
        "--reason",
        "material-decision",
        payload=payload,
    )

    assert rejected.returncode != 0
    assert "forbidden_field:chain_of_thought" in rejected.stderr
    assert "sk-" + ("x" * 32) not in rejected.stderr


def test_memory_middleware_defaults_are_workspace_scoped(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    probe = (
        "import importlib.util,json;"
        f"s=importlib.util.spec_from_file_location('memory_middleware',{str(MEMORY_MIDDLEWARE)!r});"
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        "print(json.dumps({'session':str(m.SESSION_FILE),'handover':str(m.HANDOVER_FILE)}))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=workspace,
        env={
            **os.environ,
            "FORGEWRIGHT_WORKSPACE": str(workspace),
            "HOME": str(tmp_path / "home"),
        },
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    paths = json.loads(result.stdout)
    runtime_root = workspace / ".forgewright" / "runtime" / "memory"
    assert Path(paths["session"]).is_relative_to(runtime_root)
    assert Path(paths["handover"]).is_relative_to(runtime_root)


def test_message_tick_does_not_checkpoint_from_simulated_counts(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    memory_root = tmp_path / "memory-root"
    env = {
        **os.environ,
        "FORGEWRIGHT_WORKSPACE": str(workspace),
        "MEMORY_DB_DIR": str(memory_root),
        "MEMORY_CHECKPOINT_INTERVAL": "1",
    }
    started = subprocess.run(
        [sys.executable, str(MEMORY_MIDDLEWARE), "start"],
        cwd=workspace,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert started.returncode == 0, started.stderr
    ticked = subprocess.run(
        [sys.executable, str(MEMORY_MIDDLEWARE), "tick"],
        cwd=workspace,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert ticked.returncode == 0, ticked.stderr
    session = json.loads(
        (memory_root / "current-session.json").read_text(encoding="utf-8")
    )
    assert session["message_count"] == 0
    assert session["checkpoints"] == []
    assert "event-driven" in ticked.stdout.lower()
