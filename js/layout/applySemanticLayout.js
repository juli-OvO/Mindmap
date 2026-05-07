// ═══════════════════════════════════════════════════════════════
// SEMANTIC LAYOUT
// Positions all nodes based on the current thinking state.
// Returns [{ id, x, y }] — caller updates fragment positions.
//
// All coordinates are in world space (same units as frag.x / frag.y).
// Layout is deterministic — no random placement — so re-running
// the same graph produces the same arrangement.
//
// Depends on globals: toWorld(), canvasState (from app.js / data.js)
// ═══════════════════════════════════════════════════════════════

function applySemanticLayout(nodes, relationships, classification, canvasSize) {
  if (!nodes || nodes.length === 0) return [];

  // Viewport center in world coordinates
  const center = (typeof toWorld === 'function')
    ? toWorld(canvasSize.width / 2, canvasSize.height / 2)
    : { x: 0, y: 0 };
  const cx = center.x;
  const cy = center.y;

  const scale = (typeof canvasState !== 'undefined') ? canvasState.scale : 1;
  // World-space half-extents of the visible viewport (×0.38 = comfortable inset)
  const hw = (canvasSize.width  / scale) * 0.38;
  const hh = (canvasSize.height / scale) * 0.38;

  const { state } = classification;

  if (state === 'trajectory') return _layoutTrajectory(nodes, relationships, cx, cy, hw, hh);
  if (state === 'split')      return _layoutSplit(nodes, relationships, cx, cy, hw, hh);
  if (state === 'echo')       return _layoutEcho(nodes, relationships, cx, cy, hw, hh);
  if (state === 'return')     return _layoutReturn(nodes, cx, cy, hw, hh);
  return _layoutScatter(nodes, cx, cy, hw, hh); // scatter = default
}

// ── scatter ──────────────────────────────────────────────────────
// Loose constellation: radial placement around center with generous spacing.
function _layoutScatter(nodes, cx, cy, hw, hh) {
  const count = nodes.length;
  return nodes.map((n, i) => {
    const angle  = (i / count) * Math.PI * 2;
    const tier   = Math.floor(i / 8); // 8 per ring
    const radius = hw * (0.35 + tier * 0.28);
    return { id: n.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.7 };
  });
}

// ── trajectory ───────────────────────────────────────────────────
// Longest leads_to chain runs left→right along a soft arc.
// Off-chain nodes branch near their closest chain connection.
function _layoutTrajectory(nodes, relationships, cx, cy, hw, hh) {
  const chain    = _findLongestLeadsToChain(nodes, relationships);
  const chainSet = new Set(chain);
  const positions = {};

  chain.forEach((id, i) => {
    const t = chain.length > 1 ? i / (chain.length - 1) : 0.5;
    positions[id] = {
      id,
      x: cx - hw + t * hw * 2,
      y: cy + Math.sin(t * Math.PI) * (-hh * 0.3), // upward arc
    };
  });

  const relMap  = _buildNeighborMap(relationships);
  let offIdx    = 0;
  nodes.filter(n => !chainSet.has(n.id)).forEach(n => {
    const chainNeighbors = (relMap[n.id] || []).filter(id => positions[id]);
    if (chainNeighbors.length) {
      const anchor = positions[chainNeighbors[0]];
      const side   = offIdx % 2 === 0 ? 1 : -1;
      positions[n.id] = {
        id: n.id,
        x: anchor.x + hw * 0.18 * (offIdx % 3 + 1) * side,
        y: anchor.y + hh * 0.35,
      };
    } else {
      positions[n.id] = {
        id: n.id,
        x: cx - hw * 0.4 + (offIdx % 4) * hw * 0.28,
        y: cy + hh * 0.55 + Math.floor(offIdx / 4) * hh * 0.28,
      };
    }
    offIdx++;
  });

  return nodes.map(n => positions[n.id] || { id: n.id, x: n.x, y: n.y });
}

// ── split ────────────────────────────────────────────────────────
// Contradiction-linked nodes pulled to opposing left/right corridors.
function _layoutSplit(nodes, relationships, cx, cy, hw, hh) {
  const leftSet  = new Set();
  const rightSet = new Set();

  // Seed sides from contradicts pairs
  relationships.filter(r => r.type === 'contradicts').forEach(r => {
    if (!leftSet.has(r.from) && !rightSet.has(r.from)) {
      leftSet.has(r.to) ? rightSet.add(r.from) : leftSet.add(r.from);
    }
    if (!leftSet.has(r.to) && !rightSet.has(r.to)) {
      rightSet.has(r.from) ? leftSet.add(r.to) : rightSet.add(r.to);
    }
  });

  // Remaining nodes fill the smaller side
  nodes.forEach(n => {
    if (!leftSet.has(n.id) && !rightSet.has(n.id)) {
      (leftSet.size <= rightSet.size ? leftSet : rightSet).add(n.id);
    }
  });

  const positions  = {};
  const colCount   = Math.max(1, Math.ceil(Math.sqrt(Math.max(leftSet.size, rightSet.size))));
  let li = 0, ri  = 0;

  leftSet.forEach(id => {
    positions[id] = {
      id,
      x: cx - hw * 0.58 - (li % colCount) * hw * 0.26,
      y: cy - hh * 0.30 + Math.floor(li / colCount) * hh * 0.36,
    };
    li++;
  });

  rightSet.forEach(id => {
    positions[id] = {
      id,
      x: cx + hw * 0.58 + (ri % colCount) * hw * 0.26,
      y: cy - hh * 0.30 + Math.floor(ri / colCount) * hh * 0.36,
    };
    ri++;
  });

  return nodes.map(n => positions[n.id] || { id: n.id, x: n.x, y: n.y });
}

