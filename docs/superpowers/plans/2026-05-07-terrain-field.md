# Terrain Field System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft organic terrain layer behind graph nodes — clusters of heavy nodes form tall topographic peaks with stacked contour rings, light nodes leave faint imprints.

**Architecture:** A new `terrain.js` file exposes `window.Terrain`. It maintains an offscreen canvas that caches the rendered terrain; `renderParticles()` blits it once per frame. The density field is rebuilt only when nodes move, are added/removed, or the viewport transform changes significantly. Contour bands are drawn as radial gradient arcs (fill) plus marching-squares strokes (lines).

**Tech Stack:** Vanilla JS, Canvas 2D API. No external libraries. Reads global `fragments[]` and `canvasState` from `data.js`.

---

## File Map

| Action | File | Notes |
|--------|------|-------|
| Create | `terrain.js` | All terrain logic; exports `window.Terrain` |
| Modify | `index.html:151` | Add `<script src="terrain.js"></script>` before particles.js |
| Modify | `particles.js:573` | Add one line: `if (window.Terrain) window.Terrain.draw(ctx);` after background clear |

---

## Task 1: Scaffold terrain.js + add script tag

**Files:**
- Create: `terrain.js`
- Modify: `index.html:150-151`

- [ ] **Step 1: Create terrain.js with constants and empty API**

```js
// ═══════════════════════════════════════════════════════════════
// TERRAIN FIELD SYSTEM
// Renders a conceptual-density terrain layer behind nodes.
// Reads from global `fragments` and `canvasState` (data.js).
// ═══════════════════════════════════════════════════════════════

const TERRAIN_ENABLED        = true;
const TERRAIN_RADIUS         = 55;
const TERRAIN_GRID_SIZE      = 7;
const TERRAIN_NOISE_SCALE    = 0.021;
const TERRAIN_NOISE_STRENGTH = 0.68;
const TERRAIN_WEIGHT_MIN     = 0.2;
const TERRAIN_WEIGHT_MAX     = 1.6;

window.Terrain = {
  draw(ctx)                   {},
  getTerrainDensityAt(x, y)  { return 0; },
  getTerrainHeightAt(x, y)   { return 0; },
  getTerrainGradientAt(x, y) { return { dx: 0, dy: 0 }; },
  invalidate()                {},
};
```

- [ ] **Step 2: Add script tag to index.html before particles.js**

In `index.html`, change line 151 from:
```html
<script src="particles.js"></script>
```
to:
```html
<script src="terrain.js"></script>
<script src="particles.js"></script>
```

- [ ] **Step 3: Open browser, verify no console errors**

Open the app. In DevTools console run:
```js
window.Terrain
```
Expected: object with draw, getTerrainDensityAt, getTerrainHeightAt, getTerrainGradientAt, invalidate.

- [ ] **Step 4: Commit**

```bash
git add terrain.js index.html
git commit -m "feat: scaffold terrain.js with empty API and script tag"
```

---

## Task 2: Noise functions

**Files:**
- Modify: `terrain.js` — add after constants, before `window.Terrain`

- [ ] **Step 1: Add valueNoise and fbm to terrain.js**

```js
function _valueNoise(x, y) {
  function h(n) { n = (n ^ (n >> 7)) * 0x45d9f3b; return ((n ^ (n >> 4)) & 0xff) / 255; }
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return h(X + Y*57)*(1-u)*(1-v) + h(X+1 + Y*57)*u*(1-v)
       + h(X + (Y+1)*57)*(1-u)*v + h(X+1 + (Y+1)*57)*u*v;
}

// 4-octave fBm — produces serpentine, organic distortion
function _fbm(x, y) {
  return _valueNoise(x,     y    ) * 0.5000
       + _valueNoise(x*2.1, y*2.1) * 0.2500
       + _valueNoise(x*4.3, y*4.3) * 0.1250
       + _valueNoise(x*8.7, y*8.7) * 0.0625;
  // Note: not normalized to 1.0 — raw sum ≈ 0..0.9375, used as-is
}
```

- [ ] **Step 2: Verify noise in console**

In DevTools console, paste and run (after page load):
```js
// Should print ~20 different values between 0 and 1
for (let i = 0; i < 5; i++)
  for (let j = 0; j < 4; j++)
    console.log(_fbm(i * 13.7, j * 17.3).toFixed(3));
```
Expected: values between 0 and ~0.95, all different, none NaN.

- [ ] **Step 3: Commit**

```bash
git add terrain.js
git commit -m "feat: add valueNoise and fbm noise functions to terrain"
```

---

## Task 3: Density field + dirty cache

