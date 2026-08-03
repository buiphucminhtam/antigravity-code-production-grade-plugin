---
name: ui-designer
description: "Orchestrates user interface (UI) engineering, design system alignment, Tailwind CSS integrations, and visual regression validation. Use when the user requests new UI components, responsive layouts, theme adaptations, or styling updates."
version: 1.0.0
---

# Ui Designer (LITE)

## SOLVE Step 2: GROUND (Ui Designer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target UI framework (Tailwind CSS, React, or custom CSS) is installed | `cat package.json \| jq '.dependencies["tailwindcss"] // .dependencies["react"]'` | ... | run the check command and paste output |
| Active design_dna contracts or visual tokens exist under workspace paths | `find .agents/ -name "*design*" -o -name "*dna*"` | ... | run the check command and paste output |
| Playwright visual regression test configurations are onboarded | `cat playwright.config.ts` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Ui Designer Domain Slots)
Workflow: AUDIT → DESIGN → CONTRACT → IMPLEMENT → VALIDATE

Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Analyze existing design system, tokens, and current layout | Verify design_dna or active guidelines are understood.
2. DESIGN | Draft wireframe and component states | Verify states (hover, focus, disabled, error) are defined.
3. CONTRACT | Output the UI Design Gate contract and request user approval (if major) | Verify responsive behavior matrix is documented.
4. IMPLEMENT | Build the UI strictly matching the contract | Prohibited before design gate passes. Reject arbitrary colors, spacing, breakpoints, or isolated components.
5. VALIDATE | Run accessibility, responsive, and visual tests | Verify no layout drift or violations.
6. AUDIT | Re-read all changed files in full, build coverage matrix, scan for contradictions | Verify every requirement is addressed and examples match rules (kernel/AUDIT.md).

## Common Mistakes Checklist
- **Hardcoded Style Overrides**: Writing explicit, hardcoded hex colors or inline style properties inside TSX/JSX instead of leveraging standard Tailwind utility classes.
- **Missing Interaction States**: Designing UI buttons, links, or inputs without explicitly defining active, hover, focus-visible, and disabled styling variants.
- **VRT Platform Discrepancies**: Running local visual regression tests across different OS render engines without executing tests inside a consistent Docker environment.
- **Broken Media Breakpoints**: Omitting responsive class prefixes (e.g., `md:`, `lg:`), causing mobile device viewports to suffer layout clippings or severe wrap issues.
- **Non-Compliant Resource Directories**: Saving UI designs, style charts, or layout specs under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case.

### Example: Add a Card Widget

#### Step 1 (AUDIT): Verify the UI styling framework and active design guidelines
```bash
cat package.json | grep -E "(tailwindcss|playwright)"
find .agents/ -name "*design_dna*"
```
```
```

#### Step 2 (DESIGN): Draft wireframe and component states
- **Default**: Card with title, description, CTA button
- **Hover**: Elevated shadow on card, button color shift
- **Focus-within**: Ring highlight (sky-500)
- **Disabled**: Reduced opacity, non-interactive
- **Loading**: Skeleton pulse placeholder
- **Empty**: "No content" placeholder text
- **Error**: Red border + error icon

#### Step 3 (CONTRACT): Output design contract
```text
USER GOAL: Browse content items at a glance and drill into details.
PRIMARY ACTION: Click "View details" CTA.
CONTENT HIERARCHY: Title (h2) → Description (body) → CTA (button).
DESIGN-SYSTEM AUDIT: design_dna.json loaded — bg-slate-900, text-slate-100, accent sky-600.
TOKENS: color (slate-900/100/400, sky-500/600), typography (text-xl/2xl, text-sm), spacing (p-6, mt-2, mt-4), radius (rounded-xl, rounded-lg), elevation (shadow-md → shadow-lg), motion (transition on shadow and color).
RESPONSIVE MATRIX:
  Narrow (<640px): Full-width card, text-xl title
  Medium (640-1024px): max-w-md card, text-2xl title
  Wide (>1024px): max-w-md card in grid, text-2xl title
ACCESSIBILITY: Focus-within ring, semantic h2, button focus ring with offset, prefers-reduced-motion disables transition.
```

#### Step 4 (IMPLEMENT): Build the UI strictly matching the contract
Create `src/components/CardWidget.tsx`:
```typescript
import React from 'react';

export const CardWidget = ({ title, description }: { title: string; description: string }) => {
  return (
    // Conforms strictly to design_dna rules for padding, background colors, and rounded borders
    <div className="max-w-md rounded-xl bg-slate-900 p-6 shadow-md transition hover:shadow-lg focus-within:ring-2 focus-within:ring-sky-500 motion-reduce:transition-none">
      <h2 className="text-xl font-bold text-slate-100 md:text-2xl">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        {description}
      </p>
      <button className="mt-4 inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900 active:bg-sky-700 motion-reduce:transition-none">
        View details
      </button>
    </div>
  );
};
```

#### Step 5 (VALIDATE): Run accessibility, responsive, and visual tests
```bash
npx playwright test tests/visual-regression.spec.ts
```
