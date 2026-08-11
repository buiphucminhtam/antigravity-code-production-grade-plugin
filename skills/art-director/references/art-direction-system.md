# Art Direction System Reference

Use this reference when a project needs a full visual-system canvas, an
asset-family bible, or a scored review. Omit dimensions that do not apply; never
fill a template with invented certainty.

## Direction Canvas

| Field | Decision |
|---|---|
| Audience/player and context | |
| Creative promise | |
| Selected concept thesis | |
| Dominant visual mechanisms | |
| Locked decisions | |
| Controlled variation | |
| Open experiments | |
| Prohibited drift | |
| Camera/viewports/platform | |
| Production capacity and constraints | |
| Style-frame question | |
| Representative family | |
| Acceptance evidence | |

## Style DNA Record

For each applicable dimension—shape, proportion, silhouette, composition, value,
color, material, edges, line/detail, lighting, atmosphere, camera, motion, VFX,
type, UI relationship—record:

1. creative and functional rationale;
2. approved reference evidence and role;
3. invariant mechanism;
4. allowed range or controlled variation;
5. prohibited drift and known anti-example;
6. target scale, camera, viewport, state, or platform;
7. validation artifact and owner.

## Asset-Family Bible

- **Purpose:** what the family communicates or enables.
- **First read:** what must survive at glance/gameplay scale.
- **Lineage:** shared shape, proportion, material, value, or motion mechanisms.
- **Variation axes:** which properties change, why, and within what range.
- **Hierarchy:** how this family separates from adjacent families.
- **State range:** ordinary, selected, disabled, damage, rarity, progression,
  responsive, accessibility, motion, or lighting states as applicable.
- **Production anatomy:** layers, pivots, modular pieces, tiling, deformation,
  frame bounds, atlas/LOD/compression, naming and version identity.
- **Examples:** representative ordinary case, edge case, and anti-example.

## Multi-Scale Review Rubric

Score 1–5 only when a comparison artifact exists. A hard constraint cannot be
averaged away by a high total.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Intent | contradicts promise | partially communicates | immediate, purposeful read |
| Distinctiveness | derivative/generic | some ownable mechanisms | unmistakable system identity |
| Hierarchy | focal order collapses | readable with context | robust at glance and real scale |
| Coherence | assets conflict | mostly related | clear family lineage |
| Controlled variation | clones or random drift | uneven range | varied yet governed |
| Repeatability | hero-only exception | reproducible with supervision | reliable across content volume |
| Context fit | fails camera/viewport/state | limited cases work | robust across required contexts |
| Feasibility | cannot ship as designed | known remediation needed | fits tools, budget, and platform |

Every review finding includes: artifact/context, expected rule, observed
deviation, impact, corrective mechanism, owner, and next evidence.

## Gate Record

```text
GATE: concept-packet | style-frame | representative-family | production
STATUS: PASS | CONCERNS | FAIL
EVIDENCE: <artifact, render, comparison, or deterministic check>
PRESERVED INTENT: <what survived>
DEVIATIONS: <specific rule mismatches>
RISKS: <impact and likelihood>
ACTION: <owner, corrective mechanism, next test>
```
