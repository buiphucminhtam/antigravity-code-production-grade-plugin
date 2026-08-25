#!/usr/bin/env python3
"""Read-only Docs Hub continuity checks for the bounded Stop hook.

This module deliberately does not invoke the Docs CLI and never creates or
updates a manifest, project state, generated site, or receipt.  It only reads
small, project-contained metadata and records one hashed retry token when an
explicit ``enforce`` mode asks the agent to refresh a provably stale build.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MAX_METADATA_BYTES = 512 * 1024
MAX_RECEIPT_BYTES = 256 * 1024
MAX_RETRY_STATE_BYTES = 64 * 1024
MAX_MATERIAL_FILE_BYTES = 2 * 1024 * 1024
MAX_MATERIAL_TOTAL_BYTES = 8 * 1024 * 1024
STATE_TTL_SECONDS = 15 * 60
CHECK_TIMEOUT_SECONDS = 1.0
_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

MISSING_MANIFEST = "docs_manifest_missing"
INVALID_MANIFEST = "docs_manifest_invalid"
MISSING_STATE = "docs_project_state_missing"
INVALID_STATE = "docs_project_state_invalid"
MISSING_RECEIPT = "docs_build_receipt_missing"
INVALID_RECEIPT = "docs_build_receipt_invalid"
STALE_RECEIPT = "docs_build_receipt_stale"
NON_GIT = "docs_workspace_not_git"
MISSING_CLI = "docs_cli_missing"
PATH_ERROR = "docs_path_outside_workspace"
MALFORMED_PAYLOAD = "docs_stop_payload_malformed"
MISSING_MATERIAL = "docs_material_path_missing"

_GENERATED_PREFIXES = (
    ".forgewright/docs-hub/",
    ".forgewright/cache/",
    ".git/",
    ".gitnexus/",
)
_MATERIAL_PREFIXES = (
    "docs/",
    "documentation/",
    "wiki/",
)
_DOCS_TEXT_EXTENSIONS = {".md", ".markdown", ".json", ".yaml", ".yml"}
_DOCS_ASSET_EXTENSIONS = {
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
}
_RECEIPT_RELATIVE_PATHS = (
    ".forgewright/docs-hub/final-build-receipt.json",
    ".forgewright/docs-hub/build-receipt.json",
    ".forgewright/docs-hub/final-build.json",
    ".forgewright/docs-hub/site/.forgewright-docs-hub",
)
_NODE_LOCALE_SORT_SCRIPT = """
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
for (const key of ["documents", "assets"]) {
  if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string")) {
    process.exit(2);
  }
  value[key].sort((left, right) => left.localeCompare(right));
}
process.stdout.write(JSON.stringify(value));
"""


@dataclass(frozen=True)
class ContinuityResult:
    """Small, host-neutral result consumed by ``stop_gate.py``."""

    status: str
    reason: str = ""
    material_paths: tuple[str, ...] = ()
    receipt_path: str = ""

    @property
    def material(self) -> bool:
        return bool(self.material_paths)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _json_compact(value: Any) -> bytes:
    """Match the Docs scanner's insertion-ordered JSON.stringify bytes."""

    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _node_locale_sorted_paths(
    documents: Iterable[str], assets: Iterable[str]
) -> tuple[list[str], list[str]] | None:
    """Match the TypeScript scanner's default-locale ``localeCompare`` order.

    Python's code-point ordering differs for mixed-case and accented paths.
    The scanner is the source of truth, so use the same local Node runtime for
    this bounded, read-only comparison.  No project CLI or network is used;
    unavailable or slow runtimes fail open by declining cache verification.
    """

    values = {"documents": list(documents), "assets": list(assets)}
    try:
        result = subprocess.run(
            ["node", "-e", _NODE_LOCALE_SORT_SCRIPT],
            input=json.dumps(values, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        sorted_values = json.loads(result.stdout)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(sorted_values, dict):
        return None
    output: list[list[str]] = []
    for key in ("documents", "assets"):
        current = sorted_values.get(key)
        original = values[key]
        if (
            not isinstance(current, list)
            or len(current) != len(original)
            or any(not isinstance(item, str) for item in current)
            or set(current) != set(original)
        ):
            return None
        output.append(current)
    return output[0], output[1]


def _mode() -> str:
    raw = os.environ.get(
        "FORGEWRIGHT_DOCS_CONTINUITY_MODE",
        os.environ.get("FORGEWRIGHT_RULE_HOOK_MODE", "observe"),
    )
    value = raw.strip().lower()
    return value if value in {"off", "observe", "enforce"} else "observe"


def _within(root: Path, value: str | Path) -> Path | None:
    """Resolve a path and reject absolute/parent/symlink escapes."""

    candidate = Path(value).expanduser() if isinstance(value, str) else value
    try:
        root_real = root.resolve()
        resolved = (
            candidate.resolve()
            if candidate.is_absolute()
            else (root / candidate).resolve()
        )
        resolved.relative_to(root_real)
        return resolved
    except (OSError, RuntimeError, ValueError):
        return None


def _relative(root: Path, value: Path) -> str:
    return value.resolve().relative_to(root.resolve()).as_posix()


def _regular_contained(root: Path, relative: str) -> Path | None:
    raw = Path(relative).expanduser()
    raw = raw if raw.is_absolute() else root / raw
    try:
        if raw.is_symlink():
            return None
    except OSError:
        return None
    if _has_symlink_component(root, raw):
        return None
    path = _within(root, raw)
    if path is None:
        return None
    try:
        info = path.lstat()
    except OSError:
        return None
    if not path.is_file() or info.st_mode & 0o170000 != 0o100000:
        return None
    return path


def _has_symlink_component(root: Path, path: Path) -> bool:
    """Return whether an existing component between root and path is a link."""

    try:
        # Keep a lexical view to detect a link at the final path, then use a
        # resolved view only for containment.  ``/var`` is commonly a symlink
        # to ``/private/var`` on macOS, so the workspace root itself is not a
        # component we reject.
        root_lexical = root.absolute()
        root_real = root.resolve()
        candidate = path if path.is_absolute() else root_lexical / path
        candidate_lexical = candidate.absolute()
        try:
            relative = candidate_lexical.relative_to(root_lexical)
            component_root = root_lexical
        except ValueError:
            # The caller may already have passed a resolved path while the
            # root was written through a platform alias such as /var.
            relative = candidate_lexical.relative_to(root_real)
            component_root = root_real
    except (OSError, RuntimeError, ValueError):
        return True
    current = component_root
    for component in relative.parts:
        current /= component
        try:
            if current.is_symlink():
                return True
        except OSError:
            return True
    try:
        candidate_lexical.resolve(strict=False).relative_to(root_real)
    except (OSError, RuntimeError, ValueError):
        return True
    return False


def _read_bounded(path: Path, limit: int) -> bytes | None:
    """Read a regular file with a hard pre-read and in-read byte bound.

    ``Path.read_bytes`` first allocates the whole file, so a post-read size
    check is not a meaningful resource bound.  Open with ``O_NOFOLLOW`` when
    available, check the descriptor, and read at most ``limit + 1`` bytes.
    Any mutation during the read is treated as indeterminate rather than
    producing a digest that could be mistaken for verified evidence.
    """

    if limit < 0:
        return None
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    try:
        initial = path.lstat()
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > limit:
            return None
        fd = os.open(path, flags | nofollow)
    except OSError:
        return None
    try:
        opened = os.fstat(fd)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size > limit
            or (opened.st_dev, opened.st_ino) != (initial.st_dev, initial.st_ino)
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
        identity = (opened.st_dev, opened.st_ino)
        if (
            (final.st_dev, final.st_ino) != identity
            or final.st_size != opened.st_size
            or final.st_mtime_ns != opened.st_mtime_ns
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


def _read_json(path: Path, limit: int) -> dict[str, Any] | None:
    try:
        raw = _read_bounded(path, limit)
        if raw is None:
            return None
        value = json.loads(raw.decode("utf-8"))
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        RecursionError,
        MemoryError,
        TypeError,
        ValueError,
    ):
        return None
    return value if isinstance(value, dict) else None


def _native_paths(
    root: Path, payload: dict[str, Any], files: Iterable[str] | None
) -> tuple[list[str], bool]:
    """Return only native Stop paths; never infer materiality from prose."""

    raw = (
        list(files)
        if files is not None
        else payload.get("files", payload.get("changed_files", []))
    )
    if not isinstance(raw, list):
        return [], False
    paths: list[str] = []
    malformed = False
    for item in raw:
        if not isinstance(item, (str, Path)) or not str(item).strip():
            malformed = True
            continue
        path = _within(root, str(item).strip())
        if path is None:
            malformed = True
            continue
        rel = _relative(root, path)
        if rel in {"", "."} or rel.startswith(_GENERATED_PREFIXES):
            continue
        paths.append(rel)
    return list(dict.fromkeys(paths)), malformed


def _manifest(root: Path) -> tuple[dict[str, Any] | None, str]:
    path = _regular_contained(root, ".forgewright/docs-manifest.json")
    if path is None:
        return None, MISSING_MANIFEST
    value = _read_json(path, MAX_METADATA_BYTES)
    if value is None or not isinstance(value.get("project"), dict):
        return None, INVALID_MANIFEST
    project_id = value["project"].get("id")
    if not isinstance(project_id, str) or not _SAFE_NAME.fullmatch(project_id):
        return None, INVALID_MANIFEST
    return value, ""


def _manifest_relative_path(value: Any) -> bool:
    """Match the manifest's relative-path contract before resolving it."""

    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.replace("\\", "/")
    if (
        normalized != value
        or "\x00" in normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:/", normalized) is not None
    ):
        return False
    return ".." not in normalized.split("/")


def _scanner_path(value: Any) -> str | None:
    """Normalize a manifest path exactly as the scanner does."""

    if not _manifest_relative_path(value):
        return None
    normalized = unicodedata.normalize("NFC", value).replace("\\", "/")
    normalized = re.sub(r"/+", "/", normalized)
    normalized = re.sub(r"^\./+", "", normalized)
    parts = [part for part in normalized.split("/") if part != "."]
    return "/".join(parts) or None


def _manifest_source_specs(
    root: Path, manifest: dict[str, Any]
) -> tuple[list[dict[str, Any]], str]:
    """Return validated source roots and their scanner include/exclude rules."""

    raw_sources = manifest.get("sources", [])
    if not isinstance(raw_sources, list):
        return [], INVALID_MANIFEST
    sources: list[dict[str, Any]] = []
    for source in raw_sources:
        if not isinstance(source, dict):
            return [], INVALID_MANIFEST
        raw_path = source.get("path")
        if not _manifest_relative_path(raw_path):
            return [], PATH_ERROR
        included = source.get("include", [])
        excluded = source.get("exclude", [])
        if not isinstance(included, list) or not all(
            isinstance(item, str) and item for item in included
        ):
            return [], INVALID_MANIFEST
        if not isinstance(excluded, list) or not all(
            isinstance(item, str) and item for item in excluded
        ):
            return [], INVALID_MANIFEST
        resolved = _within(root, raw_path)
        if resolved is None:
            return [], PATH_ERROR
        sources.append(
            {
                "path": _relative(root, resolved).rstrip("/"),
                "type": source.get("type"),
                "include": list(included),
                "exclude": list(excluded),
            }
        )
    return sources, ""


def _manifest_privacy(
    manifest: dict[str, Any], source_specs: list[dict[str, Any]]
) -> tuple[list[str], list[str], str]:
    """Resolve the scanner's allowlist/exclude defaults and path semantics."""

    raw_privacy = manifest.get("privacy")
    if raw_privacy is None:
        return [source["path"] for source in source_specs], [], ""
    if not isinstance(raw_privacy, dict) or raw_privacy.get("mode") != "allowlist":
        return [], [], INVALID_MANIFEST
    raw_allow = raw_privacy.get("allow")
    raw_exclude = raw_privacy.get("exclude", [])
    if raw_allow is not None and not isinstance(raw_allow, list):
        return [], [], INVALID_MANIFEST
    if not isinstance(raw_exclude, list):
        return [], [], INVALID_MANIFEST
    allow_values = (
        [source["path"] for source in source_specs] if raw_allow is None else raw_allow
    )
    allow: list[str] = []
    exclude: list[str] = []
    for target, values in ((allow, allow_values), (exclude, raw_exclude)):
        for value in values:
            normalized = _scanner_path(value)
            if normalized is None:
                return [], [], PATH_ERROR
            target.append(normalized)
    return allow, exclude, ""


_SENSITIVE_SEGMENTS = {
    ".git",
    ".hg",
    ".svn",
    ".ssh",
    ".aws",
    ".gnupg",
    ".worktrees",
    "credentials",
    "credential",
    "secrets",
    "secret",
    "keystore",
    "node_modules",
}


def _sensitive_path(relative: str) -> bool:
    segments = relative.lower().split("/")
    basename = segments[-1] if segments else ""
    if any(segment in _SENSITIVE_SEGMENTS for segment in segments):
        return True
    if segments and segments[0] == ".forgewright":
        if relative.lower() not in {
            ".forgewright/docs-manifest.json",
            ".forgewright/project-profile.json",
            ".forgewright/project.json",
            ".forgewright/code-conventions.md",
        }:
            return True
    return any(
        re.search(pattern, basename, flags=re.IGNORECASE) is not None
        for pattern in (
            r"^\.env(?:\.|$)",
            r"(?:^|[-_.])(secret|credentials?|private[-_.]?key)(?:[-_.]|$)",
            r"\.(?:pem|key|p8|p12|jks|keystore)$",
            r"^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$",
        )
    )


def _privacy_allowed(relative: str, allow: list[str], exclude: list[str]) -> bool:
    """Mirror ``isAllowedByPrivacy`` for one already-bounded catalog path."""

    normalized = _scanner_path(relative)
    if normalized is None or _sensitive_path(normalized):
        return False

    def matches(pattern: str) -> bool:
        return (
            normalized == pattern
            or normalized.startswith(pattern.rstrip("/") + "/")
            or _glob_matches(normalized, pattern)
        )

    if any(matches(pattern) for pattern in exclude):
        return False
    return any(matches(pattern) for pattern in allow)


def _manifest_paths(root: Path, manifest: dict[str, Any]) -> tuple[set[str], str]:
    material: set[str] = set()
    project_docs = manifest.get("project_docs")
    if isinstance(project_docs, dict):
        state = project_docs.get("state")
        if not _manifest_relative_path(state):
            return material, PATH_ERROR
        if isinstance(state, str) and state.strip():
            state_path = _within(root, state)
            if state_path is None:
                return material, PATH_ERROR
            material.add(_relative(root, state_path))
    truth = manifest.get("truth", [])
    if not isinstance(truth, list):
        return material, INVALID_MANIFEST
    for item in truth:
        if not _manifest_relative_path(item):
            return material, PATH_ERROR
        path = _within(root, item)
        if path is None:
            return material, PATH_ERROR
        material.add(_relative(root, path).rstrip("/"))
    sources, source_error = _manifest_source_specs(root, manifest)
    if source_error:
        return material, source_error
    for source in sources:
        material.add(source["path"])
    return material, ""


def _glob_matches(path: str, glob: str) -> bool:
    """Match the bounded scanner glob syntax without filesystem access."""

    normalized_path = path.replace("\\", "/")
    normalized_glob = glob.replace("\\", "/").removeprefix("./")
    pattern: list[str] = []
    index = 0
    while index < len(normalized_glob):
        char = normalized_glob[index]
        if char == "*":
            if index + 1 < len(normalized_glob) and normalized_glob[index + 1] == "*":
                index += 1
                if (
                    index + 1 < len(normalized_glob)
                    and normalized_glob[index + 1] == "/"
                ):
                    index += 1
                    pattern.append("(?:.*/)?")
                else:
                    pattern.append(".*")
            else:
                pattern.append("[^/]*")
        elif char == "?":
            pattern.append("[^/]")
        else:
            pattern.append(re.escape(char))
        index += 1
    try:
        return re.fullmatch("".join(pattern), normalized_path) is not None
    except (re.error, TypeError):
        return False


def _catalog_relative_path(value: Any) -> str | None:
    """Accept only scanner-normalized, project-relative catalog paths."""

    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("\\", "/")
    if (
        normalized != value
        or "\x00" in normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:/", normalized) is not None
    ):
        return None
    parts = normalized.split("/")
    if not parts or any(not part or part in {".", ".."} for part in parts):
        return None
    return normalized


def _catalog_source_file(root: Path, source_path: str) -> tuple[Path | None, str]:
    """Validate a catalog source path and classify missing files as stale."""

    normalized = _catalog_relative_path(source_path)
    if normalized is None:
        return None, "invalid"
    candidate = root / normalized
    if _has_symlink_component(root, candidate):
        return None, "invalid"
    path = _regular_contained(root, normalized)
    if path is not None:
        try:
            if path.stat().st_size > MAX_MATERIAL_FILE_BYTES:
                return None, "invalid"
        except OSError:
            return None, "invalid"
        return path, "ok"
    try:
        info = candidate.lstat()
    except FileNotFoundError:
        return None, "stale"
    except OSError:
        return None, "invalid"
    # An existing but unsafe/non-regular path is malformed catalog metadata;
    # a missing regular source is merely a stale scan.
    if info.st_mode & 0o170000 != 0o100000:
        return None, "invalid"
    return None, "invalid"


def _catalog_source_allowed(
    root: Path,
    source_path: str,
    source_specs: list[dict[str, Any]],
    allow: list[str],
    exclude: list[str],
    source_type: str | None = None,
) -> bool:
    """Ensure catalog entries still belong to the current manifest sources."""

    for source in source_specs:
        source_root = source["path"]
        if source_path == source_root:
            relative_to_source = Path(source_path).name
        elif source_path.startswith(source_root.rstrip("/") + "/"):
            relative_to_source = source_path[len(source_root.rstrip("/")) + 1 :]
        else:
            continue
        if source_type is not None and source.get("type") != source_type:
            continue
        root_path = _regular_contained(root, source_root)
        if root_path is not None and root_path.is_file() and source_path != source_root:
            continue
        source_include = source.get("include", [])
        source_exclude = source.get("exclude", [])
        if source_include and not any(
            _glob_matches(relative_to_source, item) for item in source_include
        ):
            continue
        if any(_glob_matches(relative_to_source, item) for item in source_exclude):
            continue
        if not _privacy_allowed(source_path, allow, exclude):
            continue
        return True
    return False


def _manifest_truth_paths(
    root: Path, manifest: dict[str, Any]
) -> tuple[list[str], str]:
    raw_truth = manifest.get("truth", [])
    if not isinstance(raw_truth, list):
        return [], INVALID_MANIFEST
    result: list[str] = []
    for item in raw_truth:
        if not _manifest_relative_path(item):
            return [], PATH_ERROR
        resolved = _within(root, item)
        if resolved is None:
            return [], PATH_ERROR
        result.append(_relative(root, resolved))
    return result, ""


def _is_material(
    rel: str, manifest_paths: set[str], *, legacy_prefixes: bool = False
) -> bool:
    normalized = rel.replace("\\", "/").lstrip("./")
    if normalized == ".forgewright/docs-manifest.json":
        return True
    if normalized in manifest_paths:
        return True
    if legacy_prefixes and any(
        normalized.startswith(prefix) for prefix in _MATERIAL_PREFIXES
    ):
        return True
    return any(
        normalized.startswith(path.rstrip("/") + "/") for path in manifest_paths if path
    )


def _git_available(root: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode != 0 or not result.stdout.strip():
        return False
    try:
        return Path(result.stdout.strip()).resolve() == root.resolve()
    except (OSError, RuntimeError):
        return False


def _receipt_candidates(root: Path) -> list[Path]:
    configured = os.environ.get("FORGEWRIGHT_DOCS_BUILD_RECEIPT", "").strip()
    candidates: list[Path] = []
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = root / path
        if _within(root, path) is not None:
            candidates.append(path)
        else:
            # Keep a sentinel outside the workspace out of file access; the
            # caller reports it as an infrastructure/path error.
            candidates.append(Path("/forgewright-invalid-receipt"))
    candidates.extend(
        root / relative
        for relative in _RECEIPT_RELATIVE_PATHS
        if _within(root, root / relative) is not None
    )
    return list(dict.fromkeys(candidates))


def _cache_state(
    root: Path, manifest: dict[str, Any], material: list[str]
) -> tuple[str, str]:
    """Read the bounded canonical catalog and bind it to current sources."""

    path = _regular_contained(root, ".forgewright/cache/docs-index.json")
    if path is None:
        return "invalid", ""
    catalog = _read_json(path, MAX_METADATA_BYTES)
    if catalog is None or catalog.get("schema_version") != 1:
        return "invalid", ""
    project = catalog.get("project")
    if not isinstance(project, dict) or project.get("id") != manifest["project"].get(
        "id"
    ):
        return "invalid", ""
    root_value = project.get("root")
    if not isinstance(root_value, str):
        return "invalid", ""
    try:
        if Path(root_value).resolve() != root.resolve():
            return "invalid", ""
    except (OSError, RuntimeError):
        return "invalid", ""
    source_fingerprint = catalog.get("sourceFingerprint")
    if not _valid_hash(source_fingerprint):
        return "invalid", ""
    source_specs, source_error = _manifest_source_specs(root, manifest)
    if source_error:
        return "invalid", ""
    allow, exclude, privacy_error = _manifest_privacy(manifest, source_specs)
    if privacy_error:
        return "invalid", ""
    current_truth, truth_error = _manifest_truth_paths(root, manifest)
    if truth_error:
        return "invalid", ""
    current_project = manifest.get("project")
    if not isinstance(current_project, dict):
        return "invalid", ""
    if project.get("title") != current_project.get("title"):
        return "stale", source_fingerprint
    cached_truth = project.get("truthDocuments")
    if cached_truth != current_truth:
        return "stale", source_fingerprint
    current_project_docs = manifest.get("project_docs")
    current_state_raw = (
        current_project_docs.get("state")
        if isinstance(current_project_docs, dict)
        else "docs/project-state.json"
    )
    if not _manifest_relative_path(current_state_raw):
        return "invalid", ""
    current_state = _within(root, current_state_raw)
    if current_state is None:
        return "invalid", ""
    current_state_path = _relative(root, current_state)
    if project.get("statePath") != current_state_path:
        return "stale", source_fingerprint
    documents = catalog.get("documents")
    assets = catalog.get("assets")
    if not isinstance(documents, list) or not isinstance(assets, list):
        return "invalid", ""
    document_hashes: dict[str, str] = {}
    asset_hashes: dict[str, str] = {}
    seen_source_paths: set[str] = set()
    for values, target, extensions in (
        (documents, document_hashes, _DOCS_TEXT_EXTENSIONS),
        (assets, asset_hashes, _DOCS_ASSET_EXTENSIONS),
    ):
        for item in values:
            if not isinstance(item, dict):
                return "invalid", ""
            source_path = item.get("sourcePath")
            content_hash = item.get("contentHash")
            if not isinstance(source_path, str) or not _valid_hash(content_hash):
                return "invalid", ""
            normalized_source_path = _catalog_relative_path(source_path)
            if normalized_source_path is None:
                return "invalid", ""
            if Path(normalized_source_path).suffix.lower() not in extensions:
                # The scanner only emits these bounded document/asset types;
                # a catalog entry for executable/source code cannot weaken the
                # Stop gate's code validation.
                return "invalid", ""
            catalog_type = item.get("type") if values is documents else None
            if catalog_type is not None and not isinstance(catalog_type, str):
                return "invalid", ""
            source_file, source_status = _catalog_source_file(
                root, normalized_source_path
            )
            if source_status == "invalid":
                return "invalid", ""
            if source_status == "stale":
                return "stale", source_fingerprint
            if source_file is None or not _catalog_source_allowed(
                root,
                normalized_source_path,
                source_specs,
                allow,
                exclude,
                catalog_type,
            ):
                return "stale", source_fingerprint
            if normalized_source_path in seen_source_paths:
                return "invalid", ""
            seen_source_paths.add(normalized_source_path)
            target[normalized_source_path] = content_hash
    state_path = project.get("statePath")
    state_hash = project.get("stateHash")
    if not isinstance(state_path, str) or not _valid_hash(state_hash):
        return "invalid", ""
    if not _privacy_allowed(state_path, allow, exclude):
        return "stale", source_fingerprint
    current_state = _regular_contained(root, state_path)
    if current_state is None:
        return "stale", source_fingerprint
    try:
        if current_state.stat().st_size > MAX_MATERIAL_FILE_BYTES:
            return "invalid", ""
    except OSError:
        return "invalid", ""
    state_bytes = _read_bounded(current_state, MAX_MATERIAL_FILE_BYTES)
    if state_bytes is None:
        return "invalid", ""
    if _sha256(state_bytes) != state_hash:
        return "stale", source_fingerprint
    total_bytes = 0
    for relative in material:
        current = _regular_contained(root, relative)
        if current is None:
            return "stale", source_fingerprint
        try:
            size = current.stat().st_size
        except OSError:
            return "invalid", ""
        if size > MAX_MATERIAL_FILE_BYTES:
            return "invalid", ""
        total_bytes += size
        if total_bytes > MAX_MATERIAL_TOTAL_BYTES:
            return "invalid", ""
    facts = project.get("facts")
    git = facts.get("git") if isinstance(facts, dict) else None
    cached_commit = git.get("commit") if isinstance(git, dict) else None
    adapters = manifest.get("adapters")
    if adapters is not None and not isinstance(adapters, dict):
        return "invalid", ""
    if isinstance(adapters, dict) and any(
        key in adapters and not isinstance(adapters[key], bool)
        for key in ("git", "gitnexus", "evidence_summary")
    ):
        return "invalid", ""
    git_enabled = not isinstance(adapters, dict) or adapters.get("git") is not False
    gitnexus_enabled = isinstance(adapters, dict) and adapters.get("gitnexus") is True
    if git_enabled and cached_commit is None:
        return "stale", source_fingerprint
    if not git_enabled and cached_commit is not None:
        return "stale", source_fingerprint
    if cached_commit is not None and not isinstance(cached_commit, str):
        return "invalid", ""
    gitnexus = facts.get("gitnexus") if isinstance(facts, dict) else None
    cached_indexed_commit = (
        gitnexus.get("indexedCommit") if isinstance(gitnexus, dict) else None
    )
    if cached_indexed_commit is not None and not isinstance(cached_indexed_commit, str):
        return "invalid", ""
    if not gitnexus_enabled and cached_indexed_commit is not None:
        return "stale", source_fingerprint
    if cached_commit is not None:
        try:
            current_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=CHECK_TIMEOUT_SECONDS,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return "stale", source_fingerprint
        if (
            current_commit.returncode != 0
            or current_commit.stdout.strip() != cached_commit
        ):
            return "stale", source_fingerprint
    for relative in material:
        current = _regular_contained(root, relative)
        if current is None:
            return "stale", source_fingerprint
        content = _read_bounded(current, MAX_MATERIAL_FILE_BYTES)
        if content is None:
            return "invalid", ""
        expected = _sha256(content)
        if relative == ".forgewright/docs-manifest.json":
            # The scanner fingerprint records the normalized manifest effects,
            # not the manifest bytes. Cache/receipt mtimes below prove the
            # catalog was rebuilt after this file changed.
            continue
        if relative == state_path:
            cached = state_hash
        elif relative in document_hashes:
            cached = document_hashes[relative]
        elif relative in asset_hashes:
            cached = asset_hashes[relative]
        else:
            return "stale", source_fingerprint
        if expected != cached:
            return "stale", source_fingerprint
    ordered_paths = _node_locale_sorted_paths(document_hashes, asset_hashes)
    if ordered_paths is None:
        return "invalid", ""
    ordered_documents, ordered_assets = ordered_paths
    canonical = {
        "manifest": ".forgewright/docs-manifest.json",
        "project": {
            "id": project.get("id"),
            "title": project.get("title"),
            "truth": project.get("truthDocuments"),
        },
        "documents": [
            [relative, document_hashes[relative]] for relative in ordered_documents
        ],
        "assets": [[relative, asset_hashes[relative]] for relative in ordered_assets],
        "git": cached_commit,
        "gitnexus": (
            facts.get("gitnexus", {}).get("indexedCommit")
            if isinstance(facts, dict) and isinstance(facts.get("gitnexus"), dict)
            else None
        ),
        "projectState": {"path": state_path, "hash": state_hash},
    }
    if _sha256(_json_compact(canonical)) != source_fingerprint:
        return "invalid", ""
    try:
        material_mtime = max(
            (
                _regular_contained(root, item).stat().st_mtime
                for item in material
                if _regular_contained(root, item) is not None
            ),
            default=0.0,
        )
        if path.stat().st_mtime + 0.001 < material_mtime:
            return "stale", source_fingerprint
    except OSError:
        return "stale", source_fingerprint
    return "ok", source_fingerprint


def _valid_hash(value: Any) -> bool:
    return isinstance(value, str) and _SHA256.fullmatch(value) is not None


def _receipt_fingerprint_matches(
    value: dict[str, Any], project_id: str, expected: str
) -> bool:
    """Bind a structurally valid receipt to the current project material."""

    if value.get("schema") == "forgewright-docs-hub":
        fingerprints = value.get("source_fingerprints")
        return isinstance(fingerprints, list) and any(
            isinstance(item, dict)
            and item.get("project_id") == project_id
            and item.get("fingerprint") == expected
            for item in fingerprints
        )
    hashes = [
        value.get(key)
        for key in ("source_hash", "source_fingerprint", "fingerprint", "tree_sha")
        if value.get(key) is not None
    ]
    return any(item == expected for item in hashes)


def _receipt_valid(
    value: dict[str, Any],
    manifest: dict[str, Any],
    expected_fingerprint: str | None = None,
) -> bool:
    """Validate receipt shape and, when supplied, its current source hash.

    A marker is not evidence merely because it contains a non-empty string.
    The ownership list must contain a flat, exact project entry with a real
    SHA-256.  ``expected_fingerprint`` is produced from current material and
    binds that entry to this workspace rather than accepting a copied marker.
    """

    schema = value.get("schema")
    if schema == "forgewright-docs-hub":
        if value.get("schema_version") != 1:
            return False
        project_id = manifest["project"]["id"]
        fingerprints = value.get("source_fingerprints")
        if not isinstance(fingerprints, list) or not fingerprints:
            return False
        matching = 0
        for item in fingerprints:
            if not isinstance(item, dict):
                return False
            item_project = item.get("project_id")
            fingerprint = item.get("fingerprint")
            if not isinstance(item_project, str) or not _valid_hash(fingerprint):
                return False
            if item_project == project_id:
                matching += 1
        return matching == 1
    if isinstance(schema, str) and schema.startswith("forgewright-docs-build-receipt/"):
        status = value.get("status", value.get("build_status"))
        if status not in {"pass", "passed", "ok", "success", "verified"}:
            return False
        project_id = value.get("project_id", value.get("project"))
        if project_id is not None and project_id != manifest["project"]["id"]:
            return False
        hashes = [
            value.get(key)
            for key in ("source_hash", "source_fingerprint", "fingerprint", "tree_sha")
            if value.get(key) is not None
        ]
        if not hashes or any(not _valid_hash(item) for item in hashes):
            return False
        return expected_fingerprint is None or _receipt_fingerprint_matches(
            value, manifest["project"]["id"], expected_fingerprint
        )
    return False


def _receipt_timestamp(value: dict[str, Any]) -> float | None:
    for key in ("built_at", "timestamp"):
        raw = value.get(key)
        if not isinstance(raw, str) or not raw.strip():
            continue
        try:
            return (
                datetime.fromisoformat(raw.replace("Z", "+00:00"))
                .astimezone(timezone.utc)
                .timestamp()
            )
        except (TypeError, ValueError, OverflowError):
            return None
    return None


def _receipt_state(
    root: Path, manifest: dict[str, Any], material: list[str]
) -> tuple[str, str, str]:
    candidates = _receipt_candidates(root)
    if any(str(path).startswith("/forgewright-invalid") for path in candidates):
        return "infra", PATH_ERROR, ""
    existing: list[Path] = []
    for path in candidates:
        safe_path = _within(root, path)
        if safe_path is None:
            return "infra", PATH_ERROR, ""
        try:
            info = path.lstat()
        except OSError:
            continue
        if info.st_mode & 0o170000 == 0o120000 or _has_symlink_component(root, path):
            return "infra", INVALID_RECEIPT, ""
        if not safe_path.is_file():
            return "infra", INVALID_RECEIPT, ""
        existing.append(safe_path)
    if not existing:
        return "missing", MISSING_RECEIPT, ""
    cache_status, expected = _cache_state(root, manifest, material)
    if cache_status == "invalid" or not expected:
        return "infra", INVALID_RECEIPT, ""
    for path in existing:
        value = _read_json(path, MAX_RECEIPT_BYTES)
        if value is None or not _receipt_valid(value, manifest):
            continue
        if cache_status == "stale":
            return "stale", STALE_RECEIPT, _relative(root, path)
        if not _receipt_fingerprint_matches(value, manifest["project"]["id"], expected):
            return "stale", STALE_RECEIPT, _relative(root, path)
        try:
            receipt_mtime = path.stat().st_mtime
            material_mtime = max(
                (
                    _regular_contained(root, item).stat().st_mtime
                    for item in material
                    if _regular_contained(root, item) is not None
                ),
                default=0.0,
            )
        except OSError:
            continue
        if receipt_mtime + 0.001 < material_mtime:
            return "stale", STALE_RECEIPT, _relative(root, path)
        built_at = _receipt_timestamp(value)
        if built_at is not None and built_at + 0.001 < material_mtime:
            return "stale", STALE_RECEIPT, _relative(root, path)
        return "ok", "", _relative(root, path)
    return "infra", INVALID_RECEIPT, ""


def _state_dir(root: Path) -> Path | None:
    configured = os.environ.get("FORGEWRIGHT_DOCS_CONTINUITY_STATE_DIR", "").strip()
    if configured:
        raw = Path(configured).expanduser()
        lexical = raw if raw.is_absolute() else root / raw
        if _has_symlink_component(root, lexical):
            return None
        candidate = _within(root, lexical)
        if candidate is None:
            return None
        return candidate
    default = root / ".forgewright" / "runtime" / "docs-continuity"
    return None if _has_symlink_component(root, default) else default


def _state_path_safe(root: Path, path: Path, *, directory: bool = False) -> bool:
    if _has_symlink_component(root, path):
        return False
    try:
        info = path.lstat()
    except OSError:
        return not path.exists()
    if directory:
        return stat.S_ISDIR(info.st_mode)
    return stat.S_ISREG(info.st_mode)


def _retry_scope(root: Path, payload: dict[str, Any], material: Iterable[str]) -> str:
    identity = {
        "workspace": _sha256(str(root.resolve()).encode()),
        "session": str(payload.get("session_id", ""))[:256],
        "material": sorted(set(material)),
    }
    return _sha256(_canonical(identity))


def _retry_once(root: Path, payload: dict[str, Any], material: Iterable[str]) -> bool:
    directory = _state_dir(root)
    if directory is None:
        return False
    try:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not _state_path_safe(root, directory, directory=True):
            return False
        os.chmod(directory, 0o700)
        scope = _retry_scope(root, payload, material)
        path = directory / f"{scope}.json"
        lock_path = directory / ".lock"
        if _has_symlink_component(root, lock_path):
            return False
        lock_flags = (
            os.O_RDWR
            | os.O_CREAT
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        lock_fd = os.open(lock_path, lock_flags, 0o600)
        try:
            lock = os.fdopen(lock_fd, "r+", encoding="utf-8")
        except BaseException:
            os.close(lock_fd)
            raise
        with lock:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                if path.exists() and not _state_path_safe(root, path):
                    return False
                value = (
                    _read_json(path, MAX_RETRY_STATE_BYTES) if path.exists() else None
                )
                if (
                    value
                    and float(value.get("updated_at", 0.0) or 0.0) + STATE_TTL_SECONDS
                    >= time.time()
                ):
                    return False
                payload = {"attempts": 1, "scope": scope, "updated_at": time.time()}
                fd, raw_temp = tempfile.mkstemp(prefix=f".{scope}.", dir=directory)
                temp = Path(raw_temp)
                try:
                    os.fchmod(fd, 0o600)
                    with os.fdopen(fd, "w", encoding="utf-8") as stream:
                        json.dump(
                            payload, stream, sort_keys=True, separators=(",", ":")
                        )
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temp, path)
                finally:
                    temp.unlink(missing_ok=True)
                return True
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    except (OSError, ValueError, TypeError, OverflowError):
        # A persistence failure is infrastructure, not permission to block a
        # host Stop event.  The caller will emit UNVERIFIED and allow stop.
        return False


def check_continuity(
    root: Path,
    payload: dict[str, Any] | Any,
    *,
    files: Iterable[str] | None = None,
) -> ContinuityResult:
    """Check Docs Hub metadata without invoking a build or mutating sources."""

    mode = _mode()
    if mode == "off":
        return ContinuityResult("off")
    if not isinstance(payload, dict):
        return ContinuityResult("unverified", MALFORMED_PAYLOAD)
    native, malformed = _native_paths(root, payload, files)
    if malformed:
        return ContinuityResult("unverified", PATH_ERROR)
    manifest, manifest_error = _manifest(root)
    # Without a manifest there is no confidently resolved Docs Hub contract.
    # A native docs path still deserves a non-blocking diagnostic in enforce.
    if not native:
        return ContinuityResult("irrelevant")
    if manifest is None:
        # A missing manifest keeps the legacy docs roots as a non-blocking
        # hint.  A present manifest must be the source of truth below.
        material = [
            path for path in native if _is_material(path, set(), legacy_prefixes=True)
        ]
        if not material:
            return ContinuityResult("irrelevant")
        return ContinuityResult("unverified", manifest_error, tuple(material))
    manifest_paths, path_error = _manifest_paths(root, manifest)
    material = [path for path in native if _is_material(path, manifest_paths)]
    if path_error:
        # Keep the manifest itself in scope so an invalid manifest cannot
        # silently turn a docs Stop into a verified no-code event.
        if ".forgewright/docs-manifest.json" in native:
            material = [".forgewright/docs-manifest.json", *material]
        return ContinuityResult("unverified", path_error, tuple(material))
    if not material:
        return ContinuityResult("irrelevant")
    for relative in material:
        path = _regular_contained(root, relative)
        if path is None:
            return ContinuityResult("unverified", MISSING_MATERIAL, tuple(material))
    if not _git_available(root):
        return ContinuityResult("unverified", NON_GIT, tuple(material))
    project_docs = manifest.get("project_docs")
    state_raw = (
        project_docs.get("state")
        if isinstance(project_docs, dict)
        else "docs/project-state.json"
    )
    if not isinstance(state_raw, str) or not state_raw.strip():
        return ContinuityResult("unverified", INVALID_STATE, tuple(material))
    state_path = _regular_contained(root, state_raw)
    if state_path is None:
        return ContinuityResult("unverified", MISSING_STATE, tuple(material))
    state = _read_json(state_path, MAX_METADATA_BYTES)
    if state is None:
        return ContinuityResult("unverified", INVALID_STATE, tuple(material))
    configured_cli = os.environ.get("FORGEWRIGHT_DOCS_CLI", "").strip()
    if configured_cli:
        cli = _within(root, configured_cli)
        if cli is None or not cli.is_file() or not os.access(cli, os.X_OK):
            return ContinuityResult("unverified", MISSING_CLI, tuple(material))
    receipt_status, receipt_reason, receipt_path = _receipt_state(
        root, manifest, material
    )
    if receipt_status == "ok":
        return ContinuityResult("verified", "", tuple(material), receipt_path)
    if mode == "observe":
        return ContinuityResult(
            "observe", receipt_reason, tuple(material), receipt_path
        )
    # Missing/invalid infrastructure is explicitly fail-open.  A refresh is
    # requested only for a confidently material change with a receipt that is
    # present but provably stale; this avoids retry storms on an uninitialised
    # or partially migrated project.
    if receipt_status in {"infra", "missing"}:
        return ContinuityResult(
            "unverified", receipt_reason, tuple(material), receipt_path
        )
    if _retry_once(root, payload, material):
        return ContinuityResult("retry", receipt_reason, tuple(material), receipt_path)
    return ContinuityResult(
        "unverified",
        f"{receipt_reason}_retry_suppressed",
        tuple(material),
        receipt_path,
    )
