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
import stat
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
CONTINUATION_SCHEMA = "forgewright-continuation-budget/v1"
CONTINUATION_RECEIPT_SCHEMA = "forgewright-continuation-receipt/v1"
TRAJECTORY_BINDING_SCHEMA = "forgewright-trajectory-binding/v1"
MAX_CHECKPOINT_BYTES = 64 * 1024
DEFAULT_TTL_SECONDS = 24 * 60 * 60
MAX_TTL_SECONDS = 24 * 60 * 60
SEMANTIC_BOUNDARIES = {
    "before-model",
    "before-effect",
    "step-boundary",
    "pre-compaction",
    "handoff",
}
NON_SEMANTIC_REASONS = {"timer", "idle", "message-count", "token-count"}
MAX_CONTINUATION_STEPS = 128
MAX_CONTINUATION_TOOL_CALLS = 256
MAX_CHECKPOINT_FILES = 10_000
MAX_RECEIPT_FILES = 10_000
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
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


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            info = current.lstat()
            if not hasattr(os, "getuid") or info.st_uid == os.getuid():
                return True
        if not current.exists():
            break
    return False


def _state_root(workspace: Path) -> Path:
    configured = os.environ.get("FORGEWRIGHT_CONTINUITY_ROOT", "").strip()
    if configured:
        raw_base = Path(configured).expanduser().absolute()
        if _has_symlink_component(raw_base):
            raise ContinuityError("continuity_root_symlink")
        base = raw_base.resolve(strict=False)
    else:
        base = workspace.resolve()
        for part in (".forgewright", "runtime", "continuity"):
            candidate = base / part
            if candidate.is_symlink():
                raise ContinuityError("continuity_root_symlink")
            base = candidate
    root = base / _workspace_id(workspace)
    if root.is_symlink():
        raise ContinuityError("continuity_root_symlink")
    return root.resolve(strict=False)


def _session_directory(workspace: Path, session: str, *, create: bool) -> Path:
    root = _state_root(workspace)
    if root.is_symlink():
        raise ContinuityError("continuity_root_symlink")
    if create:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
    session_dir = root / session
    if session_dir.is_symlink():
        raise ContinuityError("continuity_session_symlink")
    if create:
        session_dir.mkdir(mode=0o700, exist_ok=True)
        os.chmod(session_dir, 0o700)
    return session_dir


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


def _bounded_count(value: Any, maximum: int) -> bool:
    return (
        isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= maximum
    )


def _continuation(
    max_steps: int, max_tool_calls: int, deadline_at: str
) -> dict[str, Any]:
    if not (
        _bounded_count(max_steps, MAX_CONTINUATION_STEPS)
        and _bounded_count(max_tool_calls, MAX_CONTINUATION_TOOL_CALLS)
    ):
        raise ContinuityError("continuation_budget_invalid")
    value = {
        "schema": CONTINUATION_SCHEMA,
        "max_steps": max_steps,
        "max_tool_calls": max_tool_calls,
        "deadline_at": deadline_at,
        "nonce": _sha256(os.urandom(32)),
    }
    value["hash"] = _sha256(_canonical_bytes(value))
    return value


