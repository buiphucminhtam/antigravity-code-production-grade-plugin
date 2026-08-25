#!/usr/bin/env python3
"""Read canonical rule context for agent hooks without blocking the host.

The hook is intentionally local-only and fail-open. It reads the canonical
manifest and Markdown sources, emits one host-shaped JSON object, and stores a
small metadata-only receipt beneath ``.forgewright/runtime``. No source or
generated instruction file is modified by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import tempfile
from pathlib import Path, PureWindowsPath
from typing import Any


SCRIPT_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_RELATIVE = Path("kernel/rule-manifest.json")
RUNTIME_RELATIVE = Path(".forgewright/runtime/rule-context")
DEFAULT_MAX_CONTEXT_CHARS = 6000
MAX_CONTEXT_CHARS = 16000
MIN_CONTEXT_CHARS = 512
MAX_RULES = 8
MAX_INPUT_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024
MAX_SOURCE_BYTES = 32 * 1024
MAX_TOTAL_SOURCE_BYTES = 256 * 1024
MAX_ID_LENGTH = 64
MAX_SOURCE_LENGTH = 256
MAX_SERIALIZED_OUTPUT_BYTES = 7000
ACTIVE_STATUS = "active"
VALID_STATUSES = {"active", "superseded", "inactive", "transient"}


class ManifestError(ValueError):
    """Raised when a rule manifest cannot be safely consumed."""


class WorkspaceError(ManifestError):
    """Raised when an explicitly supplied workspace is invalid."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _workspace_root(requested: str | Path | None = None) -> Path:
    if requested is not None and str(requested).strip():
        value = str(requested).strip()
    elif os.environ.get("FORGEWRIGHT_WORKSPACE", "").strip():
        value = os.environ["FORGEWRIGHT_WORKSPACE"].strip()
    else:
        return SCRIPT_ROOT
    candidate = Path(value).expanduser().resolve()
    if candidate.is_dir() and os.access(candidate, os.R_OK):
        return candidate
    raise WorkspaceError(f"explicit workspace is invalid: {value}")


