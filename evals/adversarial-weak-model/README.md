# Adversarial Weak-Model Eval

This suite measures whether a hallucination-prone model stays inside Forgewright's **observable execution rails**. It does not inspect chain-of-thought and does not treat mock/replay output as model evidence.

The scenarios target eight failure classes: stale documentation overriding runtime truth, invented symbols, premature architecture/process work, unnecessary clarification, framework self-mutation, fake success claims, provider/model pinning, and scope creep.

## Deterministic CI self-test

```bash
python3 evals/adversarial-weak-model/run-evals.py --self-test
```

The self-test runs two deterministic replays for every scenario:

- `good`: behavior that should be accepted.
- `bad`: behavior that remains functionally plausible where possible but violates a Forgewright rail.

CI passes only when **every good replay passes and every bad replay is rejected**. This validates the grader and fixtures; it is not empirical evidence about a model.

## Live weak-model evidence

```bash
FORGEWRIGHT_PROVIDER=agy \
FORGEWRIGHT_MODEL='Gemini 3.5 Flash (Low)' \
FORGEWRIGHT_MODEL_SNAPSHOT='agy-<version>:Gemini 3.5 Flash (Low)' \
FORGEWRIGHT_SNAPSHOT_SCOPE=adapter-route \
python3 evals/adversarial-weak-model/run-evals.py --live --adapter agy \
  --output evals/adversarial-weak-model/results-live.json
```

A live report records provider, model ID, snapshot identifier, snapshot scope, adapter, ordered task IDs, and a fingerprint of the complete suite. Only reports where `mode=live` and `empirical=true` are eligible as model evidence. Use `snapshotScope=provider-resolved` only when the provider exposes an immutable/resolved backend snapshot; use `adapter-route` for an AGY version + model-label route so the report does not overclaim backend-weight identity.

The AGY adapter reuses Forgewright's established sandboxed `accept-edits` benchmark pattern, injects the current Lite kernel contract, disables slash-command expansion, closes stdin, and hard-stops the process group on timeout. The legacy orchestrator adapter remains available for chat-completions providers.

Use `--task <id>` for a focused live smoke. Do not add network/model execution to CI: the deterministic replay self-test is the release gate; live evidence is an explicit benchmark run.

## Aggregate and regression-compare live evidence

Run each task once, then aggregate those one-task reports. Aggregation rejects duplicate/missing tasks and any provider/model/snapshot-scope/adapter/suite/contract/harness mismatch.

```bash
python3 evals/adversarial-weak-model/run-evals.py \
  --aggregate evals/adversarial-weak-model/runs/final-*.json \
  --baseline-min-pass-rate 100 \
  --output evals/adversarial-weak-model/baselines/<baseline>.json
```

Compare a future full/aggregated report only when all comparison metadata and fingerprints match:

```bash
python3 evals/adversarial-weak-model/run-evals.py --compare \
  evals/adversarial-weak-model/baselines/<baseline>.json \
  evals/adversarial-weak-model/results-live-candidate.json
```

The canonical weak-model baseline uses a 100% alert threshold for these eight rails. This is a manual regression signal, not a network-dependent CI/release blocker; if the contract, fixtures, or harness execution semantics change, the old baseline becomes intentionally non-comparable and must not be relabelled as current evidence. Checked-in baselines retain verifier assertions and changed-path evidence but omit raw model stdout/stderr.

Current empirical baseline: `baselines/2026-08-08-agy-1.1.11-gemini-3.5-flash-low.json` — 8/8 pass@1 using the `agy` adapter route `Gemini 3.5 Flash (Low)` with `snapshotScope=adapter-route`. The scope label is deliberate: it identifies the observed adapter/model route, not immutable backend weights.
