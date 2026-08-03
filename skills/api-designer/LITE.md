---
name: api-designer
description: "Designs production-grade APIs — REST, GraphQL, gRPC, and AsyncAPI patterns including pagination, versioning, error handling, rate limiting, and API governance. Use when the user asks to design APIs, create endpoints, build an API layer, write OpenAPI specs, or needs help with REST/GraphQL/gRPC service design."
version: 2.0.0
tags: [api, rest, graphql, grpc, openapi, asyncapi, versioning, design, contracts]
---

# API Designer (LITE)

## SOLVE Step 2: GROUND (API Designer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| OpenAPI spec path exists | Search directory for `openapi.yaml` or `swagger.json` | ... | run the check command and paste output |
| Spec version format | Read file header of the OpenAPI spec | ... | run the check command and paste output |
| API linting tool exists | Check for `spectral` or `swagger-cli` in `package.json` | ... | run the check command and paste output |
| Error Schema Convention | Look for RFC 7807 references in docs/spec | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (API Designer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (draft API endpoint path) | TARGET (api/openapi/spec.yaml) | CHECK (npx spectral lint api/openapi/spec.yaml)`
- `n. ACTION (define response schemas) | TARGET (api/openapi/spec.yaml) | CHECK (npx spectral lint api/openapi/spec.yaml)`
- `n. ACTION (add pagination parameters) | TARGET (api/openapi/spec.yaml) | CHECK (npx spectral lint api/openapi/spec.yaml)`
- `n. ACTION (validate spec compiles) | TARGET (api/openapi/spec.yaml) | CHECK (npx swagger-cli validate api/openapi/spec.yaml)`
