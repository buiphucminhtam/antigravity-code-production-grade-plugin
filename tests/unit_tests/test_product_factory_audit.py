import hashlib
import json
from pathlib import Path

import pytest

from scripts.product_factory.audit import (
    AUDIT_VERSION,
    AuditError,
    audit_rules,
    default_inventory,
    MAX_HEURISTICS,
    validate_heuristics,
    validate_inventory,
)
from scripts.product_factory.baseline import (
    BASELINE_HEAD,
    ReceiptError,
    capture_baseline_receipt,
    validate_baseline_receipt,
)


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_PATH = Path("product-factory/baseline-evidence.v1.json")


def _inventory() -> dict:
    return {
        "schema_version": "product-factory-instruction-inventory/v1",
        "sources": [
            {"path": "kernel/ENTRY.md", "authority": "kernel"},
            {"path": "kernel/SOLVE.md", "authority": "kernel"},
            {"path": "kernel/VERIFY.md", "authority": "kernel"},
            {"path": "kernel/ESCALATE.md", "authority": "kernel"},
            {"path": "kernel/CLARIFY.md", "authority": "kernel"},
            {"path": "kernel/POLICY.md", "authority": "kernel"},
            {"path": "skills/_shared/protocols/verification.md", "authority": "shared_protocol"},
            {"path": "skills/software-engineer/LITE.md", "authority": "routed_lite"},
            {"path": "skills/software-engineer/SKILL.md", "authority": "routed_skill"},
        ],
    }


def _rule(rule_id: str, authority: str, source: str, statement: str, **extra: str) -> dict:
    return {
        "rule_id": rule_id,
        "authority": authority,
        "source": source,
        "location": source + ":10",
        "statement": statement,
        **extra,
    }


def _heuristic(**overrides: str) -> dict:
    return {
        "id": "layout-padding",
        "value": "24px",
        "domain": "ui",
        "source": "Design system measurement",
        "evidence_locator": "docs/design.md:12",
        "evidence_type": "measurement",
        "date": "2026-09-04",
        "classification": "current-project",
        **overrides,
    }


def _receipt() -> dict:
    return json.loads((ROOT / "product-factory/baseline-receipt.v1.json").read_text())


def _evidence() -> dict:
    return json.loads((ROOT / EVIDENCE_PATH).read_text())


