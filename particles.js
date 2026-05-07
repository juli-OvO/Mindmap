// ═══════════════════════════════════════════════════════════════
// NODE FLOW PARTICLE SYSTEM
// Canvas-only particle field that reads the existing DOM graph state.
// It does not own node rendering, dragging, editing, or relationship UI.
// ═══════════════════════════════════════════════════════════════

const FLOW_PRESET = {
  backgroundColor: "#F3ECDC",
  particleColor: "#62ACA7",

  particleCount: 900,
  speed: 0.13,
  noiseStrength: 0.72,
  noiseScale: 0.005,

  corridorStrength: 2.01,
  corridorRadius: 56,
  haloStrength: 0.43,

  opacity: 0.42,
  softness: 3.2,
  particleSize: 1.3,
  spawnSpread: 80,
  waveAmplitude: 42,
  waveFrequency: 1.6,
  wavePhaseSpeed: 0.25,
  routeSpread: 90,
  clearAlpha: 0.19,

  blendMode: "source-over",
  trails: true,
  showCorridors: false
};

let particles = [];
let flowGraph = { nodes: [], edges: [], edgesExpanded: [] };
let flowDirty = true;
let flowFrame = 0;
let flowLastTs = 0;
let flowSeed = 1;
let currentParticleMode = "ambientDrift";

function setParticleMode(mode) {
  currentParticleMode = mode || "ambientDrift";
  markFlowDirty();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalize(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise2D(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const sx = x - x0;
  const sy = y - y0;
  const ux = sx * sx * (3 - 2 * sx);
  const uy = sy * sy * (3 - 2 * sy);
  return lerp(
    lerp(hash2(x0, y0), hash2(x1, y0), ux),
    lerp(hash2(x0, y1), hash2(x1, y1), ux),
    uy
  );
}

function fbm(x, y, octaves) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, y * frequency) * amplitude;
    sum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / (sum || 1);
}

function sampleCurlNoise(x, y, t, scale = FLOW_PRESET.noiseScale, eps = 0.6) {
  const nx = x * scale;
  const ny = y * scale;
  const nt = t * 0.08;
  const a = fbm(nx + nt, ny, 3);
  const b = fbm(nx - nt, ny, 3);
  const c = fbm(nx, ny + nt, 3);
  const d = fbm(nx, ny - nt, 3);
  const ddx = (a - b) / (2 * eps);
  const ddy = (c - d) / (2 * eps);
  return normalize(ddy, -ddx);
}

