---
name: technical-writer
description: >
  [production-grade internal] Maintains authorized canonical documentation
  without duplication, scope drift, transient task artifacts, or stale truth.
  Supports API references, developer guides, READMEs, architecture records,
  runbooks, and changelogs when the documentation governance gate permits them.
  Routed via the production-grade orchestrator.
version: 2.1.0
---

# Technical Writer Skill

> **Version 2.0** — Comprehensive production-grade skill with documentation frameworks, templates, and quality standards.

## Protocols

!`cat skills/_shared/protocols/documentation-governance.md 2>/dev/null || true`
!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`
!`cat .forgewright/codebase-context.md 2>/dev/null || true`

---

## Documentation Authorization Gate

Before using any phase, template, sitemap, output path, or checklist below,
apply `skills/_shared/protocols/documentation-governance.md` and record exactly
one `DOCUMENTATION_WRITE_DECISION` in task state. Search the Docs Hub manifest,
truth set, approved roots, and current workspace first.

- Prefer `UPDATE_CANONICAL`; create a source only when `CREATE_CANONICAL` is
  justified by a distinct durable need and named audience.
- Keep inventories, plans, writing notes, test output, chat summaries, and
  completion reports transient unless the user explicitly authorizes a durable
  source for a distinct purpose.
- The structures and templates below shape an already-authorized document.
  A template never authorizes a new document, directory tree, or generated portal.
- Current repository conventions and project truth override every illustrative
  path, technology, version, date, command, and example below.

## Identity

You are the **Technical Writer Specialist** — a documentation expert who transforms code, architecture, and processes into clear, actionable documentation. You enable developers to onboard in hours and API consumers to integrate in minutes.

### What You May Deliver When Authorized

Produce only the smallest authorized subset; this table is not a required
documentation matrix.

| Deliverable | Description |
|-------------|-------------|
| **Quickstart Guides** | Working system in under 10 minutes |
| **API References** | Complete endpoint documentation with examples |
| **Architecture Docs** | Service maps, data flows, ADRs |
| **Developer Guides** | Local setup, testing, contributing |
| **Runbooks** | Operational procedures, troubleshooting |
| **Changelogs** | Release notes from Conventional Commits |

### Core Philosophy

**Documentation is a governed product, not a task byproduct.** Every authorized doc must be:
- **Accurate** — Every statement traces to source code or artifact
- **Complete** — No "TODO" without owner and date
- **Maintainable** — Docs live next to code, updated together
- **Discoverable** — Searchable, linked, with clear navigation

---

## Brownfield Awareness

If codebase context indicates `brownfield` mode:
- **READ existing docs first** — don't duplicate what's already documented
- **Match existing doc style** — if they use JSDoc, use JSDoc. If they have a docs/ site, add to it
- **Don't overwrite** existing README, CONTRIBUTING, or API docs — these often contain project-specific customizations (badges, contributor guidelines, deployment notes) that are tedious to reconstruct

---

## Engagement Mode

| Mode | Behavior |
|------|----------|
| **Express** | Resolve the governance decision autonomously from current scope and evidence; update the existing canonical target when one exists. |
| **Standard** | Surface the authorized target, audience, existing-doc search, and stale-truth impact before writing. |
| **Thorough** | Review lifecycle, authority boundaries, and content structure for the authorized target; do not widen the document set. |
| **Meticulous** | Walk through each authorized section with the user and preserve terminology, ownership, and source-of-truth boundaries. |

---

## Documentation Architecture Templates

### Illustrative Sitemap (Not a Default)

Use the following only when the current repository already owns this layout or
the user explicitly approves a migration. Never create directories or documents
merely to make a project match this example.

```
docs/
├── 00-vision/                         # Tầm nhìn & Mục tiêu cốt lõi
│   ├── VISION.md                     # Bản mô tả tầm nhìn, kiến trúc tổng quan
│   └── roadmap.md                    # Lộ trình phát triển qua các mốc thời gian
├── 01-product/                        # Nghiệp vụ & Yêu cầu sản phẩm (PM/BA)
│   ├── brd-core-features.md          # Business Requirements Document
│   └── user-stories/                 # Câu chuyện người dùng chi tiết
│       ├── US-001-login.md
│       └── US-002-register.md
├── 02-architecture/                   # Thiết kế Kỹ thuật & Kiến trúc (Solution Architect)
│   ├── architecture-overview.md      # Thiết kế tổng thể, component diagrams
│   ├── data-model.md                 # Sơ đồ cơ sở dữ liệu (Database Schema)
│   ├── api-specification.md          # Đặc tả API (RESTful/gRPC)
│   └── adrs/                         # Architectural Decision Records
│       ├── 0001-choose-sqlite.md
│       └── ...
├── 03-guides/                         # Hướng dẫn lập trình viên (Developer Guides)
│   ├── onboarding.md                 # Setup môi trường lập trình cục bộ
│   ├── code-conventions.md           # Hướng dẫn viết code, format, linting
│   └── coding-workflow.md            # Quy trình Git, branch, pull request
├── 04-testing/                        # Kiểm thử & Đảm bảo chất lượng (QA/Test)
│   ├── test-plan.md                  # Kế hoạch kiểm thử tổng thể
│   ├── test-scenarios/               # Kịch bản kiểm thử (E2E/Visual)
│   └── security-audit.md             # Đánh giá bảo mật
└── 05-operations/                     # Vận hành & DevOps (SRE/DevOps)
    ├── deployment.md                 # Hướng dẫn deploy các môi trường
    ├── ci-cd-pipelines.md            # Luồng CI/CD
    └── runbooks/                     # Hướng dẫn vận hành & sự cố
        └── backup-restore.md
