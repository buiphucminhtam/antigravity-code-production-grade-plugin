import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONCEPT_LITE = ROOT / "skills" / "concept-artist" / "LITE.md"
CONCEPT_SKILL = ROOT / "skills" / "concept-artist" / "SKILL.md"
CONCEPT_REFERENCE = (
    ROOT / "skills" / "concept-artist" / "references" / "concept-development.md"
)
CONCEPT_OPENAI = ROOT / "skills" / "concept-artist" / "agents" / "openai.yaml"
ART_LITE = ROOT / "skills" / "art-director" / "LITE.md"
ART_SKILL = ROOT / "skills" / "art-director" / "SKILL.md"
ART_REFERENCE = (
    ROOT / "skills" / "art-director" / "references" / "art-direction-system.md"
)
ART_OPENAI = ROOT / "skills" / "art-director" / "agents" / "openai.yaml"
INDEX = ROOT / "kernel" / "INDEX.md"
SKILLS_CONFIG = ROOT / ".forgewright" / "skills-config.json"
WORKFLOW = ROOT / "workflows" / "game-studio-build.md"
GAME_PROTOCOL = ROOT / "skills" / "_shared" / "protocols" / "game-studio-pipeline.md"
VISUAL_EVIDENCE_PROTOCOL = (
    ROOT / "skills" / "_shared" / "protocols" / "visual-evidence-library.md"
)
VISUAL_GROUNDING = ROOT / "skills" / "_shared" / "protocols" / "visual-grounding.md"
VISUAL_FOUNDATIONS = ROOT / "skills" / "_shared" / "game-visual-foundations.md"
UI_SKILL = ROOT / "skills" / "ui-designer" / "SKILL.md"
UI_DATA_README = ROOT / "skills" / "ui-designer" / "data" / "README.md"
VISION_REVIEW_SKILL = ROOT / "skills" / "vision-review" / "SKILL.md"
VISION_REVIEW_LITE = ROOT / "skills" / "vision-review" / "LITE.md"
VISION_REVIEW_SCRIPT = ROOT / "scripts" / "art-direction" / "vision-review.sh"
VFX_SKILL = ROOT / "skills" / "game-asset-vfx" / "SKILL.md"
DESIGN_MINDSET = (
    ROOT / "skills" / "_shared" / "protocols" / "design-mindset-and-rules.md"
)
PROMPT_TEMPLATES = ROOT / "skills" / "art-director" / "prompt-templates"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalized(text: str) -> str:
    return " ".join(text.replace("`", "").split())


def _assert_in_order(text: str, *fragments: str) -> None:
    positions = [text.index(fragment) for fragment in fragments]
    assert positions == sorted(positions)


def test_concept_artist_requires_thesis_roles_axes_divergence_and_packet() -> None:
    skill = _read(CONCEPT_SKILL)
    lite = _read(CONCEPT_LITE)
    reference = _read(CONCEPT_REFERENCE)
    openai = _read(CONCEPT_OPENAI)
    combined = _normalized("\n".join((skill, lite, reference)))

    assert "one visual thesis" in combined
    for role in (
        "STYLE",
        "SUBJECT",
        "COMPOSITION",
        "MATERIAL",
        "LIGHTING",
        "CAMERA",
        "MOTION",
        "PLATFORM",
    ):
        assert role in combined
    assert "Choose 3–6 axes" in skill
    assert "at least three directions" in combined
    assert "structurally distinct" in combined
    assert "Production feasibility" in reference
    assert "selection rationale" in skill
    assert "Concept Packet" in skill
    assert 'display_name: "Concept Artist"' in openai
    assert "$concept-artist" in openai
    assert "distinct visual directions" in openai

    _assert_in_order(
        skill,
        "### 1. Frame the Design Problem",
        "### 2. Decompose References by Role",
        "### 3. Build Design Axes",
        "### 4. Diverge into Concept Families",
        "### 5. Develop from Large to Small",
        "### 6. Pressure-Test the Directions",
        "### 7. Select and Resolve",
        "### 8. Produce the Concept Packet",
    )
    _assert_in_order(
        skill,
        "1. thumbnail composition",
        "2. black silhouette or massing",
        "3. value hierarchy",
        "4. proportion and negative space",
        "5. color key and lighting key",
        "6. material/edge treatment",
        "7. identity details and callouts",
    )


