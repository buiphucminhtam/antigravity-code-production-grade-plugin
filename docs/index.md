# Forgewright Documentation

> **Central documentation index for Forgewright**

Welcome to Forgewright — an adaptive orchestrator with 84 AI skills covering the full software development lifecycle.

## Quick Navigation

| Getting Started | Core Concepts | Reference |
|-----------------|---------------|-----------|
| [Quickstart Guide](quickstart.md) | [Mode Reference](mode-reference.md) | [Skill Catalog](skill-catalog.md) |
| [Setup Guide](SETUP.md) | [Pipeline Reference](pipeline-reference.md) | [Protocol Reference](protocol-reference.md) |

## By Category

### Getting Started
- **[Quickstart Guide](quickstart.md)** — Get up and running with Forgewright in 5 minutes
- **[Setup Guide](SETUP.md)** — Detailed installation instructions
- **[Configuration Guide](SETUP-REFERENCE.md)** — Configure Forgewright for your project
- **[CLI Init/Onboard Golden Path](guides/forge-init-onboard.md)** — Deterministic project initialization and profiling workflow
- **[Docs Hub](guides/docs-hub.md)** — Build a privacy-safe multi-project HTML/CSS documentation portal

### Core Concepts
- **[Mode Reference](mode-reference.md)** — 24 execution modes explained
- **[Skill Catalog](skill-catalog.md)** — All skills with descriptions and use cases
- **[Pipeline Reference](pipeline-reference.md)** — INTERPRET → DEFINE → BUILD → HARDEN → SHIP → SUSTAIN
- **[Protocol Reference](protocol-reference.md)** — 40+ shared protocols indexed

### Architecture
- **[Architecture Overview](architecture.md)** — System design and component interactions
- **[ADR-011: Central Docs Hub](adr/ADR-011-central-docs-hub.md)** — Local-first documentation architecture and safety boundaries

### Migration & Troubleshooting
- **[Migration Guide](migration/v8-to-v9.md)** — Upgrade from v8 to v9 `[Planned]`
- **[Breaking Changes](migration/breaking-changes.md)** — What's changed in v9 `[Planned]`
- **[Common Issues](troubleshooting/common-issues.md)** — Solutions to frequent problems

## What's New

| Feature | Description |
|---------|-------------|
| **Skill Health Check** | `bash scripts/skill-health.sh check` — validates all 84 canonical skills |
| **Dependency Graph** | `bash scripts/dep-graph.sh` — detects cycles, generates DOT/Mermaid exports |
| **Skill Versioning** | `bash scripts/skill-rollback.sh` — rollback skills to previous versions |
| **Session Tracker** | `bash scripts/forgewright-session-tracker.sh` — tracks consecutive plan failures |

## By Role

### For Developers
1. Read the [Quickstart Guide](quickstart.md)
2. Understand [Modes](mode-reference.md)
3. Browse [Skill Catalog](skill-catalog.md)

### For Architects
1. Study the [Architecture Overview](architecture.md)
2. Review [Protocol Reference](protocol-reference.md)
3. Understand [Pipeline Reference](pipeline-reference.md)

### For DevOps
1. Read the [Setup Guide](SETUP.md)
2. Configure via [Setup Reference](SETUP-REFERENCE.md)

## Search

To search the documentation:

```bash
# Search all docs
grep -r "keyword" docs/

# Search with context
grep -rn "pattern" docs/ --include="*.md"
```

## Contributing to Docs

See the [Technical Writer skill](../skills/technical-writer/SKILL.md) for documentation standards and contribution guidelines.

## Version

Current version: **8.7.0**
Last updated: 2026-07-09

---

*For questions or feedback, open an issue on GitHub.*
