---
name: unity-engineer
description: "Orchestrates Unity-specific visual and logical systems, C# script development, component lifecycles, and physics simulation triggers. Use when the user requests gameplay logic, script creation, Unity project setup, asset integrations, or scene object configurations."
version: 1.0.0
---

# Unity Engineer (LITE)

## SOLVE Step 2: GROUND (Unity Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Project tech stack matches Unity and C# guidelines | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |
| Active C# solution or assembly definition files exist | `find . -name "*.sln" -o -name "*.asmdef"` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Unity Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. INSPECT | Verify game scene hierarchies, active component structures, and `.meta` files | Ensure there are no broken references, unassigned GameObject serialized fields, or orphaned assets.
2. IMPLEMENT | Author or refine C# scripts using solid architecture standards and namespaces | Confirm that update loops do not run heavy calculations or direct garbage-collecting allocations.
3. COMPILE | Execute local MSBuild compilation sweeps or runner checks on active components | Verify compilation completes successfully with zero warnings or structural syntax failures.

## Common Mistakes Checklist
- **Unassigned Serialized Fields**: Forgetting to link serializable fields (`SerializeField`) in scene assets, leading to `NullReferenceException` blocks during runtime.
- **Garbage Generation in Update Loops**: Creating new class instances, calling `.GetComponent()`, or triggering heavy string concatenations in high-frequency `Update()` loops.
- **Ignoring .meta File Hygiene**: Renaming or moving script assets via terminal commands without updating or moving their corresponding `.meta` files, corrupting Unity engine serializations.
- **Non-compliant Filenames**: Storing logs, specs, or GDD layouts under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `unity-physics-setup.md`).

### Step 1: Ground the active development platform
```bash
cat .forgewright/project-profile.json
```

### Step 2: Implement a clean, garbage-recycled player controller in `src/scripts/PlayerController.cs`
```csharp
using UnityEngine;

namespace Forgewright.Core
{
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] private float moveSpeed = 5.0f;

        private Rigidbody rb;
        private Vector3 movementInput;

        private void Awake()
        {
            // Ground caching components during initialization to avoid GC overhead
            rb = GetComponent<Rigidbody>();
        }

        private void Update()
        {
            // Optimized: Recycles input variables and avoids allocations in high-frequency update
            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");
            movementInput = new Vector3(horizontal, 0f, vertical).normalized;
        }

        private void FixedUpdate()
        {
            if (movementInput.sqrMagnitude > 0.01f)
            {
                rb.MovePosition(rb.position + movementInput * moveSpeed * Time.fixedDeltaTime);
            }
        }
    }
}
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
