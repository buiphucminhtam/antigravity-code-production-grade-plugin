from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from tests.unit_tests.test_visual_evidence import (
    evidence_card,
    visual_basis,
    write_bundle,
)


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "art-direction" / "style-contract.py"
SCHEMA = (
    ROOT / "skills" / "art-director" / "contracts" / "game-art-contract.v2.schema.json"
)


def valid_contract() -> dict[str, object]:
    return {
        "schema_version": "game-art-contract/v2",
        "project": {
            "name": "Test Game",
            "genre": ["puzzle"],
            "platform": "mobile",
            "asset_scope": "2d",
        },
        "approval": {
            "status": "approved",
            "approved_by": "test",
            "approved_at": "2026-07-19T00:00:00Z",
        },
        "evidence_basis": {
            "basis_id": "basis-dev-workspace-v1",
            "card_ids": ["product-1", "product-2", "product-3"],
            "model_prior_used_as_evidence": False,
        },
        "references": {
            "style": ["references/style.png"],
            "target": [],
            "character": [],
        },
        "style": {
            "rendering": "pixel_art",
            "pixel_register": "16bit",
            "mood": ["playful"],
            "shape": {
                "language": "geometric",
                "corner_radius": "small",
                "ui_panel_geometry": "square_chunky",
            },
            "palette": {
                "primary": ["#123456"],
                "secondary": ["#345678"],
                "accent": ["#FFD34A"],
                "neutral": ["#E2E8F0"],
            },
            "color_map": {
                "background": ["#123456"],
                "button_primary": ["#FFD34A", "#345678"],
                "text_label": ["#E2E8F0"],
            },
            "materials": {
                "button": "matte_plastic",
                "container": "painted_card",
                "icon": "flat",
                "character": "cel_flat",
                "environment": "flat_vector_scene",
            },
            "lighting": {
                "direction": "top_left",
                "contrast": "medium",
                "highlight": "soft",
                "shadow": "soft_bottom",
            },
            "outline": {
                "enabled": True,
                "thickness": "thin",
                "color": "darker_variant",
            },
            "camera": "orthographic",
            "canvas": {"orientation": "landscape", "aspect_ratio": "16:9"},
            "negative": ["photorealism", "anti_aliasing"],
            "confidence": {
                "shape": 0.95,
                "palette": 1.0,
                "rendering": 0.98,
                "material": 0.9,
                "lighting": 0.86,
            },
        },
        "engine": {
            "name": "godot",
            "pixels_per_unit": 16,
            "texture_compression": "lossless",
            "atlas_group": "core-gameplay",
        },
    }


def write_contract(tmp_path: Path, value: dict[str, object]) -> Path:
    path = tmp_path / "game-art-contract.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def evidence_args(tmp_path: Path) -> list[str]:
    basis_path = tmp_path / "visual-basis.json"
    cards_dir = tmp_path / "cards"
    if not basis_path.is_file() or not cards_dir.is_dir():
        cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
        basis = visual_basis([str(card["id"]) for card in cards])
        basis_path, cards_dir = write_bundle(tmp_path, cards, basis)
    return ["--visual-basis", str(basis_path), "--cards-dir", str(cards_dir)]


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_schema_and_generation_contract_validate(tmp_path: Path) -> None:
    assert SCHEMA.is_file()
    contract = write_contract(tmp_path, valid_contract())

    result = run_tool(
        "validate", str(contract), "--stage", "generation", *evidence_args(tmp_path)
    )

    assert result.returncode == 0, result.stderr
    assert "VALID game-art-contract/v2" in result.stdout


def test_generation_validation_fails_closed_on_unapproved_contract(
    tmp_path: Path,
) -> None:
    value = valid_contract()
    value["approval"] = {"status": "draft"}
    contract = write_contract(tmp_path, value)

    result = run_tool(
        "validate", str(contract), "--stage", "generation", *evidence_args(tmp_path)
    )

    assert result.returncode != 0
    assert "approval.status must be approved" in result.stderr


def test_generation_validation_requires_approval_receipt(tmp_path: Path) -> None:
    value = valid_contract()
    value["approval"] = {"status": "approved"}
    contract = write_contract(tmp_path, value)

    result = run_tool(
        "validate", str(contract), "--stage", "generation", *evidence_args(tmp_path)
    )

    assert result.returncode != 0
    assert "approval.approved_by must be recorded" in result.stderr
    assert "approval.approved_at must be recorded" in result.stderr


