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

window.Terrain = {
  draw(ctx)                   {},
  getTerrainDensityAt(x, y)  { return 0; },
  getTerrainHeightAt(x, y)   { return 0; },
  getTerrainGradientAt(x, y) { return { dx: 0, dy: 0 }; },
  invalidate()                {},
};