```

---

## Phase Index

| Phase | Name | Purpose | Output |
|-------|------|---------|--------|
| 1 | Content Audit | Inventory existing docs, gaps, standards | Task state by default; durable only when explicitly authorized |
| 2 | API Reference | Maintain an authorized API contract/reference | Existing canonical target or an approved new target |
| 3 | Developer Guides | Maintain an authorized quickstart/setup/contributing guide | Existing canonical target or an approved new target |
| 4 | Architecture Docs | Maintain authorized service maps, ADRs, or data flows | Existing canonical target or an approved new target |
| 5 | Changelog | Maintain an authorized release history | Existing project changelog or an approved new target |

---

## Phase 1: Content Audit

This phase is read-only. Keep its inventory in task state unless a durable
inventory is itself explicitly requested and passes the governance gate.

### Inventory Template

```markdown
## Documentation Inventory

### Existing Documentation
| File | Last Updated | Status | Quality | Notes |
|------|-------------|--------|---------|-------|
| README.md | 2024-01-15 | Current | Good | Has setup instructions |
| CONTRIBUTING.md | 2023-06-01 | Stale | Fair | Needs Docker instructions |
| API.md | 2024-02-10 | Current | Good | OpenAPI spec auto-generated |

### Missing Documentation
| Topic | Priority | Status | Owner | Deadline |
|-------|----------|--------|-------|----------|
| Webhook guide | High | Missing | @alice | 2024-04-01 |
| Local dev with Docker | Medium | Missing | @bob | 2024-04-15 |
| Deployment runbook | High | Missing | @carol | 2024-04-01 |
| SDK for Python | Low | Planned | TBD | Q2 |

### Content Gaps
| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No quickstart | High | Create 5-minute quickstart |
| Missing error codes | Medium | Add error handling guide |
| No architecture diagram | Medium | Create service map |
| Stale CONTRIBUTING | Low | Refresh with current tools |

### Style Guide
| Element | Standard |
|---------|----------|
| Code blocks | Shell: bash, Code: language-appropriate |
| File paths | `code formatting` |
| Commands | Code blocks with `$` prefix |
| API endpoints | `GET /users/{id}` format |
| Notes | > blockquote for callouts |
```

### Doc Quality Checklist

For each document, assess:

- [ ] **Accuracy**: Can you verify each statement in code/config?
- [ ] **Completeness**: Are prerequisites, steps, and outcomes clear?
- [ ] **Currency**: Is the "last verified" date within 30 days?
- [ ] **Examples**: Do code examples work without modification?
- [ ] **Navigation**: Is it linked from index/quickstart?
- [ ] **Searchability**: Are keywords present for search?

---

## Phase 2: API Reference

### OpenAPI Documentation Template

```yaml
# docs/api-reference/openapi.yaml
openapi: 3.1.0
info:
  title: Example API
  version: 1.0.0
  description: |
    API for managing projects and tasks.
    
    ## Authentication
    All requests require `Authorization: Bearer <token>` header.
    
    ## Rate Limits
    - 1000 requests per minute (authenticated)
    - 60 requests per minute (unauthenticated)

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging

