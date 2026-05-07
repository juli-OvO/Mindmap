// ═══════════════════════════════════════════════════════════════
// SYNTHESIS — popup, API call, output rendering
// ═══════════════════════════════════════════════════════════════
let confirmedState = null;

function openSynthPopup() {
  if (fragments.length === 0) return;

  // Build keyword list (all unique tags, sorted by weight desc)
  const tagSet = new Set(fragments.flatMap(f => f.tags));
  const keywords = [...tagSet]
    .map(tag => ({ tag, weight: calculateWeight(tag, fragments), removed: false }))
    .sort((a, b) => b.weight - a.weight);

  // Build connection list with 12-char snippets
  const connections = [];
  fragments.forEach(frag => {
    frag.connections.forEach(conn => {
      const toFrag = fragments.find(f => f.id === conn.to);
      if (!toFrag) return;
      connections.push({
        fromId:      frag.id,
        toId:        conn.to,
        fromSnippet: (frag.content   || frag.id).slice(0, 12),
        toSnippet:   (toFrag.content || toFrag.id).slice(0, 12),
        type:        conn.type,
        removed:     false,
      });
    });
  });

  confirmedState = {
    keywords,
    connections,
    trigger: 'what am i circling?',
  };

  document.getElementById('synth-overlay').style.display = 'block';
  renderSynthPopup();
}

function closeSynthPopup() {
  document.getElementById('synth-overlay').style.display = 'none';
}

function renderSynthPopup() {
  const popup     = document.getElementById('synth-popup');
  const totalConn = fragments.reduce((s, f) => s + f.connections.length, 0);
  popup.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.className   = 'sp-header';
  hdr.textContent = `— confirm synthesis — ${fragments.length} fragment${fragments.length !== 1 ? 's' : ''} · ${totalConn} connection${totalConn !== 1 ? 's' : ''}`;
  popup.appendChild(hdr);

  // Keywords
  const kwSec = document.createElement('div');
  kwSec.className = 'sp-section';
  const kwTitle = document.createElement('div');
  kwTitle.className   = 'sp-section-title';
  kwTitle.textContent = 'keywords by weight';
  kwSec.appendChild(kwTitle);

  const activeKw = confirmedState.keywords.filter(k => !k.removed);
  if (activeKw.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:10px;color:rgba(139,115,85,0.45);padding:3px 0;';
    empty.textContent = 'no tags yet';
    kwSec.appendChild(empty);
  }
  confirmedState.keywords.forEach((kw, i) => {
    if (kw.removed) return;
    const row = document.createElement('div');
    row.className = 'sp-kw-row';
    const lbl = document.createElement('span');
    lbl.textContent = kw.tag;
    const right = document.createElement('span');
    right.className = 'sp-right';
    const wt = document.createElement('span');
    wt.className   = 'sp-kw-weight';
    wt.textContent = kw.weight;
    const rm = document.createElement('span');
    rm.className   = 'sp-remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => { confirmedState.keywords[i].removed = true; renderSynthPopup(); });
    right.appendChild(wt);
    right.appendChild(rm);
    row.appendChild(lbl);
    row.appendChild(right);
    kwSec.appendChild(row);
  });
  popup.appendChild(kwSec);

  // Connections
  const connSec = document.createElement('div');
  connSec.className = 'sp-section';
  const connTitle = document.createElement('div');
  connTitle.className   = 'sp-section-title';
  connTitle.textContent = 'connections';
  connSec.appendChild(connTitle);

  const activeConn = confirmedState.connections.filter(c => !c.removed);
  if (activeConn.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:10px;color:rgba(139,115,85,0.45);padding:3px 0;';
    empty.textContent = 'no connections yet';
    connSec.appendChild(empty);
  }
  confirmedState.connections.forEach((conn, i) => {
    if (conn.removed) return;
    const row = document.createElement('div');
    row.className = 'sp-conn-row';
    const lbl = document.createElement('span');
    lbl.textContent = `[${conn.fromSnippet}] → ${conn.type} → [${conn.toSnippet}]`;
    const rm = document.createElement('span');
    rm.className   = 'sp-remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => { confirmedState.connections[i].removed = true; renderSynthPopup(); });
    row.appendChild(lbl);
    row.appendChild(rm);
    connSec.appendChild(row);
  });
  popup.appendChild(connSec);

  // Trigger selector
  const trigSec = document.createElement('div');
  trigSec.className = 'sp-section';
  const trigTitle = document.createElement('div');
  trigTitle.className   = 'sp-section-title';
  trigTitle.textContent = 'trigger';
  trigSec.appendChild(trigTitle);

  ['what am i circling?', 'give me the concept', 'push back', 'concept from labels'].forEach(trigger => {
    const row = document.createElement('div');
    const selected = confirmedState.trigger === trigger;
    row.className = 'sp-trigger-row' + (selected ? ' selected' : '');
    const arrow = document.createElement('span');
    arrow.className   = 'sp-trigger-arrow';
    arrow.textContent = selected ? '›' : ' ';
    const lbl = document.createElement('span');
    lbl.textContent = trigger;
    row.appendChild(arrow);
    row.appendChild(lbl);
    row.addEventListener('click', () => { confirmedState.trigger = trigger; renderSynthPopup(); });
    trigSec.appendChild(row);
  });
  popup.appendChild(trigSec);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'sp-footer';
  const cancel = document.createElement('button');
  cancel.className   = 'sp-btn';
  cancel.textContent = 'cancel';
  cancel.addEventListener('click', closeSynthPopup);
  const confirm = document.createElement('button');
  confirm.className   = 'sp-btn';
  confirm.textContent = 'confirm →';
  confirm.addEventListener('click', confirmSynthesis);
  footer.appendChild(cancel);
  footer.appendChild(confirm);
  popup.appendChild(footer);
}

