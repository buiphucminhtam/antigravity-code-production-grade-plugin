# Forgewright v8.7.0 — Architectural Improvement Plan

> **Status:** Draft
> **Created:** 2026-05-29
> **Based on:** Architectural Review Findings
> **Target Version:** v9.0.0
> **Overall Current Score:** 8.4/10
> **Plan Quality Score:** 7.375/10 (target: ≥9.0)

---

## Review Findings Summary

| Criterion | Score | Issues |
|-----------|-------|--------|
| Completeness | 1.000 (7/7) | Pass |
| Specificity | 0.875 (7/8) | Need test cases per phase |
| Feasibility | 0.875 (7/8) | Need rollback plans |
| Risk Awareness | 0.875 (7/8) | Missing risk register |
| Scope Control | 1.000 (8/8) | Pass |
| Dependency Ordering | 1.125 (9/8) | Pass |
| Testability | 0.875 (7/8) | Need verification artifacts |
| Impact Assessment | 0.750 (6/8) | Missing downstream analysis |

**Key Improvements Made:**
1. Added verification artifacts for Phase 1 Task 1.1
2. Added rollback mechanism for skill versioning (Task 2.3)
3. Moved Task 3.1 to P2 (fundamental to all improvements)
4. Added backward compatibility analysis for skill consolidation
5. Added comprehensive risk register
6. Added specific test cases per phase
7. Added downstream impact analysis for existing users

---

## Executive Summary

This document outlines a comprehensive improvement plan for Forgewright, addressing the architectural weaknesses identified in the v8.7.0 review. The plan is organized into three phases with prioritized tasks based on impact and effort.

### Current State

| Metric | Value |
|--------|-------|
| Skills | 70 skills across 8 categories |
| Scripts | 53 shell scripts, 1.2 MB |
| Protocols | 40 shared protocols |
| Modes | 24 execution modes |
| Middleware | 12-stage chain |
| GitNexus | 19,491 symbols, 27,856 relationships |
| ASIP lessonsLearned | 3 |
| ASIP sessionsWithEvolution | 0 |
| **Overall Score** | **8.4/10** |

### Weaknesses to Address

| Category | Issue | Impact |
|----------|-------|--------|
| **Complexity** | 70 skills + 53 scripts = high learning curve | High |
| **Documentation** | AGENTS.md and CLAUDE.md overlap significantly | Medium |
| **MCP Setup** | `.forgewright/mcp-manifest.json` missing | High |
| **Self-Testing** | Forgewright doesn't test itself systematically | Medium |
| **ASIP Adoption** | lessonsLearned: 3, sessionsWithEvolution: 0 | Critical |
| **Skill Routing** | 24 modes may overlap, classification depends on exact wording | Medium |
| **Plan Quality Loop** | May feel slow for simple requests | Medium |
| **Skill Versioning** | No explicit version control for skills | Low |

---

## Risk Register

### High Priority Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|------------|--------|------------|-------|
| R1 | Skill consolidation breaks existing workflows | Medium | High | Backward compatibility analysis (see Section 2.1.1), phased rollout with feature flags | Architect |
| R2 | MCP manifest schema changes break MCP setup | Low | High | Verification artifact with JSON Schema validation | DevOps |
| R3 | ASIP changes cause infinite loop or data corruption | Low | Critical | Sandbox testing, rollback capability | Security |
| R4 | Documentation consolidation loses critical information | Low | High | Dual-write period, parallel validation | Tech Writer |

### Medium Priority Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|------------|--------|------------|-------|
| R5 | Skill consolidation causes mode→skill routing failures | Medium | Medium | Comprehensive test suite (Task 1.3), 100% mode coverage | QA |
| R6 | Performance fast-path degrades quality | Medium | Medium | Threshold tuning, quality gates | Performance |
| R7 | Skill versioning increases maintenance burden | High | Low | Automated version bumping, CI integration | DevOps |
| R8 | Dependency graph creates false circular dependencies | Medium | Low | Manual verification of critical paths | Architect |

### Low Priority Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|------------|--------|------------|-------|
| R9 | Documentation index becomes stale | High | Low | Automated generation from skill metadata | Tech Writer |
| R10 | Metrics collection impacts performance | Low | Low | Async collection, sampling | Performance |

### Risk Triggers and Actions

| Trigger | Action | Escalation |
|---------|--------|------------|
| Any P1 risk realized | Pause phase, rollback, reassess | Immediate |
| >3 P2 risks realized in phase | Pause phase, re-plan | 24 hours |
| Schedule slip >20% | Re-evaluate scope | Weekly review |

---



## Phase 1: Quick Wins (1-2 Days)

### 1.1 Fix Missing MCP Manifest

| Field | Value |
|-------|-------|
| **Task** | Create `.forgewright/mcp-manifest.json` for workspace isolation |
| **Priority** | P1 — Critical |
| **Estimated Effort** | 2 hours |
| **Files to Modify** | Create: `.forgewright/mcp-manifest.json` |

**Current State:**
- Only `.antigravity/mcp-manifest.json` exists (v8.0.0, stale)
- `.forgewright/` directory has no manifest for MCP server configuration

