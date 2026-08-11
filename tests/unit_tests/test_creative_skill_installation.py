import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts" / "bootstrap" / "forgewright-install.sh"
SKILLS_CONFIG = ROOT / ".forgewright" / "skills-config.json"
WORKFLOW = ROOT / "workflows" / "game-studio-build.md"
PROTOCOL = ROOT / "skills" / "_shared" / "protocols" / "game-studio-pipeline.md"
LITE = ROOT / "skills" / "production-grade" / "LITE.md"
CLASSIFICATION = (
    ROOT / "skills" / "production-grade" / "references" / "mode-classification.md"
)
MODE_REFERENCE = ROOT / "docs" / "mode-reference.md"
PRODUCT_OVERVIEW = ROOT / "docs" / "product-overview.md"
CATALOG = ROOT / "docs" / "skill-catalog.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _run_installer(
    destination: Path, home: Path, *args: str
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "FORGEWRIGHT_DIR": str(destination),
            "FORGEWRIGHT_SOURCE_DIR": str(ROOT),
            "HOME": str(home),
        }
    )
    return subprocess.run(
        ["bash", str(INSTALLER), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _assert_in_order(text: str, *fragments: str) -> None:
    positions = [text.index(fragment) for fragment in fragments]
    assert positions == sorted(positions), fragments


def test_full_profile_routes_concept_artist_before_art_director() -> None:
    result = _run_installer(
        Path("/tmp/forgewright-test-install-unused"),
        Path("/tmp/forgewright-test-home-unused"),
        "--profile",
        "full",
        "--yes",
        "--dry-run",
        "--skip-mcp",
    )

    assert result.returncode == 0, result.stderr
    _assert_in_order(
        result.stdout,
        "[DRY RUN] Would install: concept-artist",
        "[DRY RUN] Would install: art-director",
    )


def test_installer_installs_router_config_without_overwriting_user_config(
    tmp_path: Path,
) -> None:
    existing_destination = tmp_path / "existing" / "config" / "skills-config.json"
    existing_destination.parent.mkdir(parents=True)
    existing_destination.write_text('{"user_owned": true}\n', encoding="utf-8")

    existing_result = _run_installer(
        tmp_path / "existing",
        tmp_path / "home-existing",
        "--profile",
        "minimal",
        "--yes",
        "--skip-mcp",
        "--skip-skills",
    )
    assert existing_result.returncode == 0, existing_result.stderr
    assert existing_destination.read_text(encoding="utf-8") == '{"user_owned": true}\n'

    fresh_result = _run_installer(
        tmp_path / "fresh",
        tmp_path / "home-fresh",
        "--profile",
        "minimal",
        "--yes",
        "--skip-mcp",
        "--skip-skills",
    )
    assert fresh_result.returncode == 0, fresh_result.stderr
    installed = tmp_path / "fresh" / "config" / "skills-config.json"
    assert json.loads(installed.read_text(encoding="utf-8")) == json.loads(
        SKILLS_CONFIG.read_text(encoding="utf-8")
    )

    rerun_result = _run_installer(
        tmp_path / "fresh",
        tmp_path / "home-fresh",
        "--profile",
        "minimal",
        "--yes",
        "--skip-mcp",
        "--skip-skills",
    )
    assert rerun_result.returncode == 0, rerun_result.stderr
    assert installed.read_text(encoding="utf-8") == SKILLS_CONFIG.read_text(
        encoding="utf-8"
    )


def test_design_and_game_docs_share_the_creative_handoff_order() -> None:
    design = _read(MODE_REFERENCE)
    design_section = design[design.index("## Design") : design.index("## Mobile")]
    game_section = design[design.index("## Game Build") : design.index("## XR Build")]
    _assert_in_order(
        design_section,
        "UX/research",
        "Concept Artist",
        "Art Director",
        "UI/technical handoff",
    )
    _assert_in_order(
        game_section,
        "UX/research",
        "Concept Artist",
        "Art Director",
        "UI/technical/engine handoff",
    )

    for path in (LITE, CLASSIFICATION, WORKFLOW, PROTOCOL, PRODUCT_OVERVIEW):
        text = _read(path)
        assert "concept-artist" in text or "Concept Artist" in text
        assert "art-director" in text or "Art Director" in text

    catalog = _read(CATALOG)
    assert "**concept-artist**" in catalog
    assert "**art-director**" in catalog


def test_workflow_and_protocol_use_the_verified_host_dispatch_chain() -> None:
    protocol_section = (
        _read(PROTOCOL)
        .split("### Creative routing and executable dispatch contract", 1)[1]
        .split("### Design-ready handoff", 1)[0]
    )
    workflow_section = (
        _read(WORKFLOW)
        .split("## Ordered Creative Handoff and Dispatch", 1)[1]
        .split("## Steps", 1)[0]
    )

    for section in (protocol_section, workflow_section):
        _assert_in_order(
            section,
            "python3 scripts/runtime/skill_routing.py",
            "python3 scripts/art-direction/creative-handoff.py",
            "Freeze" if "Freeze" in section else "freeze",
            "python3 scripts/runtime/codex-subagent-routing.py",
            "host-owned native `spawn_agent`",
        )
        assert "skill item/path" in section
        assert "creative-handoff.py validate-handoff" in section
        assert "repository does not" in section