def _valid_continuation(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    required = {
        "schema",
        "max_steps",
        "max_tool_calls",
        "deadline_at",
        "nonce",
        "hash",
    }
    if set(value) != required:
        return False
    unsigned = dict(value)
    digest = unsigned.pop("hash")
    try:
        datetime.fromisoformat(str(value["deadline_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    return bool(
        value["schema"] == CONTINUATION_SCHEMA
        and _bounded_count(value["max_steps"], MAX_CONTINUATION_STEPS)
        and _bounded_count(value["max_tool_calls"], MAX_CONTINUATION_TOOL_CALLS)
        and isinstance(value["nonce"], str)
        and DIGEST.fullmatch(value["nonce"])
        and isinstance(digest, str)
        and DIGEST.fullmatch(digest)
        and digest == _sha256(_canonical_bytes(unsigned))
    )


def _validate_trajectory(value: Any) -> dict[str, Any]:
    required = {
        "schema",
        "trajectory_id",
        "writer_epoch",
        "ledger_offset",
        "ledger_head_hash",
        "capability_hash",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ContinuityError("invalid_trajectory_binding")
    if value.get("schema") != TRAJECTORY_BINDING_SCHEMA:
        raise ContinuityError("invalid_trajectory_binding")
    if not isinstance(value.get("trajectory_id"), str) or not SAFE_ID.fullmatch(
        value["trajectory_id"]
    ):
        raise ContinuityError("invalid_trajectory_binding")
    if not _bounded_count(value.get("writer_epoch"), 2**31 - 1):
        raise ContinuityError("invalid_trajectory_binding")
    if not _bounded_count(value.get("ledger_offset"), 2**53 - 1):
        raise ContinuityError("invalid_trajectory_binding")
    for field in ("ledger_head_hash", "capability_hash"):
        if not isinstance(value.get(field), str) or not DIGEST.fullmatch(value[field]):
            raise ContinuityError("invalid_trajectory_binding")
    return dict(value)


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


def _open_writer_lock(session_dir: Path):
    lock_path = session_dir / ".writer.lock"
    try:
        descriptor = os.open(
            lock_path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, "a+", encoding="utf-8")
    except OSError as error:
        raise ContinuityError("checkpoint_lock_unsafe") from error


def _load_json(path: Path) -> dict[str, Any] | None:
    descriptor: int | None = None
    try:
        info = path.lstat()
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_size > MAX_CHECKPOINT_BYTES
        ):
            return None
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            descriptor = None
            value = json.load(stream)
    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):
        return None
    finally:
        if descriptor is not None:
            os.close(descriptor)
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
    files = sorted(session_dir.glob("checkpoint-*.json"))
    if len(files) > MAX_CHECKPOINT_FILES:
        raise ContinuityError("checkpoint_file_count_exceeded")
    return files


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
    boundary: str = "step-boundary",
    max_steps: int = 0,
    max_tool_calls: int = 0,
    trajectory: dict[str, Any] | None = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> dict[str, Any]:
    session = _validate_id("session", session)
    turn = _validate_id("turn", turn)
    reason = _validate_id("reason", reason)
    if reason in NON_SEMANTIC_REASONS:
        raise ContinuityError("non_semantic_checkpoint_reason")
    if boundary not in SEMANTIC_BOUNDARIES:
        raise ContinuityError("invalid_semantic_boundary")
    if not _bounded_count(ttl_seconds, MAX_TTL_SECONDS) or ttl_seconds < 1:
        raise ContinuityError("checkpoint_ttl_invalid")
    trajectory_binding = (
        None if trajectory is None else _validate_trajectory(trajectory)
    )
    cleaned = _validate_payload(payload)
    session_dir = _session_directory(workspace, session, create=True)
    with _open_writer_lock(session_dir) as lock:
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
            "semantic_boundary": boundary,
            "created_at": _iso(now),
            "expires_at": _iso(now + timedelta(seconds=ttl_seconds)),
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
        record["continuation"] = _continuation(
            max_steps, max_tool_calls, record["expires_at"]
        )
        if trajectory_binding is not None:
            record["trajectory"] = trajectory_binding
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


def _receipt_hash(value: dict[str, Any]) -> str:
    unsigned = dict(value)
    unsigned.pop("hash", None)
    return _sha256(_canonical_bytes(unsigned))


def _validated_receipts(
    session_dir: Path, session: str, checkpoint_hash: str, nonce_hash: str
) -> tuple[list[dict[str, Any]], int, int]:
    receipt_dir = session_dir / "receipts" / checkpoint_hash
    if not receipt_dir.exists():
        return [], 0, 0
    if receipt_dir.is_symlink() or not receipt_dir.is_dir():
        raise ContinuityError("continuation_receipt_corrupt")
    files = sorted(receipt_dir.glob("receipt-*.json"))
    if len(files) > MAX_RECEIPT_FILES:
        raise ContinuityError("continuation_receipt_count_exceeded")
    head_path = receipt_dir / "head.json"
    if not files:
        if head_path.exists() or head_path.is_symlink():
            raise ContinuityError("continuation_receipt_head_mismatch")
        return [], 0, 0
    head = None if head_path.is_symlink() else _load_json(head_path)
    if head is None:
        raise ContinuityError("continuation_receipt_head_mismatch")
    previous_hash = ""
    total_steps = 0
    total_tools = 0
    receipts: list[dict[str, Any]] = []
    request_ids: set[str] = set()
    required = {
        "schema",
        "checkpoint_hash",
        "session_id",
        "sequence",
        "request_id",
        "nonce_hash",
        "steps",
        "tool_calls",
        "cumulative_steps",
        "cumulative_tool_calls",
        "previous_hash",
        "created_at",
        "hash",
    }
    for sequence, path in enumerate(files, start=1):
        value = None if path.is_symlink() else _load_json(path)
        if not isinstance(value, dict) or set(value) != required:
            raise ContinuityError("continuation_receipt_corrupt")
        if (
            value.get("schema") != CONTINUATION_RECEIPT_SCHEMA
            or value.get("checkpoint_hash") != checkpoint_hash
            or value.get("session_id") != session
            or value.get("sequence") != sequence
            or path.name != f"receipt-{sequence:08d}.json"
            or value.get("previous_hash") != previous_hash
            or value.get("hash") != _receipt_hash(value)
            or not isinstance(value.get("request_id"), str)
            or not SAFE_ID.fullmatch(value["request_id"])
            or value["request_id"] in request_ids
            or not isinstance(value.get("nonce_hash"), str)
            or value.get("nonce_hash") != nonce_hash
            or not _bounded_count(value.get("steps"), MAX_CONTINUATION_STEPS)
            or not _bounded_count(value.get("tool_calls"), MAX_CONTINUATION_TOOL_CALLS)
        ):
            raise ContinuityError("continuation_receipt_corrupt")
        total_steps += value["steps"]
        total_tools += value["tool_calls"]
        if (
            value.get("cumulative_steps") != total_steps
            or value.get("cumulative_tool_calls") != total_tools
        ):
            raise ContinuityError("continuation_receipt_corrupt")
        request_ids.add(value["request_id"])
        previous_hash = value["hash"]
        receipts.append(value)
    if (
        head.get("schema") != CONTINUATION_RECEIPT_SCHEMA
        or head.get("checkpoint_hash") != checkpoint_hash
        or head.get("sequence") != len(receipts)
        or head.get("receipt_hash") != previous_hash
        or head.get("file") != files[-1].name
    ):
        raise ContinuityError("continuation_receipt_head_mismatch")
    return receipts, total_steps, total_tools


def resume_checkpoint(
    workspace: Path, session: str, expected_trajectory: dict[str, Any] | None = None
) -> dict[str, Any]:
    session = _validate_id("session", session)
    try:
        session_dir = _session_directory(workspace, session, create=False)
    except ContinuityError as error:
        return {"status": "fresh-start", "reasons": [str(error)]}
    if not session_dir.is_dir() or session_dir.is_symlink():
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
    if "trajectory" in checkpoint:
        try:
            stored_trajectory = _validate_trajectory(checkpoint.get("trajectory"))
        except ContinuityError:
            reasons.append("trajectory_invalid")
            stored_trajectory = None
    else:
        stored_trajectory = None
    if expected_trajectory is not None:
        try:
            expected = _validate_trajectory(expected_trajectory)
        except ContinuityError:
            reasons.append("trajectory_expectation_invalid")
        else:
            if stored_trajectory != expected:
                reasons.append("trajectory_mismatch")
    if reasons:
        return {"status": "fresh-start", "reasons": reasons}
    continuation = checkpoint.get("continuation")
    if continuation is None:
        max_steps = 0
        max_tool_calls = 0
        consumed_steps = 0
        consumed_tool_calls = 0
        nonce = None
    elif not _valid_continuation(continuation):
        return {"status": "fresh-start", "reasons": ["continuation_invalid"]}
    else:
        try:
            deadline = datetime.fromisoformat(
                str(continuation["deadline_at"]).replace("Z", "+00:00")
            )
            if deadline < _now():
                return {"status": "fresh-start", "reasons": ["continuation_expired"]}
            _, consumed_steps, consumed_tool_calls = _validated_receipts(
                session_dir,
                session,
                checkpoint["checkpoint_hash"],
                _sha256(continuation["nonce"].encode("utf-8")),
            )
        except (ContinuityError, ValueError) as error:
            return {"status": "fresh-start", "reasons": [str(error)]}
        max_steps = continuation["max_steps"]
        max_tool_calls = continuation["max_tool_calls"]
        nonce = continuation["nonce"]
        if consumed_steps > max_steps or consumed_tool_calls > max_tool_calls:
            return {"status": "fresh-start", "reasons": ["continuation_overrun"]}
    return {
        "status": "resumable-context",
        "authority": "context-only",
        "requires_workspace_regrounding": True,
        "remaining_budget": {
            "steps": max_steps - consumed_steps,
            "tool_calls": max_tool_calls - consumed_tool_calls,
        },
        "continuation_nonce": nonce,
        "checkpoint": checkpoint,
    }


def consume_checkpoint(
    workspace: Path,
    session: str,
    checkpoint_hash: str,
    nonce: str,
    request_id: str,
    steps: int,
    tool_calls: int,
    expected_trajectory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session = _validate_id("session", session)
    request_id = _validate_id("request_id", request_id)
    if not isinstance(checkpoint_hash, str) or not DIGEST.fullmatch(checkpoint_hash):
        raise ContinuityError("continuation_checkpoint_mismatch")
    if not isinstance(nonce, str) or not DIGEST.fullmatch(nonce):
        raise ContinuityError("continuation_nonce_mismatch")
    if not (
        _bounded_count(steps, MAX_CONTINUATION_STEPS)
        and _bounded_count(tool_calls, MAX_CONTINUATION_TOOL_CALLS)
        and (steps > 0 or tool_calls > 0)
    ):
        raise ContinuityError("continuation_budget_invalid")
    try:
        session_dir = _session_directory(workspace, session, create=False)
    except ContinuityError as error:
        raise ContinuityError("continuation_fresh_start_required") from error
    if not session_dir.is_dir() or session_dir.is_symlink():
        raise ContinuityError("continuation_fresh_start_required")
    with _open_writer_lock(session_dir) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        resumed = resume_checkpoint(workspace, session, expected_trajectory)
        if resumed.get("status") != "resumable-context":
            raise ContinuityError("continuation_fresh_start_required")
        checkpoint = resumed["checkpoint"]
        if checkpoint.get("checkpoint_hash") != checkpoint_hash:
            raise ContinuityError("continuation_checkpoint_mismatch")
        continuation = checkpoint.get("continuation")
        if not _valid_continuation(continuation):
            raise ContinuityError("continuation_invalid")
        if continuation["nonce"] != nonce:
            raise ContinuityError("continuation_nonce_mismatch")
        receipts, consumed_steps, consumed_tools = _validated_receipts(
            session_dir, session, checkpoint_hash, _sha256(nonce.encode("utf-8"))
        )
        if any(receipt["request_id"] == request_id for receipt in receipts):
            raise ContinuityError("continuation_replay")
        if (
            consumed_steps + steps > continuation["max_steps"]
            or consumed_tools + tool_calls > continuation["max_tool_calls"]
        ):
            raise ContinuityError("continuation_overrun")
        sequence = len(receipts) + 1
        previous_hash = receipts[-1]["hash"] if receipts else ""
        record: dict[str, Any] = {
            "schema": CONTINUATION_RECEIPT_SCHEMA,
            "checkpoint_hash": checkpoint_hash,
            "session_id": session,
            "sequence": sequence,
            "request_id": request_id,
            "nonce_hash": _sha256(nonce.encode("utf-8")),
            "steps": steps,
            "tool_calls": tool_calls,
            "cumulative_steps": consumed_steps + steps,
            "cumulative_tool_calls": consumed_tools + tool_calls,
            "previous_hash": previous_hash,
            "created_at": _iso(_now()),
        }
        record["hash"] = _receipt_hash(record)
        receipt_dir = session_dir / "receipts" / checkpoint_hash
        receipt_name = f"receipt-{sequence:08d}.json"
        _atomic_write(receipt_dir / receipt_name, _canonical_bytes(record) + b"\n")
        head = {
            "schema": CONTINUATION_RECEIPT_SCHEMA,
            "checkpoint_hash": checkpoint_hash,
            "sequence": sequence,
            "receipt_hash": record["hash"],
            "file": receipt_name,
        }
        _atomic_write(receipt_dir / "head.json", _canonical_bytes(head) + b"\n")
        return {
            **record,
            "remaining_steps": continuation["max_steps"] - record["cumulative_steps"],
            "remaining_tool_calls": continuation["max_tool_calls"]
            - record["cumulative_tool_calls"],
            "authority": "context-only",
            "requires_workspace_regrounding": True,
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


def _add_trajectory_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--trajectory-id")
    parser.add_argument("--writer-epoch", type=int)
    parser.add_argument("--trajectory-offset", type=int)
    parser.add_argument("--trajectory-head-hash")
    parser.add_argument("--capability-hash")


def _trajectory_from_args(args: argparse.Namespace) -> dict[str, Any] | None:
    values = (
        args.trajectory_id,
        args.writer_epoch,
        args.trajectory_offset,
        args.trajectory_head_hash,
        args.capability_hash,
    )
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise ContinuityError("invalid_trajectory_binding")
    return _validate_trajectory(
        {
            "schema": TRAJECTORY_BINDING_SCHEMA,
            "trajectory_id": args.trajectory_id,
            "writer_epoch": args.writer_epoch,
            "ledger_offset": args.trajectory_offset,
            "ledger_head_hash": args.trajectory_head_hash,
            "capability_hash": args.capability_hash,
        }
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    checkpoint = subparsers.add_parser("checkpoint")
    checkpoint.add_argument("--session", required=True)
    checkpoint.add_argument("--turn", required=True)
    checkpoint.add_argument("--reason", required=True)
    checkpoint.add_argument(
        "--boundary", choices=sorted(SEMANTIC_BOUNDARIES), default="step-boundary"
    )
    checkpoint.add_argument("--max-steps", type=int, default=0)
    checkpoint.add_argument("--max-tool-calls", type=int, default=0)
    checkpoint.add_argument("--ttl-seconds", type=int, default=DEFAULT_TTL_SECONDS)
    _add_trajectory_arguments(checkpoint)
    resume = subparsers.add_parser("resume")
    resume.add_argument("--session", required=True)
    _add_trajectory_arguments(resume)
    consume = subparsers.add_parser("consume")
    consume.add_argument("--session", required=True)
    consume.add_argument("--checkpoint-hash", required=True)
    consume.add_argument("--nonce", required=True)
    consume.add_argument("--request-id", required=True)
    consume.add_argument("--steps", type=int, required=True)
    consume.add_argument("--tool-calls", type=int, required=True)
    _add_trajectory_arguments(consume)
    args = parser.parse_args()
    try:
        workspace = _workspace()
        trajectory = _trajectory_from_args(args)
        if args.command == "checkpoint":
            output = write_checkpoint(
                workspace,
                args.session,
                args.turn,
                args.reason,
                _read_stdin_payload(),
                args.boundary,
                args.max_steps,
                args.max_tool_calls,
                trajectory,
                args.ttl_seconds,
            )
        elif args.command == "resume":
            output = resume_checkpoint(workspace, args.session, trajectory)
        else:
            output = consume_checkpoint(
                workspace,
                args.session,
                args.checkpoint_hash,
                args.nonce,
                args.request_id,
                args.steps,
                args.tool_calls,
                trajectory,
            )
    except ContinuityError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
