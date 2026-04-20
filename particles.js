// ═══════════════════════════════════════════════════════════════
// FREE-FLOW PARTICLE SYSTEM
// Physics-based particles roam the full canvas.
// Direction driven by layered noise, deflected by nodes,
// pulled into corridors along connections.
// ═══════════════════════════════════════════════════════════════

const PARTICLE_COUNT = 300;

let particles = [];
let animTime  = 0;

// ═══════════════════════════════════════════════════════════════
// NOISE
// ═══════════════════════════════════════════════════════════════
function noise2(x, y, t) {
  return (
    Math.sin(x * 0.8 + t * 0.5) * Math.cos(y * 0.6 + t * 0.3) * 0.5 +
    Math.sin(x * 0.4 - y * 0.3 + t * 0.2) * 0.3 +
    Math.cos(x * 1.2 + y * 0.9 - t * 0.4) * 0.2
  );
}

// ═══════════════════════════════════════════════════════════════
// PARTICLE SPAWN + INIT
// ═══════════════════════════════════════════════════════════════
function spawnParticle() {
  return {
    x:      Math.random() * window.innerWidth,
    y:      Math.random() * window.innerHeight,
    vx:     (Math.random() - 0.5) * 1.25,
    vy:     (Math.random() - 0.5) * 1.25,
    age:    Math.floor(Math.random() * 60),
    maxAge: 240 + Math.random() * 180,
    col:    [...COL_AMBIENT],
  };
}

