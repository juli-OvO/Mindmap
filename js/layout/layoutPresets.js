// ═══════════════════════════════════════════════════════════════
// LAYOUT PRESETS
// Maps each thinking state to a layout mode and particle behavior.
// Consumed by applySemanticLayout() and setParticleMode().
// ═══════════════════════════════════════════════════════════════

const LAYOUT_PRESETS = {
  scatter: {
    layoutMode:   'constellation',
    particleMode: 'ambientDrift',
    nodeSpacing:  1.6,
    edgeStrength: 0.4,
  },
  trajectory: {
    layoutMode:   'forwardPath',
    particleMode: 'forwardRiver',
    nodeSpacing:  1.2,
    edgeStrength: 1.4,
  },
  split: {
    layoutMode:   'opposingCorridors',
    particleMode: 'opposingCorridors',
    nodeSpacing:  1.5,
    edgeStrength: 1.0,
  },
  echo: {
    layoutMode:   'parallelBands',
    particleMode: 'synchronizedLanes',
    nodeSpacing:  1.3,
    edgeStrength: 0.9,
  },
  return: {
    layoutMode:   'memoryOrbit',
    particleMode: 'memoryEddy',
    nodeSpacing:  1.1,
    edgeStrength: 1.2,
  },
};
