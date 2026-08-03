#!/usr/bin/env python3
"""Validate skill test contracts and optionally execute them through an adapter."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


SCRIPT_DIR = Path(__file__).resolve().parent
TEST_ROOT = SCRIPT_DIR / "skills"
SKILLS_ROOT = SCRIPT_DIR.parent
MAX_ADAPTER_OUTPUT_BYTES = 1_000_000
TEST_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TIMEOUT = re.compile(r"^(\d+)(ms|s|m)$")

EXPECTED_VALIDATORS = {
    "output_contains_all": "contains",
    "output_excludes_none": "not_contains",
    "file_count_matches": "files_created",
    "min_lines_satisfied": "min_lines",
    "severity_counts_match": "severity_count",
}
STANDALONE_VALIDATORS = {"no_todos"}

USE_COLOR = True


def color(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def available_skills() -> list[str]:
    if not TEST_ROOT.is_dir():
        return []
    return sorted(
        path.name
        for path in TEST_ROOT.iterdir()
        if path.is_dir() and (path / "test.yaml").is_file()
    )


def load_contract(skill_name: str) -> dict[str, Any]:
    test_file = TEST_ROOT / skill_name / "test.yaml"
    if not test_file.is_file():
        raise ValueError(f"test contract not found: {test_file}")
    try:
        document = yaml.safe_load(test_file.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ValueError(f"cannot read test contract {test_file}: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError(f"test contract root must be an object: {test_file}")
    return document


def _string_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(item, str) and item.strip() for item in value)
    )


def _validator_expected_key(validator: str) -> str | None:
    if validator in STANDALONE_VALIDATORS:
        return ""
    if validator in EXPECTED_VALIDATORS:
        return EXPECTED_VALIDATORS[validator]
    match = re.fullmatch(r"min_([a-z0-9_]+)_satisfied", validator)
    return f"min_{match.group(1)}" if match else None


def validate_contract_document(
    skill_name: str, document: Any, skills_root: Path = SKILLS_ROOT
) -> list[str]:
    """Return deterministic schema errors for one skill test contract."""
    errors: list[str] = []
    if not isinstance(document, dict):
        return ["contract root must be an object"]
    if document.get("skill") != skill_name:
        errors.append(f"skill field must equal directory name: {skill_name}")
    if not isinstance(document.get("version"), str) or not document["version"].strip():
        errors.append("version must be a non-empty string")
    if not (skills_root / skill_name / "SKILL.md").is_file():
        errors.append(f"skill source is missing: skills/{skill_name}/SKILL.md")

    tests = document.get("tests")
    if not isinstance(tests, list) or not tests:
        errors.append("tests must be a non-empty array")
        return errors

    seen: set[str] = set()
    for index, test in enumerate(tests):
        prefix = f"tests[{index}]"
        if not isinstance(test, dict):
            errors.append(f"{prefix} must be an object")
            continue
        test_id = test.get("id")
        if not isinstance(test_id, str) or not TEST_ID.fullmatch(test_id):
            errors.append(f"{prefix}.id must use lowercase kebab-case")
        elif test_id in seen:
            errors.append(f"duplicate test id: {test_id}")
        else:
            seen.add(test_id)
        if (
            not isinstance(test.get("description"), str)
            or not test["description"].strip()
        ):
            errors.append(f"{prefix}.description must be a non-empty string")
        if not isinstance(test.get("input"), dict):
            errors.append(f"{prefix}.input must be an object")
        if not _string_list(test.get("tags")):
            errors.append(f"{prefix}.tags must be a non-empty string array")
        timeout = test.get("timeout")
        if not isinstance(timeout, str) or not TIMEOUT.fullmatch(timeout):
            errors.append(f"{prefix}.timeout must look like 500ms, 30s, or 2m")

        expected = test.get("expected")
        validators = test.get("validate")
        if not isinstance(expected, dict) or not expected:
            errors.append(f"{prefix}.expected must be a non-empty object")
            expected = {}
        if not _string_list(validators):
            errors.append(f"{prefix}.validate must be a non-empty string array")
            validators = []

        for key, value in expected.items():
            if key in {"contains", "not_contains"}:
                if not _string_list(value):
                    errors.append(f"{prefix}.expected.{key} must be a string array")
            elif key == "severity_count":
                if not isinstance(value, dict) or not all(
                    isinstance(name, str)
                    and isinstance(count, int)
                    and not isinstance(count, bool)
                    and count >= 0
                    for name, count in value.items()
                ):
                    errors.append(
                        f"{prefix}.expected.severity_count must map names to counts"
                    )
            elif key == "files_created" or key.startswith("min_"):
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    errors.append(
                        f"{prefix}.expected.{key} must be a non-negative integer"
                    )
            else:
                errors.append(f"{prefix}.expected has unsupported key: {key}")

        for validator in validators:
            expected_key = _validator_expected_key(validator)
            if expected_key is None:
                errors.append(f"{prefix} has unknown validator: {validator}")
            elif expected_key and expected_key not in expected:
                errors.append(
                    f"{prefix} validator {validator} requires expected.{expected_key}"
                )
    return errors


def parse_timeout(value: str) -> float:
    match = TIMEOUT.fullmatch(value)
    if not match:
        raise ValueError(f"invalid timeout: {value}")
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "ms":
        return max(amount / 1000, 0.001)
    if unit == "m":
        return amount * 60
    return float(amount)


def validate_live_result(result: Any, test: dict[str, Any]) -> list[str]:
    """Validate adapter output without inventing semantic metrics."""
    if not isinstance(result, dict):
        return ["adapter response must be a JSON object"]
    unexpected = sorted(set(result) - {"output", "metrics"})
    errors = [f"adapter response has unexpected field: {key}" for key in unexpected]
    output = result.get("output")
    metrics = result.get("metrics", {})
    if not isinstance(output, str):
        errors.append("adapter response output must be a string")
        output = ""
    if not isinstance(metrics, dict):
        errors.append("adapter response metrics must be an object")
        metrics = {}

    expected = test.get("expected", {})
    for item in expected.get("contains", []):
        if item not in output:
            errors.append(f"missing expected content: {item}")
    for item in expected.get("not_contains", []):
        if item in output:
            errors.append(f"found forbidden content: {item}")
    if "no_todos" in test.get("validate", []) and re.search(
        r"\b(?:TODO|FIXME)\b", output
    ):
        errors.append("output contains TODO or FIXME")
    if "min_lines" in expected and len(output.splitlines()) < expected["min_lines"]:
        errors.append(
            f"line count {len(output.splitlines())} < {expected['min_lines']}"
        )

    for key, minimum in expected.items():
        if not key.startswith("min_") or key == "min_lines":
            continue
        metric = key.removeprefix("min_")
        actual = metrics.get(metric)
        if not isinstance(actual, (int, float)) or isinstance(actual, bool):
            errors.append(f"missing metric: {metric}")
        elif actual < minimum:
            errors.append(f"metric {metric} {actual} < {minimum}")

    if "files_created" in expected:
        actual = metrics.get("files_created")
        if not isinstance(actual, int) or isinstance(actual, bool):
            errors.append("missing metric: files_created")
        elif actual != expected["files_created"]:
            errors.append(
                f"metric files_created {actual} != {expected['files_created']}"
            )

    if "severity_count" in expected:
        actual = metrics.get("severity_count")
        if not isinstance(actual, dict):
            errors.append("missing metric: severity_count")
        else:
            for severity, minimum in expected["severity_count"].items():
                count = actual.get(severity)
                if (
                    not isinstance(count, int)
                    or isinstance(count, bool)
                    or count < minimum
                ):
                    errors.append(
                        f"metric severity_count.{severity} {count!r} < {minimum}"
                    )
    return errors


def resolve_adapter(command: str | None) -> list[str] | None:
    raw = command or os.environ.get("FORGEWRIGHT_SKILL_TEST_ADAPTER")
    if not raw:
        return None
    argv = shlex.split(raw)
    if not argv:
        raise ValueError("live adapter command is empty")
    executable = shutil.which(argv[0])
    if executable is None:
        raise ValueError(f"live adapter executable not found: {argv[0]}")
    argv[0] = executable
    return argv


def execute_adapter(
    argv: list[str], skill_name: str, test: dict[str, Any]
) -> dict[str, Any]:
    skill_file = SKILLS_ROOT / skill_name / "SKILL.md"
    request = {
        "protocol_version": 1,
        "skill": skill_name,
        "test": test,
        "skill_prompt": skill_file.read_text(encoding="utf-8"),
    }
    completed = subprocess.run(
        argv,
        input=json.dumps(request),
        text=True,
        capture_output=True,
        timeout=parse_timeout(test["timeout"]),
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"adapter exited {completed.returncode}: {detail[:1000]}")
    if len(completed.stdout.encode("utf-8")) > MAX_ADAPTER_OUTPUT_BYTES:
        raise RuntimeError("adapter output exceeded 1000000 bytes")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"adapter output is not JSON: {exc}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("adapter response must be a JSON object")
    return result


def selected_tests(
    tests: list[dict[str, Any]], test_id: str | None, tags: set[str]
) -> list[dict[str, Any]]:
    selected = []
    for test in tests:
        if test_id and test.get("id") != test_id:
            continue
        if tags and not tags.intersection(test.get("tags", [])):
            continue
        selected.append(test)
    return selected


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    global USE_COLOR
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill", nargs="?", help="Skill name to test")
    parser.add_argument("test_id", nargs="?", help="Specific test ID")
    parser.add_argument("--all", action="store_true", help="Run every contract")
    parser.add_argument("--list", action="store_true", help="List test contracts")
    parser.add_argument("--tag", help="Comma-separated tag filter")
    parser.add_argument(
        "--contract-only", action="store_true", help="Validate contracts only"
    )
    parser.add_argument(
        "--require-live", action="store_true", help="Fail unless a live adapter is set"
    )
    parser.add_argument("--adapter-command", help="Live adapter command (no shell)")
    parser.add_argument("--report", type=Path, help="Write a JSON result report")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    args = parser.parse_args(argv)
    USE_COLOR = not args.no_color

    if args.contract_only and args.require_live:
        parser.error("--contract-only and --require-live are mutually exclusive")

    skills = available_skills()
    if args.list:
        print("Available Skill Tests")
        for skill in skills:
            document = load_contract(skill)
            print(f"{skill}: {len(document.get('tests', []))}")
        return 0
    if not args.all and not args.skill:
        parser.print_help()
        return 0
    if args.skill and args.skill not in skills:
        print(f"Unknown skill test contract: {args.skill}", file=sys.stderr)
        return 2

    try:
        adapter = None if args.contract_only else resolve_adapter(args.adapter_command)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.require_live and adapter is None:
        print("A live adapter is required but none was configured.", file=sys.stderr)
        return 2

    mode = "live" if adapter else "contract-only"
    print(f"Mode: {mode}")
    target_skills = skills if args.all else [args.skill]
    tag_filter = {tag.strip() for tag in (args.tag or "").split(",") if tag.strip()}
    report: dict[str, Any] = {
        "schema_version": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "tests": [],
    }

    for skill in target_skills:
        document = load_contract(skill)
        contract_errors = validate_contract_document(skill, document)
        if contract_errors:
            for error in contract_errors:
                print(color("31", f"[FAIL] {skill}: {error}"))
            report["failed"] += len(contract_errors)
            continue
        tests = selected_tests(document["tests"], args.test_id, tag_filter)
        if args.test_id and not tests:
            print(f"Test ID not found: {args.test_id}", file=sys.stderr)
            return 2
        for test in tests:
            test_id = test["id"]
            if test.get("deprecated") or test.get("skip"):
                report["skipped"] += 1
                report["tests"].append(
                    {"skill": skill, "id": test_id, "status": "skipped"}
                )
                continue
            errors: list[str] = []
            if adapter:
                try:
                    result = execute_adapter(adapter, skill, test)
                    errors = validate_live_result(result, test)
                except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                    errors = [str(exc)]
            if errors:
                report["failed"] += 1
                report["tests"].append(
                    {
                        "skill": skill,
                        "id": test_id,
                        "status": "failed",
                        "errors": errors,
                    }
                )
                print(color("31", f"[FAIL] {skill}/{test_id}: {'; '.join(errors)}"))
            else:
                report["passed"] += 1
                report["tests"].append(
                    {"skill": skill, "id": test_id, "status": "passed"}
                )
                label = "Live passed" if adapter else "Contract passed"
                print(color("32", f"[PASS] {label}: {skill}/{test_id}"))

    print(
        f"Results: passed={report['passed']} failed={report['failed']} "
        f"skipped={report['skipped']}"
    )
    if args.report:
        write_report(args.report, report)
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
