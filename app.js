// ═══════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════
const pCanvas    = document.getElementById('particle-canvas');
const pCtx       = pCanvas.getContext('2d');
const cContainer = document.getElementById('canvas-container');
const cDiv       = document.getElementById('canvas');
const hint       = document.getElementById('hint');
const editPanel  = document.getElementById('edit-panel');
const typePicker = document.getElementById('type-picker');
const ctxMenu    = document.getElementById('context-menu');
const typeFilter = document.getElementById('type-filter');
const tagFilter  = document.getElementById('tag-filter');

const NODE_TYPES = ['feeling','observation','question','tension','anchor','reference','material','decision'];

// ═══════════════════════════════════════════════════════════════
// CANVAS TRANSFORM
// ═══════════════════════════════════════════════════════════════
function applyTransform() {
  cDiv.style.transform =
    `translate(${canvasState.x}px,${canvasState.y}px) scale(${canvasState.scale})`;
}
function toScreen(wx, wy) {
  return { x: wx * canvasState.scale + canvasState.x,
           y: wy * canvasState.scale + canvasState.y };
}
function toWorld(sx, sy) {
  return { x: (sx - canvasState.x) / canvasState.scale,
           y: (sy - canvasState.y) / canvasState.scale };
}

function nodeRadius(frag) {
  const base = nodeTextMode === 'visible' ? RADIUS_VISIBLE : RADIUS_SIMPLIFY;
  return base + (frag.weight || 0) * 6;
}
function nodeScreen(frag) {
  const s = toScreen(frag.x, frag.y);
  return { x: s.x, y: s.y, r: nodeRadius(frag) * canvasState.scale };
}

