# Mode Reference Index

> **Purpose:** Maps Forgewright's 24 modes to their execution references. The canonical inventory is `product-manifest.json` / `docs/mode-reference.md`.
> This file provides a quick reference; full mode descriptions are in `skills/production-grade/SKILL.md`.

## Mode Map

| Mode | SKILL.md Section | Skills | Gates |
|------|-----------------|--------|-------|
| Full Build | `SKILL.md` → Full Build Pipeline | All (up to 17) | 3 |
| Feature | `SKILL.md` → Feature Mode | BA → PM → Architect → BE/FE → QA | 1 |
| Harden | `SKILL.md` → Harden Mode | Security → QA → Review | 1 |
| Ship | `SKILL.md` → Ship Mode | DevOps → SRE | 1 |
| Debug | `SKILL.md` → Debug Mode | Debugger → Engineer | 1 |
| Test | `SKILL.md` → Test Mode | QA | 0 |
| Review | `SKILL.md` → Review Mode | Code Reviewer | 0 |
| Architect | `SKILL.md` → Architect Mode | Solution Architect | 1 |
| Document | `SKILL.md` → Document Mode | Technical Writer | 0 |
| Explore | `SKILL.md` → Explore Mode | Polymath | 0 |
| Research | `SKILL.md` → Research Mode | Polymath + NotebookLM | 0 |
| Optimize | `SKILL.md` → Optimize Mode | Performance + SRE | 1 |
| Design | `SKILL.md` → Design Mode | UX Researcher → UI Designer | 1 |
| Mobile | `SKILL.md` → Mobile Mode | BA → Mobile Engineer | 1 |
| Game Build | `SKILL.md` → Game Build Mode | Studio control plane → role lanes → engine → QA/release | 7 |
| XR Build | `SKILL.md` → XR Build Mode | XR Engineer + Game pipeline | 2 |
| Marketing | `SKILL.md` → Marketing Mode | Growth Marketer | 1 |
| Grow | `SKILL.md` → Grow Mode | Growth Marketer → Conversion Optimizer | 1 |
| Analyze | `SKILL.md` → Analyze Mode | Business Analyst | 0 |
| AI Build | `SKILL.md` → AI Build Mode | AI Engineer + Prompt Eng + Data Scientist | 2 |
| Migrate | `SKILL.md` → Migrate Mode | Database Eng → Software Eng → QA | 2 |
| Prompt | `SKILL.md` → Prompt Mode | Prompt Engineer + Prompt Optimizer | 0 |
| Goal | `SKILL.md` → Goal Mode | Goal-driven wrapper + only the roles needed by the underlying work | varies |
| Custom Mode | `SKILL.md` → Custom Mode | User-selected relevant roles | varies |

## Shared Behaviors (All Modes)

All modes share these behaviors (see `SKILL.md` → Mode Execution):

- Reuse verified workspace/config state rather than recreating scaffolding.
- Every domain role operates at senior level; model tier is separate from competence.
- `QUICK` uses the mini-plan fast path; `STANDARD`/`DEEP` use the applicable complexity-scaled threshold.
- Verification and review scale with risk; do not add work merely to exercise more roles/phases.
- Status updates are for substantial work; user questions are reserved for material ambiguity.

## Single-Skill Modes (Skip Plan Presentation)

These modes skip plan presentation — classify and invoke immediately:

`Test`, `Review`, `Document`, `Explore`, `Analyze`, `Prompt`

## Multi-Skill Modes (Present Plan)

These modes present a plan for user confirmation:

`Feature`, `Harden`, `Ship`, `Optimize`, `Architect`, `Design`, `Debug`,
`Game Build`, `XR Build`, `AI Build`, `Migrate`, `Custom`
