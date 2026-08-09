# Forgewright Self-Test Orchestrator

> **Purpose:** Validates Forgewright's own behavior including mode classification, plan quality scoring, and middleware chain execution.

**Source:** This skill is part of Phase 1 (Quick Wins) of the Forgewright improvement plan (v9). It ensures Forgewright tests itself systematically before shipping changes.

---

## Overview

The Test Orchestrator provides automated testing for core Forgewright behaviors:

| Category | Coverage |
|----------|----------|
| Mode Classification | 24 modes (100%) |
| Plan Quality Scoring | 9 criteria |
| Middleware Chain | 14 stages |
| Memory Retrieval | 5 key operations |
| Skill Routing | 15 edge cases |

---

## Test Runner

```bash
# Run all tests
bash scripts/run-self-tests.sh

# Run specific category
bash scripts/run-self-tests.sh --category mode-classification

# Run with verbose output
bash scripts/run-self-tests.sh --verbose

# Generate coverage report
bash scripts/run-self-tests.sh --coverage
```

---

## Test Categories

### Mode Classification Tests

Tests that verify the 24 execution modes are correctly detected from user requests.

| Mode | Trigger Phrases | Expected Classification |
|------|---------------|------------------------|
| Full Build | "build a SaaS", "from scratch", "full stack" | `Full Build` |
| Feature | "add [feature]", "implement", "new endpoint" | `Feature` |
| Review | "review my code", "code quality" | `Review` |
| Debug | "bug", "broken", "crash", "error" | `Debug` |
| Test | "write tests", "test coverage" | `Test` |
| Ship | "deploy", "CI/CD", "docker" | `Ship` |
| Architect | "design", "architecture" | `Architect` |
| Document | "document", "write docs" | `Document` |
| Explore | "explain", "how does" | `Explore` |
| Research | "research", "deep research" | `Research` |
| Optimize | "performance", "slow", "optimize" | `Optimize` |
| Design | "design UI", "wireframes" | `Design` |
| Mobile | "mobile app", "iOS", "Android" | `Mobile` |
| Game Build | "game", "Unity", "Unreal", "Godot", "Roblox" | `Game Build` |
| XR Build | "VR", "AR", "MR", "XR", "Quest" | `XR Build` |
| Marketing | "marketing", "SEO" | `Marketing` |
| Grow | "growth", "CRO", "conversion" | `Grow` |
| Analyze | "analyze requirements" | `Analyze` |
| AI Build | "AI feature", "chatbot", "RAG" | `AI Build` |
| Migrate | "migrate", "upgrade" | `Migrate` |
| Prompt | "improve prompts", "prompt engineering" | `Prompt` |
| Security | "secure", "harden", "audit" | `Harden` |
| Backend | "backend", "api", "server" | `Feature` (BE) |
| Frontend | "frontend", "react", "ui" | `Feature` (FE) |

### Plan Quality Scoring Tests

Tests that verify the 9-criteria scoring rubric works correctly.

| Criterion | Weight | Min Score |
|-----------|--------|-----------|
| Completeness | 1.0 | 0.888 (8/9) |
| Specificity | 1.0 | 0.888 (8/9) |
| Feasibility | 1.0 | 0.888 (8/9) |
| Risk Awareness | 1.0 | 0.888 (8/9) |
| Scope Control | 1.0 | 1.0 (9/9) |
| Dependency Ordering | 1.0 | 1.111 (10/9) |
| Testability | 1.0 | 0.888 (8/9) |
| Impact Assessment | 1.0 | 0.777 (7/9) |
| Evidence Verification | 1.0 | 0.888 (8/9) |

### Middleware Chain Tests

Tests that verify the 14-stage middleware chain executes correctly.

| Stage | Description | Max Latency |
|-------|-------------|-------------|
| 1 | Session Data Load | 200ms |
| 2 | Context/Memory Load | 300ms |
| 3 | Dry Run Context | 100ms |
| 4 | Skill Registry Load | 200ms |
| 5 | Guardrail Check | 100ms |
| 6 | Summarization | 200ms |
| 7 | Quality Gate Check | 100ms |
| 8 | Brownfield Safety Check | 200ms |
| 9 | Task Tracking Update | 100ms |
| 10 | Memory fact extraction | 300ms |
| 11 | Graceful Failure handler | 100ms |
| 12 | ASIP Self-Healing Loop | 2000ms |
| 13 | Circuit Breaker | 100ms |
| 14 | Evidence Verification | 500ms |

---

## Test Case Format

Each test case follows this structure:

```yaml
test_id: T1.3.1
category: mode-classification
description: "Mode classification: 'build a SaaS' triggers Full Build"
input:
  user_request: "build a SaaS for pet adoption"
expected:
  mode: "Full Build"
  confidence: ">=0.9"
  routing: "orchestrator"
```

---

## Success Criteria

| Metric | Target | Current |
|--------|--------|---------|
| Mode Coverage | 100% (24/24) | 0% |
| Plan Scoring Coverage | 100% (9/9) | 0% |
| Middleware Coverage | 100% (14/14) | 0% |
| Overall Test Pass Rate | >=95% | N/A |
| CI Integration | Yes | No |

---

## CI Integration

Add to your CI pipeline:

```yaml
# Canonical local command (hosted adapters may call this when explicitly requested)
- name: Run Forgewright Self-Tests
  run: |
    bash scripts/run-self-tests.sh --coverage --junit results.xml
```

---

## Future Enhancements

- [ ] Add fuzzy matching tests for mode classification
- [ ] Add regression tests for known bugs
- [ ] Add performance benchmark tests
- [ ] Add integration tests with real skills

---

*Last Updated: 2026-05-29*
*Part of: Phase 1 - Task 1.3*
