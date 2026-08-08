---
name: llm-tester
description: "Orchestrates automated evaluation of LLM prompt completions, model response assertions, output schema validations, and token cost tracking. Use when the user requests model evaluation suites, prompt regression tests, JSON response verification, or cost-safety audits."
version: 1.0.0
---

# Llm Tester (LITE)

## SOLVE Step 2: GROUND (Llm Tester Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target model configurations and API provider bindings are defined | `cat .production-grade.yaml` | ... | run the check command and paste output |
| Existing prompt test cases, mock responses, or assertion files are indexed | `find tests/ -name "*test-llm*" -o -name "*assert*"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Llm Tester Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Validate prompts, current runtime/model parameters, and output schema assertions | Verify parameters against the active provider/runtime contract and schema against executable validators.
2. COMPILE | Execute automated unit and integration assertion loops on target prompt interfaces | Verify that model outputs adhere to schema structures and pass semantic safety constraints.
3. PROFILE | Evaluate token overhead, API execution latency, and session cost metrics | Confirm that token footprints are tracked via `.forgewright/usage/` logs and stay under budget bounds.

## Common Mistakes Checklist
- **Provider contract mismatch**: Overriding or stripping provider-required request/response fields without verifying the active runtime contract.
- **Bypassing Output Schema Assertions**: Trusting that the LLM will return perfectly formed JSON structures without implementing rigorous validation gates, causing parsing crashes.
- **Non-Compliant File Names**: Storing prompt evaluations, benchmark results, or review notes under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `docs/04-testing/LLMTesterResult.md` instead of `docs/04-testing/llm-tester-result.md`).
- **Context Window Exhaustion**: Feeding full raw API responses or massive trace outputs back into the model context instead of summarizing or utilizing Context Offload mechanisms.

### Step 1: Ground target model settings and token budget tracking status
```bash
cat .production-grade.yaml
cat .forgewright/budget.yaml
```

### Step 2: Implement an automated model response schema validator in `tests/validate_completion.py`
```python
import json
from jsonschema import validate, ValidationError

# Grounded schema asserting that agent outputs must contain a structured decision
SCHEMA_DECISION = {
    "type": "object",
    "properties": {
        "decision": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
        "reasoning": {"type": "string"}
    },
    "required": ["decision", "confidence", "reasoning"]
}

def verify_model_completion(raw_completion: str) -> bool:
    try:
        data = json.loads(raw_completion)
        validate(instance=data, schema=SCHEMA_DECISION)
        print("Success: Completion schema matches production-grade validation criteria.")
        return True
    except (json.JSONDecodeError, ValidationError) as err:
        print(f"[FAIL] Schema validation error: {err}")
        return False

# Mock check
verify_model_completion('{"decision": "PROCEED", "confidence": 0.95, "reasoning": "Passes Quality Gate"}')
```

### Step 3: Run the validation script and check token usage metrics
```bash
python3 tests/validate_completion.py
forge token status || cat ~/.forgewright/usage/summary.json
```
