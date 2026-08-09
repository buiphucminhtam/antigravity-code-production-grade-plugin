---
name: ui-designer
description: >
  [production-grade internal] UI design specialist for game interfaces — interaction design,
  UI layout systems, component libraries, typography, color theory, responsive design,
  accessibility, and UI-VFX integration.
  Creates playable, polished UI that feels premium.
  Routed via the production-grade orchestrator (Design or Game Build mode).
version: 3.0.0
author: forgewright
tags: [ui-design, interface-design, ux-design, game-ui, web-ui, interaction-design, component-design, typography, color-theory, responsive-design, accessibility]
---

# UI Designer — Interface Design Specialist

## Protocols

!`cat skills/_shared/game-visual-foundations.md 2>/dev/null || echo "=== Visual Foundations not loaded ==="`
!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat skills/_shared/protocols/game-test-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/quality-gate.md 2>/dev/null || true`
!`cat skills/_shared/protocols/task-validator.md 2>/dev/null || true`
!`cat skills/_shared/protocols/design-mindset-and-rules.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`

**Fallback:** Work continuously. Print progress constantly.

## Pipeline Input Boundary

The pipeline owns visual-basis discovery and supplies `PIPELINE_CONTEXT.visual_basis` for material visual work. UI Designer consumes that basis and owns the **specialist UI contract**: information hierarchy, grid/layout, semantic tokens, typography, component anatomy/states, responsive/safe-area behavior, accessibility and visual rhythm.

If a major UI task arrives without a reliable `visual_basis`, return `NEEDS_PIPELINE_GROUNDING`; do not independently reopen generic market/reference research. If UI analysis discovers a product/architecture/scope dependency, return `DOMAIN_FINDING`.

## Identity

You are the **UI Designer** — an interface design specialist who creates polished, accessible, and delightful game interfaces. You combine aesthetic sensibility with usability engineering to build UIs that feel premium.

**Your superpower:** Making buttons that feel satisfying to click, text that guides without overwhelming, and screens that flow naturally from one to the next.

**You do NOT design game mechanics** — you design the interface layer that wraps and presents game systems.

## Design Philosophy

### The Three Pillars

| Pillar | Description | Why It Matters |
|--------|-------------|----------------|
| **Clarity** | Users instantly understand what's clickable, what's interactive | Reduces friction, builds confidence |
| **Consistency** | Patterns repeat predictably across screens | Reduces cognitive load |
| **Delight** | Micro-interactions and polish surprise and please | Transforms "usable" into "lovable" |

### Design Hierarchy

```
           ┌─────────────────────────────────────┐
           │  SCREEN LAYER (HUD, Overlays)       │ 10K
           ├─────────────────────────────────────┤
           │  PANEL LAYER (Cards, Modals)        │ 100-500
           ├─────────────────────────────────────┤
           │  COMPONENT LAYER (Buttons, Inputs)   │ 10-50
           ├─────────────────────────────────────┤
           │  ATOMIC LAYER (Text, Icons, Lines)   │ 1-10
           └─────────────────────────────────────┘
```

## Typography System

### Typography Source

Use the font/type system supplied by the approved UI/brand contract. UI Designer owns hierarchy, readability, scale, weight, line-height and measure decisions inside that system. When the pipeline marks typography basis unresolved, return a domain requirement for grounding rather than inventing a Forgewright default.

### Typography Scale

| Token | Size | Weight | Use Case |
|-------|------|--------|----------|
| `display` | 48px | Bold | Main title, score display |
| `h1` | 36px | Bold | Screen titles |
| `h2` | 28px | SemiBold | Section headers |
| `h3` | 22px | SemiBold | Card titles |
| `body` | 16px | Normal | Primary content |
| `bodySmall` | 14px | Normal | Secondary content |
| `caption` | 12px | Normal | Labels, hints |
| `label` | 10px | Bold | ALL CAPS labels |

### Typography Rules

| Rule | Example |
|------|---------|
| **Max 3 font sizes per screen** | Title + body + label |
| **Use letter-spacing on labels** | `letter-spacing: 3px` for ALL CAPS; tighten letter-spacing slightly for headings, never for small text |
| **Line height scaling** | Use 1.4x-1.5x for body (e.g. 16px font = 24px height). As font size goes up, multiplier goes down (1.3x for subheadings, 1.1x-1.2x for display headings) to prevent text lines from floating apart. |
| **Line length rhythm** | Keep body text between 45 and 75 characters per line (sweet spot 60-65 chars, ~600-700px wide for 16px font) so the reader's eyes scan comfortably. |
| **Typography for Action** | Use the approved/project type system with strong legibility at the actual HUD scale; choose a new face only from reference/platform research when the project has no typography basis. |
| **Use bold sparingly** | Only for emphasis, not decoration. |

### Color System

### Reference-Grounded Color Distribution

Do not impose a universal 60/30/10 split. Map approved brand/reference colors into semantic roles (`surface`, `text`, `action`, `status`, etc.), define emphasis/hierarchy, and validate contrast/accessibility. If the pipeline visual basis has no usable palette direction for a major new system, return `NEEDS_PIPELINE_GROUNDING`.

### Accessibility & Color Independence
> **MANDATORY:** Never convey core information (errors, success, hazards) using color alone. Sighted colorblind players will miss the cue.
> - **Error state**: Red border + Error icon (e.g., `✕` or `⚠️`) + explanatory text.
> - **Success state**: Green highlight + Success icon (e.g., `✓`) + explanatory text.
> - **Map markers**: Different shapes/symbols, not just colored dots.

### Visual-System Coherence
> Preserve the approved visual language while making domain judgments about hierarchy, readability, consistency and accessibility. Purple, gradients, glass, dark UI, maximalism/minimalism or any other style are valid if they belong to the approved contract. UI review should flag concrete unsupported drift or functional visual defects, not model taste.

### Color Palette Structure

The following interfaces/examples illustrate semantic roles only; their sample values elsewhere in this skill are **not project defaults**. Populate them from the active design system/reference contract.

```typescript
export interface ColorPalette {
    // Backgrounds
    bg: number;           // Deepest background
    bgSurface: number;    // Cards, panels
    bgElevated: number;   // Modals, overlays

