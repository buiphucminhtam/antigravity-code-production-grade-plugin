# Mode Classification Reference

<!-- source: skills/production-grade/references/mode-classification.md -->

## Enhanced Mode Classification with Fuzzy Matching (v8.7+)

### Confidence Scoring System

Every mode classification returns a confidence score (0.0 - 1.0):

```
┌─ Mode Classification ─────────────────────────────────────┐
│                                                            │
│  Detected: Feature                                         │
│  Confidence: 0.87                                          │
│                                                            │
│  Evidence:                                                 │
│  • "add login" → feature keyword match                    │
│  • "implement" → strong signal                            │
│  • No full-stack indicators → no Full Build               │
│                                                            │
│  Secondary candidates:                                      │
│  • Full Build (0.23) — mentions "system"                  │
│  • AI Build (0.15) — mentions "smart"                    │
│                                                            │
│  Status: ✅ Proceeding with Feature mode                   │
└────────────────────────────────────────────────────────────┘
```

### Trigger Matching

| Match Type | Confidence | Example |
|-----------|------------|---------|
| **Exact match** | 0.95-1.0 | "build a SaaS" → Full Build |
| **Fuzzy match** | 0.7-0.94 | "make a web app" → Full Build (0.85) |
| **Weak signal** | 0.4-0.69 | "help me" → Explore (0.45) |
| **No match** | < 0.4 | Fallback chain invoked |

### Fuzzy Trigger Patterns

```yaml
classification:
  primary:
    trigger: "build a SaaS"
    mode: "Full Build"
    confidence: 0.95
    keywords: ["build", "saas", "full stack", "from scratch", "greenfield"]

  fuzzy:
    - trigger: "build"
      mode: "Full Build"
      threshold: 0.7
      synonyms: ["create", "make", "develop", "construct"]

    - trigger: "game"
      mode: "Game Build"
      threshold: 0.75
      engine_keywords: ["unity", "unreal", "godot", "roblox", "phaser", "threejs"]

    - trigger: "mobile"
      mode: "Mobile"
      threshold: 0.7
      keywords: ["ios", "android", "react native", "flutter"]

  fallback:
    - mode: "Explore"
      confidence: 0.3
      reason: "Ambiguous request"
    - mode: "Feature"
      confidence: 0.4
      reason: "Default for additions"
    - mode: "Full Build"
      confidence: 0.35
      reason: "Catch-all for builds"
```

### Fuzzy Matching Rules

1. **Keyword extraction** — Extract key terms from request
2. **Stemming** — Match "building" to "build"
3. **Synonym expansion** — Match "create" to "build"
4. **Partial matching** — "unity" matches "Unity3D"
5. **Context weighting** — "game" near "mobile" → Game Build (higher)

### Fallback Chain

When no match exceeds the threshold:

```
Fallback sequence:
1. Polymath (Explore) — Help clarify intent
2. Feature — Default for additions
3. Full Build — Catch-all for builds
4. Custom — Let user pick mode
```

### Configuration

```yaml
# In .production-grade.yaml
skillRouting:
  fuzzyMatching:
    enabled: true
    minConfidence: 0.7
    synonymExpansion: true
    stemmingEnabled: true
  fallbackChain:
    - Explore
    - Feature
    - Full Build
```

If `confidence: HIGH` → use the detected mode directly, skip the classification table.
If `confidence: MEDIUM` → present 2 most likely modes to the user.
If `confidence: LOW` → present 3 most likely modes to the user.

**⚠️ ENFORCEMENT: If request is unclear, STOP and ask. DO NOT start executing.**

The following requests MUST trigger clarification:
- Contains vague verbs: "help me", "make it", "do something", "fix it"
- No specific scope: "build an app", "add a feature", "update the system"
- Two or more tasks in one: "explain AND build", "fix AND test"
- No success criteria: "make it better", "improve it"
- No file/location specified: "update login", "add auth"

Override the detected mode only if the user's intent clearly differs from what was interpreted. Otherwise, trust the chat-interpreter's analysis.

