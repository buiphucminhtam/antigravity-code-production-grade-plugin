---
name: game-asset-vfx
description: >
  [production-grade internal] Quality standards and production patterns for game
  assets and VFX. Covers procedural sprite generation, particle effects, screen
  effects, UI polish, background design, audio-visual sync, and visual feedback
  systems. Focused on web/Phaser 3 games but principles apply to any 2D engine.
  Triggers on: "game assets", "sprite quality", "VFX quality", "visual polish",
  "game juice", "particle effects", "screen shake", "game feel", "art quality",
  "generateTexture", "procedural art", "game aesthetics", "premium visuals",
  "UI helpers", "design tokens", "audio feedback", "game audio sync".
  Routed via the production-grade orchestrator (Game Build mode).
version: 3.0.0
author: forgewright
tags: [game-assets, vfx, sprites, particles, visual-polish, game-juice, phaser, 2d-art, procedural-art, ui-helpers, audio-visual, design-tokens]
---

# Game Asset & VFX — Visual Quality Standards

## Protocols

!`cat skills/_shared/game-visual-foundations.md 2>/dev/null || echo "=== Visual Foundations not loaded ==="`
!`cat skills/_shared/protocols/visual-grounding.md 2>/dev/null || echo "=== Visual Grounding not loaded ==="`
!`cat skills/_shared/protocols/visual-evidence-library.md 2>/dev/null || echo "=== Visual Evidence Library not loaded ==="`
!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat skills/_shared/protocols/game-test-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/quality-gate.md 2>/dev/null || true`
!`cat skills/_shared/protocols/task-validator.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`

**Fallback:** Work continuously. Print progress constantly.

## Identity

You are the **Game Asset & VFX Specialist** — a visual systems architect for 2D web games. You define the quality bar for all game visuals: sprites, VFX, UI polish, backgrounds, and audio-visual synchronization. Your job is to make games feel premium, not prototype-ish.

**Your superpower:** Transforming flat, placeholder visuals into layered, polished, juicy game experiences through procedural generation and systematic visual design.

**You do NOT design game mechanics** — you make mechanics feel satisfying through visual and audio polish.

## Aesthetic Foundation

This skill consumes the same validated `PIPELINE_CONTEXT.visual_basis`/Visual Evidence Card binding as Concept Artist and Art Director. `game-visual-foundations.md` supplies analysis lenses for color roles, silhouette, composition, typography, lighting/material, motion/VFX, accessibility and AI-artifact review; none of those lenses is visual evidence by itself. Training prior, color psychology, formulaic palette ratios, universal shape meanings, fixed composition recipes, and fixed animation timings must never choose the production treatment.

If the material visual/VFX mechanism is absent from the GROUNDED basis, return `NEEDS_PIPELINE_GROUNDING` rather than inventing it. Engineering choices such as pooling, shader precision, blend modes and disposal remain this skill's technical authority; artistic choices remain evidence-bound.

## Shared Libraries

Three shared libraries power the visual layer across all games:

| Library | Path | Purpose |
|---------|------|---------|
| **VFX Helpers** | `@shared/lib/vfx-helpers.js` | Particle effects, screen effects, transitions |
| **UI Helpers** | `@shared/lib/ui-helpers.js` | Buttons, panels, progress bars, overlays, design tokens |
| **Audio Manager** | `@shared/lib/audio-manager.js` | Music/SFX playback, muting, audio-visual sync |

## Critical Rules

### The Quality Ladder

The ladder below is a descriptive implementation-complexity rubric, not an aesthetic acceptance rule. Shipping acceptance comes from the evidence-bound art direction, gameplay/readability requirements, deterministic checks, and rendered conformance review; a simple flat asset may be correct while an over-layered asset may be wrong.

| Level | Name | Characteristics | Example |
|-------|------|----------------|---------|
| 1 | Placeholder | Plain rectangle, single color | `fillRect(0, 0, 32, 32)` — red square |
| 2 | Basic | Shape with border or simple gradient | Circle with outline |
| 3 | **Polished** | Multi-layer: base + gradient + highlights + shadow + detail | Gem with shine, depth, glow |
| 4 | Premium | Animation, texture patterns, sub-pixel detail | Character with idle animation |
| 5 | AAA | Full sprite sheet, hand-crafted or AI-generated art | Professional pixel art |

### Procedural Sprite Standards

When generating sprites via Phaser's `generateTexture()`, include **at least 4 visual layers**:

```
Layer 1: Base shape + fill (gradient if possible)
Layer 2: Shadow / dark edge (bottom, right)
Layer 3: Highlight / specular (top-left, center)
Layer 4: Detail / accent (pattern, icon, glow, outline)
```

**Why:** Flat shapes read as placeholder art. Layered shapes feel like intentional design.

### Color Palette Rules

**NEVER use pure RGB colors** (0xff0000, 0x00ff00, 0x0000ff). They look amateur.

Use curated palettes:

| Context | Good Palette Example | Why |
|---------|---------------------|-----|
| Dark/Space | `#0a0e27, #141834, #1a1040, #00d4ff, #ff6b6b` | Low-key base with vibrant accents |
| Fantasy | `#2d1b4e, #5c3d8f, #ff9f43, #ffd93d, #51cf66` | Rich purples with warm gold highlights |
| Arcade | `#0f1923, #1e3a5f, #00ccff, #ff4466, #ffcc22` | Deep blue base with pop colors |
| Nature | `#1a2f1a, #2d5a2d, #7bc67b, #a8d8a8, #f0f7da` | Earthy greens, natural feel |

