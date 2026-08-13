import json
from pathlib import Path

import jsonschema
import pytest


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schemas/docs-project-state.schema.json").read_text())
FORMAT_CHECKER = jsonschema.FormatChecker()


def validate(value: dict) -> None:
    jsonschema.validate(value, SCHEMA, format_checker=FORMAT_CHECKER)


def project_state() -> dict:
    return {
        "schema_version": 1,
        "project": {
            "summary": "Documentation baseline.",
            "product_type": "tooling",
            "lifecycle": "active",
        },
        "structure": {
            "roots": [
                {
                    "id": "src",
                    "path": "src",
                    "kind": "directory",
                    "purpose": "Implementation.",
                    "owner": "team",
                }
            ],
            "dependencies": [],
        },
        "roadmap": [
            {
                "id": "docs-baseline",
                "title": "Document the baseline",
                "status": "planned",
                "priority": "medium",
                "owner": "team",
                "target_date": None,
                "depends_on": [],
                "references": [{"path": "README.md", "anchor": "overview"}],
            }
        ],
        "flows": [
            {
                "id": "scan-docs",
                "title": "Scan docs",
                "status": "active",
                "trigger": "A docs scan is requested.",
                "steps": [
                    {
                        "id": "load-state",
                        "name": "Load state",
                        "actor": "scanner",
                        "inputs": ["manifest"],
                        "outputs": ["catalog"],
                        "references": [],
                    }
                ],
            }
        ],
        "backlog": [
            {
                "id": "add-tests",
                "title": "Add contract tests",
                "type": "task",
                "status": "ready",
                "priority": "high",
                "owner": "team",
                "acceptance": ["Schema tests pass."],
                "references": [],
            }
        ],
        "status": {
            "lifecycle": "active",
            "health": "on_track",
            "phase": "baseline",
            "summary": "The baseline is being documented.",
            "updated_at": "2026-08-12T00:00:00Z",
            "blockers": [],
            "risks": [],
            "next_actions": [
                {
                    "id": "review-state",
                    "title": "Review the state",
                    "owner": "team",
                    "due_date": None,
                }
            ],
            "next_update_at": None,
        },
    }


def test_complete_project_state_is_valid() -> None:
    validate(project_state())


def test_schema_requires_cli_semantic_validation_for_cross_record_contracts() -> None:
    semantic = SCHEMA["x-forgewright-semantic-validation"]
    assert semantic["required"] is True
    assert "forge docs gate" in semantic["commands"]


def test_repository_canonical_project_state_is_valid() -> None:
    value = json.loads((ROOT / "docs/project-state.json").read_text())
    validate(value)


@pytest.mark.parametrize(
    "case",
    [
        "missing_status",
        "invalid_enum",
        "path_escape",
        "duplicate_id",
        "invalid_date",
        "invalid_calendar_date",
    ],
)
def test_invalid_project_state_is_rejected(case: str) -> None:
    value = project_state()
    if case == "missing_status":
        value.pop("status")
    elif case == "invalid_enum":
        value["project"]["product_type"] = "website"
    elif case == "path_escape":
        value["structure"]["roots"][0]["path"] = "../outside"
    elif case == "duplicate_id":
        value["roadmap"][0]["id"] = "same"
        duplicate = {**value["roadmap"][0]}
        value["roadmap"].append(duplicate)
    elif case == "invalid_date":
        value["status"]["updated_at"] = "not-a-date"
    else:
        value["roadmap"][0]["target_date"] = "2026-02-30"
    with pytest.raises(jsonschema.ValidationError):
        validate(value)


@pytest.mark.parametrize(
    "path", ["/tmp/state.json", "../state.json", r"docs\state.json"]
)
def test_project_state_rejects_unsafe_paths(path: str) -> None:
    value = project_state()
    value["structure"]["roots"][0]["path"] = path
    with pytest.raises(jsonschema.ValidationError):
        validate(value)