function hexToRgb(hex) {
  const safe = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : "#62ACA7";
  const clean = safe.slice(1);
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(alpha, 0, 1)})`;
}

function distToSegmentWithT(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby || 1;
  const t = clamp((apx * abx + apy * aby) / abLen2, 0, 1);
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  const dx = px - qx;
  const dy = py - qy;
  return { distance: Math.hypot(dx, dy), t, qx, qy, dx, dy };
}

function routeValues(edge, t, params, particle = null, time = 0) {
  const abx = edge.b.x - edge.a.x;
  const aby = edge.b.y - edge.a.y;
  const tangent = normalize(abx, aby);
  const normal = normalize(-aby, abx);
  const routeOffset = particle ? particle.routeOffset || 0 : 0;
  const routePhase = particle ? particle.routePhase || 0 : 0;
  const routeFrequency = particle ? particle.routeFrequency || params.waveFrequency : params.waveFrequency;
  const routeAmplitude = particle ? particle.routeAmplitude || params.waveAmplitude : params.waveAmplitude;
  const phase = routePhase + time * params.wavePhaseSpeed;
  const wave = Math.sin(t * Math.PI * routeFrequency + phase) * routeAmplitude;
  const waveSlope = Math.cos(t * Math.PI * routeFrequency + phase) * Math.PI * routeFrequency * routeAmplitude;
  const x = lerp(edge.a.x, edge.b.x, t) + normal.x * (wave + routeOffset);
  const y = lerp(edge.a.y, edge.b.y, t) + normal.y * (wave + routeOffset);
  const routeTangent = normalize(abx + normal.x * waveSlope, aby + normal.y * waveSlope);
  return { x, y, tangent: routeTangent, normal, wave };
}

function getFlowCanvas() {
  return document.getElementById("particle-canvas");
}

function getFlowCtx() {
  const canvas = getFlowCanvas();
  return canvas ? canvas.getContext("2d") : null;
}

function viewportWorldBounds(extra = 120) {
  const state = typeof canvasState !== "undefined" ? canvasState : { x: 0, y: 0, scale: 1 };
  const scale = state.scale || 1;
  return {
    left: (-state.x - extra) / scale,
    top: (-state.y - extra) / scale,
    right: (window.innerWidth - state.x + extra) / scale,
    bottom: (window.innerHeight - state.y + extra) / scale
  };
}

function flowNodeFromFragment(frag) {
  const r = typeof nodeRadius === "function" ? nodeRadius(frag) : 38;
  return {
    id: frag.id,
    label: frag.title || frag.content || frag.id,
    type: frag.type || "observation",
    x: frag.x || 0,
    y: frag.y || 0,
    width: r * 2,
    height: r * 2,
    r: r + Math.min(28, Math.max(8, String(frag.title || frag.content || "").length * 0.45))
  };
}

function mapGraphToFlow() {
  const sourceFragments = typeof fragments !== "undefined" ? fragments : [];
  const nodes = sourceFragments.map(flowNodeFromFragment);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = [];

  sourceFragments.forEach(frag => {
    (frag.connections || []).forEach(conn => {
      if (!nodeIds.has(conn.to)) return;
      edges.push({
        from: frag.id,
        to: conn.to,
        type: conn.type || "leads_to"
      });
    });
  });

  const edgesExpanded = expandEdges(nodes, edges);
  flowGraph = { nodes, edges, edgesExpanded };
}

function expandEdges(nodes, edges) {
  return edges
    .map((edge, idx) => ({
      ...edge,
      idx,
      a: nodes.find(n => n.id === edge.from),
      b: nodes.find(n => n.id === edge.to)
    }))
    .filter(edge => edge.a && edge.b);
}

function markFlowDirty() {
  flowDirty = true;
}

function chooseSpawnEdge(graph, rand) {
  if (!graph.edgesExpanded.length) return null;
  return graph.edgesExpanded[Math.floor(rand() * graph.edgesExpanded.length)];
}

function spawnParticleInto(p, graph, params, rand, time = 0) {
  const edge = chooseSpawnEdge(graph, rand);
  if (edge) {
    const t = rand();
    const tangent = normalize(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const laneSide = rand() > 0.5 ? 1 : -1;
    const contradictionOffset = edge.type === "contradicts" ? params.corridorRadius * 0.34 * laneSide : 0;
    const spreadScale = edge.type === "contradicts" ? 0.28 : 1;
    p.routeOffset = contradictionOffset + (rand() - 0.5) * params.routeSpread * spreadScale;
    p.routePhase = rand() * Math.PI * 2;
    p.routeFrequency = params.waveFrequency * (0.86 + rand() * 0.28);
    p.routeAmplitude = params.waveAmplitude * (0.78 + rand() * 0.44);
    const route = routeValues(edge, t, params, p, time);
    p.x = route.x + tangent.x * (rand() - 0.5) * params.spawnSpread;
    p.y = route.y + tangent.y * (rand() - 0.5) * params.spawnSpread;
    p.edgeIndex = edge.idx;
    p.laneSide = laneSide;
  } else {
    const bounds = viewportWorldBounds();
    p.x = lerp(bounds.left, bounds.right, rand());
    p.y = lerp(bounds.top, bounds.bottom, rand());
    p.edgeIndex = -1;
    p.laneSide = rand() > 0.5 ? 1 : -1;
    p.routeOffset = (rand() - 0.5) * params.routeSpread;
    p.routePhase = rand() * Math.PI * 2;
    p.routeFrequency = params.waveFrequency * (0.86 + rand() * 0.28);
    p.routeAmplitude = params.waveAmplitude * (0.78 + rand() * 0.44);
  }

  p.vx = (rand() - 0.5) * 0.3;
  p.vy = (rand() - 0.5) * 0.3;
  p.age = 0;
  p.life = 4 + rand() * 6;
  p.size = 1 + rand() * params.particleSize;
  p.alpha = 0;
  p.seed = rand() * 1000 + time;
}

function makeParticles(count, graph = flowGraph, params = FLOW_PRESET, seed = 1) {
  const rand = mulberry32(seed);
  const pool = [];
  for (let i = 0; i < count; i++) {
    const p = {};
    spawnParticleInto(p, graph, params, rand, rand() * 10);
    p.age = rand() * p.life;
    pool.push(p);
  }
  return pool;
}

function reconcileParticles(params) {
  const target = Math.round(params.particleCount);
  if (particles.length < target) {
    const more = makeParticles(target - particles.length, flowGraph, params, ++flowSeed);
    particles.push(...more);
  } else if (particles.length > target) {
    particles.length = target;
  }
}

function sampleNodeHalo(node, x, y) {
  const dx = x - node.x;
  const dy = y - node.y;
  const d = Math.hypot(dx, dy);
  const radius = node.r * 1.65;
  if (d > radius) return { x: 0, y: 0, w: 0 };

  const falloff = 1 - smoothstep(node.r * 0.35, radius, d);
  const tangential = normalize(-dy, dx);
  if (node.type === "anchor") return { x: tangential.x * 0.22, y: tangential.y * 0.22, w: falloff * 0.28 };
  if (node.type === "tension") return { x: tangential.x * 0.5 + dx * 0.0015, y: tangential.y * 0.5 + dy * 0.0015, w: falloff * 0.35 };
  if (node.type === "feeling") return { x: tangential.x * 0.34, y: tangential.y * 0.34, w: falloff * 0.26 };
  if (node.type === "question") return { x: tangential.x * 0.42, y: tangential.y * 0.42, w: falloff * 0.24 };
  return { x: tangential.x * 0.18, y: tangential.y * 0.18, w: falloff * 0.14 };
}

function applyNodeRepulsion(p, nodes) {
  for (const node of nodes) {
    const dx = p.x - node.x;
    const dy = p.y - node.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const outer = node.r * 1.8;
    if (d > outer) continue;
    const strength = (1 - smoothstep(node.r * 0.4, outer, d)) * 1.4;
    p.vx += (dx / d) * strength;
    p.vy += (dy / d) * strength;
  }
}

function sampleCorridor(edge, x, y, params, particle = null, time = 0) {
  const corridorRadius = params.corridorRadius;
  const seg = distToSegmentWithT(x, y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
  const routeParticle = particle && particle.edgeIndex === edge.idx ? particle : null;
  const route = routeValues(edge, seg.t, params, routeParticle, time);
  const routeDx = x - route.x;
  const routeDy = y - route.y;
  const routeDistance = Math.hypot(routeDx, routeDy);
  if (routeDistance > corridorRadius) return { x: 0, y: 0, w: 0 };

  const tangent = route.tangent;
  const normal = route.normal;
  const centerWeight = 1 - smoothstep(0, corridorRadius, routeDistance);
  const midBias = 1 - Math.abs(seg.t - 0.5) * 1.2;
  let w = centerWeight * Math.max(0.2, midBias);
  let vx = tangent.x;
  let vy = tangent.y;

  if (edge.type === "parallel") {
    const wave = Math.sin(seg.t * Math.PI * 2 + flowFrame * 0.018);
    vx += normal.x * 0.18 * wave;
    vy += normal.y * 0.18 * wave;
    w *= 0.68;
  } else if (edge.type === "contradicts") {
    const centerRoute = routeValues(edge, seg.t, params, null, time);
    const centerDx = x - centerRoute.x;
    const centerDy = y - centerRoute.y;
    const signedDist = centerDx * centerRoute.normal.x + centerDy * centerRoute.normal.y;
    const barrierWidth = corridorRadius * 0.22;
    if (Math.abs(signedDist) < barrierWidth) return { x: 0, y: 0, w: 0 };

    const side = particle && particle.edgeIndex === edge.idx
      ? particle.laneSide || 1
      : Math.sign(signedDist) || 1;
    const laneOffset = corridorRadius * 0.34;
    const laneDistance = Math.abs(side * laneOffset - signedDist);
    const laneWeight = 1 - smoothstep(0, corridorRadius * 0.42, laneDistance);
    vx = tangent.x * side;
    vy = tangent.y * side;
    vx += normal.x * side * 0.12;
    vy += normal.y * side * 0.12;
    w *= 1.18 * Math.max(0.22, laneWeight);
  } else {
    w *= 1.05;
  }

  const v = normalize(vx, vy);
  return { x: v.x, y: v.y, w };
}

function sampleField(graph, x, y, t, params, particle = null) {
  let vx = 0;
  let vy = 0;
  let total = 0;

  for (const edge of graph.edgesExpanded) {
    const c = sampleCorridor(
      edge,
      x,
      y,
      params,
      particle && particle.edgeIndex === edge.idx ? particle : null,
      t
    );
    vx += c.x * c.w * params.corridorStrength;
    vy += c.y * c.w * params.corridorStrength;
    total += c.w;
  }

  for (const node of graph.nodes) {
    const h = sampleNodeHalo(node, x, y);
    vx += h.x * h.w * params.haloStrength;
    vy += h.y * h.w * params.haloStrength;
    total += h.w * 0.5;
  }

  const noise = sampleCurlNoise(x, y, t, params.noiseScale);
  vx += noise.x * params.noiseStrength;
  vy += noise.y * params.noiseStrength;

  if (particle) {
    const edge = graph.edgesExpanded.find(item => item.idx === particle.edgeIndex && item.type === "contradicts");
    if (edge) {
      const seg = distToSegmentWithT(x, y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
      const centerRoute = routeValues(edge, seg.t, params, null, t);
      const routeDx = x - centerRoute.x;
      const routeDy = y - centerRoute.y;
      if (Math.hypot(routeDx, routeDy) < params.corridorRadius) {
        const normal = centerRoute.normal;
        const tangent = centerRoute.tangent;
        const signedDist = routeDx * normal.x + routeDy * normal.y;
        const side = particle.laneSide || Math.sign(signedDist) || 1;
        const laneOffset = params.corridorRadius * 0.34;
        const laneError = side * laneOffset - signedDist;
        vx += normal.x * laneError * 0.08;
        vy += normal.y * laneError * 0.08;
        vx += tangent.x * side * params.corridorStrength * 0.6;
        vy += tangent.y * side * params.corridorStrength * 0.6;
      }
    }
  }

  const out = normalize(vx || 0.0001, vy || 0.0001);
  return { x: out.x, y: out.y, strength: clamp(total, 0, 1) };
}

function constrainContradictionLane(p, graph, params) {
  const edge = graph.edgesExpanded.find(item => item.idx === p.edgeIndex && item.type === "contradicts");
  if (!edge) return;

  const seg = distToSegmentWithT(p.x, p.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
  const centerRoute = routeValues(edge, seg.t, params, null, flowLastTs / 1000);
  const routeDx = p.x - centerRoute.x;
  const routeDy = p.y - centerRoute.y;
  if (Math.hypot(routeDx, routeDy) > params.corridorRadius) return;

  const normal = centerRoute.normal;
  const signedDist = routeDx * normal.x + routeDy * normal.y;
  const side = p.laneSide || Math.sign(signedDist) || 1;
  const barrierWidth = params.corridorRadius * 0.22;

  if (signedDist * side < barrierWidth) {
    const correction = barrierWidth * side - signedDist;
    p.x += normal.x * correction;
    p.y += normal.y * correction;

    const normalVelocity = p.vx * normal.x + p.vy * normal.y;
    if (normalVelocity * side < 0) {
      p.vx -= normal.x * normalVelocity * 1.4;
      p.vy -= normal.y * normalVelocity * 1.4;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }
}

function textSuppressionAt(graph, x, y) {
  let suppression = 0;
  for (const node of graph.nodes) {
    const d = Math.hypot(x - node.x, y - node.y);
    const textRadius = Math.max(12, node.r * 0.52);
    const local = 1 - smoothstep(textRadius * 0.35, textRadius, d);
    suppression = Math.max(suppression, local);
  }
  return suppression;
}

function drawSoftParticle(ctx, x, y, radius, alpha, color) {
  const r = Math.max(radius, 0.1);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgbaFromHex(color, alpha));
  g.addColorStop(0.45, rgbaFromHex(color, alpha * 0.38));
  g.addColorStop(1, rgbaFromHex(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function updateParticles(dt, time, params) {
  if (flowDirty) {
    mapGraphToFlow();
    reconcileParticles(params);
    flowDirty = false;
  } else {
    reconcileParticles(params);
  }

  const rand = Math.random;
  const bounds = viewportWorldBounds(160);

  for (const p of particles) {
    const field = sampleField(flowGraph, p.x, p.y, time, params, p);
    p.vx = p.vx * 0.94 + field.x * params.speed;
    p.vy = p.vy * 0.94 + field.y * params.speed;
    applyNodeRepulsion(p, flowGraph.nodes);
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;

    constrainContradictionLane(p, flowGraph, params);

    p.age += dt;
    const ageNorm = p.age / p.life;
    const fadeIn = smoothstep(0, 0.12, ageNorm);
    const fadeOut = 1 - smoothstep(0.65, 1, ageNorm);
    const textAvoidance = textSuppressionAt(flowGraph, p.x, p.y);
    p.alpha = params.opacity * fadeIn * fadeOut * (0.35 + field.strength * 0.75) * (1 - textAvoidance * 0.42);

    if (
      p.age > p.life ||
      p.x < bounds.left || p.x > bounds.right ||
      p.y < bounds.top || p.y > bounds.bottom
    ) {
      spawnParticleInto(p, flowGraph, params, rand, time);
    }
  }
}

function renderCorridors(ctx, params) {
  if (!params.showCorridors) return;
  ctx.save();
  for (const edge of flowGraph.edgesExpanded) {
    ctx.strokeStyle = edge.type === "contradicts"
      ? "rgba(150,82,55,0.13)"
      : edge.type === "parallel"
      ? "rgba(64,100,130,0.12)"
      : "rgba(74,104,68,0.12)";
    ctx.lineWidth = params.corridorRadius * 0.18;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const route = routeValues(edge, i / 32, params, null, flowLastTs / 1000);
      if (i === 0) ctx.moveTo(route.x, route.y);
      else ctx.lineTo(route.x, route.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function renderConnectionPreview(ctx) {
  if (typeof connectingFrom === "undefined" || !connectingFrom) return;
  if (typeof nodeScreen !== "function" || typeof connectMouse === "undefined") return;

  const a = nodeScreen(connectingFrom.fragment);
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(139,115,85,0.55)";
  ctx.lineWidth = 1;
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(connectMouse.x, connectMouse.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function renderParticles(ctx, params) {
  const canvas = getFlowCanvas();
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  if (params.trails) {
    ctx.fillStyle = rgbaFromHex(params.backgroundColor, params.clearAlpha);
    ctx.fillRect(0, 0, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  } else {
    ctx.fillStyle = params.backgroundColor;
    ctx.fillRect(0, 0, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }
  ctx.restore();

  const state = typeof canvasState !== "undefined" ? canvasState : { x: 0, y: 0, scale: 1 };
  ctx.save();
  ctx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, dpr * state.x, dpr * state.y);
  ctx.globalCompositeOperation = params.blendMode || "source-over";

  if (window.Terrain) window.Terrain.draw(ctx);

  renderCorridors(ctx, params);
  for (const p of particles) {
    if (p.alpha <= 0.004) continue;
    drawSoftParticle(ctx, p.x, p.y, p.size * params.softness, p.alpha, params.particleColor);
  }
  ctx.restore();

  renderConnectionPreview(ctx);
}

function resizeParticleCanvas() {
  const canvas = getFlowCanvas();
  const ctx = getFlowCtx();
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = FLOW_PRESET.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  markFlowDirty();
}

function initParticles() {
  mapGraphToFlow();
  particles = makeParticles(FLOW_PRESET.particleCount, flowGraph, FLOW_PRESET, ++flowSeed);
  flowDirty = false;
}

function buildAllPaths() {
  markFlowDirty();
  drawConnections();
}

function drawConnections() {
  const svg = document.getElementById("conn-svg");
  if (!svg) return;

  svg.querySelectorAll(".conn-line, .conn-label").forEach(el => el.remove());

  const colors = {
    parallel: "rgba(139,115,85,0.6)",
    leads_to: "rgba(80,120,100,0.7)",
    contradicts: "rgba(160,80,80,0.7)"
  };

  if (typeof fragments === "undefined") return;

  fragments.forEach(frag => {
    (frag.connections || []).forEach(conn => {
      const toFrag = fragments.find(f => f.id === conn.to);
      if (!toFrag) return;

      const r1 = typeof nodeRadius === "function" ? nodeRadius(frag) : 32;
      const r2 = typeof nodeRadius === "function" ? nodeRadius(toFrag) : 32;
      const dx = toFrag.x - frag.x;
      const dy = toFrag.y - frag.y;
      const dist = Math.hypot(dx, dy) || 1;

      const x1 = frag.x + (dx / dist) * r1;
      const y1 = frag.y + (dy / dist) * r1;
      const x2 = toFrag.x - (dx / dist) * (r2 + 6);
      const y2 = toFrag.y - (dy / dist) * (r2 + 6);

      const color = colors[conn.type] || "rgba(139,115,85,0.5)";
      const markerId = "arrow-" + conn.type;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const curve = Math.min(dist * 0.10, 55);
      const cpx = mx - (dy / dist) * curve;
      const cpy = my + (dx / dist) * curve;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "conn-line");
      path.setAttribute("d", `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "1");
      path.setAttribute("fill", "none");
      path.setAttribute("marker-end", `url(#${markerId})`);
      path.dataset.fromId = frag.id;
      path.dataset.toId = toFrag.id;
      svg.appendChild(path);

      const bmx = 0.25 * x1 + 0.5 * cpx + 0.25 * x2;
      const bmy = 0.25 * y1 + 0.5 * cpy + 0.25 * y2;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "conn-label");
      label.setAttribute("x", bmx);
      label.setAttribute("y", bmy - 4);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", color);
      label.setAttribute("font-family", "monospace");
      label.setAttribute("font-size", "8");
      label.dataset.fromId = frag.id;
      label.dataset.toId = toFrag.id;
      label.textContent = conn.type;
      svg.appendChild(label);
    });
  });

  markFlowDirty();
  if (typeof applyGraphVisualState === "function") applyGraphVisualState();
}

function loop(ts) {
  const ctx = getFlowCtx();
  if (!ctx) {
    requestAnimationFrame(loop);
    return;
  }

  if (!flowLastTs) flowLastTs = ts || performance.now();
  const now = ts || performance.now();
  const dt = Math.min(0.033, (now - flowLastTs) / 1000);
  const time = now / 1000;
  flowLastTs = now;
  flowFrame++;

  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  updateParticles(dt, time, FLOW_PRESET);
  renderParticles(ctx, FLOW_PRESET);

  requestAnimationFrame(loop);
}