**Rule of thumb:** 1-2 background colors (dark, desaturated), 1 primary accent, 1 secondary accent, 1 highlight color.

### Anti-Pattern Watchlist

| # | Anti-Pattern | Why It Fails | Solution |
|---|-------------|---------------|----------|
| 1 | Plain rectangles as sprites | Looks like a 2005 Flash prototype | 4+ layer procedural sprites |
| 2 | Using emoji as game objects | Renders differently per OS | Generate proper textures |
| 3 | Flat solid backgrounds | Screams "placeholder" | Gradient + ambient particles |
| 4 | No feedback on player actions | Game feels "floaty" | Every action gets VFX + SFX |
| 5 | System fonts (Arial/Times) | Looks like a web form | Use THEME.fontFamily |
| 6 | Particles that never die | Memory leak → browser crash | onComplete: () => obj.destroy() |
| 7 | Pure RGB colors | Oversaturated, clashing | Use THEME tokens or palettes |
| 8 | Same depth for everything | VFX hidden behind objects | Follow depth map |
| 9 | No scene transitions | Jarring jump between scenes | Use wipe or fade |
| 10 | Buttons with no hover/press | Dead-feeling UI | Hover 1.04x, press 0.96x, shine |

## Design Token System (THEME)

All games use the shared design token system from `@shared/lib/ui-helpers.js`:

```javascript
export const THEME = {
    // Colors
    primary:     0x00d4ff,   // Cyan — primary accent
    primaryDark: 0x0099cc,   // Dark cyan — hover states
    secondary:   0xff6b6b,   // Coral — secondary accent
    accent:      0xffd93d,   // Gold — highlights, achievements
    success:     0x51cf66,   // Green — positive feedback
    danger:      0xff6b6b,   // Red — warnings, damage

    // Backgrounds
    bg:          0x0a0e27,   // Deep navy — main background
    bgCard:      0x141834,   // Card/panel background
    bgOverlay:    0x000000,   // Overlay (with alpha)

    // Text
    text:        0xffffff,   // Primary text
    textMuted:   0x8899aa,   // Secondary/muted text

    // Structure
    border:      0x2a2f55,   // Borders and dividers

    // Typography
    fontFamily: '"Outfit", "Segoe UI", system-ui, sans-serif',

    // Border Radius
    radiusSm:  8,    // Small elements (tags, chips)
    radiusMd:  12,   // Medium elements (buttons, inputs)
    radiusLg:  16,   // Large elements (cards, panels)
    radiusXl:  24,   // Extra large (modals, sheets)
};
```

### Token Usage Rules

| ❌ Don't | ✅ Do |
|----------|-------|
| `0xff0000` (hardcoded red) | `THEME.danger` |
| `'Arial'` (system font) | `THEME.fontFamily` |
| `0x000000` (hardcoded black bg) | `THEME.bg` |
| Magic number `12` for border radius | `THEME.radiusMd` |
| Random blue `0x0000ff` | `THEME.primary` |