**Files:**
- Modify: `terrain.js` — add cache state vars and field-building functions after noise functions

- [ ] **Step 1: Add cache state variables**

```js
let _cache = null;       // { f, cols, rows, worldMinX, worldMinY }
let _offscreen = null;   // HTMLCanvasElement, screen-space pixel dimensions
let _offCtx = null;
let _dirty = true;

// Last-known values for dirty detection
let _lastLen = -1;
let _lastPosHash = NaN;
let _lastWtHash  = NaN;
let _lastTx = NaN, _lastTy = NaN, _lastScale = NaN;
```

- [ ] **Step 2: Add weight remapping and density functions**

```js
function _remapWeight(w, wMin, wMax) {
  const span = wMax - wMin;
  if (span < 1e-6) return (TERRAIN_WEIGHT_MIN + TERRAIN_WEIGHT_MAX) / 2;
  return TERRAIN_WEIGHT_MIN + ((w - wMin) / span) * (TERRAIN_WEIGHT_MAX - TERRAIN_WEIGHT_MIN);
}

function _density(px, py, nodes, remappedWeights) {
  let d = 0;
  const R2 = TERRAIN_RADIUS * TERRAIN_RADIUS;
  for (let i = 0; i < nodes.length; i++) {
    const dx = px - nodes[i].x, dy = py - nodes[i].y;
    d += remappedWeights[i] * Math.exp(-(dx*dx + dy*dy) / R2);
  }
  const noise = _fbm(px * TERRAIN_NOISE_SCALE, py * TERRAIN_NOISE_SCALE);
  return d * ((1 - TERRAIN_NOISE_STRENGTH) + TERRAIN_NOISE_STRENGTH * 2 * noise);
}
```

- [ ] **Step 3: Add field builder**

```js
function _buildField(worldMinX, worldMinY, worldMaxX, worldMaxY, nodes, remappedWeights) {
  const cols = Math.ceil((worldMaxX - worldMinX) / TERRAIN_GRID_SIZE) + 2;
  const rows = Math.ceil((worldMaxY - worldMinY) / TERRAIN_GRID_SIZE) + 2;
  const f = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = worldMinX + c * TERRAIN_GRID_SIZE;
      const wy = worldMinY + r * TERRAIN_GRID_SIZE;
      f[r * cols + c] = _density(wx, wy, nodes, remappedWeights);
    }
  }
  return { f, cols, rows, worldMinX, worldMinY };
}
```

- [ ] **Step 4: Add dirty check function**

```js
function _checkDirty() {
  const frags = typeof fragments !== 'undefined' ? fragments : [];
  const state = typeof canvasState !== 'undefined' ? canvasState : { x:0, y:0, scale:1 };

  const len = frags.length;
  let posHash = 0, wtHash = 0;
  for (const f of frags) { posHash += Math.round(f.x) + Math.round(f.y); wtHash += f.weight || 1; }

  const txChanged = Math.abs(state.x - _lastTx) > 1 || Math.abs(state.y - _lastTy) > 1
                 || Math.abs(state.scale - _lastScale) > 0.005;

  if (len === _lastLen && posHash === _lastPosHash && wtHash === _lastWtHash && !txChanged && !_dirty) return;

  _lastLen = len; _lastPosHash = posHash; _lastWtHash = wtHash;
  _lastTx = state.x; _lastTy = state.y; _lastScale = state.scale;
  _dirty = false;

  if (len === 0) {
    console.log('[Terrain] skipped: no nodes');
    _cache = null; _offscreen = null; _offCtx = null;
    return;
  }

  console.log('[Terrain] recalculated');

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.getElementById('particle-canvas');
  const W = canvas ? canvas.width : window.innerWidth * dpr;
  const H = canvas ? canvas.height : window.innerHeight * dpr;

  const worldMinX = -state.x / state.scale;
  const worldMinY = -state.y / state.scale;
  const worldMaxX = W / (dpr * state.scale) + worldMinX;
  const worldMaxY = H / (dpr * state.scale) + worldMinY;

  const rawWeights = frags.map(f => f.weight || 1);
  const wMin = Math.min(...rawWeights), wMax = Math.max(...rawWeights);
  const remappedWeights = rawWeights.map(w => _remapWeight(w, wMin, wMax));

  _cache = _buildField(worldMinX, worldMinY, worldMaxX, worldMaxY, frags, remappedWeights);
  _rebuildOffscreen(W, H, state, dpr);
}
```

- [ ] **Step 5: Add stub for _rebuildOffscreen (will fill in Task 4+5)**

