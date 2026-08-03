---
name: qa-engineer
description: "[production-grade internal] Quality assurance engineering for game and web projects — test strategy, test case design, automated testing, regression prevention, and bug reporting. Ensures every feature meets acceptance criteria before shipping. Routed via the production-grade orchestrator."
version: 3.0.0
tags: [qa, quality-assurance, testing, test-cases, automated-testing, regression, bug-reporting]
---

# QA Engineer (LITE)

## SOLVE Step 2: GROUND (QA Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Test framework configuration works | Read test config file or run a simple test | ... | run the check command and paste output |
| API specs / Requirements are available | Read BRD or OpenAPI spec files | ... | run the check command and paste output |
| Target code file exists | `ls` / View file path of code to be tested | ... | run the check command and paste output |
| Mocking utilities exist / ready | Check test imports for mock libraries | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (QA Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (design test scenarios) | TARGET (docs/test-cases.md) | CHECK (cat docs/test-cases.md)`
- `n. ACTION (implement boundary value tests) | TARGET (tests/unit.test.ts) | CHECK (npm test tests/unit.test.ts)`
- `n. ACTION (implement invalid input tests) | TARGET (tests/unit.test.ts) | CHECK (npm test tests/unit.test.ts)`
- `n. ACTION (generate test coverage report) | TARGET (coverage/index.html) | CHECK (npm run test:coverage)`
