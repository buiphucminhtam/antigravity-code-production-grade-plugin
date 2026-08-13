import json
from pathlib import Path

import jsonschema
import pytest


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schemas/docs-manifest.schema.json").read_text())


def test_docs_manifest_schema_accepts_minimal_allowlist_manifest() -> None:
    jsonschema.validate(
        {
            "schema_version": 1,
            "project": {"id": "forgewright", "title": "Forgewright"},
            "sources": [{"path": "docs", "type": "documentation"}],
            "truth": ["README.md"],
            "privacy": {"mode": "allowlist", "allow": ["docs", "README.md"]},
        },
        SCHEMA,
    )


def test_docs_manifest_schema_accepts_project_docs_contract() -> None:
    jsonschema.validate(
        {
            "schema_version": 1,
            "project": {"id": "forgewright", "title": "Forgewright"},
            "sources": [{"path": "docs", "type": "documentation"}],
            "project_docs": {
                "schema_version": 1,
                "state": "docs/project-state.json",
                "max_stale_days": 30,
            },
            "privacy": {
                "mode": "allowlist",
                "allow": ["docs", "docs/project-state.json"],
            },
        },
        SCHEMA,
    )


@pytest.mark.parametrize(
    "project_docs",
    [
        {"schema_version": 2, "state": "docs/project-state.json"},
        {"schema_version": 1, "state": "../project-state.json"},
        {"schema_version": 1, "state": r"docs\project-state.json"},
        {"schema_version": 1, "state": "docs/project-state.json", "max_stale_days": 0},
        {
            "schema_version": 1,
            "state": "docs/project-state.json",
            "max_stale_days": 366,
        },
    ],
)
def test_docs_manifest_schema_rejects_invalid_project_docs(project_docs: dict) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(
            {
                "schema_version": 1,
                "project": {"id": "forgewright", "title": "Forgewright"},
                "sources": [{"path": "docs", "type": "documentation"}],
                "project_docs": project_docs,
                "privacy": {"mode": "allowlist"},
            },
            SCHEMA,
        )


@pytest.mark.parametrize(
    "path",
    [
        "/absolute/docs",
        "../private",
        "docs/../../private",
        r"C:\private",
        r"docs\..\private",
    ],
)
def test_docs_manifest_schema_rejects_escaping_paths(path: str) -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(
            {
                "schema_version": 1,
                "project": {"id": "forgewright", "title": "Forgewright"},
                "sources": [{"path": path, "type": "documentation"}],
                "privacy": {"mode": "allowlist"},
            },
            SCHEMA,
        )
