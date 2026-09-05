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
import review_attest as review_attest_module  # noqa: E402
import continuity_check as continuity_check_module  # noqa: E402
import stop_gate as stop_gate_module  # noqa: E402
import verify_gate as verify_gate_module  # noqa: E402
import windows_secure_io as windows_secure_io_module  # noqa: E402

from evidence_common import (  # noqa: E402
    command_text,
    execution_manifest,
    read_evidence_bytes,
    sha256_text,
    worktree_fingerprint,
)


def test_replay_env_drops_launcher_pythonhome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A gate interpreter's stdlib must not contaminate a replayed Python."""

    monkeypatch.setenv("PYTHONHOME", "C:/gate-python-3.11")
    monkeypatch.setenv("FORGEWRIGHT_REPLAY_SENTINEL", "preserved")

    replay_env = verify_gate_module._replay_env()

    assert "PYTHONHOME" not in replay_env
    assert replay_env["FORGEWRIGHT_REPLAY_SENTINEL"] == "preserved"


# ── helpers ───────────────────────────────────────────────────────────────────


def _symlink_or_skip(
    link: Path, target: Path, *, target_is_directory: bool = False
) -> None:
    try:
        link.symlink_to(target, target_is_directory=target_is_directory)
    except OSError as error:
        if os.name == "nt" and getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows symlink privilege is unavailable")
        raise


def _windows_junction(link: Path, target: Path) -> None:
    created = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert created.returncode == 0, created.stderr or created.stdout


def _windows_try_set_mount_point(directory: Path, target: Path) -> tuple[bool, int]:
    import ctypes
    import struct
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    device_io = kernel32.DeviceIoControl
    device_io.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        wintypes.LPVOID,
    ]
    device_io.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    handle = create_file(
        str(directory),
        0x40000000,
        0x00000001 | 0x00000002,
        None,
        3,
        0x02000000 | 0x00200000,
        None,
    )
    if handle == wintypes.HANDLE(-1).value:
        return False, ctypes.get_last_error()
    try:
        print_name = str(target.resolve())
        substitute = f"\\??\\{print_name}".encode("utf-16-le")
        printable = print_name.encode("utf-16-le")
        path_buffer = substitute + b"\0\0" + printable + b"\0\0"
        reparse_data = (
            struct.pack(
                "<IHHHHHH",
                0xA0000003,
                8 + len(path_buffer),
                0,
                0,
                len(substitute),
                len(substitute) + 2,
                len(printable),
            )
            + path_buffer
        )
        raw = ctypes.create_string_buffer(reparse_data)
        returned = wintypes.DWORD()
        if device_io(
            handle,
            0x000900A4,
            raw,
            len(reparse_data),
            None,
            0,
            ctypes.byref(returned),
            None,
        ):
            return True, 0
        return True, ctypes.get_last_error()
    finally:
        close_handle(handle)


@pytest.mark.skipif(os.name == "nt", reason="POSIX symlink semantics")
def test_review_attest_rejects_symlinked_verify_output(tmp_path: Path) -> None:
    forge_dir = tmp_path / ".forgewright"
    forge_dir.mkdir()
    outside = Path(tempfile.mkdtemp(prefix="fw_external_review_"))
    verify_dir = forge_dir / "verify"
    verify_dir.symlink_to(outside, target_is_directory=True)
    escaped = outside / "escaped-review.json"
    try:
        with pytest.raises(ValueError, match="symlink|reparse"):
            resolved_verify = review_attest_module._verify_dir(tmp_path)
            review_attest_module._atomic_write(resolved_verify / escaped.name, b"{}\n")
        assert not escaped.exists()
    finally:
        verify_dir.unlink(missing_ok=True)
        shutil.rmtree(outside, ignore_errors=True)


@pytest.mark.skipif(os.name != "nt", reason="Windows junction semantics")
def test_review_attest_rejects_junctioned_verify_output(tmp_path: Path) -> None:
    forge_dir = tmp_path / ".forgewright"
    forge_dir.mkdir()
    outside = Path(tempfile.mkdtemp(prefix="fw_external_review_"))
    verify_dir = forge_dir / "verify"
    _windows_junction(verify_dir, outside)
    escaped = outside / "escaped-review.json"
    try:
        with pytest.raises(ValueError, match="symlink|reparse"):
            resolved_verify = review_attest_module._verify_dir(tmp_path)
            review_attest_module._atomic_write(resolved_verify / escaped.name, b"{}\n")
        assert not escaped.exists()
    finally:
        verify_dir.rmdir()
        shutil.rmtree(outside, ignore_errors=True)


