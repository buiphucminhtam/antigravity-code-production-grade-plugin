#!/usr/bin/env python3
"""Version, drift-check, manifest, and hand off approved game assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
STYLE_CONTRACT_TOOL = ROOT / "scripts" / "art-direction" / "style-contract.py"
STYLE_SCHEMA = (
    ROOT / "skills" / "art-director" / "contracts" / "game-art-contract.v2.schema.json"
)
INVENTORY_SCHEMA = (
    ROOT / "skills" / "art-director" / "contracts" / "game-art-inventory.v1.schema.json"
)
MANIFEST_SCHEMA = (
    ROOT
    / "skills"
    / "art-director"
    / "contracts"
    / "game-art-engine-import.v1.schema.json"
)
INVENTORY_SCHEMA_VERSION = "game-art-inventory/v1"
MANIFEST_SCHEMA_VERSION = "game-art-engine-import/v1"
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class LifecycleError(ValueError):
    """Raised when lifecycle state cannot be advanced safely."""


def read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise LifecycleError(f"{label} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise LifecycleError(f"{label} must be a JSON object")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def json_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise LifecycleError(f"cannot hash asset {path}: {error}") from error
    return digest.hexdigest()


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False
        ) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    except OSError as error:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise LifecycleError(f"cannot write {path}: {error}") from error


def install_json_no_clobber(path: Path, value: dict[str, Any]) -> bool:
    """Atomically install JSON without replacing target-side state."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            prefix=f".{path.name}.forgewright-",
            dir=path.parent,
            delete=False,
        ) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        try:
            os.link(temporary, path)
            return True
        except FileExistsError:
            try:
                existing = read_json(path, "target engine manifest")
            except LifecycleError as error:
                raise LifecycleError(
                    f"refusing to overwrite changed target manifest: {path}"
                ) from error
            if existing != value:
                raise LifecycleError(
                    f"refusing to overwrite changed target manifest: {path}"
                )
            return False
    except OSError as error:
        raise LifecycleError(
            f"cannot install {path} without overwrite: {error}"
        ) from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def validate_contract(
    path: Path, visual_basis: Path | None, cards_dir: Path | None
) -> dict[str, Any]:
    command = [
        sys.executable,
        str(STYLE_CONTRACT_TOOL),
        "validate",
        str(path),
        "--stage",
        "generation",
    ]
    if visual_basis is not None:
        command.extend(["--visual-basis", str(visual_basis)])
    if cards_dir is not None:
        command.extend(["--cards-dir", str(cards_dir)])
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise LifecycleError(f"Style DNA contract is not generation-ready: {detail}")
    return read_json(path, "Style DNA contract")


def validate_identity(asset_type: str, name: str) -> None:
    schema = read_json(STYLE_SCHEMA, "Style DNA schema")
    allowed = schema.get("compiler_asset_types", [])
    if asset_type not in allowed:
        raise LifecycleError(
            f"asset type must be one of: {', '.join(str(item) for item in allowed)}"
        )
    if SAFE_NAME_RE.fullmatch(name) is None:
        raise LifecycleError(
            "asset name must start with an alphanumeric character and contain only "
            "letters, numbers, dot, underscore, or hyphen"
        )


def require_exact_fields(
    value: dict[str, Any], required: list[str], label: str
) -> None:
    for key in required:
        if key not in value:
            raise LifecycleError(f"{label} missing required field: {key}")
    unknown = sorted(set(value) - set(required))
    if unknown:
        raise LifecycleError(f"{label} has unknown field: {unknown[0]}")


def require_sha256(value: Any, label: str) -> None:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise LifecycleError(f"{label} must be a lowercase SHA-256 hex digest")


def canonical_manifest_relative_path(relative_text: str) -> str:
    if "\\" in relative_text:
        raise LifecycleError(f"unsafe manifest relative_path: {relative_text}")
    relative = PurePosixPath(relative_text)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise LifecycleError(f"unsafe manifest relative_path: {relative_text}")
    return relative.as_posix()


