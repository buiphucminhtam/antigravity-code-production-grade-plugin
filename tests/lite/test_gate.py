"""
tests/lite/test_gate.py
Deterministic tests for the Forgewright verify-gate pipeline.

Covers:
  - Forgery detection (missing schema_version, empty command, empty output,
    forged-shape output patterns)
  - Staleness (evidence older than STALENESS_SECS)
  - Secret leakage in evidence output (unredacted sk-*, ghp_*, AKIA*)
  - Source immutability during run-check (redaction does not mutate source)
  - Filenames with spaces (NUL-safe git collection)
  - Dirty baseline (DIRTY:... tree_sha accepted vs clean mismatch rejected)
  - Workspace mismatch rejection
  - Exit code non-zero rejection
  - run_check.py smoke test in a temp git repo
  - guard.sh tri-state protected paths
  - guard.sh HARD-signal exit code 2
  - verify-gate.sh --platform parsing

All tests use deterministic temp-repo fixtures — no network, no real git push.
"""

from __future__ import annotations

import json
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

# Ensure host environment variables do not bleed into subprocesses and trigger Codex-specific output
for _env_var in ["CODEX_THREAD_ID", "CODEX_CI"]:
    os.environ.pop(_env_var, None)

# ── path to scripts ────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts" / "lite"
RUN_CHECK = SCRIPTS_DIR / "run_check.py"
VERIFY_PY = SCRIPTS_DIR / "verify_gate.py"
RULE_VALIDATOR = SCRIPTS_DIR / "rule-validator.py"
GUARD_SH = SCRIPTS_DIR / "guard.sh"
VERIFY_SH = SCRIPTS_DIR / "verify-gate.sh"
STOP_SH = SCRIPTS_DIR / "stop-gate.sh"
REVIEW_ATTEST = SCRIPTS_DIR / "review_attest.py"
sys.path.insert(0, str(SCRIPTS_DIR))
from evidence_common import (  # noqa: E402
    command_text,
    execution_manifest,
    sha256_text,
    worktree_fingerprint,
)


# ── helpers ───────────────────────────────────────────────────────────────────


_REVIEW_FIXTURES: dict[Path, dict[str, object]] = {}


def _generate_review_keypair(tmp: Path, prefix: str) -> dict[str, Path | list[Path]]:
    """Generate a disposable external Ed25519 keypair beside, not inside, tmp."""
    key_dir = Path(tempfile.mkdtemp(prefix=f"{tmp.name}_{prefix}_", dir=tmp.parent))
    private_key = key_dir / "reviewer"
    public_key = key_dir / "reviewer.pub"
    subprocess.run(
        [
            "ssh-keygen",
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            f"{prefix}@forgewright.test",
            "-f",
            str(private_key),
        ],
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )
    private_key.chmod(0o600)
    assert stat.S_IMODE(private_key.stat().st_mode) == 0o600
    return {"dir": key_dir, "private_key": private_key, "public_key": public_key}


def _make_review_fixture(tmp: Path) -> dict[str, object]:
    """Create an external trusted review identity and allowed_signers root."""
    keypair = _generate_review_keypair(tmp, "trusted-review")
    public_key = keypair["public_key"]
    assert isinstance(public_key, Path)
    public_fields = public_key.read_text(encoding="utf-8").split()
    allowed_signers = keypair["dir"] / "reviewers.allowed_signers"
    allowed_signers.write_text(
        f"human-42 {public_fields[0]} {public_fields[1]}\n", encoding="utf-8"
    )
    allowed_signers.chmod(0o644)
    assert stat.S_IMODE(allowed_signers.stat().st_mode) == 0o644
    fixture: dict[str, object] = {
        **keypair,
        "allowed_signers": allowed_signers,
        "key_dirs": [keypair["dir"]],
    }
    _REVIEW_FIXTURES[tmp.resolve()] = fixture
    return fixture


def _review_fixture(tmp: Path) -> dict[str, object]:
    fixture = _REVIEW_FIXTURES.get(tmp.resolve())
    return fixture if fixture is not None else _make_review_fixture(tmp)


def _cleanup_review_fixture(tmp: Path) -> None:
    fixture = _REVIEW_FIXTURES.pop(tmp.resolve(), None)
    if fixture is None:
        return
    key_dirs = fixture["key_dirs"]
    assert isinstance(key_dirs, list)
    for key_dir in key_dirs:
        assert isinstance(key_dir, Path)
        shutil.rmtree(key_dir, ignore_errors=True)


def _run_py(
    script: Path, args: list[str] = (), env: dict | None = None, cwd: Path | None = None
) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        [sys.executable, str(script)] + list(args),
        capture_output=True,
        text=True,
        timeout=30,
        env=full_env,
        cwd=str(cwd or REPO_ROOT),
    )


def _run_sh(
    script: Path,
    args: list[str] = (),
    env: dict | None = None,
    cwd: Path | None = None,
    stdin_text: str = "",
) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        ["bash", str(script)] + list(args),
        capture_output=True,
        text=True,
        timeout=30,
        env=full_env,
        cwd=str(cwd or REPO_ROOT),
        input=stdin_text,
    )


