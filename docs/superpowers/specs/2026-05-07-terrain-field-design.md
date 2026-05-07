# Terrain Field System — Design Spec
**Date:** 2026-05-07
**Project:** CoreStudio Sem2Final

---

## Overview

Add a conceptual-density terrain layer rendered behind nodes and edges. Clusters of nearby nodes produce higher terrain — representing accumulated thought. Visual only for now; exposes a reusable API for particles later.

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

Reads directly from the global `fragments` array (same source used by `particles.js`). Uses `fragment.x` and `fragment.y` (world coordinates). Does not depend on relationship count, type, or any other fragment field.

---

## Density Formula

For each node:
```js
density += 1.0 * exp(-distanceSquared / (TERRAIN_RADIUS * TERRAIN_RADIUS))
```

Then apply stable noise distortion:
```js
density *= 0.85 + TERRAIN_NOISE_STRENGTH * noise2D(x * TERRAIN_NOISE_SCALE, y * TERRAIN_NOISE_SCALE)
```

- Base weight: `1.0`
- Radius: `TERRAIN_RADIUS = 320px`
- Noise is value-noise (no external libraries), stable over time — no time parameter
- Noise distorts the field shape, not node positions

---

## Noise Function

Small local value-noise implementation (no dependencies):

```js
function noise2D(x, y) {
  function h(n) { n = (n ^ (n >> 7)) * 0x45d9f3b; return ((n ^ (n >> 4)) & 0xff) / 255; }
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const u = fx*fx*(3-2*fx), v = fy*fy*(3-2*fy);
  return h(X+Y*57)*(1-u)*(1-v) + h(X+1+Y*57)*u*(1-v)
       + h(X+(Y+1)*57)*(1-u)*v + h(X+1+(Y+1)*57)*u*v;
}
```

---

## Cache

- `Float32Array` of density values, one per grid cell covering the visible world-space region
- Grid step: `TERRAIN_GRID_SIZE = 32px`
- Viewport world-space bounds computed from canvas transform: `worldMinX = -state.x / state.scale`, `worldMinY = -state.y / state.scale`, `worldMaxX = worldMinX + canvasWidth / state.scale`, `worldMaxY = worldMinY + canvasHeight / state.scale`
- Terrain is drawn in world coordinates (ctx already has world transform applied when `draw(ctx)` is called)
- Invalidated each frame by comparing:
  - `fragments.length` (node count changed)
  - Position hash: sum of all `Math.round(f.x) + Math.round(f.y)` (node moved)
  - Canvas transform `x`, `y`, `scale` against last-known values (threshold: >1px or >0.005 scale delta)
- On invalidation: recalculate full grid, log `[Terrain] recalculated`
- If `fragments.length === 0`: skip all drawing, log `[Terrain] skipped: no nodes`, clear cache

---

## Rendering

**Contour bands** (five thresholds, drawn back-to-front — lowest first):

| Threshold | Color (RGB) | Alpha |
|-----------|-------------|-------|
| 0.18 | `180, 200, 165` pale sage | 0.14 |
| 0.32 | `155, 180, 140` sage | 0.20 |
| 0.48 | `130, 160, 115` moss sage | 0.26 |
| 0.65 | `110, 140, 95` deeper moss | 0.32 |
| 0.82 | `90, 120, 75` rich moss | 0.38 |

**Per grid cell above threshold:** draw a soft radial gradient arc (radius ~1.3× grid step). Not a filled square — adjacent arcs blend into organic blobs.

**Blur pass:** `ctx.filter = 'blur(5px)'` applied around the entire terrain draw pass, reset after. Smooths contour edges without per-pixel code.

**Background:** `#F3ECDC` (existing app background, already filled by particle canvas).

---

## Performance

- Grid sampled at 32px — ~700–1200 cells for a typical viewport
- Cache recalculated only when dirty; `draw()` otherwise just replays from cache
- No per-pixel operations
- Viewport-scoped: only sample cells within the visible canvas area

---

## Debug Constants

At the top of `terrain.js`:

```js
const TERRAIN_ENABLED        = true;
const TERRAIN_RADIUS         = 320;
const TERRAIN_GRID_SIZE      = 32;
const TERRAIN_NOISE_SCALE    = 0.008;
const TERRAIN_NOISE_STRENGTH = 0.3;
```

---

## Clear All Behavior

When `fragments` is cleared to zero nodes:
- Cache is invalidated immediately
- `draw()` returns early without rendering anything
- No ghost terrain persists

---

## Out of Scope (this spec)

- Particle repulsion / interaction with terrain
- Animated terrain (no time-based noise)
- Per-type node weight differences (kept subtle and uniform)
- Any changes to node data structure, API prompts, or parsing
