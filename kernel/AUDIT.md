# AUDIT — Proportional Requirement Coverage

Audit against the **original user objective + current workspace evidence** before declaring success. The depth scales with risk and blast radius.

## QUICK
For a local, reversible change:
- Inspect the final diff and affected context.
- Confirm the explicit acceptance condition with current evidence.
- Check that no unrelated path changed.
- No matrix or full-repository reread is required.

If the changed file is itself an instruction/rule/config file whose consumer reads the whole document, read that file in full for contradictions even when the edit is small.

## STANDARD
Use a concise requirement checklist covering each material requirement, changed surface, and relevant adjacent regression risk. Expand to a matrix only if it improves traceability.

## DEEP
Use the full coverage structure where appropriate:
```text
REQUIREMENT COVERAGE MATRIX:
| # | Requirement | File(s)/surface | Covered? | Evidence |
|---|---|---|---|---|
| 1 | ... | ... | ✅ / ⚠️ / ❌ | ... |

CONTRADICTION SCAN:
| Surface | Active rule | Example/prose | Conflict? |
|---|---|---|---|
| ... | ... | ... | ✅ / ❌ |

CROSS-ENTRY CONSISTENCY:
| Concept | Surface A | Surface B | Aligned? |
|---|---|---|---|
| ... | ... | ... | ✅ / ❌ |

VERDICT: FULL COVERAGE | GAPS FOUND
```

## Rules
1. Audit material requirements, not arbitrary template rows.
2. Examples/templates must not contradict active rules; current workspace/runtime truth outranks stale prose.
3. `GAPS FOUND` requires correction or explicit blocker reporting before success.
4. Review guardrail/permission denials when they occurred; never suppress them to obtain a green verdict.
5. Do not broaden scope merely because the audit noticed optional improvements; put them under `Out of scope` / `Later`.
