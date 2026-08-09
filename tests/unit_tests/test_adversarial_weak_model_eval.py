import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "evals" / "adversarial-weak-model" / "run-evals.py"
SUITE = ROOT / "evals" / "adversarial-weak-model" / "suite.json"


def _module():
    spec = importlib.util.spec_from_file_location("adversarial_weak_model_eval", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_suite_schema_and_unique_failure_classes():
    module = _module()
    suite = module.load_suite(SUITE)
    assert len(suite["tasks"]) >= 8
    ids = [task["id"] for task in suite["tasks"]]
    assert len(ids) == len(set(ids))
    categories = {task["category"] for task in suite["tasks"]}
    assert {
        "grounding",
        "proportionality",
        "coordination",
        "self-mutation",
        "evidence",
        "provider-neutrality",
        "scope",
    } <= categories


def test_all_compliant_replays_pass():
    module = _module()
    report = module.run_suite(
        module.load_suite(SUITE), mode="replay", replay_kind="good"
    )
    assert report["empirical"] is False
    assert report["summary"]["passedTasks"] == report["summary"]["totalTasks"]


def test_all_adversarial_replays_are_rejected():
    module = _module()
    report = module.run_suite(
        module.load_suite(SUITE), mode="replay", replay_kind="bad"
    )
    assert report["summary"]["passedTasks"] == 0
    assert all(
        any(not assertion["passed"] for assertion in result["assertions"])
        for result in report["results"]
    )


def test_replay_report_is_never_empirical_model_evidence():
    module = _module()
    report = module.run_suite(
        module.load_suite(SUITE),
        mode="replay",
        replay_kind="good",
        task_id="status-no-fake-success",
    )
    errors = module.validate_live_report(report)
    assert errors
    assert "only live reports are empirical model evidence" in errors


def test_live_report_requires_provider_model_snapshot_and_suite_fingerprint():
    module = _module()
    report = {
        "schemaVersion": module.REPORT_SCHEMA_VERSION,
        "mode": "live",
        "empirical": True,
        "comparisonMetadata": {
            "provider": "test-provider",
            "modelId": "weak-model",
            "modelSnapshot": "weak-model-2026-08-08",
            "snapshotScope": "provider-resolved",
            "adapter": "agy",
            "suiteFingerprint": "abc123",
            "contractFingerprint": "contract123",
            "harnessFingerprint": "harness123",
            "taskIds": ["one"],
        },
        "suiteFingerprint": "abc123",
        "contractFingerprint": "contract123",
        "harnessFingerprint": "harness123",
    }
    assert module.validate_live_report(report) == []
    report["comparisonMetadata"]["modelSnapshot"] = ""
    assert (
        "comparisonMetadata.modelSnapshot must be non-empty"
        in module.validate_live_report(report)
    )


def test_agy_adapter_is_sandboxed_bounded_and_non_dangerous():
    module = _module()
    task = module.load_suite(SUITE)["tasks"][0]
    argv = module._agy_argv(task, "Weak Model", "project-123")
    assert argv[:5] == ["agy", "--project", "project-123", "--model", "Weak Model"]
    assert ["--sandbox", "--mode", "accept-edits"] == argv[5:8]
    assert "--disable-slash-commands" in argv
    assert "--print-timeout" in argv
    assert "--dangerously-skip-permissions" not in argv
    prompt = argv[argv.index("--print") + 1]
    assert "built-in file/read/search tools" in prompt
    assert "Shell/command permission is intentionally limited" in prompt
    assert "--model" not in prompt


def test_agy_permissions_are_fixture_read_only_plus_exact_write_and_verifier(tmp_path):
    module = _module()
    suite = module.load_suite(SUITE)
    task = next(
        task for task in suite["tasks"] if task["id"] == "stale-doc-runtime-truth"
    )
    workspace = tmp_path.resolve()
    (workspace / "app-config.json").write_text('{"port": 8080}\n')
    (workspace / "config_loader.py").write_text("pass\n")
    (workspace / ".git").mkdir()
    (workspace / ".git" / "config").write_text("secret-ish git metadata\n")
    rules = module._agy_permission_rules(task, workspace)
    assert f"read_file({workspace / 'app-config.json'})" in rules
    assert f"read_file({workspace / 'config_loader.py'})" in rules
    assert not any("/.git/" in rule for rule in rules)
    assert f"write_file({workspace / 'app-config.json'})" in rules
    assert "command(python3 verify.py)" in rules
    assert all("legacy-config.json" not in rule for rule in rules)
    assert not any("**" in rule or "*" in rule for rule in rules)


def test_harness_fingerprint_is_semantic_and_stable_shape():
    module = _module()
    assert module.LIVE_HARNESS_SEMANTICS_VERSION == "agy-isolated-least-privilege-v2"
    fingerprint = module._harness_fingerprint()
    assert len(fingerprint) == 64
    assert fingerprint == module._harness_fingerprint()


def test_harness_fingerprint_tracks_orchestrator_bytes(monkeypatch, tmp_path):
    module = _module()
    orchestrator = tmp_path / "orchestrator.py"
    orchestrator.write_text("print('one')\n", encoding="utf-8")
    monkeypatch.setattr(module, "ORCHESTRATOR", orchestrator)
    first = module._harness_fingerprint()
    orchestrator.write_text("print('two')\n", encoding="utf-8")
    assert module._harness_fingerprint() != first


def test_suite_fingerprint_includes_fixture_bytes():
    module = _module()
    suite = module.load_suite(SUITE)
    fingerprint = module._suite_fingerprint(suite)
    changed = {**suite, "description": suite["description"] + " changed"}
    assert len(fingerprint) == 64
    assert module._suite_fingerprint(changed) != fingerprint


def test_auto_adapter_uses_agy_only_for_agy_provider(monkeypatch):
    module = _module()
    monkeypatch.setenv("FORGEWRIGHT_PROVIDER", "agy")
    monkeypatch.setattr(
        module.shutil, "which", lambda name: "/fake/agy" if name == "agy" else None
    )
    assert module._select_live_adapter("auto") == "agy"
    monkeypatch.setenv("FORGEWRIGHT_PROVIDER", "other")
    assert module._select_live_adapter("auto") == "orchestrator"


def _single_live_report(module, suite, task_id, *, passed=True):
    report = module.run_suite(suite, mode="replay", replay_kind="good", task_id=task_id)
    report["mode"] = "live"
    report["empirical"] = True
    report["comparisonMetadata"].update(
        {
            "provider": "agy",
            "modelId": "Weak Model",
            "modelSnapshot": "agy-1:Weak Model",
            "snapshotScope": "adapter-route",
            "adapter": "agy",
        }
    )
    if not passed:
        report["results"][0]["passed"] = False
        report["summary"] = module._summary_from_results(report["results"])
    return report


def test_aggregate_live_reports_requires_complete_exact_task_set():
    module = _module()
    suite = module.load_suite(SUITE)
    reports = [
        _single_live_report(module, suite, task["id"]) for task in suite["tasks"]
    ]
    aggregate = module.aggregate_live_reports(reports, suite, minimum_pass_rate=100.0)
    assert aggregate["summary"]["passedTasks"] == len(suite["tasks"])
    assert aggregate["baselinePolicy"]["minimumPassRate"] == 100.0
    assert aggregate["baselinePolicy"]["ciBlocking"] is False
    assert "stdout/stderr omitted" in aggregate["baselinePolicy"]["evidenceRetention"]
    assert all(
        "stdout" not in result and "stderr" not in result
        for result in aggregate["results"]
    )
    assert aggregate["comparisonMetadata"]["taskIds"] == [
        task["id"] for task in suite["tasks"]
    ]


def test_compare_live_reports_detects_pass_at_one_regression():
    module = _module()
    suite = module.load_suite(SUITE)
    reports = [
        _single_live_report(module, suite, task["id"]) for task in suite["tasks"]
    ]
    baseline = module.aggregate_live_reports(reports, suite, minimum_pass_rate=100.0)
    candidate = json.loads(json.dumps(baseline))
    candidate["results"][0]["passed"] = False
    candidate["summary"] = module._summary_from_results(candidate["results"])
    comparison = module.compare_live_reports(baseline, candidate, suite)
    assert comparison["comparable"] is True
    assert comparison["passed"] is False
    assert comparison["candidatePassRate"] < 100.0
    assert comparison["failedRequiredTasks"] == [suite["tasks"][0]["id"]]


def test_compare_live_reports_rejects_contract_drift():
    module = _module()
    suite = module.load_suite(SUITE)
    reports = [
        _single_live_report(module, suite, task["id"]) for task in suite["tasks"]
    ]
    baseline = module.aggregate_live_reports(reports, suite)
    candidate = json.loads(json.dumps(baseline))
    candidate["comparisonMetadata"]["contractFingerprint"] = "different"
    candidate["contractFingerprint"] = "different"
    comparison = module.compare_live_reports(baseline, candidate, suite)
    assert comparison["comparable"] is False
    assert any("contractFingerprint" in error for error in comparison["errors"])


def test_live_report_rejects_stale_suite_fingerprint():
    module = _module()
    suite = module.load_suite(SUITE)
    report = module.run_suite(
        suite, mode="replay", replay_kind="good", task_id="status-no-fake-success"
    )
    report["mode"] = "live"
    report["empirical"] = True
    report["comparisonMetadata"].update(
        {
            "provider": "provider",
            "modelId": "model",
            "modelSnapshot": "snapshot",
            "snapshotScope": "adapter-route",
            "adapter": "agy",
        }
    )
    report["suiteFingerprint"] = "stale"
    report["comparisonMetadata"]["suiteFingerprint"] = "stale"
    assert (
        "live report suite fingerprint does not match the current suite"
        in module.validate_live_report(report, suite)
    )
