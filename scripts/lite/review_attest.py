#!/usr/bin/env python3
"""Create a signed Forgewright review-2 record with an existing SSH key."""

from __future__ import annotations

import argparse
import base64
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
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024
MAX_REVIEW_BYTES = 256 * 1024
MAX_SIGNATURE_BYTES = 64 * 1024
MAX_KEY_BYTES = 128 * 1024
MAX_ALLOWED_SIGNERS_BYTES = 64 * 1024
_ED25519_KEY_TYPES = {
    "ssh-ed25519",
    "ssh-ed25519-cert-v01@openssh.com",
    "sk-ssh-ed25519@openssh.com",
    "sk-ssh-ed25519-cert-v01@openssh.com",
}


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


def _secure_external_file(
    raw_path: str,
    workspace: Path,
    *,
    label: str,
    max_bytes: int,
    forbidden_mode_bits: int,
) -> tuple[Path, bytes]:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError(f"{label} is required")
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        raise ValueError(f"{label} must be an absolute path")
    try:
        info = candidate.lstat()
    except OSError as error:
        raise ValueError(f"{label} cannot be read") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValueError(f"{label} must be a regular non-symlink file")
    resolved = candidate.resolve(strict=True)
    if _within(resolved, workspace.resolve()):
        raise ValueError(f"{label} must resolve outside the workspace")
    if forbidden_mode_bits and stat.S_IMODE(info.st_mode) & forbidden_mode_bits:
        raise ValueError(f"{label} has unsafe permissions")
    uid = getattr(os, "getuid", None)
    if uid is not None and info.st_uid != uid():
        raise ValueError(f"{label} is not owned by the current user")
    if info.st_size > max_bytes:
        raise ValueError(f"{label} exceeds the bounded size limit")
    try:
        payload = resolved.read_bytes()
    except OSError as error:
        raise ValueError(f"{label} cannot be read") from error
    if len(payload) > max_bytes:
        raise ValueError(f"{label} exceeds the bounded size limit")
    return resolved, payload


def _validate_allowed_signers(payload: bytes) -> None:
    if not payload or len(payload) > MAX_ALLOWED_SIGNERS_BYTES:
        raise ValueError("allowed_signers file is missing or exceeds the size limit")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("allowed_signers file is not valid UTF-8") from error
    if "\x00" in text:
        raise ValueError("allowed_signers file contains NUL bytes")
    valid_key_line = False
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if len(line) > 16 * 1024:
            raise ValueError("allowed_signers line exceeds the size limit")
        fields = stripped.split()
        if len(fields) < 2:
            continue
        for index, key_type in enumerate(fields[1:], start=1):
            if key_type not in _ED25519_KEY_TYPES:
                continue
            if index + 1 >= len(fields):
                continue
            try:
                base64.b64decode(fields[index + 1], validate=True)
            except (ValueError, TypeError):
                continue
            valid_key_line = True
            break
    if not valid_key_line:
        raise ValueError("allowed_signers file has no valid Ed25519 signer entry")


def _allowed_signers(workspace: Path) -> tuple[Path, bytes]:
    configured = os.environ.get("FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS")
    raw_path = (
        configured
        if configured is not None
        else "~/.forgewright/reviewers.allowed_signers"
    )
    path, payload = _secure_external_file(
        raw_path,
        workspace,
        label="allowed_signers file",
        max_bytes=MAX_ALLOWED_SIGNERS_BYTES,
        forbidden_mode_bits=0o022,
    )
    _validate_allowed_signers(payload)
    return path, payload


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


def _sign(review: dict[str, Any], private_key: Path) -> bytes:
    payload = _canonical_json(review)
    with tempfile.TemporaryDirectory(prefix="forgewright-review-") as directory:
        payload_path = Path(directory) / "payload"
        payload_path.write_bytes(payload)
        result = subprocess.run(
            [
                "ssh-keygen",
                "-Y",
                "sign",
                "-f",
                str(private_key),
                "-n",
                REVIEW_NAMESPACE,
                str(payload_path),
            ],
            capture_output=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError("ssh-keygen could not sign the review payload")
        signature_path = Path(f"{payload_path}.sig")
        try:
            signature = signature_path.read_bytes()
        except OSError as error:
            raise ValueError("ssh-keygen did not produce a signature") from error
    if len(signature) > MAX_SIGNATURE_BYTES or b"\x00" in signature:
        raise ValueError("SSH signature exceeds the bounded size limit")
    if not signature.startswith(
        b"-----BEGIN SSH SIGNATURE-----"
    ) or not signature.rstrip().endswith(b"-----END SSH SIGNATURE-----"):
        raise ValueError("ssh-keygen did not produce an armored SSH signature")
    return signature


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    sign = subparsers.add_parser("sign", help="sign a final evidence review")
    sign.add_argument("--evidence", required=True, help="final evidence JSON")
    sign.add_argument(
        "--private-key",
        "--key",
        dest="private_key",
        default=os.environ.get("FORGEWRIGHT_REVIEW_PRIVATE_KEY"),
    )
    sign.add_argument("--output", "--out", dest="output", default=None)
    sign.add_argument("--finding", action="append", default=[])
    sign.add_argument("--limitation", action="append", default=[])
    return parser


def _run_sign(args: argparse.Namespace) -> int:
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
    private_key, _ = _secure_external_file(
        args.private_key or "",
        workspace,
        label="private key",
        max_bytes=MAX_KEY_BYTES,
        forbidden_mode_bits=0o077,
    )
    try:
        key_probe = subprocess.run(
            ["ssh-keygen", "-y", "-f", str(private_key)],
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("private key could not be inspected") from error
    key_type = key_probe.stdout.split(b" ", 1)[0].decode("ascii", "ignore")
    if key_probe.returncode != 0 or key_type not in _ED25519_KEY_TYPES:
        raise ValueError("private key must be an OpenSSH Ed25519 key")
    allowed_path, _ = _allowed_signers(workspace)
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
        "limitations": list(args.limitation),
        "timestamp_utc": datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z"),
    }
    signature = _sign(review, private_key)
    review["signature"] = signature.decode("utf-8")
    serialized = _canonical_json(review)
    if len(serialized) > MAX_REVIEW_BYTES:
        raise ValueError("review record exceeds the bounded size limit")
    _atomic_write(output, serialized + b"\n")
    _ = allowed_path  # Trust-root validation is deliberately completed before writing.
    print(
        json.dumps(
            {
                "status": "signed",
                "review_path": str(output),
                "reviewer_id": reviewer["id"],
            }
        )
    )
    return 0


def main() -> int:
    try:
        args = _parser().parse_args()
        if args.command == "sign":
            return _run_sign(args)
        raise ValueError("unsupported command")
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        print(f"[REVIEW-ATTEST] ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
