// ═══════════════════════════════════════════════════════════════
// TERRAIN FIELD SYSTEM
// Renders a conceptual-density terrain layer behind nodes.
// Reads from global `fragments` and `canvasState` (data.js).
// ═══════════════════════════════════════════════════════════════

const TERRAIN_ENABLED        = true;
const TERRAIN_RADIUS         = 305;
const TERRAIN_GRID_SIZE      = 7;
const TERRAIN_NOISE_SCALE    = 0.01;
const TERRAIN_NOISE_STRENGTH = 0.68;
const TERRAIN_WEIGHT_MIN     = 0.07;
const TERRAIN_WEIGHT_MAX     = 0.60;

const _BANDS = [
  { t:0.05, r:202,g:214,b:188, fa:0.038, lc:[148,168,126,0.30], lw:0.50 },
  { t:0.13, r:180,g:200,b:162, fa:0.052, lc:[126,154,104,0.38], lw:0.65 },
  { t:0.24, r:156,g:183,b:136, fa:0.066, lc:[105,142, 82,0.46], lw:0.80 },
  { t:0.38, r:132,g:161,b:109, fa:0.082, lc:[ 84,126, 62,0.53], lw:0.95 },
  { t:0.55, r:108,g:140,b: 84, fa:0.100, lc:[ 64,110, 44,0.60], lw:1.10 },
  { t:0.75, r: 85,g:117,b: 62, fa:0.122, lc:[ 46, 92, 28,0.67], lw:1.25 },
  { t:0.98, r: 64,g: 96,b: 42, fa:0.146, lc:[ 30, 74, 16,0.73], lw:1.40 },
];
// t=density threshold, r/g/b=fill color, fa=fill alpha, lc=[r,g,b,a] line color, lw=line width

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
let _offscreen = null;   // HTMLCanvasElement, world-space pixel dimensions (no dpr/scale)
let _offCtx = null;
let _dirty = true;

// Last-known values for dirty detection
let _lastLen = -1;
let _lastPosHash = NaN;
let _lastWtHash  = NaN;

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
  const len = frags.length;
  let posHash = 0, wtHash = 0;
  for (let i = 0; i < frags.length; i++) { posHash += Math.round(frags[i].x) * 31 + Math.round(frags[i].y) * 17 + i * 7; wtHash += frags[i].weight || 1; }

  if (len === _lastLen && posHash === _lastPosHash && wtHash === _lastWtHash && !_dirty) return;

  _lastLen = len; _lastPosHash = posHash; _lastWtHash = wtHash;
  _dirty = false;

  if (len === 0) {
    console.log('[Terrain] skipped: no nodes');
    _cache = null; _offscreen = null; _offCtx = null;
    return;
  }

  console.log('[Terrain] recalculated');

  // Node-centric bounds — terrain covers node cluster, not viewport
  const pad = TERRAIN_RADIUS * 2;
  let wxMin = Infinity, wyMin = Infinity, wxMax = -Infinity, wyMax = -Infinity;
  for (const fr of frags) {
    if (fr.x - pad < wxMin) wxMin = fr.x - pad;
    if (fr.y - pad < wyMin) wyMin = fr.y - pad;
    if (fr.x + pad > wxMax) wxMax = fr.x + pad;
    if (fr.y + pad > wyMax) wyMax = fr.y + pad;
  }

  if (typeof updateFragmentWeights === 'function') updateFragmentWeights(frags);
  const rawWeights = frags.map(f => f.weight || 1);
  const wMin = Math.min(...rawWeights), wMax = Math.max(...rawWeights);
  const remappedWeights = rawWeights.map(w => _remapWeight(w, wMin, wMax));

  _cache = _buildField(wxMin, wyMin, wxMax, wyMax, frags, remappedWeights);
  _rebuildOffscreen();
}

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

// Module-level: maps marching squares case index to edge pair names
// Each value is [edge1, edge2] where edges are 'top'|'rgt'|'bot'|'lft'
const _MARCH_EDGES = {
   1: ['lft','top'],  2: ['top','rgt'],  3: ['lft','rgt'],
   4: ['rgt','bot'],  6: ['top','bot'],  7: ['lft','bot'],
   8: ['bot','lft'],  9: ['bot','top'], 11: ['bot','rgt'],
  12: ['rgt','lft'], 13: ['rgt','top'], 14: ['lft','top'],
};

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

      const edges = { top, rgt, bot, lft };

      let pairs;
      if      (idx === 5)  pairs = [['lft','top'], ['rgt','bot']];
      else if (idx === 10) pairs = [['top','rgt'], ['bot','lft']];
      else                 pairs = _MARCH_EDGES[idx] ? [_MARCH_EDGES[idx]] : null;

      if (!pairs) continue;
      for (const [e0, e1] of pairs) {
        ctx.moveTo(edges[e0][0], edges[e0][1]);
        ctx.lineTo(edges[e1][0], edges[e1][1]);
      }
    }
  }

  ctx.stroke();
}

function _rebuildOffscreen() {
  const { f, cols, rows, worldMinX, worldMinY } = _cache;
  const W = Math.ceil((cols - 1) * TERRAIN_GRID_SIZE);
  const H = Math.ceil((rows - 1) * TERRAIN_GRID_SIZE);

  if (!_offscreen || _offscreen.width !== W || _offscreen.height !== H) {
    _offscreen = document.createElement('canvas');
    _offscreen.width  = W;
    _offscreen.height = H;
    _offCtx = _offscreen.getContext('2d');
  }

  _offCtx.clearRect(0, 0, W, H);

  // Render in world space: translate so (worldMinX, worldMinY) maps to (0, 0) in offscreen
  _offCtx.save();
  _offCtx.translate(-worldMinX, -worldMinY);

  for (const b of _BANDS) {
    _drawFillBand(_offCtx, f, cols, rows, worldMinX, worldMinY, b.t, b.r, b.g, b.b, b.fa);
  }
  for (const b of _BANDS) {
    _marchLines(_offCtx, f, cols, rows, worldMinX, worldMinY, b.t, b.lc, b.lw);
  }

  _offCtx.restore();
}

window.Terrain = {
  draw(ctx) {
    if (!TERRAIN_ENABLED) return;
    _checkDirty();
    if (!_offscreen || !_cache) return;
    ctx.save();
    ctx.drawImage(_offscreen, _cache.worldMinX, _cache.worldMinY);
    ctx.restore();
  },
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
  getTerrainHeightAt(x, y) {
    return Math.min(1, this.getTerrainDensityAt(x, y) / 2.0);
  },
  getTerrainGradientAt(x, y) {
    const eps = TERRAIN_GRID_SIZE;
    const dx = this.getTerrainDensityAt(x + eps, y) - this.getTerrainDensityAt(x - eps, y);
    const dy = this.getTerrainDensityAt(x, y + eps) - this.getTerrainDensityAt(x, y - eps);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: dx / len, dy: dy / len };
  },
  invalidate() {
    _dirty = true;
  },
};
