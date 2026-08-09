---
name: devops
description: "Orchestrates local-first CI/CD automation, testing gates, containers, deployment scripts, package publishing, and infrastructure monitoring. Hosted CI providers are optional adapters only when explicitly requested."
version: 1.1.0
---

# DevOps (LITE)

## Local-First Invariant
The project-owned automation under `scripts/ci/` is the source of truth. GitHub Actions, GitLab CI, CircleCI, Jenkins, or other hosted runners may mirror local commands only when the user explicitly requests that provider. Never make merge/release correctness depend on a hosted provider when the same gate can run locally.

## SOLVE Step 2: GROUND
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project stack/profile is known | `cat .forgewright/project-profile.json` | ... | capture the current project profile |
| Canonical automation is discoverable | `find scripts/ci/ -maxdepth 2 -type f` | ... | capture the local scripts and entrypoints |
| Container/deploy surface is known | `find . -maxdepth 3 \( -name 'Dockerfile*' -o -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' \)` | ... | capture the existing deployment artifacts |

## SOLVE Step 3: DECOMPOSE
1. AUDIT | Existing local gates, build/deploy scripts, environment boundaries | no plaintext credentials; no hidden hosted-only requirement.
2. CONSTRUCT | Provider-neutral scripts under `scripts/ci/` and `scripts/` | commands run directly from a developer machine/agent host.
3. VERIFY | Run local gates and failure paths | deterministic exit codes and local receipts/logs.
4. ADAPT | Hosted provider adapter only if explicitly requested | adapter calls the same local command; no duplicated business logic.

## Default Local Pipeline
```bash
node scripts/ci/local-ci.mjs quick
node scripts/ci/local-ci.mjs security
node scripts/ci/local-ci.mjs compat
node scripts/ci/local-ci.mjs review
node scripts/ci/local-ci.mjs all
```

Use local git hooks for commit-time gates and OS-native schedulers (`launchd`, systemd user timers, Windows Task Scheduler) for periodic checks. Do not install a permanent CI daemon merely to emulate a hosted runner.

## Common Mistakes Checklist
- Duplicating quality logic into provider YAML instead of calling one local entrypoint.
- Hardcoding tokens/passwords in automation; inject secrets only at the command boundary.
- Running unbounded parallel test/install jobs that leak processes or exhaust developer machines.
- Pulling mutable `latest` images/tool versions on release-critical paths.
- Treating a remote green badge as stronger evidence than the deterministic local command and its observed output.

## Runtime Lifecycle
Start long-running services with `bash scripts/runtime/dev-run.sh --role <role> -- <command>` so leases/reuse/cleanup remain observable. See ADR-010.
