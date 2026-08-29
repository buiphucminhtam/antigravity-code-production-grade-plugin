#!/usr/bin/env python3
"""Fail-closed validator for exact Forgewright v2 evidence records."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_common import (
    FINAL_PHASES,
    SCHEMA_VERSION,
    STRONG_TIERS,
    acceptance_map,
    acceptance_test_map,
    changed_files,
    command_errors,
    contains_secret,
    hard_signal,
    link_values,
    negative_path_map,
    nontrivial_reviewer_id,
    parse_timestamp,
    phase_errors,
    read_evidence_bytes,
    read_evidence_json,
    redact,
    resolve_evidence_link,
    schema_errors,
    sha256_text,
    execution_manifest,
    worktree_fingerprint,
)


STALENESS_SECS = int(os.environ.get("FORGEWRIGHT_STALENESS_SECS", "3600"))
REVIEW_SCHEMA = "review-2"
REVIEW_NAMESPACE = "forgewright-review-v2"
KEYLESS_TRUST_LIMITATION = (
    "Keyless review binds exact evidence but does not authenticate reviewer identity "
    "against same-user forgery."
)
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024
MAX_REVIEW_BYTES = 256 * 1024
MAX_REPLAY_TIMEOUT_SECS = 300.0
DEFAULT_REPLAY_TIMEOUT_SECS = 300.0
MAX_REPLAY_DETAIL_CHARS = 4096

_FORGED_OUTPUT_PATTERNS = [
    re.compile(r"^\[REDACTED\]$", re.MULTILINE),
    re.compile(r"^<output>$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^placeholder$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^TODO$", re.MULTILINE),
    re.compile(r"^N/A$", re.MULTILINE),
]
_STUB_PATTERN = re.compile(r"\b(TODO|FIXME|NotImplementedError)\b")
_BINARY_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".whl",
    ".so",
    ".dylib",
    ".exe",
    ".db",
    ".sqlite",
}
_SKIP_STUB_PREFIXES = ("scripts/lite/", ".forgewright/", ".gitnexus/", ".forgenexus/")
_SKIP_STUB_EXTS = {".md", ".txt", ".json", ".yaml", ".yml", ".ini", ".cfg", ".toml"}
_STUB_EXTS = _SKIP_STUB_EXTS
_SECRET_ENV_NAME = re.compile(
    r"(?:^|_)(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET(?:[_-]?KEY)?|TOKEN|"
    r"PASSWORD|PASSWD|CREDENTIALS?|PRIVATE[_-]?KEY|AUTH(?:ORIZATION)?)(?:_|$)",
    re.IGNORECASE,
)


def _log(label: str, msg: str, *, err: bool = False) -> None:
    color = "\033[0;31m" if err else "\033[0;32m"
    reset = "\033[0m"
    print(
        f"{color}[VERIFY-GATE]{reset} {label}: {msg}",
        file=sys.stderr if err else sys.stdout,
    )


def _ok(msg: str) -> None:
    _log("OK", msg)


def _err(msg: str) -> None:
    _log("ERROR", msg, err=True)


def _warn(msg: str) -> None:
    _log("WARNING", msg, err=True)


def _workspace() -> Path:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip()).resolve()
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.cwd().resolve()


def _current_tree_sha(workspace: Path) -> str:
    return worktree_fingerprint(workspace)


def _find_evidence(project_root: Path, turn_env: str) -> Path | None:
    verify_dir = project_root.resolve() / ".forgewright" / "verify"
    if turn_env:
        if Path(turn_env).name != turn_env or any(
            part in {".", ".."} for part in Path(turn_env).parts
        ):
            return None
        candidate = verify_dir / f"{turn_env}.json"
        try:
            read_evidence_json(project_root, candidate)
        except ValueError:
            return None
        return candidate
    try:
        for directory in (verify_dir.parent, verify_dir):
            info = directory.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                return None
    except OSError:
        return None
    files: list[tuple[int, Path]] = []
    for path in verify_dir.glob("*.json"):
        try:
            info = path.lstat()
        except OSError:
            continue
        if stat.S_ISREG(info.st_mode):
            files.append((info.st_mtime_ns, path))
    files.sort(key=lambda item: item[0], reverse=True)
    current_tree = _current_tree_sha(project_root)
    for _, path in files:
        try:
            candidate = read_evidence_json(project_root, path)
        except ValueError:
            continue
        if (
            candidate.get("schema_version") == SCHEMA_VERSION
            and candidate.get("phase") in FINAL_PHASES
            and candidate.get("exit_code") == 0
            and not schema_errors(candidate)
            and not _validate_output(candidate)
            and not _validate_staleness(candidate)
            and not _validate_workspace(candidate, project_root)
            and not _validate_tree(candidate, current_tree)
        ):
            return path
    return None


def _validate_schema(ev: dict) -> list[str]:
    """Return structural diagnostics; v1 is explicitly never a completion record."""
    return schema_errors(ev)


def _validate_output(ev: dict) -> list[str]:
    errors: list[str] = []
    output = ev.get("output")
    if not isinstance(output, str):
        return ["FORGED: 'output' must be a string"]
    if not output.strip():
        errors.append(
            "FORGED: 'output' is empty — evidence did not prove a command ran"
        )
    for pattern in _FORGED_OUTPUT_PATTERNS:
        if pattern.search(output):
            errors.append(
                f"FORGED: output matches forged-shape pattern {pattern.pattern!r}"
            )
    if contains_secret(output):
        errors.append("SECRETS: evidence output contains an unredacted secret")
    digest = ev.get("output_sha256")
    if isinstance(digest, str) and sha256_text(output) != digest:
        errors.append("FORGED: output_sha256 does not match the exact stored output")
    return errors


def _validate_staleness(ev: dict) -> list[str]:
    try:
        event_time = parse_timestamp(ev.get("timestamp_utc", ""))
    except (TypeError, ValueError, OverflowError) as error:
        return [f"STALE: cannot parse timestamp_utc: {error}"]
    age = (datetime.now(timezone.utc) - event_time).total_seconds()
    if age < 0:
        return [f"FORGED: evidence timestamp is in the future ({age:.0f}s ahead)"]
    if age > STALENESS_SECS:
        return [f"STALE: evidence is {age:.0f}s old (limit: {STALENESS_SECS}s)"]
    return []


def _validate_workspace(ev: dict, current_workspace: Path) -> list[str]:
    try:
        evidence_workspace = Path(ev.get("workspace", "")).resolve()
    except (TypeError, ValueError):
        return ["MISMATCH: workspace is invalid"]
    if evidence_workspace != current_workspace.resolve():
        return [
            f"MISMATCH: workspace {str(evidence_workspace)!r} != current {str(current_workspace)!r}"
        ]
    return []


def _validate_tree(ev: dict, current_tree: str) -> list[str]:
    evidence_tree = ev.get("tree_sha")
    if not isinstance(evidence_tree, str) or not evidence_tree:
        return ["MISMATCH: tree_sha missing in evidence"]
    if evidence_tree != current_tree:
        return [
            "MISMATCH: exact worktree fingerprint changed since evidence was written. "
            f"Evidence: {evidence_tree!r}, Current: {current_tree!r}"
        ]
    return []


def _validate_exit_code(ev: dict) -> list[str]:
    return phase_errors(ev)


def _replay_timeout() -> float:
    raw = os.environ.get("FORGEWRIGHT_REPLAY_TIMEOUT_SECS", "")
    try:
        value = float(raw) if raw.strip() else DEFAULT_REPLAY_TIMEOUT_SECS
    except ValueError:
        value = DEFAULT_REPLAY_TIMEOUT_SECS
    if value <= 0:
        return 0.001
    return min(value, MAX_REPLAY_TIMEOUT_SECS)


def _replay_env() -> dict[str, str]:
    """Keep normal process discovery/environment while dropping secret-like names."""
    return {
        name: value
        for name, value in os.environ.items()
        if not _SECRET_ENV_NAME.search(name)
    }


def _bounded_replay_detail(value: Any) -> str:
    if value is None:
        return ""
    text = redact(str(value))
    if len(text) > MAX_REPLAY_DETAIL_CHARS:
        return text[:MAX_REPLAY_DETAIL_CHARS] + "...[truncated]"
    return text


def _final_replay_records(
    evidence: dict[str, Any], project_root: Path, evidence_path: Path, hard: bool
) -> list[tuple[str, dict[str, Any]]]:
    """Return only final-tree records; historical red/mutation records are excluded."""
    if evidence.get("phase") not in FINAL_PHASES:
        return []
    if evidence.get("tree_sha") != _current_tree_sha(project_root):
        return []

    records: list[tuple[str, dict[str, Any]]] = [("final", evidence)]
    if not hard:
        return records

    links = link_values(evidence)
    for relation in ("contract", "runtime", "e2e"):
        raw_path = links.get(relation)
        if not raw_path:
            continue
        path, error = resolve_evidence_link(project_root, raw_path)
        if error or path is None or path.resolve() == evidence_path.resolve():
            continue
        try:
            linked = read_evidence_json(project_root, path)
        except ValueError:
            continue
        if (
            linked.get("phase") in FINAL_PHASES
            and linked.get("exit_code") == 0
            and linked.get("tree_sha") == evidence.get("tree_sha")
        ):
            records.append((relation, linked))
    return records


def _replay_final_commands(
    evidence: dict[str, Any],
    project_root: Path,
    evidence_path: Path,
    hard: bool,
) -> list[str]:
    """Replay each exact final-tree argv once and fail closed on any mismatch."""
    errors: list[str] = []
    records = _final_replay_records(evidence, project_root, evidence_path, hard)
    commands: dict[tuple[str, ...], list[tuple[str, dict[str, Any]]]] = {}
    for label, record in records:
        command = record.get("command")
        command_diagnostics = command_errors(command)
        if command_diagnostics:
            errors.extend(
                f"REPLAY: {label} command refused by schema: {diagnostic}"
                for diagnostic in command_diagnostics
            )
            continue
        assert isinstance(command, list)
        commands.setdefault(tuple(command), []).append((label, record))

    mutated_worktree = False
    for command_tuple, command_records in commands.items():
        command = list(command_tuple)
        try:
            result = subprocess.run(
                command,
                cwd=str(project_root),
                env=_replay_env(),
                shell=False,
                capture_output=True,
                text=True,
                timeout=_replay_timeout(),
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            detail = _bounded_replay_detail(
                getattr(error, "stderr", None) or getattr(error, "output", None)
            )
            suffix = f" detail={detail!r}" if detail else ""
            errors.append(
                "REPLAY: final-tree command timed out before proving exit_code=0"
                f" after {_replay_timeout():g}s{suffix}"
            )
            continue
        except (OSError, UnicodeError) as error:
            detail = _bounded_replay_detail(error)
            errors.append(
                "REPLAY: final-tree command could not be started safely"
                + (f": {detail}" if detail else "")
            )
            continue

        detail = _bounded_replay_detail((result.stdout or "") + (result.stderr or ""))
        for label, record in command_records:
            expected = record.get("exit_code")
            if result.returncode != expected:
                errors.append(
                    f"REPLAY: {label} command returncode {result.returncode} does not "
                    f"match stored exit_code {expected}"
                    + (f" detail={detail!r}" if detail else "")
                )
            elif result.returncode != 0:
                errors.append(
                    f"REPLAY: {label} final-tree command returned nonzero exit_code "
                    f"{result.returncode}; final evidence must replay with 0"
                    + (f" detail={detail!r}" if detail else "")
                )

        replay_tree = _current_tree_sha(project_root)
        if replay_tree != evidence.get("tree_sha") and not mutated_worktree:
            errors.append(
                "REPLAY: mutated final worktree outside excluded evidence directory; "
                "replay changed tracked, untracked, ignored, or submodule content. "
                f"Evidence: {evidence.get('tree_sha')!r}, Current: {replay_tree!r}"
            )
            mutated_worktree = True

    # Recompute after all final commands, including when commands are deduplicated.
    final_tree = _current_tree_sha(project_root)
    if final_tree != evidence.get("tree_sha") and not mutated_worktree:
        errors.append(
            "REPLAY: mutated final worktree outside excluded evidence directory; "
            "replay changed tracked, untracked, ignored, or submodule content. "
            f"Evidence: {evidence.get('tree_sha')!r}, Current: {final_tree!r}"
        )
    return errors


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _check_stubs(files: list[str]) -> list[str]:
    errors: list[str] = []
    for filename in files:
        path = Path(filename)
        if path.suffix.lower() in _STUB_EXTS or path.suffix.lower() in _BINARY_EXTS:
            continue
        if (
            any(filename.startswith(prefix) for prefix in _SKIP_STUB_PREFIXES)
            or not path.is_file()
        ):
            continue
        try:
            for line_number, line in enumerate(
                path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1
            ):
                if _STUB_PATTERN.search(line):
                    errors.append(f"  {filename}:{line_number}: {line}")
        except OSError:
            pass
    return errors


def _lint_text(text: str, name: str) -> list[str]:
    errors: list[str] = []
    for index, line in enumerate(text.splitlines(), 1):
        check = re.search(r"\bCHECK\s*:\s*`([^`]*)`", line)
        if not check:
            continue
        command = check.group(1)
        if not command.strip():
            errors.append(f"  {name}:{index}: empty CHECK command")
            continue
        try:
            result = subprocess.run(
                ["bash", "-c", f"set -n; {command}"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            if result.returncode != 0:
                errors.append(
                    f"  {name}:{index}: bash syntax error in `{command}`: {result.stderr.strip()}"
                )
        except (OSError, subprocess.SubprocessError):
            pass
        if "->" not in line[check.end() :]:
            errors.append(
                f"  {name}:{index}: missing '->' transition in: {line.strip()}"
            )
    return errors


def _lint_check_commands(files: list[str], response_content: str) -> list[str]:
    errors: list[str] = []
    if response_content:
        errors.extend(_lint_text(response_content, "Response"))
    for filename in files:
        path = Path(filename)
        if filename.endswith(".md") and path.is_file():
            try:
                errors.extend(
                    _lint_text(
                        path.read_text(encoding="utf-8", errors="ignore"), filename
                    )
                )
            except OSError:
                pass
    return errors


def _redact_source_file(fp: Path) -> bool:
    """Compatibility no-op: completion gates never rewrite source files."""
    _ = fp
    return False


def _linked_record_errors(
    ev: dict[str, Any], project_root: Path, *, current_path: Path | None = None
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    errors: list[str] = []
    records: dict[str, dict[str, Any]] = {}
    for relation, raw_path in link_values(ev).items():
        path, error = resolve_evidence_link(project_root, raw_path)
        if error:
            errors.append(error)
            continue
        assert path is not None
        if current_path is not None and path.resolve() == current_path.resolve():
            errors.append(
                f"FORGED: linked {relation} evidence cannot point to the current record"
            )
            continue
        try:
            linked = read_evidence_json(project_root, path)
        except ValueError as error:
            errors.append(
                f"FORGED: linked {relation} evidence is not valid JSON: {error}"
            )
            continue
        errors.extend(schema_errors(linked))
        errors.extend(_validate_output(linked))
        errors.extend(_validate_staleness(linked))
        errors.extend(_validate_workspace(linked, project_root))
        errors.extend(phase_errors(linked))
        records[relation] = linked
    return errors, records


def _validate_chain(
    ev: dict[str, Any], project_root: Path, *, current_path: Path, hard: bool
) -> list[str]:
    errors: list[str] = []
    links = link_values(ev)
    if ev.get("phase") not in FINAL_PHASES:
        return errors
    is_fix = ev.get("change_kind") == "fix"
    if is_fix and ev.get("phase") != "green":
        errors.append("FAILED: change_kind=fix final evidence must have phase=green")
    if is_fix and "red" not in links:
        errors.append("FAILED: change_kind=fix requires a linked RED evidence record")
    if (
        hard
        and is_fix
        and any(
            relation not in links for relation in ("red", "pre_mutation", "mutation")
        )
    ):
        errors.append(
            "FAILED: HARD fixes require linked RED, pre-mutation GREEN, and mutation evidence"
        )
    link_errors, records = _linked_record_errors(
        ev, project_root, current_path=current_path
    )
    errors.extend(link_errors)
    red = records.get("red")
    if red is not None:
        if red.get("phase") != "red":
            errors.append("MISMATCH: linked red evidence must have phase=red")
        for field in ("tier", "test_refs", "command", "execution"):
            if red.get(field) != ev.get(field):
                errors.append(
                    f"MISMATCH: linked RED {field} must exactly match green evidence"
                )
        if acceptance_map(red) != acceptance_map(ev):
            errors.append(
                "MISMATCH: linked RED acceptance IDs/claims must exactly match green evidence"
            )
        if acceptance_test_map(red) != acceptance_test_map(ev):
            errors.append(
                "MISMATCH: linked RED acceptance-to-test mapping must exactly match green evidence"
            )
        if red.get("negative_paths") != ev.get("negative_paths"):
            errors.append(
                "MISMATCH: linked RED negative_paths must exactly match green evidence"
            )
        if negative_path_map(red) != negative_path_map(ev):
            errors.append(
                "MISMATCH: linked RED negative path bindings must exactly match green evidence"
            )
    pre_mutation = records.get("pre_mutation")
    if pre_mutation is not None:
        if pre_mutation.get("phase") != "green" or pre_mutation.get("exit_code") != 0:
            errors.append(
                "MISMATCH: linked pre_mutation evidence must be passing GREEN"
            )
        for field in ("tier", "test_refs", "command", "execution"):
            if pre_mutation.get(field) != ev.get(field):
                errors.append(
                    f"MISMATCH: linked pre_mutation {field} must exactly match final GREEN"
                )
        if acceptance_map(pre_mutation) != acceptance_map(ev):
            errors.append(
                "MISMATCH: linked pre_mutation acceptance IDs/claims must match final GREEN"
            )
        if acceptance_test_map(pre_mutation) != acceptance_test_map(ev):
            errors.append(
                "MISMATCH: linked pre_mutation acceptance-to-test mapping must match final GREEN"
            )
        if pre_mutation.get("negative_paths") != ev.get("negative_paths"):
            errors.append(
                "MISMATCH: linked pre_mutation negative_paths must match final GREEN"
            )
        if negative_path_map(pre_mutation) != negative_path_map(ev):
            errors.append(
                "MISMATCH: linked pre_mutation negative path bindings must match final GREEN"
            )
        if pre_mutation.get("tree_sha") != ev.get("tree_sha"):
            errors.append(
                "MISMATCH: final GREEN must restore the exact pre-mutation full worktree"
            )
    mutation = records.get("mutation")
    if mutation is not None:
        if mutation.get("phase") != "mutation":
            errors.append("MISMATCH: linked mutation evidence must have phase=mutation")
        for field in ("tier", "test_refs", "command", "execution"):
            if mutation.get(field) != ev.get(field):
                errors.append(
                    f"MISMATCH: linked mutation {field} must exactly match green evidence"
                )
        if acceptance_map(mutation) != acceptance_map(ev):
            errors.append(
                "MISMATCH: linked mutation acceptance IDs/claims must exactly match green evidence"
            )
        if acceptance_test_map(mutation) != acceptance_test_map(ev):
            errors.append(
                "MISMATCH: linked mutation acceptance-to-test mapping must exactly match green evidence"
            )
        if mutation.get("negative_paths") != ev.get("negative_paths"):
            errors.append(
                "MISMATCH: linked mutation negative_paths must exactly match green evidence"
            )
        if negative_path_map(mutation) != negative_path_map(ev):
            errors.append(
                "MISMATCH: linked mutation negative path bindings must exactly match green evidence"
            )
        if hard and is_fix and "red" not in link_values(mutation):
            errors.append(
                "MISMATCH: HARD mutation evidence must link back to RED evidence"
            )
        mutation_red_path = link_values(mutation).get("red")
        if hard and is_fix and mutation_red_path != links.get("red"):
            errors.append("MISMATCH: mutation RED link must match the green RED link")
        mutation_pre_path = link_values(mutation).get("pre_mutation")
        if hard and is_fix and mutation_pre_path != links.get("pre_mutation"):
            errors.append("MISMATCH: mutation pre_mutation link must match final GREEN")
        mutation_metadata = mutation.get("mutation", {})
        if pre_mutation is not None and mutation_metadata.get(
            "pre_mutation_tree_sha"
        ) != pre_mutation.get("tree_sha"):
            errors.append(
                "MISMATCH: mutation metadata does not bind the pre-mutation tree"
            )
    if (
        red is not None
        and mutation is not None
        and red.get("tree_sha") == mutation.get("tree_sha")
    ):
        errors.append(
            "MISMATCH: linked RED and mutation evidence must have distinct tree fingerprints"
        )
    if red is not None and red.get("tree_sha") == ev.get("tree_sha"):
        errors.append(
            "MISMATCH: linked RED and final GREEN must have distinct tree fingerprints"
        )
    if mutation is not None and mutation.get("tree_sha") == ev.get("tree_sha"):
        errors.append(
            "MISMATCH: linked mutation and final GREEN must have distinct tree fingerprints"
        )

    def ordered(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
        if left is None or right is None:
            return True
        try:
            return parse_timestamp(left["timestamp_utc"]) < parse_timestamp(
                right["timestamp_utc"]
            )
        except (KeyError, TypeError, ValueError, OverflowError):
            return False

    if is_fix and red is not None and not ordered(red, ev):
        errors.append("MISMATCH: RED timestamp must be earlier than final GREEN")
    if (
        hard
        and is_fix
        and all(item is not None for item in (red, pre_mutation, mutation))
    ):
        assert red is not None and pre_mutation is not None and mutation is not None
        if not (
            ordered(red, pre_mutation)
            and ordered(pre_mutation, mutation)
            and ordered(mutation, ev)
        ):
            errors.append(
                "MISMATCH: HARD fix evidence must order RED < pre-mutation GREEN < mutation < final GREEN"
            )

    if hard:
        required_tiers = {"contract", "runtime", "e2e"}
        observed_tiers = {ev.get("tier")}
        for relation in required_tiers:
            linked = records.get(relation)
            if linked is None:
                continue
            if linked.get("tier") != relation:
                errors.append(
                    f"MISMATCH: linked {relation} evidence must declare tier={relation}"
                )
                continue
            if linked.get("phase") not in FINAL_PHASES or linked.get("exit_code") != 0:
                errors.append(
                    f"MISMATCH: linked {relation} evidence must be a passing final record"
                )
            if acceptance_map(linked) != acceptance_map(ev):
                errors.append(
                    f"MISMATCH: linked {relation} acceptance IDs/claims must exactly "
                    "match final evidence"
                )
            if linked.get("negative_paths") != ev.get("negative_paths"):
                errors.append(
                    f"MISMATCH: linked {relation} negative_paths must exactly match final evidence"
                )
            if negative_path_map(linked) != negative_path_map(ev):
                errors.append(
                    f"MISMATCH: linked {relation} negative path bindings must exactly match final evidence"
                )
            if linked.get("tree_sha") != ev.get("tree_sha"):
                errors.append(
                    f"MISMATCH: linked {relation} evidence must describe the final tree"
                )
            observed_tiers.add(linked.get("tier"))
        missing_tiers = sorted(required_tiers - observed_tiers)
        if missing_tiers:
            errors.append(
                f"HARD: missing passing final evidence tiers: {missing_tiers}"
            )
    return errors


def _validate_hard_requirements(
    ev: dict[str, Any], hard: bool, project_root: Path
) -> list[str]:
    if not hard:
        return []
    errors: list[str] = []
    if ev.get("risk") != "hard":
        errors.append("HARD: changed code/diff requires declared risk=hard")
    reviewer = ev.get("reviewer", {})
    if reviewer.get("status", "").lower() != "independent-approved":
        errors.append("HARD: reviewer.status must be independent-approved")
    if not nontrivial_reviewer_id(reviewer.get("id")):
        errors.append("HARD: reviewer.id must be a nontrivial reviewer identifier")
    if reviewer.get("id") == ev.get("implementer_id"):
        errors.append("HARD: independent reviewer must not be the implementer")
    evidence_ref = reviewer.get("evidence_ref")
    if not isinstance(evidence_ref, str) or not evidence_ref.strip():
        errors.append("HARD: reviewer.evidence_ref is required")
    else:
        review_path, review_path_error = resolve_evidence_link(
            project_root, evidence_ref
        )
        if review_path_error:
            errors.append(f"HARD: reviewer evidence is invalid: {review_path_error}")
        else:
            assert review_path is not None
            try:
                review_bytes = read_evidence_bytes(
                    project_root,
                    review_path,
                    max_bytes=MAX_REVIEW_BYTES,
                )
                review = json.loads(review_bytes.decode("utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                errors.append(f"HARD: reviewer evidence must be valid JSON: {error}")
            except (UnicodeDecodeError, ValueError) as error:
                errors.append(f"HARD: reviewer evidence is invalid: {error}")
            else:
                expected_ids = sorted(acceptance_map(ev))
                required_fields = {
                    "schema_version",
                    "namespace",
                    "reviewer_id",
                    "implementer_id",
                    "status",
                    "turn",
                    "workspace",
                    "tree_sha",
                    "evidence_sha256",
                    "acceptance_ids",
                    "negative_path_bindings",
                    "findings",
                    "limitations",
                    "timestamp_utc",
                }
                if not isinstance(review, dict):
                    errors.append("HARD: reviewer evidence must be a JSON object")
                    review = {}
                missing = sorted(required_fields - set(review))
                extra = sorted(set(review) - required_fields)
                if missing:
                    errors.append(f"HARD: review-2 is missing fields: {missing}")
                if extra:
                    errors.append(f"HARD: review-2 has unexpected fields: {extra}")
                if review.get("schema_version") != REVIEW_SCHEMA:
                    errors.append(
                        "HARD: reviewer evidence schema_version must be review-2; review-1 is never sufficient"
                    )
                if review.get("namespace") != REVIEW_NAMESPACE:
                    errors.append("HARD: reviewer evidence namespace is invalid")
                if review.get("reviewer_id") != reviewer.get("id"):
                    errors.append("HARD: reviewer evidence reviewer_id does not match")
                if review.get("implementer_id") != ev.get("implementer_id"):
                    errors.append(
                        "HARD: reviewer evidence implementer_id does not match"
                    )
                if review.get("status") != "independent-approved":
                    errors.append(
                        "HARD: reviewer evidence status must be independent-approved"
                    )
                if review.get("acceptance_ids") != expected_ids:
                    errors.append(
                        "HARD: reviewer evidence must cover every exact acceptance ID"
                    )
                if review.get("negative_path_bindings") != ev.get(
                    "negative_path_bindings"
                ):
                    errors.append(
                        "HARD: reviewer evidence must bind exact negative_path_bindings"
                    )
                if review.get("turn") != ev.get("turn"):
                    errors.append(
                        "HARD: reviewer evidence turn does not match final evidence"
                    )
                if review.get("workspace") != str(project_root.resolve()):
                    errors.append("HARD: reviewer evidence workspace does not match")
                if review.get("tree_sha") != ev.get("tree_sha"):
                    errors.append(
                        "HARD: reviewer evidence must describe the final tree"
                    )
                if (
                    review.get("evidence_sha256")
                    != hashlib.sha256(_canonical_json(ev)).hexdigest()
                ):
                    errors.append(
                        "HARD: reviewer evidence_sha256 does not match exact final evidence"
                    )
                if not isinstance(review.get("findings"), list):
                    errors.append("HARD: reviewer evidence findings must be a list")
                if not isinstance(review.get("limitations"), list):
                    errors.append("HARD: reviewer evidence limitations must be a list")
                elif KEYLESS_TRUST_LIMITATION not in review["limitations"]:
                    errors.append(
                        "HARD: keyless review must disclose its reviewer-authentication limitation"
                    )
                errors.extend(
                    _validate_staleness({"timestamp_utc": review.get("timestamp_utc")})
                )
                try:
                    evidence_time = parse_timestamp(ev["timestamp_utc"])
                    review_time = parse_timestamp(review["timestamp_utc"])
                    if review_time < evidence_time:
                        errors.append(
                            "HARD: reviewer evidence timestamp predates final evidence"
                        )
                except (KeyError, TypeError, ValueError, OverflowError):
                    errors.append("HARD: reviewer evidence timestamp is invalid")
    if ev.get("tier") not in STRONG_TIERS:
        errors.append(f"HARD: tier must be one of {sorted(STRONG_TIERS)}")
    return errors


def completion_checks(
    evidence: dict[str, Any],
    project_root: Path,
    evidence_path: Path,
    files_to_check: list[str] | None = None,
) -> tuple[bool, tuple[tuple[str, list[str]], ...]]:
    """Return the one canonical completion decision used by both validators."""

    current_tree = _current_tree_sha(project_root)
    files_for_signal = files_to_check or changed_files(project_root)
    hard = evidence.get("risk") == "hard" or hard_signal(project_root, files_for_signal)
    checks = (
        ("schema", _validate_schema(evidence)),
        ("output", _validate_output(evidence)),
        ("staleness", _validate_staleness(evidence)),
        ("workspace", _validate_workspace(evidence, project_root)),
        ("tree", _validate_tree(evidence, current_tree)),
        ("phase", phase_errors(evidence, final=True)),
        ("exit_code", _validate_exit_code(evidence)),
        ("hard", _validate_hard_requirements(evidence, hard, project_root)),
        (
            "chain",
            _validate_chain(
                evidence,
                project_root,
                current_path=evidence_path,
                hard=hard,
            ),
        ),
        (
            "replay",
            _replay_final_commands(
                evidence,
                project_root,
                evidence_path,
                hard,
            ),
        ),
    )
    return hard, checks


def _selftest(project_root: Path) -> int:
    """Smoke-test the v2 schema without writing into the caller's workspace."""
    import shutil
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    try:
        output = "selftest\n"
        check_path = tmp / "selftest_check.py"
        check_path.write_text("print('selftest')\n", encoding="utf-8")
        command = ["python3", "selftest_check.py"]
        refs = ["selftest_check.py"]
        execution, execution_diagnostics = execution_manifest(tmp, command, refs)
        if execution_diagnostics or execution is None:
            _err(f"selftest setup FAILED: {execution_diagnostics}")
            return 1
        ev = {
            "schema_version": "2",
            "turn": "selftest-001",
            "acceptance_criteria": [
                {
                    "id": "selftest",
                    "claim": "selftest output is recorded",
                    "test_refs": ["selftest_check.py"],
                }
            ],
            "tier": "contract",
            "test_refs": refs,
            "negative_paths": ["missing evidence"],
            "negative_path_bindings": [
                {
                    "id": "negative-path-1",
                    "claim": "missing evidence",
                    "acceptance_ids": ["selftest"],
                    "test_refs": ["selftest_check.py"],
                }
            ],
            "limitations": [],
            "change_kind": "test",
            "phase": "verification",
            "implementer_id": "selftest-runner",
            "reviewer": {"status": "not_required"},
            "command": command,
            "execution": execution,
            "exit_code": 0,
            "output": output,
            "output_sha256": sha256_text(output),
            "output_truncated": False,
            "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "workspace": str(tmp),
            "tree_sha": _current_tree_sha(tmp),
        }
        errors = (
            _validate_schema(ev)
            + _validate_output(ev)
            + _validate_staleness(ev)
            + _validate_workspace(ev, tmp)
            + _validate_tree(ev, ev["tree_sha"])
            + _validate_exit_code(ev)
        )
        if errors:
            _err(f"selftest FAILED: {errors}")
            return 1
        _ok("selftest PASSED")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest(Path.cwd()))

    response_content = os.environ.get("RESPONSE_CONTENT", "")
    files_str = os.environ.get("FILES_TO_CHECK_STR", "")
    if os.environ.get("FILES_TO_CHECK_NUL"):
        files_to_check = [
            filename for filename in files_str.split("\0") if filename.strip()
        ]
    else:
        files_to_check = [
            filename for filename in files_str.splitlines() if filename.strip()
        ]
    project_root = _workspace()
    turn = os.environ.get("FORGEWRIGHT_TURN", os.environ.get("TURN", ""))
    all_errors: list[str] = []

    stub_errors = _check_stubs(files_to_check)
    if stub_errors:
        all_errors.append("STUBS")
        _err("Code contains forbidden stubs:")
        for error in stub_errors:
            print(error, file=sys.stderr)

    evidence_path = _find_evidence(project_root, turn)
    if evidence_path is None:
        all_errors.append("MISSING")
        _err("MISSING: no exact v2 evidence file under .forgewright/verify/")
    else:
        try:
            evidence = read_evidence_json(project_root, evidence_path)
        except ValueError as error:
            evidence = {}
            all_errors.append("FORGED")
            _err(f"FORGED: cannot parse evidence file: {error}")
        if evidence:
            _, checks = completion_checks(
                evidence,
                project_root,
                evidence_path,
                files_to_check,
            )
            for label, errors in checks:
                if errors:
                    all_errors.extend(errors)
                    _err(f"Evidence {label} check failed:")
                    for error in errors:
                        print(f"   {error}", file=sys.stderr)

    lint_errors = _lint_check_commands(files_to_check, response_content)
    if lint_errors:
        _warn("Plan CHECK command linting found advisory issues")

    if all_errors:
        _err(f"Gate BLOCKED. Reasons: {', '.join(dict.fromkeys(all_errors[:8]))}")
        raise SystemExit(1)
    _ok("All v2 evidence checks passed — gate OPEN")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
