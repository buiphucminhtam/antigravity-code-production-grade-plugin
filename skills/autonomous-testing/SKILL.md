---
name: autonomous-testing
description: >
  [production-grade] Implements autonomous testing and self-healing workflow.
  After code generation, automatically runs tests (unit, integration, visual, E2E),
  detects bugs, attempts auto-fix, and continues development.
  Requires: Vitest, Playwright (VRT via Docker), LLM access.
version: 2.0.0
author: forgewright
tags: [autonomous, self-healing, testing, CI-CD, automated-bug-fix, vitest, playwright, e2e]
---

# Autonomous Testing Agent — Self-Healing QA Workflow

## Protocols

!`cat skills/_shared/protocols/qa-test-protocol.md 2>/dev/null || echo "=== QA Test Protocol not loaded ==="`

## Identity

You are the **Autonomous Testing Agent**. After code is generated:
1. Run tests automatically across all layers
2. Detect and classify bugs by severity and fixability
3. Auto-fix production code or test infrastructure only when the requirement-defined behavioral oracle remains unchanged
4. Re-test to verify fix
5. Continue development autonomously
6. Escalate to human if fix requires architectural changes or intent clarification

## Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│ CODE GENERATED                                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ RUN TESTS (Unit → Integration → Visual → E2E)                        │
│ • Parallel execution where possible                                   │
│ • Capture full error context (stack trace, test output, screenshots) │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DETECT BUGS                                                           │
│ • Classify by type: syntax, type, logic, integration, visual, e2e    │
│ • Assess severity: blocker, major, minor, cosmetic                    │
│ • Determine fixability: auto-fix, auto-fix-with-context, human       │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
                    ┌─────────┴─────────┐
                    │ Fixable?         │
                    └─────────┬─────────┘
              Yes              │              No
               ▼               │               ▼
    ┌──────────────────┐      │     ┌──────────────────┐
    │ AUTO-FIX (No     │      │     │ HUMAN ESCALATION │
    │ approval needed) │      │     │ (Blocker/Arch)   │
    └────────┬─────────┘      │     └──────────────────┘
             ▼                │
    ┌──────────────────┐      │
    │ RETEST           │      │
    │ • Verify fix     │──────┘
    │ • Check no       │
    │   regression     │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ CONTINUE         │
    │ Next task        │
    └──────────────────┘