def test_concept_artist_has_direction_matrix_feasibility_and_art_direction_handoff() -> (
    None
):
    skill = _read(CONCEPT_SKILL)
    reference = _read(CONCEPT_REFERENCE)
    combined = _normalized("\n".join((skill, reference)))

    assert "Direction Matrix" in reference
    assert (
        "Direction A" in reference
        and "Direction B" in reference
        and "Direction C" in reference
    )
    assert "Selection Rubric" in reference
    assert "production feasibility" in combined.lower()
    assert "extensibility" in combined.lower()
    assert "invariants" in skill and "controlled variation" in skill
    assert "prohibited drift" in skill
    assert "Handoff" in skill
    assert "hand one selected concept to Art Direction" in skill
    assert "selected concept packet" in skill
    assert "scale/camera evidence" in skill
    assert "production risks" in skill
    assert "art-director" in skill


def test_art_director_starts_after_concept_and_owns_production_visual_system() -> None:
    skill = _read(ART_SKILL)
    lite = _read(ART_LITE)
    combined = _normalized("\n".join((skill, lite)))

    assert "Consume the selected concept packet from concept-artist" in combined
    assert "Do not reopen broad concept exploration" in combined
    assert "after concept selection" in combined
    assert "Style DNA" in combined
    assert "COLOR SCRIPT" in combined
    assert "controlled variation" in combined
    assert "multi-scale" in combined.lower()
    assert "Handoff" in combined

    for gate in (
        "Concept packet gate",
        "Style frame gate",
        "Representative family gate",
        "Production gate",
    ):
        assert gate in skill
    for review_scale in (
        "thumbnail / glance",
        "gameplay / product context",
        "hero / close view",
        "family wall",
        "stress states",
    ):
        assert review_scale in skill
    assert "family bibles" in combined
    assert "generation/import contracts" in combined
    assert "real-context evidence" in combined


def test_art_director_reference_and_openai_prompt_encode_review_and_handoff_contract() -> (
    None
):
    skill = _normalized(_read(ART_SKILL))
    lite = _normalized(_read(ART_LITE))
    reference = _normalized(_read(ART_REFERENCE))
    openai = _read(ART_OPENAI)

    assert "Style DNA Record" in reference
    assert "Multi-Scale Review Rubric" in reference
    assert "controlled variation" in reference.lower()
    assert "prohibited drift" in reference.lower()
    assert "Hand off" in skill or "Send downstream roles" in skill
    assert 'display_name: "Art Director"' in openai
    assert "$art-director" in openai
    assert "Style DNA" in openai
    assert "direction gates" in openai
    assert "family rules" in openai
    assert "production-ready visual review" in openai
    assert "COLOR SCRIPT" in lite


def test_creative_skills_are_routed_across_index_config_workflow_and_protocol() -> None:
    index = _read(INDEX)
    config = json.loads(_read(SKILLS_CONFIG))
    workflow = _normalized(_read(WORKFLOW))
    protocol = _normalized(_read(GAME_PROTOCOL))

    for skill_name in ("concept-artist", "art-director"):
        assert f"**{skill_name}**" in index
        assert f"skills/{skill_name}/LITE.md" in index
        assert config["skills"][skill_name]["enabled"] == "auto"
        assert skill_name in config["auto_detect_rules"]["mode_skill_map"]["design"]
        assert skill_name in config["auto_detect_rules"]["mode_skill_map"]["game-build"]

    assert "divergent visual concepts" in workflow
    assert "selected concept packet" in workflow
    assert "approved Style DNA" in workflow
    assert "skills/_shared/protocols/model-tier.md" in workflow
    assert "subagents.codex" in workflow

    assert "Creative direction" in protocol
    assert "concept-artist" in protocol and "art-director" in protocol
    assert "skills/_shared/protocols/model-tier.md" in protocol
    assert "subagents.codex" in protocol
    assert "selected concept packet" in protocol or "approved Style DNA" in protocol
    assert "provider-managed" in protocol


def test_prompt_templates_bind_generation_to_direction_contract() -> None:
    templates = sorted(PROMPT_TEMPLATES.rglob("*.md"))
    assert templates

    required_placeholders = (
        "[APPROVED_STYLE_DNA]",
        "[REFERENCE_ROLE_MAP]",
        "[OBSERVED_OR_CREDIBLE_DRIFT]",
        "[ASSET_FAMILY]",
        "[REAL_SCALE_CONTEXT]",
        "[PLATFORM_AND_PRODUCTION_CONSTRAINTS]",
    )
    grounded_terms = (
        "reference roles",
        "Style DNA",
        "real-scale",
        "production",
        "prohibited drift",
    )

    for path in templates:
        content = _read(path)
        for placeholder in required_placeholders:
            assert placeholder in content, f"{placeholder} missing from {path}"
        normalized = _normalized(content).lower()
        assert all(term.lower() in normalized for term in grounded_terms), path
        assert (
            "non-default example" in normalized or "non-default examples" in normalized
        )