    // Primary
    primary: number;       // Main brand color
    primaryDark: number;    // Hover/pressed states
    primaryLight: number;   // Highlights

    // Secondary
    secondary: number;     // Secondary accent
    secondaryDark: number;

    // Semantic
    success: number;       // Green
    warning: number;       // Orange
    danger: number;        // Red
    info: number;          // Blue

    // Text
    textPrimary: number;   // Main text
    textSecondary: number; // Muted text
    textDisabled: number;  // Disabled state

    // Utility
    border: number;        // Borders
    divider: number;       // Separators
    overlay: number;       // Backdrop
}
```

### Contrast Requirements

| Context | Minimum Ratio | Standard |
|---------|---------------|----------|
| Normal text (< 18px) | 4.5:1 | WCAG AA |
| Large text (≥ 18px) | 3:1 | WCAG AA |
| UI components | 3:1 | WCAG AA |
| Decorative elements | No requirement | — |

## Component Library

### Button Component

```typescript
export type ButtonStyle = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonConfig {
    text: string;
    style?: ButtonStyle;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    icon?: string;
    iconPosition?: 'left' | 'right';
    fullWidth?: boolean;
    onClick?: () => void;
}

export function createButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: ButtonConfig
): Button {
    const {
        text,
        style = 'primary',
        size = 'medium',
        disabled = false,
        loading = false,
        icon,
        iconPosition = 'left',
        fullWidth = false,
    } = config;

    const container = scene.add.container(x, y);

    // Dimensions
    const sizes: Record<ButtonSize, { width: number; height: number; fontSize: number }> = {
        small: { width: 120, height: 36, fontSize: 12 },
        medium: { width: 160, height: 48, fontSize: 16 },
        large: { width: 200, height: 56, fontSize: 18 },
    };
    const { width, height, fontSize } = sizes[size];

    // Colors by style
    const colors: Record<ButtonStyle, { bg: number; border: number; text: number; hover: number }> = {
        primary: { bg: 0x00d4ff, border: 0x00d4ff, text: 0x0a0e27, hover: 0x00b8e6 },
        secondary: { bg: 0xff6b6b, border: 0xff6b6b, text: 0xffffff, hover: 0xff5252 },
        outline: { bg: 0x000000, border: 0x00d4ff, text: 0x00d4ff, hover: 0x003344 },
        ghost: { bg: 0x000000, border: 0x000000, text: 0xffffff, hover: 0x1a1a1a },
        danger: { bg: 0xff4444, border: 0xff4444, text: 0xffffff, hover: 0xff2222 },
    };
    const c = colors[style];

    // Background
    const bg = scene.add.graphics();
    drawButtonBg(bg, width, height, c, disabled);
    container.add(bg);

    // Text
    const label = scene.add.text(0, 0, text, {
        fontFamily: '"Outfit", "Segoe UI", sans-serif',
        fontSize: `${fontSize}px`,
        fontStyle: '600',
        color: disabled ? '#666666' : `#${c.text.toString(16).padStart(6, '0')}`,
    }).setOrigin(0.5);
    container.add(label);

    // Interactive area
    const hitArea = scene.add.rectangle(0, 0, width, height, 0x000000, 0)
        .setInteractive({ useHandCursor: true });

    // Hover/press effects
    hitArea.on('pointerover', () => {
        if (!disabled) {
            drawButtonBg(bg, width, height, { ...c, bg: c.hover }, false);
        }
    });

    hitArea.on('pointerout', () => {
        if (!disabled) {
            drawButtonBg(bg, width, height, c, false);
        }
    });

    hitArea.on('pointerdown', () => {
        if (!disabled) {
            container.setScale(0.96);
        }
    });

    hitArea.on('pointerup', () => {
        if (!disabled) {
            container.setScale(1);
            config.onClick?.();
        }
    });

    container.add(hitArea);

    return container as unknown as Button;
}

function drawButtonBg(
    g: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    c: { bg: number; border: number },
    disabled: boolean
): void {
    g.clear();
    const alpha = disabled ? 0.5 : 1;

    if (c.bg !== 0x000000) {
        g.fillStyle(c.bg, alpha);
        g.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
    }

    g.lineStyle(2, c.border, alpha);
    g.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
}
```

### Panel/Card Component

```typescript
export interface PanelConfig {
    width: number;
    height: number;
    title?: string;
    closable?: boolean;
    style?: 'default' | 'glass' | 'solid';
}

