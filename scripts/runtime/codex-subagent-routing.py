#!/usr/bin/env python3
"""Resolve safe native Codex ``spawn_agent`` model overrides.

The resolver deliberately treats the project YAML as preferences and the
capability payload as the only authority for passing model or reasoning
overrides to a parent ``spawn_agent`` call.  The capability payload must be a
structured, same-invocation object of this form::

    {"status": "available", "models": [
        {"id": "gpt-5.6-luna", "reasoning_efforts": ["high", "medium"]}
    ]}

It emits one JSON object on stdout.  ``spawn_agent_args`` is safe to pass to
the native adapter; ``audit`` records why each field was or was not selected.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping

try:
    import yaml
except ImportError:  # pragma: no cover - exercised only in minimal runtimes
    yaml = None


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / ".production-grade.yaml"
FIELDS = ("model", "reasoning_effort")
_MISSING = object()


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _field_value(entry: Mapping[str, Any], field: str) -> Any:
    """Read one supported preference field without accepting aliases silently."""

    if field in entry:
        return entry[field]
    return _MISSING


def _preference_sources(
    config: Any,
    *,
    agent_type: str | None,
    tier: str | None,
    overrides: Any,
) -> tuple[list[tuple[str, Mapping[str, Any]]], list[str]]:
    """Return precedence-ordered preference maps and structural warnings."""

    warnings: list[str] = []
    sources: list[tuple[str, Mapping[str, Any]]] = []

    explicit = _mapping(overrides)
    if overrides is not None and explicit is None:
        warnings.append("explicit overrides are malformed")
    elif explicit is not None:
        sources.append(("explicit", explicit))

    root = _mapping(config)
    if config is not None and root is None:
        warnings.append("config root is malformed")
        return sources, warnings

    subagents = root.get("subagents", {}) if root else {}
    subagents_map = _mapping(subagents)
    if root is not None and subagents_map is None:
        warnings.append("subagents is malformed")
        return sources, warnings
    codex = _mapping(subagents_map.get("codex")) if subagents_map else None
    if root is not None and codex is None:
        warnings.append("subagents.codex is missing or malformed")
        return sources, warnings

    if codex is None:
        return sources, warnings

    agent_types = codex.get("agent_types", {})
    tiers = codex.get("tiers", {})
    default = codex.get("default", {})
    for name, value in (
        ("agent_types", agent_types),
        ("tiers", tiers),
        ("default", default),
    ):
        if not isinstance(value, Mapping):
            warnings.append(f"{name} is malformed")

    if agent_type and isinstance(agent_types, Mapping) and agent_type in agent_types:
        entry = _mapping(agent_types[agent_type])
        if entry is None:
            warnings.append(f"agent_types.{agent_type} is malformed")
        else:
            sources.append(("agent_type", entry))
    if tier and isinstance(tiers, Mapping) and tier in tiers:
        entry = _mapping(tiers[tier])
        if entry is None:
            warnings.append(f"tiers.{tier} is malformed")
        else:
            sources.append(("tier", entry))
    if isinstance(default, Mapping):
        sources.append(("default", default))

    return sources, warnings


def _select_preferences(
    sources: list[tuple[str, Mapping[str, Any]]],
) -> tuple[dict[str, Any], dict[str, str | None], list[str]]:
    """Resolve each field independently, preserving precedence on bad values."""

    selected: dict[str, Any] = {}
    selected_source: dict[str, str | None] = {field: None for field in FIELDS}
    warnings: list[str] = []

    for field in FIELDS:
        for source, entry in sources:
            value = _field_value(entry, field)
            if value is _MISSING:
                continue
            selected[field] = value
            selected_source[field] = source
            if field == "model" and not _is_non_empty_string(value):
                warnings.append(f"{source} model preference is malformed")
            if field == "reasoning_effort" and not _is_non_empty_string(value):
                warnings.append(f"{source} reasoning_effort preference is malformed")
            break

    return selected, selected_source, warnings


def _normalize_efforts(value: Any) -> set[str] | None:
    if _is_non_empty_string(value):
        return {value}
    if (
        not isinstance(value, list)
        or not value
        or not all(_is_non_empty_string(item) for item in value)
    ):
        return None
    return set(value)


def _normalize_capabilities(
    capabilities: Any,
) -> tuple[dict[str, set[str] | None], str | None, str | None]:
    """Validate and normalize the supported structured capability payload."""

    root = _mapping(capabilities)
    if root is None:
        return {}, "provider-managed", "capability payload is missing or malformed"

    state = root.get("status", "available")
    if state == "unavailable":
        return {}, "unavailable", "active provider reports unavailable"
    if state in {"provider-managed", "verified", "available"}:
        pass
    else:
        return {}, "provider-managed", "capability status is malformed"

    models = root.get("models", _MISSING)
    if not isinstance(models, list):
        return {}, "provider-managed", "capabilities.models is missing or malformed"

    normalized: dict[str, set[str] | None] = {}
    for model in models:
        item = _mapping(model)
        if item is None:
            return {}, "provider-managed", "a capability model entry is malformed"
        model_id = item.get("id", _MISSING)
        if not _is_non_empty_string(model_id):
            return (
                {},
                "provider-managed",
                "a capability model id is missing or malformed",
            )
        effort_keys = [
            key for key in ("reasoning_efforts", "reasoning_effort") if key in item
        ]
        if len(effort_keys) > 1:
            return (
                {},
                "provider-managed",
                f"capability for {model_id} has duplicate effort fields",
            )
        efforts = None if not effort_keys else _normalize_efforts(item[effort_keys[0]])
        if effort_keys and efforts is None:
            return (
                {},
                "provider-managed",
                f"capability reasoning efforts for {model_id} are malformed",
            )
        if model_id in normalized and normalized[model_id] != efforts:
            existing = normalized[model_id]
            if existing is None or efforts is None:
                normalized[model_id] = None
            else:
                normalized[model_id] = existing | efforts
        else:
            normalized[model_id] = efforts

    if state == "provider-managed":
        return normalized, "provider-managed", "active provider owns model selection"
    return normalized, None, None


def resolve_routing(
    config: Any,
    capabilities: Any,
    *,
    tier: str | None = None,
    agent_type: str | None = None,
    overrides: Any = None,
    config_source: str = ".production-grade.yaml",
    capability_source: str = "active spawn_agent schema",
    config_error: str | None = None,
    capability_error: str | None = None,
) -> dict[str, Any]:
    """Resolve validated native Codex spawn arguments and an audit packet."""

    sources, warnings = _preference_sources(
        config, agent_type=agent_type, tier=tier, overrides=overrides
    )
    if config_error:
        warnings.append(config_error)
    selected, preference_source, selection_warnings = _select_preferences(sources)
    warnings.extend(selection_warnings)

    supported, capability_state, capability_reason = _normalize_capabilities(
        capabilities
    )
    if capability_error:
        capability_state = "provider-managed"
        capability_reason = capability_error

    spawn_args: dict[str, str] = {}
    resolved: dict[str, str | None] = {field: None for field in FIELDS}
    omissions: dict[str, str] = {}

    model = selected.get("model", _MISSING)
    model_valid = _is_non_empty_string(model)
    if model is not _MISSING and not model_valid:
        omissions["model"] = "configured model is malformed"
    elif model_valid and capability_state is None:
        if model not in supported:
            omissions["model"] = "configured model is not advertised"
        else:
            spawn_args["model"] = model
            resolved["model"] = model
    elif model is not _MISSING:
        omissions["model"] = capability_reason or "model capability is unavailable"

    effort = selected.get("reasoning_effort", _MISSING)
    effort_valid = _is_non_empty_string(effort)
    if effort is not _MISSING and not effort_valid:
        omissions["reasoning_effort"] = "configured reasoning_effort is malformed"
    elif effort_valid:
        # An effort is only safe when the exact selected model/effort pair is
        # advertised.  Never pass an effort by guessing the provider-managed model.
        if "model" not in spawn_args:
            omissions["reasoning_effort"] = "exact model/effort pair is not verified"
        elif capability_state is not None:
            omissions["reasoning_effort"] = (
                capability_reason or "effort capability is unavailable"
            )
        elif supported.get(spawn_args["model"]) is None:
            omissions["reasoning_effort"] = (
                "capability does not advertise reasoning efforts for model"
            )
        elif effort not in supported[spawn_args["model"]]:
            omissions["reasoning_effort"] = (
                "configured effort is not advertised for the exact model"
            )
        else:
            spawn_args["reasoning_effort"] = effort
            resolved["reasoning_effort"] = effort

    if capability_state == "unavailable":
        status = "unavailable"
    elif spawn_args and not omissions:
        status = "verified"
    elif spawn_args:
        status = "provider-managed"
    else:
        status = capability_state or "provider-managed"

    if not selected:
        warnings.append("no configured model or reasoning override resolved")
    reason = "; ".join(dict.fromkeys(warnings))
    if omissions:
        omitted = ", ".join(
            f"{field}: {message}" for field, message in omissions.items()
        )
        reason = "; ".join(part for part in (reason, f"omitted {omitted}") if part)
    if not reason:
        reason = "exact configured model and reasoning effort pair verified"

    audit = {
        "tier": tier,
        "agent_type": agent_type,
        "selection_status": status,
        "preference_source": preference_source,
        "capability_source": capability_source,
        "resolved": resolved,
        "omitted": omissions,
        "reason": reason,
        "enforcement": "advisory",
        "sources": {"config": config_source, "capabilities": capability_source},
    }
    return {
        "spawn_agent_args": spawn_args,
        "model_selection": status,
        "status": status,
        "audit": audit,
    }


def _load_yaml(path: Path) -> tuple[Any, str | None]:
    if not path.exists():
        return None, "config file is missing"
    if yaml is None:
        return None, "PyYAML is unavailable"
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return None, f"config is malformed: {exc.__class__.__name__}"
    return value, None


def _load_json_text(text: str, label: str) -> tuple[Any, str | None]:
    try:
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        return None, f"{label} is malformed JSON at character {exc.pos}"


def _load_capabilities(args: argparse.Namespace) -> tuple[Any, str | None]:
    if args.capabilities_file and args.capabilities_json:
        return None, "provide only one capability input"
    if args.capabilities_file:
        path = Path(args.capabilities_file)
        try:
            text = (
                sys.stdin.read()
                if str(path) == "-"
                else path.read_text(encoding="utf-8")
            )
        except OSError:
            return None, "capability file is missing or unreadable"
        return _load_json_text(text, "capability input")
    if args.capabilities_json:
        text = (
            sys.stdin.read()
            if args.capabilities_json == "-"
            else args.capabilities_json
        )
        return _load_json_text(text, "capability input")
    return None, "capability input is missing"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--capabilities-file")
    parser.add_argument("--capabilities-json")
    parser.add_argument("--capability-source", default="active spawn_agent schema")
    parser.add_argument("--tier")
    parser.add_argument("--agent-type")
    parser.add_argument("--model")
    parser.add_argument("--reasoning-effort")
    parser.add_argument("--overrides-json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config, config_error = _load_yaml(args.config)
    capabilities, capability_error = _load_capabilities(args)

    overrides: Any = {}
    if args.overrides_json:
        overrides, override_error = _load_json_text(
            args.overrides_json, "override input"
        )
        if override_error:
            overrides = None
            config_error = "; ".join(
                part for part in (config_error, override_error) if part
            )
    if args.model is not None:
        if not isinstance(overrides, dict):
            overrides = {}
        overrides["model"] = args.model
    if args.reasoning_effort is not None:
        if not isinstance(overrides, dict):
            overrides = {}
        overrides["reasoning_effort"] = args.reasoning_effort

    result = resolve_routing(
        config,
        capabilities,
        tier=args.tier,
        agent_type=args.agent_type,
        overrides=overrides,
        config_source=str(args.config),
        capability_source=args.capability_source,
        config_error=config_error,
        capability_error=capability_error,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