// ═══════════════════════════════════════════════════════════════
// FILTER + HOVER VISUAL STATE
// ═══════════════════════════════════════════════════════════════
function relativeTime(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function focusSession(sessionId) {
  const frags = fragments.filter(f => f.sessionId === sessionId);
  if (!frags.length) return;
  const cx = frags.reduce((s, f) => s + f.x, 0) / frags.length;
  const cy = frags.reduce((s, f) => s + f.y, 0) / frags.length;
  canvasState.x = window.innerWidth  / 2 - cx * canvasState.scale;
  canvasState.y = window.innerHeight / 2 - cy * canvasState.scale;
  applyTransform();
  saveCanvas();
}

function renderTimeline() {
  const container = document.getElementById('session-timeline');
  if (!container) return;
  container.innerHTML = '';

  const ordered = sessions.slice().reverse();
  ordered.forEach((session, i) => {
    const item = document.createElement('div');
    item.className = 'tl-item' + (session.id === currentSessionId ? ' active' : '');
    item.style.opacity = String(Math.max(0.25, 1 - i * 0.15));

    const dot = document.createElement('div');
    dot.className = 'tl-dot';

    const meta = document.createElement('div');
    meta.className = 'tl-meta';

    const timeEl = document.createElement('span');
    timeEl.className = 'tl-time';
    timeEl.textContent = relativeTime(session.timestamp) || '—';

    const detailEl = document.createElement('span');
    detailEl.className = 'tl-detail';
    const typeLabel = session.inputType === 'voice' ? 'v' : session.inputType === 'text' ? 't' : '·';
    const n = session.fragmentIds ? session.fragmentIds.length : 0;
    detailEl.textContent = typeLabel + '  ' + n + (n === 1 ? ' node' : ' nodes');

    meta.appendChild(timeEl);
    meta.appendChild(detailEl);
    item.appendChild(dot);
    item.appendChild(meta);

    if (session.transcript) {
      const txBtn = document.createElement('button');
      txBtn.className = 'tl-tx-btn';
      txBtn.textContent = 'tx';
      txBtn.title = 'view transcript';
      txBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof openTranscriptView === 'function') openTranscriptView(session.id);
      });
      item.appendChild(txBtn);
    }

    item.addEventListener('click', () => focusSession(session.id));
    container.appendChild(item);
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateSelect(select, values, selectedValue) {
  if (!select) return;
  select.innerHTML = '';

  const all = document.createElement('option');
  all.value = '__all';
  all.textContent = 'All';
  select.appendChild(all);

  values.forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  select.value = values.includes(selectedValue) ? selectedValue : '__all';
}

function refreshFilterOptions() {
  const types = uniqueSorted([...NODE_TYPES, ...fragments.map(f => f.type)]);
  const tags  = uniqueSorted(sessions.flatMap(s => Array.isArray(s.topTags) ? s.topTags : []));

  populateSelect(typeFilter, types, graphFilters.type);
  populateSelect(tagFilter, tags, graphFilters.tag);
  graphFilters.type = typeFilter?.value || '__all';
  graphFilters.tag  = tagFilter?.value  || '__all';
  applyGraphVisualState();
  renderTimeline();
}

function fragmentMatchesFilters(frag) {
  const typeMatch = graphFilters.type === '__all' || frag.type === graphFilters.type;
  const tags = Array.isArray(frag.tags) ? frag.tags : [];
  const tagMatch = graphFilters.tag === '__all' || tags.includes(graphFilters.tag);
  return typeMatch && tagMatch;
}

function getDirectNeighborIds(id) {
  const ids = new Set();
  fragments.forEach(frag => {
    if (frag.id === id) {
      frag.connections.forEach(conn => ids.add(conn.to));
    }
    if (frag.connections.some(conn => conn.to === id)) {
      ids.add(frag.id);
    }
  });
  return ids;
}

function connectionTouchesFilterMatch(fromFrag, toFrag) {
  return fragmentMatchesFilters(fromFrag) || fragmentMatchesFilters(toFrag);
}

function applyGraphVisualState() {
  const neighborIds = hoveredNodeId ? getDirectNeighborIds(hoveredNodeId) : new Set();

  fragments.forEach(frag => {
    const el = cDiv.querySelector(`[data-id="${frag.id}"]`);
    if (!el) return;

    const isHovered = frag.id === hoveredNodeId;
    const isConnected = neighborIds.has(frag.id);
    const matches = fragmentMatchesFilters(frag);

    el.classList.toggle('filter-match', matches);
    el.classList.toggle('filter-miss', !matches);
    el.classList.toggle('hover-active', isHovered);
    el.classList.toggle('hover-connected', !isHovered && isConnected);
    el.classList.toggle('hover-dim', Boolean(hoveredNodeId && !isHovered && !isConnected));
  });

  document.querySelectorAll('.conn-line, .conn-label').forEach(el => {
    const fromFrag = fragments.find(f => f.id === el.dataset.fromId);
    const toFrag = fragments.find(f => f.id === el.dataset.toId);
    if (!fromFrag || !toFrag) return;

    const touchesHover = hoveredNodeId &&
      (fromFrag.id === hoveredNodeId || toFrag.id === hoveredNodeId);
    const touchesMatch = connectionTouchesFilterMatch(fromFrag, toFrag);

    el.classList.toggle('filter-miss', !touchesMatch);
    el.classList.toggle('hover-active', Boolean(touchesHover));
    el.classList.toggle('hover-dim', Boolean(hoveredNodeId && !touchesHover));
  });
}

// ═══════════════════════════════════════════════════════════════
// NODE RENDERING
// ═══════════════════════════════════════════════════════════════
function renderTags(frag, el) {
  if (!el) return;
  el.querySelectorAll('.node-tag-mark').forEach(t => t.remove());
  const R = nodeRadius(frag);
  const tags = Array.isArray(frag.tags) ? frag.tags : [];
  tags.forEach((tag, i) => {
    const angle = (i / Math.max(tags.length, 1)) * Math.PI * 2 - Math.PI/2;
    const tm = document.createElement('span');
    tm.className = 'node-tag-mark';
    tm.textContent = tag;
    tm.style.left = (R + Math.cos(angle) * (R + 2)) + 'px';
    tm.style.top  = (R + Math.sin(angle) * (R + 2)) + 'px';
    el.appendChild(tm);
  });
}

function buildNode(frag) {
  const R  = nodeRadius(frag);
  const el = document.createElement('div');
  el.className  = 'node';
  el.dataset.id = frag.id;
  el.dataset.sessionId    = frag.sessionId || '';
  el.dataset.sessionIndex = sessions.findIndex(s => s.id === frag.sessionId);
  el.style.left   = (frag.x - R) + 'px';
  el.style.top    = (frag.y - R) + 'px';
  el.style.width  = (R * 2)      + 'px';
  el.style.height = (R * 2)      + 'px';

  // Gravity halo
  const gravR = (nodeRadius(frag)  + 28) + (frag.weight||0) * 20;
  const halo  = document.createElement('div');
  halo.className    = 'node-halo';
  halo.style.width  = (gravR * 2) + 'px';
  halo.style.height = (gravR * 2) + 'px';
  el.appendChild(halo);

  // Center
  const center = document.createElement('div');
  center.className = 'node-center';

  const titleEl = document.createElement('div');
  titleEl.className   = 'node-title';
  titleEl.textContent = frag.title || '';

  center.appendChild(titleEl);
  el.appendChild(center);

  // Hover tooltip — detailed popup
  const tooltip = document.createElement('div');
  tooltip.className = 'node-tooltip';

  function buildTooltipRow(label, values) {
    const row = document.createElement('div');
    row.className = 'node-tooltip-row';
    const lbl = document.createElement('span');
    lbl.className   = 'node-tooltip-label';
    lbl.textContent = label + ': ';
    row.appendChild(lbl);
    values.forEach(v => {
      if (!v) return;
      const tag = document.createElement('span');
      tag.className   = 'node-tooltip-tag';
      tag.textContent = '[' + v + ']';
      row.appendChild(tag);
    });
    return row;
  }

  tooltip.appendChild(buildTooltipRow('title',   [frag.title || '(untitled)']));
  tooltip.appendChild(buildTooltipRow('type',    [frag.type]));
  tooltip.appendChild(buildTooltipRow('source',  [frag.source || 'intuition']));
  if (frag.content) tooltip.appendChild(buildTooltipRow('notes', [frag.content]));
  if (frag.tags && frag.tags.length) tooltip.appendChild(buildTooltipRow('tags', frag.tags));

  el.appendChild(tooltip);

  // Connection dot
  const dot = document.createElement('div');
  dot.className     = 'conn-dot';
  dot.dataset.fromId = frag.id;
  el.appendChild(dot);

  // Click → edit panel
  el.addEventListener('click', (e) => {
    if (e.target.closest('.conn-dot')) return;
    e.stopPropagation();
    openEditPanel(frag);
  });

  el.addEventListener('mouseenter', () => {
    hoveredNodeId = frag.id;
    applyGraphVisualState();
  });

  el.addEventListener('mouseleave', () => {
    if (hoveredNodeId === frag.id) {
      hoveredNodeId = null;
      applyGraphVisualState();
    }
  });

  // Node drag
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.conn-dot')) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    draggingNode = {
      fragment: frag, el,
      startMX: e.clientX, startMY: e.clientY,
      startFX: frag.x,   startFY: frag.y,
    };
    el.style.opacity = '0.8';
    cContainer.style.cursor = 'grabbing';
  });

  // Right-click
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    ctxFrag = frag;
    showContextMenu(e.clientX, e.clientY, frag);
  });

  // Connection dot drag
  dot.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    connectingFrom = { fragment: frag };
    connectMouse   = { x: e.clientX, y: e.clientY };
  });

  cDiv.appendChild(el);
  applyGraphVisualState();
  return el;
}

