#!/usr/bin/env python3
"""Local OpenAPI breaking-change checker with no hosted-CI dependency."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def _load(text: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        try:
            import yaml
        except ImportError as error:
            raise ValueError(
                f"cannot parse YAML OpenAPI document {label}: install local CI dependencies with `npm run ci:bootstrap`"
            ) from error
        try:
            value = yaml.safe_load(text)
        except yaml.YAMLError as error:
            raise ValueError(f"cannot parse {label}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain an OpenAPI object")
    return value


def _git_show(base_ref: str, path: Path) -> str | None:
    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(
        ["git", "show", f"{base_ref}:{relative}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def _required_parameters(operation: dict[str, Any]) -> set[tuple[str, str]]:
    result: set[tuple[str, str]] = set()
    for item in operation.get("parameters", []) or []:
        if isinstance(item, dict) and item.get("required") is True:
            result.add((str(item.get("in", "")), str(item.get("name", ""))))
    return result


def _schema_required(schema: Any) -> set[str]:
    if not isinstance(schema, dict):
        return set()
    required = schema.get("required", [])
    return {str(item) for item in required} if isinstance(required, list) else set()


def compare(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    old_paths = old.get("paths", {}) if isinstance(old.get("paths"), dict) else {}
    new_paths = new.get("paths", {}) if isinstance(new.get("paths"), dict) else {}

    for path_name, old_path in old_paths.items():
        if path_name not in new_paths:
            issues.append(f"removed path: {path_name}")
            continue
        if not isinstance(old_path, dict) or not isinstance(new_paths[path_name], dict):
            continue
        new_path = new_paths[path_name]
        for method in METHODS & {str(key).lower() for key in old_path}:
            old_op = old_path.get(method)
            new_op = new_path.get(method)
            if new_op is None:
                issues.append(f"removed operation: {method.upper()} {path_name}")
                continue
            if not isinstance(old_op, dict) or not isinstance(new_op, dict):
                continue
            added_required = _required_parameters(new_op) - _required_parameters(old_op)
            for location, name in sorted(added_required):
                issues.append(
                    f"new required parameter: {method.upper()} {path_name} {location}:{name}"
                )
            old_body = old_op.get("requestBody")
            new_body = new_op.get("requestBody")
            if isinstance(new_body, dict) and new_body.get("required") is True:
                if (
                    not isinstance(old_body, dict)
                    or old_body.get("required") is not True
                ):
                    issues.append(
                        f"request body became required: {method.upper()} {path_name}"
                    )
            old_responses = (
                old_op.get("responses", {})
                if isinstance(old_op.get("responses"), dict)
                else {}
            )
            new_responses = (
                new_op.get("responses", {})
                if isinstance(new_op.get("responses"), dict)
                else {}
            )
            for code in old_responses:
                if code not in new_responses:
                    issues.append(
                        f"removed response: {method.upper()} {path_name} {code}"
                    )

    old_schemas = (
        ((old.get("components") or {}).get("schemas") or {})
        if isinstance(old.get("components"), dict)
        else {}
    )
    new_schemas = (
        ((new.get("components") or {}).get("schemas") or {})
        if isinstance(new.get("components"), dict)
        else {}
    )
    if isinstance(old_schemas, dict) and isinstance(new_schemas, dict):
        for name, old_schema in old_schemas.items():
            if name not in new_schemas:
                issues.append(f"removed schema: {name}")
                continue
            new_schema = new_schemas[name]
            for field in sorted(
                _schema_required(new_schema) - _schema_required(old_schema)
            ):
                issues.append(f"new required schema property: {name}.{field}")
            if isinstance(old_schema, dict) and isinstance(new_schema, dict):
                old_enum = old_schema.get("enum")
                new_enum = new_schema.get("enum")
                if isinstance(old_enum, list) and isinstance(new_enum, list):
                    removed = {
                        json.dumps(item, sort_keys=True) for item in old_enum
                    } - {json.dumps(item, sort_keys=True) for item in new_enum}
                    for value in sorted(removed):
                        issues.append(f"removed enum value: {name} {value}")
    return issues


def discover() -> list[Path]:
    candidates: set[Path] = set()
    for pattern in (
        "**/openapi*.yaml",
        "**/openapi*.yml",
        "**/openapi*.json",
        "**/swagger*.yaml",
        "**/swagger*.yml",
        "**/swagger*.json",
    ):
        for path in ROOT.glob(pattern):
            if (
                "node_modules" not in path.parts
                and ".git" not in path.parts
                and path.is_file()
            ):
                candidates.add(path)
    return sorted(candidates)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check OpenAPI contracts locally for common breaking changes"
    )
    parser.add_argument("--base-ref", default="HEAD")
    parser.add_argument("specs", nargs="*")
    args = parser.parse_args()

    specs = [ROOT / item for item in args.specs] if args.specs else discover()
    if not specs:
        print("openapi contract check: SKIP (no specs detected)")
        return 0

    issues: list[str] = []
    checked = 0
    try:
        for path in specs:
            if not path.is_file():
                continue
            old_text = _git_show(args.base_ref, path)
            if old_text is None:
                print(f"openapi contract check: NEW {path.relative_to(ROOT)}")
                continue
            checked += 1
            old = _load(old_text, f"{args.base_ref}:{path.relative_to(ROOT)}")
            new = _load(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))
            for issue in compare(old, new):
                issues.append(f"{path.relative_to(ROOT)}: {issue}")
    except ValueError as error:
        print(f"openapi contract check: FAIL ({error})")
        return 1

    if issues:
        print("openapi contract check: FAIL")
        for issue in issues:
            print(f" - {issue}")
        return 1
    print(f"openapi contract check: PASS ({checked} existing spec(s) checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
