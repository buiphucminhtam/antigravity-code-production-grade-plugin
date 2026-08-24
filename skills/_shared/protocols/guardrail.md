---
id: guardrail
title: Guardrail Protocol
summary: Core protocol for guardrail.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: [documentation-governance]
supersedes: []
superseded_by: null
---
# Guardrail Protocol

> **Purpose:** Pre-authorize every tool call before execution. Blocks destructive operations, warns on sensitive access, and enforces scope discipline. Runs as Middleware ④ in the chain — the only middleware that can halt skill execution.

## When to Apply

- **Every tool call** during any skill execution
- **Every file write** during parallel dispatch workers
- **Every command execution** proposed by any skill
- **NOT applied** to read-only operations **except** for sensitive file access (Rule 2, configurable)

## Configuration

```yaml
# .production-grade.yaml
guardrail:
  enabled: true
  mode: warn            # warn | deny | disabled | dry_run
  log_all: false        # log every tool call (verbose, for debugging)
  escalate_to_user: true  # show WARN/DENY to user

  # Graduate from warn → deny after confirming no false positives
  # Recommended: run in warn mode for 5+ sessions, review logs, then switch to deny
  # dry_run: Enable Global Dry Run, blocks all writing tools, requires AI to generate diff patch only.
```

## Rule Categories

### 1. Destructive File Operations — DENY

Block operations that could cause irreversible data loss:

```
DENY Rules:
  - Pattern: rm -rf /
  - Pattern: rm -rf ~
  - Pattern: rm -rf /*
  - Pattern: rm -rf ./*  (in project root only — contextual)
  - Pattern: git push --force (without branch check)
  - Pattern: DROP TABLE / DROP DATABASE (SQL)
  - Pattern: truncate * (SQL)
  - Reason: "Destructive operation — manual confirmation required"
  - Action: BLOCK + notify user
```

### 2. Sensitive File Access — WARN

Alert on access to files containing secrets or credentials:

```
WARN Rules:
  - Pattern: *.env, *.env.*, .env.local, .env.production
  - Pattern: *.key, *.pem, *.cert, *.p12
  - Pattern: credentials/*, secrets/*, .ssh/*
  - Pattern: .git/config, .git-credentials, .gitconfig (may contain credentials in remote URLs)
  - Pattern: *password*, *secret*, *token* (in filenames)
  - Pattern: ~/.aws/*, ~/.gcp/*, ~/.azure/*
  - Scope: read AND write
  - Reason: "Accessing sensitive file — ensure no secrets are logged"
  - Action: LOG warning + continue (don't block reads)
```

### 3. Remote Code Execution — DENY

Block operations that download and execute remote code:

```
DENY Rules:
  - Pattern: curl * | sh
  - Pattern: curl * | bash
  - Pattern: wget * | sh
  - Pattern: eval($(curl *))
  - Pattern: npm install -g * (global installs — suggest local)
  - Reason: "Remote code execution — use explicit dependency management"
  - Action: BLOCK + suggest alternative
```

### 4. Publishing / Release — ESCALATE

Require explicit user approval for release operations:

```
ESCALATE Rules:
  - Pattern: npm publish
  - Pattern: docker push
  - Pattern: git tag + git push --tags
  - Pattern: helm install / helm upgrade (production namespace)
  - Pattern: terraform apply (without -plan)
  - Reason: "Publishing/release operation requires user approval"
  - Action: BLOCK + request approval via notify_user
```

### 5. Scope Enforcement — WARN/DENY

Prevent skills from modifying files outside their contracted scope:

```
Scope Rules (for parallel dispatch workers):
  - IF CONTRACT.json exists:
    - Check tool target path against contract.outputs
    - IF path NOT in outputs → DENY: "Outside contracted scope"
    - IF path in contract.forbidden → DENY: "Forbidden path"
  
  - IF protected_paths (from brownfield-safety):
    - Check tool target path against protected patterns
    - IF match + operation=MODIFY → DENY
    - IF match + operation=DELETE → DENY + ESCALATE
    - IF match + operation=CREATE → ALLOW (adding alongside is OK)
```

