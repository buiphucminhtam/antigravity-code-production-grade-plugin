import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
CONTINUITY = ROOT / "scripts" / "memory" / "continuity.py"
MEMORY_MIDDLEWARE = ROOT / "scripts" / "memory" / "memory-middleware.py"


def _symlink_or_skip(
    link: Path, target: Path, *, target_is_directory: bool = False
) -> None:
    try:
        link.symlink_to(target, target_is_directory=target_is_directory)
    except OSError as error:
        if os.name == "nt" and getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows symlink privilege is unavailable")
        raise


def _windows_junction(link: Path, target: Path) -> None:
    created = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert created.returncode == 0, created.stderr or created.stdout


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


@pytest.mark.skipif(os.name != "nt", reason="native Windows lock backend")
def test_concurrent_checkpoint_writers_preserve_one_chain(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    state_root = tmp_path / "continuity-state"
    environment = {
        **os.environ,
        "FORGEWRIGHT_WORKSPACE": str(workspace),
        "FORGEWRIGHT_CONTINUITY_ROOT": str(state_root),
    }
    processes = [
        subprocess.Popen(
            [
                sys.executable,
                str(CONTINUITY),
                "checkpoint",
                "--session",
                "concurrent-session",
                "--turn",
                f"turn-{index}",
                "--reason",
                "handoff",
            ],
            cwd=workspace,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for index in range(6)
    ]
    results = [
        process.communicate(json.dumps(_payload()), timeout=30) for process in processes
    ]

    assert all(process.returncode == 0 for process in processes), results
    checkpoints = [json.loads(stdout) for stdout, _stderr in results]
    assert sorted(checkpoint["sequence"] for checkpoint in checkpoints) == list(
        range(1, 7)
    )
    resumed = subprocess.run(
        [
            sys.executable,
            str(CONTINUITY),
            "resume",
            "--session",
            "concurrent-session",
        ],
        cwd=workspace,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    assert resumed.returncode == 0, resumed.stderr
    assert json.loads(resumed.stdout)["checkpoint"]["sequence"] == 6


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


def test_semantic_boundary_checkpoint_and_nonsemantic_reason_rejection(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)

    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "semantic-session",
        "--turn",
        "turn-1",
        "--reason",
        "pre-compaction",
        "--boundary",
        "pre-compaction",
        "--max-steps",
        "2",
        "--max-tool-calls",
        "3",
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    checkpoint = json.loads(written.stdout)
    assert checkpoint["semantic_boundary"] == "pre-compaction"
    assert checkpoint["continuation"]["max_steps"] == 2
    assert checkpoint["authority"] == "context-only"

    rejected = _run(
        workspace,
        "checkpoint",
        "--session",
        "timer-session",
        "--turn",
        "turn-1",
        "--reason",
        "timer",
        payload=_payload(),
    )
    assert rejected.returncode == 2
    assert "non_semantic_checkpoint_reason" in rejected.stderr


def test_bounded_continuation_consumes_cumulatively_and_rejects_replay_overrun(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "budget-session",
        "--turn",
        "turn-1",
        "--reason",
        "step-boundary",
        "--max-steps",
        "2",
        "--max-tool-calls",
        "3",
        payload=_payload(),
    )
    checkpoint = json.loads(written.stdout)
    checkpoint_hash = checkpoint["checkpoint_hash"]
    nonce = checkpoint["continuation"]["nonce"]

    first = _run(
        workspace,
        "consume",
        "--session",
        "budget-session",
        "--checkpoint-hash",
        checkpoint_hash,
        "--nonce",
        nonce,
        "--request-id",
        "request-1",
        "--steps",
        "1",
        "--tool-calls",
        "1",
    )
    assert first.returncode == 0, first.stderr
    assert json.loads(first.stdout)["remaining_steps"] == 1

    second = _run(
        workspace,
        "consume",
        "--session",
        "budget-session",
        "--checkpoint-hash",
        checkpoint_hash,
        "--nonce",
        nonce,
        "--request-id",
        "request-2",
        "--steps",
        "1",
        "--tool-calls",
        "1",
    )
    assert second.returncode == 0, second.stderr
    assert json.loads(second.stdout)["remaining_steps"] == 0

    wrong_nonce = _run(
        workspace,
        "consume",
        "--session",
        "budget-session",
        "--checkpoint-hash",
        checkpoint_hash,
        "--nonce",
        "f" * 64,
        "--request-id",
        "wrong-nonce",
        "--steps",
        "0",
        "--tool-calls",
        "1",
    )
    assert wrong_nonce.returncode == 2
    assert "continuation_nonce_mismatch" in wrong_nonce.stderr

    replay = _run(
        workspace,
        "consume",
        "--session",
        "budget-session",
        "--checkpoint-hash",
        checkpoint_hash,
        "--nonce",
        nonce,
        "--request-id",
        "request-2",
        "--steps",
        "0",
        "--tool-calls",
        "1",
    )
    assert replay.returncode == 2
    assert "continuation_replay" in replay.stderr

    overrun = _run(
        workspace,
        "consume",
        "--session",
        "budget-session",
        "--checkpoint-hash",
        checkpoint_hash,
        "--nonce",
        nonce,
        "--request-id",
        "request-3",
        "--steps",
        "1",
        "--tool-calls",
        "0",
    )
    assert overrun.returncode == 2
    assert "continuation_overrun" in overrun.stderr

    resumed = _run(workspace, "resume", "--session", "budget-session")
    assert json.loads(resumed.stdout)["remaining_budget"] == {
        "steps": 0,
        "tool_calls": 1,
    }


def test_trajectory_binding_and_receipt_corruption_fail_fresh(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    trajectory_args = [
        "--trajectory-id",
        "trajectory-1",
        "--writer-epoch",
        "3",
        "--trajectory-offset",
        "7",
        "--trajectory-head-hash",
        "b" * 64,
        "--capability-hash",
        "c" * 64,
    ]
    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "trajectory-session",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        "--max-steps",
        "2",
        "--max-tool-calls",
        "2",
        *trajectory_args,
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    checkpoint = json.loads(written.stdout)
    matched = _run(
        workspace, "resume", "--session", "trajectory-session", *trajectory_args
    )
    assert json.loads(matched.stdout)["status"] == "resumable-context"
    mismatched = _run(
        workspace,
        "resume",
        "--session",
        "trajectory-session",
        *trajectory_args[:-1],
        "d" * 64,
    )
    parsed = json.loads(mismatched.stdout)
    assert parsed["status"] == "fresh-start"
    assert "trajectory_mismatch" in parsed["reasons"]

    consumed = _run(
        workspace,
        "consume",
        "--session",
        "trajectory-session",
        "--checkpoint-hash",
        checkpoint["checkpoint_hash"],
        "--nonce",
        checkpoint["continuation"]["nonce"],
        "--request-id",
        "request-1",
        "--steps",
        "1",
        "--tool-calls",
        "0",
        *trajectory_args,
    )
    assert consumed.returncode == 0, consumed.stderr
    receipt = next(
        Path(checkpoint["storage_path"]).parent.glob("receipts/*/receipt-*.json")
    )
    receipt.write_text("{}", encoding="utf-8")
    corrupt = _run(
        workspace, "resume", "--session", "trajectory-session", *trajectory_args
    )
    corrupt_result = json.loads(corrupt.stdout)
    assert corrupt_result["status"] == "fresh-start"
    assert "continuation_receipt_corrupt" in corrupt_result["reasons"]


def test_continuation_expiry_fails_fresh(tmp_path: Path) -> None:
    import time

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "expiry-session",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        "--max-steps",
        "1",
        "--ttl-seconds",
        "1",
        payload=_payload(),
    )
    assert written.returncode == 0, written.stderr
    time.sleep(1.05)
    resumed = _run(workspace, "resume", "--session", "expiry-session")
    parsed = json.loads(resumed.stdout)
    assert parsed["status"] == "fresh-start"
    assert "checkpoint_expired" in parsed["reasons"]


def test_continuity_rejects_symlinked_roots_and_sessions(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    external = tmp_path / "external"
    external.mkdir()
    linked_root = tmp_path / "linked-root"
    _symlink_or_skip(linked_root, external, target_is_directory=True)
    rejected_root = subprocess.run(
        [
            sys.executable,
            str(CONTINUITY),
            "checkpoint",
            "--session",
            "linked-session",
            "--turn",
            "turn-1",
            "--reason",
            "handoff",
        ],
        cwd=workspace,
        env={
            **os.environ,
            "FORGEWRIGHT_WORKSPACE": str(workspace),
            "FORGEWRIGHT_CONTINUITY_ROOT": str(linked_root / "nested"),
        },
        input=json.dumps(_payload()),
        text=True,
        capture_output=True,
        check=False,
    )
    assert rejected_root.returncode == 2
    assert "continuity_root_symlink" in rejected_root.stderr
    assert list(external.iterdir()) == []

    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "session-link",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    checkpoint = json.loads(written.stdout)
    session_dir = Path(checkpoint["storage_path"]).parent
    moved = tmp_path / "moved-session"
    session_dir.rename(moved)
    _symlink_or_skip(session_dir, moved, target_is_directory=True)
    rejected_session = _run(
        workspace,
        "checkpoint",
        "--session",
        "session-link",
        "--turn",
        "turn-2",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    assert rejected_session.returncode == 2
    assert "continuity_session_symlink" in rejected_session.stderr


@pytest.mark.skipif(os.name != "nt", reason="Windows junction semantics")
def test_continuity_rejects_junctioned_roots_and_sessions(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    external = tmp_path / "external"
    external.mkdir()
    linked_root = tmp_path / "linked-root"
    _windows_junction(linked_root, external)
    try:
        rejected_root = subprocess.run(
            [
                sys.executable,
                str(CONTINUITY),
                "checkpoint",
                "--session",
                "linked-session",
                "--turn",
                "turn-1",
                "--reason",
                "handoff",
            ],
            cwd=workspace,
            env={
                **os.environ,
                "FORGEWRIGHT_WORKSPACE": str(workspace),
                "FORGEWRIGHT_CONTINUITY_ROOT": str(linked_root / "nested"),
            },
            input=json.dumps(_payload()),
            text=True,
            capture_output=True,
            check=False,
        )
        assert rejected_root.returncode == 2
        assert "continuity_root_symlink" in rejected_root.stderr
        assert list(external.iterdir()) == []
    finally:
        linked_root.rmdir()

    written = _run(
        workspace,
        "checkpoint",
        "--session",
        "session-link",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    checkpoint = json.loads(written.stdout)
    session_dir = Path(checkpoint["storage_path"]).parent
    moved = tmp_path / "moved-session"
    session_dir.rename(moved)
    _windows_junction(session_dir, moved)
    try:
        rejected_session = _run(
            workspace,
            "checkpoint",
            "--session",
            "session-link",
            "--turn",
            "turn-2",
            "--reason",
            "handoff",
            payload=_payload(),
        )
        assert rejected_session.returncode == 2
        assert "continuity_session_symlink" in rejected_session.stderr
    finally:
        session_dir.rmdir()


def test_continuity_rejects_oversized_reads(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _git_workspace(workspace)
    safe = _run(
        workspace,
        "checkpoint",
        "--session",
        "oversized-session",
        "--turn",
        "turn-1",
        "--reason",
        "handoff",
        payload=_payload(),
    )
    safe_checkpoint = json.loads(safe.stdout)
    Path(safe_checkpoint["storage_path"]).write_bytes(b"{" + b"x" * (65 * 1024))
    oversized = _run(workspace, "resume", "--session", "oversized-session")
    oversized_result = json.loads(oversized.stdout)
    assert oversized_result["status"] == "fresh-start"
    assert "corrupt_checkpoint" in oversized_result["reasons"]
