# UI Button Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Asset type:** UI Button (interactive element)
- **Output format:** [OUTPUT_FORMAT]

## Style and interaction bindings

- **Color roles:** [COLOR_ROLES_AND_STATES]
- **Typography:** [TYPOGRAPHY_SYSTEM]
- **Geometry, spacing, and radius:** [GEOMETRY_SPACING_AND_RADIUS]
- **Material, border, and shadow behavior:** [SURFACE_AND_DEPTH_RULES]
- **State hierarchy:** [BUTTON_STATE_RULES]
- **Accessibility and touch contract:** [ACCESSIBILITY_AND_TOUCH_CONTRACT]
- **Required negative constraints:** [PROHIBITED_DRIFT]

All visual values must be copied from the approved Style DNA or a named platform
requirement. Do not substitute a generic font, color, grid, radius, shadow, or
composition preference. The assigned reference roles and `[PROHIBITED_DRIFT]`
define the prohibited drift and what is in scope for this button family.

## Generation prompt

Generate a UI button for `[ASSET_FAMILY]` that preserves the approved type/UI
relationship and semantic hierarchy. Resolve the button at `[REAL_SCALE_CONTEXT]`
and include the states required by `[PLATFORM_AND_PRODUCTION_CONSTRAINTS]`.
Use `[COLOR_ROLES_AND_STATES]`, `[TYPOGRAPHY_SYSTEM]`, and
`[SURFACE_AND_DEPTH_RULES]` exactly as bound; apply only the listed drift
constraints.

### States to include

1. **Default:** [DEFAULT_STATE]
2. **Hover / focus:** [HOVER_FOCUS_STATE]
3. **Active / pressed:** [ACTIVE_PRESSED_STATE]
4. **Disabled:** [DISABLED_STATE]
5. **Loading / progress:** [LOADING_STATE]

### Variants and composition

- **Primary:** [PRIMARY_VARIANT]
- **Secondary:** [SECONDARY_VARIANT]
- **Ghost:** [GHOST_VARIANT]
- **Danger:** [DANGER_VARIANT]
- **Icon-only:** [ICON_ONLY_VARIANT]
- **Text/icon alignment and truncation:** [BUTTON_CONTENT_RULES]

Non-default examples: a 44×44px touch target, a 1px border, a 600 font weight,
or an inner-tinted shadow are illustrative values only. Keep them only when the
platform contract or Style DNA requires them.

## Output and acceptance

- **Aspect ratio / dimensions:** [DIMENSIONS_AND_ASPECT_RATIO]
- **Format and transparency:** [OUTPUT_FORMAT]
- **DPI / density:** [DPI_AND_DENSITY]
- **Naming:** [NAMING_CONVENTION]
- **Contrast and redundant cues:** [CONTRAST_AND_REDUNDANT_CUES]
- **State coverage artifact:** [STATE_COVERAGE_ARTIFACT]
- **Review owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]
