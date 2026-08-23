#!/usr/bin/env python3
"""Project/session-scoped continuity checkpoints for compaction and handoff.

Checkpoints are context-only. They never authorize tools, resume execution, or
claim completion; every resume must re-ground against the current workspace
tree and rule-ledger head.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

LITE_DIR = Path(__file__).resolve().parents[1] / "lite"
sys.path.insert(0, str(LITE_DIR))

from evidence_common import worktree_fingerprint  # noqa: E402


SCHEMA = "forgewright-continuity/v1"
MAX_CHECKPOINT_BYTES = 64 * 1024
DEFAULT_TTL_SECONDS = 24 * 60 * 60
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
FORBIDDEN_FIELDS = {
    "authorization",
    "chain_of_thought",
    "completion_state",
    "private_reasoning",
    "reasoning",
    "scratchpad",
    "tool_authorization",
}
SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[A-Z0-9]{16}"),
    re.compile(
        r"-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----"
    ),
)
PAYLOAD_FIELDS = (
    "objective",
    "acceptance_ids",
    "non_goals",
    "plan",
    "verified_facts",
    "assumptions",
    "limitations",
    "change_refs",
    "command_refs",
    "evidence_refs",
    "blockers",
    "next_action",
    "owned_process_leases",
)


class ContinuityError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _workspace() -> Path:
    configured = os.environ.get("FORGEWRIGHT_WORKSPACE", "").strip()
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if candidate.is_dir():
            return candidate
        raise ContinuityError("invalid_workspace")
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    if result.returncode == 0 and result.stdout.strip():
        return Path(result.stdout.strip()).resolve()
    return Path.cwd().resolve()


def _repo_identity(workspace: Path) -> dict[str, str]:
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    remote = result.stdout.strip() if result.returncode == 0 else ""
    return {
        "workspace_path_sha256": _sha256(str(workspace).encode("utf-8")),
        "origin_sha256": _sha256(remote.encode("utf-8")),
    }


def _workspace_id(workspace: Path) -> str:
    return _sha256(_canonical_bytes(_repo_identity(workspace)))


def _state_root(workspace: Path) -> Path:
    configured = os.environ.get("FORGEWRIGHT_CONTINUITY_ROOT", "").strip()
    base = (
        Path(configured).expanduser().resolve()
        if configured
        else workspace / ".forgewright" / "runtime" / "continuity"
    )
    return base / _workspace_id(workspace)


def _ledger_state(workspace: Path) -> dict[str, Any]:
    ledger = workspace / ".forgewright" / "rule-ledger.jsonl"
    try:
        content = ledger.read_bytes()
    except OSError:
        content = b""
    return {"offset": len(content), "head_hash": _sha256(content)}


def _find_forbidden(value: Any, path: str = "") -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in FORBIDDEN_FIELDS:
                return f"forbidden_field:{path + '.' if path else ''}{key}"
            found = _find_forbidden(item, f"{path}.{key}" if path else str(key))
            if found:
                return found
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found = _find_forbidden(item, f"{path}[{index}]")
            if found:
                return found
    return None


def _redact(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        count = 0
        redacted = value
        for pattern in SECRET_PATTERNS:
            redacted, replacements = pattern.subn("[REDACTED]", redacted)
            count += replacements
        return redacted, count
    if isinstance(value, list):
        output = []
        count = 0
        for item in value:
            cleaned, replacements = _redact(item)
            output.append(cleaned)
            count += replacements
        return output, count
    if isinstance(value, dict):
        output = {}
        count = 0
        for key, item in value.items():
            cleaned, replacements = _redact(item)
            output[key] = cleaned
            count += replacements
        return output, count
    return value, 0


def _validate_id(label: str, value: str) -> str:
    if not SAFE_ID.fullmatch(value):
        raise ContinuityError(f"invalid_{label}")
    return value


def _validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ContinuityError("payload_must_be_object")
    forbidden = _find_forbidden(payload)
    if forbidden:
        raise ContinuityError(forbidden)
    missing = [field for field in PAYLOAD_FIELDS if field not in payload]
    if missing:
        raise ContinuityError(f"missing_fields:{','.join(missing)}")
    if (
        not isinstance(payload.get("objective"), str)
        or not payload["objective"].strip()
    ):
        raise ContinuityError("invalid_objective")
    if not isinstance(payload.get("next_action"), str):
        raise ContinuityError("invalid_next_action")
    verified_facts = payload.get("verified_facts")
    if not isinstance(verified_facts, list):
        raise ContinuityError("invalid_verified_facts")
    for fact in verified_facts:
        if not isinstance(fact, dict) or any(
            not isinstance(fact.get(field), str) or not fact.get(field)
            for field in ("claim", "source", "digest", "observed_at")
        ):
            raise ContinuityError("invalid_verified_fact_binding")
        if not re.fullmatch(r"[0-9a-f]{64}", fact["digest"]):
            raise ContinuityError("invalid_verified_fact_digest")
    cleaned, replacements = _redact({field: payload[field] for field in PAYLOAD_FIELDS})
    cleaned["redaction_count"] = replacements
    return cleaned


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    return value if isinstance(value, dict) else None


def _valid_checkpoint(value: dict[str, Any]) -> bool:
    stored_hash = value.get("checkpoint_hash")
    if not isinstance(stored_hash, str):
        return False
    unsigned = dict(value)
    unsigned.pop("checkpoint_hash", None)
    return (
        value.get("schema") == SCHEMA
        and _sha256(_canonical_bytes(unsigned)) == stored_hash
    )


def _checkpoint_files(session_dir: Path) -> list[Path]:
    return sorted(session_dir.glob("checkpoint-*.json"))


def _quarantine(path: Path) -> None:
    quarantine = path.parent / "quarantine"
    quarantine.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(quarantine, 0o700)
    destination = quarantine / f"{path.name}.corrupt-{int(_now().timestamp())}"
    try:
        os.replace(path, destination)
    except OSError:
        pass


def _validated_chain(
    session_dir: Path,
    session: str,
    *,
    quarantine_corrupt: bool = False,
) -> dict[str, Any] | None:
    files = _checkpoint_files(session_dir)
    head_path = session_dir / "head.json"
    if not files:
        if head_path.exists() or head_path.is_symlink():
            raise ContinuityError("checkpoint_head_mismatch")
        return None

    head = None if head_path.is_symlink() else _load_json(head_path)
    if head is None:
        raise ContinuityError("checkpoint_head_mismatch")

    previous_hash = ""
    latest: dict[str, Any] | None = None
    for expected_sequence, path in enumerate(files, start=1):
        value = None if path.is_symlink() else _load_json(path)
        if value is None or not _valid_checkpoint(value):
            if quarantine_corrupt and not path.is_symlink():
                _quarantine(path)
            raise ContinuityError("corrupt_checkpoint")
        ledger = value.get("ledger") if isinstance(value.get("ledger"), dict) else {}
        if (
            value.get("session_id") != session
            or value.get("sequence") != expected_sequence
            or path.name != f"checkpoint-{expected_sequence:08d}.json"
            or ledger.get("previous_checkpoint_hash") != previous_hash
        ):
            raise ContinuityError("checkpoint_chain_broken")
        previous_hash = str(value["checkpoint_hash"])
        latest = value

    assert latest is not None
    if (
        head.get("schema") != SCHEMA
        or head.get("sequence") != latest.get("sequence")
        or head.get("checkpoint_hash") != latest.get("checkpoint_hash")
        or head.get("file") != files[-1].name
    ):
        raise ContinuityError("checkpoint_head_mismatch")
    return latest


def write_checkpoint(
    workspace: Path,
    session: str,
    turn: str,
    reason: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    session = _validate_id("session", session)
    turn = _validate_id("turn", turn)
    reason = _validate_id("reason", reason)
    cleaned = _validate_payload(payload)
    root = _state_root(workspace)
    session_dir = root / session
    session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    os.chmod(session_dir, 0o700)
    lock_path = session_dir / ".writer.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        previous = _validated_chain(session_dir, session)
        sequence = int(previous.get("sequence", 0)) + 1 if previous else 1
        now = _now()
        ledger = _ledger_state(workspace)
        ledger["previous_checkpoint_hash"] = (
            previous.get("checkpoint_hash") if previous else ""
        )
        record: dict[str, Any] = {
            "schema": SCHEMA,
            "authority": "context-only",
            "workspace_id": _workspace_id(workspace),
            "repo_identity": _repo_identity(workspace),
            "session_id": session,
            "turn_id": turn,
            "sequence": sequence,
            "reason": reason,
            "created_at": _iso(now),
            "expires_at": _iso(now + timedelta(seconds=DEFAULT_TTL_SECONDS)),
            "tree_sha": worktree_fingerprint(workspace),
            "ledger": ledger,
            **{field: cleaned[field] for field in PAYLOAD_FIELDS},
            "writer": {
                "name": "scripts/memory/continuity.py",
                "version": SCHEMA,
                "redaction_receipt": {"replacements": cleaned["redaction_count"]},
            },
            "threat_model": {
                "protects": [
                    "accidental corruption",
                    "stale or cross-project replay",
                    "wrong-model memory injection",
                ],
                "does_not_protect": ["malicious tampering by the same OS user"],
            },
        }
        record["checkpoint_hash"] = _sha256(_canonical_bytes(record))
        encoded = _canonical_bytes(record) + b"\n"
        if len(encoded) > MAX_CHECKPOINT_BYTES:
            raise ContinuityError("checkpoint_size_limit_exceeded")
        path = session_dir / f"checkpoint-{sequence:08d}.json"
        _atomic_write(path, encoded)
        head = {
            "schema": SCHEMA,
            "sequence": sequence,
            "checkpoint_hash": record["checkpoint_hash"],
            "file": path.name,
        }
        _atomic_write(session_dir / "head.json", _canonical_bytes(head) + b"\n")
        output = dict(record)
        output["storage_path"] = str(path)
        return output


def resume_checkpoint(workspace: Path, session: str) -> dict[str, Any]:
    session = _validate_id("session", session)
    session_dir = _state_root(workspace) / session
    if not session_dir.is_dir():
        return {"status": "fresh-start", "reasons": ["checkpoint_missing"]}
    try:
        checkpoint = _validated_chain(session_dir, session, quarantine_corrupt=True)
    except ContinuityError as error:
        return {"status": "fresh-start", "reasons": [str(error)]}
    if checkpoint is None:
        return {"status": "fresh-start", "reasons": ["checkpoint_missing"]}
    reasons = []
    if checkpoint.get("workspace_id") != _workspace_id(workspace):
        reasons.append("workspace_mismatch")
    if checkpoint.get("session_id") != session:
        reasons.append("session_mismatch")
    try:
        expires_at = datetime.fromisoformat(
            str(checkpoint.get("expires_at", "")).replace("Z", "+00:00")
        )
        if expires_at < _now():
            reasons.append("checkpoint_expired")
    except ValueError:
        reasons.append("invalid_expiry")
    if checkpoint.get("tree_sha") != worktree_fingerprint(workspace):
        reasons.append("tree_mismatch")
    current_ledger = _ledger_state(workspace)
    checkpoint_ledger = (
        checkpoint.get("ledger") if isinstance(checkpoint.get("ledger"), dict) else {}
    )
    if (
        checkpoint_ledger.get("offset") != current_ledger["offset"]
        or checkpoint_ledger.get("head_hash") != current_ledger["head_hash"]
    ):
        reasons.append("ledger_mismatch")
    if reasons:
        return {"status": "fresh-start", "reasons": reasons}
    return {
        "status": "resumable-context",
        "authority": "context-only",
        "requires_workspace_regrounding": True,
        "checkpoint": checkpoint,
    }


def _read_stdin_payload() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_CHECKPOINT_BYTES + 1)
    if len(raw) > MAX_CHECKPOINT_BYTES:
        raise ContinuityError("payload_size_limit_exceeded")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ContinuityError("invalid_payload_json") from error
    if not isinstance(value, dict):
        raise ContinuityError("payload_must_be_object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    checkpoint = subparsers.add_parser("checkpoint")
    checkpoint.add_argument("--session", required=True)
    checkpoint.add_argument("--turn", required=True)
    checkpoint.add_argument("--reason", required=True)
    resume = subparsers.add_parser("resume")
    resume.add_argument("--session", required=True)
    args = parser.parse_args()
    try:
        workspace = _workspace()
        if args.command == "checkpoint":
            output = write_checkpoint(
                workspace,
                args.session,
                args.turn,
                args.reason,
                _read_stdin_payload(),
            )
        else:
            output = resume_checkpoint(workspace, args.session)
    except ContinuityError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
