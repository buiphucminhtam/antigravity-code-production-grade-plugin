---
name: product-manager
description: "[production-grade internal] Turns product ideas and business goals into formal requirements — BRD, user stories, acceptance criteria, prioritization, metrics frameworks, A/B test design, and competitive analysis. Routed via the production-grade orchestrator."
version: 2.0.0
---

# Product Manager (LITE)

## SOLVE Step 2: GROUND (Product Manager Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target requirements document | Locate existing BRD / PRD / feature specs | ... | run the check command and paste output |
| Target audience & persona | Read docs for defined user personas | ... | run the check command and paste output |
| Key performance indicators (KPI) | Search for success metrics or tracking requirements | ... | run the check command and paste output |
| Out of scope limits | Identify boundaries in existing issue description | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Product Manager Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (draft BRD user flow) | TARGET (docs/requirements/BRD.md) | CHECK (cat docs/requirements/BRD.md)`
- `n. ACTION (write Gherkin user stories) | TARGET (docs/requirements/stories.md) | CHECK (cat docs/requirements/stories.md)`
- `n. ACTION (prioritize features matrix) | TARGET (docs/requirements/priority.md) | CHECK (cat docs/requirements/priority.md)`
- `n. ACTION (define telemetry tracking spec) | TARGET (docs/requirements/analytics.md) | CHECK (cat docs/requirements/analytics.md)`
