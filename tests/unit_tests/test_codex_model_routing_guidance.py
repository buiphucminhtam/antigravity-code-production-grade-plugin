from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODEL_TIER = ROOT / "skills" / "_shared" / "protocols" / "model-tier.md"
KERNEL_SOLVE = ROOT / "kernel" / "SOLVE.md"
AGENTS = ROOT / "AGENTS.md"


def test_codex_gpt56_family_maps_workloads_to_role_tiers() -> None:
    protocol = MODEL_TIER.read_text(encoding="utf-8")
    kernel = KERNEL_SOLVE.read_text(encoding="utf-8")
    agents = AGENTS.read_text(encoding="utf-8")

    assert "| `expert` | Sol | Hardest problems" in protocol
    assert "| `builder` | Terra | Everyday production work" in protocol
    assert "| `scout` | Luna | High-volume workflows" in protocol

    guidance = (
        "route `expert` to Sol for the hardest problems, `builder` to Terra for "
        "everyday production work, and `scout` to Luna for high-volume workflows"
    )
    fallback = "otherwise keep provider-managed selection and omit the override"
    for generated_guidance in (kernel, agents):
        normalized = " ".join(generated_guidance.split())
        assert guidance in normalized
        assert fallback in normalized

    assert "exact model ID advertised by the current Codex runtime" in protocol
    assert (
        "If the preferred model is not advertised, keep `provider-managed` "
        "selection and omit the override" in " ".join(protocol.split())
    )
