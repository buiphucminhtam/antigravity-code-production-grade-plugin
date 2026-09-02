#!/usr/bin/env python3
"""Validate UI reference discovery data and evidence-bound UI style profiles.

The registry expands the search space only. It can never ground a production
choice by itself. A GROUNDED UI style profile must bind an already-validated
Visual Basis and derive every style-signature axis from basis decisions.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from visual_evidence import _schema_errors, load_and_validate_bundle


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_SCHEMA = ROOT / "schemas" / "ui-reference-registry.schema.json"
PROFILE_SCHEMA = ROOT / "schemas" / "ui-style-profile.schema.json"
DEFAULT_REGISTRY = ROOT / "skills" / "ui-designer" / "data" / "reference-registry.json"


class UiStyleProfileError(ValueError):
    """Raised when UI style evidence cannot be used safely."""


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise UiStyleProfileError(f"{label} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise UiStyleProfileError(f"{label} must be a JSON object")
    return value


def is_https(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def validate_registry(document: dict[str, Any]) -> list[str]:
    errors = _schema_errors(document, REGISTRY_SCHEMA)
    if errors:
        return sorted(set(errors))

    seen: set[str] = set()
    for index, entry in enumerate(document["entries"]):
        entry_id = entry["id"]
        if entry_id in seen:
            errors.append(f"entries[{index}].id duplicates registry id {entry_id!r}")
        seen.add(entry_id)
        if not is_https(entry["source_url"]):
            errors.append(f"entries[{index}].source_url must be HTTPS")
        if entry["source_class"] == "production_system_candidate":
            if entry["candidate_evidence_kind"] != "production_design_system":
                errors.append(
                    f"entries[{index}] production_system_candidate must map to production_design_system"
                )
        elif entry["candidate_evidence_kind"] != "inspiration_only":
            errors.append(
                f"entries[{index}] non-production registry source must remain inspiration_only"
            )
    return sorted(set(errors))


def validate_profile(
    profile: dict[str, Any],
    registry: dict[str, Any],
    basis: dict[str, Any],
    cards: dict[str, dict[str, Any]],
) -> list[str]:
    errors = _schema_errors(profile, PROFILE_SCHEMA)
    if errors:
        return sorted(set(errors))

    if basis.get("status") != "GROUNDED":
        errors.append("UI style profile requires a GROUNDED Visual Basis")
    if profile["basis_id"] != basis.get("id"):
        errors.append("UI style profile basis_id must match the validated Visual Basis")

    registry_by_id = {entry["id"]: entry for entry in registry.get("entries", [])}
    missing_registry = sorted(set(profile["registry_ids"]) - set(registry_by_id))
    if missing_registry:
        errors.append(
            "UI style profile references unknown registry ids: "
            + ", ".join(missing_registry)
        )

    decisions = {
        decision["id"]: decision
        for decision in basis.get("decisions", [])
        if isinstance(decision, dict) and isinstance(decision.get("id"), str)
    }
    selected_basis_cards = set(basis.get("card_ids", []))
    for axis_name, axis in profile["signature"].items():
        missing_decisions = sorted(set(axis["decision_ids"]) - set(decisions))
        if missing_decisions:
            errors.append(
                f"signature.{axis_name} references unknown basis decisions: "
                + ", ".join(missing_decisions)
            )
            continue
        supporting_card_ids: set[str] = set()
        for decision_id in axis["decision_ids"]:
            supporting_card_ids.update(decisions[decision_id].get("card_ids", []))
        outside_basis = sorted(supporting_card_ids - selected_basis_cards)
        if outside_basis:
            errors.append(
                f"signature.{axis_name} resolves to cards outside the Visual Basis: "
                + ", ".join(outside_basis)
            )
        inspiration = sorted(
            card_id
            for card_id in supporting_card_ids
            if cards.get(card_id, {}).get("subject", {}).get("kind")
            == "inspiration_only"
        )
        if inspiration:
            errors.append(
                f"signature.{axis_name} cannot be grounded by inspiration_only cards: "
                + ", ".join(inspiration)
            )

    if basis.get("basis_origin") == "external_research" and basis.get(
        "target_context", {}
    ).get("greenfield"):
        if profile["status"] != "GROUNDED":
            errors.append(
                "greenfield external UI style profile must be GROUNDED before implementation"
            )
        if profile["stack_independence"]["unmodified_stack_default"] is not False:
            errors.append(
                "greenfield external UI style profile cannot use an unmodified component-stack default"
            )

    for registry_id in profile["registry_ids"]:
        entry = registry_by_id.get(registry_id)
        if entry and entry.get("can_ground_without_card") is not False:
            errors.append(
                f"registry source {registry_id!r} cannot become grounding authority"
            )

    return sorted(set(errors))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    registry_parser = subparsers.add_parser("validate-registry")
    registry_parser.add_argument(
        "registry", type=Path, nargs="?", default=DEFAULT_REGISTRY
    )

    profile_parser = subparsers.add_parser("validate-profile")
    profile_parser.add_argument("profile", type=Path)
    profile_parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    profile_parser.add_argument("--visual-basis", type=Path, required=True)
    profile_parser.add_argument("--cards-dir", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        registry = load_json(args.registry, "UI reference registry")
        registry_errors = validate_registry(registry)
        if args.command == "validate-registry":
            payload = {
                "command": args.command,
                "entry_count": len(registry.get("entries", [])),
                "errors": registry_errors,
                "registry_is_evidence": registry.get("registry_is_evidence"),
                "valid": not registry_errors,
            }
            print(json.dumps(payload, sort_keys=True))
            return int(bool(registry_errors))

        profile = load_json(args.profile, "UI style profile")
        basis, cards, basis_errors = load_and_validate_bundle(
            args.visual_basis, args.cards_dir
        )
        errors = list(registry_errors) + list(basis_errors)
        if not basis_errors:
            errors.extend(validate_profile(profile, registry, basis, cards))
        errors = sorted(set(errors))
        payload = {
            "basis_id": basis.get("id"),
            "command": args.command,
            "errors": errors,
            "profile_id": profile.get("id"),
            "registry_ids": profile.get("registry_ids", []),
            "valid": not errors,
        }
        print(json.dumps(payload, sort_keys=True))
        return int(bool(errors))
    except UiStyleProfileError as error:
        print(
            json.dumps(
                {"command": args.command, "errors": [str(error)], "valid": False},
                sort_keys=True,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