function rebuildNode(frag) {
  const old = cDiv.querySelector(`[data-id="${frag.id}"]`);
  if (old) old.remove();
  buildNode(frag);
}

function rebuildAllNodes() {
  fragments.forEach(f => rebuildNode(f));
}

function updateNodeDisplay(frag) {
  const el = cDiv.querySelector(`[data-id="${frag.id}"]`);
  if (!el) return;
  el.querySelector('.node-title').textContent = frag.title || '';
  // Rebuild tooltip in place
  const oldTip = el.querySelector('.node-tooltip');
  if (oldTip) oldTip.remove();
  rebuildTooltip(frag, el);
}

function rebuildTooltip(frag, el) {
  const tooltip = document.createElement('div');
  tooltip.className = 'node-tooltip';

  function buildTooltipRow(label, values) {
    const row = document.createElement('div');
    row.className = 'node-tooltip-row';
    const lbl = document.createElement('span');
    lbl.className   = 'node-tooltip-label';
    lbl.textContent = label + ': ';
    row.appendChild(lbl);
    values.forEach(v => {
      if (!v) return;
      const tag = document.createElement('span');
      tag.className   = 'node-tooltip-tag';
      tag.textContent = '[' + v + ']';
      row.appendChild(tag);
    });
    return row;
  }

  tooltip.appendChild(buildTooltipRow('title',  [frag.title || '(untitled)']));
  tooltip.appendChild(buildTooltipRow('type',   [frag.type]));
  tooltip.appendChild(buildTooltipRow('source', [frag.source || 'intuition']));
  if (frag.content) tooltip.appendChild(buildTooltipRow('notes', [frag.content]));
  if (frag.tags && frag.tags.length) tooltip.appendChild(buildTooltipRow('tags', frag.tags));

  el.appendChild(tooltip);
}

