import asyncio
import importlib.util
import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
ROUTER_PATH = REPO_ROOT / "scripts" / "runtime" / "skill_routing.py"
ORCHESTRATOR_PATH = REPO_ROOT / "scripts" / "runtime" / "forgewright-orchestrator.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


router = _load_module("skill_routing_runtime", ROUTER_PATH)


def _write_config(
    root: Path,
    mode_skill_map: dict[str, list[str]],
    enabled: dict[str, object] | None = None,
    cap: int = 12,
    description_budget: object = 8000,
) -> Path:
    for skill in {item for items in mode_skill_map.values() for item in items}:
        if not skill.startswith("../"):
            skill_dir = root / "skills" / skill
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "SKILL.md").write_text(f"# {skill}\n", encoding="utf-8")
            (skill_dir / "LITE.md").write_text(f"# Lite {skill}\n", encoding="utf-8")
    config_dir = root / ".forgewright"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "skills-config.json"
    config_path.write_text(
        json.dumps(
            {
                "auto_detect": True,
                "auto_detect_rules": {"mode_skill_map": mode_skill_map},
                "skills": {
                    name: {"enabled": value} for name, value in (enabled or {}).items()
                },
                "context_budget": {
                    "max_skills_per_mode": cap,
                    "max_skill_descriptions_tokens": description_budget,
                },
            }
        ),
        encoding="utf-8",
    )
    return config_path


@pytest.mark.parametrize("engine", ["Unity", "Roblox", "Unreal"])
def test_game_engines_route_to_game_build_before_generic_build(engine: str) -> None:
    result = router.route_skills(
        prompt=f"I need help with {engine}", project_root=REPO_ROOT
    )

    assert result["status"] == "ok"
    assert result["mode"] == "game-build"
    names = [skill["name"] for skill in result["skills"]]
    assert names[:3] == ["game-designer", "concept-artist", "art-director"]
    assert "software-engineer" not in names


def test_current_design_and_game_build_config_resolve_without_missing_skills() -> None:
    expected_orders = {
        "design": ["ux-researcher", "concept-artist", "art-director", "ui-designer"],
        "game-build": ["game-designer", "concept-artist", "art-director"],
    }

    for mode, expected_prefix in expected_orders.items():
        result = router.route_skills(mode=mode, project_root=REPO_ROOT)

        assert result["status"] == "ok"
        assert result["errors"] == []
        names = [skill["name"] for skill in result["skills"]]
        assert names[: len(expected_prefix)] == expected_prefix
        assert "designer" not in names
        assert all(
            Path(skill[key]).is_absolute() and Path(skill[key]).is_file()
            for skill in result["skills"]
            for key in ("skill_path", "lite_path")
        )


def test_visual_concept_prompt_routes_design_and_preserves_creative_order(
    tmp_path: Path,
) -> None:
    _write_config(
        tmp_path,
        {"design": ["ux-researcher", "concept-artist", "art-director"]},
        {name: "auto" for name in ["ux-researcher", "concept-artist", "art-director"]},
    )

    result = router.route_skills(
        prompt="Create a visual concept and art direction for the product",
        project_root=tmp_path,
    )

    assert result["status"] == "ok"
    assert result["mode"] == "design"
    assert [skill["name"] for skill in result["skills"]] == [
        "ux-researcher",
        "concept-artist",
        "art-director",
    ]


def test_unknown_explicit_mode_fails_closed(tmp_path: Path) -> None:
    _write_config(tmp_path, {"design": ["concept-artist"]}, {"concept-artist": "auto"})

    result = router.route_skills(mode="not-a-mode", project_root=tmp_path)

    assert result["status"] == "error"
    assert result["skills"] == []
    assert "unknown explicit mode" in result["errors"][0]


def test_unclassified_prompt_matches_current_config_fail_closed_contract() -> None:
    config = json.loads(
        (REPO_ROOT / ".forgewright" / "skills-config.json").read_text(encoding="utf-8")
    )

    assert config["context_budget"]["fallback_on_classification_failure"] == "none"

    result = router.route_skills(
        prompt="Please help me with an unclassified request",
        project_root=REPO_ROOT,
    )

    assert result["status"] == "ok"
    assert result["mode"] is None
    assert result["skills"] == []