```js
function _rebuildOffscreen(W, H, state, dpr) {
  // implemented in Task 4 and 5
}
```

- [ ] **Step 6: Verify in console (add a node first, then run)**

```js
// In DevTools after adding at least one node to the graph:
_checkDirty();
console.log(_cache);
```
Expected: `_cache` is an object with `f` (Float32Array), `cols`, `rows`, `worldMinX`, `worldMinY`. Values in `f` should be > 0 near node positions.

- [ ] **Step 7: Commit**

```bash
git add terrain.js
git commit -m "feat: add density field builder and dirty-check cache to terrain"
```

---

## Task 4: Offscreen canvas + ghost fill pass

**Files:**
- Modify: `terrain.js` — implement `_rebuildOffscreen` (ghost fill portion)

- [ ] **Step 1: Define the 7 band palette (add near constants at top of file)**

```js
const _BANDS = [
  { t:0.05, r:202,g:214,b:188, fa:0.038, lc:[148,168,126,0.30], lw:0.50 },
  { t:0.13, r:180,g:200,b:162, fa:0.052, lc:[126,154,104,0.38], lw:0.65 },
  { t:0.24, r:156,g:183,b:136, fa:0.066, lc:[105,142, 82,0.46], lw:0.80 },
  { t:0.38, r:132,g:161,b:109, fa:0.082, lc:[ 84,126, 62,0.53], lw:0.95 },
  { t:0.55, r:108,g:140,b: 84, fa:0.100, lc:[ 64,110, 44,0.60], lw:1.10 },
  { t:0.75, r: 85,g:117,b: 62, fa:0.122, lc:[ 46, 92, 28,0.67], lw:1.25 },
  { t:0.98, r: 64,g: 96,b: 42, fa:0.146, lc:[ 30, 74, 16,0.73], lw:1.40 },
];
// lc = [r, g, b, alpha] for contour line color
```

- [ ] **Step 2: Implement _drawFillBand helper**

```js
function _drawFillBand(ctx, f, cols, rows, worldMinX, worldMinY, threshold, r, g, b, a) {
  const G = TERRAIN_GRID_SIZE;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (f[row * cols + col] < threshold) continue;
      const wx = worldMinX + col * G;
      const wy = worldMinY + row * G;
      const grad = ctx.createRadialGradient(wx, wy, 0, wx, wy, G * 1.6);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(wx, wy, G * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
```

- [ ] **Step 3: Implement _rebuildOffscreen with fill pass**

Replace the stub from Task 3 Step 5:

```js
function _rebuildOffscreen(W, H, state, dpr) {
  if (!_offscreen || _offscreen.width !== W || _offscreen.height !== H) {
    _offscreen = document.createElement('canvas');
    _offscreen.width  = W;
    _offscreen.height = H;
    _offCtx = _offscreen.getContext('2d');
  }

  _offCtx.clearRect(0, 0, W, H);

  // Apply the same world-space transform particles.js uses
  _offCtx.save();
  _offCtx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, dpr * state.x, dpr * state.y);

  const { f, cols, rows, worldMinX, worldMinY } = _cache;

  // Pass 1: ghost fills, outer bands first so inner bands paint over
  for (const b of _BANDS) {
    _drawFillBand(_offCtx, f, cols, rows, worldMinX, worldMinY, b.t, b.r, b.g, b.b, b.fa);
  }

  // Pass 2: contour lines — added in Task 5

  _offCtx.restore();
}
```

- [ ] **Step 4: Implement draw() to blit offscreen and hook dirty check**

Replace the empty `draw(ctx)` in `window.Terrain`:

```js
draw(ctx) {
  if (!TERRAIN_ENABLED) return;
  _checkDirty();
  if (!_offscreen) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);   // screen-pixel space — blit raw
  ctx.drawImage(_offscreen, 0, 0);
  ctx.restore();
},
```

- [ ] **Step 5: Add the one-line hook to particles.js**

In `particles.js`, after line 573 (`ctx.restore();` — end of background-clear block), add:

```js
  if (window.Terrain) window.Terrain.draw(ctx);
```

The section should now look like:
```js
  ctx.restore();                                         // line 573 — end background clear

  if (window.Terrain) window.Terrain.draw(ctx);         // ← ADD THIS

  const state = typeof canvasState !== "undefined" ? canvasState : { x: 0, y: 0, scale: 1 };
  ctx.save();
  ctx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, dpr * state.x, dpr * state.y);
```

- [ ] **Step 6: Browser verify — ghost fills visible**

Open the app, add 3–4 nodes close together. Expect:
- Soft translucent sage-green blobs visible behind the node cluster
- No blobs where there are no nodes
- No console errors