def test_review_attest_atomic_write_preserves_descriptor_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    verify_dir = tmp_path / ".forgewright" / "verify"
    verify_dir.mkdir(parents=True)
    output = verify_dir / "review.json"

    def fail_fstat(_descriptor: int) -> os.stat_result:
        raise OSError("forced fstat failure")

    monkeypatch.setattr(review_attest_module.os, "fstat", fail_fstat)
    with pytest.raises(OSError, match="forced fstat failure"):
        review_attest_module._atomic_write(verify_dir, output, b"{}\n")
    assert not output.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows directory sharing semantics")
def test_review_attest_atomic_write_blocks_junction_swap_after_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    forge_dir = tmp_path / ".forgewright"
    verify_dir = forge_dir / "verify"
    verify_dir.mkdir(parents=True)
    original_verify = forge_dir / "verify-original"
    outside = Path(tempfile.mkdtemp(prefix="fw_external_review_race_"))
    output = verify_dir / "review.json"
    real_writer = review_attest_module.windows_atomic_write_bytes

    def guarded_writer(root: Path, target: Path, payload: bytes) -> None:
        def swap() -> None:
            verify_dir.replace(original_verify)
            _windows_junction(verify_dir, outside)

        real_writer(root, target, payload, after_guard=swap)

    monkeypatch.setattr(
        review_attest_module, "windows_atomic_write_bytes", guarded_writer
    )
    try:
        with pytest.raises((OSError, ValueError)) as caught:
            review_attest_module._atomic_write(
                verify_dir, output, b'{"secret":"written-outside"}\n'
            )
        assert list(outside.iterdir()) == []
        assert isinstance(caught.value, OSError)
        assert getattr(caught.value, "winerror", None) in {5, 32, 33}
    finally:
        if verify_dir.exists():
            verify_dir.rmdir()
        if original_verify.exists():
            original_verify.replace(verify_dir)
        shutil.rmtree(outside, ignore_errors=True)


@pytest.mark.skipif(os.name != "nt", reason="Windows directory sharing semantics")
def test_stop_retry_writer_blocks_parent_swap_after_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state_dir = tmp_path / ".forgewright" / "runtime" / "stop-attempts"
    state_dir.mkdir(parents=True)
    original = state_dir.with_name("stop-attempts-original")
    target = state_dir / "state.json"
    real_writer = stop_gate_module.windows_atomic_write_bytes

    def guarded_writer(root: Path, path: Path, payload: bytes) -> None:
        def swap() -> None:
            state_dir.replace(original)

        real_writer(root, path, payload, after_guard=swap)

    monkeypatch.setattr(stop_gate_module, "windows_atomic_write_bytes", guarded_writer)
    with pytest.raises(OSError) as caught:
        stop_gate_module._atomic_json(tmp_path, target, {"keys": []})
    assert getattr(caught.value, "winerror", None) in {5, 32, 33}
    assert not target.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows directory sharing semantics")
def test_continuity_retry_writer_blocks_parent_swap_after_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state_dir = tmp_path / ".forgewright" / "runtime" / "docs-continuity"
    original = state_dir.with_name("docs-continuity-original")
    observed: dict[str, OSError] = {}
    real_writer = continuity_check_module.windows_atomic_write_bytes

    def guarded_writer(root: Path, path: Path, payload: bytes) -> None:
        def swap() -> None:
            try:
                state_dir.replace(original)
            except OSError as error:
                observed["error"] = error
                raise

        real_writer(root, path, payload, after_guard=swap)

    monkeypatch.setattr(
        continuity_check_module, "windows_atomic_write_bytes", guarded_writer
    )
    assert not continuity_check_module._retry_once(
        tmp_path, {"session_id": "windows-race"}, ["README.md"]
    )
    assert getattr(observed["error"], "winerror", None) in {5, 32, 33}
    assert not original.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows directory sharing semantics")
