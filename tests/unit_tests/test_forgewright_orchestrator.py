import asyncio
import importlib.util
import json
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "runtime" / "forgewright-orchestrator.py"
SPEC = importlib.util.spec_from_file_location("forgewright_orchestrator", MODULE_PATH)
assert SPEC and SPEC.loader
orchestrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(orchestrator)


def test_repo_root_is_repository_root() -> None:
    assert Path(orchestrator._REPO_ROOT) == REPO_ROOT


def test_model_precedence_and_empty_fallback() -> None:
    assert (
        orchestrator.resolve_model(
            {"FORGEWRIGHT_MODEL": " gpt-primary ", "NINEROUTER_MODEL": "legacy"}
        )
        == "gpt-primary"
    )
    assert (
        orchestrator.resolve_model(
            {"FORGEWRIGHT_MODEL": " ", "NINEROUTER_MODEL": "legacy"}
        )
        == "legacy"
    )
    with pytest.raises(ValueError, match="FORGEWRIGHT_MODEL is required"):
        orchestrator.resolve_model({})


def test_api_key_precedence_and_minimax_key_is_not_accepted() -> None:
    assert (
        orchestrator.resolve_api_key(
            {"FORGEWRIGHT_API_KEY": " configured ", "NINEROUTER_API_KEY": "legacy"}
        )
        == "configured"
    )
    assert orchestrator.resolve_api_key({"NINEROUTER_API_KEY": "legacy"}) == "legacy"
    assert orchestrator.resolve_api_key({"MINIMAX_API_KEY": "provider-only"}) == ""


@pytest.mark.parametrize(
    "url",
    [
        "https://example.test/v1/chat/completions",
        "https://example.test/custom/path/",
        "https://example.test/custom/path?region=vn",
    ],
)
def test_api_url_is_preserved_exactly(url: str) -> None:
    assert orchestrator.resolve_api_url({"FORGEWRIGHT_API_URL": url}) == url


def test_legacy_base_url_keeps_chat_completions_normalization() -> None:
    assert (
        orchestrator.resolve_api_url(
            {"NINEROUTER_BASE_URL": "https://openrouter.test/api/v1"}
        )
        == "https://openrouter.test/api/v1/chat/completions"
    )


def test_api_url_requires_explicit_configuration() -> None:
    with pytest.raises(
        ValueError,
        match="FORGEWRIGHT_API_URL or NINEROUTER_BASE_URL must be explicitly configured",
    ):
        orchestrator.resolve_api_url({})


def test_call_api_fails_closed_without_configured_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(orchestrator, "_BASE_URL", "")
    monkeypatch.setattr(orchestrator, "_API_KEY", "test-key")
    monkeypatch.setattr(orchestrator, "_MODEL", "test-model")
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))

    with pytest.raises(SystemExit) as exit_info:
        agent._call_api([])

    assert exit_info.value.code == 1


