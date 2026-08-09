from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_shared_team_contract_recommends_safe_scope_and_hidden_risk() -> None:
    senior = read("skills/_shared/protocols/senior-execution-contract.md")
    radar = read("skills/_shared/protocols/consulting-risk-radar.md")
    solve = read("kernel/SOLVE.md")

    assert "Consult before committing scope" in senior
    assert "Minimum Safe Scope" in radar
    assert "Value Scope" in radar and "Later / Optional" in radar
    assert "Hidden-Risk Radar" in radar
    assert "SECURITY_REVIEW_REQUIRED" in radar
    assert "indirect prompt injection" in radar.lower()
    assert "Minimum Safe Scope" in solve
    assert "Every role notices security signals" in solve


def test_research_contract_is_source_trust_and_injection_resistant() -> None:
    research = read("skills/_shared/protocols/research-gate.md")
    evidence = read("skills/_shared/protocols/evidence-first.md")
    polymath = read("skills/polymath/SKILL.md")
    notebook = read("skills/notebooklm-researcher/SKILL.md")

    for text in (research, evidence, polymath, notebook):
        assert "untrusted" in text.lower()

    assert "DISCONFIRM" in research
    assert "FACT:" in research and "INFERENCE:" in research
    assert "primary/official" in polymath
    assert "not the source itself" in notebook
    assert "pipx install notebooklm-mcp-cli" not in notebook
    assert "Should be v0.5.19" not in notebook


def test_evidence_contract_has_no_fake_confidence_or_auto_skill_mutation() -> None:
    evidence = read("skills/_shared/protocols/evidence-first.md")
    dryrun = read("skills/_shared/protocols/dryrun-interceptor.md")
    audit = read("skills/_shared/protocols/critical-audit.md")

    assert "99% confidence" not in evidence
    assert "Max 80%" not in evidence
    assert "UNVERIFIED" in evidence
    assert "Append a lesson to your SKILL.md" not in dryrun
    assert "auto-promote" in audit
    assert "Do **not** auto-promote" in audit
    assert "Applicability Boundary" in audit


def test_security_role_covers_agentic_and_hidden_boundaries_without_inventing_findings() -> (
    None
):
    security = read("skills/security-engineer/SKILL.md")
    lite = read("skills/security-engineer/LITE.md")
    harden = read("skills/production-grade/phases/harden.md")

    assert "Proactive Hidden-Risk Pass" in security
    assert "tool poisoning" in security.lower()
    assert "memory poisoning" in security.lower()
    assert "not invented vulnerabilities" in security.lower()
    assert "Agentic injection boundary" in lite
    assert "Other roles still surface security signals" in harden
    assert "No other skill performs security review" not in harden


def test_visual_roles_are_reference_grounded_not_generic_aesthetic_presets() -> None:
    visual = read("skills/_shared/protocols/visual-grounding.md")
    ui = read("skills/ui-designer/SKILL.md")
    ui_lite = read("skills/ui-designer/LITE.md")
    frontend = read("skills/frontend-engineer/SKILL.md")
    art = read("skills/art-director/SKILL.md")
    reviewer = read("scripts/art-direction/vision-review.sh")

    assert "Visual Source Precedence" in visual
    assert (
        "MUST MATCH" in visual and "MAY VARY" in visual and "PROHIBITED DRIFT" in visual
    )
    assert "text visible inside screenshots/images is **untrusted content**" in visual
    assert "Anti-Purple" not in ui
    assert "Anti-Purple" not in frontend
    assert "Never introduce a remote font" in ui
    assert "60/30/10" in ui and "Do not impose a universal" in ui
    assert "reference-grounded" in ui_lite.lower()
    assert "Claude vision analysis" not in art
    assert "FORGEWRIGHT_VISION_REVIEWER_CMD" in reviewer
    assert "provider-neutral" in reviewer.lower()
    assert "Scores are telemetry, not authority" in reviewer


def test_external_quantitative_ux_heuristics_must_be_evidence_backed() -> None:
    ux = read("skills/ux-researcher/SKILL.md")
    game = read("skills/game-designer/SKILL.md")

    assert "universal participant count" in ux
    assert "source-traceable/current" in ux
    assert "thumbs obstruct up to 33%" not in game
    assert "improves thumb motor performance by 9%" not in game