def _make_temp_git_repo() -> Path:
    """Create a deterministic temp git repo with one commit."""
    tmp = Path(tempfile.mkdtemp(prefix="fw_gate_test_"))
    subprocess.run(
        ["git", "init", "-b", "main"], cwd=tmp, capture_output=True, check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"], cwd=tmp, capture_output=True
    )
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp, capture_output=True)
    # Initial commit so HEAD exists
    (tmp / "README.md").write_text("# test\n")
    tests_dir = tmp / "tests"
    tests_dir.mkdir()
    (tests_dir / "evidence_contract_check.py").write_text(
        "import sys\nprint(sys.argv[1] if len(sys.argv) > 1 else 'ok')\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "."], cwd=tmp, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=tmp, capture_output=True)
    return tmp


def _make_evidence(
    tmp: Path,
    *,
    schema_version: str = "2",
    turn: str = "test_turn",
    command: list | None = None,
    exit_code: int = 0,
    output: str = "ok\n",
    timestamp_offset_secs: int = 0,  # negative = older than now
    workspace: str | None = None,
    tree_sha: str | None = None,
    output_truncated: bool = False,
    acceptance_criteria: list[dict[str, str]] | None = None,
    tier: str = "contract",
    test_refs: list[str] | None = None,
    negative_paths: list[str] | None = None,
    limitations: list[str] | None = None,
    change_kind: str = "test",
    phase: str = "verification",
    implementer_id: str = "codex-implementer",
    reviewer: dict[str, str] | None = None,
    risk: str | None = None,
    links: dict[str, str] | None = None,
) -> Path:
    """Write a v2 evidence file to tmp/.forgewright/verify/<turn>.json."""
    ts = datetime.now(timezone.utc) + timedelta(seconds=timestamp_offset_secs)
    ev_dir = tmp / ".forgewright" / "verify"
    ev_dir.mkdir(parents=True, exist_ok=True)

    actual_command = (
        command
        if command is not None
        else [
            sys.executable,
            "tests/evidence_contract_check.py",
        ]
    )
    actual_refs = test_refs or ["tests/evidence_contract_check.py"]
    raw_acceptance = acceptance_criteria or [
        {"id": "test-acceptance", "claim": "the check produces the expected output"}
    ]
    actual_acceptance = [dict(criterion) for criterion in raw_acceptance]
    for criterion in actual_acceptance:
        criterion.setdefault("test_refs", list(actual_refs))
    execution, _ = execution_manifest(tmp, actual_command, actual_refs)
    ev = {
        "schema_version": schema_version,
        "turn": turn,
        "acceptance_criteria": actual_acceptance,
        "command": actual_command,
        "execution": execution,
        "tier": tier,
        "test_refs": actual_refs,
        "negative_paths": negative_paths
        or ["the check fails when the behavior is absent"],
        "negative_path_bindings": [
            {
                "id": "negative-path-1",
                "claim": (
                    negative_paths or ["the check fails when the behavior is absent"]
                )[0],
                "acceptance_ids": [item["id"] for item in actual_acceptance],
                "test_refs": list(actual_refs),
            }
        ],
        "limitations": [] if limitations is None else limitations,
        "change_kind": change_kind,
        "phase": phase,
        "implementer_id": implementer_id,
        "reviewer": reviewer or {"status": "not_required"},
        "exit_code": exit_code,
        "output": output,
        "output_sha256": sha256_text(output),
        "output_truncated": output_truncated,
        "timestamp_utc": ts.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "workspace": workspace if workspace is not None else str(tmp.resolve()),
        "tree_sha": tree_sha if tree_sha is not None else worktree_fingerprint(tmp),
    }
    if risk is not None:
        ev["risk"] = risk
    if links:
        ev["links"] = links

    ev_file = ev_dir / f"{turn}.json"
    ev_file.write_text(json.dumps(ev, indent=2))
    return ev_file


def _run_validate(
    tmp: Path,
    files_str: str = "",
    turn: str = "test_turn",
    response: str = "VERIFY: tested",
    review_allowed_signers: Path | None = None,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    """Run verify_gate.py in a temp dir context."""
    env = {
        "RESPONSE_CONTENT": response,
        "FILES_TO_CHECK_STR": files_str,
        "FILES_TO_CHECK_NUL": "1",
        "FORGEWRIGHT_TURN": turn,
        "FORGEWRIGHT_STALENESS_SECS": "3600",
    }
    fixture = _REVIEW_FIXTURES.get(tmp.resolve())
    if review_allowed_signers is not None:
        env["FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS"] = str(review_allowed_signers)
    elif fixture is not None:
        allowed_signers = fixture["allowed_signers"]
        assert isinstance(allowed_signers, Path)
        env["FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS"] = str(allowed_signers)
    if extra_env:
        env.update(extra_env)
    return _run_py(VERIFY_PY, cwd=tmp, env=env)


def _add_hard_support(
    tmp: Path,
    final_path: Path,
    *,
    criteria: list[dict[str, str]],
    command: list[str],
    test_refs: list[str],
    reviewer_id: str = "human-42",
) -> None:
    final = json.loads(final_path.read_text(encoding="utf-8"))
    links = final.setdefault("links", {})
    red_path = tmp / ".forgewright" / "verify" / links["red"]
    mutation_path = tmp / ".forgewright" / "verify" / links["mutation"]
    pre_mutation_path = _make_evidence(
        tmp,
        turn=f"{final['turn']}-pre-mutation",
        acceptance_criteria=criteria,
        command=command,
        output=f"{test_refs[0]} pre-mutation green passed\n",
        test_refs=test_refs,
        tier=final["tier"],
        change_kind="fix",
        phase="green",
    )
    links["pre_mutation"] = pre_mutation_path.name

    red_payload = json.loads(red_path.read_text(encoding="utf-8"))
    pre_mutation = json.loads(pre_mutation_path.read_text(encoding="utf-8"))
    mutation = json.loads(mutation_path.read_text(encoding="utf-8"))
    timeline = datetime.now(timezone.utc)
    red_payload["timestamp_utc"] = (
        (timeline - timedelta(seconds=3))
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    pre_mutation["timestamp_utc"] = (
        (timeline - timedelta(seconds=2))
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    mutation["timestamp_utc"] = (
        (timeline - timedelta(seconds=1))
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    final["timestamp_utc"] = timeline.isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )
    mutation.setdefault("links", {})["pre_mutation"] = pre_mutation_path.name
    mutation["mutation"] = {
        "target_paths": ["purchase.py"],
        "pre_mutation_tree_sha": pre_mutation["tree_sha"],
    }
    red_path.write_text(json.dumps(red_payload), encoding="utf-8")
    pre_mutation_path.write_text(json.dumps(pre_mutation), encoding="utf-8")
    mutation_path.write_text(json.dumps(mutation), encoding="utf-8")

    for tier in ("contract", "e2e"):
        linked = _make_evidence(
            tmp,
            turn=f"{final['turn']}-{tier}",
            acceptance_criteria=criteria,
            command=command,
            output=f"{test_refs[0]} {tier} passed\n",
            test_refs=test_refs,
            tier=tier,
            change_kind="test",
            phase="verification",
        )
        links[tier] = linked.name
    review_path = tmp / ".forgewright" / "verify" / f"{final['turn']}-review.json"
    review_path.write_text(
        json.dumps(
            {
                "schema_version": "review-1",
                "reviewer_id": reviewer_id,
                "implementer_id": final["implementer_id"],
                "status": "independent-approved",
                "acceptance_ids": sorted(item["id"] for item in criteria),
                "workspace": str(tmp.resolve()),
                "tree_sha": final["tree_sha"],
                "timestamp_utc": datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                ),
                "findings": [],
                "limitations": [],
            }
        ),
        encoding="utf-8",
    )
    final["reviewer"]["status"] = "independent-approved"
    final["reviewer"]["evidence_ref"] = review_path.name
    final_path.write_text(json.dumps(final), encoding="utf-8")

    # Prove that the legacy unsigned review-1 shape cannot satisfy HARD before
    # replacing it with the signed review-2 record.
    unsigned = _run_validate(
        tmp,
        files_str="purchase.py",
        turn=final["turn"],
        response=_strict_response(final_path),
    )
    assert unsigned.returncode == 1
    assert "review-2" in unsigned.stderr

    fixture = _review_fixture(tmp)
    private_key = fixture["private_key"]
    allowed_signers = fixture["allowed_signers"]
    assert isinstance(private_key, Path)
    assert isinstance(allowed_signers, Path)
    signed = _run_py(
        REVIEW_ATTEST,
        ["sign", "--evidence", str(final_path), "--private-key", str(private_key)],
        cwd=tmp,
        env={"FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS": str(allowed_signers)},
    )
    assert signed.returncode == 0, signed.stderr


def _run_check(
    tmp: Path,
    command: list[str],
    *,
    turn: str = "run-check-test",
    acceptance_id: str = "run-check",
    claim: str = "the check output is recorded",
    test_ref: str = "check-ref",
    phase: str = "verification",
    change_kind: str = "test",
    extra: list[str] | None = None,
) -> subprocess.CompletedProcess:
    args = [
        sys.executable,
        str(RUN_CHECK),
        "--turn",
        turn,
        "--acceptance",
        f"{acceptance_id}={claim}",
        "--tier",
        "contract",
        "--test-ref",
        test_ref,
        "--negative-path",
        "fails when the expected behavior is absent",
        "--limitations",
        "",
        "--change-kind",
        change_kind,
        "--phase",
        phase,
        "--implementer-id",
        "codex-implementer",
        "--reviewer-status",
        "not_required",
    ]
    if extra:
        args.extend(extra)
    args.extend(["--", *command])
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=15,
        cwd=str(tmp),
    )


def _strict_response(evidence_path: Path) -> str:
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    blocks = []
    for criterion in evidence["acceptance_criteria"]:
        blocks.append(
            "\n".join(
                [
                    "VERIFY:",
                    f"ACCEPTANCE: {criterion['id']}",
                    f"CLAIM: {criterion['claim']}",
                    f"COMMAND: {command_text(evidence['command'])}",
                    f"OUTPUT: sha256:{evidence['output_sha256']}",
                    f"EXIT CODE: {evidence['exit_code']}",
                    "VERDICT: PASS",
                ]
            )
        )
    return "\n\n".join(blocks)


def _run_rule_validator(
    tmp: Path, response: str, turn: str
) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(RULE_VALIDATOR), "--runtime"],
        input=response,
        capture_output=True,
        text=True,
        timeout=15,
        cwd=str(tmp),
        env={
            **os.environ,
            "FORGEWRIGHT_WORKSPACE": str(tmp),
            "FORGEWRIGHT_TURN": turn,
            "FORGEWRIGHT_RULE_LEDGER": str(tmp.parent / f"ledger-{turn}.jsonl"),
        },
    )


def _signed_hard_review(tmp: Path, turn: str = "signed-review") -> tuple[Path, str]:
    """Build one valid signed HARD evidence chain for signed-review regressions."""
    source = tmp / "purchase.py"
    source.write_text("purchase = 'red'\n", encoding="utf-8")
    criteria = [{"id": "signed-review", "claim": "purchase handling is verified"}]
    command = [sys.executable, "tests/evidence_contract_check.py", "signed-review"]
    refs = ["tests/evidence_contract_check.py"]
    red = _make_evidence(
        tmp,
        turn=f"{turn}-red",
        acceptance_criteria=criteria,
        command=command,
        output="signed-review red\n",
        test_refs=refs,
        tier="runtime",
        change_kind="fix",
        phase="red",
        exit_code=1,
    )
    source.write_text("purchase = 'mutation'\n", encoding="utf-8")
    mutation = _make_evidence(
        tmp,
        turn=f"{turn}-mutation",
        acceptance_criteria=criteria,
        command=command,
        output="signed-review mutation\n",
        test_refs=refs,
        tier="runtime",
        change_kind="fix",
        phase="mutation",
        exit_code=1,
        links={"red": red.name},
    )
    source.write_text("purchase = 'green'\n", encoding="utf-8")
    final = _make_evidence(
        tmp,
        turn=turn,
        acceptance_criteria=criteria,
        command=command,
        output="signed-review green\n",
        test_refs=refs,
        tier="runtime",
        change_kind="fix",
        phase="green",
        risk="hard",
        reviewer={
            "id": "human-42",
            "status": "approved",
            "evidence_ref": "review.json",
        },
        links={"red": red.name, "mutation": mutation.name},
    )
    _add_hard_support(tmp, final, criteria=criteria, command=command, test_refs=refs)
    response = _strict_response(final)
    passed = _run_validate(tmp, files_str="purchase.py", turn=turn, response=response)
    assert passed.returncode == 0, passed.stderr
    return final, response


# ══════════════════════════════════════════════════════════════════════════════
# A. Evidence validation: verify_gate.py
# ══════════════════════════════════════════════════════════════════════════════


