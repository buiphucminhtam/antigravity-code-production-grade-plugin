---
id: project-onboarding
title: Project Onboarding Protocol
summary: Core protocol for project onboarding.
status: deprecated
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Project Onboarding Protocol

**Every new project installation MUST run this protocol to create a comprehensive project fingerprint.** This applies to both greenfield and brownfield projects, adapting depth based on what exists.

## When to Run

- **First time** Forgewright is invoked in a project (no `.forgewright/project-profile.json` exists)
- **On explicit `/onboard`** command from user
- **When manual changes detected** (session-lifecycle protocol detects drift)
- **Skip if** `.forgewright/project-profile.json` exists AND is less than 24 hours old AND no git changes since last onboarding

## Phase 1 — Fingerprint (Parallel Scans)

Run all scans simultaneously:

```
# Language & Framework detection
find_by_name("package.json"), find_by_name("go.mod"), find_by_name("pyproject.toml"),
find_by_name("Cargo.toml"), find_by_name("pom.xml"), find_by_name("build.gradle"),
find_by_name("Gemfile"), find_by_name("composer.json"), find_by_name("mix.exs")

# Architecture detection
find_by_name("*", "src/"), find_by_name("*", "services/"), find_by_name("*", "apps/"),
find_by_name("*", "packages/"), find_by_name("*", "modules/")

# Infrastructure detection
find_by_name("Dockerfile*"), find_by_name("docker-compose*"),
find_by_name("*", "scripts/ci/"), find_by_name("*", ".github/workflows/"),
find_by_name(".gitlab-ci.yml"), find_by_name("Jenkinsfile"), find_by_name("*.tf"), find_by_name("vercel.json"),
find_by_name("railway.json"), find_by_name("netlify.toml")

# Test detection
find_by_name("*", "tests/"), find_by_name("*", "__tests__/"), find_by_name("*", "spec/"),
find_by_name("*.test.*"), find_by_name("*.spec.*"),
find_by_name("jest.config*"), find_by_name("vitest.config*"), find_by_name("pytest.ini"),
find_by_name("playwright.config*"), find_by_name(".mocharc*")

# Config detection
find_by_name(".production-grade.yaml"), find_by_name(".eslintrc*"),
find_by_name(".prettierrc*"), find_by_name("tsconfig.json"),
find_by_name(".editorconfig"), find_by_name("biome.json")
```

**Output:** Populate `fingerprint` section of project profile.

## Phase 1.5 — Code Intelligence (Optional Enhancement)

