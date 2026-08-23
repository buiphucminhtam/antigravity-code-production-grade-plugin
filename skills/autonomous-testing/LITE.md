---
name: autonomous-testing
description: "Orchestrates automated test execution, property-based testing (PBT), mutation testing, and visual/E2E test suites via Vitest, Stryker, fast-check, Playwright, or Maestro. Use when the user requests automated testing pipelines, test suite creations, coverage audits, or validation of software quality gates before deployment."
version: 1.0.0
---

# Autonomous Testing (LITE)

## SOLVE Step 2: GROUND (Autonomous Testing Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target testing libraries (Vitest, Stryker, fast-check, Playwright, Maestro) are installed | `cat package.json \| jq '.dependencies, .devDependencies \| select(. != null) \| with_entries(select(.key \| match("vitest\|stryker\|fast-check\|playwright\|maestro")))'` | ... | run the check command and paste output |
| Existing test configurations, suites, or specifications exist in the workspace | `find tests/ src/ -name "*.test.ts" -o -name "*.spec.ts" -o -name "playwright.config.ts"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Autonomous Testing Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Analyze test coverage reports, mutation scores, and property-based test bounds | Verify that code coverage and mutation tests comply with configured quality gate criteria.
2. GENERATE | Build automated BDD test specifications, mock stubs, or fast-check property-based suites | Ensure test stubs are registered under `tests/` matching BDD specifications prior to main code build.
3. EXECUTE | Run local unit, integration, visual regression, or E2E mobile test suites | Confirm clean test passes on all endpoints, verify zero visual drift, and track execution status in the session graph.

## Common Mistakes Checklist
- **Green-suite goal hacking**: Rewriting assertions, expected outputs, snapshots/goldens, eval labels, skips, or scenarios to match the current implementation. Behavioral test oracles are requirement-locked; if the requirement is insufficient or contradictory, ask the user/product owner instead of changing the test.
- **Testing implementation details instead of BDD specifications**: Writing fragile unit tests that couple tightly to private class internals instead of verifying functional BDD acceptance criteria.
- **Ignoring Mutation or PBT verification**: Relying solely on raw code line coverage without running property-based or mutation testing, allowing low-assertion test cases to pass.
- **Dangling test runner ports**: Failing to close headless browser contexts or database socket handles on test cleanup, leading to port collisions or memory leaks.
- **Non-compliant test file naming**: Saving test specifications, configurations, or operations logs using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `tests/UserTest.ts` instead of `tests/user-test.ts`).

### Step 1: Verify the testing framework configuration and project profile
```bash
cat .forgewright/project-profile.json
cat package.json | grep -E "(vitest|stryker)"
```
```json
    "vitest": "^1.6.0",
    "@stryker-mutator/core": "^8.0.0"
```

### Step 2: Write a BDD-aligned property-based test under `tests/user-validation.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Implementation target
const isValidUsername = (username: string): boolean => {
  return username.length >= 3 && username.length <= 15 && /^[a-z0-9-]+$/.test(username);
};

describe('Username Validation BDD-First Specs', () => {
  // Scenario: String boundary checks using property-based testing (PBT)
  it('should accept valid kebab-case strings and reject invalid inputs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 3, maxLength: 15 }), (input) => {
        const result = isValidUsername(input);
        if (/^[a-z0-9-]+$/.test(input)) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      })
    );
  });
});
```

### Step 3: Run the test suites with Stryker mutation testing and generate quality audits
```bash
npx vitest run --coverage
npx stryker run
```
