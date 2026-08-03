---
name: parallel-dispatch
description: "Plan or run bounded, independent AI worker scopes with explicit budgets, provider consent, and reviewer isolation."
version: 2.0.0
---

# Parallel Dispatch (LITE)

Use parallel dispatch only when the task decomposes into genuinely independent,
path-disjoint scopes. The canonical runner is
`scripts/parallel-dispatch-runner.py`; it is dry-run by default and never creates
worktrees, branches, commits, or recursive agents by itself.

## SOLVE Step 2: Ground

| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Manifest is valid JSON v1 | `python3 -m json.tool <manifest>` | ... | run the check command and paste output |
| Scope paths are disjoint | runner validation during dry-run | ... | run the check command and paste output |
| Token/concurrency/deadline limits are positive | policy validation during dry-run | ... | run the check command and paste output |
| AGY model IDs are machine-readable | same-invocation `agy models` runtime probe | ... | run the check command and paste output |

## Decision Contract

- Small or serial work: `0` workers.
- Mechanical inventory: at most `1` scout.
- Other work: `2–3` workers only for independent, disjoint scopes.
- Worker count is capped by scope count, available concurrency, advisory remaining
  token budget, and the hard worker-count cap of three. A requested reviewer
  reserves one advisory budget slot before workers are selected.
- Builder is the default implementation/audit role. Security, schema, public API,
  concurrency, and disagreement route to expert.
- Independent review receives only immutable requirements, diff, and raw evidence.
- Every worker stops on duplicate findings, covered scope, the same blocker twice,
  advisory token budget, or enforced deadline cap. AGY exposes no runtime token
  limiter, so `hard_token_cap: true` fails closed. Recursive spawning is forbidden.
- Path scopes are advisory read-only boundaries, not filesystem isolation. Every
  AGY call is forced to `--sandbox --mode plan`; write-requesting manifests fail
  closed, but workers share one validated read-only workspace and may technically
  read outside their assigned path list.

## Manifest and Dry Run

```json
{
  "version": 1,
  "request": {
    "task_id": "audit-1",
    "task_size": "large",
    "serial": false,
    "access": "read-only",
    "requirements": "Audit these independent scopes.",
    "scopes": [
      {"id": "api", "paths": ["src/api"], "independent": true, "risk_signals": ["public-api"]},
      {"id": "ui", "paths": ["src/ui"], "independent": true, "risk_signals": []}
    ],
    "limits": {"concurrency": 2, "remaining_token_budget": 4000, "worker_token_budget": 2000, "deadline_ms": 30000}
  },
  "provider": {"cli": "agy"}
}
```

```bash
python3 scripts/parallel-dispatch-runner.py --manifest /path/to/manifest.json
```

The JSON plan reports `provider-managed`, `unavailable`, or `verified` model
selection. A manifest-supplied capability file is untrusted and cannot authorize
`--model`. During an explicitly authorized execution, the runner probes `agy
models` in the same invocation and uses an ID only if the output is structured
and machine-readable; human display names leave selection provider-managed.

## External Execution Gate

AGY is the only external execution adapter. Sending scoped code externally
requires both flags; either flag alone never triggers an external call:

```bash
python3 scripts/parallel-dispatch-runner.py \
  --manifest /path/to/manifest.json \
  --execute \
  --allow-external-code-sharing
```

The runner uses an argv array with `shell=False` and always adds `--sandbox
--mode plan`; manifest text is never shell interpolated. Custom provider args,
`accept-edits`, disabled sandboxing, and dangerous permission-bypass flags are
forbidden. A manifest cannot select the provider executable. The runner resolves
`agy` only from `~/.local/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`, and
passes an allowlisted environment containing the canonical workspace, a fixed
PATH, HOME, locale variables, and TMPDIR; other parent variables are not forwarded.
Before any external call, execution fails closed unless Antigravity's
runtime-loaded global `~/.gemini/config/hooks.json` contains the exact enabled
`forgewright-policy` `PreToolUse` hook. Each worker receives the canonical
workspace through `FORGEWRIGHT_WORKSPACE`, because current `agy --print` builds
may emit an empty `workspacePaths` hook field. A denial is terminal and
explicit—do not bypass it by invoking AGY through another shell wrapper.

## Checks

```bash
pytest -q tests/unit_tests/test_parallel_dispatch_runner.py
python3 scripts/parallel-dispatch-runner.py --manifest /path/to/manifest.json
```
