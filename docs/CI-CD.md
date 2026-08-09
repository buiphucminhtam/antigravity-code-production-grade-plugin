# Local CI/CD Control Plane

Forgewright is **local-first and hosting-provider neutral**. GitHub, GitLab, or another Git host may store the repository, but hosted runners are not part of the canonical PASS/FAIL contract.

## Canonical entrypoint

```bash
node scripts/ci/local-ci.mjs doctor
node scripts/ci/local-ci.mjs quick
node scripts/ci/local-ci.mjs security
node scripts/ci/local-ci.mjs compat
node scripts/ci/local-ci.mjs review
node scripts/ci/local-ci.mjs all
```

The launcher selects Python locally and the control plane resolves a supported Node LTS runtime. Set `FORGEWRIGHT_NODE_BIN`, `FORGEWRIGHT_NODE22_BIN`, or `FORGEWRIGHT_NODE24_BIN` when a machine needs explicit runtime paths.

## Coverage

| Mode | Local responsibility |
|---|---|
| `quick` | Product truth, adversarial rails, Lite overlays, kernel budget, diff sanity |
| `full` | Complete repository gates and skill contracts without requiring a clean working tree before the run |
| `security` | Root + standalone MCP production dependency audit and local-automation policy |
| `compat` | Node 22/24 MCP + CLI compatibility matrix |
| `review` | GitNexus blast radius, OpenAPI breaking-change detection, commit/security policy |
| `reindex` / `wiki` | Local GitNexus index and documentation checks; AI wiki generation is explicit opt-in |
| `deps` | Local dependency audit/update report; `--fix` applies package-manager security lock fixes |

Every run writes a receipt under `.forgewright/reports/local-ci/`; this is local evidence and is ignored by Git.

## Triggers

The repository pre-commit hook is only a thin adapter to `local-ci precommit`. Optional recurring checks use the operating system scheduler rather than a resident CI daemon:

```bash
npm run ci:schedule:install
npm run ci:schedule:uninstall
```

The scheduler supports launchd on macOS, systemd user timers on Linux, and Windows Task Scheduler on Windows.

## Hosted providers

Hosted CI is optional. If a project explicitly requests GitHub Actions, GitLab CI, CircleCI, Jenkins, or another service, generate only a thin adapter that invokes the canonical local command. Never duplicate build/test/security/release logic in provider YAML.