def test_missing_skill_and_path_escape_fail_closed(tmp_path: Path) -> None:
    missing = _write_config(
        tmp_path, {"design": ["missing-skill"]}, {"missing-skill": "auto"}
    )
    (tmp_path / "skills" / "missing-skill" / "SKILL.md").unlink()
    (tmp_path / "skills" / "missing-skill" / "LITE.md").unlink()
    (tmp_path / "skills" / "missing-skill").rmdir()
    missing_result = router.route_skills(
        config_path=missing, mode="design", project_root=tmp_path
    )
    assert missing_result["status"] == "error"
    assert missing_result["skills"] == []
    assert "missing skill directory" in missing_result["errors"][0]

    escape_root = tmp_path / "escape"
    (escape_root / "skills").mkdir(parents=True)
    escape = _write_config(
        escape_root, {"design": ["../outside"]}, {"../outside": "auto"}
    )
    escape_result = router.route_skills(
        config_path=escape, mode="design", project_root=escape_root
    )
    assert escape_result["status"] == "error"
    assert escape_result["skills"] == []
    assert "escapes skills root" in escape_result["errors"][0]


@pytest.mark.skipif(not hasattr(Path, "symlink_to"), reason="symlink unsupported")
def test_symlinked_skill_directory_and_files_fail_closed(tmp_path: Path) -> None:
    external = tmp_path / "external"
    external.mkdir()
    (external / "SKILL.md").write_text("metadata", encoding="utf-8")
    (external / "LITE.md").write_text("overlay", encoding="utf-8")

    directory_root = tmp_path / "directory-link"
    config = _write_config(
        directory_root,
        {"design": ["linked"]},
        {"linked": "auto"},
    )
    linked = directory_root / "skills" / "linked"
    for child in linked.iterdir():
        child.unlink()
    linked.rmdir()
    linked.symlink_to(external, target_is_directory=True)
    result = router.route_skills(
        config_path=config, mode="design", project_root=directory_root
    )
    assert result["status"] == "error"
    assert "symlinked skill directory" in result["errors"][0]

    file_root = tmp_path / "file-link"
    config = _write_config(
        file_root,
        {"design": ["linked"]},
        {"linked": "auto"},
    )
    lite_path = file_root / "skills" / "linked" / "LITE.md"
    lite_path.unlink()
    lite_path.symlink_to(external / "LITE.md")
    result = router.route_skills(
        config_path=config, mode="design", project_root=file_root
    )
    assert result["status"] == "error"
    assert "symlinked LITE.md" in result["errors"][0]


def test_manual_disable_force_enable_and_cap_are_ordered(tmp_path: Path) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["first", "disabled", "third"]},
        {"first": "auto", "disabled": False, "third": "auto", "forced": True},
        cap=2,
    )
    forced_dir = tmp_path / "skills" / "forced"
    forced_dir.mkdir()
    (forced_dir / "SKILL.md").write_text("# forced\n", encoding="utf-8")
    (forced_dir / "LITE.md").write_text("# forced lite\n", encoding="utf-8")

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "ok"
    assert [skill["name"] for skill in result["skills"]] == ["first", "third"]
    assert all(
        Path(skill[key]).is_absolute()
        for skill in result["skills"]
        for key in ("skill_path", "lite_path")
    )
    assert all(
        Path(skill[key]).is_file()
        for skill in result["skills"]
        for key in ("skill_path", "lite_path")
    )

    document = json.loads(config.read_text(encoding="utf-8"))
    document["context_budget"]["max_skills_per_mode"] = 3
    config.write_text(json.dumps(document), encoding="utf-8")
    forced_result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )
    assert [skill["name"] for skill in forced_result["skills"]] == [
        "first",
        "third",
        "forced",
    ]