// ═══════════════════════════════════════════════════════════════
// HINT
// ═══════════════════════════════════════════════════════════════
function updateHint() {
  hint.style.display = fragments.length > 0 ? 'none' : 'block';
}

// ═══════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════
function deleteFragment(id) {
  const el = cDiv.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
  fragments = fragments.filter(f => f.id !== id);
  fragments.forEach(f => { f.connections = f.connections.filter(c => c.to !== id); });
  sessions.forEach(s => { s.fragmentIds = s.fragmentIds.filter(fid => fid !== id); });
  saveFragments();
  saveSessions();
  refreshFilterOptions();
  buildAllPaths();
  updateHint();
  if (editFrag && editFrag.id === id) closeEditPanel();
}

// ═══════════════════════════════════════════════════════════════
// VIEW MODE TOGGLE
// ═══════════════════════════════════════════════════════════════
function setNodeMode(mode) {
  nodeTextMode = mode;
  document.body.className = 'mode-' + mode;
  document.getElementById('vt-simplify').classList.toggle('active', mode === 'simplify');
  document.getElementById('vt-visible').classList.toggle('active', mode === 'visible');
  // Resize all nodes since radius changes between modes
  rebuildAllNodes();
  buildAllPaths();
  applyGraphVisualState();
}

document.getElementById('vt-simplify').addEventListener('click', () => setNodeMode('simplify'));
document.getElementById('vt-visible').addEventListener('click',  () => setNodeMode('visible'));

typeFilter?.addEventListener('change', () => {
  graphFilters.type = typeFilter.value;
  applyGraphVisualState();
});

tagFilter?.addEventListener('change', () => {
  graphFilters.tag = tagFilter.value;
  applyGraphVisualState();
});

// ═══════════════════════════════════════════════════════════════
// EDIT PANEL
// ═══════════════════════════════════════════════════════════════
function openEditPanel(frag) {
  editFrag = frag;
  const ns = nodeScreen(frag);
  let left = ns.x + ns.r + 16;
  let top  = ns.y - 80;
  if (left + 220 > window.innerWidth - 10) left = ns.x - ns.r - 226;
  left = Math.max(8, left);
  top  = Math.max(8, Math.min(top, window.innerHeight - 260));
  editPanel.style.left    = left + 'px';
  editPanel.style.top     = top  + 'px';
  editPanel.style.display = 'block';
  renderEditPanel(frag);
}

