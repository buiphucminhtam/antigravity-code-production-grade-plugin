from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from tests.unit_tests.test_visual_evidence import evidence_card, visual_basis


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "art-direction" / "creative-handoff.py"


def direction(direction_id: str) -> dict[str, object]:
    return {
        "id": direction_id,
        "name": f"Direction {direction_id}",
        "premise": f"A structurally distinct premise for {direction_id}.",
        "structure": {
            "silhouette_or_massing": "Large stepped masses establish a clear first read.",
            "composition_and_value": "A bright focal band separates foreground and depth.",
            "shape_grammar": "Tapered wedges repeat at primary structural joints.",
            "material_and_edge_language": "Matte surfaces use deliberate hard and soft edges.",
            "lighting_and_camera": "Top-left key light supports an orthographic camera.",
            "signature_motif": "A split-chevron motif repeats only at hierarchy anchors.",
        },
        "benefit": "Keeps the functional focal point readable at target scale.",
        "production_feasibility": "Can be built from reusable layered modules.",
        "risks": ["The motif may become too repetitive without a controlled range."],
        "distinctive_difference": f"Uses a different massing and value strategy from the other directions ({direction_id}).",
    }


def concept_packet() -> dict[str, object]:
    return {
        "version": "concept-packet/v1",
        "project": {"id": "project-aurora", "name": "Aurora Test"},
        "visual_basis": {
            "id": "basis-dev-workspace-v1",
            "status": "GROUNDED",
            "evidence_card_ids": ["product-1", "product-2", "product-3"],
            "model_prior_used_as_evidence": False,
        },
        "visual_thesis": "Use disciplined stepped masses and luminous focal contrast to make the tool feel optimistic and dependable.",
        "reference_role_map": {
            "ref-style-01": {
                "role": "STYLE",
                "transfer_mechanism": "Transfer the restrained value grouping.",
                "prohibited_influence": "Do not copy its subject silhouette or exact palette.",
            }
        },
        "directions": [
            direction("aurora-a"),
            direction("aurora-b"),
            direction("aurora-c"),
        ],
        "selected_direction_id": "aurora-b",
        "locked": ["Readable focal hierarchy at gameplay scale."],
        "controlled": ["Accent color may vary within the approved range."],
        "open": ["Confirm the damaged-state edge treatment in the style frame."],
        "prohibited": ["Photorealistic texture and reference imitation."],
        "production_risks": [
            {
                "id": "risk-01",
                "risk": "Small details may collapse on mobile displays.",
                "impact": "The first read could become ambiguous.",
                "mitigation": "Test silhouette and value keys at target scale.",
                "owner": "art-director",
            }
        ],
        "target_context": {
            "audience": "Players scanning a mobile gameplay HUD.",
            "platform": "mobile",
            "camera": "orthographic three-quarter",
            "scale": "64px focal object",
            "use_case": "in-game selection and state comparison",
        },
        "handoff_metadata": {
            "packet_id": "packet-aurora-001",
            "sender": "concept-artist",
            "recipient": "art-director",
            "revision": "r1",
            "created_at": "2026-08-10T00:00:00Z",
        },
    }


def art_gates(concept: dict[str, object], status: str = "PASS") -> dict[str, object]:
    project = concept["project"]
    packet = concept["handoff_metadata"]
    assert isinstance(project, dict)
    assert isinstance(packet, dict)
    gates = {
        name: {
            "applicable": True,
            "required": True,
            "status": status,
            "evidence": [f"evidence/{name}.json"],
            "owner": "art-director",
            "next_action": "none"
            if status == "PASS"
            else "Run the next corrective test.",
        }
        for name in (
            "concept-packet",
            "style-frame",
            "representative-family",
            "production",
        )
    }
    return {
        "version": "art-direction-gates/v1",
        "project": project,
        "visual_basis": concept["visual_basis"],
        "concept_packet": {
            "packet_id": packet["packet_id"],
            "version": concept["version"],
            "project_id": project["id"],
            "selected_direction_id": concept["selected_direction_id"],
        },
        "style_dna": {
            "artifact_id": "style-dna-aurora-001",
            "version": "style-dna/v1",
            "status": "APPROVED",
            "evidence": ["artifacts/style-dna.json"],
        },
        "gates": gates,
    }