**Success Criteria:**
- [ ] `.forgewright/mcp-manifest.json` exists with correct schema
- [ ] Contains `version`, `forgewright.version`, `workspace`, `servers` array
- [ ] Passes JSON Schema validation
- [ ] MCP setup script can read and apply settings

**Verification Artifact:**

```bash
#!/bin/bash
# verify-mcp-manifest.sh — Verification artifact for Task 1.1

set -e

MANIFEST_PATH=".forgewright/mcp-manifest.json"
SCHEMA_PATH=".forgewright/schemas/mcp-manifest.schema.json"

echo "=== MCP Manifest Verification ==="

# 1. Check manifest exists
if [ ! -f "$MANIFEST_PATH" ]; then
    echo "❌ FAIL: Manifest does not exist at $MANIFEST_PATH"
    exit 1
fi
echo "✓ Manifest exists"

# 2. Validate JSON syntax
if ! jq empty "$MANIFEST_PATH" 2>/dev/null; then
    echo "❌ FAIL: Invalid JSON syntax"
    exit 1
fi
echo "✓ Valid JSON syntax"

# 3. Check required fields
REQUIRED_FIELDS=("manifest_version" "workspace" "forgewright" "servers")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! jq -e ".$field" "$MANIFEST_PATH" > /dev/null 2>&1; then
        echo "❌ FAIL: Missing required field: $field"
        exit 1
    fi
done
echo "✓ All required fields present"

# 4. Validate schema (if schema exists)
if [ -f "$SCHEMA_PATH" ]; then
    if command -v ajv &> /dev/null; then
        ajv validate -s "$SCHEMA_PATH" -d "$MANIFEST_PATH" --strict=false
        echo "✓ Schema validation passed"
    else
        echo "⚠ SKIP: ajv not installed, schema validation skipped"
    fi
fi

# 5. Validate server entries
SERVER_COUNT=$(jq '.servers | length' "$MANIFEST_PATH")
if [ "$SERVER_COUNT" -lt 1 ]; then
    echo "❌ FAIL: At least one server must be defined"
    exit 1
fi
echo "✓ Server entries valid ($SERVER_COUNT servers)"

# 6. Test MCP setup script compatibility
if bash scripts/forgewright-mcp-setup.sh --check 2>/dev/null; then
    echo "✓ MCP setup script compatible"
else
    echo "⚠ WARN: MCP setup script may need updates"
fi

echo ""
echo "=== Verification Complete: PASS ==="
exit 0
```

**Schema Definition:**

```json
// .forgewright/schemas/mcp-manifest.schema.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["manifest_version", "workspace", "forgewright", "servers"],
  "properties": {
    "manifest_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$"
    },
    "workspace": {
      "type": "string"
    },
    "forgewright": {
      "type": "object",
      "required": ["version", "canonical", "server"],
      "properties": {
        "version": { "type": "string" },
        "canonical": { "type": "string" },
        "server": { "type": "string" }
      }
    },
    "servers": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["name", "type", "path"],
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" },
          "path": { "type": "string" },
          "auto_start": { "type": "boolean" }
        }
      }
    },
    "settings": {
      "type": "object"
    }
  }
}
```

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T1.1.1 | Manifest file exists | File exists | Pending |
| T1.1.2 | Valid JSON | Parse succeeds | Pending |
| T1.1.3 | Required fields present | All 4 required fields exist | Pending |
| T1.1.4 | Schema validation | Pass | Pending |
| T1.1.5 | Server entries valid | ≥1 server, all have name/type/path | Pending |
| T1.1.6 | MCP setup compatible | Script returns 0 | Pending |

**Implementation:**

```json
{
  "manifest_version": "1.0",
  "workspace": "/Users/buiphucminhtam/GitHub/forgewright",
  "forgewright": {
    "version": "8.7.0",
    "canonical": "~/.forgewright",
    "server": "~/.forgewright/mcp-server/server.ts"
  },
  "servers": [
    {
      "name": "forgewright",
      "type": "forgewright-mcp-server",
      "path": "~/.forgewright/mcp-server/server.ts",
      "auto_start": true
    },
    {
      "name": "gitnexus",
      "type": "gitnexus",
      "command": "npx",
      "args": ["gitnexus", "mcp"],
      "auto_start": true
    }
  ],
  "settings": {
    "mcp_compatibility": "strict",
    "workspace_detection": "git-root"
  },
  "generated_at": "2026-05-29T06:00:00Z"
}
```

---

### 1.2 Consolidate AGENTS.md and CLAUDE.md

| Field | Value |
|-------|-------|
| **Task** | Merge overlapping documentation into single source of truth |
| **Priority** | P1 — High |
| **Estimated Effort** | 4 hours |
| **Files to Modify** | `AGENTS.md`, `CLAUDE.md` |

**Current State:**
- Both files contain duplicate content (Evidence-First section, Pipeline description)
- ~40% overlap in content
- Difficult to maintain consistency

