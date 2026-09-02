---
id: visual-evidence-library
title: Production-Proven Visual Evidence Library
summary: Evidence contract for learning visual mechanisms from current successful products, production design systems, platform guidance, user-approved references, and project renders without treating model training priors as authority.
status: active
version: 1.0.0
owners: [core, design]
triggers: [material visual direction, greenfield visual work, weak visual basis]
used_by: [pipeline, research-gate, visual-grounding, concept-artist, art-director, ui-designer, art-pipeline]
related: [visual-grounding, ui-style-diversity, research-gate, pipeline-operating-contract, evidence-first]
supersedes: []
superseded_by: null
---
# Production-Proven Visual Evidence Library

## Purpose

Forgewright does not derive material visual direction from what a model remembers
from training. Model prior may suggest **what to investigate**, but only current
observable evidence may decide **what to design**.

This protocol turns successful real products and production design systems into a
traceable visual evidence base. It is designed to prevent two failure modes at
once:

1. **AI-average design** — familiar gradients, palettes, card shapes, fonts, or
   layouts are selected because the model has seen them frequently;
2. **cargo-cult copying** — a successful product is imitated without separating
   its context, transferable mechanisms, brand identity, and unknown causal
   relationship to business success.

## Hard Boundary: Model Prior Is Not Evidence

For material visual decisions:

- training memory, latent preference, model familiarity, generic design advice,
  and uncited recollection have evidence weight **zero**;
- model prior may generate search terms, candidate products, comparison axes, or
  falsifiable hypotheses only;
- every evidence artifact records
  `model_prior.used_as_evidence: false` and
  `model_prior.hypothesis_only: true`;
- a visual decision cannot become `GROUNDED` merely because several models agree;
- numeric aesthetic confidence or self-score is telemetry, never authority.

If no current evidence can support a material choice, return `UNVERIFIED` or
`EXPLORATORY`; do not fill the gap from training data.

## Evidence Tiers

### Tier A — Direct authority / production system

Highest-value sources include:

- user-approved reference, Figma/design file, art bible, brand guide;
- current project design system and shipped product renders;
- official platform design guidance;
- official production design systems used by shipped products;
- first-party product and adoption evidence.

Tier A proves what the source actually specifies or visibly does. It still does
not prove a visual mechanism caused market success.

### Tier B — Direct successful-product observation

Use current production screenshots, interaction captures, or product pages from
comparable successful products when no public design system exposes the needed
mechanism. Bind the visual observation to separate first-party success/adoption
evidence whenever the card is classified as `successful_product`.

Tier B is useful for repeated pattern discovery, but one product alone must not
become a universal rule.

### Tier C — Inspiration only

Gallery, award, portfolio, moodboard, social, community, and speculative concept
sources can broaden exploration. They may inform search hypotheses but cannot
support a `GROUNDED` decision. They are explicitly marked `inspiration_only`.

## What “Successful” Means

A product can be admitted as `successful_product` only when a current source
provides a credible production/adoption signal such as public customer/user
scale, paid adoption, revenue/business scale, sustained market presence, or
other first-party evidence appropriate to the product.

The signal proves only that the product is a real, adopted production system. It
does **not** establish that a color, layout, motion pattern, or typography choice
caused that success.

Every success signal therefore records a caveat and every visual card fixes:

```text
causal_claim_allowed: false
```

Do not write claims such as `green increases retention` or `dark UI creates
trust` unless independent causal research actually establishes that claim for
the applicable context. Normal product-reference research supports observation
and transferability, not causation.

## Context Matching Before Pattern Transfer

Before selecting comparables, define the target:

- product/game category;
- audience/player;
- primary job or gameplay read;
- platform and input model;
- usage frequency/session pattern;
- information density;
- camera/viewing distance when relevant;
- brand/game fantasy and accessibility constraints.

Prefer references with materially similar jobs and interaction constraints.
Popularity alone is not comparability.

A finance mobile app, desktop developer tool, casual portrait game, and console
HUD may all be successful while requiring incompatible visual mechanisms.

## Visual Evidence Card

Each source becomes one machine-validatable card conforming to:

`schemas/visual-evidence-card.schema.json`

Canonical project-local location when persistence is useful:

`.forgewright/visual-evidence/cards/<card-id>.json`

A card records:

- source identity, date, publisher, authority tier and source type;
- subject kind and product/platform context;
- success/adoption evidence when the source claims production success;
- role tags such as `STYLE`, `COLOR`, `TYPOGRAPHY`, `COMPOSITION`, `MOTION`;
- concrete observations with evidence locations;
- transferable mechanism;
- applicability boundary;
- prohibited copying;
- causality limit;
- explicit model-prior exclusion.

