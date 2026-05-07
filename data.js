// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const FRAGMENTS_KEY    = 'synthesis-fragments';
const CANVAS_KEY       = 'synthesis-canvas-state';
const SESSIONS_KEY     = 'synthesis-sessions';
const PROJECT_TITLE_KEY = 'synthesis-project-title';
const COL_AMBIENT      = [122, 181, 168];
const COL_PARALLEL     = [122, 181, 168]; // parallel: resonating / echoing thoughts
const COL_LEADS        = [74,  140, 130]; // leads_to: directional development
const COL_CONTRADICTS  = [176, 122,  90]; // contradicts: tension / opposition

const RADIUS_SIMPLIFY = 32;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let fragments        = [];
let canvasState      = { x: 0, y: 0, scale: 1 };
let fragmentCounter  = 0;
let projectTitle     = 'Untitled Project';

let sessions         = [];
let currentSessionId = null;
let sessionCounter   = 0;

let paths          = [];
let graphFilters   = { type: '__all', tag: '__all' };
let suggestedNodes = []; // floating suggestion nodes — ephemeral, not persisted
let hoveredNodeId = null;

let isPanning      = false;
let panStart       = { x: 0, y: 0 };
let draggingNode   = null;
let connectingFrom = null;
let connectMouse   = { x: 0, y: 0 };
let pendingConn    = null;
let editFrag       = null;
let ctxFrag        = null;
let skipNextClick  = false; // prevents click from closing type picker after conn drag

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════
function saveFragments() {
  localStorage.setItem(FRAGMENTS_KEY, JSON.stringify(fragments));
}
function saveCanvas() {
  localStorage.setItem(CANVAS_KEY, JSON.stringify(canvasState));
}
function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}
function saveProjectTitle() {
  localStorage.setItem(PROJECT_TITLE_KEY, projectTitle);
}

function generateId() {
  return 'f' + String(++fragmentCounter).padStart(3, '0');
}
function generateSessionId() {
  return 's' + String(++sessionCounter).padStart(3, '0');
}

function createSession(inputType, transcript) {
  const session = {
    id:          generateSessionId(),
    timestamp:   new Date().toISOString(),
    label:       '',
    inputType,
    transcript:  transcript || null,
    fragmentIds: [],
    visible:     true,
  };
  sessions.push(session);
  currentSessionId = session.id;
  saveSessions();
  return session;
}

function getFragmentsBySession(sessionId) {
  return fragments.filter(f => f.sessionId === sessionId);
}

function migrateLegacyFragments() {
  const needsMigration = fragments.some(f => !f.sessionId);
  if (!needsMigration) return;
  const legacy = {
    id: 's000', timestamp: '', label: 'before',
    inputType: 'manual', transcript: null,
    fragmentIds: [], visible: true,
  };
  fragments.forEach(f => {
    if (!f.sessionId) {
      f.sessionId = 's000';
      f.origin    = 'manual';
      legacy.fragmentIds.push(f.id);
    }
  });
  sessions.unshift(legacy);
  saveSessions();
  saveFragments();
}

function loadState() {
  try {
    const cs = JSON.parse(localStorage.getItem(CANVAS_KEY));
    if (cs) {
      canvasState.x     = cs.x     ?? 0;
      canvasState.y     = cs.y     ?? 0;
      canvasState.scale = cs.scale ?? 1;
    }
  } catch(e) {}
  try {
    const fs = JSON.parse(localStorage.getItem(FRAGMENTS_KEY));
    if (Array.isArray(fs)) {
      fragments = fs;
      fragments.forEach(f => {
        const n = parseInt((f.id || '').replace('f',''), 10);
        if (!isNaN(n) && n > fragmentCounter) fragmentCounter = n;
      });
    }
  } catch(e) {}
  try {
    const ss = JSON.parse(localStorage.getItem(SESSIONS_KEY));
    if (Array.isArray(ss)) {
      sessions = ss;
      sessions.forEach(s => {
        const n = parseInt((s.id || '').replace('s',''), 10);
        if (!isNaN(n) && n > sessionCounter) sessionCounter = n;
      });
    }
  } catch(e) {}
  const savedTitle = localStorage.getItem(PROJECT_TITLE_KEY);
  if (savedTitle !== null) projectTitle = savedTitle;
  migrateLegacyFragments();
  currentSessionId = sessions.length ? sessions[sessions.length - 1].id : null;
}

