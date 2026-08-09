import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ci" / "openapi-contract-check.py"


def _module():
    spec = importlib.util.spec_from_file_location("openapi_contract_check", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_detects_removed_operation_and_new_required_input() -> None:
    module = _module()
    old = {
        "paths": {
            "/users": {
                "get": {"responses": {"200": {}}},
                "post": {
                    "parameters": [{"in": "query", "name": "x", "required": False}],
                    "responses": {"201": {}},
                },
            }
        }
    }
    new = {
        "paths": {
            "/users": {
                "post": {
                    "parameters": [{"in": "query", "name": "x", "required": True}],
                    "responses": {"201": {}},
                }
            }
        }
    }
    issues = module.compare(old, new)
    assert "removed operation: GET /users" in issues
    assert "new required parameter: POST /users query:x" in issues


def test_detects_schema_breaking_changes() -> None:
    module = _module()
    old = {
        "components": {
            "schemas": {"Mode": {"enum": ["a", "b"]}, "User": {"required": ["id"]}}
        }
    }
    new = {
        "components": {
            "schemas": {"Mode": {"enum": ["a"]}, "User": {"required": ["id", "name"]}}
        }
    }
    issues = module.compare(old, new)
    assert 'removed enum value: Mode "b"' in issues
    assert "new required schema property: User.name" in issues