The card stores **observations**, not a cloned design recipe.

## UI Reference Discovery Registry

For material UI work, `skills/ui-designer/data/reference-registry.json` may be used to broaden research. The registry deliberately mixes production-system candidates with exploration/discovery tools, but **the registry is never evidence**. Validate it with `python3 scripts/art-direction/ui_style_profile.py validate-registry`. A production-system candidate must still be inspected at its current source and encoded as a fresh Visual Evidence Card before it can support a Visual Basis; exploration/discovery rows remain hypothesis-only. See `ui-style-diversity.md`.

## Greenfield Research Gate

Material greenfield visual work with no project or user-approved visual authority
must open the Research Gate before Concept Artist, Art Director, UI Designer, or
asset generation can lock direction.

For an `external_research` `GROUNDED` basis:

- Research Gate status must be `PASSED`;
- a greenfield basis needs at least **3 grounded evidence cards**;
- at least one card must be a `successful_product` or
  `production_design_system` with production/adoption proof;
- every material synthesized decision needs at least **2 independent evidence
  cards**;
- `inspiration_only` cards never count as grounding evidence.

The minimums exist to detect repeated transferable mechanisms and reduce
single-product imitation. Research should stop once the decision is supported;
do not collect references as a vanity count.

User-approved and current-project sources retain higher authority. A user may
explicitly choose one reference as the target; the system then treats that as a
project decision rather than pretending market consensus exists.

## Visual Basis

Evidence cards are synthesized into:

`.forgewright/visual-evidence/visual-basis.json`

using `schemas/visual-basis.schema.json`.

The basis records:

- target context and whether it is greenfield;
- Research Gate result;
- exact card IDs;
- decision claims and supporting card IDs;
- synthesis and applicability boundary;
- `MUST MATCH` mechanisms;
- `MAY VARY` creative latitude;
- `PROHIBITED DRIFT`;
- causality limits;
- model-prior exclusion.

A basis may be:

- `GROUNDED` — evidence is sufficient to authorize downstream direction;
- `EXPLORATORY` — useful hypotheses exist but production direction is not locked;
- `UNVERIFIED` — required evidence is missing or conflicting.

Validate it locally with:

```bash
python3 scripts/art-direction/visual_evidence.py validate-basis \
  .forgewright/visual-evidence/visual-basis.json \
  --cards-dir .forgewright/visual-evidence/cards
```

## Mechanism Extraction, Not Look Cloning

When a reference is useful, decompose it into mechanisms, for example:

- neutral surface hierarchy with sparse semantic accent;
- dense left navigation plus dominant workspace;
- large-value separation before texture detail;
- compact typography with restrained weight changes;
- motion that prioritizes state change over decoration;
- lighting that preserves character silhouette at gameplay scale.

Do not transfer:

- logos, trademarks, proprietary illustrations;
- exact copyrighted artwork;
- unique branded icons or character identity;
- exact composition merely because it is recognizable;
- exact hex values unless the user owns/approved the brand contract;
- accidental defects or one-off implementation artifacts.

## Color and Style Claims

Color psychology, 60/30/10, shape psychology, rule-of-thirds, font-count limits,
fixed animation durations, genre palettes, and similar design heuristics are
**candidate lenses**, not evidence.

They may be used only when:

1. the current project/design system explicitly adopts them; or
2. current external evidence supports the mechanism in a comparable context; or
3. they are framed as an exploratory hypothesis to test.

Accessibility standards and deterministic physical/platform constraints are
separate: measured contrast, safe area, readable size, input target, and similar
requirements retain their applicable standards-based authority.

## Evidence Freshness

Record `observed_at` on every external card. Re-research when a material source
may have changed, especially:

- live product UI;
- design-system versions;
- platform conventions;
- product/adoption claims;
- product positioning or target audience.

Do not refresh stable historical evidence merely to produce a newer timestamp.

## Learning Loop

Project results can become stronger evidence than external analogies.

After real usage or playtesting, validated project-local observations may be
recorded as `project_product` cards, including usability findings, measured
behavior, visual failure modes, and successful corrections. These project cards
then outrank generic external comparables for later iterations.

Do not automatically promote one project's finding into a universal Forgewright
rule. Framework promotion requires an explicit framework-development change,
contradiction review, and regression evidence.

## Completion Boundary

A material visual output is not evidence-grounded merely because:

- research links exist;
- screenshots were collected;
- a model produced a moodboard;
- a reviewer gave a high score;
- the generated image looks polished.

`GROUNDED` requires a valid Visual Evidence Library + Visual Basis, and downstream
Concept/Art/UI/generation contracts must bind the same basis. Rendered output is
then reviewed against that basis via `visual-grounding.md`.