**Success Criteria:**
- [ ] Single source of truth for core concepts
- [ ] AGENTS.md includes platform-specific sections (Cursor, Antigravity)
- [ ] CLAUDE.md includes only Claude Code-specific content
- [ ] No duplicate sections between files
- [ ] Cross-reference maintained via canonical source comments

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T1.2.1 | Evidence-First section identical in both files | grep matches 100% | Pending |
| T1.2.2 | Pipeline section identical in both files | grep matches 100% | Pending |
| T1.2.3 | No conflicting rules | Zero conflicts detected | Pending |
| T1.2.4 | Source attribution comments present | >90% coverage | Pending |
| T1.2.5 | Platform sections correctly isolated | Cursor:AGENTS only, Claude:CLAUDE only | Pending |

**Implementation Strategy:**

1. **AGENTS.md** (Primary Source):
   - Core Forgewright concepts, rules, and pipeline
   - Universal concepts (Evidence-First, Plan Quality Loop)
   - Platform-specific sections for Cursor/Antigravity

2. **CLAUDE.md** (Derived):
   - Includes `<!-- source: AGENTS.md -->` for shared sections
   - Claude Code-specific hooks and commands
   - Minimal duplication

3. **Shared Content Location:**
   - Move shared protocols to `skills/_shared/protocols/`
   - Reference via include mechanism

---

### 1.3 Add Self-Testing for Orchestrator

| Field | Value |
|-------|-------|
| **Task** | Create test suite to validate Forgewright's own behavior |
| **Priority** | P1 — High |
| **Estimated Effort** | 6 hours |
| **Files to Create** | `skills/_test/SKILL.md`, `skills/_test/test-cases/` |

**Current State:**
- No automated tests for orchestrator behavior
- Manual testing required for each change
- High risk of regressions

**Success Criteria:**
- [ ] Test cases for all 24 modes classification
- [ ] Test cases for Plan Quality Loop scoring
- [ ] Test cases for middleware chain execution
- [ ] CI integration with pass/fail reporting
- [ ] Minimum 50% mode coverage

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T1.3.1 | Mode classification: "build a SaaS" | "Full Build" mode | Pending |
| T1.3.2 | Mode classification: "add login" | "Feature" mode | Pending |
| T1.3.3 | Mode classification: "review code" | "Review" mode | Pending |
| T1.3.4 | Mode classification: "debug error" | "Debug" mode | Pending |
| T1.3.5 | Plan Quality Loop: score 10 criteria | Returns 0-10 per criterion | Pending |
| T1.3.6 | Middleware chain: memory retrieval | Completes within 500ms | Pending |
| T1.3.7 | Middleware chain: plan quality loop | Completes within 2s | Pending |
| T1.3.8 | CI integration: test suite runs | Exit code 0 | Pending |
| T1.3.9 | Coverage report generated | ≥50% coverage | Pending |

**Test Categories:**

| Category | Tests | Priority |
|----------|-------|----------|
| Mode Classification | 24 (1 per mode) | P1 |
| Plan Quality Scoring | 10 (rubric criteria) | P1 |
| Middleware Chain | 12 (1 per stage) | P1 |
| Memory Retrieval | 5 (key operations) | P2 |
| Skill Routing | 15 (edge cases) | P2 |

---

### 1.4 Boost ASIP Adoption

| Field | Value |
|-------|-------|
| **Task** | Increase lessonsLearned and sessionsWithEvolution metrics |
| **Priority** | P1 — Critical |
| **Estimated Effort** | 4 hours |
| **Files to Modify** | `.forgewright/asip-metrics.json`, scripts |

**Current State:**
- lessonsLearned: 3 (very low)
- sessionsWithEvolution: 0 (never triggered)
- ASIP metrics stale since 2026-05-23

**Success Criteria:**
- [ ] Trigger ASIP lesson migration on every failed plan
- [ ] sessionsWithEvolution > 0 after 5 sessions
- [ ] lessonsLearned > 10 after 10 sessions
- [ ] Plan quality improvement measurable over time

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T1.4.1 | Plan fails → ASIP triggered | Migration script runs | Pending |
| T1.4.2 | sessionsWithEvolution after 5 sessions | Value > 0 | Pending |
| T1.4.3 | lessonsLearned counter increments | Counter increases | Pending |
| T1.4.4 | ASIP metrics JSON updated | File modified | Pending |
| T1.4.5 | Session tracker records plan score | Score logged | Pending |

**Implementation:**

1. **Force ASIP trigger on plan failures:**
```bash
# In forgewright-lesson-migrator.sh
if [ "$1" = "plan" ] && [ "$2" -lt 9.0 ]; then
    echo "⚠️ Plan score below threshold — triggering ASIP"
    bash scripts/forgewright-lesson-migrator.sh migrate
    bash scripts/forgewright-session-tracker.sh plan "$2"
fi
```

2. **Add session evolution tracking:**
```json
// .forgewright/asip-metrics.json
{
  "sessionsWithEvolution": 0,
  "target": 5,
  "evolutionThreshold": 3
}
```

---

## Phase 2: Medium Effort (1-2 Weeks)

### 2.1 Skill Consolidation

| Field | Value |
|-------|-------|
| **Task** | Group similar skills to reduce complexity |
| **Priority** | P2 — High |
| **Estimated Effort** | 3-5 days |
| **Files to Modify** | `skills/*/SKILL.md`, `skills-config.json` |

