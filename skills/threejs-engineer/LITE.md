---
name: threejs-engineer
description: "Orchestrates WebGL rendering pipelines, scene graphs, custom shaders, and 3D asset loaders via Three.js. Use when the user requests 3D interactive visualizations, browser-based games, custom GPU shaders, GLTF/GLB assets integration, or WebGL performance optimizations."
version: 1.0.0
---

# Threejs Engineer (LITE)

## SOLVE Step 2: GROUND (Threejs Engineer Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Target Three.js and associated packages are installed in the workspace | `cat package.json \| jq '.dependencies["three"]'` | ... | run the check command and paste output |
| Existing WebGL components, canvases, or scenes are indexed | `find src/ -name "*canvas*" -o -name "*three*" -o -name "*scene*"` | ... | run the check command and paste output |
| Playwright test harness is configured for Visual Regression Testing (VRT) | `cat playwright.config.ts` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Threejs Engineer Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. ALIGN | Map coordinate systems (e.g., Blender Z-up to Three.js Y-up) and camera bounds | Ensure clipping planes (`near`/`far`), field of view (`fov`), and canvas aspect ratios are configured dynamically.
2. COMPILE | Create or optimize WebGL shader programs and material configurations | Verify custom glsl fragment and vertex shaders compile without syntax errors or register limits.
3. LOAD | Load and traverse GLTF/GLB models using standard `GLTFLoader` engines | Validate that all loaded meshes utilize unified buffers, optimized geometries, and correct textures.
4. SNAP | Capture rendering frames via local Playwright visual regression tests | Verify pixel-level render outputs against standard baseline snapshots to identify visual drift.

## Common Mistakes Checklist
- **WebGL Memory leak via undisposed resources**: Creating new geometry, materials, or textures programmatically inside render or animation updates without calling `.dispose()`, triggering eventual GPU crashes.
- **NPOT (Non-Power-of-Two) texture sizes**: Loading custom images or textures that do not utilize power-of-two dimensions (e.g., 512x512 or 1024x1024), breaking mipmap generation on older mobile GPUs.
- **Mismatched light and material types**: Implementing PBR materials (e.g., `MeshStandardMaterial`) without configuring active lighting in the scene, resulting in fully black renders.
- **Non-compliant naming patterns**: Saving documentation, test assets, or shader files using uppercase letters, camelCase, or spaces instead of strictly lowercase kebab-case (e.g., `threejs-renderer-audit.md`).

### Step 1: Check Three.js dependency version in package.json
```bash
cat package.json | grep -E "three"
```

### Step 2: Implement a lightweight, optimized WebGL renderer under `src/threejs-scene.ts`
```typescript
import * as THREE from 'three';

export function createInteractiveScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });

  // Set up standard lighting for PBR material compatibility
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);

  // Generate a mesh using reusable geometries and materials
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.4 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  camera.position.z = 5;

  let animationFrameId: number;

  const animate = () => {
    animationFrameId = requestAnimationFrame(animate);
    // Safe: keep lightweight rotations inside the loop to preserve high FPS
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
  };

  animate();

  // Return explicit teardown hooks to prevent WebGL context memory leaks
  return {
    scene,
    renderer,
    dispose: () => {
      cancelAnimationFrame(animationFrameId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    }
  };
}
```

### Step 3: Run regression tests to verify canvas rendering
```bash
npx playwright test tests/visual-regression.spec.ts
```

## Runtime Lifecycle

Start anything long-running (dev server, editor, emulator, watcher, container) with
`bash scripts/runtime/dev-run.sh --role <role> -- <command>`. It reuses an instance that is
already up instead of starting a second one, and registers a lease so the process is
reclaimed instead of leaking a port and its RAM. Close the turn with VERIFY Template 4
(RUNTIME LEDGER). See [ADR-010](../../docs/adr/ADR-010-runtime-lifecycle-guard.md).