function initParticles() {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px-ax, py-ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

function noiseScale() {
  const n = fragments.reduce((s, f) =>
    s + f.connections.filter(c => c.type === 'counter').length, 0);
  return 0.003 + n * 0.002;
}

// ═══════════════════════════════════════════════════════════════
// PARTICLE UPDATE + DRAW
// ═══════════════════════════════════════════════════════════════
function updateParticle(p) {
  p.age++;
  if (p.age >= p.maxAge) { Object.assign(p, spawnParticle()); return; }

  const ns  = noiseScale();
  const ang = noise2(p.x * ns, p.y * ns, animTime * 0.001) * Math.PI * 2;
  p.vx += Math.cos(ang) * 0.04;
  p.vy += Math.sin(ang) * 0.04;

  let tc = [...COL_AMBIENT];

  // Node obstacle avoidance
  for (const frag of fragments) {
    const n   = nodeScreen(frag);
    const obs = n.r + 14;
    const dx  = p.x - n.x, dy = p.y - n.y;
    const dist = Math.hypot(dx, dy);
    if (dist < obs && dist > 0) {
      const ux = dx/dist, uy = dy/dist;
      const str = (1 - dist/obs) * 0.8;
      p.vx += (ux*0.6 + (-uy)*0.4) * str;
      p.vy += (uy*0.6 + ( ux)*0.4) * str;
    }
  }

  // Connection corridor currents
  for (const frag of fragments) {
    for (const conn of frag.connections) {
      const toFrag = fragments.find(f => f.id === conn.to);
      if (!toFrag) continue;
      const a   = nodeScreen(frag);
      const b   = nodeScreen(toFrag);
      const avgW = ((frag.weight||0) + (toFrag.weight||0)) / 2;
      const cw  = (130 + avgW*18) * canvasState.scale;
      const d   = distToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
      if (d >= cw) continue;

      const influence = 1 - d/cw;
      const sdx = b.x-a.x, sdy = b.y-a.y;
      const slen = Math.hypot(sdx, sdy);
      if (slen === 0) continue;
      const ndx = sdx/slen, ndy = sdy/slen;

      let dirX, dirY, speed, color;
      if (conn.type === 'echoes') {
        const dir = Math.sin(animTime*0.004 + p.age*0.02) > 0 ? 1 : -1;
        speed=1.4; dirX=ndx*dir; dirY=ndy*dir; color=COL_ECHOES;
      } else if (conn.type === 'leads-to') {
        speed=3.0; dirX=ndx; dirY=ndy; color=COL_LEADS;
      } else {
        const osc=Math.sin(p.age*0.04);
        speed=1.0; dirX=ndx*osc; dirY=ndy*osc; color=COL_COUNTER;
      }
      p.vx += dirX * speed * influence * 0.42;
      p.vy += dirY * speed * influence * 0.42;
      const bl = influence * 0.22;
      tc = tc.map((v,i) => v + (color[i]-v)*bl);
    }
  }

  // Color lerp toward target
  p.col = p.col.map((v,i) => v + (tc[i]-v)*0.05);

  p.vx *= 0.991; p.vy *= 0.991;
  const spd = Math.hypot(p.vx, p.vy);
  if (spd > 4.0) { p.vx *= 4.0/spd; p.vy *= 4.0/spd; }

  p.x += p.vx; p.y += p.vy;

  // Wrap around screen edges
  if (p.x < -15)                     p.x = window.innerWidth  + 15;
  if (p.x > window.innerWidth  + 15) p.x = -15;
  if (p.y < -15)                     p.y = window.innerHeight + 15;
  if (p.y > window.innerHeight + 15) p.y = -15;
}

function drawParticle(p) {
  const fadeIn  = Math.min(1, p.age / 40);
  const fadeOut = p.age > p.maxAge * 0.85
    ? (p.maxAge - p.age) / (p.maxAge * 0.15) : 1;
  const spd   = Math.hypot(p.vx, p.vy);
  const alpha = Math.max(0, Math.min(1, (0.45 + spd * 0.14) * fadeIn * fadeOut));
  if (alpha < 0.01) return;

  const [r, g, b] = p.col.map(Math.round);
  pCtx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  pCtx.beginPath();
  pCtx.arc(p.x, p.y, 2.0, 0, Math.PI * 2);
  pCtx.fill();
}

function resizeParticleCanvas() {
  pCanvas.width  = window.innerWidth;
  pCanvas.height = window.innerHeight;
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════
function loop() {
  animTime++;
  pCtx.fillStyle = 'rgba(245, 240, 232, 0.10)';
  pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

  for (const p of particles) { updateParticle(p); drawParticle(p); }

  // Connection preview line while dragging from a node
  if (connectingFrom) {
    const a = nodeScreen(connectingFrom.fragment);
    pCtx.beginPath();
    pCtx.setLineDash([4, 6]);
    pCtx.strokeStyle = 'rgba(139,115,85,0.55)';
    pCtx.lineWidth = 1;
    pCtx.moveTo(a.x, a.y);
    pCtx.lineTo(connectMouse.x, connectMouse.y);
    pCtx.stroke();
    pCtx.setLineDash([]);
  }

  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════════
// COMPATIBILITY STUB
// app.js calls buildAllPaths() on init and after graph changes.
// With the free-flow system there are no paths to build —
// reinitialise particles instead so counts stay correct.
// ═══════════════════════════════════════════════════════════════
function buildAllPaths() {
  initParticles();
  drawConnections();
}

function drawConnections() {
  const svg = document.getElementById('conn-svg');
  if (!svg) return;

  // Remove old lines/labels but keep <defs>
  svg.querySelectorAll('.conn-line, .conn-label').forEach(el => el.remove());

  const colors = {
    'echoes':   'rgba(139,115,85,0.6)',
    'leads-to': 'rgba(80,120,100,0.7)',
    'counter':  'rgba(160,80,80,0.7)',
  };

  fragments.forEach(frag => {
    frag.connections.forEach(conn => {
      const toFrag = fragments.find(f => f.id === conn.to);
      if (!toFrag) return;

      const r1 = nodeRadius(frag);
      const r2 = nodeRadius(toFrag);

      // Vector from center to center
      const dx = toFrag.x - frag.x;
      const dy = toFrag.y - frag.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Start/end points on node edges
      const x1 = frag.x  + (dx / dist) * r1;
      const y1 = frag.y  + (dy / dist) * r1;
      const x2 = toFrag.x - (dx / dist) * (r2 + 6); // +6 so arrow tip clears node edge
      const y2 = toFrag.y - (dy / dist) * (r2 + 6);

      const color    = colors[conn.type] || 'rgba(139,115,85,0.5)';
      const markerId = 'arrow-' + conn.type;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'conn-line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('marker-end', `url(#${markerId})`);
      line.dataset.fromId = frag.id;
      line.dataset.toId = toFrag.id;
      svg.appendChild(line);

      // Label at midpoint
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'conn-label');
      label.setAttribute('x', mx);
      label.setAttribute('y', my - 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', color);
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('font-size', '8');
      label.dataset.fromId = frag.id;
      label.dataset.toId = toFrag.id;
      label.textContent = conn.type;
      svg.appendChild(label);
    });
  });

  if (typeof applyGraphVisualState === 'function') applyGraphVisualState();
}
