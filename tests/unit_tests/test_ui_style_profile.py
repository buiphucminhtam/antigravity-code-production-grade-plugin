from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

from tests.unit_tests.test_visual_evidence import (
    evidence_card,
    visual_basis,
    write_bundle,
)


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "art-direction" / "ui_style_profile.py"
REGISTRY = ROOT / "skills" / "ui-designer" / "data" / "reference-registry.json"


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def output(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    assert result.stderr == "", result.stderr
    return json.loads(result.stdout)


def style_profile(*, decision_id: str = "decision-semantic-color") -> dict[str, object]:
    def axis(value: str) -> dict[str, object]:
        return {"value": value, "decision_ids": [decision_id]}

    return {
        "schema_version": "ui-style-profile/v1",
        "id": "ui-profile-dev-workspace-v1",
        "status": "GROUNDED",
        "basis_id": "basis-dev-workspace-v1",
        "registry_ids": ["primer", "daisyui", "ui-ux-pro-max"],
        "signature": {
            "density": axis(
                "Dense workspace with explicit grouping and progressive disclosure."
            ),
            "geometry": axis(
                "Compact rectilinear controls with hierarchy expressed through role, not repeated cards."
            ),
            "surface": axis(
                "Quiet semantic surfaces with boundaries reserved for meaningful grouping."
            ),
            "typography": axis(
                "Compact role-based hierarchy with contrast from scale and weight."
            ),
            "chroma": axis(
                "Neutral surfaces with sparse semantic accents tied to state and action."
            ),
            "depth": axis(
                "Low decorative elevation; use borders or layering only where hierarchy needs it."
            ),
            "motion": axis(
                "State-change motion is restrained and tied to interaction feedback."
            ),
            "composition": axis(
                "Dominant work area with supporting navigation and secondary regions."
            ),
            "imagery": axis(
                "Functional icons and diagrams support content without becoming generic decoration."
            ),
        },
        "stack_independence": {
            "base_component_stack": "shadcn-compatible primitives",
            "unmodified_stack_default": False,
            "deviation_summary": "Component semantics may be reused, but density, geometry, surfaces, typography, motion, and composition are derived from the evidence-bound profile rather than the library's starter theme.",
            "intentional_expressive_accents": [
                "Reserve expressive treatments for evidence-backed focal states instead of decorating every card."
            ],
        },
        "prohibited_defaults": [
            "Do not add glass panels, purple gradients, bento blocks, or oversized rounded cards unless the basis supports them.",
            "Do not let the component library's starter theme become the product identity.",
        ],
        "model_prior": {"used_as_evidence": False, "hypothesis_only": True},
    }


def bundle(tmp_path: Path) -> tuple[Path, Path]:
    cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
    basis = visual_basis([str(card["id"]) for card in cards])
    return write_bundle(tmp_path, cards, basis)


def write_profile(tmp_path: Path, profile: dict[str, object]) -> Path:
    path = tmp_path / "ui-style-profile.json"
    path.write_text(json.dumps(profile), encoding="utf-8")
    return path


def test_reference_registry_is_valid_discovery_data_not_evidence() -> None:
    result = run_tool("validate-registry", str(REGISTRY))

    assert result.returncode == 0, result.stdout
    payload = output(result)
    assert payload["valid"] is True
    assert payload["registry_is_evidence"] is False
    assert payload["entry_count"] >= 7


def test_registry_rejects_source_that_can_ground_without_card(tmp_path: Path) -> None:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    registry["entries"][0]["can_ground_without_card"] = True
    path = tmp_path / "registry.json"
    path.write_text(json.dumps(registry), encoding="utf-8")

    result = run_tool("validate-registry", str(path))

    assert result.returncode != 0
    assert "can_ground_without_card" in " ".join(output(result)["errors"])


def test_grounded_ui_style_profile_binds_all_axes_to_visual_basis(
    tmp_path: Path,
) -> None:
    basis_path, cards_dir = bundle(tmp_path)
    profile_path = write_profile(tmp_path, style_profile())

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode == 0, result.stdout
    assert output(result)["valid"] is True


def test_ui_style_profile_rejects_basis_id_mismatch(tmp_path: Path) -> None:
    basis_path, cards_dir = bundle(tmp_path)
    profile = style_profile()
    profile["basis_id"] = "basis-other-project-v1"
    profile_path = write_profile(tmp_path, profile)

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode != 0
    assert "basis_id must match" in " ".join(output(result)["errors"])


def test_ui_style_profile_rejects_unknown_basis_decision(tmp_path: Path) -> None:
    basis_path, cards_dir = bundle(tmp_path)
    profile_path = write_profile(
        tmp_path, style_profile(decision_id="invented-style-rule")
    )

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode != 0
    assert "unknown basis decisions" in " ".join(output(result)["errors"])


def test_greenfield_profile_rejects_unmodified_component_stack_default(
    tmp_path: Path,
) -> None:
    basis_path, cards_dir = bundle(tmp_path)
    profile = style_profile()
    profile["stack_independence"]["unmodified_stack_default"] = True
    profile_path = write_profile(tmp_path, profile)

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode != 0
    assert "unmodified component-stack default" in " ".join(output(result)["errors"])


def test_profile_rejects_unknown_discovery_registry_source(tmp_path: Path) -> None:
    basis_path, cards_dir = bundle(tmp_path)
    profile = style_profile()
    profile["registry_ids"] = ["made-up-library"]
    profile_path = write_profile(tmp_path, profile)

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode != 0
    assert "unknown registry ids" in " ".join(output(result)["errors"])


def test_profile_requires_grounded_visual_basis(tmp_path: Path) -> None:
    cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
    basis = visual_basis([str(card["id"]) for card in cards])
    exploratory = copy.deepcopy(basis)
    exploratory["status"] = "EXPLORATORY"
    basis_path, cards_dir = write_bundle(tmp_path, cards, exploratory)
    profile_path = write_profile(tmp_path, style_profile())

    result = run_tool(
        "validate-profile",
        str(profile_path),
        "--visual-basis",
        str(basis_path),
        "--cards-dir",
        str(cards_dir),
    )

    assert result.returncode != 0
    assert "requires a GROUNDED Visual Basis" in " ".join(output(result)["errors"])