def test_generation_validation_requires_grounded_visual_evidence(
    tmp_path: Path,
) -> None:
    contract = write_contract(tmp_path, valid_contract())

    result = run_tool("validate", str(contract), "--stage", "generation")

    assert result.returncode != 0
    assert "generation requires --visual-basis and --cards-dir" in result.stderr
    assert "model priors or unbound references are not evidence" in result.stderr


def test_generation_validation_rejects_bad_hex_even_with_grounded_evidence(
    tmp_path: Path,
) -> None:
    value = valid_contract()
    style = value["style"]
    assert isinstance(style, dict)
    palette = style["palette"]
    confidence = style["confidence"]
    assert isinstance(palette, dict)
    assert isinstance(confidence, dict)
    palette["primary"] = ["blue"]
    confidence["lighting"] = 0.0
    contract = write_contract(tmp_path, value)

    result = run_tool(
        "validate", str(contract), "--stage", "generation", *evidence_args(tmp_path)
    )

    assert result.returncode != 0
    assert "style.palette.primary[0] must match #RRGGBB" in result.stderr
    assert "style.confidence.lighting must be >=" not in result.stderr


def test_low_self_confidence_is_telemetry_not_generation_authority(
    tmp_path: Path,
) -> None:
    value = valid_contract()
    style = value["style"]
    assert isinstance(style, dict)
    style["confidence"] = {"shape": 0.0, "palette": 0.0}
    contract = write_contract(tmp_path, value)

    result = run_tool(
        "validate", str(contract), "--stage", "generation", *evidence_args(tmp_path)
    )

    assert result.returncode == 0, result.stderr


def test_compile_is_deterministic_and_contains_no_placeholders(tmp_path: Path) -> None:
    contract = write_contract(tmp_path, valid_contract())
    args = evidence_args(tmp_path)

    first = run_tool(
        "compile",
        str(contract),
        "--asset-type",
        "character",
        "--name",
        "clockwork-fox",
        *args,
    )
    second = run_tool(
        "compile",
        str(contract),
        "--asset-type",
        "character",
        "--name",
        "clockwork-fox",
        *args,
    )

    assert first.returncode == 0, first.stderr
    assert first.stdout == second.stdout
    assert "clockwork-fox" in first.stdout
    assert "#123456" in first.stdout
    assert "Evidence basis: basis-dev-workspace-v1" in first.stdout
    assert "model training prior is hypothesis-only and is not evidence" in first.stdout
    assert "STYLE reference roles" in first.stdout
    assert "STYLE = references/style.png" in first.stdout
    assert re.search(r"\[[A-Z][A-Z0-9_ -]*\]", first.stdout) is None


def test_compile_rejects_lowercase_bracket_placeholder(tmp_path: Path) -> None:
    value = valid_contract()
    style = value["style"]
    assert isinstance(style, dict)
    style["mood"] = ["[draft_mood]"]
    contract = write_contract(tmp_path, value)

    result = run_tool(
        "compile",
        str(contract),
        "--asset-type",
        "character",
        "--name",
        "hero",
        *evidence_args(tmp_path),
    )

    assert result.returncode != 0
    assert "unresolved placeholders" in result.stderr


def test_init_writes_structurally_valid_evidence_neutral_draft(tmp_path: Path) -> None:
    output = tmp_path / "new-contract.json"

    init = run_tool(
        "init",
        str(output),
        "--project-type",
        "game-2d",
        "--project-name",
        "Draft Game",
    )
    validate = run_tool("validate", str(output), "--stage", "draft")
    generation = run_tool("validate", str(output), "--stage", "generation")

    assert init.returncode == 0, init.stderr
    assert validate.returncode == 0, validate.stderr
    assert generation.returncode != 0
    assert "approval.status must be approved" in generation.stderr

    draft = json.loads(output.read_text(encoding="utf-8"))
    assert draft["evidence_basis"] == {
        "basis_id": "unresolved",
        "card_ids": [],
        "model_prior_used_as_evidence": False,
    }
    assert draft["project"]["genre"] == []
    assert draft["project"]["platform"] == "unresolved"
    assert draft["style"]["rendering"] == "unresolved"
    assert draft["style"]["mood"] == []
    assert all(values == [] for values in draft["style"]["palette"].values())
    assert draft["style"]["color_map"] == {}
    assert draft["style"]["outline"]["enabled"] is None
    assert draft["style"]["camera"] == "unresolved"