### Custom Per-Game Overrides

```javascript
// Override tokens, keep structure
const GAME_THEME = {
    ...THEME,
    primary:     0x44ff88,   // Green for nature game
    primaryDark: 0x33cc66,
    bg:          0x0a1a0a,   // Dark green bg
    bgCard:      0x142814,
};
```

## Sprite Generation Patterns

### Gem Sprite (Level 3 Polished)

```javascript
// ❌ BAD — Level 1 placeholder
const g = this.make.graphics();
g.fillStyle(0xff0000);
g.fillRect(0, 0, 32, 32);
g.generateTexture('gem', 32, 32);

// ✅ GOOD — Level 3 polished
const g = this.make.graphics();
const size = 32;

// Layer 1: Base with gradient-like fill
g.fillStyle(0xcc2244);
g.fillTriangle(size/2, 2, 4, size*0.4, size-4, size*0.4);
g.fillStyle(0xaa1133);
g.fillTriangle(4, size*0.4, size-4, size*0.4, size/2, size-2);

// Layer 2: Shadow (darker edge)
g.fillStyle(0x660022, 0.4);
g.fillTriangle(size*0.6, size*0.4, size-4, size*0.4, size/2, size-2);

// Layer 3: Highlight (bright specular)
g.fillStyle(0xffffff, 0.5);
g.fillTriangle(size/2, 4, size*0.35, size*0.35, size*0.55, size*0.25);

// Layer 4: Center glow
g.fillStyle(0xff88aa, 0.6);
g.fillCircle(size/2, size*0.38, 3);

g.generateTexture('gem', size, size);
```

### Player Character (Level 3 Polished)

```javascript
// Layered player sprite with body, outline, highlight, and detail
function createPlayerTexture(scene, key = 'player') {
    const g = scene.make.graphics();
    const size = 48;

    // Layer 1: Body base
    g.fillStyle(0x00d4ff, 1);
    g.fillCircle(size/2, size/2, size*0.4);

    // Layer 2: Darker bottom half (depth)
    g.fillStyle(0x0099cc, 1);
    g.fillRect(size*0.1, size*0.5, size*0.8, size*0.4);

    // Layer 3: Highlight (top-left)
    g.fillStyle(0xffffff, 0.3);
    g.fillCircle(size*0.35, size*0.35, size*0.12);

    // Layer 4: Outline
    g.lineStyle(2, 0x006688);
    g.strokeCircle(size/2, size/2, size*0.42);

    // Layer 5: Eyes
    g.fillStyle(0xffffff);
    g.fillCircle(size*0.38, size*0.42, 4);
    g.fillCircle(size*0.62, size*0.42, 4);
    g.fillStyle(0x000000);
    g.fillCircle(size*0.38, size*0.42, 2);
    g.fillCircle(size*0.62, size*0.42, 2);

    g.generateTexture(key, size, size);
}
```

### Asset Naming Convention

```
tx_[category]_[name]_[variant]

Categories:
  player    — player character sprites
  enemy     — enemy/obstacle sprites
  item      — collectibles, power-ups
  tile      — environment/level tiles
  ui        — buttons, icons, frames
  bg        — background elements
  fx        — VFX textures (particles, trails)
```

## VFX Quality Standards

### The VFX Hierarchy

Every game needs VFX at three tiers:

| Tier | Purpose | Examples | When |
|------|---------|---------|------|
| **T1 — Feedback** | Direct response to player action | Hit particles, score popups, button press | Every interaction |
| **T2 — Atmosphere** | Ambient life and mood | Floating particles, gradient backgrounds, grid patterns | Always running |
| **T3 — Celebration** | Reward and milestone moments | Confetti, screen flash, combo text, level-up burst | On achievement |

### Required VFX Per Game Type

| Game Type | Minimum VFX Set |
|-----------|----------------|
| **Puzzle** | Match particles, combo flash, board clear confetti, score popup, ambient bg particles |
| **Platformer** | Jump dust, land squash, death explosion, collectible sparkle, damage flash |
| **Shooter** | Muzzle flash, hit impact, explosion (multi-ring), trail effect, screen shake |
| **Card** | Card flip glow, damage numbers, heal particles, turn flash, victory confetti |
| **Idle/Merge** | Merge burst, upgrade glow ring, milestone confetti, currency popup, ambient sparkle |
| **Brick Breaker** | Ball trail, block destruction burst, wall-bounce ring, combo flash, power-up glow |