def test_skill_description_budget_selects_ordered_prefix_and_reports_deferred(
    tmp_path: Path,
) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["first", "second", "third"]},
        {name: "auto" for name in ["first", "second", "third"]},
        description_budget=14,
    )

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "ok"
    assert result["context_budget"]["limit"] == 14
    assert result["context_budget"]["estimator"] == "utf8_bytes_div_4_ceil"
    assert result["context_budget"]["estimated_used"] <= 14
    assert [skill["name"] for skill in result["skills"]] == ["first"]
    assert result["context_budget"]["deferred_skills"] == ["second", "third"]
    assert result["context_budget"]["deferred_count"] == 2
    rendered = "\n## Skill-Specific Instructions: first\n# Lite first\n\n"
    assert (
        result["skills"][0]["estimated_tokens"]
        == (len(rendered.encode("utf-8")) + 3) // 4
    )


def test_skill_description_budget_does_not_read_deferred_overlay(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["first", "second"]},
        {"first": "auto", "second": "auto"},
        description_budget=14,
    )
    deferred_path = (tmp_path / "skills" / "second" / "LITE.md").resolve()
    original_read_text = Path.read_text
    observed_reads: list[Path] = []

    def tracked_read_text(path: Path, *args: object, **kwargs: object) -> str:
        observed_reads.append(path.resolve())
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", tracked_read_text)

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "ok"
    assert result["context_budget"]["deferred_skills"] == ["second"]
    assert deferred_path not in observed_reads


def test_skill_description_budget_accounting_is_deterministic(tmp_path: Path) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["alpha", "beta"]},
        {"alpha": "auto", "beta": "auto"},
        description_budget=10_000,
    )

    first = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )
    second = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert first["context_budget"] == second["context_budget"]
    assert first["skills"] == second["skills"]
    assert first["context_budget"]["estimated_used"] == sum(
        skill["estimated_tokens"] for skill in first["skills"]
    )


def test_utf8_estimator_counts_bytes_and_defers_oversized_first(
    tmp_path: Path,
) -> None:
    config = _write_config(
        tmp_path,
        {"research": ["unicode-skill"]},
        {"unicode-skill": "auto"},
        description_budget=1,
    )
    lite_path = tmp_path / "skills" / "unicode-skill" / "LITE.md"
    lite_path.write_text("# Cà phê ☕\n", encoding="utf-8")
    rendered = (
        "\n## Skill-Specific Instructions: unicode-skill\n"
        + lite_path.read_text(encoding="utf-8")
        + "\n"
    )
    expected = (len(rendered.encode("utf-8")) + 3) // 4

    result = router.route_skills(
        config_path=config, mode="research", project_root=tmp_path
    )

    assert (
        router._estimate_overlay_tokens(
            {"name": "unicode-skill", "lite_path": str(lite_path)}
        )
        == expected
    )
    assert expected > (len(rendered) + 3) // 4
    assert result["skills"] == []
    assert result["context_budget"]["estimated_used"] == 0
    assert result["context_budget"]["deferred_skills"] == ["unicode-skill"]


@pytest.mark.parametrize("invalid_budget", [-1, True, "8000", 1.5])
def test_invalid_skill_description_budget_fails_closed(
    tmp_path: Path, invalid_budget: object
) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["concept-artist"]},
        {"concept-artist": "auto"},
        description_budget=invalid_budget,
    )

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "error"
    assert result["skills"] == []
    assert "max_skill_descriptions_tokens" in result["errors"][0]


def test_all_paths_validate_before_zero_budget_can_hide_missing_skill(
    tmp_path: Path,
) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["valid", "missing"]},
        {"valid": "auto", "missing": "auto"},
        cap=1,
        description_budget=0,
    )
    missing_dir = tmp_path / "skills" / "missing"
    (missing_dir / "SKILL.md").unlink()
    (missing_dir / "LITE.md").unlink()
    missing_dir.rmdir()

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "error"
    assert result["skills"] == []
    assert "missing skill directory" in result["errors"][0]


def test_zero_skill_description_budget_returns_no_overlays(tmp_path: Path) -> None:
    config = _write_config(
        tmp_path,
        {"design": ["first", "second"]},
        {"first": "auto", "second": "auto"},
        description_budget=0,
    )

    result = router.route_skills(
        config_path=config, mode="design", project_root=tmp_path
    )

    assert result["status"] == "ok"
    assert result["skills"] == []
    assert result["context_budget"]["estimated_used"] == 0
    assert result["context_budget"]["deferred_skills"] == ["first", "second"]


