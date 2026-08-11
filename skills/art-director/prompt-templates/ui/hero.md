# UI Hero Section Prompt Template

## Contract inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Asset type:** Hero Section (landing page above-the-fold)
- **Output format:** [OUTPUT_FORMAT]

## Style and composition bindings

- **Background and atmosphere:** [BACKGROUND_AND_ATMOSPHERE_RULES]
- **Typography and type/UI relationship:** [TYPOGRAPHY_SYSTEM]
- **Color roles and focal contrast:** [COLOR_ROLES_AND_FOCAL_HIERARCHY]
- **Composition, crop, and focal order:** [COMPOSITION_RULES]
- **Responsive behavior and breakpoints:** [RESPONSIVE_HERO_RULES]
- **Required negative constraints:** [PROHIBITED_DRIFT]

The approved basis decides whether the hero is centered, offset, asymmetric,
symmetrical, full-bleed, split, cropped, or text-led. Do not make any of those
choices universal. Review `[PROHIBITED_DRIFT]` as evidence-backed prohibited
drift for this hero family and viewport.

## Generation prompt

Generate a hero section for `[ASSET_FAMILY]` that communicates the approved
creative promise at `[REAL_SCALE_CONTEXT]`. Use the assigned reference roles and
`[COMPOSITION_RULES]` to stage the headline, visual, CTA, and optional proof.
Preserve type hierarchy, accessibility, and responsive behavior under
`[PLATFORM_AND_PRODUCTION_CONSTRAINTS]`; apply only `[PROHIBITED_DRIFT]`.

### Composition options

Select one only when the Style DNA or a tested direction approves it:

1. **Split screen:** [SPLIT_SCREEN_RULES]
2. **Offset composition:** [OFFSET_COMPOSITION_RULES]
3. **Magazine / full-bleed:** [MAGAZINE_COMPOSITION_RULES]
4. **Grid / bento:** [GRID_COMPOSITION_RULES]
5. **Other approved structure:** [OTHER_COMPOSITION_RULES]

These are **non-default examples**, not a mandatory asymmetry rule.

### Content and supporting elements

- **Heading and subheading:** [HERO_COPY_AND_TYPE_RULES]
- **Visual asset / illustration:** [HERO_VISUAL_RULES]
- **Primary and secondary CTA:** [HERO_CTA_RULES]
- **Social proof, if applicable:** [SOCIAL_PROOF_RULES]
- **Below-the-fold relationship, if shown:** [BELOW_FOLD_RULES]

## Output and acceptance

- **Dimensions / viewport range:** [DIMENSIONS_AND_VIEWPORT_RANGE]
- **Format:** [OUTPUT_FORMAT]
- **Naming:** [NAMING_CONVENTION]
- **Responsive and horizontal-overflow check:** [RESPONSIVE_REVIEW_ARTIFACT]
- **Copy / accessibility check:** [COPY_ACCESSIBILITY_ARTIFACT]
- **Review owner and next test:** [REVIEW_OWNER_AND_NEXT_TEST]
