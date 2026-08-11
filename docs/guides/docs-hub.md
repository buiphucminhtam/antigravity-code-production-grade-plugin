# Forgewright Docs Hub

The Docs Hub inventories approved documentation from one or more projects,
normalizes links and metadata, and generates a static HTML/CSS portal. Source
documents stay in their projects; generated catalogs, pages, search indexes,
and optional Obsidian exports are disposable outputs.

## Safety model

- Collection is **allowlist-only**.
- Every source and symlink is resolved inside its canonical project root.
- Credential, secret, worktree, dependency, Git, and private Forgewright
  runtime paths are denied before file content is read.
- Markdown HTML is escaped rather than executed.
- Generated output is never treated as a source document.
- Obsidian export is rejected when its destination overlaps a project root.

## Quickstart

Build one project:

```bash
forge docs init .
forge docs scan .
forge docs build .
forge docs doctor . --strict
```

Register and build several projects:

```bash
forge docs registry add /path/to/project-a
forge docs registry add /path/to/project-b
forge docs registry list
forge docs build --all
```

The default registry is:

```text
$FORGEWRIGHT_HOME/docs-hub/projects.json
```

When `FORGEWRIGHT_HOME` is unset, it falls back to:

```text
~/.forgewright/docs-hub/projects.json
```

## Manifest

`forge docs init` creates `.forgewright/docs-manifest.json` without
overwriting an existing manifest unless `--force` is supplied.

```json
{
  "schema_version": 1,
  "project": {
    "id": "example-project",
    "title": "Example Project"
  },
  "sources": [
    {
      "path": "docs",
      "type": "documentation",
      "include": ["**/*.md", "**/*.png"]
    },
    {
      "path": "README.md",
      "type": "overview"
    }
  ],
  "truth": ["README.md"],
  "adapters": {
    "git": true,
    "gitnexus": true,
    "evidence_summary": false
  },
  "privacy": {
    "mode": "allowlist",
    "allow": ["docs", "README.md"],
    "exclude": ["docs/private/**"]
  }
}
```

Legacy projects without a manifest use bounded discovery for `Docs/`, `docs/`,
`documentation/`, `wiki/`, root README files, and curated project profile
metadata. The CLI reports this fallback and does not write a manifest unless
`forge docs init` is run.

## Commands

| Command | Purpose |
|---|---|
| `forge docs init [target]` | Create or validate the project manifest |
| `forge docs registry add <path>` | Register a canonical project root |
| `forge docs registry list` | List configured projects |
| `forge docs registry remove <id-or-path>` | Remove one registry entry |
| `forge docs scan [target]` | Produce the normalized project catalog |
| `forge docs build [target]` | Build a static portal for one project |
| `forge docs build --all` | Build all registered projects |
| `forge docs doctor [target]` | Report links, anchors, diagrams, privacy, case, and staleness issues |
| `forge docs export obsidian [target]` | Copy approved source documents to an external vault |

Use the root `--json` flag for a stable agent-readable envelope.

## Generated outputs

Single-project defaults:

```text
<project>/.forgewright/cache/docs-index.json
<project>/.forgewright/docs-hub/site/
```

Multi-project defaults:

```text
$FORGEWRIGHT_HOME/docs-hub/site/
$FORGEWRIGHT_HOME/docs-hub/obsidian/
```

The portal includes:

- global and project dashboards;
- semantic document pages with breadcrumbs and heading outlines;
- backlinks, related documents, and traceability relations;
- offline project-aware search;
- accessible SVG diagram previews with source-text fallback;
- Git and GitNexus availability/staleness state;
- diagnostics, print styles, light/dark tokens, keyboard focus, and reduced
  motion support.

Core content and navigation remain readable with JavaScript disabled. The
small local script only progressively enhances search.

## Doctor and local CI

Run a strict project diagnosis:

```bash
forge docs doctor . --strict
```

Run the repository-owned documentation gate:

```bash
npm run ci:docs
```

Strict mode fails on warnings as well as errors. Normal mode fails only on
errors.

## Cross-project links

Use a stable project ID and project-relative source path:

```markdown
[Shared architecture](forgewright://platform-core/docs/architecture.md#runtime)
```

The target project must be included in the same multi-project build. Missing
projects degrade to an explicit diagnostic rather than a fabricated link.

## Obsidian compatibility

Obsidian is an optional export, not the canonical store:

```bash
forge docs export obsidian --all
```

Exports contain copies of approved sources and generated navigation files. The
exporter never writes into source docs and does not create source symlinks.
The older `scripts/forgewright-wiki-sync*.sh` commands are retained only as
legacy compatibility paths.