def test_orchestrator_loads_ordered_game_creative_overlays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    orchestrator = _load_module("forgewright_orchestrator_runtime", ORCHESTRATOR_PATH)
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}", encoding="utf-8")

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

        async def initialize(self):
            return None

        async def list_tools(self):
            return SimpleNamespace(tools=[])

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)
    monkeypatch.setenv("FORGEWRIGHT_LITE", "true")

    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    monkeypatch.setattr(agent, "_call_api", lambda _tools: {"content": "done"})
    asyncio.run(agent.run("Build a Unity game"))

    output = capsys.readouterr().out
    assert "Loaded skill LITE overlay: concept-artist" in output
    assert "Loaded skill LITE overlay: art-director" in output
    assert "Loaded skill LITE overlay: software-engineer" not in output
    assert "Skill-Specific Instructions: concept-artist" in agent.messages[0]["content"]
    assert "Skill-Specific Instructions: art-director" in agent.messages[0]["content"]
    assert (
        "Skill-Specific Instructions: software-engineer"
        not in agent.messages[0]["content"]
    )


def test_orchestrator_advertises_exact_deferred_loader_without_eager_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    orchestrator = _load_module("forgewright_orchestrator_deferred", ORCHESTRATOR_PATH)
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}", encoding="utf-8")
    initial_overlay = tmp_path / "initial-LITE.md"
    deferred_overlay = tmp_path / "deferred-LITE.md"
    initial_overlay.write_text("INITIAL OVERLAY BODY", encoding="utf-8")
    deferred_overlay.write_text("DEFERRED SECRET BODY", encoding="utf-8")
    server_calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        orchestrator,
        "route_skills",
        lambda **_kwargs: {
            "status": "ok",
            "mode": "feature",
            "source": "prompt",
            "errors": [],
            "skills": [
                {
                    "name": "initial",
                    "lite_path": str(initial_overlay),
                    "estimated_tokens": 5,
                }
            ],
            "context_budget": {
                "limit": 5,
                "estimated_used": 5,
                "estimator": "utf8_bytes_div_4_ceil",
                "deferred_skills": ["deferred"],
                "deferred_count": 1,
            },
        },
    )

    @asynccontextmanager
    async def fake_stdio_client(params):
        yield params, object()

    class FakeClientSession:
        def __init__(self, read, _write):
            self.params = read

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _traceback):
            return False

        async def initialize(self):
            return None

        async def list_tools(self):
            if self.params.command == "bash":
                return SimpleNamespace(
                    tools=[
                        SimpleNamespace(
                            name="fw_load_skill_overlay",
                            description="Load one deferred overlay",
                            inputSchema={
                                "type": "object",
                                "properties": {"name": {"type": "string"}},
                                "required": ["name"],
                            },
                        )
                    ]
                )
            return SimpleNamespace(tools=[])

        async def call_tool(self, name, arguments):
            server_calls.append((name, arguments))
            return SimpleNamespace(
                isError=False,
                content=[SimpleNamespace(text="DEFERRED OVERLAY BODY")],
            )

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)
    monkeypatch.setenv("FORGEWRIGHT_LITE", "true")
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    exposed_name = orchestrator.qualified_tool_name(
        "forgewright", "fw_load_skill_overlay"
    )
    replies = iter(
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "load-once",
                        "type": "function",
                        "function": {
                            "name": exposed_name,
                            "arguments": '{"name":"deferred"}',
                        },
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "load-duplicate",
                        "type": "function",
                        "function": {
                            "name": exposed_name,
                            "arguments": '{"name":"deferred"}',
                        },
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "load-unlisted",
                        "type": "function",
                        "function": {
                            "name": exposed_name,
                            "arguments": '{"name":"not-routed"}',
                        },
                    }
                ],
            },
            {"content": "done"},
        ]
    )
    monkeypatch.setattr(agent, "_call_api", lambda _tools: next(replies))

    asyncio.run(agent.run("Implement a feature"))

    system_prompt = agent.messages[0]["content"]
    assert "INITIAL OVERLAY BODY" in system_prompt
    assert "DEFERRED SECRET BODY" not in system_prompt
    assert "deferred" in system_prompt
    assert exposed_name in system_prompt
    assert '{"name": "deferred"}' in system_prompt
    assert server_calls == [("fw_load_skill_overlay", {"name": "deferred"})]
    tool_messages = [
        message for message in agent.messages if message.get("role") == "tool"
    ]
    assert tool_messages[0]["content"] == "DEFERRED OVERLAY BODY"
    assert "already loaded" in tool_messages[1]["content"]
    assert "not in the current deferred inventory" in tool_messages[2]["content"]


