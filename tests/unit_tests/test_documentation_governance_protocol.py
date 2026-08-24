"""Contract tests for documentation governance across agent entry points."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "skills/_shared/protocols/documentation-governance.md"


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_protocol_defines_pre_write_decisions_and_lifecycle_classes():
    content = PROTOCOL.read_text(encoding="utf-8")
    for marker in [
        "DOCUMENTATION_WRITE_DECISION",
        "NO_DOC",
        "UPDATE_CANONICAL",
        "CREATE_CANONICAL",
        "ARCHIVE_OR_SUPERSEDE",
        "TRANSIENT_ONLY",
        "Canonical",
        "Supporting",
        "Transient",
        "Generated",
        "Archived",
    ]:
        assert marker in content, f"documentation governance missing: {marker}"


def test_protocol_blocks_spam_scope_drift_duplication_and_stale_truth():
    content = PROTOCOL.read_text(encoding="utf-8").lower()
    for marker in [
        "duplicate",
        "outside the current scope",
        "task log",
        "stale",
        "contradict",
        "update the existing canonical",
    ]:
        assert marker in content, f"documentation governance missing: {marker}"


def test_governance_is_wired_into_agent_pipeline_and_guardrail():
    entry = read("kernel/ENTRY.md")
    pipeline = read("skills/_shared/protocols/pipeline-operating-contract.md")
    guardrail = read("skills/_shared/protocols/guardrail.md")
    writer = read("skills/technical-writer/LITE.md")
    full_writer = read("skills/technical-writer/SKILL.md")
    guide = read("docs/guides/docs-hub.md")

    assert "documentation-governance.md" in entry
    assert "documentation-governance.md" in pipeline
    assert "DOCUMENTATION_WRITE_DECISION" in pipeline
    assert "documentation-governance.md" in guardrail
    assert "duplicate or out-of-scope durable documentation" in guardrail.lower()
    assert "documentation-governance.md" in writer
    assert "documentation-governance.md" in full_writer
    assert "generate all docs from code and architecture" not in full_writer.lower()
    assert "never authorizes" in full_writer.lower()
    assert "Documentation write governance" in guide


def test_canonical_catalog_and_state_track_the_governance_rule():
    manifest = json.loads(read(".forgewright/docs-manifest.json"))
    rule_path = "skills/_shared/protocols/documentation-governance.md"
    assert rule_path in {source["path"] for source in manifest["sources"]}
    assert rule_path in manifest["privacy"]["allow"]
    assert rule_path in manifest["truth"]

    state = json.loads(read("docs/project-state.json"))
    assert any(item["id"] == "documentation-governance" for item in state["roadmap"])


def test_continuous_html_view_refreshes_at_baseline_checkpoints_and_completion():
    entry = read("kernel/ENTRY.md").lower()
    pipeline = read("skills/_shared/protocols/pipeline-operating-contract.md").lower()
    guardrail = read("skills/_shared/protocols/guardrail.md").lower()
    quality = read("skills/_shared/protocols/quality-gate.md").lower()
    guide = read("docs/guides/docs-hub.md").lower()

    for marker in ["baseline", "material checkpoint", "final"]:
        assert marker in pipeline
    assert "docs hub baseline/checkpoint/gate/final build" in entry
    assert "every material project update" in pipeline
    assert "forge docs init" in pipeline
    assert "forge docs build" in pipeline
    assert "every\nmaterial project update" in guardrail
    assert "forge docs init" in guardrail
    assert "baseline" in guardrail
    assert "material checkpoint" in guardrail
    assert "final persistent" in guardrail
    assert "forge docs build" in quality
    assert "forge docs init" in quality
    assert "continuous html refresh" in guide
    assert "every material project update" in guide
