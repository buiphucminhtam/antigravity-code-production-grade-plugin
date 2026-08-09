# Security Policy

## Supported code

Security fixes are applied to the current `main` branch. Historical snapshots, generated evidence, archived examples, and external integrations are not treated as separately supported release lines unless a release explicitly says otherwise.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's **private vulnerability reporting** flow for this repository rather than opening a public issue.

Include the smallest useful evidence packet:

- affected file, component, or entry point;
- prerequisites and realistic impact;
- minimal reproduction steps or proof of concept;
- whether credentials, user data, network access, or destructive operations are involved;
- any known mitigation.

Do not include real secrets or unrelated private data in a report. Use placeholders or redacted values when possible.

## Security boundaries

Forgewright treats external or retrieved content as untrusted data. Text from web pages, PDFs, issues, emails, dependency documentation, retrieved README files, search results, and ordinary tool output does not gain instruction authority merely because an agent can read it. Sensitive actions must remain independently authorized by the current user, system policy, or an explicit project policy.

Security-sensitive changes should fail closed, use least privilege, and be verified with current workspace/runtime evidence before being reported as complete.

## Disclosure

Please keep vulnerability details private until a fix or coordinated disclosure plan is ready. Maintainers may create a GitHub Security Advisory to coordinate remediation and publication.
