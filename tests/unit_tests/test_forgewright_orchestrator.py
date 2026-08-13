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
