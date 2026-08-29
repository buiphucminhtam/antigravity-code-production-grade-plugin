import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs" / "active-roadmap.md"
MANIFEST = ROOT / "docs" / "roadmap-completion.json"
PROJECT_STATE = ROOT / "docs" / "project-state.json"
EXPECTED_IDS = {
    *(f"P{phase}.{item}" for phase in range(3) for item in range(1, 6)),
    *(f"P3.{item}" for item in range(1, 5)),
}
EXPECTED_MANIFEST_IDS = EXPECTED_IDS | {"H0", "H1", "H2", "H3", "H4", "H5"}
COMPLETION_AXES = {
    "implementation": {"done", "partial", "missing"},
    "integration": {"canonical", "partial", "isolated", "not-applicable"},
    "activation": {
        "local",
        "opt-in",
        "library-only",
        "canonical-mcp",
        "not-enabled",
    },
    "production_evidence": {"verified", "missing", "not-required"},
    "outcome": {"met", "met-locally", "partially-met", "not-measured", "not-met"},
}
REPORT_CONTRACT = {
    "schema": "forgewright-roadmap-verification/v1",
    "producer": "scripts/ci/verify-roadmap-completion.py",
}


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_completion_manifest_covers_every_declared_local_deliverable_once() -> None:
    assert _manifest()["schema"] == "forgewright-roadmap-completion/v2"
    assert set(_manifest()["axis_definitions"]) == set(COMPLETION_AXES)
    roadmap_ids = re.findall(
        r"^\| (P[0-3]\.\d+) \|", ROADMAP.read_text(encoding="utf-8"), re.MULTILINE
    )
    manifest_ids = [item["id"] for item in _manifest()["deliverables"]]

    assert set(roadmap_ids) == EXPECTED_IDS
    assert len(manifest_ids) == len(set(manifest_ids))
    assert set(manifest_ids) == EXPECTED_MANIFEST_IDS

    h2 = next(item for item in _manifest()["deliverables"] if item["id"] == "H2")
    assert h2["implementation"] == "done"
    assert h2["integration"] == "canonical"
    assert h2["activation"] == "canonical-mcp"
    assert h2["production_evidence"] == "missing"
    assert h2["outcome"] == "met-locally"

    h3 = next(item for item in _manifest()["deliverables"] if item["id"] == "H3")
    assert h3["implementation"] == "done"
    assert h3["integration"] == "canonical"
    assert h3["activation"] == "canonical-mcp"
    assert h3["production_evidence"] == "missing"
    assert h3["outcome"] == "met-locally"

    h4 = next(item for item in _manifest()["deliverables"] if item["id"] == "H4")
    assert h4["implementation"] == "done"
    assert h4["integration"] == "isolated"
    assert h4["activation"] == "local"
    assert h4["production_evidence"] == "missing"
    assert h4["outcome"] == "met-locally"

    h5 = next(item for item in _manifest()["deliverables"] if item["id"] == "H5")
    assert h5["implementation"] == "done"
    assert h5["integration"] == "partial"
    assert h5["activation"] == "local"
    assert h5["production_evidence"] == "missing"
    assert h5["outcome"] == "partially-met"

    h1 = next(item for item in _manifest()["deliverables"] if item["id"] == "H1")
    assert h1["integration"] == "isolated"
    assert h1["activation"] == "library-only"


def test_harness_upgrade_dependencies_precede_live_provider_routing() -> None:
    roadmap = ROADMAP.read_text(encoding="utf-8")
    section = roadmap.split("## Harness Upgrade Sequence", 1)[1].split(
        "## Current Blockers", 1
    )[0]
    rows = re.findall(r"^\| (H\d) \|.*?\| ([^|]+) \|", section, re.MULTILINE)
    assert rows == [
        ("H0", "None"),
        ("H1", "H0"),
        ("H2", "H1"),
        ("H3", "H1, H2"),
        ("H4", "H2, H3"),
        ("H5", "H4"),
        ("H6", "H5"),
    ]
    assert section.index("TrajectoryLedger") < section.index("Provider adapters")
    assert section.index("filesystem/network containment") < section.index(
        "Provider adapters"
    )

    state = json.loads(PROJECT_STATE.read_text(encoding="utf-8"))
    dependencies = {item["id"]: item["depends_on"] for item in state["roadmap"]}
    assert dependencies["harness-host-contract"] == ["roadmap-truth-reset"]
    assert dependencies["trajectory-lifecycle"] == ["harness-host-contract"]
    assert dependencies["execution-containment"] == [
        "harness-host-contract",
        "trajectory-lifecycle",
    ]
    assert dependencies["record-replay"] == [
        "trajectory-lifecycle",
        "execution-containment",
    ]
    assert dependencies["production-evidence"] == ["record-replay"]
    assert dependencies["long-running-handoff"] == ["production-evidence"]