function renderEditPanel(frag) {
  editPanel.innerHTML = '';

  // Title input
  const titleRow = document.createElement('div');
  titleRow.className = 'edit-panel-row';
  const titleInp = document.createElement('input');
  titleInp.type        = 'text';
  titleInp.className   = 'edit-title-input';
  titleInp.value       = frag.title || '';
  titleInp.placeholder = 'title...';
  titleInp.addEventListener('input', () => {
    frag.title = titleInp.value;
    updateNodeDisplay(frag);
    saveFragments();
  });
  titleRow.appendChild(titleInp);
  editPanel.appendChild(titleRow);
  setTimeout(() => titleInp.focus(), 0);

  // Notes label + textarea
  const notesLabel = document.createElement('span');
  notesLabel.className   = 'edit-section-label';
  notesLabel.textContent = 'notes';
  editPanel.appendChild(notesLabel);

  const taRow = document.createElement('div');
  taRow.className = 'edit-panel-row';
  const ta = document.createElement('textarea');
  ta.value = frag.content || '';
  ta.placeholder = 'detailed notes...';
  ta.addEventListener('input', () => {
    frag.content = ta.value;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    updateNodeDisplay(frag);
    saveFragments();
  });
  taRow.appendChild(ta);
  editPanel.appendChild(taRow);
  setTimeout(() => { ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; }, 0);

  // Type select
  const tyRow = document.createElement('div');
  tyRow.className = 'edit-panel-row';
  const tyS = document.createElement('select');
  NODE_TYPES.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (frag.type === opt) o.selected = true;
    tyS.appendChild(o);
  });
  tyS.addEventListener('change', () => {
    frag.type = tyS.value;
    updateNodeDisplay(frag);
    saveFragments();
    refreshFilterOptions();
  });
  tyRow.appendChild(tyS);
  editPanel.appendChild(tyRow);

  // Source select
  const srRow = document.createElement('div');
  srRow.className = 'edit-panel-row';
  const srS = document.createElement('select');
  ['intuition','reference','both'].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (frag.source === opt) o.selected = true;
    srS.appendChild(o);
  });
  srS.addEventListener('change', () => {
    frag.source = srS.value;
    updateNodeDisplay(frag);
    saveFragments();
  });
  srRow.appendChild(srS);
  editPanel.appendChild(srRow);

  // Tags
  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'edit-tags';

  function refreshEditTags() {
    tagsDiv.querySelectorAll('.edit-tag').forEach(e => e.remove());
    const inp = tagsDiv.querySelector('.edit-tag-input');
    const tags = Array.isArray(frag.tags) ? frag.tags : [];
    tags.forEach(tag => {
      const sp = document.createElement('span');
      sp.className = 'edit-tag'; sp.textContent = tag; sp.title = 'click to remove';
      sp.addEventListener('click', () => {
        frag.tags = tags.filter(t => t !== tag);
        saveFragments();
        renderTags(frag, cDiv.querySelector(`[data-id="${frag.id}"]`));
        refreshEditTags();
        refreshFilterOptions();
      });
      tagsDiv.insertBefore(sp, inp);
    });
  }

  const tagInp = document.createElement('input');
  tagInp.className = 'edit-tag-input'; tagInp.type = 'text'; tagInp.placeholder = 'add tag...';
  tagInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = tagInp.value.trim();
      if (!Array.isArray(frag.tags)) frag.tags = [];
      if (v && !frag.tags.includes(v)) {
        frag.tags.push(v);
        saveFragments();
        renderTags(frag, cDiv.querySelector(`[data-id="${frag.id}"]`));
        refreshEditTags();
        refreshFilterOptions();
      }
      tagInp.value = '';
    }
  });
  tagsDiv.appendChild(tagInp);
  refreshEditTags();
  editPanel.appendChild(tagsDiv);

  // Delete
  const del = document.createElement('button');
  del.className = 'edit-delete'; del.textContent = 'delete fragment';
  del.addEventListener('click', () => deleteFragment(frag.id));
  editPanel.appendChild(del);
}

