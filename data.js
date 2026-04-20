// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const FRAGMENTS_KEY = 'synthesis-fragments';
const CANVAS_KEY    = 'synthesis-canvas-state';
const SESSIONS_KEY  = 'synthesis-sessions';
const COL_AMBIENT = [122, 181, 168];
const COL_ECHOES  = [122, 181, 168];
const COL_LEADS   = [74,  140, 130];
const COL_COUNTER = [176, 122,  90];

const RADIUS_SIMPLIFY = 32;
const RADIUS_VISIBLE  = 68;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let fragments        = [];
let canvasState      = { x: 0, y: 0, scale: 1 };
let fragmentCounter  = 0;
let nodeTextMode     = 'simplify'; // 'simplify' | 'visible'

let sessions         = [];
let currentSessionId = null;
let sessionCounter   = 0;

let paths     = [];
let graphFilters = { type: '__all', tag: '__all' };
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

function calculateConvergence(frags) {
  const allTags = frags.flatMap(f => f.tags);
  const unique  = new Set(allTags).size;
  const concentration = unique > 0 ? Math.min((allTags.length / unique) / 5, 1) : 0;
  const totalConns = frags.reduce((s, f) => s + f.connections.length, 0);
  const maxConns   = frags.length * (frags.length - 1);
  const density    = maxConns > 0 ? totalConns / maxConns : 0;
  return (concentration + density) / 2;
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