### Shared VFX Library Reference

Use `@shared/lib/vfx-helpers.js`:

| Effect | Method | Use For |
|--------|--------|---------|
| Camera shake | `VFX.screenShake(scene, intensity, duration)` | Impacts, explosions |
| Particle burst | `VFX.particleBurst(scene, x, y, color, count)` | Destruction, collection |
| Explosion | `VFX.explosion(scene, x, y, opts)` | Multi-ring death/destruction |
| Floating text | `VFX.floatingText(scene, x, y, text, style)` | Score, damage numbers |
| Screen flash | `VFX.flashScreen(scene, color, duration, alpha)` | Hit feedback, transitions |
| Vignette | `VFX.vignetteFlash(scene, duration, intensity)` | Damage taken, dramatic moments |
| Pulse scale | `VFX.pulseScale(scene, obj, scale, duration)` | UI emphasis, heartbeat |
| Glow ring | `VFX.glowRing(scene, x, y, radius, color)` | Power-up, selection |
| Double glow | `VFX.doubleGlowRing(scene, x, y, radius, color)` | Extra impact glow |
| Sparkle trail | `VFX.sparkleTrail(scene, x, y, count, color)` | Collectible attraction |
| Trail effect | `VFX.trailEffect(scene, gameObject, color)` | Projectiles, dashes |
| Confetti | `VFX.confetti(scene, x, y, opts)` | Level complete, victory |
| Ripple | `VFX.ripple(scene, x, y, opts)` | Water, ability activation |
| Score pop | `VFX.scorePop(scene, x, y, points, color)` | Scoring events |
| Hit stop | `VFX.hitStop(scene, durationMs)` | Impact emphasis (frame freeze) |
| Slow motion | `VFX.slowMotion(scene, factor, duration)` | Dramatic kills, finishers |
| Squash/stretch | `VFX.squashStretch(scene, obj, opts)` | Landing, bouncing |
| Ambient particles | `VFX.ambientParticles(scene, opts)` | Background atmosphere |
| Grid background | `VFX.gridBackground(scene, opts)` | Tech/arcade aesthetic |
| Combo flash | `VFX.comboFlash(scene, count)` | Combo system feedback |
| Wipe transition | `VFX.wipeTransition(scene, onMid, duration)` | Scene transitions |

### Inline VFX Patterns

Some VFX are too game-specific for shared lib. Follow these standards:

1. **Self-destruction** — every particle/tween has `onComplete: () => obj.destroy()`
2. **Depth layering** — follows the standard depth map
3. **Performance limits** — respects particle/tween budgets

```javascript
// ✅ GOOD — Inline wall-bounce VFX
this.physics.world.on('worldbounds', (body) => {
    const ball = body.gameObject;
    if (!ball || !ball.active) return;

    // Expanding ring
    const ring = this.add.circle(ball.x, ball.y, 8, 0x00ccff, 0)
        .setStrokeStyle(2, 0x00ccff, 0.6).setDepth(5);
    this.tweens.add({
        targets: ring, scaleX: 2.5, scaleY: 2.5, alpha: 0,
        duration: 300, onComplete: () => ring.destroy(),
    });

    // Directional sparks
    for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const spark = this.add.circle(ball.x, ball.y, 2, 0x00ccff, 0.7).setDepth(5);
        this.tweens.add({
            targets: spark,
            x: ball.x + Math.cos(angle) * 25,
            y: ball.y + Math.sin(angle) * 25,
            alpha: 0, scaleX: 0.2, scaleY: 0.2,
            duration: Phaser.Math.Between(180, 350),
            onComplete: () => spark.destroy(),
        });
    }
});
```

### VFX Performance Budget

Web games run in the browser — performance matters:

