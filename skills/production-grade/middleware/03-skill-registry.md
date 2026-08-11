# Middleware 03 — SkillRegistry

> **Source:** `.forgewright/skills-config.json`
> **Hook:** `before_skill()`
> **Purpose:** Progressive skill discovery — load only skills relevant to classified mode

## Execution

```
1. Read .forgewright/skills-config.json (mode → skill mapping)

2. Load only skills needed for current mode:
   Review mode   → 1 skill  (~3KB)
   Feature mode → 5 skills (~15KB)
   Full Build   → 10 skills (~30KB)
   Fallback     → ordinary local fallback; no mode skill injection (classification failure)

3. Reject skills not in the mode's approved list
```

## Output

- Progressive loading reduces context size from ~66KB (all skills) to mode-appropriate amount
- Token budget preserved for actual skill work

## Note

This replaces the previous pattern of loading all 52 skill descriptions upfront.