def test_code_dir_is_resolved_and_root_is_rejected(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    assert orchestrator.resolve_code_dir(str(workspace / ".." / "workspace")) == str(
        workspace.resolve()
    )
    with pytest.raises(ValueError, match="filesystem root"):
        orchestrator.resolve_code_dir(str(Path(Path.cwd().anchor)))


def test_filesystem_containment_rejects_escapes_symlinks_and_unknown_tools(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / "linked").symlink_to(outside, target_is_directory=True)

    assert "escapes" in orchestrator.validate_filesystem_tool_call(
        "read_file", {"path": "../outside/secret"}, str(workspace)
    )
    assert "symlink" in orchestrator.validate_filesystem_tool_call(
        "read_file", {"path": "linked/secret"}, str(workspace)
    )
    assert "allowlisted" in orchestrator.validate_filesystem_tool_call(
        "delete_file", {"path": "safe"}, str(workspace)
    )


def test_filesystem_containment_allows_bounded_workspace_reads_and_writes(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "existing.txt").write_text("ok", encoding="utf-8")

    assert (
        orchestrator.validate_filesystem_tool_call(
            "read_file", {"path": "existing.txt"}, str(workspace)
        )
        is None
    )
    assert (
        orchestrator.validate_filesystem_tool_call(
            "list_directory", {"path": "."}, str(workspace)
        )
        is None
    )
    assert (
        orchestrator.validate_filesystem_tool_call(
            "read_file", {"path": str(workspace / "existing.txt")}, str(workspace)
        )
        is None
    )
    assert (
        orchestrator.validate_filesystem_tool_call(
            "write_file", {"path": "new.txt"}, str(workspace)
        )
        is None
    )
    assert "escapes" in orchestrator.validate_filesystem_tool_call(
        "read_file", {"path": str(tmp_path / "outside.txt")}, str(workspace)
    )
    assert (
        orchestrator.validate_filesystem_tool_call(
            "read_multiple_files",
            {"paths": ["existing.txt", str(workspace)]},
            str(workspace),
        )
        is None
    )
    assert (
        orchestrator.validate_filesystem_tool_call(
            "move_file",
            {"source": "existing.txt", "destination": "renamed.txt"},
            str(workspace),
        )
        is None
    )


def test_production_containment_requires_identity_and_profile() -> None:
    with pytest.raises(ValueError, match="CALLER_ID"):
        orchestrator.validate_production_containment({"FORGEWRIGHT_PRODUCTION": "true"})
    with pytest.raises(ValueError, match="CONTAINMENT_PROFILE"):
        orchestrator.validate_production_containment(
            {"FORGEWRIGHT_PRODUCTION": "true", "FORGEWRIGHT_CALLER_ID": "caller-a"}
        )
    orchestrator.validate_production_containment(
        {
            "FORGEWRIGHT_PRODUCTION": "true",
            "FORGEWRIGHT_CALLER_ID": "caller-a",
            "FORGEWRIGHT_CONTAINMENT_PROFILE": "application",
        }
    )


def test_runtime_mode_is_fail_closed_and_legacy_production_is_only_a_fallback() -> None:
    with pytest.raises(ValueError, match="RUNTIME_MODE"):
        orchestrator.validate_production_containment(
            {"FORGEWRIGHT_RUNTIME_MODE": "staging"}
        )
    with pytest.raises(ValueError, match="conflicts"):
        orchestrator.validate_production_containment(
            {"FORGEWRIGHT_RUNTIME_MODE": "local", "FORGEWRIGHT_PRODUCTION": "true"}
        )
    orchestrator.validate_production_containment({"FORGEWRIGHT_RUNTIME_MODE": "local"})
    orchestrator.validate_production_containment(
        {
            "FORGEWRIGHT_RUNTIME_MODE": "production",
            "FORGEWRIGHT_CALLER_ID": "caller-a",
            "FORGEWRIGHT_CONTAINMENT_PROFILE": "application",
        }
    )


def test_continuity_bridge_is_context_only_and_uses_semantic_boundaries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []

    def fake_run(args, **_kwargs):
        calls.append(args)
        if "checkpoint" in args:
            payload = {
                "checkpoint_hash": "a" * 64,
                "continuation": {"nonce": "b" * 64},
                "objective": "goal",
                "plan": [],
                "blockers": [],
                "next_action": "re-ground",
            }
        elif "consume" in args:
            payload = {"remaining_steps": 5, "remaining_tool_calls": 6}
        else:
            payload = {"status": "fresh-start"}
        return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(orchestrator.subprocess, "run", fake_run)
    bridge = orchestrator.ContinuityBridge(str(tmp_path), "project", "goal")
    assert bridge.resume()["status"] == "fresh-start"
    bridge.checkpoint("before-model", 1, 10, 20)
    bridge.consume(1, 0)
    bridge.checkpoint("before-effect", 1, 9, 20)
    bridge.checkpoint("step-boundary", 1, 9, 19)
    assert any("before-model" in call for call in calls)
    consume_call = next(call for call in calls if "consume" in call)
    assert "--nonce" in consume_call
    assert "--request-id" in consume_call
    assert not any("authorization" in str(call) for call in calls)


def test_material_effect_classification_is_not_timer_or_message_based() -> None:
    assert orchestrator.is_material_effect("filesystem", "write_file")
    assert orchestrator.is_material_effect("forgewright", "fw_update_subtask")
    assert not orchestrator.is_material_effect("filesystem", "read_file")
    assert not orchestrator.is_material_effect("gitnexus", "query")


def test_continuity_sessions_are_task_scoped_and_step_boundary_skips_zero_consume(
    tmp_path: Path,
) -> None:
    first = orchestrator.ContinuityBridge(str(tmp_path), "project", "task-a", {})
    second = orchestrator.ContinuityBridge(str(tmp_path), "project", "task-b", {})
    assert first.session != second.session
    original = first.session
    first.bind_task("task-c")
    assert first.session != original

    class FakeContinuity:
        required = False
        binding = {
            "remaining_budget": {"steps": 7, "tool_calls": 8},
        }

        def __init__(self):
            self.consumed: list[tuple[int, int]] = []
            self.checkpoints: list[tuple[str, int, int, int]] = []

        def consume(self, steps: int, tools: int) -> None:
            self.consumed.append((steps, tools))

        def checkpoint(
            self, boundary: str, turn: int, max_steps: int, max_tools: int
        ) -> None:
            self.checkpoints.append((boundary, turn, max_steps, max_tools))

    fake = FakeContinuity()
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path), continuity=fake)
    agent._continuity_boundary("step-boundary", 1, 1)
    assert fake.consumed == []
    assert fake.checkpoints == [("step-boundary", 1, 7, 8)]


