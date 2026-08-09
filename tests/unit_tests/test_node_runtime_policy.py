import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _package(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def test_supported_first_party_node_floor_is_22() -> None:
    manifests = (
        "package.json",
        "mcp/package.json",
        "src/cli/package.json",
        "src/testing/package.json",
        "docs/package.json",
    )
    for path in manifests:
        assert _package(path)["engines"]["node"] in {">=22.0.0", ">=22"}, path


def test_cli_build_target_matches_supported_node_floor() -> None:
    text = (ROOT / "src/cli/tsup.config.ts").read_text(encoding="utf-8")
    assert "target: 'node22'" in text
    assert "target: 'node18'" not in text


def test_active_github_actions_do_not_pin_eol_node_20() -> None:
    github = ROOT / ".github"
    action_files = list((github / "actions").glob("*/action.yml"))
    workflow_files = list((github / "workflows").glob("*.yml"))
    for path in action_files + workflow_files:
        text = path.read_text(encoding="utf-8")
        assert 'node-version: "20' not in text, path
