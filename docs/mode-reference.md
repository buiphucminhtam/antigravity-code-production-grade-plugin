# Mode Reference

> **Complete guide to Forgewright's 24 execution modes**

Modes determine how Forgewright processes requests. Each mode invokes different skills in different sequences.

## Mode Overview

| Mode | Skills Invoked | Complexity | Time |
|------|---------------|------------|------|
| [Full Build](#full-build) | All (up to 17) | Highest | Long |
| [Feature](#feature) | 4-5 | Medium | Medium |
| [Review](#review) | 1 | Low | Short |
| [Debug](#debug) | 1-2 | Medium | Medium |
| [Ship](#ship) | 2-3 | Medium | Medium |
| [Test](#test) | 1 | Low | Short |
| [Harden](#harden) | 3 | Medium-High | Medium |
| [Architect](#architect) | 1 | High | Medium |
| [Document](#document) | 1 | Low | Short |
| [Explore](#explore) | 1 | Low | Varies |
| [Research](#research) | 1-2 | Medium | Varies |
| [Optimize](#optimize) | 2-3 | Medium | Medium |
| [Design](#design) | 2-3 | Medium | Medium |
| [Mobile](#mobile) | 4-5 | High | Long |
| [Game Build](#game-build) | 4-6 | High | Long |
| [XR Build](#xr-build) | 4-6 | High | Long |
| [Marketing](#marketing) | 2-3 | Medium | Medium |
| [Grow](#grow) | 2-3 | Medium | Medium |
| [AI Build](#ai-build) | 4-5 | High | Long |
| [Analyze](#analyze) | 1 | Low | Short |
| [Migrate](#migrate) | 3-4 | Medium | Medium |
| [Prompt](#prompt) | 1-2 | Low | Short |
| [Goal](#goal) | Variable | Variable | Variable |

---

## Full Build

**Trigger signals:** "build a SaaS", "from scratch", "full stack", "production grade", greenfield intent

**Skills invoked:** BA → PM → Architect → BE → FE → QA → Security → DevOps → SRE → [more]

**Pipeline:** INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN → GROW

**Use when:** Building an entirely new application from scratch

```
User: "Build a task management SaaS with React and Node.js"
Forgewright:
  1. DEFINE → Architecture, API design, data model
  2. BUILD → Backend services, frontend app
  3. HARDEN → Security, testing, performance
  4. SHIP → CI/CD, deployment
  5. SUSTAIN → Monitoring, alerting
  6. GROW → Analytics, SEO
```

---

## Feature

**Trigger signals:** "add [feature]", "implement [feature]", "new endpoint", "integrate [service]"

**Skills invoked:** PM (scoped) → Architect (scoped) → BE/FE → QA

**Use when:** Adding new functionality to existing codebase

```
User: "Add user roles and permissions"
Forgewright:
  1. PM → Scope the feature
  2. Architect → Design RBAC system
  3. Engineer → Implement
  4. QA → Test
```

---

## Review

**Trigger signals:** "review my code", "code review", "code quality", "check my code"

**Skills invoked:** Code Reviewer

**Use when:** Analyzing existing code quality

```
User: "Review the authentication module"
Forgewright:
  1. Code Reviewer → Architecture, quality, performance, test quality
  2. Output: Findings with severity levels
```

---

## Debug

**Trigger signals:** "debug", "fix bug", "broken", "investigate", "not working", "error", "trace"

**Skills invoked:** Debugger → [Engineer for fix if needed]

**Use when:** Finding and fixing bugs

```
User: "Users can't log in on mobile"
Forgewright:
  1. Debugger → Root cause analysis
  2. Engineer → Minimal fix
  3. QA → Regression test
```

---

## Ship

**Trigger signals:** "deploy", "CI/CD", "containerize", "infrastructure", "docker", "terraform"

**Skills invoked:** DevOps → SRE

**Use when:** Deployment and infrastructure work

```
User: "Deploy to Kubernetes"
Forgewright:
  1. DevOps → Docker, K8s configs
  2. SRE → Monitoring, alerting
```

---

## Test

**Trigger signals:** "write tests", "test coverage", "add tests"

**Skills invoked:** QA Engineer

**Use when:** Writing test cases

```
User: "Add unit tests for the payment service"
Forgewright:
  1. QA → Test strategy, test cases, implementation
```

---

## Harden

**Trigger signals:** "review", "audit", "secure", "harden", "before launch", "production ready"

**Skills invoked:** Security Engineer → QA Engineer → Code Reviewer

**Use when:** Pre-launch quality and security

```
User: "Harden this for production"
Forgewright:
  1. Security → Vulnerability scan
  2. QA → Test coverage check
  3. Code Review → Architecture conformance
```

---

## Architect

**Trigger signals:** "design", "architecture", "API design", "tech stack", "how should I structure"

**Skills invoked:** Solution Architect

**Use when:** Designing systems without implementation

```
User: "Design a microservices architecture"
Forgewright:
  1. Architect → Service boundaries, API contracts, data ownership
```

---

## Document

**Trigger signals:** "document", "write docs", "API docs", "README"

**Skills invoked:** Technical Writer

**Use when:** Creating documentation

```
User: "Document the user API"
Forgewright:
  1. Tech Writer → API reference, guides, examples
```

---

## Explore

**Trigger signals:** "explain", "understand", "help me think", "what should I", "I'm not sure"

**Skills invoked:** Polymath

**Use when:** Learning or brainstorming

```
User: "Help me understand microservices"
Forgewright:
  1. Polymath → Explanations, analogies, context
```

---

## Research

**Trigger signals:** "research", "deep research", "find sources", "investigate [domain]", "NotebookLM"

**Skills invoked:** NotebookLM Researcher → Polymath

**Use when:** Gathering information

```
User: "Research best practices for auth"
Forgewright:
  1. NotebookLM → Deep research with sources
  2. Polymath → Synthesize findings
```

---

## Optimize

**Trigger signals:** "performance", "slow", "optimize", "scale"

**Skills invoked:** Performance Engineer → SRE → Code Reviewer

**Use when:** Improving performance

```
User: "The dashboard is slow"
Forgewright:
  1. Performance → Profiling
  2. SRE → Infrastructure
  3. Code Review → Code patterns
```

---

## Design

**Trigger signals:** "design UI", "wireframes", "design system", "color palette", "UX flow"

**Skills invoked:** UX/research → Concept Artist → Art Director → UI/technical handoff

**Use when:** UI/UX design work

```
User: "Design the checkout flow"
Forgewright:
  1. UX Researcher → User research
  2. Concept Artist → Distinct visual directions and selected concept packet
  3. Art Director → Style DNA and production visual gates
  4. UI/technical handoff → Wireframes, design system, and implementation constraints
```

---

## Mobile

**Trigger signals:** "mobile app", "React Native", "iOS", "Android"

**Skills invoked:** Mobile Engineer → [PM, Architect as needed]

**Use when:** Building mobile applications

```
User: "Build an iOS app"
Forgewright:
  1. Mobile Engineer → React Native/Flutter
  2. Testing → Device testing
```

---

## Game Build

**Trigger signals:** "game", "Unity", "Unreal", "Godot", "Roblox", "Phaser", "Three.js", "gameplay"

**Skills invoked:** UX/research → Concept Artist → Art Director → UI/technical/engine handoff → [Level, Narrative, Audio as needed]

**Use when:** Building games

```
User: "Build a Unity game"
Forgewright:
  1. UX/research → Player needs and constraints
  2. Concept Artist → Distinct visual directions and selected concept packet
  3. Art Director → Style DNA and production visual gates
  4. UI/technical/engine handoff → Unity implementation constraints
  5. Level Designer → Levels
```

The executable route resolves ordered verified paths with
`python3 scripts/runtime/skill_routing.py --mode design|game-build --config
.forgewright/skills-config.json`, validates concept/art artifacts with
`python3 scripts/art-direction/creative-handoff.py validate-handoff "$CONCEPT_PACKET" "$ART_DIRECTION_GATES"`, freezes a
skill-aware dispatch packet, and then uses the host-owned native `spawn_agent`
only after `python3 scripts/runtime/codex-subagent-routing.py` resolves safe
spawn arguments.

### Game Engine Routing

| Request | Skill Invoked |
|---------|---------------|
| "Unity game" | unity-engineer |
| "Unreal game" | unreal-engineer |
| "Godot game" | godot-engineer |
| "Roblox experience" | roblox-engineer |
| "HTML5 game" | phaser3-engineer |
| "3D web experience" | threejs-engineer |
| "VR app" | xr-engineer |

---

## XR Build

**Trigger signals:** "VR", "AR", "MR", "XR", "Quest", "Vision Pro", "WebXR"

**Skills invoked:** XR Engineer → [Game Build pipeline if game-like]

**Use when:** Building immersive experiences

```
User: "Create a VR training app"
Forgewright:
  1. XR Engineer → VR implementation
  2. Game Designer → Experience design
```

---

## Marketing

**Trigger signals:** "marketing", "SEO", "launch strategy", "copywriting", "go-to-market"

**Skills invoked:** Growth Marketer → [Conversion Optimizer]

**Use when:** Marketing work

```
User: "Plan the launch"
Forgewright:
  1. Growth Marketer → Strategy, channels
  2. Conversion Optimizer → Landing pages
```

---

## Grow

**Trigger signals:** "growth", "CRO", "conversion", "funnel", "A/B test", "churn", "retention"

**Skills invoked:** Conversion Optimizer → Growth Marketer

**Use when:** Growth and conversion optimization

```
User: "Improve our checkout conversion"
Forgewright:
  1. Conversion Optimizer → Funnel analysis, A/B tests
```

---

## AI Build

**Trigger signals:** "AI feature", "chatbot", "RAG", "embeddings", "LLM", "agent", "prompt", "AI-powered"

**Skills invoked:** AI Engineer → Prompt Engineer → Data Scientist → Architect

**Use when:** Building AI features

```
User: "Add a chatbot to the app"
Forgewright:
  1. AI Engineer → RAG pipeline
  2. Prompt Engineer → Prompt design
  3. Data Scientist → Embeddings
```

---

## Analyze

**Trigger signals:** "analyze requirements", "evaluate this", "is this feasible", "validate requirements"

**Skills invoked:** Business Analyst

**Use when:** Requirements analysis

```
User: "Analyze these requirements"
Forgewright:
  1. BA → Feasibility, gaps, completeness
```

---

## Migrate

**Trigger signals:** "migrate", "upgrade", "migration", "database change", "schema change", "move to"

**Skills invoked:** Database Engineer → Software Engineer → QA

**Use when:** Migration work

```
User: "Migrate to PostgreSQL"
Forgewright:
  1. Database Engineer → Schema design
  2. Software Engineer → Code changes
  3. QA → Test migration
```

---

## Prompt

**Trigger signals:** "improve prompts", "prompt engineering", "optimize prompts"

**Skills invoked:** Prompt Engineer → Prompt Optimizer

**Use when:** Prompt optimization

```
User: "Improve these prompts"
Forgewright:
  1. Prompt Engineer → Analysis
  2. Prompt Optimizer → Systematic optimization
```

---

## Goal

**Trigger signals:** "set goal", "/goal", "keep going until", "autonomous"

**Skills invoked:** Goal-Driven orchestrator → [Any skill as needed]

**Use when:** Autonomous task completion

```
User: "Set goal: Implement the accepted requirement and keep CI green"
Forgewright:
  → Locks behavioral test oracles to the accepted requirement
  → Auto-evaluates after each implementation/infrastructure fix
  → If expected behavior is ambiguous, blocks and asks the user/PO instead of editing tests
  → Continues until requirement + verification condition are met
```

---

## Mode Selection Flow

```
User Request
     ↓
Chat Interpreter (9 dimensions)
     ↓
Mode Detection (with fuzzy matching)
     ↓
    ┌─ High confidence ──────────────────┐
    ↓                                    ↓
Direct to mode                     Present alternatives
     ↓                                    ↓
Skill Selection                          User chooses
     ↓
Orchestrate execution
```

---

## Custom Mode

If no mode matches, Forgewright presents a skill menu and lets you pick.

---

*Mode Reference version: 1.0 | Updated: 2026-05-29*
