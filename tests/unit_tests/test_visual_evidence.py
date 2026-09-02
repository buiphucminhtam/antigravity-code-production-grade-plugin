from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "art-direction" / "visual_evidence.py"


def evidence_card(
    card_id: str,
    *,
    kind: str = "successful_product",
    source_type: str = "first_party_product",
    tier: str = "A",
) -> dict[str, object]:
    status = "verified"
    signals: list[dict[str, str]] = [
        {
            "claim": f"{card_id} has verified production adoption in its declared context.",
            "source_location": f"https://example.com/{card_id}/metrics",
            "observed_at": "2026-09-01",
            "caveat": "Adoption proves production use, not that this visual pattern caused success.",
        }
    ]
    if kind == "production_design_system":
        source_type = "official_design_system"
        status = "production_adoption"
    elif kind == "platform_guideline":
        source_type = "official_platform_guideline"
        status = "not_applicable"
        signals = []
    elif kind == "user_approved_reference":
        source_type = "user_supplied"
        status = "user_authority"
        signals = []
    elif kind == "project_product":
        source_type = "project_local"
        status = "project_observed"
        signals = []
    elif kind == "inspiration_only":
        source_type = "secondary_inspiration"
        status = "not_applicable"
        signals = []
        tier = "C"

    location = f"https://example.com/{card_id}"
    if source_type in {"user_supplied", "project_local", "direct_product_capture"}:
        location = f"artifacts/{card_id}.png"

    return {
        "schema_version": "visual-evidence-card/v1",
        "id": card_id,
        "subject": {
            "name": card_id,
            "kind": kind,
            "category": "developer productivity",
            "platform": "web desktop",
        },
        "source": {
            "publisher": "Evidence owner",
            "source_type": source_type,
            "location": location,
            "observed_at": "2026-09-01",
            "authority_tier": tier,
        },
        "context": {
            "audience": "professional developers",
            "primary_job": "inspect and manage dense technical work",
            "interaction_model": "desktop keyboard and pointer",
            "similarity_to_target": "Comparable high-frequency professional workspace.",
            "applicability_boundary": "Do not transfer product identity or patterns tied to unrelated workflows.",
        },
        "success_evidence": {"status": status, "signals": signals},
        "evidence_roles": ["STYLE", "COLOR", "LAYOUT_TARGET"],
        "observations": [
            {
                "dimension": "color",
                "evidence_location": location,
                "observed_pattern": "Neutral surfaces dominate while semantic accent is sparse.",
                "transferable_mechanism": "Use semantic surface and action roles rather than copying exact colors.",
                "applicability_boundary": "Applies to dense professional workspaces with comparable task frequency.",
                "prohibited_copying": "Do not copy exact hex values, logos, proprietary icons, or unique composition.",
            }
        ],
        "causality": {
            "claim_level": "observation",
            "causal_claim_allowed": False,
            "note": "The product's success does not prove this color treatment caused the success.",
        },
        "model_prior": {"used_as_evidence": False, "hypothesis_only": True},
    }


def visual_basis(
    card_ids: list[str],
    *,
    origin: str = "external_research",
    greenfield: bool = True,
) -> dict[str, object]:
    decision_ids = card_ids[:2] if len(card_ids) >= 2 else card_ids
    return {
        "schema_version": "visual-basis/v1",
        "id": "basis-dev-workspace-v1",
        "status": "GROUNDED",
        "basis_origin": origin,
        "target_context": {
            "greenfield": greenfield,
            "category": "developer productivity",
            "platform": "web desktop",
            "audience": "professional developers",
            "primary_job": "manage dense technical work",
        },
        "research_gate": {
            "status": "PASSED"
            if origin in {"external_research", "mixed"}
            else "NOT_REQUIRED",
            "question": "Which production-proven visual mechanisms fit this target context?",
            "researched_at": "2026-09-01",
            "source_strategy": "Use first-party product/design-system evidence and verify adoption separately from visual observations.",
        },
        "card_ids": card_ids,
        "decisions": [
            {
                "id": "decision-semantic-color",
                "claim": "Use neutral surfaces with sparse semantic accent for the primary workspace.",
                "dimensions": ["color", "layout"],
                "card_ids": decision_ids,
                "synthesis": "Repeated production evidence supports restrained semantic color roles in comparable dense workspaces.",
                "applicability_boundary": "Only for the dense primary workspace; marketing surfaces may use another approved basis.",
                "must_match": ["Semantic roles remain consistent across states."],
                "may_vary": ["Exact palette values are derived for this product."],
                "prohibited_drift": [
                    "Do not clone source branding or exact proprietary composition."
                ],
                "causality_limit": "This is a transferable observed pattern, not a claim that the pattern caused product success.",
            }
        ],
        "model_prior": {"used_as_evidence": False, "hypothesis_only": True},
    }


