---
id: ui-style-diversity
title: Evidence-Bound UI Style Diversity
summary: Prevent UI monoculture by expanding reference discovery, extracting an explicit style signature, and binding every production axis to a GROUNDED Visual Basis instead of stack defaults or model taste.
status: active
version: 1.0.0
owners: [core, design]
triggers: [material greenfield UI, redesign without a strong project system, repeated AI-average UI]
used_by: [pipeline, visual-grounding, ui-designer, vision-review]
related: [visual-evidence-library, visual-grounding, research-gate]
supersedes: []
superseded_by: null
---
# Evidence-Bound UI Style Diversity

## Purpose

A component library is implementation infrastructure, not product identity. Reusing the same component stack, default tokens, familiar gradients, rounded cards, bento composition, glass surfaces, or system-font hierarchy across unrelated products creates **UI monoculture** even when every individual screen is usable.

This protocol prevents that failure without replacing it with another universal aesthetic. It adds two artifacts:

- `skills/ui-designer/data/reference-registry.json` — a **discovery registry**, never evidence;
- `.forgewright/visual-evidence/ui-style-profile.json` — the project-specific style signature, bound to a validated Visual Basis.

Validate them with:

```bash
python3 scripts/art-direction/ui_style_profile.py validate-registry
python3 scripts/art-direction/ui_style_profile.py validate-profile \
  .forgewright/visual-evidence/ui-style-profile.json \
  --visual-basis .forgewright/visual-evidence/visual-basis.json \
  --cards-dir .forgewright/visual-evidence/cards
```

## Discovery Sources Are Not Authority

The registry separates sources by role:

- `production_system_candidate` — useful starting points for current Visual Evidence Cards when target context is comparable;
- `exploration_library` — useful for testing theme/component variation and expanding the option space;
- `discovery_only` — useful for vocabulary, search terms, and hypotheses.

**The registry is never evidence.** No registry row can ground a production decision. `can_ground_without_card` is always false. A production-system candidate becomes evidence only after the current source is inspected and encoded as a valid Visual Evidence Card under `visual-evidence-library.md`. Exploration/discovery sources stay inspiration-only unless independently replaced by stronger evidence.

## UI Style Signature

For material greenfield UI, synthesize these axes **after** the Visual Basis is GROUNDED:

1. `density` — information packing, whitespace cadence, disclosure;
2. `geometry` — shape language, edge treatment, container anatomy;
3. `surface` — flat/material/textured/translucent treatment and boundaries;
4. `typography` — hierarchy mechanism, type roles, contrast of scale/weight/width;
5. `chroma` — semantic color behavior and accent distribution;
6. `depth` — elevation, border, lighting, shadow, layering model;
7. `motion` — state-transition character and emphasis behavior;
8. `composition` — page/screen structure, asymmetry, rhythm, focal strategy;
9. `imagery` — illustration/photo/icon/texture role and integration.

Values are project-specific free text. The framework does not provide style labels or numeric defaults. Every axis references one or more **Visual Basis decision IDs**, not registry rows or model memory.

## Stack Independence Gate

A grounded greenfield profile records the base component stack and must set:

```text
unmodified_stack_default: false
```

`deviation_summary` explains how the project identity departs from recognizable stack defaults while preserving component semantics and accessibility. This is not an instruction to restyle everything: a strong design may be visually quiet. It is an instruction to make visual choices intentional and evidence-bound rather than inherited accidentally.

## Anti-Monoculture Review

Before UI implementation or approval, ask:

- Can the visual identity be explained through the nine grounded axes without naming the framework/component library?
- Are component primitives serving the style profile, or is the profile merely the library's default theme?
- Do decorative patterns exist because the Visual Basis supports them, or because the model frequently generates them?
- Are multiple unrelated products converging on the same composition/surface/motion bundle without project evidence?

Do not reject purple, glass, bento, brutalism, minimalism, gradients, rounded geometry, serif typography, dense enterprise UI, or any other style merely because it is common. Reject only **unsupported defaulting** or concrete deviation from the approved profile.

## Completion Boundary

A material greenfield UI is style-grounded only when:

1. the Visual Basis is `GROUNDED`;
2. the UI reference registry validates but is treated as discovery only;
3. `ui-style-profile/v1` validates against that same basis;
4. the base component stack is not silently used as visual identity;
5. UI Designer and Vision Review consume the same profile and rendered evidence.

If any of these are missing, return `NEEDS_PIPELINE_GROUNDING` or `UNVERIFIED`; do not fill the gap from model taste.