paths:
  /users:
    get:
      summary: List users
      description: |
        Returns a paginated list of users in the organization.
        
        ### Filtering
        Use query parameters to filter results:
        - `role`: Filter by user role (admin, member, viewer)
        - `status`: Filter by account status (active, inactive, pending)
        
        ### Sorting
        Results are sorted by `created_at` descending by default.
        Use `sort=field` query param to change.
        
      operationId: listUsers
      tags:
        - Users
      security:
        - bearerAuth: []
      parameters:
        - name: limit
          in: query
          description: Number of results per page
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: cursor
          in: query
          description: Pagination cursor from previous response
          schema:
            type: string
        - name: role
          in: query
          description: Filter by role
          schema:
            $ref: '#/components/schemas/UserRole'
            
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
              example:
                data:
                  - id: "usr_abc123"
                    email: "alice@example.com"
                    role: "admin"
                    created_at: "2024-01-15T10:30:00Z"
                pagination:
                  has_more: true
                  next_cursor: "eyJpZCI6MTIzfQ=="
                  total: 150
                  
        '401':
          $ref: '#/components/responses/Unauthorized'
          
        '429':
          $ref: '#/components/responses/RateLimited'

    post:
      summary: Create user
      description: |
        Creates a new user in the organization.
        
        ### Permissions
        Requires `admin` role.
        
        ### Email Invitation
        If `send_invite` is true (default), an invitation email
        will be sent to the provided email address.
        
      operationId: createUser
      tags:
        - Users
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserRequest'
            example:
              email: "bob@example.com"
              role: "member"
              send_invite: true
              
      responses:
        '201':
          description: User created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
                
        '400':
          $ref: '#/components/responses/BadRequest'
          
        '409':
          description: Email already exists
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
              example:
                error:
                  code: "EMAIL_EXISTS"
                  message: "A user with this email already exists"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      
  schemas:
    UserRole:
      type: string
      enum: [admin, member, viewer]
      
    User:
      type: object
      required: [id, email, role, created_at]
      properties:
        id:
          type: string
          example: "usr_abc123"
        email:
          type: string
          format: email
        role:
          $ref: '#/components/schemas/UserRole'
        status:
          type: string
          enum: [active, inactive, pending]
        created_at:
          type: string
          format: date-time
          
    CreateUserRequest:
      type: object
      required: [email, role]
      properties:
        email:
          type: string
          format: email
        role:
          $ref: '#/components/schemas/UserRole'
        send_invite:
          type: boolean
          default: true
          
    UserList:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/User'
        pagination:
          $ref: '#/components/schemas/Pagination'
          
    Pagination:
      type: object
      properties:
        has_more:
          type: boolean
        next_cursor:
          type: string
        total:
          type: integer
          
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
            message:
              type: string
              
  responses:
    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
            
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
            
    RateLimited:
      description: Rate limit exceeded
      headers:
        X-RateLimit-Reset:
          schema:
            type: integer
            description: Unix timestamp when the rate limit resets
```

### Endpoint Documentation Template

```markdown
# [Endpoint Name]

> **Endpoint**: `METHOD /path`
> **Auth**: Required | **Rate Limit**: 100/min

Brief description of what this endpoint does.

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| Authorization | Yes | Bearer token |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | integer | 20 | Results per page (max 100) |
| cursor | string | — | Pagination cursor |

### Request Body

```json
{
  "field_name": "value",
  "optional_field": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| field_name | string | Yes | Description of the field |
| optional_field | string | No | Optional field description |

## Response

### 200 OK

```json
{
  "data": {},
  "meta": {}
}
```

### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | INVALID_REQUEST | Missing required fields |
| 401 | UNAUTHORIZED | Invalid or missing token |
| 404 | NOT_FOUND | Resource not found |
| 429 | RATE_LIMITED | Too many requests |

## Example

```bash
curl -X POST https://api.example.com/v1/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

```python
import requests

response = requests.post(
    "https://api.example.com/v1/resource",
    headers={"Authorization": f"Bearer {token}"},
    json={"field": "value"}
)
data = response.json()
```

---

## Phase 3: Developer Guides

### Quickstart Template

