# Evidence-Bound Negative Constraints

This is a fill-in contract, not a universal denylist. Attach only constraints
that are supported by the approved direction, assigned reference roles, and the
target production context.

## Direction inputs

- **Approved Style DNA:** [APPROVED_STYLE_DNA]
- **Reference-role map:** [REFERENCE_ROLE_MAP]
- **Asset family:** [ASSET_FAMILY]
- **Real-scale context:** [REAL_SCALE_CONTEXT]
- **Platform and production constraints:** [PLATFORM_AND_PRODUCTION_CONSTRAINTS]
- **Observed or credible drift:** [OBSERVED_OR_CREDIBLE_DRIFT]

## Constraint record

For each negative constraint, record the evidence and the response. Do not add a
constraint merely because it is common in generated work.

| Scope | Prohibited drift | Evidence / confidence | Corrective mechanism | Review context |
|---|---|---|---|---|
| [DRIFT_SCOPE] | [PROHIBITED_DRIFT] | [DRIFT_EVIDENCE] | [CORRECTIVE_MECHANISM] | [DRIFT_REVIEW_CONTEXT] |

Apply the record only to the named asset family, state, scale, camera, platform,
and production path. A review finding may change the record; it does not create a
global aesthetic rule for unrelated assets.

## Optional evidence examples

These are **non-default examples**. Keep one only when the project's evidence
supports it, and replace it with the observed mechanism and scope:

- Example: repeated placement in a background family is prohibited when a family
  review shows visible tiling at the gameplay camera.
- Example: a typeface or color treatment is prohibited when the approved Style
  DNA or a legibility test shows it conflicts with the product state hierarchy.
- Example: a construction artifact is prohibited when it fails the target export,
  animation, localization, or engine-import check.

## Review handoff

- **Acceptance artifact:** [NEGATIVE_CONSTRAINT_REVIEW_ARTIFACT]
- **Owner:** [NEGATIVE_CONSTRAINT_OWNER]
- **Next validation:** [NEGATIVE_CONSTRAINT_NEXT_TEST]