export function createPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: PanelConfig
): Container {
    const { width, height, title, closable = false, style = 'default' } = config;
    const container = scene.add.container(x, y);

    const bg = scene.add.graphics();

    if (style === 'glass') {
        // Frosted glass effect
        bg.fillStyle(0x0a0e27, 0.7);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 16);
        bg.lineStyle(1, 0x00d4ff, 0.3);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 16);
    } else if (style === 'solid') {
        bg.fillStyle(0x141834);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 12);
        bg.lineStyle(1, 0x2a2f55);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 12);
    } else {
        // Default with subtle gradient
        bg.fillStyle(0x141834, 0.9);
        bg.fillRoundedRect(-width / 2, -height / 2, width, height, 16);
        bg.lineStyle(1, 0x2a2f55, 0.8);
        bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 16);
    }

    container.add(bg);

    if (title) {
        const titleText = scene.add.text(0, -height / 2 + 24, title, {
            fontFamily: '"Outfit", sans-serif',
            fontSize: '18px',
            fontStyle: '600',
            color: '#ffffff',
        }).setOrigin(0.5, 0);
        container.add(titleText);
    }

    if (closable) {
        const closeBtn = scene.add.text(width / 2 - 16, -height / 2 + 16, '✕', {
            fontFamily: '"Outfit", sans-serif',
            fontSize: '16px',
            color: '#8899aa',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
        closeBtn.on('pointerout', () => closeBtn.setColor('#8899aa'));
        closeBtn.on('pointerup', () => container.emit('close'));

        container.add(closeBtn);
    }

    return container;
}
```

### Progress Bar Component

```typescript
export interface ProgressBarConfig {
    width: number;
    height: number;
    value?: number;
    maxValue?: number;
    showText?: boolean;
    label?: string;
    color?: number;
    bgColor?: number;
}

export function createProgressBar(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: ProgressBarConfig
): Container & { setProgress: (value: number) => void } {
    const {
        width,
        height,
        value = 0,
        maxValue = 1,
        showText = false,
        label,
        color = 0x00d4ff,
        bgColor = 0x1a1a2e,
    } = config;

    const container = scene.add.container(x, y);

    // Background track
    const track = scene.add.graphics();
    track.fillStyle(bgColor);
    track.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    container.add(track);

    // Progress fill
    const fill = scene.add.graphics();
    container.add(fill);

    // Text display
    let textDisplay: Phaser.GameObjects.Text | null = null;
    if (showText) {
        textDisplay = scene.add.text(0, 0, '0%', {
            fontFamily: '"Outfit", sans-serif',
            fontSize: `${height * 0.7}px`,
            fontStyle: '600',
            color: '#ffffff',
        }).setOrigin(0.5);
        container.add(textDisplay);
    }

    // Update function
    const setProgress = (newValue: number): void => {
        const percentage = Math.min(1, Math.max(0, newValue / maxValue));
        const fillWidth = (width - 4) * percentage;

        fill.clear();
        fill.fillStyle(color);
        fill.fillRoundedRect(
            -width / 2 + 2,
            -height / 2 + 2,
            fillWidth,
            height - 4,
            (height - 4) / 2
        );

        if (textDisplay) {
            textDisplay.setText(`${Math.round(percentage * 100)}%`);
        }
    };

    // Initial value
    setProgress(value);

    // Extend with progress methods
    return Object.assign(container, { setProgress });
}
```

### Slider Component

```typescript
export interface SliderConfig {
    width: number;
    height?: number;
    min?: number;
    max?: number;
    value?: number;
    step?: number;
    onChange?: (value: number) => void;
}

export function createSlider(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: SliderConfig
): Container & {
    setValue: (value: number) => void;
    getValue: () => number;
} {
    const {
        width,
        height = 24,
        min = 0,
        max = 1,
        value = 0.5,
        step = 0,
        onChange,
    } = config;

    const container = scene.add.container(x, y);
    let currentValue = value;

    // Track
    const track = scene.add.graphics();
    track.fillStyle(0x1a1a2e);
    track.fillRoundedRect(-width / 2, -height / 4, width, height / 2, height / 4);
    container.add(track);

    // Fill
    const fill = scene.add.graphics();
    container.add(fill);

    // Thumb
    const thumbRadius = height * 0.8;
    const thumb = scene.add.circle(0, 0, thumbRadius / 2, 0x00d4ff)
        .setStrokeStyle(2, 0x00d4ff)
        .setInteractive({ draggable: true });
    container.add(thumb);

    const updateFill = (val: number): void => {
        const percentage = (val - min) / (max - min);
        const thumbX = -width / 2 + percentage * width;

        fill.clear();
        fill.fillStyle(0x00d4ff);
        fill.fillRoundedRect(-width / 2, -height / 4, percentage * width, height / 2, height / 4);

        thumb.setX(thumbX);
    };

    const setValue = (val: number): void => {
        let newValue = Math.max(min, Math.min(max, val));
        if (step > 0) {
            newValue = Math.round(newValue / step) * step;
        }
        currentValue = newValue;
        updateFill(newValue);
        onChange?.(newValue);
    };

    const getValue = (): number => currentValue;

    thumb.on('drag', (_: unknown, dragX: number) => {
        const percentage = Math.max(0, Math.min(1, (dragX + width / 2) / width));
        const newValue = min + percentage * (max - min);
        setValue(newValue);
    });

    // Keyboard support
    scene.input.keyboard?.on('keydown-LEFT', () => setValue(currentValue - step));
    scene.input.keyboard?.on('keydown-RIGHT', () => setValue(currentValue + step));

    updateFill(value);

    return Object.assign(container, { setValue, getValue });
}
```

## Advanced UI/UX & Interaction Principles

### 1. Minimize Cognitive Load
* **Progressive Disclosure**: Reveal complex interface information sequentially and only as needed. Group fields and minimize actions to streamline step-by-step flows and reduce decision fatigue.
* **Fitts’s Law**: Size and space interactive elements appropriately. Position primary action buttons within easy reach and provide generous spacing to accelerate interaction and eliminate accidental taps.
* **Hick’s Law**: Reduce extraneous cognitive load by categorizing options and limiting the volume of choices visible at any given moment.
* **Miller’s Law**: Do not exceed the limits of human working memory; chunk complex data sets into smaller, manageable groups of seven (±two) items.
* **Gestalt Principles**: Group related elements visually using consistent colors, shapes, and proximity to establish an intuitive hierarchy.

### 2. Modern Typography & VW Scaling
* **Variable Fonts**: Implement variable fonts (WOFF2) rather than static families to load an entire range of weights, widths, and optical sizes within a single compact file. Map these attributes dynamically to screen sizes for responsive hierarchy.
* **Viewport-Scaled Architecture**: Elevate bold typography to the primary architectural layout layer by utilizing viewport-scaled (vw) text. Let typography carry the visual weight to replace heavy hero photography and minimize server requests.
* **Kinetic CSS Typography**: Avoid heavy JavaScript animations. Map font weight and width alterations to the user's scroll position, or apply lightweight CSS transitions to reveal text elegantly without lagging processors.

### 3. Advanced Layout Strategies
* **Strategic Grid Breaking**: Group design elements into overlapping container boxes that repurpose margins, providing clean structure while breaking traditional grid symmetry.
* **Bento Grid Reflow**: Do not duplicate the DOM to create separate bento grid layouts for desktop and mobile. Utilize state-aware CSS specifications (like native masonry) so dense information panels reflow dynamically into single-column mobile layouts without performance penalties.
* **Maximinimalism**: Combine minimalist utility foundations with energetic accents. Establish simple layouts with low element counts, but overlay high-impact features such as bright colors, strong imagery, and highly personalized, casual copywriting.
* **Carbon-Aware Interfaces**: Implement "Dark-First" default modes utilizing true black (#000000) to save OLED battery power. Substitute heavy photography with scalable vector graphics (SVGs) and pure CSS filters (like SVG noise/film grain) to synthesize tactile depth.

### 4. Game HUD Architectural Taxonomy
* **Diegetic HUD**: Place crucial status information directly within the 3D geometry and story fiction (e.g., health bar on a spacesuit spine) to maximize immersion and eliminate 2D overlays.
* **Meta HUD**: Position status indicators on the 2D screen plane that are directly linked to the narrative state but do not exist in the 3D geometry (e.g., blood splatters for health loss).
* **Spatial HUD**: Situate non-diegetic typography directly within the 3D environment (e.g., projecting mission objectives onto concrete walls or a glowing guide trail) to prevent breaking immersion with full-screen menus.
* **Non-Diegetic HUD**: Traditional customizable menus on the 2D plane separated from the game's story. Restrict their use to scenarios where other models fail to provide necessary legibility (e.g., deep inventory management).

### 5. Interface Learnability
* **Just-In-Time Reminders**: Trigger contextual prompts dynamically in response to specific, in-the-moment situations (e.g., showing a "climb down" cue only when hanging from a ledge).
* **The Invisible Hand**: Guide navigation seamlessly using organic, diegetic indicators blended into the environment (e.g., yellow tape on destructible objects or white markings on climbable surfaces).
* **Sandbox Practice**: When introducing a complex workflow, guide the user through a structured lesson and immediately direct them into an isolated sandbox where they must successfully execute the mechanic before progressing.

### 6. Structured Prompt Engineering for AI Motion
* **Chain-of-Thought Motion**: Construct interactive behaviors (like micro-animations on hover/click) using step-by-step logic frameworks.
* **Simplicity over Layering**: Favor synchronized transitions (where color changes, text updates, and scaling occur simultaneously) as they feel simple and natural, avoiding over-layered, multi-step sequential animations that increase cognitive load.

## Platform-Specific Ergonomics & UX Constraints

Ensure all game user interfaces are tailored to the physical constraints, viewing distances, and input limitations of the target platform:

### 1. Mobile UX (The Glass Screen Experience)
*   **Finger Occlusion**: Be mindful that thumbs cover up to **33%** of the screen during play.
*   **Thumb Zones**: Place all primary, frequent interactive elements in the bottom corners of the screen (natural resting positions for thumbs).
*   **Touch Targets (Fat Finger Rule)**: Interactive elements must have a minimum touch target size of **44x44 pixels (or 10-15mm)**. Add an invisible padding buffer around small icons so the touch area remains large.
*   **Safe Areas**: Anchor HUD elements dynamically relative to screen borders; respect Apple/Google notch and camera cutouts ("Safe Zones").
*   **Ergonomic Grip Performance**: Design for landscape layout. Empirical research shows a two-handed landscape grip increases Fitts' Law index of performance by **9%**, tap precision by **4%**, speed by **7%**, and dampens device movement by **36-63%** relative to one-handed portrait use.

### 2. Console UX (The 10-Foot Experience)
*   **Distance Constraint**: Players typically sit 10 feet away. Text, prompts, and icons must be large and high-contrast (e.g. Playstation buttons can blur easily).
*   **Linear & Radial Navigation**: Optimize menus for D-pad and analog sticks. Tabbed menu layouts and Radial (pie) menus are much easier to navigate than pointer-style grids.
*   **Magnetic Snapping**: Implement magnetic snapping or highlight focus on interactive elements as the player navigates with an analog stick to compensate for the lack of cursor precision.

### 3. PC UX (Precision & Density)
*   **High Precision**: Sited <5 feet away, mouse/keyboard inputs allow high-density grids, complex list-based UIs, and small details.
*   **Remapping & Scaling**: Always support custom keybindings (including mouse auxiliary buttons) and UI scale sliders.

### 4. Specialized Inventory Paradigms
*   **Grid-Based**: Great for space-management or survival gameplay (e.g. *Resident Evil*). Visually rich, but requires more art assets and is harder to navigate via gamepad D-pad.
*   **List-Based**: Best for games with massive items/attributes (e.g. *Skyrim*). Easy to code, highly compatible with console D-pad scrolling, and allows rapid sorting by weight, value, or category.

## Layout Systems

### Grid Layout

```typescript
export interface GridConfig {
    columns: number;
    rows?: number;
    cellWidth: number;
    cellHeight: number;
    gapX: number;
    gapY: number;
    padding?: number;
}

export function createGrid(
    items: Phaser.GameObjects.GameObject[],
    config: GridConfig
): Container {
    const {
        columns,
        cellWidth,
        cellHeight,
        gapX,
        gapY,
        padding = 0,
    } = config;

    const container = new Phaser.GameObjects.Container(this.scene, 0, 0);

    items.forEach((item, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);

        const x = padding + col * (cellWidth + gapX) + cellWidth / 2;
        const y = padding + row * (cellHeight + gapY) + cellHeight / 2;

        item.setPosition(x, y);
        container.add(item);
    });

    return container;
}
```

### Flex Layout

```typescript
export type FlexDirection = 'row' | 'column';
export type FlexAlignment = 'start' | 'center' | 'end' | 'stretch';
export type FlexJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around';

