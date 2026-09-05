#!/usr/bin/env python3
"""PF0 immutable pre-change baseline receipt capture and validation."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

RECEIPT_VERSION = "product-factory-baseline-receipt/v1"
EVIDENCE_VERSION = "product-factory-baseline-evidence/v1"
SOURCE_REPORT_VERSION = "forgewright-local-ci/v1"
EVIDENCE_PATH = "product-factory/baseline-evidence.v1.json"
BASELINE_HEAD = "aa2ff807cd1ab2230c506f27f0e3e0de0055595f"
BASELINE_TREE = "71d8d8eb321b0f2f3ca6394cf1e9451ce5c0b703"
BASELINE_CAPTURED_AT = "2026-09-04T06:46:10.359350+00:00"
REPORT_SHA256 = "4009a88cd4ba75feb5d9e045d841b6fb7bd782c47c9499860a8f771e7a6eed0f"
UNMEASURED = frozenset({"unavailable", "not_measured"})
MAX_COMMANDS, MAX_ARGV, MAX_STRING, MAX_EVIDENCE_BYTES = 32, 32, 4096, 131072
REPO_ROOT_TOKEN = "${REPO_ROOT}"
NODE_BINARY_TOKEN = "${NODE_BINARY}"
BASH_TOKEN = "${BASH}"
EXPECTED_HOST = {
    "os": "Darwin",
    "python": "3.11.14",
    "node": "26.7.0",
    "node_binary": NODE_BINARY_TOKEN,
}
EXPECTED_COMMANDS = (
    {
        "name": "product-truth",
        "argv": [
            f"{REPO_ROOT_TOKEN}/.forgewright/local-ci-venv/bin/python",
            "scripts/ci/verify-product-truth.py",
        ],
        "cwd": REPO_ROOT_TOKEN,
        "exit_code": 0,
        "duration_ms": 40,
        "status": "pass",
        "note": "",
    },
    {
        "name": "adversarial-weak-model-rails",
        "argv": [
            f"{REPO_ROOT_TOKEN}/.forgewright/local-ci-venv/bin/python",
            "evals/adversarial-weak-model/run-evals.py",
            "--self-test",
        ],
        "cwd": REPO_ROOT_TOKEN,
        "exit_code": 0,
        "duration_ms": 2400,
        "status": "pass",
        "note": "",
    },
    {
        "name": "lite-overlays",
        "argv": [
            f"{REPO_ROOT_TOKEN}/.forgewright/local-ci-venv/bin/python",
            "scripts/lite/validate-overlays.py",
        ],
        "cwd": REPO_ROOT_TOKEN,
        "exit_code": 0,
        "duration_ms": 40,
        "status": "pass",
        "note": "",
    },
    {
        "name": "kernel-token-budget",
        "argv": [BASH_TOKEN, "scripts/lite/test-kernel-tokens.sh"],
        "cwd": REPO_ROOT_TOKEN,
        "exit_code": 0,
        "duration_ms": 238,
        "status": "pass",
        "note": "",
    },
    {
        "name": "git-diff-check",
        "argv": ["git", "diff", "--check"],
        "cwd": REPO_ROOT_TOKEN,
        "exit_code": 0,
        "duration_ms": 20,
        "status": "pass",
        "note": "",
    },
)
EXPECTED_CAPABILITIES = {
    "git_at_capture": "available",
    "historical_report": "available",
    "tracked_evidence": "available",
}
EXPECTED_GAPS = {
    "intent": "unavailable",
    "clarification": "not_measured",
    "environment_coverage": "not_measured",
    "false_success": "not_measured",
}


class ReceiptError(ValueError):
    """Raised when receipt evidence cannot bind the PF0 pre-change baseline."""


def _run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise ReceiptError("unable to resolve baseline git binding")
    return result.stdout.strip()


def _report(path: Path) -> tuple[Mapping[str, Any], str]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ReceiptError(
            "explicit historical local CI report is unavailable"
        ) from exc
    if not isinstance(value, Mapping):
        raise ReceiptError("historical local CI report must be an object")
    return value, hashlib.sha256(raw).hexdigest()


def capture_baseline_receipt(
    root: str | Path,
    *,
    expected_head: str,
    historical_report_path: str | Path,
) -> dict[str, Any]:
    """Build the immutable receipt from one explicit report at a clean base."""
    base = Path(root).resolve()
    if (
        expected_head != BASELINE_HEAD
        or _run_git(base, "rev-parse", "HEAD") != expected_head
    ):
        raise ReceiptError("capture requires the explicit PF0 baseline HEAD")
    if _run_git(base, "status", "--porcelain"):
        raise ReceiptError("capture requires a clean baseline worktree")
    if _run_git(base, "rev-parse", f"{expected_head}^{{tree}}") != BASELINE_TREE:
        raise ReceiptError("capture baseline tree does not match expected fingerprint")
    report_path = Path(historical_report_path)
    if not report_path.is_absolute():
        report_path = base / report_path
    report, report_digest = _report(report_path)
    if report_digest != REPORT_SHA256:
        raise ReceiptError(
            "explicit historical report digest differs from the PF0 capture"
        )
    evidence = _evidence_from_report(report)
    evidence_digest = hashlib.sha256(_canonical_json_bytes(evidence)).hexdigest()
    return {
        "schema_version": RECEIPT_VERSION,
        "baseline_head": BASELINE_HEAD,
        "baseline_tree": {"tree_sha": BASELINE_TREE, "worktree_status": "clean"},
        "captured_at": evidence["captured_at"],
        "engineering_quick_suite": {
            "status": evidence["status"],
            "evidence_path": EVIDENCE_PATH,
            "evidence_sha256": evidence_digest,
            "commands": _copy_commands(evidence["steps"]),
        },
        "environment": {
            "host": dict(evidence["host"]),
            "capabilities": dict(EXPECTED_CAPABILITIES),
        },
        "measurement_gaps": dict(EXPECTED_GAPS),
    }


def _evidence_from_report(report: Mapping[str, Any]) -> dict[str, Any]:
    expected_fields = {
        "schema",
        "mode",
        "status",
        "startedAt",
        "durationMs",
        "dryRun",
        "host",
        "repository",
        "steps",
    }
    if set(report) != expected_fields:
        raise ReceiptError("historical local CI report contains unknown fields")
    if (
        report.get("schema") != SOURCE_REPORT_VERSION
        or report.get("mode") != "quick"
        or report.get("status") != "pass"
        or report.get("startedAt") != BASELINE_CAPTURED_AT
        or report.get("durationMs") != 2845
        or report.get("dryRun") is not False
    ):
        raise ReceiptError(
            "historical local CI report identity differs from the PF0 capture"
        )
    repository = report.get("repository")
    if not isinstance(repository, Mapping) or set(repository) != {"head", "branch"}:
        raise ReceiptError("historical local CI report repository is malformed")
    if repository != {"head": BASELINE_HEAD, "branch": "main"}:
        raise ReceiptError(
            "historical local CI report repository differs from the PF0 capture"
        )
    host = report.get("host")
    if not isinstance(host, Mapping):
        raise ReceiptError("historical local CI report host is malformed")
    evidence = {
        "schema_version": EVIDENCE_VERSION,
        "source_schema": SOURCE_REPORT_VERSION,
        "mode": "quick",
        "status": "pass",
        "captured_at": BASELINE_CAPTURED_AT,
        "duration_ms": 2845,
        "host": _portable_host(host),
        "repository": {
            "head": BASELINE_HEAD,
            "tree_sha": BASELINE_TREE,
            "worktree_status": "clean",
        },
        "steps": _portable_commands(report.get("steps")),
    }
    _validate_baseline_evidence(evidence)
    return evidence


def _portable_commands(steps: Any) -> list[dict[str, Any]]:
    if not isinstance(steps, list) or not steps or len(steps) > MAX_COMMANDS:
        raise ReceiptError(
            "historical local CI report must contain bounded executed steps"
        )
    recorded_roots = {step.get("cwd") for step in steps if isinstance(step, Mapping)}
    if len(recorded_roots) != 1:
        raise ReceiptError(
            "historical local CI report commands must share one repository cwd"
        )
    recorded_root = next(iter(recorded_roots))
    if (
        not isinstance(recorded_root, str)
        or not PurePosixPath(recorded_root).is_absolute()
        or len(recorded_root) > MAX_STRING
    ):
        raise ReceiptError(
            "historical local CI report cwd must be an absolute capture path"
        )
    commands: list[dict[str, Any]] = []
    step_fields = {"name", "argv", "cwd", "exit_code", "duration_ms", "status", "note"}
    for step in steps:
        if not isinstance(step, Mapping) or set(step) != step_fields:
            raise ReceiptError("historical local CI report contains a malformed step")
        if (
            step.get("cwd") != recorded_root
            or step.get("status") != "pass"
            or step.get("exit_code") != 0
            or isinstance(step.get("exit_code"), bool)
            or not isinstance(step.get("duration_ms"), int)
            or isinstance(step.get("duration_ms"), bool)
            or step["duration_ms"] < 0
            or not isinstance(step.get("name"), str)
            or not step["name"]
            or len(step["name"]) > MAX_STRING
            or not isinstance(step.get("note"), str)
            or len(step["note"]) > MAX_STRING
            or not isinstance(step.get("argv"), list)
        ):
            raise ReceiptError(
                "historical local CI report contains non-passing or malformed step data"
            )
        argv = step["argv"]
        if (
            not argv
            or len(argv) > MAX_ARGV
            or any(not isinstance(item, str) or len(item) > MAX_STRING for item in argv)
        ):
            raise ReceiptError(
                "historical local CI report contains an oversized command reference"
            )
        commands.append(
            {
                "name": step["name"],
                "argv": [_portable_arg(recorded_root, item) for item in argv],
                "cwd": REPO_ROOT_TOKEN,
                "exit_code": step["exit_code"],
                "duration_ms": step["duration_ms"],
                "status": step["status"],
                "note": step["note"],
            }
        )
    return commands


def _portable_arg(recorded_root: str, arg: str) -> str:
    if arg == recorded_root or arg.startswith(recorded_root + "/"):
        return REPO_ROOT_TOKEN + arg[len(recorded_root) :]
    if arg == "/bin/bash":
        return BASH_TOKEN
    if PurePosixPath(arg).is_absolute() or PureWindowsPath(arg).is_absolute():
        raise ReceiptError(
            "historical local CI report contains an unportable absolute command path"
        )
    return arg


def _portable_host(host: Mapping[str, Any]) -> dict[str, Any]:
    if set(host) != {"os", "python", "node", "nodeBinary"}:
        raise ReceiptError("historical local CI report host contains unknown fields")
    if any(
        not isinstance(host.get(key), str)
        or not host[key]
        or len(host[key]) > MAX_STRING
        for key in host
    ):
        raise ReceiptError("historical local CI report host contains invalid values")
    if not PurePosixPath(host["nodeBinary"]).is_absolute():
        raise ReceiptError(
            "historical local CI report node binary must be an absolute capture path"
        )
    return {
        "os": host["os"],
        "python": host["python"],
        "node": host["node"],
        "node_binary": NODE_BINARY_TOKEN,
    }


def _copy_commands(steps: Any) -> list[dict[str, Any]]:
    return [{**step, "argv": list(step["argv"])} for step in steps]


def _canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        + "\n"
    ).encode("utf-8")


def _validate_baseline_evidence(evidence: Mapping[str, Any]) -> None:
    fields = {
        "schema_version",
        "source_schema",
        "mode",
        "status",
        "captured_at",
        "duration_ms",
        "host",
        "repository",
        "steps",
    }
    if set(evidence) != fields:
        raise ReceiptError("baseline evidence contains unknown fields")
    if (
        evidence.get("schema_version") != EVIDENCE_VERSION
        or evidence.get("source_schema") != SOURCE_REPORT_VERSION
    ):
        raise ReceiptError(
            "baseline evidence schema differs from the canonical capture"
        )
    if evidence.get("mode") != "quick" or evidence.get("status") != "pass":
        raise ReceiptError(
            "baseline evidence mode or status differs from the canonical capture"
        )
    if evidence.get("captured_at") != BASELINE_CAPTURED_AT:
        raise ReceiptError(
            "baseline evidence captured_at differs from the canonical capture"
        )
    _validate_timestamp(evidence["captured_at"], "baseline evidence captured_at")
    duration = evidence.get("duration_ms")
    if duration != 2845 or isinstance(duration, bool):
        raise ReceiptError(
            "baseline evidence duration differs from the canonical capture"
        )
    host = evidence.get("host")
    if not isinstance(host, Mapping) or set(host) != {
        "os",
        "python",
        "node",
        "node_binary",
    }:
        raise ReceiptError("baseline evidence host contains unknown fields")
    if dict(host) != EXPECTED_HOST:
        raise ReceiptError("baseline evidence host differs from the canonical capture")
    repository = evidence.get("repository")
    if not isinstance(repository, Mapping) or set(repository) != {
        "head",
        "tree_sha",
        "worktree_status",
    }:
        raise ReceiptError("baseline evidence repository contains unknown fields")
    if dict(repository) != {
        "head": BASELINE_HEAD,
        "tree_sha": BASELINE_TREE,
        "worktree_status": "clean",
    }:
        raise ReceiptError(
            "baseline evidence repository differs from the canonical capture"
        )
    steps = evidence.get("steps")
    if not isinstance(steps, list) or not steps or len(steps) > MAX_COMMANDS:
        raise ReceiptError("baseline evidence steps must be a bounded list")
    step_fields = {"name", "argv", "cwd", "exit_code", "duration_ms", "status", "note"}
    for step in steps:
        if not isinstance(step, Mapping) or set(step) != step_fields:
            raise ReceiptError("baseline evidence step contains unknown fields")
    if tuple(steps) != EXPECTED_COMMANDS:
        raise ReceiptError(
            "baseline evidence command manifest/status/exit/duration differs from the canonical capture"
        )


def _validate_timestamp(value: Any, label: str) -> None:
    try:
        if (
            not isinstance(value, str)
            or datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None
        ):
            raise ValueError
    except ValueError as exc:
        raise ReceiptError(
            f"{label} must be an ISO-8601 timestamp with timezone"
        ) from exc


def _load_evidence(root: Path) -> tuple[Mapping[str, Any], str]:
    path = root / EVIDENCE_PATH
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ReceiptError("tracked baseline evidence is unavailable") from exc
    if not raw or len(raw) > MAX_EVIDENCE_BYTES:
        raise ReceiptError("tracked baseline evidence size is invalid")
    try:
        evidence = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReceiptError("tracked baseline evidence is not valid JSON") from exc
    if not isinstance(evidence, Mapping):
        raise ReceiptError("tracked baseline evidence must be an object")
    if raw != _canonical_json_bytes(evidence):
        raise ReceiptError("tracked baseline evidence bytes are not canonical JSON")
    _validate_baseline_evidence(evidence)
    return evidence, hashlib.sha256(raw).hexdigest()


def validate_baseline_receipt(
    receipt: Mapping[str, Any], root: str | Path | None = None
) -> None:
    """Validate tracked historic evidence without querying Git or capture runtime state."""
    fields = {
        "schema_version",
        "baseline_head",
        "baseline_tree",
        "captured_at",
        "engineering_quick_suite",
        "environment",
        "measurement_gaps",
    }
    if not isinstance(receipt, Mapping) or set(receipt) != fields:
        raise ReceiptError("receipt contains unknown fields")
    if (
        receipt.get("schema_version") != RECEIPT_VERSION
        or receipt.get("baseline_head") != BASELINE_HEAD
    ):
        raise ReceiptError("receipt baseline_head or schema does not bind PF0 baseline")
    baseline_tree = receipt.get("baseline_tree")
    if not isinstance(baseline_tree, Mapping) or set(baseline_tree) != {
        "tree_sha",
        "worktree_status",
    }:
        raise ReceiptError("receipt baseline tree contains unknown fields")
    if dict(baseline_tree) != {"tree_sha": BASELINE_TREE, "worktree_status": "clean"}:
        raise ReceiptError(
            "receipt baseline tree or clean worktree binding differs from expected"
        )
    if receipt.get("captured_at") != BASELINE_CAPTURED_AT:
        raise ReceiptError(
            "receipt captured_at differs from canonical baseline evidence"
        )
    _validate_timestamp(receipt["captured_at"], "receipt captured_at")
    suite = receipt.get("engineering_quick_suite")
    suite_fields = {"status", "evidence_path", "evidence_sha256", "commands"}
    if (
        not isinstance(suite, Mapping)
        or set(suite) != suite_fields
        or suite.get("status") != "pass"
    ):
        raise ReceiptError("receipt must record canonical engineering quick suite pass")
    if suite.get("evidence_path") != EVIDENCE_PATH:
        raise ReceiptError(
            "receipt evidence path differs from the tracked canonical path"
        )
    digest = suite.get("evidence_sha256")
    if (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in "0123456789abcdef" for character in digest)
    ):
        raise ReceiptError("receipt evidence digest must be lowercase SHA-256")
    commands = suite.get("commands")
    if not isinstance(commands, list) or tuple(commands) != EXPECTED_COMMANDS:
        raise ReceiptError(
            "receipt command manifest/status/exit codes differ from canonical baseline"
        )
    env = receipt.get("environment")
    if not isinstance(env, Mapping) or set(env) != {"host", "capabilities"}:
        raise ReceiptError("receipt environment contains unknown fields")
    host = env.get("host")
    capabilities = env.get("capabilities")
    if (
        not isinstance(host, Mapping)
        or set(host) != {"os", "python", "node", "node_binary"}
        or dict(host) != EXPECTED_HOST
    ):
        raise ReceiptError("receipt host differs from canonical baseline evidence")
    if (
        not isinstance(capabilities, Mapping)
        or dict(capabilities) != EXPECTED_CAPABILITIES
    ):
        raise ReceiptError(
            "receipt capability data differs from canonical baseline evidence"
        )
    gaps = receipt.get("measurement_gaps")
    if (
        not isinstance(gaps, Mapping)
        or dict(gaps) != EXPECTED_GAPS
        or any(value not in UNMEASURED for value in gaps.values())
    ):
        raise ReceiptError(
            "receipt must mark all unmeasured PF0 baselines unavailable or not_measured"
        )

    evidence_root = (
        Path(root).resolve()
        if root is not None
        else Path(__file__).resolve().parents[2]
    )
    evidence, actual_digest = _load_evidence(evidence_root)
    if digest != actual_digest:
        raise ReceiptError(
            "receipt evidence digest does not match tracked canonical file bytes"
        )
    if receipt["captured_at"] != evidence["captured_at"]:
        raise ReceiptError("receipt captured_at does not match tracked evidence")
    if dict(host) != dict(evidence["host"]):
        raise ReceiptError("receipt host does not match tracked evidence")
    if receipt["baseline_head"] != evidence["repository"]["head"] or dict(
        baseline_tree
    ) != {
        "tree_sha": evidence["repository"]["tree_sha"],
        "worktree_status": evidence["repository"]["worktree_status"],
    }:
        raise ReceiptError("receipt repository binding does not match tracked evidence")
    if commands != evidence["steps"] or suite["status"] != evidence["status"]:
        raise ReceiptError(
            "receipt command manifest/status/exit codes do not match tracked evidence"
        )