| Mode | Trigger Signals | Skills Involved |
|------|----------------|-----------------|
| **Full Build** | "build a SaaS", "production grade", "from scratch", "full stack", greenfield intent | All skills, full DEFINE→BUILD→HARDEN→SHIP→SUSTAIN→GROW pipeline |
| **Feature** | "add [feature]", "implement [feature]", "new endpoint", "new page", "integrate [service]" | BA (if gaps detected) → PM (scoped) → Architect (scoped) → BE/FE → QA |
| **Harden** | "review", "audit", "secure", "harden", "before launch", "production ready" (on EXISTING code) | Security + QA + Code Review (sequential) → Remediation |
| **Ship** | "deploy", "CI/CD", "containerize", "infrastructure", "terraform", "docker" | DevOps → SRE |
| **Debug** | "debug", "fix bug", "broken", "investigate", "not working", "error", "trace", "crashes" | Debugger (→ Software/Frontend Engineer for fix) |
| **AI Build** | "AI feature", "chatbot", "RAG", "embeddings", "LLM", "agent", "prompt", "AI-powered" | AI Engineer + Prompt Engineer + Data Scientist + Architect (scoped) → BE/FE |
| **Migrate** | "migrate", "upgrade", "migration", "database change", "schema change", "refactor DB", "move to" | Database Engineer + Software Engineer → QA |
| **Test** | "write tests", "test coverage", "test this", "add tests" | QA |
| **Review** | "review my code", "code review", "code quality", "check my code" | Code Reviewer |
| **Architect** | "design", "architecture", "API design", "data model", "tech stack", "how should I structure" | Solution Architect |
| **Document** | "document", "write docs", "API docs", "README" | Technical Writer |
| **Explore** | "explain", "understand", "help me think", "what should I", "I'm not sure" | Polymath |
| **Research** | "research", "deep research", "find sources", "analyze topic", "investigate [domain]", "NotebookLM", "study materials", "generate quiz" | NotebookLM Researcher → Polymath (research mode) + NotebookLM MCP (primary) |
| **Optimize** | "performance", "slow", "optimize", "scale", "reliability" | Performance Engineer + SRE + Code Reviewer |
| **Design** | "design UI", "wireframes", "design system", "color palette", "UX flow" | UX/research → Concept Artist → Art Director → UI/technical handoff |
| **Mobile** | "mobile app", "React Native", "Flutter", "iOS", "Android" | BA (if gaps detected) → Mobile Engineer (+ PM scoped, Architect scoped if needed) |
| **Game Build** | "game", "Unity", "Unreal", "Godot", "Roblox", "Phaser", "Three.js", "gameplay", "game design", "build a game" | UX/research → Concept Artist → Art Director → UI/technical/engine handoff → Level/Narrative/TechArt/Audio |
| **XR Build** | "VR", "AR", "MR", "XR", "spatial", "Quest", "Vision Pro", "WebXR" | XR Engineer (+ Game Build pipeline if game-like XR) |
| **Marketing** | "marketing", "SEO", "launch strategy", "copywriting", "content strategy", "go-to-market" | Growth Marketer (+ Conversion Optimizer if CRO mentioned) |
| **Grow** | "growth", "CRO", "conversion", "funnel", "A/B test", "churn", "retention", "referral" | Conversion Optimizer (+ Growth Marketer if strategy needed) |
| **Analyze** | "analyze requirements", "evaluate this", "is this feasible", "validate requirements", "check completeness", "client says" | Business Analyst (standalone requirements analysis) |
| **Auto-Publish** | "auto publish", "publish store", "publish apple", "publish google play", "release app" | Auto-Publish |
| **Goal** | "set goal", "work toward", "keep going until", "autonomous", "/goal" | Goal-Driven orchestrator — auto-evaluate and continue until condition met |
| **Custom** | Doesn't fit above patterns | Present skill menu, let user pick |

**Step 2 — Choose the smallest interaction needed:**

- `QUICK` or obvious single-role work: execute after a mini-plan; do not ask for plan approval unless a material preference/gate exists.
- `STANDARD` multi-role work: communicate the concise plan and material trade-offs; proceed autonomously when choices are reversible and within the user's delegated scope.
- `DEEP` / contractual / release-critical work: surface major trade-offs and obtain approval only at actual human decision gates.

Never offer "run every skill/phase" as a quality upgrade. More roles are not inherently better; route only the capabilities required by acceptance and risk.

For UI work, reuse the current design system/reference first. Offer a `DESIGN.md` template only for a major new identity/redesign where no current visual system exists.

Use persistent Antigravity planning only when multi-lane coordination or durable architecture planning actually benefits from it; component count alone is not a trigger.
