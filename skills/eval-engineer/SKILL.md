# Eval Engineer Skill

> **Role:** Design, implement, and maintain pass@k evaluation frameworks for Forgewright skills.

## Overview

The Eval Engineer skill enables systematic capability testing and regression detection for every Forgewright skill. It provides the methodology for creating meaningful evals, interpreting results, and maintaining quality standards across the codebase.

## Core Concepts

### What is pass@k?

`pass@k` measures the probability that a task succeeds within k attempts:

```
pass@1  = P(success on first try)      # Strictest
pass@3  = P(success within 3 attempts)  # Recommended
pass@5  = P(success within 5 attempts)  # Lenient
```

**Why k > 1?** Because:
1. LLMs are stochastic — same prompt can get different results
2. A single failure doesn't mean the skill is broken
3. More accurate measurement of true capability

**Formula:**
```
pass@k = 1 - (1 - pass_rate)^k
```

Where `pass_rate` is the fraction of tasks that passed.

### Why pass@k Matters

| Metric | What it tells you |
|--------|------------------|
| pass@1 | Consistency (does it work every time?) |
| pass@3 | Reliability (can it recover from failures?) |
| pass@5 | Resilience (how often does it eventually succeed?) |

## YAML Task Schema

Every eval task follows this schema:

```yaml
id: unique-task-identifier          # Required: unique across all evals
description: "Human-readable summary" # Required: what this tests
prompt: |                            # Required: exact prompt for agent
  The exact prompt text...
expected: "Success criteria"          # Required: what "success" looks like
validator: code_present              # Required: how to validate
difficulty: medium                   # Recommended: easy/medium/hard
skills_tested:                       # Required: which skills this exercises
  - software-engineer
  - code-reviewer
points: 20                            # Points for this task
hints:                                # Optional: hints for failed attempts
  - "Hint 1"
  - "Hint 2"
tags:                                 # Optional: categorization
  - file-editing
  - typescript
```

## Validator Types

| Validator | When to Use | Returns |
|-----------|-------------|---------|
| `code_present` | Check if text/code exists in output | pass/fail |
| `git_diff_check` | Verify file changes via git | pass/fail + diff |
| `code-grader` | Automated syntax/style validation | 0-100 score |
| `human-grader` | Requires human judgment | 0-100 score |
| `multi_file_check` | Multiple files must exist/modify | pass/fail |

### Choosing the Right Validator

```
Is the task fully automatable?
├── Yes → Can we parse the output structurally?
│   ├── Yes → code_present or git_diff_check
│   └── No  → code-grader
└── No → Does it require expert judgment?
    ├── Yes → human-grader
    └── No  → Consider redesigning the task
```

## Writing Good Eval Tasks

### Good Task Characteristics

1. **Deterministic** — Same prompt = same expected outcome
2. **Verifiable** — Can automatically confirm success
3. **Focused** — Tests one specific capability
4. **Non-flaky** — Results are reproducible

### Bad Task Patterns

❌ **Too vague:**
```yaml
prompt: "Make the code better"
expected: "Code improved"
# How do you verify this automatically?
```

❌ **Too broad:**
```yaml
prompt: "Build a complete SaaS application"
expected: "Working app"
# This tests everything and nothing
```

✅ **Specific and verifiable:**
```yaml
prompt: "Add error handling to fetchData() in src/api.ts"
expected: "try/catch block with error handling present"
validator: code_present
```

### Difficulty Guidelines

| Difficulty | When to Use | Example |
|------------|-------------|---------|
| easy | Basic skill usage | "Rename a function" |
| medium | Standard workflow | "Add feature with tests" |
| hard | Complex multi-step | "Debug race condition" |

## Capability Categories

### 1. Coding Basic

Tests fundamental coding abilities:
- File creation/editing
- Syntax correctness
- Import statements
- Error handling
- TypeScript/JavaScript patterns

**File:** `capabilities/coding-basic.yaml`

### 2. Pipeline Complete

Tests full pipeline execution:
- INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN
- Mode classification
- Skill routing
- End-to-end workflows

**File:** `capabilities/pipeline-complete.yaml`

### 3. Skill Routing

Tests mode classification accuracy:
- Correct skill selection
- Ambiguous request handling
- Multi-skill coordination
- Context-aware routing

**File:** `capabilities/skill-routing.yaml`

## Running Evals

### Single Command

```bash
# Run all evals
bash .claude/evals/run-eval.sh

# Run specific capability
bash .claude/evals/run-eval.sh --capability coding-basic

# Verbose mode
bash .claude/evals/run-eval.sh --verbose

# CI mode (JSON only)
bash .claude/evals/run-eval.sh --ci
```

### Expected Output

```
==============================================
              EVAL SUMMARY
==============================================

Capability                  | Tasks   | Score | Grade
---------------------------+---------+-------+-------
coding-basic               | 6       | 85    | B
pipeline-complete          | 5       | 78    | C
skill-routing              | 8       | 82    | B
---------------------------+---------+-------+-------
TOTAL                      | 19      | 82    | B

Duration: 45s
Results:  .claude/evals/results/eval-2026-06-02.json

Pass Rate: [##################################################] 79%
```

