# Game 2D Icon Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Icon type:** [ICON_TYPE]
- **Size:** [SIZE]×[SIZE]px

## Style and technical bindings

- **Rendering mode:** [RENDERING_MODE]
- **Shape and silhouette grammar:** [SHAPE_AND_SILHOUETTE_RULES]
- **Color roles and semantic states:** [COLOR_ROLES_AND_STATES]
- **Outline / edge treatment:** [OUTLINE_EDGE_RULES]
- **Grid and scaling policy:** [GRID_AND_SCALING_POLICY]
- **Required negative constraints:** [PROHIBITED_DRIFT]
- **Set lineage and variation:** [ICON_SET_LINEAGE_AND_VARIATION]

Any color count, outline width, detail threshold, or contrast target must be
derived from the approved contract and tested at `[REAL_SCALE_CONTEXT]`; this
template does not choose a universal number. `[PROHIBITED_DRIFT]` is evidence-
backed prohibited drift for this icon family, not a global denylist.

## Generation prompt

Generate a `[ICON_TYPE]` icon that belongs to `[ASSET_FAMILY]`, preserving the
approved Style DNA, reference roles, and semantic state hierarchy. Make the
silhouette and key action/item read at `[REAL_SCALE_CONTEXT]`; resolve secondary
detail only where `[PLATFORM_AND_PRODUCTION_CONSTRAINTS]` supports it.

### Icon role examples

Use the applicable contract-defined role, not a default visual treatment:

- **Inventory item:** [INVENTORY_ITEM_READ_AND_RARITY_RULES]
- **Ability/action:** [ABILITY_ACTION_READ_AND_COOLDOWN_SPACE]
- **HUD element:** [HUD_STATE_AND_REDUNDANT_CUE_RULES]
- **Navigation:** [NAVIGATION_DIRECTION_AND_MARKER_RULES]

### Set consistency

- **Shared geometry/material/camera:** [SET_SHARED_RULES]
- **Allowed variation:** [SET_ALLOWED_VARIATION]
- **State and accessibility variants:** [SET_STATE_VARIANTS]
- **Anti-drift check:** [SET_DRIFT_CHECK]

## Output and acceptance

- **Exact dimensions and bounds:** [EXACT_DIMENSIONS_AND_BOUNDS]
- **Format and transparency:** [OUTPUT_FORMAT_AND_TRANSPARENCY]
- **Naming:** [NAMING_CONVENTION]
- **Anti-aliasing / scaling:** [ANTIALIASING_AND_SCALING_POLICY]
- **Family and real-scale artifact:** [FAMILY_AND_SCALE_ARTIFACT]
- **Review owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]

Non-default examples: a 16px silhouette-only read, a 32px single interior
landmark, or a 64px face detail are example scale tests, not mandatory detail
levels. Keep only the scale cases required by the target platform.