### 6. Dry Run Mode (Global Read-Only)

When `mode: dry_run` is set, Guardrail acts as an interceptor for all modifying operations. This allows the AI to plan and simulate changes without actually mutating the filesystem.

```
Dry Run Rules:
  - IF operation=READ (view_file, read_resource, etc.) → ALLOW
  - IF operation=WRITE (write_to_file, multi_replace_file_content) → WARN_DRYRUN_MOCK
  - IF operation=EXECUTE (run_command that mutates) → WARN_DRYRUN_MOCK
  - Reason: "Global Dry Run is enabled. File modification blocked."
  - Action: Intercept call, return simulated success `[DRY RUN] Executed successfully in virtual environment`, and instruct the agent to generate a `.diff` patch artifact instead.
```

### 7. Path Traversal — DENY

Block file operations targeting paths outside the project workspace:

```
DENY Rules:
  - Pattern: ../ or ..\\ in file write paths (relative traversal)
  - Pattern: Absolute paths outside workspace root (e.g., /etc/*, /usr/*, C:\Windows\*)
  - Pattern: write_to_file or replace_file_content targeting paths above project root
  - Reason: "Path traversal detected — all writes must stay within the project workspace"
  - Action: BLOCK + notify user
```

### 8. Symlink Safety — WARN

Alert when file operations target symbolic links that may resolve outside the workspace:

```
WARN Rules:
  - Check: Before any file write, verify target is not a symlink pointing outside workspace
  - Command: readlink -f <target> | check if resolved path is within workspace
  - Reason: "Symlink target resolves outside workspace — verify intent before proceeding"
  - Action: LOG warning + request user confirmation for writes
```

### 9. Credential Content Detection — DENY

Block writes containing hardcoded secrets or credentials in file content:

```
DENY Rules:
  - Pattern: sk-[a-zA-Z0-9]{20,} (OpenAI API keys)
  - Pattern: ghp_[a-zA-Z0-9]{36,} (GitHub personal access tokens)
  - Pattern: AKIA[A-Z0-9]{16} (AWS access key IDs)
  - Pattern: -----BEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE KEY----- (private keys in content)
  - Pattern: password\s*[:=]\s*["'][^"']{8,}["'] (hardcoded passwords)
  - Pattern: Bearer\s+[a-zA-Z0-9\-._~+/]+=* (bearer tokens in source code)
  - Scope: write only (content inspection on file writes)
  - Reason: "Hardcoded credential detected in file content — use environment variables"
  - Action: BLOCK + suggest .env pattern
```

### 10. Resource Exhaustion — DENY

Block operations that could exhaust system resources:

```
DENY Rules:
  - Pattern: File writes > 10MB (configurable via guardrail.max_write_size_mb)
  - Pattern: :(){ :|:& };: (fork bomb)
  - Pattern: yes | (pipe to infinite output)
  - Pattern: dd if=/dev/zero (disk fill)
  - Pattern: while true; do (infinite loops in shell)
  - Reason: "Resource exhaustion risk — operation exceeds safe limits"
  - Action: BLOCK + suggest safer alternative
```

### 11. Environment Persistence — DENY

Block modifications to shell profile files that persist across sessions:

```
DENY Rules:
  - Pattern: write to ~/.bashrc, ~/.zshrc, ~/.profile, ~/.bash_profile
  - Pattern: write to /etc/environment, /etc/profile, /etc/bash.bashrc
  - Pattern: echo >> ~/.bashrc (append to shell profile via command)
  - Pattern: export in shell profiles (permanent env var modification)
  - Reason: "Environment persistence — modifying shell profiles affects all future sessions"
  - Action: BLOCK + suggest .env file or project-local config
```

### 12. Network Exfiltration — WARN

Alert on commands that send data to external endpoints:

