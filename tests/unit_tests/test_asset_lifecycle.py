from __future__ import annotations

import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

from tests.unit_tests.test_style_contract import evidence_args, valid_contract


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "art-direction" / "asset-lifecycle.py"
PIPELINE = ROOT / "scripts" / "art-direction" / "art-pipeline.sh"


def write_contract(tmp_path: Path, *, engine: str = "godot") -> Path:
    value = valid_contract()
    engine_value = value["engine"]
    assert isinstance(engine_value, dict)
    engine_value["name"] = engine
    path = tmp_path / "game-art-contract.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    command_args = list(args)
    if command_args and command_args[0] in {"register", "drift", "manifest"}:
        contract_index = command_args.index("--contract") + 1
        contract = Path(command_args[contract_index])
        command_args.extend(evidence_args(contract.parent))
    return subprocess.run(
        [sys.executable, str(TOOL), *command_args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def register(
    contract: Path,
    inventory: Path,
    asset: Path,
    *,
    name: str = "hero",
) -> subprocess.CompletedProcess[str]:
    return run_tool(
        "register",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--asset-type",
        "character",
        "--name",
        name,
        "--asset",
        str(asset),
    )


def test_register_is_idempotent_and_versions_changed_content(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"version-one")

    first = register(contract, inventory, asset)
    same = register(contract, inventory, asset)
    asset.write_bytes(b"version-two")
    changed = register(contract, inventory, asset)

    assert first.returncode == 0, first.stderr
    assert same.returncode == 0, same.stderr
    assert changed.returncode == 0, changed.stderr
    assert json.loads(first.stdout)["version"] == 1
    assert json.loads(same.stdout)["status"] == "unchanged"
    assert json.loads(changed.stdout)["version"] == 2
    document = json.loads(inventory.read_text(encoding="utf-8"))
    assert document["schema_version"] == "game-art-inventory/v1"
    assert len(document["assets"]) == 1
    assert len(document["assets"][0]["versions"]) == 2


def test_drift_detects_contract_content_and_missing_file_changes(
    tmp_path: Path,
) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"registered")
    assert register(contract, inventory, asset).returncode == 0

    clean = run_tool(
        "drift", "--contract", str(contract), "--inventory", str(inventory)
    )
    assert clean.returncode == 0, clean.stderr
    assert json.loads(clean.stdout)["status"] == "clean"

    asset.write_bytes(b"unregistered-change")
    content_drift = run_tool(
        "drift", "--contract", str(contract), "--inventory", str(inventory)
    )
    assert content_drift.returncode == 1
    assert "content_changed" in json.loads(content_drift.stdout)["reasons"]

    asset.unlink()
    missing = run_tool(
        "drift", "--contract", str(contract), "--inventory", str(inventory)
    )
    assert missing.returncode == 1
    assert "asset_missing" in json.loads(missing.stdout)["reasons"]

    asset.write_bytes(b"registered")
    value = json.loads(contract.read_text(encoding="utf-8"))
    value["style"]["mood"] = ["serious"]
    contract.write_text(json.dumps(value, indent=2), encoding="utf-8")
    contract_drift = run_tool(
        "drift", "--contract", str(contract), "--inventory", str(inventory)
    )
    assert contract_drift.returncode == 1
    assert "contract_changed" in json.loads(contract_drift.stdout)["reasons"]


def test_manifest_and_handoff_are_deterministic_and_non_destructive(
    tmp_path: Path,
) -> None:
    contract = write_contract(tmp_path, engine="godot")
    inventory = tmp_path / "asset-inventory.json"
    manifest = tmp_path / "engine-import.json"
    target = tmp_path / "game-project"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset-bytes")
    assert register(contract, inventory, asset).returncode == 0

    first = run_tool(
        "manifest",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--output",
        str(manifest),
    )
    first_bytes = manifest.read_bytes()
    second = run_tool(
        "manifest",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--output",
        str(manifest),
    )

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert manifest.read_bytes() == first_bytes
    document = json.loads(first.stdout)
    assert document["schema_version"] == "game-art-engine-import/v1"
    assert document["engine"] == "godot"
    assert document["assets"][0]["engine_uri"].startswith("res://art/")
    assert document["assets"][0]["import_settings"]["pixels_per_unit"] == 16

    handoff = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )
    repeated = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )
    assert handoff.returncode == 0, handoff.stderr
    assert repeated.returncode == 0, repeated.stderr
    copied = target / document["assets"][0]["relative_path"]
    assert copied.read_bytes() == b"asset-bytes"
    assert (target / "game-art-engine-import.json").is_file()

    copied.write_bytes(b"local-user-change")
    conflict = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )
    assert conflict.returncode != 0
    assert "refusing to overwrite" in conflict.stderr


