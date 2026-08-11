import yaml
import importlib.util
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".production-grade.yaml"
MODEL_TIER = ROOT / "skills" / "_shared" / "protocols" / "model-tier.md"
RESOLVER = ROOT / "scripts" / "runtime" / "codex-subagent-routing.py"
TEMPLATE = ROOT / "skills" / "_shared" / "templates" / "production-grade.yaml.tmpl"
TECHNICAL_REFERENCE = (
    ROOT / "skills" / "production-grade" / "references" / "technical-reference.md"
)


def _load_resolver():
    spec = importlib.util.spec_from_file_location("codex_subagent_routing", RESOLVER)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalized(text: str) -> str:
    return " ".join(text.replace("`", "").split())


def _assert_in_order(text: str, *fragments: str) -> None:
    positions = [text.index(fragment) for fragment in fragments]
    assert positions == sorted(positions)


def test_native_codex_default_is_luna_high_with_explicit_override_maps() -> None:
    config = yaml.safe_load(_read(CONFIG))
    codex = config["subagents"]["codex"]

    assert codex["default"] == {
        "model": "gpt-5.6-luna",
        "reasoning_effort": "high",
    }
    assert codex["tiers"] == {}
    assert codex["agent_types"] == {}


def test_model_tier_defines_precedence_and_capability_validation() -> None:
    protocol = _normalized(_read(MODEL_TIER))

    _assert_in_order(
        protocol,
        "1. Explicit user/task dispatch override.",
        "2. agent_types.<spawn_agent agent_type>.",
        "3. tiers.<scout|builder|expert>.",
        "4. default.",
        "5. Parent/provider inheritance when no configured value survives validation.",
    )
    assert "Treat configuration as preference only" in protocol
    assert "exact model and reasoning effort are advertised for that model" in protocol
    assert "Never silently substitute another model, downgrade reasoning" in protocol
    assert "If verified, report model_selection: verified" in protocol
    assert "report provider-managed and omit overrides" in protocol
    assert (
        "If runtime capability data is missing, malformed, human-readable only, or has no tier match"
        in protocol
    )
    assert "omit model/reasoning fields" in protocol


def test_codex_routing_requires_same_invocation_capability_evidence_and_audit_fields() -> (
    None
):
    protocol = _normalized(_read(MODEL_TIER))

    assert "Probe the active provider in the same authorized invocation" in protocol
    assert (
        "Accept only structured machine-readable model IDs and reasoning controls"
        in protocol
    )
    assert "Never trust a manifest-supplied capability artifact" in protocol
    assert (
        "Never add provider-specific thinking/temperature flags unless the same-invocation runtime capability surface declares support"
        in protocol
    )
    for field in (
        "tier",
        "agent type",
        "selection status",
        "preference source",
        "capability source",
        "resolved model/reasoning",
        "enforcement: advisory",
    ):
        assert field in protocol


def _capabilities(*models: dict) -> dict:
    return {"status": "available", "models": list(models)}


def test_resolver_applies_explicit_agent_type_tier_default_precedence_per_field() -> (
    None
):
    resolver = _load_resolver()
    config = {
        "subagents": {
            "codex": {
                "default": {"model": "default-model", "reasoning_effort": "low"},
                "tiers": {
                    "builder": {"model": "tier-model", "reasoning_effort": "medium"}
                },
                "agent_types": {
                    "worker": {"model": "agent-model", "reasoning_effort": "high"}
                },
            }
        }
    }
    capabilities = _capabilities(
        {"id": "explicit-model", "reasoning_efforts": ["xhigh"]},
        {"id": "agent-model", "reasoning_efforts": ["high"]},
        {"id": "tier-model", "reasoning_efforts": ["medium"]},
        {"id": "default-model", "reasoning_efforts": ["low"]},
    )

    result = resolver.resolve_routing(
        config,
        capabilities,
        tier="builder",
        agent_type="worker",
        overrides={"model": "explicit-model", "reasoning_effort": "xhigh"},
    )

    assert result["spawn_agent_args"] == {
        "model": "explicit-model",
        "reasoning_effort": "xhigh",
    }
    assert result["model_selection"] == "verified"
    assert result["audit"]["preference_source"] == {
        "model": "explicit",
        "reasoning_effort": "explicit",
    }