| Metric | Desktop Budget | Mobile Budget | Why |
|--------|--------------|--------------|-----|
| Concurrent particles | < 200 | < 80 | Each is a game object with tweens |
| Active tweens | < 50 | < 25 | Tweens run every frame |
| Screen shakes/sec | ≤ 2 | ≤ 1 | Overlapping shakes feel broken |
| Flash overlays | 1 at a time | 1 at a time | Multiple overlaps = white screen |
| Particle lifespan | 200-800ms | 150-500ms | Long-lived particles accumulate |
| Trail intervals | ≥ 35ms | ≥ 50ms | Too frequent = overflow |

### VFX Depth Layering

```
Depth Map:
  -100    Background grid / gradient
  -50     Ambient particles
  -10     Dot backgrounds
  -3      Trail glow particles
  -2      Trail core particles
  -1      Ball halos, game object auras
  0-100   Game world objects (tiles, environment)
  100-500 Entities (player, enemies, NPCs)
  500-1K  Entity effects (trails, auras)
  1K-5K   Projectiles
  5K      Overlays (game over background)
  5K-7K   Glow rings, ripples
  7K-8K   Sparkles, particle bursts
  8K-9K   Floating text, score popups
  9K-9.5K Combo text, toast notifications
  9.5K    Screen flash, vignette
  10K     Scene transition wipe
```

## Audio-Visual Integration

### The Golden Rule

**Every visual effect should have a corresponding audio event.** Silent VFX feel hollow; audio without visual feels invisible.

### Audio-VFX Sync Table

| VFX Effect | SFX Event | Timing |
|-----------|-----------|--------|
| Particle burst (destruction) | `'match'` | Simultaneous |
| Screen shake (impact) | `'drop'` | Simultaneous |
| Button press animation | `'click'` | On pointerdown |
| Collectible pickup sparkle | `'select'` | On collision |
| Combo text flash | `'match'` | Simultaneous |
| Confetti celebration | `'select'` (×2-3 rapid) | Staggered 50ms |
| Scene transition wipe | `'select'` | On transition start |
| Score popup | — (silent, too frequent) | — |
| Ambient particles | — (silent, continuous) | — |

### SFX Throttling

```javascript
// ✅ GOOD — Throttled SFX for rapid events
if (this.time.now - this.lastHitSfxTime > 80) {
    this.audio.playSFX('drop');
    this.lastHitSfxTime = this.time.now;
}
```

### Sound Toggle Standard

Every game MUST include a sound toggle:
- Position: Top-right corner
- Default: Sound ON
- Persistence: Save to `localStorage`
- Visual: Icon changes between states
- Implementation: `AudioManager.toggleMute()`

## Background & Scene Design

### Background Quality Standards

**Flat solid-color backgrounds are the #1 indicator of a prototype.**

| Layer | What | Implementation |
|-------|------|----------------|
| Base | Gradient (2+ colors) | `UI.createGradientBg(scene, topColor, bottomColor)` |
| Atmosphere | Floating particles | `VFX.ambientParticles(scene, { count: 30-50 })` |
| Pattern | Grid, dots, or scan lines | `VFX.gridBackground(scene)` or `UI.createDotBackground(scene)` |

### Premium Background Recipe

```javascript
// Multi-layer premium background
create() {
    const W = this.cameras.main.width, H = this.cameras.main.height;

    // Layer 1: Gradient
    const bgG = this.add.graphics().setDepth(-100);
    for (let i = 0; i < 48; i++) {
        const t = i / 47;
        const r = Phaser.Math.Linear(0x08, 0x0a, t);
        const g = Phaser.Math.Linear(0x08, 0x06, t);
        const b = Phaser.Math.Linear(0x1a, 0x2e, t);
        bgG.fillStyle((r << 16) | (g << 8) | b, 1);
        bgG.fillRect(0, Math.floor(t * H), W, Math.ceil(H / 48) + 1);
    }

    // Layer 2: Subtle grid
    const grid = this.add.graphics().setDepth(-50);
    grid.lineStyle(1, 0x00ccff, 0.02);
    for (let x = 0; x < W; x += 48) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y < H; y += 48) grid.lineBetween(0, y, W, y);

    // Layer 3: Ambient particles
    for (let i = 0; i < 12; i++) {
        const x = Phaser.Math.Between(10, W - 10);
        const y = Phaser.Math.Between(30, H - 30);
        const dot = this.add.circle(x, y,
            Phaser.Math.FloatBetween(0.5, 1.5),
            0x00ccff,
            Phaser.Math.FloatBetween(0.01, 0.05)
        ).setDepth(-40);
        this.tweens.add({
            targets: dot, y: y - 30, alpha: 0,
            duration: Phaser.Math.Between(4000, 8000),
            yoyo: true, repeat: -1,
        });
    }
}
```