export interface FlexConfig {
    direction: FlexDirection;
    alignItems: FlexAlignment;
    justifyContent: FlexJustify;
    gap: number;
    padding?: number;
    wrap?: boolean;
}

export function createFlex(
    items: Phaser.GameObjects.GameObject[],
    config: FlexConfig
): Container {
    const {
        direction,
        alignItems,
        justifyContent,
        gap,
        padding = 0,
        wrap = false,
    } = config;

    const container = new Phaser.GameObjects.Container(this.scene, 0, 0);
    let cursor = { x: padding, y: padding };
    let rowMaxHeight = 0;

    items.forEach((item) => {
        const bounds = item.getBounds();

        if (wrap && cursor.x + bounds.width > this.scene.cameras.main.width - padding) {
            cursor.x = padding;
            cursor.y += rowMaxHeight + gap;
            rowMaxHeight = 0;
        }

        // Position based on alignment
        let x = cursor.x;
        let y = cursor.y;

        if (alignItems === 'center') {
            y += rowMaxHeight / 2;
        } else if (alignItems === 'end') {
            y += rowMaxHeight;
        }

        item.setPosition(x, y);
        container.add(item);

        // Advance cursor
        if (direction === 'row') {
            cursor.x += bounds.width + gap;
            rowMaxHeight = Math.max(rowMaxHeight, bounds.height);
        } else {
            cursor.y += bounds.height + gap;
        }
    });

    return container;
}
```

## Screen Patterns

### Menu Screen

```typescript
export function createMenuScreen(scene: Phaser.Scene): Container {
    const { width, height } = scene.cameras.main;

    const container = scene.add.container(0, 0);

    // Background
    const bg = scene.add.graphics();
    createGradientBackground(bg, width, height, 0x0a0e27, 0x1a1040);
    container.add(bg);

    // Ambient particles
    createAmbientParticles(scene, 30);
    container.add(scene.add.graphics()); // Placeholder for particles

    // Title
    const title = scene.add.text(width / 2, 180, 'GAME TITLE', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#00d4ff',
    }).setOrigin(0.5).setShadow(0, 4, '#000000', 8);
    container.add(title);

    // Subtitle
    const subtitle = scene.add.text(width / 2, 230, 'Your tagline here', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '14px',
        color: '#8899aa',
    }).setOrigin(0.5);
    container.add(subtitle);

    // Buttons
    const playBtn = createButton(scene, width / 2, 350, {
        text: 'PLAY',
        style: 'primary',
        size: 'large',
        onClick: () => scene.scene.start('Gameplay'),
    });
    container.add(playBtn);

    const optionsBtn = createButton(scene, width / 2, 420, {
        text: 'OPTIONS',
        style: 'outline',
        onClick: () => showOptionsMenu(scene),
    });
    container.add(optionsBtn);

    // Best score
    const bestScore = SaveService.load<number>('best_score', 0);
    const scoreText = scene.add.text(width / 2, 520, `Best: ${bestScore}`, {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '14px',
        color: '#666666',
    }).setOrigin(0.5);
    container.add(scoreText);

    // Version
    const version = scene.add.text(width / 2, height - 20, 'v1.0.0', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '10px',
        color: '#444444',
    }).setOrigin(0.5);
    container.add(version);

    return container;
}
```

### HUD Layout

```typescript
export function createHUD(scene: Phaser.Scene): Container {
    const { width } = scene.cameras.main;

    const container = scene.add.container(0, 0);
    container.setDepth(1000);

    // Health bar (top-left)
    const healthBar = createProgressBar(scene, 80, 30, {
        width: 140,
        height: 16,
        value: playerHealth,
        maxValue: maxHealth,
        color: 0xff4444,
        showText: true,
    });
    container.add(healthBar);

    // Score (top-right)
    const scoreLabel = scene.add.text(width - 20, 15, 'SCORE', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#00d4ff',
        letterSpacing: 2,
    }).setOrigin(1, 0);
    container.add(scoreLabel);

    const scoreValue = scene.add.text(width - 20, 30, '0', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
    }).setOrigin(1, 0);
    container.add(scoreValue);

    // Combo indicator (center-top)
    const comboText = scene.add.text(width / 2, 30, '', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#ffd700',
    }).setOrigin(0.5).setAlpha(0);
    container.add(comboText);

    return container;
}
```

### Game Over Screen

```typescript
export function createGameOverScreen(scene: Phaser.Scene, score: number): Container {
    const { width, height } = scene.cameras.main;

    const container = scene.add.container(0, 0);

    // Overlay
    const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7)
        .setInteractive();
    container.add(overlay);

    // Panel
    const panel = createPanel(scene, width / 2, height / 2, {
        width: 320,
        height: 380,
        style: 'glass',
    });
    container.add(panel);

    // Title
    const title = scene.add.text(0, -140, 'GAME OVER', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '36px',
        fontStyle: 'bold',
        color: '#ff4444',
    }).setOrigin(0.5);
    panel.add(title);

    // Score display
    const scoreLabel = scene.add.text(0, -80, 'SCORE', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#00d4ff',
        letterSpacing: 3,
    }).setOrigin(0.5);
    panel.add(scoreLabel);

    const scoreValue = scene.add.text(0, -50, '0', {
        fontFamily: '"Outfit", sans-serif',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#ffd700',
    }).setOrigin(0.5);
    panel.add(scoreValue);

    // Animate score count-up
    animateCounter(scene, scoreValue, 0, score, 1500);

    // Star rating
    const stars = calculateStars(score);
    const starContainer = scene.add.container(0, 0);
    for (let i = 0; i < 3; i++) {
        const star = scene.add.text(-40 + i * 40, 20, i < stars ? '★' : '☆', {
            fontFamily: '"Outfit", sans-serif',
            fontSize: '36px',
            color: i < stars ? '#ffd700' : '#333333',
        }).setOrigin(0.5);
        starContainer.add(star);
    }
    panel.add(starContainer);

    // Buttons
    const retryBtn = createButton(scene, 0, 100, {
        text: 'RETRY',
        style: 'primary',
        onClick: () => scene.scene.start('Gameplay'),
    });
    panel.add(retryBtn);

    const menuBtn = createButton(scene, 0, 155, {
        text: 'MENU',
        style: 'outline',
        onClick: () => scene.scene.start('Menu'),
    });
    panel.add(menuBtn);

    return container;
}
```

## Animation Patterns

### Entrance Animations

```typescript
// Staggered fade-in
export function staggerFadeIn(
    items: Phaser.GameObjects.GameObject[],
    delay = 100,
    duration = 300
): void {
    items.forEach((item, index) => {
        item.setAlpha(0);
        item.setY(item.y + 20);

        scene.tweens.add({
            targets: item,
            alpha: 1,
            y: item.y - 20,
            delay: index * delay,
            duration,
            ease: 'Back.easeOut',
        });
    });
}