def _read_limited(path: Path, limit: int) -> bytes:
    """Read a small local file and reject it before unbounded allocation."""
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        initial = path.lstat()
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > limit:
            raise ManifestError(f"file exceeds bounded read limit: {path}")
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ManifestError(f"file is not a safe regular file: {path}") from error
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size > limit
            or (opened.st_dev, opened.st_ino) != (initial.st_dev, initial.st_ino)
        ):
            raise ManifestError(f"file changed during bounded open: {path}")
        chunks: list[bytes] = []
        total = 0
        while total <= limit:
            chunk = os.read(descriptor, min(64 * 1024, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        data = b"".join(chunks)
        final = os.fstat(descriptor)
        if (
            (final.st_dev, final.st_ino) != (opened.st_dev, opened.st_ino)
            or final.st_size != opened.st_size
            or final.st_mtime_ns != opened.st_mtime_ns
        ):
            raise ManifestError(f"file changed during bounded read: {path}")
    finally:
        os.close(descriptor)
    if len(data) > limit:
        raise ManifestError(f"file exceeds bounded read limit: {path}")
    return data


def _source_path(root: Path, source: Any) -> Path:
    if not isinstance(source, str) or not source.strip() or "\x00" in source:
        raise ManifestError("rule source must be a non-empty string")
    # Treat Windows separators as separators even when a manifest is checked
    # on POSIX. This prevents a manifest from becoming safe only by accident.
    normalized = source.replace("\\", "/")
    windows = PureWindowsPath(normalized)
    relative = Path(normalized)
    if relative.is_absolute() or windows.is_absolute() or windows.drive:
        raise ManifestError(f"rule source must be workspace-relative: {source!r}")
    if any(part in {"", ".", ".."} for part in relative.parts):
        raise ManifestError(f"rule source contains an unsafe path: {source!r}")
    root_resolved = root.resolve()
    candidate = root / relative
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root_resolved)
    except (OSError, ValueError) as error:
        raise ManifestError(
            f"rule source is missing or escapes workspace: {source!r}"
        ) from error
    if not resolved.is_file() or not os.access(resolved, os.R_OK):
        raise ManifestError(f"rule source is not readable: {source!r}")
    return resolved


def _as_list(value: Any, field: str) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ManifestError(f"manifest field {field!r} must be a list of strings")
    values = [item.strip() for item in value if item.strip()]
    if len(values) > MAX_RULES:
        raise ManifestError(f"manifest field {field!r} exceeds bounded item count")
    return values


def validate_manifest(manifest: Any, root: Path) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ManifestError("manifest must be a JSON object")
    if manifest.get("schema_version") != "1":
        raise ManifestError("unsupported rule manifest schema")
    raw_rules = manifest.get("rules")
    if not isinstance(raw_rules, list) or len(raw_rules) > MAX_RULES:
        raise ManifestError("manifest rules must be a bounded list")
    defaults = manifest.get("defaults", {})
    if not isinstance(defaults, dict):
        raise ManifestError("manifest defaults must be an object")
    max_chars = defaults.get("max_context_chars", DEFAULT_MAX_CONTEXT_CHARS)
    max_rules = defaults.get("max_rules", len(raw_rules) or 1)
    if (
        not isinstance(max_chars, int)
        or not MIN_CONTEXT_CHARS <= max_chars <= MAX_CONTEXT_CHARS
    ):
        raise ManifestError("manifest max_context_chars is outside the safe bound")
    if not isinstance(max_rules, int) or not 1 <= max_rules <= MAX_RULES:
        raise ManifestError("manifest max_rules is outside the safe bound")

    rules: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw in raw_rules:
        if not isinstance(raw, dict):
            raise ManifestError("manifest rule entries must be objects")
        identifier = raw.get("id")
        if not isinstance(identifier, str):
            raise ManifestError("manifest rule ids must be unique non-empty strings")
        identifier = identifier.strip()
        if not identifier or len(identifier) > MAX_ID_LENGTH or identifier in seen_ids:
            raise ManifestError("manifest rule ids must be unique non-empty strings")
        seen_ids.add(identifier)
        source = raw.get("source")
        if isinstance(source, str):
            source = source.strip()
        if not isinstance(source, str) or not source or len(source) > MAX_SOURCE_LENGTH:
            raise ManifestError(f"rule {identifier!r} has an invalid source")
        _source_path(root, source)
        platforms = _as_list(raw.get("platforms", ["*"]), "platforms")
        events = raw.get("events", raw.get("triggers", raw.get("event", ["*"])))
        events = _as_list(events, "events")
        status = raw.get("status")
        canonical = raw.get("canonical")
        if (
            not isinstance(status, str)
            or not status.strip()
            or status.strip().lower() not in VALID_STATUSES
        ):
            raise ManifestError(f"rule {identifier!r} has no status")
        if canonical is not None and not isinstance(canonical, bool):
            raise ManifestError(f"rule {identifier!r} canonical must be boolean")
        if canonical is None:
            raise ManifestError(f"rule {identifier!r} canonical must be boolean")
        priority = raw.get("priority", 1000)
        if not isinstance(priority, int):
            raise ManifestError(f"rule {identifier!r} priority must be an integer")
        normalized = dict(raw)
        normalized.update(
            {
                "id": identifier,
                "source": source,
                "platforms": platforms,
                "events": events,
                "status": status.strip().lower(),
                "canonical": canonical,
                "priority": priority,
            }
        )
        rules.append(normalized)
    inventory_floor = len("[Forgewright rule inventory]\n") + sum(
        len(rule["id"]) + 1 + len(rule["source"]) + 1 + len("sha256:" + ("0" * 64)) + 1
        for rule in rules
    )
    if max_chars < inventory_floor:
        raise ManifestError("manifest context bound cannot contain the rule inventory")
    return {
        "schema_version": "1",
        "defaults": {"max_context_chars": max_chars, "max_rules": max_rules},
        "rules": rules,
    }


def load_manifest(root: Path | str) -> dict[str, Any]:
    root = _workspace_root(root)
    path = root / MANIFEST_RELATIVE
    try:
        raw_bytes = _read_limited(path, MAX_MANIFEST_BYTES)
        raw = json.loads(raw_bytes.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, ManifestError) as error:
        raise ManifestError(f"could not read rule manifest: {error}") from error
    validated = validate_manifest(raw, root)
    validated["manifest_sha256"] = _sha256_bytes(raw_bytes)
    return validated


def _matches(values: list[str], wanted: str) -> bool:
    wanted = wanted.strip().casefold()
    return "*" in values or any(value.casefold() == wanted for value in values)


def select_rules(
    manifest: dict[str, Any], platform: str, event: str
) -> list[dict[str, Any]]:
    selected = [
        rule
        for rule in manifest.get("rules", [])
        if rule.get("status") == ACTIVE_STATUS
        and rule.get("canonical", True)
        and _matches(rule.get("platforms", ["*"]), platform)
        and _matches(rule.get("events", ["*"]), event)
    ]
    selected.sort(key=lambda rule: (rule.get("priority", 1000), rule["id"]))
    max_rules = manifest.get("defaults", {}).get("max_rules", MAX_RULES)
    return selected[:max_rules]


def build_context(
    root: Path | str,
    rules: list[dict[str, Any]],
    *,
    max_chars: int,
    include_excerpts: bool = True,
    manifest_sha256: str = "",
) -> dict[str, Any]:
    root = _workspace_root(root)
    max_chars = int(max_chars)
    if not MIN_CONTEXT_CHARS <= max_chars <= MAX_CONTEXT_CHARS:
        raise ManifestError("context bound is outside the safe range")
    records: list[tuple[dict[str, str], bytes]] = []
    total_read = 0
    for rule in rules:
        source_path = _source_path(root, rule.get("source"))
        raw = _read_limited(source_path, MAX_SOURCE_BYTES)
        total_read += len(raw)
        if total_read > MAX_TOTAL_SOURCE_BYTES:
            raise ManifestError("selected rule sources exceed total read budget")
        digest = _sha256_bytes(raw)
        metadata = {"id": rule["id"], "source": rule["source"], "sha256": digest}
        records.append((metadata, raw))

    inventory = ["[Forgewright rule inventory]"]
    inventory.extend(
        f"{metadata['id']}\t{metadata['source']}\tsha256:{metadata['sha256']}"
        for metadata, _ in records
    )
    inventory_text = "\n".join(inventory) + "\n"
    if len(inventory_text) > max_chars:
        raise ManifestError("rule inventory exceeds context bound")
    included: list[dict[str, str]] = []
    omitted: list[dict[str, str]] = []
    excerpts: list[str] = []
    remaining = max_chars - len(inventory_text)
    if not include_excerpts:
        omitted = [
            dict(metadata, reason="excerpts_disabled") for metadata, _ in records
        ]
    elif records and remaining > 0:
        # Equal per-rule budgets prevent an early large rule from consuming
        # the entire context before later active canonical rules are visible.
        budget = remaining // len(records)
        for metadata, raw in records:
            header = f"--- Forgewright rule excerpt: {metadata['id']} ({metadata['source']}) ---\n"
            available = budget - len(header) - 1
            if available <= 0:
                omitted.append(dict(metadata, reason="excerpt_budget"))
                continue
            text = raw.decode("utf-8")
            if len(text) > available:
                text = text[: max(0, available - 16)] + "\n...[bounded]"
            chunk = header + text.rstrip() + "\n"
            excerpts.append(chunk)
            included.append(metadata)
    else:
        omitted = [dict(metadata, reason="excerpt_budget") for metadata, _ in records]
    context = inventory_text + "\n".join(excerpts)
    selected = [metadata for metadata, _ in records]
    return {
        "context": context,
        "manifest_sha256": manifest_sha256,
        "inventory": selected,
        "rules": selected,  # compatibility alias for existing callers
        "selected": selected,
        "included": included,
        "omitted": omitted,
    }


def _receipt_name(platform: str, event: str) -> str:
    def safe(value: str) -> str:
        value = "".join(
            character if character.isalnum() or character in "-_" else "_"
            for character in value
        )
        return value[:80] or "unknown"

    return f"{safe(platform.upper())}-{safe(event)}.json"


def _safe_receipt_dir_fallback(root: Path) -> Path:
    root_resolved = root.resolve(strict=True)
    current = root_resolved
    missing: list[Path] = []
    for component in RUNTIME_RELATIVE.parts:
        current = current / component
        if current.exists() or current.is_symlink():
            if current.is_symlink() or not current.is_dir():
                raise ManifestError(f"receipt path component is unsafe: {current}")
            try:
                current.resolve(strict=True).relative_to(root_resolved)
            except (OSError, ValueError) as error:
                raise ManifestError(
                    f"receipt path escapes workspace: {current}"
                ) from error
        else:
            missing.append(current)
    for directory in missing:
        directory.mkdir()
    # Re-check after mkdir to close the normal symlink/component escape path.
    current = root_resolved
    for component in RUNTIME_RELATIVE.parts:
        current = current / component
        if current.is_symlink() or not current.is_dir():
            raise ManifestError(f"receipt path component is unsafe: {current}")
        try:
            current.resolve(strict=True).relative_to(root_resolved)
        except (OSError, ValueError) as error:
            raise ManifestError(f"receipt path escapes workspace: {current}") from error
    return current


def _supports_secure_receipt_dir() -> bool:
    """Return whether this runtime can keep receipt writes anchored by fd."""
    required = ("open", "mkdir", "rename", "unlink", "lstat")
    if not all(hasattr(os, name) for name in required):
        return False
    supports_dir_fd = getattr(os, "supports_dir_fd", set())
    return all(getattr(os, name) in supports_dir_fd for name in required) and hasattr(
        os, "O_NOFOLLOW"
    )


def _open_directory_at(path: Path | str, parent_fd: int | None = None) -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if parent_fd is None:
        fd = os.open(path, flags)
    else:
        fd = os.open(path, flags, dir_fd=parent_fd)
    try:
        if not stat.S_ISDIR(os.fstat(fd).st_mode):
            raise ManifestError(f"receipt path component is not a directory: {path}")
    except BaseException:
        os.close(fd)
        raise
    return fd


def _open_receipt_dir(root: Path) -> tuple[int, Path]:
    """Open/create receipt directories without following a raced symlink."""
    root_resolved = root.resolve(strict=True)
    current_fd = _open_directory_at(root_resolved)
    current_path = root_resolved
    try:
        for component in RUNTIME_RELATIVE.parts:
            try:
                next_fd = _open_directory_at(component, current_fd)
            except FileNotFoundError:
                try:
                    os.mkdir(component, dir_fd=current_fd)
                except FileExistsError:
                    # A concurrent creator is fine; O_NOFOLLOW below still
                    # rejects a concurrent symlink replacement.
                    pass
                except OSError as error:
                    raise ManifestError(
                        f"receipt path component is unsafe: {current_path / component}"
                    ) from error
                try:
                    next_fd = _open_directory_at(component, current_fd)
                except OSError as error:
                    raise ManifestError(
                        f"receipt path component is unsafe: {current_path / component}"
                    ) from error
            except OSError as error:
                raise ManifestError(
                    f"receipt path component is unsafe: {current_path / component}"
                ) from error
            os.close(current_fd)
            current_fd = next_fd
            current_path /= component
        return current_fd, current_path
    except BaseException:
        os.close(current_fd)
        raise


def _safe_receipt_dir(root: Path) -> Path:
    """Validate the receipt path, using fd anchoring where available."""
    if _supports_secure_receipt_dir():
        receipt_fd, receipt_dir = _open_receipt_dir(root)
        os.close(receipt_fd)
        return receipt_dir
    return _safe_receipt_dir_fallback(root)


def _open_receipt_temp(dir_fd: int, target_name: str) -> tuple[int, str]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    candidates = tempfile._get_candidate_names()
    for _ in range(100):
        temporary = f".{target_name}.{next(candidates)}"
        try:
            return os.open(temporary, flags, 0o600, dir_fd=dir_fd), temporary
        except FileExistsError:
            continue
    raise ManifestError("could not allocate a unique receipt temporary file")


def _fdopen_text(descriptor: int):
    """Transfer an fd to a text stream without leaking it on wrap failure."""
    try:
        return os.fdopen(descriptor, "w", encoding="utf-8")
    except BaseException:
        os.close(descriptor)
        raise


def write_receipt(
    root: Path | str, platform: str, event: str, result: dict[str, Any]
) -> Path:
    root = _workspace_root(root)
    payload = {
        "schema_version": "1",
        "platform": platform.upper(),
        "event": event,
        "manifest_sha256": result.get("manifest_sha256", ""),
        "selected": result.get("selected", result.get("rules", [])),
        "included": result.get("included", []),
        "omitted": result.get("omitted", []),
        "context_sha256": _sha256_bytes(result.get("context", "").encode("utf-8")),
    }
    payload["rules"] = payload["selected"]
    target_name = _receipt_name(platform, event)

    if not _supports_secure_receipt_dir():
        receipt_dir = _safe_receipt_dir(root)
        target = receipt_dir / target_name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ManifestError(f"receipt target is unsafe: {target}")
        fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=receipt_dir)
        try:
            with _fdopen_text(fd) as handle:
                json.dump(
                    payload,
                    handle,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
                handle.write("\n")
            os.replace(temporary, target)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        return target

    receipt_fd, receipt_dir = _open_receipt_dir(root)
    temporary: str | None = None
    try:
        try:
            existing = os.lstat(target_name, dir_fd=receipt_fd)
        except FileNotFoundError:
            existing = None
        if existing is not None and (
            stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode)
        ):
            raise ManifestError(
                f"receipt target is unsafe: {receipt_dir / target_name}"
            )
        fd, temporary = _open_receipt_temp(receipt_fd, target_name)
        try:
            with _fdopen_text(fd) as handle:
                json.dump(
                    payload,
                    handle,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
                handle.write("\n")
            # os.rename with dirfds is the portable POSIX spelling available
            # here; rename replaces the destination entry itself, never a
            # symlink target, and remains anchored if the path is raced.
            os.rename(
                temporary,
                target_name,
                src_dir_fd=receipt_fd,
                dst_dir_fd=receipt_fd,
            )
            temporary = None
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary, dir_fd=receipt_fd)
                except OSError:
                    pass
    finally:
        os.close(receipt_fd)
    return receipt_dir / target_name


