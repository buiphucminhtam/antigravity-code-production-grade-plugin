---
name: art-director
description: "Establishes, audits, and enforces cohesive visual identity guidelines, asset pipelines, and UI/UX theme consistency. Use when the user requests art style guides, visual moodboards, palette validations, texture/mesh quality-assurance workflows, or design system alignment audits."
version: 1.0.0
---

# Art Director (LITE)

## SOLVE Step 2: GROUND (Art Director Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project tech stack and rendering configurations are onboarded | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |
| Style DNA contract is generation-ready | `python3 scripts/art-direction/style-contract.py validate .forgewright/art-direction/game-art-contract.json --stage generation` | ... | run the check command and paste output |
| Approved asset inventory has no drift | `scripts/art-direction/art-pipeline.sh drift` | ... | require exit code 0 before engine handoff |
| Asset catalog directory is structured correctly | `find assets/ -name "*style*" -o -name "*palette*" -o -name "*theme*"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Art Director Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Review layout mockups, graphic assets, and theme configurations against the design DNA | Verify color contrast ratios, font hierarchies, and texture compression rules conform to the master style guide.
2. ENFORCE | Standardize asset names, formats, and structural layouts | Confirm visual assets under `assets/` strictly use lowercase kebab-case with zero spaces.
3. ALIGN | Inject style constraints into UI component templates, canvas scenes, or graphics shaders | Ensure all elements dynamically inherit global themes rather than using hardcoded values.

## Common Mistakes Checklist
- **Style Guide Deviations**: Using hardcoded colors (e.g., custom hex colors) instead of approved Tailwind CSS classes or theme-aware tokens defined in the `design_dna.json` contract.
- **Inconsistent Asset Formats**: Committing visual assets with mixed file types, high polygon budgets, or non-power-of-two (NPOT) texture sizes.
- **Lowercase kebab-case naming violations**: Naming theme files or design documentation under `docs/` using CamelCase, spaces, or absolute paths (e.g., `docs/01-product/ArtStyleGuide.md` instead of `docs/01-product/art-style-guide.md`).
- **Unverified UI Breakpoints**: Forgetting to audit visual components on responsive layouts, leading to container clippings or overlapping text.
- **Ignoring asset memory limits**: Overloading 3D scenes or web views with uncompressed high-resolution textures, triggering WebGL out-of-memory errors on target devices.

### Step 1: Ground the target game stack and baseline settings
```bash
cat .forgewright/project-profile.json
find .agents/ -name "*design_dna*"
```
```
```

### Step 2: Implement a responsive, theme-aligned visual card using Design DNA variables
Create `src/components/ArtThemeCard.tsx`:
```typescript
import React from 'react';

export const ArtThemeCard = ({ title, description }: { title: string; description: string }) => {
  return (
    // Conforms strictly to design_dna rules for padding, background colors, and rounded borders
    <div className="max-w-md rounded-xl bg-slate-900 p-6 shadow-md border border-slate-800 transition hover:shadow-lg focus-within:ring-2 focus-within:ring-emerald-500">
      <h2 className="text-xl font-bold text-slate-100 md:text-2xl">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        {description}
      </p>
      <button className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900 active:bg-emerald-700">
        Launch WebGL Scene
      </button>
    </div>
  );
};
```

### Step 3: Run the local visual regression test runner to verify theme alignment
```bash
npx playwright test tests/visual-regression.spec.ts
```