function closeEditPanel() {
  editPanel.style.display = 'none';
  editFrag = null;
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════
function showContextMenu(mx, my, frag) {
  ctxMenu.innerHTML = '';

  const del = document.createElement('div');
  del.className = 'ctx-item'; del.textContent = 'delete fragment';
  del.addEventListener('click', () => { deleteFragment(frag.id); hideContextMenu(); });
  ctxMenu.appendChild(del);

  if (frag.sessionId) {
    const sess = sessions.find(s => s.id === frag.sessionId);
    if (sess && sess.transcript) {
      const sep2 = document.createElement('hr');
      sep2.className = 'ctx-sep';
      ctxMenu.appendChild(sep2);
      const txBtn = document.createElement('div');
      txBtn.className = 'ctx-item';
      txBtn.textContent = 'view session transcript';
      txBtn.addEventListener('click', () => {
        hideContextMenu();
        if (typeof openTranscriptView === 'function') openTranscriptView(frag.sessionId);
      });
      ctxMenu.appendChild(txBtn);
    }
  }

  if (frag.connections.length > 0) {
    const sep = document.createElement('hr');
    sep.className = 'ctx-sep';
    ctxMenu.appendChild(sep);

    frag.connections.forEach(conn => {
      const toFrag  = fragments.find(f => f.id === conn.to);
      const snippet = toFrag ? (toFrag.content || toFrag.id).slice(0,12) : conn.to;
      const row = document.createElement('div');
      row.className = 'ctx-conn-item';
      const lbl = document.createElement('span');
      lbl.textContent = `→ ${conn.type} → ${snippet}`;
      const x = document.createElement('span');
      x.className = 'ctx-conn-delete'; x.textContent = '×';
      x.addEventListener('click', () => {
        frag.connections = frag.connections.filter(c => !(c.to===conn.to && c.type===conn.type));
        saveFragments();
        buildAllPaths();
        hideContextMenu();
      });
      row.appendChild(lbl); row.appendChild(x);
      ctxMenu.appendChild(row);
    });
  }

  let left = mx, top = my;
  if (left + 180 > window.innerWidth)  left = mx - 180;
  if (top  + 160 > window.innerHeight) top  = my - (ctxMenu.offsetHeight || 80);
  ctxMenu.style.left = left + 'px';
  ctxMenu.style.top  = top  + 'px';
  ctxMenu.style.display = 'block';
}
function hideContextMenu() {
  ctxMenu.style.display = 'none'; ctxFrag = null;
}

// ═══════════════════════════════════════════════════════════════
// TYPE PICKER
// ═══════════════════════════════════════════════════════════════
function showTypePicker(fromId, toId) {
  pendingConn = { fromId, toId };
  const fromFrag = fragments.find(f => f.id === fromId);
  const toFrag   = fragments.find(f => f.id === toId);
  const a = nodeScreen(fromFrag), b = nodeScreen(toFrag);

  typePicker.innerHTML = '';
  ['echoes','leads-to','counter'].forEach((type, i) => {
    if (i > 0) typePicker.appendChild(document.createTextNode(' · '));
    const span = document.createElement('span');
    span.className = 'picker-opt'; span.textContent = type;
    span.addEventListener('click', () => confirmConnection(type));
    typePicker.appendChild(span);
  });

  typePicker.style.left    = ((a.x + b.x) / 2) + 'px';
  typePicker.style.top     = ((a.y + b.y) / 2) + 'px';
  typePicker.style.display = 'block';
}

function confirmConnection(type) {
  if (!pendingConn) return;
  const frag = fragments.find(f => f.id === pendingConn.fromId);
  if (frag) {
    frag.connections = frag.connections.filter(c => c.to !== pendingConn.toId);
    frag.connections.push({ to: pendingConn.toId, type });
    saveFragments();
    buildAllPaths();
  }
  typePicker.style.display = 'none';
  pendingConn = null;
}

// ═══════════════════════════════════════════════════════════════
// CANVAS PAN (mouse drag on empty space)
// ═══════════════════════════════════════════════════════════════
cContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.node')) return;
  isPanning = true;
  panStart  = { x: e.clientX, y: e.clientY };
  cContainer.style.cursor = 'grab';
});

// ═══════════════════════════════════════════════════════════════
// ZOOM + TRACKPAD PAN (wheel event)
// Ctrl+wheel → zoom. Plain wheel (trackpad two-finger scroll) → pan.
// ═══════════════════════════════════════════════════════════════
cContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    // Pinch-to-zoom or Ctrl+scroll → zoom
    const factor   = e.deltaY < 0 ? 1.08 : 0.93;
    const newScale = Math.min(2, Math.max(0.3, canvasState.scale * factor));
    const rect     = cContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    canvasState.x = mx - (mx - canvasState.x) * (newScale / canvasState.scale);
    canvasState.y = my - (my - canvasState.y) * (newScale / canvasState.scale);
    canvasState.scale = newScale;
  } else {
    // Trackpad two-finger scroll → pan
    canvasState.x -= e.deltaX;
    canvasState.y -= e.deltaY;
  }
  applyTransform();
  saveCanvas();
}, { passive: false });

