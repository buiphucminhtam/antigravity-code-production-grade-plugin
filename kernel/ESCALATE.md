# EASY / HARD Routing

Tag each task step during [SOLVE.md](SOLVE.md) planning.

## Classification Checklist
Model self-tag is only a hint. A step is **HARD** if ANY of these objective runtime signals or conditions apply:
- [ ] Repeated verification failure (runtime signal).
- [ ] Independent-sample disagreement (runtime signal).
- [ ] Security-sensitive context (auth, secrets, injection surface, permissions).
- [ ] Changes a public interface, schema, or public exports.
- [ ] Concurrency, locking, or asynchronous ordering paths.
- [ ] The Stuck rule fired on this step.
- [ ] Guardrail flagged a DENY or WARN on this step.
- [ ] The step would signal or kill a process that holds no Runtime Lifecycle Guard lease, or would reap a `policy=keep` lease.

Otherwise, the step is **EASY**.

## Execution Protocol
- **EASY**: Execute the step yourself (`thinking_level: MINIMAL`).
- **HARD**: Run the escalation command:
  ```bash
  bash scripts/lite/escalate.sh "<step + minimal context>"
  ```
  *(This spawns the strong model and returns its answer; you must integrate and verify it).*

## Agreement-Based Cascade Rules
When a task is escalated to a stronger model:
1. Verify the generated output matches all constraints and local coding patterns.
2. If the stronger model's output introduces any ambiguity or contradicts other parts of the plan, run another escalation to cross-validate or ask the user for confirmation.
3. Integrate and run a `VERIFY` check immediately. Never merge unverified code from escalated models.

## Budget Limit
- **Cost Budget Rules Apply**: Escalations are bound by token and cost budget rules, not a fixed escalation limit.
- If you exceed the budget, you must **pause**. Do not "do your best".
- Security, schema, and public-interface work must pause and explicitly wait for user approval or budget extension if exhausted.