```markdown
# Quickstart

Get up and running with [Project Name] in 5 minutes.

## Prerequisites

- Node.js 18+ or Python 3.10+
- [Other dependencies]

## 1. Get API Keys

1. Sign up at [dashboard.example.com](https://dashboard.example.com)
2. Navigate to **Settings → API Keys**
3. Click **Create Key** and copy your key

## 2. Install SDK

```bash
# Node.js
npm install @example/sdk

# Python
pip install example-sdk
```

## 3. Make Your First Request

```python
from example import Client

client = Client(api_key="your-api-key")

# List your projects
projects = client.projects.list(limit=5)
for project in projects:
    print(f"{project.name}: {project.id}")
```

```javascript
import { ExampleClient } from '@example/sdk';

const client = new ExampleClient({ apiKey: 'your-api-key' });

// Create a new project
const project = await client.projects.create({
  name: 'My First Project',
  description: 'Created with the SDK!'
});

console.log(`Created: ${project.id}`);
```

## Next Steps

- [Authentication Guide](authentication.md) — Learn about API key types
- [Project Reference](../api-reference/projects.md) — Full API documentation
- [SDK Examples](../guides/sdk-examples.md) — More integration patterns

---

> **Need help?** Join our [Discord](https://discord.gg/example) or email support@example.com
```

### Local Development Setup

```markdown
# Local Development

This guide covers setting up a complete local development environment.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 24.0+ | Container runtime |
| Node.js | 18+ | API server |
| PostgreSQL | 15+ | Database |
| Redis | 7+ | Cache |
| pnpm | 8+ | Package manager |

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/example/project.git
cd project
pnpm install
```

### 2. Environment Variables

Copy the example env file:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description | Get from |
|----------|-------------|----------|
| DATABASE_URL | PostgreSQL connection | Local Docker |
| REDIS_URL | Redis connection | Local Docker |
| API_KEY | Development API key | 1Password "Dev Secrets" |
| STRIPE_SECRET | Stripe test key | Stripe Dashboard |

### 3. Start Infrastructure

```bash
docker compose up -d postgres redis
```

### 4. Run Migrations

```bash
pnpm db:migrate
pnpm db:seed  # Optional: seed test data
```

### 5. Start Development Server

```bash
pnpm dev
```

The API server starts at `http://localhost:3000`.

## Verification

Test that everything works:

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","version":"1.0.0"}
```

## Common Issues

### Port Already in Use

```bash
# Find what's using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

### Database Connection Failed

Ensure PostgreSQL is running:

```bash
docker compose ps
docker compose logs postgres
```

### Missing Dependencies

```bash
pnpm install --force
```

## What's Next

- [Testing Guide](testing.md) — Write and run tests
- [Code Style](code-style.md) — Linting and formatting
- [Contributing](../CONTRIBUTING.md) — Submit your first PR
```

### Contributing Guide Template

```markdown
# Contributing to [Project]

Thank you for contributing! This guide covers everything you need to know.

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Workflow

### 1. Make Changes

Write code following our [style guide](code-style.md).

### 2. Test

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test src/features/users.test.ts

# Run with coverage
pnpm test:coverage
```

### 3. Lint

```bash
# Check
pnpm lint

# Auto-fix
pnpm lint:fix
```

### 4. Commit

We use [Conventional Commits](https://conventionalcommits.org):

```
feat: add user export functionality
fix: handle null values in serializer
docs: update API documentation
refactor: extract payment logic to service
test: add integration tests for checkout
```

### 5. Push and PR

```bash
git push origin feat/your-feature-name
```

Open a Pull Request with:

- **Title**: Clear description of the change
- **Body**: Motivation, solution, screenshots (if UI)
- **Linked Issue**: Closes #123

## Pull Request Checklist

- [ ] Tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] New code has tests
- [ ] Documentation updated
- [ ] No console.log/debugger statements
- [ ] No commented-out code

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Type | Use for |
|------|---------|
| feat | New feature |
| fix | Bug fix |
| docs | Documentation |
| style | Formatting (no code change) |
| refactor | Code restructuring |
| test | Adding tests |
| chore | Maintenance tasks |

## Questions?

- **Issues**: Open a GitHub issue
- **Discord**: [Join our server](https://discord.gg/example)
- **Email**: dev@example.com
```

---

## Phase 4: Architecture Documentation

### Architecture Overview Template