def test_manifest_fails_closed_when_inventory_has_drift(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"registered")
    assert register(contract, inventory, asset).returncode == 0
    asset.write_bytes(b"changed")

    result = run_tool(
        "manifest",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--output",
        str(tmp_path / "manifest.json"),
    )

    assert result.returncode != 0
    assert "inventory drift detected" in result.stderr


def test_pipeline_wires_register_drift_manifest_and_handoff(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    manifest = tmp_path / "engine-import.json"
    target = tmp_path / "game-project"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"pipeline-asset")
    env = os.environ.copy()
    env.update(
        {
            "PROJECT_STYLE_GUIDE": str(contract),
            "ART_ASSET_INVENTORY": str(inventory),
            "ART_ENGINE_MANIFEST": str(manifest),
            "VISUAL_BASIS_PATH": str(Path(evidence_args(tmp_path)[1])),
            "VISUAL_EVIDENCE_CARDS_DIR": str(Path(evidence_args(tmp_path)[3])),
        }
    )

    commands = [
        [str(PIPELINE), "register", "character", "hero", str(asset)],
        [str(PIPELINE), "drift"],
        [str(PIPELINE), "manifest"],
        [str(PIPELINE), "handoff", str(target)],
    ]
    results = [
        subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        for command in commands
    ]

    assert all(result.returncode == 0 for result in results), [
        result.stderr for result in results
    ]
    assert inventory.is_file()
    assert manifest.is_file()
    assert (target / "game-art-engine-import.json").is_file()


def test_malformed_inventory_fails_closed_without_traceback(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    inventory.write_text(
        json.dumps(
            {
                "schema_version": "game-art-inventory/v1",
                "project_name": "Test Game",
                "assets": [],
            }
        ),
        encoding="utf-8",
    )

    result = run_tool(
        "drift", "--contract", str(contract), "--inventory", str(inventory)
    )

    assert result.returncode != 0
    assert "missing required field: contract_sha256" in result.stderr
    assert "Traceback" not in result.stderr


def test_malformed_latest_version_fails_closed_without_traceback(
    tmp_path: Path,
) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "asset-inventory.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset")
    value = {
        "schema_version": "game-art-inventory/v1",
        "project_name": "Test Game",
        "contract_sha256": "0" * 64,
        "assets": [
            {
                "asset_id": "character/hero",
                "asset_type": "character",
                "name": "hero",
                "latest_version": "bogus",
                "versions": [
                    {
                        "version": 1,
                        "source_path": str(asset),
                        "sha256": "0" * 64,
                        "contract_sha256": "0" * 64,
                    }
                ],
            }
        ],
    }
    inventory.write_text(json.dumps(value), encoding="utf-8")

    result = register(contract, inventory, asset)

    assert result.returncode != 0
    assert "latest_version must be a positive integer" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("alias", ["art//shared.bin", "art/./shared.bin"])
