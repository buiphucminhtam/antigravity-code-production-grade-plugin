from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / "scripts" / "lite" / "rule-context-hook.py"
SYNC = ROOT / "scripts" / "lite" / "sync-kernel.py"
VALIDATOR = ROOT / "scripts" / "lite" / "rule-validator.py"


def load_hook_module():
    spec = importlib.util.spec_from_file_location("rule_context_hook", HOOK)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def run_hook(
    tmp_path: Path,
    payload: str,
    *,
    platform: str = "CODEX",
    event: str = "SessionStart",
    mode: str = "observe",
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "FORGEWRIGHT_WORKSPACE": str(tmp_path),
            "FORGEWRIGHT_RULE_HOOK_MODE": mode,
        }
    )
    return subprocess.run(
        [
            sys.executable,
            str(HOOK),
            "--platform",
            platform,
            "--event",
            event,
        ],
        cwd=tmp_path,
        env=env,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )


def write_manifest(root: Path, rules: list[dict]) -> Path:
    path = root / "kernel" / "rule-manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "defaults": {"max_context_chars": 1200, "max_rules": 8},
                "rules": rules,
            }
        ),
        encoding="utf-8",
    )
    return path


def active_rule(source: str = "kernel/ENTRY.md", **extra: object) -> dict:
    value = {
        "id": "entry",
        "status": "active",
        "canonical": True,
        "source": source,
        "platforms": ["CODEX", "CLAUDE", "GEMINI", "ANTIGRAVITY", "CURSOR"],
        "events": ["SessionStart", "BeforeAgent", "PreInvocation", "sessionStart"],
    }
    value.update(extra)
    return value


def test_manifest_contains_only_active_canonical_sources() -> None:
    manifest = json.loads((ROOT / "kernel" / "rule-manifest.json").read_text())
    assert manifest["schema_version"] == "1"
    assert manifest["rules"]
    assert all(rule["status"] == "active" for rule in manifest["rules"])
    assert all(rule.get("canonical") is True for rule in manifest["rules"])
    assert all(
        "source" in rule and not rule["source"].startswith("/")
        for rule in manifest["rules"]
    )


def test_live_manifest_selects_all_six_ids_with_inventory_and_fair_excerpts() -> None:
    module = load_hook_module()
    manifest = module.load_manifest(ROOT)
    selected = module.select_rules(manifest, "CODEX", "SessionStart")
    assert [rule["id"] for rule in selected] == [
        "kernel-entry",
        "kernel-solve",
        "kernel-verify",
        "kernel-escalate",
        "kernel-clarify",
        "kernel-policy",
    ]
    result = module.build_context(ROOT, selected, max_chars=2400)
    assert [item["id"] for item in result["inventory"]] == [
        rule["id"] for rule in selected
    ]
    assert all(
        item["source"] and len(item["sha256"]) == 64 for item in result["inventory"]
    )
    assert {item["id"] for item in result["included"]} == {
        rule["id"] for rule in selected
    }
    assert not result["omitted"]
    for item in result["inventory"]:
        assert item["id"] in result["context"]


def test_every_configured_lifecycle_event_selects_all_active_canonical_rules() -> None:
    module = load_hook_module()
    manifest = module.load_manifest(ROOT)
    configured_events = (
        "SessionStart",
        "SessionResume",
        "compact",
        "BeforeAgent",
        "SubagentStart",
        "PreInvocation",
        "sessionStart",
    )
    active = [
        rule
        for rule in manifest["rules"]
        if rule["status"] == "active" and rule["canonical"] is True
    ]
    assert {tuple(rule["events"]) for rule in active} == {configured_events}
    expected = {rule["id"] for rule in active}
    for platform, event in (
        ("CODEX", "SessionStart"),
        ("CODEX", "SubagentStart"),
        ("CLAUDE", "SessionStart"),
        ("CLAUDE", "SubagentStart"),
        ("GEMINI", "BeforeAgent"),
        ("ANTIGRAVITY", "PreInvocation"),
        ("CURSOR", "sessionStart"),
    ):
        selected = module.select_rules(manifest, platform, event)
        assert {rule["id"] for rule in selected} == expected, (platform, event)