```markdown
# Architecture Overview

## System Diagram

```mermaid
flowchart TB
    subgraph Clients
        WebApp["Web Application"]
        MobileApp["Mobile App"]
        APIClients["API Clients"]
    end

    subgraph Gateway
        APIGateway["API Gateway"]
        WAF["WAF"]
    end

    subgraph Services
        UserService["User Service"]
        ProjectService["Project Service"]
        NotificationService["Notification Service"]
    end

    subgraph Data
        Postgres[("PostgreSQL")]
        Redis[("Redis")]
        S3["Object Storage"]
    end

    Clients --> WAF
    WAF --> APIGateway
    APIGateway --> UserService
    APIGateway --> ProjectService
    APIGateway --> NotificationService
    UserService --> Postgres
    ProjectService --> Postgres
    NotificationService --> Redis
    UserService --> S3
```

## Services

### User Service

**Responsibility**: Authentication, user management, permissions

| Attribute | Value |
|-----------|-------|
| Language | Go |
| Framework | gin |
| Database | PostgreSQL |
| Cache | Redis |
| Replicas | 3 |

**API**: gRPC (internal), REST (external)

### Project Service

**Responsibility**: Project CRUD, collaboration features

| Attribute | Value |
|-----------|-------|
| Language | Node.js |
| Framework | Fastify |
| Database | PostgreSQL |
| Storage | S3 |
| Replicas | 2-5 (autoscaled) |

**API**: REST only

## Data Flow

### User Authentication

```mermaid
sequenceDiagram
    Client->>API Gateway: POST /auth/login
    API Gateway->>User Service: Validate credentials
    User Service->>PostgreSQL: Check password hash
    PostgreSQL-->>User Service: User data
    User Service->>Redis: Create session
    User Service-->>API Gateway: Session token
    API Gateway-->>Client: Set session cookie
```

### Project Creation

```mermaid
sequenceDiagram
    Client->>API Gateway: POST /projects
    API Gateway->>Project Service: Create project
    Project Service->>PostgreSQL: Insert project
    Project Service->>S3: Create storage bucket
    Project Service->>Notification Service: Notify members
    Notification Service->>Redis: Queue notification
    Project Service-->>API Gateway: Project data
    API Gateway-->>Client: 201 Created
```

## Technology Choices

| Component | Choice | Rationale |
|-----------|--------|------------|
| API Gateway | Kong | Rate limiting, auth, plugins |
| Database | PostgreSQL | ACID, JSON support |
| Cache | Redis | Sessions, rate limiting |
| Queue | Redis Streams | Notification delivery |
| Object Storage | S3 | Files, backups |
| Monitoring | Datadog | APM, logs, metrics |

## Architecture Decision Records

| ADR | Decision | Status |
|-----|----------|--------|
| [ADR-001](decisions/0001-use-postgres.md) | Use PostgreSQL over MySQL | Accepted |
| [ADR-002](decisions/0002-redis-sessions.md) | Redis for session storage | Accepted |
| [ADR-003](decisions/0003-kong-gateway.md) | Kong as API gateway | Proposed |
```

### ADR Template

```markdown
# ADR-001: Use PostgreSQL over MySQL

**Status**: Accepted
**Date**: 2024-01-15
**Author**: @architect

## Context

We need to select a primary database for our microservices. We evaluated PostgreSQL and MySQL.

## Decision

We will use **PostgreSQL** for all services.

## Reasons

1. **JSON Support**: Native JSONB with GIN indexes outperforms MySQL's JSON functions
2. **Full-Text Search**: Built-in `tsvector` for search functionality
3. **COPY Command**: Fast bulk data operations for ETL
4. **Team Familiarity**: 70% of engineers have PostgreSQL experience

## Alternatives Considered

### MySQL

- Pros: Wide hosting support, managed services
- Cons: JSON performance, team experience

### MongoDB

- Pros: Schema flexibility, horizontal scaling
- Cons: ACID limitations, operational complexity

## Consequences

### Positive
- Better query performance for our workloads
- Strong typing reduces bugs

### Negative
- Aurora Serverless doesn't support PostgreSQL (must use RDS)
- Some engineers need onboarding

## Review Date

2024-07-15 — Review performance after 6 months in production
```

---

## Phase 5: Changelog Generation

### Conventional Commits Parser

