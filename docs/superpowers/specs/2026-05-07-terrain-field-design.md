# Terrain Field System — Design Spec
**Date:** 2026-05-07
**Project:** CoreStudio Sem2Final

---

## Overview

Add a conceptual-density terrain layer rendered behind nodes and edges. Clusters of nearby nodes produce higher terrain — representing accumulated thought. Heavier nodes (anchor, decision) create tall peaks with many tight contour rings; lighter nodes (reference, suggestion) produce shallow imprints on outer bands only. Visual only for now; exposes a reusable API for particles later.

---

## Architecture

### New file: `terrain.js`

A single self-contained file. Loaded via `<script>` tag in `index.html` before `particles.js`. Exposes a global `window.Terrain` object.

**Changes to existing files:**
- `index.html`: +1 `<script src="terrain.js">` tag before `particles.js`
- `particles.js`: +1 line at the top of `renderParticles()`: `if (window.Terrain) window.Terrain.draw(ctx);`
- No other existing files change.

---

## Public API

```js
window.Terrain = {
  draw(ctx),                   // called by particles.js every frame
  getTerrainDensityAt(x, y),  // world coords → raw density value (0..n)
  getTerrainHeightAt(x, y),   // normalized 0..1
  getTerrainGradientAt(x, y), // { dx, dy } normalized gradient vector
  invalidate(),               // force cache recalculation next frame
}
```

`getTerrainDensityAt` and `getTerrainGradientAt` use bilinear interpolation from the cached grid so particles can call them cheaply without resampling.

`invalidate()` is the single external entry point — `app.js` does not need to know about cache internals.

---

## Data Source

Reads directly from the global `fragments` array (same source used by `particles.js`). Uses `fragment.x`, `fragment.y` (world coordinates) and `fragment.weight` (drives terrain peak height). Does not depend on relationship count or type.

---

## Density Formula

For each node, weight is remapped to the range 0.2 → 1.6 based on the spread of weights across all current fragments:

```js
// remap fragment.weight to [0.2, 1.6]
const wMin = Math.min(...fragments.map(f => f.weight));
const wMax = Math.max(...fragments.map(f => f.weight));
const terrainWeight = 0.2 + (f.weight - wMin) / (wMax - wMin + 1e-6) * 1.4;

density += terrainWeight * exp(-distanceSquared / (TERRAIN_RADIUS * TERRAIN_RADIUS))
```

Then apply stable noise distortion:

```js
density *= (1 - TERRAIN_NOISE_STRENGTH) + TERRAIN_NOISE_STRENGTH * 2 * fbm(x * TERRAIN_NOISE_SCALE, y * TERRAIN_NOISE_SCALE)
```

- Radius: `TERRAIN_RADIUS = 55px`
- Noise strength: `TERRAIN_NOISE_STRENGTH = 0.68`
- Noise is 4-octave fBm (no external libraries), stable over time — no time parameter
- Noise distorts field shape, not node positions

---

## Noise Function

4-octave fractional Brownian motion built from a local value-noise primitive:

```js
function valueNoise(x, y) {
  function h(n) { n = (n ^ (n >> 7)) * 0x45d9f3b; return ((n ^ (n >> 4)) & 0xff) / 255; }
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
  return h(X+Y*57)*(1-u)*(1-v) + h(X+1+Y*57)*u*(1-v)
       + h(X+(Y+1)*57)*(1-u)*v + h(X+1+(Y+1)*57)*u*v;
}

function fbm(x, y) {
  return valueNoise(x,y)*0.500 + valueNoise(x*2.1,y*2.1)*0.250
       + valueNoise(x*4.3,y*4.3)*0.125 + valueNoise(x*8.7,y*8.7)*0.0625;
}
```

---

## Cache

- `Float32Array` of density values, one per grid cell covering the visible world-space region
- Grid step: `TERRAIN_GRID_SIZE = 7px` (fine enough for marching squares)
- Viewport world-space bounds: `worldMinX = -state.x / state.scale`, `worldMinY = -state.y / state.scale`, `worldMaxX = worldMinX + canvasWidth / state.scale`, `worldMaxY = worldMinY + canvasHeight / state.scale`
- Terrain is drawn in world coordinates (ctx already has world transform applied when `draw(ctx)` is called)
- Invalidated each frame by comparing:
  - `fragments.length` (node count changed)
  - Position hash: sum of all `Math.round(f.x) + Math.round(f.y)` (node moved)
  - Weight hash: sum of all `f.weight` (weight changed)
  - Canvas transform `x`, `y`, `scale` against last-known values (threshold: >1px or >0.005 scale delta)
- On invalidation: recalculate full grid, log `[Terrain] recalculated`
- If `fragments.length === 0`: skip all drawing, log `[Terrain] skipped: no nodes`, clear cache

---

## Rendering

Two-pass draw: ghost fill first (barely visible), contour lines on top (primary visual).

### Pass 1 — Ghost fill (radial gradient arcs, no ctx.filter)

Seven bands drawn outer → inner. Each grid cell above threshold draws a soft radial gradient arc (radius 1.4× grid step). Adjacent arcs blend into organic shapes.

| Threshold | Fill RGB | Fill Alpha |
|-----------|----------|------------|
| 0.05 | 202, 214, 188 | 0.038 |
| 0.13 | 180, 200, 162 | 0.052 |
| 0.24 | 156, 183, 136 | 0.066 |
| 0.38 | 132, 161, 109 | 0.082 |
| 0.55 | 108, 140, 84  | 0.100 |
| 0.75 | 85, 117, 62   | 0.122 |
| 0.98 | 64, 96, 42    | 0.146 |

### Pass 2 — Contour lines (marching squares)

Same seven thresholds. Marching squares traces contour strokes at each level. Inner lines are thicker and more opaque than outer lines.

| Threshold | Line Color (RGBA) | Line Width |
|-----------|-------------------|------------|
| 0.05 | 148, 168, 126, 0.30 | 0.50 |
| 0.13 | 126, 154, 104, 0.38 | 0.65 |
| 0.24 | 105, 142, 82, 0.46  | 0.80 |
| 0.38 | 84, 126, 62, 0.53   | 0.95 |
| 0.55 | 64, 110, 44, 0.60   | 1.10 |
| 0.75 | 46, 92, 28, 0.67    | 1.25 |
| 0.98 | 30, 74, 16, 0.73    | 1.40 |

No `ctx.filter` used anywhere — pure canvas 2D for cross-browser compatibility.

---

## Performance

- Grid sampled at 7px — fine enough for smooth marching squares contours
- Cache recalculated only when dirty; `draw()` otherwise replays from cache
- No per-pixel operations
- Viewport-scoped: only sample cells within the visible canvas area

---

## Debug Constants

At the top of `terrain.js`:

```js
const TERRAIN_ENABLED         = true;
const TERRAIN_RADIUS          = 55;
const TERRAIN_GRID_SIZE       = 7;
const TERRAIN_NOISE_SCALE     = 0.021;
const TERRAIN_NOISE_STRENGTH  = 0.68;
const TERRAIN_WEIGHT_MIN      = 0.2;
const TERRAIN_WEIGHT_MAX      = 1.6;
```

---

## Clear All Behavior

When `fragments` is cleared to zero nodes:
- Cache invalidates immediately
- `draw()` returns early without rendering anything
- No ghost terrain persists

---

## Out of Scope (this spec)

- Particle repulsion / interaction with terrain
- Animated terrain (no time-based noise)
- Any changes to node data structure, API prompts, or parsing