@pytest.mark.parametrize("writer", ["stop", "continuity"])
def test_windows_state_lock_blocks_parent_swap_before_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, writer: str
) -> None:
    module = stop_gate_module if writer == "stop" else continuity_check_module
    directory_name = "stop-attempts" if writer == "stop" else "docs-continuity"
    state_dir = tmp_path / ".forgewright" / "runtime" / directory_name
    original = state_dir.with_name(f"{directory_name}-original")
    outside = tmp_path / f"{directory_name}-outside"
    outside.mkdir()
    real_open = module.windows_open_anchored_lock_file

    def guarded_open(root: Path, directory: Path, path: Path) -> int:
        def swap() -> None:
            state_dir.replace(original)
            _windows_junction(state_dir, outside)

        return real_open(root, directory, path, before_open=swap)

    monkeypatch.setattr(module, "windows_open_anchored_lock_file", guarded_open)
    if writer == "stop":
        assert module._retry_state(
            tmp_path, "windows-lock-race", "key", record=True
        ) == (False, "validation_failed")
    else:
        assert not module._retry_once(
            tmp_path, {"session_id": "windows-lock-race"}, ["README.md"]
        )
    assert not original.exists()
    assert list(outside.iterdir()) == []
    assert not (state_dir / ".lock").exists()


@pytest.mark.skipif(os.name != "nt", reason="native Windows lock-anchor semantics")
@pytest.mark.parametrize("writer", ["stop", "continuity"])
def test_windows_state_lock_anchor_blocks_parent_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, writer: str
) -> None:
    module = stop_gate_module if writer == "stop" else continuity_check_module
    directory_name = "stop-attempts" if writer == "stop" else "docs-continuity"
    state_dir = tmp_path / ".forgewright" / "runtime" / directory_name
    renamed = state_dir.with_name(f"{directory_name}-renamed")
    outside = tmp_path / f"{directory_name}-outside"
    outside.mkdir()
    observed: dict[str, object] = {}
    real_open = module.windows_open_anchored_lock_file

    def guarded_open(root: Path, directory: Path, path: Path) -> int:
        def attack() -> None:
            try:
                state_dir.replace(renamed)
            except OSError as error:
                observed["rename_error"] = error
            else:
                raise AssertionError("the lock anchor allowed its parent to move")
            opened, error = _windows_try_set_mount_point(state_dir, outside)
            observed["reparse_opened"] = opened
            observed["reparse_error"] = error
            if error == 0:
                raise AssertionError("the lock-anchored parent became a junction")

        return real_open(root, directory, path, after_open=attack)

    monkeypatch.setattr(module, "windows_open_anchored_lock_file", guarded_open)
    if writer == "stop":
        assert module._retry_state(
            tmp_path, "windows-lock-anchor", "key", record=True
        ) == (False, "validation_failed")
    else:
        assert module._retry_once(
            tmp_path, {"session_id": "windows-lock-anchor"}, ["README.md"]
        )
    assert getattr(observed["rename_error"], "winerror", None) in {5, 32, 33}
    assert observed["reparse_opened"] is True
    assert observed["reparse_error"] in {5, 32, 145}
    assert not renamed.exists()
    assert list(outside.iterdir()) == []


@pytest.mark.skipif(os.name != "nt", reason="native Windows rename semantics")
def test_windows_atomic_writer_keeps_published_target_on_postcheck_error(
    tmp_path: Path,
) -> None:
    target = tmp_path / "state.json"
    target.write_bytes(b"old")

    def fail_after_publish() -> None:
        raise OSError("forced post-publication check failure")

    with pytest.raises(OSError, match="forced post-publication"):
        windows_secure_io_module.atomic_write_bytes(
            tmp_path,
            target,
            b"new",
            after_publish=fail_after_publish,
        )
    assert target.read_bytes() == b"new"
    assert list(tmp_path.glob(".*.tmp")) == []


@pytest.mark.skipif(os.name != "nt", reason="native Windows anchor semantics")
def test_windows_atomic_writer_temp_anchor_blocks_parent_mutation(
    tmp_path: Path,
) -> None:
    parent = tmp_path / "state"
    parent.mkdir()
    renamed = tmp_path / "state-renamed"
    outside = tmp_path / "outside"
    outside.mkdir()
    target = parent / "state.json"
    observed: dict[str, object] = {}

    def attack_after_parent_reopen() -> None:
        try:
            parent.replace(renamed)
        except OSError as error:
            observed["rename_error"] = error
        else:
            raise AssertionError("the temporary anchor allowed its parent to move")
        opened, error = _windows_try_set_mount_point(parent, outside)
        observed["reparse_opened"] = opened
        observed["reparse_error"] = error
        if error == 0:
            raise AssertionError("the nonempty anchored parent became a junction")

    windows_secure_io_module.atomic_write_bytes(
        tmp_path,
        target,
        b"anchored",
        after_anchor=attack_after_parent_reopen,
    )
    assert getattr(observed["rename_error"], "winerror", None) in {5, 32, 33}
    assert observed["reparse_opened"] is True
    assert observed["reparse_error"] in {5, 32, 145}
    assert target.read_bytes() == b"anchored"
    assert list(outside.iterdir()) == []