def test_resolver_resolves_fields_independently_and_supports_partial_overrides() -> (
    None
):
    resolver = _load_resolver()
    config = {
        "subagents": {
            "codex": {
                "default": {"reasoning_effort": "low"},
                "tiers": {"builder": {"reasoning_effort": "medium"}},
                "agent_types": {"worker": {"model": "agent-model"}},
            }
        }
    }
    result = resolver.resolve_routing(
        config,
        _capabilities({"id": "agent-model", "reasoning_efforts": ["medium"]}),
        tier="builder",
        agent_type="worker",
    )

    assert result["spawn_agent_args"] == {
        "model": "agent-model",
        "reasoning_effort": "medium",
    }
    assert result["audit"]["preference_source"] == {
        "model": "agent_type",
        "reasoning_effort": "tier",
    }


def test_resolver_omits_unsupported_effort_without_substituting_and_rejects_model() -> (
    None
):
    resolver = _load_resolver()
    config = {
        "subagents": {
            "codex": {"default": {"model": "luna", "reasoning_effort": "high"}}
        }
    }

    partial = resolver.resolve_routing(
        config,
        _capabilities({"id": "luna", "reasoning_efforts": ["medium"]}),
    )
    assert partial["spawn_agent_args"] == {"model": "luna"}
    assert partial["model_selection"] == "provider-managed"
    assert "reasoning_effort" in partial["audit"]["omitted"]

    unsupported = resolver.resolve_routing(
        config,
        _capabilities({"id": "terra", "reasoning_efforts": ["high"]}),
    )
    assert unsupported["spawn_agent_args"] == {}
    assert unsupported["model_selection"] == "provider-managed"
    assert "luna" not in json.dumps(unsupported["spawn_agent_args"])


def test_resolver_handles_malformed_or_missing_config_and_capabilities() -> None:
    resolver = _load_resolver()
    missing_config = resolver.resolve_routing(None, _capabilities({"id": "luna"}))
    assert missing_config["spawn_agent_args"] == {}
    assert missing_config["model_selection"] == "provider-managed"

    malformed_capabilities = resolver.resolve_routing(
        {
            "subagents": {
                "codex": {"default": {"model": "luna", "reasoning_effort": "high"}}
            }
        },
        {"status": "available", "models": "human-readable only"},
    )
    assert malformed_capabilities["spawn_agent_args"] == {}
    assert malformed_capabilities["model_selection"] == "provider-managed"

    explicit_with_bad_config = resolver.resolve_routing(
        {"subagents": []},
        _capabilities({"id": "explicit", "reasoning_efforts": ["high"]}),
        overrides={"model": "explicit", "reasoning_effort": "high"},
    )
    assert explicit_with_bad_config["spawn_agent_args"] == {
        "model": "explicit",
        "reasoning_effort": "high",
    }


def test_luna_high_default_is_verified_only_for_exact_capability_pair() -> None:
    resolver = _load_resolver()
    config = yaml.safe_load(_read(CONFIG))
    result = resolver.resolve_routing(
        config,
        _capabilities({"id": "gpt-5.6-luna", "reasoning_efforts": ["high"]}),
    )
    assert result["spawn_agent_args"] == {
        "model": "gpt-5.6-luna",
        "reasoning_effort": "high",
    }
    assert result["model_selection"] == "verified"


def test_cli_emits_spawn_args_and_audit_json(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        "subagents:\n  codex:\n    default:\n      model: cli-model\n      reasoning_effort: high\n    tiers: {}\n    agent_types: {}\n",
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            sys.executable,
            str(RESOLVER),
            "--config",
            str(config),
            "--capabilities-json",
            json.dumps(
                _capabilities({"id": "cli-model", "reasoning_efforts": ["high"]})
            ),
            "--tier",
            "builder",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    output = json.loads(completed.stdout)
    assert output["spawn_agent_args"] == {
        "model": "cli-model",
        "reasoning_effort": "high",
    }
    assert output["audit"]["capability_source"] == "active spawn_agent schema"


def test_template_and_reference_keep_comment_examples_but_parse_maps_as_mappings() -> (
    None
):
    for path in (TEMPLATE, TECHNICAL_REFERENCE):
        text = _read(path)
        assert "tiers: {}" in text
        assert "agent_types: {}" in text
        assert "# expert:" in text or "# builder:" in text