def test_every_deliverable_separates_completion_axes_and_executable_evidence() -> None:
    acceptance_ids: set[str] = set()
    for item in _manifest()["deliverables"]:
        assert "status" not in item, f"{item['id']}: ambiguous aggregate status"
        for axis, allowed in COMPLETION_AXES.items():
            assert item[axis] in allowed, f"{item['id']}: invalid {axis}"
        assert item["evidence"], item["id"]
        assert item["rollback"].strip(), item["id"]
        for relative_path in item["evidence"]:
            assert not Path(relative_path).is_absolute(), relative_path
            assert (ROOT / relative_path).is_file(), f"{item['id']}: {relative_path}"

        verification = item["verification"]
        command = verification["command"]
        assert isinstance(command, list) and command, item["id"]
        assert all(isinstance(arg, str) and arg for arg in command), item["id"]
        assert verification["timeout_seconds"] > 0, item["id"]
        assert verification["evidence_report"] == REPORT_CONTRACT, item["id"]
        assert verification["acceptance_ids"], item["id"]
        assert not acceptance_ids.intersection(verification["acceptance_ids"]), item[
            "id"
        ]
        acceptance_ids.update(verification["acceptance_ids"])
        assert verification["test_refs"], item["id"]
        assert verification["negative_paths"], item["id"]

        command_text = " ".join(command)
        for test_ref in verification["test_refs"]:
            relative_path = re.split(r"::|#", test_ref, maxsplit=1)[0]
            assert (ROOT / relative_path).is_file(), f"{item['id']}: {test_ref}"
            prefix_relative = relative_path.removeprefix("mcp/")
            assert relative_path in command_text or prefix_relative in command_text, (
                f"{item['id']}: test ref is not bound to command: {test_ref}"
            )

        negative_ids: set[str] = set()
        for negative_path in verification["negative_paths"]:
            assert negative_path["id"] not in negative_ids, item["id"]
            negative_ids.add(negative_path["id"])
            assert negative_path["claim"].strip(), item["id"]
            assert negative_path["test_refs"], item["id"]
            assert set(negative_path["test_refs"]).issubset(
                verification["test_refs"]
            ), f"{item['id']}: negative path is not bound to invoked refs"