```

## Test Layers

| Layer | Tool | Speed | Auto-Fix Rate | Coverage |
|-------|------|-------|---------------|----------|
| **Unit** | Vitest, Jest, pytest | 10ms | 90% | Functions, classes |
| **Integration** | Vitest, Supertest | 100ms | 60% | APIs, DB, services |
| **Component** | Testing Library | 50ms | 70% | React/Vue components |
| **Visual** | Playwright (Native VRT via Docker) | 1s | 50% | UI rendering |
| **E2E** | Playwright, Cypress | 10s | 30% | Full user flows |
| **Accessibility** | axe-core | 200ms | 50% | WCAG compliance |
| **Performance** | Lighthouse CI | 5s | 20% | Core Web Vitals |

## Auto-Fix Rules

### ✅ Auto-Fix (No Approval Required)

**Confidence: HIGH — Fix automatically**

```
1. Syntax errors (typos, missing brackets, wrong imports)
2. Type errors (TypeScript) - wrong types, missing type annotations
3. Import/require path errors - file moved, renamed
4. Simple logic bugs (< 5 lines) - off-by-one, null checks
5. Test-runner/setup/teardown plumbing defects that preserve the existing scenario, assertion, expected result, and coverage
6. Missing null/undefined checks
7. Simple dead code removal
8. Unused imports/variables
9. React prop warnings (missing required props)
10. ESLint/Prettier auto-fixable issues
```

### ⚠️ Auto-Fix (With Context)

**Confidence: MEDIUM — Show fix plan, proceed if human doesn't object**

```
1. Complex logic bugs (> 5 lines)
2. API response changes (verify intent)
3. UI layout changes (verify with screenshot)
4. Performance issues (measure before/after)
5. Missing test coverage (add tests for new code)
6. Race conditions (async timing issues)
7. Memory leaks (need profiling)
8. Security vulnerabilities (review severity first)
```

### ❌ Human Required

**Confidence: LOW — Always escalate**

```
1. Architectural changes (new files, folder structure)
2. Database migrations (data loss risk)
3. Breaking API changes (consumer impact)
4. Security vulnerabilities (manual review needed)
5. Intent unclear (ambiguous requirements)
6. Multiple bugs with dependencies
7. Performance regressions requiring profiling
8. Accessibility failures (WCAG compliance)
9. E2E test failures when the intended target/behavior is ambiguous
10. Any behavioral test-oracle change without an explicit current requirement/acceptance delta
```

## Bug Classification Matrix

| Type | Example | Auto-Fix | Human |
|------|---------|----------|-------|
| **Syntax** | Missing `;`, typo | ✅ | |
| **Type** | Wrong type annotation | ✅ | |
| **Logic** | `if (x = 1)` vs `if (x == 1)` | ✅ | |
| **Null** | `Cannot read property of undefined` | ✅ | |
| **Import** | Module not found | ✅ | |
| **API** | 500 error, wrong response | ⚠️ | |
| **UI** | Component renders wrong | ⚠️ | |
| **Integration** | DB query fails | ⚠️ | |
| **E2E** | Click target not found | | ❌ |
| **Security** | XSS vulnerability | | ❌ |
| **Performance** | Memory leak | | ❌ |

## Implementation

### Test Runner Framework

```typescript
// lib/autonomous-testing/test-runner.ts
import { VitestRunner } from './runners/vitest';
import { PlaywrightRunner } from './runners/playwright';
import { PlaywrightVisualRunner } from './runners/playwright-visual';
import { BugClassifier } from './classifier';
import { AutoFixer } from './auto-fixer';

export interface TestResult {
  layer: 'unit' | 'integration' | 'visual' | 'e2e' | 'a11y';
  passed: boolean;
  duration: number;
  bugs: Bug[];
  screenshots?: string[];
}

export interface Bug {
  id: string;
  type: 'syntax' | 'type' | 'logic' | 'null' | 'import' | 'api' | 'ui' | 'integration' | 'e2e';
  severity: 'blocker' | 'major' | 'minor' | 'cosmetic';
  file: string;
  line?: number;
  message: string;
  stack?: string;
  fixable: 'auto' | 'context' | 'human';
  suggestedFix?: string;
}

export class TestRunnerOrchestrator {
  private runners = {
    unit: new VitestRunner(),
    integration: new VitestRunner(),
    visual: new PlaywrightVisualRunner(),
    e2e: new PlaywrightRunner(),
  };

  async runAllLayers(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    // Run unit + integration in parallel
    const [unitResult, integrationResult] = await Promise.all([
      this.runners.unit.run({ type: 'unit' }),
      this.runners.integration.run({ type: 'integration' }),
    ]);
    results.push(unitResult, integrationResult);
    
    // Run visual tests
    const visualResult = await this.runners.visual.run();
    results.push(visualResult);
    
    // Run E2E tests
    const e2eResult = await this.runners.e2e.run({ type: 'e2e' });
    results.push(e2eResult);
    
    return results;
  }

  async processResults(results: TestResult[]): Promise<FixPlan[]> {
    const fixPlans: FixPlan[] = [];
    
    for (const result of results) {
      for (const bug of result.bugs) {
        const classifier = new BugClassifier();
        const classification = classifier.classify(bug);
        
        if (classification.fixable === 'auto' || classification.fixable === 'context') {
          const fixer = new AutoFixer();
          const plan = await fixer.createFixPlan(bug, classification);
          fixPlans.push(plan);
        } else {
          // Escalate to human
          await this.escalateToHuman(bug);
        }
      }
    }
    
    return fixPlans;
  }
}
```

### Bug Classifier

```typescript
// lib/autonomous-testing/classifier.ts
export class BugClassifier {
  classify(bug: Bug): BugClassification {
    const patterns = this.getPatterns();
    
    for (const [pattern, classification] of patterns) {
      if (pattern.test(bug.message)) {
        return classification;
      }
    }
    
    return {
      type: 'unknown',
      severity: 'minor',
      fixable: 'human',
    };
  }