def test_context_inventory_is_fair_and_receipt_distinguishes_excerpts(
    tmp_path: Path,
) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    rules = []
    for index in range(3):
        source = f"kernel/RULE-{index}.md"
        (tmp_path / source).write_text(
            f"marker-{index}\n" + ("body\n" * 200), encoding="utf-8"
        )
        rules.append(
            active_rule(
                id=f"rule-{index}",
                source=source,
                events=["SessionStart"],
                priority=index,
            )
        )
    write_manifest(tmp_path, rules)
    manifest = module.load_manifest(tmp_path)
    selected = module.select_rules(manifest, "CODEX", "SessionStart")
    result = module.build_context(tmp_path, selected, max_chars=1400)
    assert all(item["id"] in result["context"] for item in result["inventory"])
    assert all(f"marker-{index}" in result["context"] for index in range(3))
    receipt = module.write_receipt(tmp_path, "CODEX", "SessionStart", result)
    persisted = json.loads(receipt.read_text(encoding="utf-8"))
    assert [item["id"] for item in persisted["selected"]] == [
        "rule-0",
        "rule-1",
        "rule-2",
    ]
    assert [item["id"] for item in persisted["included"]] == [
        "rule-0",
        "rule-1",
        "rule-2",
    ]
    assert persisted["omitted"] == []

    inventory_only = module.build_context(
        tmp_path, selected, max_chars=1400, include_excerpts=False
    )
    assert inventory_only["included"] == []
    assert {item["id"] for item in inventory_only["omitted"]} == {
        "rule-0",
        "rule-1",
        "rule-2",
    }


def test_ids_are_trimmed_before_manifest_uniqueness_check(tmp_path: Path) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text("entry\n", encoding="utf-8")
    write_manifest(tmp_path, [active_rule(id=" rule "), active_rule(id="rule")])
    try:
        module.load_manifest(tmp_path)
    except module.ManifestError as error:
        assert "unique" in str(error)
    else:
        raise AssertionError("expected trimmed duplicate id rejection")


def test_selection_is_deterministic_and_respects_platform_event(tmp_path: Path) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text("entry rule\n", encoding="utf-8")
    (tmp_path / "kernel" / "SOLVE.md").write_text("solve rule\n", encoding="utf-8")
    write_manifest(
        tmp_path,
        [
            active_rule(id="entry", source="kernel/ENTRY.md"),
            active_rule(
                id="solve",
                source="kernel/SOLVE.md",
                events=["SubagentStart"],
            ),
            active_rule(
                id="stale",
                source="kernel/SOLVE.md",
                status="superseded",
                events=["SessionStart"],
            ),
        ],
    )
    loaded = module.load_manifest(tmp_path)
    selected = module.select_rules(loaded, "codex", "SessionStart")
    assert [rule["id"] for rule in selected] == ["entry"]
    assert module.select_rules(loaded, "CODEX", "SubagentStart")[0]["id"] == "solve"


def test_manifest_rejects_path_traversal_and_symlink_escape(tmp_path: Path) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    outside = tmp_path.parent / f"{tmp_path.name}-outside.md"
    outside.write_text("outside\n", encoding="utf-8")
    (tmp_path / "kernel" / "link.md").symlink_to(outside)
    for source in ("../outside.md", "kernel/../outside.md", "kernel/link.md"):
        write_manifest(tmp_path, [active_rule(source=source)])
        try:
            module.load_manifest(tmp_path)
        except module.ManifestError:
            pass
        else:
            raise AssertionError(f"expected manifest rejection for {source}")