def test_roadmap_verifier_contract_and_failure_path_are_executable(
    tmp_path: Path,
) -> None:
    runner = ROOT / REPORT_CONTRACT["producer"]
    checked = subprocess.run(
        ["python3", str(runner), "--check-contract"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert checked.returncode == 0, checked.stderr

    in_tree_report = ROOT / ".forgewright-roadmap-test-report.json"
    rejected_report = subprocess.run(
        [
            "python3",
            str(runner),
            "--check-contract",
            "--report",
            str(in_tree_report),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert rejected_report.returncode != 0
    assert "outside the repository worktree" in rejected_report.stderr
    assert not in_tree_report.exists()

    tampered = _manifest()
    item = tampered["deliverables"][0]
    item["verification"]["command"] = [
        "python3",
        "-c",
        "import sys; sys.exit(7)",
        "tests/unit_tests/test_product_truth.py",
    ]
    item["verification"]["test_refs"] = ["tests/unit_tests/test_product_truth.py"]
    item["verification"]["negative_paths"] = [
        {
            "id": "forced-verifier-failure",
            "claim": "a nonzero verifier blocks roadmap evidence",
            "test_refs": ["tests/unit_tests/test_product_truth.py"],
        }
    ]
    manifest = tmp_path / "roadmap-completion.json"
    manifest.write_text(json.dumps(tampered), encoding="utf-8")
    failed = subprocess.run(
        ["python3", str(runner), "--manifest", str(manifest), "--only", item["id"]],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    assert failed.returncode != 0
    report = json.loads(failed.stdout)
    assert report["status"] == "fail"
    assert report["deliverables"][0]["exit_code"] == 7

    ignored_probe = (
        ROOT / ".forgewright" / "reports" / "roadmap-verifier-ignored-probe.txt"
    )
    assert not ignored_probe.exists()
    ignored_mutation = _manifest()
    mutation_item = ignored_mutation["deliverables"][0]
    mutation_item["verification"]["command"] = [
        "python3",
        "-c",
        "from pathlib import Path; Path('.forgewright/reports/roadmap-verifier-ignored-probe.txt').write_text('mutated')",
        "tests/unit_tests/test_product_truth.py",
    ]
    mutation_item["verification"]["test_refs"] = [
        "tests/unit_tests/test_product_truth.py"
    ]
    mutation_item["verification"]["negative_paths"] = [
        {
            "id": "ignored-worktree-mutation",
            "claim": "an ignored worktree mutation blocks roadmap evidence",
            "test_refs": ["tests/unit_tests/test_product_truth.py"],
        }
    ]
    mutation_manifest = tmp_path / "mutating-roadmap-completion.json"
    mutation_manifest.write_text(json.dumps(ignored_mutation), encoding="utf-8")
    try:
        mutated = subprocess.run(
            [
                "python3",
                str(runner),
                "--manifest",
                str(mutation_manifest),
                "--only",
                mutation_item["id"],
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
    finally:
        ignored_probe.unlink(missing_ok=True)
    mutation_report = json.loads(mutated.stdout)
    assert mutated.returncode != 0
    assert mutation_report["status"] == "fail"
    assert mutation_report["tree_unchanged"] is False

    escaped = _manifest()
    escaped["deliverables"][0]["evidence"] = ["../../etc/passwd"]
    escaped_manifest = tmp_path / "escaped-roadmap-completion.json"
    escaped_manifest.write_text(json.dumps(escaped), encoding="utf-8")
    rejected_escape = subprocess.run(
        [
            "python3",
            str(runner),
            "--manifest",
            str(escaped_manifest),
            "--check-contract",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert rejected_escape.returncode != 0
    assert "missing evidence path" in rejected_escape.stderr


def test_all_declared_roadmap_verifiers_replay_on_unchanged_tree(
    tmp_path: Path,
) -> None:
    report_path = tmp_path / "roadmap-replay.json"
    replayed = subprocess.run(
        [
            "python3",
            str(ROOT / REPORT_CONTRACT["producer"]),
            "--report",
            str(report_path),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=480,
        check=False,
    )
    report_diagnostic = (
        report_path.read_text(encoding="utf-8")
        if report_path.exists()
        else "missing report"
    )
    assert replayed.returncode == 0, replayed.stderr + "\n" + report_diagnostic

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["status"] == "pass"
    assert report["tree_unchanged"] is True
    assert report["source_tree_unchanged"] is True
    assert report["snapshot_matches_source"] is True
    assert report["execution_tree_unchanged"] is True
    assert {item["id"] for item in report["deliverables"]} == EXPECTED_MANIFEST_IDS
    assert all(item["status"] == "pass" for item in report["deliverables"])


def test_provider_activation_is_not_overclaimed() -> None:
    gated = {
        item["id"]: item
        for item in _manifest()["deliverables"]
        if item["id"] in {"P2.2", "P2.3", "P2.4", "P2.5"}
    }

    assert set(gated) == {"P2.2", "P2.3", "P2.4", "P2.5"}
    assert all(item["activation"] == "not-enabled" for item in gated.values())
    assert all(item["production_evidence"] == "missing" for item in gated.values())
    assert all(item["outcome"] == "not-measured" for item in gated.values())
    assert (
        "Provider-native activation is a separate gate"
        in _manifest()["completion_rule"]
    )
