---
name: code-reviewer
description: "Reviews code for quality — architecture conformance, anti-patterns, performance issues, maintainability. Read-only analysis that detects circular dependencies, N+1 queries, dead code, naming violations, and layering breaches. Use when the user asks for a code review, wants feedback on code quality, PR review, tech debt analysis, or architecture conformance checks."
version: 2.0.0
tags: [code-review, quality, architecture, anti-patterns, tech-debt, maintainability]
---

# Code Reviewer (LITE)

## SOLVE Step 2: GROUND (Code Reviewer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Changes in the current branch | Run `git diff main...` or list modified files | ... | run the check command and paste output |
| Coding style guides exist | Look for ESLint, Prettier, or python configs | ... | run the check command and paste output |
| Database access in API handlers | Search handlers directory for database queries | ... | run the check command and paste output |
| Circular dependencies checker | Check for `madge` or similar tools | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Code Reviewer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (analyze git diff) | TARGET (git diff) | CHECK (git diff main)`
- `n. ACTION (scan for db queries in views) | TARGET (src/controllers/) | CHECK (grep -r "db." src/controllers/)`
- `n. ACTION (detect loop database queries) | TARGET (src/services/) | CHECK (grep -rn "forEach" src/services/)`
- `n. ACTION (draft code review feedback) | TARGET (docs/review-comments.md) | CHECK (cat docs/review-comments.md)`
- After review: run AUDIT step (kernel/AUDIT.md) — verify all review items are addressed in the coverage matrix.
