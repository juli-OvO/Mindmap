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
