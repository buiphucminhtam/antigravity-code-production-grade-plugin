import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals" / "routing"))

from control_plane import (  # noqa: E402
    corpus_fingerprint,
    evaluate_control_plane as _evaluate_control_plane,
    sign_evidence,
)
from corpus import build_corpus  # noqa: E402


ATTESTATION_KEY = b"test-only-routing-attestation-key-32-bytes"


def evaluate_control_plane(evidence: dict) -> dict:
    try:
        evidence["attestation_hmac_sha256"] = sign_evidence(evidence, ATTESTATION_KEY)
    except (TypeError, ValueError):
        # Exercise field validation for payloads that canonical JSON correctly
        # refuses to attest (for example, non-finite numeric evidence).
        pass
    return _evaluate_control_plane(evidence, ATTESTATION_KEY)


def rollout_transition(task, expert_number: int) -> tuple[str, int]:
    if task.expected_tier == "expert" and expert_number > 30:
        return "builder", 1
    return task.expected_tier, 0


def shadow_evidence() -> dict:
    tasks = build_corpus()
    return {
        "schema_version": 1,
        "mode": "shadow",
        "execution_mode": "live",
        "cost_unit": "usd",
        "provider": "openai-codex",
        "model": "gpt-5.6-terra",
        "resolved_snapshot": "gpt-5.6-terra-2026-07-13",
        "corpus_fingerprint": corpus_fingerprint(),
        "verifier_fingerprint": "sha256:verifier-v1",
        "baseline_run_id": "baseline-live-001",
        "candidate_run_id": "shadow-live-001",
        "records": [
            {
                "task_id": task.id,
                "baseline_tier": "expert",
                "baseline_verifier_passed": True,
                "baseline_cost": 1.0,
                "selected_tier": task.expected_tier,
                "predicted_cost": {"scout": 0.2, "builder": 0.5, "expert": 1.0}[
                    task.expected_tier
                ],
                "execution_id": f"exec-{task.id}",
                "input_sha256": "a" * 64,
                "baseline_output_sha256": "b" * 64,
                "candidate_output_sha256": "c" * 64,
                "verifier_result_sha256": "d" * 64,
            }
            for task in tasks
        ],
    }


def test_shadow_requires_complete_live_strong_baseline_and_reports_savings() -> None:
    report = evaluate_control_plane(shadow_evidence())
    assert report["route_precision"] == 1.0
    assert report["under_routed"] == 0
    assert report["predicted_savings_rate"] > 0
    assert report["canary_eligible"] is True


@pytest.mark.parametrize(
    "field", ["provider", "model", "resolved_snapshot", "verifier_fingerprint"]
)
def test_shadow_rejects_missing_comparable_metadata(field: str) -> None:
    evidence = shadow_evidence()
    evidence[field] = ""
    with pytest.raises(ValueError, match=field):
        evaluate_control_plane(evidence)


def test_shadow_rejects_non_expert_or_incomplete_baseline() -> None:
    evidence = shadow_evidence()
    evidence["records"][0]["baseline_tier"] = "builder"
    with pytest.raises(ValueError, match="strong-model-only"):
        evaluate_control_plane(evidence)
    evidence = shadow_evidence()
    evidence["records"].pop()
    with pytest.raises(ValueError, match="exact frozen corpus"):
        evaluate_control_plane(evidence)


def test_canary_requires_exactly_ten_percent_and_zero_quality_drop() -> None:
    evidence = shadow_evidence()
    evidence["mode"] = "canary"
    by_category = {}
    for task, record in zip(build_corpus(), evidence["records"], strict=True):
        by_category.setdefault(task.category, record)
    evidence["records"] = [
        {
            **record,
            "candidate_verifier_passed": True,
            "safety_regression": False,
        }
        for record in by_category.values()
    ]
    report = evaluate_control_plane(evidence)
    assert report["canary_passed"] is True
    evidence["records"][0]["candidate_verifier_passed"] = False
    report = evaluate_control_plane(evidence)
    assert report["canary_passed"] is False


def test_rollout_and_independent_review_thresholds_are_mechanical() -> None:
    evidence = shadow_evidence()
    evidence["mode"] = "rollout"
    evidence["records"] = []
    expert_number = 0
    for index, task in enumerate(build_corpus()):
        if task.expected_tier == "expert":
            expert_number += 1
        initial_tier, escalation_count = rollout_transition(task, expert_number)
        evidence["records"].append(
            {
                "task_id": task.id,
                "initial_tier": initial_tier,
                "selected_tier": task.expected_tier,
                "verifier_passed": True,
                "safety_regression": False,
                "escalated": escalation_count == 1,
                "re_escalated": False,
                "escalation_count": escalation_count,
                "independent_review": index < 10,
                "review_found_defect": index < 5,
                "review_cost": 0.1 if index < 10 else 0.0,
                "avoided_defect_cost": 0.3
                if index < 5
                else (0.2 if index < 10 else 0.0),
                "execution_id": f"exec-{task.id}",
                "input_sha256": "a" * 64,
                "baseline_output_sha256": "b" * 64,
                "candidate_output_sha256": "c" * 64,
                "verifier_result_sha256": "d" * 64,
                "baseline_tier": "expert",
                "baseline_verifier_passed": True,
                "baseline_cost": 1.0,
            }
        )
    report = evaluate_control_plane(evidence)
    assert report["rollout_passed"] is True
    assert report["review_gate"]["marginal_value_positive"] is True
    assert report["review_gate"]["review_precision"] == 0.5