- [ ] **Step 7: Commit**

```bash
git add terrain.js particles.js
git commit -m "feat: terrain ghost fill pass with offscreen canvas caching"
```

---

## Task 5: Contour lines (marching squares)

**Files:**
- Modify: `terrain.js` — add `_marchLines` helper and wire into `_rebuildOffscreen`

- [ ] **Step 1: Add _marchLines function**

```js
function _marchLines(ctx, f, cols, rows, worldMinX, worldMinY, threshold, lineColor, lineWidth) {
  const [lr, lg, lb, la] = lineColor;
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},${la})`;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';

  const G = TERRAIN_GRID_SIZE;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function ei(v0, v1, t) {
    return Math.abs(v1 - v0) < 1e-4 ? 0.5 : Math.max(0, Math.min(1, (t - v0) / (v1 - v0)));
  }

  ctx.beginPath();

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = f[ r      * cols + c    ];
      const v10 = f[ r      * cols + c + 1];
      const v01 = f[(r + 1) * cols + c    ];
      const v11 = f[(r + 1) * cols + c + 1];

      const x0 = worldMinX + c * G;
      const y0 = worldMinY + r * G;

      const b00 = v00 >= threshold ? 1 : 0;
      const b10 = v10 >= threshold ? 1 : 0;
      const b01 = v01 >= threshold ? 1 : 0;
      const b11 = v11 >= threshold ? 1 : 0;
      const idx = b00 | b10 << 1 | b11 << 2 | b01 << 3;

      if (idx === 0 || idx === 15) continue;

      const top = [x0 + lerp(0, G, ei(v00, v10, threshold)), y0        ];
      const rgt = [x0 + G,                                   y0 + lerp(0, G, ei(v10, v11, threshold))];
      const bot = [x0 + lerp(0, G, ei(v01, v11, threshold)), y0 + G    ];
      const lft = [x0,                                        y0 + lerp(0, G, ei(v00, v01, threshold))];

      const segMap = {
         1: [lft, top],  2: [top, rgt],  3: [lft, rgt],
         4: [rgt, bot],  6: [top, bot],  7: [lft, bot],
         8: [bot, lft],  9: [bot, top], 11: [bot, rgt],
        12: [rgt, lft], 13: [rgt, top], 14: [lft, top],
      };

      let pairs;
      if      (idx === 5)  pairs = [[lft, top], [rgt, bot]];
      else if (idx === 10) pairs = [[top, rgt], [bot, lft]];
      else                 pairs = segMap[idx] ? [segMap[idx]] : null;

      if (!pairs) continue;
      for (const [p0, p1] of pairs) {
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
    }
  }

  ctx.stroke();
}
```

- [ ] **Step 2: Wire contour lines into _rebuildOffscreen**

In `_rebuildOffscreen`, after the fill loop (Pass 1), add Pass 2:

```js
  // Pass 2: contour lines at each threshold
  for (const b of _BANDS) {
    _marchLines(_offCtx, f, cols, rows, worldMinX, worldMinY, b.t, b.lc, b.lw);
  }