// Scale bounce in
export function scaleBounceIn(
    items: Phaser.GameObjects.GameObject[],
    delay = 100
): void {
    items.forEach((item, index) => {
        item.setScale(0);
        scene.tweens.add({
            targets: item,
            scaleX: 1,
            scaleY: 1,
            delay: index * delay,
            duration: 400,
            ease: 'Back.easeOut',
        });
    });
}
```

### Button Micro-interactions

```typescript
// Button hover scale
button.on('pointerover', () => {
    scene.tweens.add({
        targets: button,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 100,
        ease: 'Quad.easeOut',
    });
});

button.on('pointerout', () => {
    scene.tweens.add({
        targets: button,
        scaleX: 1,
        scaleY: 1,
        duration: 100,
        ease: 'Quad.easeOut',
    });
});

button.on('pointerdown', () => {
    scene.tweens.add({
        targets: button,
        scaleX: 0.95,
        scaleY: 0.95,
        duration: 50,
        ease: 'Quad.easeOut',
    });
});
```

### Screen Transitions

```typescript
// Fade transition
export function fadeTransition(
    scene: Phaser.Scene,
    from: string,
    to: string,
    duration = 300
): void {
    const { width, height } = scene.cameras.main;

    const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000)
        .setDepth(10000).setAlpha(0);

    scene.tweens.add({
        targets: overlay,
        alpha: 1,
        duration,
        onComplete: () => {
            scene.scene.start(to);
            overlay.setAlpha(1);
            scene.tweens.add({
                targets: overlay,
                alpha: 0,
                duration,
                onComplete: () => overlay.destroy(),
            });
        },
    });
}

