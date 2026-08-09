from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs" / "active-roadmap.md"
ADR = ROOT / "docs" / "adr" / "ADR-009-live-routing-evidence.md"


def test_roadmap_uses_zero_cost_provider_native_policy() -> None:
    roadmap = ROADMAP.read_text(encoding="utf-8")
    routing_policy = roadmap.split("## Provider-Native Routing Policy", 1)[1].split(
        "## Delivery Phases", 1
    )[0]
    assert "one provider adapter" in routing_policy
    assert "GitHub Actions" not in routing_policy
    assert "hosted execution remain" not in routing_policy
    assert "GPT-5.6 Luna" not in routing_policy
    assert "GPT-5.6 Terra" not in routing_policy
    assert "GPT-5.6 Sol" not in routing_policy


def test_provider_adapter_owns_ecosystem_specific_behavior() -> None:
    adr = ADR.read_text(encoding="utf-8")
    assert "one selected provider ecosystem" in adr
    assert "model names to core routing logic" in adr
    assert "cross-provider services are neither required" in adr
    assert (
        "cannot satisfy live evidence by signing only the fields it just produced"
        in adr
    )


def test_repository_keeps_hosted_execution_out_of_the_canonical_path() -> None:
    assert not (ROOT / ".github" / "workflows").exists()
    assert not (ROOT / ".gitlab-ci.yml").exists()
    local_ci = (ROOT / "scripts" / "ci" / "local-ci.py").read_text(encoding="utf-8")
    assert "scripts/parallel-dispatch-runner.py" not in local_ci
    assert "scripts/lite/escalate.sh" not in local_ci
    assert "forgewright-local-ci/v1" in local_ci
