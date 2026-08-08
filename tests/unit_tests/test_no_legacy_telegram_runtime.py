from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

LEGACY_PATHS = (
    ROOT / "scripts" / "telegram-listener.py",
    ROOT / "scripts" / "utilities" / "telegram-listener.py",
    ROOT / "scripts" / "task-runner.sh",
    ROOT / "scripts" / "runtime" / "task-runner.sh",
    ROOT / "_local_tmp_edits",
)

FORBIDDEN_RUNTIME_MARKERS = (
    "api.telegram.org",
    "FORGEWRIGHT_TELEGRAM_BOT_TOKEN",
    "/root/scripts/task-runner.sh",
    "send_telegram(",
    "Tiểu Mơ",
)


def test_legacy_telegram_runtime_paths_are_absent() -> None:
    for path in LEGACY_PATHS:
        assert not path.exists(), (
            f"legacy Telegram/VPS runtime path must stay removed: {path}"
        )


def test_active_scripts_do_not_reintroduce_legacy_telegram_runtime() -> None:
    scripts = ROOT / "scripts"
    active_text = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in scripts.rglob("*")
        if path.is_file() and path.suffix in {".py", ".sh", ".js", ".ts"}
    )
    for marker in FORBIDDEN_RUNTIME_MARKERS:
        assert marker not in active_text, (
            f"legacy Telegram/VPS marker reintroduced: {marker}"
        )
