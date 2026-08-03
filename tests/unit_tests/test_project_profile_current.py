import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_checked_in_project_profile_matches_deterministic_filesystem_facts():
    profile = json.loads(
        (ROOT / ".forgewright" / "project-profile.json").read_text(encoding="utf-8")
    )
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    assert profile == {
        "schema_version": 1,
        "facts": {
            "git_present": True,
            "package_json_present": True,
            "lockfiles": ["package-lock.json"],
            "declared_test_script": package["scripts"]["test"],
        },
    }
    assert json.loads(
        (ROOT / ".forgewright" / "project.json").read_text(encoding="utf-8")
    ) == {"schema_version": 1}