def test_prompt_templates_do_not_reintroduce_universal_aesthetic_defaults() -> None:
    templates = sorted(PROMPT_TEMPLATES.rglob("*.md"))
    forbidden_rules = (
        re.compile(r"#000000", re.IGNORECASE),
        re.compile(r"\b(?:avoid|not|never use)\s+inter\b", re.IGNORECASE),
        re.compile(r"\binter\s+font\b", re.IGNORECASE),
        re.compile(
            r"\b(?:maximum|max(?:imum)?|no more than)\s+\d+\s+colors?\b", re.IGNORECASE
        ),
        re.compile(r"\bmaximum\s+\d+\s+visible\s+fingers\b", re.IGNORECASE),
        re.compile(r"\b5[- ]finger\b", re.IGNORECASE),
        re.compile(
            r"\bauto[- ]reject\b|\bautomatic(?:ally)?\s+reject\b", re.IGNORECASE
        ),
        re.compile(r"\battach this to every\b|\bmaster list\b", re.IGNORECASE),
        re.compile(
            r"\bchoose one asymmetric\b|\bbreak symmetry\b|\bmust be asymmetric\b",
            re.IGNORECASE,
        ),
        re.compile(r"negative prompts \(never generate\)", re.IGNORECASE),
    )

    for path in templates:
        content = _read(path)
        for rule in forbidden_rules:
            assert not rule.search(content), f"{rule.pattern} reintroduced in {path}"


def test_negative_constraints_require_evidence_and_scoped_review() -> None:
    negative = _read(PROMPT_TEMPLATES / "_shared" / "negative-prompts.md")

    assert "not a universal denylist" in negative
    assert "[DRIFT_EVIDENCE]" in negative
    assert "[CORRECTIVE_MECHANISM]" in negative
    assert "[DRIFT_REVIEW_CONTEXT]" in negative
    assert "asset family, state, scale, camera, platform" in negative


def test_visual_evidence_protocol_makes_model_prior_hypothesis_only() -> None:
    evidence = _normalized(_read(VISUAL_EVIDENCE_PROTOCOL)).lower()
    grounding = _normalized(_read(VISUAL_GROUNDING)).lower()

    assert "model prior is not evidence" in evidence
    assert "used_as_evidence: false" in evidence
    assert "3 grounded evidence cards" in evidence
    assert "2 independent evidence cards" in evidence
    assert "causal_claim_allowed: false" in evidence
    assert "training memory" in grounding
    assert "evidence weight zero" in grounding


def test_visual_foundations_and_specialists_do_not_reintroduce_legacy_taste_rules() -> (
    None
):
    foundations = _normalized(_read(VISUAL_FOUNDATIONS)).lower()
    ui = _read(UI_SKILL)
    vfx = _read(VFX_SKILL)
    mindset = _normalized(_read(DESIGN_MINDSET)).lower()
    data_readme = _normalized(_read(UI_DATA_README)).lower().replace("*", "")

    assert "not a rule" in foundations
    assert "system fonts are not inherently low quality" in foundations
    assert "no universal palette ratio" in mindset
    assert "legacy aesthetic recipe csvs were removed" in data_readme
    assert "cannot authorize palette" in data_readme

    forbidden = (
        "Max 3 font sizes per screen",
        'Implement "Dark-First"',
        "Spacing system (8px grid)",
        "circle=safe",
        "triangle=danger",
        "Color theory** (60-30-10 rule",
    )
    combined = ui + "\n" + vfx
    for phrase in forbidden:
        assert phrase not in combined


def test_legacy_aesthetic_recipe_data_and_ai_tells_gate_are_retired() -> None:
    data_dir = ROOT / "skills" / "ui-designer" / "data"
    assert sorted(path.name for path in data_dir.glob("*.csv")) == []

    vision_skill = _normalized(_read(VISION_REVIEW_SKILL)).lower()
    vision_lite = _normalized(_read(VISION_REVIEW_LITE)).lower()
    vision_script = _normalized(_read(VISION_REVIEW_SCRIPT)).lower()
    for text in (vision_skill, vision_lite, vision_script):
        assert '"ai_tells"' not in text
        assert "claude vision-powered" not in text
        assert "reference_fidelity" in text
        assert "model prior" in text
        assert "scores are telemetry" in text


def test_creative_workflow_binds_handoff_to_visual_evidence_bundle() -> None:
    workflow = _normalized(_read(WORKFLOW))
    protocol = _normalized(_read(GAME_PROTOCOL))

    for text in (workflow, protocol):
        assert "--visual-basis .forgewright/visual-evidence/visual-basis.json" in text
        assert "--cards-dir .forgewright/visual-evidence/cards" in text
