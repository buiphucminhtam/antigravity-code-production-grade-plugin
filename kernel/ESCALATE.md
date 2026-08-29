# EASY / HARD Routing

`EASY` and `HARD` describe **risk/uncertainty**, not seniority. Every role/tier remains accountable for senior judgment and evidence.

## HARD Signals
A step is `HARD` when one or more material signals apply:
- Repeated verification failure or the Stuck rule fired.
- Independent evidence materially disagrees.
- Security-sensitive behavior or permission boundary.
- Public interface/schema/export contract change.
- Concurrency, locking, ordering, migration, or irreversible release path.
- Payment, billing, IAP/in-app purchase, receipt validation, entitlements,
  subscription, or checkout behavior. These are mandatory `HARD` signals
  regardless of file count.
- Guardrail returned DENY/WARN that changes the feasible approach.
- Process termination would affect an unowned or deliberately-kept runtime.

Otherwise the step is `EASY`; `QUICK` work does not need ceremonial per-line tagging.

## Execution Protocol
- **EASY**: keep execution in the current parent agent unless delegation has a real scope/latency benefit.
- **HARD**: route to the current runtime's verified `expert` capability when available. If `scripts/lite/escalate.sh` is the configured path, call it with the minimal evidence packet.
- This kernel never pins a provider, model ID, thinking parameter, or temperature. Capability resolution belongs to `skills/_shared/protocols/model-tier.md` and the current runtime probe.

## Review After Escalation
1. Treat escalated output as a proposal, not truth; verify it against current constraints and project evidence.
2. Cross-validate only when disagreement or risk remains material — do not trigger a second model merely to satisfy a cascade.
3. Integrate only verified output.

Payment/HARD completion requires reviewer identity different from
`implementer_id` and a keyless `review-2` binding canonical final-evidence digest, exact tree,
turn, workspace, acceptance IDs, and `negative_path_bindings`, with
`reviewer.status: independent-approved`. Review-1, same-identity records, and
markers are `UNVERIFIED`. The binding does not authenticate identity; disclose
same-user-forgery risk.

## Budget / Stop Condition
Respect declared cost/token/deadline constraints. When the preferred escalation is unavailable, use the safest bounded path that still meets acceptance; for security/irreversible/public-contract work, report the unresolved blocker rather than silently weakening the gate. Do not invent extra work to consume remaining budget.
