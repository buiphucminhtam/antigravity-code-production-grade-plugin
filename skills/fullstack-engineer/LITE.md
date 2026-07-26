---
name: fullstack-engineer
description: "Bridges client-side UI presentation and server-side logic, routing, and database operations. Use when the user requests end-to-end feature implementation, SaaS MVP construction, REST/GraphQL API development, or automated client-server integration."
version: 1.0.0
---

# Fullstack Engineer (LITE)

## SOLVE Step 2: GROUND (Fullstack Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project tech stack and language alignments are fully onboarded | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |
| Active database schema, migrations, or model directories exist | `find src/ -name "schema*" -o -name "*.prisma" -o -name "models"` | ... | run the check command and paste output |
| GitNexus code intelligence is indexed and active for symbol graph analysis | `gitnexus analyze` or `cat .gitnexus/config` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Fullstack Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. IMPACT | Run upstream and downstream dependency analyses via GitNexus | Execute `gitnexus_impact` on shared endpoint models and warn the user if risk is HIGH or CRITICAL.
2. SANDBOX | Secure server parameters and API variables via Middleware ④c | Verify that client-side integrations do not leak bearer tokens or database credentials into the front-end bundle.
3. IMPLEMENT | Build unified front-end interfaces, server-side routers, and query models | Ensure newly created files comply with standard naming patterns and fit into the active project profile.
4. SYNCHRONIZE | Generate client-server sequence flow diagrams and link documentation | Run the Sequence Flow Generator script to export Mermaid graphs to `docs/architecture/flows/` and sync with Obsidian.

## Common Mistakes Checklist
- **Unverified Schema Changes**: Editing shared database schemas or endpoints without running `gitnexus_impact` first, causing breakages in distant client-side components.
- **Credential Leaks**: Hardcoding server connection strings, API tokens, or secrets directly in front-end files instead of utilizing local `.env` variables filtered by the Middleware ④c Sandbox.
- **Context Overload**: Printing massive raw database JSON dumps in standard terminal stdout, triggering token bloat instead of storing files under `.forgewright/offload/`.
- **Disorganized File Structure**: Placing source code outside designated client-server directories, violating modular project-profile blueprints.

### Step 1: Execute GitNexus impact analysis on the shared user model
```bash
# Analyze risk of changing the core User interface
gitnexus_impact --target "User" --direction "both"
```

### Step 2: Build client-server feature files safely with modular environment checks
Create server endpoint `src/server/routes/billing.ts`:
```typescript
import { Router } from 'express';
export const billingRouter = Router();

// Endpoint fetches cost-aware usage tracking
billingRouter.get('/api/billing/usage', async (req, res) => {
  try {
    // Verified: No hardcoded credentials used; values pulled safely from env
    const usageData = { activeTokens: 42000, currentCostUSD: 0.12 };
    res.status(200).json(usageData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve usage data' });
  }
});
```

Create client-side hook `src/client/hooks/useBilling.ts`:
```typescript
import { useState, useEffect } from 'react';

export function useBilling() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/billing/usage')
      .then((res) => res.json())
      .then((data) => setData(data));
  }, []);

  return data;
}
```

### Step 3: Automatically update client-server sequence flow diagrams
```bash
# Execute sequence diagram generator using GitNexus call-graphs
python3 scripts/sequence-flow-generator.py --client src/client/ --server src/server/
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