@pytest.mark.skipif(os.name != "nt", reason="native Windows cleanup semantics")
def test_windows_atomic_writer_preserves_primary_cleanup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "state.json"

    def fail_rename(_descriptor: int, _directory: int, _name: str) -> None:
        raise OSError("primary rename failure")

    def fail_cleanup(_descriptor: int) -> None:
        raise OSError("forced cleanup failure")

    monkeypatch.setattr(windows_secure_io_module, "_rename_open_file", fail_rename)
    monkeypatch.setattr(windows_secure_io_module, "_dispose_open_file", fail_cleanup)
    with pytest.raises(OSError, match="primary rename failure") as caught:
        windows_secure_io_module.atomic_write_bytes(tmp_path, target, b"payload")
    assert any("cleanup also failed" in note for note in caught.value.__notes__)


@pytest.mark.skipif(os.name != "nt", reason="native Windows rename semantics")
def test_review_attest_atomic_write_replaces_long_name_from_workspace_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    verify_dir = tmp_path / ".forgewright" / "verify"
    verify_dir.mkdir(parents=True)
    output = verify_dir / "windows-keyless-review-review.json"
    output.write_bytes(b"stale\n")
    monkeypatch.chdir(tmp_path)

    for iteration in range(32):
        payload = f'{{"iteration":{iteration}}}\n'.encode()
        review_attest_module._atomic_write(verify_dir, output, payload)
        assert output.read_bytes() == payload


def test_read_evidence_bytes_accepts_valid_regular_file(tmp_path: Path) -> None:
    verify_dir = tmp_path / ".forgewright" / "verify"
    verify_dir.mkdir(parents=True)
    evidence = verify_dir / "valid.json"
    evidence.write_bytes(b'{"schema_version":"2"}')

    assert read_evidence_bytes(tmp_path, evidence) == evidence.read_bytes()


@pytest.mark.skipif(os.name != "nt", reason="NTFS alternate data streams")
def test_read_evidence_bytes_rejects_windows_alternate_data_stream(
    tmp_path: Path,
) -> None:
    verify_dir = tmp_path / ".forgewright" / "verify"
    verify_dir.mkdir(parents=True)
    carrier = verify_dir / "carrier.json"
    carrier_payload = b'{"schema_version":"2","carrier":true}'
    carrier.write_bytes(carrier_payload)
    alternate_stream = Path(f"{carrier}:proof")
    alternate_payload = b'{"schema_version":"2","forged":true}'
    try:
        alternate_stream.write_bytes(alternate_payload)
        assert alternate_stream.read_bytes() == alternate_payload
    except OSError:
        pytest.skip("NTFS alternate data streams are unavailable")

    with pytest.raises(ValueError, match="safe relative path"):
        read_evidence_bytes(tmp_path, alternate_stream)
    assert carrier.read_bytes() == carrier_payload
    assert alternate_stream.read_bytes() == alternate_payload


@pytest.mark.skipif(os.name != "nt", reason="Windows junction semantics")
def test_read_evidence_bytes_rejects_windows_junction(tmp_path: Path) -> None:
    forge_dir = tmp_path / ".forgewright"
    forge_dir.mkdir()
    outside = tmp_path.parent / f"{tmp_path.name}-outside-evidence"
    outside.mkdir()
    evidence = outside / "junction.json"
    evidence.write_bytes(b'{"schema_version":"2"}')
    junction = forge_dir / "verify"
    _windows_junction(junction, outside)
    try:
        with pytest.raises(ValueError, match="regular non-symlink"):
            read_evidence_bytes(tmp_path, junction / evidence.name)
        assert evidence.read_bytes() == b'{"schema_version":"2"}'
    finally:
        junction.rmdir()
        shutil.rmtree(outside, ignore_errors=True)


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

    # Prove that the legacy review-1 shape cannot satisfy HARD before replacing
    # it with the exact keyless review-2 record.
    legacy = _run_validate(
        tmp,
        files_str="purchase.py",
        turn=final["turn"],
        response=_strict_response(final_path),
    )
    assert legacy.returncode == 1
    assert "review-2" in legacy.stderr

    created = _run_py(
        REVIEW_ATTEST,
        ["create", "--evidence", str(final_path)],
        cwd=tmp,
    )
    assert created.returncode == 0, created.stderr


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