## Interpreting Results

### Score Thresholds

| Grade | Score | Action |
|-------|-------|--------|
| A | 90-100 | Excellent — maintain quality |
| B | 80-89 | Good — minor improvements OK |
| C | 70-79 | Passing — address weak areas |
| D | 60-69 | Below expectations — requires fixes |
| F | 0-59 | Failed — blocking, must fix |

### Regression Detection

The framework automatically compares results against the latest baseline:

```
✓ No regression detected      # Score within 10 points of baseline
⚠ Score dropped by X points   # Outside threshold but < 10
✗ REGRESSION DETECTED        # Score dropped > 10 points
```

**When regression is detected:**
1. Review the failing tasks and the requirement/rubric that owns expected behavior.
2. Identify the root cause.
3. If the requirement/rubric is unchanged, keep eval cases/labels/expected outputs read-only and fix the skill/implementation. Update an eval oracle only after an explicit current requirement/rubric change; if intent is ambiguous, ask the user/owner first.
4. Re-run to verify.

### pass@k Interpretation

| pass@1 | pass@3 | pass@5 | Interpretation |
|--------|--------|--------|----------------|
| 0.9 | 0.95 | 0.98 | Excellent consistency |
| 0.7 | 0.85 | 0.92 | Good reliability |
| 0.5 | 0.70 | 0.80 | Needs improvement |
| 0.3 | 0.50 | 0.65 | Unreliable |

## Adding New Capabilities

### Step 1: Create the YAML file

```bash
# Create new capability file
touch .claude/evals/capabilities/my-new-capability.yaml
```

### Step 2: Define tasks

```yaml
id: my-new-capability
description: "Tests my new capability"
version: "1.0.0"
category: my-category

tasks:
  - id: first-task
    description: "What this tests"
    prompt: "Exact prompt for the agent"
    expected: "What success looks like"
    validator: code_present
    difficulty: easy
    skills_tested:
      - software-engineer
    points: 10
```

### Step 3: Register in config.yaml

```yaml
capabilities:
  - coding-basic
  - pipeline-complete
  - skill-routing
  - my-new-capability  # Add here
```

### Step 4: Run and verify

```bash
bash .claude/evals/run-eval.sh --capability my-new-capability
```

### Step 5: Document

Update `README.md` with the new capability description.

## Grader Implementation

### code-grader.ts

Automated validation for:
- Syntax correctness
- File existence
- Code patterns
- Basic lint

**API:**
```typescript
interface GradingResult {
  score: number;      // 0-100
  grade: string;      // A, B, C, D, F
  passed: boolean;
  details: string;
  errors?: string[];
  suggestions?: string[];
}

async function gradeCode(input: ValidationInput): Promise<GradingResult>
```

### human-grader.ts

For tasks requiring expert judgment:
- Security reviews
- Architecture decisions
- UX feedback
- Complex edge cases

**API:**
```typescript
interface HumanGradingResult {
  score: number;
  grade: string;
  passed: boolean;
  requiresHumanReview: boolean;
  feedback?: string;
}

async function submitForHumanReview(request: HumanGradingRequest): Promise<HumanGradingResult>
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Eval Quality Gate

on:
  pull_request:
    branches: [main]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run Evals
        run: bash .claude/evals/run-eval.sh --ci
        
      - name: Check Results
        run: |
          PASS_RATE=$(cat results.json | jq '.summary.pass_rate')
          if (( $(echo "$PASS_RATE < 70" | bc -l) )); then
            echo "Eval failed: pass rate $PASS_RATE < 70%"
            exit 1
          fi
```

## Best Practices

1. **Start simple** — Begin with easy tasks, add complexity gradually
2. **Be specific** — Precise prompts produce reliable results
3. **Test edge cases** — Don't just test happy paths
4. **Maintain baselines** — Capture baseline before improvements
5. **Track trends** — Compare results over time
6. **Iterate** — Refine tasks based on results

## Troubleshooting

### Eval hangs or times out
- Check timeout setting in `config.yaml`
- Verify prompts aren't asking for infinite loops
- Ensure validators don't wait for external resources

### Inconsistent results
- Make prompts more deterministic
- Add more specific expected criteria
- Check for randomness in the agent

### All tasks pass but score is low
- Review scoring logic in graders
- Adjust point values
- Check for false positives in validators

## Related Skills

| Skill | Relationship |
|-------|-------------|
| QA Engineer | Testing methodology |
| Code Reviewer | Quality standards |
| Debugger | Failure analysis |

## Files Reference

```
.claude/evals/
├── README.md                  # User-facing documentation
├── config.yaml                # Global configuration
├── run-eval.sh                # Main eval runner
├── capabilities/              # Task definitions
│   ├── coding-basic.yaml
│   ├── pipeline-complete.yaml
│   └── skill-routing.yaml
├── graders/                   # Validation implementations
│   ├── code-grader.ts
│   └── human-grader.ts
├── regressions/               # Baseline snapshots
│   └── baseline-*.json
└── results/                   # Eval output
    └── eval-*.json
```

---

*Last updated: 2026-06-02*
*Version: 1.0.0*