def test_checkpoint_journal_preserves_optional_failure_without_reexecuting_on_replay(
    tmp_path: Path,
) -> None:
    class FailingContinuity:
        required = False
        binding = None

        def checkpoint(self, *_args) -> None:
            raise RuntimeError("private checkpoint failure")

        def consume(self, *_args) -> None:
            return None

    journal = orchestrator.Journal(tmp_path / "journal", "loop-checkpoint")
    binding = {
        "project_id": "project",
        "workspace_digest": orchestrator.digest(str(tmp_path)),
        "task_digest": orchestrator.digest("task"),
    }
    journal.append("lifecycle.event", {"phase": "runtime.started", **binding})
    journal.append(
        "loop.started",
        {**binding, "tool_count": 0, "tool_schema_bytes": 2, "tools": []},
    )
    recording = orchestrator.ForgewrightAgent(
        "project",
        str(tmp_path),
        continuity=FailingContinuity(),
        journal_mode="record",
        journal=journal,
    )
    recording._continuity_boundary("before-model", 1, 0, steps=1)
    boundary = journal.read()[-1]
    assert boundary["kind"] == "checkpoint.boundary"
    assert boundary["payload"]["checkpoint_status"] == "optional-failed"
    assert "private checkpoint failure" not in json.dumps(journal.read())

    replaying = orchestrator.ForgewrightAgent(
        "project",
        str(tmp_path),
        continuity=FailingContinuity(),
        journal_mode="replay",
        journal=journal,
    )
    assert replaying.replay_cursor is not None
    replaying.replay_cursor.take("lifecycle.event")
    replaying.replay_cursor.take("loop.started")
    replaying._continuity_boundary("before-model", 1, 0, steps=1)
    replaying.replay_cursor.finish()


def test_runtime_limits_have_no_default_turn_quota() -> None:
    assert orchestrator.RuntimeLimits.from_env({}).max_turns is None
    assert (
        orchestrator.RuntimeLimits.from_env({"FORGEWRIGHT_MAX_TURNS": "0"}).max_turns
        is None
    )


def test_runtime_limits_reject_invalid_turn_caps() -> None:
    with pytest.raises(ValueError, match="FORGEWRIGHT_MAX_TURNS"):
        orchestrator.RuntimeLimits.from_env({"FORGEWRIGHT_MAX_TURNS": "many"})
    with pytest.raises(ValueError, match="FORGEWRIGHT_MAX_TURNS"):
        orchestrator.RuntimeLimits.from_env({"FORGEWRIGHT_MAX_TURNS": "-1"})


def _install_fake_mcp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @asynccontextmanager
    async def fake_stdio_client(_params):
        yield object(), object()

    class FakeClientSession:
        def __init__(self, _read, _write):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _traceback):
            return False

        async def initialize(self) -> None:
            return None

        async def list_tools(self):
            return SimpleNamespace(tools=[])

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)