def _keyless_hard_review(tmp: Path, turn: str = "keyless-review") -> tuple[Path, str]:
    """Build one valid keyless HARD evidence chain for review regressions."""
    source = tmp / "purchase.py"
    source.write_text("purchase = 'red'\n", encoding="utf-8")
    criteria = [{"id": "keyless-review", "claim": "purchase handling is verified"}]
    command = [sys.executable, "tests/evidence_contract_check.py", "keyless-review"]
    refs = ["tests/evidence_contract_check.py"]
    red = _make_evidence(
        tmp,
        turn=f"{turn}-red",
        acceptance_criteria=criteria,
        command=command,
        output="keyless-review red\n",
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
        output="keyless-review mutation\n",
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
        output="keyless-review green\n",
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

    def test_ignored_node_modules_dependency_cache_is_not_fingerprinted(self):
        (self.tmp / ".gitignore").write_text("node_modules/\n", encoding="utf-8")
        cached = self.tmp / "tools" / "node_modules" / "fixture" / "index.js"
        cached.parent.mkdir(parents=True)
        cached.write_text("module.exports = 1;\n", encoding="utf-8")
        before = worktree_fingerprint(self.tmp)
        cached.write_text("module.exports = 2;\n", encoding="utf-8")
        after = worktree_fingerprint(self.tmp)

        assert after == before

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

    def teardown_method(self):
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
        tampered_review["limitations"] = []
        review_path.write_text(json.dumps(tampered_review), encoding="utf-8")
        tampered = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert tampered.returncode == 1
        assert "reviewer-authentication limitation" in tampered.stderr
        review_path.write_text(original_review, encoding="utf-8")

        extra_signature = json.loads(original_review)
        extra_signature["signature"] = "legacy-signature-must-not-be-required"
        review_path.write_text(json.dumps(extra_signature), encoding="utf-8")
        extra = _run_validate(
            self.tmp, files_str="purchase.py", turn="pay-green", response=response
        )
        assert extra.returncode == 1
        assert "unexpected fields" in extra.stderr
        review_path.write_text(original_review, encoding="utf-8")

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

    @pytest.mark.skipif(os.name != "nt", reason="native Windows file modes")
    def test_keyless_review_create_uses_native_windows_mode_path(self):
        final, _ = _keyless_hard_review(self.tmp, "windows-keyless-review")
        payload = json.loads(final.read_text(encoding="utf-8"))
        review_path = final.parent / payload["reviewer"]["evidence_ref"]
        review = json.loads(review_path.read_text(encoding="utf-8"))

        assert review_path.is_file()
        assert review["schema_version"] == "review-2"
        assert review["turn"] == "windows-keyless-review"

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

    def test_keyless_review_rejects_mutated_final_evidence(self):
        final, response = _keyless_hard_review(self.tmp, "keyless-mutation")
        payload = json.loads(final.read_text(encoding="utf-8"))
        payload["limitations"] = ["added after the review was created"]
        final.write_text(json.dumps(payload), encoding="utf-8")

        result = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="keyless-mutation",
            response=response,
        )

        assert result.returncode == 1
        assert "evidence_sha256" in result.stderr

    def test_keyless_review_cli_rejects_legacy_private_key_flag(self):
        final, _ = _keyless_hard_review(self.tmp, "keyless-no-key-flag")
        result = _run_py(
            REVIEW_ATTEST,
            ["create", "--evidence", str(final), "--private-key", "/tmp/unused"],
            cwd=self.tmp,
        )

        assert result.returncode == 2
        assert "unrecognized arguments" in result.stderr

    def test_keyless_review_rejects_replayed_review_for_different_turn(self):
        final, _ = _keyless_hard_review(self.tmp, "keyless-original")
        original = json.loads(final.read_text(encoding="utf-8"))
        replay = dict(original)
        replay["turn"] = "keyless-replay"
        replay_path = self.tmp / ".forgewright" / "verify" / "keyless-replay.json"
        replay_path.write_text(json.dumps(replay), encoding="utf-8")

        result = _run_validate(
            self.tmp,
            files_str="purchase.py",
            turn="keyless-replay",
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

    def test_codex_typed_stop_no_code_returns_verified_decision(self):
        """A clean native Stop still exposes its typed completion state."""
        result = self._stop_gate(
            {
                "hook_event_name": "Stop",
                "session_id": "clean-stop-session",
                "turn": "clean-stop-turn",
                "last_assistant_message": "No verification claim is being made.",
            }
        )

        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == {
            "continue": True,
            "forgewright": {
                "schema": "forgewright-stop-decision/v1",
                "host_action": "allow_stop",
                "completion_state": "verified",
                "retry_suppressed": False,
                "reason_code": "no_code_changes",
            },
        }

    def test_codex_custom_manifest_sources_skip_docs_but_keep_code_governed(self):
        """Manifest JSON/YAML/assets are continuity; a code file remains gated."""
        forge = self.tmp / ".forgewright"
        forge.mkdir()
        source = self.tmp / "knowledge"
        source.mkdir()
        (source / "guide.json").write_text('{"title":"Guide"}\n', encoding="utf-8")
        (source / "diagram.svg").write_text("<svg />\n", encoding="utf-8")
        (self.tmp / "docs").mkdir()
        (self.tmp / "docs/project-state.json").write_text(
            json.dumps({"status": {"updated_at": "2026-08-25T00:00:00Z"}}),
            encoding="utf-8",
        )
        (forge / "docs-manifest.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "project": {"id": "fixture", "title": "Fixture"},
                    "sources": [{"path": "knowledge", "type": "documentation"}],
                    "project_docs": {
                        "schema_version": 1,
                        "state": "docs/project-state.json",
                    },
                    "truth": ["docs/project-state.json"],
                    "privacy": {"mode": "allowlist", "allow": ["knowledge", "docs"]},
                }
            ),
            encoding="utf-8",
        )
        env = {
            **os.environ,
            "FORGEWRIGHT_DOCS_CONTINUITY_MODE": "observe",
            "FORGEWRIGHT_STOP_STATE_DIR": str(self.tmp / "stop-state-docs"),
            "FORGEWRIGHT_DOCS_CONTINUITY_STATE_DIR": str(
                self.tmp / "continuity-state-docs"
            ),
        }
        docs_result = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            cwd=self.tmp,
            env=env,
            input=json.dumps(
                {
                    "hook_event_name": "Stop",
                    "session_id": "custom-docs-session",
                    "turn": "custom-docs-turn",
                    "last_assistant_message": "No code changes were made.",
                    "files": ["knowledge/guide.json", "knowledge/diagram.svg"],
                }
            ),
            text=True,
            capture_output=True,
            timeout=30,
        )
        assert docs_result.returncode == 0, docs_result.stderr
        assert json.loads(docs_result.stdout)["continue"] is True
        assert (
            json.loads(docs_result.stdout)["forgewright"]["completion_state"]
            == "unverified"
        )

        code_result = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            cwd=self.tmp,
            env={
                **env,
                "FORGEWRIGHT_STOP_STATE_DIR": str(self.tmp / "stop-state-code"),
            },
            input=json.dumps(
                {
                    "hook_event_name": "Stop",
                    "session_id": "custom-code-session",
                    "turn": "custom-code-turn",
                    "last_assistant_message": "No code changes were made.",
                    "files": ["knowledge/worker.py"],
                }
            ),
            text=True,
            capture_output=True,
            timeout=30,
        )
        assert code_result.returncode == 0, code_result.stderr
        assert json.loads(code_result.stdout)["decision"] == "block"

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
        accepted_payload = json.loads(accepted.stdout)
        assert accepted_payload["continue"] is True
        assert accepted_payload["forgewright"]["completion_state"] == "verified"
        assert accepted_payload["forgewright"]["host_action"] == "allow_stop"

        payload["last_assistant_message"] = response.replace(
            "COMMAND:", "COMMAND: unrelated ", 1
        )
        rejected = self._stop_gate(payload)
        assert rejected.returncode == 0, rejected.stderr
        assert json.loads(rejected.stdout)["decision"] == "block"

    def test_codex_unmapped_platform_turn_field_discovers_correlated_final_evidence(
        self,
    ):
        """Codex may put its routing UUID in `turn`, not only in `turn_id`."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="internal-evidence-for-opaque-turn")
        response = _strict_response(evidence)
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": response,
            "turn": "codex-platform-routing-uuid",
            "session_id": "opaque-turn-session",
            "stop_hook_active": True,
        }

        accepted = self._stop_gate(payload)

        assert accepted.returncode == 0, accepted.stderr
        parsed = json.loads(accepted.stdout)
        assert parsed["continue"] is True
        assert parsed["forgewright"]["completion_state"] == "verified"
        assert parsed["forgewright"]["host_action"] == "allow_stop"

    def test_codex_identical_invalid_stop_reentry_is_bounded(self):
        """The first invalid Stop retries; its identical re-entry must terminate."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="bounded-reentry-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "codex-routing-reentry",
            "session_id": "bounded-reentry-session",
            "stop_hook_active": True,
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}

        first = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )
        second = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )

        first_payload = json.loads(first.stdout)
        second_payload = json.loads(second.stdout)
        assert first_payload["decision"] == "block"
        assert first_payload["forgewright"] == {
            "schema": "forgewright-stop-decision/v1",
            "host_action": "request_retry",
            "completion_state": "unverified",
            "retry_suppressed": False,
            "reason_code": "validation_failed",
        }
        assert second_payload["continue"] is True
        assert second_payload["forgewright"]["host_action"] == "allow_stop"
        assert second_payload["forgewright"]["completion_state"] == "unverified"
        assert second_payload["forgewright"]["retry_suppressed"] is True
        assert second_payload["forgewright"]["reason_code"] == "duplicate_invalid_stop"

    @pytest.mark.skipif(os.name != "nt", reason="native Windows lock backend")
    def test_codex_concurrent_identical_invalid_stop_has_one_retry(self):
        """Concurrent native Stops share one msvcrt-protected retry decision."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="concurrent-stop-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "concurrent-stop-routing",
            "session_id": "concurrent-stop-session",
            "stop_hook_active": True,
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
        processes = [
            subprocess.Popen(
                ["bash", str(STOP_SH), "--platform", "codex"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=str(self.tmp),
                env=env,
            )
            for _ in range(6)
        ]
        results = [
            process.communicate(json.dumps(payload), timeout=60)
            for process in processes
        ]
        assert all(process.returncode == 0 for process in processes), results
        decisions = [json.loads(stdout) for stdout, _stderr in results]
        retries = [item for item in decisions if item.get("decision") == "block"]
        suppressed = [
            item
            for item in decisions
            if item.get("forgewright", {}).get("retry_suppressed") is True
        ]
        assert len(retries) == 1
        assert len(suppressed) == 5
        records = list(state_dir.glob("*.json"))
        assert len(records) == 1
        state = json.loads(records[0].read_text(encoding="utf-8"))
        assert state["attempts"] == 1
        assert len(state["keys"]) == 1

    def test_codex_retry_state_symlink_lock_fails_open_without_external_write(self):
        """An attacker-controlled lock symlink cannot redirect Stop state writes."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="symlink-lock-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "symlink-lock-routing",
            "session_id": "symlink-lock-session",
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        state_dir.mkdir(parents=True)
        outside = Path(tempfile.mkdtemp(prefix="fw_external_stop_state_"))
        try:
            outside_target = outside / "redirected-lock"
            _symlink_or_skip(state_dir / ".lock", outside_target)
            env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
            result = subprocess.run(
                ["bash", str(STOP_SH), "--platform", "codex"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.tmp),
                env=env,
                input=json.dumps(payload),
            )
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["decision"] == "block"
            assert not outside_target.exists()
            assert list(outside.iterdir()) == []
            assert not list(state_dir.glob("*.json"))
        finally:
            shutil.rmtree(outside, ignore_errors=True)

    @pytest.mark.skipif(os.name != "nt", reason="native Windows hardlink semantics")
    def test_codex_retry_state_hardlink_lock_never_writes_outside(self):
        """A lock hardlink fails open without mutating its external inode."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="hardlink-lock-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "hardlink-lock-routing",
            "session_id": "hardlink-lock-session",
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        state_dir.mkdir(parents=True)
        outside = Path(tempfile.mkdtemp(prefix="fw_external_hardlink_state_"))
        try:
            outside_target = outside / "external-lock"
            outside_target.write_bytes(b"")
            os.link(outside_target, state_dir / ".lock")
            env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
            result = subprocess.run(
                ["bash", str(STOP_SH), "--platform", "codex"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.tmp),
                env=env,
                input=json.dumps(payload),
            )
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["decision"] == "block"
            assert outside_target.read_bytes() == b""
            assert not list(state_dir.glob("*.json"))
        finally:
            shutil.rmtree(outside, ignore_errors=True)

    @pytest.mark.skipif(os.name != "nt", reason="native Windows junction semantics")
    def test_codex_retry_state_directory_junction_never_writes_outside(self):
        """A configured state-dir junction cannot redirect Stop state writes."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="junction-state-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "junction-state-routing",
            "session_id": "junction-state-session",
        }
        outside = Path(tempfile.mkdtemp(prefix="fw_external_junction_state_"))
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-junction"
        state_dir.parent.mkdir(parents=True)
        _windows_junction(state_dir, outside)
        try:
            env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
            result = subprocess.run(
                ["bash", str(STOP_SH), "--platform", "codex"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.tmp),
                env=env,
                input=json.dumps(payload),
            )
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["decision"] == "block"
            assert list(outside.iterdir()) == []
        finally:
            state_dir.rmdir()
            shutil.rmtree(outside, ignore_errors=True)

    def test_codex_oversized_retry_state_fails_open_without_rewrite(self):
        """Oversized retry state is rejected before an unbounded read/allocation."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn="oversized-state-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": "oversized-state-routing",
            "session_id": "oversized-state-session",
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
        first = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )
        assert json.loads(first.stdout)["decision"] == "block"
        record = next(state_dir.glob("*.json"))
        oversized = b"{" + (b" " * (64 * 1024 + 1)) + b"}"
        record.write_bytes(oversized)
        second = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )
        assert second.returncode == 0, second.stderr
        assert json.loads(second.stdout)["decision"] == "block"
        assert record.read_bytes() == oversized

    @pytest.mark.parametrize(
        ("platform", "first_returncode"),
        [("claude", 2), ("gemini", 2), ("cursor", 1)],
    )
    def test_non_codex_identical_invalid_stop_reentry_is_bounded(
        self, platform: str, first_returncode: int
    ):
        """Every supported Stop host must share the same bounded retry state."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        evidence = _make_evidence(self.tmp, turn=f"{platform}-bounded-evidence")
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence).replace(
                "COMMAND:", "COMMAND: mismatched ", 1
            ),
            "turn": f"{platform}-routing-reentry",
            "session_id": f"{platform}-bounded-session",
            "stop_hook_active": True,
        }
        state_dir = self.tmp / ".forgewright" / "runtime" / "stop-attempts"
        env = {**os.environ, "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir)}
        command = ["bash", str(STOP_SH), "--platform", platform]

        first = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )
        second = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )

        assert first.returncode == first_returncode
        assert second.returncode == 0
        records = list(state_dir.glob("*.json"))
        assert len(records) == 1
        state = json.loads(records[0].read_text(encoding="utf-8"))
        assert state["attempts"] == 1
        assert len(state["keys"]) == 1

    def test_codex_stop_replays_canonical_evidence_once(self):
        """One Stop invocation must execute the evidence command exactly once."""
        source = self.tmp / "fixture.py"
        source.write_text("print('changed')\n")
        counter_script = self.tmp / "tests" / "replay_counter.py"
        counter_script.write_text(
            "import os\n"
            "from pathlib import Path\n"
            "counter = Path(os.environ['FORGEWRIGHT_TEST_REPLAY_COUNTER'])\n"
            "value = int(counter.read_text()) if counter.exists() else 0\n"
            "counter.write_text(str(value + 1))\n"
            "print('ok')\n",
            encoding="utf-8",
        )
        counter = self.tmp.parent / f"{self.tmp.name}-replay-count"
        counter.unlink(missing_ok=True)
        evidence = _make_evidence(
            self.tmp,
            turn="single-replay-evidence",
            command=[sys.executable, "tests/replay_counter.py"],
            output="ok\n",
            test_refs=["tests/replay_counter.py"],
        )
        payload = {
            "hook_event_name": "Stop",
            "last_assistant_message": _strict_response(evidence),
            "turn": "codex-routing-single-replay",
            "session_id": "single-replay-session",
        }
        env = {
            **os.environ,
            "FORGEWRIGHT_TEST_REPLAY_COUNTER": str(counter),
            "FORGEWRIGHT_STOP_STATE_DIR": str(
                self.tmp / ".forgewright" / "runtime" / "stop-attempts"
            ),
        }

        result = subprocess.run(
            ["bash", str(STOP_SH), "--platform", "codex"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(self.tmp),
            env=env,
            input=json.dumps(payload),
        )

        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["continue"] is True
        assert counter.read_text(encoding="utf-8") == "1"
        counter.unlink(missing_ok=True)

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
            _symlink_or_skip(evidence, external)
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
