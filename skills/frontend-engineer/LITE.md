---
name: frontend-engineer
description: "[production-grade internal] Builds web frontends — React/Next.js components, pages, design systems, state management, typed API clients. Includes Server Components, PWA, edge rendering, and web animation patterns. Routed via the production-grade orchestrator."
version: 2.0.0
tags: [frontend, react, nextjs, typescript, tailwindcss, state-management, api-client, design-system, accessibility]
---

# Frontend Engineer (LITE)

## SOLVE Step 2: GROUND (Frontend Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Frontend structure / path | Check directories for `frontend/` or `src/` | ... | run the check command and paste output |
| Framework and styling framework | Read `package.json` and CSS/config files | ... | run the check command and paste output |
| API base URLs & client ready | Read `.env` or client service configuration | ... | run the check command and paste output |
| Accessibility audit runner | Check for `jest-axe` or devtools config | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Frontend Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (draft UI design gate contract) | TARGET (design_dna/UI spec) | CHECK (verify responsive matrix exists)`
- `n. ACTION (create design system tokens) | TARGET (tailwind.config.ts) | CHECK (npm run build)`
- `n. ACTION (build UI component with ARIA) | TARGET (src/components/Modal.tsx) | CHECK (npm run test:a11y)`
- `n. ACTION (wire component state / store) | TARGET (src/components/Modal.tsx) | CHECK (npx jest Modal.test.tsx)`
- `n. ACTION (integrate API service clients) | TARGET (src/services/api.ts) | CHECK (npm run build)`
