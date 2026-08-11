# UI Card Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Asset type:** UI Card (content container)
- **Output format:** [OUTPUT_FORMAT]

## Style and layout bindings

- **Surface and semantic colors:** [COLOR_ROLES_AND_STATES]
- **Typography hierarchy:** [TYPOGRAPHY_SYSTEM]
- **Border, radius, shadow, and material:** [SURFACE_AND_DEPTH_RULES]
- **Spacing and content density:** [SPACING_AND_DENSITY_RULES]
- **Focal order and alignment:** [COMPOSITION_RULES]
- **Responsive behavior:** [RESPONSIVE_CARD_RULES]
- **Required negative constraints:** [PROHIBITED_DRIFT]

The contract decides whether a card is centered, offset, symmetric, asymmetric,
flat, elevated, bordered, or textured. This template does not prescribe a layout
shape or fixed visual token. Treat `[PROHIBITED_DRIFT]` as evidence-backed
prohibited drift for the named family and real-scale context.

## Generation prompt

Generate a UI card for `[ASSET_FAMILY]` that matches the approved Style DNA and
reference roles. Preserve hierarchy and legibility at `[REAL_SCALE_CONTEXT]`,
then resolve content detail within `[PLATFORM_AND_PRODUCTION_CONSTRAINTS]`.
Apply `[COMPOSITION_RULES]` and `[SPACING_AND_DENSITY_RULES]` without adding
unapproved decoration or generic drift.

### Content and states

- **Header:** [CARD_HEADER_RULES]
- **Body:** [CARD_BODY_RULES]
- **Footer/actions:** [CARD_FOOTER_RULES]
- **Basic:** [BASIC_CARD_VARIANT]
- **Elevated:** [ELEVATED_CARD_VARIANT]
- **Interactive:** [INTERACTIVE_CARD_VARIANT]
- **Stat:** [STAT_CARD_VARIANT]
- **Media:** [MEDIA_CARD_VARIANT]
- **Action:** [ACTION_CARD_VARIANT]
- **Hover / focus / active / disabled / loading:** [CARD_STATE_RULES]

### Family consistency

- **Shared lineage:** [CARD_FAMILY_LINEAGE]
- **Allowed variation:** [CARD_ALLOWED_VARIATION]
- **Cross-family separation:** [CROSS_FAMILY_HIERARCHY]
- **Observed drift correction:** [DRIFT_CORRECTION_MECHANISM]

Non-default examples: a 280–400px standalone width, 16–24px padding, a left
aligned body, or a two-column/bento arrangement are examples only. Retain them
only when the actual viewport, content model, and Style DNA support them.

## Output and acceptance

- **Dimensions and responsive states:** [DIMENSIONS_AND_RESPONSIVE_STATES]
- **Format and transparency:** [OUTPUT_FORMAT]
- **Naming:** [NAMING_CONVENTION]
- **Typography and hierarchy artifact:** [TYPOGRAPHY_REVIEW_ARTIFACT]
- **Family / scale review:** [FAMILY_AND_SCALE_ARTIFACT]
- **Review owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]