  private getPatterns(): Array<[RegExp, BugClassification]> {
    return [
      // Syntax errors
      [/\bUnexpected token\b/, { type: 'syntax', severity: 'blocker', fixable: 'auto' }],
      [/\bmissing \w+ after\b/, { type: 'syntax', severity: 'blocker', fixable: 'auto' }],
      
      // Type errors
      [/Type '.*' is not assignable/, { type: 'type', severity: 'blocker', fixable: 'auto' }],
      [/Property '.*' does not exist/, { type: 'type', severity: 'blocker', fixable: 'auto' }],
      
      // Null/undefined errors
      [/Cannot read properties of (null|undefined)/, { type: 'null', severity: 'blocker', fixable: 'auto' }],
      [/is not a function\b/, { type: 'null', severity: 'major', fixable: 'auto' }],
      
      // Import errors
      [/Cannot find module/, { type: 'import', severity: 'blocker', fixable: 'auto' }],
      [/Module not found/, { type: 'import', severity: 'blocker', fixable: 'auto' }],
      
      // Logic errors
      [/\bif\s*\([^=!]+\s*=\s*\d+\)/, { type: 'logic', severity: 'major', fixable: 'auto' }], // Assignment in condition
      
      // API errors
      [/\b4\d\d\b/, { type: 'api', severity: 'major', fixable: 'context' }],
      [/\b5\d\d\b/, { type: 'api', severity: 'blocker', fixable: 'context' }],
      
      // UI errors
      [/Target not found/, { type: 'e2e', severity: 'major', fixable: 'human' }],
      [/Element.*not visible/, { type: 'e2e', severity: 'minor', fixable: 'human' }],
    ];
  }
}
```

### Auto-Fixer

```typescript
// lib/autonomous-testing/auto-fixer.ts
export class AutoFixer {
  async createFixPlan(bug: Bug, classification: BugClassification): Promise<FixPlan> {
    switch (classification.type) {
      case 'syntax':
        return this.fixSyntax(bug);
      case 'type':
        return this.fixType(bug);
      case 'null':
        return this.fixNull(bug);
      case 'import':
        return this.fixImport(bug);
      case 'logic':
        return this.fixLogic(bug);
      default:
        return this.fixGeneric(bug);
    }
  }

  private async fixSyntax(bug: Bug): Promise<FixPlan> {
    // Use ESLint's built-in fixer
    const fixer = new ESLintFixer();
    return {
      bug,
      changes: await fixer.getFix(bug.file, bug.message),
      confidence: 'high',
      verificationSteps: ['Run ESLint --fix', 'Run affected tests'],
    };
  }

  private async fixType(bug: Bug): Promise<FixPlan> {
    // Analyze TypeScript error and suggest type fix
    const typeInfo = await this.analyzeTypeError(bug);
    
    return {
      bug,
      changes: [
        {
          file: bug.file,
          action: 'replace',
          before: typeInfo.incorrectType,
          after: typeInfo.correctType,
        }
      ],
      confidence: 'high',
      verificationSteps: ['Type check with tsc', 'Run affected tests'],
    };
  }

  private async fixNull(bug: Bug): Promise<FixPlan> {
    // Add null checks
    const context = this.getContextAround(bug);
    
    return {
      bug,
      changes: [
        {
          file: bug.file,
          action: 'add-guard',
          guard: this.generateNullGuard(context),
          location: bug.line,
        }
      ],
      confidence: 'high',
      verificationSteps: ['Run affected tests'],
    };
  }

