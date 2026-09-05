#!/usr/bin/env python3
"""Shared, fail-closed primitives for the Forgewright evidence boundary."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "2"
EVIDENCE_TIERS = frozenset(
    {"unit", "contract", "integration", "runtime", "e2e", "security", "review"}
)
STRONG_TIERS = frozenset({"contract", "integration", "runtime", "e2e", "security"})
PHASES = frozenset({"verification", "red", "green", "mutation"})
FINAL_PHASES = frozenset({"green", "verification"})
CHANGE_KINDS = frozenset(
    {"feature", "fix", "refactor", "test", "docs", "chore", "security", "other"}
)
REVIEWER_STATUSES = frozenset(
    {"not_required", "pending", "independent-approved", "rejected"}
)
RISKS = frozenset({"quick", "standard", "hard"})
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TREE_FINGERPRINT_RE = re.compile(r"^(?:TREE|NONGIT):[0-9a-f]{64}$")
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024

# Runtime-owned state changes as a consequence of verification, hooks, and
# independent subagent review. Hashing these paths makes the act of reviewing
# invalidate the evidence it is reviewing. Keep the exclusion explicit and
# narrow: project configuration and source under .forgewright remain covered.
_FINGERPRINT_RUNTIME_DIRS = frozenset(
    {
        ".forgewright/audit",
        ".forgewright/cache",
        ".forgewright/escalations",
        ".forgewright/local-ci-venv",
        ".forgewright/memory-bank",
        ".forgewright/metrics",
        ".forgewright/offload",
        ".forgewright/runtime",
        ".forgewright/subagent-context",
        ".forgewright/telemetry",
        ".forgewright/verify",
        "mcp/.forgewright",
        "mcp/node_modules/.vite",
        "src/cli/node_modules/.vite",
        ".hypothesis",
        ".pytest_cache",
        ".ruff_cache",
    }
)
# Reproducible dependency caches may contain tens of thousands of ignored files.
# They are excluded only from the ignored-file scan; explicitly tracked files
# under these directories remain part of the exact worktree fingerprint.
_FINGERPRINT_IGNORED_DEPENDENCY_DIR_NAMES = frozenset({"node_modules"})

_FINGERPRINT_RUNTIME_FILES = frozenset(
    {
        ".forgewright/asip-metrics.json",
        ".forgewright/asip-state.json",
        ".forgewright/bookkeep.log",
        ".forgewright/code-reviewer/review-report.md",
        ".forgewright/events.log",
        ".forgewright/goal-progress.md",
        ".forgewright/instincts/store.json",
        ".forgewright/lesson-migration-state.json",
        ".forgewright/pipeline-state.json",
        ".forgewright/quality-gate-events.jsonl",
        ".forgewright/rule-ledger.jsonl",
        ".forgewright/session-log.json",
        ".forgewright/session-track.json",
        ".forgewright/session-tracker-v2.json",
        ".forgewright/verification-events.jsonl",
    }
)

_SECRET_PATTERNS = (
    (re.compile(r"sk-[a-zA-Z0-9]{20,}"), "sk-[REDACTED]"),
    (re.compile(r"ghp_[a-zA-Z0-9]{20,}"), "ghp_[REDACTED]"),
    (re.compile(r"AKIA[A-Z0-9]{16}"), "AKIA[REDACTED]"),
    (re.compile(r"xoxb-[0-9A-Za-z\-]{20,}"), "xoxb-[REDACTED]"),
    (
        re.compile(
            r"-----BEGIN(?:\s+[A-Z]+)?\s+PRIVATE KEY-----[\s\S]+?"
            r"-----END(?:\s+[A-Z]+)?\s+PRIVATE KEY-----"
        ),
        "-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----",
    ),
)

TRIVIAL_EXECUTABLES = frozenset({"true", "echo", "printf"})
SHELL_EXECUTABLES = frozenset({"sh", "bash", "dash", "zsh", "ksh", "fish"})
INLINE_INTERPRETERS = frozenset(
    {"python", "python3", "python.exe", "node", "node.exe", "ruby", "perl"}
)
PYTHON_EXECUTABLE_RE = re.compile(r"^python(?:\d+(?:\.\d+)*[a-z]*)?(?:\.exe)?$")
TEST_RUNNERS = frozenset({"pytest", "py.test", "vitest", "jest", "mocha", "playwright"})
HARD_TERMS_RE = re.compile(
    r"(?:payment|iap|billing|entitlement|receipt|purchase|subscription|checkout|"
    r"storekit|play\s+billing)",
    re.IGNORECASE,
)
_TEST_REF_SUFFIXES = frozenset(
    {
        ".py",
        ".sh",
        ".js",
        ".cjs",
        ".mjs",
        ".ts",
        ".tsx",
        ".go",
        ".rs",
        ".swift",
        ".java",
        ".kt",
        ".cs",
        ".rb",
    }
)


def redact(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def contains_secret(text: str) -> bool:
    return any(pattern.search(text) for pattern, _ in _SECRET_PATTERNS)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def command_text(command: Iterable[str]) -> str:
    return shlex.join([str(item) for item in command])


def _basename(value: str) -> str:
    return Path(value).name.lower()


def _shell_script(command: list[str]) -> str | None:
    shell_index = next(
        (
            index
            for index, value in enumerate(command)
            if _basename(value) in SHELL_EXECUTABLES
        ),
        None,
    )
    if shell_index is None:
        return None
    for index in range(shell_index + 1, len(command)):
        if command[index] in {"-c", "-lc", "-ic"} and index + 1 < len(command):
            return command[index + 1]
    return None


def _script_only_trivial(script: str) -> bool:
    if not script.strip():
        return False
    if any(
        operator in script
        for operator in (";", "&&", "||", "|", ">", "<", "\n", "$(", "`")
    ):
        return False
    try:
        tokens = shlex.split(script)
    except ValueError:
        return False
    return bool(tokens) and _basename(tokens[0]) in TRIVIAL_EXECUTABLES


def trivial_command_reason(command: list[str]) -> str | None:
    if not command:
        return "command must be non-empty"
    if _basename(command[0]) in TRIVIAL_EXECUTABLES:
        return "trivial command is not evidence: true/echo/printf are rejected"
    executable = _basename(command[0])
    if (
        executable in INLINE_INTERPRETERS or PYTHON_EXECUTABLE_RE.fullmatch(executable)
    ) and any(argument in {"-c", "-e"} for argument in command[1:]):
        return (
            "inline interpreter commands are not completion evidence; run a "
            "project-owned test/check file"
        )
    script = _shell_script(command)
    if script is not None and _script_only_trivial(script):
        return "shell wrapper runs only a trivial true/echo/printf command"
    return None


def command_errors(command: Any) -> list[str]:
    if not isinstance(command, list) or not command:
        return ["FORGED: 'command' must be a non-empty list"]
    if any(not isinstance(item, str) or not item.strip() for item in command):
        return ["FORGED: every command argument must be a non-empty string"]
    reason = trivial_command_reason(command)
    return [f"FORGED: {reason}"] if reason else []


def concrete_test_ref(value: str) -> bool:
    base = value.split("::", 1)[0]
    return (
        "::" in value
        or "/" in base
        or "\\" in base
        or Path(base).suffix.lower() in _TEST_REF_SUFFIXES
    )


def _contained_file(workspace: Path, value: str) -> tuple[str | None, str | None]:
    raw_path = value.split("::", 1)[0]
    candidate = Path(raw_path).expanduser()
    resolved = (
        candidate.resolve()
        if candidate.is_absolute()
        else (workspace / candidate).resolve()
    )
    root = workspace.resolve()
    if resolved != root and root not in resolved.parents:
        return None, f"test ref escapes the workspace: {value!r}"
    if not resolved.is_file():
        return None, f"test ref does not resolve to a project-owned file: {value!r}"
    normalized = resolved.relative_to(root).as_posix()
    suffix = value[len(raw_path) :]
    return normalized + suffix, None


def execution_manifest(
    workspace: Path, command: list[str], test_refs: list[str]
) -> tuple[dict[str, Any] | None, list[str]]:
    """Derive a machine invocation manifest; do not trust caller-declared runner text."""

    if not command:
        return None, ["FORGED: execution manifest requires a command"]
    executable = _basename(command[0])
    runner = ""
    invoked_refs: list[str] = []

    if executable in TEST_RUNNERS:
        runner = executable
        invoked_refs = command[1:]
    elif PYTHON_EXECUTABLE_RE.fullmatch(executable) and len(command) >= 2:
        if command[1:3] == ["-m", "pytest"]:
            runner = "pytest"
            invoked_refs = command[3:]
        elif not command[1].startswith("-"):
            runner = "python-script"
            invoked_refs = [command[1]]
    elif executable in {"node", "node.exe", "ruby", "perl"} and len(command) >= 2:
        if not command[1].startswith("-"):
            runner = f"{executable}-script"
            invoked_refs = [command[1]]
    elif executable in SHELL_EXECUTABLES and len(command) >= 2:
        if not command[1].startswith("-"):
            runner = "shell-script"
            invoked_refs = [command[1]]
    elif "/" in command[0] or "\\" in command[0]:
        runner = "project-executable"
        invoked_refs = [command[0]]

    if not runner:
        return None, [
            "FORGED: command is not a supported project check/test invocation"
        ]

    normalized_refs: list[str] = []
    errors: list[str] = []
    for ref in test_refs:
        normalized, error = _contained_file(workspace, ref)
        if error:
            errors.append(f"FORGED: {error}")
        elif normalized is not None:
            normalized_refs.append(normalized)

    normalized_invoked: list[str] = []
    for ref in invoked_refs:
        normalized, _ = _contained_file(workspace, ref)
        if normalized is not None:
            normalized_invoked.append(normalized)

    for ref in normalized_refs:
        if ref not in normalized_invoked:
            errors.append(
                f"FORGED: test ref {ref!r} was not invoked by the recognized runner"
            )
    if not normalized_invoked:
        errors.append(
            "FORGED: recognized runner did not invoke a project-owned check file"
        )
    if errors:
        return None, errors
    return {
        "runner": runner,
        "entrypoints": sorted(set(normalized_invoked)),
        "test_refs": normalized_refs,
    }, []


def execution_errors(ev: dict[str, Any]) -> list[str]:
    workspace_value = ev.get("workspace")
    if not isinstance(workspace_value, str) or not workspace_value:
        return ["FORGED: execution validation requires workspace"]
    command = ev.get("command")
    refs = ev.get("test_refs")
    if not isinstance(command, list) or not isinstance(refs, list):
        return ["FORGED: execution validation requires command and test_refs"]
    manifest, errors = execution_manifest(Path(workspace_value), command, refs)
    if errors:
        return errors
    if ev.get("execution") != manifest:
        return ["FORGED: execution manifest does not match the exact command"]
    return []


def acceptance_errors(criteria: Any, global_test_refs: Any = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(criteria, list) or not criteria:
        return ["FORGED: 'acceptance_criteria' must be a non-empty list"]
    seen: set[str] = set()
    for index, item in enumerate(criteria):
        if not isinstance(item, dict):
            errors.append(f"FORGED: acceptance_criteria[{index}] must be an object")
            continue
        identifier = item.get("id")
        claim = item.get("claim")
        test_refs = item.get("test_refs")
        if not isinstance(identifier, str) or not SLUG_RE.fullmatch(identifier):
            errors.append(
                f"FORGED: acceptance_criteria[{index}].id must be a lowercase slug"
            )
        elif identifier in seen:
            errors.append(f"FORGED: duplicate acceptance id {identifier!r}")
        else:
            seen.add(identifier)
        if not isinstance(claim, str) or not claim.strip():
            errors.append(
                f"FORGED: acceptance_criteria[{index}].claim must be nonempty"
            )
        if (
            not isinstance(test_refs, list)
            or not test_refs
            or any(not isinstance(ref, str) or not ref.strip() for ref in test_refs)
        ):
            errors.append(
                f"FORGED: acceptance_criteria[{index}].test_refs must be a "
                "non-empty list"
            )
        elif any(not concrete_test_ref(ref) for ref in test_refs):
            errors.append(
                f"FORGED: acceptance_criteria[{index}].test_refs must name "
                "concrete project-owned check files or test IDs"
            )
        elif isinstance(global_test_refs, list):
            unknown = [ref for ref in test_refs if ref not in global_test_refs]
            if unknown:
                errors.append(
                    f"FORGED: acceptance_criteria[{index}].test_refs are not "
                    f"declared globally: {unknown}"
                )
    return errors


def acceptance_map(ev: dict[str, Any]) -> dict[str, str]:
    return {
        item["id"]: item["claim"]
        for item in ev.get("acceptance_criteria", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def acceptance_test_map(ev: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    return {
        item["id"]: tuple(item.get("test_refs", []))
        for item in ev.get("acceptance_criteria", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def negative_path_map(
    ev: dict[str, Any],
) -> dict[str, tuple[str, tuple[str, ...], tuple[str, ...]]]:
    """Return a stable, exact comparison view of negative-path bindings."""

    return {
        item["id"]: (
            item.get("claim", ""),
            tuple(item.get("acceptance_ids", [])),
            tuple(item.get("test_refs", [])),
        )
        for item in sorted(
            (
                item
                for item in ev.get("negative_path_bindings", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ),
            key=lambda item: item["id"],
        )
    }


negative_path_binding_map = negative_path_map


def negative_path_binding_errors(ev: dict[str, Any]) -> list[str]:
    """Validate machine traceability for every displayed negative path."""

    if ev.get("schema_version") != SCHEMA_VERSION:
        return []
    negative_paths = ev.get("negative_paths")
    bindings = ev.get("negative_path_bindings")
    if not isinstance(bindings, list) or not bindings:
        return [
            "MISSING: 'negative_path_bindings' is required for schema v2 completion"
        ]
    if not isinstance(negative_paths, list):
        return [
            "UNVERIFIED: negative_path_bindings cannot be checked without negative_paths"
        ]

    acceptance_ids = set(acceptance_map(ev))
    global_refs = ev.get("test_refs")
    global_ref_set = set(global_refs) if isinstance(global_refs, list) else set()
    execution = ev.get("execution")
    invoked_refs = (
        set(execution.get("entrypoints", []))
        if isinstance(execution, dict)
        and isinstance(execution.get("entrypoints"), list)
        else None
    )
    errors: list[str] = []
    seen_ids: set[str] = set()
    bound_paths: set[str] = set()
    for index, binding in enumerate(bindings):
        prefix = f"negative_path_bindings[{index}]"
        if not isinstance(binding, dict):
            errors.append(f"FORGED: {prefix} must be an object")
            continue
        binding_id = binding.get("id")
        claim = binding.get("claim")
        acceptance_binding_ids = binding.get("acceptance_ids")
        binding_refs = binding.get("test_refs")
        if not isinstance(binding_id, str) or not SLUG_RE.fullmatch(binding_id):
            errors.append(f"FORGED: {prefix}.id must be a lowercase slug")
        elif binding_id in seen_ids:
            errors.append(f"FORGED: duplicate negative path binding id {binding_id!r}")
        else:
            seen_ids.add(binding_id)
        if not isinstance(claim, str) or not claim.strip():
            errors.append(f"FORGED: {prefix}.claim must be nonempty")
        elif claim not in negative_paths:
            errors.append(
                f"MISMATCH: {prefix}.claim must exactly match one negative_paths entry"
            )
        else:
            bound_paths.add(claim)
        if (
            not isinstance(acceptance_binding_ids, list)
            or not acceptance_binding_ids
            or any(
                not isinstance(identifier, str) or not identifier.strip()
                for identifier in acceptance_binding_ids
            )
        ):
            errors.append(f"FORGED: {prefix}.acceptance_ids must be non-empty")
        else:
            unknown = sorted(set(acceptance_binding_ids) - acceptance_ids)
            if unknown:
                errors.append(
                    f"MISMATCH: {prefix}.acceptance_ids reference unknown IDs: {unknown}"
                )
        if (
            not isinstance(binding_refs, list)
            or not binding_refs
            or any(not isinstance(ref, str) or not ref.strip() for ref in binding_refs)
        ):
            errors.append(f"FORGED: {prefix}.test_refs must be non-empty")
        else:
            nonconcrete = [ref for ref in binding_refs if not concrete_test_ref(ref)]
            if nonconcrete:
                errors.append(
                    f"FORGED: {prefix}.test_refs must be concrete: {nonconcrete}"
                )
            unknown_global = sorted(set(binding_refs) - global_ref_set)
            if unknown_global:
                errors.append(
                    f"MISMATCH: {prefix}.test_refs are not declared globally: {unknown_global}"
                )
            if invoked_refs is None:
                errors.append(
                    f"UNVERIFIED: {prefix}.test_refs cannot be checked against invoked refs"
                )
            else:
                uninvoked = sorted(set(binding_refs) - invoked_refs)
                if uninvoked:
                    errors.append(
                        f"MISMATCH: {prefix}.test_refs were not invoked: {uninvoked}"
                    )
    missing_paths = [path for path in negative_paths if path not in bound_paths]
    if missing_paths:
        errors.append(
            f"MISSING: every negative_paths entry requires a binding: {missing_paths}"
        )
    return errors


def correlation_errors(ev: dict[str, Any]) -> list[str]:
    """Require claims and negative paths to name concrete invoked verifiers."""

    command = ev.get("command")
    if not isinstance(command, list) or any(
        not isinstance(item, str) for item in command
    ):
        return ["FORGED: command/test correlation requires a string command list"]
    rendered = command_text(command)
    global_refs = ev.get("test_refs")
    if not isinstance(global_refs, list):
        return ["FORGED: command/test correlation requires global test_refs"]

    errors: list[str] = []
    assigned: set[str] = set()
    for acceptance_id, refs in acceptance_test_map(ev).items():
        for ref in refs:
            assigned.add(ref)
            if ref not in rendered:
                errors.append(
                    f"FORGED: acceptance {acceptance_id!r} test_ref {ref!r} is "
                    "not present in the exact command"
                )
    unassigned = [ref for ref in global_refs if ref not in assigned]
    if unassigned:
        errors.append(
            f"FORGED: global test_refs are not mapped to an acceptance claim: {unassigned}"
        )
    bindings = ev.get("negative_path_bindings", [])
    if isinstance(bindings, list):
        execution = ev.get("execution")
        invoked_refs = (
            set(execution.get("entrypoints", []))
            if isinstance(execution, dict)
            and isinstance(execution.get("entrypoints"), list)
            else None
        )
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            binding_id = binding.get("id", "")
            binding_refs = binding.get("test_refs", [])
            if not isinstance(binding_refs, list):
                continue
            unknown_global = sorted(set(binding_refs) - set(global_refs))
            if unknown_global:
                errors.append(
                    f"MISMATCH: negative path binding {binding_id!r} test_refs are not "
                    f"declared globally: {unknown_global}"
                )
            if invoked_refs is not None:
                uninvoked = sorted(set(binding_refs) - invoked_refs)
                if uninvoked:
                    errors.append(
                        f"MISMATCH: negative path binding {binding_id!r} test_refs "
                        f"were not invoked: {uninvoked}"
                    )
    return errors


def schema_errors(ev: Any) -> list[str]:
    if not isinstance(ev, dict):
        return ["FORGED: evidence must be a JSON object"]
    errors: list[str] = []
    version = ev.get("schema_version")
    if version != SCHEMA_VERSION:
        if version == "1" or version == 1:
            errors.append(
                "FORGED: schema_version v1 is rejected; v1 evidence cannot complete "
                "code changes. Re-run run-check with v2 metadata."
            )
        else:
            errors.append(
                f"FORGED: schema_version must be '{SCHEMA_VERSION}', got {version!r}"
            )
    errors.extend(acceptance_errors(ev.get("acceptance_criteria"), ev.get("test_refs")))
    errors.extend(command_errors(ev.get("command")))

    tier = ev.get("tier")
    if tier not in EVIDENCE_TIERS:
        errors.append(f"FORGED: tier must be one of {sorted(EVIDENCE_TIERS)}")
    refs = ev.get("test_refs")
    if (
        not isinstance(refs, list)
        or not refs
        or any(not isinstance(ref, str) or not ref.strip() for ref in refs)
    ):
        errors.append("FORGED: 'test_refs' must be a non-empty list of strings")
    negative_paths = ev.get("negative_paths")
    if (
        not isinstance(negative_paths, list)
        or not negative_paths
        or any(not isinstance(path, str) or not path.strip() for path in negative_paths)
    ):
        errors.append(
            "FORGED: 'negative_paths' must be a present, non-empty list of strings"
        )
    errors.extend(negative_path_binding_errors(ev))
    limitations = ev.get("limitations")
    if not isinstance(limitations, list) or any(
        not isinstance(item, str) for item in limitations
    ):
        errors.append(
            "FORGED: 'limitations' must be a present list of strings (possibly empty)"
        )

    change_kind = ev.get("change_kind")
    if change_kind not in CHANGE_KINDS:
        errors.append(f"FORGED: change_kind must be one of {sorted(CHANGE_KINDS)}")
    if ev.get("phase") not in PHASES:
        errors.append(f"FORGED: phase must be one of {sorted(PHASES)}")

    reviewer = ev.get("reviewer")
    if not isinstance(reviewer, dict):
        errors.append("FORGED: 'reviewer' must be an object")
    elif reviewer.get("status") not in REVIEWER_STATUSES:
        errors.append(
            f"FORGED: reviewer.status must be one of {sorted(REVIEWER_STATUSES)}"
        )

    implementer_id = ev.get("implementer_id")
    if not isinstance(implementer_id, str) or len(implementer_id.strip()) < 3:
        errors.append("FORGED: implementer_id must be a nontrivial actor identifier")

    for field in ("turn", "timestamp_utc", "workspace", "tree_sha"):
        if not isinstance(ev.get(field), str) or not ev[field].strip():
            errors.append(f"FORGED: '{field}' is missing or empty")
    if isinstance(ev.get("tree_sha"), str) and not TREE_FINGERPRINT_RE.fullmatch(
        ev["tree_sha"]
    ):
        errors.append(
            "FORGED: tree_sha must be an exact TREE:<sha256> or NONGIT:<sha256> fingerprint"
        )
    if not isinstance(ev.get("output"), str):
        errors.append("FORGED: 'output' must be a string")
    output_sha = ev.get("output_sha256")
    if not isinstance(output_sha, str) or not SHA256_RE.fullmatch(output_sha):
        errors.append("FORGED: output_sha256 must be a 64-character lowercase SHA-256")
    elif isinstance(ev.get("output"), str) and sha256_text(ev["output"]) != output_sha:
        errors.append("FORGED: output_sha256 does not match the exact stored output")
    if not isinstance(ev.get("output_truncated"), bool):
        errors.append("FORGED: output_truncated must be a boolean")
    exit_code = ev.get("exit_code")
    if not isinstance(exit_code, int) or isinstance(exit_code, bool):
        errors.append("FORGED: exit_code must be an integer")

    if "risk" in ev and ev["risk"] not in RISKS:
        errors.append(f"FORGED: risk must be one of {sorted(RISKS)}")
    links = ev.get("links", ev.get("linked_evidence", {}))
    if links is not None and (
        not isinstance(links, dict)
        or any(
            not isinstance(key, str) or not isinstance(value, str)
            for key, value in links.items()
        )
    ):
        errors.append(
            "FORGED: links must be an object mapping phases to relative evidence paths"
        )
    mutation = ev.get("mutation")
    if ev.get("phase") == "mutation":
        if not isinstance(mutation, dict):
            errors.append("FORGED: mutation phase requires a mutation object")
        else:
            targets = mutation.get("target_paths")
            if (
                not isinstance(targets, list)
                or not targets
                or any(
                    not isinstance(path, str)
                    or not path.strip()
                    or Path(path).is_absolute()
                    or ".." in Path(path).parts
                    for path in targets
                )
            ):
                errors.append(
                    "FORGED: mutation.target_paths must be non-empty safe relative paths"
                )
            pre_tree = mutation.get("pre_mutation_tree_sha")
            if not isinstance(pre_tree, str) or not TREE_FINGERPRINT_RE.fullmatch(
                pre_tree
            ):
                errors.append(
                    "FORGED: mutation.pre_mutation_tree_sha must be an exact tree fingerprint"
                )
    elif mutation is not None:
        errors.append("FORGED: mutation metadata is allowed only for phase=mutation")
    errors.extend(correlation_errors(ev))
    errors.extend(execution_errors(ev))
    return errors


def phase_errors(ev: dict[str, Any], *, final: bool = False) -> list[str]:
    phase = ev.get("phase")
    exit_code = ev.get("exit_code")
    errors: list[str] = []
    if phase in {"red", "mutation"} and exit_code == 0:
        errors.append(f"FAILED: phase {phase} evidence must have a nonzero exit_code")
    if phase in {"green", "verification"} and exit_code != 0:
        errors.append(f"FAILED: phase {phase} evidence must have exit_code=0")
    if final and phase not in FINAL_PHASES:
        errors.append("FAILED: final gate accepts only green or verification evidence")
    return errors


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _run_git(workspace: Path, args: list[str], *, check: bool = False) -> bytes:
    result = subprocess.run(
        ["git", *args], cwd=workspace, capture_output=True, timeout=10, check=False
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace"))
    return result.stdout


def _ignored_verify_path(path: str) -> bool:
    """Return whether a path is verifier-owned volatile runtime state."""

    normalized = path.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = normalized.rstrip("/")
    if normalized in _FINGERPRINT_RUNTIME_FILES:
        return True
    if normalized == ".forgewright/memory.db" or normalized.startswith(
        ".forgewright/memory.db-"
    ):
        return True
    return any(
        normalized == directory or normalized.startswith(directory + "/")
        for directory in _FINGERPRINT_RUNTIME_DIRS
    )


def _ignored_dependency_cache_path(path: str) -> bool:
    """Return whether an ignored path lives in a reproducible dependency cache."""

    normalized = path.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return any(
        part in _FINGERPRINT_IGNORED_DEPENDENCY_DIR_NAMES
        for part in normalized.split("/")
        if part
    )


def _actual_record(workspace: Path, relative: str) -> str:
    path = workspace / relative
    try:
        info = path.lstat()
    except FileNotFoundError:
        return f"worktree|{relative}|MISSING"
    mode = stat.S_IFMT(info.st_mode) | stat.S_IMODE(info.st_mode)
    if stat.S_ISLNK(info.st_mode):
        payload = os.readlink(path).encode("utf-8", "surrogateescape")
        kind = "symlink"
    elif stat.S_ISREG(info.st_mode):
        payload = path.read_bytes()
        kind = "file"
    else:
        payload = b""
        kind = "other"
    return f"worktree|{relative}|{mode:o}|{kind}|{hashlib.sha256(payload).hexdigest()}"


def _untracked_record(workspace: Path, relative: str) -> list[str]:
    """Represent untracked files, including embedded repositories Git reports as a dir."""

    normalized = relative.rstrip("/")
    root = workspace / normalized
    try:
        root_info = root.lstat()
    except FileNotFoundError:
        return [_actual_record(workspace, normalized)]
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        return [_actual_record(workspace, normalized)]

    records = [_actual_record(workspace, normalized)]
    for directory, dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(directory)
        relative_dir = current.relative_to(workspace).as_posix()
        dirnames[:] = sorted(
            name
            for name in dirnames
            if name != ".git" and not _ignored_verify_path(f"{relative_dir}/{name}")
        )
        for name in dirnames:
            records.append(_actual_record(workspace, f"{relative_dir}/{name}"))
        for name in sorted(filenames):
            child = f"{relative_dir}/{name}"
            if name == ".git" or _ignored_verify_path(child):
                continue
            records.append(_actual_record(workspace, child))
    return records


def _git_paths(workspace: Path, args: list[str]) -> list[str]:
    return [
        item.decode("utf-8", "surrogateescape")
        for item in _run_git(workspace, args).split(b"\0")
        if item
    ]


def worktree_fingerprint(
    workspace: Path,
    *,
    records_out: dict[str, str] | None = None,
    excluded_paths: Iterable[str] = (),
) -> str:
    """Hash HEAD plus staged/unstaged tracked, untracked, and ignored source state.

    Explicit verifier-owned runtime state is excluded so evidence capture,
    hooks, and independent review cannot invalidate the evidence by operating.
    Project configuration and arbitrary ignored files remain covered. Unlike the
    old DIRTY fallback, every covered state is represented by an exact digest
    and same-HEAD changes are not accepted.

    When ``records_out`` is supplied, populate it with the exact covered path
    records gathered during the fingerprint pass. This lets callers diagnose
    changed paths without re-reading the whole worktree a second time.

    ``excluded_paths`` is an explicit caller-owned boundary for generated output
    that a verifier is expected to rewrite. Defaults remain fail-closed: callers
    must opt in to every excluded path, and normal evidence fingerprints cover
    the full project state except verifier-owned runtime paths above.
    """

    def normalize_relative(value: str) -> str:
        normalized = value.replace("\\", "/")
        while normalized.startswith("./"):
            normalized = normalized[2:]
        return normalized.rstrip("/")

    normalized_exclusions = tuple(
        sorted(
            {
                normalize_relative(value)
                for value in excluded_paths
                if normalize_relative(value)
            }
        )
    )

    def path_ignored(relative: str) -> bool:
        normalized = normalize_relative(relative)
        return _ignored_verify_path(normalized) or any(
            normalized == prefix or normalized.startswith(prefix + "/")
            for prefix in normalized_exclusions
        )

    try:
        inside = _run_git(workspace, ["rev-parse", "--is-inside-work-tree"]).strip()
    except (OSError, subprocess.SubprocessError, RuntimeError):
        inside = b""
    if inside != b"true":
        digest = hashlib.sha256()
        for root, dirs, files in os.walk(workspace):
            dirs[:] = [d for d in dirs if d != ".git"]
            for name in sorted(files):
                path = Path(root) / name
                relative = path.relative_to(workspace).as_posix()
                if path_ignored(relative):
                    continue
                record = _actual_record(workspace, relative)
                if records_out is not None:
                    records_out[relative] = record
                digest.update(record.encode())
                digest.update(b"\0")
        return f"NONGIT:{digest.hexdigest()}"

    try:
        head = _run_git(workspace, ["rev-parse", "HEAD"], check=True).decode().strip()
        index_records = []
        index_metadata: dict[str, str] = {}
        submodule_paths: list[str] = []
        for record in _run_git(workspace, ["ls-files", "-s", "-z"]).split(b"\0"):
            if not record:
                continue
            metadata, raw_path = record.split(b"\t", 1)
            relative = raw_path.decode("utf-8", "surrogateescape")
            if not path_ignored(relative):
                metadata_text = metadata.decode("ascii", "replace")
                index_records.append("index|" + relative + "|" + metadata_text)
                index_metadata[relative] = metadata_text
                if metadata_text.startswith("160000 "):
                    submodule_paths.append(relative)
        tracked = _git_paths(workspace, ["ls-files", "-z"])
        untracked = _git_paths(
            workspace, ["ls-files", "--others", "--exclude-standard", "-z"]
        )
        ignored = _git_paths(
            workspace,
            ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
        )
        ignored = [
            relative
            for relative in ignored
            if not _ignored_dependency_cache_path(relative)
        ]
        records = [f"HEAD|{head}", *sorted(index_records)]
        for relative in sorted(set(tracked)):
            if path_ignored(relative):
                continue
            record = _actual_record(workspace, relative)
            records.append(record)
            if records_out is not None:
                records_out[relative] = (
                    record + "|index|" + index_metadata.get(relative, "")
                )
        for relative in sorted(set((*untracked, *ignored))):
            if path_ignored(relative):
                continue
            for record in _untracked_record(workspace, relative):
                records.append(record)
                if records_out is not None:
                    parts = record.split("|", 2)
                    diagnostic_path = parts[1] if len(parts) > 1 else relative
                    records_out[diagnostic_path] = record
        for relative in sorted(set(submodule_paths)):
            submodule = workspace / relative
            nested = (
                worktree_fingerprint(submodule) if submodule.is_dir() else "MISSING"
            )
            submodule_record = f"submodule|{relative}|{nested}"
            records.append(submodule_record)
            if records_out is not None:
                prior = records_out.get(relative, "")
                records_out[relative] = (
                    f"{prior}|{submodule_record}" if prior else submodule_record
                )
        digest = hashlib.sha256()
        for record in records:
            digest.update(record.encode("utf-8", "surrogateescape"))
            digest.update(b"\0")
        return f"TREE:{digest.hexdigest()}"
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as error:
        return f"GITERR:{hashlib.sha256(str(error).encode()).hexdigest()}"


def changed_files(workspace: Path) -> list[str]:
    try:
        tracked = _git_paths(workspace, ["diff", "--name-only", "-z"])
        staged = _git_paths(workspace, ["diff", "--name-only", "-z", "--cached"])
        untracked = _git_paths(
            workspace, ["ls-files", "--others", "--exclude-standard", "-z"]
        )
        return sorted(
            {
                path
                for path in (*tracked, *staged, *untracked)
                if not _ignored_verify_path(path)
            }
        )
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return []


def hard_signal(workspace: Path, files: Iterable[str]) -> bool:
    file_list = list(files)
    pieces: list[str] = [*file_list]
    try:
        for args in (("diff", "--no-ext-diff"), ("diff", "--cached", "--no-ext-diff")):
            pieces.append(_run_git(workspace, list(args)).decode("utf-8", "replace"))
    except (OSError, subprocess.SubprocessError, RuntimeError):
        pass
    for relative in file_list:
        if _ignored_verify_path(relative):
            continue
        path = workspace / relative
        try:
            if path.is_file():
                pieces.append(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            pass
    return bool(HARD_TERMS_RE.search("\n".join(pieces)))


def nontrivial_reviewer_id(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.strip().lower()
    return (
        bool(normalized)
        and len(normalized) >= 3
        and normalized
        not in {
            "self",
            "agent",
            "reviewer",
            "unknown",
            "n/a",
            "none",
        }
    )


def link_values(ev: dict[str, Any]) -> dict[str, str]:
    links = ev.get("links")
    if links is None:
        links = ev.get("linked_evidence", {})
    return dict(links) if isinstance(links, dict) else {}


def _windows_has_reparse_component(root: Path, path: Path) -> bool:
    """Reject Windows symlinks, junctions, and other reparse-point components."""

    try:
        root_lexical = Path(os.path.abspath(root))
        root_real = root.resolve()
        candidate = path if path.is_absolute() else root_lexical / path
        candidate_lexical = Path(os.path.abspath(candidate))
        try:
            relative = candidate_lexical.relative_to(root_lexical)
            component_root = root_lexical
        except ValueError:
            candidate_lexical = candidate_lexical.resolve(strict=False)
            relative = candidate_lexical.relative_to(root_real)
            component_root = root_real
    except (OSError, RuntimeError, ValueError):
        return True
    current = component_root
    for component in relative.parts:
        current /= component
        try:
            info = current.lstat()
        except FileNotFoundError:
            continue
        except OSError:
            return True
        if stat.S_ISLNK(info.st_mode) or bool(
            getattr(info, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        ):
            return True
    try:
        candidate_lexical.resolve(strict=False).relative_to(root_real)
    except (OSError, RuntimeError, ValueError):
        return True
    return False


def _read_evidence_bytes_windows(
    root: Path, candidate: Path, *, max_bytes: int
) -> bytes:
    """Windows bounded read with reparse and identity checks around the handle."""

    if max_bytes < 0 or _windows_has_reparse_component(root, candidate):
        raise ValueError("evidence must be a readable regular non-symlink file")
    try:
        initial = candidate.lstat()
        if (
            not stat.S_ISREG(initial.st_mode)
            or initial.st_size > max_bytes
            or bool(
                getattr(initial, "st_file_attributes", 0)
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            )
        ):
            raise ValueError("evidence must be a bounded regular non-symlink file")
        descriptor = os.open(
            candidate,
            os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0),
        )
    except OSError as error:
        raise ValueError(
            "evidence must be a readable regular non-symlink file"
        ) from error
    try:
        opened = os.fstat(descriptor)
        identity = (opened.st_dev, opened.st_ino)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size > max_bytes
            or identity != (initial.st_dev, initial.st_ino)
            or bool(
                getattr(opened, "st_file_attributes", 0)
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            )
        ):
            raise ValueError("evidence changed or became unsafe while opening")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > max_bytes:
            raise ValueError("evidence exceeds the bounded size limit")
        final = os.fstat(descriptor)
        current = candidate.lstat()
        if (
            (final.st_dev, final.st_ino) != identity
            or final.st_size != opened.st_size
            or final.st_mtime_ns != opened.st_mtime_ns
            or not stat.S_ISREG(current.st_mode)
            or (current.st_dev, current.st_ino) != identity
            or current.st_size != final.st_size
            or current.st_mtime_ns != final.st_mtime_ns
            or bool(
                getattr(current, "st_file_attributes", 0)
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            )
            or _windows_has_reparse_component(root, candidate)
        ):
            raise ValueError("evidence changed or became unsafe while reading")
        return payload
    except OSError as error:
        raise ValueError(
            "evidence must be a readable regular non-symlink file"
        ) from error
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass


def read_evidence_bytes(
    project_root: Path,
    path: Path | str,
    *,
    max_bytes: int = MAX_EVIDENCE_BYTES,
) -> bytes:
    """Read one bounded regular evidence file without following symlinks."""
    root = project_root.resolve()
    verify_dir = root / ".forgewright" / "verify"
    candidate = Path(path)
    if candidate.is_absolute():
        try:
            relative = candidate.relative_to(verify_dir)
        except ValueError as error:
            raise ValueError(
                "evidence path must stay inside .forgewright/verify"
            ) from error
    else:
        relative = candidate
    if (
        not relative.parts
        or relative.is_absolute()
        or "\0" in str(relative)
        or any(part in {"", ".", ".."} for part in relative.parts)
        or (os.name == "nt" and any(":" in part for part in relative.parts))
    ):
        raise ValueError("evidence path must be a safe relative path")

    if os.name == "nt":
        return _read_evidence_bytes_windows(
            root, verify_dir / relative, max_bytes=max_bytes
        )

    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    cloexec = getattr(os, "O_CLOEXEC", 0)
    opened: list[int] = []
    try:
        current = os.open(root, directory_flags | cloexec)
        opened.append(current)
        for part in (".forgewright", "verify", *relative.parts[:-1]):
            current = os.open(
                part,
                directory_flags | nofollow | cloexec,
                dir_fd=current,
            )
            opened.append(current)
        file_fd = os.open(
            relative.parts[-1],
            os.O_RDONLY | nofollow | cloexec,
            dir_fd=current,
        )
        opened.append(file_fd)
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("evidence must be a regular non-symlink file")
        if info.st_size > max_bytes:
            raise ValueError("evidence exceeds the bounded size limit")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(file_fd, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > max_bytes:
            raise ValueError("evidence exceeds the bounded size limit")
        return payload
    except OSError as error:
        raise ValueError(
            "evidence must be a readable regular non-symlink file"
        ) from error
    finally:
        for descriptor in reversed(opened):
            try:
                os.close(descriptor)
            except OSError:
                pass


def read_evidence_json(
    project_root: Path,
    path: Path | str,
    *,
    max_bytes: int = MAX_EVIDENCE_BYTES,
) -> dict[str, Any]:
    """Read an evidence JSON object and bind schema-v2 turn to its filename."""
    payload = read_evidence_bytes(project_root, path, max_bytes=max_bytes)
    try:
        record = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"evidence is not valid UTF-8 JSON: {error}") from error
    if not isinstance(record, dict):
        raise ValueError("evidence JSON must be an object")
    if record.get("schema_version") == SCHEMA_VERSION:
        expected_turn = Path(path).stem
        if record.get("turn") != expected_turn:
            raise ValueError("schema-v2 evidence turn must match its filename")
    return record


def resolve_evidence_link(
    project_root: Path, raw: Any
) -> tuple[Path | None, str | None]:
    if not isinstance(raw, str) or not raw.strip():
        return None, "FORGED: linked evidence path must be a non-empty relative path"
    relative = raw.strip()
    candidate_path = Path(relative)
    if candidate_path.is_absolute() or "\0" in relative:
        return None, "FORGED: linked evidence path must stay inside .forgewright/verify"
    if any(part == ".." for part in candidate_path.parts):
        return None, "FORGED: linked evidence path traversal is rejected"
    verify_dir = project_root.resolve() / ".forgewright" / "verify"
    candidate = verify_dir / candidate_path
    try:
        read_evidence_bytes(project_root, candidate)
    except ValueError as error:
        if not candidate.exists() and not candidate.is_symlink():
            return None, f"MISSING: linked evidence file {relative!r} was not found"
        return None, f"FORGED: linked evidence is unsafe: {error}"
    if not candidate.exists():
        return None, f"MISSING: linked evidence file {relative!r} was not found"
    return candidate, None