def native_response(platform: str, event: str, context: str = "") -> dict[str, Any]:
    platform = platform.strip().upper()
    response: dict[str, Any] = {"continue": True}
    if not context:
        return response
    if platform in {"CODEX", "CLAUDE"}:
        response["hookSpecificOutput"] = {
            "hookEventName": event,
            "additionalContext": context,
        }
    elif platform == "GEMINI":
        response["hookSpecificOutput"] = {
            "hookEventName": event,
            "additionalContext": context,
        }
    elif platform == "ANTIGRAVITY":
        response["injectSteps"] = [{"ephemeralMessage": context}]
    elif platform == "CURSOR":
        response["additional_context"] = context
    else:
        response["context"] = context
        response["event"] = event
    return response


def _mode() -> str:
    mode = os.environ.get("FORGEWRIGHT_RULE_HOOK_MODE", "observe").strip().lower()
    return mode if mode in {"off", "observe", "enforce"} else "observe"


def _allow_output(platform: str, event: str) -> None:
    sys.stdout.write(_serialize_native_response(platform, event) + "\n")


def _serialize_native_response(platform: str, event: str, context: str = "") -> str:
    """Serialize a host response under a byte cap, including ASCII escapes."""

    def encode(value: str) -> str:
        return json.dumps(
            native_response(platform, event, value),
            separators=(",", ":"),
            ensure_ascii=True,
        )

    serialized = encode(context)
    if len(serialized.encode("utf-8")) + 1 <= MAX_SERIALIZED_OUTPUT_BYTES:
        return serialized

    marker = "\n...[bounded]"
    excerpt_boundary = context.find("\n--- Forgewright rule excerpt:")
    inventory = context if excerpt_boundary < 0 else context[:excerpt_boundary]
    inventory_only = encode(inventory)
    if len(inventory_only.encode("utf-8")) + 1 > MAX_SERIALIZED_OUTPUT_BYTES:
        # Never emit a partial inventory that could make a later active rule
        # appear absent. An oversized inventory is an invalid operational
        # state, so the host receives the normal fail-open response instead.
        return encode("")
    lower = len(inventory)
    upper = len(context)
    best = inventory_only
    while lower <= upper:
        midpoint = (lower + upper) // 2
        candidate_context = context[:midpoint] + marker
        candidate = encode(candidate_context)
        if len(candidate.encode("utf-8")) + 1 <= MAX_SERIALIZED_OUTPUT_BYTES:
            best = candidate
            lower = midpoint + 1
        else:
            upper = midpoint - 1
    return best