def test_rejects_non_live_or_unbalanced_canary_evidence() -> None:
    evidence = shadow_evidence()
    evidence["execution_mode"] = "simulation"
    with pytest.raises(ValueError, match="execution_mode"):
        evaluate_control_plane(evidence)

    evidence = shadow_evidence()
    evidence["mode"] = "canary"
    evidence["records"] = [
        {**record, "candidate_verifier_passed": True, "safety_regression": False}
        for record in evidence["records"][:10]
    ]
    with pytest.raises(ValueError, match="every corpus category"):
        evaluate_control_plane(evidence)


def test_rollout_rejects_inconsistent_escalation_and_review_evidence() -> None:
    evidence = shadow_evidence()
    evidence["mode"] = "rollout"
    evidence["records"] = []
    expert_number = 0
    for task in build_corpus():
        if task.expected_tier == "expert":
            expert_number += 1
        initial_tier, escalation_count = rollout_transition(task, expert_number)
        evidence["records"].append(
            {
                "task_id": task.id,
                "initial_tier": initial_tier,
                "selected_tier": task.expected_tier,
                "verifier_passed": True,
                "safety_regression": False,
                "escalated": escalation_count == 1,
                "re_escalated": False,
                "escalation_count": escalation_count,
                "independent_review": False,
                "review_found_defect": False,
                "review_cost": 0.0,
                "avoided_defect_cost": 0.0,
                "execution_id": f"exec-{task.id}",
                "input_sha256": "a" * 64,
                "baseline_output_sha256": "b" * 64,
                "candidate_output_sha256": "c" * 64,
                "verifier_result_sha256": "d" * 64,
                "baseline_tier": "expert",
                "baseline_verifier_passed": True,
                "baseline_cost": 1.0,
            }
        )
    evidence["records"][0]["re_escalated"] = True
    with pytest.raises(ValueError, match="re_escalated requires escalated"):
        evaluate_control_plane(evidence)

    evidence["records"][0]["re_escalated"] = False
    evidence["records"][0]["review_found_defect"] = True
    with pytest.raises(ValueError, match="review evidence requires independent_review"):
        evaluate_control_plane(evidence)


def test_rejects_missing_provenance_nonfinite_cost_and_under_routing() -> None:
    evidence = shadow_evidence()
    del evidence["records"][0]["execution_id"]
    with pytest.raises(ValueError, match="execution_id"):
        evaluate_control_plane(evidence)
    evidence = shadow_evidence()
    evidence["records"][0]["baseline_cost"] = float("nan")
    with pytest.raises(ValueError, match="baseline_cost"):
        evaluate_control_plane(evidence)


def test_review_must_be_individually_profitable_but_zero_reviews_is_allowed() -> None:
    evidence = shadow_evidence()
    evidence["mode"] = "rollout"
    expert_number = 0
    for task, record in zip(build_corpus(), evidence["records"], strict=True):
        if task.expected_tier == "expert":
            expert_number += 1
        initial_tier, escalation_count = rollout_transition(task, expert_number)
        record.update(
            baseline_tier="expert",
            initial_tier=initial_tier,
            selected_tier=task.expected_tier,
            verifier_passed=True,
            safety_regression=False,
            escalated=escalation_count == 1,
            re_escalated=False,
            independent_review=False,
            escalation_count=escalation_count,
            review_found_defect=False,
            review_cost=0.0,
            avoided_defect_cost=0.0,
        )
    assert evaluate_control_plane(evidence)["rollout_passed"] is True
    evidence["records"][0].update(
        independent_review=True, review_cost=1.0, avoided_defect_cost=0.5
    )
    with pytest.raises(ValueError, match="exceed review_cost"):
        evaluate_control_plane(evidence)


def test_attestation_is_required_and_detects_tampering() -> None:
    evidence = shadow_evidence()
    with pytest.raises(ValueError, match="attestation"):
        _evaluate_control_plane(evidence, ATTESTATION_KEY)
    evidence["attestation_hmac_sha256"] = sign_evidence(evidence, ATTESTATION_KEY)
    evidence["records"][0]["baseline_cost"] = 2.0
    with pytest.raises(ValueError, match="attestation is invalid"):
        _evaluate_control_plane(evidence, ATTESTATION_KEY)


def test_escalation_flags_must_match_tier_transition() -> None:
    evidence = shadow_evidence()
    evidence["mode"] = "rollout"
    for record in evidence["records"]:
        record.update(
            initial_tier=record["selected_tier"],
            escalation_count=0,
            verifier_passed=True,
            safety_regression=False,
            escalated=False,
            re_escalated=False,
            independent_review=False,
            review_found_defect=False,
            review_cost=0.0,
            avoided_defect_cost=0.0,
        )
    evidence["records"][0]["escalated"] = True
    with pytest.raises(ValueError, match="escalated must reflect"):
        evaluate_control_plane(evidence)
