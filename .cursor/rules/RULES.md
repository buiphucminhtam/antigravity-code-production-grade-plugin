# Cursor Rules Index

`AGENTS.md` is the single project-wide instruction authority for Cursor and
Antigravity. It is generated from `kernel/` and must not be duplicated by a
second always-applied Cursor rule.

## Active project rules

No standalone Cursor project rules are active. A future rule must use Cursor's
recognized `.mdc` format with valid frontmatter, own a narrow file or task
scope, and avoid copying instructions already present in `AGENTS.md`.

## Lifecycle enforcement

Project lifecycle hooks are configured in `.cursor/hooks.json`. Hooks may
inject compact context or record observability, but rule-context failures must
remain fail-open for normal project work. Destructive and security-sensitive
controls remain governed by the canonical Forgewright guardrail.

## Adding a scoped rule

1. Confirm that `AGENTS.md` does not already own the instruction.
2. Create a `.mdc` file with `description`, `globs`, and `alwaysApply`
   frontmatter appropriate to its scope.
3. Keep the content concise and reference canonical project sources instead of
   copying them.
4. Add the rule to this index and test its actual Cursor activation behavior.
