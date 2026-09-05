"""Regression tests for AI Reasoning Research lessons implemented in kernel.

Validates that the 5 lessons from ChatGPT/Claude reasoning research are
properly integrated into SOLVE.md, VERIFY.md, and self-check.md.
"""

import pytest


SOLVE_PATH = "kernel/SOLVE.md"
VERIFY_PATH = "kernel/VERIFY.md"
SELF_CHECK_PATH = "skills/_shared/protocols/self-check.md"


@pytest.fixture
def solve_content():
    with open(SOLVE_PATH, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def verify_content():
    with open(VERIFY_PATH, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def selfcheck_content():
    with open(SELF_CHECK_PATH, "r", encoding="utf-8") as f:
        return f.read()


# --- Lesson 1: Reasoning Checkpoint ("Think Tool") ---
class TestLesson1ReasoningCheckpoint:
    def test_reasoning_checkpoint_in_step_6(self, solve_content):
        assert "Reasoning checkpoint" in solve_content, (
            "SOLVE step 6 must contain reasoning checkpoint"
        )

    def test_reasoning_checkpoint_asks_what_learned(self, solve_content):
        assert "What did this result tell me" in solve_content, (
            "Reasoning checkpoint must ask what was learned"
        )

    def test_reasoning_checkpoint_asks_plan_change(self, solve_content):
        assert "Does it change my plan" in solve_content, (
            "Reasoning checkpoint must ask about plan changes"
        )


# --- Lesson 2: Adversarial Review ---
class TestLesson2AdversarialReview:
    def test_adversarial_review_in_step_6(self, solve_content):
        assert "Adversarial review" in solve_content, (
            "SOLVE step 6 must contain adversarial review"
        )

    def test_adversarial_review_mentions_fresh_context(self, solve_content):
        # Check that review emphasizes seeing only diff, not reasoning
        assert "diff" in solve_content.split("Adversarial")[1].split("\n")[0].lower(), (
            "Adversarial review must mention reviewing only the diff"
        )

    def test_adversarial_review_threshold(self, solve_content):
        assert "3 changed files" in solve_content, (
            "Adversarial review must specify the threshold"
        )


# --- Lesson 3: Verification Tools > Instructions ---
class TestLesson3VerificationStrength:
    def test_narrative_claims_rule(self, verify_content):
        assert "Narrative claims" in verify_content, (
            "VERIFY must have rule about narrative claims being FALSE"
        )

    def test_narrative_claims_automatically_false(self, verify_content):
        assert "automatically FALSE" in verify_content, (
            "Narrative claims must be marked as automatically FALSE"
        )

    def test_prefer_deterministic_checks(self, verify_content):
        assert "deterministic checks" in verify_content, (
            "VERIFY must prefer deterministic checks"
        )

    def test_create_check_if_none_exists(self, verify_content):
        assert "create one before claiming" in verify_content, (
            "VERIFY must require creating a check if none exists"
        )

    def test_rule_count_is_7(self, verify_content):
        # Count rules (lines starting with number followed by dot)
        rules = [
            line
            for line in verify_content.split("\n")
            if line.strip().startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7."))
        ]
        assert len(rules) >= 7, f"VERIFY must have at least 7 rules, found {len(rules)}"


# --- Lesson 4: Risk-fit testing instead of universal TDD ceremony ---
class TestLesson4TestingFit:
    def test_test_first_is_preferred_when_regression_risk_is_material(
        self, selfcheck_content
    ):
        assert (
            "Prefer test-first for bugs, public contracts, and non-trivial behavior"
            in selfcheck_content
        )

    def test_quick_work_can_use_existing_deterministic_verifier(
        self, selfcheck_content
    ):
        assert "For clear reversible `QUICK` work" in selfcheck_content
        assert (
            "existing deterministic lint/typecheck/build/behavior check"
            in selfcheck_content
        )


# --- Lesson 5: Reset Context on Failure ---
class TestLesson5ContextReset:
    def test_stuck_rule_reset_context(self, solve_content):
        assert "Reset context" in solve_content, (
            "STUCK rule must include context reset step"
        )

    def test_stuck_rule_variant_warning(self, solve_content):
        assert "variant of a failed fix" in solve_content, (
            "STUCK rule must warn that a variant is still the same fix"
        )

    def test_stuck_rule_start_fresh(self, solve_content):
        assert "start fresh" in solve_content, "STUCK rule must advise starting fresh"

    def test_stuck_rule_has_6_steps(self, solve_content):
        stuck_section = solve_content.split("STUCK RULE")[1]
        step_count = (
            stuck_section.count("\n1.")
            + stuck_section.count("\n2.")
            + stuck_section.count("\n3.")
            + stuck_section.count("\n4.")
            + stuck_section.count("\n5.")
            + stuck_section.count("\n6.")
        )
        assert step_count >= 6, f"STUCK rule must have 6 steps, found {step_count}"


# --- Cross-cutting: Token budget compliance ---
class TestTokenBudget:
    def test_solve_under_budget(self, solve_content):
        tokens = len(solve_content) // 4
        assert tokens <= 2000, f"SOLVE.md at {tokens} tokens, should be under 2000"

    def test_verify_under_budget(self, verify_content):
        tokens = len(verify_content) // 4
        assert tokens <= 1000, f"VERIFY.md at {tokens} tokens, should be under 1000"
