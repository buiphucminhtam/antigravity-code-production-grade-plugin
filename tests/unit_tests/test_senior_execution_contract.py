import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return ""
    return text.split("---\n", 2)[1]


def test_kernel_is_senior_grounded_and_proportional():
    entry = _read("kernel/ENTRY.md")
    solve = _read("kernel/SOLVE.md")

    assert "Hard Rules (The Only 6)" in entry
    assert "senior specialist" in entry.lower()
    assert "workspace/runtime evidence" in entry.lower()
    assert "smallest adequate process and architecture" in entry.lower()
    assert (
        "Examples, templates, memory, and prior sessions are not current-state evidence"
        in entry
    )

    assert "## 2.5 RIGHT-SIZE" in solve
    assert "`QUICK`" in solve and "`STANDARD`" in solve and "`DEEP`" in solve
    assert "Optimization requires" in solve
    assert "Do not create pipeline work after acceptance is met" in solve
    assert "No mandatory per-turn memory writes" in solve
    assert "Memory Load (MANDATORY" not in entry
    assert "TURN-CLOSE" not in solve
    assert "Always follow all steps" not in solve
    assert "Write this scratchpad" not in solve
    assert "GPT-5.6" not in solve
    assert "Terra" not in solve and "Luna" not in solve and "Sol for" not in solve
    assert "local, reversible `QUICK` edit" in entry


def test_kernel_verification_audit_and_escalation_are_proportional():
    verify = _read("kernel/VERIFY.md")
    audit = _read("kernel/AUDIT.md")
    escalate = _read("kernel/ESCALATE.md")
    clarify = _read("kernel/CLARIFY.md")

    assert "QUICK — Compact Evidence" in verify
    assert "full matrix is not mandatory" in verify
    assert "## QUICK" in audit and "No matrix" in audit
    assert "risk/uncertainty" in escalate
    assert "never pins a provider, model ID" in escalate
    assert "spawns the strong model" not in escalate
    assert "material unknown" in clarify
    assert "guide, not a mandatory interview" in clarify


def test_shared_contract_separates_competence_from_model_tier():
    contract = _read("skills/_shared/protocols/senior-execution-contract.md")
    model_tier = _read("skills/_shared/protocols/model-tier.md")

    assert "Seniority is judgment, not ceremony" in contract
    assert "not competence levels" in contract
    assert "Optimization Gate" in contract
    assert "speculative microservices" in contract
    assert "current workspace/runtime evidence" in contract.lower()
    assert "must not invent or\nhard-code" in model_tier


def test_plan_quality_has_quick_fast_path_without_fake_confidence_target():
    protocol = _read("skills/_shared/protocols/plan-quality-loop.md")
    production = _read("skills/production-grade/SKILL.md")
    config = _read(".production-grade.yaml")

    assert "`QUICK` fast path" in protocol
    assert "Do not numeric-score" in protocol
    assert "99% empirical confidence" not in protocol
    assert "Verification Fit" in protocol
    assert "blanket 9.0" in production
    assert "default to **Senior (8)**" in production
    assert re.search(r"^codingLevel:\s*8\s*$", config, re.MULTILINE)
    assert (
        "No exceptions — every skill plans first, scores, improves until ≥ 9.0"
        not in production
    )


def test_core_roles_do_not_force_process_or_speculative_architecture():
    pm = _read("skills/product-manager/SKILL.md")
    engineer = _read("skills/software-engineer/SKILL.md")
    architect = _read("skills/solution-architect/SKILL.md")
    qa = _read("skills/qa-engineer/SKILL.md")
    bug_role = _read("skills/" + "debug" + "ger/SKILL.md")
    fullstack = _read("skills/fullstack-engineer/SKILL.md")
    ba = _read("skills/business-analyst/SKILL.md")
    ai_engineer_lite = _read("skills/ai-engineer/LITE.md")
    ai_behavior = _read("skills/ai-behavior-engineer/SKILL.md")
    ai_behavior_lite = _read("skills/ai-behavior-engineer/LITE.md")

    assert "Every Project Needs a BRD" not in pm
    assert "Every project gets a BRD. No exceptions" not in pm
    assert "Circuit breakers everywhere" not in engineer
    assert "Every query must include tenant_id" not in engineer
    assert "Every architectural decision gets an ADR" not in architect
    assert "### Required ADRs" not in architect
    assert (
        "Many (50+)" not in qa and "Some (10-20)" not in qa and "Few (5-10)" not in qa
    )
    assert "NEVER ASSUME A BUG IS SIMPLE" not in bug_role
    assert "Circuit breakers everywhere" not in fullstack
    assert "Every query must include tenant_id" not in fullstack
    assert "Ambiguity Score" not in ba
    assert "Completeness Score" not in ba
    assert "3-5 questions per elicitation round" not in ba
    assert "Client must choose" not in ba
    assert "Gemini 3.1 Pro" not in ai_engineer_lite
    assert "Gemini 3.5 Flash" not in ai_engineer_lite
    assert "Thought Signatures" not in ai_engineer_lite
    assert "game AI" in ai_behavior_lite
    assert "FSM" in ai_behavior_lite and "GOAP" in ai_behavior_lite
    assert "LLM provider routing" in ai_behavior_lite
    assert "Gemini" not in ai_behavior_lite
    assert "Use the Simplest Adequate Decision Model" in ai_behavior


