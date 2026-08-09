#!/usr/bin/env python3
"""Fail closed when canonical automation drifts back to hosted CI providers."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN_CANONICAL_PATHS = (
    ROOT / ".github" / "workflows",
    ROOT / ".github" / "actions",
    ROOT / ".github" / "dependabot.yml",
    ROOT / ".gitlab-ci.yml",
)
FORBIDDEN_LOCAL_MARKERS = (
    "GITHUB_OUTPUT",
    "GITHUB_TOKEN",
    "CI_JOB_TOKEN",
    "CI_PROJECT_ID",
    "github.event",
    "gitlab-ci",
)
DANGEROUS_PIPE = re.compile(r"(?:curl|wget)[^\n|]*\|\s*(?:ba)?sh\b", re.IGNORECASE)
BACKGROUND_SHELL = re.compile(r"(?<![>&])&(?![&0-9])\s*$")


def main() -> int:
    errors: list[str] = []
    for path in FORBIDDEN_CANONICAL_PATHS:
        if path.exists():
            errors.append(
                f"hosted CI path must stay absent from canonical runtime: {path.relative_to(ROOT)}"
            )

    local_ci = ROOT / "scripts" / "ci" / "local-ci.py"
    launcher = ROOT / "scripts" / "ci" / "local-ci.mjs"
    hook = ROOT / ".husky" / "pre-commit"
    for required in (local_ci, launcher, hook):
        if not required.is_file():
            errors.append(
                f"required local automation file is missing: {required.relative_to(ROOT)}"
            )

    for path in sorted((ROOT / "scripts" / "ci").iterdir()):
        if not path.is_file() or path.suffix not in {".py", ".sh", ".mjs", ".js"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if path.name in {
            "release-supply-chain-policy.mjs",
            "release-supply-chain-policy.test.mjs",
            "verify-local-automation-policy.py",
        }:
            # These are generic validators that intentionally understand hosted-provider syntax.
            continue
        for marker in FORBIDDEN_LOCAL_MARKERS:
            if marker.lower() in text.lower():
                errors.append(
                    f"{path.relative_to(ROOT)} contains hosted-CI marker {marker!r}"
                )
        if DANGEROUS_PIPE.search(text):
            errors.append(
                f"{path.relative_to(ROOT)} contains an unverified download-to-shell pipeline"
            )

    if hook.is_file():
        hook_text = hook.read_text(encoding="utf-8")
        if "scripts/ci/local-ci.mjs precommit" not in hook_text:
            errors.append(
                "pre-commit hook must delegate to the canonical local CI control plane"
            )

    hooks_dir = ROOT / ".husky"
    if hooks_dir.is_dir():
        for hook_path in sorted(path for path in hooks_dir.iterdir() if path.is_file()):
            for line_number, line in enumerate(
                hook_path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1
            ):
                if BACKGROUND_SHELL.search(line):
                    errors.append(
                        f"{hook_path.relative_to(ROOT)}:{line_number} starts hidden background work; use local-ci/scheduler instead"
                    )

    if errors:
        print("local automation policy: FAIL")
        for error in errors:
            print(f" - {error}")
        return 1
    print("local automation policy: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