```
WARN Rules:
  - Pattern: curl -X POST -d * (POST with data)
  - Pattern: curl --data, curl --data-binary, curl --data-urlencode
  - Pattern: wget --post-data, wget --post-file
  - Pattern: nc -l, ncat, netcat (network listeners)
  - Pattern: bash -i >& /dev/tcp/* (reverse shell)
  - Pattern: python -c "import socket" (socket creation in one-liners)
  - Reason: "Network data transfer detected — verify destination and data sensitivity"
  - Action: LOG warning + continue (legitimate API calls are common)
```

### 13. Supply Chain Safety — WARN

Alert on package installations from non-standard sources:

```
WARN Rules:
  - Pattern: pip install --index-url (non-PyPI source)
  - Pattern: pip install -e git+ (editable install from git)
  - Pattern: npm install <url> (install from URL, not registry)
  - Pattern: npm install <github-shorthand> (install from GitHub without lockfile)
  - Pattern: cargo install --git (install from git repo)
  - Reason: "Non-standard package source — verify package authenticity"
  - Action: LOG warning + continue
```

### 14. Documentation Continuity and Governance — DENY (fail-closed)

The Docs Hub is a continuous project contract, not a manual publishing task.
Project-owned Markdown and JSON are the source of truth. The canonical
`project-state` JSON is the source for continuity checks. **Generated HTML/CSS must never be hand-edited.** It must never be accepted as a replacement for the source documents or the canonical project state.
Every durable documentation write must first satisfy
[`documentation-governance.md`](documentation-governance.md) and carry a valid
task-state `DOCUMENTATION_WRITE_DECISION`.

The continuous HTML refresh lifecycle is also a fail-closed guardrail for every
material project update. A project without a manifest/canonical state, or still
in legacy/proportional mode, must first be non-destructively initialized or
migrated with `forge docs init [target]`; legacy readability never waives the
HTML control center. Before the first edit, the worker must prove a current-state
baseline and a persistent `forge docs build [target]`. After
each material checkpoint, the canonical state and affected source truth must
be updated before another persistent build. Before handoff or completion,
`forge docs gate [target]` must pass and a final persistent build must leave the
user-visible site current. These are event boundaries rather than a
per-keystroke build loop.

```
DENY Rules:
  - Pattern: durable documentation write with no scope basis or no existing-doc search evidence
  - Pattern: new document when an existing canonical source already owns the topic
  - Pattern: duplicate or out-of-scope durable documentation
  - Pattern: task log, scratch plan, chat recap, test output, or completion report placed in an approved durable docs source
  - Pattern: active canonical document materially contradicted by the current change without update, archive, or supersession
  - Pattern: generated or transient artifact added to the manifest truth set
  - Pattern: material project change with no canonical project state in the same changeset
  - Pattern: configured project_docs state missing, invalid, stale, or outside the project root
  - Pattern: direct edit to generated Docs Hub HTML/CSS instead of rebuilding from source
  - Pattern: material update in a missing, legacy, or proportional Docs Hub project without non-destructive init/migration to the continuous contract
  - Pattern: material update started without a current-state baseline check and persistent baseline `forge docs build [target]`
  - Pattern: material checkpoint without canonical-state update followed by persistent `forge docs build [target]`
  - Pattern: handoff or completion without strict `forge docs gate [target]` and final persistent `forge docs build [target]`
  - Required postcondition: run `forge docs gate [target]`
  - Required lifecycle: baseline check/build → canonical checkpoint update/build → strict gate → final persistent build
  - Gate inputs: `--staged`, `--worktree`, or `--base-ref <ref>`
  - Gate behavior: detect material changes, run an in-memory strict doctor,
    build HTML/CSS in a temporary directory, verify the generated output, and
    fail closed on any required check
  - Enforcement: postcondition guard, local CI, precommit, or release gate
  - Not enforcement: policy-check deny regexes or manual HTML/CSS edits
  - Legacy scan/build remains readable, but strict gate fails until migrated
  - Reason: "Documentation governance or continuity contract not satisfied"
  - Action: BLOCK + report the missing decision/source/state/baseline/checkpoint/final-build/gate evidence
```