// ── echo ─────────────────────────────────────────────────────────
// Parallel-linked nodes grouped into horizontal bands via union-find.
function _layoutEcho(nodes, relationships, cx, cy, hw, hh) {
  const parent = {};
  nodes.forEach(n => { parent[n.id] = n.id; });

  function find(id) {
    if (parent[id] !== id) parent[id] = find(parent[id]);
    return parent[id];
  }
  function union(a, b) {
    if (parent[a] !== undefined && parent[b] !== undefined)
      parent[find(a)] = find(b);
  }

  relationships.filter(r => r.type === 'parallel').forEach(r => union(r.from, r.to));

  const groups = {};
  nodes.forEach(n => {
    const root = find(n.id);
    if (!groups[root]) groups[root] = [];
    groups[root].push(n.id);
  });

  const groupList  = Object.values(groups).sort((a, b) => b.length - a.length);
  const bandHeight = hh * 0.48;
  const positions  = {};

  groupList.forEach((group, gi) => {
    const bandY = cy - (groupList.length - 1) * bandHeight * 0.5 + gi * bandHeight;
    group.forEach((id, ni) => {
      const t = group.length > 1 ? ni / (group.length - 1) : 0.5;
      positions[id] = {
        id,
        x: cx - hw * 0.65 + t * hw * 1.3,
        y: bandY,
      };
    });
  });

  return nodes.map(n => positions[n.id] || { id: n.id, x: n.x, y: n.y });
}

// ── return ───────────────────────────────────────────────────────
// Older nodes (by session order) orbit near center as gravity wells.
// Newer nodes spread outward in rings around them.
function _layoutReturn(nodes, cx, cy, hw, hh) {
  const sessionOrder = {};
  if (typeof sessions !== 'undefined') {
    sessions.forEach((s, i) => { sessionOrder[s.id] = i; });
  }

  const sorted = [...nodes].sort((a, b) => {
    const ai = sessionOrder[a.sessionId] ?? 9999;
    const bi = sessionOrder[b.sessionId] ?? 9999;
    return ai - bi;
  });

  const total     = sorted.length;
  const coreCount = Math.max(1, Math.ceil(total * 0.35));
  const positions = {};

  // Core — tightly clustered near center
  sorted.slice(0, coreCount).forEach((n, i) => {
    const angle  = (i / coreCount) * Math.PI * 2;
    const radius = hw * 0.16;
    positions[n.id] = { id: n.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.65 };
  });

  // Orbit — expanding rings outward
  sorted.slice(coreCount).forEach((n, i) => {
    const ring   = 1 + Math.floor(i / 6);
    const angle  = (i / Math.max(total - coreCount, 1)) * Math.PI * 2;
    const radius = hw * 0.32 + ring * hw * 0.22;
    positions[n.id] = { id: n.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.65 };
  });

  return nodes.map(n => positions[n.id] || { id: n.id, x: n.x, y: n.y });
}

// ── helpers ──────────────────────────────────────────────────────

// Return the longest leads_to chain as an ordered array of node IDs.
function _findLongestLeadsToChain(nodes, relationships) {
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  relationships.filter(r => r.type === 'leads_to').forEach(r => {
    if (adj[r.from]) adj[r.from].push(r.to);
  });

  const memo = {};
  function longestPath(id, visiting) {
    if (visiting.has(id)) return [id];
    if (memo[id]) return memo[id];
    visiting.add(id);
    let best = [id];
    for (const cid of (adj[id] || [])) {
      const sub = longestPath(cid, visiting);
      if (sub.length + 1 > best.length) best = [id, ...sub];
    }
    visiting.delete(id);
    memo[id] = best;
    return best;
  }

  let best = [];
  for (const n of nodes) {
    const path = longestPath(n.id, new Set());
    if (path.length > best.length) best = path;
  }
  return best;
}

// Bidirectional adjacency map for quick neighbor lookup.
function _buildNeighborMap(relationships) {
  const map = {};
  relationships.forEach(r => {
    if (!map[r.from]) map[r.from] = [];
    if (!map[r.to])   map[r.to]   = [];
    map[r.from].push(r.to);
    map[r.to].push(r.from);
  });
  return map;
}