class TestEvidenceValidation:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ── A1. Happy path ─────────────────────────────────────────────────────────
    def test_valid_evidence_passes(self):
        _make_evidence(self.tmp)
        r = _run_validate(self.tmp)
        assert r.returncode == 0, r.stderr

    def test_no_turn_ignores_newer_review_and_historical_records(self):
        final = _make_evidence(self.tmp, turn="selected-final")
        red = _make_evidence(self.tmp, turn="newer-red", phase="red", exit_code=1)
        review = self.tmp / ".forgewright" / "verify" / "newest-review.json"
        review.write_text(
            json.dumps(
                {"schema_version": "review-2", "status": "independent-approved"}
            ),
            encoding="utf-8",
        )
        malformed = self.tmp / ".forgewright" / "verify" / "malformed-final.json"
        malformed.write_text(
            json.dumps({"schema_version": "2", "phase": "green", "exit_code": 0}),
            encoding="utf-8",
        )
        stale = _make_evidence(
            self.tmp,
            turn="newer-stale-final",
            timestamp_offset_secs=-7200,
        )
        wrong_workspace = _make_evidence(
            self.tmp,
            turn="newer-wrong-workspace",
            workspace=str(self.tmp.parent),
        )
        wrong_tree = _make_evidence(
            self.tmp,
            turn="newer-wrong-tree",
            tree_sha="TREE:" + ("0" * 64),
        )
        os.utime(final, (1, 1))
        os.utime(red, (2, 2))
        os.utime(review, (3, 3))
        os.utime(malformed, (4, 4))
        os.utime(stale, (5, 5))
        os.utime(wrong_workspace, (6, 6))
        os.utime(wrong_tree, (7, 7))

        gate = _run_validate(self.tmp, turn="", response=_strict_response(final))
        validator = _run_rule_validator(self.tmp, _strict_response(final), "")

        assert gate.returncode == 0, gate.stderr
        assert validator.returncode == 0, validator.stderr

    def test_final_replay_rejects_hand_authored_pass_in_both_validators(self):
        failing_check = self.tmp / "tests" / "failing_check.py"
        failing_check.write_text("raise SystemExit(1)\n", encoding="utf-8")
        evidence = _make_evidence(
            self.tmp,
            turn="replay-forged-pass",
            command=[sys.executable, "tests/failing_check.py"],
            output="hand-authored pass\n",
            exit_code=0,
        )

        gate = _run_validate(self.tmp, turn="replay-forged-pass")
        assert gate.returncode == 1
        assert "REPLAY" in gate.stderr

        validator = _run_rule_validator(
            self.tmp,
            _strict_response(evidence),
            "replay-forged-pass",
        )
        assert validator.returncode == 1
        assert "REPLAY" in validator.stderr

    def test_final_replay_accepts_valid_command(self):
        evidence = _make_evidence(self.tmp, turn="replay-valid")

        gate = _run_validate(self.tmp, turn="replay-valid")
        assert gate.returncode == 0, gate.stderr
        validator = _run_rule_validator(
            self.tmp,
            _strict_response(evidence),
            "replay-valid",
        )
        assert validator.returncode == 0, validator.stderr

    def test_final_replay_rejects_project_owned_check_mutating_worktree(self):
        mutating_check = self.tmp / "tests" / "mutating_check.py"
        mutating_check.write_text(
            "from pathlib import Path\n"
            "Path('README.md').write_text('# mutated by replay\\n', encoding='utf-8')\n"
            "print('ok')\n",
            encoding="utf-8",
        )
        evidence = _make_evidence(
            self.tmp,
            turn="replay-mutating-worktree",
            command=[sys.executable, "tests/mutating_check.py"],
        )

        result = _run_validate(self.tmp, turn="replay-mutating-worktree")

        assert result.returncode == 1
        assert "REPLAY" in result.stderr
        assert "mutated final worktree" in result.stderr
        assert evidence.is_file()

    def test_final_replay_fails_closed_for_timeout_and_missing_command(self):
        timeout_check = self.tmp / "tests" / "timeout_check.py"
        timeout_check.write_text("import time\ntime.sleep(0.2)\n", encoding="utf-8")
        timeout_evidence = _make_evidence(
            self.tmp,
            turn="replay-timeout",
            command=[sys.executable, "tests/timeout_check.py"],
            output="completed\n",
        )
        timed_out = _run_validate(
            self.tmp,
            turn="replay-timeout",
            extra_env={"FORGEWRIGHT_REPLAY_TIMEOUT_SECS": "0.01"},
        )
        assert timed_out.returncode == 1
        assert "REPLAY" in timed_out.stderr
        assert "timed out" in timed_out.stderr

        missing_evidence = _make_evidence(
            self.tmp,
            turn="replay-missing-command",
            command=[sys.executable, "tests/does-not-exist.py"],
            output="completed\n",
        )
        missing = _run_validate(self.tmp, turn="replay-missing-command")
        assert missing.returncode == 1
        assert "REPLAY" in missing.stderr
        assert "does not match stored exit_code" in missing.stderr
        assert timeout_evidence.is_file() and missing_evidence.is_file()

    # ── A2. Missing evidence file ──────────────────────────────────────────────
    def test_missing_evidence_blocked(self):
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "MISSING" in r.stderr

    # ── A3. Forgery: wrong schema_version ─────────────────────────────────────
    def test_wrong_schema_version_blocked(self):
        _make_evidence(self.tmp, schema_version="1")
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FORGED" in r.stderr

    # ── A4. Forgery: empty command list ───────────────────────────────────────
    def test_empty_command_blocked(self):
        _make_evidence(self.tmp, command=[])
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FORGED" in r.stderr

    # ── A5. Forgery: empty output ─────────────────────────────────────────────
    def test_empty_output_blocked(self):
        _make_evidence(self.tmp, output="")
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FORGED" in r.stderr

    # ── A6. Forgery: placeholder output patterns ──────────────────────────────
    @pytest.mark.parametrize(
        "output",
        [
            "[REDACTED]",
            "placeholder",
            "N/A",
            "TO" + "DO",
        ],
    )
    def test_forged_shape_output_blocked(self, output):
        _make_evidence(self.tmp, output=output)
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FORGED" in r.stderr

    # ── A7. Staleness ─────────────────────────────────────────────────────────
    def test_stale_evidence_blocked(self):
        _make_evidence(self.tmp, timestamp_offset_secs=-(3601))  # 1 hour + 1 sec ago
        r = _run_validate(self.tmp, turn="test_turn")
        assert r.returncode == 1
        assert "STALE" in r.stderr

    # ── A8. Future timestamp (forged) ─────────────────────────────────────────
    def test_future_timestamp_blocked(self):
        _make_evidence(self.tmp, timestamp_offset_secs=+7200)  # 2 hours in the future
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FORGED" in r.stderr

    # ── A9. Workspace mismatch ────────────────────────────────────────────────
    def test_workspace_mismatch_blocked(self):
        _make_evidence(self.tmp, workspace="/nonexistent/other/workspace")
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "MISMATCH" in r.stderr

    # ── A10. Failed exit code ─────────────────────────────────────────────────
    def test_failed_exit_code_blocked(self):
        _make_evidence(self.tmp, exit_code=1)
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FAILED" in r.stderr

    # ── A11. Non-zero exit code (nonzero, not 1) ─────────────────────────────
    def test_nonzero_exit_code_127_blocked(self):
        _make_evidence(self.tmp, exit_code=127)
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "FAILED" in r.stderr

    # ── A12. Secrets in evidence output ──────────────────────────────────────
    @pytest.mark.parametrize(
        "secret",
        [
            "sk-abc123xyz456def789ghi012jkl",  # OpenAI key (30 chars)
            "ghp_abc123xyz456def789ghi012jkl3",  # GitHub PAT (31 chars)
            "AKIAIOSFODNN7EXAMPLE",  # AWS key (20 chars)
        ],
    )
    def test_secrets_in_evidence_output_blocked(self, secret):
        _make_evidence(self.tmp, output=f"token={secret}\n")
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "SECRETS" in r.stderr

    # ── A13. Same-HEAD dirty fallback is no longer accepted ───────────────────
    def test_dirty_tree_sha_accepted_same_head(self):
        """A same-HEAD but different dirty worktree must be rejected."""
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.tmp, capture_output=True, text=True
        ).stdout.strip()
        tree_sha = f"DIRTY:{head[:12]}:someidxhash"
        # Make the repo actually dirty so current tree_sha has DIRTY prefix
        (self.tmp / "dirty_file.txt").write_text("dirty\n")
        _make_evidence(self.tmp, tree_sha=tree_sha)
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "MISMATCH" in r.stderr

    # ── A14. Clean-tree mismatch (stale HEAD) ────────────────────────────────
    def test_stale_tree_sha_blocked(self):
        """Evidence with old HEAD SHA rejected after new commit."""
        old_head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.tmp, capture_output=True, text=True
        ).stdout.strip()
        # Make a new commit
        (self.tmp / "newfile.txt").write_text("new\n")
        subprocess.run(["git", "add", "."], cwd=self.tmp, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "second"], cwd=self.tmp, capture_output=True
        )
        # Evidence has old head
        _make_evidence(self.tmp, tree_sha=old_head)
        r = _run_validate(self.tmp)
        assert r.returncode == 1
        assert "MISMATCH" in r.stderr