def validate_inventory_document(inventory: dict[str, Any]) -> None:
    schema = read_json(INVENTORY_SCHEMA, "asset inventory schema")
    if inventory.get("schema_version") != schema.get("$id"):
        raise LifecycleError(
            f"asset inventory schema_version must be {INVENTORY_SCHEMA_VERSION}"
        )
    require_exact_fields(inventory, schema["required_top_level"], "asset inventory")
    if (
        not isinstance(inventory["project_name"], str)
        or not inventory["project_name"].strip()
    ):
        raise LifecycleError("asset inventory project_name must be non-empty")
    require_sha256(inventory["contract_sha256"], "asset inventory contract_sha256")
    assets = inventory["assets"]
    if not isinstance(assets, list):
        raise LifecycleError("asset inventory assets must be a list")
    identities: set[str] = set()
    for asset_index, entry in enumerate(assets):
        label = f"asset inventory assets[{asset_index}]"
        if not isinstance(entry, dict):
            raise LifecycleError(f"{label} must be an object")
        require_exact_fields(entry, schema["asset_required"], label)
        asset_type = entry["asset_type"]
        name = entry["name"]
        if not isinstance(asset_type, str) or not isinstance(name, str):
            raise LifecycleError(f"{label} asset_type and name must be strings")
        validate_identity(asset_type, name)
        expected_id = f"{asset_type}/{name}"
        if entry["asset_id"] != expected_id:
            raise LifecycleError(f"{label} asset_id must be {expected_id}")
        if expected_id in identities:
            raise LifecycleError(f"asset inventory duplicate asset_id: {expected_id}")
        identities.add(expected_id)
        latest = entry["latest_version"]
        if isinstance(latest, bool) or not isinstance(latest, int) or latest <= 0:
            raise LifecycleError(f"{label} latest_version must be a positive integer")
        versions = entry["versions"]
        if not isinstance(versions, list) or not versions:
            raise LifecycleError(f"{label} versions must be a non-empty list")
        for version_index, version in enumerate(versions, start=1):
            version_label = f"{label} versions[{version_index - 1}]"
            if not isinstance(version, dict):
                raise LifecycleError(f"{version_label} must be an object")
            require_exact_fields(version, schema["version_required"], version_label)
            if version["version"] != version_index:
                raise LifecycleError(
                    f"{version_label} version must be contiguous value {version_index}"
                )
            if (
                not isinstance(version["source_path"], str)
                or not version["source_path"].strip()
            ):
                raise LifecycleError(f"{version_label} source_path must be non-empty")
            require_sha256(version["sha256"], f"{version_label} sha256")
            require_sha256(
                version["contract_sha256"], f"{version_label} contract_sha256"
            )
        if latest != versions[-1]["version"]:
            raise LifecycleError(f"{label} latest_version must match the last version")


def validate_manifest_document(manifest: dict[str, Any]) -> None:
    schema = read_json(MANIFEST_SCHEMA, "engine import manifest schema")
    if manifest.get("schema_version") != schema.get("$id"):
        raise LifecycleError(
            f"engine import manifest schema_version must be {MANIFEST_SCHEMA_VERSION}"
        )
    require_exact_fields(
        manifest, schema["required_top_level"], "engine import manifest"
    )
    if (
        not isinstance(manifest["project_name"], str)
        or not manifest["project_name"].strip()
    ):
        raise LifecycleError("engine import manifest project_name must be non-empty")
    if manifest["engine"] not in schema["supported_engines"]:
        raise LifecycleError("engine import manifest engine is unsupported")
    require_sha256(manifest["contract_sha256"], "manifest contract_sha256")
    require_sha256(manifest["inventory_sha256"], "manifest inventory_sha256")
    assets = manifest["assets"]
    if not isinstance(assets, list) or not assets:
        raise LifecycleError("engine import manifest assets must be a non-empty list")
    asset_ids: set[str] = set()
    relative_paths: set[str] = set()
    for index, item in enumerate(assets):
        label = f"engine import manifest assets[{index}]"
        if not isinstance(item, dict):
            raise LifecycleError(f"{label} must be an object")
        require_exact_fields(item, schema["asset_required"], label)
        if not isinstance(item["asset_id"], str) or not item["asset_id"]:
            raise LifecycleError(f"{label} asset_id must be non-empty")
        if item["asset_id"] in asset_ids:
            raise LifecycleError(
                f"engine import manifest duplicate asset_id: {item['asset_id']}"
            )
        asset_ids.add(item["asset_id"])
        if (
            isinstance(item["version"], bool)
            or not isinstance(item["version"], int)
            or item["version"] <= 0
        ):
            raise LifecycleError(f"{label} version must be a positive integer")
        if not isinstance(item["source_path"], str) or not item["source_path"]:
            raise LifecycleError(f"{label} source_path must be non-empty")
        require_sha256(item["sha256"], f"{label} sha256")
        relative_text = item["relative_path"]
        if not isinstance(relative_text, str) or not relative_text:
            raise LifecycleError(f"{label} relative_path must be non-empty")
        canonical_relative = canonical_manifest_relative_path(relative_text)
        if canonical_relative in relative_paths:
            raise LifecycleError(
                f"engine import manifest duplicate relative_path: {relative_text}"
            )
        relative_paths.add(canonical_relative)
        if not isinstance(item["engine_uri"], str) or not item["engine_uri"]:
            raise LifecycleError(f"{label} engine_uri must be non-empty")
        if not isinstance(item["import_settings"], dict):
            raise LifecycleError(f"{label} import_settings must be an object")


