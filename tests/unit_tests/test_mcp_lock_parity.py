import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROOT_LOCK = ROOT / "package-lock.json"
MCP_MANIFEST = ROOT / "mcp" / "package.json"
MCP_LOCK = ROOT / "mcp" / "package-lock.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _workspace_resolution(lock: dict, package: str) -> str | None:
    nested = lock.get("packages", {}).get(f"mcp/node_modules/{package}", {})
    root = lock.get("packages", {}).get(f"node_modules/{package}", {})
    return nested.get("version") or root.get("version")


def test_mcp_workspace_and_standalone_locks_match_manifest_contract() -> None:
    manifest = _load(MCP_MANIFEST)
    root_lock = _load(ROOT_LOCK)
    standalone_lock = _load(MCP_LOCK)

    workspace = root_lock["packages"]["mcp"]
    standalone = standalone_lock["packages"][""]

    assert workspace["dependencies"] == manifest["dependencies"]
    assert standalone["dependencies"] == manifest["dependencies"]
    assert workspace["engines"] == manifest["engines"]
    assert standalone["engines"] == manifest["engines"]

    for package in manifest["dependencies"]:
        workspace_version = _workspace_resolution(root_lock, package)
        standalone_entry = standalone_lock["packages"].get(
            f"node_modules/{package}", {}
        )
        assert workspace_version, f"missing workspace resolution for {package}"
        assert standalone_entry.get("version") == workspace_version, (
            f"standalone MCP resolution drift for {package}: "
            f"workspace={workspace_version}, standalone={standalone_entry.get('version')}"
        )
        assert standalone_entry.get("resolved"), f"missing resolved URL for {package}"
        assert standalone_entry.get("integrity"), f"missing integrity for {package}"