# ══════════════════════════════════════════════════════════════════════════════
# B. Source immutability: run_check.py redaction
# ══════════════════════════════════════════════════════════════════════════════


class TestSourceImmutability:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @pytest.mark.parametrize("command", [["echo", "ok"], ["printf", "ok"], ["true"]])
    def test_trivial_commands_are_rejected_before_execution(self, command):
        result = subprocess.run(
            [sys.executable, str(RUN_CHECK), "--", *command],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(self.tmp),
        )
        assert result.returncode == 2
        assert "Command was not started" in result.stderr
        assert not (self.tmp / ".forgewright" / "verify").exists()

    def test_v2_metadata_is_required_before_execution(self):
        result = subprocess.run(
            [sys.executable, str(RUN_CHECK), "--", "python3", "-c", "print('ok')"],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(self.tmp),
        )
        assert result.returncode == 2
        assert "MISSING" in result.stderr
        assert "Command was not started" in result.stderr

    def test_test_ref_must_be_concrete_in_command_not_only_output(self):
        generic = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "invented-ref"],
            test_ref="invented-ref",
        )
        assert generic.returncode == 2
        assert "concrete project-owned check" in generic.stderr

        output_script = self.tmp / "tests" / "output_only_check.py"
        output_script.write_text("print('output-only-ref')\n", encoding="utf-8")
        output_only = _run_check(
            self.tmp,
            [sys.executable, "tests/output_only_check.py"],
            test_ref="tests/not-invoked-check.py",
        )
        assert output_only.returncode == 2
        assert "not present in the exact command" in output_only.stderr

    def test_multiple_acceptances_require_explicit_test_mapping(self):
        command = [sys.executable, "tests/evidence_contract_check.py", "mapped"]
        common = [
            sys.executable,
            str(RUN_CHECK),
            "--turn",
            "multi-acceptance",
            "--acceptance",
            "first-claim=first behavior is verified",
            "--acceptance",
            "second-claim=second behavior is verified",
            "--tier",
            "contract",
            "--test-ref",
            "tests/evidence_contract_check.py",
            "--negative-path",
            "the verifier rejects the missing behavior",
            "--limitations",
            "",
            "--change-kind",
            "test",
            "--phase",
            "verification",
            "--implementer-id",
            "codex-implementer",
            "--reviewer-status",
            "not_required",
        ]
        missing_map = subprocess.run(
            [*common, "--", *command],
            cwd=self.tmp,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert missing_map.returncode == 2
        assert "acceptance_criteria[0].test_refs" in missing_map.stderr

        mapped = subprocess.run(
            [
                *common,
                "--acceptance-test",
                "first-claim=tests/evidence_contract_check.py",
                "--acceptance-test",
                "second-claim=tests/evidence_contract_check.py",
                "--negative-path-binding",
                "negative-path-1=the verifier rejects the missing behavior|first-claim,second-claim|tests/evidence_contract_check.py",
                "--",
                *command,
            ],
            cwd=self.tmp,
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert mapped.returncode == 0, mapped.stderr
        evidence = json.loads(
            next((self.tmp / ".forgewright" / "verify").glob("*.json")).read_text()
        )
        assert evidence["negative_path_bindings"] == [
            {
                "id": "negative-path-1",
                "claim": "the verifier rejects the missing behavior",
                "acceptance_ids": ["first-claim", "second-claim"],
                "test_refs": ["tests/evidence_contract_check.py"],
            }
        ]

    def test_run_check_does_not_mutate_source(self):
        """run_check.py must NOT modify the script being executed, even when it echoes a secret."""
        # Create a script that outputs a secret token
        script = self.tmp / "print_secret.sh"
        # This script contains a secret in its source AND outputs it
        secret_in_source = "echo sk-originaloriginaloriginal12345"
        script.write_text(f"#!/bin/sh\n{secret_in_source}\n")
        original_content = script.read_text()

        r = _run_check(self.tmp, ["bash", str(script)], test_ref=str(script))
        assert r.returncode == 0, r.stderr

        # Source file must be EXACTLY unchanged
        after_content = script.read_text()
        assert after_content == original_content, (
            "run_check.py mutated the source file during redaction!\n"
            f"Before: {original_content!r}\n"
            f"After:  {after_content!r}"
        )

        # Evidence output should have the secret REDACTED
        ev_dir = self.tmp / ".forgewright" / "verify"
        ev_files = list(ev_dir.glob("*.json"))
        assert len(ev_files) == 1
        ev = json.loads(ev_files[0].read_text())
        assert "sk-[REDACTED]" in ev["output"], "Secret not redacted in evidence output"
        assert "sk-originaloriginaloriginal12345" not in ev["output"], (
            "Unredacted secret found in evidence output"
        )

    def test_run_check_handles_filename_with_spaces(self):
        """run_check.py must handle commands with filenames containing spaces."""
        script = self.tmp / "my script with spaces.sh"
        script.write_text("#!/bin/sh\necho 'hello from spaced script'\n")

        r = _run_check(self.tmp, ["bash", str(script)], test_ref=str(script))
        assert r.returncode == 0, r.stderr

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev_files = list(ev_dir.glob("*.json"))
        assert len(ev_files) == 1
        ev = json.loads(ev_files[0].read_text())
        assert ev["exit_code"] == 0
        assert "hello from spaced script" in ev["output"]
        # Command array must preserve filename with spaces as a single element
        assert any("my script with spaces.sh" in c for c in ev["command"])

    def test_run_check_evidence_fields(self):
        """All required schema_version-2 fields must be present and typed correctly."""
        r = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "test-ref"],
            test_ref="tests/evidence_contract_check.py",
        )
        assert r.returncode == 0, r.stderr

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev_files = list(ev_dir.glob("*.json"))
        assert len(ev_files) == 1
        ev = json.loads(ev_files[0].read_text())

        assert ev["schema_version"] == "2"
        assert ev["acceptance_criteria"]
        assert ev["negative_path_bindings"] == [
            {
                "id": "negative-path-1",
                "claim": "fails when the expected behavior is absent",
                "acceptance_ids": ["run-check"],
                "test_refs": ["tests/evidence_contract_check.py"],
            }
        ]
        assert ev["tier"] in {
            "unit",
            "contract",
            "integration",
            "runtime",
            "e2e",
            "security",
        }
        assert ev["test_refs"]
        assert ev["negative_paths"]
        assert "limitations" in ev
        assert ev["change_kind"]
        assert ev["phase"] in {"verification", "red", "green", "mutation"}
        assert ev["reviewer"]["status"]
        assert isinstance(ev["turn"], str) and ev["turn"]
        assert isinstance(ev["command"], list) and ev["command"]
        assert isinstance(ev["exit_code"], int)
        assert isinstance(ev["output"], str)
        assert re.fullmatch(r"[0-9a-f]{64}", ev["output_sha256"])
        assert isinstance(ev["output_truncated"], bool)
        assert isinstance(ev["timestamp_utc"], str)
        assert isinstance(ev["workspace"], str) and ev["workspace"]
        assert isinstance(ev["tree_sha"], str) and ev["tree_sha"]

    def test_run_check_failed_command_exit_code(self):
        """run_check.py records non-zero exit_code but itself exits 0."""
        failing = self.tmp / "tests" / "failing_contract_check.sh"
        failing.write_text(
            "#!/bin/sh\nprintf 'negative-ref'\nexit 42\n", encoding="utf-8"
        )
        r = _run_check(
            self.tmp,
            ["bash", "tests/failing_contract_check.sh"],
            test_ref="tests/failing_contract_check.sh",
            phase="red",
        )
        assert r.returncode == 0, (
            f"run_check.py should always exit 0, got {r.returncode}"
        )

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev_files = list(ev_dir.glob("*.json"))
        assert len(ev_files) == 1
        ev = json.loads(ev_files[0].read_text())
        assert ev["exit_code"] == 42


# ══════════════════════════════════════════════════════════════════════════════
# C. Dirty baseline (git state tracking)
# ══════════════════════════════════════════════════════════════════════════════


