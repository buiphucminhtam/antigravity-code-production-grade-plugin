# Docs Hub Acceptance Audit

| ID | Status | Current evidence |
|---|---|---|
| AC-01 | PASS | Zod validation plus Draft-07 schema tests |
| AC-02 | PASS | Idempotent/non-destructive init test |
| AC-03 | PASS | Environment/home-derived registry path test |
| AC-04 | PASS | `Docs/`, `docs/`, README-only, empty and Pixelworld scans |
| AC-05 | PASS | Traversal and symlink-escape tests |
| AC-06 | PASS | Sensitive-source test plus real Pixelworld artifact exclusion |
| AC-07 | PASS | Repeated scan ID/fingerprint determinism test |
| AC-08 | PASS | Broken link, image, anchor, case/symlink and stale-index diagnostics |
| AC-09 | PASS | Static build integration and real Forgewright build |
| AC-10 | PASS | Generated document content/navigation is present without JS dependency; browser pages render statically |
| AC-11 | PASS | Offline project-aware search test and browser interaction |
| AC-12 | PASS | Mermaid validation, SVG `role=img`, title/description and text fallback tests/browser audit |
| AC-13 | PASS | GitNexus available/stale/unavailable tests |
| AC-14 | PASS | Outside-root export test, source-preservation test and symlink-output regression |
| AC-15 | PASS | Browser audit at 360, 768, 1024 and 1280 CSS pixels; no horizontal overflow |
| AC-16 | PARTIAL | Landmarks, native controls, skip link, focus-visible and reduced-motion pass; direct sequential Tab traversal remains `UNVERIFIED` because the browser adapter did not move focus after two attempts |
| AC-17 | PASS | Stable scan IDs/routes and byte-equivalent reordered multi-project builds |
| AC-18 | PASS | Automated partial-batch test preserves valid project output when another manifest fails |

## Review verdict

Independent adversarial review reported no remaining P0 or P1 findings after
the Obsidian symlink-containment and duplicate registry-ID fixes. The only
remaining verification boundary is the direct Tab traversal portion of AC-16.