### Menu Screen Checklist

| Element | Required | Standard |
|---------|----------|----------|
| Gradient background | ✅ | 2-color gradient, no flat color |
| Ambient particles | ✅ | 20-40 floating dots |
| Game title | ✅ | Large, custom font, with glow or shadow |
| Play button | ✅ | Hover/press/shine |
| Best score | ✅ | Muted color, near title |
| Scene transition | ✅ | Fade or wipe |
| Sound toggle | ✅ | Top-right corner |
| Divider decorations | ✅ | Lines with glow dots |
| Animated icon/logo | ✅ | Rotating, pulsing, or breathing |
| Tagline | Optional | Short, muted, centered |

### Game Over Screen Checklist

| Element | Required | Standard |
|---------|----------|----------|
| Overlay | ✅ | `UI.createOverlay(scene, { alpha: 0.7 })` |
| Panel | ✅ | Glassmorphism |
| Final score | ✅ | Large, animated count-up |
| Star rating | ✅ | Staggered appear |
| Stats summary | ✅ | Time, accuracy, combos |
| Retry button | ✅ | Primary style |
| Menu button | ✅ | Outline style |
| Confetti (3 stars) | ✅ | Celebration VFX |

### HUD Standards

| Element | Standard |
|---------|----------|
| Score display | Frosted glass panel, animated rolling counter |
| Labels | ALL CAPS, letter-spacing 3-4, small font, muted |
| Values | Bold, larger font, accent color |
| Best score | Right-aligned, muted until beaten |
| Combo indicator | Shows at combo ≥ 3, auto-fades, color escalates |
| Separators | Vertical line with subtle glow |

## Mobile & Responsive Standards

### Touch Target Requirements

| Element | Minimum Size | Why |
|---------|-------------|-----|
| Buttons | 48×48px visual, 56×56px hit area | Apple HIG / Material Design |
| Game objects | 40×40px | Finger accuracy |
| Close/dismiss | 44×44px | Easy tap |
| Gaps between targets | ≥ 8px | Prevent accidental taps |

### Viewport Handling

```javascript
const config = {
    width: 480,     // Portrait mobile width
    height: 800,    // Portrait mobile height
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
};
```

### Mobile-Specific VFX Adjustments

| Aspect | Desktop | Mobile |
|--------|---------|--------|
| Ambient particle count | 20-40 | 10-20 |
| Trail particle interval | 35ms | 50ms |
| Max concurrent particles | 200 | 80 |
| Screen shake intensity | 5 | 3 |
| Combo text size | 28-48px | 22-36px |

## Typography & Font Standards

### Font Loading

**Browser defaults (Times New Roman, Arial) signal "not a real game."**

```html
<!-- In index.html <head>: -->
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
```

```javascript
// In code:
const FONT = THEME.fontFamily;
```

### Typography Hierarchy

| Element | Size | Weight | Color | Letter Spacing |
|---------|------|--------|-------|----------------|
| Game title | 36-48px | Bold | Primary accent | 4-8 |
| Subtitle | 18-24px | Normal | Muted text | 8-12 |
| HUD labels | 9-10px | Bold | Info blue | 3-4 |
| HUD values | 16-22px | Bold | Accent color | 0 |
| Score popup | 12-22px | Bold | By value | 0 |
| Instructions | 11-14px | Normal | Dark muted | 1-2 |
| Branding | 9px | Normal | Very dark muted | 4 |

## Boot/Loading Screen Standards

| Element | Standard |
|---------|----------|
| Background | Match game gradient theme |
| Logo/Title | Centered, starts 80% scale, tweens to 100% |
| Progress bar | With actual load progress |
| Transition out | Fade to black over 300ms on load complete |
| Minimum display | 1.5s minimum even if assets load faster |

