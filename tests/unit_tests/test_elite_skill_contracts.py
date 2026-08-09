from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_four_elite_criteria_are_pipeline_owned_invariants() -> None:
    operating = read("skills/_shared/protocols/pipeline-operating-contract.md")
    pipeline = read("skills/_shared/protocols/pipeline.md")
    middleware = read("skills/_shared/protocols/middleware-chain.md")
    orchestrator = read("skills/production-grade/LITE.md")
    radar = read("skills/_shared/protocols/consulting-risk-radar.md")
    research = read("skills/_shared/protocols/research-gate.md")
    visual = read("skills/_shared/protocols/visual-grounding.md")

    assert "Pipeline-Owned Invariants" in operating
    assert "Outcome & scope consulting" in operating
    assert "Hidden-risk anticipation" in operating
    assert "Adversarial grounding & learning loop" in operating
    assert "Reference-grounded visual quality" in operating
    assert "PIPELINE_CONTEXT" in operating
    assert "Pre-Skill Loop" in operating and "Post-Skill Loop" in operating

    assert "Pipeline-Owned Operating Contract" in pipeline
    assert "Cross-domain operating behavior remains owned by the pipeline" in pipeline
    assert "OperatingPreflight" in middleware
    assert "OperatingAudit" in middleware
    assert "Pipeline Operating Preflight" in orchestrator
    assert "Operating audit" in orchestrator

    assert "used_by: [pipeline" in radar
    assert "used_by: [pipeline" in research
    assert "used_by: [pipeline" in visual
    assert "Individual skills consume" in radar
    assert "pipeline establishes the cross-cutting visual basis" in visual


def test_skill_authoring_requires_specialist_depth_not_mini_orchestrators() -> None:
    contract = read("skills/_shared/protocols/skill-specialization-contract.md")
    maker = read("skills/skill-maker/SKILL.md")
    upgrader = read("scripts/lite/upgrade-skills.py")

    for section in (
        "Domain Authority",
        "Specialist Inputs",
        "Specialist Heuristics",
        "Domain Artifacts",
        "Domain Failure Modes",
        "Domain Verifiers",
        "Handoff Contract",
    ):
        assert section in contract

    assert "senior specialist capability" in contract.lower()
    assert "not a miniature orchestrator" in contract.lower()
    assert "PIPELINE_CONTEXT" in contract
    assert "DOMAIN_FINDING" in contract
    assert "Specialist, not mini-orchestrator" in maker
    assert "skill-specialization-contract.md" in maker
    assert "ARCHITECTURE BOUNDARY" in upgrader
    assert "Do NOT duplicate those generic operating loops" in upgrader
    assert "If text could be pasted unchanged into an unrelated skill" in upgrader


def test_product_and_research_skills_are_deep_domain_specialists() -> None:
    pm = read("skills/product-manager/LITE.md")
    pm_full = read("skills/product-manager/SKILL.md")
    polymath = read("skills/polymath/LITE.md")
    polymath_full = read("skills/polymath/SKILL.md")

    assert "JTBD" in pm
    assert "KPI" in pm and "RICE/WSJF" in pm
    assert "product economics" in pm.lower()
    assert "Product Outcome Before Feature Inventory" in pm_full
    assert "Minimum Safe Scope" not in pm
    assert "Minimum Safe Scope" not in pm_full

    for term in ("HYPOTHESES", "TRIANGULATE", "DISCONFIRM", "DECISION MEMO"):
        assert term in polymath
    assert "Scope Like a Consulting Lead" not in polymath_full
    assert "RISK RADAR" not in polymath
    assert "Minimum Safe Scope" not in polymath


