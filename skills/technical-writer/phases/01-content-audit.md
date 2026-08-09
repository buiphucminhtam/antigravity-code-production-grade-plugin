# Phase 1: Content Audit

## Objective

Inventory every existing artifact across the project, identify documentation gaps against the required documentation matrix, assess README and code comment quality, and produce a prioritized documentation plan. This phase reads — it does not write documentation.

## 1.1 — Mandatory Inputs

| Input | Path | What to Extract |
|-------|------|-----------------|
| Business context | `.forgewright/product-manager/` | User personas, feature scope, domain glossary |
| Architecture docs | `docs/architecture/` | Service boundaries, ADRs, tech stack, data flow |
| API contracts | `api/openapi/*.yaml`, `api/asyncapi/*.yaml` | Endpoints, schemas, auth methods, webhook events |
| Source code | `services/`, `frontend/`, `libs/` | Module structure, code comments, config files, env vars |
| Test artifacts | `tests/`, `.forgewright/qa-engineer/` | Test coverage, integration test descriptions, test strategy |
| DevOps artifacts | `infrastructure/`, `scripts/ci/`, optional hosted-provider configs | Local CI/CD pipelines, deployment configs, environment definitions |
| SRE artifacts | `docs/runbooks/`, `.forgewright/sre/` | Runbooks, incident procedures, SLO definitions, DR playbooks |
| Project README | `README.md` | Current onboarding state, accuracy of existing instructions |

## 1.2 — Artifact Inventory

Read every suite directory and source tree. For each file, record in a table:

```markdown
| File Path | Content Type | Doc Relevance | Target Audience | Notes |
|-----------|-------------|---------------|-----------------|-------|
| api/openapi/main.yaml | spec | high | API consumer | Primary API contract |
| docs/architecture/tech-stack.md | narrative | high | developer | Stack rationale |
| ... | ... | ... | ... | ... |
```

Content types: `config`, `narrative`, `spec`, `diagram`, `code`, `test`, `runbook`.
Target audiences: `developer`, `operator`, `API consumer`, `business stakeholder`.

## 1.3 — Gap Analysis

Cross-reference the inventory against the required documentation matrix:

| Document | Source Artifact | Audience | Priority |
|----------|----------------|----------|----------|
| Quickstart guide | Implementation + DevOps | New developer | P0 |
| Local development setup | docker-compose, env vars | New developer | P0 |
| Architecture overview | ADRs, service map | All technical | P0 |
| API authentication guide | OpenAPI spec, auth middleware | API consumer | P0 |
| API endpoint reference | OpenAPI spec | API consumer | P0 |
| Error code reference | Source code, API spec | API consumer | P0 |
| Deployment guide | CI/CD pipelines | Operator | P1 |
| Monitoring guide | Monitoring configs, SLOs | Operator | P1 |
| Incident response guide | SRE incidents | Operator | P1 |
| Coding conventions | Linter configs, code patterns | Developer | P1 |
| Testing guide | Test suite, test plan | Developer | P1 |
| Contributing guide | Git workflow, PR templates | Developer | P1 |
| Webhook documentation | AsyncAPI spec | API consumer | P2 |
| Rate limiting guide | API gateway config | API consumer | P2 |
| ADR summaries | Architecture ADRs | Developer | P2 |
| Runbook index | SRE runbooks | Operator | P2 |

For each row, mark: `exists`, `partial`, or `missing`. Record what source artifact is available and what is absent.

## 1.4 — README Quality Assessment

Evaluate the project README against these criteria:

- Does it explain what the project does in one paragraph?
- Does it list prerequisites with version numbers?
- Does it have a working quickstart (clone, install, run)?
- Are environment variables documented?
- Does it link to deeper documentation?
- Is the information current and accurate?

Rate: `good` (usable as-is), `needs-update` (structure fine, content stale), `rewrite` (not salvageable).

## 1.5 — Code Comments Coverage

Scan source code for documentation density:

- Public functions/methods: do they have doc comments?
- Complex algorithms: are they explained inline?
- Configuration files: are options annotated?
- Middleware: is the request flow documented?

Record percentage estimates per service. Flag services with less than 30% doc coverage on public APIs.

## 1.6 — Documentation Plan

Produce a prioritized plan with estimated effort:

```markdown
## Documentation Plan

### P0 — Must Have (write first)
1. [ ] Quickstart guide — source: DevOps artifacts, docker-compose — ~2 pages
2. [ ] API authentication — source: OpenAPI spec, auth middleware — ~3 pages
3. [ ] API endpoint reference — source: OpenAPI spec — ~1 page per resource
4. [ ] Architecture overview — source: ADRs, service map — ~3 pages

### P1 — Should Have (write second)
5. [ ] Deployment guide — source: CI/CD pipelines, K8s manifests — ~3 pages
6. [ ] Testing guide — source: test plan, test configs — ~2 pages
7. [ ] Contributing guide — source: git workflow, PR templates — ~2 pages

### P2 — Nice to Have (write last)
8. [ ] Webhook guide — source: AsyncAPI spec — ~2 pages
9. [ ] ADR summaries — source: architecture ADRs — ~1 page each
10. [ ] Runbook index — source: SRE runbooks — ~1 page
```

## Output Deliverables

| Artifact | Path |
|----------|------|
| Content inventory | `.forgewright/technical-writer/content-inventory.md` |
| Writing notes and style decisions | `.forgewright/technical-writer/writing-notes.md` |

## Validation Loop

Before moving to Phase 2:
- Every suite directory has been read and catalogued
- Gap analysis covers all rows in the documentation matrix
- README assessment is recorded with specific issues
- Documentation plan is prioritized and approved by user via notify_user
- No source artifact has been overlooked

## Quality Bar

- Content inventory lists every file with relevance rating
- Gap analysis has zero unresolved rows
- Documentation plan has realistic page estimates
- All P0 items have identified source artifacts (if a source is missing, flag it as a blocker)
