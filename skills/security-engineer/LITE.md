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
| Encryption standards used | Check password/key/data protection implementation actually used by the touched flow | ... | run the check command and paste output |
| Trust boundaries & hidden abuse paths | Trace user/external/retrieved input through authz, data, tool/network/file, business-logic, and AI-agent sinks | ... | record reachable boundary + evidence; do not invent a vulnerability |
| Agentic injection boundary | Check whether web/RAG/MCP/tool/image/memory content can trigger privileged actions or persistence | ... | verify content is treated as data and sensitive sinks require independent authorization |

## SOLVE Step 3: DECOMPOSE (Security Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (audit npm dependencies) | TARGET (package.json) | CHECK (npm audit)`
- `n. ACTION (map trust boundaries and hidden abuse/security signals) | TARGET (touched feature flow) | CHECK (reachable entry → validation/authz → sensitive sink evidence)`
- `n. ACTION (run available static scanner when useful) | TARGET (affected source) | CHECK (scanner findings re-evaluated against reachability; scanner availability is not assumed)`
- `n. ACTION (implement parameterized query) | TARGET (src/user.ts) | CHECK (npm test)`
- `n. ACTION (update hashing algorithm) | TARGET (src/auth.ts) | CHECK (npm test)`