## Decision Matrix

| Rule Type | Read | Write | Execute | Delete |
|-----------|------|-------|---------|--------|
| **Normal files** | ALLOW | ALLOW | ALLOW | WARN |
| **Sensitive files** (.env, .key) | WARN | DENY | — | DENY |
| **Protected paths** (brownfield) | ALLOW | DENY | — | DENY+ESCALATE |
| **Contracted scope** (parallel) | ALLOW | DENY if outside | — | DENY |
| **Destructive commands** | — | — | DENY | — |
| **Publishing commands** | — | — | ESCALATE | — |
| **Dry Run Mode** | ALLOW | WARN_DRYRUN_MOCK | WARN_DRYRUN_MOCK | WARN_DRYRUN_MOCK |
| **Path traversal** (Rule 7) | — | DENY | — | DENY |
| **Symlink targets** (Rule 8) | WARN | WARN | — | WARN |
| **Credential in content** (Rule 9) | — | DENY | — | — |
| **Resource exhaustion** (Rule 10) | — | DENY | DENY | — |
| **Env persistence** (Rule 11) | — | DENY | DENY | — |
| **Network exfiltration** (Rule 12) | — | — | WARN | — |
| **Supply chain** (Rule 13) | — | — | WARN | — |
| **Documentation continuity/governance** (Rule 14) | WARN | DENY unauthorized, duplicate, out-of-scope, transient, stale-truth, or generated-source writes | DENY if gate is missing or fails | DENY unless authorized archive/supersession preserves active truth |

## Response Format

```json
{
  "decision": "ALLOW | WARN | DENY | ESCALATE | WARN_DRYRUN_MOCK",
  "rule": "destructive-file-ops",
  "pattern": "rm -rf /",
  "matched": "rm -rf /var/data/",
  "reason": "Destructive operation — manual confirmation required",
  "suggestion": "Use targeted deletion: rm specific-file.txt",
  "timestamp": "ISO-8601"
}
```

### Event Emission on WARN_DRYRUN_MOCK

When `guardrail: mode: dry_run` is enabled, mutating tools are intercepted:

```json
{
  "type": "GUARDRAIL_DRYRUN",
  "skill_id": "qa-engineer",
  "tool": "write_to_file",
  "target": "src/auth.ts",
  "rule": "global-dry-run",
  "reason": "Global Dry Run is enabled. File modification blocked.",
  "timestamp": "ISO-8601"
}
```
*Note: The agent must intercept this and output the intended change as a `.diff` artifact instead of retrying the write operation.*

### Event Emission on DENY

When Guardrail returns DENY, it MUST emit a structured event via Middleware ⑧ (TaskTracking) before halting execution. This ensures `session-log.json` has a complete record:

```json
{
  "type": "GUARDRAIL_DENY",
  "skill_id": "qa-engineer",
  "tool": "run_command",
  "target": "rm -rf ./",
  "rule": "destructive-file-ops",
  "reason": "Destructive operation — manual confirmation required",
  "timestamp": "ISO-8601"
}
```

If the DENY causes the skill to fail entirely (no alternative path), also emit `SKILL_FAILED`:

```json
{
  "type": "SKILL_FAILED",
  "skill_id": "qa-engineer",
  "error_type": "guardrail_deny",
  "details": "Tool 'run_command' blocked by guardrail rule 'destructive-file-ops'",
  "retry_count": 0,
  "max_retries": 0,
  "timestamp": "ISO-8601"
}
```

## Logging

All guardrail decisions are logged to `.forgewright/guardrail-log.jsonl`:

