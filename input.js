// ═══════════════════════════════════════════════════════════════
// INPUT — voice capture + text dump + extraction pipeline
// Depends on: data.js (createSession, generateId, fragments,
//             sessions, saveFragments, saveSessions)
//             app.js  (buildNode, updateHint, toWorld)
//             particles.js (buildAllPaths)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TRANSCRIPT VIEWER
// ═══════════════════════════════════════════════════════════════
function openTranscriptView(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const metaEl = document.getElementById('transcript-meta');
  const bodyEl = document.getElementById('transcript-body');
  if (!metaEl || !bodyEl) return;

  const date      = session.timestamp ? new Date(session.timestamp).toLocaleString() : '';
  const inputType = session.inputType || '';
  metaEl.textContent = [date, inputType].filter(Boolean).join('  ·  ');

  bodyEl.textContent = session.transcript
    ? session.transcript
    : '(no transcript saved for this session)';

  document.getElementById('transcript-overlay')?.classList.add('open');
}

// ═══════════════════════════════════════════════════════════════
// PENDING PATCH STATE
// ═══════════════════════════════════════════════════════════════
let pendingPatch          = null;
let pendingPatchRaw       = '';
let pendingPatchInputType = '';

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════
const FILLER_RE = /\b(um+|uh+|like|so|just|you know|kind of|sort of|basically|literally|i mean|right|okay|ok|yeah|yep|well|actually|honestly)\b/gi;