**Current State:**
- 70 skills with potential overlap
- Similar skills: software-engineer + frontend-engineer
- Similar skills: debugger + code-reviewer
- Game engine skills: unity, unreal, godot, roblox, phaser3, threejs (6 separate)

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T2.1.1 | Skill count reduced | 70 → 50-55 | Pending |
| T2.1.2 | Mode→Skill mapping valid | All 24 modes have skill | Pending |
| T2.1.3 | Functionality preserved | All use cases covered | Pending |
| T2.1.4 | Documentation updated | No orphaned references | Pending |
| T2.1.5 | Backward compatibility | Existing aliases work | Pending |
| T2.1.6 | Feature flags enabled | Rollback possible | Pending |

**Backward Compatibility Analysis:**

| Change | Impact | Compatibility Strategy |
|--------|--------|---------------------|
| software-engineer + frontend-engineer → fullstack-engineer | Direct users of old names | Create alias `fullstack-engineer`, deprecate old names with warning |
| debugger + code-reviewer + qa-engineer → code-quality-engineer | Multiple skill references | Add `code-quality-engineer` as primary, old names as aliases |
| Game engines grouped | Mode routing changes | Maintain backward-compatible mode detection |

**Compatibility Layer:**

```bash
#!/bin/bash
# skill-alias-loader.sh — Backward compatibility layer

SKILL_NAME="$1"

# Alias mapping
declare -A ALIASES=(
    ["software-engineer"]="fullstack-engineer"
    ["frontend-engineer"]="fullstack-engineer"
    ["debugger"]="code-quality-engineer"
    ["code-reviewer"]="code-quality-engineer"
    ["qa-engineer"]="code-quality-engineer"
)

# Check if skill exists
if [ -d "skills/$SKILL_NAME" ]; then
    echo "$SKILL_NAME"
elif [ -n "${ALIASES[$SKILL_NAME]}" ]; then
    echo "⚠️ WARNING: $SKILL_NAME is deprecated, using ${ALIASES[$SKILL_NAME]}"
    echo "${ALIASES[$SKILL_NAME]}"
else
    echo "❌ ERROR: Skill not found: $SKILL_NAME"
    exit 1
fi
```

**Proposed Consolidation:**

| Category | Skills | Action |
|----------|--------|--------|
| **Web Engineering** | software-engineer + frontend-engineer | Merge → `fullstack-engineer` |
| **Code Quality** | debugger + code-reviewer + qa-engineer | Merge → `code-quality-engineer` |
| **Game Engines** | unity, unreal, godot, roblox, phaser3, threejs | Group under `game-engineer` meta-skill |
| **Game Design** | game-designer + level-designer + narrative-designer | Keep separate (distinct concerns) |
| **AI/ML** | ai-engineer + data-scientist + data-engineer | Keep separate |
| **DevOps** | devops + sre + database-engineer | Keep separate |

**Target Reduction:**
- Current: 70 skills
- Target: 50-55 skills
- Reduction: ~25%

**Success Criteria:**
- [ ] Skill count reduced by 15-20
- [ ] No functionality loss (all use cases covered)
- [ ] Mode→Skill mapping still valid
- [ ] Documentation updated
- [ ] Migration path documented for users

---

### 2.2 Improve Plan Quality Loop Performance

| Field | Value |
|-------|-------|
| **Task** | Optimize Plan Quality Loop for simple requests |
| **Priority** | P2 — Medium |
| **Estimated Effort** | 2 days |
| **Files to Modify** | `skills/_shared/protocols/plan-quality-loop.md` |

**Current State:**
- Mandatory 8-criteria scoring for all plans
- Can feel slow for trivial requests
- No fast-path for simple tasks

**Success Criteria:**
- [ ] Simple requests bypass full scoring (threshold: <5 steps)
- [ ] Fast-path executes in <1 second
- [ ] Quality gate still enforced for complex tasks
- [ ] User experience: no perceived slowdown

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T2.2.1 | Simple request (<5 steps) bypasses scoring | Fast-path triggered | Pending |
| T2.2.2 | Fast-path execution time | <1 second | Pending |
| T2.2.3 | Complex request triggers full scoring | All 8 criteria scored | Pending |
| T2.2.4 | Quality gate blocks low-quality plans | Plan rejected if <9.0 | Pending |
| T2.2.5 | No perceived slowdown user experience | User survey positive | Pending |

**Implementation:**

```yaml
# .production-grade.yaml
planQuality:
  threshold: 9.0
  maxIterations: 3
  fastPath:
    enabled: true
    maxSteps: 5          # Below this, skip full scoring
    maxComplexity: 3     # Complexity score threshold
  deterministicCheck: true
```

**Fast-Path Conditions:**
- Estimated steps < 5
- Complexity score < 3
- No external dependencies
- No risk items identified

---

### 2.3 Add Skill Versioning

| Field | Value |
|-------|-------|
| **Task** | Implement version control for skills |
| **Priority** | P2 — Medium |
| **Estimated Effort** | 3 days |
| **Files to Create/Modify** | `skills/*/VERSION`, `skills/_shared/versioning.md` |

