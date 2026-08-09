---
id: critical-audit
title: Critical Self-Audit Protocol
summary: Core protocol for critical audit.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# Critical Self-Audit Protocol

<!-- source: skills/_shared/protocols/critical-audit.md -->
<!-- This is the single source of truth for the Critical Self-Audit protocol -->

> **Purpose:** Ensure every deliverable fully covers the user's requirements, with no contradictions between rules and examples, and no inconsistencies across entry points. This is the extended reference for `kernel/AUDIT.md`.
>
> **When:** After EXECUTE & VERIFY (step 6), before declaring success (step 7 in SOLVE loop).

---

## Why This Exists

| Problem | How AUDIT catches it |
|---------|---------------------|
| Header/rule updated but example left unchanged | Contradiction Scan: rule says X, example shows Y |
| 7 of 8 requirements addressed, 1 silently dropped | Coverage Matrix: every requirement gets a row |
| frontend-engineer says A, ui-designer says B | Cross-Entry Consistency: same concept compared across files |
| Tests pass but deliverable is incomplete | VERIFY proves *code works*; AUDIT proves *requirements are covered* |
| Diffs look clean but full-file context reveals gaps | Rule 1: re-read files in full, not diffs |

## Relationship to Other Protocols

| Protocol | What it proves | AUDIT adds |
|----------|---------------|------------|
| **kernel/VERIFY.md** | Code compiles, tests pass, behavior works | Requirements are covered, no contradictions |
| **self-check.md** | Process was followed (13 items) | Content is consistent and complete |
| **verification.md** | Assumptions are validated with evidence | Deliverable matches the request |
| **task-validator.md** | Contract boundaries respected | File contents are internally consistent |
| **evidence-first.md** | Assumptions grounded before acting | Post-delivery coverage check |

---

## The 5 Audit Heuristics

### 1. Re-read All Changed Files in Full
- **Not diffs.** An agent that reads the file next will see the whole thing.
- If a rule at line 20 contradicts an example at line 80, the diff won't show both.
- For files > 400 lines, read in sections but cover the entire file.

### 2. Build the Requirement Coverage Matrix
- Extract every numbered requirement or bullet from the user's original request.
- For each: identify which file(s) address it and what evidence proves coverage.
- Mark: ✅ Covered | ⚠️ Partially covered | ❌ Missing.

### 3. Contradiction Scan
- For each changed file, compare:
  - **Rules/instructions** (what the file tells agents to do)
  - **Examples/templates** (what the file shows agents as a worked example)
- If the example demonstrates a workflow that contradicts the rules → ❌ CONFLICT.
- Common failure: updating the rule header but leaving the old example intact.

### 4. Cross-Entry Consistency Check
- When multiple files serve the same role (e.g., `ui-designer/LITE.md` and `frontend-engineer/LITE.md` both handle UI features):
  - Pick the key concepts (e.g., "design contract required before code", "VERIFY template")
  - Compare what each file says about each concept
  - Flag misalignment.

### 5. Fix Before Delivery
- If the verdict is GAPS FOUND:
  1. Fix the gaps immediately.
  2. Re-run validation (tests, build, sync-kernel).
  3. Re-run the AUDIT (abbreviated: only re-check the fixed items).
- Do not report gaps and declare done. The audit is a **correction loop**.

---

## When to Scale Down

| Task type | Audit level |
|-----------|-------------|
| Single-file trivial edit (typo, version bump) | Inline sentence: "Re-read file. Requirement covered. No contradictions." |
| Single-file substantive edit | Coverage matrix, contradiction scan (skip cross-entry) |
| Multi-file edit | Full template: coverage + contradiction + cross-entry |
| Instruction/protocol/skill files | **Always full template** — these files instruct agents |

---

## Project Learning Loop

When AUDIT discovers a reusable gap, improve the **project’s future execution** without silently rewriting the framework:
1. Fix the current deliverable and re-run the failed evidence.
2. If the pattern has reuse value, record it in project-local `.forgewright/execution-lessons.md` (or the established project decision/lesson store):
   ```markdown
   ### [Date] — Audit Gap: [Brief Description]
   - **Problem / Context:** [What was missing or contradictory]
   - **Evidence / Root Cause:** [What proved why it happened]
   - **Correction:** [What worked]
   - **Applicability Boundary:** [When this lesson applies and when it does not]
   - **Verifier / Source:** [Command, test, or authoritative source]
   ```
3. On later similar work, retrieve and test the lesson against current workspace evidence before reuse; stale project lessons are hints, not authority.
4. Do **not** auto-promote a session lesson into shared `SKILL.md`. Shared-framework promotion is allowed only in an explicit Forgewright-development task (such as this repository’s own skill improvement) with regression tests, contradiction/cross-entry audit, and review.

---

## Template (Full)

```text
REQUIREMENT COVERAGE MATRIX:
| # | Requirement (from user request) | File(s) changed | Covered? | Evidence |
|---|------|------|------|------|
| 1 | ... | ... | ✅ / ⚠️ / ❌ | ... |

CONTRADICTION SCAN:
| File | Rule/instruction says | Example/template shows | Conflict? |
|---|---|---|---|
| ... | ... | ... | ✅ OK / ❌ CONFLICT |

CROSS-ENTRY CONSISTENCY: (if multiple files serve the same role)
| Concept | File A says | File B says | Aligned? |
|---|---|---|---|
| ... | ... | ... | ✅ / ❌ |

VERDICT: FULL COVERAGE | GAPS FOUND → fix before delivery
```

---

*Source: skills/_shared/protocols/critical-audit.md*
*Kernel compact version: kernel/AUDIT.md*
