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
                "context_budget": {"max_skills_per_mode": cap},
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