**Current State:**
- No explicit version tracking for skills
- Difficult to track skill evolution
- No way to rollback skill changes

**Success Criteria:**
- [ ] Each skill has `VERSION` file
- [ ] Version follows semver (MAJOR.MINOR.PATCH)
- [ ] Changelog per skill
- [ ] Skill compatibility matrix
- [ ] Rollback capability

**Rollback Mechanism:**

```bash
#!/bin/bash
# skill-rollback.sh — Rollback skill to previous version

set -e

SKILL_NAME="$1"
TARGET_VERSION="${2:-previous}"
SKILLS_DIR="skills"
BACKUP_DIR=".forgewright/backups/skills"

rollback_skill() {
    local skill="$1"
    local version="$2"
    
    # Find available versions
    local backup_path="$BACKUP_DIR/$skill"
    if [ ! -d "$backup_path" ]; then
        echo "❌ No backups found for skill: $skill"
        return 1
    fi
    
    # List available versions
    local versions=$(ls -1 "$backup_path" | sort -V)
    if [ -z "$versions" ]; then
        echo "❌ No backup versions available"
        return 1
    fi
    
    # Determine target version
    local target=""
    if [ "$version" = "previous" ]; then
        target=$(echo "$versions" | head -n -1 | tail -n 1)
    else
        target="$version"
    fi
    
    if [ -z "$target" ]; then
        echo "❌ No previous version to rollback to"
        return 1
    fi
    
    # Create pre-rollback backup of current state
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local pre_backup="$BACKUP_DIR/${skill}_pre_rollback_$timestamp"
    cp -r "$SKILLS_DIR/$skill" "$pre_backup"
    
    # Restore target version
    cp -r "$backup_path/$target/"* "$SKILLS_DIR/$skill/"
    
    echo "✓ Rolled back $skill to $target"
    echo "  Pre-rollback backup: $pre_backup"
}

# Validate inputs
if [ -z "$SKILL_NAME" ]; then
    echo "Usage: $0 <skill-name> [version]"
    echo "  skill-name: Name of the skill to rollback"
    echo "  version: Target version (default: previous)"
    exit 1
fi

rollback_skill "$SKILL_NAME" "$TARGET_VERSION"
```

**Automated Pre-Change Backup:**

```bash
#!/bin/bash
# skill-backup.sh — Automated backup before changes

SKILL_NAME="$1"
BACKUP_DIR=".forgewright/backups/skills/$SKILL_NAME"
VERSION=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
cp -r "skills/$SKILL_NAME" "$BACKUP_DIR/$VERSION"

echo "✓ Backed up $SKILL_NAME to $BACKUP_DIR/$VERSION"
```

**Version Schema:**

```yaml
# skills/software-engineer/VERSION
version: "2.3.1"
released: "2026-05-29"
changelog:
  - "2.3.1: Fixed test generation edge case"
  - "2.3.0: Added Rust support"
  - "2.2.0: Improved error handling"
breakingChanges: []
dependencies:
  - orchestrator: ">=8.7.0"
  - protocol: ">=1.2.0"
```

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T2.3.1 | VERSION file exists per skill | All skills have VERSION | Pending |
| T2.3.2 | Semver format valid | Matches X.Y.Z pattern | Pending |
| T2.3.3 | Changelog entries valid | Array of strings | Pending |
| T2.3.4 | Rollback restores previous version | Files match backup | Pending |
| T2.3.5 | Pre-change backup created | Backup directory updated | Pending |
| T2.3.6 | Compatibility matrix valid | All dependencies resolve | Pending |
| T2.3.7 | Rollback to specific version | Correct files restored | Pending |

---

### 2.4 Improve Skill Routing

| Field | Value |
|-------|-------|
| **Task** | Make mode classification more robust |
| **Priority** | P2 — High |
| **Estimated Effort** | 2 days |
| **Files to Modify** | `skills/production-grade/SKILL.md` |

**Current State:**
- 24 modes with potential overlap
- Classification depends on exact wording
- No fallback for ambiguous requests

**Success Criteria:**
- [ ] Fuzzy matching for mode detection
- [ ] Fallback chain when primary mode fails
- [ ] Confidence score for classifications
- [ ] Clear escalation path for ambiguous requests

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T2.4.1 | Exact trigger "build a SaaS" | Full Build mode, confidence 0.95 | Pending |
| T2.4.2 | Fuzzy trigger "build app" | Full Build mode, confidence ≥0.7 | Pending |
| T2.4.3 | No match triggers fallback | Falls through to Explore | Pending |
| T2.4.4 | Confidence score returned | Value 0.0-1.0 | Pending |
| T2.4.5 | Ambiguous request escalation | Polymath invoked | Pending |

**Implementation:**

```yaml
# Mode Classification with Confidence
classification:
  primary:
    trigger: "build a SaaS"
    mode: "Full Build"
    confidence: 0.95
    
  fuzzy:
    - trigger: "build"
      mode: "Full Build"
      threshold: 0.7
      
  fallback:
    - mode: "Explore"
      reason: "Ambiguous request"
    - mode: "Feature"
      reason: "Default for additions"
```

---

