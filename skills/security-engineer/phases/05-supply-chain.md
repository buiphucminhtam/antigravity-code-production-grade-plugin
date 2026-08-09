# Phase 5: Dependency & Supply Chain Security

## Objective

Audit every dependency in the project for known vulnerabilities, license risk, maintenance health, and supply chain integrity. Generate a Software Bill of Materials and evaluate the full dependency tree -- not just direct dependencies. security-engineer is the SOLE AUTHORITY on application-layer dependency security analysis. DevOps handles container image CVE scanning at the infrastructure layer; this phase covers library and package vulnerabilities. Generate all outputs in `.forgewright/security-engineer/supply-chain/`.

## Context Bridge

Read Phase 4 outputs from `.forgewright/security-engineer/data-security/`. Data security findings may reveal dependencies that handle encryption or PII processing -- these deserve elevated scrutiny in the supply chain audit. Also reference Phase 2 code audit A06 (Vulnerable and Outdated Components) for any dependency flags already raised.

## Inputs

- Phase 2 code audit -- `.forgewright/security-engineer/code-audit/` (A06 findings)
- Phase 4 data security -- `.forgewright/security-engineer/data-security/`
- Dependency manifests -- `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `requirements.txt`, `Pipfile.lock`, `poetry.lock`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`, `pom.xml`, `build.gradle`
- Lockfiles -- verify they exist and are committed to version control
- CI/CD configs -- canonical local automation under `scripts/ci/`; inspect hosted-provider files only when the project explicitly uses them
- Dockerfiles -- base image references and pinning strategy
- Frontend assets -- CDN-loaded scripts, SRI hash usage

## Workflow

### Step 1: Generate Software Bill of Materials (SBOM)

Produce a comprehensive SBOM covering all direct and transitive dependencies across every language/package manager in the project. Use CycloneDX format:

- Enumerate every package with name, version, and package URL (purl)
- Include license information for each component
- Include hash values where available from lockfiles
- Cover ALL ecosystems in the project (npm, pip, Go modules, Cargo, Maven, etc.)

If the project spans multiple languages, produce a unified SBOM combining all ecosystems.

### Step 2: Run Vulnerability Audit

For each ecosystem, analyze known vulnerabilities:

- **npm**: cross-reference with npm audit / GitHub Advisory Database
- **Python**: cross-reference with pip-audit / Safety DB / PyPI advisories
- **Go**: cross-reference with govulncheck / Go vulnerability database
- **Rust**: cross-reference with cargo-audit / RustSec Advisory Database
- **Java/Kotlin**: cross-reference with OWASP Dependency-Check / NVD

For each vulnerability found:

**Re-evaluate severity in context** -- do not blindly accept CVSS scores:
- Scanner says Critical, BUT the vulnerable function is never called in this codebase -- downgrade to Low with justification
- Scanner says Low, BUT the vulnerable function handles user input in an internet-facing endpoint -- upgrade to High with justification
- Document whether the vulnerable code path is actually reachable

For each dependency, also assess:
- **Maintenance status** -- last commit date, release frequency, number of maintainers
- **Typosquatting risk** -- is the package name similar to a popular package? Verify publisher identity
- **Transitive risk** -- vulnerabilities in dependencies of dependencies, supply chain depth

### Step 3: Audit License Compliance

Classify every dependency license by risk level:

| Risk | Licenses | Action |
|------|----------|--------|
| None | MIT, BSD-2, BSD-3, ISC, Apache-2.0 | No action required |
| Low | MPL-2.0 | File-level copyleft -- modifications to MPL files must be shared |
| Medium | LGPL-2.1, LGPL-3.0 | Dynamic linking OK, static linking may require source release |
| High | GPL-2.0, GPL-3.0, AGPL-3.0 | Full copyleft -- derivative works must use same license |
| Unknown | Unlicensed, custom license | Legal review required before use |

Flag:
- Copyleft licenses in a proprietary/commercial project
- Dependencies with no license declaration (legally cannot be used)
- License incompatibilities between dependencies
- Dependencies whose license changed between versions

### Step 4: Evaluate Pinning Strategy

Review dependency version management:

- Are versions pinned exactly (`1.2.3`) or using ranges (`^1.2.3`, `~1.2.3`)?
- Is there a lockfile for every package manager? Is it committed to version control?
- Are Docker base images pinned to digest (e.g., `node@sha256:abc...`), not just tag?
- Are third-party tools used by local automation pinned or lockfile-resolved reproducibly?
- Is there a local dependency audit/update command with deterministic lockfile review? Hosted bots such as Dependabot/Renovate are optional, never assumed.
- Is there a process for reviewing and merging dependency updates?

### Step 5: Audit CI/CD Pipeline Security

Review the build pipeline for supply chain attack vectors:

- Are build artifacts signed?
- Are third-party local CI tools/plugins reviewed before adoption? If a hosted adapter is explicitly enabled, review its actions/plugins separately.
- Are build environment secrets scoped to minimum required access?
- Is there build reproducibility (same source produces same artifact)?
- Are artifact registries (npm, Docker, Maven) using authentication and access control?
- Is there SLSA provenance generation?

### Step 6: Check Frontend Supply Chain

For frontend/client-side code:
- Are CDN-loaded scripts protected with Subresource Integrity (SRI) hashes?
- Are third-party scripts loaded from trusted sources?
- Is there a Content Security Policy restricting script sources?
- Are frontend dependencies audited with the same rigor as backend?

## Output Deliverables

Write all outputs to `.forgewright/security-engineer/supply-chain/`:

| File | Contents |
|------|----------|
| `sbom.json` | CycloneDX SBOM with all direct and transitive dependencies |
| `dependency-audit.md` | Vulnerability findings with contextual severity re-evaluation |
| `license-compliance.md` | License inventory with risk classification and flagged issues |

## Validation

Before proceeding to Phase 6, verify:
- [ ] SBOM covers all ecosystems in the project (not just the primary language)
- [ ] Every vulnerability has contextual severity assessment (not just raw CVSS)
- [ ] License compliance covers all direct dependencies
- [ ] Pinning strategy is documented with specific recommendations
- [ ] CI/CD pipeline has been reviewed for supply chain attack vectors

## Quality Bar

A supply chain audit that runs `npm audit` and copies the output is not an audit. Every vulnerability must be evaluated in the context of THIS project: is the vulnerable code path reachable? Is the input user-controlled? A Critical CVE in a test-only dependency is not the same as a Critical CVE in a request-handling library. Re-evaluate, justify, and prioritize accordingly.
