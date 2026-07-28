from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "skills" / "_shared" / "protocols" / "game-studio-pipeline.md"
WORKFLOW = ROOT / "workflows" / "game-studio-build.md"
MODE_EXECUTION = (
    ROOT / "skills" / "production-grade" / "references" / "mode-execution.md"
)
MODE_INDEX = ROOT / "skills" / "production-grade" / "modes" / "README.md"
DESIGNER = ROOT / "skills" / "game-designer" / "LITE.md"
ENGINEER = ROOT / "skills" / "game-engineer" / "LITE.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _between(text: str, start: str, end: str) -> str:
    start_index = text.index(start)
    end_index = text.index(end, start_index + len(start))
    return text[start_index:end_index]


def _normalized(text: str) -> str:
    return " ".join(text.replace("`", "").split())


def test_protocol_defines_the_seven_phase_control_plane() -> None:
    text = _read(PROTOCOL)
    expected_rows = [
        "| 1 | Concept |",
        "| 2 | Systems Design |",
        "| 3 | Technical Setup |",
        "| 4 | Pre-Production |",
        "| 5 | Production |",
        "| 6 | Polish |",
        "| 7 | Release & Sustain |",
    ]

    positions = [text.index(row) for row in expected_rows]
    assert positions == sorted(positions)
    assert "vertical slice" in text.lower()
    assert "production/session-state/game-studio.md" in text
    assert "PASS | CONCERNS | FAIL" in text


def test_handoff_applicability_prevents_a_circular_greenfield_flow() -> None:
    protocol = _read(PROTOCOL)
    workflow = _read(WORKFLOW)
    expected_rows = [
        "| Concept | None | Phase gate record |",
        "| Systems Design | Passed Concept gate | Design-ready handoff + phase gate record |",
        "| Technical Setup | Design-ready handoff | Implementation-ready handoff + phase gate record |",
        "| Production | Design-ready and implementation-ready per story | Done handoff per story + phase gate record |",
    ]

    for row in expected_rows:
        assert row in protocol

    assert "Produce only the handoff required by the active phase" in workflow
    assert "Non-code phases close with a phase gate record" in workflow


def test_gate_applicability_and_release_evidence_are_explicit() -> None:
    protocol = _read(PROTOCOL)
    workflow = _read(WORKFLOW)
    workflow_normalized = _normalized(workflow)

    assert "Only genuinely non-applicable evidence may be marked `N/A`" in protocol
    assert "Missing applicable required evidence is always `FAIL`" in protocol
    assert "A `FAIL` cannot be accepted or waived" in protocol
    assert "release artifact identity and checksum" in protocol
    assert "publish/deployment evidence" in protocol
    assert "telemetry and crash-reporting smoke evidence" in protocol
    assert "post-release measurement and triage checkpoint" in protocol
    assert "Publish or deploy the approved artifact" in workflow_normalized


def test_studio_state_path_respects_project_overrides() -> None:
    protocol = _read(PROTOCOL)
    workflow = _read(WORKFLOW)
    mode = _read(MODE_EXECUTION)
    protocol_section = _normalized(
        _between(protocol, "## State Path Resolution", "## Entry Routing")
    )
    workflow_section = _normalized(
        _between(workflow, "2. **Open the studio state**", "3. **Plan the milestone**")
    )
    mode_section = _normalized(
        _between(
            mode,
            "2. **Open studio state**",
            "3. **Run the seven phases**",
        )
    )

    assert (
        "Read .production-grade.yaml and use an existing project-specific "
        "production or session-state path override when one is defined."
    ) in protocol_section
    assert (
        "Only when neither exists, use the default "
        "production/session-state/game-studio.md."
    ) in protocol_section
    assert (
        "Resolve .production-grade.yaml path overrides and any existing project "
        "convention first; use production/session-state/game-studio.md only as "
        "the default."
    ) in workflow_section
    assert (
        "resolve .production-grade.yaml path overrides and existing project "
        "conventions first; use production/session-state/game-studio.md only as "
        "the default."
    ) in mode_section


def test_protocol_is_codex_native_and_uses_bounded_topologies() -> None:
    text = _read(PROTOCOL)
    principles = _normalized(
        _between(text, "## Operating Principles", "## State Path Resolution")
    )

    for topology in ("serial-local", "pipeline", "fan-out/fan-in", "hierarchical"):
        assert f"`{topology}`" in text

    assert "scripts/runtime/orchestration_policy.py" in text
    assert (
        "studio roles are role lenses applied by the current agent. Do not claim "
        "that named subagents exist. Use actual subagents only when the user "
        "explicitly requests delegation or parallel agent work."
    ) in principles
    assert "Assume that named subagents exist." not in principles
    assert "Use actual subagents unless the user explicitly requests" not in principles
    assert "recursive spawn" in text
    assert "path ownership" in text


def test_parallel_game_work_uses_capability_aware_model_routing() -> None:
    protocol = _read(PROTOCOL)
    workflow = _read(WORKFLOW)
    section = _normalized(
        _between(
            protocol, "## Model-Aware Subagent Dispatch", "## Production Story Loop"
        )
    )

    assert "skills/_shared/protocols/model-tier.md" in section
    assert "scripts/parallel-dispatch-runner.py" in section
    assert "scout" in section
    assert "builder" in section
    assert "expert" in section
    assert "same-invocation structured capability probe" in section
    assert "provider-managed" in section
    assert "Do not hard-code model IDs" in protocol
    assert "independent reviewer" in section
    assert "requirements, diff, and raw evidence" in section
    assert "reserve one advisory token-budget slot" in section
    assert "spawn_agent" in workflow
    assert "fan-in" in workflow
    assert "model-tier.md" in workflow


def test_game_build_mode_and_entrypoint_use_the_protocol() -> None:
    mode = _read(MODE_EXECUTION)
    workflow = _read(WORKFLOW)

    assert "game-studio-pipeline.md" in mode
    assert "game-studio-pipeline.md" in workflow
    assert "game-test-protocol.md" in mode
    assert "quality-gate.md" in mode
    assert "task-validator.md" in mode
    assert "7 phase gates" in mode
    assert "orchestration_policy.py" in workflow


def test_game_role_overlays_define_controlled_handoffs() -> None:
    designer = _read(DESIGNER)
    engineer = _read(ENGINEER)

    assert "Game Studio Control Plane" in designer
    assert "design-ready handoff" in designer
    assert "Game Studio Control Plane" in engineer
    assert "implementation-ready handoff" in engineer
    assert "game-studio-pipeline.md" in designer
    assert "game-studio-pipeline.md" in engineer


def test_mode_index_reports_the_new_gate_model() -> None:
    text = _read(MODE_INDEX)

    assert (
        "| Game Build | `SKILL.md` → Game Build Mode | "
        "Studio control plane → role lanes → engine → QA/release | 7 |"
    ) in text
    assert "`Game Build`" in text