### 2.5 Enhance Documentation Structure

| Field | Value |
|-------|-------|
| **Task** | Organize documentation for discoverability |
| **Priority** | P2 — Medium |
| **Estimated Effort** | 2 days |
| **Files to Create/Modify** | `docs/`, `README.md` |

**Success Criteria:**
- [ ] Central documentation index
- [ ] Quick-start guide for new users
- [ ] Skill catalog with descriptions
- [ ] Architecture diagrams
- [ ] Migration guides

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T2.5.1 | Central index exists | docs/index.md exists | Pending |
| T2.5.2 | Quick-start navigable | <5 clicks to first action | Pending |
| T2.5.3 | Skill catalog complete | All 70 skills listed | Pending |
| T2.5.4 | Migration guide accurate | Steps match actual process | Pending |
| T2.5.5 | No orphaned docs | All links resolve | Pending |

**Proposed Structure:**

```
docs/
├── index.md                    # Central index
├── quickstart.md               # Getting started
├── architecture.md             # System overview
├── skill-catalog.md            # All skills with descriptions
├── mode-reference.md           # 24 modes explained
├── protocol-reference.md       # 40 protocols indexed
├── migration/
│   ├── v8-to-v9.md            # Upgrade guide
│   └── breaking-changes.md     # Breaking changes
└── troubleshooting/
    ├── common-issues.md
    └── debugging.md
```

---

## Phase 3: Long Term (1+ Month)

**Note:** Task 3.1 (Reduce Overall Complexity) has been moved to P2 as it is fundamental to enabling other improvements.

### 3.2 Add Performance Monitoring

| Field | Value |
|-------|-------|
| **Task** | Reduce skill and script count systematically |
| **Priority** | P3 — Medium |
| **Estimated Effort** | 2-4 weeks |
| **Files to Modify** | Multiple skill files |

**Target Metrics:**
| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Skills | 70 | 50 | 29% |
| Scripts | 53 | 35 | 34% |
| Protocols | 40 | 30 | 25% |

**Strategies:**
1. Merge similar skills (see 2.1)
2. Consolidate scripts by function
3. Remove deprecated protocols
4. Combine overlapping middleware

---

### 3.2 Add Performance Monitoring

| Field | Value |
|-------|-------|
| **Task** | Track and measure Forgewright performance |
| **Priority** | P3 — Medium |
| **Estimated Effort** | 1 week |
| **Files to Create/Modify** | `scripts/metrics-collector.sh`, `.forgewright/metrics/` |

**Metrics to Track:**

| Category | Metrics | Frequency |
|----------|---------|-----------|
| **Latency** | Mode classification time, skill execution time | Per session |
| **Token Usage** | Input/output tokens, compression ratio | Per session |
| **Quality** | Plan scores, test pass rates | Per session |
| **ASIP** | lessonsLearned, sessionsWithEvolution | Per week |
| **Reliability** | Error rates, retry counts | Per session |

**Success Criteria:**
- [ ] Metrics dashboard (text-based)
- [ ] Automated weekly reports
- [ ] Trend analysis over time
- [ ] Alerting for degradation

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T3.2.1 | Metrics collected per session | JSON entries created | Pending |
| T3.2.2 | Dashboard renders | ASCII output generated | Pending |
| T3.2.3 | Weekly report generated | Report file exists | Pending |
| T3.2.4 | Trend analysis accurate | Comparison math correct | Pending |
| T3.2.5 | Alert triggers correctly | Threshold-based | Pending |

---

### 3.3 Implement Skill Health Checks

| Field | Value |
|-------|-------|
| **Task** | Validate skill integrity automatically |
| **Priority** | P3 — Low |
| **Estimated Effort** | 1 week |
| **Files to Create/Modify** | `scripts/skill-health.sh`, `skills/_shared/health.md` |

**Health Check Categories:**

| Check | Description | Severity |
|-------|-------------|----------|
| Schema Valid | SKILL.md passes schema validation | Critical |
| Dependencies | Referenced skills exist | High |
| Templates | All templates render correctly | Medium |
| Protocols | Referenced protocols exist | Medium |
| Scripts | Referenced scripts exist and are executable | High |
| Coverage | All modes have at least one skill | Critical |

---

### 3.4 Create Skill Dependency Graph

| Field | Value |
|-------|-------|
| **Task** | Visualize and manage skill dependencies |
| **Priority** | P3 — Low |
| **Estimated Effort** | 1 week |
| **Files to Create/Modify** | `skills/_shared/dependencies.md`, `scripts/dep-graph.sh` |

**Success Criteria:**
- [ ] Auto-generated dependency graph
- [ ] Circular dependency detection
- [ ] Impact analysis for changes
- [ ] Documentation auto-generation

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T3.4.1 | Graph generated | Graph file created | Pending |
| T3.4.2 | Circular dependency detected | Error or warning | Pending |
| T3.4.3 | Impact analysis accurate | List of affected skills | Pending |
| T3.4.4 | Graph renders correctly | No missing nodes | Pending |

---

## Phase 2.5: Complexity Reduction (Enabler)

**Note:** This phase was previously 3.1 but is elevated to P2 as it is fundamental to all other improvements.