def run_hook(
    platform: str, event: str, raw_input: str, workspace: str | Path | None = None
) -> int:
    """Run one hook invocation; all operational failures are fail-open."""
    try:
        if _mode() == "off":
            _allow_output(platform, event)
            return 0
        if len(raw_input.encode("utf-8", errors="ignore")) > MAX_INPUT_BYTES:
            raise ValueError("hook payload exceeds bounded input size")
        payload = json.loads(raw_input) if raw_input.strip() else {}
        if not isinstance(payload, dict):
            raise ValueError("hook payload must be a JSON object")
        root = _workspace_root(workspace)
        manifest = load_manifest(root)
        selected = select_rules(manifest, platform, event)
        result = build_context(
            root,
            selected,
            max_chars=manifest["defaults"]["max_context_chars"],
            include_excerpts=not (
                platform.strip().upper() == "ANTIGRAVITY"
                and event.strip().casefold() == "preinvocation"
            ),
            manifest_sha256=manifest.get("manifest_sha256", ""),
        )
        try:
            write_receipt(root, platform, event, result)
        except Exception:
            # Receipts are telemetry only and never a reason to block a host.
            pass
        sys.stdout.write(
            _serialize_native_response(platform, event, result["context"]) + "\n"
        )
        return 0
    except Exception:
        _allow_output(platform, event)
        return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", default="")
    parser.add_argument("--event", default="")
    parser.add_argument("--workspace", default=None)
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1).decode("utf-8")
    except (OSError, UnicodeError):
        raw = ""
    return run_hook(args.platform, args.event, raw, args.workspace)


if __name__ == "__main__":
    raise SystemExit(main())