Build a knowledge graph of the codebase for deep structural analysis. Powered by [GitNexus](https://github.com/abhigyanpatwari/GitNexus).

**Auto-skip if:** project has <10 source files, OR `.gitnexus/` exists and is <24h old.

```
1. Check CLI:
   command -v gitnexus || npx gitnexus --version

   → If NOT found: PAUSE and notify user (see below)
   → If found: proceed to step 2

2. Index codebase:
   gitnexus analyze              # Build knowledge graph (AST → relationships → clusters)
   gitnexus analyze --skills     # Generate per-community SKILL.md files

3. Verify index:
   - Check .gitnexus/ directory created
   - Count symbols, relationships, communities from index

4. Populate profile:
   code_intelligence: {
     indexed: true,
     engine: "gitnexus",
     symbols_count: N,
     relationships_count: N,
     communities_count: N,
     processes_count: N,
     index_path: ".gitnexus/",
     indexed_at: "ISO-8601",
     mcp_available: true,
     skills_generated: ["community-a", "community-b", ...]
   }
```

### When GitNexus is NOT installed — User Notification

Do NOT silently skip. Pause and present a clear explanation using notify_user:

```
notify_user:
  "💡 Code Intelligence chưa được cài đặt

   Forgewright tích hợp sẵn tính năng Code Intelligence — giúp AI
   hiểu được mối quan hệ giữa các file, function, class trong dự án.

   Lợi ích:
   • AI biết chính xác sửa 1 hàm thì ảnh hưởng bao nhiêu file khác
   • Review code chất lượng hơn — phát hiện rủi ro trước khi commit
   • Debug nhanh hơn — trace ngược chuỗi gọi để tìm root cause

   Cài đặt rất đơn giản (yêu cầu Node.js):
   npm install -g gitnexus

   Bạn muốn làm gì?"
  Options:
  > "Tôi sẽ cài ngay — chờ tôi chạy lệnh trên (Recommended)"
  > "Bỏ qua — tiếp tục onboarding không cần Code Intelligence"
  > "Tôi chưa có Node.js — hướng dẫn tôi cài từ đầu"
  > "Chat about this"
```

**If user selects "Tôi sẽ cài ngay":**
- Wait for user to run `npm install -g gitnexus`
- Verify: `command -v gitnexus` → if found, proceed to step 2
- If still not found, guide troubleshooting (PATH issues, permissions)

**If user selects "Bỏ qua":**
- Set `code_intelligence.indexed = false`
- Continue onboarding normally
- Log: "Code Intelligence skipped by user choice"

**If user selects "Tôi chưa có Node.js":**
- Provide platform-specific install instructions:
  ```
  macOS:   brew install node
  Windows: Download from https://nodejs.org (LTS version)
  Linux:   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs
  ```
- After Node.js installed, guide: `npm install -g gitnexus`
- Then proceed to step 2

**Error handling:** If `gitnexus analyze` fails (timeout, parse error, etc.), mark as `code_intelligence.indexed = false` — never fail onboarding because of Code Intelligence. Log the error for debugging.

**Output:** Populate `code_intelligence` section of project profile. See `code-intelligence.md` protocol for usage by downstream skills.

## Phase 1.6 — MCP Server Generation (Auto after Code Intelligence)

Generates a project-specific MCP server that exposes codebase intelligence to any MCP-compatible client. Powered by `mcp-generator` skill.

**Auto-skip if:** `code_intelligence.indexed == false`, OR `.forgewright/mcp-server/` exists and is <24h old.

```
1. Check prerequisites:
   - code_intelligence.indexed == true (from Phase 1.5)
   - Node.js available (command -v node)
   → If Code Intelligence not indexed: SKIP — MCP requires GitNexus data
   → If Node.js missing: SKIP with note to user

2. Generate MCP server:
   - Read project-profile.json for project name, language, framework
   - Detect available commands (test, lint, build) from profile
   - Render templates from skills/mcp-generator/templates/ into .forgewright/mcp-server/
   - Replace Handlebars variables: {{projectName}}, {{testCommand}}, etc.

3. Install dependencies:
   cd .forgewright/mcp-server/ && npm install --silent

4. Populate profile:
   mcp_server: {
     generated: true,
     path: ".forgewright/mcp-server/",
     tools_count: N,       // count of enabled tools
     resources_count: N,    // count of enabled resources
     prompts_count: 3,
     transport: "stdio",
     generated_at: "ISO-8601"
   }

5. Output client config snippets:
   - Claude Desktop / Antigravity config
   - Cursor config
   - VS Code config
```

**Error handling:** If MCP generation fails, mark as `mcp_server.generated = false` — never fail onboarding because of MCP. Log the error for debugging.

**Output:** Generate `.forgewright/mcp-server/` directory and populate `mcp_server` section of project profile. See `skills/mcp-generator/SKILL.md` for full details.

## Phase 2 — Health Check

Run project health checks based on detected stack:

```
# Build check (detect and run appropriate build command)
IF package.json → npm run build (or pnpm build, yarn build)
IF go.mod → go build ./...
IF pyproject.toml → python -m py_compile on src/**/*.py
IF Cargo.toml → cargo check

# Test check (detect and run existing tests)
IF package.json has "test" script → npm test
IF go.mod → go test ./...
IF pyproject.toml → pytest --co (collect only, don't run — just count)
IF Cargo.toml → cargo test

# Lint check (detect and run existing linter)
IF .eslintrc* exists → npx eslint . --format json
IF biome.json exists → npx biome check .
IF pyproject.toml has ruff → ruff check .

# Dependency health
IF package.json → npm audit --json (count vulnerabilities)
IF go.mod → go list -m -json all | check for deprecated
IF pyproject.toml → pip-audit (if available)
```

**Error handling:** If any health check command fails to execute (not installed, etc.), mark as `"unknown"` — never fail the onboarding because of a missing tool.

**Output:** Populate `health` section of project profile.

## Phase 3 — Pattern Analysis

Read 3-5 representative source files to detect coding patterns:

```
1. Select files:
   - Largest source file in each major directory
   - Most recently modified files (active development area)
   - Entry point files (index.ts, main.go, app.py, etc.)

2. Analyze:
   - Naming convention: camelCase / snake_case / PascalCase / kebab-case
   - Import style: absolute paths / relative paths / barrel files / path aliases
   - Error handling: try-catch / Result types / error middleware / custom error classes
   - Component pattern (frontend): feature-based / type-based / atomic design
   - State management (frontend): Redux / Zustand / Jotai / Context / Signals
   - API pattern: REST controllers / server actions / tRPC / GraphQL resolvers
   - File organization: feature-sliced / layer-based / domain-driven

3. Confidence scoring:
   - High (>80% of files follow pattern) → enforce in quality gate
   - Medium (50-80%) → suggest but don't block
   - Low (<50%) → note as inconsistent, don't enforce
```

**Output:** Write `patterns` section to project profile AND `.forgewright/code-conventions.md` (human-readable).

## Phase 4 — Risk Assessment

```
1. Tech debt scan:
   - Count TODO/FIXME/HACK/XXX in source files (exclude node_modules, vendor)
   - Score: 0-10 → 1.0, 11-50 → 3.0, 51-100 → 5.0, 100+ → 7.0+

2. Deprecated dependencies:
   - Check for deprecated packages in lock files
   - Check major version gaps (installed v2, latest v5 = high risk)

3. Known CVEs:
   - From npm audit / pip-audit / cargo audit output in Phase 2
   - Classify: Critical / High / Medium / Low

4. Protected paths:
   - Always protect: .env*, *.key, *.pem, credentials/*, secrets/*
   - Detect production configs: production.*, *-prod.*
   - Detect migration files: migrations/, prisma/migrations/
   - Detect canonical local CI first: scripts/ci/; hosted-provider configs are optional evidence only

5. Protected branches:
   - Read from git: main, master, production, release/*
   - Check branch protection rules if accessible

6. Compute risk score (1-10):
   - tech_debt_weight × 0.2 + deprecated_deps × 0.2 + cve_count × 0.3 + (10 - test_coverage/10) × 0.3
```

**Output:** Populate `risk` section of project profile.

## Phase 5 — Profile Generation

Write `.forgewright/project-profile.json`:

```json
{
  "schema_version": "1.0",
  "fingerprint": {
    "language": "typescript",
    "framework": "next.js@15.1",
    "package_manager": "pnpm",
    "architecture": "modular-monolith",
    "test_framework": "vitest",
    "lint_tool": "biome",
    "ci_system": "local",
    "deployment": "vercel",
    "monorepo": false,
    "services": ["api", "web"],
    "detected_at": "ISO-8601"
  },
  "health": {
    "build_passes": true,
    "tests_pass": true,
    "test_count": 142,
    "test_coverage_percent": 78,
    "lint_clean": false,
    "lint_error_count": 23,
    "deprecated_dep_count": 3,
    "known_cve_count": 1,
    "cve_severity": { "critical": 0, "high": 0, "medium": 1, "low": 0 },
    "checked_at": "ISO-8601"
  },
  "patterns": {
    "naming_convention": "camelCase",
    "naming_confidence": "high",
    "component_pattern": "feature-based",
    "error_handling": "custom-error-classes",
    "import_style": "path-aliases",
    "state_management": "zustand",
    "api_pattern": "server-actions",
    "file_organization": "feature-sliced"
  },
  "risk": {
    "tech_debt_score": 3.2,
    "overall_risk_score": 4.1,
    "critical_risks": [],
    "protected_paths": [".env*", "prisma/migrations/**", ".github/**"],
    "protected_branches": ["main", "production"]
  },
  "forgewright": {
    "version": "7.0.0",
    "onboarded_at": "ISO-8601",
    "last_session": null,
    "total_sessions": 0
  }
}
```

Also write `.forgewright/code-conventions.md` — human-readable version of patterns section for developers.

Also ensure `.forgewright/.gitignore` is created:

```
# Session-specific (never commit)
session-log.json
baseline-*.json
change-manifest-*.json
quality-metrics.json
quality-history.json
quality-report-*.json
memory.db

# Project-specific (commit these)
!project-profile.json
!code-conventions.md
!.gitignore
```

## Completion

Print onboarding summary:

```
━━━ Project Onboarded ━━━━━━━━━━━━━━━━━━━━━━
Stack:     TypeScript / Next.js 15 / pnpm
Tests:     142 passing (78% coverage)
Health:    ✓ Build OK | ⚠ 23 lint errors | ⚠ 1 CVE (medium)
Risk:      4.1/10 (low-moderate)
Patterns:  camelCase, feature-based, Zustand
Profile:   .forgewright/project-profile.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Greenfield Behavior

For new/empty projects, the protocol still runs but produces minimal output:

```json
{
  "fingerprint": { "language": "unknown", "framework": "unknown", ... },
  "health": { "build_passes": null, "tests_pass": null, ... },
  "patterns": {},
  "risk": { "tech_debt_score": 0, "overall_risk_score": 0, ... }
}
```

The profile is populated progressively as the pipeline creates project structure.