class TestDirtyBaseline:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_dirty_repo_tree_sha_is_exact_fingerprint(self):
        """Dirty state is represented by an exact fingerprint, not DIRTY fallback."""
        (self.tmp / "modified.txt").write_text("changed\n")

        r = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "dirty-test"],
            test_ref="tests/evidence_contract_check.py",
        )
        assert r.returncode == 0

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev = json.loads(list(ev_dir.glob("*.json"))[0].read_text())
        assert re.fullmatch(r"TREE:[0-9a-f]{64}", ev["tree_sha"])

    def test_clean_repo_tree_sha_is_commit_hash(self):
        """In a clean repo, tree_sha is an exact v2 fingerprint."""
        r = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "clean-test"],
            test_ref="tests/evidence_contract_check.py",
        )
        assert r.returncode == 0

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev = json.loads(list(ev_dir.glob("*.json"))[0].read_text())
        assert re.fullmatch(r"TREE:[0-9a-f]{64}", ev["tree_sha"])

    def test_untracked_file_is_in_exact_fingerprint(self):
        """An untracked nonignored file contributes content to the fingerprint."""
        (self.tmp / "untracked.txt").write_text("untracked\n")
        # Don't git add it

        r = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "untracked"],
            test_ref="tests/evidence_contract_check.py",
        )
        assert r.returncode == 0

        ev_dir = self.tmp / ".forgewright" / "verify"
        ev = json.loads(list(ev_dir.glob("*.json"))[0].read_text())
        assert re.fullmatch(r"TREE:[0-9a-f]{64}", ev["tree_sha"])

    def test_unstaged_source_change_after_evidence_mismatches_same_head_and_index(self):
        """Changing source after capture is rejected even when HEAD/index stay fixed."""
        source = self.tmp / "source.py"
        source.write_text("VALUE = 1\n")
        evidence = _run_check(
            self.tmp,
            [sys.executable, "tests/evidence_contract_check.py", "source-ref"],
            test_ref="tests/evidence_contract_check.py",
            turn="unstaged-source",
        )
        assert evidence.returncode == 0, evidence.stderr
        head_before = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.tmp,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        source.write_text("VALUE = 2\n")
        head_after = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.tmp,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert head_after == head_before
        result = _run_validate(self.tmp, turn="unstaged-source")
        assert result.returncode == 1
        assert "exact worktree fingerprint" in result.stderr

    def test_dirty_submodule_content_changes_parent_fingerprint(self):
        submodule_source = Path(tempfile.mkdtemp(prefix="fw_gate_submodule_"))
        try:
            subprocess.run(
                ["git", "init", "-b", "main"],
                cwd=submodule_source,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=submodule_source,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=submodule_source,
                capture_output=True,
                check=True,
            )
            (submodule_source / "runtime.py").write_text(
                "VALUE = 1\n", encoding="utf-8"
            )
            subprocess.run(
                ["git", "add", "runtime.py"],
                cwd=submodule_source,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=submodule_source,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                [
                    "git",
                    "-c",
                    "protocol.file.allow=always",
                    "submodule",
                    "add",
                    str(submodule_source),
                    "vendor/runtime",
                ],
                cwd=self.tmp,
                capture_output=True,
                text=True,
                check=True,
            )
            subprocess.run(
                ["git", "add", ".gitmodules", "vendor/runtime"],
                cwd=self.tmp,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "commit", "-m", "add submodule"],
                cwd=self.tmp,
                capture_output=True,
                check=True,
            )

            head_before = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.tmp,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            before = worktree_fingerprint(self.tmp)
            nested_source = self.tmp / "vendor" / "runtime" / "runtime.py"
            nested_source.write_text("VALUE = 2\n", encoding="utf-8")
            after = worktree_fingerprint(self.tmp)

            assert before != after
            head_after = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.tmp,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            assert head_after == head_before
        finally:
            shutil.rmtree(submodule_source, ignore_errors=True)

    def test_untracked_embedded_repository_content_is_fingerprinted(self):
        embedded = self.tmp / "scratch-repo"
        embedded.mkdir()
        subprocess.run(
            ["git", "init", "-q"],
            cwd=embedded,
            capture_output=True,
            check=True,
        )
        source = embedded / "draft.py"
        source.write_text("VALUE = 1\n", encoding="utf-8")
        before = worktree_fingerprint(self.tmp)
        source.write_text("VALUE = 2\n", encoding="utf-8")
        after = worktree_fingerprint(self.tmp)

        assert before != after

    def test_ignored_untracked_content_is_fingerprinted(self):
        (self.tmp / ".gitignore").write_text("ignored.cfg\n", encoding="utf-8")
        ignored = self.tmp / "ignored.cfg"
        ignored.write_text("VALUE=1\n", encoding="utf-8")
        before = worktree_fingerprint(self.tmp)
        ignored.write_text("VALUE=2\n", encoding="utf-8")
        after = worktree_fingerprint(self.tmp)

        assert before != after

    def test_runtime_owned_state_is_excluded_but_project_config_remains_covered(self):
        (self.tmp / ".gitignore").write_text(".forgewright/\n", encoding="utf-8")
        volatile_paths = [
            ".forgewright/memory.db",
            ".forgewright/memory.db-wal",
            ".forgewright/memory-bank/graph_memory.json",
            ".forgewright/subagent-context/CONVERSATION_SUMMARY.md",
            ".forgewright/rule-ledger.jsonl",
            ".forgewright/session-tracker-v2.json",
            ".forgewright/telemetry/events.jsonl",
            ".forgewright/cache/runtime.json",
            ".forgewright/verify/current.json",
        ]
        for relative in volatile_paths:
            path = self.tmp / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("version=1\n", encoding="utf-8")
        project_config = self.tmp / ".forgewright" / "settings.env"
        project_config.write_text("MODE=safe\n", encoding="utf-8")

        before = worktree_fingerprint(self.tmp)
        for relative in volatile_paths:
            (self.tmp / relative).write_text("version=2\n", encoding="utf-8")
        after_runtime_updates = worktree_fingerprint(self.tmp)
        project_config.write_text("MODE=changed\n", encoding="utf-8")
        after_project_config = worktree_fingerprint(self.tmp)

        assert after_runtime_updates == before
        assert after_project_config != after_runtime_updates


