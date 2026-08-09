# Phase 3: Developer Guides

## Objective

Enable a new developer to go from zero to productive. Write task-oriented guides that answer "how do I..." questions — quickstart, local development, contributing, testing, architecture overview, environment variables reference, and deployment. Every guide is grounded in actual project artifacts, not generic advice.

## 3.1 — Mandatory Inputs

| Input | Path | What to Extract |
|-------|------|-----------------|
| DevOps artifacts | `infrastructure/`, `docker-compose.yml` | Docker configs, environment setup |
| CI/CD pipelines | `scripts/ci/`, `scripts/` | Canonical local build/test/security/deploy commands; hosted adapters only if present |
| Source structure | `services/`, `frontend/`, `libs/` | Module layout, build files, package managers |
| Architecture docs | `docs/architecture/` | ADRs, service map, tech stack |
| Test artifacts | `tests/`, `.forgewright/qa-engineer/test-plan.md` | Test strategy, coverage requirements |
| Linter configs | `.eslintrc*`, `.prettierrc*`, `ruff.toml`, etc. | Code style rules, enforced conventions |
| Git workflow | `.github/PULL_REQUEST_TEMPLATE.md`, branch strategy | PR process, commit conventions |
| Env example | `.env.example` | All environment variables with defaults |
| Content inventory | `.forgewright/technical-writer/content-inventory.md` | Phase 1 priorities |

## 3.2 — Quickstart Guide

Generate `docs/getting-started/quickstart.md`:

1. **Prerequisites** — List runtime, Docker, and tools with exact version numbers and install links (3 items max)
2. **Clone and install** — Exact commands from clone to dependency install
3. **Configure environment** — Copy `.env.example`, document which values must be changed
4. **Start infrastructure** — `docker compose up -d` or equivalent
5. **Run migrations and seed** — Exact migration and seed commands
6. **Start the application** — Exact start command with expected output
7. **Verify it works** — A curl command with expected response (health check)
8. **Environment variables table** — Required vars with name, required flag, default, description
9. **Next steps** — Links to local development guide, architecture overview, contributing guide

The quickstart MUST achieve a working local environment in under 10 minutes. Move deep configuration to separate pages.

## 3.3 — Local Development Setup

Generate `docs/getting-started/local-development.md`:

1. **IDE setup** — Recommended IDE, required extensions/plugins, workspace settings
2. **Hot reloading** — How to enable live reload for each service
3. **Debugging** — launch.json / debugger configuration with step-by-step setup
4. **Running tests locally** — Commands for unit, integration, and e2e tests
5. **Working with Docker** — Rebuilding containers, viewing logs, accessing service shells
6. **Common development tasks** — Creating migrations, adding endpoints, adding a new service
7. **Troubleshooting** — Table of common issues with symptoms and fixes

## 3.4 — Contributing Guide

Generate `docs/guides/contributing.md`:

1. **Git branching strategy** — Branch naming, base branches, feature vs hotfix flow
2. **Commit message format** — Convention (Conventional Commits or project-specific)
3. **Pull request process** — PR template, required reviewers, CI checks that must pass
4. **Code review expectations** — What reviewers look for, turnaround time expectations
5. **Getting help** — Slack channels, office hours, documentation links

## 3.5 — Testing Guide

Generate `docs/guides/testing-guide.md`:

1. **Testing philosophy** — Testing strategy extracted from `.forgewright/qa-engineer/test-plan.md`
2. **Running tests** — Exact commands for each test type (unit, integration, e2e) with expected output
3. **Writing a new test** — Template and example for each test type
4. **Coverage requirements** — Minimum thresholds and how to check coverage locally
5. **Test data management** — Fixtures, factories, seeding, database cleanup
6. **CI test pipeline** — Which tests run on PR, which run nightly, failure handling

## 3.6 — Architecture Overview

Generate `docs/architecture/overview.md`:

1. **System diagram** — Mermaid diagram showing all services and their connections
2. **Service responsibilities** — One paragraph per service explaining what it does and why
3. **Data flow** — Step-by-step data flow for the 3-5 most common operations
4. **Technology stack** — Table with technology, version, and rationale for each choice
5. **Key constraints** — Architectural trade-offs and why they were made

Synthesize from ADRs and architecture docs. Write for a developer who has no prior context.

## 3.7 — Environment Variables Reference

Generate `docs/getting-started/installation.md` (includes env var reference):

1. **Installation instructions** — Platform-specific setup for macOS, Linux, Windows/WSL
2. **Version requirements** — Exact versions for all tools with compatibility notes
3. **Environment variables** — Grouped by category (database, cache, auth, external services, observability)

Each variable documented with: name, type, required/optional, default value, description, example value. Group by category — never dump 50 variables in a flat list.

## 3.8 — Deployment Guide

Generate `docs/operations/deployment.md`:

1. **Pipeline overview** — Describe CI/CD stages from commit to production
2. **Environments table** — URL, branch, auto-deploy flag, approval requirements
3. **Standard deployment** — Step-by-step from PR merge to production rollout
4. **Emergency deployment** — Manual process when CI is unavailable
5. **Rollback procedure** — Commands for rolling back to previous and specific versions
6. **Feature flags** — How to toggle features without deployment
7. **Database migrations** — How migrations run during deployment, rollback procedures

## 3.9 — Coding Conventions

Generate `docs/guides/coding-conventions.md`:

1. **Naming conventions** — Extracted from linter configs and existing code patterns
2. **File organization** — Directory structure conventions per service
3. **Error handling patterns** — How errors are created, propagated, and logged
4. **Logging conventions** — Log levels, structured fields, when to log what
5. **Code examples** — "Good" examples from the actual codebase (not invented patterns)

## Output Deliverables

| Artifact | Path |
|----------|------|
| Quickstart guide | `docs/getting-started/quickstart.md` |
| Local development guide | `docs/getting-started/local-development.md` |
| Installation and env vars | `docs/getting-started/installation.md` |
| Contributing guide | `docs/guides/contributing.md` |
| Testing guide | `docs/guides/testing-guide.md` |
| Coding conventions | `docs/guides/coding-conventions.md` |
| Architecture overview | `docs/architecture/overview.md` |
| Service map | `docs/architecture/service-map.md` |
| ADR summaries | `docs/architecture/decisions/<NNN-title>.md` |
| Deployment guide | `docs/operations/deployment.md` |

## Validation Loop

Before moving to Phase 4:
- Quickstart achieves a working environment in under 10 minutes (mentally walk through every step)
- Every environment variable is documented with name, type, required/optional, default, description
- Every test command actually works (verify against project build files)
- Architecture overview matches the actual system, not an aspirational design
- All guides end with "Next steps" linking to related pages
- No fabricated content — every statement traces to a source artifact

## Quality Bar

- A new developer can onboard using only these guides and no human help
- Every code example is complete and copy-pasteable
- ADR summaries are plain language, not copy-pasted from raw ADR format
- Coding conventions reference actual linter configs, not invented rules