def _tool_turn(index: int) -> dict[str, object]:
    return {
        "content": "",
        "tool_calls": [
            {
                "id": f"call-{index}",
                "type": "function",
                "function": {"name": "missing_tool", "arguments": "{}"},
            }
        ],
    }


def test_run_without_turn_cap_continues_past_former_default(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}")
    _install_fake_mcp(monkeypatch)
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    agent.limits = replace(
        agent.limits,
        max_turns=None,
        max_tool_calls_total=30,
    )
    calls = 0

    def fake_call_api(_tools):
        nonlocal calls
        calls += 1
        return _tool_turn(calls) if calls <= 21 else {"content": "done"}

    monkeypatch.setattr(agent, "_call_api", fake_call_api)

    asyncio.run(agent.run("exercise the unlimited goal loop"))

    assert calls == 22


def test_explicit_positive_turn_cap_remains_an_emergency_guard(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}")
    _install_fake_mcp(monkeypatch)
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    agent.limits = replace(
        agent.limits,
        max_turns=2,
        max_tool_calls_total=10,
    )
    calls = 0

    def fake_call_api(_tools):
        nonlocal calls
        calls += 1
        return _tool_turn(calls)

    monkeypatch.setattr(agent, "_call_api", fake_call_api)

    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(agent.run("exercise the emergency cap"))

    assert exit_info.value.code == 1
    assert calls == 2


def test_qualified_tool_names_are_bounded_stable_and_namespaced() -> None:
    first = orchestrator.qualified_tool_name("filesystem", "read.file")
    second = orchestrator.qualified_tool_name("gitnexus", "read.file")
    assert first == orchestrator.qualified_tool_name("filesystem", "read.file")
    assert first != second
    assert len(first) <= 64
    assert len(orchestrator.qualified_tool_name("server", "x" * 500)) <= 64
    assert set(first) <= set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    )


def test_serialized_size_is_utf8_bytes() -> None:
    value = {"text": "Tiếng Việt"}
    expected = len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    assert orchestrator._serialized_size(value) == expected


class _FakeResponse:
    def __init__(self, payload: dict[str, object], content: bytes | None = None):
        self.text = json.dumps(payload)
        self.content = self.text.encode("utf-8") if content is None else content
        self.encoding = None

    def iter_content(self, chunk_size: int):
        del chunk_size
        yield self.content


def test_call_api_sends_output_cap_and_preserves_exact_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    observed: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> _FakeResponse:
        observed.update(url=url, **kwargs)
        return _FakeResponse({"choices": [{"message": {"content": "done"}}]})

    monkeypatch.setattr(orchestrator, "_API_KEY", "test-key")
    monkeypatch.setattr(orchestrator, "_MODEL", "test-model")
    monkeypatch.setattr(orchestrator, "_BASE_URL", "https://example.test/custom")
    monkeypatch.setattr(orchestrator.requests, "post", fake_post)
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))

    reply = agent._call_api([])

    assert reply == {"content": "done"}
    assert observed["url"] == "https://example.test/custom"
    assert observed["json"]["max_tokens"] == agent.limits.max_output_tokens
    assert observed["stream"] is True


