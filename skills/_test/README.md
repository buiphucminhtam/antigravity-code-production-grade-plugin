# Forgewright Skill Testing Framework

> **Purpose:** Validate deterministic skill-test contracts in CI and optionally run
> behavioral tests through an explicitly configured live adapter.

## Directory Structure

```
skills/_test/
├── README.md                      # This file
├── skill-test-executor.py         # Contract validator and live adapter runner
└── skills/
    ├── software-engineer/
    │   └── test.yaml              # Test contract definitions
    ├── code-reviewer/
    │   └── test.yaml
    └── [skill-name]/
        └── test.yaml

scripts/testing/
└── test-runner.sh                 # Stable shell entrypoint
```

## Test Case Format

Test cases are defined in `test.yaml`:

```yaml
skill: software-engineer
version: "1.0.0"
tests:
  - id: test-basic-endpoint
    description: Generate a basic REST endpoint
    tags: [basic, api, rest]
    input:
      language: typescript
      framework: express
      endpoint: /api/users
      method: GET
    expected:
      contains:
        - "export default"
        - "async function"
        - "/api/users"
      files_created: 1
      min_lines: 10
    validate:
      - output_contains_all
      - file_count_matches
      - min_lines_satisfied
    timeout: 60s
  
  - id: test-auth-middleware
    description: Generate auth middleware
    tags: [auth, middleware, security]
    input:
      language: typescript
      type: auth-middleware
      auth_type: jwt
    expected:
      contains:
        - "verify"
        - "jwt"
        - "authorization"
      not_contains:
        - "TODO"
        - "FIXME"
    validate:
      - output_contains_all
      - output_excludes_none
    timeout: 60s
```

## Running Tests

### Validate All Contracts

```bash
bash scripts/testing/test-runner.sh --all --contract-only
```

### Run Specific Skill

```bash
bash scripts/testing/test-runner.sh software-engineer --contract-only
```

### Run Specific Test

```bash
bash scripts/testing/test-runner.sh software-engineer test-basic-rest-endpoint --contract-only
```

### Run Tests by Tag

```bash
bash scripts/testing/test-runner.sh --all --tag basic --contract-only
bash scripts/testing/test-runner.sh --all --tag api,rest --contract-only
```

Contract mode validates YAML structure, skill existence, unique IDs, validator
coverage, assertion types, tags, and timeouts. It never fabricates model output
and never claims behavioral skill execution.

### Run Live Behavioral Tests

Set `FORGEWRIGHT_SKILL_TEST_ADAPTER` or pass `--adapter-command`. The command is
executed directly without a shell. It receives one JSON request on stdin and
must return one JSON object on stdout:

```json
{
  "output": "the complete skill response",
  "metrics": {
    "files_created": 1,
    "findings": 3,
    "severity_count": {"high": 1, "medium": 2}
  }
}
```

```bash
FORGEWRIGHT_SKILL_TEST_ADAPTER="./tools/live-skill-adapter" \
  bash scripts/testing/test-runner.sh --all --require-live
```

Numeric expectations such as `min_findings` require adapter-attested metrics;
the runner does not infer or invent them from prose.

## Test Results

Pass `--report <path>` to write a JSON report. Reports are not created unless an
explicit path is provided:

```bash
bash scripts/testing/test-runner.sh --all --contract-only \
  --report /tmp/forgewright-skill-contracts.json
```

```json
{
  "schema_version": 1,
  "timestamp": "2026-04-21T12:00:00+00:00",
  "mode": "contract-only",
  "passed": 71,
  "failed": 0,
  "skipped": 0,
  "tests": [
    {
      "id": "test-basic-endpoint",
      "skill": "software-engineer",
      "status": "passed"
    }
  ]
}
```

## CI Integration

Add to CI pipeline:

```bash
# Run skill tests on PR
if bash scripts/testing/test-runner.sh --all --contract-only; then
  echo "All skill tests passed"
else
  echo "Skill tests failed"
  exit 1
fi
```

## Writing New Tests

### 1. Create Test Directory

```bash
mkdir -p skills/_test/skills/{skill-name}
```

### 2. Add Test YAML

Create `skills/_test/skills/{skill-name}/test.yaml`:

```yaml
skill: {skill-name}
version: "1.0.0"
tests:
  - id: test-{case-name}
    description: Description of what this test validates
    tags: [tag1, tag2]
    input:
      key: value
    expected:
      contains:
        - "expected string"
    validate:
      - output_contains_all
    timeout: 60s
```

## Validation Functions

Available validation functions:

| Function | Purpose |
|----------|---------|
| `output_contains_all` | All expected strings present |
| `output_excludes_none` | No forbidden strings present |
| `file_count_matches` | Correct number of files created |
| `min_lines_satisfied` | Minimum line count met |
| `min_<metric>_satisfied` | Adapter-attested metric meets `expected.min_<metric>` |
| `severity_counts_match` | Adapter-attested severity counts meet declared minima |
| `no_todos` | No TODO/FIXME in output |

## Maintenance

### Updating Tests

When a skill changes:
1. Run existing tests
2. Update expected outputs if behavior changed
3. Add new tests for new functionality
4. Update skill version in test.yaml

### Deprecating Tests

Mark deprecated tests:

```yaml
- id: test-old-feature
  description: Old feature test (deprecated)
  deprecated: true
  deprecated_reason: "Feature removed in v2.0"
  skip: true
```

## History

- v1.0 — Initial framework (inspired by CCGS Skill Testing Framework)
