from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_cursor_rule_directory_has_no_legacy_markdown_rules() -> None:
    legacy = sorted(
        path.name
        for path in (ROOT / ".cursor/rules").glob("*.md")
        if path.name != "RULES.md"
    )
    assert legacy == []


def test_cursor_rule_templates_emit_mdc_frontmatter() -> None:
    for relative_path in (
        "templates/cursor/rule.md.hbs",
        "templates/cursor/file-rule.hbs",
    ):
        content = read(relative_path)
        assert content.startswith("---\n")
        assert "description:" in content
        assert "globs:" in content
        assert "alwaysApply: false" in content

    template_guide = read("templates/cursor/README.md")
    assert ".cursor/rules/react.mdc" in template_guide
    assert "--output ./.cursor/rules/my-project.mdc" in template_guide
    assert ".cursor/rules/react.md`" not in template_guide
    assert "--output ./.cursor/rules/my-project.md " not in template_guide


def test_skill_maker_uses_cursor_mdc_contract() -> None:
    content = read("skills/skill-maker/SKILL.md")
    assert ".cursor/rules/<name>.mdc" in content
    assert "<rule-name>.mdc" in content
    assert ".cursor/rules/<name>.md`" not in content
    assert "<rule-name>.md    # Individual rule file" not in content
