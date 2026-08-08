---
name: prompt-engineer
description: "Orchestrates system prompt design, prompt optimization, few-shot examples alignment, context compression, and prompt injection security audits. Use when the user requests custom system prompt designs, context length optimization, system prompt updates, or LLM output behavior tuning."
version: 1.0.0
---

# Prompt Engineer (LITE)

## SOLVE Step 2: GROUND (Prompt Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target model configs and optimization levels are active | `cat .production-grade.yaml` | ... | run the check command and paste output |
| Existing system prompts or template instructions are indexed | `find src/ -name "*prompt*" -o -name "*instruction*" -o -name "*template*"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Prompt Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Analyze system instructions against prompt injections and secret leak vectors | Ensure strict credential redactors and Middleware ④c rules are defined to filter API keys.
2. OPTIMIZE | Structure prompts with only the examples/context needed for the task | Measure quality/context cost and use progressive disclosure when large context is genuinely required.
3. PRESERVE | Respect the currently configured provider/runtime contract | Verify adapters preserve provider-required request/response fields without hard-coding parameters for an unverified model family.

## Common Mistakes Checklist
- **Breaking provider-native payloads**: Applying generic regex/trimmers/parsers that remove fields required by the currently configured provider/runtime.
- **Hardcoding Secrets in Prompts**: Placing raw API keys, bearer tokens, or connection URIs directly inside system prompts or few-shot examples, risking context leaks.
- **Ignoring Context Bloat Guidelines**: Feeding extremely large database dumps or raw codebases directly into the prompt context instead of leveraging progressive summaries or minimal signature layouts.
- **Hardcoding provider parameters**: Applying a temperature/thinking setting without verifying that the active model supports or benefits from it.
- **Non-Compliant File Names**: Storing prompt guides or optimization reports under `docs/` using CamelCase, spaces, or uppercase letters instead of strictly lowercase kebab-case.

### Step 1: Ground the model configuration rules
```bash
cat .production-grade.yaml
```

### Step 2: Implement a secure, token-optimized system prompt template generator in `src/prompts/prompt-generator.ts`
```typescript
export class PromptGenerator {
  // Conforms strictly to Middleware ④c (Tool Sandbox) by avoiding hardcoded credentials
  private static SYSTEM_TEMPLATE = `
You are an expert Forgewright Assistant. You must act strictly as a grounded developer.

## Core Rules:
1. Grounding: Every factual claim must be backed by workspace files.
2. Compliance: Always use lowercase kebab-case for file names under docs/.

## Technical Parameters:
- Temperature: {{temperature}}
- Tech Stack: {{techStack}}

## Few-shot Example:
Input: Create a script for task tracking.
`;

  public static generatePrompt(techStack: string, temp: number): string {
    return this.SYSTEM_TEMPLATE
      .replace('{{techStack}}', techStack)
      .replace('{{temperature}}', temp.toFixed(1));
  }
}
```

### Step 3: Run pre-flight validation on the generated prompt template
```bash
# Verify prompt structure compiles cleanly
node -e "
const { PromptGenerator } = require('./src/prompts/prompt-generator');
const prompt = PromptGenerator.generatePrompt('TypeScript', 1.0);
console.log('[AUDIT] Generated prompt character length:', prompt.length);
if (prompt.includes('{{')) throw new Error('Unreplaced template variables detected!');
console.log('Success: Prompt pre-flight check passed.');
"
```
