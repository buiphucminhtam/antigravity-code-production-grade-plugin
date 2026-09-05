#!/usr/bin/env python3
"""PF0 instruction-authority and heuristic-provenance audit contracts.

The module intentionally accepts plain JSON-compatible data.  It has no
implicit filesystem scan: callers must first construct the fixed inventory
declared by :func:`default_inventory` and provide rule locations explicitly.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


INVENTORY_VERSION = "product-factory-instruction-inventory/v1"
AUDIT_VERSION = "product-factory-instruction-audit/v1"
HEURISTIC_REGISTRY_VERSION = "product-factory-heuristic-registry/v1"
AUTHORITY_RANKS = {
    "kernel": 400,
    "shared_protocol": 300,
    "routed_lite": 200,
    "routed_skill": 100,
}
MAX_SOURCES = 512
MAX_RULES = 1024
MAX_HEURISTICS = 512
MAX_FIELD_LENGTH = 4096
CLASSIFICATIONS = frozenset({"current-project", "primary", "default", "hypothesis"})
_LOCATOR = re.compile(r"^[^\s]+(?::\d+(?::\d+)?)?$")


class AuditError(ValueError):
    """Raised when an instruction or heuristic cannot be trusted."""


@dataclass(frozen=True)
class InventorySource:
    path: str
    authority: str


@dataclass(frozen=True)
class Rule:
    rule_id: str
    authority: str
    source: str
    location: str
    statement: str
    disposition: str = "active"


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def default_inventory(root: str | Path) -> dict[str, Any]:
    """Return the stable, sorted v1 inventory for a repository root.

    It always includes exactly the six operational kernel sources and every
    tracked shared protocol and routed LITE/SKILL overlay. Missing mandatory
    sources are left in the inventory so validation fails rather than silently
    shrinking the audit surface.
    """

    base = Path(root).resolve()
    sources: list[InventorySource] = [
        InventorySource(f"kernel/{name}.md", "kernel")
        for name in ("ENTRY", "SOLVE", "VERIFY", "ESCALATE", "CLARIFY", "POLICY")
    ]
    tracked = _tracked_paths(base)
    seen = {source.path for source in sources}

    def add_tracked(paths: Iterable[Path], authority: str) -> None:
        for path in sorted(paths):
            relative = _relative(base, path)
            if relative not in tracked or relative in seen:
                continue
            sources.append(InventorySource(relative, authority))
            seen.add(relative)

    add_tracked((base / "skills" / "_shared" / "protocols").rglob("*.md"), "shared_protocol")
    add_tracked((base / "skills").rglob("LITE.md"), "routed_lite")
    add_tracked((base / "skills").rglob("SKILL.md"), "routed_skill")
    return {
        "schema_version": INVENTORY_VERSION,
        "sources": [asdict(source) for source in sorted(sources, key=lambda item: item.path)],
    }


def _tracked_paths(root: Path) -> set[str]:
    result = subprocess.run(
        ["git", "ls-files", "--", "skills/_shared/protocols", "skills"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise AuditError("unable to determine tracked instruction inventory")
    return {line for line in result.stdout.splitlines() if line}


def validate_inventory(inventory: Mapping[str, Any], root: str | Path | None = None) -> None:
    if set(inventory) != {"schema_version", "sources"}:
        raise AuditError("inventory contains unknown fields")
    if inventory.get("schema_version") != INVENTORY_VERSION:
        raise AuditError("inventory schema_version must be " + INVENTORY_VERSION)
    sources = inventory.get("sources")
    if not isinstance(sources, list) or not sources or len(sources) > MAX_SOURCES:
        raise AuditError("inventory sources must be a non-empty list")
    seen: set[str] = set()
    mandatory = {f"kernel/{name}.md" for name in ("ENTRY", "SOLVE", "VERIFY", "ESCALATE", "CLARIFY", "POLICY")}
    actual: set[str] = set()
    for source in sources:
        if not isinstance(source, Mapping) or set(source) != {"path", "authority"}:
            raise AuditError("inventory source must be an object")
        path, authority = source.get("path"), source.get("authority")
        if not isinstance(path, str) or not path or len(path) > MAX_FIELD_LENGTH or path.startswith("/") or ".." in Path(path).parts:
            raise AuditError("inventory source path must be a safe relative path")
        if authority not in AUTHORITY_RANKS:
            raise AuditError(f"inventory source {path!r} has unknown authority")
        if path in seen:
            raise AuditError(f"inventory contains duplicate source {path}")
        seen.add(path)
        actual.add(path)
        if root is not None and not (Path(root) / path).is_file():
            raise AuditError(f"inventory source is missing: {path}")
    missing = sorted(mandatory - actual)
    if missing:
        raise AuditError("inventory omits mandatory kernel source(s): " + ", ".join(missing))
    if root is not None and inventory != default_inventory(root):
        raise AuditError("inventory does not match current tracked v1 source selection")


def _rule(value: Mapping[str, Any], inventory: Mapping[str, str]) -> Rule:
    required = ("rule_id", "authority", "source", "location", "statement")
    if set(value) - {*required, "disposition"}:
        raise AuditError("rule contains unknown fields")
    for key in required:
        if not isinstance(value.get(key), str) or not value[key].strip() or len(value[key]) > MAX_FIELD_LENGTH:
            raise AuditError(f"rule {key} must be a non-empty string")
    authority = value["authority"]
    source = value["source"]
    if authority not in AUTHORITY_RANKS:
        raise AuditError(f"rule {value['rule_id']} has unknown authority")
    if source not in inventory:
        raise AuditError(f"rule {value['rule_id']} source is outside fixed inventory: {source}")
    if inventory[source] != authority:
        raise AuditError(f"rule {value['rule_id']} authority does not match inventory source")
    location = value["location"]
    if not location.startswith(source + ":"):
        raise AuditError(f"rule {value['rule_id']} location must start with its source")
    disposition = value.get("disposition", "active")
    if disposition not in {"active", "stale"}:
        raise AuditError(f"rule {value['rule_id']} disposition must be active or stale")
    return Rule(value["rule_id"], authority, source, location, value["statement"], disposition)


def audit_rules(inventory: Mapping[str, Any], rules: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Resolve competing rule IDs with explicit rank and complete provenance."""

    validate_inventory(inventory)
    inventory_by_source = {item["path"]: item["authority"] for item in inventory["sources"]}
    raw_rules = list(rules)
    if len(raw_rules) > MAX_RULES:
        raise AuditError("rule count exceeds bounded v1 maximum")
    grouped: dict[str, list[Rule]] = {}
    for raw in raw_rules:
        if not isinstance(raw, Mapping):
            raise AuditError("rule must be an object")
        item = _rule(raw, inventory_by_source)
        grouped.setdefault(item.rule_id, []).append(item)
    resolutions: list[dict[str, Any]] = []
    for rule_id in sorted(grouped):
        candidates = grouped[rule_id]
        active = [item for item in candidates if item.disposition == "active"]
        if not active:
            raise AuditError(f"rule {rule_id} has no active candidate")
        ordered = sorted(active, key=lambda item: (-AUTHORITY_RANKS[item.authority], item.location))
        winner = ordered[0]
        for authority in AUTHORITY_RANKS:
            peers = [item for item in active if item.authority == authority]
            if len({item.statement for item in peers}) > 1:
                raise AuditError(f"same-authority contradiction for rule {rule_id}")
        losers = []
        for item in candidates:
            if item is winner:
                continue
            if item.disposition == "active" and AUTHORITY_RANKS[item.authority] < AUTHORITY_RANKS[winner.authority]:
                disposition = "superseded_lower_authority"
            elif item.disposition == "stale":
                disposition = "stale_rejected"
            else:
                disposition = "duplicate_same_authority"
            losers.append({"source": item.source, "location": item.location, "statement": item.statement, "disposition": disposition})
        resolutions.append({
            "rule_id": rule_id,
            "winner": {"authority": winner.authority, "source": winner.source, "location": winner.location, "statement": winner.statement, "disposition": "active_winner"},
            "losers": sorted(losers, key=lambda item: (item["source"], item["location"])),
        })
    return {"schema_version": AUDIT_VERSION, "authority_ranks": AUTHORITY_RANKS, "resolutions": resolutions}