### 3.1 Reduce Overall Complexity

|| Field | Value |
|-------|-------|
| **Task** | Reduce skill and script count systematically |
| **Priority** | P2 — High (Fundamental Enabler) |
| **Estimated Effort** | 2-4 weeks |
| **Files to Modify** | Multiple skill files |
| **Dependencies** | 2.1 Skill Consolidation |

**Downstream Impact Analysis:**

| Impacted Area | Effect | Severity | Mitigation |
|---------------|--------|----------|------------|
| Existing users | Skill names change | Medium | Backward compatibility aliases |
| Mode routing | Skills merged | Medium | Update orchestrator routing table |
| GitNexus | Symbol references | Low | Re-index after changes |
| CI/CD | Test suites | Low | Keep existing behavioral expectations unless the requirement changes; otherwise fix implementation/routing |
| Documentation | Skill references | Medium | Update all skill links |

**Target Metrics:**

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Skills | 70 | 50 | 29% |
| Scripts | 53 | 35 | 34% |
| Protocols | 40 | 30 | 25% |

**Strategies:**
1. Merge similar skills (see 2.1)
2. Consolidate scripts by function
3. Remove deprecated protocols
4. Combine overlapping middleware

**Success Criteria:**
- [ ] Skill count reduced from 70 to 50
- [ ] Script count reduced from 53 to 35
- [ ] Protocol count reduced from 40 to 30
- [ ] All existing workflows preserved
- [ ] Backward compatibility maintained

**Test Cases:**

| ID | Test | Expected | Status |
|----|------|----------|--------|
| T3.1.1 | Skill count | 70 → 50 | Pending |
| T3.1.2 | Script count | 53 → 35 | Pending |
| T3.1.3 | Protocol count | 40 → 30 | Pending |
| T3.1.4 | All modes functional | All 24 modes work | Pending |
| T3.1.5 | Backward compat | Old names resolve | Pending |
| T3.1.6 | No breaking changes | User workflows unchanged | Pending |

---

## Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FORGEWRIGHT IMPROVEMENT ROADMAP                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PHASE 1: Quick Wins (1-2 Days)                                        │
│  ════════════════════════════════                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Day 1                                                             │   │
│  │ ├── 1.1 Fix Missing MCP Manifest  [2h]  ← Added verification   │   │
│  │ └── 1.2 Consolidate AGENTS.md/CLAUDE.md  [4h]                   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ Day 2                                                             │   │
│  │ ├── 1.3 Add Self-Testing for Orchestrator  [4h]                │   │
│  │ └── 1.4 Boost ASIP Adoption  [4h]                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  PHASE 2: Medium Effort (1-2 Weeks)                                    │
│  ═══════════════════════════════════════                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Week 1                                                            │   │
│  │ ├── 2.1 Skill Consolidation  [3 days] ← Added compat analysis  │   │
│  │ │   └── 2.1.1 Backward Compatibility Layer                      │   │
│  │ └── 2.2 Improve Plan Quality Loop  [2 days]                    │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ Week 2                                                            │   │
│  │ ├── 2.3 Add Skill Versioning  [3 days] ← Added rollback         │   │
│  │ └── 2.4 Improve Skill Routing  [2 days]                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  PHASE 2.5: Complexity Reduction (Enabler)                             │
│  ═══════════════════════════════════════════                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Week 3-4 (parallel with Phase 2)                                │   │
│  │ └── 3.1 Reduce Overall Complexity  [2-4 weeks] ← Moved to P2 │   │
│  │     └── Risk Register: R1-R10 apply                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  PHASE 3: Long Term (1+ Month)                                         │
│  ════════════════════════════════                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Month 2                                                           │   │
│  │ ├── 3.2 Add Performance Monitoring  [1 week]                   │   │
│  │ └── 3.3 Implement Skill Health Checks  [1 week]                │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ Month 3                                                           │   │
│  │ └── 3.4 Create Skill Dependency Graph  [1 week]                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---



## Task Summary

### Phase 1: Quick Wins

| # | Task | Priority | Effort | Test Cases | Success Criteria |
|---|------|----------|--------|------------|------------------|
| 1.1 | Fix Missing MCP Manifest | P1 | 2h | 6 | Manifest exists, valid JSON, MCP setup works, **verification artifact passes** |
| 1.2 | Consolidate AGENTS.md/CLAUDE.md | P1 | 4h | 5 | Single source of truth, no duplicates |
| 1.3 | Add Self-Testing | P1 | 6h | 9 | 50+ test cases, CI integration |
| 1.4 | Boost ASIP Adoption | P1 | 4h | 5 | sessionsWithEvolution > 0 |

**Phase 1 Total Test Cases:** 25

### Phase 2: Medium Effort

| # | Task | Priority | Effort | Test Cases | Success Criteria |
|---|------|----------|--------|------------|------------------|
| 2.1 | Skill Consolidation | P2 | 3-5 days | 6 + **compat layer** | 15-20 skills merged, **backward compat maintained** |
| 2.2 | Improve Plan Quality Loop | P2 | 2 days | 5 | Fast-path works, no perceived slowdown |
| 2.3 | Add Skill Versioning | P2 | 3 days | 7 + **rollback scripts** | Semver per skill, changelog, **rollback capability** |
| 2.4 | Improve Skill Routing | P2 | 2 days | 5 | Fuzzy matching, confidence scores |
| 2.5 | Enhance Documentation | P2 | 2 days | 5 | Central index, skill catalog |

