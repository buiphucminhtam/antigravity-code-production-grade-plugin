---
name: eval-engineer
description: "Orchestrates prompt evaluation suites, model validation benchmarks, completion assertion scoring, and automated Quality Gate verification. Use when the user requests model accuracy reports, benchmark comparisons, automated prompt completions audits, or latency and token cost performance evaluations."
version: 1.0.0
---

# Eval Engineer (LITE)

## SOLVE Step 2: GROUND (Eval Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target model configurations and thinking level overrides are active | `cat .production-grade.yaml` | ... | run the check command and paste output |
| Existing validation matrices, mock answers, or evaluation scripts are indexed | `find tests/ -name "*eval*" -o -name "*assert*" -o -name "*benchmark*"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Eval Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Validate prompts, active model/runtime parameters, and completion schema constraints | Verify parameters from current provider/runtime configuration and executable schema checks.
2. BENCHMARK | Execute automated prompt assertion loops across multiple target model providers | Confirm that output completions pass semantic constraints and structured schema validators.
3. MEASURE | Analyze model completion latency, token counts, and API spend footprints | Verify model output metrics are logged under ~/.forgewright/usage/ and stay within budget rules.

## Common Mistakes Checklist
- **Breaking provider-native payloads**: Removing provider-required fields during automated testing without verifying the current runtime contract.
- **No Validation Schema Assertions**: Trusting model outputs without running programmatic assertions or validation schema constraints, allowing structural hallucinations to slip through.
- **Parallel Thread API Throttling**: Running intensive, multi-worker prompt validation sweeps without implementing back-off delays, triggering API rate limit blocks.
- **Non-Compliant File Names**: Storing prompt evaluations, metric boards, or benchmark results under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `docs/04-testing/EvalResults.md` instead of `docs/04-testing/eval-results-report.md`).

### Step 1: Ground target project evaluation settings
```bash
cat .production-grade.yaml
cat .forgewright/budget.yaml
```

### Step 2: Run a secure prompt completion assertion in `tests/eval_prompt.py`
```python
import json

def calculate_quality_score(completion_text: str) -> dict:
    # Grounded Check: Ensure structured output holds valid JSON properties
    try:
        data = json.loads(completion_text)
        confidence = data.get("confidence", 0.0)
        has_citations = len(data.get("citations", [])) > 0

        # Scoring metrics mapping to standard Quality Gate (0-100)
        score = 0
        if confidence > 0.8:
            score += 50
        if has_citations:
            score += 50

        grade = "A" if score >= 90 else "B" if score >= 80 else "F"
        return {"score": score, "grade": grade, "status": "PASS" if score >= 90 else "FAIL"}
    except (json.JSONDecodeError, TypeError) as err:
        return {"score": 0, "grade": "F", "status": "FAIL", "error": str(err)}

# Validate mock output completion
print(calculate_quality_score('{"confidence": 0.95, "citations": [""]}'))
```

### Step 3: Run the prompt validator and check token usage metrics
```bash
python3 tests/eval_prompt.py
forge token status || cat ~/.forgewright/usage/summary.json
```
