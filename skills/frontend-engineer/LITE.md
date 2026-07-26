---
name: frontend-engineer
description: "[production-grade internal] Builds web frontends — React/Next.js components, pages, design systems, state management, typed API clients. Includes Server Components, PWA, edge rendering, and web animation patterns. Routed via the production-grade orchestrator."
version: 2.0.0
tags: [frontend, react, nextjs, typescript, tailwindcss, state-management, api-client, design-system, accessibility]
---

# Frontend Engineer (LITE)

## SOLVE Step 2: GROUND (Frontend Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Frontend structure / path | Check directories for `frontend/` or `src/` | ... | run the check command and paste output |
| Framework and styling framework | Read `package.json` and CSS/config files | ... | run the check command and paste output |
| API base URLs & client ready | Read `.env` or client service configuration | ... | run the check command and paste output |
| Accessibility audit runner | Check for `jest-axe` or devtools config | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Frontend Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (draft UI design gate contract) | TARGET (design_dna/UI spec) | CHECK (verify responsive matrix exists)`
- `n. ACTION (create design system tokens) | TARGET (tailwind.config.ts) | CHECK (npm run build)`
- `n. ACTION (build UI component with ARIA) | TARGET (src/components/Modal.tsx) | CHECK (npm run test:a11y)`
- `n. ACTION (wire component state / store) | TARGET (src/components/Modal.tsx) | CHECK (npx jest Modal.test.tsx)`
- `n. ACTION (integrate API service clients) | TARGET (src/services/api.ts) | CHECK (npm run build)`

---

### Example: Build a Login Form

#### 1. UNDERSTAND
- **Task**: Build a responsive and accessible Login Form using TailwindCSS and React.
- **What must be TRUE**: Form uses `<form>`, inputs have linked labels (`htmlFor`/`id`), error states use `aria-invalid` and `aria-describedby`, Tailwind styles are responsive, build passes, design contract produced before code.
- **What could I be wrong about**: Incorrect ARIA attributes causing screen reader failure.

#### 2. GROUND
| Assumption | Check command / file read | Result | VERIFIED? |
|---|---|---|---|
| Tailwind CSS is configured | `cat tailwind.config.ts` | Tailwind CSS configured | Y |
| Component directory exists | `ls src/components` | Directory exists | Y |
| React is installed | Read `package.json` | React v18 | Y |
| Design DNA exists | `find .agents/ -name "*design_dna*"` | `.agents/design_dna.json` found | Y |

#### 3. DECOMPOSE
1. ACTION (draft UI design gate contract) | TARGET (design_dna/UI spec) | CHECK (verify responsive matrix exists)
2. ACTION (create LoginForm component matching contract) | TARGET (src/components/LoginForm.tsx) | CHECK (npm run build)
3. ACTION (add validation & ARIA attributes) | TARGET (src/components/LoginForm.tsx) | CHECK (npx jest LoginForm.test.tsx)
4. ACTION (verify layout responsiveness) | TARGET (src/components/LoginForm.tsx) | CHECK (npx playwright test)

#### 4. EXECUTE

**Step 1 (CONTRACT):** Produce design contract before writing any code.
```text
USER GOAL: Authenticate to access the application.
PRIMARY ACTION: Submit email + password credentials.
CONTENT HIERARCHY: Heading (h1) → Email field → Password field → Submit button → Error message.
DESIGN-SYSTEM AUDIT: design_dna.json loaded — bg-white, text-gray-900, accent blue-600.
TOKENS: color (gray-700, blue-600/500, red-600), typography (text-sm/base), spacing (gap-4, p-4, mt-1), radius (rounded-md, rounded), elevation (shadow-sm), motion (transition on button hover).
COMPONENT STATES: default, hover (button bg-blue-500), focus (ring-2 ring-blue-400), disabled (opacity-50 cursor-not-allowed), loading (spinner in button), empty (pristine form), error (red border + aria-invalid + describedby).
RESPONSIVE MATRIX:
  Narrow (<640px): Full-width form, single column
  Medium (640-1024px): max-w-sm centered
  Wide (>1024px): max-w-sm centered, optional side panel
ACCESSIBILITY: Labels linked via htmlFor/id, aria-invalid on error, aria-describedby for error text, focus ring, prefers-reduced-motion removes transitions.
```

**Step 2:** Create LoginForm component matching contract.
```typescript
import React, { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
    } else {
      setError('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm mx-auto p-4 border rounded">
      <div>
        <label htmlFor="email-input" className="block text-sm font-medium text-gray-700">Email Address</label>
        <input
          id="email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "email-error" : undefined}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm transition focus:ring-2 focus:ring-blue-400 motion-reduce:transition-none"
        />
        {error && <p id="email-error" className="text-red-600 text-sm mt-1">{error}</p>}
      </div>
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded transition hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 motion-reduce:transition-none">Log In</button>
    </form>
  );
}
```
- CHECK: `npm run build` -> Passed.

**Step 3:** Add validation & ARIA attributes (already in step 2).
- CHECK: `npx jest LoginForm.test.tsx` (using jest-axe) -> Passed.

**Step 4:** Verify layout responsiveness.
- CHECK: `npx playwright test` -> Passed.

#### 5. VERIFY
```text
CLAIM: Login form is fully accessible, responsive, and matches design contract.
DOM CHECK COMMAND: document.querySelectorAll('form label[for], input[aria-invalid], [aria-describedby]')
DOM OUTPUT: <label for="email-input">, <input aria-invalid="false">, [aria-describedby] present on error
EVIDENCE:
- Project breakpoints/fallback viewports tested: 320px, 640px, 1024px verified via Playwright
- Horizontal overflow checked: No overflow at 320px minimum
- Content wrapping and hierarchy verified: h1 → label → input → button single-column flow
- Keyboard/focus behavior verified: Tab order correct, focus ring visible on all interactive elements
- Component states (loading, empty, error, disabled) verified: Error state shows red text with aria-describedby
- Token/design-system conformance verified: All colors, spacing, radius from design_dna.json
- Screenshots/VRT results: Baseline captured for 3 viewports
VISUAL VERDICT: STRUCTURALLY VERIFIED (requires user visual confirmation)
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