def new_inventory(contract: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": INVENTORY_SCHEMA_VERSION,
        "project_name": contract["project"]["name"],
        "contract_sha256": json_hash(contract),
        "assets": [],
    }


def load_inventory(path: Path, contract: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return new_inventory(contract)
    inventory = read_json(path, "asset inventory")
    validate_inventory_document(inventory)
    if inventory.get("project_name") != contract["project"]["name"]:
        raise LifecycleError("asset inventory belongs to a different project")
    return inventory


def latest_version(entry: dict[str, Any]) -> dict[str, Any]:
    versions = entry.get("versions")
    if not isinstance(versions, list) or not versions:
        raise LifecycleError(
            f"asset {entry.get('asset_id', '<unknown>')} has no versions"
        )
    latest = versions[-1]
    if not isinstance(latest, dict):
        raise LifecycleError("asset version must be an object")
    return latest


def command_register(args: argparse.Namespace) -> int:
    contract = validate_contract(args.contract, args.visual_basis, args.cards_dir)
    validate_identity(args.asset_type, args.name)
    try:
        asset = args.asset.resolve(strict=True)
    except OSError as error:
        raise LifecycleError(f"asset cannot be resolved: {error}") from error
    if not asset.is_file():
        raise LifecycleError(f"asset must be a file: {asset}")

    inventory = load_inventory(args.inventory, contract)
    contract_sha = json_hash(contract)
    digest = file_hash(asset)
    asset_id = f"{args.asset_type}/{args.name}"
    entries = inventory["assets"]
    entry = next(
        (
            candidate
            for candidate in entries
            if isinstance(candidate, dict) and candidate.get("asset_id") == asset_id
        ),
        None,
    )
    if entry is None:
        entry = {
            "asset_id": asset_id,
            "asset_type": args.asset_type,
            "name": args.name,
            "latest_version": 0,
            "versions": [],
        }
        entries.append(entry)

    latest = latest_version(entry) if entry["versions"] else None
    if (
        latest is not None
        and latest.get("sha256") == digest
        and latest.get("contract_sha256") == contract_sha
        and latest.get("source_path") == str(asset)
    ):
        response = {
            "status": "unchanged",
            "asset_id": asset_id,
            "version": latest["version"],
            "sha256": digest,
        }
        print(json.dumps(response, sort_keys=True))
        return 0

    version = int(entry["latest_version"]) + 1
    entry["versions"].append(
        {
            "version": version,
            "source_path": str(asset),
            "sha256": digest,
            "contract_sha256": contract_sha,
        }
    )
    entry["latest_version"] = version
    entries.sort(key=lambda candidate: str(candidate.get("asset_id", "")))
    inventory["contract_sha256"] = contract_sha
    atomic_write_json(args.inventory, inventory)
    response = {
        "status": "registered",
        "asset_id": asset_id,
        "version": version,
        "sha256": digest,
    }
    print(json.dumps(response, sort_keys=True))
    return 0


def drift_report(contract: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    contract_sha = json_hash(contract)
    findings: list[dict[str, Any]] = []
    reasons: set[str] = set()
    for entry in inventory["assets"]:
        if not isinstance(entry, dict):
            raise LifecycleError("asset inventory entry must be an object")
        latest = latest_version(entry)
        asset_reasons: list[str] = []
        if latest.get("contract_sha256") != contract_sha:
            asset_reasons.append("contract_changed")
        source = Path(str(latest.get("source_path", "")))
        if not source.is_file():
            asset_reasons.append("asset_missing")
        elif file_hash(source) != latest.get("sha256"):
            asset_reasons.append("content_changed")
        if asset_reasons:
            reasons.update(asset_reasons)
            findings.append(
                {
                    "asset_id": entry.get("asset_id"),
                    "version": latest.get("version"),
                    "reasons": sorted(asset_reasons),
                }
            )
    return {
        "schema_version": "game-art-drift-report/v1",
        "status": "drifted" if findings else "clean",
        "contract_sha256": contract_sha,
        "reasons": sorted(reasons),
        "findings": findings,
    }


def command_drift(args: argparse.Namespace) -> int:
    contract = validate_contract(args.contract, args.visual_basis, args.cards_dir)
    if not args.inventory.is_file():
        raise LifecycleError(f"asset inventory not found: {args.inventory}")
    inventory = load_inventory(args.inventory, contract)
    report = drift_report(contract, inventory)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if report["status"] == "drifted" else 0


def safe_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    if not normalized:
        raise LifecycleError(f"cannot derive safe path component from {value!r}")
    return normalized


def engine_uri(engine: str, relative: PurePosixPath) -> str:
    relative_text = relative.as_posix()
    prefixes = {
        "unity": "Assets/Art/",
        "godot": "res://art/",
        "unreal": "/Game/Art/",
        "phaser": "assets/art/",
        "threejs": "assets/art/",
        "generic": "art/",
    }
    return prefixes[engine] + relative_text.removeprefix("art/")


def build_manifest(
    contract: dict[str, Any], inventory: dict[str, Any]
) -> dict[str, Any]:
    report = drift_report(contract, inventory)
    if report["status"] != "clean":
        raise LifecycleError(
            "inventory drift detected; register changed assets against the current "
            "contract before generating an engine manifest"
        )
    if not inventory["assets"]:
        raise LifecycleError("asset inventory is empty")

    engine = contract["engine"]
    rendering = contract["style"]["rendering"]
    atlas = safe_component(engine["atlas_group"])
    manifest_assets: list[dict[str, Any]] = []
    for entry in inventory["assets"]:
        latest = latest_version(entry)
        source = Path(latest["source_path"])
        suffix = source.suffix.lower() or ".bin"
        relative = PurePosixPath(
            "art",
            atlas,
            safe_component(entry["asset_type"]),
            f"{safe_component(entry['name'])}-v{latest['version']}{suffix}",
        )
        manifest_assets.append(
            {
                "asset_id": entry["asset_id"],
                "version": latest["version"],
                "source_path": str(source),
                "sha256": latest["sha256"],
                "relative_path": relative.as_posix(),
                "engine_uri": engine_uri(engine["name"], relative),
                "import_settings": {
                    "pixels_per_unit": engine["pixels_per_unit"],
                    "texture_compression": engine["texture_compression"],
                    "atlas_group": engine["atlas_group"],
                    "filter_mode": "nearest" if rendering == "pixel_art" else "linear",
                },
            }
        )
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "project_name": contract["project"]["name"],
        "engine": engine["name"],
        "contract_sha256": json_hash(contract),
        "inventory_sha256": json_hash(inventory),
        "assets": manifest_assets,
    }


def command_manifest(args: argparse.Namespace) -> int:
    contract = validate_contract(args.contract, args.visual_basis, args.cards_dir)
    if not args.inventory.is_file():
        raise LifecycleError(f"asset inventory not found: {args.inventory}")
    inventory = load_inventory(args.inventory, contract)
    manifest = build_manifest(contract, inventory)
    atomic_write_json(args.output, manifest)
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


def resolve_destination(target: Path, relative_text: str) -> Path:
    relative = PurePosixPath(canonical_manifest_relative_path(relative_text))
    destination = target.joinpath(*relative.parts).resolve(strict=False)
    if destination != target and target not in destination.parents:
        raise LifecycleError(f"manifest path escapes handoff target: {relative_text}")
    return destination


def copy_asset_no_clobber(source: Path, destination: Path, expected: str) -> bool:
    """Copy and atomically publish an asset without replacing any destination."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.forgewright-", dir=destination.parent
    )
    os.close(file_descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(source, temporary)
        if file_hash(temporary) != expected:
            raise LifecycleError(f"handoff copy verification failed: {destination}")
        try:
            os.link(temporary, destination)
            return True
        except FileExistsError:
            if destination.is_file() and file_hash(destination) == expected:
                return False
            raise LifecycleError(f"refusing to overwrite changed target: {destination}")
    except OSError as error:
        raise LifecycleError(
            f"cannot install asset without overwrite: {destination}: {error}"
        ) from error
    finally:
        temporary.unlink(missing_ok=True)


def command_handoff(args: argparse.Namespace) -> int:
    manifest = read_json(args.manifest, "engine import manifest")
    validate_manifest_document(manifest)
    assets = manifest["assets"]
    target = args.target_dir.resolve(strict=False)
    target_manifest = target / "game-art-engine-import.json"
    manifest_matches = False
    if target_manifest.exists():
        try:
            existing_manifest = read_json(target_manifest, "target engine manifest")
        except LifecycleError as error:
            raise LifecycleError(
                f"refusing to overwrite changed target manifest: {target_manifest}"
            ) from error
        if existing_manifest != manifest:
            raise LifecycleError(
                f"refusing to overwrite changed target manifest: {target_manifest}"
            )
        manifest_matches = True

    transfers: list[tuple[Path, Path, str]] = []
    skipped = 0
    for item in assets:
        if not isinstance(item, dict):
            raise LifecycleError("engine import manifest asset must be an object")
        source = Path(str(item.get("source_path", "")))
        expected = str(item.get("sha256", ""))
        if not source.is_file() or file_hash(source) != expected:
            raise LifecycleError(f"source asset hash mismatch: {source}")
        destination = resolve_destination(target, str(item.get("relative_path", "")))
        if destination.exists():
            if not destination.is_file() or file_hash(destination) != expected:
                raise LifecycleError(
                    f"refusing to overwrite changed target: {destination}"
                )
            skipped += 1
            continue
        transfers.append((source, destination, expected))

    target.mkdir(parents=True, exist_ok=True)
    copied = 0
    for source, destination, expected in transfers:
        if copy_asset_no_clobber(source, destination, expected):
            copied += 1
        else:
            skipped += 1

    if not manifest_matches:
        install_json_no_clobber(target_manifest, manifest)
    response = {
        "status": "handed_off",
        "target_dir": str(target),
        "copied": copied,
        "skipped": skipped,
    }
    print(json.dumps(response, sort_keys=True))
    return 0


def add_evidence_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--visual-basis", type=Path)
    command.add_argument("--cards-dir", type=Path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register")
    register.add_argument("--contract", type=Path, required=True)
    add_evidence_arguments(register)
    register.add_argument("--inventory", type=Path, required=True)
    register.add_argument("--asset-type", required=True)
    register.add_argument("--name", required=True)
    register.add_argument("--asset", type=Path, required=True)
    register.set_defaults(handler=command_register)

    drift = subparsers.add_parser("drift")
    drift.add_argument("--contract", type=Path, required=True)
    add_evidence_arguments(drift)
    drift.add_argument("--inventory", type=Path, required=True)
    drift.set_defaults(handler=command_drift)

    manifest = subparsers.add_parser("manifest")
    manifest.add_argument("--contract", type=Path, required=True)
    add_evidence_arguments(manifest)
    manifest.add_argument("--inventory", type=Path, required=True)
    manifest.add_argument("--output", type=Path, required=True)
    manifest.set_defaults(handler=command_manifest)

    handoff = subparsers.add_parser("handoff")
    handoff.add_argument("--manifest", type=Path, required=True)
    handoff.add_argument("--target-dir", type=Path, required=True)
    handoff.set_defaults(handler=command_handoff)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except LifecycleError as error:
        print(f"ASSET LIFECYCLE ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