class TestEvidenceV2BypassRegressions:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()
        _make_review_fixture(self.tmp)

    def teardown_method(self):
        _cleanup_review_fixture(self.tmp)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_echo_v1_and_missing_acceptance_mapping_rejected(self):
        result = subprocess.run(
            [sys.executable, str(RUN_CHECK), "--", "echo", "ok"],
            capture_output=True,
            text=True,
            cwd=str(self.tmp),
        )
        assert result.returncode == 2
        assert "MISSING" in result.stderr
        assert "Command was not started" in result.stderr

        _make_evidence(self.tmp, schema_version="1", turn="v1-turn")
        v1 = _run_validate(self.tmp, turn="v1-turn")
        assert v1.returncode == 1
        assert "v1 is rejected" in v1.stderr

        missing = _make_evidence(self.tmp, turn="missing-turn")
        payload = json.loads(missing.read_text(encoding="utf-8"))
        payload.pop("acceptance_criteria")
        missing.write_text(json.dumps(payload), encoding="utf-8")
        rejected = _run_validate(self.tmp, turn="missing-turn")
        assert rejected.returncode == 1
        assert "acceptance_criteria" in rejected.stderr

    def test_string_mention_does_not_attest_that_a_test_was_invoked(self):
        fake_test = self.tmp / "tests" / "fake_claim.py"
        fake_test.write_text("def test_claim():\n    assert True\n", encoding="utf-8")
        fixture = self.tmp / "fixture.txt"
        fixture.write_text("tests/fake_claim.py\n", encoding="utf-8")

        result = _run_check(
            self.tmp,
            ["grep", "-F", "tests/fake_claim.py", "fixture.txt"],
            test_ref="tests/fake_claim.py",
        )

        assert result.returncode == 2
        assert "not a supported project check/test invocation" in result.stderr

    def test_unrelated_claim_command_and_digest_rejected(self):
        path = _make_evidence(self.tmp, turn="correlation-turn")
        evidence = json.loads(path.read_text(encoding="utf-8"))
        valid = _strict_response(path)
        command = command_text(evidence["command"])
        cases = [
            valid.replace(
                evidence["acceptance_criteria"][0]["claim"], "unrelated claim"
            ),
            valid.replace(command, "python3 -c 'print(\"unrelated\")'"),
            valid.replace(evidence["output_sha256"], "0" * 64),
        ]
        for response in cases:
            result = _run_rule_validator(self.tmp, response, "correlation-turn")
            assert result.returncode != 0
            assert "MISMATCH" in result.stderr

    def test_red_green_rejects_swapped_acceptance_test_mapping(self):
        refs = ["tests/a.py::test_a", "tests/b.py::test_b"]
        for path in (self.tmp / "tests" / "a.py", self.tmp / "tests" / "b.py"):
            path.write_text(
                "def test_placeholder():\n    assert True\n", encoding="utf-8"
            )
        command = ["pytest", *refs]
        red_criteria = [
            {"id": "one", "claim": "first behavior", "test_refs": [refs[0]]},
            {"id": "two", "claim": "second behavior", "test_refs": [refs[1]]},
        ]
        green_criteria = [
            {"id": "one", "claim": "first behavior", "test_refs": [refs[1]]},
            {"id": "two", "claim": "second behavior", "test_refs": [refs[0]]},
        ]
        source = self.tmp / "feature.py"
        source.write_text("VALUE = 'red'\n", encoding="utf-8")
        red = _make_evidence(
            self.tmp,
            turn="mapping-red",
            acceptance_criteria=red_criteria,
            command=command,
            test_refs=refs,
            exit_code=1,
            output="2 failed\n",
            change_kind="fix",
            phase="red",
            timestamp_offset_secs=-1,
        )
        source.write_text("VALUE = 'green'\n", encoding="utf-8")
        _make_evidence(
            self.tmp,
            turn="mapping-green",
            acceptance_criteria=green_criteria,
            command=command,
            test_refs=refs,
            output="2 passed\n",
            change_kind="fix",
            phase="green",
            links={"red": red.name},
        )

        result = _run_validate(self.tmp, turn="mapping-green")

        assert result.returncode == 1
        assert "acceptance-to-test mapping" in result.stderr

    def test_negative_binding_missing_is_blocked(self):
        path = _make_evidence(self.tmp, turn="negative-missing")
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload.pop("negative_path_bindings")
        path.write_text(json.dumps(payload), encoding="utf-8")
        result = _run_validate(self.tmp, turn="negative-missing")
        assert result.returncode == 1
        assert "negative_path_bindings" in result.stderr

    def test_negative_binding_wrong_acceptance_is_blocked(self):
        path = _make_evidence(self.tmp, turn="negative-acceptance")
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["negative_path_bindings"][0]["acceptance_ids"] = ["other-acceptance"]
        path.write_text(json.dumps(payload), encoding="utf-8")
        result = _run_validate(self.tmp, turn="negative-acceptance")
        assert result.returncode == 1
        assert "unknown IDs" in result.stderr

    def test_negative_binding_uninvoked_ref_is_blocked(self):
        path = _make_evidence(self.tmp, turn="negative-uninvoked")
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["negative_path_bindings"][0]["test_refs"] = ["not-invoked.py"]
        payload["test_refs"] = ["not-invoked.py"]
        payload["execution"]["entrypoints"] = []
        path.write_text(json.dumps(payload), encoding="utf-8")
        result = _run_validate(self.tmp, turn="negative-uninvoked")
        assert result.returncode == 1
        assert (
            "not-invoked" in result.stderr or "not declared globally" in result.stderr
        )

    def test_negative_binding_claim_mismatch_is_blocked(self):
        path = _make_evidence(self.tmp, turn="negative-claim")
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["negative_path_bindings"][0]["claim"] = "different negative behavior"
        path.write_text(json.dumps(payload), encoding="utf-8")
        result = _run_validate(self.tmp, turn="negative-claim")
        assert result.returncode == 1
        assert (
            "negative_paths entry" in result.stderr or "exactly match" in result.stderr
        )

    def test_negative_binding_chain_mismatch_is_blocked(self):
        red = _make_evidence(
            self.tmp, turn="negative-chain-red", phase="red", exit_code=1
        )
        _make_evidence(
            self.tmp,
            turn="negative-chain-green",
            phase="green",
            change_kind="fix",
            links={"red": red.name},
        )
        red_payload = json.loads(red.read_text(encoding="utf-8"))
        red_payload["negative_path_bindings"][0]["claim"] = (
            "different negative behavior"
        )
        red.write_text(json.dumps(red_payload), encoding="utf-8")
        result = _run_validate(self.tmp, turn="negative-chain-green")
        assert result.returncode == 1
        assert "negative path bindings" in result.stderr

    @pytest.mark.parametrize("response", ["VERIFY:\n", "```verify\n```\n"])
    def test_marker_only_and_fenced_markers_rejected(self, response):
        _make_evidence(self.tmp, turn="marker-turn")
        result = _run_rule_validator(self.tmp, response, "marker-turn")
        assert result.returncode != 0
        assert "ACCEPTANCE" in result.stderr or "strict VERIFY" in result.stderr

    def test_rule_validator_reuses_full_hard_completion_gate(self):
        (self.tmp / "iap.py").write_text("FLAG = True\n", encoding="utf-8")
        green = _make_evidence(
            self.tmp,
            turn="hard-direct-rule",
            change_kind="fix",
            phase="green",
            tier="runtime",
            risk="hard",
        )
        result = _run_rule_validator(
            self.tmp,
            _strict_response(green),
            "hard-direct-rule",
        )
        assert result.returncode != 0
        assert "HARD" in result.stderr or "linked RED" in result.stderr

    def test_hard_payment_requires_approved_strong_chain_and_mutation_match(self):
        source = self.tmp / "purchase.py"
        source.write_text("purchase = 'red'\n")
        criteria = [{"id": "payment-flow", "claim": "purchase handling is verified"}]
        command = [sys.executable, "tests/evidence_contract_check.py", "payment-ref"]
        refs = ["tests/evidence_contract_check.py"]
        red = _make_evidence(
            self.tmp,
            turn="pay-red",
            acceptance_criteria=criteria,
            command=command,
            output="payment-ref red\n",
            test_refs=refs,
            tier="runtime",
            change_kind="fix",
            phase="red",
            exit_code=1,
        )
        source.write_text("purchase = 'mutation'\n")
        mutation = _make_evidence(
            self.tmp,
            turn="pay-mutation",
            acceptance_criteria=criteria,
            command=command,
            output="payment-ref mutation\n",
            test_refs=refs,
            tier="runtime",
            change_kind="fix",
            phase="mutation",
            exit_code=1,
            links={"red": red.name},
        )
        source.write_text("purchase = 'green'\n")
        green = _make_evidence(
            self.tmp,
            turn="pay-green",
            acceptance_criteria=criteria,
            command=command,
            output="payment-ref green\n",
            test_refs=refs,
            tier="runtime",
            change_kind="fix",
            phase="green",
            risk="hard",
            reviewer={
                "id": "human-42",
                "status": "approved",
                "evidence_ref": "review.json",
            },
            links={"red": red.name, "mutation": mutation.name},
        )
        _add_hard_support(
            self.tmp,
            green,
            criteria=criteria,
            command=command,
            test_refs=refs,
        )
        response = _strict_response(green)
        passed = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert passed.returncode == 0, passed.stderr

        review_path = self.tmp / ".forgewright" / "verify" / "pay-green-review.json"
        original_review = review_path.read_text(encoding="utf-8")
        tampered_review = json.loads(original_review)
        tampered_review["findings"] = ["tampered finding"]
        review_path.write_text(json.dumps(tampered_review), encoding="utf-8")
        tampered = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert tampered.returncode == 1
        assert "signature" in tampered.stderr
        review_path.write_text(original_review, encoding="utf-8")

        missing_trust_root = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="pay-green",
            response=response,
            review_allowed_signers=self.tmp.parent
            / "missing-reviewers.allowed_signers",
        )
        assert missing_trust_root.returncode == 1
        assert "allowed_signers" in missing_trust_root.stderr

        green_payload = json.loads(green.read_text(encoding="utf-8"))
        pre_path = (
            self.tmp
            / ".forgewright"
            / "verify"
            / green_payload["links"]["pre_mutation"]
        )
        pre_payload = json.loads(pre_path.read_text(encoding="utf-8"))
        original_pre_tree = pre_payload["tree_sha"]
        pre_payload["tree_sha"] = json.loads(red.read_text(encoding="utf-8"))[
            "tree_sha"
        ]
        pre_path.write_text(json.dumps(pre_payload), encoding="utf-8")
        not_restored = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert not_restored.returncode == 1
        assert "restore the exact pre-mutation full worktree" in not_restored.stderr
        pre_payload["tree_sha"] = original_pre_tree
        pre_path.write_text(json.dumps(pre_payload), encoding="utf-8")

        mutation_payload = json.loads(mutation.read_text(encoding="utf-8"))
        mutation_payload["command"] = [sys.executable, "-c", "print('other-ref')"]
        mutation.write_text(json.dumps(mutation_payload), encoding="utf-8")
        mismatch = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert mismatch.returncode == 1
        assert "linked mutation command" in mismatch.stderr

    def test_link_traversal_and_same_tree_red_mutation_rejected(self):
        source = self.tmp / "purchase.py"
        source.write_text("purchase = True\n")
        criteria = [{"id": "chain", "claim": "the chain is verified"}]
        command = [sys.executable, "tests/evidence_contract_check.py", "chain-ref"]
        refs = ["tests/evidence_contract_check.py"]
        red = _make_evidence(
            self.tmp,
            turn="chain-red",
            acceptance_criteria=criteria,
            command=command,
            output="chain-ref red\n",
            test_refs=refs,
            tier="runtime",
            phase="red",
            exit_code=1,
        )
        source.write_text("purchase = False\n")
        mutation = _make_evidence(
            self.tmp,
            turn="chain-mutation",
            acceptance_criteria=criteria,
            command=command,
            output="chain-ref mutation\n",
            test_refs=refs,
            tier="runtime",
            phase="mutation",
            exit_code=1,
            links={"red": red.name},
        )
        source.write_text("purchase = 'green'\n")
        green = _make_evidence(
            self.tmp,
            turn="chain-green",
            acceptance_criteria=criteria,
            command=command,
            output="chain-ref green\n",
            test_refs=refs,
            tier="runtime",
            phase="green",
            risk="hard",
            reviewer={
                "id": "human-42",
                "status": "independent-approved",
                "evidence_ref": "review.json",
            },
            links={"red": red.name, "mutation": mutation.name},
        )
        _add_hard_support(
            self.tmp,
            green,
            criteria=criteria,
            command=command,
            test_refs=refs,
        )
        green_payload = json.loads(green.read_text(encoding="utf-8"))
        green_payload["links"]["red"] = "../escape.json"
        green.write_text(json.dumps(green_payload), encoding="utf-8")
        traversal = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="chain-green",
            response=_strict_response(green),
        )
        assert traversal.returncode == 1
        assert "path traversal" in traversal.stderr

        green_payload = json.loads(green.read_text(encoding="utf-8"))
        green_payload["links"]["red"] = red.name
        mutation_payload = json.loads(mutation.read_text(encoding="utf-8"))
        mutation_payload["tree_sha"] = json.loads(red.read_text(encoding="utf-8"))[
            "tree_sha"
        ]
        mutation.write_text(json.dumps(mutation_payload), encoding="utf-8")
        green.write_text(json.dumps(green_payload), encoding="utf-8")
        same_tree = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="chain-green",
            response=_strict_response(green),
        )
        assert same_tree.returncode == 1
        assert "distinct tree fingerprints" in same_tree.stderr

    def test_signed_review_rejects_mutated_final_evidence(self):
        final, response = _signed_hard_review(self.tmp, "signed-mutation")
        payload = json.loads(final.read_text(encoding="utf-8"))
        payload["limitations"] = ["added after the review was signed"]
        final.write_text(json.dumps(payload), encoding="utf-8")

        result = _run_validate(
            self.tmp, files_str="purchase.py", turn="signed-mutation", response=response
        )

        assert result.returncode == 1
        assert "evidence_sha256" in result.stderr

    def test_signed_review_rejects_untrusted_attacker_key(self):
        final, response = _signed_hard_review(self.tmp, "signed-attacker")
        fixture = _review_fixture(self.tmp)
        attacker = _generate_review_keypair(self.tmp, "attacker-review")
        key_dirs = fixture["key_dirs"]
        assert isinstance(key_dirs, list)
        attacker_dir = attacker["dir"]
        attacker_key = attacker["private_key"]
        assert isinstance(attacker_dir, Path)
        assert isinstance(attacker_key, Path)
        key_dirs.append(attacker_dir)
        allowed_signers = fixture["allowed_signers"]
        assert isinstance(allowed_signers, Path)
        signed = _run_py(
            REVIEW_ATTEST,
            ["sign", "--evidence", str(final), "--private-key", str(attacker_key)],
            cwd=self.tmp,
            env={"FORGEWRIGHT_REVIEW_ALLOWED_SIGNERS": str(allowed_signers)},
        )
        assert signed.returncode == 0, signed.stderr

        result = _run_validate(
            self.tmp, files_str="purchase.py", turn="signed-attacker", response=response
        )

        assert result.returncode == 1
        assert "signature" in result.stderr

    def test_signed_review_rejects_replayed_review_for_different_turn(self):
        final, _ = _signed_hard_review(self.tmp, "signed-original")
        original = json.loads(final.read_text(encoding="utf-8"))
        replay = dict(original)
        replay["turn"] = "signed-replay"
        replay_path = self.tmp / ".forgewright" / "verify" / "signed-replay.json"
        replay_path.write_text(json.dumps(replay), encoding="utf-8")

        result = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="signed-replay",
            response=_strict_response(replay_path),
        )

        assert result.returncode == 1
        assert (
            "reviewer evidence turn does not match" in result.stderr
            or "evidence_sha256" in result.stderr
        )


