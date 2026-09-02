# Game Visual Foundations — Evidence-Grounded Heuristic Catalog

> **Authority boundary:** this file is a toolbox of visual-analysis lenses, not a source of project truth. Material visual decisions MUST follow `skills/_shared/protocols/visual-evidence-library.md` and `skills/_shared/protocols/visual-grounding.md`. Model training prior, generic taste, and the heuristics below have evidence weight zero unless the current project, user-approved reference, applicable standard, or current external evidence supports them.

This reference helps visual roles ask better questions about color, shape, composition, typography, lighting, motion, style systems, and accessibility. It must never be used to invent a palette, style, font, camera, or animation language for a project that has not grounded those choices.

---

## 1. How to Use This File

For each proposed visual mechanism:

1. identify the user/player task and real presentation context;
2. inspect the current project/user visual authority first;
3. if no reliable basis exists, run the Visual Evidence Research Gate;
4. use the sections below only to define comparison dimensions or hypotheses;
5. record the final mechanism in the validated Visual Basis with supporting card IDs, applicability boundary, and prohibited drift;
6. verify the rendered result at the real viewport/camera/scale.

A phrase such as “60/30/10,” “rule of thirds,” “blue means trust,” “triangles mean danger,” “use two fonts,” or “200–400 ms feels premium” is therefore **not a rule**. It is at most a candidate hypothesis to test against evidence.

---

## 2. Color Analysis

### 2.1 Analyze roles before hues

Useful dimensions include:

- surface/background hierarchy;
- text and icon contrast;
- semantic action/status roles;
- saturation and accent frequency;
- warm/cool relationships;
- value separation in grayscale;
- color behavior under lighting/post-processing;
- color-vision accessibility and redundant cues.

Do not infer a palette from generic color psychology. Meanings are affected by product convention, culture, genre, brand, state, neighboring colors, and lighting.

### 2.2 Distribution is contextual

A dominant/secondary/accent split can be useful as an **analysis lens**, including patterns sometimes described as 60/30/10, but no universal percentage is required. Measure the actual successful/project references and preserve their semantic roles rather than forcing a ratio.

### 2.3 Color evidence record

For a grounded color decision, record:

```text
OBSERVED: <what current references/project actually do>
ROLE: <surface | text | action | status | rarity | danger | ...>
TRANSFER: <mechanism that fits this project>
BOUNDARY: <where it applies / does not apply>
CAUSALITY: observation or association only; never infer product success from color
VERIFY: contrast + grayscale + target-context render
```

### 2.4 2D and 3D

- In 2D, sprite/background value separation and palette consistency are often directly visible in source assets.
- In 3D, material response, exposure, environment lighting, tone mapping, fog, and post-processing can materially alter apparent color. Validate in-engine rather than approving isolated swatches.

---

## 3. Shape, Silhouette, and Proportion

Analyze:

- first-read silhouette;
- large-to-small massing;
- contour rhythm;
- positive/negative space;
- proportion and exaggeration;
- corner/edge language;
- repeated motifs and their hierarchy;
- recognition at gameplay/UI scale;
- family consistency and controlled variation.

Geometric labels such as circle/square/triangle can be useful for describing form, but do not assign universal personality, gender, morality, or gameplay meaning to a shape. Meaning must come from the approved/project/reference system and observed context.

For characters, enemies, props, and icons, test silhouettes without interior detail. For environments, test landmark hierarchy and traversal/readability at the actual camera.

---

## 4. Composition and Visual Hierarchy

### 4.1 Primary questions

- What must the viewer notice first, second, and third?
- Does size/value/saturation/motion/isolation support that order?
- Are related elements grouped by alignment, proximity, or common region?
- Is the focal element protected by enough negative space?
- Does the composition survive crop, responsive reflow, camera movement, localization, and state changes?

### 4.2 Composition heuristics are optional tools

Rule-of-thirds, centered symmetry, golden-ratio layouts, F/Z scanning patterns, diagonal tension, leading lines, S-curves, or asymmetry are possible composition strategies—not mandatory quality rules. Use whichever strategy is supported by the current task/reference and prove the result in context.

A centered subject or centered horizon is not inherently weak. A deliberately symmetric boss reveal, dashboard, portrait, loading scene, or architectural composition may require it.

### 4.3 Depth and separation

Potential mechanisms include:

- value separation;
- atmospheric perspective;
- scale and overlap;
- focus/depth of field;
- warm/cool or saturation shifts;
- motion parallax;
- foreground/midground/background staging.

Select only mechanisms compatible with the approved direction and target renderer.

---

## 5. Typography

Typography decisions must originate from the approved brand/UI contract or current evidence. Analyze:

- type role and hierarchy;
- legibility at actual pixels/viewing distance;
- weight and line-height;
- line measure;
- localization and text expansion;
- numeral/readout clarity;
- icon/type relationship;
- responsive scaling;
- font loading/licensing/performance;
- platform accessibility requirements.

There is no universal maximum number of font families or sizes, and system fonts are not inherently low quality. A system stack may be the correct production choice for performance, platform familiarity, or utility products; a distinctive display face may be correct when current brand/reference evidence requires it.

