from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def runner_module():
    spec = importlib.util.spec_from_file_location(
        "parallel_dispatch_runner",
        ROOT / "scripts" / "parallel-dispatch-runner.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packet(skill_name: str, skill_path: str, *, handoff_type: str) -> dict[str, object]:
    return {
        "mode": "creative",
        "skill_name": skill_name,
        "skill_path": skill_path,
        "input_artifacts": ["brief.json", "reference-board.json"],
        "output_artifacts": ["selected-concept.json"],
        "handoff_type": handoff_type,
        "acceptance_checks": ["preserve thesis", "record production risks"],
    }


def request_with_packets() -> dict[str, object]:
    return {
        "task_id": "creative-dispatch",
        "task_size": "large",
        "serial": False,
        "requirements": "Route independent creative lanes.",
        "scopes": [
            {
                "id": "concept",
                "paths": ["art/concepts"],
                "independent": True,
                "risk_signals": [],
                "packet": packet(
                    "concept-artist",
                    "skills/concept-artist/SKILL.md",
                    handoff_type="concept-to-direction",
                ),
            },
            {
                "id": "direction",
                "paths": ["art/direction"],
                "independent": True,
                "risk_signals": [],
                "packet": packet(
                    "art-director",
                    "skills/art-director/LITE.md",
                    handoff_type="direction-to-production",
                ),
            },
        ],
        "limits": {
            "concurrency": 2,
            "remaining_token_budget": 4_000,
            "worker_token_budget": 2_000,
            "deadline_ms": 30_000,
        },
    }


def collaboration_activation() -> dict[str, object]:
    return {
        "mode": "bounded-advisory",
        "profile": "concept-art-direction/v1",
        "participants": ["concept-artist", "art-director"],
        "purpose": "Compare concept direction and production risks.",
        "frozen_inputs": True,
        "fallback": "parent-serial",
        "artifact_refs": [
            {
                "uri": "artifact://creative-dispatch/brief.json",
                "sha256": "a" * 64,
                "media_type": "application/json",
                "schema": "brief/v1",
            }
        ],
    }


def manifest(request: dict[str, object], workspace: Path = ROOT) -> dict[str, object]:
    return {
        "version": 1,
        "request": {**request, "workspace": str(workspace)},
        "provider": {"cli": "agy"},
    }


def test_policy_preserves_valid_creative_packets_and_is_deterministic() -> None:
    from scripts.runtime.orchestration_policy import decide_orchestration

    request = request_with_packets()
    first = decide_orchestration(request)
    second = decide_orchestration(request)

    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert [worker["scope_id"] for worker in first["workers"]] == [
        "concept",
        "direction",
    ]
    assert first["workers"][0]["packet"] == request["scopes"][0]["packet"]
    assert first["workers"][1]["packet"] == request["scopes"][1]["packet"]


def test_legacy_scope_without_packet_remains_compatible() -> None:
    from scripts.runtime.orchestration_policy import decide_orchestration

    request = request_with_packets()
    request["scopes"] = [
        {
            "id": "legacy-a",
            "paths": ["src/a"],
            "independent": True,
            "risk_signals": [],
        },
        {
            "id": "legacy-b",
            "paths": ["src/b"],
            "independent": True,
            "risk_signals": [],
        },
    ]

    decision = decide_orchestration(request)

    assert decision["worker_count"] == 2
    assert all("packet" not in worker for worker in decision["workers"])


@pytest.mark.parametrize(
    "bad_packet, message",
    [
        (
            {
                "skill_name": "concept-artist",
                "skill_path": "skills/../outside/SKILL.md",
            },
            "skill_path",
        ),
        (
            {"skill_name": "concept-artist"},
            "must appear together",
        ),
        (
            {"creative_packet": "unknown"},
            "unknown packet field/type",
        ),
    ],
)
def test_policy_rejects_unsafe_or_unknown_packet_contract(
    bad_packet: dict[str, object], message: str
) -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    request["scopes"][0]["packet"] = bad_packet

    with pytest.raises(PolicyError, match=message):
        decide_orchestration(request)


def test_runner_rejects_missing_skill_and_symlink_escape(tmp_path: Path) -> None:
    runner = runner_module()
    missing = request_with_packets()
    missing["scopes"][0]["packet"] = packet(
        "missing-skill",
        "skills/missing-skill/SKILL.md",
        handoff_type="missing",
    )
    with pytest.raises(runner.ManifestError, match="existing file"):
        runner.build_plan(manifest(missing), ROOT)

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / "skills").symlink_to(outside, target_is_directory=True)
    escaped = request_with_packets()
    with pytest.raises(runner.ManifestError, match="escapes"):
        runner.build_plan(manifest(escaped, workspace), ROOT)


