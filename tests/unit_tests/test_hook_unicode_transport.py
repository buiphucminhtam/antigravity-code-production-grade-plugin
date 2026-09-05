"""Hook transports must not inherit a legacy Windows code page."""

from __future__ import annotations

import importlib
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_docs_path_sorting_preserves_unicode_under_legacy_code_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.syspath_prepend(str(ROOT / "scripts/lite"))
    module = importlib.import_module("continuity_check")
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1252")
    documents = ["docs/đường-dẫn.md"]
    assert module._node_locale_sorted_paths(documents, []) == (documents, [])


def test_stop_validator_receives_exact_unicode_independent_of_parent_locale(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.syspath_prepend(str(ROOT / "scripts/lite"))
    module = importlib.import_module("stop_gate")
    # Transport-only child: no real project evidence or approval is fabricated.
    (tmp_path / "rule-validator.py").write_text(
        "import json, sys\nvalue=json.load(sys.stdin)\nassert value['message'] == '\\u0111\\u01b0\\u1eddng'\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "__file__", str(tmp_path / "stop_gate.py"))
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1252")
    monkeypatch.setenv("PYTHONIOENCODING", "cp1252")
    valid, _diagnostic = module._validator_once(tmp_path, {"message": "đường"})
    assert valid is True
