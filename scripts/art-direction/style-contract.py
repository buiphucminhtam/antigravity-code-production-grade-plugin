#!/usr/bin/env python3
"""Validate and compile Forgewright game-art-contract/v2 files."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from visual_evidence import load_and_validate_bundle


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = (
    ROOT / "skills" / "art-director" / "contracts" / "game-art-contract.v2.schema.json"
)
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
ASPECT_RE = re.compile(r"^[1-9][0-9]*:[1-9][0-9]*$")
PLACEHOLDER_RE = re.compile(r"\[[^\[\]\r\n]+\]")


class ContractError(ValueError):
    """Raised when a game art contract cannot be used safely."""


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContractError(f"{label} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be a JSON object")
    return value


def load_schema() -> dict[str, Any]:
    return load_json(SCHEMA_PATH, "contract schema")


def get_path(document: dict[str, Any], dotted: str) -> tuple[bool, Any]:
    value: Any = document
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return False, None
        value = value[part]
    return True, value


def require_object(value: Any, path: str, errors: list[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return {}
    return value


def validate_hex_map(value: Any, path: str, errors: list[str]) -> None:
    mapping = require_object(value, path, errors)
    if not mapping:
        errors.append(f"{path} must contain at least one color role")
        return
    for role, colors in mapping.items():
        role_path = f"{path}.{role}"
        if not isinstance(colors, list) or not colors:
            errors.append(f"{role_path} must be a non-empty list")
            continue
        for index, color in enumerate(colors):
            if not isinstance(color, str) or HEX_RE.fullmatch(color) is None:
                errors.append(f"{role_path}[{index}] must match #RRGGBB")


def validate_contract(
    document: dict[str, Any], schema: dict[str, Any], stage: str
) -> list[str]:
    errors: list[str] = []
    if document.get("schema_version") != schema.get("$id"):
        errors.append(f"schema_version must be {schema.get('$id')}")

    allowed_top = set(schema.get("allowed_top_level", []))
    unknown_top = sorted(set(document) - allowed_top)
    for key in unknown_top:
        errors.append(f"unknown top-level field: {key}")

    for key in schema.get("required_top_level", []):
        if key not in document:
            errors.append(f"missing required field: {key}")
    for dotted in schema.get("required_paths", []):
        present, _ = get_path(document, dotted)
        if not present:
            errors.append(f"missing required field: {dotted}")

    for dotted, allowed in schema.get("enums", {}).items():
        present, value = get_path(document, dotted)
        if present and value not in allowed:
            errors.append(f"{dotted} must be one of: {', '.join(allowed)}")

    for dotted in schema.get("list_string_paths", []):
        present, value = get_path(document, dotted)
        if present and (
            not isinstance(value, list)
            or not all(isinstance(item, str) and item.strip() for item in value)
        ):
            errors.append(f"{dotted} must be a list of non-empty strings")

    for dotted in schema.get("hex_map_paths", []):
        present, value = get_path(document, dotted)
        if present and not (stage == "draft" and value == {}):
            if (
                stage == "draft"
                and isinstance(value, dict)
                and all(
                    isinstance(colors, list) and not colors for colors in value.values()
                )
            ):
                continue
            validate_hex_map(value, dotted, errors)

    present, aspect = get_path(document, "style.canvas.aspect_ratio")
    if present and not (stage == "draft" and aspect == "unresolved"):
        if not isinstance(aspect, str) or ASPECT_RE.fullmatch(aspect) is None:
            errors.append("style.canvas.aspect_ratio must use W:H")

    present, outline_enabled = get_path(document, "style.outline.enabled")
    if present and not (stage == "draft" and outline_enabled is None):
        if not isinstance(outline_enabled, bool):
            errors.append("style.outline.enabled must be a boolean")

    present, pixels_per_unit = get_path(document, "engine.pixels_per_unit")
    if present and not (stage == "draft" and pixels_per_unit == 0):
        if (
            isinstance(pixels_per_unit, bool)
            or not isinstance(pixels_per_unit, int)
            or pixels_per_unit <= 0
        ):
            errors.append("engine.pixels_per_unit must be a positive integer")

    for dotted in ("engine.texture_compression", "engine.atlas_group"):
        present, value = get_path(document, dotted)
        if present and (not isinstance(value, str) or not value.strip()):
            errors.append(f"{dotted} must be a non-empty string")

    present, rendering = get_path(document, "style.rendering")
    pixel_present, _ = get_path(document, "style.pixel_register")
    if present and rendering == "pixel_art" and not pixel_present:
        errors.append("style.pixel_register is required for pixel_art")
    if present and rendering != "pixel_art" and pixel_present:
        errors.append("style.pixel_register is only valid for pixel_art")

    present, confidence_value = get_path(document, "style.confidence")
    confidence: dict[str, Any] = {}
    if present:
        confidence = require_object(confidence_value, "style.confidence", errors)
        for dimension, score in confidence.items():
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                errors.append(f"style.confidence.{dimension} must be a number")
            elif not 0 <= score <= 1:
                errors.append(f"style.confidence.{dimension} must be between 0 and 1")

    evidence_present, evidence_value = get_path(document, "evidence_basis")
    evidence_basis = (
        require_object(evidence_value, "evidence_basis", errors)
        if evidence_present
        else {}
    )
    if (
        evidence_basis
        and evidence_basis.get("model_prior_used_as_evidence") is not False
    ):
        errors.append("evidence_basis.model_prior_used_as_evidence must be false")

    if stage == "generation":
        requirements = schema.get("generation_requirements", {})
        present, status = get_path(document, "approval.status")
        expected = requirements.get("approval_status", "approved")
        if not present or status != expected:
            errors.append(f"approval.status must be {expected} for generation")
        for dotted in requirements.get("approval_required_paths", []):
            present, value = get_path(document, dotted)
            if not present or not isinstance(value, str) or not value.strip():
                errors.append(f"{dotted} must be recorded for generation")
        present, references = get_path(document, "references.style")
        minimum = requirements.get("minimum_style_references", 1)
        if not present or not isinstance(references, list) or len(references) < minimum:
            errors.append(
                f"references.style must contain at least {minimum} STYLE reference"
            )
        unresolved_paths = (
            "project.platform",
            "style.rendering",
            "style.shape.language",
            "style.shape.corner_radius",
            "style.materials.button",
            "style.materials.container",
            "style.materials.icon",
            "style.lighting.direction",
            "style.lighting.contrast",
            "style.lighting.highlight",
            "style.lighting.shadow",
            "style.outline.enabled",
            "style.outline.thickness",
            "style.outline.color",
            "style.camera",
            "style.canvas.orientation",
            "style.canvas.aspect_ratio",
            "engine.name",
            "engine.pixels_per_unit",
            "engine.texture_compression",
            "engine.atlas_group",
        )
        for dotted in unresolved_paths:
            present, value = get_path(document, dotted)
            if not present or value in (None, "unresolved", 0):
                errors.append(f"{dotted} must be resolved before generation")
        for dotted in ("project.genre", "style.mood", "evidence_basis.card_ids"):
            present, value = get_path(document, dotted)
            if not present or not isinstance(value, list) or not value:
                errors.append(
                    f"{dotted} must contain grounded values before generation"
                )
    return errors


def validate_evidence_binding(
    document: dict[str, Any], visual_basis: Path | None, cards_dir: Path | None
) -> tuple[dict[str, Any], list[str]]:
    if visual_basis is None or cards_dir is None:
        return {}, [
            "generation requires --visual-basis and --cards-dir; model priors or unbound references are not evidence"
        ]
    basis, cards, errors = load_and_validate_bundle(visual_basis, cards_dir)
    if errors:
        return basis, [f"visual evidence: {error}" for error in errors]
    if basis.get("status") != "GROUNDED":
        errors.append("visual evidence: basis status must be GROUNDED for generation")

    binding = document.get("evidence_basis")
    if not isinstance(binding, dict):
        errors.append("evidence_basis must bind the validated visual basis")
        return basis, errors
    if binding.get("basis_id") != basis.get("id"):
        errors.append(
            "evidence_basis.basis_id does not match validated visual basis id"
        )
    contract_ids = binding.get("card_ids")
    basis_ids = basis.get("card_ids")
    if not isinstance(contract_ids, list) or sorted(contract_ids) != sorted(
        basis_ids or []
    ):
        errors.append(
            "evidence_basis.card_ids do not match validated visual basis cards"
        )
    if binding.get("model_prior_used_as_evidence") is not False:
        errors.append("evidence_basis.model_prior_used_as_evidence must be false")
    if not cards:
        errors.append("validated visual evidence library is empty")
    return basis, sorted(set(errors))


def validate_or_raise(
    document: dict[str, Any],
    stage: str,
    *,
    visual_basis: Path | None = None,
    cards_dir: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    schema = load_schema()
    errors = validate_contract(document, schema, stage)
    basis: dict[str, Any] = {}
    if stage == "generation":
        basis, evidence_errors = validate_evidence_binding(
            document, visual_basis, cards_dir
        )
        errors.extend(evidence_errors)
    if errors:
        raise ContractError("\n".join(f"- {error}" for error in sorted(set(errors))))
    return schema, basis


def csv(values: list[str]) -> str:
    return ", ".join(values)


def enum_phrase(value: str) -> str:
    return value.replace("_", " ")


def compile_prompt(
    document: dict[str, Any],
    asset_type: str,
    name: str,
    *,
    visual_basis: Path,
    cards_dir: Path,
) -> str:
    schema, basis = validate_or_raise(
        document, "generation", visual_basis=visual_basis, cards_dir=cards_dir
    )
    allowed = schema.get("compiler_asset_types", [])
    if asset_type not in allowed:
        raise ContractError(
            f"asset type must be one of: {', '.join(str(item) for item in allowed)}"
        )
    if not name.strip():
        raise ContractError("asset name must be non-empty")

    project = document["project"]
    style = document["style"]
    shape = style["shape"]
    palette = style["palette"]
    color_map = style["color_map"]
    materials = style["materials"]
    lighting = style["lighting"]
    outline = style["outline"]
    canvas = style["canvas"]
    engine = document["engine"]
    references = document["references"]

    surface_colors = "; ".join(
        f"{role.replace('_', ' ')} = {csv(colors)}"
        for role, colors in sorted(color_map.items())
    )
    material_text = "; ".join(
        f"{role} = {enum_phrase(value)}" for role, value in sorted(materials.items())
    )
    shape_parts = [
        f"{enum_phrase(shape['language'])} shape language",
        f"{enum_phrase(shape['corner_radius'])} corner radius",
    ]
    if shape.get("ui_panel_geometry"):
        shape_parts.append(f"{enum_phrase(shape['ui_panel_geometry'])} panel geometry")
    if shape.get("slant"):
        shape_parts.append(f"{enum_phrase(shape['slant'])} slant")

    pixel_text = ""
    if style["rendering"] == "pixel_art":
        pixel_text = f", {enum_phrase(style['pixel_register'])} pixel register"

    type_guidance = {
        "character": "Keep identity, silhouette, outfit colors, and proportions stable across future poses.",
        "background": "Keep the gameplay focal area readable and separate depth into reusable layers.",
        "environment": "Keep the gameplay focal area readable and separate depth into reusable layers.",
        "icon": "Use a centered readable silhouette with transparent-background export readiness.",
        "object": "Make function and interaction affordance readable from the silhouette.",
        "prop": "Make function and interaction affordance readable from the silhouette.",
        "sprite": "Use a consistent frame canvas, pivot, scale, and transparent background.",
        "tile": "Use seamless edges and the declared pixel grid without anti-aliasing drift.",
        "ui-kit": "Render the complete component family on one sheet to reduce cross-asset drift.",
        "screen": "Respect safe areas, hierarchy, and one entry point per feature.",
        "button": "Keep states visually related and preserve label readability.",
        "panel": "Preserve the declared geometry on every edge and trim surface.",
    }[asset_type]

    lines = [
        (
            f"Generate the {asset_type} asset '{name}' for {project['name']}, "
            f"a {csv(project['genre'])} {project['platform']} game."
        ),
        (
            f"Evidence basis: {basis['id']} ({len(basis['card_ids'])} validated cards); "
            "model training prior is hypothesis-only and is not evidence."
        ),
        (
            "STYLE reference roles: STYLE references define appearance only; "
            "TARGET references define content or layout only; CHARACTER references "
            "define identity only. Do not mix these roles."
        ),
        (
            f"Reference inputs: STYLE = {csv(references['style'])}; "
            f"TARGET = {csv(references['target']) or 'none'}; "
            f"CHARACTER = {csv(references['character']) or 'none'}."
        ),
        (
            f"Rendering: {enum_phrase(style['rendering'])}{pixel_text}; "
            f"mood: {csv([enum_phrase(item) for item in style['mood']])}."
        ),
        f"Shape lock: {csv(shape_parts)}. Echo this geometry on every relevant surface.",
        (
            f"Palette lock: primary {csv(palette['primary'])}; secondary "
            f"{csv(palette['secondary'])}; accent {csv(palette['accent'])}; "
            f"neutral {csv(palette['neutral'])}."
        ),
        f"Per-surface color lock: {surface_colors}.",
        f"Materials: {material_text}.",
        (
            f"Lighting: {enum_phrase(lighting['direction'])} direction, "
            f"{enum_phrase(lighting['contrast'])} contrast, "
            f"{enum_phrase(lighting['highlight'])} highlight, "
            f"{enum_phrase(lighting['shadow'])} shadow."
        ),
        (
            f"Outline: {'enabled' if outline['enabled'] else 'disabled'}, "
            f"{enum_phrase(outline['thickness'])}, "
            f"{enum_phrase(outline['color'])}."
        ),
        (
            f"Camera and canvas: {enum_phrase(style['camera'])}; "
            f"{canvas['orientation']} {canvas['aspect_ratio']}."
        ),
        type_guidance,
        (
            f"Engine handoff: {engine['name']}, {engine['pixels_per_unit']} pixels "
            f"per unit, {engine['texture_compression']} compression, atlas group "
            f"{engine['atlas_group']}."
        ),
        f"Avoid: {csv(style['negative'])}.",
        f"Contract: {document['schema_version']} (approved).",
    ]
    prompt = "\n".join(lines)
    unresolved = PLACEHOLDER_RE.findall(prompt)
    if unresolved:
        raise ContractError(
            "compiled prompt contains unresolved placeholders: "
            + ", ".join(sorted(set(unresolved)))
        )
    return prompt


def draft_contract(project_name: str, project_type: str) -> dict[str, Any]:
    scope_by_type = {
        "app": "2d",
        "game-2d": "2d",
        "game-3d": "3d",
        "mixed": "mixed",
    }
    return {
        "schema_version": "game-art-contract/v2",
        "project": {
            "name": project_name,
            "genre": [],
            "platform": "unresolved",
            "asset_scope": scope_by_type[project_type],
        },
        "approval": {"status": "draft"},
        "evidence_basis": {
            "basis_id": "unresolved",
            "card_ids": [],
            "model_prior_used_as_evidence": False,
        },
        "references": {"style": [], "target": [], "character": []},
        "style": {
            "rendering": "unresolved",
            "mood": [],
            "shape": {"language": "unresolved", "corner_radius": "unresolved"},
            "palette": {"primary": [], "secondary": [], "accent": [], "neutral": []},
            "color_map": {},
            "materials": {
                "button": "unresolved",
                "container": "unresolved",
                "icon": "unresolved",
            },
            "lighting": {
                "direction": "unresolved",
                "contrast": "unresolved",
                "highlight": "unresolved",
                "shadow": "unresolved",
            },
            "outline": {
                "enabled": None,
                "thickness": "unresolved",
                "color": "unresolved",
            },
            "camera": "unresolved",
            "canvas": {"orientation": "unresolved", "aspect_ratio": "unresolved"},
            "negative": [],
            "confidence": {},
        },
        "engine": {
            "name": "unresolved",
            "pixels_per_unit": 0,
            "texture_compression": "unresolved",
            "atlas_group": "unresolved",
        },
    }


def command_validate(args: argparse.Namespace) -> int:
    document = load_json(args.contract, "contract")
    validate_or_raise(
        document,
        args.stage,
        visual_basis=args.visual_basis,
        cards_dir=args.cards_dir,
    )
    print(f"VALID {document['schema_version']} stage={args.stage}")
    return 0


def command_compile(args: argparse.Namespace) -> int:
    document = load_json(args.contract, "contract")
    print(
        compile_prompt(
            document,
            args.asset_type,
            args.name,
            visual_basis=args.visual_basis,
            cards_dir=args.cards_dir,
        )
    )
    return 0


def command_init(args: argparse.Namespace) -> int:
    if args.output.exists() and not args.force:
        raise ContractError(f"refusing to overwrite existing contract: {args.output}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    value = draft_contract(args.project_name, args.project_type)
    args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    print(f"Created draft {value['schema_version']}: {args.output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("contract", type=Path)
    validate.add_argument("--stage", choices=("draft", "generation"), default="draft")
    validate.add_argument("--visual-basis", type=Path)
    validate.add_argument("--cards-dir", type=Path)
    validate.set_defaults(handler=command_validate)

    compile_parser = subparsers.add_parser("compile")
    compile_parser.add_argument("contract", type=Path)
    compile_parser.add_argument("--asset-type", required=True)
    compile_parser.add_argument("--name", required=True)
    compile_parser.add_argument("--visual-basis", type=Path, required=True)
    compile_parser.add_argument("--cards-dir", type=Path, required=True)
    compile_parser.set_defaults(handler=command_compile)

    init = subparsers.add_parser("init")
    init.add_argument("output", type=Path)
    init.add_argument(
        "--project-type",
        choices=("app", "game-2d", "game-3d", "mixed"),
        default="game-2d",
    )
    init.add_argument("--project-name", default="Untitled Game")
    init.add_argument("--force", action="store_true")
    init.set_defaults(handler=command_init)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except ContractError as error:
        print(f"INVALID game art contract:\n{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
