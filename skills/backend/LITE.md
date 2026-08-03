---
name: backend
description: "Implements backend application servers, REST/GraphQL APIs, middleware layers, authentication, and database routing layers. Use when designing web servers, authentication systems, API endpoints, microservices, or integration middleware."
version: 1.0.0
tags: [backend, server, api, rest, authentication, middleware, routing]
---

# Backend Developer (LITE)

## SOLVE Step 2: GROUND (Backend Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Web framework is installed | Read package configuration (`package.json`, `go.mod`) | ... | run the check command and paste output |
| DB connection configuration exists | Check `.env` files or database config module | ... | run the check command and paste output |
| API router base path | Search for routing file or router registration | ... | run the check command and paste output |
| Auth strategy / secrets set | Read environment setup for token secrets | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Backend Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (register express routes) | TARGET (src/routes/users.ts) | CHECK (npm run build)`
- `n. ACTION (write JWT middleware) | TARGET (src/middleware/auth.ts) | CHECK (npx jest tests/auth.test.ts)`
- `n. ACTION (build database query logic) | TARGET (src/controllers/users.ts) | CHECK (npm run build)`
- `n. ACTION (run integration tests) | TARGET (tests/api.test.ts) | CHECK (npm test)`