  private async fixImport(bug: Bug): Promise<FixPlan> {
    const moduleName = this.extractModuleName(bug.message);
    const possiblePaths = await this.findModulePaths(moduleName);
    
    if (possiblePaths.length === 1) {
      return {
        bug,
        changes: [{
          file: bug.file,
          action: 'replace',
          before: `'${moduleName}'`,
          after: `'${possiblePaths[0]}'`,
        }],
        confidence: 'high',
        verificationSteps: ['Run linter', 'Run affected tests'],
      };
    }
    
    return {
      bug,
      options: possiblePaths,
      confidence: 'medium',
      askHuman: 'Multiple possible paths found',
    };
  }

  private async fixLogic(bug: Bug): Promise<FixPlan> {
    // Analyze the logic and suggest fix
    const analysis = await this.analyzeLogic(bug);
    
    return {
      bug,
      changes: analysis.changes,
      confidence: analysis.confidence,
      verificationSteps: ['Run unit tests', 'Run integration tests'],
    };
  }
}
```

## Commands

```bash
# Run all tests
forge test

# Run specific layer
forge test unit
forge test integration
forge test visual
forge test e2e
forge test a11y

# Auto-fix and retry
forge test:fix

# Autonomous mode (auto-fix + continue)
forge test:autonomous

# Run with coverage
forge test --coverage

# Run specific test file
forge test unit src/utils/format.test.ts

# Debug mode (verbose output)
forge test --debug

# Generate report
forge test --report
```

## Configuration

```yaml
# .forgewright/autonomous.yaml
autonomous:
  enabled: true
  maxAutoFixAttempts: 3
  requireHumanApproval: false
  escalationThreshold: 3  # Escalate after 3 failed fix attempts
  
  layers:
    unit:
      enabled: true
      autoFix: true
      timeout: 60s
      autoFixTypes:
        - syntax
        - type
        - null
        - import
        - logic
    integration:
      enabled: true
      autoFix: true
      timeout: 120s
      autoFixTypes:
        - syntax
        - type
        - null
    visual:
      enabled: true
      autoFix: false  # Human review for visual changes
      timeout: 300s
      baselineBranch: main
    e2e:
      enabled: true
      autoFix: false  # E2E issues often environment-related
      timeout: 600s
      retries: 2  # Retry flaky tests
    a11y:
      enabled: true
      autoFix: true
      timeout: 180s
      standards: [wcag2a, wcag2aa]

  llm:
    provider: anthropic
    model: claude-sonnet-4
    temperature: 0.3
    maxTokens: 2000

  reporting:
    format: [json, html, slack]
    channels:
      - slack: #qa-alerts
      - email: qa-team@company.com
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | All tests pass | Continue to next task |
| 1 | Tests fail (auto-fix attempted) | Fix → Re-test → Continue or Escalate |
| 2 | Tests fail (human required) | Generate report → Wait for human |
| 3 | Infrastructure error | Log → Retry → Escalate if persistent |
| 4 | Timeout | Increase timeout or split tests |
| 5 | Test file not found | Check test path |

## Test File Conventions

```
src/
├── components/
│   └── Button/
│       ├── Button.tsx
│       └── Button.test.tsx       # Component tests
├── hooks/
│   └── useUser.ts
│       └── useUser.test.ts       # Hook tests
├── utils/
│   └── format.ts
│       └── format.test.ts        # Utility tests
└── __tests__/
    ├── integration/              # Integration tests
    │   ├── api.test.ts
    │   └── db.test.ts
    ├── visual/                  # Visual tests
    │   ├── login-page.spec.ts
    │   └── dashboard.spec.ts
    └── e2e/                     # E2E tests
        └── checkout.spec.ts
```

## Self-Healing Patterns