def test_orchestrator_passes_deferred_inventory_to_canonical_mcp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    orchestrator = _load_module("forgewright_orchestrator_inventory", ORCHESTRATOR_PATH)
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        orchestrator,
        "route_skills",
        lambda **_kwargs: {
            "status": "ok",
            "mode": "feature",
            "source": "prompt",
            "errors": [],
            "skills": [],
            "context_budget": {
                "limit": 0,
                "estimated_used": 0,
                "estimator": "utf8_bytes_div_4_ceil",
                "deferred_skills": ["software-engineer"],
                "deferred_count": 1,
            },
        },
    )
    observed_env: dict[str, str] = {}

    @asynccontextmanager
    async def fake_stdio_client(params):
        if params.command == "bash":
            observed_env.update(params.env or {})
        yield params, object()

    class FakeClientSession:
        def __init__(self, read, _write):
            self.params = read

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _traceback):
            return False

        async def initialize(self):
            return None

        async def list_tools(self):
            if self.params.command == "bash":
                return SimpleNamespace(
                    tools=[
                        SimpleNamespace(
                            name="fw_load_skill_overlay",
                            description="loader",
                            inputSchema={"type": "object"},
                        )
                    ]
                )
            return SimpleNamespace(tools=[])

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)
    monkeypatch.setenv("FORGEWRIGHT_LITE", "true")
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))
    monkeypatch.setattr(agent, "_call_api", lambda _tools: {"content": "done"})

    asyncio.run(agent.run("Implement a feature"))

    assert observed_env["FORGEWRIGHT_DEFERRED_SKILLS_JSON"] == '["software-engineer"]'


def test_orchestrator_rejects_canonical_loader_without_inventory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    orchestrator = _load_module(
        "forgewright_orchestrator_no_inventory", ORCHESTRATOR_PATH
    )
    (tmp_path / ".antigravity").mkdir()
    (tmp_path / ".antigravity" / "mcp-manifest.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        orchestrator,
        "route_skills",
        lambda **_kwargs: {
            "status": "ok",
            "mode": "feature",
            "source": "prompt",
            "errors": [],
            "skills": [],
            "context_budget": {
                "limit": 0,
                "estimated_used": 0,
                "estimator": "utf8_bytes_div_4_ceil",
                "deferred_skills": [],
                "deferred_count": 0,
            },
        },
    )

    @asynccontextmanager
    async def fake_stdio_client(params):
        yield params, object()

    class FakeClientSession:
        def __init__(self, read, _write):
            self.params = read

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _traceback):
            return False

        async def initialize(self):
            return None

        async def list_tools(self):
            if self.params.command == "bash":
                return SimpleNamespace(
                    tools=[
                        SimpleNamespace(
                            name="fw_load_skill_overlay",
                            description="loader",
                            inputSchema={"type": "object"},
                        )
                    ]
                )
            return SimpleNamespace(tools=[])

    monkeypatch.setattr(orchestrator, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(orchestrator, "ClientSession", FakeClientSession)
    monkeypatch.setenv("FORGEWRIGHT_LITE", "true")
    agent = orchestrator.ForgewrightAgent("project", str(tmp_path))

    with pytest.raises(SystemExit) as exit_info:
        asyncio.run(agent.run("Implement a feature"))

    assert exit_info.value.code == 1
