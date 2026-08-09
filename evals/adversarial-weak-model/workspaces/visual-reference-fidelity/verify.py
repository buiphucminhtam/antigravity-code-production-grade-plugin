from pathlib import Path

text = Path("theme.css").read_text(encoding="utf-8")
assert "--brand-primary: #6d28d9" in text
assert "--brand-gradient:" in text
assert "background: var(--brand-gradient)" in text
assert "#059669" not in text
assert "#f8fafc" not in text.lower()