```

- [ ] **Step 3: Browser verify — contour lines visible**

Add a tight cluster of 4–5 nodes. Expect:
- Thin serpentine sage-green contour rings around the cluster
- Inner rings tighter and darker than outer rings
- Lines are organically distorted — not perfect circles
- Lines do not flicker (stable, no time component)

- [ ] **Step 4: Verify terrain updates when nodes move**

Drag a node to a new position. Expect:
- Terrain redraws to match new node position
- Console prints `[Terrain] recalculated` when node stops moving (or within 1 frame)

- [ ] **Step 5: Commit**

```bash
git add terrain.js
git commit -m "feat: add marching squares contour lines to terrain renderer"
```

---

## Task 6: Public query API

**Files:**
- Modify: `terrain.js` — implement the three query functions and `invalidate()`

- [ ] **Step 1: Implement getTerrainDensityAt with bilinear interpolation**

Replace the stub in `window.Terrain`:

```js
getTerrainDensityAt(x, y) {
  if (!_cache) return 0;
  const { f, cols, rows, worldMinX, worldMinY } = _cache;
  const col = (x - worldMinX) / TERRAIN_GRID_SIZE;
  const row = (y - worldMinY) / TERRAIN_GRID_SIZE;
  const c0 = Math.floor(col), r0 = Math.floor(row);
  const c1 = c0 + 1,          r1 = r0 + 1;
  if (c0 < 0 || r0 < 0 || c1 >= cols || r1 >= rows) return 0;
  const fx = col - c0, fy = row - r0;
  return f[ r0 * cols + c0] * (1-fx) * (1-fy)
       + f[ r0 * cols + c1] *    fx  * (1-fy)
       + f[ r1 * cols + c0] * (1-fx) *    fy
       + f[ r1 * cols + c1] *    fx  *    fy;
},
```

- [ ] **Step 2: Implement getTerrainHeightAt**

Replace the stub in `window.Terrain`:

```js
getTerrainHeightAt(x, y) {
  const raw = this.getTerrainDensityAt(x, y);
  // Clamp and normalize — density beyond ~2.0 is "saturated peak"
  return Math.min(1, raw / 2.0);
},
```

- [ ] **Step 3: Implement getTerrainGradientAt**

Replace the stub in `window.Terrain`:

```js
getTerrainGradientAt(x, y) {
  const eps = TERRAIN_GRID_SIZE;
  const dx = this.getTerrainDensityAt(x + eps, y) - this.getTerrainDensityAt(x - eps, y);
  const dy = this.getTerrainDensityAt(x, y + eps) - this.getTerrainDensityAt(x, y - eps);
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { dx: dx / len, dy: dy / len };
},
```

- [ ] **Step 4: Implement invalidate()**

Replace the stub in `window.Terrain`:

```js
invalidate() {
  _dirty = true;
},
```

- [ ] **Step 5: Verify query functions in console**

Add 2–3 nodes to the graph. In DevTools console:

```js
// Position near a node — should return a value > 0
const f = fragments[0];
console.log('density at node:', Terrain.getTerrainDensityAt(f.x, f.y).toFixed(3));
console.log('height at node:', Terrain.getTerrainHeightAt(f.x, f.y).toFixed(3));
console.log('gradient at node:', Terrain.getTerrainGradientAt(f.x, f.y));

// Far from any node — should return ~0
console.log('density far away:', Terrain.getTerrainDensityAt(9999, 9999).toFixed(3));
```

Expected:
- Density at node > 0 (should be ~0.3–1.5 depending on weight)
- Height at node between 0 and 1
- Gradient is `{ dx: number, dy: number }` with length ≈ 1
- Density far away ≈ 0

- [ ] **Step 6: Commit**

```bash
git add terrain.js
git commit -m "feat: implement terrain public query API with bilinear interpolation"
```

---

## Task 7: Full browser verification

**Files:** none — verification only

- [ ] **Step 1: Verify node weight hierarchy**

Add one anchor node and three reference nodes clustered near each other. Expect:
- The anchor node (higher weight) has more contour rings stacked around it than the reference nodes
- The reference nodes show fewer, lighter rings

- [ ] **Step 2: Verify clear-all removes terrain**

Click the "clear all" button. Expect:
- Terrain disappears immediately — no ghost blobs remain
- Console prints `[Terrain] skipped: no nodes`

- [ ] **Step 3: Verify pan/zoom updates terrain**

Zoom in and pan around with several nodes present. Expect:
- Terrain redraws to fill the viewport as you pan
- Console prints `[Terrain] recalculated` when viewport settles
- No visible seam or mismatch between terrain and node positions

- [ ] **Step 4: Verify terrain sits behind nodes and particles**

Nodes (DOM elements) and particles should render on top of terrain. Expect:
- Node labels are fully readable
- Terrain does not overpower the graph UI
- Particles flow visibly over the terrain

- [ ] **Step 5: Commit final verification state**

```bash
git add terrain.js particles.js index.html
git commit -m "feat: terrain field system complete — organic contour background behind nodes"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ terrain.js new file, script tag in index.html, one-line hook in particles.js
- ✅ getTerrainDensityAt, getTerrainHeightAt, getTerrainGradientAt, draw, invalidate exposed
- ✅ Density: Gaussian with TERRAIN_RADIUS=55, per-node weight remapped from fragment.weight
- ✅ fBm noise (4 octaves), TERRAIN_NOISE_SCALE=0.021, TERRAIN_NOISE_STRENGTH=0.68, stable (no time param)
- ✅ 7 contour bands: ghost fill (radial gradient arcs) + marching squares strokes
- ✅ Warm sage botanical palette
- ✅ Offscreen canvas caching — redraws only on dirty (node add/move/delete, viewport change)
- ✅ fragments.length === 0 → clears cache, logs [Terrain] skipped: no nodes
- ✅ Debug constants at top of terrain.js
- ✅ No ctx.filter (cross-browser safe)
- ✅ No particle repulsion implemented
- ✅ No external libraries
- ✅ No changes to node data structure, API prompts, or parsing
