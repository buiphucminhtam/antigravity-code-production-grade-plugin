# Game 2D Background Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Asset type:** 2D Game Background / Environment
- **Game type:** [GAME_TYPE]
- **Art style:** [ART_STYLE]
- **Layer:** [BACKGROUND_MIDGROUND_FOREGROUND]

## Style and technical bindings

- **Camera angle / projection:** [CAMERA_ANGLE]
- **Tile size and repeat behavior:** [TILE_SIZE_AND_REPEAT_RULE]
- **Color roles and state progression:** [COLOR_ROLES_AND_PROGRESSION]
- **Lighting and atmosphere:** [LIGHTING_AND_ATMOSPHERE_RULES]
- **Shape, material, and detail density:** [SHAPE_MATERIAL_DETAIL_RULES]
- **Parallax and depth contract:** [PARALLAX_DEPTH_CONTRACT]
- **Required negative constraints:** [PROHIBITED_DRIFT]

These rules are valid only for the named family and real presentation context.
Do not infer palette size, temperature, symmetry, density, or texture treatment
from this template. Review `[PROHIBITED_DRIFT]` as evidence-backed prohibited
drift, not as a universal aesthetic rule.

## Generation prompt

Generate a 2D game background/environment that preserves the approved Style DNA
and reference roles for `[ASSET_FAMILY]`. Prioritize the first read at
`[REAL_SCALE_CONTEXT]`, then detail and material behavior at
`[SECONDARY_REVIEW_SCALE]`. Match `[CAMERA_ANGLE]`, the horizon/depth placement,
and `[PARALLAX_DEPTH_CONTRACT]`; keep the result compatible with
`[PLATFORM_AND_PRODUCTION_CONSTRAINTS]`.

### Composition and depth

- **Background layer:** [BACKGROUND_LAYER_RULES]
- **Midground layer:** [MIDGROUND_LAYER_RULES]
- **Foreground layer:** [FOREGROUND_LAYER_RULES]
- **Interactive/readability separation:** [INTERACTIVE_SEPARATION_RULES]
- **Cropping, negative space, and focal order:** [COMPOSITION_RULES]

### Environment binding

For `[ENVIRONMENT_TYPE]`, use the approved family lineage and variation axes:

- **Landmarks / silhouettes:** [LANDMARK_AND_SILHOUETTE_RULES]
- **Organic or architectural distribution:** [DISTRIBUTION_RULES]
- **Weather, season, or atmosphere state:** [ATMOSPHERE_STATE]
- **Material and texture frequency:** [MATERIAL_TEXTURE_FREQUENCY]

### Tile and export checks

- **Seam rule:** [TILE_SEAM_RULE]
- **Repeat test:** [TILE_REPEAT_TEST]
- **Format and transparency:** [OUTPUT_FORMAT_AND_TRANSPARENCY]
- **Naming:** [NAMING_CONVENTION]
- **Atlas/LOD/compression/import:** [ATLAS_LOD_COMPRESSION_IMPORT]

Non-default examples: a 3×3 repeat test, parallax values such as 0.1/0.5/0.9,
or a warm-near/cool-far grade are useful starting examples only. Keep them only
when the approved camera, color script, and production tests support them.

## Acceptance evidence

- **Style-frame or family comparison:** [STYLE_FRAME_OR_FAMILY_ARTIFACT]
- **Real-scale read:** [REAL_SCALE_REVIEW_RESULT]
- **Drift review:** [DRIFT_REVIEW_RESULT]
- **Owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]
