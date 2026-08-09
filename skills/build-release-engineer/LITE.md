---
name: build-release-engineer
description: "Orchestrates local-first compilation, tests, packaging, dependency audits, release evidence, and rollout scripts. Hosted CI is an optional adapter, never the canonical gate."
version: 1.1.0
---

# Build Release Engineer (LITE)

## SOLVE Step 2: GROUND
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project profile exists | `cat .forgewright/project-profile.json` | ... | capture the current stack/runtime |
| Canonical local automation exists | `ls -la scripts/ci/` | ... | capture the local CI/release entrypoints |
| Build commands are declared | inspect package/build manifests | ... | capture exact build/test/package commands |

## SOLVE Step 3: DECOMPOSE
1. AUDIT | manifests + lockfiles | zero unresolved high/critical production CVEs.
2. COMPILE | local build command | deterministic successful build.
3. COMPAT | supported runtimes/platforms | execute compatibility matrix locally when material.
4. PACKAGE | release artifact | reproducible content, size/hash recorded.
5. RELEASE | local release script + approval boundary | deployment is blocked on failed local evidence.

## Default Commands
```bash
node scripts/ci/local-ci.mjs security
node scripts/ci/local-ci.mjs compat
node scripts/ci/local-ci.mjs all
```

Hosted build runners may call these commands, but must not replace them with provider-specific logic.

## Common Mistakes Checklist
- Lockfile and manifest drift between workspace and standalone/runtime packages.
- Publishing an artifact from a different dependency tree than the one verified locally.
- Treating dependency bots as the vulnerability gate instead of running the package-manager audit locally.
- Long-lived publish credentials when short-lived/local credential injection is available.
- Release scripts that swallow build/push/deploy failures.