def test_runner_propagates_prompt_and_host_owned_packet_without_reading_artifacts(
    tmp_path: Path,
) -> None:
    runner = runner_module()
    artifact = tmp_path / "artifact.txt"
    artifact.write_text("DO NOT READ THIS CONTENT", encoding="utf-8")
    request = request_with_packets()
    concept_packet = request["scopes"][0]["packet"]
    concept_packet["input_artifacts"] = [str(artifact)]

    plan = runner.build_plan(manifest(request), ROOT)
    worker = plan["workers"][0]
    prompt = worker["argv"][-1]
    native = worker["native_dispatch_packet"]

    assert "Selected skill: concept-artist" in prompt
    assert "Selected skill path: skills/concept-artist/SKILL.md" in prompt
    assert "concept-to-direction" in prompt
    assert "preserve thesis" in prompt
    assert "DO NOT READ THIS CONTENT" not in prompt
    assert "do not read, execute, or resolve artifact paths" in prompt

    assert native["adapter"] == "host-owned"
    assert native["skill"] == {
        "name": "concept-artist",
        "path": "skills/concept-artist/SKILL.md",
    }
    assert native["handoff"] == {
        "mode": "creative",
        "input_artifacts": [str(artifact)],
        "output_artifacts": ["selected-concept.json"],
        "handoff_type": "concept-to-direction",
    }
    assert native["acceptance"] == {
        "checks": ["preserve thesis", "record production risks"]
    }
    assert native["ownership"] == {
        "scope_id": "concept",
        "paths": ["art/concepts"],
    }
    assert native["recursive_spawn"] is False
    assert (
        "spawn" not in json.dumps(native).lower() or native["recursive_spawn"] is False
    )


def test_packet_lists_are_bounded() -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    request["scopes"][0]["packet"]["acceptance_checks"] = ["check"] * 33

    with pytest.raises(PolicyError, match="bounded list"):
        decide_orchestration(request)


def test_collaboration_is_opt_in_named_profile_with_parent_arbiter_plan() -> None:
    from scripts.runtime.orchestration_policy import decide_orchestration

    request = request_with_packets()
    request["collaboration"] = collaboration_activation()
    decision = decide_orchestration(request)
    collaboration = decision["collaboration_plan"]

    assert decision["decision_reason"] == "collaboration_peer_path"
    assert collaboration["status"] == "planned"
    assert collaboration["mode"] == "bounded-advisory"
    assert collaboration["fallback"] == "parent-serial"
    assert collaboration["artifact_refs"][0]["uri"].startswith("artifact://")
    assert [item["profile"] for item in collaboration["participants"]] == [
        "concept-artist",
        "art-director",
    ]
    assert collaboration["ownership"] == {
        "parent": "orchestrator",
        "decision_arbiter": "orchestrator",
        "peer_append": False,
        "peer_writes": False,
        "shared_mutable_paths": False,
        "recursive_spawn": False,
    }
    assert collaboration["transport"] == {
        "preference": "in-process",
        "mode": "parent-mediated",
        "external_agy_peer_transport": False,
    }
    assert "budget_limited" not in json.dumps(collaboration).lower()
    assert "quota" not in json.dumps(collaboration).lower()
    assert "token" not in json.dumps(collaboration).lower()


def test_legacy_decision_has_no_collaboration_output() -> None:
    from scripts.runtime.orchestration_policy import decide_orchestration

    decision = decide_orchestration(request_with_packets())
    assert "collaboration_plan" not in decision
    assert [worker["scope_id"] for worker in decision["workers"]] == [
        "concept",
        "direction",
    ]
    assert decision["stop_conditions"] == [
        "duplicate_findings",
        "scope_covered",
        "same_blocker_twice",
        "deadline_cap",
    ]
    assert set(decision) == {
        "version",
        "task_id",
        "decision_reason",
        "worker_count",
        "workers",
        "reviewer",
        "stop_conditions",
        "caps",
    }


@pytest.mark.parametrize(
    "collaboration, message",
    [
        ({**collaboration_activation(), "profile": "arbitrary"}, "unsupported"),
        (
            {**collaboration_activation(), "policy_path": "../../attacker.json"},
            "exactly",
        ),
    ],
)
def test_collaboration_rejects_untrusted_profile_or_policy_path(
    collaboration: dict[str, object], message: str
) -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    request["collaboration"] = collaboration
    with pytest.raises(PolicyError, match=message):
        decide_orchestration(request)


def test_collaboration_role_mismatch_uses_deterministic_serial_fallback() -> None:
    from scripts.runtime.orchestration_policy import decide_orchestration

    request = request_with_packets()
    request["collaboration"] = collaboration_activation()
    request["scopes"][0]["packet"] = packet(
        "art-director",
        "skills/art-director/LITE.md",
        handoff_type="wrong-role",
    )
    decision = decide_orchestration(request)
    assert decision["workers"] == []
    assert decision["decision_reason"] == "collaboration_serial_fallback"
    assert decision["collaboration_plan"]["status"] == "serial-fallback"
    assert (
        decision["collaboration_plan"]["serial_fallback_reason"]
        == "duplicate_peer_profile:art-director"
    )


@pytest.mark.parametrize(
    "value",
    [
        "concept-art-direction/v1",
        {**collaboration_activation(), "unknown": True},
    ],
)
def test_collaboration_requires_strict_activation_object(value: object) -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    request["collaboration"] = value
    with pytest.raises(PolicyError, match="exactly"):
        decide_orchestration(request)


def test_collaboration_rejects_serial_request_instead_of_empty_peer_plan() -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    request["serial"] = True
    request["collaboration"] = collaboration_activation()
    with pytest.raises(PolicyError, match="serial=true"):
        decide_orchestration(request)


def test_collaboration_requires_activation_artifact_refs_not_input_artifacts() -> None:
    from scripts.runtime.orchestration_policy import PolicyError, decide_orchestration

    request = request_with_packets()
    activation = collaboration_activation()
    activation["artifact_refs"] = []
    request["collaboration"] = activation
    with pytest.raises(PolicyError, match="artifact_refs.*non-empty"):
        decide_orchestration(request)