def validate_heuristics(entries: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Validate a provenance registry without promoting defaults into truth."""

    iterator = iter(entries)
    bounded_entries = []
    for _ in range(MAX_HEURISTICS + 1):
        try:
            bounded_entries.append(next(iterator))
        except StopIteration:
            break
    if len(bounded_entries) > MAX_HEURISTICS:
        raise AuditError("heuristic count exceeds bounded v1 maximum")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in bounded_entries:
        if not isinstance(entry, Mapping):
            raise AuditError("heuristic entry must be an object")
        required = ("id", "value", "domain", "source", "evidence_locator", "evidence_type", "date", "classification")
        if set(entry) != set(required):
            raise AuditError("heuristic entry contains unknown or missing fields")
        for key in required:
            value = entry.get(key)
            if key == "value":
                valid = isinstance(value, (str, int, float)) and not isinstance(value, bool) and str(value).strip() and len(str(value)) <= MAX_FIELD_LENGTH
            else:
                valid = isinstance(value, str) and value.strip() and len(value) <= MAX_FIELD_LENGTH
            if not valid:
                raise AuditError(f"heuristic {key} must be a non-empty string")
        if entry["id"] in seen:
            raise AuditError(f"duplicate heuristic id {entry['id']}")
        seen.add(entry["id"])
        classification = entry["classification"]
        if classification not in CLASSIFICATIONS:
            raise AuditError(f"heuristic {entry['id']} has invalid classification")
        if not _LOCATOR.fullmatch(entry["evidence_locator"]):
            raise AuditError(f"heuristic {entry['id']} has invalid evidence locator")
        try:
            from datetime import date
            date.fromisoformat(entry["date"])
        except ValueError as exc:
            raise AuditError(f"heuristic {entry['id']} date must be ISO-8601") from exc
        value_text = str(entry["value"])
        numeric_truth = isinstance(entry["value"], (int, float)) and not isinstance(entry["value"], bool)
        numeric_truth = numeric_truth or any("0" <= character <= "9" for character in value_text)
        if classification in {"current-project", "primary"} and numeric_truth:
            if entry["evidence_type"] not in {"measurement", "primary_source"}:
                raise AuditError(f"heuristic {entry['id']} makes unsupported numeric truth claim")
        normalized.append(dict(entry))
    return {"schema_version": HEURISTIC_REGISTRY_VERSION, "entries": sorted(normalized, key=lambda item: item["id"])}


def canonical_json(value: Mapping[str, Any]) -> str:
    """Expose canonical serialization for receipts and stable test fixtures."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