def test_invalid_explicit_workspace_fails_open_empty(tmp_path: Path) -> None:
    invalid = tmp_path / "does-not-exist"
    result = run_hook(tmp_path, "{}")
    assert result.returncode == 0
    assert json.loads(result.stdout).get("continue") is True

    env = os.environ.copy()
    env.update(
        {
            "FORGEWRIGHT_WORKSPACE": str(invalid),
            "FORGEWRIGHT_RULE_HOOK_MODE": "observe",
        }
    )
    result = subprocess.run(
        [sys.executable, str(HOOK), "--platform", "CODEX", "--event", "SessionStart"],
        cwd=tmp_path,
        env=env,
        input="{}",
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload == {"continue": True}


def test_receipt_dir_symlink_is_rejected_before_write(tmp_path: Path) -> None:
    module = load_hook_module()
    outside = tmp_path.parent / f"{tmp_path.name}-receipt-outside"
    outside.mkdir()
    (tmp_path / ".forgewright").symlink_to(outside, target_is_directory=True)
    try:
        module.write_receipt(
            tmp_path,
            "CODEX",
            "SessionStart",
            {"context": "inventory", "rules": []},
        )
    except module.ManifestError:
        pass
    else:
        raise AssertionError("expected receipt directory symlink rejection")
    assert not list(outside.iterdir())

    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text("visible context\n", encoding="utf-8")
    write_manifest(tmp_path, [active_rule()])
    result = run_hook(tmp_path, "{}")
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["continue"] is True
    assert "visible context" in payload["hookSpecificOutput"]["additionalContext"]
    assert not list(outside.iterdir())


def test_receipt_nested_symlink_is_rejected_without_writing_outside(
    tmp_path: Path,
) -> None:
    module = load_hook_module()
    outside = tmp_path.parent / f"{tmp_path.name}-nested-receipt-outside"
    outside.mkdir()
    (tmp_path / ".forgewright" / "runtime").mkdir(parents=True)
    (tmp_path / ".forgewright" / "runtime" / "rule-context").symlink_to(
        outside, target_is_directory=True
    )
    try:
        module.write_receipt(
            tmp_path,
            "CODEX",
            "SessionStart",
            {"context": "inventory", "rules": []},
        )
    except module.ManifestError:
        pass
    else:
        raise AssertionError("expected nested receipt symlink rejection")
    assert not list(outside.iterdir())


def test_receipt_dir_race_after_mkdir_does_not_follow_symlink(
    tmp_path: Path, monkeypatch
) -> None:
    module = load_hook_module()
    outside = tmp_path.parent / f"{tmp_path.name}-raced-receipt-outside"
    outside.mkdir()
    real_mkdir = module.os.mkdir
    raced = False

    def racing_mkdir(path, *args, **kwargs):
        nonlocal raced
        result = real_mkdir(path, *args, **kwargs)
        if path == ".forgewright" and not raced:
            raced = True
            component = tmp_path / ".forgewright"
            component.rmdir()
            component.symlink_to(outside, target_is_directory=True)
        return result

    monkeypatch.setattr(module.os, "mkdir", racing_mkdir)
    monkeypatch.setattr(module, "_supports_secure_receipt_dir", lambda: True)
    try:
        module.write_receipt(
            tmp_path,
            "CODEX",
            "SessionStart",
            {"context": "inventory", "rules": []},
        )
    except module.ManifestError:
        pass
    else:
        raise AssertionError("expected raced receipt symlink rejection")
    assert raced
    assert not list(outside.iterdir())


def test_secure_receipt_directory_closes_every_opened_descriptor(
    tmp_path: Path, monkeypatch
) -> None:
    module = load_hook_module()
    real_open = module._open_directory_at
    real_close = module.os.close
    opened: list[int] = []
    closed: list[int] = []

    def tracked_open(path, parent_fd=None):
        descriptor = real_open(path, parent_fd)
        opened.append(descriptor)
        return descriptor

    def tracked_close(descriptor):
        closed.append(descriptor)
        return real_close(descriptor)

    monkeypatch.setattr(module, "_open_directory_at", tracked_open)
    monkeypatch.setattr(module.os, "close", tracked_close)
    monkeypatch.setattr(module, "_supports_secure_receipt_dir", lambda: True)
    receipt_fd, _ = module._open_receipt_dir(tmp_path)
    module.os.close(receipt_fd)
    assert sorted(opened) == sorted(closed)


@pytest.mark.parametrize("secure", [False, True])
def test_receipt_temp_descriptor_closes_when_fdopen_fails(
    tmp_path: Path, monkeypatch, secure: bool
) -> None:
    module = load_hook_module()
    captured: dict[str, int] = {}
    monkeypatch.setattr(module, "_supports_secure_receipt_dir", lambda: secure)
    if secure:
        real_open_temp = module._open_receipt_temp

        def tracked_open_temp(directory_fd, target_name):
            descriptor, temporary = real_open_temp(directory_fd, target_name)
            captured["fd"] = descriptor
            return descriptor, temporary

        monkeypatch.setattr(module, "_open_receipt_temp", tracked_open_temp)
    else:
        real_mkstemp = module.tempfile.mkstemp

        def tracked_mkstemp(*args, **kwargs):
            descriptor, temporary = real_mkstemp(*args, **kwargs)
            captured["fd"] = descriptor
            return descriptor, temporary

        monkeypatch.setattr(module.tempfile, "mkstemp", tracked_mkstemp)

    def fail_fdopen(*_args, **_kwargs):
        raise RuntimeError("fault-injected fdopen failure")

    monkeypatch.setattr(module.os, "fdopen", fail_fdopen)
    with pytest.raises(RuntimeError, match="fault-injected"):
        module.write_receipt(
            tmp_path,
            "CODEX",
            "SessionStart",
            {"context": "inventory", "rules": []},
        )
    descriptor = captured["fd"]
    with pytest.raises(OSError):
        os.fstat(descriptor)


def test_oversized_manifest_and_source_fail_open(tmp_path: Path) -> None:
    (tmp_path / "kernel").mkdir()
    source = tmp_path / "kernel" / "ENTRY.md"
    source.write_text("x" * (load_hook_module().MAX_SOURCE_BYTES + 1), encoding="utf-8")
    write_manifest(tmp_path, [active_rule()])
    result = run_hook(tmp_path, "{}")
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"continue": True}

    (tmp_path / "kernel" / "rule-manifest.json").write_text(
        "{" + ('"padding":"x", ' * 40000) + '"rules":[]}', encoding="utf-8"
    )
    result = run_hook(tmp_path, "{}")
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"continue": True}