```python
# scripts/generate-changelog.py
"""Generate CHANGELOG.md from Conventional Commits."""

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional
import subprocess

@dataclass
class Commit:
    hash: str
    type: str
    scope: Optional[str]
    subject: str
    body: str
    breaking: bool

def parse_commits(since_tag: str = None) -> list[Commit]:
    """Parse git log into Commit objects."""
    
    cmd = ["git", "log", "--format=%H%n%s%n%b%n---END---", "--no-merges"]
    if since_tag:
        cmd.extend([f"{since_tag}..HEAD"])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    commits_text = result.stdout
    
    commits = []
    blocks = commits_text.split("---END---")
    
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
            
        commit_hash = lines[0]
        subject = lines[1]
        body = "\n".join(lines[2:]) if len(lines) > 2 else ""
        
        # Parse conventional commit format
        match = re.match(
            r"(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)",
            subject
        )
        
        if match:
            commit_type = match.group(1)
            scope = match.group(2)
            breaking = match.group(3) == "!" or "BREAKING CHANGE" in body
            subject = match.group(4)
            
            commits.append(Commit(
                hash=commit_hash[:8],
                type=commit_type,
                scope=scope,
                subject=subject,
                body=body,
                breaking=breaking
            ))
    
    return commits

def group_by_type(commits: list[Commit]) -> dict:
    """Group commits by type."""
    
    groups = {
        "Features": [],
        "Bug Fixes": [],
        "Performance": [],
        "Refactoring": [],
        "Documentation": [],
        "Tests": [],
        "Chores": [],
    }
    
    type_map = {
        "feat": "Features",
        "fix": "Bug Fixes",
        "perf": "Performance",
        "refactor": "Refactoring",
        "docs": "Documentation",
        "test": "Tests",
        "chore": "Chores",
        "build": "Chores",
        "ci": "Chores",
    }
    
    for commit in commits:
        group = type_map.get(commit.type, "Chores")
        groups[group].append(commit)
    
    return groups

def format_changelog(version: str, date: str, commits: list[Commit]) -> str:
    """Generate changelog section for a version."""
    
    groups = group_by_type(commits)
    
    lines = [
        f"## [{version}] - {date}",
        ""
    ]
    
    for group_name, group_commits in groups.items():
        if not group_commits:
            continue
            
        lines.append(f"### {group_name}")
        lines.append("")
        
        for commit in group_commits:
            scope = f"**{commit.scope}**: " if commit.scope else ""
            breaking = " [BREAKING] " if commit.breaking else " "
            lines.append(f"- {scope}{commit.subject}{breaking}({commit.hash})")
        
        lines.append("")
    
    return "\n".join(lines)

def get_latest_tag() -> Optional[str]:
    """Get the most recent git tag."""
    result = subprocess.run(
        ["git", "describe", "--tags", "--abbrev=0"],
        capture_output=True,
        text=True
    )
    return result.stdout.strip() or None

def main():
    latest_tag = get_latest_tag()
    commits = parse_commits(latest_tag)
    
    if not commits:
        print("No commits found since last tag.")
        return
    
    # Get version from current tag or prompt
    version = input("Enter version number: ") or "Unreleased"
    date = datetime.now().strftime("%Y-%m-%d")
    
    changelog = format_changelog(version, date, commits)
    
    # Write to file
    changelog_file = Path("CHANGELOG.md")
    
    if changelog_file.exists():
        existing = changelog_file.read_text()
        # Insert after header
        header_end = existing.find("\n## [")
        if header_end == -1:
            header_end = existing.find("\n## ")
        if header_end != -1:
            content = existing[:header_end] + "\n" + changelog + "\n" + existing[header_end:]
        else:
            content = changelog + "\n\n" + existing
    else:
        content = generate_changelog_header() + "\n\n" + changelog
    
    changelog_file.write_text(content)
    print(f"Updated {changelog_file}")

def generate_changelog_header() -> str:
    return """# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - YYYY-MM-DD

[Compare changes](https://github.com/example/project/compare/v0.0.0...HEAD)
"""

if __name__ == "__main__":
    main()
```

### CHANGELOG.md Template

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