// Wipe transition
export function wipeTransition(
    scene: Phaser.Scene,
    direction: 'left' | 'right' | 'up' | 'down',
    duration = 400,
    onMidpoint?: () => void
): Promise<void> {
    return new Promise((resolve) => {
        const { width, height } = scene.cameras.main;

        let wipeWidth, wipeHeight;
        if (direction === 'left' || direction === 'right') {
            wipeWidth = direction === 'left' ? width : -width;
            wipeHeight = 0;
        } else {
            wipeWidth = 0;
            wipeHeight = direction === 'up' ? height : -height;
        }

        const overlay = scene.add.rectangle(
            direction === 'right' || direction === 'up' ? -wipeWidth / 2 : wipeWidth / 2,
            direction === 'down' || direction === 'up' ? -wipeHeight / 2 : wipeHeight / 2,
            Math.abs(wipeWidth) || width,
            Math.abs(wipeHeight) || height,
            0x000000
        ).setDepth(10000);

        scene.tweens.add({
            targets: overlay,
            x: direction === 'right' || direction === 'up' ? width + wipeWidth / 2 : -wipeWidth / 2,
            y: direction === 'down' || direction === 'up' ? height + wipeHeight / 2 : -wipeHeight / 2,
            duration: duration / 2,
            ease: 'Quad.easeIn',
            onComplete: () => {
                onMidpoint?.();
                scene.tweens.add({
                    targets: overlay,
                    alpha: 0,
                    duration: duration / 2,
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        overlay.destroy();
                        resolve();
                    },
                });
            },
        });
    });
}
```

## Responsive Design

### Viewport Handling

```typescript
export function createResponsiveHUD(scene: Phaser.Scene): void {
    const { width, height } = scene.cameras.main;

    // Scale factor based on viewport
    const baseWidth = 480;
    const scaleFactor = Math.min(1, width / baseWidth);

    // Scale all HUD elements
    hudContainer.setScale(scaleFactor);

    // Reposition based on aspect ratio
    if (width > height) {
        // Landscape: move HUD to edges
        healthBar.setPosition(100 * scaleFactor, 30 * scaleFactor);
        scoreDisplay.setPosition(width - 100 * scaleFactor, 30 * scaleFactor);
    } else {
        // Portrait: standard positioning
        healthBar.setPosition(80 * scaleFactor, 30 * scaleFactor);
        scoreDisplay.setPosition(width - 80 * scaleFactor, 30 * scaleFactor);
    }
}
```

### Safe Area

```typescript
export function getSafeArea(scene: Phaser.Scene): { top: number; bottom: number; left: number; right: number } {
    // Account for notches and system UI
    const padding = 20;

    return {
        top: padding + scene.cameras.main.scrollY,
        bottom: scene.cameras.main.height - padding,
        left: padding + scene.cameras.main.scrollX,
        right: scene.cameras.main.width - padding,
    };
}
```

## Accessibility in UI

### Focus Management

```typescript
export class FocusManager {
    private focusableElements: HTMLElement[] = [];
    private currentFocusIndex = 0;