def test_pipeline_surfaces_share_canonical_phases_without_ceremony():
    protocol = _read("skills/_shared/protocols/pipeline.md")
    docs = _read("docs/pipeline-reference.md")
    workflow = _read(".agent/workflows/pipeline.md")
    canonical = "INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN"

    for surface in (protocol, docs, workflow):
        assert canonical in surface
        assert "QUICK" in surface and "STANDARD" in surface and "DEEP" in surface

    assert "[PIPELINE_RESET]" not in protocol
    assert "score >= 9.0" not in protocol
    assert "score ≥ 9.0" not in protocol
    assert "Status: Placeholder" not in docs
    assert "DEFINE → BUILD → HARDEN → SHIP → SUSTAIN" in workflow
    assert "Do not run every phase as a mandatory work package" in workflow


def test_full_mode_and_activation_cannot_override_runtime_contract():
    production = _read("skills/production-grade/SKILL.md")
    activation = _read("skills/_shared/protocols/pipeline-activation.md")
    mode_execution = _read("skills/production-grade/references/mode-execution.md")
    mode_index = _read("skills/production-grade/modes/README.md")
    preflight = _read("scripts/ci/pipeline-preflight.sh")
    antigravity = _read("antigravity/README.md")
    qa = _read("skills/qa-engineer/SKILL.md")
    index_generator = _read("scripts/lite/upgrade-skills.py")
    skill_index = _read("kernel/INDEX.md")

    for surface in (production, activation, preflight):
        assert "[PIPELINE_RESET]" not in surface

    assert "Assign optimal Claude model tier" not in production
    assert "MANDATORY RULE: GEMINI" not in production
    assert "Ambiguity Score" not in production
    assert "No hard limit" not in production
    assert "file:///Users/" not in production
    assert "file:///Users/" not in qa
    assert "file:///Users/" not in index_generator
    assert "file:///Users/" not in skill_index
    assert "Do **not** mutate shared Forgewright skill/protocol files" in production
    assert "score ≥ 9.0 before any work begins" not in mode_execution
    assert "3+ components MUST use antigravity" not in mode_execution
    assert "Forgewright's 24 modes" in mode_index
    assert "| Goal |" in mode_index
    assert "Plan with score ≥ 9.0" not in antigravity
    assert "Senior Delivery Standard" in preflight and "RIGHT-SIZE" in preflight
    assert "`QUICK`" in activation and "numeric plan score" in activation


def test_runtime_recovery_cannot_auto_mutate_framework_skills():
    tracker = _read("scripts/runtime/forgewright-session-tracker.sh")
    migrator = _read("scripts/skills/forgewright-lesson-migrator.sh")
    recovery = _read("skills/production-grade/middleware/10-asip.md")
    memory = _read("skills/production-grade/middleware/09-memory.md")
    graceful = _read("skills/_shared/protocols/graceful-failure.md")
    verification = _read("skills/_shared/protocols/verification.md")
    middleware = _read("skills/_shared/protocols/middleware-chain.md")

    assert "Triggering forced ASIP evolution" not in tracker
    assert (
        'bash "$PROJECT_DIR/scripts/forgewright-lesson-migrator.sh" migrate'
        not in tracker
    )
    assert "FORGEWRIGHT_ALLOW_FRAMEWORK_MUTATION" in migrator
    assert "migrate-framework" in migrator
    assert "Framework skill mutation is disabled by default" in migrator
    assert "Never append session lessons into shared Forgewright" in recovery
    assert "Never migrate project/session lessons automatically" in memory
    assert "same step fails twice" in graceful.lower()
    assert "Never trigger automatic shared-skill mutation" in verification
    assert "RecoveryResearch" in middleware
    assert "CANONICAL self-improvement" not in middleware
    assert "mandatory Turn-Close" not in middleware


def test_root_skill_frontmatter_never_pins_provider_models():
    pinned = []
    for skill_file in sorted((ROOT / "skills").glob("*/SKILL.md")):
        frontmatter = _frontmatter(skill_file.read_text(encoding="utf-8"))
        if re.search(r"^model\s*:", frontmatter, re.MULTILINE):
            pinned.append(skill_file.relative_to(ROOT).as_posix())

    assert pinned == [], f"root skill frontmatter pins provider/model: {pinned}"


def test_planning_may_reason_deeply_but_execution_is_plan_locked():
    solve = _read("kernel/SOLVE.md")
    pipeline = _read("skills/_shared/protocols/pipeline-operating-contract.md")

    for content in (solve, pipeline):
        assert "PLAN_LOCKED" in content
        assert "acceptance" in content
        assert "out-of-scope" in content
        assert "replan" in content.lower()
        assert "material_assumption_invalidated" in content
        assert "same_blocker_twice" in content


def test_configuration_references_do_not_reintroduce_overengineering_defaults():
    template = _read("skills/_shared/templates/production-grade.yaml.tmpl")
    reference = _read("skills/production-grade/references/technical-reference.md")

    assert 'architecture: "modular-monolith"' in template
    assert 'cloud: ""' in template
    assert "multi_tenancy: false" in template
    assert "documentation_site: false" in template
    assert "event_driven: false" in template
    assert "max_workers: 3" in reference
    assert "`FORGEWRIGHT_MAX_RETRIES` | Max retry attempts | 2 |" in reference
    assert "Unresolvable blocker after 2 failed attempts" in reference
    assert "Each skill writes artifacts" not in reference
    assert "Mandatory memory `add`" not in reference
    assert "model: null  # resolved from current runtime capabilities" in reference
