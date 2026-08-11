# Docs Hub Retrospective

## Delivered

- Removed the default goal turn quota and cleared the stale local completed goal
  file. Runtime timeout, tool-call, byte-size, and explicit emergency caps remain
  as safety guards.
- Added a versioned docs manifest, canonical registry, legacy discovery,
  allowlist privacy gate, root containment, symlink checks, deterministic
  catalog IDs, links, backlinks, diagnostics, and curated Git/GitNexus state.
- Added a dependency-free static HTML/CSS portal with project/document pages,
  offline search, print styles, light/dark tokens, reduced-motion support,
  accessible diagram SVG/text fallback, traceability and diagnostics pages, and
  output ownership markers.
- Added optional source-preserving Obsidian export and documented legacy wiki
  compatibility shims.
- Added Forgewright/Pixelworld fixtures, schema tests, CLI unit tests, local CI,
  real Forgewright build evidence, real Pixelworld privacy-safe scan evidence,
  and browser responsive evidence.

## Evidence observed

| Check | Result |
|---|---|
| Goal quota/runtime regression | Unlimited execution passed beyond 20 turns; explicit cap passed |
| Python focused tests | `26 passed` including orchestrator, goal contract, and manifest schema |
| Docs CLI focused tests | `21 passed` |
| Full CLI suite | `113 passed` |
| CLI typecheck/build | PASS |
| Fixture CLI E2E | init → registry → scan → build → doctor → Obsidian export PASS |
| Partial batch build | invalid project exits `1`; valid project output preserved |
| Forgewright build | 100 documents, 110 generated files |
| Pixelworld scan | 133 documents, 5 assets; sensitive paths absent |
| Browser responsive | 360/768/1024/1280: no horizontal overflow |
| Browser visual/a11y structure | landmarks, focus-visible rule, reduced-motion rule, alt coverage, diagram SVG fallback, console errors: PASS |

## Known boundaries

1. Direct Tab key traversal could not be observed through the in-app browser
   adapter: the adapter kept focus on the input/body despite two semantic
   attempts. The generated HTML remains keyboard-native and includes a visible
   skip link plus `:focus-visible`; this specific interaction is `UNVERIFIED`,
   not silently treated as PASS.
2. Legacy documents that contain raw HTML are escaped by design. This prevents
   source HTML/scripts from becoming an execution surface. Mermaid fenced blocks
   are rendered through the controlled SVG adapter with a source-text fallback.
3. Existing Forgewright docs contain many broken legacy links and anchors. Normal
   builds preserve readable output and surface actionable diagnostics; strict
   doctor correctly reports `warning`.
4. Generated `.forgewright/docs-hub/` output is ignored and disposable. The
   static builder refuses to replace an output directory without its ownership
   marker.
5. Independent adversarial review initially found an Obsidian symlink escape
   and silent duplicate registry IDs. Both were fixed with regression tests;
   the follow-up review reported no remaining P0/P1 findings.

## Follow-up

- Add a Playwright/keyboard lane that can assert actual focus transitions in a
  browser backend with reliable key dispatch.
- Add richer Mermaid layout only after measurements show the bounded SVG adapter
  is insufficient.