function cleanTranscript(raw) {
  return raw
    .replace(FILLER_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════
// STATUS DISPLAY
// ═══════════════════════════════════════════════════════════════
function showInputStatus(msg) {
  const el = document.getElementById('input-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'input-status';
}

function showInputError(msg) {
  const el = document.getElementById('input-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'input-status error';
  setTimeout(() => { if (el.className === 'input-status error') el.textContent = ''; el.className = 'input-status'; }, 4000);
}

function clearInputStatus() {
  const el = document.getElementById('input-status');
  if (!el) return;
  el.textContent = '';
  el.className = 'input-status';
}

async function readApiJson(resp, flowName) {
  const text = await resp.text();
  if (!text.trim()) {
    throw new Error(`${flowName}: empty server response`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${flowName}: server returned invalid JSON (${err.message})`);
  }
}

function apiErrorMessage(flowName, resp, data) {
  const code = data?.code ? ` [${data.code}]` : '';
  const detail = data?.detail ? `: ${data.detail}` : '';
  const msg = data?.error || `HTTP ${resp.status}`;
  return `${flowName}: ${msg}${code}${detail}`;
}

function validatePatchShape(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('patch: invalid patch shape [CLIENT_PATCH_SHAPE_INVALID]');
  }

  const required = ['newNodes', 'editedNodes', 'keptNodes', 'relationships', 'topTags'];
  const bad = required.filter(key => !Array.isArray(patch[key]));
  if (bad.length) {
    throw new Error(`patch: invalid patch shape, expected arrays for ${bad.join(', ')} [CLIENT_PATCH_SHAPE_INVALID]`);
  }
}

// ═══════════════════════════════════════════════════════════════
// FRAGMENT PLACEMENT
// Spread fragments around the current viewport center in world coords
// ═══════════════════════════════════════════════════════════════
function clusterPositions(count, relationships = [], existingFragments = []) {
  if (count === 0) return [];

  // Find existing nodes referenced in relationships (non-new: refs)
  const referencedIds = new Set();
  relationships.forEach(r => {
    if (typeof r.from === 'string' && !r.from.startsWith('new:')) referencedIds.add(r.from);
    if (typeof r.to   === 'string' && !r.to.startsWith('new:'))   referencedIds.add(r.to);
  });
  const anchors = existingFragments.filter(f => referencedIds.has(f.id));

  let cx, cy;
  if (anchors.length > 0) {
    cx = anchors.reduce((s, f) => s + f.x, 0) / anchors.length;
    cy = anchors.reduce((s, f) => s + f.y, 0) / anchors.length;
    const angle = Math.random() * Math.PI * 2;
    cx += Math.cos(angle) * 320;
    cy += Math.sin(angle) * 200;
  } else {
    const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);
    cx = center.x;
    cy = center.y;
  }

  const radius  = 160 + count * 18;
  const minGap  = 85;
  const positions = [];

  for (let i = 0; i < count; i++) {
    let best = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const r = radius + (Math.random() - 0.5) * 80;
      const cand = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };

      const dPlaced   = positions.length
        ? Math.min(...positions.map(p => Math.hypot(p.x - cand.x, p.y - cand.y)))
        : Infinity;
      const dExisting = existingFragments.length
        ? Math.min(...existingFragments.map(f => Math.hypot(f.x - cand.x, f.y - cand.y)))
        : Infinity;
      const score = Math.min(dPlaced, dExisting);
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    if (bestScore < minGap && positions.length > 0) {
      best.x += (Math.random() - 0.5) * 100;
      best.y += (Math.random() - 0.5) * 100;
    }
    positions.push(best);
  }
  return positions;
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════
function deduplicateLabels(frags) {
  const seen = new Set();
  return frags.filter(f => {
    const key = (f.label || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// EXTRACTION API CALL
// ═══════════════════════════════════════════════════════════════
async function callExtract(transcript, inputType) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch('/api/extract', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ transcript, inputType }),
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    const data = await readApiJson(resp, 'extract');
    if (!resp.ok || data.error) throw new Error(apiErrorMessage('extract', resp, data));
    if (!Array.isArray(data.fragments)) {
      throw new Error('extract: invalid server payload, expected fragments array [CLIENT_EXTRACT_SHAPE_INVALID]');
    }
    return data.fragments;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('extraction timed out');
    if (err instanceof TypeError) throw new Error(`extract: network failure (${err.message})`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// PATCH API CALL
// ═══════════════════════════════════════════════════════════════
async function callPatch(transcript, existingNodes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch('/api/patch', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ transcript, existingNodes }),
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    const data = await readApiJson(resp, 'patch');
    if (!resp.ok || data.error) throw new Error(apiErrorMessage('patch', resp, data));
    validatePatchShape(data.patch);
    return data.patch;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('patch timed out');
    if (err instanceof TypeError) throw new Error(`patch: network failure (${err.message})`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION + FRAGMENT INJECTION
// ═══════════════════════════════════════════════════════════════
function injectSession(rawTranscript, inputType, extractedFragments) {
  const frags     = extractedFragments.slice(0, 20);
  const session   = createSession(inputType, rawTranscript);
  const positions = clusterPositions(frags.length);

  frags.forEach((ef, i) => {
    const frag = {
      id:          generateId(),
      timestamp:   new Date().toISOString(),
      title:       ef.label      || '',
      content:     ef.sourceSpan || '',
      type:        ef.type       || 'observation',
      source:      inputType === 'voice' ? 'voice' : 'text',
      tags:        Array.isArray(ef.tags) ? ef.tags.slice(0, 3) : [],
      connections: [],
      weight:      0,
      x:           positions[i].x,
      y:           positions[i].y,
      sessionId:   session.id,
      origin:      'extracted',
    };
    fragments.push(frag);
    session.fragmentIds.push(frag.id);
    buildNode(frag);
  });

  saveFragments();
  saveSessions();
  if (typeof refreshFilterOptions === 'function') refreshFilterOptions();
  buildAllPaths();
  updateHint();
}

// ═══════════════════════════════════════════════════════════════
// PATCH REVIEW — resolve a from/to ref to a display label
// ═══════════════════════════════════════════════════════════════
function resolveRefLabel(ref, newNodes) {
  if (typeof ref === 'string' && ref.startsWith('new:')) {
    const idx = parseInt(ref.slice(4), 10);
    return (!isNaN(idx) && newNodes[idx]) ? newNodes[idx].label : ref;
  }
  const existing = fragments.find(f => f.id === ref);
  return existing ? existing.title : ref;
}

// ═══════════════════════════════════════════════════════════════
// PATCH REVIEW — render and show popup
// ═══════════════════════════════════════════════════════════════
function showPatchReview(patch, rawTranscript, inputType) {
  pendingPatch          = patch;
  pendingPatchRaw       = rawTranscript;
  pendingPatchInputType = inputType;

  const transcriptEl = document.getElementById('patch-transcript-text');
  if (transcriptEl) transcriptEl.textContent = rawTranscript;

  const sectionsEl = document.getElementById('patch-sections');
  if (!sectionsEl) return;
  sectionsEl.innerHTML = '';

  function makeSection(title) {
    const sec = document.createElement('div');
    sec.className = 'pp-section';
    const h = document.createElement('div');
    h.className = 'pp-section-title';
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  }

  // new nodes
  if (patch.newNodes.length) {
    const sec = makeSection(`new  (${patch.newNodes.length})`);
    patch.newNodes.forEach(n => {
      const row = document.createElement('div');
      row.className = 'pp-node-new';
      row.innerHTML =
        `<div>${n.label || ''}</div>` +
        `<div class="pp-node-span">${n.sourceSpan || ''}</div>`;
      sec.appendChild(row);
    });
    sectionsEl.appendChild(sec);
  }

  // edited nodes
  if (patch.editedNodes.length) {
    const sec = makeSection(`refined  (${patch.editedNodes.length})`);
    patch.editedNodes.forEach(e => {
      const existing = fragments.find(f => f.id === e.id);
      const row = document.createElement('div');
      row.className = 'pp-node-edited';
      const before = existing ? existing.title : e.id;
      row.innerHTML =
        `<div>${before}<span class="pp-node-arrow">→</span>${e.label || ''}</div>` +
        `<div class="pp-node-reason">${e.reason || ''}</div>`;
      sec.appendChild(row);
    });
    sectionsEl.appendChild(sec);
  }

  // kept nodes
  if (patch.keptNodes.length) {
    const sec = makeSection(`confirmed  (${patch.keptNodes.length})`);
    patch.keptNodes.forEach(id => {
      const existing = fragments.find(f => f.id === id);
      const row = document.createElement('div');
      row.className = 'pp-node-kept';
      row.textContent = existing ? existing.title : id;
      sec.appendChild(row);
    });
    sectionsEl.appendChild(sec);
  }

  // relationships
  if (patch.relationships.length) {
    const sec = makeSection(`connections  (${patch.relationships.length})`);
    patch.relationships.forEach(r => {
      const fromLabel = resolveRefLabel(r.from, patch.newNodes);
      const toLabel   = resolveRefLabel(r.to,   patch.newNodes);
      const row = document.createElement('div');
      row.className = 'pp-rel';
      row.innerHTML =
        `<span>${fromLabel}</span>` +
        `<span class="pp-rel-type">${r.type.replace('_', ' ')}</span>` +
        `<span>${toLabel}</span>`;
      sec.appendChild(row);
    });
    sectionsEl.appendChild(sec);
  }

  // topTags
  if (patch.topTags.length) {
    const sec = makeSection('session tags');
    const tagsEl = document.createElement('div');
    tagsEl.className = 'pp-tags';
    patch.topTags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'pp-tag';
      span.textContent = t;
      tagsEl.appendChild(span);
    });
    sec.appendChild(tagsEl);
    sectionsEl.appendChild(sec);
  }

  document.getElementById('patch-overlay')?.classList.add('open');
}

// ═══════════════════════════════════════════════════════════════
// APPLY PATCH — called on "accept all"
// ═══════════════════════════════════════════════════════════════
function applyPatch(patch, rawTranscript, inputType) {
  const session   = createSession(inputType, rawTranscript);
  session.topTags = patch.topTags || [];

  const positions = clusterPositions(patch.newNodes.length, patch.relationships, fragments);
  const newIds    = [];

  // Add new nodes
  patch.newNodes.forEach((n, i) => {
    const frag = {
      id:          generateId(),
      timestamp:   new Date().toISOString(),
      title:       n.label      || '',
      content:     n.sourceSpan || '',
      type:        n.type       || 'observation',
      source:      inputType === 'voice' ? 'voice' : 'text',
      tags:        patch.topTags ? patch.topTags.slice() : [],
      connections: [],
      weight:      0,
      x:           positions[i].x,
      y:           positions[i].y,
      sessionId:   session.id,
      origin:      'extracted',
    };
    fragments.push(frag);
    session.fragmentIds.push(frag.id);
    newIds.push(frag.id);
    buildNode(frag);
  });

  // Apply edited nodes
  patch.editedNodes.forEach(e => {
    const frag = fragments.find(f => f.id === e.id);
    if (!frag) return;
    if (e.label)   frag.title   = e.label;
    if (e.content) frag.content = e.content;
    const nodeEl = document.querySelector(`.node[data-id="${e.id}"]`);
    if (nodeEl) {
      const titleEl = nodeEl.querySelector('.node-title');
      if (titleEl) titleEl.textContent = frag.title;
    }
  });

  // Apply relationships — resolve new:<index> refs
  function resolveId(ref) {
    if (typeof ref === 'string' && ref.startsWith('new:')) {
      const idx = parseInt(ref.slice(4), 10);
      return (!isNaN(idx) && newIds[idx]) ? newIds[idx] : null;
    }
    return fragments.find(f => f.id === ref) ? ref : null;
  }

  patch.relationships.forEach(r => {
    const fromId = resolveId(r.from);
    const toId   = resolveId(r.to);
    if (!fromId || !toId || fromId === toId) return;
    const fromFrag = fragments.find(f => f.id === fromId);
    if (!fromFrag) return;
    const already = fromFrag.connections.some(c => c.to === toId && c.type === r.type);
    if (already) return;
    fromFrag.connections.push({ to: toId, type: r.type });
  });

  saveFragments();
  saveSessions();
  if (typeof refreshFilterOptions === 'function') refreshFilterOptions();
  buildAllPaths();
  updateHint();
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FLOW
// ═══════════════════════════════════════════════════════════════
async function extractAndInject(rawTranscript, inputType) {
  const cleaned = cleanTranscript(rawTranscript);
  if (!cleaned || cleaned.split(/\s+/).length < 3) {
    showInputError('transcript too short');
    return;
  }

  showInputStatus('thinking...');

  const existingNodes = fragments.map(f => ({
    id:      f.id,
    label:   f.title,
    content: f.content,
    type:    f.type,
    tags:    f.tags,
  }));

  let patch;
  try {
    patch = await callPatch(cleaned, existingNodes);
  } catch (err) {
    showInputError(err.message);
    return;
  }

  clearInputStatus();
  showPatchReview(patch, rawTranscript, inputType);
}

// ═══════════════════════════════════════════════════════════════
// VOICE CAPTURE
// ═══════════════════════════════════════════════════════════════
let recognition     = null;
let voiceActive     = false;
let voiceFinalText  = '';

function startVoice() {
  if (voiceActive) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showInputError('speech recognition not supported in this browser');
    return;
  }

  voiceFinalText = '';
  voiceActive    = true;
  document.getElementById('voice-btn')?.classList.add('recording');
  showInputStatus('listening...');

  recognition                  = new SpeechRecognition();
  recognition.continuous       = true;
  recognition.interimResults   = true;
  recognition.lang             = 'en-US';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) voiceFinalText += t + ' ';
      else interim += t;
    }
    const preview = (voiceFinalText + interim).slice(-60);
    showInputStatus('● ' + preview);
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return; // harmless
    showInputError('mic: ' + e.error);
    stopVoice();
  };

  recognition.onend = () => {
    // Browser cuts off after ~60s — restart if still intentionally recording
    if (voiceActive) {
      try { recognition.start(); } catch(_) {}
    }
  };

  try {
    recognition.start();
  } catch (err) {
    showInputError(err.message);
    voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  }
}

function stopVoice() {
  if (!voiceActive) return;
  voiceActive = false;
  document.getElementById('voice-btn')?.classList.remove('recording');

  if (recognition) {
    recognition.onend = null; // prevent auto-restart on the stop-triggered onend
    recognition.stop();
    recognition = null;
  }

  const transcript = voiceFinalText.trim();
  voiceFinalText   = '';

  if (transcript) {
    extractAndInject(transcript, 'voice');
  } else {
    clearInputStatus();
  }
}

function toggleVoice() {
  if (voiceActive) stopVoice();
  else startVoice();
}

// ═══════════════════════════════════════════════════════════════
// TEXT DUMP
// ═══════════════════════════════════════════════════════════════
function openTextDump() {
  const panel = document.getElementById('text-dump-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.querySelector('textarea').focus();
}

function closeTextDump() {
  const panel = document.getElementById('text-dump-panel');
  if (!panel) return;
  panel.style.display = 'none';
  panel.querySelector('textarea').value = '';
}

async function submitTextDump() {
  const panel = document.getElementById('text-dump-panel');
  if (!panel) return;
  const raw = panel.querySelector('textarea').value.trim();
  if (!raw) { showInputError('nothing to extract'); return; }
  closeTextDump();
  await extractAndInject(raw, 'text');
}

// ═══════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════
(function wireInputEvents() {
  document.getElementById('voice-btn')
    ?.addEventListener('click', toggleVoice);

  document.getElementById('dump-btn')
    ?.addEventListener('click', openTextDump);

  document.getElementById('dump-submit')
    ?.addEventListener('click', submitTextDump);

  document.getElementById('dump-cancel')
    ?.addEventListener('click', closeTextDump);

  document.querySelector('#text-dump-panel textarea')
    ?.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitTextDump();
      if (e.key === 'Escape') closeTextDump();
    });

  // Close text dump on outside click
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('text-dump-panel');
    if (!panel || panel.style.display === 'none') return;
    if (!panel.contains(e.target) &&
        !e.target.closest('#dump-btn')) {
      closeTextDump();
    }
  });

  document.getElementById('transcript-close')
    ?.addEventListener('click', () => {
      document.getElementById('transcript-overlay')?.classList.remove('open');
    });

  document.getElementById('transcript-overlay')
    ?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('transcript-overlay'))
        document.getElementById('transcript-overlay').classList.remove('open');
    });

  document.getElementById('patch-accept')
    ?.addEventListener('click', () => {
      if (!pendingPatch) return;
      applyPatch(pendingPatch, pendingPatchRaw, pendingPatchInputType);
      pendingPatch = null; pendingPatchRaw = ''; pendingPatchInputType = '';
      document.getElementById('patch-overlay')?.classList.remove('open');
    });

  document.getElementById('patch-cancel')
    ?.addEventListener('click', () => {
      pendingPatch = null; pendingPatchRaw = ''; pendingPatchInputType = '';
      document.getElementById('patch-overlay')?.classList.remove('open');
    });

  document.getElementById('patch-overlay')
    ?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('patch-overlay')) {
        pendingPatch = null; pendingPatchRaw = ''; pendingPatchInputType = '';
        document.getElementById('patch-overlay').classList.remove('open');
      }
    });

  // Disable voice button if API unavailable
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const btn = document.getElementById('voice-btn');
    if (btn) {
      btn.title   = 'speech recognition not supported';
      btn.style.opacity = '0.3';
      btn.style.cursor  = 'default';
      btn.onclick = (e) => { e.stopPropagation(); showInputError('speech recognition not supported in this browser'); };
    }
  }
})();
