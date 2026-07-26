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

---

### 1. UNDERSTAND
- **Task**: Design and write unit tests for `calculateDiscount(age: number, cartTotal: number): number` in `src/discount.ts`.
- **What must be TRUE**: 100% path coverage, all boundary values (age: 0, 18, 65; cart: 0, 100) are verified; tests pass.
- **What could I be wrong about**: Handling negative age or cart total inputs.

### 2. GROUND
| Assumption | Check command / file read | Result | VERIFIED? |
|---|---|---|---|
| Function logic exists | `ls src/discount.ts` | File exists | Y |
| Function signature matches | View `src/discount.ts` | `calculateDiscount(age, cartTotal)` | Y |
| Test command is available | Read `package.json` scripts | `"test": "jest"` | Y |

### 3. DECOMPOSE
1. ACTION (design Gherkin test cases)   TARGET (docs/discount-tests.md)   CHECK (cat docs/discount-tests.md)
2. ACTION (write unit test assertions)   TARGET (tests/discount.test.ts)   CHECK (npx jest tests/discount.test.ts)
3. ACTION (run with coverage)   TARGET (coverage/)   CHECK (npx jest tests/discount.test.ts --coverage)

### 4. EXECUTE
#### Step 1: Design test cases
- Created `docs/discount-tests.md` with:
  - GIVEN age is 65 (Senior), WHEN cart total is $100, THEN discount is 15%.
  - GIVEN age is 17 (Minor), WHEN cart total is $100, THEN discount is 10%.
  - GIVEN invalid inputs (negative values), THEN throw Error.
- CHECK: `cat docs/discount-tests.md` -> Printed scenarios correctly.

#### Step 2: Write unit tests
- Created `tests/discount.test.ts` testing bounds: age=17, 18, 64, 65, and negative numbers.
- CHECK: `npx jest tests/discount.test.ts` -> Passed.

#### Step 3: Run coverage
- CHECK: `npx jest tests/discount.test.ts --coverage` -> 100% statement and branch coverage.

### 5. VERIFY
CLAIM: discount calculator is fully validated for all boundary and error inputs
COMMAND: npx jest tests/discount.test.ts --coverage
PASS  tests/discount.test.ts
✓ should apply senior discount
✓ should apply minor discount
✓ should reject negative values
----------------------------------------------------
File        % Stmts   % Branch   % Funcs   % Lines
----------------------------------------------------
discount.ts      100        100       100       100
----------------------------------------------------
EXIT CODE: 0
VERDICT: PASS

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