def test_context_hashes_are_deterministic_and_receipt_has_no_source_content(
    tmp_path: Path,
) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    content = "# Secret-looking rule body\nDo the safe thing.\n"
    (tmp_path / "kernel" / "ENTRY.md").write_text(content, encoding="utf-8")
    write_manifest(tmp_path, [active_rule()])
    loaded = module.load_manifest(tmp_path)
    selected = module.select_rules(loaded, "CODEX", "SessionStart")
    first = module.build_context(tmp_path, selected, max_chars=1200)
    second = module.build_context(tmp_path, selected, max_chars=1200)
    assert first["context"] == second["context"]
    expected = hashlib.sha256(content.encode()).hexdigest()
    assert first["rules"][0]["sha256"] == expected
    receipt = module.write_receipt(tmp_path, "CODEX", "SessionStart", first)
    assert receipt.is_relative_to(tmp_path / ".forgewright" / "runtime")
    persisted = json.loads(receipt.read_text(encoding="utf-8"))
    assert content not in json.dumps(persisted)
    assert persisted["rules"][0]["sha256"] == expected


def test_hook_is_fail_open_for_malformed_input_and_unknown_manifest(
    tmp_path: Path,
) -> None:
    result = run_hook(tmp_path, "not-json")
    assert result.returncode == 0
    response = json.loads(result.stdout)
    assert response.get("continue") is True
    assert "additionalContext" not in json.dumps(response)

    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "rule-manifest.json").write_text("{bad", encoding="utf-8")
    result = run_hook(tmp_path, "{}")
    assert result.returncode == 0
    assert json.loads(result.stdout).get("continue") is True