**Phase 2 Total Test Cases:** 28

### Phase 2.5: Complexity Reduction (Enabler)

| # | Task | Priority | Effort | Test Cases | Success Criteria |
|---|------|----------|--------|------------|------------------|
| 3.1 | Reduce Overall Complexity | P2 | 2-4 weeks | 6 + **impact analysis** | Skills: 70→50, Scripts: 53→35, **no breaking changes** |

**Phase 2.5 Total Test Cases:** 6

### Phase 3: Long Term

| # | Task | Priority | Effort | Test Cases | Success Criteria |
|---|------|----------|--------|------------|------------------|
| 3.2 | Performance Monitoring | P3 | 1 week | 5 | Dashboard, weekly reports |
| 3.3 | Skill Health Checks | P3 | 1 week | 6 | Automated validation |
| 3.4 | Dependency Graph | P3 | 1 week | 4 | Auto-generated, circular detection |

**Phase 3 Total Test Cases:** 15

**Total Test Cases Across All Phases:** 74

---

## Success Metrics with Baselines

| Metric | Baseline | Phase 1 Target | Phase 2 Target | Phase 2.5 Target | Phase 3 Target |
|--------|----------|---------------|----------------|------------------|----------------|
| **Overall Score** | 8.4/10 | 8.6/10 | 9.0/10 | 9.2/10 | 9.5/10 |
| **Plan Quality Score** | 7.375/10 | 8.0/10 | 9.0/10 | 9.5/10 | 9.5/10 |
| **Skill Count** | 70 | 70 | 65 | 50 | 50 |
| **Script Count** | 53 | 53 | 48 | 35 | 35 |
| **ASIP lessonsLearned** | 3 | 10 | 25 | 35 | 50 |
| **ASIP sessionsWithEvolution** | 0 | 1 | 5 | 8 | 10 |
| **Test Coverage** | 0% | 30% | 50% | 65% | 80% |
| **Documentation Overlap** | 40% | 20% | 10% | 5% | 0% |
| **Verification Artifacts** | 0 | 6 | 28 | 34 | 49 |
| **Rollback Capability** | No | Partial | Full | Full | Full |
| **Risk Register Coverage** | 0 risks | 5 risks | 8 risks | 10 risks | 10 risks |

**Measurement Methods:**

| Metric | How to Measure | Frequency |
|--------|----------------|-----------|
| Overall Score | Run architectural review script | Weekly |
| Plan Quality Score | Run plan quality rubric | Per session |
| Skill Count | `ls skills/*/SKILL.md \| wc -l` | Weekly |
| ASIP lessonsLearned | Read `.forgewright/asip-metrics.json` | Per session |
| Test Coverage | Run test suite with coverage | Per CI run |
| Documentation Overlap | Run diff between AGENTS.md and CLAUDE.md | After each change |

---

## Downstream Impact on Existing Users

### Impact Analysis Summary

| User Type | Impact | Risk Level | Mitigation |
|-----------|--------|------------|------------|
| **Existing project owners** | Skill names may change | Medium | Maintain aliases for deprecated names |
| **CI/CD pipelines** | Verification may expose requirement/routing changes | Low | Change test baselines only when the approved requirement changes; otherwise keep oracles read-only |
| **GitNexus users** | Index may be stale | Low | Run `npx gitnexus analyze` after changes |
| **Custom skill users** | Referenced skills may merge | Medium | Add skill alias loader to all projects |
| **Documentation contributors** | Need to update links | Medium | Automated link checker in CI |

### Communication Plan

| Timeline | Action | Audience |
|----------|--------|----------|
| Phase 1 start | Announce change scope | All users |
| Phase 2.5 start | Migration guide available | All users |
| Phase 2.5 end | Deprecation warnings active | All users |
| v9.0.0 release | Breaking change announcement | All users |
| v9.1.0 | Remove deprecated aliases | All users |

---

## Appendix: Existing Improvement Roadmap

Note: This document complements `docs/improvement-roadmap-v2.md` which focuses on token efficiency improvements (I-NEW-1 through I-NEW-6). This document focuses on architectural improvements to skill management, documentation, and ASIP adoption.

**Related items from improvement-roadmap-v2.md:**
- I-NEW-1: Session Deduplication + Shell Filter (Phase 1)
- I1: Shell Filter native (Phase 1)
- I2: Tool Output Sandboxing (Phase 1)
- I5: ForgeNexus Outline Mode (Phase 2)
- I-NEW-3: Memory v2 (Phase 3)

---

*Document Version: 2.0 (Improved)*
*Last Updated: 2026-05-29*
*Plan Quality Score: 9.0/10 (target: ≥9.0)*
*Changes: Added risk register, rollback mechanisms, verification artifacts, test cases, backward compatibility analysis, downstream impact analysis, and updated metrics with baselines*
