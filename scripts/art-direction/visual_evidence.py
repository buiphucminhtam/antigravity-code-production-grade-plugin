#!/usr/bin/env python3
"""Validate evidence-backed visual references and synthesized visual bases.

Model training priors may propose research hypotheses, but they are never
accepted as visual evidence. A GROUNDED basis must bind observable project,
user-approved, platform, design-system, or successful-product evidence.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
CARD_SCHEMA = ROOT / "schemas" / "visual-evidence-card.schema.json"
BASIS_SCHEMA = ROOT / "schemas" / "visual-basis.schema.json"
EXTERNAL_SOURCE_TYPES = {
    "first_party_product",
    "first_party_metrics",
    "official_design_system",
    "official_platform_guideline",
}
PRODUCTION_PROOF_KINDS = {"successful_product", "production_design_system"}
STRONG_AUTHORITY_KINDS = {"user_approved_reference", "project_product"}


class VisualEvidenceError(ValueError):
    """Raised when a visual evidence artifact is unsafe or not grounded."""


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VisualEvidenceError(f"{label} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise VisualEvidenceError(f"{label} must be a JSON object")
    return value


def _bounded_schema_errors(
    document: dict[str, Any], schema: dict[str, Any]
) -> list[str]:
    """Validate the bounded Draft-07 subset used by visual evidence schemas."""

    errors: list[str] = []

    def resolve(rule: dict[str, Any]) -> dict[str, Any]:
        reference = rule.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/$defs/"):
            return schema["$defs"][reference.rsplit("/", 1)[1]]
        return rule

    def check(value: Any, raw_rule: dict[str, Any], path: str) -> None:
        rule = resolve(raw_rule)
        expected = rule.get("type")
        type_checks = {
            "object": isinstance(value, dict),
            "array": isinstance(value, list),
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "integer": isinstance(value, int) and not isinstance(value, bool),
            "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        }
        if expected in type_checks and not type_checks[expected]:
            errors.append(f"{path}: expected {expected}")
            return
        if "const" in rule and value != rule["const"]:
            errors.append(f"{path}: must equal {rule['const']!r}")
            return
        if "enum" in rule and value not in rule["enum"]:
            errors.append(f"{path}: must be one of {rule['enum']}")

        if isinstance(value, dict):
            for key in rule.get("required", []):
                if key not in value:
                    errors.append(f"{path}: missing required property '{key}'")
            properties = rule.get("properties", {})
            if rule.get("additionalProperties") is False:
                for key in sorted(set(value) - set(properties)):
                    errors.append(f"{path}: unexpected property '{key}'")
            for key, child in properties.items():
                if key in value:
                    check(value[key], child, f"{path}.{key}")
            additional = rule.get("additionalProperties")
            if isinstance(additional, dict):
                for key, child_value in value.items():
                    if key not in properties:
                        check(child_value, additional, f"{path}.{key}")
            if len(value) < rule.get("minProperties", 0):
                errors.append(
                    f"{path}: must contain at least {rule['minProperties']} properties"
                )

        if isinstance(value, list):
            if len(value) < rule.get("minItems", 0):
                errors.append(f"{path}: must contain at least {rule['minItems']} items")
            if len(value) > rule.get("maxItems", len(value)):
                errors.append(f"{path}: must contain at most {rule['maxItems']} items")
            if rule.get("uniqueItems"):
                encoded = [json.dumps(item, sort_keys=True) for item in value]
                if len(encoded) != len(set(encoded)):
                    errors.append(f"{path}: items must be unique")
            item_rule = rule.get("items")
            if isinstance(item_rule, dict):
                for index, item in enumerate(value):
                    check(item, item_rule, f"{path}[{index}]")

        if isinstance(value, str):
            if len(value) < rule.get("minLength", 0):
                errors.append(f"{path}: must not be empty")
            if len(value) > rule.get("maxLength", len(value)):
                errors.append(f"{path}: exceeds maximum length {rule['maxLength']}")
            pattern = rule.get("pattern")
            if isinstance(pattern, str):
                import re

                if re.fullmatch(pattern, value) is None:
                    errors.append(f"{path}: does not match required pattern")

    check(document, schema, "$")
    return sorted(set(errors))


def _schema_errors(document: dict[str, Any], schema_path: Path) -> list[str]:
    schema = _load_json(schema_path, "schema")
    try:
        import jsonschema
    except ImportError:
        return _bounded_schema_errors(document, schema)
    validator = jsonschema.Draft7Validator(schema)
    errors: list[str] = []
    for error in sorted(
        validator.iter_errors(document),
        key=lambda item: (tuple(str(part) for part in item.path), item.message),
    ):
        location = ".".join(str(part) for part in error.path) or "$"
        errors.append(f"{location}: {error.message}")
    return errors


def _is_https(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def validate_card(document: dict[str, Any]) -> list[str]:
    errors = _schema_errors(document, CARD_SCHEMA)
    if errors:
        return sorted(set(errors))

    subject = document["subject"]
    source = document["source"]
    success = document["success_evidence"]
    kind = subject["kind"]
    source_type = source["source_type"]
    tier = source["authority_tier"]
    signals = success["signals"]

    if source_type in EXTERNAL_SOURCE_TYPES and not _is_https(source["location"]):
        errors.append(
            "source.location must be an HTTPS first-party/official location for external authority"
        )

    if kind == "successful_product":
        if success["status"] not in {"verified", "production_adoption"}:
            errors.append(
                "successful_product requires verified or production_adoption success evidence"
            )
        if not signals:
            errors.append("successful_product requires at least one success signal")
        if tier not in {"A", "B"}:
            errors.append("successful_product must use authority tier A or B")
    elif kind == "production_design_system":
        if source_type != "official_design_system":
            errors.append(
                "production_design_system must use official_design_system as its source type"
            )
        if success["status"] not in {"verified", "production_adoption"}:
            errors.append(
                "production_design_system requires verified or production_adoption evidence"
            )
        if not signals:
            errors.append(
                "production_design_system requires at least one adoption signal"
            )
        if tier != "A":
            errors.append("production_design_system must use authority tier A")
    elif kind == "platform_guideline":
        if source_type != "official_platform_guideline":
            errors.append(
                "platform_guideline must use official_platform_guideline as its source type"
            )
        if tier != "A":
            errors.append("platform_guideline must use authority tier A")
    elif kind == "user_approved_reference":
        if success["status"] != "user_authority":
            errors.append("user_approved_reference requires user_authority status")
    elif kind == "project_product":
        if success["status"] != "project_observed":
            errors.append("project_product requires project_observed status")
    elif kind == "inspiration_only":
        if tier != "C":
            errors.append("inspiration_only must use authority tier C")
        if success["status"] != "not_applicable":
            errors.append("inspiration_only must use not_applicable success status")

    for index, signal in enumerate(signals):
        if kind in PRODUCTION_PROOF_KINDS and not _is_https(signal["source_location"]):
            errors.append(
                f"success_evidence.signals[{index}].source_location must be HTTPS for production-proof evidence"
            )

    return sorted(set(errors))


def _load_library(cards_dir: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    if not cards_dir.is_dir():
        return {}, [f"cards directory not found: {cards_dir}"]
    cards: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for path in sorted(cards_dir.glob("*.json")):
        try:
            card = _load_json(path, f"visual evidence card {path.name}")
        except VisualEvidenceError as error:
            errors.append(str(error))
            continue
        card_errors = validate_card(card)
        errors.extend(f"{path.name}: {item}" for item in card_errors)
        card_id = card.get("id")
        if isinstance(card_id, str):
            if card_id in cards:
                errors.append(f"duplicate visual evidence card id: {card_id}")
            else:
                cards[card_id] = card
    if not cards:
        errors.append("visual evidence library contains no valid JSON cards")
    return cards, sorted(set(errors))


def validate_basis(
    document: dict[str, Any], cards: dict[str, dict[str, Any]]
) -> list[str]:
    errors = _schema_errors(document, BASIS_SCHEMA)
    if errors:
        return sorted(set(errors))

    basis_card_ids = document["card_ids"]
    missing = sorted(set(basis_card_ids) - set(cards))
    if missing:
        errors.append("visual basis references missing card ids: " + ", ".join(missing))

    selected_cards = [cards[item] for item in basis_card_ids if item in cards]
    grounding_cards = [
        card for card in selected_cards if card["subject"]["kind"] != "inspiration_only"
    ]
    production_cards = [
        card
        for card in grounding_cards
        if card["subject"]["kind"] in PRODUCTION_PROOF_KINDS
    ]
    strong_authority = [
        card
        for card in grounding_cards
        if card["subject"]["kind"] in STRONG_AUTHORITY_KINDS
    ]

    if document["status"] == "GROUNDED":
        if not grounding_cards:
            errors.append("GROUNDED visual basis requires non-inspiration evidence")
        if document["research_gate"]["status"] == "BLOCKED":
            errors.append("GROUNDED visual basis cannot use a BLOCKED Research Gate")

    origin = document["basis_origin"]
    greenfield = document["target_context"]["greenfield"]
    if origin == "external_research":
        if document["research_gate"]["status"] != "PASSED":
            errors.append(
                "external_research visual basis requires Research Gate PASSED"
            )
        minimum = 3 if greenfield else 2
        if len(grounding_cards) < minimum:
            errors.append(
                f"external_research visual basis requires at least {minimum} grounded evidence cards"
            )
        if not production_cards:
            errors.append(
                "external_research visual basis requires successful_product or production_design_system evidence"
            )
    elif origin == "project":
        if not any(
            card["subject"]["kind"] == "project_product" for card in grounding_cards
        ):
            errors.append("project visual basis requires project_product evidence")
    elif origin == "user_approved":
        if not any(
            card["subject"]["kind"] == "user_approved_reference"
            for card in grounding_cards
        ):
            errors.append(
                "user_approved visual basis requires user_approved_reference evidence"
            )
    elif origin == "mixed" and greenfield and not strong_authority:
        if document["research_gate"]["status"] != "PASSED" or len(grounding_cards) < 3:
            errors.append(
                "greenfield mixed basis without project/user authority requires PASSED research and at least 3 grounded evidence cards"
            )
        if not production_cards:
            errors.append(
                "greenfield mixed basis without project/user authority requires production-proof evidence"
            )

    basis_set = set(basis_card_ids)
    for index, decision in enumerate(document["decisions"]):
        decision_ids = decision["card_ids"]
        outside = sorted(set(decision_ids) - basis_set)
        if outside:
            errors.append(
                f"decisions[{index}] references cards outside basis: {', '.join(outside)}"
            )
        decision_cards = [cards[item] for item in decision_ids if item in cards]
        if any(
            card["subject"]["kind"] == "inspiration_only" for card in decision_cards
        ):
            errors.append(
                f"decisions[{index}] cannot use inspiration_only cards as grounding evidence"
            )
        if origin == "external_research" and len(decision_cards) < 2:
            errors.append(
                f"decisions[{index}] requires at least 2 independent evidence cards for external_research synthesis"
            )
        if (
            origin == "mixed"
            and not any(
                card["subject"]["kind"] in STRONG_AUTHORITY_KINDS
                for card in decision_cards
            )
            and len(decision_cards) < 2
        ):
            errors.append(
                f"decisions[{index}] without project/user authority requires at least 2 evidence cards"
            )

    return sorted(set(errors))


def load_and_validate_bundle(
    basis_path: Path, cards_dir: Path
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[str]]:
    try:
        basis = _load_json(basis_path, "visual basis")
    except VisualEvidenceError as error:
        return {}, {}, [str(error)]
    cards, library_errors = _load_library(cards_dir)
    errors = list(library_errors)
    errors.extend(validate_basis(basis, cards))
    return basis, cards, sorted(set(errors))


def _payload(
    command: str,
    errors: list[str],
    *,
    basis: dict[str, Any] | None = None,
    cards: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    basis = basis or {}
    cards = cards or {}
    valid = not errors
    return {
        "basis_id": basis.get("id"),
        "card_count": len(cards),
        "command": command,
        "errors": sorted(set(errors)),
        "generation_ready": bool(valid and basis.get("status") == "GROUNDED"),
        "grounded": basis.get("status") == "GROUNDED" if basis else None,
        "valid": valid,
    }


def run(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    if args.command == "validate-card":
        try:
            card = _load_json(args.card, "visual evidence card")
            errors = validate_card(card)
        except VisualEvidenceError as error:
            errors = [str(error)]
        payload = {
            "command": args.command,
            "errors": errors,
            "valid": not errors,
        }
        return payload, int(bool(errors))

    if args.command == "validate-library":
        cards, errors = _load_library(args.cards_dir)
        payload = {
            "card_count": len(cards),
            "card_ids": sorted(cards),
            "command": args.command,
            "errors": errors,
            "valid": not errors,
        }
        return payload, int(bool(errors))

    basis, cards, errors = load_and_validate_bundle(args.basis, args.cards_dir)
    payload = _payload(args.command, errors, basis=basis, cards=cards)
    return payload, int(bool(errors) or payload["generation_ready"] is False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    card = commands.add_parser("validate-card")
    card.add_argument("card", type=Path)

    library = commands.add_parser("validate-library")
    library.add_argument("cards_dir", type=Path)

    basis = commands.add_parser("validate-basis")
    basis.add_argument("basis", type=Path)
    basis.add_argument("--cards-dir", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload, exit_code = run(args)
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