def test_visual_specialists_consume_pipeline_basis_and_keep_domain_depth() -> None:
    ui = read("skills/ui-designer/LITE.md")
    ui_full = read("skills/ui-designer/SKILL.md")
    art = read("skills/art-director/LITE.md")
    art_full = read("skills/art-director/SKILL.md")
    frontend = read("skills/frontend-engineer/LITE.md")
    frontend_full = read("skills/frontend-engineer/SKILL.md")

    assert "PIPELINE_CONTEXT.visual_basis" in ui
    assert "information hierarchy" in ui.lower()
    assert "Component anatomy" in ui
    assert "research-gate.md" not in ui
    assert "Pipeline Input Boundary" in ui_full

    assert "PIPELINE_CONTEXT.visual_basis" in art
    assert "Style DNA" in art
    assert "COLOR SCRIPT" in art
    assert "research-gate.md" not in art
    assert "Translate the Approved Basis into Style DNA" in art_full

    assert "rendering/data-fetching" in frontend.lower()
    assert "hydration" in frontend.lower()
    assert "State ownership" in frontend
    assert "draft UI design gate" not in frontend
    assert "Consume the Approved UI Contract" in frontend_full
    assert "TailwindCSS is the MANDATORY styling framework" not in frontend_full


def test_security_specialist_owns_formal_findings_pipeline_owns_signal_routing() -> (
    None
):
    operating = read("skills/_shared/protocols/pipeline-operating-contract.md")
    radar = read("skills/_shared/protocols/consulting-risk-radar.md")
    security = read("skills/security-engineer/LITE.md")
    security_full = read("skills/security-engineer/SKILL.md")
    harden = read("skills/production-grade/phases/harden.md")

    assert "risk_signals" in operating
    assert "SECURITY_REVIEW_REQUIRED" in radar
    assert "formal security findings" in security.lower()
    assert "STRIDE" in security
    assert "Business-logic abuse" in security
    assert "Agentic/tool trust boundary" in security
    assert "exploitability" in security.lower()
    assert "Security Attack-Surface Expansion" in security_full
    assert "Every other role must still recognize" not in security_full
    assert (
        "authority for formal OWASP/STRIDE/PII/encryption/agentic-security findings"
        in harden
    )


def test_ux_frontend_and_game_overlays_have_real_domain_decision_machinery() -> None:
    ux = read("skills/ux-researcher/LITE.md")
    frontend = read("skills/frontend-engineer/LITE.md")
    game = read("skills/game-designer/LITE.md")

    for term in (
        "Method fit",
        "Sampling / recruitment fit",
        "Bias / confounds",
        "Severity",
    ):
        assert term in ux
    assert "universal participant count" in ux.lower()
    assert "preference = usability" in ux.lower()

    for term in (
        "rendering model",
        "State ownership",
        "Async/resilience",
        "Performance/hydration",
    ):
        assert term.lower() in frontend.lower()
    assert "State duplication" in frontend

    for term in (
        "Player promise",
        "CORE LOOP",
        "SYSTEM DYNAMICS",
        "PROGRESSION",
        "ECONOMY",
        "BALANCE",
        "PLAYTEST",
    ):
        assert term in game
    assert "Feature pile instead of loop" in game
    assert "Balance by intuition" in game


def test_evidence_learning_and_quantitative_claims_remain_grounded() -> None:
    evidence = read("skills/_shared/protocols/evidence-first.md")
    dryrun = read("skills/_shared/protocols/dryrun-interceptor.md")
    audit = read("skills/_shared/protocols/critical-audit.md")
    ux_full = read("skills/ux-researcher/SKILL.md")
    game_full = read("skills/game-designer/SKILL.md")
    notebook = read("skills/notebooklm-researcher/SKILL.md")

    assert "99% confidence" not in evidence
    assert "Max 80%" not in evidence
    assert "UNVERIFIED" in evidence
    assert "Append a lesson to your SKILL.md" not in dryrun
    assert "Do **not** auto-promote" in audit
    assert "universal participant count" in ux_full
    assert "thumbs obstruct up to 33%" not in game_full
    assert "improves thumb motor performance by 9%" not in game_full
    assert "not the source itself" in notebook
    assert "pipx install notebooklm-mcp-cli" not in notebook
