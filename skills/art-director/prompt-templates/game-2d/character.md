# Game 2D Character Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Game type:** [GAME_TYPE]
- **Art style:** [ART_STYLE]

## Style and technical bindings

- **Camera / projection:** [CAMERA_ANGLE]
- **Tile size:** [TILE_SIZE]
- **Character height:** [CHARACTER_HEIGHT_TILES] tiles = [CALCULATED_PIXEL_HEIGHT]px
- **Shape, proportion, and silhouette rules:** [SHAPE_PROPORTION_SILHOUETTE_RULES]
- **Color roles and state progression:** [COLOR_ROLES_AND_PROGRESSION]
- **Lighting direction and material behavior:** [LIGHTING_AND_MATERIAL_RULES]
- **First-read scale:** [FIRST_READ_SCALE]
- **Required negative constraints:** [PROHIBITED_DRIFT]

The bindings above are family-specific. Do not import a fixed palette limit,
symmetry preference, anatomy heuristic, or detail threshold from this template.
Treat `[PROHIBITED_DRIFT]` as evidence-backed prohibited drift for this family
and review context only.

## Generation prompt

Generate a 2D game character for `[ASSET_FAMILY]` that matches the approved Style
DNA and reference roles. Preserve the required silhouette and role read at
`[REAL_SCALE_CONTEXT]`, then resolve identity details at `[HERO_REVIEW_SCALE]`.
Keep proportions, pose, construction, states, and export compatible with
`[PLATFORM_AND_PRODUCTION_CONSTRAINTS]`.

### Character construction

- **Anatomy / pose / deformation rules:** [ANATOMY_POSE_DEFORMATION_RULES]
- **Class or gameplay read:** [ROLE_READ_RULES]
- **Identity anchors and permitted variation:** [IDENTITY_ANCHORS_AND_VARIATION]
- **Equipment and prop relationship:** [EQUIPMENT_RELATIONSHIP]
- **Internal detail and simplification by scale:** [DETAIL_BY_SCALE_RULES]
- **Observed/credible drift correction:** [DRIFT_CORRECTION_MECHANISM]

### Character sheet format

```text
Canvas size: [CANVAS_WIDTH]×[CANVAS_HEIGHT]px (all frames same size)
Sheet layout: [SHEET_LAYOUT]
States and frame counts: [STATE_FRAME_COUNTS]
Frame timing / loop contract: [ANIMATION_TIMING_AND_LOOP_RULES]
Pivot, bounds, atlas, and import: [PIVOT_BOUNDS_ATLAS_IMPORT]
```

Non-default examples: idle/walk/attack/hurt/death rows, 4–6 frames for a loop,
or a first-frame/last-frame match are illustrative production patterns only.
Use them only when the animation and engine contracts call for them.

## Output and review

- **Format and transparency:** [OUTPUT_FORMAT_AND_TRANSPARENCY]
- **Naming:** [NAMING_CONVENTION]
- **Grid/anti-aliasing policy:** [GRID_AND_ANTIALIASING_POLICY]
- **Family comparison artifact:** [FAMILY_COMPARISON_ARTIFACT]
- **Real-scale silhouette result:** [REAL_SCALE_REVIEW_RESULT]
- **Acceptance owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]
