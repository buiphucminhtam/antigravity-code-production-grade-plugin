#!/usr/bin/env python3
"""Create a keyless Forgewright review-2 record bound to final evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_common import (  # noqa: E402
    nontrivial_reviewer_id,
    phase_errors,
    read_evidence_bytes,
    resolve_evidence_link,
    schema_errors,
)


REVIEW_SCHEMA = "review-2"
REVIEW_NAMESPACE = "forgewright-review-v2"
KEYLESS_TRUST_LIMITATION = (
    "Keyless review binds exact evidence but does not authenticate reviewer identity "
    "against same-user forgery."
)
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024
MAX_REVIEW_BYTES = 256 * 1024


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _within(path: Path, directory: Path) -> bool:
    try:
        return path == directory or directory in path.parents
    except (OSError, ValueError):
        return False


def _verify_dir(workspace: Path) -> Path:
    verify_dir = (workspace / ".forgewright" / "verify").resolve()
    if not verify_dir.is_dir():
        raise ValueError(".forgewright/verify must be an existing directory")
    for directory in (workspace / ".forgewright", verify_dir):
        info = directory.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(".forgewright/verify must not use symlinked directories")
    return verify_dir


def _evidence_path(raw_path: str, workspace: Path, verify_dir: Path) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("--evidence is required")
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    candidate = candidate.parent.resolve(strict=True) / candidate.name
    if not _within(candidate, verify_dir):
        raise ValueError("evidence must be inside .forgewright/verify")
    read_evidence_bytes(workspace, candidate, max_bytes=MAX_EVIDENCE_BYTES)
    return candidate


def _output_path(
    raw_path: str | None, evidence: dict[str, Any], workspace: Path, verify_dir: Path
) -> Path:
    evidence_ref = evidence.get("reviewer", {}).get("evidence_ref")
    if not isinstance(evidence_ref, str) or not evidence_ref.strip():
        raise ValueError("final evidence reviewer.evidence_ref is required")
    _, ref_error = resolve_evidence_link(workspace, evidence_ref)
    if ref_error and not ref_error.startswith("MISSING:"):
        raise ValueError(f"reviewer.evidence_ref is invalid: {ref_error}")
    ref_candidate = (verify_dir / Path(evidence_ref)).resolve()
    if not _within(ref_candidate, verify_dir) or ref_candidate == verify_dir:
        raise ValueError("reviewer.evidence_ref must stay inside .forgewright/verify")
    if raw_path is None:
        output = ref_candidate
    else:
        supplied = Path(raw_path).expanduser()
        output = (
            supplied if supplied.is_absolute() else Path.cwd() / supplied
        ).resolve()
        if output != ref_candidate:
            raise ValueError(
                "--output must exactly match final evidence reviewer.evidence_ref"
            )
    if not _within(output, verify_dir) or output == verify_dir:
        raise ValueError("review output must be inside .forgewright/verify")
    if output.exists() and output.is_symlink():
        raise ValueError("review output must not replace a symlink")
    if not output.parent.is_dir():
        raise ValueError("review output parent must already exist")
    return output


def _validate_final_evidence(evidence: dict[str, Any], workspace: Path) -> None:
    errors = schema_errors(evidence) + phase_errors(evidence, final=True)
    reviewer = evidence.get("reviewer")
    if not isinstance(reviewer, dict):
        errors.append("final evidence reviewer must be an object")
    else:
        reviewer_id = reviewer.get("id")
        if not nontrivial_reviewer_id(reviewer_id):
            errors.append("final evidence reviewer.id must be nontrivial")
        if reviewer.get("status") != "independent-approved":
            errors.append("final evidence reviewer.status must be independent-approved")
        if reviewer_id == evidence.get("implementer_id"):
            errors.append("final evidence reviewer must differ from implementer")
        if not isinstance(reviewer.get("evidence_ref"), str):
            errors.append("final evidence reviewer.evidence_ref is required")
    if evidence.get("workspace") != str(workspace.resolve()):
        errors.append("final evidence workspace does not match current workspace")
    if errors:
        raise ValueError(
            "final evidence is not a valid completion record: " + "; ".join(errors[:8])
        )


def _atomic_write(path: Path, payload: bytes) -> None:
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create", help="create a final evidence review")
    create.add_argument("--evidence", required=True, help="final evidence JSON")
    create.add_argument("--output", "--out", dest="output", default=None)
    create.add_argument("--finding", action="append", default=[])
    create.add_argument("--limitation", action="append", default=[])
    return parser


def _run_create(args: argparse.Namespace) -> int:
    workspace = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True, timeout=5
        ).strip()
    ).resolve()
    verify_dir = _verify_dir(workspace)
    evidence_path = _evidence_path(args.evidence, workspace, verify_dir)
    evidence_bytes = read_evidence_bytes(
        workspace,
        evidence_path,
        max_bytes=MAX_EVIDENCE_BYTES,
    )
    try:
        evidence = json.loads(evidence_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"final evidence is not valid JSON: {error}") from error
    if not isinstance(evidence, dict):
        raise ValueError("final evidence must be a JSON object")
    _canonical_json(evidence)
    _validate_final_evidence(evidence, workspace)
    output = _output_path(args.output, evidence, workspace, verify_dir)
    reviewer = evidence["reviewer"]
    evidence_digest = hashlib.sha256(_canonical_json(evidence)).hexdigest()
    review: dict[str, Any] = {
        "schema_version": REVIEW_SCHEMA,
        "namespace": REVIEW_NAMESPACE,
        "reviewer_id": reviewer["id"],
        "implementer_id": evidence["implementer_id"],
        "status": reviewer["status"],
        "turn": evidence["turn"],
        "workspace": str(workspace),
        "tree_sha": evidence["tree_sha"],
        "evidence_sha256": evidence_digest,
        "acceptance_ids": sorted(
            item["id"] for item in evidence["acceptance_criteria"]
        ),
        "negative_path_bindings": evidence["negative_path_bindings"],
        "findings": list(args.finding),
        "limitations": list(
            dict.fromkeys([KEYLESS_TRUST_LIMITATION, *args.limitation])
        ),
        "timestamp_utc": datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z"),
    }
    serialized = _canonical_json(review)
    if len(serialized) > MAX_REVIEW_BYTES:
        raise ValueError("review record exceeds the bounded size limit")
    _atomic_write(output, serialized + b"\n")
    print(
        json.dumps(
            {
                "status": "created",
                "review_path": str(output),
                "reviewer_id": reviewer["id"],
            }
        )
    )
    return 0


def main() -> int:
    try:
        args = _parser().parse_args()
        if args.command == "create":
            return _run_create(args)
        raise ValueError("unsupported command")
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        print(f"[REVIEW-ATTEST] ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