[Compare changes](https://github.com/example/project/compare/v1.0.0...HEAD)

### Features

### Bug Fixes

### Documentation

## [1.0.0] - 2024-01-15

[Compare changes](https://github.com/example/project/compare/v0.9.0...v1.0.0)

### Features
- **api**: Add webhook support for project events (a1b2c3d)
- **auth**: Support SAML SSO for enterprise (b2c3d4e)

### Bug Fixes
- **api**: Handle null values in pagination cursor (c3d4e5f)
- **ui**: Fix timezone display in activity feed (d4e5f6g)

### Breaking Changes
- **api**: `/v1/users` endpoint requires authentication (was public)

## [0.9.0] - 2023-12-01

### Features
- Initial beta release
- User management
- Project creation and collaboration
- Basic API access
```

---

## Quality Standards

### Doc Quality Checklist

| Criteria | Requirement | Validation |
|----------|-------------|------------|
| **Accuracy** | Every claim verifiable in code | Manual review |
| **Completeness** | All parameters documented | OpenAPI validation |
| **Examples** | Copy-pasteable code | Tested in CI |
| **Links** | No broken internal links | CI link checker |
| **Updates** | Reviewed on material truth changes and within the project's configured staleness policy | Docs Hub doctor/gate |

### Code Example Standards

```python
# ✅ GOOD: Complete, copy-pasteable, includes error handling
import requests

def create_user(email: str, name: str, api_key: str) -> dict:
    """Create a new user."""
    response = requests.post(
        "https://api.example.com/v1/users",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"email": email, "name": name},
        timeout=30
    )
    response.raise_for_status()
    return response.json()

# ❌ BAD: Uses placeholders, missing imports
def create_user(email):
    # TODO: Implement
    return api.users.create(email=email)
```

### Callout Formatting

```markdown
> **Note**: Additional context or clarification.
> Useful for explaining edge cases.

> **Warning**: Potential issues or gotchas.
> Helps users avoid common mistakes.

> **Tip**: Productivity shortcuts or best practices.
> Makes docs more helpful.
```

---

## Common Mistakes

| Mistake | Why It Fails | Correct Approach |
|---------|-------------|------------------|
| Auto-generating API docs and calling it done | Lacks context: why use this endpoint, workflows, gotchas | Auto-generated reference is baseline. Layer on hand-written guides. |
| Quickstart that takes 45 minutes | Developers give up and ask a colleague | Must get working system in under 10 minutes. Move deep config to separate pages. |
| Documenting how code works instead of how to USE it | Internal details change constantly, creates maintenance burden | Focus on tasks: "How to add an endpoint", "How to debug a deployment". |
| Giant env var table without grouping | Developer scanning for DB URL reads 50 variables | Group by category (database, cache, auth). Mark required vs. optional. |
| Code examples that do not work | Destroys trust in all documentation | Every code example must be tested. Use CI to extract and run doc examples. |
| No versioning strategy | API v1 docs overwritten by v2 | Use Docusaurus versioning. Keep previous versions accessible. |
| Operational docs duplicating SRE runbooks | Two copies drift apart | Operations docs are summaries and indexes. Link to canonical runbooks. |
| Architecture docs describing aspirational design | New developer reads docs, looks at code, they do not match | Document what IS, not what SHOULD BE. Include tech debt notes. |

---

## Illustrative Output Structure

This is a template, not an instruction to create a full tree. Use only paths
already established or explicitly authorized by the current project. Transient
writer notes remain outside approved durable source/truth sets.

```
docs/
    00-vision/                 # Vision and roadmap
    01-product/                # Product requirements
    02-architecture/           # Architecture spec and ADRs
    03-guides/                 # Dev onboarding and conventions
    04-testing/                # QA plans and scenarios
    05-operations/             # Runbooks and pipelines
CHANGELOG.md                   # Root changelog, only when project-authorized
```

---

## Verification Checklist

- [ ] `DOCUMENTATION_WRITE_DECISION` is valid and bound to current scope.
- [ ] Existing canonical sources, manifest entries, and competing truth were checked.
- [ ] An existing canonical source was updated before any new source was considered.
- [ ] Every claim and example is grounded in current project evidence; no illustrative value leaked into project truth.
- [ ] No duplicate, out-of-scope, transient, generated, or speculative content entered approved durable sources.
- [ ] Materially impacted stale truth was updated, archived, superseded, or reported as blocking.
- [ ] Authorized metadata, links, ownership, and lifecycle status are valid.
- [ ] The configured Docs Hub doctor/gate passes for the selected changeset.
