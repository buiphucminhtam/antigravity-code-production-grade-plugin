from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODEL_TIER = ROOT / "skills" / "_shared" / "protocols" / "model-tier.md"
KERNEL_SOLVE = ROOT / "kernel" / "SOLVE.md"


def test_codex_gpt56_family_maps_workloads_to_role_tiers() -> None:
    protocol = MODEL_TIER.read_text(encoding="utf-8")
    kernel = KERNEL_SOLVE.read_text(encoding="utf-8")
    assert "| `expert` | Sol | Hardest problems" in protocol
    assert "| `builder` | Terra | Everyday production work" in protocol
    assert "| `scout` | Luna | High-volume workflows" in protocol

    # Provider-family mapping is intentionally lazy and protocol-local. The generic
    # boot kernel must stay provider-neutral so unrelated/weak models do not receive
    # stale provider-specific routing instructions.
    assert "GPT-5.6" not in kernel
    assert "Terra" not in kernel
    assert "Luna" not in kernel
    assert "Sol for" not in kernel

    assert "exact model ID advertised by the current Codex runtime" in protocol
    assert (
        "If the preferred model is not advertised, keep `provider-managed` "
        "selection and omit the override" in " ".join(protocol.split())
    )
