// ═══════════════════════════════════════════════════════════════
// INPUT — voice capture + text dump + extraction pipeline
// Depends on: data.js (createSession, generateId, fragments,
//             sessions, saveFragments, saveSessions)
//             app.js  (buildNode, updateHint, toWorld)
//             particles.js (buildAllPaths)
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// FRAGMENT PLACEMENT
// Spread fragments around the current viewport center in world coords
// ═══════════════════════════════════════════════════════════════
function clusterPositions(count) {
  const cx = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  const radius = 220;
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle  = (i / count) * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 90;
    positions.push({
      x: cx.x + Math.cos(angle) * (radius + jitter),
      y: cx.y + Math.sin(angle) * (radius + jitter),
    });
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
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
    return data.fragments;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('extraction timed out');
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
// MAIN EXTRACTION FLOW
// ═══════════════════════════════════════════════════════════════
async function extractAndInject(rawTranscript, inputType) {
  // 1. Clean + validate
  const cleaned = cleanTranscript(rawTranscript);
  if (!cleaned || cleaned.split(/\s+/).length < 3) {
    showInputError('transcript too short');
    return;
  }

  // 2. Status
  showInputStatus('extracting...');

  // 3. API call
  let extracted;
  try {
    extracted = await callExtract(cleaned, inputType);
  } catch (err) {
    showInputError(err.message);
    return;
  }

  // 4. Validate response shape
  if (!Array.isArray(extracted) || extracted.length === 0) {
    showInputError('no fragments returned');
    return;
  }

  // 5. Deduplicate + trim
  const deduped = deduplicateLabels(extracted).slice(0, 20);
  if (deduped.length === 0) {
    showInputError('all fragments were duplicates');
    return;
  }

  // 6. Inject into graph
  injectSession(rawTranscript, inputType, deduped);
  clearInputStatus();
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
