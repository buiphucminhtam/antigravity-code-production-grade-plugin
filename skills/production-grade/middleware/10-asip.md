# Middleware 10 — Recovery Research (legacy ASIP compatibility)

> **Sources:** `skills/_shared/protocols/research-gate.md`, `skills/_shared/protocols/graceful-failure.md`
> **Hook:** `on_error()`; `after_skill()` is normally a no-op
> **Legacy name:** ASIP

The old ASIP behavior — mandatory research after failures plus automatic mutation of shared `SKILL.md` files — is deprecated. It can amplify a hallucinated diagnosis into persistent framework policy.

## Current Behavior

```text
Failure
  → capture exact evidence
  → first evidence-supported local correction (if available)
  → run the same verifier
  → same step fails twice: STOP repeated attempts
      ├─ material unknown blocks decision → Research Gate
      └─ no material unknown → escalate with evidence/options
```

## Invariants

- `QUICK` work does not acquire a numeric plan score merely to feed recovery state.
- `STANDARD` / `DEEP` plan scores may be tracked as telemetry using their applicable thresholds.
- Research is conditional on a material knowledge/evidence gap, not an attempt counter alone.
- NotebookLM, web search, or any specific research provider is optional and must be verified available before use.
- Lessons are stored in project-local state (`.forgewright/plan-lessons.md`, `.forgewright/execution-lessons.md`, decision/handoff state) when they have future value.
- **Never append session lessons into shared Forgewright `SKILL.md`/protocol files automatically.** Framework mutation requires explicit Forgewright-development scope plus regression tests/review.
- Graph/ASIP metrics may remain for backward-compatible telemetry, but a score/edge weight is not evidence that a conclusion is true.
- Do not automatically decay/reinforce a procedural rule from one unreviewed model judgment.

## State Compatibility

Existing `.forgewright/session/asip-state.json` / `.forgewright/asip-metrics.json` may be read for continuity. New code should prefer neutral fields such as:

```json
{
  "recovery": {
    "sameStepFailures": 0,
    "materialUnknown": null,
    "researchGateTriggered": false,
    "projectLessonRecorded": false,
    "frameworkMutation": false
  }
}
```

Do not require a notebook ID, skill update, or research cycle to allow recovery to finish.

## Enforcement

A failed step may continue only when one of these is true:
1. new evidence supports a specific corrected action; or
2. the Research Gate resolved a material unknown and produced a different evidence-supported action.

If neither is true after two failures, escalate. Do not run a third cosmetic variation.

## Compatibility Metrics

If legacy ASIP counters are retained, reinterpret them as observational metrics only:
- `totalResearchGates`: actual research gates opened;
- `projectLessons`: verified lessons stored locally;
- `frameworkSkillUpdates`: must remain `0` unless explicit framework-development mode was enabled and reviewed.

No metric is a completion gate by itself.