// ═══════════════════════════════════════════════════════════════
// WEIGHT + CONVERGENCE — do not change these formulas
// ═══════════════════════════════════════════════════════════════
function calculateWeight(tag, frags) {
  const freq  = frags.filter(f => f.tags.includes(tag)).length;
  const conns = frags.reduce((s, f) => s + f.connections.filter(c => {
    const t = frags.find(x => x.id === c.to);
    return t && t.tags.includes(tag);
  }).length, 0);
  return freq * (1 + conns); // counter connections weighted 1.5x
}

function updateFragmentWeights(frags) {
  const NEARBY_R2 = 200 * 200;
  for (const frag of frags) {
    const connectionCount = frag.connections.length;
    let nearbyNodeCount = 0;
    let sharedTagCount = 0;
    for (const other of frags) {
      if (other.id === frag.id) continue;
      const dx = frag.x - other.x, dy = frag.y - other.y;
      if (dx * dx + dy * dy < NEARBY_R2) nearbyNodeCount++;
      for (const tag of frag.tags) {
        if (other.tags.includes(tag)) sharedTagCount++;
      }
    }
    frag.weight = 1 + (connectionCount * 0.35) + (nearbyNodeCount * 0.25) + (sharedTagCount * 0.15);
  }
}

function calculateConvergence(frags) {
  const allTags = frags.flatMap(f => f.tags);
  const unique  = new Set(allTags).size;
  const concentration = unique > 0 ? Math.min((allTags.length / unique) / 5, 1) : 0;
  const totalConns = frags.reduce((s, f) => s + f.connections.length, 0);
  const maxConns   = frags.length * (frags.length - 1);
  const density    = maxConns > 0 ? totalConns / maxConns : 0;
  return (concentration + density) / 2;
}