def write_json(tmp_path: Path, name: str, value: dict[str, object]) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def evidence_args(tmp_path: Path) -> list[str]:
    cards_dir = tmp_path / "cards"
    cards_dir.mkdir(exist_ok=True)
    cards = [evidence_card(f"product-{index}") for index in range(1, 4)]
    for card in cards:
        (cards_dir / f"{card['id']}.json").write_text(
            json.dumps(card), encoding="utf-8"
        )
    basis = visual_basis([str(card["id"]) for card in cards])
    basis_path = tmp_path / "visual-basis.json"
    basis_path.write_text(json.dumps(basis), encoding="utf-8")
    return ["--visual-basis", str(basis_path), "--cards-dir", str(cards_dir)]


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def output(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    assert result.stderr == "", result.stderr
    return json.loads(result.stdout)


def test_validate_concept_accepts_three_distinct_directions(tmp_path: Path) -> None:
    concept = write_json(tmp_path, "concept.json", concept_packet())

    result = run_tool("validate-concept", str(concept))

    assert result.returncode == 0
    assert output(result) == {
        "blocking_reasons": [],
        "command": "validate-concept",
        "errors": [],
        "generation_allowed": None,
        "valid": True,
    }


def test_validate_concept_rejects_fewer_than_three_directions(tmp_path: Path) -> None:
    value = concept_packet()
    value["directions"] = value["directions"][:2]
    concept = write_json(tmp_path, "concept.json", value)

    result = run_tool("validate-concept", str(concept))

    assert result.returncode != 0
    assert "directions" in output(result)["errors"][0]


def test_validate_concept_rejects_duplicate_and_missing_selected_ids(
    tmp_path: Path,
) -> None:
    value = concept_packet()
    value["directions"][2]["id"] = value["directions"][1]["id"]
    value["selected_direction_id"] = "missing"
    concept = write_json(tmp_path, "concept.json", value)

    result = run_tool("validate-concept", str(concept))
    errors = output(result)["errors"]

    assert result.returncode != 0
    assert any("unique" in error for error in errors)
    assert any("existing direction" in error for error in errors)


def test_validate_handoff_rejects_mismatched_project_packet_and_selected_refs(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    art_value = art_gates(concept_value)
    art_value["project"] = {"id": "other-project", "name": "Other"}
    art_value["concept_packet"]["packet_id"] = "other-packet"
    art_value["concept_packet"]["selected_direction_id"] = "aurora-a"
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_value)

    result = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )
    errors = output(result)["errors"]

    assert result.returncode != 0
    assert any("project.id mismatch" in error for error in errors)
    assert any("packet_id" in error for error in errors)
    assert any("selected_direction_id" in error for error in errors)


def test_concerns_and_fail_block_generation(tmp_path: Path) -> None:
    concept_value = concept_packet()
    concept = write_json(tmp_path, "concept.json", concept_value)
    for status in ("CONCERNS", "FAIL"):
        art = write_json(
            tmp_path, f"art-{status}.json", art_gates(concept_value, status)
        )

        result = run_tool(
            "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
        )
        document = output(result)

        assert result.returncode != 0
        assert document["valid"] is True
        assert document["generation_allowed"] is False
        assert document["blocking_reasons"]


def test_all_required_applicable_pass_gates_allow_generation(tmp_path: Path) -> None:
    concept_value = concept_packet()
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_gates(concept_value))

    first = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )
    second = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )

    assert first.returncode == 0
    assert first.stdout == second.stdout
    assert output(first)["generation_allowed"] is True


def test_all_required_applicable_pass_gates_with_draft_style_dna_block_generation(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    art_value = art_gates(concept_value)
    art_value["style_dna"]["status"] = "DRAFT"
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_value)

    result = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )
    document = output(result)

    assert result.returncode != 0
    assert document["valid"] is True
    assert document["generation_allowed"] is False
    assert document["blocking_reasons"] == [
        "style_dna.status is DRAFT; generation requires exactly APPROVED"
    ]