### Test Flakiness Detection
```typescript
// Detect and handle flaky tests
class FlakyTestDetector {
  private flakyTests = new Map<string, number>();
  private readonly FLACKY_THRESHOLD = 3;
  
  recordFailure(testName: string): void {
    const count = (this.flakyTests.get(testName) || 0) + 1;
    this.flakyTests.set(testName, count);
    
    if (count >= this.FLACKY_THRESHOLD) {
      this.markAsFlaky(testName);
      this.suggestFix(testName);
    }
  }
  
  private suggestFix(testName: string): void {
    // Common flakiness fixes:
    // 1. Add explicit waits
    // 2. Increase timeout
    // 3. Add retry decorator
    // 4. Fix timing issues
  }
}
```

### Visual Regression Self-Healing
```typescript
// Visual baselines are requirement/reference oracles and are never auto-approved.
class VisualRegressionHandler {
  async handleVisualDiff(result: VisualDiff): Promise<void> {
    const changes = this.categorizeChanges(result);

    // A cosmetic diff is still a mismatch unless an explicit current visual
    // requirement/reference change authorizes a new baseline.
    if (changes.all('cosmetic')) {
      await this.escalateToHuman(result);
      return;
    }

    if (changes.any('functional')) {
      await this.escalateToHuman(result);
    }
  }
  
  private categorizeChanges(diff: VisualDiff): ChangeCategories {
    return {
      text: diff.textChanges,      // Always review
      layout: diff.layoutChanges,  // Review if > 5px
      color: diff.colorChanges,    // Auto if < 5% difference
      spacing: diff.spacingChanges, // Review if > 3px
    };
  }
}
```

## Docker & Mobile CI/CD Integration

### Playwright VRT Docker Execution
To prevent cross-platform font rendering and layout flakiness, run Playwright VRT inside the official Playwright Docker container:

```bash
# Run VRT locally or on CI/CD using the official Playwright container
docker run --rm --network host -v $(pwd):/work/ -w /work/ mcr.microsoft.com/playwright:v1.45.0-jammy npx playwright test --grep @visual
```

### Mobile CI/CD Strategy
*   **CI/CD (GitHub Actions / GitLab CI)**: Run mobile web/responsive tests using Playwright's mobile emulation (e.g., `devices['Pixel 5']` or `devices['iPhone 12']`) on a standard Linux runner.
*   **Local Machine (Pre-commit/PR check)**: Run full E2E testing on native Android Emulators or iOS Simulators.

## Integration with Forgewright

### Hook into Build Pipeline
```typescript
// hooks/post-build.ts
import { TestRunnerOrchestrator } from './lib/autonomous-testing';

export async function postBuildHook(): Promise<void> {
  const runner = new TestRunnerOrchestrator();
  
  console.log('Running autonomous tests...');
  const results = await runner.runAllLayers();
  
  const failedBugs = results.flatMap(r => r.bugs);
  if (failedBugs.length > 0) {
    const fixPlans = await runner.processResults(results);
    
    console.log(`Found ${failedBugs.length} bugs, attempting fixes...`);
    
    for (const plan of fixPlans) {
      if (plan.confidence === 'high') {
        await plan.execute();
      }
    }
    
    // Re-run to verify
    const recheck = await runner.runAllLayers();
    if (recheck.some(r => !r.passed)) {
      console.log('⚠️ Some tests still failing - manual review needed');
      await runner.generateReport(recheck);
    }
  }
}
```

## Best Practices

1. **Test isolation**: Each test is independent, no shared state
2. **Deterministic tests**: Same input always produces same output
3. **Fast feedback**: Unit tests < 100ms, integration < 1s
4. **Clear assertions**: Tests fail with actionable error messages
5. **Coverage minimums**: 80% coverage target, 100% for critical paths
6. **Flaky test handling**: Retry once, then mark as flaky
7. **CI integration**: Run on every PR, block on failures
8. **Parallel execution**: Run independent tests concurrently

## Output

When tests run, generate a report:

```
.forgewright/autonomous-testing/
├── reports/
│   ├── {timestamp}-report.json
│   ├── {timestamp}-report.html
│   └── failures/
│       └── {test-name}/
│           ├── screenshot.png
│           ├── stack-trace.txt
│           └── suggested-fix.md
└── baselines/
    ├── visual/
    └── snapshots/
```
