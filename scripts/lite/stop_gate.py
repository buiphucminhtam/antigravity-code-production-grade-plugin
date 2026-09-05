#!/usr/bin/env python3
"""Canonical, bounded Stop/verify decision engine.

The engine normalizes host routing metadata, calls the strict rule validator
once, and persists only hashed retry state. Repeated invalid Stop events are
allowed to terminate at the host boundary while completion remains explicitly
unverified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if os.name == "nt":
    import msvcrt
else:
    import fcntl

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_common import (
    FINAL_PHASES,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    read_evidence_bytes,
    read_evidence_json,
    worktree_fingerprint,
)
from windows_secure_io import (
    atomic_write_bytes as windows_atomic_write_bytes,
    open_anchored_lock_file as windows_open_anchored_lock_file,
)

try:
    from continuity_check import ContinuityResult, check_continuity
except ImportError:  # An older global install must preserve the old Stop path.

    @dataclass(frozen=True)
    class ContinuityResult:  # type: ignore[no-redef]
        status: str
        reason: str = ""
        material_paths: tuple[str, ...] = ()
        receipt_path: str = ""

        @property
        def material(self) -> bool:
            return bool(self.material_paths)

    def check_continuity(*_args: Any, **_kwargs: Any) -> ContinuityResult:
        return ContinuityResult("off")


from verify_gate import _check_stubs, _find_evidence, changed_files


SCHEMA = "forgewright-stop-decision/v1"
MAX_PAYLOAD_BYTES = 1024 * 1024
MAX_DIAGNOSTIC_BYTES = 64 * 1024
MAX_RETRY_STATE_BYTES = 64 * 1024
STATE_TTL_SECONDS = 15 * 60
MAX_ATTEMPTS_PER_SCOPE = 2
VALID_PLATFORMS = {"CLAUDE", "GEMINI", "CURSOR", "CODEX", ""}
SKIP_SUFFIXES = {".md", ".txt"}
SKIP_NAMES = {".gitignore", ".gitattributes", ".memignore", ".cursorignore"}
SKIP_PREFIXES = (".forgewright/", ".gitnexus/", ".forgenexus/")
DOCS_SOURCE_EXTENSIONS = {
    ".md",
    ".markdown",
    ".json",
    ".yaml",
    ".yml",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
}
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


def _is_docs_continuity_path(value: str, material_paths: tuple[str, ...] = ()) -> bool:
    """Recognize validated Docs Hub sources without exempting actual code."""

    normalized = value.removeprefix("./").replace("\\", "/")
    if normalized == ".forgewright/docs-manifest.json":
        return True
    if Path(normalized).suffix.lower() not in DOCS_SOURCE_EXTENSIONS:
        return False
    if any(
        normalized == path or normalized.startswith(path.rstrip("/") + "/")
        for path in material_paths
        if path
    ):
        return True
    # This fallback is only used for legacy/missing-manifest diagnostics;
    # check_continuity supplies manifest-derived material paths when a
    # validated manifest is present.
    return normalized.startswith(("docs/", "documentation/", "wiki/"))


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
        # Evidence is untrusted input.  Keep the digest path anchored to the
        # project verify directory and use the shared descriptor-anchored,
        # bounded reader so a large file cannot be allocated before checking
        # its size and no symlink component can redirect the read.
        if os.name != "nt" and not hasattr(os, "O_NOFOLLOW"):
            return "missing"
        return _sha256_bytes(
            read_evidence_bytes(root, candidate, max_bytes=MAX_EVIDENCE_BYTES)
        )
    except (OSError, ValueError):
        return "missing"


def _has_symlink_component(root: Path, path: Path) -> bool:
    """Return whether an existing path component is a link or escapes root."""

    try:
        root_lexical = Path(os.path.abspath(root))
        root_real = root.resolve()
        candidate = path if path.is_absolute() else root_lexical / path
        candidate_lexical = Path(os.path.abspath(candidate))
        try:
            relative = candidate_lexical.relative_to(root_lexical)
            component_root = root_lexical
        except ValueError:
            # ``Path.resolve`` may canonicalize a platform alias such as
            # /var to /private/var.  Treat that resolved spelling as the
            # workspace lexical root, but still enforce containment below.
            try:
                candidate_lexical = candidate_lexical.resolve(strict=False)
                relative = candidate_lexical.relative_to(root_real)
                component_root = root_real
            except ValueError:
                return True
    except (OSError, RuntimeError, ValueError):
        return True

    current = component_root
    for component in relative.parts:
        current /= component
        try:
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or (
                os.name == "nt"
                and bool(
                    getattr(info, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
                )
            ):
                return True
        except FileNotFoundError:
            continue
        except OSError:
            return True
    try:
        candidate_lexical.resolve(strict=False).relative_to(root_real)
    except (OSError, RuntimeError, ValueError):
        return True
    return False


def _state_entry_safe(root: Path, directory: Path, path: Path) -> bool:
    """Check a state entry before any read or replacement is attempted."""

    if path.parent != directory or _has_symlink_component(root, path):
        return False
    try:
        info = path.lstat()
    except FileNotFoundError:
        return True
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode)


def _read_bounded_regular(path: Path, limit: int) -> bytes | None:
    """Read a regular file with a pre-allocation size bound and no-follow."""

    if limit < 0 or (os.name != "nt" and not hasattr(os, "O_NOFOLLOW")):
        return None
    nofollow = 0 if os.name == "nt" else os.O_NOFOLLOW
    try:
        initial = path.lstat()
        if (
            not stat.S_ISREG(initial.st_mode)
            or initial.st_size > limit
            or (
                os.name == "nt"
                and bool(
                    getattr(initial, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
                )
            )
        ):
            return None
        fd = os.open(
            path,
            os.O_RDONLY
            | nofollow
            | getattr(os, "O_BINARY", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
    except OSError:
        return None
    try:
        opened = os.fstat(fd)
        identity = (opened.st_dev, opened.st_ino)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size > limit
            or identity != (initial.st_dev, initial.st_ino)
            or (
                os.name == "nt"
                and bool(
                    getattr(opened, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
                )
            )
        ):
            return None
        chunks: list[bytes] = []
        total = 0
        while total <= limit:
            chunk = os.read(fd, min(64 * 1024, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > limit:
                return None
        final = os.fstat(fd)
        if (
            (final.st_dev, final.st_ino) != identity
            or final.st_size != opened.st_size
            or final.st_mtime_ns != opened.st_mtime_ns
        ):
            return None
        if os.name == "nt":
            current = path.lstat()
            if (
                not stat.S_ISREG(current.st_mode)
                or (current.st_dev, current.st_ino) != identity
                or current.st_size != final.st_size
                or current.st_mtime_ns != final.st_mtime_ns
                or bool(
                    getattr(current, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
                )
            ):
                return None
        return b"".join(chunks)
    except (OSError, ValueError):
        return None
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def _state_dir(root: Path) -> Path | None:
    configured = os.environ.get("FORGEWRIGHT_STOP_STATE_DIR", "").strip()
    raw = (
        Path(configured).expanduser()
        if configured
        else Path(".forgewright") / "runtime" / "stop-attempts"
    )
    candidate = raw if raw.is_absolute() else root / raw
    if _has_symlink_component(root, candidate):
        return None
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(root.resolve())
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved


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


def _atomic_json(root: Path, path: Path, value: dict[str, Any]) -> None:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_RETRY_STATE_BYTES:
        raise OSError("retry state exceeds the bounded size limit")
    if os.name == "nt":
        windows_atomic_write_bytes(root, path, payload)
        return

    if not hasattr(os, "O_NOFOLLOW"):
        raise OSError("atomic state writes require O_NOFOLLOW")
    directory = path.parent
    directory_fd = os.open(
        directory,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0),
    )
    temp_name = ""
    fd = -1
    try:
        os.fchmod(directory_fd, 0o700)
        for _ in range(100):
            temp_name = f".{path.name}.{next(tempfile._get_candidate_names())}"
            try:
                fd = os.open(
                    temp_name,
                    os.O_WRONLY
                    | os.O_CREAT
                    | os.O_EXCL
                    | os.O_NOFOLLOW
                    | getattr(os, "O_CLOEXEC", 0),
                    0o600,
                    dir_fd=directory_fd,
                )
                break
            except FileExistsError:
                continue
        if fd < 0:
            raise OSError("could not allocate a temporary retry-state file")
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(
            temp_name,
            path.name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        temp_name = ""
        os.fsync(directory_fd)
    finally:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        if temp_name:
            try:
                os.unlink(temp_name, dir_fd=directory_fd)
            except OSError:
                pass
        try:
            os.close(directory_fd)
        except OSError:
            pass


def _open_lock_file(root: Path, directory: Path, path: Path) -> int:
    """Open a regular non-reparse lock file without following Windows links."""

    flags = os.O_RDWR | getattr(os, "O_CLOEXEC", 0)
    if os.name != "nt":
        return os.open(path, flags | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    return windows_open_anchored_lock_file(root, directory, path)


def _lock_exclusive(stream: Any) -> None:
    if os.name == "nt":
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        return
    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)


def _unlock_exclusive(stream: Any) -> None:
    if os.name == "nt":
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        return
    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _retry_state(root: Path, scope: str, key: str, *, record: bool) -> tuple[bool, str]:
    directory = _state_dir(root)
    if directory is None:
        # Retry state is an optimization at the host boundary.  If its
        # configured location is unsafe or unavailable, continue the normal
        # validation path and never create anything through that location.
        return False, "validation_failed"
    try:
        if _has_symlink_component(root, directory):
            return False, "validation_failed"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if _has_symlink_component(root, directory):
            return False, "validation_failed"
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode):
            return False, "validation_failed"
        os.chmod(directory, 0o700)
    except OSError:
        return False, "validation_failed"
    lock_path = directory / ".lock"
    path = directory / f"{scope}.json"
    if (
        not _state_entry_safe(root, directory, lock_path)
        or not _state_entry_safe(root, directory, path)
        or (os.name != "nt" and not hasattr(os, "O_NOFOLLOW"))
    ):
        return False, "validation_failed"
    lock_fd = -1
    try:
        lock_fd = _open_lock_file(root, directory, lock_path)
        lock_info = os.fstat(lock_fd)
        if not stat.S_ISREG(lock_info.st_mode):
            return False, "validation_failed"
        if hasattr(os, "fchmod"):
            os.fchmod(lock_fd, 0o600)
        with os.fdopen(lock_fd, "r+b") as lock:
            lock_fd = -1
            _lock_exclusive(lock)
            try:
                if not _state_entry_safe(root, directory, path):
                    return False, "validation_failed"
                state: dict[str, Any] = {
                    "attempts": 0,
                    "keys": {},
                    "updated_at": 0.0,
                }
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    info = None
                except OSError:
                    return False, "validation_failed"
                if info is not None:
                    raw_state = _read_bounded_regular(path, MAX_RETRY_STATE_BYTES)
                    if raw_state is None:
                        # Do not overwrite malformed/oversized state: this keeps
                        # a persistence fault fail-open and write-free.
                        return False, "validation_failed"
                    try:
                        loaded = json.loads(raw_state.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
                        return False, "validation_failed"
                    if not isinstance(loaded, dict):
                        return False, "validation_failed"
                    state.update(loaded)
                try:
                    age = time.time() - float(state.get("updated_at", 0.0) or 0.0)
                    attempts = int(state.get("attempts", 0) or 0)
                except (TypeError, ValueError, OverflowError):
                    return False, "validation_failed"
                if age > STATE_TTL_SECONDS:
                    state = {"attempts": 0, "keys": {}, "updated_at": 0.0}
                    attempts = 0
                keys = state.get("keys")
                if not isinstance(keys, dict):
                    return False, "validation_failed"
                if key in keys:
                    return True, "duplicate_invalid_stop"
                if attempts >= MAX_ATTEMPTS_PER_SCOPE:
                    return True, "retry_budget_exhausted"
                if record:
                    keys[key] = 1
                    state = {
                        "attempts": attempts + 1,
                        "keys": keys,
                        "updated_at": time.time(),
                    }
                    if not _state_entry_safe(root, directory, path):
                        return False, "validation_failed"
                    _atomic_json(root, path, state)
                return False, "validation_failed"
            finally:
                _unlock_exclusive(lock)
    except (OSError, ValueError, TypeError, OverflowError):
        # Persistence failures must not turn into an exception or an external
        # write.  The caller retains the existing Stop validation result.
        return False, "validation_failed"
    finally:
        if lock_fd >= 0:
            try:
                os.close(lock_fd)
            except OSError:
                pass


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
    platform: str,
    typed: bool,
    completion: str,
    reason: str,
    suppressed: bool,
    *,
    diagnostic: str = "",
) -> int:
    decision = _typed("allow_stop", completion, suppressed, reason)
    if diagnostic:
        print(f"[DOCS-CONTINUITY] UNVERIFIED: {diagnostic[:512]}", file=sys.stderr)
    if platform == "CODEX":
        payload: dict[str, Any] = {"continue": True}
        if typed:
            payload["forgewright"] = decision
        print(json.dumps(payload, sort_keys=True))
    return 0


def _emit_block(
    platform: str,
    typed: bool,
    reason: str,
    *,
    reason_code: str = "validation_failed",
) -> int:
    decision = _typed("request_retry", "unverified", False, reason_code)
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
        "PYTHONIOENCODING": "utf-8",
    }
    result = subprocess.run(
        [sys.executable, str(validator), "--runtime"],
        cwd=root,
        env=environment,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        encoding="utf-8",
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
    continuity: ContinuityResult = check_continuity(root, payload, files=files)
    if continuity.status == "retry":
        return _emit_block(
            platform,
            args.typed_stop_decision,
            f"Docs Hub continuity requires one bounded refresh: {continuity.reason}.",
            reason_code="docs_continuity_retry",
        )
    has_code = any(
        _is_code_path(value)
        and not (
            continuity.material
            and _is_docs_continuity_path(value, continuity.material_paths)
        )
        for value in files
    )
    stop_marker_requires_validation = args.typed_stop_decision and _has_verify_marker(
        payload
    )
    continuity_unverified = continuity.status in {"observe", "unverified"}
    continuity_reason = continuity.reason or "docs_continuity_unverified"
    continuity_retry_suppressed = continuity_reason.endswith("_retry_suppressed")
    if not has_code and not stop_marker_requires_validation:
        if platform != "CODEX":
            print("[VERIFY-GATE] No code changes detected — gate OPEN")
        return _emit_allow(
            platform,
            args.typed_stop_decision,
            "unverified" if continuity_unverified else "verified",
            "docs_continuity_unverified"
            if continuity_unverified
            else "no_code_changes",
            continuity_retry_suppressed,
            diagnostic=continuity_reason if continuity_unverified else "",
        )

    scope, key = _identity(root, payload)
    suppressed, suppression_reason = _retry_state(root, scope, key, record=False)
    if suppressed:
        return _emit_allow(
            platform,
            args.typed_stop_decision,
            "unverified",
            suppression_reason,
            True,
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
            platform,
            args.typed_stop_decision,
            "unverified" if continuity_unverified else "verified",
            "docs_continuity_unverified"
            if continuity_unverified
            else "validation_passed",
            continuity_retry_suppressed,
            diagnostic=continuity_reason if continuity_unverified else "",
        )

    suppressed, suppression_reason = _retry_state(root, scope, key, record=True)
    if suppressed:
        return _emit_allow(
            platform, args.typed_stop_decision, "unverified", suppression_reason, True
        )
    return _emit_block(platform, args.typed_stop_decision, reason)


if __name__ == "__main__":
    raise SystemExit(main())