def test_hook_outputs_platform_native_shape_and_bounded_context(tmp_path: Path) -> None:
    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text("x" * 5000, encoding="utf-8")
    write_manifest(tmp_path, [active_rule()])
    for platform in ("CODEX", "CLAUDE", "GEMINI", "ANTIGRAVITY", "CURSOR"):
        result = run_hook(tmp_path, "{}", platform=platform)
        assert result.returncode == 0, result.stderr
        response = json.loads(result.stdout)
        assert response.get("continue") is True
        serialized = json.dumps(response)
        assert len(serialized) <= 7000
        assert "x" * 5000 not in serialized
        if platform not in {"ANTIGRAVITY", "CURSOR"}:
            assert "SessionStart" in serialized


def test_hook_serialized_output_bound_counts_unicode_escaping(tmp_path: Path) -> None:
    module = load_hook_module()
    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text("世界" * 5000, encoding="utf-8")
    write_manifest(tmp_path, [active_rule()])
    for platform in ("CODEX", "CLAUDE", "GEMINI", "ANTIGRAVITY", "CURSOR"):
        result = run_hook(tmp_path, "{}", platform=platform)
        assert result.returncode == 0, result.stderr
        assert len(result.stdout.encode("utf-8")) <= module.MAX_SERIALIZED_OUTPUT_BYTES
        response = json.loads(result.stdout)
        assert response["continue"] is True
        assert "decision" not in response
        assert "entry" in result.stdout
        assert "kernel/ENTRY.md" in result.stdout


def test_enforce_is_advisory_and_antigravity_preinvocation_is_compact(
    tmp_path: Path,
) -> None:
    (tmp_path / "kernel").mkdir()
    (tmp_path / "kernel" / "ENTRY.md").write_text(
        "long-rule\n" * 1000, encoding="utf-8"
    )
    write_manifest(tmp_path, [active_rule(events=["PreInvocation"])])
    result = run_hook(
        tmp_path,
        json.dumps({"invocationNum": 7}),
        platform="ANTIGRAVITY",
        event="PreInvocation",
        mode="enforce",
    )
    assert result.returncode == 0
    response = json.loads(result.stdout)
    assert response["continue"] is True
    assert "decision" not in response
    assert len(result.stdout) < 2200
    assert "long-rule" not in response["injectSteps"][0]["ephemeralMessage"]


def test_sync_check_does_not_write_and_detects_drift(tmp_path: Path) -> None:
    target = tmp_path / "AGENTS.md"
    target.write_text("drift\n", encoding="utf-8")
    assert target.read_text(encoding="utf-8") == "drift\n"

    # Exercise the drift branch against a copied fixture tree so no generated
    # instruction file in the real workspace can be changed by this test.
    spec = importlib.util.spec_from_file_location("sync_kernel", SYNC)
    assert spec and spec.loader
    sync_module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = sync_module
    spec.loader.exec_module(sync_module)
    assert "POLICY.md" in sync_module.LITE_FILES
    fixture = tmp_path / "fixture"
    (fixture / "kernel").mkdir(parents=True)
    for name in sync_module.LITE_FILES:
        shutil.copy2(ROOT / "kernel" / name, fixture / "kernel" / name)
    sync_module.PROJECT_ROOT = str(fixture)
    sync_module.KERNEL_DIR = str(fixture / "kernel")
    assert sync_module.sync() == 0
    generated = fixture / "AGENTS.md"
    generated.write_text(
        generated.read_text(encoding="utf-8") + "drift\n", encoding="utf-8"
    )
    changed = generated.read_bytes()
    assert sync_module.sync(check=True) == 1
    assert generated.read_bytes() == changed


def test_static_validator_checks_rule_manifest() -> None:
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--static"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