def write_bundle(
    tmp_path: Path, cards: list[dict[str, object]], basis: dict[str, object]
) -> tuple[Path, Path]:
    cards_dir = tmp_path / "cards"
    cards_dir.mkdir()
    for card in cards:
        (cards_dir / f"{card['id']}.json").write_text(
            json.dumps(card), encoding="utf-8"
        )
    basis_path = tmp_path / "visual-basis.json"
    basis_path.write_text(json.dumps(basis), encoding="utf-8")
    return basis_path, cards_dir


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def output(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    assert result.stderr == "", result.stderr
    return json.loads(result.stdout)


def test_greenfield_external_basis_accepts_three_production_grounded_cards(
    tmp_path: Path,
) -> None:
    cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
    basis = visual_basis([str(card["id"]) for card in cards])
    basis_path, cards_dir = write_bundle(tmp_path, cards, basis)

    result = run_tool("validate-basis", str(basis_path), "--cards-dir", str(cards_dir))

    assert result.returncode == 0, result.stdout
    assert output(result) == {
        "basis_id": "basis-dev-workspace-v1",
        "card_count": 3,
        "command": "validate-basis",
        "errors": [],
        "generation_ready": True,
        "grounded": True,
        "valid": True,
    }


def test_successful_product_requires_real_success_signal(tmp_path: Path) -> None:
    card = evidence_card("product-proof")
    card["success_evidence"] = {"status": "verified", "signals": []}
    path = tmp_path / "card.json"
    path.write_text(json.dumps(card), encoding="utf-8")

    result = run_tool("validate-card", str(path))

    assert result.returncode != 0
    assert any("success signal" in item for item in output(result)["errors"])


def test_model_prior_can_never_be_marked_as_visual_evidence(tmp_path: Path) -> None:
    card = evidence_card("product-prior")
    card["model_prior"] = {"used_as_evidence": True, "hypothesis_only": False}
    path = tmp_path / "card.json"
    path.write_text(json.dumps(card), encoding="utf-8")

    result = run_tool("validate-card", str(path))

    assert result.returncode != 0
    errors = " ".join(output(result)["errors"])
    assert "used_as_evidence" in errors
    assert "hypothesis_only" in errors


def test_inspiration_only_card_cannot_ground_a_visual_decision(tmp_path: Path) -> None:
    cards = [
        evidence_card("product-a"),
        evidence_card("product-b"),
        evidence_card("gallery-c", kind="inspiration_only"),
    ]
    basis = visual_basis([str(card["id"]) for card in cards])
    basis["decisions"][0]["card_ids"] = ["product-a", "gallery-c"]
    basis_path, cards_dir = write_bundle(tmp_path, cards, basis)

    result = run_tool("validate-basis", str(basis_path), "--cards-dir", str(cards_dir))

    assert result.returncode != 0
    assert any("inspiration_only" in item for item in output(result)["errors"])


def test_greenfield_external_research_fails_closed_with_too_few_references(
    tmp_path: Path,
) -> None:
    cards = [evidence_card("product-a"), evidence_card("product-b")]
    basis = visual_basis([str(card["id"]) for card in cards])
    basis_path, cards_dir = write_bundle(tmp_path, cards, basis)

    result = run_tool("validate-basis", str(basis_path), "--cards-dir", str(cards_dir))

    assert result.returncode != 0
    assert any("at least 3" in item for item in output(result)["errors"])


def test_external_research_decision_requires_two_independent_cards(
    tmp_path: Path,
) -> None:
    cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
    basis = visual_basis([str(card["id"]) for card in cards])
    basis["decisions"][0]["card_ids"] = ["product-1"]
    basis_path, cards_dir = write_bundle(tmp_path, cards, basis)

    result = run_tool("validate-basis", str(basis_path), "--cards-dir", str(cards_dir))

    assert result.returncode != 0
    assert any("at least 2 independent" in item for item in output(result)["errors"])


def test_user_approved_reference_can_be_authoritative_without_market_success(
    tmp_path: Path,
) -> None:
    card = evidence_card("owner-reference", kind="user_approved_reference")
    basis = visual_basis(["owner-reference"], origin="user_approved")
    basis_path, cards_dir = write_bundle(tmp_path, [card], basis)

    result = run_tool("validate-basis", str(basis_path), "--cards-dir", str(cards_dir))

    assert result.returncode == 0, result.stdout
    assert output(result)["generation_ready"] is True


def test_product_success_is_observation_not_causal_proof(tmp_path: Path) -> None:
    card = evidence_card("product-causality")
    invalid = copy.deepcopy(card)
    invalid["causality"] = {
        "claim_level": "observation",
        "causal_claim_allowed": True,
        "note": "Incorrect causal overreach.",
    }
    path = tmp_path / "card.json"
    path.write_text(json.dumps(invalid), encoding="utf-8")

    result = run_tool("validate-card", str(path))

    assert result.returncode != 0
    assert any("causal_claim_allowed" in item for item in output(result)["errors"])
