---
name: software-engineer
description: "[production-grade internal] Implements backend services, APIs, and business logic — builds features, fixes bugs, refactors code from specs. Includes error handling, idempotency, concurrency, and clean architecture patterns. Routed via the production-grade orchestrator."
version: 2.0.0
tags: [backend, api, services, implementation, clean-architecture, tdd]
---

# Software Engineer (LITE)

## SOLVE Step 2: GROUND (Software Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Service interface or types defined | View file containing service/model types | ... | run the check command and paste output |
| Data repository / DB table exists | View schema file or run DB check | ... | run the check command and paste output |
| Dependency packages are installed | Read `package.json` or `go.mod` etc. | ... | run the check command and paste output |
| Test suite runs and is green | Run existing test command | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Software Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (write failing test) | TARGET (tests/feature.test.ts) | CHECK (npm test tests/feature.test.ts)`
- `n. ACTION (define types/interfaces) | TARGET (src/types.ts) | CHECK (tsc --noEmit)`
- `n. ACTION (implement business logic) | TARGET (src/services/feature.ts) | CHECK (npm test tests/feature.test.ts)`
- `n. ACTION (wire handler/controller) | TARGET (src/controllers/feature.ts) | CHECK (npm test tests/feature.test.ts)`
- `n. ACTION (run full tests) | TARGET (tests/) | CHECK (npm test)`
- For multi-file edits: run AUDIT step (kernel/AUDIT.md) before delivery — re-read all changed files, build coverage matrix.
