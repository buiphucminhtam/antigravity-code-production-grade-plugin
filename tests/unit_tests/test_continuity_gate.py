"""Focused, fail-open coverage for Docs Hub continuity at Stop."""

from __future__ import annotations

import json
import hashlib
import os
import subprocess
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
STOP = ROOT / "scripts/lite/stop-gate.sh"


def _git_workspace(path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "tests@example.com"], cwd=path, check=True
    )
    subprocess.run(["git", "config", "user.name", "Tests"], cwd=path, check=True)
    (path / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=path, check=True)


def _docs_contract(
    path: Path, *, receipt: bool = True, mixed_case: bool = False
) -> None:
    (path / ".forgewright").mkdir(parents=True, exist_ok=True)
    (path / "docs").mkdir(exist_ok=True)
    (path / "docs/guide.md").write_text("# Guide\n", encoding="utf-8")
    (path / "docs/project-state.json").write_text(
        json.dumps({"status": {"updated_at": "2026-08-25T00:00:00Z"}}),
        encoding="utf-8",
    )
    (path / ".forgewright/docs-manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project": {"id": "fixture", "title": "Fixture"},
                "sources": [{"path": "docs", "type": "documentation"}],
                "project_docs": {
                    "schema_version": 1,
                    "state": "docs/project-state.json",
                },
                "truth": ["docs/project-state.json"],
            }
        ),
        encoding="utf-8",
    )
    if receipt:
        state_hash = hashlib.sha256(
            (path / "docs/project-state.json").read_bytes()
        ).hexdigest()
        guide_hash = hashlib.sha256((path / "docs/guide.md").read_bytes()).hexdigest()
        documents = [{"sourcePath": "docs/guide.md", "contentHash": guide_hash}]
        canonical_documents = [["docs/guide.md", guide_hash]]
        if mixed_case:
            mixed_case_documents = (
                ("docs/Z.md", "# Upper\n"),
                ("docs/a.md", "# Lower\n"),
            )
            mixed_case_hashes = {}
            for source_path, contents in mixed_case_documents:
                mixed_case_path = path / source_path
                mixed_case_path.write_text(contents, encoding="utf-8")
                mixed_case_hashes[source_path] = hashlib.sha256(
                    mixed_case_path.read_bytes()
                ).hexdigest()
                documents.append(
                    {
                        "sourcePath": source_path,
                        "contentHash": mixed_case_hashes[source_path],
                    }
                )
            # This is the ordering produced by the TypeScript scanner's
            # default-locale localeCompare (lowercase before uppercase).
            canonical_documents = [
                ["docs/a.md", mixed_case_hashes["docs/a.md"]],
                ["docs/guide.md", guide_hash],
                ["docs/Z.md", mixed_case_hashes["docs/Z.md"]],
            ]
        commit_result = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=path, capture_output=True, text=True
        )
        commit = commit_result.stdout.strip() if commit_result.returncode == 0 else None
        catalog = {
            "schema_version": 1,
            "project": {
                "id": "fixture",
                "title": "Fixture",
                "root": str(path.resolve()),
                "statePath": "docs/project-state.json",
                "stateHash": state_hash,
                "truthDocuments": ["docs/project-state.json"],
                "facts": {
                    "git": {"commit": commit},
                    "gitnexus": {"indexedCommit": None},
                },
            },
            "documents": documents,
            "assets": [],
        }
        canonical = {
            "manifest": ".forgewright/docs-manifest.json",
            "project": {
                "id": "fixture",
                "title": "Fixture",
                "truth": ["docs/project-state.json"],
            },
            "documents": canonical_documents,
            "assets": [],
            "git": commit,
            "gitnexus": None,
            "projectState": {"path": "docs/project-state.json", "hash": state_hash},
        }
        fingerprint = hashlib.sha256(
            json.dumps(canonical, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
        catalog["sourceFingerprint"] = fingerprint
        cache = path / ".forgewright/cache"
        cache.mkdir(parents=True, exist_ok=True)
        (cache / "docs-index.json").write_text(json.dumps(catalog), encoding="utf-8")
        site = path / ".forgewright/docs-hub/site"
        site.mkdir(parents=True)
        (site / ".forgewright-docs-hub").write_text(
            json.dumps(
                {
                    "schema": "forgewright-docs-hub",
                    "schema_version": 1,
                    "source_fingerprints": [
                        {"project_id": "fixture", "fingerprint": fingerprint}
                    ],
                }
            ),
            encoding="utf-8",
        )


def _run_stop(
    path: Path,
    payload: object,
    *,
    mode: str = "observe",
    state_dir: Path | None = None,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "FORGEWRIGHT_DOCS_CONTINUITY_MODE": mode,
            "FORGEWRIGHT_STOP_STATE_DIR": str(state_dir or path / ".stop-state"),
            "FORGEWRIGHT_DOCS_CONTINUITY_STATE_DIR": str(
                state_dir or path / ".stop-state"
            ),
        }
    )
    if extra_env:
        env.update(extra_env)
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run(
        ["bash", str(STOP), "--platform", "CODEX"],
        cwd=path,
        env=env,
        input=raw,
        text=True,
        capture_output=True,
        timeout=10,
    )


def _docs_payload(path: Path) -> dict[str, object]:
    return {
        "session_id": "continuity-session",
        "turn": "continuity-turn",
        "last_assistant_message": "No code changes were made.",
        "files": ["docs/guide.md"],
        "cwd": str(path),
    }


def _refresh_fixture_fingerprint(path: Path) -> None:
    """Recompute the scanner-compatible fingerprint after catalog mutation."""

    catalog_path = path / ".forgewright/cache/docs-index.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    project = catalog["project"]
    documents = sorted(
        [[item["sourcePath"], item["contentHash"]] for item in catalog["documents"]],
        key=lambda item: item[0],
    )
    assets = sorted(
        [[item["sourcePath"], item["contentHash"]] for item in catalog["assets"]],
        key=lambda item: item[0],
    )
    canonical = {
        "manifest": ".forgewright/docs-manifest.json",
        "project": {
            "id": project["id"],
            "title": project["title"],
            "truth": project["truthDocuments"],
        },
        "documents": documents,
        "assets": assets,
        "git": project["facts"]["git"]["commit"],
        "gitnexus": project["facts"]["gitnexus"]["indexedCommit"],
        "projectState": {
            "path": project["statePath"],
            "hash": project["stateHash"],
        },
    }
    fingerprint = hashlib.sha256(
        json.dumps(canonical, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    catalog["sourceFingerprint"] = fingerprint
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    marker = path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    marker.write_text(
        json.dumps(
            {
                "schema": "forgewright-docs-hub",
                "schema_version": 1,
                "source_fingerprints": [
                    {"project_id": project["id"], "fingerprint": fingerprint}
                ],
            }
        ),
        encoding="utf-8",
    )


def test_malformed_payload_is_fail_open(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    result = _run_stop(tmp_path, "not-json", mode="enforce")
    assert result.returncode == 0
    assert json.loads(result.stdout)["continue"] is True


@pytest.mark.parametrize("case", ["manifest", "receipt", "cli", "git"])
def test_missing_continuity_infrastructure_allows_stop(
    tmp_path: Path, case: str
) -> None:
    if case != "git":
        _git_workspace(tmp_path)
    if case == "manifest":
        (tmp_path / "docs").mkdir()
        (tmp_path / "docs/guide.md").write_text("# Guide\n", encoding="utf-8")
    elif case == "receipt":
        _docs_contract(tmp_path, receipt=False)
    elif case == "cli":
        _docs_contract(tmp_path)
    elif case == "git":
        _docs_contract(tmp_path)
    extra = {"FORGEWRIGHT_DOCS_CLI": str(tmp_path / "missing-forge")}
    result = _run_stop(
        tmp_path,
        _docs_payload(tmp_path),
        mode="enforce",
        extra_env=extra if case == "cli" else None,
    )
    assert result.returncode == 0
    parsed = json.loads(result.stdout)
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"
    assert "UNVERIFIED" in result.stderr


def test_observe_missing_receipt_allows_without_retry(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=False)
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    result = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="observe", state_dir=state_dir
    )
    assert result.returncode == 0
    assert json.loads(result.stdout)["continue"] is True
    assert not list(state_dir.glob("*.json"))
    assert "UNVERIFIED" in result.stderr


def test_valid_persistent_receipt_allows_verified_stop(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=True)
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    assert result.returncode == 0
    parsed = json.loads(result.stdout)
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "verified"
    assert "UNVERIFIED" not in result.stderr


def test_custom_manifest_sources_classify_docs_but_not_code(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=False)
    source = tmp_path / "reference"
    source.mkdir()
    for relative, content in (
        ("guide.json", '{"title":"Guide"}\n'),
        ("config.yaml", "title: Guide\n"),
        ("diagram.svg", "<svg />\n"),
    ):
        (source / relative).write_text(content, encoding="utf-8")
    manifest_path = tmp_path / ".forgewright/docs-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"] = [{"path": "reference", "type": "documentation"}]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    for relative in (
        "reference/guide.json",
        "reference/config.yaml",
        "reference/diagram.svg",
    ):
        result = _run_stop(
            tmp_path,
            {**_docs_payload(tmp_path), "files": [relative]},
            mode="observe",
        )
        parsed = json.loads(result.stdout)
        assert result.returncode == 0
        assert parsed["continue"] is True
        assert parsed["forgewright"]["completion_state"] == "unverified"

    code = source / "worker.py"
    code.write_text("print('changed')\n", encoding="utf-8")
    result = _run_stop(
        tmp_path,
        {**_docs_payload(tmp_path), "files": ["reference/worker.py"]},
        mode="observe",
    )
    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "block"


@pytest.mark.parametrize("source_path", ["/etc/passwd", "../outside.md"])
def test_catalog_unsafe_source_path_is_never_verified(
    tmp_path: Path, source_path: str
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    catalog = json.loads(
        (tmp_path / ".forgewright/cache/docs-index.json").read_text(encoding="utf-8")
    )
    catalog["documents"].append(
        {
            "sourcePath": source_path,
            "contentHash": catalog["documents"][0]["contentHash"],
        }
    )
    (tmp_path / ".forgewright/cache/docs-index.json").write_text(
        json.dumps(catalog), encoding="utf-8"
    )
    _refresh_fixture_fingerprint(tmp_path)
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"


def test_catalog_symlink_source_path_is_never_verified(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    outside = tmp_path / "outside.md"
    outside.write_text("outside\n", encoding="utf-8")
    linked = tmp_path / "docs/escape.md"
    linked.symlink_to(outside)
    catalog = json.loads(
        (tmp_path / ".forgewright/cache/docs-index.json").read_text(encoding="utf-8")
    )
    catalog["documents"].append(
        {
            "sourcePath": "docs/escape.md",
            "contentHash": catalog["documents"][0]["contentHash"],
        }
    )
    (tmp_path / ".forgewright/cache/docs-index.json").write_text(
        json.dumps(catalog), encoding="utf-8"
    )
    _refresh_fixture_fingerprint(tmp_path)
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"


def test_manifest_source_change_is_stale_even_with_newer_cache_and_receipt(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    (tmp_path / "reference").mkdir()
    (tmp_path / "reference/guide.md").write_text("# Guide\n", encoding="utf-8")
    manifest_path = tmp_path / ".forgewright/docs-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"] = [{"path": "reference", "type": "documentation"}]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    future = time.time() + 120
    for relative in (
        ".forgewright/cache/docs-index.json",
        ".forgewright/docs-hub/site/.forgewright-docs-hub",
    ):
        os.utime(tmp_path / relative, (future, future))
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    payload = {
        **_docs_payload(tmp_path),
        "files": [".forgewright/docs-manifest.json"],
    }
    first = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    second = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    assert json.loads(first.stdout)["forgewright"]["reason_code"] == (
        "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["forgewright"]["completion_state"] == "unverified"


def test_manifest_privacy_exclude_change_is_stale_even_with_newer_receipt(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    manifest_path = tmp_path / ".forgewright/docs-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["privacy"] = {
        "mode": "allowlist",
        "allow": ["docs"],
        "exclude": ["docs/guide.md"],
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    future = time.time() + 120
    for relative in (
        ".forgewright/cache/docs-index.json",
        ".forgewright/docs-hub/site/.forgewright-docs-hub",
    ):
        os.utime(tmp_path / relative, (future, future))
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-privacy"
    payload = {
        **_docs_payload(tmp_path),
        "files": [".forgewright/docs-manifest.json"],
    }
    first = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    second = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    assert json.loads(first.stdout)["forgewright"]["reason_code"] == (
        "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["forgewright"]["completion_state"] == "unverified"


def test_manifest_source_include_change_is_stale_even_with_newer_receipt(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    manifest_path = tmp_path / ".forgewright/docs-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sources"] = [
        {
            "path": "docs",
            "type": "documentation",
            "include": ["**/*.json"],
        }
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    future = time.time() + 120
    for relative in (
        ".forgewright/cache/docs-index.json",
        ".forgewright/docs-hub/site/.forgewright-docs-hub",
    ):
        os.utime(tmp_path / relative, (future, future))
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-include"
    payload = {
        **_docs_payload(tmp_path),
        "files": [".forgewright/docs-manifest.json"],
    }
    first = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    second = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    assert json.loads(first.stdout)["forgewright"]["reason_code"] == (
        "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["forgewright"]["completion_state"] == "unverified"


def test_real_mixed_case_source_fingerprint_matches_scanner_locale_order(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=True, mixed_case=True)
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "verified"
    assert "UNVERIFIED" not in result.stderr


def test_payload_without_files_still_detects_git_docs_change(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=True)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    os.utime(marker, (1, 1))
    payload = _docs_payload(tmp_path)
    payload.pop("files")
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    first = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    second = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    assert (
        json.loads(first.stdout)["forgewright"]["reason_code"]
        == "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["forgewright"]["completion_state"] == "unverified"


def test_mixed_code_and_docs_still_has_bounded_continuity_retry(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=True)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    os.utime(marker, (1, 1))
    source = tmp_path / "src/app.py"
    source.parent.mkdir()
    source.write_text("print('fixture')\n", encoding="utf-8")
    payload = _docs_payload(tmp_path)
    payload["files"] = ["docs/guide.md", "src/app.py"]
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    first = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    second = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    third = _run_stop(tmp_path, payload, mode="enforce", state_dir=state_dir)
    assert (
        json.loads(first.stdout)["forgewright"]["reason_code"]
        == "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["decision"] == "block"
    assert json.loads(third.stdout)["continue"] is True


def test_enforce_stale_receipt_requests_one_retry_then_allows(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path, receipt=True)
    os.utime(tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub", (1, 1))
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    first = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    second = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    third = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )

    first_json = json.loads(first.stdout)
    second_json = json.loads(second.stdout)
    third_json = json.loads(third.stdout)
    assert first.returncode == 0
    assert first_json["decision"] == "block"
    assert first_json["forgewright"]["reason_code"] == "docs_continuity_retry"
    assert second_json["continue"] is True
    assert second_json["forgewright"]["completion_state"] == "unverified"
    assert second_json["forgewright"]["retry_suppressed"] is True
    assert "UNVERIFIED" in second.stderr
    assert third_json == second_json
    assert len(list(state_dir.glob("*.json"))) == 1


def test_stale_receipt_is_bounded_and_never_builds(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    os.utime(marker, (1, 1))
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    assert result.returncode == 0
    assert json.loads(result.stdout)["decision"] == "block"
    assert "refresh" in json.loads(result.stdout)["reason"]
    assert marker.stat().st_mtime == 1


def test_oversized_receipt_is_bounded_and_fail_open(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    marker.write_bytes(b"{" + b'"padding":"' + (b"x" * (256 * 1024)) + b'"}')
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    result = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"
    assert not list(state_dir.glob("*.json"))


def test_oversized_material_is_never_verified_or_hashed_unbounded(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    subprocess.run(
        ["git", "add", ".forgewright/docs-manifest.json", "docs"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(["git", "commit", "-qm", "docs contract"], cwd=tmp_path, check=True)
    (tmp_path / "docs/guide.md").write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    result = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["forgewright"]["completion_state"] == "unverified"
    assert not list(state_dir.glob("*.json"))


def test_nested_or_fake_source_fingerprint_is_rejected(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    marker.write_text(
        json.dumps(
            {
                "schema": "forgewright-docs-hub",
                "schema_version": 1,
                "source_fingerprints": [
                    {"project_id": "fixture", "fingerprint": {"value": "a" * 64}}
                ],
            }
        ),
        encoding="utf-8",
    )
    result = _run_stop(tmp_path, _docs_payload(tmp_path), mode="enforce")
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"


def test_copied_old_fingerprint_is_stale_and_gets_one_retry(tmp_path: Path) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    (tmp_path / "docs/guide.md").write_text("# Changed\n", encoding="utf-8")
    state_dir = tmp_path / ".forgewright/runtime/docs-continuity-test"
    first = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    second = _run_stop(
        tmp_path, _docs_payload(tmp_path), mode="enforce", state_dir=state_dir
    )
    assert (
        json.loads(first.stdout)["forgewright"]["reason_code"]
        == "docs_continuity_retry"
    )
    assert json.loads(second.stdout)["forgewright"]["retry_suppressed"] is True


def test_symlinked_retry_state_fails_open_without_writing_outside(
    tmp_path: Path,
) -> None:
    _git_workspace(tmp_path)
    _docs_contract(tmp_path)
    subprocess.run(
        ["git", "add", ".forgewright/docs-manifest.json", "docs"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(["git", "commit", "-qm", "docs contract"], cwd=tmp_path, check=True)
    marker = tmp_path / ".forgewright/docs-hub/site/.forgewright-docs-hub"
    os.utime(marker, (1, 1))
    outside = tmp_path / "outside-state"
    outside.mkdir()
    state_link = tmp_path / ".forgewright/runtime/state-link"
    state_link.parent.mkdir(parents=True, exist_ok=True)
    state_link.symlink_to(outside, target_is_directory=True)
    result = _run_stop(
        tmp_path,
        _docs_payload(tmp_path),
        mode="enforce",
        state_dir=state_link,
        extra_env={"FORGEWRIGHT_STOP_STATE_DIR": str(tmp_path / "safe-stop-state")},
    )
    parsed = json.loads(result.stdout)
    assert result.returncode == 0
    assert parsed["continue"] is True
    assert parsed["forgewright"]["completion_state"] == "unverified"
    assert list(outside.iterdir()) == []
