---
name: mobile-engineer
description: "Orchestrates mobile application development, React Native test execution, Maestro/Midscene.js local-only E2E automation, and iOS/Android automated store publishing pipelines. Use when the user requests React Native feature additions, mobile test suite configurations, Android Emulator setups, or EAS/Fastlane publishing configurations."
version: 1.0.0
---

# Mobile Engineer (LITE)

## SOLVE Step 2: GROUND (Mobile Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target mobile project dependencies and scripts exist | `cat package.json \|\| find . -name "App.tsx" -o -name "App.js"` | ... | run the check command and paste output |
| Local emulator creation and mobile test scripts are present | `find scripts/ -name "*emulator*" -o -name "*publish*"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Mobile Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Validate React Native UI structures, styling layouts, and module packaging imports | Verify that native bundle settings, asset linkages, and platform-specific code divisions are clean.
2. CONSTRUCT | Set up local-only mobile E2E test scripts utilizing Maestro YAML actions or Midscene.js | Confirm tests execute successfully against local Android Emulators or iOS Simulators.
3. DEPLOY | Configure automated App Store and Google Play publishing profiles via EAS or Fastlane | Ensure release configurations, bundle targets, and credential secrets are securely segmented.

## Common Mistakes Checklist
- **Hardcoding Local API Endpoints**: Specifying hardcoded `localhost` inside API fetch definitions instead of utilizing environment-specific loopbacks (such as `10.0.2.2` for Android Emulators), preventing dynamic server access.
- **Unpinned Native Package Boundaries**: Specifying dynamic gradle or cocoapods dependencies in mobile configs, triggering native compilation crashes when libraries update.
- **Testing against SaaS Cloud Device Pools**: Routing test suites through expensive SaaS visual cloud networks instead of running localized Maestro E2E profiles against local emulators.
- **Non-Compliant Documentation File Names**: Storing mobile specs, fastlane configurations, or testing logs under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `docs/04-testing/MobileTest.md` instead of `docs/04-testing/mobile-test.md`).

### Step 1: Ground the active React Native workspace configurations
```bash
cat .forgewright/project-profile.json
find scripts/ -name "*emulator*"
```
```
scripts/setup-local-emulators.sh
```

### Step 2: Implement a safe, local Maestro E2E test script in `.maestro/login-flow.yaml`
```yaml
appId: com.forgewright.mobileclient
---
- clearState
- launchApp
- assertVisible: "Welcome to Forgewright"
- tapOn: "alex@company.com"
- assertVisible: "Authorized Session"
```

### Step 3: Launch local emulators and execute local-only Maestro test assertions
```bash
# Set up local Android emulator safely
./scripts/setup-local-emulators.sh --create-android

# Run local Maestro test suite
maestro test .maestro/login-flow.yaml
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
