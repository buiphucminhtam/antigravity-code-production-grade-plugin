# Skill Catalog

> **Complete reference of all Forgewright skills**

Forgewright includes 55+ skills organized into 8 categories. Skills are loaded on-demand based on the detected mode.

## Skill Categories

| Category | Count | Skills |
|---------|-------|--------|
| [Orchestration](#orchestration) | 4 | Orchestrator, Polymath, Parallel Dispatch, Memory Manager |
| [Engineering](#engineering) | 12 | Fullstack Engineer, Code Quality Engineer, etc. |
| [Game Development](#game-development) | 15 | Unity, Unreal, Godot, Roblox, Phaser 3, Three.js |
| [AI/ML](#aiml) | 4 | AI Engineer, Prompt Engineer, Data Scientist, NotebookLM |
| [DevOps](#devops) | 5 | DevOps, SRE, Database Engineer, Performance Engineer, Security |
| [Design](#design) | 6 | UX Researcher, Concept Artist, Art Director, UI Designer, Interaction Designer, etc. |
| [Growth](#growth) | 3 | Growth Marketer, Conversion Optimizer |
| [Meta](#meta) | 5 | Skill Maker, MCP Generator, Project Manager, etc. |

## Orchestration

| Skill | Description | Use When |
|-------|-------------|-----------|
| **production-grade** | Main orchestrator - routes requests to appropriate skills | Always - this is the entry point |
| **polymath** | General-purpose problem solver with broad knowledge | "Help me think about...", ambiguous requests |
| **parallel-dispatch** | Coordinates parallel task execution | Complex tasks with multiple parallel paths |
| **memory-manager** | Memory retrieval and persistence | Session continuity, context restoration |

## Engineering

### Consolidated Skills (v9.0)

| Skill | Consolidated From | Description |
|-------|-------------------|-------------|
| **fullstack-engineer** | software-engineer + frontend-engineer | Backend + frontend development |
| **code-quality-engineer** | debugger + code-reviewer + qa-engineer | Debugging, code review, testing |

### Specialized Engineering

| Skill | Description | Use When |
|-------|-------------|-----------|
| **api-designer** | API contract design | "Design the API for..." |
| **database-engineer** | Data modeling, migrations | "Add a database table...", "migrate schema" |
| **mobile-engineer** | React Native, Flutter, iOS, Android | "Build a mobile app" |
| **accessibility-engineer** | a11y audits and implementation | "Make this accessible", WCAG compliance |
| **build-release-engineer** | CI/CD, build systems | "Set up the build pipeline" |

## Game Development

### Consolidated as Meta-Skill (v9.0)

| Meta-Skill | Sub-Engines | Description |
|-----------|--------------|-------------|
| **game-engineer** | unity, unreal, godot, roblox, phaser3, threejs | Unified game development orchestrator |

### Game Engine Skills

| Skill | Description | Use When |
|-------|-------------|-----------|
| **unity-engineer** | Unity 3D game development | "Build a Unity game" |
| **unreal-engineer** | Unreal Engine development | "Build an Unreal game" |
| **godot-engineer** | Godot engine development | "Build a Godot game" |
| **roblox-engineer** | Roblox experience development | "Build a Roblox game" |
| **phaser3-engineer** | HTML5 2D games | "Build an HTML5 game" |
| **threejs-engineer** | WebGL 3D experiences | "Build a Three.js experience" |

### Game Design Skills

| Skill | Description | Use When |
|-------|-------------|-----------|
| **game-designer** | Game mechanics, balance | "Design game mechanics" |
| **level-designer** | Level creation, difficulty curves | "Create a level" |
| **narrative-designer** | Story, dialogue, world-building | "Write the game story" |
| **game-audio-engineer** | Sound effects, music | "Add game audio" |
| **game-asset-vfx** | Visual effects, particles | "Add visual effects" |
| **technical-artist** | Graphics optimization, shaders | "Optimize game graphics" |

## AI/ML

| Skill | Description | Use When |
|-------|-------------|-----------|
| **ai-engineer** | AI features, RAG, LLM integration | "Add AI to my app", "build a chatbot" |
| **prompt-engineer** | Prompt engineering and optimization | "Improve this prompt", "write better prompts" |
| **prompt-optimizer** | DSPy algorithmic optimization | "Optimize prompts systematically" |
| **data-scientist** | Data analysis, ML pipelines | "Analyze this dataset" |
| **notebooklm-researcher** | NotebookLM integration | "Research this topic", "create a notebook" |
| **web-scraper** | Web data extraction | "Scrape this website", "collect data" |

## DevOps

| Skill | Description | Use When |
|-------|-------------|-----------|
| **devops** | CI/CD, Docker, Kubernetes | "Set up CI/CD", "dockerize this" |
| **sre** | Site reliability, monitoring | "Improve reliability", "set up alerting" |
| **database-engineer** | Data modeling, migrations | "Design the database", "migrate data" |
| **performance-engineer** | Performance optimization | "Make this faster", "optimize" |
| **security-engineer** | Security audits, hardening | "Audit security", "penetration test" |

## Design

| Skill | Description | Use When |
|-------|-------------|-----------|
| **ux-researcher** | User research, usability testing | "Research user needs" |
| **concept-artist** | Divergent visual concepts and selected concept packets | "Explore visual directions" |
| **art-director** | Style DNA, visual gates, and production art direction | "Define the visual style" |
| **ui-designer** | UI design, visual systems | "Design the interface" |
| **interaction-designer** | Micro-interactions, animations | "Design the interactions" |
| **vision-review** | AI-generated art quality check | "Review AI-generated assets" |
| **accessibility-engineer** | Accessibility audits | "Check accessibility" |

## Growth

| Skill | Description | Use When |
|-------|-------------|-----------|
| **growth-marketer** | Marketing strategy, campaigns | "Market my product" |
| **conversion-optimizer** | A/B testing, funnel optimization | "Improve conversions" |

## Meta

| Skill | Description | Use When |
|-------|-------------|-----------|
| **skill-maker** | Create new skills | "I need a custom skill" |
| **mcp-generator** | Generate MCP configurations | "Set up MCP for this project" |
| **project-manager** | Project planning, tracking | "Plan this project" |
| **product-manager** | Product strategy, roadmaps | "Plan the product" |
| **business-analyst** | Requirements analysis | "Analyze requirements" |
| **solution-architect** | Architecture design | "Design the architecture" |
| **technical-writer** | Documentation | "Write docs" |
| **autonomous-testing** | Self-healing E2E tests | "Run autonomous tests" |
| **goal-driven** | Autonomous goal pursuit | "Keep working until..." |
| **token-tracker** | Context window monitoring | "Track token usage" |

## Skill Versioning (v9.0)

Each skill now has a `VERSION` file with semver tracking:

| Version | Meaning |
|---------|---------|
| PATCH | Bug fixes, docs |
| MINOR | New features, backward-compatible |
| MAJOR | Breaking changes |

### Backup and Rollback

```bash
# Backup before changes
bash scripts/skill-backup.sh <skill-name>

# List available versions
bash scripts/skill-rollback.sh --list <skill-name>

# Rollback to previous version
bash scripts/skill-rollback.sh <skill-name>
```

## Skill Dependencies

```
production-grade (orchestrator)
    ├── business-analyst (BA)
    ├── product-manager (PM)
    ├── solution-architect (Architect)
    ├── fullstack-engineer
    │   ├── api-designer
    │   └── database-engineer
    ├── code-quality-engineer
    │   ├── debugger
    │   ├── code-reviewer
    │   └── qa-engineer
    ├── devops
    ├── security-engineer
    ├── game-engineer (meta-skill)
    │   ├── unity-engineer
    │   ├── unreal-engineer
    │   ├── godot-engineer
    │   ├── roblox-engineer
    │   ├── phaser3-engineer
    │   └── threejs-engineer
    └── [many more...]
```

## Finding Skills

### By Task

```markdown
# I want to...
"build an app"           → fullstack-engineer
"fix a bug"             → code-quality-engineer
"write tests"           → code-quality-engineer
"review code"           → code-quality-engineer
"design the UI"         → ui-designer
"set up CI/CD"          → devops
"build a Unity game"    → game-engineer (routes to unity-engineer)
"add AI features"        → ai-engineer
```

### By Category

| Category | Skills |
|---------|--------|
| Web Dev | fullstack-engineer, api-designer |
| Quality | code-quality-engineer |
| Game Dev | game-engineer, [engine] |
| AI/ML | ai-engineer, prompt-engineer |
| DevOps | devops, sre, security-engineer |
| Design | ux-researcher, ui-designer |

## Creating Custom Skills

See the [Skill Maker](../skills/skill-maker/SKILL.md) skill for creating custom skills.

---

*Skill Catalog version: 1.0 | Updated: 2026-05-29*
