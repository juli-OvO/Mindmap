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

let _cache = null;       // { f, cols, rows, worldMinX, worldMinY }
let _offscreen = null;   // HTMLCanvasElement, screen-space pixel dimensions
let _offCtx = null;
let _dirty = true;

// Last-known values for dirty detection
let _lastLen = -1;
let _lastPosHash = NaN;
let _lastWtHash  = NaN;
let _lastTx = NaN, _lastTy = NaN, _lastScale = NaN;

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

function _rebuildOffscreen(W, H, state, dpr) {
  // implemented in Task 4 and 5
}

window.Terrain = {
  draw(ctx)                   {},
  getTerrainDensityAt(x, y)  { return 0; },
  getTerrainHeightAt(x, y)   { return 0; },
  getTerrainGradientAt(x, y) { return { dx: 0, dy: 0 }; },
  invalidate()                {},
};