def _canonical_bytes(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def _store_evidence(root: Path, receipt: dict, evidence: dict, *, canonical: bool = True) -> None:
    path = root / EVIDENCE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = _canonical_bytes(evidence) if canonical else json.dumps(evidence, indent=2).encode()
    path.write_bytes(raw)
    receipt["engineering_quick_suite"]["evidence_sha256"] = hashlib.sha256(raw).hexdigest()


def _synchronize_receipt(receipt: dict, evidence: dict) -> None:
    receipt["captured_at"] = evidence["captured_at"]
    receipt["baseline_head"] = evidence["repository"]["head"]
    receipt["baseline_tree"] = {
        "tree_sha": evidence["repository"]["tree_sha"],
        "worktree_status": evidence["repository"]["worktree_status"],
    }
    receipt["environment"]["host"] = evidence["host"]
    receipt["engineering_quick_suite"]["commands"] = evidence["steps"]


def test_canonical_product_factory_verifier_covers_implemented_phases_and_pf7_truth_guard() -> None:
    verifier = (ROOT / "scripts/ci/verify-product-factory.py").read_text()

    required_contracts = {
        "PF0": "tests/unit_tests/test_product_factory_audit.py",
        "PF1": "src/product-factory/product-intent.test.ts",
        "PF2": "src/product-factory/environment-aci.test.ts",
        "PF3": "src/product-factory/product-outcome-runner.test.ts",
        "PF4": "tests/bench-product-factory.test.ts",
        "PF5": "src/product-factory/learning-foundry.test.ts",
        "PF6": "src/product-factory/disposable-environment.test.ts",
        "PF7": "tests/unit_tests/test_product_factory_release_status.py",
    }
    for phase, contract in required_contracts.items():
        assert contract in verifier, f"canonical verifier omitted {phase}: {contract}"

    required_checks = (ROOT / "scripts/ci/run-required-checks.sh").read_text()
    assert (
        "run_required product-factory npm run verify:product-factory" in required_checks
    ), "required local CI omitted the canonical Product Factory verifier"


def test_default_inventory_is_versioned_and_covers_required_surfaces() -> None:
    inventory = default_inventory(ROOT)

    validate_inventory(inventory, ROOT)

    paths = {source["path"] for source in inventory["sources"]}
    assert {f"kernel/{name}.md" for name in ("ENTRY", "SOLVE", "VERIFY", "ESCALATE", "CLARIFY", "POLICY")} <= paths
    assert any(path.startswith("skills/_shared/protocols/") for path in paths)
    assert any(path.endswith("/LITE.md") for path in paths)
    assert any(path.endswith("/SKILL.md") for path in paths)
    assert "skills/generated/hook-expert/SKILL.md" in paths


def test_stored_inventory_artifact_declares_exact_v1_selection() -> None:
    artifact = json.loads((ROOT / "product-factory/instruction-inventory.v1.json").read_text())
    expected = default_inventory(ROOT)

    validate_inventory(artifact, ROOT)
    assert artifact == expected


def test_audit_selects_higher_authority_with_complete_loser_provenance() -> None:
    inventory = _inventory()
    result = audit_rules(inventory, [
        _rule("verify", "routed_lite", "skills/software-engineer/LITE.md", "run unit tests"),
        _rule("verify", "kernel", "kernel/VERIFY.md", "record observed evidence"),
    ])

    assert result["schema_version"] == AUDIT_VERSION
    resolution = result["resolutions"][0]
    assert resolution["winner"] == {
        "authority": "kernel",
        "source": "kernel/VERIFY.md",
        "location": "kernel/VERIFY.md:10",
        "statement": "record observed evidence",
        "disposition": "active_winner",
    }
    assert resolution["losers"][0]["disposition"] == "superseded_lower_authority"


def test_audit_rejects_same_authority_conflicts_and_out_of_inventory_rules() -> None:
    inventory = _inventory()
    with pytest.raises(AuditError, match="same-authority contradiction"):
        audit_rules(inventory, [
            _rule("verify", "kernel", "kernel/VERIFY.md", "first"),
            _rule("verify", "kernel", "kernel/ENTRY.md", "second"),
        ])
    with pytest.raises(AuditError, match="outside fixed inventory"):
        audit_rules(inventory, [_rule("verify", "kernel", "kernel/AUDIT.md", "unknown")])


def test_audit_rejects_lower_rank_conflict_even_when_kernel_wins() -> None:
    with pytest.raises(AuditError, match="same-authority contradiction"):
        audit_rules(_inventory(), [
            _rule("verify", "kernel", "kernel/VERIFY.md", "kernel winner"),
            _rule("verify", "routed_lite", "skills/software-engineer/LITE.md", "first lower rule"),
            _rule("verify", "routed_lite", "skills/software-engineer/LITE.md", "second lower rule", location="skills/software-engineer/LITE.md:20"),
        ])


def test_audit_rejects_stale_rule_when_it_would_be_promoted() -> None:
    with pytest.raises(AuditError, match="no active candidate"):
        audit_rules(_inventory(), [
            _rule("verify", "routed_skill", "skills/software-engineer/SKILL.md", "obsolete", disposition="stale")
        ])


def test_heuristics_require_provenance_and_keep_defaults_explicit() -> None:
    result = validate_heuristics([
        _heuristic(),
        _heuristic(
            id="retry-count",
            value=3,
            source="Explicit product default",
            evidence_locator="product-factory/defaults:3",
            evidence_type="explicit_default",
            classification="default",
        ),
        _heuristic(
            id="colour-guess",
            value="blue",
            source="Design exploration",
            evidence_locator="research/notes.md:4",
            evidence_type="hypothesis",
            classification="hypothesis",
        ),
    ])

    assert [entry["id"] for entry in result["entries"]] == ["colour-guess", "layout-padding", "retry-count"]


def test_heuristics_reject_missing_provenance_and_unsupported_numeric_truth() -> None:
    missing = _heuristic()
    missing.pop("evidence_locator")
    with pytest.raises(AuditError, match="missing fields"):
        validate_heuristics([missing])
    with pytest.raises(AuditError, match="unsupported numeric truth claim"):
        validate_heuristics([_heuristic(value="latency must be 50ms", evidence_type="best_practice")])
    with pytest.raises(AuditError, match="unsupported numeric truth claim"):
        validate_heuristics([_heuristic(value=24, evidence_type="best_practice")])
    for value in ("50ms", "30%", "2x", "3/4", "24", "16:9", "512MB", "60fps", "2rem", "1.5GB", "p95"):
        with pytest.raises(AuditError, match="unsupported numeric truth claim"):
            validate_heuristics([_heuristic(value=value, evidence_type="best_practice")])
    for classification in ("default", "hypothesis"):
        validate_heuristics([_heuristic(value="16:9", evidence_type="explicit_default", classification=classification)])
    with pytest.raises(AuditError, match="unknown"):
        validate_heuristics([_heuristic(extra="not allowed")])
    with pytest.raises(AuditError, match="non-empty string"):
        validate_heuristics([_heuristic(domain="x" * 4097)])


def test_heuristic_iterable_is_bounded() -> None:
    with pytest.raises(AuditError, match="bounded"):
        validate_heuristics(_heuristic(id=f"h-{index}") for index in range(MAX_HEURISTICS + 1))


def test_baseline_receipt_binds_head_quick_suite_and_unmeasured_gaps() -> None:
    receipt = _receipt()

    validate_baseline_receipt(receipt)
    assert receipt["baseline_head"] == BASELINE_HEAD
    assert receipt["engineering_quick_suite"]["status"] == "pass"
    assert receipt["engineering_quick_suite"]["evidence_path"] == EVIDENCE_PATH.as_posix()
    assert all(value in {"unavailable", "not_measured"} for value in receipt["measurement_gaps"].values())
    assert receipt["engineering_quick_suite"]["commands"]


def test_tracked_evidence_is_canonical_and_matches_receipt_digest() -> None:
    receipt = _receipt()
    evidence = _evidence()
    raw = (ROOT / EVIDENCE_PATH).read_bytes()

    assert raw == _canonical_bytes(evidence)
    assert hashlib.sha256(raw).hexdigest() == receipt["engineering_quick_suite"]["evidence_sha256"]
    validate_baseline_receipt(receipt)


def test_baseline_receipt_rejects_zero_and_wrong_head() -> None:
    receipt = _receipt()
    receipt["measurement_gaps"]["intent"] = 0
    with pytest.raises(ReceiptError, match="unmeasured"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["baseline_head"] = "0" * 40
    with pytest.raises(ReceiptError, match="baseline_head"):
        validate_baseline_receipt(receipt)


def test_baseline_receipt_rejects_unknown_fields_and_malformed_time() -> None:
    receipt = _receipt()
    receipt["captured_at"] = "not-a-timestamp"
    with pytest.raises(ReceiptError, match="captured_at"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["extra"] = True
    with pytest.raises(ReceiptError, match="unknown"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["environment"]["host"]["node_binary"] = "/private/host/node"
    with pytest.raises(ReceiptError, match="host"):
        validate_baseline_receipt(receipt)


def test_baseline_rejects_forged_command_manifest_tree_and_digest() -> None:
    receipt = _receipt()
    receipt["engineering_quick_suite"]["commands"][0]["argv"].append("--forged")
    with pytest.raises(ReceiptError, match="command manifest"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["baseline_tree"]["tree_sha"] = "0" * 40
    with pytest.raises(ReceiptError, match="tree"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["engineering_quick_suite"]["evidence_sha256"] = "0" * 64
    with pytest.raises(ReceiptError, match="digest"):
        validate_baseline_receipt(receipt)


def test_baseline_rejects_forged_timestamp_host_and_evidence_path() -> None:
    receipt = _receipt()
    receipt["captured_at"] = "2026-09-04T06:46:11.359350+00:00"
    with pytest.raises(ReceiptError, match="captured_at"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["environment"]["host"]["os"] = "forged"
    with pytest.raises(ReceiptError, match="host"):
        validate_baseline_receipt(receipt)
    receipt = _receipt()
    receipt["engineering_quick_suite"]["evidence_path"] = "product-factory/forged-evidence.json"
    with pytest.raises(ReceiptError, match="evidence path"):
        validate_baseline_receipt(receipt)


@pytest.mark.parametrize("forgery", ["timestamp", "host", "command", "tree", "status", "exit_code"])
def test_tracked_evidence_rejects_resigned_cross_field_forgeries(tmp_path: Path, forgery: str) -> None:
    receipt = _receipt()
    evidence = _evidence()
    if forgery == "timestamp":
        evidence["captured_at"] = "2026-09-04T06:46:11.359350+00:00"
    elif forgery == "host":
        evidence["host"]["os"] = "forged"
    elif forgery == "command":
        evidence["steps"][0]["argv"].append("--forged")
    elif forgery == "tree":
        evidence["repository"]["tree_sha"] = "0" * 40
    elif forgery == "status":
        evidence["steps"][0]["status"] = "fail"
    else:
        evidence["steps"][0]["exit_code"] = 1
    _synchronize_receipt(receipt, evidence)
    _store_evidence(tmp_path, receipt, evidence)

    with pytest.raises(ReceiptError):
        validate_baseline_receipt(receipt, tmp_path)


def test_tracked_evidence_rejects_extra_fields_and_noncanonical_bytes(tmp_path: Path) -> None:
    receipt = _receipt()
    evidence = _evidence()
    evidence["extra"] = True
    _store_evidence(tmp_path, receipt, evidence)
    with pytest.raises(ReceiptError, match="unknown fields"):
        validate_baseline_receipt(receipt, tmp_path)

    receipt = _receipt()
    evidence = _evidence()
    _store_evidence(tmp_path, receipt, evidence, canonical=False)
    with pytest.raises(ReceiptError, match="canonical"):
        validate_baseline_receipt(receipt, tmp_path)


def test_immutable_validation_survives_post_pf_checkout_and_capture_is_separate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("scripts.product_factory.baseline._run_git", lambda *_args: (_ for _ in ()).throw(AssertionError("validator queried git")))
    validate_baseline_receipt(_receipt())
    monkeypatch.undo()
    with pytest.raises(TypeError):
        capture_baseline_receipt(ROOT, expected_head=BASELINE_HEAD)
    with pytest.raises(ReceiptError, match="clean baseline worktree"):
        capture_baseline_receipt(
            ROOT,
            expected_head=BASELINE_HEAD,
            historical_report_path=ROOT / ".forgewright/reports/local-ci/20260904T064613Z.json",
        )


def test_steady_validation_works_in_fresh_checkout_without_git_or_ignored_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    receipt = _receipt()
    evidence = _evidence()
    _store_evidence(tmp_path, receipt, evidence)
    monkeypatch.setattr("scripts.product_factory.baseline._run_git", lambda *_args: (_ for _ in ()).throw(AssertionError("validator queried git")))
    monkeypatch.setattr("scripts.product_factory.baseline._report", lambda *_args: (_ for _ in ()).throw(AssertionError("validator queried report")))

    validate_baseline_receipt(receipt, tmp_path)


def test_capture_from_explicit_historical_report_reproduces_stored_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_git(_root: Path, *args: str) -> str:
        if args == ("rev-parse", "HEAD"):
            return BASELINE_HEAD
        if args == ("status", "--porcelain"):
            return ""
        if args == ("rev-parse", f"{BASELINE_HEAD}^{{tree}}"):
            return _receipt()["baseline_tree"]["tree_sha"]
        raise AssertionError(f"unexpected git call: {args}")

    monkeypatch.setattr("scripts.product_factory.baseline._run_git", fake_git)
    captured = capture_baseline_receipt(
        ROOT,
        expected_head=BASELINE_HEAD,
        historical_report_path=ROOT / ".forgewright/reports/local-ci/20260904T064613Z.json",
    )

    assert captured == _receipt()


def test_stored_baseline_receipt_is_valid_contract_snapshot() -> None:
    receipt = json.loads((ROOT / "product-factory/baseline-receipt.v1.json").read_text())
    validate_baseline_receipt(receipt)
