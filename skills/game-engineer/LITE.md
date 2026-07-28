---
name: game-engineer
description: "Orchestrates game engine implementations, frame-rate independent physics loops, entity management, and performance optimizations. Use when the user requests core gameplay systems coding, movement mechanics, state controllers, collision sweeps, or game loop integrations in Phaser, Three.js, Unity, Godot, or Roblox."
version: 1.0.0
---

# Game Engineer (LITE)

## SOLVE Step 2: GROUND (Game Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target game development libraries or frameworks are defined | `cat package.json \| jq '.dependencies["phaser"] // .dependencies["three"]'` | ... | run the check command and paste output |
| Active project stack and health status profile are onboarded | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Game Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. INTEGRATE | Code physics updates and core entity loops using delta-time scaling | Ensure frame rate independent calculations to prevent speed scaling fluctuations on varying monitors.
2. POOL | Set up reusable object pools for high-frequency game entities (e.g., projectiles) | Verify that entities are recycled dynamically to minimize garbage collection stutter and CPU spikes.
3. HARNESS | Implement custom collision systems and bounding-box overlap validation rules | Verify that collision sweeps are optimized to avoid nested O(n²) calculation bottlenecks.

## Game Studio Control Plane

For milestone or cross-discipline work, follow
`../_shared/protocols/game-studio-pipeline.md`. The Game Engineer requires an
implementation-ready handoff before editing: approved design, governing ADRs,
dependency status, target/path ownership, performance and build budgets,
automated checks, playtest evidence requirements, and rollback strategy.

Close implementation with a done handoff that maps every acceptance criterion
to code and evidence. Implementation alone never marks a story done. Apply
engine-specialist role lenses locally unless the user explicitly requests
delegation.

## Common Mistakes Checklist
- **FPS-Dependent Physics Scaling**: Calculating physical movements (e.g., gravity, acceleration) without multiplying values by delta-time components, resulting in game speed shifts on different refresh rate monitors.
- **Dynamic Entity Allocations (GC Spikes)**: Continually instantiating short-lived game objects (bullets, damage numbers, explosion visualizers) at runtime rather than utilizing a pre-allocated Object Pool, causing severe Garbage Collection pauses.
- **Dangling Event Listeners**: Neglecting to unsubscribe keyboard, mouse, or controller listener handlers on scene teardown, producing cumulative memory leaks and duplicated input executions.
- **Non-Compliant File Structures**: Creating game mechanics specs or documentation files under `docs/` using CamelCase, spaces, or uppercase naming patterns instead of strictly lowercase kebab-case (e.g., `bullet-physics-system.md`).

### Step 1: Verify the game dev stack from the project profile
```bash
cat .forgewright/project-profile.json
```

### Step 2: Implement a high-performance, frame-independent entity updater in `src/game/projectile-manager.ts`
```typescript
import Phaser from 'phaser';

export class ProjectileManager {
  private group: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene) {
    // Ground: Initialize Arcade Physics group with pre-configured object pooling
    this.group = scene.physics.add.group({
      defaultKey: 'bullet-texture',
      maxSize: 50, // Strict memory ceiling
      runChildUpdate: true
    });
  }

  // Fires projectile using frame-independent velocity configurations
  public fireBullet(x: number, y: number, speed: number, deltaTime: number) {
    const bullet = this.group.get(x, y);
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);

      // Verified: Scaled with frame delta-time to ensure hardware performance parity
      const targetVelocity = speed * deltaTime;
      bullet.body.setVelocityY(-targetVelocity);
    }
  }

  // Recycle out-of-bounds projectiles to prevent memory leaks
  public update() {
    this.group.getChildren().forEach((bullet: any) => {
      if (bullet.active && bullet.y < 0) {
        this.group.killAndHide(bullet);
      }
    });
  }
}
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
