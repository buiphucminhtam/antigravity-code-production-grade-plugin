# Cursor Rules Templates

Templates for creating Cursor IDE rules and agent prompts for project-specific AI guidance.

## Templates

| Template | Description |
|----------|-------------|
| `rule.md.hbs` | Generic scoped Cursor `.mdc` rule template |
| `file-rule.hbs` | File-specific rule (e.g., `.cursor/rules/react.mdc`) |
| `agent.md.hbs` | Agent prompt template for custom agents |
| `rules-index.hbs` | Rules directory index |

## Usage

```bash
# Generate a custom Cursor rule
npx ts-node scripts/generate-template.ts \
  --template cursor/rule \
  --output ./.cursor/rules/my-project.mdc \
  --data '{"ruleName": "TypeScript Standards", "scope": "*.ts"}'

# Generate agent prompt
npx ts-node scripts/generate-template.ts \
  --template cursor/agent \
  --output ./.cursor/agents/my-agent.md \
  --data '{"agentName": "Backend Expert", "expertise": ["Node.js", "PostgreSQL"]}'
```

## Context Variables

```typescript
{
  ruleName?: string;      // Rule name (e.g., "TypeScript Standards")
  scope?: string;          // File scope (e.g., "*.ts", "src/**")
  agentName?: string;      // Agent name
  expertise?: string[];    // Array of expertise areas
  guidelines?: string[];   // Custom guidelines
  examples?: string[];     // Code examples
}
```

## Rule Structure

```markdown
---
description: A narrow explanation of when this rule applies
globs: "src/**/*.ts"
alwaysApply: false
---

# Rule: [Name]

## Scope
Files matching: [scope]

## Guidelines
1. [Guideline 1]
2. [Guideline 2]

## Examples
\`\`\`typescript
// Good example
\`\`\`

## Anti-patterns
\`\`\`typescript
// Bad example
\`\`\`
```

## Best Practices

- Treat `AGENTS.md` as the project-wide authority; add only narrow rules that
  do not duplicate it
- Keep rules concise (under 500 words)
- Use specific file scopes
- Include concrete examples
- Avoid conflicting rules
- Keep `.cursor/rules/RULES.md` current and remove stale rules