// ═══════════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════════
function exportProject() {
  const title = (projectTitle || 'synthesis').replace(/\s+/g, '-').toLowerCase();
  const payload = {
    projectTitle,
    sessions,
    fragments,
    fragmentCounter,
    sessionCounter,
    canvasState,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = title + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function clearProject() {
  fragments        = [];
  sessions         = [];
  fragmentCounter  = 0;
  sessionCounter   = 0;
  currentSessionId = null;
  saveFragments();
  saveSessions();
}

function applyImportedState(data) {
  sessions        = data.sessions;
  fragments       = data.fragments;
  fragmentCounter = data.fragmentCounter ?? 0;
  sessionCounter  = data.sessionCounter  ?? 0;
  if (data.canvasState) {
    canvasState.x     = data.canvasState.x     ?? 0;
    canvasState.y     = data.canvasState.y      ?? 0;
    canvasState.scale = data.canvasState.scale  ?? 1;
  }
  if (data.projectTitle) projectTitle = data.projectTitle;
  currentSessionId = sessions.length ? sessions[sessions.length - 1].id : null;
  saveFragments();
  saveSessions();
  saveCanvas();
  saveProjectTitle();
}

// ═══════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════
function pickLayoutType(frags) {
  const text = frags.map(f => (f.title || '') + ' ' + (f.content || '')).join(' ').toLowerCase();

  if (/\b(but|however|vs|versus|tension|contradicts|conflict)\b/.test(text)) return 'tension';
  if (/\b(then|after|before|step|process|next|first|finally)\b/.test(text)) return 'flow';

  const typeCounts = {};
  frags.forEach(f => { typeCounts[f.type] = (typeCounts[f.type] || 0) + 1; });
  const maxCount = Math.max(0, ...Object.values(typeCounts));
  if (frags.length >= 4 && maxCount / frags.length > 0.4) return 'cluster';

  return 'fallback';
}

function flowLayout(frags) {
  const SPACING = 120;
  const n       = frags.length;
  return frags.map((frag, i) => ({
    id: frag.id,
    x:  i * SPACING - ((n - 1) * SPACING) / 2,
    y:  Math.sin((i / Math.max(n - 1, 1)) * Math.PI) * -55,
  }));
}

function tensionLayout(frags) {
  const SPACING_Y   = 110;
  const X_SPREAD    = 240;
  const centerCount = frags.length % 2;
  const sideCount   = Math.floor(frags.length / 2);
  const result      = [];

  for (let i = 0; i < sideCount; i++) {
    result.push({ id: frags[i].id, x: -X_SPREAD, y: (i - (sideCount - 1) / 2) * SPACING_Y });
  }
  if (centerCount) {
    result.push({ id: frags[sideCount].id, x: 0, y: 0 });
  }
  for (let i = 0; i < sideCount; i++) {
    result.push({ id: frags[sideCount + centerCount + i].id, x: X_SPREAD, y: (i - (sideCount - 1) / 2) * SPACING_Y });
  }
  return result;
}

function clusterLayout(frags) {
  const GROUP_COUNT = Math.min(3, Math.ceil(frags.length / 2));
  const SPACING_X   = 260;
  const SPACING_Y   = 100;
  const chunkSize   = Math.ceil(frags.length / GROUP_COUNT);
  return frags.map((frag, i) => {
    const g      = Math.floor(i / chunkSize);
    const gi     = i % chunkSize;
    const gCount = Math.min(chunkSize, frags.length - g * chunkSize);
    return {
      id: frag.id,
      x:  (g - (GROUP_COUNT - 1) / 2) * SPACING_X,
      y:  (gi - (gCount - 1) / 2) * SPACING_Y,
    };
  });
}

function layoutFragments(frags) {
  const type = pickLayoutType(frags);
  if (type === 'flow')    return flowLayout(frags);
  if (type === 'tension') return tensionLayout(frags);
  if (type === 'cluster') return clusterLayout(frags);
  // fallback: grid
  const COLS = 5, SPACING = 130;
  const rows    = Math.ceil(frags.length / COLS);
  const offsetX = ((Math.min(frags.length, COLS) - 1) * SPACING) / 2;
  const offsetY = ((rows - 1) * SPACING) / 2;
  return frags.map((frag, i) => ({
    id: frag.id,
    x:  (i % COLS) * SPACING - offsetX,
    y:  Math.floor(i / COLS) * SPACING - offsetY,
  }));
}

// Flatten all fragment connections into { from, to, type } relationship objects.
// Used by graph analysis — keeps the data layer separate from the fragment format.
function getAllRelationships(frags) {
  frags = frags || fragments;
  const rels = [];
  frags.forEach(f => {
    (f.connections || []).forEach(conn => {
      rels.push({ from: f.id, to: conn.to, type: conn.type });
    });
  });
  return rels;
}

// Nodes as { id, label } pairs — used by suggest directions
function getCurrentNodesForAPI() {
  return fragments.filter(f => f.title).map(f => ({ id: f.id, label: f.title }));
}

// All non-empty node titles — used by concept synthesis
function getCurrentNodeLabels() {
  return fragments.map(f => f.title || '').filter(Boolean);
}

// Fragment whose tags have the lowest overlap with other fragments
function findOutlierFragment() {
  if (!fragments.length) return null;
  let minOverlap = Infinity, outlier = fragments[0];
  for (const frag of fragments) {
    const overlap = frag.tags.reduce((s, tag) =>
      s + fragments.filter(f => f.id !== frag.id && f.tags.includes(tag)).length, 0);
    if (overlap < minOverlap) { minOverlap = overlap; outlier = frag; }
  }
  return outlier;
}