def test_missing_style_dna_status_is_a_deterministic_blocker(tmp_path: Path) -> None:
    concept_value = concept_packet()
    art_value = art_gates(concept_value)
    del art_value["style_dna"]["status"]
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_value)

    result = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )
    document = output(result)

    assert result.returncode != 0
    assert document["generation_allowed"] is False
    assert document["blocking_reasons"] == [
        "style_dna.status is missing; generation requires exactly APPROVED"
    ]


def test_rejected_and_malformed_style_dna_statuses_are_blockers(tmp_path: Path) -> None:
    concept_value = concept_packet()
    concept = write_json(tmp_path, "concept.json", concept_value)
    cases = {
        "rejected": "REJECTED",
        "malformed": {"unexpected": "value"},
    }

    for label, status in cases.items():
        art_value = art_gates(concept_value)
        art_value["style_dna"]["status"] = status
        art = write_json(tmp_path, f"art-{label}.json", art_value)

        result = run_tool(
            "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
        )
        document = output(result)

        assert result.returncode != 0
        assert document["generation_allowed"] is False
        assert any(
            "style_dna.status" in reason for reason in document["blocking_reasons"]
        )


def test_non_applicable_gate_does_not_block_generation(tmp_path: Path) -> None:
    concept_value = concept_packet()
    art_value = art_gates(concept_value)
    art_value["gates"]["style-frame"]["applicable"] = False
    art_value["gates"]["style-frame"]["required"] = False
    art_value["gates"]["style-frame"]["status"] = "CONCERNS"
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_value)

    result = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )

    assert result.returncode == 0
    assert output(result)["generation_allowed"] is True


def test_validate_art_rejects_generation_blockers_and_invalid_schema(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    cases = {
        "concerns": art_gates(concept_value, "CONCERNS"),
        "fail": art_gates(concept_value, "FAIL"),
        "draft": art_gates(concept_value),
        "missing-gate": art_gates(concept_value),
        "missing-status": art_gates(concept_value),
    }
    cases["draft"]["style_dna"]["status"] = "DRAFT"
    del cases["missing-gate"]["gates"]["production"]
    del cases["missing-status"]["style_dna"]["status"]

    for label, art_value in cases.items():
        art = write_json(tmp_path, f"art-{label}.json", art_value)

        result = run_tool("validate-art", str(art), *evidence_args(tmp_path))
        document = output(result)

        assert result.returncode != 0
        assert document["generation_allowed"] is False
        assert document["blocking_reasons"]


def test_validate_art_approves_only_approved_style_and_all_pass_gates(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    art = write_json(tmp_path, "art.json", art_gates(concept_value))

    first = run_tool("validate-art", str(art), *evidence_args(tmp_path))
    second = run_tool("validate-art", str(art), *evidence_args(tmp_path))

    assert first.returncode == 0
    assert first.stdout == second.stdout
    assert output(first)["generation_allowed"] is True


def test_valid_creative_handoff_without_visual_evidence_bundle_is_blocked(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_gates(concept_value))

    result = run_tool("validate-handoff", str(concept), str(art))
    document = output(result)

    assert result.returncode != 0
    assert document["generation_allowed"] is False
    assert any(
        "validated visual evidence bundle is required" in reason
        for reason in document["blocking_reasons"]
    )


def test_creative_handoff_rejects_artifact_binding_that_does_not_match_validated_basis(
    tmp_path: Path,
) -> None:
    concept_value = concept_packet()
    art_value = art_gates(concept_value)
    art_value["visual_basis"] = {
        "id": "different-basis",
        "status": "GROUNDED",
        "evidence_card_ids": ["product-1", "product-2", "product-3"],
        "model_prior_used_as_evidence": False,
    }
    concept = write_json(tmp_path, "concept.json", concept_value)
    art = write_json(tmp_path, "art.json", art_value)

    result = run_tool(
        "validate-handoff", str(concept), str(art), *evidence_args(tmp_path)
    )
    document = output(result)

    assert result.returncode != 0
    assert document["generation_allowed"] is False
    errors = " ".join(document["errors"])
    assert (
        "visual_basis.id mismatch" in errors
        or "does not match validated visual basis" in errors
    )