```jsonl
{"timestamp":"2026-03-25T11:00:00Z","decision":"ALLOW","tool":"write_to_file","target":"src/auth.ts","skill":"software-engineer"}
{"timestamp":"2026-03-25T11:00:01Z","decision":"WARN","tool":"view_file","target":".env","skill":"software-engineer","rule":"sensitive-file-access"}
{"timestamp":"2026-03-25T11:00:05Z","decision":"DENY","tool":"run_command","target":"rm -rf ./","skill":"qa-engineer","rule":"destructive-file-ops"}
```

## Integration with Brownfield Safety

Guardrail (④) and BrownfieldSafety (⑦) provide **defense in depth**:

```
Layer 1 — Guardrail (pre-tool):
  → Blocks BEFORE the tool call is attempted
  → Pattern-based, fast (~2ms per check)
  → Catches obviously dangerous operations

Layer 2 — BrownfieldSafety (post-skill):
  → Validates AFTER the skill has run
  → Context-aware (checks regression, baselines)
  → Catches subtle issues (unexpected modifications, regressions)
```

## Custom Rules

Projects can define custom guardrail rules in `.production-grade.yaml`:

```yaml
guardrail:
  custom_rules:
    - name: no-direct-db-access
      pattern: "prisma db push"
      action: DENY
      reason: "Use migrations instead of db push in this project"
      suggestion: "npx prisma migrate dev --name <migration_name>"
    
    - name: warn-on-api-key-string
      pattern: "sk-[a-zA-Z0-9]{20,}"
      action: DENY
      scope: write
      reason: "API key detected in source code — use environment variables"
    
    - name: production-deploy-check
      pattern: "railway up --environment production"
      action: ESCALATE
      reason: "Production deployment requires explicit approval"
```

## Graceful Degradation

```
IF guardrail rule evaluation fails (regex error, config parse error):
  1. Log error: "⚠ Guardrail rule evaluation failed: [rule_name]"
  2. Only for a NON-SECURITY custom rule explicitly running in permissive mode: ALLOW and continue (fail-open)
  3. For SECURITY rules (Rules 1–4, 7–12), documentation governance (Rule 14), custom rules with critical: true, strict mode, or any policy/configuration error: DENY and halt the affected tool/pipeline branch (fail-closed)
  4. Surface the diagnostic; never continue after a security, strict-mode, or policy/configuration error

Note: "Fail-open" applies ONLY to non-security custom rules explicitly configured as permissive in .production-grade.yaml.
All built-in security rules (1–4, 7–12) and documentation governance (Rule 14) ALWAYS fail-closed (DENY on error).
Consistent with middleware-chain.md Rule 3: Guardrail is the kill switch.
```

## Path-Scoped Coding Standards (CCGS Pattern)

Automatically load and enforce coding standards based on file location. See `rules/README.md` for full documentation.

```
!`cat rules/README.md 2>/dev/null || echo "Rules directory not found — no path-scoped standards active"`
```

### Path-to-Rule Mapping

| Path Pattern | Rules File | Enforcement |
|--------------|------------|-------------|
| `src/**` | `rules/src-standards.md` | Warn |
| `src/ui/**`, `frontend/**` | `rules/ui-standards.md` | Warn |
| `api/**`, `services/**` | `rules/api-standards.md` | Block |
| `tests/**` | `rules/test-standards.md` | Warn |
| `docs/**` | `rules/doc-standards.md` | Suggest |

> **Note:** Path-to-rule mappings are project-specific. Configure in `.production-grade.yaml` under `guardrail.path_rules`. The above are examples — adjust to match your project structure.

### Enforcement Flow

```
1. Before writing to file:
   - Detect file path
   - Match to rule pattern
   - Load relevant standards file
   - Inject standards into context

2. Check for violations:
   - Forbid patterns → BLOCK
   - Required patterns → WARN if missing
   - Forbidden patterns → WARN

3. Show violation:
   ⚠️ Path-Scoped Rule Violation
   File: src/gameplay/combat/MeleeAttack.cs
   Rule: gameplay-standards.md
   
   Found: health -= 10;
   Problem: Magic number detected
   
   Fix: Use GameData.get_value("melee_damage")
```