def test_call_api_rejects_oversized_response(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(orchestrator, "_BASE_URL", "https://example.test/custom")
    monkeypatch.setattr(orchestrator, "_API_KEY", "test-key")
    monkeypatch.setattr(orchestrator, "_MODEL", "test-model")
    monkeypatch.setattr(
        orchestrator.requests,
        "post",
        lambda *_args, **_kwargs: _FakeResponse(
            {"choices": [{"message": {"content": "done"}}]}, content=b"xx"
        ),
    )
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    agent.limits = replace(agent.limits, max_http_response_bytes=1)

    with pytest.raises(RuntimeError, match="HTTP response bytes"):
        agent._call_api([])


def test_remaining_timeout_is_capped_by_total_deadline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    agent.limits = replace(agent.limits, runtime_timeout_seconds=10)
    agent._started_at = 100.0
    monkeypatch.setattr(orchestrator.time, "monotonic", lambda: 109.5)

    assert agent._remaining_timeout(120) == pytest.approx(0.5)

    monkeypatch.setattr(orchestrator.time, "monotonic", lambda: 110.0)
    with pytest.raises(RuntimeError, match="total runtime"):
        agent._remaining_timeout(120)


def test_runtime_source_wires_fail_closed_limits_and_workspace() -> None:
    source = MODULE_PATH.read_text(encoding="utf-8")
    required = [
        '"max_tokens": self.limits.max_output_tokens',
        "while True:",
        "self.limits.max_turns is not None",
        "runtime limit exceeded: max turns",
        "self.limits.max_tool_calls_per_turn",
        "self.limits.max_tool_calls_total",
        "self.limits.max_tool_argument_bytes",
        "self.limits.max_tool_result_bytes",
        "self.limits.max_context_bytes",
        "self.limits.max_tool_schema_bytes",
        "self._remaining_timeout(",
        "session.initialize(),",
        "timeout=self._remaining_timeout(300)",
        "qualified_tool_name(srv_name, tool.name)",
        '"@modelcontextprotocol/server-filesystem",\n                        self.code_dir',
        "Required MCP server failed",
    ]
    assert all(marker in source for marker in required)
    assert 'FORGEWRIGHT_TOOL_SANDBOX"] = "false"' not in source
    assert '"/workspace"' not in source
    assert "tool_to_session_map[tool.name]" not in source
    assert "MINIMAX" not in source


def test_mcp_contexts_enter_without_spawning_timeout_tasks() -> None:
    source = MODULE_PATH.read_text(encoding="utf-8")

    assert "async with asyncio.timeout(" in source
    assert (
        "asyncio.wait_for(\n                            stack.enter_async_context"
        not in source
    )
    assert '"name": "forgewright",\n                    "optional": True' in source


def test_agent_loop_record_replay_is_strict_and_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".antigravity").mkdir()
    (workspace / ".antigravity" / "mcp-manifest.json").write_text("{}")
    journal = orchestrator.Journal(tmp_path / "journal", "loop-a")
    calls = {"api": 0, "tool": 0}

    class FakeContinuity:
        required = False
        binding = None

        def bind_task(self, _task: str) -> None:
            return None

        def resume(self) -> dict[str, str]:
            return {"status": "fresh-start"}

        def compact_context(self):
            return None

        def consume(self, _steps: int, _tools: int) -> None:
            return None

        def checkpoint(
            self, _boundary: str, _turn: int, _steps: int, _tools: int
        ) -> None:
            return None

    @asynccontextmanager
    async def fake_stdio_client(params):
        yield params.command, object()

    class FakeClientSession:
        def __init__(self, read, _write):
            self.server = read

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _traceback):
            return False

        async def initialize(self) -> None:
            return None

        async def list_tools(self):
            if self.server == "bash":
                names = [
                    "fw_request_gate_approval",
                    "fw_approve_gate",
                    "fw_check_pipeline_compliance",
                ]
            else:
                names = ["list_allowed_directories"]
            return SimpleNamespace(
                tools=[
                    SimpleNamespace(
                        name=name,
                        description=f"raw private prompt body {self.server}",
                        inputSchema={
                            "type": "object",
                            "properties": {
                                "secret": {"default": "opaque-private-value"}
                            },
                        },
                    )
                    for name in names
                ]
            )

        async def call_tool(self, name, arguments):
            calls["tool"] += 1
            assert arguments == {}
            outputs = {
                "list_allowed_directories": "private tool output",
                "fw_request_gate_approval": "private approval request",
                "fw_approve_gate": "private approval result",
                "fw_check_pipeline_compliance": "private evidence result",
            }
            return SimpleNamespace(
                isError=False,
                content=[SimpleNamespace(text=outputs[name])],
            )

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)
    monkeypatch.delenv("FORGEWRIGHT_LITE", raising=False)
    exposed_tool = orchestrator.qualified_tool_name(
        "filesystem", "list_allowed_directories"
    )
    approval_request_tool = orchestrator.qualified_tool_name(
        "forgewright", "fw_request_gate_approval"
    )
    approval_tool = orchestrator.qualified_tool_name("forgewright", "fw_approve_gate")
    evidence_tool = orchestrator.qualified_tool_name(
        "forgewright", "fw_check_pipeline_compliance"
    )
    replies = iter(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": exposed_tool, "arguments": "{}"},
                    },
                    {
                        "id": "call-2",
                        "type": "function",
                        "function": {
                            "name": approval_request_tool,
                            "arguments": "{}",
                        },
                    },
                    {
                        "id": "call-3",
                        "type": "function",
                        "function": {"name": approval_tool, "arguments": "{}"},
                    },
                    {
                        "id": "call-4",
                        "type": "function",
                        "function": {"name": evidence_tool, "arguments": "{}"},
                    },
                ],
            },
            {"content": "finished"},
        ]
    )
    recording = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="record",
        journal=journal,
    )

    def record_api(_tools):
        calls["api"] += 1
        return next(replies)

    monkeypatch.setattr(recording, "_call_api", record_api)
    asyncio.run(recording.run("private task body"))
    assert calls == {"api": 2, "tool": 4}
    original = journal.path.read_bytes()
    events = journal.read()
    serialized = json.dumps(events)
    assert "private task body" not in serialized
    assert "private tool output" not in serialized
    assert "private approval request" not in serialized
    assert "private approval result" not in serialized
    assert "private evidence result" not in serialized
    assert "finished" not in serialized
    assert "raw private prompt body" not in serialized
    assert "opaque-private-value" not in serialized
    assert orchestrator.digest("private task body") in serialized
    assert {event["kind"] for event in events} >= {
        "loop.started",
        "lifecycle.event",
        "containment.decision",
        "checkpoint.boundary",
        "model.request",
        "model.response",
        "tool.request",
        "tool.result",
        "approval.requested",
        "approval.approved",
        "evidence.recorded",
        "loop.completed",
    }
    assert all(
        event["payload"]["checkpoint_status"] == "checkpointed"
        for event in events
        if event["kind"] == "checkpoint.boundary"
    )

    failure_journal = orchestrator.Journal(tmp_path / "journal", "loop-failure")
    failing_record = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="record",
        journal=failure_journal,
    )
    monkeypatch.setattr(
        failing_record,
        "_call_api",
        lambda _tools: (_ for _ in ()).throw(RuntimeError("private provider failure")),
    )
    with pytest.raises(SystemExit):
        asyncio.run(failing_record.run("private failing task"))
    failure_events = failure_journal.read()
    assert [event["kind"] for event in failure_events[-2:]] == [
        "lifecycle.event",
        "loop.failed",
    ]
    assert "private provider failure" not in json.dumps(failure_events)

    class CleanupFailSession(FakeClientSession):
        async def __aexit__(self, _exc_type, _exc, _traceback):
            raise RuntimeError("private cleanup failure")

    monkeypatch.setattr(orchestrator, "ClientSession", CleanupFailSession)
    cleanup_journal = orchestrator.Journal(tmp_path / "journal", "loop-cleanup")
    cleanup_record = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="record",
        journal=cleanup_journal,
    )
    monkeypatch.setattr(
        cleanup_record,
        "_call_api",
        lambda _tools: {"content": "must not seal completion"},
    )
    with pytest.raises(SystemExit):
        asyncio.run(cleanup_record.run("private cleanup task"))
    cleanup_events = cleanup_journal.read()
    assert [event["kind"] for event in cleanup_events[-2:]] == [
        "lifecycle.event",
        "loop.failed",
    ]
    assert "loop.completed" not in [event["kind"] for event in cleanup_events]
    assert "private cleanup failure" not in json.dumps(cleanup_events)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)

    @asynccontextmanager
    async def failing_stdio(_params):
        raise RuntimeError("private required startup failure")
        yield

    monkeypatch.setattr(orchestrator, "stdio_client", failing_stdio)
    startup_journal = orchestrator.Journal(tmp_path / "journal", "loop-startup")
    startup_record = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="record",
        journal=startup_journal,
    )
    with pytest.raises(SystemExit):
        asyncio.run(startup_record.run("private startup task"))
    startup_events = startup_journal.read()
    assert [event["kind"] for event in startup_events] == [
        "lifecycle.event",
        "lifecycle.event",
        "loop.failed",
    ]
    assert "private required startup failure" not in json.dumps(startup_events)

    async def forbidden_stdio(_params):
        raise AssertionError("replay must not start MCP")

    class ForbiddenSession:
        def __init__(self, *_args):
            raise AssertionError("replay must not create MCP session")

    monkeypatch.setattr(orchestrator, "stdio_client", forbidden_stdio)
    monkeypatch.setattr(orchestrator, "ClientSession", ForbiddenSession)

    def replay_once() -> None:
        replaying = orchestrator.ForgewrightAgent(
            "project",
            str(workspace),
            continuity=FakeContinuity(),
            journal_mode="replay",
            journal=journal,
        )
        monkeypatch.setattr(
            replaying,
            "_call_api",
            lambda _tools: (_ for _ in ()).throw(
                AssertionError("replay must not call provider")
            ),
        )
        asyncio.run(replaying.run("private task body"))

    replay_once()
    assert calls == {"api": 2, "tool": 4}

    failing_replay = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="replay",
        journal=failure_journal,
    )
    monkeypatch.setattr(
        failing_replay,
        "_call_api",
        lambda _tools: (_ for _ in ()).throw(
            AssertionError("failure replay must not call provider")
        ),
    )
    with pytest.raises(SystemExit):
        asyncio.run(failing_replay.run("private failing task"))

    startup_replay = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="replay",
        journal=startup_journal,
    )
    with pytest.raises(SystemExit):
        asyncio.run(startup_replay.run("private startup task"))

    cleanup_replay = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="replay",
        journal=cleanup_journal,
    )
    with pytest.raises(SystemExit):
        asyncio.run(cleanup_replay.run("private cleanup task"))

    mismatched_failure = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=FakeContinuity(),
        journal_mode="replay",
        journal=failure_journal,
    )

    async def raise_different_failure(_task: str) -> None:
        raise ValueError("different replay failure")

    monkeypatch.setattr(mismatched_failure, "_run_inner", raise_different_failure)
    with pytest.raises(SystemExit):
        asyncio.run(mismatched_failure.run("private failing task"))
    assert mismatched_failure.replay_cursor is not None
    assert mismatched_failure.replay_cursor.index == 1
    assert mismatched_failure.replay_cursor.peek()[0] == "loop.started"

    lease_owner = orchestrator.Journal(tmp_path / "journal", "loop-lease")
    lease_owner.begin_record()

    class ForbiddenContinuity(FakeContinuity):
        def bind_task(self, _task: str) -> None:
            raise AssertionError("writer loser must not start continuity")

        def resume(self) -> dict[str, str]:
            raise AssertionError("writer loser must not resume continuity")

    blocked_continuity = ForbiddenContinuity()
    blocked = orchestrator.ForgewrightAgent(
        "project",
        str(workspace),
        continuity=blocked_continuity,
        journal_mode="record",
        journal=orchestrator.Journal(tmp_path / "journal", "loop-lease"),
    )
    with pytest.raises(orchestrator.JournalError, match="in_use"):
        asyncio.run(blocked.run("must not start"))
    lease_owner.end_record()

    replay_events = journal.read()
    cursor = orchestrator.ReplayCursor([*replay_events, replay_events[-1]])
    for event in replay_events:
        cursor.take(event["kind"])
    with pytest.raises(orchestrator.JournalError, match="extra"):
        cursor.finish()

    lines = original.splitlines(keepends=True)
    journal.path.write_bytes(b"".join(lines[:-1]))
    with pytest.raises(SystemExit):
        replay_once()

    journal.path.write_bytes(b"".join([lines[1], lines[0], *lines[2:]]))
    with pytest.raises(orchestrator.JournalError):
        orchestrator.ForgewrightAgent(
            "project",
            str(workspace),
            continuity=FakeContinuity(),
            journal_mode="replay",
            journal=journal,
        )
