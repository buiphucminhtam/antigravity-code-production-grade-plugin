#!/usr/bin/env python3
"""Write one exact, machine-produced Forgewright evidence record.

The command is deliberately metadata-first: missing v2 metadata and trivial
commands are rejected before the requested command is started.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from evidence_common import (
    CHANGE_KINDS,
    EVIDENCE_TIERS,
    PHASES,
    SCHEMA_VERSION,
    acceptance_errors,
    command_errors,
    command_text,
    correlation_errors,
    execution_manifest,
    negative_path_binding_errors,
    redact,
    schema_errors,
    sha256_text,
    worktree_fingerprint,
)


_OUTPUT_MAX = 16_384


def _redact(text: str) -> str:
    """Redact secrets in memory only; source files are never touched."""
    return redact(text)


def _tree_sha(workspace: Path) -> str:
    """Compatibility name for the exact v2 worktree fingerprint."""
    return worktree_fingerprint(workspace)


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


def _parse_acceptances(
    values: list[str], ids: list[str], claims: list[str]
) -> list[dict[str, str]]:
    parsed: list[dict[str, str]] = []
    for value in values:
        raw = value.strip()
        separator = "=" if "=" in raw else ":"
        if separator not in raw:
            continue
        identifier, claim = raw.split(separator, 1)
        parsed.append({"id": identifier.strip(), "claim": claim.strip()})
    if not parsed and ids:
        if len(ids) != len(claims):
            return []
        parsed = [
            {"id": identifier.strip(), "claim": claim.strip()}
            for identifier, claim in zip(ids, claims)
        ]
    return parsed


def _parse_links(
    values: list[str], red: str | None, mutation: str | None
) -> dict[str, str]:
    links: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            continue
        key, path = value.split("=", 1)
        links[key.strip()] = path.strip()
    if red:
        links["red"] = red
    if mutation:
        links["mutation"] = mutation
    return links


def _parse_acceptance_tests(
    values: list[str],
) -> tuple[dict[str, list[str]], list[str]]:
    mapping: dict[str, list[str]] = {}
    errors: list[str] = []
    for value in values:
        if "=" not in value:
            errors.append(
                f"FORGED: --acceptance-test must use ACCEPTANCE_ID=TEST_REF, got {value!r}"
            )
            continue
        acceptance_id, test_ref = (part.strip() for part in value.split("=", 1))
        if not acceptance_id or not test_ref:
            errors.append(
                f"FORGED: --acceptance-test has an empty ID or test ref: {value!r}"
            )
            continue
        mapping.setdefault(acceptance_id, []).append(test_ref)
    return mapping, errors


def _parse_negative_path_bindings(
    values: list[str],
) -> tuple[list[dict[str, object]], list[str]]:
    """Parse ID=CLAIM|ACCEPTANCE_ID[,..]|TEST_REF[,..] bindings."""

    bindings: list[dict[str, object]] = []
    errors: list[str] = []
    for value in values:
        raw = value.strip()
        parts = raw.split("|")
        if len(parts) != 3:
            errors.append(
                "FORGED: --negative-path-binding must use "
                "ID=CLAIM|ACCEPTANCE_ID[,..]|TEST_REF[,..]"
            )
            continue
        identifier, claim = (
            (part.strip() for part in parts[0].split("=", 1))
            if "=" in parts[0]
            else ("", "")
        )
        acceptance_ids = [item.strip() for item in parts[1].split(",") if item.strip()]
        test_refs = [item.strip() for item in parts[2].split(",") if item.strip()]
        if not identifier or not claim or not acceptance_ids or not test_refs:
            errors.append(
                f"FORGED: --negative-path-binding has an empty field: {value!r}"
            )
            continue
        bindings.append(
            {
                "id": identifier,
                "claim": claim,
                "acceptance_ids": acceptance_ids,
                "test_refs": test_refs,
            }
        )
    return bindings, errors


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turn", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--redact", default="1")
    parser.add_argument("--no-redact", action="store_true")
    parser.add_argument(
        "--acceptance", "--acceptance-criteria", action="append", default=[]
    )
    parser.add_argument("--acceptance-id", action="append", default=[])
    parser.add_argument("--claim", action="append", default=[])
    parser.add_argument(
        "--acceptance-test",
        action="append",
        default=[],
        help="Map one acceptance ID to one concrete test ref: ID=TEST_REF",
    )
    parser.add_argument("--tier", default=None)
    parser.add_argument("--test-ref", "--test-refs", action="append", default=[])
    parser.add_argument(
        "--negative-path", "--negative-paths", action="append", default=[]
    )
    parser.add_argument(
        "--negative-path-binding",
        action="append",
        default=[],
        help="Bind a negative path: ID=CLAIM|ACCEPTANCE_ID[,..]|TEST_REF[,..]",
    )
    parser.add_argument("--limitations", action="append", default=None)
    parser.add_argument("--change-kind", default=None)
    parser.add_argument("--phase", default=None)
    parser.add_argument("--risk", default=None)
    parser.add_argument(
        "--implementer-id", default=os.environ.get("FORGEWRIGHT_ACTOR_ID")
    )
    parser.add_argument("--reviewer", default=None, help="Reviewer JSON object")
    parser.add_argument("--reviewer-id", default=None)
    parser.add_argument("--reviewer-status", default=None)
    parser.add_argument("--reviewer-evidence-ref", default=None)
    parser.add_argument("--link", action="append", default=[])
    parser.add_argument("--red-evidence", default=None)
    parser.add_argument("--mutation-evidence", default=None)
    parser.add_argument("--mutation-target", action="append", default=[])
    parser.add_argument("--pre-mutation-tree-sha", default=None)
    parser.add_argument("cmd", nargs=argparse.REMAINDER)
    return parser


def _metadata_errors(
    args: argparse.Namespace, command: list[str], workspace: Path
) -> tuple[list[str], dict]:
    acceptance = _parse_acceptances(args.acceptance, args.acceptance_id, args.claim)
    acceptance_tests, acceptance_test_errors = _parse_acceptance_tests(
        args.acceptance_test
    )
    negative_bindings, negative_binding_errors = _parse_negative_path_bindings(
        args.negative_path_binding
    )
    acceptance_ids = {item.get("id") for item in acceptance if isinstance(item, dict)}
    if not acceptance_tests and len(acceptance) == 1:
        acceptance_tests[str(acceptance[0].get("id", ""))] = list(args.test_ref)
    for criterion in acceptance:
        criterion["test_refs"] = acceptance_tests.get(criterion.get("id", ""), [])
    if (
        not negative_bindings
        and not args.negative_path_binding
        and len(args.negative_path) == 1
        and len(acceptance) == 1
    ):
        negative_bindings = [
            {
                "id": "negative-path-1",
                "claim": args.negative_path[0],
                "acceptance_ids": [str(acceptance[0].get("id", ""))],
                "test_refs": list(args.test_ref),
            }
        ]
    reviewer: dict[str, str]
    if args.reviewer:
        try:
            parsed_reviewer = json.loads(args.reviewer)
        except json.JSONDecodeError:
            parsed_reviewer = None
        reviewer = parsed_reviewer if isinstance(parsed_reviewer, dict) else {}
    else:
        reviewer = {}
    if args.reviewer_id is not None:
        reviewer["id"] = args.reviewer_id
    if args.reviewer_status is not None:
        reviewer["status"] = args.reviewer_status
    if args.reviewer_evidence_ref is not None:
        reviewer["evidence_ref"] = args.reviewer_evidence_ref

    ev = {
        "schema_version": SCHEMA_VERSION,
        "acceptance_criteria": acceptance,
        "command": command,
        "tier": args.tier,
        "test_refs": args.test_ref,
        "negative_paths": args.negative_path,
        "negative_path_bindings": negative_bindings,
        "limitations": args.limitations,
        "change_kind": args.change_kind,
        "phase": args.phase,
        "implementer_id": args.implementer_id,
        "reviewer": reviewer,
    }
    if args.phase == "mutation" or args.mutation_target or args.pre_mutation_tree_sha:
        ev["mutation"] = {
            "target_paths": args.mutation_target,
            "pre_mutation_tree_sha": args.pre_mutation_tree_sha,
        }
    errors: list[str] = []
    errors.extend(acceptance_test_errors)
    errors.extend(negative_binding_errors)
    unknown_acceptance_tests = sorted(set(acceptance_tests) - acceptance_ids)
    if unknown_acceptance_tests:
        errors.append(
            "FORGED: --acceptance-test references unknown acceptance IDs: "
            f"{unknown_acceptance_tests}"
        )
    if not acceptance:
        errors.append("MISSING: --acceptance ID=CLAIM is required")
    errors.extend(acceptance_errors(acceptance, args.test_ref))
    if not args.tier:
        errors.append("MISSING: --tier is required")
    if not args.test_ref:
        errors.append("MISSING: at least one --test-ref is required")
    if not args.negative_path:
        errors.append("MISSING: at least one --negative-path is required")
    if args.limitations is None:
        errors.append("MISSING: --limitations is required (it may be empty)")
    if not args.change_kind:
        errors.append("MISSING: --change-kind is required")
    if not args.phase:
        errors.append("MISSING: --phase is required")
    if not args.implementer_id:
        errors.append("MISSING: --implementer-id or FORGEWRIGHT_ACTOR_ID is required")
    elif len(args.implementer_id.strip()) < 3:
        errors.append("FORGED: --implementer-id must be a nontrivial identifier")
    if args.reviewer is not None and not reviewer:
        errors.append("FORGED: --reviewer must contain a JSON object")
    if not args.reviewer_status and not reviewer.get("status"):
        errors.append("MISSING: --reviewer-status is required")
    errors.extend(command_errors(command))
    if args.tier is not None and args.tier not in EVIDENCE_TIERS:
        errors.append("FORGED: tier is not a recognized evidence tier")
    if args.change_kind is not None and args.change_kind not in CHANGE_KINDS:
        errors.append("FORGED: change_kind is not recognized")
    if args.phase is not None and args.phase not in PHASES:
        errors.append("FORGED: phase must be one of verification/red/green/mutation")
    if args.phase == "mutation":
        if not args.mutation_target:
            errors.append("MISSING: mutation phase requires --mutation-target")
        if not args.pre_mutation_tree_sha:
            errors.append("MISSING: mutation phase requires --pre-mutation-tree-sha")
    errors.extend(correlation_errors(ev))
    execution, execution_errors = execution_manifest(workspace, command, args.test_ref)
    errors.extend(execution_errors)
    if execution is not None:
        ev["execution"] = execution
        normalized_refs = dict(zip(args.test_ref, execution["test_refs"]))
        ev["test_refs"] = [normalized_refs.get(ref, ref) for ref in ev["test_refs"]]
        for criterion in ev["acceptance_criteria"]:
            criterion["test_refs"] = [
                normalized_refs.get(ref, ref) for ref in criterion["test_refs"]
            ]
        for binding in ev["negative_path_bindings"]:
            binding["test_refs"] = [
                normalized_refs.get(ref, ref) for ref in binding["test_refs"]
            ]
    errors.extend(negative_path_binding_errors(ev))
    return list(dict.fromkeys(errors)), ev


def _strict_block(ev: dict, criterion: dict[str, str]) -> str:
    return "\n".join(
        (
            "VERIFY:",
            f"ACCEPTANCE: {criterion['id']}",
            f"CLAIM: {criterion['claim']}",
            f"COMMAND: {command_text(ev['command'])}",
            f"OUTPUT: sha256:{ev['output_sha256']}",
            f"EXIT CODE: {ev['exit_code']}",
            f"VERDICT: {'PASS' if ev['exit_code'] == 0 else 'FAIL'}",
        )
    )


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    command = list(args.cmd)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print("[run-check] ERROR: no command supplied.", file=sys.stderr)
        raise SystemExit(2)

    workspace = _workspace()
    metadata_errors, metadata = _metadata_errors(args, command, workspace)
    if metadata_errors:
        for error in metadata_errors:
            print(f"[run-check] ERROR: {error}", file=sys.stderr)
        print("[run-check] Command was not started.", file=sys.stderr)
        raise SystemExit(2)

    out_dir = Path(args.out) if args.out else workspace / ".forgewright" / "verify"
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()
    turn = (
        args.turn
        or os.environ.get("FORGEWRIGHT_TURN")
        or (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"_{os.getpid()}")
    )
    if (
        not turn
        or Path(turn).name != turn
        or any(part in {".", ".."} for part in Path(turn).parts)
    ):
        print(
            "[run-check] ERROR: turn must be a non-empty filename-safe identifier.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    do_redact = not args.no_redact and args.redact.lower() not in {"0", "false", "no"}
    started = datetime.now(timezone.utc)
    try:
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            cwd=str(workspace),
            timeout=300,
            check=False,
        )
        exit_code = process.returncode
        raw_output = (process.stdout or "") + (process.stderr or "")
    except FileNotFoundError as error:
        exit_code = 127
        raw_output = f"[run-check] Command not found: {error}"
    except subprocess.TimeoutExpired:
        exit_code = 124
        raw_output = "[run-check] Command timed out after 300s"

    output = _redact(raw_output) if do_redact else raw_output
    output_truncated = len(output) > _OUTPUT_MAX
    if output_truncated:
        output = output[:_OUTPUT_MAX]

    timestamp_utc = (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    links = _parse_links(args.link, args.red_evidence, args.mutation_evidence)
    reviewer = metadata["reviewer"]
    ev = {
        **metadata,
        "turn": turn,
        "command": command,
        "exit_code": exit_code,
        "output": output,
        "output_sha256": sha256_text(output),
        "output_truncated": output_truncated,
        "timestamp_utc": timestamp_utc,
        "workspace": str(workspace),
        # Compute only after the command; .forgewright/verify is excluded by the helper.
        "tree_sha": _tree_sha(workspace),
        "reviewer": reviewer,
    }
    if args.risk is not None:
        ev["risk"] = args.risk
    if links:
        ev["links"] = links

    final_schema_errors = schema_errors(ev)
    if final_schema_errors:
        for error in final_schema_errors:
            print(f"[run-check] ERROR: {error}", file=sys.stderr)
        print("[run-check] Evidence was not written.", file=sys.stderr)
        raise SystemExit(2)

    out_dir.mkdir(parents=True, exist_ok=True)
    evidence_file = out_dir / f"{turn}.json"
    fd, tmp_path = tempfile.mkstemp(prefix=".ev_", suffix=".json", dir=str(out_dir))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(ev, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
        os.replace(tmp_path, evidence_file)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    print(
        f"[run-check] Evidence -> {evidence_file}  exit_code={exit_code}",
        file=sys.stderr,
    )
    for criterion in ev["acceptance_criteria"]:
        print(_strict_block(ev, criterion))
        print()
    # The runner itself succeeds when it produced a record; the gate evaluates the
    # recorded exit code and phase. This preserves evidence for RED/MUTATION runs.
    _ = started
    raise SystemExit(0)


if __name__ == "__main__":
    main()