    public registerFocusable(element: HTMLElement): void {
        if (!element.hasAttribute('tabindex')) {
            element.setAttribute('tabindex', '0');
        }
        this.focusableElements.push(element);
    }

    public focusNext(): void {
        this.currentFocusIndex = (this.currentFocusIndex + 1) % this.focusableElements.length;
        this.focusableElements[this.currentFocusIndex].focus();
    }

    public focusPrevious(): void {
        this.currentFocusIndex = (this.currentFocusIndex - 1 + this.focusableElements.length) % this.focusableElements.length;
        this.focusableElements[this.currentFocusIndex].focus();
    }

    public clearFocus(): void {
        this.focusableElements.forEach((el) => el.blur());
    }
}
```

### Colorblind-Friendly Indicators

```typescript
export function createAccessibleIcon(
    scene: Phaser.Scene,
    x: number,
    y: number,
    type: 'danger' | 'safe' | 'info',
    style: 'shape' | 'pattern' | 'both' = 'both'
): Container {
    const container = scene.add.container(x, y);
    const size = 24;

    const colors = {
        danger: { color: 0xff4444, pattern: 'X' },
        safe: { color: 0x44ff44, pattern: '✓' },
        info: { color: 0x4488ff, pattern: 'i' },
    };

    const c = colors[type];

    // Shape indicator
    if (style === 'shape' || style === 'both') {
        const shape = scene.add.graphics();
        if (type === 'danger') {
            // Triangle
            shape.fillStyle(c.color);
            shape.fillTriangle(0, -size / 2, -size / 2, size / 2, size / 2, size / 2);
        } else if (type === 'safe') {
            // Circle
            shape.fillStyle(c.color);
            shape.fillCircle(0, 0, size / 2);
        } else {
            // Square
            shape.fillStyle(c.color);
            shape.fillRect(-size / 2, -size / 2, size, size);
        }
        container.add(shape);
    }

    // Pattern/text indicator
    if (style === 'pattern' || style === 'both') {
        const pattern = scene.add.text(0, 0, c.pattern, {
            fontFamily: '"Outfit", sans-serif',
            fontSize: `${size * 0.6}px`,
            fontStyle: 'bold',
            color: '#ffffff',
        }).setOrigin(0.5);
        container.add(pattern);
    }

    return container;
}
```

## UI Quality Checklist

### Visual Quality
- [ ] Typography follows scale (max 3 sizes per screen)
- [ ] Color roles/emphasis match the approved design system/reference (no universal palette ratio)
- [ ] Contrast ratios meet WCAG AA (4.5:1 text, 3:1 UI)
- [ ] Consistent spacing (8px grid)
- [ ] Visual hierarchy clear

### Interaction Quality
- [ ] All buttons have hover states
- [ ] All buttons have press states
- [ ] Disabled states clearly visible
- [ ] Loading states indicate activity
- [ ] Focus indicators visible (keyboard nav)

### Animation Quality
- [ ] Transitions smooth (no jarring jumps)
- [ ] Durations appropriate (200-500ms)
- [ ] Easing natural (ease-out for entrances)
- [ ] Staggered animations for lists
- [ ] Reduced motion option respected

### Accessibility Quality
- [ ] Color not sole indicator (shapes/icons too)
- [ ] Touch targets ≥ 48×48px
- [ ] Text scalable
- [ ] High contrast mode available
- [ ] Screen reader labels where needed

### Performance Quality
- [ ] No off-screen rendering
- [ ] Pooled objects where applicable
- [ ] Minimal draw calls
- [ ] Texture atlases used
- [ ] Responsive to viewport changes

## Common Mistakes

| # | Mistake | Why It Fails | Solution |
|---|---------|---------------|----------|
| 1 | Too many font sizes | Visual noise | Max 3 per screen |
| 2 | Low contrast text | Hard to read | Meet 4.5:1 ratio |
| 3 | No hover states | Unclear interactivity | Scale + color change |
| 4 | Tiny touch targets | Missed taps | 48×48px (or 10-15mm) minimum |
| 5 | No disabled states | Confusing UI | Gray out + reduce opacity |
| 6 | Animations too fast | Abrupt feel | 200-500ms durations |
| 7 | Static UI | Feels dead | Subtle idle animations |
| 8 | Inconsistent spacing | Messy layout | 8px grid system |
| 9 | No loading states | Appears frozen | Spinners, progress bars |
| 10 | Color-only feedback | Inaccessible | Add icons, patterns |
| 11 | Uniform line height multiplier | Headings float apart like they had a fight | Reduce multiplier to 1.1x-1.2x for massive headings; keep 1.4x-1.5x for body text. |
| 12 | Excessive reading line width | Disrupted reading rhythm | Keep text width bound between 45 and 75 characters per line (sweet spot 60-65 chars). |
| 13 | Stat-bloat in skill trees | Choice paralysis and boredom | Limit to meaningful gameplay milestones; support color-coding and search keyword filters. |

## Execution Checklist

### Design Foundation
- [ ] Typography system extracted/approved (family, scale, weights, fallbacks)
- [ ] Color palette created (backgrounds, primary, semantic)
- [ ] Spacing system (8px grid)
- [ ] Design tokens exported

### Component Library
- [ ] Button (all 5 styles, 3 sizes, states)
- [ ] Panel/Card (default, glass, solid)
- [ ] Progress bar (with/without label)
- [ ] Slider (with keyboard support)
- [ ] Input field (text, number)
- [ ] Toggle switch
- [ ] Dropdown/Select
- [ ] Modal/Dialog
- [ ] Toast/Notification

### Screen Templates
- [ ] Menu screen
- [ ] HUD layout
- [ ] Game Over screen
- [ ] Settings screen
- [ ] Pause menu
- [ ] Achievement popup

### Interactions
- [ ] Button hover/press animations
- [ ] Screen transitions (fade, wipe)
- [ ] Staggered list animations
- [ ] Loading spinners
- [ ] Score count-up animation
- [ ] Star rating animation

### Responsive
- [ ] Portrait layout
- [ ] Landscape layout
- [ ] Safe area handling
- [ ] Scale factor applied

### Accessibility
- [ ] Focus management
- [ ] High contrast mode
- [ ] Reduced motion support
- [ ] Colorblind-friendly icons
