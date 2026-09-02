# UI Designer Data

Legacy aesthetic recipe CSVs were removed because they encoded unverified mappings such as product category → palette/font/style/motion defaults. Keeping those recipes beside the UI skill made it too easy for a model to convert training-era folklore into production direction.

Material visual decisions now use only:

1. `skills/_shared/protocols/visual-evidence-library.md`;
2. `skills/_shared/protocols/visual-grounding.md`;
3. current project/user-approved visual authority; or
4. validated `.forgewright/visual-evidence/cards/*.json` plus `.forgewright/visual-evidence/visual-basis.json`.

The remaining `stacks/` data is implementation-stack reference data, not aesthetic evidence. It cannot authorize palette, typography, spacing, motion, layout, art style, or product-type visual mappings.

Model training prior may propose search terms or hypotheses only. A Visual Evidence Card must point to current original product/design-system/platform/project evidence; legacy recipes must never be reconstructed as project truth.
`reference-registry.json` is a curated **research starting-point registry**, not a style database. Production-system candidates (for example mature design systems) still require fresh Visual Evidence Cards; exploration/discovery entries can only widen hypotheses. Validate the registry and project-specific `.forgewright/visual-evidence/ui-style-profile.json` with `scripts/art-direction/ui_style_profile.py`.