def test_handoff_rejects_duplicate_destinations_before_copy(
    tmp_path: Path, alias: str
) -> None:
    first = tmp_path / "first.bin"
    second = tmp_path / "second.bin"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": "game-art-engine-import/v1",
                "project_name": "Test Game",
                "engine": "generic",
                "contract_sha256": "1" * 64,
                "inventory_sha256": "2" * 64,
                "assets": [
                    {
                        "asset_id": "object/first",
                        "version": 1,
                        "source_path": str(first),
                        "sha256": __import__("hashlib").sha256(b"first").hexdigest(),
                        "relative_path": "art/shared.bin",
                        "engine_uri": "art/shared.bin",
                        "import_settings": {},
                    },
                    {
                        "asset_id": "object/second",
                        "version": 1,
                        "source_path": str(second),
                        "sha256": __import__("hashlib").sha256(b"second").hexdigest(),
                        "relative_path": alias,
                        "engine_uri": "art/shared.bin",
                        "import_settings": {},
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    target = tmp_path / "target"

    result = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )

    assert result.returncode != 0
    assert "duplicate relative_path" in result.stderr
    assert not (target / "art/shared.bin").exists()


def test_handoff_rejects_non_posix_relative_path(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"source")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": "game-art-engine-import/v1",
                "project_name": "Test Game",
                "engine": "generic",
                "contract_sha256": "1" * 64,
                "inventory_sha256": "2" * 64,
                "assets": [
                    {
                        "asset_id": "object/source",
                        "version": 1,
                        "source_path": str(source),
                        "sha256": __import__("hashlib").sha256(b"source").hexdigest(),
                        "relative_path": "art\\source.bin",
                        "engine_uri": "art/source.bin",
                        "import_settings": {},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(tmp_path / "target")
    )

    assert result.returncode != 0
    assert "unsafe manifest relative_path" in result.stderr


def test_handoff_preserves_preexisting_predictable_temp_file(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "inventory.json"
    manifest = tmp_path / "manifest.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset")
    assert register(contract, inventory, asset).returncode == 0
    generated = run_tool(
        "manifest",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--output",
        str(manifest),
    )
    assert generated.returncode == 0, generated.stderr

    document = json.loads(generated.stdout)
    target = tmp_path / "target"
    destination = target / document["assets"][0]["relative_path"]
    destination.parent.mkdir(parents=True)
    sentinel = destination.with_name(f".{destination.name}.forgewright-tmp")
    sentinel.write_bytes(b"unrelated-user-file")

    result = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )

    assert result.returncode == 0, result.stderr
    assert destination.read_bytes() == b"asset"
    assert sentinel.read_bytes() == b"unrelated-user-file"


def test_asset_publish_race_never_replaces_new_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    namespace = runpy.run_path(str(TOOL))
    copy_asset_no_clobber = namespace["copy_asset_no_clobber"]
    lifecycle_error = namespace["LifecycleError"]
    source = tmp_path / "source.bin"
    destination = tmp_path / "target" / "asset.bin"
    source.write_bytes(b"generated-asset")
    expected = __import__("hashlib").sha256(b"generated-asset").hexdigest()
    real_link = os.link

    def create_target_then_link(source_path: Path, target_path: Path) -> None:
        Path(target_path).write_bytes(b"local-racing-write")
        real_link(source_path, target_path)

    monkeypatch.setattr(os, "link", create_target_then_link)

    with pytest.raises(lifecycle_error, match="refusing to overwrite changed target"):
        copy_asset_no_clobber(source, destination, expected)

    assert destination.read_bytes() == b"local-racing-write"


def test_handoff_refuses_to_replace_changed_target_manifest(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "inventory.json"
    manifest = tmp_path / "manifest.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset")
    assert register(contract, inventory, asset).returncode == 0
    assert (
        run_tool(
            "manifest",
            "--contract",
            str(contract),
            "--inventory",
            str(inventory),
            "--output",
            str(manifest),
        ).returncode
        == 0
    )
    target = tmp_path / "target"
    target.mkdir()
    target_manifest = target / "game-art-engine-import.json"
    target_manifest.write_text("local user content", encoding="utf-8")

    result = run_tool(
        "handoff", "--manifest", str(manifest), "--target-dir", str(target)
    )

    assert result.returncode != 0
    assert "refusing to overwrite changed target manifest" in result.stderr
    assert target_manifest.read_text(encoding="utf-8") == "local user content"


@pytest.mark.parametrize(
    ("engine", "prefix"),
    [
        ("unity", "Assets/Art/"),
        ("unreal", "/Game/Art/"),
        ("godot", "res://art/"),
        ("phaser", "assets/art/"),
        ("threejs", "assets/art/"),
        ("generic", "art/"),
    ],
)
def test_manifest_supports_every_contract_engine(
    tmp_path: Path, engine: str, prefix: str
) -> None:
    contract = write_contract(tmp_path, engine=engine)
    inventory = tmp_path / "inventory.json"
    manifest = tmp_path / "manifest.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset")
    assert register(contract, inventory, asset).returncode == 0

    result = run_tool(
        "manifest",
        "--contract",
        str(contract),
        "--inventory",
        str(inventory),
        "--output",
        str(manifest),
    )

    assert result.returncode == 0, result.stderr
    document = json.loads(result.stdout)
    assert document["engine"] == engine
    assert document["assets"][0]["engine_uri"].startswith(prefix)


def test_register_rejects_path_like_asset_identity(tmp_path: Path) -> None:
    contract = write_contract(tmp_path)
    inventory = tmp_path / "inventory.json"
    asset = tmp_path / "hero.png"
    asset.write_bytes(b"asset")

    result = register(contract, inventory, asset, name="../hero")

    assert result.returncode != 0
    assert "asset name must start with" in result.stderr
    assert not inventory.exists()