Do not copy a reference product's proprietary type treatment when the transferable mechanism is simply compact hierarchy, readable numerals, condensed labels, or another underlying pattern.

---

## 6. Lighting, Material, and Atmosphere

### 6.1 Lighting as a system

Inspect and ground:

- light motivation/source;
- key/fill/rim relationship where applicable;
- shadow depth and softness;
- exposure and dynamic range;
- color temperature structure;
- emissive hierarchy;
- atmospheric depth/fog;
- material roughness/specular behavior;
- separation from the gameplay/background field;
- consistency across time/state/camera changes.

Three-point lighting is one production technique, not a required aesthetic. Likewise, genre recipes such as “sci-fi = blue rim” or “cozy = golden light” are hypotheses unless supported by the selected evidence basis.

### 6.2 Post-processing

Bloom, vignette, LUT/color grading, depth of field, motion blur, chromatic aberration, film grain, sharpening, and similar effects must reinforce the grounded art direction and preserve readability. Do not use post-processing to rescue weak value hierarchy, material definition, or composition.

Verify post effects at target hardware and UI/gameplay scale; a hero screenshot cannot prove motion/readability/performance.

---

## 7. Motion, Animation, and VFX

### 7.1 Analyze motion by function

Useful dimensions:

- anticipation;
- onset/impact;
- settle/recovery;
- continuity and spatial causality;
- motion hierarchy—what moves first and strongest;
- timing rhythm relative to task/gameplay significance;
- easing/spring character;
- deformation/squash/stretch when appropriate;
- trails/secondary particles/dissipation;
- camera shake and haptic/audio synchronization;
- reduced-motion alternative;
- performance and lifecycle safety.

Fixed durations, easing curves, shake pixel ranges, and particle counts are not aesthetic defaults. Derive them from current product/game references, platform/input constraints, gameplay timing, and measured render behavior.

### 7.2 VFX readability

A visually impressive effect fails when it obscures state, enemy/player silhouettes, timing windows, objectives, or UI. Review VFX at real camera distance and during overlapping combat/state conditions—not only as an isolated effect.

---

## 8. Visual Style and Art-Direction Workflow

The production flow is:

```text
Current project/user authority
        ↓
Visual Evidence Research Gate when needed
        ↓
Evidence Cards → GROUNDED Visual Basis
        ↓
Concept directions
        ↓
Selected Concept Packet
        ↓
Style DNA / Style Frame / Color Script / Family Bible
        ↓
Generation or implementation contract
        ↓
Rendered reference-conformance review
```

A moodboard is exploratory evidence organization, not production truth. A style guide becomes production-ready only when it expresses observable mechanisms, ranges, states, examples/anti-examples, and target-context verification.

### 8.1 Art-style labels

Labels such as pixel art, hand-drawn, low-poly, stylized 3D, realistic PBR, voxel, flat vector, clay, toy-like, brutalist, glassy, or painterly are useful taxonomy only. They do not determine quality or automatically imply a palette, lighting model, outline rule, density, or motion language.

---

## 9. Accessibility and Inclusive Readability

These are standards/functional constraints, not taste heuristics.

When applicable:

- meet the target WCAG/platform contrast requirements;
- do not rely on color alone for critical meaning;
- preserve focus visibility and semantic order for UI;
- support text/UI scaling required by the platform;
- respect safe areas, touch/gamepad/keyboard input constraints;
- provide reduced-motion behavior;
- test color-vision and high-contrast states when relevant;
- keep subtitles/captions and critical HUD information readable at intended distance.

Use current official platform/standard references for thresholds rather than remembered numbers when the exact requirement matters.

---

## 10. Generative-AI Guardrails

When AI creates or transforms visual assets:

1. bind the request to the validated Visual Basis and exact Evidence Card IDs;
2. treat model prior as hypothesis-only, never as style authority;
3. preserve identity invariants and intentional asymmetry;
4. lock camera, scale, composition, material/light behavior, and prohibited drift where material;
5. separate reference roles so one source does not silently control style, subject, composition, and identity;
6. compare output against current references and Style DNA, not against the generation prompt itself;
7. reject concrete anatomy/artifact/reference deviations even when an aggregate score is high;
8. verify at real gameplay/product scale and representative states;
9. do not automatically smooth, average, brighten, beautify, or normalize deliberate artistic choices.

---

## 11. Quick Analysis Card

```text
EVIDENCE FIRST: project/user authority → current external evidence → exploration
MODEL PRIOR: hypothesis-only, never evidence
COLOR: roles/value/contrast/context; no universal palette psychology
SHAPE: silhouette/massing/proportion; no universal personality mapping
COMPOSITION: prove focal hierarchy in context; composition formulas are optional
TYPE: project/reference/platform evidence; no universal font-count rule
LIGHT/MATERIAL: grounded motivation + in-engine response
MOTION/VFX: function → anticipation/impact/settle/readability; no fixed timing defaults
STYLE: Evidence Cards → Visual Basis → Concept → Style DNA → render review
ACCESSIBILITY: current standards/platform constraints remain authoritative
CAUSALITY: successful product ≠ proof that its visual mechanism caused success
```
