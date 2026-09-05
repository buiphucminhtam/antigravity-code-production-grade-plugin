import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "runtime"))
from agent_loop_replay import (  # noqa: E402
    Journal,
    JournalError,
    ReplayCursor,
    digest,
    normalize,
)


def _start(
    journal: Journal,
    project_id: str = "project",
    tools: list[dict] | None = None,
) -> None:
    catalog = tools or []
    binding = {
        "project_id": project_id,
        "workspace_digest": digest("workspace"),
        "task_digest": digest("task"),
    }
    journal.append("lifecycle.event", {"phase": "runtime.started", **binding})
    journal.append(
        "loop.started",
        {
            **binding,
            "tool_count": len(catalog),
            "tool_schema_bytes": 2,
            "tools": catalog,
        },
    )


def _complete(journal: Journal, turn: int = 1, total_tool_calls: int = 0) -> None:
    journal.append(
        "checkpoint.boundary",
        {
            "boundary": "before-model",
            "turn": turn,
            "total_tool_calls": total_tool_calls,
            "steps": 1,
            "tool_calls": 0,
            "checkpoint_status": "checkpointed",
        },
    )
    journal.append(
        "model.request",
        {
            "turn": turn,
            "messages_digest": digest("messages"),
            "tools_digest": digest("tools"),
        },
    )
    journal.append(
        "model.response",
        {
            "content_digest": digest("done"),
            "content_bytes": 4,
            "content_present": True,
            "tool_calls": [],
        },
    )
    payload = {
        "turn": turn,
        "total_tool_calls": total_tool_calls,
        "final_digest": digest("done"),
    }
    journal.append("lifecycle.event", {"phase": "runtime.completed", **payload})
    journal.append("loop.completed", payload)


def test_roundtrip_strict_replay_and_provider_normalization(tmp_path: Path):
    journal = Journal(tmp_path, "loop-a")
    _start(journal)
    journal.append(
        "checkpoint.boundary",
        {
            "boundary": "before-model",
            "turn": 1,
            "total_tool_calls": 0,
            "steps": 1,
            "tool_calls": 0,
            "checkpoint_status": "checkpointed",
        },
    )
    journal.append(
        "model.request",
        {
            "turn": 1,
            "messages_digest": digest("messages"),
            "tools_digest": digest("tools"),
        },
    )
    response = {
        "content_digest": digest("safe output"),
        "content_bytes": 11,
        "content_present": True,
        "tool_calls": [
            {
                "id": "call-1",
                "name": "read_file",
                "arguments_digest": digest({"path": "safe.txt"}),
                "arguments_bytes": 19,
            }
        ],
    }
    journal.append("model.response", response)
    cursor = ReplayCursor(journal.read())
    cursor.take("lifecycle.event")
    cursor.take("loop.started")
    cursor.take("checkpoint.boundary")
    cursor.take("model.request")
    assert cursor.take("model.response")["tool_calls"][0]["name"] == "read_file"
    cursor.finish()
    assert len(journal.fixture_fingerprint()) == 64


def test_rejects_missing_extra_reordered_tampered_secret_oversize_and_symlink(
    tmp_path: Path,
):
    journal = Journal(tmp_path / "valid", "loop-a")
    _start(journal)
    cursor = ReplayCursor(journal.read())
    with pytest.raises(JournalError, match="mismatch"):
        cursor.expect("tool.request", {})
    with pytest.raises(JournalError, match="extra"):
        ReplayCursor(journal.read()).finish()
    with pytest.raises(JournalError, match="missing"):
        ReplayCursor([]).expect("loop.started", {})

    secret = Journal(tmp_path / "secret", "loop-a")
    with pytest.raises(JournalError, match="secret"):
        secret.append(
            "lifecycle.event",
            {
                "phase": "runtime.started",
                "project_id": "password=private-value",
                "workspace_digest": digest("workspace"),
                "task_digest": digest("task"),
            },
        )

    oversize = Journal(tmp_path / "oversize", "loop-a")
    with pytest.raises(JournalError, match="size"):
        oversize.append(
            "lifecycle.event",
            {
                "phase": "runtime.started",
                "project_id": "x" * 70000,
                "workspace_digest": digest("workspace"),
                "task_digest": digest("task"),
            },
        )

    with pytest.raises(JournalError, match="non_json"):
        normalize({"ratio": 1.25})

    journal.path.write_text("{bad}\n", encoding="utf-8")
    with pytest.raises(JournalError, match="corrupt"):
        journal.read()

    if os.name != "nt":
        outside = tmp_path / "outside.jsonl"
        outside.write_text("{}\n", encoding="utf-8")
        symlink_dir = tmp_path / "symlink"
        symlink_dir.mkdir()
        (symlink_dir / "loop-b.jsonl").symlink_to(outside)
        with pytest.raises(JournalError, match="symlink"):
            Journal(symlink_dir, "loop-b")