# ══════════════════════════════════════════════════════════════════════════════
# D. guard.sh tri-state protected paths and HARD signals
# ══════════════════════════════════════════════════════════════════════════════


class TestGuardSh:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()
        # Replicate guard.sh in the temp repo for testing
        fake_scripts_lite = self.tmp / "scripts" / "lite"
        fake_scripts_lite.mkdir(parents=True)
        shutil.copy(GUARD_SH, fake_scripts_lite / "guard.sh")
        # Ensure gitnexus is not called (no .gitnexus dir)

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _guard(
        self, *files: str, env: dict | None = None
    ) -> subprocess.CompletedProcess:
        guard = self.tmp / "scripts" / "lite" / "guard.sh"
        full_env = {**os.environ, **(env or {})}
        return subprocess.run(
            ["bash", str(guard)] + list(files),
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(self.tmp),
            env=full_env,
        )

    # ── D1. CREATE of protected path is ALLOWED ───────────────────────────────
    def test_create_protected_path_allowed(self):
        """Creating a .env file (not yet in HEAD) should be ALLOWED."""
        # Don't create the file — it doesn't exist in HEAD, so action = CREATE
        r = self._guard(".env")
        assert r.returncode in (0, 2), (
            f"Expected 0 or 2 (HARD), got {r.returncode}\n{r.stderr}"
        )
        assert "ALLOWED CREATE" in r.stdout

    # ── D2. MODIFY of protected path is BLOCKED ───────────────────────────────
    def test_modify_protected_path_blocked(self):
        """Modifying .env (tracked in HEAD) should be BLOCKED."""
        # Create and commit the file so it's in HEAD
        env_file = self.tmp / ".env"
        env_file.write_text("KEY=val\n")
        subprocess.run(["git", "add", ".env"], cwd=self.tmp, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "add env"], cwd=self.tmp, capture_output=True
        )
        # Now it's in HEAD → action = MODIFY → should be BLOCKED
        env_file.write_text("KEY=changed\n")
        r = self._guard(".env")
        assert r.returncode == 1
        assert "BLOCKED" in r.stderr

    # ── D3. HARD signal for auth-related content ──────────────────────────────
    def test_hard_signal_for_auth_content(self):
        """File containing 'jwt' keyword should trigger exit code 2."""
        auth_file = self.tmp / "auth_handler.py"
        auth_file.write_text(
            textwrap.dedent("""\
            # Auth handler
            import jwt
            def verify_jwt(token):
                return jwt.decode(token, 'secret', algorithms=['HS256'])
        """)
        )
        r = self._guard("auth_handler.py")
        assert r.returncode == 2, (
            f"Expected HARD exit 2, got {r.returncode}\n{r.stderr}"
        )
        assert "HARD" in r.stderr

    # ── D3b. Self-source guard exception ─────────────────────────────────────
    def test_lite_guard_source_does_not_self_trigger_hard_signal(self):
        """guard.sh must not classify its own pattern source as HARD."""
        r = self._guard("scripts/lite/guard.sh")
        assert r.returncode == 0, (
            f"Expected guard source to pass without HARD signal, got {r.returncode}\n"
            f"stdout={r.stdout}\nstderr={r.stderr}"
        )
        assert "HARD-SIGNAL" not in r.stderr

    # ── D4. Deny table: rm -rf blocked ───────────────────────────────────────
    def test_deny_rm_rf_in_file_blocked(self):
        """File containing 'rm -rf' should be blocked (not in comment)."""
        bad_file = self.tmp / "deploy.sh"
        bad_file.write_text("#!/bin/sh\nrm -rf /var/data\necho done\n")
        r = self._guard("deploy.sh")
        assert r.returncode == 1
        assert "rm -rf" in r.stderr

    # ── D5. Deny table: rm -rf in comment is OK ──────────────────────────────
    def test_deny_rm_rf_in_comment_allowed(self):
        """Commented-out 'rm -rf' should not block."""
        ok_file = self.tmp / "safe.sh"
        ok_file.write_text("#!/bin/sh\n# rm -rf /tmp  # do not run this!\necho ok\n")
        r = self._guard("safe.sh")
        # Should not be blocked for rm -rf (it's commented)
        assert r.returncode in (0, 2), (
            f"Expected 0 or 2, got {r.returncode}\n{r.stderr}"
        )
        assert "rm -rf" not in r.stderr or "Deny" not in r.stderr

    # ── D6. Filenames with spaces ─────────────────────────────────────────────
    def test_guard_handles_filename_with_spaces(self):
        """guard.sh must handle filenames containing spaces without crashing."""
        spaced_file = self.tmp / "my file with spaces.sh"
        spaced_file.write_text("#!/bin/sh\necho hello\n")
        r = self._guard(str(spaced_file))
        # Should not crash (exit 1 could be because of guard content, but not crash)
        assert r.returncode in (0, 1, 2), f"Crashed on spaced filename: {r.returncode}"

    # ── D7. No hardcoded repo name ────────────────────────────────────────────
    def test_guard_does_not_hardcode_repo_name(self):
        """guard.sh must not contain hardcoded 'forgewright' as repo name."""
        content = GUARD_SH.read_text()
        # The repo name should be derived dynamically via $(basename ...), not hardcoded
        assert 'REPO_NAME="forgewright"' not in content, (
            "guard.sh hardcodes repo name 'forgewright' — use $(basename ${PROJECT_ROOT}) instead"
        )
        # Should use basename
        assert "basename" in content, (
            "guard.sh should use 'basename' to derive repo name"
        )


# ══════════════════════════════════════════════════════════════════════════════
# E. verify-gate.sh --platform parsing
# ══════════════════════════════════════════════════════════════════════════════


