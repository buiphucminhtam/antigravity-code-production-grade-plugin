from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skills" / "goal-driven" / "SKILL.md"
LITE = ROOT / "skills" / "goal-driven" / "LITE.md"


def test_goal_contract_has_no_default_turn_quota() -> None:
    content = SKILL.read_text(encoding="utf-8")

    assert '"max_turns"' not in content
    assert "max_turns:" not in content
    assert "Turns elapsed / max turns" not in content


def test_goal_contract_rejects_sentinel_budget_fallback() -> None:
    full = SKILL.read_text(encoding="utf-8")
    lite = LITE.read_text(encoding="utf-8")

    assert "Never use a sentinel budget such as `1`" in full
    assert "normal Codex task plan" in full
    assert "Never pass a fake positive budget such as `1`" in lite
    assert "budgetLimited" not in full
    assert "budget_limited" not in full