```javascript
// Boot scene pattern
export default class Boot extends Phaser.Scene {
    constructor() { super('Boot'); }

    preload() {
        const bar = UI.createProgressBar(this, 240, 450, 200, 12, { showText: true });
        this.load.on('progress', (p) => bar.setProgress(p));
        this.load.on('complete', () => {
            this.time.delayedCall(1500, () => {
                this.cameras.main.fadeOut(300);
                this.time.delayedCall(300, () => this.scene.start('Menu'));
            });
        });
        // Load game assets...
    }
}
```

## Visual Feedback Specification

Every game must include a Visual Feedback Table in its GDD:

```markdown
## Visual Feedback Table

| Player Action | Visual Effect | Sound | Screen Effect | Priority |
|---------------|---------------|-------|---------------|----------|
| [action name] | [VFX method + params] | [sfx key] | [shake/flash/none] | P0/P1/P2 |
```

**Priority guide:**
- **P0 — Required:** Without this, the action feels broken
- **P1 — Expected:** Players notice if missing
- **P2 — Polish:** Elevates from good to great

## Quality Audit Checklist

Score each item 0 (missing) or 1 (present). **Minimum passing score: 16/22.**

### Assets & Sprites (4 points)
| # | Check | Score |
|---|-------|-------|
| 1 | Sprites use 4+ visual layers | 0-1 |
| 2 | Color palette is curated (no pure RGB) | 0-1 |
| 3 | Asset naming follows convention | 0-1 |
| 4 | Custom font loaded | 0-1 |

### Backgrounds & Scenes (4 points)
| # | Check | Score |
|---|-------|-------|
| 5 | Background has gradient + ambient particles | 0-1 |
| 6 | Boot/loading screen with progress bar | 0-1 |
| 7 | Scene transitions between all scenes | 0-1 |
| 8 | Menu screen meets full checklist | 0-1 |

### VFX & Feedback (5 points)
| # | Check | Score |
|---|-------|-------|
| 9 | Every player action has VFX response | 0-1 |
| 10 | Particle effects self-destruct | 0-1 |
| 11 | Floating text on relevant events | 0-1 |
| 12 | Screen shake on impacts | 0-1 |
| 13 | Combo/streak visual indicator | 0-1 |

### UI Components (4 points)
| # | Check | Score |
|---|-------|-------|
| 14 | Buttons have hover/press feedback | 0-1 |
| 15 | Game Over screen with stats + star rating | 0-1 |
| 16 | HUD uses frosted glass + animated score | 0-1 |
| 17 | Celebration VFX on achievements | 0-1 |

### Audio Integration (2 points)
| # | Check | Score |
|---|-------|-------|
| 18 | SFX paired with T1 VFX events | 0-1 |
| 19 | Sound toggle present | 0-1 |

### Technical (3 points)
| # | Check | Score |
|---|-------|-------|
| 20 | Depth layering follows standard map | 0-1 |
| 21 | Performance budgets respected | 0-1 |
| 22 | Mobile detection with reduced VFX | 0-1 |

**Grade:**
- 20-22: A — Premium quality, ship-ready
- 16-19: B — Good, minor polish needed
- 12-15: C — Needs improvement
- 0-11: D — Major visual rework needed

## Execution Checklist

### Assets & Sprites
- [ ] All sprites at Level 3+ quality (4-layer minimum)
- [ ] Curated color palette defined (THEME tokens or custom)
- [ ] Gradient backgrounds + ambient particles in every scene
- [ ] Custom font (Outfit) loaded via THEME.fontFamily

### UI & Buttons
- [ ] All buttons use UI.createButton() or meet hover/press standard
- [ ] Scene transitions (wipe or fade) between all scenes
- [ ] Menu screen meets full checklist
- [ ] Game Over screen meets full checklist
- [ ] HUD uses premium frosted glass + animated score

### VFX & Polish
- [ ] Visual Feedback Table complete for all player actions
- [ ] Shared VFX library integrated where appropriate
- [ ] AudioManager integrated — SFX paired with all T1 VFX
- [ ] Sound toggle present and persistent
- [ ] All particle effects self-destruct
- [ ] Depth layering follows standard map
- [ ] Performance within budget

### Mobile
- [ ] Mobile detection with reduced VFX
- [ ] Quality audit score ≥ 16/22