class TestVerifyGateSh:
    def setup_method(self):
        self.tmp = _make_temp_git_repo()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _gate(
        self, platform: str = "claude", stdin_json: str = "", env: dict | None = None
    ) -> subprocess.CompletedProcess:
        full_env = {**os.environ, **(env or {})}
        return subprocess.run(
            ["bash", str(VERIFY_SH), "--platform", platform],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=full_env,
            input=stdin_json,
        )

    def _stop_gate(self, payload: dict) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=os.environ.copy(),
            input=json.dumps(payload),
        )

    def test_no_code_changes_gate_open(self):
        """Clean repo with no code changes → gate open immediately."""
        r = self._gate(platform="claude", stdin_json="")
        assert r.returncode == 0, r.stderr
        assert "No code changes" in r.stdout

    def test_invalid_platform_blocked(self):
        """Unknown platform name → gate blocks with error."""
        r = subprocess.run(
            ["bash", str(VERIFY_SH), "--platform", "unknownbot"],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(self.tmp),
        )
        assert r.returncode == 1
        assert "Unknown platform" in r.stderr

    def test_valid_platforms_accepted(self):
        """All four valid platforms must be accepted without 'Unknown platform' error."""
        for platform in ("claude", "gemini", "cursor", "codex"):
            r = subprocess.run(
                ["bash", str(VERIFY_SH), "--platform", platform],
                capture_output=True,
                text=True,
                timeout=15,
                cwd=str(self.tmp),
            )
            # Clean repo → gate open (exit 0), no "Unknown platform" error
            assert r.returncode == 0, (
                f"Platform '{platform}' should be valid, got rc={r.returncode}\n{r.stderr}"
            )
            assert "Unknown platform" not in r.stderr

    def test_platform_payload_json_parsed(self):
        """Payload JSON with response_content and turn is parsed correctly."""
        payload = json.dumps(
            {
                "response_content": "VERIFY: echo passed",
                "turn": "t_001",
                "files": [],
            }
        )
        # Clean repo → no code changes → gate open regardless of payload
        r = self._gate(platform="gemini", stdin_json=payload)
        assert r.returncode == 0, r.stderr

    def test_codex_native_stop_payload_uses_last_assistant_message_and_turn_id(self):
        """Codex Stop's native payload must select exact-turn evidence and VERIFY text."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        turn_id = "codex-native-turn"
        selected_evidence = _make_evidence(
            self.tmp,
            turn=turn_id,
        )
        competing_evidence = _make_evidence(
            self.tmp,
            turn="newer-wrong-turn",
            exit_code=1,
        )
        os.utime(selected_evidence, (1, 1))
        os.utime(competing_evidence, (2, 2))
        strict_response = _strict_response(selected_evidence)
        payload = json.dumps(
            {
                "cwd": str(self.tmp),
                "hook_event_name": "Stop",
                "last_assistant_message": strict_response,
                "model": "gpt-5",
                "permission_mode": "dontAsk",
                "session_id": "test-session",
                "stop_hook_active": True,
                "transcript_path": str(self.tmp / "rollout.jsonl"),
                "turn": "",
                "turn_id": turn_id,
            }
        )

        r = self._gate(platform="codex", stdin_json=payload)

        assert r.returncode == 0, r.stderr
        assert json.loads(r.stdout) == {"continue": True}
        assert "Strict VERIFY response correlation passed" in r.stderr

    def test_codex_unmapped_platform_turn_id_discovers_correlated_final_evidence(self):
        """A Codex routing ID must not shadow valid current Forgewright evidence."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="internal-evidence-turn")
        review = evidence.with_name("internal-evidence-turn-review.json")
        review.write_text(json.dumps({"schema_version": "review-2"}), encoding="utf-8")
        os.utime(evidence, (1, 1))
        os.utime(review, (2, 2))
        response = _strict_response(evidence)
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": response,
            "turn": "",
            "turn_id": "codex-platform-unmapped-uuid",
        }

        accepted = self._stop_gate(payload)
        assert accepted.returncode == 0, accepted.stderr
        assert json.loads(accepted.stdout) == {"continue": True}

        payload["last_assistant_message"] = response.replace(
            "COMMAND:", "COMMAND: unrelated ", 1
        )
        rejected = self._stop_gate(payload)
        assert rejected.returncode == 0, rejected.stderr
        assert json.loads(rejected.stdout)["decision"] == "block"

    def test_codex_mapped_symlink_evidence_is_blocked_without_fallback(self):
        """Mapped evidence must remain a bounded regular file inside the workspace."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="symlink-turn")
        response = _strict_response(evidence)
        external_dir = Path(tempfile.mkdtemp(prefix="fw_external_evidence_"))
        try:
            external = external_dir / "symlink-turn.json"
            evidence.replace(external)
            evidence.symlink_to(external)
            payload = {
                "hook_event_name": "Stop",
                "last_assistant_message": response,
                "turn": "",
                "turn_id": "symlink-turn",
            }

            rejected = self._stop_gate(payload)

            assert rejected.returncode == 0, rejected.stderr
            assert json.loads(rejected.stdout)["decision"] == "block"
        finally:
            shutil.rmtree(external_dir, ignore_errors=True)

    def test_codex_mapped_evidence_turn_must_match_filename(self):
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="filename-turn")
        record = json.loads(evidence.read_text(encoding="utf-8"))
        record["turn"] = "different-internal-turn"
        evidence.write_text(json.dumps(record), encoding="utf-8")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence),
            "turn": "",
            "turn_id": "filename-turn",
        }

        rejected = self._stop_gate(payload)

        assert rejected.returncode == 0, rejected.stderr
        assert json.loads(rejected.stdout)["decision"] == "block"

    def test_codex_mapped_oversized_evidence_is_blocked_without_fallback(self):
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        fallback = _make_evidence(self.tmp, turn="bounded-fallback")
        oversized = fallback.with_name("oversized-turn.json")
        oversized.write_bytes(b"{" + (b" " * (4 * 1024 * 1024)) + b"}")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(fallback),
            "turn": "",
            "turn_id": "oversized-turn",
        }

        rejected = self._stop_gate(payload)

        assert rejected.returncode == 0, rejected.stderr
        assert json.loads(rejected.stdout)["decision"] == "block"

    def test_verify_gate_does_not_mutate_source_files(self):
        """verify-gate must validate source files without redacting/re-writing them."""
        source = self.tmp / "fixture.py"
        source.write_text(
            textwrap.dedent("""\
            PRIVATE_KEY_FIXTURE = '''-----BEGIN PRIVATE KEY-----
            fake-test-key-material
            -----END PRIVATE KEY-----'''
        """)
        )
        original = source.read_text()
        evidence = _make_evidence(self.tmp, turn="t_mutation")

        payload = json.dumps(
            {
                "response_content": _strict_response(evidence),
                "turn": "t_mutation",
                "files": ["fixture.py"],
            }
        )
        r = self._gate(platform="codex", stdin_json=payload)
        assert r.returncode == 0, r.stderr
        assert source.read_text() == original

    def test_stdin_loop_cap(self):
        """Oversized stdin should be handled without hanging (loop cap enforced)."""
        # 2 MB of JSON-ish data that is NOT valid JSON → should not hang
        big_input = '{"response_content": "' + ("x" * (2 * 1024 * 1024)) + '"}'
        r = subprocess.run(
            ["bash", str(VERIFY_SH), "--platform", "claude"],
            capture_output=True,
            text=True,
            timeout=20,
            cwd=str(self.tmp),
            input=big_input,
        )
        # Should complete within timeout — we just check it doesn't hang
        assert r.returncode in (0, 1), f"Expected 0 or 1, got {r.returncode}"


# ══════════════════════════════════════════════════════════════════════════════
# F. verify_gate.py --selftest smoke test
# ══════════════════════════════════════════════════════════════════════════════


def test_verify_gate_selftest():
    r = _run_py(VERIFY_PY, args=["--selftest"])
    assert r.returncode == 0, r.stderr
    assert "selftest PASSED" in r.stdout or "PASSED" in r.stdout

    spec = importlib.util.spec_from_file_location("verify_gate_under_test", VERIFY_PY)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    prose = (
        "`n. ACTION (one concrete action) | TARGET (exact file/symbol) | "
        "CHECK (one command whose exit code proves this item done)`"
    )
    assert module._lint_text(prose, "AGENTS.md") == []
    assert (
        module._lint_text(
            "3. If `EASY` → execute it, then run its CHECK command.", "AGENTS.md"
        )
        == []
    )
    assert module._lint_text("- CHECK: `pytest -q` -> Passed.", "plan.md") == []
    assert any(
        "bash syntax error" in error
        for error in module._lint_text("- CHECK: `if (` -> Failed.", "plan.md")
    )
    assert any(
        "missing '->' transition" in error
        for error in module._lint_text("- CHECK: `pytest -q`", "plan.md")
    )
    assert any(
        "empty CHECK command" in error
        for error in module._lint_text("- CHECK: `` -> Failed.", "plan.md")
    )


# ══════════════════════════════════════════════════════════════════════════════
# G. Regression: verify_gate.py _STUB_EXTS reference
# ══════════════════════════════════════════════════════════════════════════════


def test_verify_gate_py_imports_cleanly():
    """verify_gate.py must be importable without errors (catches NameError etc.)."""
    r = _run_py(VERIFY_PY, args=["--selftest"])
    assert "NameError" not in r.stderr
    assert "AttributeError" not in r.stderr
    assert r.returncode == 0
