#!/usr/bin/env python3
"""Validate strict response evidence against the exact turn's v2 record."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

# Keep direct import-by-path callers (the focused test suite and hook probes)
# on the same local module resolution path as normal script execution.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_common import (
    acceptance_map,
    command_text,
    read_evidence_json,
    redact,
)
from verify_gate import _find_evidence, completion_checks


EXECUTABLE_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ERROR: str | None = None
workspace_value = os.environ.get("FORGEWRIGHT_WORKSPACE")
if workspace_value:
    try:
        candidate_workspace = Path(workspace_value).expanduser().resolve(strict=True)
        if not candidate_workspace.is_dir() or not os.access(
            candidate_workspace, os.R_OK
        ):
            raise OSError("not a readable directory")
        PROJECT_ROOT = candidate_workspace
    except OSError as error:
        PROJECT_ROOT = EXECUTABLE_ROOT
        WORKSPACE_ERROR = f"FORGEWRIGHT_WORKSPACE is invalid: {error}"
else:
    try:
        workspace_result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        PROJECT_ROOT = (
            Path(workspace_result.stdout.strip()).resolve()
            if workspace_result.returncode == 0 and workspace_result.stdout.strip()
            else Path.cwd().resolve()
        )
    except (OSError, subprocess.SubprocessError):
        PROJECT_ROOT = Path.cwd().resolve()

KERNEL_FILES = (
    "ENTRY.md",
    "SOLVE.md",
    "VERIFY.md",
    "ESCALATE.md",
    "CLARIFY.md",
    "POLICY.md",
)
REQUIRED_VERIFY_FIELDS = (
    "ACCEPTANCE",
    "CLAIM",
    "COMMAND",
    "OUTPUT",
    "EXIT CODE",
    "VERDICT",
)
_FIELD_RE = re.compile(
    r"^\s*(ACCEPTANCE|CLAIM|COMMAND|OUTPUT|EXIT CODE|VERDICT):\s*(.*)\s*$",
    re.IGNORECASE,
)


def static_validation() -> int:
    kernel_dir = PROJECT_ROOT / "kernel"
    missing = [name for name in KERNEL_FILES if not (kernel_dir / name).is_file()]
    unreadable = [
        name
        for name in KERNEL_FILES
        if (kernel_dir / name).is_file() and not os.access(kernel_dir / name, os.R_OK)
    ]
    if missing or unreadable:
        if missing:
            print(
                f"Static validation failed: missing kernel files: {missing}",
                file=sys.stderr,
            )
        if unreadable:
            print(
                f"Static validation failed: unreadable kernel files: {unreadable}",
                file=sys.stderr,
            )
        return 1
    print("Static validation passed.")
    return 0


def _response_from_json(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in (
        "response_content",
        "last_assistant_message",
        "content",
        "assistant_response",
        "output",
        "response",
    ):
        candidate = value.get(key)
        if isinstance(candidate, str):
            return candidate
        if isinstance(candidate, list):
            texts = [item.get("text") for item in candidate if isinstance(item, dict)]
            if texts and all(isinstance(item, str) for item in texts):
                return "\n".join(texts)
    return None


def _payload_context(raw: str) -> tuple[str, str]:
    if not raw.strip():
        raise ValueError("response is empty")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw, os.environ.get("FORGEWRIGHT_TURN", "")
    response = _response_from_json(parsed)
    if response is None or not response.strip():
        raise ValueError("JSON payload has no supported response field")
    turn = ""
    if isinstance(parsed, dict):
        for key in ("turn", "turn_id"):
            candidate = parsed.get(key)
            if isinstance(candidate, str) and candidate.strip():
                turn = candidate.strip()
                break
    return response, turn or os.environ.get("FORGEWRIGHT_TURN", "")


def decode_response(raw: str) -> str:
    """Decode Codex/native JSON while retaining the historical public helper."""
    return _payload_context(raw)[0]


def _field(line: str) -> tuple[str, str] | None:
    match = _FIELD_RE.match(line)
    return (match.group(1).upper(), match.group(2).strip()) if match else None


def _block_ranges(response: str) -> tuple[list[tuple[int, int]], list[str]]:
    lines = response.splitlines()
    field_positions = [(index, _field(line)) for index, line in enumerate(lines)]
    # CLAIM is a field inside a block, not a block delimiter. Legacy CLAIM-only
    # responses therefore produce one block that fails the required ACCEPTANCE
    # check instead of being split into a phantom second block.
    starts = [
        index
        for index, parsed in field_positions
        if parsed and parsed[0] == "ACCEPTANCE"
    ]
    if not starts:
        return [], [
            "no strict VERIFY block found; marker-only VERIFY and fenced markers are not evidence"
        ]
    ranges: list[tuple[int, int]] = []
    errors: list[str] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        first = _field(lines[start])
        if first is None or first[0] != "ACCEPTANCE":
            errors.append(f"VERIFY block {position + 1} must start with ACCEPTANCE")
            continue
        ranges.append((start, end))
    return ranges, errors


def _parse_blocks(response: str) -> tuple[list[dict[str, str]], list[str]]:
    lines = response.splitlines()
    ranges, errors = _block_ranges(response)
    blocks: list[dict[str, str]] = []
    expected = list(REQUIRED_VERIFY_FIELDS)
    for number, (start, end) in enumerate(ranges, 1):
        fields: dict[str, str] = {}
        positions: list[tuple[str, int]] = []
        for index in range(start, end):
            parsed = _field(lines[index])
            if parsed:
                if parsed[0] in fields:
                    errors.append(f"VERIFY block {number} repeats {parsed[0]}")
                fields[parsed[0]] = parsed[1]
                positions.append((parsed[0], index))
            elif lines[index].strip() and lines[index].strip().upper() != "VERIFY:":
                errors.append(f"VERIFY block {number} contains non-field text")
        missing = [name for name in expected if name not in fields]
        if missing:
            errors.append(f"VERIFY block {number} missing fields: {', '.join(missing)}")
            continue
        if [name for name, _ in positions] != expected:
            errors.append(
                f"VERIFY block {number} fields must be consecutive in strict order"
            )
            continue
        if not fields["ACCEPTANCE"] or not fields["CLAIM"] or not fields["COMMAND"]:
            errors.append(
                f"VERIFY block {number} has an empty ACCEPTANCE, CLAIM, or COMMAND"
            )
        if not fields["OUTPUT"].startswith("sha256:"):
            errors.append(
                f"VERIFY block {number} OUTPUT must be sha256:<output_sha256>"
            )
        if fields["EXIT CODE"] != "0":
            errors.append(f"VERIFY block {number} EXIT CODE is not 0")
        if fields["VERDICT"].upper() != "PASS":
            errors.append(f"VERIFY block {number} VERDICT is not PASS")
        blocks.append(fields)
    return blocks, errors


def _load_exact_evidence(
    turn: str,
) -> tuple[dict[str, Any] | None, Path | None, list[str]]:
    if turn and (
        Path(turn).name != turn or any(part in {".", ".."} for part in Path(turn).parts)
    ):
        return None, None, ["FORGED: exact evidence turn is not a safe identifier"]
    path = _find_evidence(PROJECT_ROOT, turn)
    if path is None:
        message = (
            f"MISSING: exact-turn evidence {turn!r} was not found"
            if turn
            else "MISSING: no current passing schema-v2 final evidence was found"
        )
        return None, None, [message]
    try:
        evidence = read_evidence_json(PROJECT_ROOT, path)
    except ValueError as error:
        return None, None, [f"FORGED: exact-turn evidence could not be read: {error}"]
    return evidence, path, []


def _evidence_errors(evidence: dict[str, Any], evidence_path: Path) -> list[str]:
    _, checks = completion_checks(
        evidence,
        PROJECT_ROOT,
        evidence_path,
        None,
    )
    return [error for _, check_errors in checks for error in check_errors]


def validate_verify_blocks(
    response: str, evidence: dict[str, Any] | None = None
) -> list[str]:
    """Validate strict blocks and, when supplied, correlate them to v2 evidence."""
    blocks, errors = _parse_blocks(response)
    if evidence is None:
        return errors
    criteria = acceptance_map(evidence)
    if len(blocks) != len(criteria):
        errors.append(
            "MISMATCH: every exact-turn acceptance criterion must be represented exactly once"
        )
    seen: set[str] = set()
    exact_command = command_text(evidence.get("command", []))
    exact_digest = f"sha256:{evidence.get('output_sha256', '')}"
    for number, block in enumerate(blocks, 1):
        raw_acceptance = block.get("ACCEPTANCE", "")
        acceptance_id, separator, embedded_claim = raw_acceptance.partition("|")
        acceptance_id = acceptance_id.strip()
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", acceptance_id):
            errors.append(f"VERIFY block {number} ACCEPTANCE is not a lowercase slug")
            continue
        if separator and embedded_claim.strip() != block.get("CLAIM", ""):
            errors.append(
                f"VERIFY block {number} ACCEPTANCE claim does not match CLAIM"
            )
        if acceptance_id in seen:
            errors.append(f"VERIFY block {number} repeats acceptance {acceptance_id}")
        seen.add(acceptance_id)
        if acceptance_id not in criteria:
            errors.append(
                f"MISMATCH: response acceptance {acceptance_id!r} is not in exact-turn evidence"
            )
            continue
        if block.get("CLAIM") != criteria[acceptance_id]:
            errors.append(
                f"MISMATCH: response claim does not exactly match acceptance {acceptance_id}"
            )
        if block.get("COMMAND") != exact_command:
            errors.append(
                "MISMATCH: response command does not exactly match shlex-rendered evidence command"
            )
        if block.get("OUTPUT") != exact_digest:
            errors.append(
                "MISMATCH: response OUTPUT digest does not exactly match evidence output_sha256"
            )
    if seen != set(criteria):
        errors.append(
            "MISMATCH: response did not represent every exact-turn acceptance ID"
        )
    return errors


def record_violation(note: str) -> int:
    ledger = EXECUTABLE_ROOT / "scripts" / "lite" / "rule-ledger.sh"
    result = subprocess.run(
        [
            "bash",
            str(ledger),
            "add",
            "HR1-verify",
            "violation",
            f"source: validator - {redact(note)}",
        ],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        print(
            "Runtime validation failed and the violation ledger write also failed.",
            file=sys.stderr,
        )
        if result.stderr:
            print(redact(result.stderr.strip()), file=sys.stderr)
        return result.returncode or 1
    return 0


def runtime_validation(raw: str) -> int:
    try:
        response, turn = _payload_context(raw)
        evidence, evidence_path, errors = _load_exact_evidence(turn)
        if evidence is not None:
            assert evidence_path is not None
            errors.extend(_evidence_errors(evidence, evidence_path))
            if not errors:
                errors.extend(validate_verify_blocks(response, evidence))
        else:
            # No evidence means no strict correlation target; do not accept markers.
            _, shape_errors = _parse_blocks(response)
            errors.extend(shape_errors)
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        errors = [str(error)]

    if not errors:
        print("Runtime validation passed.")
        return 0
    note = "; ".join(errors)
    print(f"Runtime validation failed: {note}", file=sys.stderr)
    ledger_rc = record_violation(note)
    return ledger_rc if ledger_rc != 0 else 1


def read_runtime_input(path: str | None) -> str:
    if path and path != "-":
        transcript = Path(path)
        if not transcript.is_absolute():
            transcript = PROJECT_ROOT / transcript
        if not transcript.is_file() or not os.access(transcript, os.R_OK):
            raise OSError(f"transcript is missing or unreadable: {transcript}")
        return transcript.read_text(encoding="utf-8")
    return sys.stdin.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--static", action="store_true")
    mode.add_argument("--runtime", action="store_true")
    parser.add_argument("--transcript", help="Transcript path, or '-' for stdin")
    args = parser.parse_args()
    if WORKSPACE_ERROR:
        print(WORKSPACE_ERROR, file=sys.stderr)
        return 1
    if args.static:
        return static_validation()
    try:
        raw = read_runtime_input(args.transcript)
    except (OSError, UnicodeError) as error:
        return _runtime_input_failure(str(error))
    return runtime_validation(raw)


def _runtime_input_failure(note: str) -> int:
    print(f"Runtime validation failed: {redact(note)}", file=sys.stderr)
    ledger_rc = record_violation(note)
    return ledger_rc if ledger_rc != 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
