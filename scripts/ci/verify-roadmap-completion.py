#!/usr/bin/env python3
"""Replay the exact local verifiers declared by the roadmap completion manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "lite"))
from evidence_common import (  # noqa: E402
    _actual_record,
    _git_paths,
    _ignored_verify_path,
    _untracked_record,
    worktree_fingerprint,
)


DEFAULT_MANIFEST = ROOT / "docs" / "roadmap-completion.json"
MANIFEST_SCHEMA = "forgewright-roadmap-completion/v2"
REPORT_CONTRACT = {
    "schema": "forgewright-roadmap-verification/v1",
    "producer": "scripts/ci/verify-roadmap-completion.py",
}
AXES = {
    "implementation": {"done", "partial", "missing"},
    "integration": {"canonical", "partial", "isolated", "not-applicable"},
    "activation": {
        "local",
        "opt-in",
        "library-only",
        "canonical-mcp",
        "not-enabled",
    },
    "production_evidence": {"verified", "missing", "not-required"},
    "outcome": {"met", "met-locally", "partially-met", "not-measured", "not-met"},
}

# Verifier-owned, non-source outputs are mounted outside the replay worktree. The
# snapshot fingerprint still covers every other tracked, untracked, and ignored
# path, so a command cannot rewrite its own source/test inputs and manufacture a
# passing result. Keep this list narrow and evidence-oriented.
VERIFIER_VOLATILE_MOUNTS = {
    ".pytest_cache": "pytest collection/result cache",
    ".hypothesis": "Hypothesis example database",
    ".ruff_cache": "Ruff analysis cache",
    ".forgewright/audit": "runtime audit events emitted by MCP smoke tests",
    "mcp/.forgewright": "MCP verification and quality-gate event ledgers",
    "mcp/node_modules/.vite": "Vitest dependency and result cache",
    "src/cli/node_modules/.vite": "CLI Vitest dependency and result cache",
    "src/cli/dist": "CLI build output exercised by the onboarding verifier",
}


def _test_path(test_ref: str) -> str:
    return test_ref.split("::", 1)[0].split("#", 1)[0]


def _project_file(relative: str) -> Path | None:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        return None
    resolved = (ROOT / path).resolve()
    if not resolved.is_relative_to(ROOT) or not resolved.is_file():
        return None
    return resolved


def _command_binds_ref(command: list[str], test_ref: str) -> bool:
    command_text = " ".join(command)
    path = _test_path(test_ref)
    return path in command_text or path.removeprefix("mcp/") in command_text


def _test_ref_exists(test_ref: str) -> bool:
    path = _project_file(_test_path(test_ref))
    if path is None:
        return False
    content = path.read_text(encoding="utf-8")
    if "::" in test_ref:
        return f"def {test_ref.split('::', 1)[1]}(" in content
    if "#" in test_ref:
        return test_ref.split("#", 1)[1] in content
    return True


def _load_and_validate(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    manifest = json.loads(raw)
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"manifest schema must be {MANIFEST_SCHEMA}")
    deliverables = manifest.get("deliverables")
    if not isinstance(deliverables, list) or not deliverables:
        raise ValueError("manifest deliverables must be a non-empty list")

    seen_ids: set[str] = set()
    seen_acceptance: set[str] = set()
    for item in deliverables:
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id or item_id in seen_ids:
            raise ValueError(f"invalid or duplicate deliverable id: {item_id!r}")
        seen_ids.add(item_id)
        if "status" in item:
            raise ValueError(f"{item_id}: aggregate status is forbidden")
        for axis, allowed in AXES.items():
            if item.get(axis) not in allowed:
                raise ValueError(f"{item_id}: invalid {axis}")
        evidence = item.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"{item_id}: evidence must be non-empty")
        for relative in evidence:
            if not isinstance(relative, str) or _project_file(relative) is None:
                raise ValueError(f"{item_id}: missing evidence path: {relative}")
        if not isinstance(item.get("rollback"), str) or not item["rollback"].strip():
            raise ValueError(f"{item_id}: rollback must be non-empty")

        verification = item.get("verification")
        if not isinstance(verification, dict):
            raise ValueError(f"{item_id}: verification contract is required")
        command = verification.get("command")
        if (
            not isinstance(command, list)
            or not command
            or not all(isinstance(arg, str) and arg for arg in command)
        ):
            raise ValueError(f"{item_id}: command must be exact non-empty argv")
        timeout = verification.get("timeout_seconds")
        if not isinstance(timeout, int) or timeout <= 0:
            raise ValueError(f"{item_id}: timeout_seconds must be positive")
        if verification.get("evidence_report") != REPORT_CONTRACT:
            raise ValueError(f"{item_id}: evidence_report contract mismatch")
        acceptance_ids = verification.get("acceptance_ids")
        if not isinstance(acceptance_ids, list) or not acceptance_ids:
            raise ValueError(f"{item_id}: acceptance_ids must be non-empty")
        for acceptance_id in acceptance_ids:
            if (
                not isinstance(acceptance_id, str)
                or not acceptance_id
                or acceptance_id in seen_acceptance
            ):
                raise ValueError(
                    f"{item_id}: invalid or duplicate acceptance id: {acceptance_id!r}"
                )
            seen_acceptance.add(acceptance_id)
        test_refs = verification.get("test_refs")
        if not isinstance(test_refs, list) or not test_refs:
            raise ValueError(f"{item_id}: test_refs must be non-empty")
        for test_ref in test_refs:
            if (
                not isinstance(test_ref, str)
                or _project_file(_test_path(test_ref)) is None
                or not _test_ref_exists(test_ref)
                or not _command_binds_ref(command, test_ref)
            ):
                raise ValueError(f"{item_id}: unbound test ref: {test_ref!r}")
        negative_paths = verification.get("negative_paths")
        if not isinstance(negative_paths, list) or not negative_paths:
            raise ValueError(f"{item_id}: negative_paths must be non-empty")
        negative_ids: set[str] = set()
        for negative in negative_paths:
            if not isinstance(negative, dict):
                raise ValueError(f"{item_id}: invalid negative path")
            negative_id = negative.get("id")
            refs = negative.get("test_refs")
            if (
                not isinstance(negative_id, str)
                or not negative_id
                or negative_id in negative_ids
                or not isinstance(negative.get("claim"), str)
                or not negative["claim"].strip()
                or not isinstance(refs, list)
                or not refs
                or not set(refs).issubset(test_refs)
            ):
                raise ValueError(f"{item_id}: invalid negative path binding")
            negative_ids.add(negative_id)
    return manifest, raw


def _text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    return (
        value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value
    )


def _run_verifier(
    item: dict[str, Any], workspace: Path, environment: dict[str, str]
) -> dict[str, Any]:
    verification = item["verification"]
    command = verification["command"]
    started = time.monotonic()
    timed_out = False
    try:
        result = subprocess.run(
            command,
            cwd=workspace,
            env=environment,
            capture_output=True,
            text=True,
            timeout=verification["timeout_seconds"],
            check=False,
        )
        exit_code = result.returncode
        stdout = result.stdout
        stderr = result.stderr
    except subprocess.TimeoutExpired as error:
        timed_out = True
        exit_code = 124
        stdout = _text(error.stdout)
        stderr = _text(error.stderr)
    duration_ms = int((time.monotonic() - started) * 1000)
    entry = {
        "id": item["id"],
        "status": "pass" if exit_code == 0 and not timed_out else "fail",
        "command": command,
        "acceptance_ids": verification["acceptance_ids"],
        "test_refs": verification["test_refs"],
        "negative_paths": verification["negative_paths"],
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
        "stdout_sha256": hashlib.sha256(stdout.encode()).hexdigest(),
        "stderr_sha256": hashlib.sha256(stderr.encode()).hexdigest(),
    }
    if entry["status"] == "fail":
        entry["stdout_tail"] = stdout[-4000:]
        entry["stderr_tail"] = stderr[-4000:]
    return entry


def _clone_workspace(destination: Path) -> tuple[Path, str]:
    snapshot = destination / "workspace"
    clone_command: list[str] | None = None
    strategy = "python-copytree"
    if sys.platform == "darwin":
        clone_command = ["cp", "-cR", str(ROOT), str(snapshot)]
        strategy = "apfs-clone"
    elif os.name == "posix":
        clone_command = [
            "cp",
            "-a",
            "--reflink=auto",
            str(ROOT),
            str(snapshot),
        ]
        strategy = "posix-reflink-or-copy"
    if clone_command is not None:
        result = subprocess.run(
            clone_command,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode == 0:
            return snapshot, strategy
        shutil.rmtree(snapshot, ignore_errors=True)
    try:
        shutil.copytree(ROOT, snapshot, symlinks=True)
    except OSError as error:
        raise RuntimeError(f"isolated workspace copy failed: {error}") from error
    return snapshot, "python-copytree"


def _mount_verifier_volatiles(
    workspace: Path, volatile_root: Path
) -> list[dict[str, str]]:
    mounts: list[dict[str, str]] = []
    for relative, reason in VERIFIER_VOLATILE_MOUNTS.items():
        source = workspace / relative
        target = (
            volatile_root / "src-cli-vite-cache"
            if relative == "src/cli/node_modules/.vite"
            else volatile_root / relative
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        source.parent.mkdir(parents=True, exist_ok=True)
        if source.exists() or source.is_symlink():
            source.rename(target)
        else:
            target.mkdir(parents=True)
        source.symlink_to(target, target_is_directory=True)
        mounts.append({"path": relative, "reason": reason})
    # The CLI output is resolved from its real path in the volatile tree. Mirror
    # the package's dependency location beside it so ESM resolution stays
    # equivalent to src/cli/dist without changing NODE_OPTIONS or the command.
    for relative in (Path("src/cli/node_modules"), Path("node_modules")):
        (volatile_root / relative).symlink_to(workspace / relative)
    return mounts


def _write_report(report: dict[str, Any], path: Path | None) -> None:
    output = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if path is None:
        sys.stdout.write(output)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(output, encoding="utf-8")
    path.chmod(0o600)


def _covered_file_records(workspace: Path) -> dict[str, str]:
    """Return path-keyed records for exact tree-change diagnostics."""

    tracked = _git_paths(workspace, ["ls-files", "-z"])
    untracked = _git_paths(
        workspace, ["ls-files", "--others", "--exclude-standard", "-z"]
    )
    ignored = _git_paths(
        workspace,
        ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    )
    records: dict[str, str] = {}
    for relative in sorted(set(tracked)):
        if not _ignored_verify_path(relative):
            records[relative] = _actual_record(workspace, relative)
    for relative in sorted(set((*untracked, *ignored))):
        if _ignored_verify_path(relative):
            continue
        for record in _untracked_record(workspace, relative):
            parts = record.split("|", 3)
            key = parts[1] if len(parts) > 1 else relative
            records[key] = record
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--report", type=Path)
    parser.add_argument("--check-contract", action="store_true")
    args = parser.parse_args()

    try:
        report_path = args.report.resolve() if args.report else None
        if report_path and report_path.is_relative_to(ROOT):
            raise ValueError("--report must be outside the repository worktree")
        manifest, raw = _load_and_validate(args.manifest.resolve())
        if args.check_contract:
            _write_report(
                {
                    "schema": REPORT_CONTRACT["schema"],
                    "status": "pass",
                    "mode": "contract-only",
                    "deliverable_count": len(manifest["deliverables"]),
                    "manifest_sha256": hashlib.sha256(raw).hexdigest(),
                },
                report_path,
            )
            return 0

        selected_ids = set(args.only)
        known_ids = {item["id"] for item in manifest["deliverables"]}
        unknown = selected_ids - known_ids
        if unknown:
            raise ValueError(f"unknown deliverable ids: {sorted(unknown)}")
        selected = [
            item
            for item in manifest["deliverables"]
            if not selected_ids or item["id"] in selected_ids
        ]
        source_before = worktree_fingerprint(ROOT)
        with tempfile.TemporaryDirectory(
            prefix="forgewright-roadmap-replay-"
        ) as temporary:
            replay_root = Path(temporary)
            workspace, snapshot_strategy = _clone_workspace(replay_root)
            snapshot_source_tree = worktree_fingerprint(workspace)
            mounts = _mount_verifier_volatiles(workspace, replay_root / "volatile")
            execution_before = worktree_fingerprint(workspace)
            execution_records_before = _covered_file_records(workspace)
            environment = os.environ.copy()
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            environment["TMPDIR"] = str(replay_root / "tmp")
            Path(environment["TMPDIR"]).mkdir(parents=True, exist_ok=True)
            results = [_run_verifier(item, workspace, environment) for item in selected]
            execution_after = worktree_fingerprint(workspace)
            execution_records_after = _covered_file_records(workspace)
        source_after = worktree_fingerprint(ROOT)
        snapshot_matches_source = snapshot_source_tree == source_before
        execution_unchanged = execution_before == execution_after
        execution_changed_paths = sorted(
            path
            for path in set((*execution_records_before, *execution_records_after))
            if execution_records_before.get(path) != execution_records_after.get(path)
        )
        source_unchanged = source_before == source_after
        passed = (
            all(item["status"] == "pass" for item in results)
            and snapshot_matches_source
            and execution_unchanged
            and source_unchanged
        )
        report = {
            "schema": REPORT_CONTRACT["schema"],
            "status": "pass" if passed else "fail",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "tree_sha": source_before,
            "tree_unchanged": execution_unchanged and source_unchanged,
            "source_tree_unchanged": source_unchanged,
            "snapshot_matches_source": snapshot_matches_source,
            "snapshot_tree_sha": snapshot_source_tree,
            "execution_workspace": "isolated-snapshot",
            "snapshot_strategy": snapshot_strategy,
            "execution_tree_sha": execution_before,
            "execution_tree_unchanged": execution_unchanged,
            "execution_changed_paths": execution_changed_paths,
            "volatile_mounts": mounts,
            "deliverables": results,
        }
        _write_report(report, report_path)
        return 0 if passed else 1
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"roadmap verification contract error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