// ═══════════════════════════════════════════════════════════════
// DOUBLE-CLICK → CREATE NODE
// ═══════════════════════════════════════════════════════════════
cContainer.addEventListener('dblclick', (e) => {
  if (e.target.closest('.node')) return;
  const rect = cContainer.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);

  const frag = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    title: '', content: '', type: 'feeling', source: 'intuition',
    tags: [], connections: [],
    weight: 0,
    x: w.x, y: w.y,
    sessionId: currentSessionId,
    origin:    'manual',
  };

  fragments.push(frag);
  const cur = sessions.find(s => s.id === currentSessionId);
  if (cur) { cur.fragmentIds.push(frag.id); saveSessions(); }
  saveFragments();
  buildNode(frag);
  refreshFilterOptions();
  updateHint();
  openEditPanel(frag);
});

// ═══════════════════════════════════════════════════════════════
// GLOBAL MOUSE EVENTS
// ═══════════════════════════════════════════════════════════════
document.addEventListener('mousemove', (e) => {
  if (isPanning) {
    canvasState.x += e.clientX - panStart.x;
    canvasState.y += e.clientY - panStart.y;
    panStart = { x: e.clientX, y: e.clientY };
    applyTransform();
  }

  if (draggingNode) {
    const { fragment, el, startMX, startMY, startFX, startFY } = draggingNode;
    fragment.x = startFX + (e.clientX - startMX) / canvasState.scale;
    fragment.y = startFY + (e.clientY - startMY) / canvasState.scale;
    const R = nodeRadius(fragment);
    el.style.left = (fragment.x - R) + 'px';
    el.style.top  = (fragment.y - R) + 'px';
    drawConnections();
    if (editFrag && editFrag.id === fragment.id) {
      const ns = nodeScreen(fragment);
      let left = ns.x + ns.r + 16;
      let top  = ns.y - 80;
      if (left + 220 > window.innerWidth - 10) left = ns.x - ns.r - 226;
      left = Math.max(8, left);
      top  = Math.max(8, Math.min(top, window.innerHeight - 260));
      editPanel.style.left = left + 'px';
      editPanel.style.top  = top  + 'px';
    }
  }

  if (connectingFrom) {
    connectMouse = { x: e.clientX, y: e.clientY };
  }
});

document.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    cContainer.style.cursor = 'default';
    saveCanvas();
  }

  if (draggingNode) {
    draggingNode.el.style.opacity = '';
    saveFragments();
    draggingNode = null;
    cContainer.style.cursor = 'default';
    drawConnections();
    applyGraphVisualState();
  }

  if (connectingFrom) {
    const underEl    = document.elementFromPoint(e.clientX, e.clientY);
    const targetNode = underEl ? underEl.closest('.node') : null;
    if (targetNode) {
      const toId   = targetNode.dataset.id;
      const fromId = connectingFrom.fragment.id;
      if (toId && toId !== fromId) {
        // Prevent the upcoming click event from closing the type picker
        skipNextClick = true;
        showTypePicker(fromId, toId);
      }
    }
    connectingFrom = null;
  }
});

// Click outside → close menus/panels
document.addEventListener('click', (e) => {
  // Skip one click cycle after a connection is established
  if (skipNextClick) { skipNextClick = false; return; }

  if (!ctxMenu.contains(e.target)) hideContextMenu();

  if (typePicker.style.display === 'block' && !typePicker.contains(e.target)) {
    typePicker.style.display = 'none';
    pendingConn = null;
  }

  if (editPanel.style.display === 'block' &&
      !editPanel.contains(e.target) &&
      !e.target.closest('.node') &&
      !e.target.closest('#view-toggle')) {
    closeEditPanel();
  }
});

document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.node')) hideContextMenu();
});

window.addEventListener('resize', resizeParticleCanvas);

// Synthesis button + overlay close
document.getElementById('synth-btn').addEventListener('click', openSynthPopup);
document.getElementById('synth-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeSynthPopup();
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
  resizeParticleCanvas();
  loadState();
  applyTransform();
  fragments.forEach(f => buildNode(f));
  refreshFilterOptions();
  updateHint();
  buildAllPaths();
  requestAnimationFrame(loop);
}

init();
