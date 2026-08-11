#!/usr/bin/env python3
"""Validate Concept Artist -> Art Director handoff contracts.

The CLI reads only the files explicitly supplied by the caller. Evidence and
artifact paths inside JSON are opaque metadata; they are never followed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CONCEPT_SCHEMA = ROOT / "schemas" / "concept-packet.schema.json"
ART_SCHEMA = ROOT / "schemas" / "art-direction-gates.schema.json"
GATE_NAMES = ("concept-packet", "style-frame", "representative-family", "production")


class HandoffError(ValueError):
    """Raised for an unreadable or structurally invalid handoff document."""


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise HandoffError(f"{label} is not valid JSON: {error}") from error


def schema_errors(document: Any, schema_path: Path) -> list[str]:
    schema = load_json(schema_path, "schema")
    try:
        import jsonschema
    except ImportError:
        return bounded_schema_errors(document, schema)

    validator = jsonschema.Draft7Validator(schema)
    errors: list[str] = []
    for error in sorted(
        validator.iter_errors(document),
        key=lambda item: (tuple(str(part) for part in item.path), item.message),
    ):
        location = ".".join(str(part) for part in error.path) or "$"
        errors.append(f"{location}: {error.message}")
    return errors


def bounded_schema_errors(document: Any, schema: dict[str, Any]) -> list[str]:
    """Small JSON Schema subset used when jsonschema is unavailable."""

    errors: list[str] = []

    def check(value: Any, rule: dict[str, Any], path: str) -> None:
        expected = rule.get("type")
        type_ok = {
            "object": isinstance(value, dict),
            "array": isinstance(value, list),
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "integer": isinstance(value, int) and not isinstance(value, bool),
        }
        if expected in type_ok and not type_ok[expected]:
            errors.append(f"{path}: expected {expected}")
            return
        if isinstance(value, dict):
            for key in sorted(rule.get("required", [])):
                if key not in value:
                    errors.append(f"{path}: missing required property '{key}'")
            if rule.get("additionalProperties") is False:
                known = set(rule.get("properties", {}))
                if not rule.get("properties") and "additionalProperties" in rule:
                    known = set()
                for key in sorted(set(value) - known):
                    errors.append(f"{path}: unexpected property '{key}'")
            for key, child in sorted(rule.get("properties", {}).items()):
                if key in value:
                    check(value[key], child, f"{path}.{key}")
            additional = rule.get("additionalProperties")
            if isinstance(additional, dict):
                for key in sorted(value):
                    if key not in rule.get("properties", {}):
                        check(value[key], additional, f"{path}.{key}")
        if isinstance(value, list):
            if len(value) < rule.get("minItems", 0):
                errors.append(f"{path}: must contain at least {rule['minItems']} items")
            item_rule = rule.get("items")
            if isinstance(item_rule, dict):
                for index, item in enumerate(value):
                    check(item, item_rule, f"{path}[{index}]")
        if isinstance(value, str):
            if len(value) < rule.get("minLength", 0):
                errors.append(f"{path}: must not be empty")
            if "enum" in rule and value not in rule["enum"]:
                errors.append(f"{path}: must be one of {rule['enum']}")
            if "pattern" in rule:
                import re

                if re.fullmatch(rule["pattern"], value) is None:
                    errors.append(f"{path}: does not match required pattern")
        if isinstance(value, dict) and len(value) < rule.get("minProperties", 0):
            errors.append(
                f"{path}: must contain at least {rule['minProperties']} properties"
            )

    def resolve(rule: dict[str, Any], root_schema: dict[str, Any]) -> dict[str, Any]:
        reference = rule.get("$ref")
        if not reference or not reference.startswith("#/$defs/"):
            return rule
        return root_schema["$defs"][reference.rsplit("/", 1)[1]]

    def check_with_refs(value: Any, rule: dict[str, Any], path: str) -> None:
        resolved = resolve(rule, schema)
        check(value, resolved, path)
        if resolved is not rule:
            # Resolve one level of nested refs in properties/items.
            if isinstance(value, dict):
                for key, child in resolved.get("properties", {}).items():
                    if key in value and "$ref" in child:
                        check_with_refs(value[key], child, f"{path}.{key}")
                additional = resolved.get("additionalProperties")
                if isinstance(additional, dict) and "$ref" in additional:
                    for key in value:
                        check_with_refs(value[key], additional, f"{path}.{key}")
            if isinstance(value, list) and isinstance(resolved.get("items"), dict):
                item = resolved["items"]
                if "$ref" in item:
                    for index, entry in enumerate(value):
                        check_with_refs(entry, item, f"{path}[{index}]")

    check_with_refs(document, schema, "$")
    return sorted(set(errors))


def read_document(path_value: str, label: str) -> dict[str, Any]:
    value = load_json(Path(path_value), label)
    if not isinstance(value, dict):
        raise HandoffError(f"{label} must be a JSON object")
    return value


def validate_concept(document: dict[str, Any]) -> list[str]:
    errors = schema_errors(document, CONCEPT_SCHEMA)
    directions = document.get("directions")
    if isinstance(directions, list):
        ids = [item.get("id") for item in directions if isinstance(item, dict)]
        duplicate_ids = sorted({item_id for item_id in ids if ids.count(item_id) > 1})
        if duplicate_ids:
            errors.append(
                "directions.id values must be unique: "
                + ", ".join(map(str, duplicate_ids))
            )
        selected = document.get("selected_direction_id")
        if selected not in ids:
            errors.append(
                "selected_direction_id must reference an existing direction id"
            )
    return sorted(set(errors))


def validate_art(document: dict[str, Any]) -> list[str]:
    errors = schema_errors(document, ART_SCHEMA)
    gates = document.get("gates")
    if isinstance(gates, dict):
        for name in GATE_NAMES:
            gate = gates.get(name)
            if not isinstance(gate, dict):
                continue
            if gate.get("required") and not gate.get("applicable"):
                errors.append(f"gates.{name}: required gates must be applicable")
    return sorted(set(errors))


def generation_blockers(document: dict[str, Any]) -> list[str]:
    gates = document.get("gates", {})
    blockers: list[str] = []

    style_dna = document.get("style_dna")
    if not isinstance(style_dna, dict):
        blockers.append(
            "style_dna is missing or malformed; style_dna.status must be exactly APPROVED"
        )
    else:
        status = style_dna.get("status")
        if status != "APPROVED":
            status_label = (
                "missing"
                if "status" not in style_dna
                else status
                if isinstance(status, str)
                else type(status).__name__
            )
            blockers.append(
                f"style_dna.status is {status_label}; generation requires exactly APPROVED"
            )

    if not isinstance(gates, dict):
        blockers.append("gates are not available")
    else:
        for name in GATE_NAMES:
            gate = gates.get(name)
            if not isinstance(gate, dict):
                blockers.append(f"gates.{name} is missing")
                continue
            if (
                gate.get("applicable")
                and gate.get("required")
                and gate.get("status") != "PASS"
            ):
                blockers.append(
                    f"gates.{name} is {gate.get('status', 'invalid')}; required applicable gates must be PASS"
                )
    return blockers


def cross_errors(concept: dict[str, Any], art: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    project = concept.get("project", {})
    art_project = art.get("project", {})
    packet = concept.get("handoff_metadata", {})
    art_packet = art.get("concept_packet", {})
    if (
        isinstance(project, dict)
        and isinstance(art_project, dict)
        and project.get("id") != art_project.get("id")
    ):
        errors.append(
            "project.id mismatch between concept packet and art-direction gates"
        )
    if isinstance(project, dict) and art_packet.get("project_id") != project.get("id"):
        errors.append("concept_packet.project_id does not match concept project.id")
    if isinstance(packet, dict) and art_packet.get("packet_id") != packet.get(
        "packet_id"
    ):
        errors.append(
            "concept_packet.packet_id does not match handoff_metadata.packet_id"
        )
    if art_packet.get("version") != concept.get("version"):
        errors.append("concept_packet.version does not match concept packet version")
    if art_packet.get("selected_direction_id") != concept.get("selected_direction_id"):
        errors.append(
            "concept_packet.selected_direction_id does not match selected_direction_id"
        )
    return sorted(set(errors))


def result(
    command: str, errors: list[str], blockers: list[str] | None = None
) -> dict[str, Any]:
    return {
        "blocking_reasons": sorted(set(blockers or [])),
        "command": command,
        "errors": sorted(set(errors)),
        "generation_allowed": None,
        "valid": not errors,
    }


def run(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    try:
        if args.command == "validate-concept":
            document = read_document(args.concept, "concept packet")
            errors = validate_concept(document)
            return result(args.command, errors), int(bool(errors))

        if args.command == "validate-art":
            document = read_document(args.art, "art-direction gates")
            errors = validate_art(document)
            if args.concept:
                concept = read_document(args.concept, "concept packet")
                concept_errors = validate_concept(concept)
                errors.extend(f"concept: {error}" for error in concept_errors)
                if not concept_errors and not errors:
                    errors.extend(cross_errors(concept, document))
            blockers = generation_blockers(document)
            output = result(args.command, errors, blockers)
            output["generation_allowed"] = not errors and not blockers
            return output, int(bool(errors or blockers))

        concept = read_document(args.concept, "concept packet")
        art = read_document(args.art, "art-direction gates")
        concept_errors = validate_concept(concept)
        art_errors = validate_art(art)
        errors = concept_errors + art_errors
        if not concept_errors and not art_errors:
            errors.extend(cross_errors(concept, art))
        blockers = generation_blockers(art)
        output = result(args.command, errors, blockers)
        output["generation_allowed"] = not errors and not blockers
        return output, int(bool(errors or blockers))
    except HandoffError as error:
        return result(args.command, [str(error)]), 1


def parser() -> argparse.ArgumentParser:
    command_parser = argparse.ArgumentParser(description=__doc__)
    commands = command_parser.add_subparsers(dest="command", required=True)

    concept = commands.add_parser("validate-concept")
    concept.add_argument("concept", help="explicit concept packet JSON path")

    art = commands.add_parser("validate-art")
    art.add_argument("art", help="explicit art-direction gates JSON path")
    art.add_argument(
        "--concept", dest="concept", help="optional concept packet JSON path"
    )

    handoff = commands.add_parser("validate-handoff")
    handoff.add_argument("concept", help="explicit concept packet JSON path")
    handoff.add_argument("art", help="explicit art-direction gates JSON path")
    return command_parser


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    payload, exit_code = run(args)
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
