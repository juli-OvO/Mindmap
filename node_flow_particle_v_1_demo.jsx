import React, { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
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
  const n00 = hash2(x0, y0);
  const n10 = hash2(x1, y0);
  const n01 = hash2(x0, y1);
  const n11 = hash2(x1, y1);
  const ux = sx * sx * (3 - 2 * sx);
  const uy = sy * sy * (3 - 2 * sy);
  return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
}

function fbm(x, y, octaves = 3) {
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

function sampleCurlNoise(x, y, t, scale = 0.003, eps = 0.6) {
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

function isValidHex(hex) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
}

function hexToRgb(hex) {
  const fallback = "#8BA08E";
  const safeHex = isValidHex(hex) ? hex : fallback;
  const clean = safeHex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbaFromHex(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function safeColor(hex, fallback) {
  return isValidHex(hex) ? hex : fallback;
}

const graphTemplate = {
  nodes: [
    { id: "n1", label: "late reply", type: "observation", x: 240, y: 160, r: 54 },
    { id: "n2", label: "felt uneasy", type: "feeling", x: 520, y: 120, r: 58 },
    { id: "n3", label: "why now?", type: "question", x: 770, y: 220, r: 56 },
    { id: "n4", label: "mixed signal", type: "tension", x: 470, y: 340, r: 64 },
    { id: "n5", label: "stay grounded", type: "anchor", x: 760, y: 430, r: 62 },
  ],
  edges: [
    { from: "n1", to: "n2", type: "leads_to" },
    { from: "n2", to: "n4", type: "parallel" },
    { from: "n4", to: "n3", type: "contradicts" },
    { from: "n4", to: "n5", type: "leads_to" },
  ],
};

function expandEdges(nodes, edges) {
  return edges
    .map((edge, idx) => ({
      ...edge,
      idx,
      a: nodes.find((n) => n.id === edge.from),
      b: nodes.find((n) => n.id === edge.to),
    }))
    .filter((edge) => edge.a && edge.b);
}

function makeParticles(count, graph, params, seed = 1) {
  const rand = mulberry32(seed);
  const edges = graph.edgesExpanded.length ? graph.edgesExpanded : expandEdges(graph.nodes, graph.edges);
  const particles = [];
  if (!edges.length) return particles;
  for (let i = 0; i < count; i++) {
    const edge = edges[Math.floor(rand() * edges.length)];
    const t = rand();
    const tangent = normalize(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const normal = normalize(-(edge.b.y - edge.a.y), edge.b.x - edge.a.x);
    const laneSide = rand() > 0.5 ? 1 : -1;
    const laneOffset = edge.type === "contradicts" ? params.corridorRadius * 0.34 * laneSide : 0;
    particles.push({
      x: lerp(edge.a.x, edge.b.x, t) + normal.x * laneOffset + tangent.x * (rand() - 0.5) * params.spawnSpread,
      y: lerp(edge.a.y, edge.b.y, t) + normal.y * laneOffset + tangent.y * (rand() - 0.5) * params.spawnSpread,
      vx: (rand() - 0.5) * 0.2,
      vy: (rand() - 0.5) * 0.2,
      age: rand() * 6,
      life: 4 + rand() * 6,
      size: 1 + rand() * params.particleSize,
      alpha: 0,
      edgeIndex: edge.idx,
      laneSide,
      seed: rand() * 1000,
    });
  }
  return particles;
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

function sampleCorridor(edge, x, y, corridorRadius) {
  const { a, b, type } = edge;
  const seg = distToSegmentWithT(x, y, a.x, a.y, b.x, b.y);
  if (seg.distance > corridorRadius) return { x: 0, y: 0, w: 0 };
  const tangent = normalize(b.x - a.x, b.y - a.y);
  const normal = normalize(-(b.y - a.y), b.x - a.x);
  const centerWeight = 1 - smoothstep(0, corridorRadius, seg.distance);
  const midBias = 1 - Math.abs(seg.t - 0.5) * 1.2;
  let w = centerWeight * Math.max(0.2, midBias);
  let vx = tangent.x;
  let vy = tangent.y;

  if (type === "parallel") {
    const wave = Math.sin(seg.t * Math.PI * 2);
    vx += normal.x * 0.18 * wave;
    vy += normal.y * 0.18 * wave;
    w *= 0.82;
  } else if (type === "contradicts") {
    const signedDist = seg.dx * normal.x + seg.dy * normal.y;
    const barrierWidth = corridorRadius * 0.18;
    if (Math.abs(signedDist) < barrierWidth) return { x: 0, y: 0, w: 0 };
    const side = Math.sign(signedDist) || 1;
    const laneOffset = corridorRadius * 0.32;
    const laneDistance = Math.abs(Math.abs(signedDist) - laneOffset);
    const laneWeight = 1 - smoothstep(0, corridorRadius * 0.42, laneDistance);
    vx = tangent.x * side + normal.x * side * 0.16;
    vy = tangent.y * side + normal.y * side * 0.16;
    w *= 1.2 * Math.max(0.25, laneWeight);
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
    const c = sampleCorridor(edge, x, y, params.corridorRadius);
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
    const edge = graph.edgesExpanded.find((item) => item.idx === particle.edgeIndex && item.type === "contradicts");
    if (edge) {
      const seg = distToSegmentWithT(x, y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
      if (seg.distance < params.corridorRadius) {
        const normal = normalize(-(edge.b.y - edge.a.y), edge.b.x - edge.a.x);
        const tangent = normalize(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
        const signedDist = seg.dx * normal.x + seg.dy * normal.y;
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
  const edge = graph.edgesExpanded.find((item) => item.idx === p.edgeIndex && item.type === "contradicts");
  if (!edge) return;
  const seg = distToSegmentWithT(p.x, p.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
  if (seg.distance > params.corridorRadius) return;
  const normal = normalize(-(edge.b.y - edge.a.y), edge.b.x - edge.a.x);
  const signedDist = seg.dx * normal.x + seg.dy * normal.y;
  const side = p.laneSide || Math.sign(signedDist) || 1;
  const barrierWidth = params.corridorRadius * 0.22;
  const minSignedDist = barrierWidth * side;
  if (signedDist * side < barrierWidth) {
    const correction = minSignedDist - signedDist;
    p.x += normal.x * correction;
    p.y += normal.y * correction;
    const normalVelocity = p.vx * normal.x + p.vy * normal.y;
    if (normalVelocity * side < 0) {
      p.vx -= normal.x * normalVelocity * 1.4;
      p.vy -= normal.y * normalVelocity * 1.4;
    }
  }
}

function drawSoftParticle(ctx, x, y, radius, alpha, color) {
  const safeParticleColor = safeColor(color, "#8BA08E");
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(radius, 0.1));
  g.addColorStop(0, rgbaFromHex(safeParticleColor, alpha));
  g.addColorStop(0.45, rgbaFromHex(safeParticleColor, alpha * 0.38));
  g.addColorStop(1, rgbaFromHex(safeParticleColor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(radius, 0.1), 0, Math.PI * 2);
  ctx.fill();
}

function RelationshipOverlay({ graphState, hoverId }) {
  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none">
      <defs>
        <marker id="arrow-leads" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(74,104,68,0.58)" />
        </marker>
      </defs>
      {graphState.edgesExpanded.map((edge) => {
        const active = hoverId && (edge.from === hoverId || edge.to === hoverId);
        const stroke = edge.type === "contradicts"
          ? active ? "rgba(150,82,55,0.72)" : "rgba(150,82,55,0.42)"
          : edge.type === "parallel"
          ? active ? "rgba(50,91,125,0.72)" : "rgba(50,91,125,0.42)"
          : active ? "rgba(74,104,68,0.72)" : "rgba(74,104,68,0.42)";
        const dash = edge.type === "contradicts" ? "7 8" : edge.type === "parallel" ? "7 7" : "8 6";
        const midX = (edge.a.x + edge.b.x) / 2;
        const midY = (edge.a.y + edge.b.y) / 2;
        return (
          <g key={`${edge.from}-${edge.to}-${edge.idx}`}>
            <line
              x1={edge.a.x}
              y1={edge.a.y}
              x2={edge.b.x}
              y2={edge.b.y}
              stroke={stroke}
              strokeWidth={active ? 1.6 : 1.1}
              strokeDasharray={dash}
              markerEnd={edge.type === "leads_to" ? "url(#arrow-leads)" : undefined}
            />
            {edge.type === "contradicts" && (
              <text x={midX} y={midY - 6} textAnchor="middle" fill={stroke} fontSize="16" fontFamily="serif">×</text>
            )}
            <text x={midX + 8} y={midY - 8} fill={stroke} fontSize="11" fontStyle="italic" style={{ textShadow: "0 1px 4px rgba(243,236,220,0.9)" }}>
              {edge.type}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FieldPreview({ graph, params }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef(null);
  const lastRef = useRef(0);
  const graphRef = useRef(null);
  const paramsRef = useRef(params);
  const [dragId, setDragId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [graphState, setGraphState] = useState(() => {
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const edges = graph.edges.map((e) => ({ ...e }));
    return { nodes, edges, edgesExpanded: expandEdges(nodes, edges) };
  });

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    graphRef.current = graphState;
  }, [graphState]);

  useEffect(() => {
    const nextGraph = {
      nodes: graph.nodes.map((n) => ({ ...n })),
      edges: graph.edges.map((e) => ({ ...e })),
    };
    nextGraph.edgesExpanded = expandEdges(nextGraph.nodes, nextGraph.edges);
    setGraphState(nextGraph);
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let devicePixelRatio = window.devicePixelRatio || 1;

    const resize = () => {
      width = canvas.clientWidth || 1;
      height = canvas.clientHeight || 1;
      devicePixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.fillStyle = safeColor(paramsRef.current.backgroundColor, "#F3ECDC");
      ctx.fillRect(0, 0, width, height);
    };

    resize();
    particlesRef.current = makeParticles(paramsRef.current.particleCount, graphRef.current || graphState, paramsRef.current, 12);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const respawn = (p, time) => {
      const currentGraph = graphRef.current;
      const currentParams = paramsRef.current;
      if (!currentGraph || !currentGraph.edgesExpanded.length) return;
      const edge = currentGraph.edgesExpanded[Math.floor(Math.random() * currentGraph.edgesExpanded.length)];
      const t = Math.random();
      const tangent = normalize(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
      const normal = normalize(-(edge.b.y - edge.a.y), edge.b.x - edge.a.x);
      const laneSide = Math.random() > 0.5 ? 1 : -1;
      const laneOffset = edge.type === "contradicts" ? currentParams.corridorRadius * 0.34 * laneSide : 0;
      p.x = lerp(edge.a.x, edge.b.x, t) + normal.x * laneOffset + tangent.x * (Math.random() - 0.5) * currentParams.spawnSpread;
      p.y = lerp(edge.a.y, edge.b.y, t) + normal.y * laneOffset + tangent.y * (Math.random() - 0.5) * currentParams.spawnSpread;
      p.vx = (Math.random() - 0.5) * 0.3;
      p.vy = (Math.random() - 0.5) * 0.3;
      p.age = 0;
      p.life = 4 + Math.random() * 6;
      p.size = 1 + Math.random() * currentParams.particleSize;
      p.alpha = 0;
      p.laneSide = laneSide;
      p.seed = Math.random() * 1000 + time;
    };

    const reconcileParticleCount = () => {
      const currentParams = paramsRef.current;
      const currentGraph = graphRef.current || graphState;
      const target = Math.round(currentParams.particleCount);
      if (particlesRef.current.length < target) {
        const more = makeParticles(target - particlesRef.current.length, currentGraph, currentParams, Math.floor(performance.now()));
        particlesRef.current.push(...more);
      } else if (particlesRef.current.length > target) {
        particlesRef.current.length = target;
      }
    };

    const tick = (ts) => {
      if (!lastRef.current) lastRef.current = ts;
      const dt = Math.min(0.033, (ts - lastRef.current) / 1000);
      const time = ts / 1000;
      lastRef.current = ts;
      const currentParams = paramsRef.current;
      const currentGraph = graphRef.current;
      const backgroundColor = safeColor(currentParams.backgroundColor, "#F3ECDC");

      reconcileParticleCount();

      if (currentParams.trails) {
        ctx.fillStyle = rgbaFromHex(backgroundColor, currentParams.clearAlpha);
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      if (currentParams.showCorridors && currentGraph) {
        ctx.save();
        for (const edge of currentGraph.edgesExpanded) {
          ctx.strokeStyle = edge.type === "contradicts"
            ? "rgba(150,82,55,0.13)"
            : edge.type === "parallel"
            ? "rgba(64,100,130,0.12)"
            : "rgba(74,104,68,0.12)";
          ctx.lineWidth = currentParams.corridorRadius * 0.18;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(edge.a.x, edge.a.y);
          ctx.lineTo(edge.b.x, edge.b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = "source-over";

      if (currentGraph) {
        for (const p of particlesRef.current) {
          const field = sampleField(currentGraph, p.x, p.y, time, currentParams, p);
          p.vx = p.vx * 0.94 + field.x * currentParams.speed;
          p.vy = p.vy * 0.94 + field.y * currentParams.speed;
          p.x += p.vx * dt * 60;
          p.y += p.vy * dt * 60;
          constrainContradictionLane(p, currentGraph, currentParams);
          p.age += dt;

          const ageNorm = p.age / p.life;
          const fadeIn = smoothstep(0, 0.12, ageNorm);
          const fadeOut = 1 - smoothstep(0.65, 1, ageNorm);
          const textAvoidance = currentGraph.nodes.reduce((acc, node) => {
            const d = Math.hypot(p.x - node.x, p.y - node.y);
            const suppress = 1 - smoothstep(node.r * 0.2, node.r * 0.55, d);
            return Math.max(acc, suppress);
          }, 0);
          p.alpha = currentParams.opacity * fadeIn * fadeOut * (0.35 + field.strength * 0.75) * (1 - textAvoidance * 0.42);

          drawSoftParticle(ctx, p.x, p.y, p.size * currentParams.softness, p.alpha, currentParams.particleColor);

          if (p.age > p.life || p.x < -120 || p.x > width + 120 || p.y < -120 || p.y > height + 120) {
            respawn(p, time);
          }
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      lastRef.current = 0;
    };
  }, []);

  const startDrag = (id) => setDragId(id);
  const stopDrag = () => setDragId(null);

  const onPointerMove = (e) => {
    if (!dragId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setGraphState((prev) => {
      const nodes = prev.nodes.map((n) => (n.id === dragId ? { ...n, x, y } : n));
      return { ...prev, nodes, edgesExpanded: expandEdges(nodes, prev.edges) };
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[640px] overflow-hidden rounded-3xl border border-black/10"
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <RelationshipOverlay graphState={graphState} hoverId={hoverId} />
      {graphState.nodes.map((node) => {
        const related = hoverId && (node.id === hoverId || graphState.edges.some((e) => (e.from === hoverId && e.to === node.id) || (e.to === hoverId && e.from === node.id)));
        return (
          <div
            key={node.id}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startDrag(node.id);
            }}
            onPointerEnter={() => setHoverId(node.id)}
            onPointerLeave={() => setHoverId(null)}
            className="absolute -translate-x-1/2 -translate-y-1/2 select-none cursor-grab active:cursor-grabbing"
            style={{ left: node.x, top: node.y }}
          >
            <div
              className="px-2 py-1 text-sm tracking-wide"
              style={{
                minWidth: 90,
                textAlign: "center",
                color: related ? "rgba(34,39,29,1)" : "rgba(37,36,30,0.9)",
                fontFamily: "Georgia, ui-serif, serif",
                textShadow: related ? "0 0 12px rgba(139,160,142,0.55), 0 1px 8px rgba(243,236,220,0.85)" : "0 1px 7px rgba(243,236,220,0.9)",
              }}
            >
              <div className="font-medium">{node.label}</div>
              <div className="mt-1 text-[10px] uppercase opacity-35">{node.type}</div>
            </div>
          </div>
        );
      })}
      <div className="absolute bottom-4 left-4 rounded-2xl border border-black/10 bg-[#f3ecdc]/70 px-3 py-2 text-xs text-black/55 backdrop-blur-md">
        Drag nodes · hover to inspect readability around links
      </div>
    </div>
  );
}

export default function NodeFlowParticleV1Demo() {
  const [backgroundColor, setBackgroundColor] = useState("#F3ECDC");
  const [particleColor, setParticleColor] = useState("#62ACA7");
  const [particleCount, setParticleCount] = useState([420]);
  const [speed, setSpeed] = useState([0.13]);
  const [noiseStrength, setNoiseStrength] = useState([0.72]);
  const [noiseScale, setNoiseScale] = useState([0.005]);
  const [corridorStrength, setCorridorStrength] = useState([2.01]);
  const [corridorRadius, setCorridorRadius] = useState([56]);
  const [haloStrength, setHaloStrength] = useState([0.43]);
  const [opacity, setOpacity] = useState([0.42]);
  const [softness, setSoftness] = useState([3.2]);
  const [particleSize, setParticleSize] = useState([1.3]);
  const [spawnSpread, setSpawnSpread] = useState([80]);
  const [clearAlpha, setClearAlpha] = useState([0.19]);
  const [trails, setTrails] = useState(true);
  const [showCorridors, setShowCorridors] = useState(false);

  const params = useMemo(() => ({
    particleCount: particleCount[0],
    speed: speed[0],
    noiseStrength: noiseStrength[0],
    noiseScale: noiseScale[0],
    corridorStrength: corridorStrength[0],
    corridorRadius: corridorRadius[0],
    haloStrength: haloStrength[0],
    opacity: opacity[0],
    softness: softness[0],
    particleSize: particleSize[0],
    spawnSpread: spawnSpread[0],
    clearAlpha: clearAlpha[0],
    trails,
    showCorridors,
    backgroundColor,
    particleColor,
  }), [particleCount, speed, noiseStrength, noiseScale, corridorStrength, corridorRadius, haloStrength, opacity, softness, particleSize, spawnSpread, clearAlpha, trails, showCorridors, backgroundColor, particleColor]);

  const presets = {
    readable: {
      particleCount: [180], speed: [0.2], noiseStrength: [0.48], noiseScale: [0.0026], corridorStrength: [1.35], corridorRadius: [90], haloStrength: [0.45], opacity: [0.18], softness: [6.2], particleSize: [1.8], spawnSpread: [52], clearAlpha: [0.18], trails: true, showCorridors: false,
    },
    atmospheric: {
      particleCount: [420], speed: [0.13], noiseStrength: [0.72], noiseScale: [0.005], corridorStrength: [2.01], corridorRadius: [56], haloStrength: [0.43], opacity: [0.42], softness: [3.2], particleSize: [1.3], spawnSpread: [80], clearAlpha: [0.19], trails: true, showCorridors: false,
    },
    diagnostic: {
      particleCount: [220], speed: [0.28], noiseStrength: [0.5], noiseScale: [0.003], corridorStrength: [1.4], corridorRadius: [110], haloStrength: [0.5], opacity: [0.22], softness: [7], particleSize: [2.3], spawnSpread: [70], clearAlpha: [0.14], trails: true, showCorridors: true,
    },
  };

  const applyPreset = (p) => {
    setParticleCount(p.particleCount);
    setSpeed(p.speed);
    setNoiseStrength(p.noiseStrength);
    setNoiseScale(p.noiseScale);
    setCorridorStrength(p.corridorStrength);
    setCorridorRadius(p.corridorRadius);
    setHaloStrength(p.haloStrength);
    setOpacity(p.opacity);
    setSoftness(p.softness);
    setParticleSize(p.particleSize);
    setSpawnSpread(p.spawnSpread);
    setClearAlpha(p.clearAlpha);
    setTrails(p.trails);
    setShowCorridors(p.showCorridors);
  };

  const Row = ({ label, value, children }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-black/75">
        <span>{label}</span>
        <span className="font-mono text-black/45">{value}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3ecdc] text-[#26241e] p-6 md:p-8">
      <div className="mx-auto max-w-7xl grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="rounded-3xl border-black/10 bg-[#f8f1e3]/75 shadow-sm backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-xl">Node Flow v1 Demo</CardTitle>
            <p className="text-sm text-black/55 leading-relaxed">
              A Canvas-based hybrid field: corridor-guided motion + curl-like noise + soft atmospheric particles. This is a practical v1 for testing feel before deciding whether you really need WebGL.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-black/70">Background</Label>
                <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/30 px-2 py-2">
                  <input type="color" value={safeColor(backgroundColor, "#F3ECDC")} onChange={(e) => setBackgroundColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg border border-black/10 bg-transparent" />
                  <input value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-full bg-transparent text-sm outline-none" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-black/70">Particle</Label>
                <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/30 px-2 py-2">
                  <input type="color" value={safeColor(particleColor, "#62ACA7")} onChange={(e) => setParticleColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg border border-black/10 bg-transparent" />
                  <input value={particleColor} onChange={(e) => setParticleColor(e.target.value)} className="w-full bg-transparent text-sm outline-none" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="rounded-2xl" onClick={() => applyPreset(presets.readable)}>Readable</Button>
              <Button variant="secondary" className="rounded-2xl" onClick={() => applyPreset(presets.atmospheric)}>Atmospheric</Button>
              <Button variant="secondary" className="rounded-2xl" onClick={() => applyPreset(presets.diagnostic)}>Diagnostic</Button>
            </div>

            <Row label="Particle count" value={particleCount[0]}>
              <Slider min={60} max={600} step={10} value={particleCount} onValueChange={setParticleCount} />
            </Row>
            <Row label="Flow speed" value={speed[0].toFixed(2)}>
              <Slider min={0.08} max={0.6} step={0.01} value={speed} onValueChange={setSpeed} />
            </Row>
            <Row label="Noise strength" value={noiseStrength[0].toFixed(2)}>
              <Slider min={0} max={1.4} step={0.01} value={noiseStrength} onValueChange={setNoiseStrength} />
            </Row>
            <Row label="Noise scale" value={noiseScale[0].toFixed(4)}>
              <Slider min={0.0012} max={0.007} step={0.0001} value={noiseScale} onValueChange={setNoiseScale} />
            </Row>
            <Row label="Corridor strength" value={corridorStrength[0].toFixed(2)}>
              <Slider min={0.2} max={2.2} step={0.01} value={corridorStrength} onValueChange={setCorridorStrength} />
            </Row>
            <Row label="Corridor radius" value={corridorRadius[0]}>
              <Slider min={40} max={180} step={1} value={corridorRadius} onValueChange={setCorridorRadius} />
            </Row>
            <Row label="Node halo strength" value={haloStrength[0].toFixed(2)}>
              <Slider min={0} max={1.4} step={0.01} value={haloStrength} onValueChange={setHaloStrength} />
            </Row>
            <Row label="Particle opacity" value={opacity[0].toFixed(2)}>
              <Slider min={0.04} max={0.5} step={0.01} value={opacity} onValueChange={setOpacity} />
            </Row>
            <Row label="Softness radius" value={softness[0].toFixed(1)}>
              <Slider min={2} max={14} step={0.1} value={softness} onValueChange={setSoftness} />
            </Row>
            <Row label="Particle size" value={particleSize[0].toFixed(1)}>
              <Slider min={0.5} max={5} step={0.1} value={particleSize} onValueChange={setParticleSize} />
            </Row>
            <Row label="Spawn spread" value={spawnSpread[0]}>
              <Slider min={10} max={150} step={1} value={spawnSpread} onValueChange={setSpawnSpread} />
            </Row>
            <Row label="Trail persistence" value={clearAlpha[0].toFixed(2)}>
              <Slider min={0.03} max={0.35} step={0.01} value={clearAlpha} onValueChange={setClearAlpha} />
            </Row>

            <div className="grid grid-cols-1 gap-3 pt-2">
              <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/20 px-3 py-2">
                <Label htmlFor="trails">Trails</Label>
                <Switch id="trails" checked={trails} onCheckedChange={setTrails} />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/20 px-3 py-2">
                <Label htmlFor="corridors">Show corridor debug</Label>
                <Switch id="corridors" checked={showCorridors} onCheckedChange={setShowCorridors} />
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/25 p-4 text-sm text-black/55 leading-relaxed">
              Relationship marks are lightly visible: green dashed arrow for <span className="text-black/80">leads_to</span>, blue dashed line for <span className="text-black/80">parallel</span>, and rust dashed line with × for <span className="text-black/80">contradicts</span>.
            </div>
          </CardContent>
        </Card>

        <FieldPreview graph={graphTemplate} params={params} />
      </div>
    </div>
  );
}
