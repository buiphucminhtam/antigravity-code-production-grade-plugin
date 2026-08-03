---
name: security-engineer
description: "[production-grade internal] Audits code for security vulnerabilities — OWASP top 10, auth flaws, injection, data exposure, dependency risks, AI/LLM security, pen testing, threat modeling, and compliance automation. Routed via the production-grade orchestrator."
version: 2.0.0
tags: [security, owasp, pentest, threat-modeling, compliance, hardening, audit]
---

# Security Engineer (LITE)

## SOLVE Step 2: GROUND (Security Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Dependency vulnerabilities | Run package manager audit command | ... | run the check command and paste output |
| Static analysis scanner ready | Check if `semgrep` or `bandit` is installed | ... | run the check command and paste output |
| Raw SQL queries exist | Search codebase for string concatenation in SQL | ... | run the check command and paste output |
| Encryption standards used | Check passwords hashing algorithm in code | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Security Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (audit npm dependencies) | TARGET (package.json) | CHECK (npm audit)`
- `n. ACTION (scan code with semgrep) | TARGET (src/) | CHECK (npx semgrep --config auto src/)`
- `n. ACTION (implement parameterized query) | TARGET (src/user.ts) | CHECK (npm test)`
- `n. ACTION (update hashing algorithm) | TARGET (src/auth.ts) | CHECK (npm test)`