def test_exact_schema_state_machine_line_limit_and_whole_loop_lease(tmp_path: Path):
    journal = Journal(tmp_path / "leased", "loop-a")
    competing = Journal(tmp_path / "leased", "loop-a")
    journal.begin_record()
    with pytest.raises(JournalError, match="in_use"):
        competing.begin_record()
    _start(journal)
    _complete(journal)
    journal.end_record()
    with pytest.raises(JournalError, match="not_fresh"):
        competing.begin_record()
    with pytest.raises(JournalError, match="sequence"):
        journal.append(
            "lifecycle.event",
            {
                "phase": "runtime.started",
                "project_id": "project",
                "workspace_digest": digest("workspace"),
                "task_digest": digest("task"),
            },
        )

    schema = Journal(tmp_path / "schema", "loop-a")
    with pytest.raises(JournalError, match="payload_schema"):
        schema.append("model.response", {"content": "raw private content"})

    line = Journal(tmp_path / "line", "loop-a")
    line.path.write_bytes(b"x" * 70000)
    with pytest.raises(JournalError, match="size"):
        line.read()


def test_tool_approval_and_evidence_event_order_is_strict(tmp_path: Path):
    journal = Journal(tmp_path, "loop-a")
    tool = {
        "exposed_name": "tool",
        "original_name": "fw_request_gate_approval",
        "server_name": "forgewright",
        "description_digest": digest("description"),
        "description_bytes": 11,
        "parameters_digest": digest({}),
        "parameters_bytes": 2,
    }
    _start(journal, tools=[tool])
    journal.append(
        "checkpoint.boundary",
        {
            "boundary": "before-model",
            "turn": 1,
            "total_tool_calls": 0,
            "steps": 1,
            "tool_calls": 0,
            "checkpoint_status": "checkpointed",
        },
    )
    journal.append(
        "model.request",
        {
            "turn": 1,
            "messages_digest": digest("messages"),
            "tools_digest": digest("tools"),
        },
    )
    journal.append(
        "model.response",
        {
            "content_digest": digest(""),
            "content_bytes": 0,
            "content_present": False,
            "tool_calls": [
                {
                    "id": "call-1",
                    "name": "tool",
                    "arguments_digest": digest({}),
                    "arguments_bytes": 2,
                }
            ],
        },
    )
    output_digest = digest("ok")
    ordered = [
        (
            "tool.request",
            {"turn": 1, "index": 1, "tool": "tool", "arguments_digest": digest({})},
        ),
        (
            "checkpoint.boundary",
            {
                "boundary": "before-effect",
                "turn": 1,
                "total_tool_calls": 1,
                "steps": 0,
                "tool_calls": 1,
                "checkpoint_status": "checkpointed",
            },
        ),
        (
            "containment.decision",
            {
                "turn": 1,
                "index": 1,
                "tool": "tool",
                "server": "forgewright",
                "decision": "admitted",
            },
        ),
        (
            "tool.result",
            {
                "turn": 1,
                "index": 1,
                "tool": "tool",
                "is_error": False,
                "output_digest": output_digest,
                "output_bytes": 2,
            },
        ),
        ("approval.requested", {"turn": 1, "result_digest": output_digest}),
        (
            "checkpoint.boundary",
            {
                "boundary": "step-boundary",
                "turn": 1,
                "total_tool_calls": 1,
                "steps": 0,
                "tool_calls": 0,
                "checkpoint_status": "checkpointed",
            },
        ),
    ]
    for kind, payload in ordered:
        journal.append(kind, payload)
    _complete(journal, turn=2, total_tool_calls=1)
    cursor = ReplayCursor(journal.read())
    cursor.take("lifecycle.event")
    cursor.take("loop.started")
    cursor.take("checkpoint.boundary")
    cursor.take("model.request")
    cursor.take("model.response")
    for kind, _payload in ordered:
        cursor.take(kind)
    cursor.take("checkpoint.boundary")
    cursor.take("model.request")
    cursor.take("model.response")
    cursor.take("lifecycle.event")
    cursor.take("loop.completed")
    cursor.finish()

    invalid = Journal(tmp_path / "invalid", "loop-a")
    _start(invalid)
    with pytest.raises(JournalError, match="sequence"):
        invalid.append(
            "tool.result",
            {
                "turn": 1,
                "index": 1,
                "tool": "tool",
                "is_error": False,
                "output_digest": digest("ok"),
                "output_bytes": 2,
            },
        )
    with pytest.raises(JournalError, match="sequence"):
        invalid.append(
            "approval.approved",
            {"turn": 1, "result_digest": digest("ok")},
        )
    with pytest.raises(JournalError, match="sequence"):
        invalid.append(
            "model.response",
            {
                "content_digest": digest("done"),
                "content_bytes": 4,
                "content_present": True,
                "tool_calls": [],
            },
        )
