#!/usr/bin/env python3
"""Canonical, bounded Stop/verify decision engine.

The engine normalizes host routing metadata, calls the strict rule validator
once, and persists only hashed retry state. Repeated invalid Stop events are
allowed to terminate at the host boundary while completion remains explicitly
unverified.
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
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_common import (
    FINAL_PHASES,
    SCHEMA_VERSION,
    read_evidence_json,
    worktree_fingerprint,
)
from verify_gate import _check_stubs, _find_evidence, changed_files


SCHEMA = "forgewright-stop-decision/v1"
MAX_PAYLOAD_BYTES = 1024 * 1024
MAX_DIAGNOSTIC_BYTES = 64 * 1024
STATE_TTL_SECONDS = 15 * 60
MAX_ATTEMPTS_PER_SCOPE = 2
VALID_PLATFORMS = {"CLAUDE", "GEMINI", "CURSOR", "CODEX", ""}
SKIP_SUFFIXES = {".md", ".txt"}
SKIP_NAMES = {".gitignore", ".gitattributes", ".memignore", ".cursorignore"}
SKIP_PREFIXES = (".forgewright/", ".gitnexus/", ".forgenexus/")
VERIFY_MARKER = re.compile(
    r"(?im)^\s*(?:(?:#{1,6}\s*)?(?:CLAIM|VERIFY|VERIFICATION)\s*:|"
    r"#{1,6}\s*(?:VERIFY|VERIFICATION)\s*$|```(?:verify|verification)\b)"
)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_hash(value: Any) -> str:
    return _sha256_bytes(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    )


def _project_root() -> Path:
    requested = os.environ.get("FORGEWRIGHT_WORKSPACE", "").strip()
    if requested:
        candidate = Path(requested).expanduser().resolve()
        if candidate.is_dir():
            return candidate
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


def _safe_selector(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    candidate = Path(value)
    if (
        not value
        or candidate.name != value
        or any(part in {".", ".."} for part in candidate.parts)
    ):
        return ""
    return value


def _mapped_evidence(root: Path, selector: str) -> tuple[bool, bool]:
    """Return (path exists in any form, exact passing final record)."""
    if not selector:
        return False, False
    candidate = root / ".forgewright" / "verify" / f"{selector}.json"
    mapped = candidate.exists() or candidate.is_symlink()
    if not mapped:
        return False, False
    try:
        evidence = read_evidence_json(root, candidate)
    except ValueError:
        return True, False
    exact_final = (
        evidence.get("schema_version") == SCHEMA_VERSION
        and evidence.get("turn") == selector
        and evidence.get("phase") in FINAL_PHASES
        and evidence.get("exit_code") == 0
    )
    return True, exact_final


def _normalize_payload(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    response = normalized.get("response_content")
    if not isinstance(response, str):
        response = normalized.get("last_assistant_message")
    if isinstance(response, str):
        normalized["response_content"] = response

    explicit = _safe_selector(normalized.get("turn"))
    alternate = _safe_selector(normalized.get("turn_id"))
    selector = explicit or alternate
    mapped, exact_final = _mapped_evidence(root, selector)
    if selector and mapped:
        # Mapped-but-invalid evidence fails closed without fallback.
        normalized["turn"] = selector
    elif selector and exact_final:
        normalized["turn"] = selector
    else:
        discovered = _find_evidence(root, "")
        if discovered is not None:
            normalized["turn"] = discovered.stem
        elif selector:
            normalized["turn"] = selector
    normalized.pop("turn_id", None)
    return normalized


def _payload_files(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("files", payload.get("changed_files", []))
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if isinstance(item, (str, Path)) and str(item)]


def _is_code_path(value: str) -> bool:
    normalized = value.removeprefix("./")
    path = Path(normalized)
    if normalized in SKIP_NAMES or path.suffix.lower() in SKIP_SUFFIXES:
        return False
    return not normalized.startswith(SKIP_PREFIXES)


def _files_to_check(root: Path, payload: dict[str, Any]) -> list[str]:
    combined = [*_payload_files(payload), *changed_files(root)]
    return list(dict.fromkeys(value for value in combined if value))


def _has_verify_marker(payload: dict[str, Any]) -> bool:
    response = payload.get("response_content", "")
    return isinstance(response, str) and VERIFY_MARKER.search(response) is not None


def _evidence_digest(root: Path, turn: str) -> str:
    if not turn:
        return "missing"
    candidate = root / ".forgewright" / "verify" / f"{turn}.json"
    try:
        if candidate.is_symlink() or not candidate.is_file():
            return "missing"
        return _sha256_bytes(candidate.read_bytes())
    except OSError:
        return "missing"


def _state_dir(root: Path) -> Path:
    configured = os.environ.get("FORGEWRIGHT_STOP_STATE_DIR", "").strip()
    return (
        Path(configured).expanduser().resolve()
        if configured
        else root / ".forgewright" / "runtime" / "stop-attempts"
    )


def _identity(root: Path, payload: dict[str, Any]) -> tuple[str, str]:
    session = (
        _safe_selector(payload.get("session_id"))
        or _safe_selector(os.environ.get("CODEX_THREAD_ID"))
        or "unknown-session"
    )
    turn = _safe_selector(payload.get("turn")) or "unknown-turn"
    tree = worktree_fingerprint(root)
    scope = _canonical_hash(
        {
            "workspace": _sha256_bytes(str(root).encode("utf-8")),
            "session": session,
            "turn": turn,
            "tree": tree,
        }
    )
    key = _canonical_hash(
        {
            "platform": str(payload.get("platform", "")),
            "scope": scope,
            "payload": _canonical_hash(payload),
            "evidence": _evidence_digest(root, turn),
        }
    )
    return scope, key


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, raw_temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp = Path(raw_temp)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temp.unlink(missing_ok=True)


def _retry_state(root: Path, scope: str, key: str, *, record: bool) -> tuple[bool, str]:
    directory = _state_dir(root)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    lock_path = directory / ".lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        path = directory / f"{scope}.json"
        state: dict[str, Any] = {"attempts": 0, "keys": {}, "updated_at": 0.0}
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                state.update(loaded)
        except (OSError, json.JSONDecodeError, TypeError):
            pass
        age = time.time() - float(state.get("updated_at", 0.0) or 0.0)
        if age > STATE_TTL_SECONDS:
            state = {"attempts": 0, "keys": {}, "updated_at": 0.0}
        keys = state.get("keys") if isinstance(state.get("keys"), dict) else {}
        attempts = int(state.get("attempts", 0) or 0)
        if key in keys:
            return True, "duplicate_invalid_stop"
        if attempts >= MAX_ATTEMPTS_PER_SCOPE:
            return True, "retry_budget_exhausted"
        if record:
            keys[key] = 1
            state = {"attempts": attempts + 1, "keys": keys, "updated_at": time.time()}
            _atomic_json(path, state)
        return False, "validation_failed"


def _typed(
    host_action: str, completion: str, suppressed: bool, reason: str
) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "host_action": host_action,
        "completion_state": completion,
        "retry_suppressed": suppressed,
        "reason_code": reason,
    }


def _emit_allow(
    platform: str, typed: bool, completion: str, reason: str, suppressed: bool
) -> int:
    decision = _typed("allow_stop", completion, suppressed, reason)
    if platform == "CODEX":
        payload: dict[str, Any] = {"continue": True}
        if typed:
            payload["forgewright"] = decision
        print(json.dumps(payload, sort_keys=True))
    return 0


def _emit_block(platform: str, typed: bool, reason: str) -> int:
    decision = _typed("request_retry", "unverified", False, "validation_failed")
    if platform == "CODEX":
        payload: dict[str, Any] = {"decision": "block", "reason": reason[:512]}
        if typed:
            payload["forgewright"] = decision
        print(json.dumps(payload, sort_keys=True))
        return 0
    print(
        "[VERIFY-GATE] ERROR: Evidence validation FAILED — gate BLOCKED",
        file=sys.stderr,
    )
    return 2 if typed and platform in {"CLAUDE", "GEMINI"} else 1


def _read_payload(path: str) -> tuple[bytes, bool]:
    if path:
        try:
            with Path(path).open("rb") as stream:
                raw = stream.read(MAX_PAYLOAD_BYTES + 1)
        except OSError:
            return b"", False
    else:
        raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
    return raw[:MAX_PAYLOAD_BYTES], len(raw) > MAX_PAYLOAD_BYTES


def _parse_payload(raw: bytes) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="replace")
    if not text.strip():
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"response_content": text}
    return parsed if isinstance(parsed, dict) else {}


def _validator_once(root: Path, payload: dict[str, Any]) -> tuple[bool, str]:
    validator = Path(__file__).resolve().parent / "rule-validator.py"
    environment = {
        **os.environ,
        "FORGEWRIGHT_WORKSPACE": str(root),
        "FORGEWRIGHT_TURN": str(payload.get("turn", "")),
    }
    result = subprocess.run(
        [sys.executable, str(validator), "--runtime"],
        cwd=root,
        env=environment,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=float(os.environ.get("FORGEWRIGHT_STOP_VALIDATION_TIMEOUT", "320")),
        check=False,
    )
    diagnostic = result.stderr.encode("utf-8", errors="replace")[
        :MAX_DIAGNOSTIC_BYTES
    ].decode("utf-8", errors="replace")
    if result.returncode == 0:
        return True, diagnostic
    return False, "Forgewright rule validator rejected the response payload."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", default="")
    parser.add_argument("--payload-file", default="")
    parser.add_argument("--typed-stop-decision", action="store_true")
    args, _unknown = parser.parse_known_args()
    platform = args.platform.upper()
    if platform not in VALID_PLATFORMS:
        print(
            f"[VERIFY-GATE] ERROR: Unknown platform '{args.platform}'", file=sys.stderr
        )
        return _emit_block(
            platform,
            args.typed_stop_decision,
            f"Unknown verify-gate platform '{args.platform}'.",
        )

    raw, oversized = _read_payload(args.payload_file)
    if oversized:
        return _emit_block(
            platform,
            args.typed_stop_decision,
            "Forgewright stop payload exceeds 1 MiB.",
        )
    root = _project_root()
    payload = _normalize_payload(root, _parse_payload(raw))
    payload["platform"] = platform
    files = _files_to_check(root, payload)
    has_code = any(_is_code_path(value) for value in files)
    stop_marker_requires_validation = args.typed_stop_decision and _has_verify_marker(
        payload
    )
    if not has_code and not stop_marker_requires_validation:
        if platform != "CODEX":
            print("[VERIFY-GATE] No code changes detected — gate OPEN")
        return _emit_allow(
            platform,
            args.typed_stop_decision,
            "verified",
            "no_code_changes",
            False,
        )

    scope, key = _identity(root, payload)
    suppressed, suppression_reason = _retry_state(root, scope, key, record=False)
    if suppressed:
        return _emit_allow(
            platform, args.typed_stop_decision, "unverified", suppression_reason, True
        )

    stub_errors = _check_stubs(files)
    if stub_errors:
        valid, reason = False, "STUBS: changed code contains forbidden stubs."
    else:
        try:
            valid, reason = _validator_once(root, payload)
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            valid, reason = (
                False,
                f"Forgewright validation failed safely: {type(error).__name__}.",
            )
    if valid:
        if not args.typed_stop_decision:
            print(
                "[VERIFY-GATE] Strict VERIFY response correlation passed",
                file=sys.stderr,
            )
        return _emit_allow(
            platform, args.typed_stop_decision, "verified", "validation_passed", False
        )

    suppressed, suppression_reason = _retry_state(root, scope, key, record=True)
    if suppressed:
        return _emit_allow(
            platform, args.typed_stop_decision, "unverified", suppression_reason, True
        )
    return _emit_block(platform, args.typed_stop_decision, reason)


if __name__ == "__main__":
    raise SystemExit(main())