async function confirmSynthesis() {
  closeSynthPopup();

  if (confirmedState.trigger === 'concept from labels') {
    await callSynthesis(getCurrentNodeLabels());
    return;
  }

  const output = document.getElementById('synth-output');
  output.style.display = 'block';
  output.innerHTML =
    '<button class="so-close" id="so-close-btn">×</button>' +
    '<div class="so-trigger-label">' + confirmedState.trigger + '</div>' +
    '<div class="so-text so-loading">synthesizing...</div>';
  document.getElementById('so-close-btn').addEventListener('click', () => {
    output.style.display = 'none';
  });

  const activeKw   = confirmedState.keywords.filter(k => !k.removed);
  const activeConn = confirmedState.connections.filter(c => !c.removed);

  // For "push back" send only the outlier fragment
  let fragPayload = fragments;
  if (confirmedState.trigger === 'push back') {
    const outlier = findOutlierFragment();
    fragPayload   = outlier ? [outlier] : (fragments.length ? [fragments[0]] : []);
  }

  try {
    const resp = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trigger:     confirmedState.trigger,
        fragments:   fragPayload,
        keywords:    activeKw,
        connections: activeConn,
      }),
    });

    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);

    output.innerHTML =
      '<button class="so-close" id="so-close-btn">×</button>' +
      '<div class="so-trigger-label">' + confirmedState.trigger + '</div>' +
      '<div class="so-text">' + escapeHtml(data.text) + '</div>';
    document.getElementById('so-close-btn').addEventListener('click', () => {
      output.style.display = 'none';
    });
  } catch (err) {
    output.innerHTML =
      '<button class="so-close" id="so-close-btn">×</button>' +
      '<div class="so-trigger-label">' + confirmedState.trigger + '</div>' +
      '<div class="so-text so-loading">error: ' + escapeHtml(err.message) + '</div>';
    document.getElementById('so-close-btn').addEventListener('click', () => {
      output.style.display = 'none';
    });
  }
}

async function callSynthesis(labels) {
  const output = document.getElementById('synth-output');
  output.style.display = 'block';
  output.innerHTML =
    '<button class="so-close" id="so-close-btn">×</button>' +
    '<div class="so-trigger-label">concept from labels</div>' +
    '<div class="so-text so-loading">synthesizing concept...</div>';
  document.getElementById('so-close-btn').addEventListener('click', () => {
    output.style.display = 'none';
  });

  try {
    const resp = await fetch('/api/synthesizeConcept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);

    output.innerHTML =
      '<button class="so-close" id="so-close-btn">×</button>' +
      '<div class="so-trigger-label">concept from labels</div>' +
      '<div class="so-text">' + escapeHtml(data.concept) + '</div>';
    document.getElementById('so-close-btn').addEventListener('click', () => {
      output.style.display = 'none';
    });
  } catch (err) {
    output.innerHTML =
      '<button class="so-close" id="so-close-btn">×</button>' +
      '<div class="so-trigger-label">concept from labels</div>' +
      '<div class="so-text so-loading">error: ' + escapeHtml(err.message) + '</div>';
    document.getElementById('so-close-btn').addEventListener('click', () => {
      output.style.display = 'none';
    });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
