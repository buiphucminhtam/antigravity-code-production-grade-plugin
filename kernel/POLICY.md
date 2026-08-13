# POLICY — Execution Policy

Runtime guardrail configuration for tool execution. The policy lives in
`.forgewright/execution-policy.yaml` and is enforced by
`scripts/lite/policy-check.sh`, called from guard middleware ④
(`skills/_shared/protocols/guardrail.md`) before a tool call runs.

## Keys

| Key | Default | Meaning |
|---|---|---|
| `mode` | `strict` | `strict` = deny blocks (exit 1) · `permissive` = warn but allow (exit 2) · `audit` = log to telemetry only (exit 0) |
| `require_verify` | `true` | Code-change completion requires exact-turn schema-v2 evidence and strict response correlation ([VERIFY.md](VERIFY.md)) |
| `max_escalations` | `3` | Max `escalate.sh` calls per user turn before pausing for approval ([ESCALATE.md](ESCALATE.md)) |
| `deny_patterns` | see file | Case-insensitive POSIX ERE list matched against `"<tool_name> <args>"` |
| `refresh_interval_ticks` | `10` | Guard re-reads the policy file every N tool calls (hot-reload) |

## Gate protocol

1. Before executing a tool, guard runs
   `bash scripts/lite/policy-check.sh check <tool_name> "<args>"`.
2. Exit `0` → proceed. Exit `2` → proceed, but tag the step **HARD**
   ([ESCALATE.md](ESCALATE.md)). Exit `1` → the tool call is blocked;
   report the matched pattern to the user instead of retrying.
3. Every match emits a `policy.deny` / `policy.warn` / `policy.audit`
   telemetry event via `scripts/lite/telemetry.sh` (best-effort).
4. If the policy file is missing, unreadable, empty, or malformed, the gate
   blocks execution (fail-closed) and reports a policy configuration error.
   Unknown `mode` values also fail closed (treated as `strict`).
5. Orchestrators read scalars with `policy-check.sh get <key>`
   (e.g. escalation budget, verify requirement).

## Editing rules

- Scalars must stay one-per-line with no spaces in the value.
- Deny patterns must stay in the `  - "pattern"` form: ERE, no double
  quotes inside the pattern, no inline comments on pattern lines.
- Loosening the policy (`strict` → `permissive`/`audit`, or removing a
  deny pattern) is itself a security-sensitive change: Hard Rule 6 and
  the HARD checklist in [ESCALATE.md](ESCALATE.md) apply.
