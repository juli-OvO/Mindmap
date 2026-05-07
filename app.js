// ═══════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════
const pCanvas       = document.getElementById('particle-canvas');
const pCtx          = pCanvas.getContext('2d');
const cContainer    = document.getElementById('canvas-container');
const cDiv          = document.getElementById('canvas');
const hint          = document.getElementById('hint');
const editPanel     = document.getElementById('edit-panel');
const typePicker    = document.getElementById('type-picker');
const ctxMenu       = document.getElementById('context-menu');
const typeFilter    = document.getElementById('type-filter');
const tagFilter     = document.getElementById('tag-filter');
const titleInput    = document.getElementById('project-title-input');

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
  return RADIUS_SIMPLIFY + (frag.weight || 0) * 6;
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

titleInput.addEventListener('input', () => {
  projectTitle = titleInput.value;
  saveProjectTitle();
});

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
  // Three canonical relationship types — must match server.js VALID_REL
  ['leads_to','contradicts','parallel'].forEach((type, i) => {
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
    if (draggingNode.isSuggestion) {
      const sug = draggingNode.fragment;
      draggingNode.el.style.opacity = '';
      if (draggingNode.convertOnDrop) {
        convertSuggestionToRealNode(sug, draggingNode.el);
      } else {
        // Dropped near a real node → convert to real node (no auto-relationship)
        const near = fragments.find(f => Math.hypot(f.x - sug.x, f.y - sug.y) < 100);
        if (near) acceptSuggestion(sug, draggingNode.el);
        // If not near anything, keep it floating at its new position
      }
    } else {
      draggingNode.el.style.opacity = '';
      saveFragments();
    }
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
      !e.target.closest('.node')) {
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
// THINKING STATE LABEL
// Subtle readout of the current classified state + reason.
// Positioned top-right; hidden when graph is empty.
// ═══════════════════════════════════════════════════════════════
const STATE_LABELS = {
  scatter:    'Scatter / Exploration',
  trajectory: 'Trajectory / Development',
  split:      'Split / Debate',
  echo:       'Echo / Resonance',
  return:     'Return / Memory',
};

function renderThinkingStateLabel(classification) {
  const el = document.getElementById('thinking-state-label');
  if (!el) return;
  const label  = STATE_LABELS[classification.state] || classification.state;
  const reason = (classification.reasons || [])[0] || '';
  el.innerHTML =
    `<span class="tsl-state">thinking state: ${label}</span>` +
    (reason ? `<span class="tsl-reason">${reason.toLowerCase()}</span>` : '');
  el.style.opacity = '0';
  el.style.display = 'block';
  requestAnimationFrame(() => { el.style.opacity = '1'; });
}

// ═══════════════════════════════════════════════════════════════
// SUGGESTED NODES
// Suggested nodes are possibilities from the API, not facts.
// They float disconnected until the user accepts, ignores,
// or drags them near an existing node.
// ═══════════════════════════════════════════════════════════════
function renderSuggestedNodes(suggestions) {
  // Clear any existing suggestion elements
  cDiv.querySelectorAll('.suggestion-node').forEach(el => el.remove());
  if (!Array.isArray(suggestions) || !suggestions.length) return;

  // Store as global ephemeral state (not persisted)
  suggestedNodes = suggestions
    .filter(s => s && s.status !== 'ignored')
    .map(s => ({ ...s, isSuggestion: true, status: 'floating' }));

  // Position suggestions loosely around the current viewport center
  const centerW = toWorld(window.innerWidth / 2, window.innerHeight / 2);
  suggestedNodes.forEach((sug, i) => {
    const angle  = (i / suggestedNodes.length) * Math.PI * 2 + Math.PI * 0.25;
    const radius = 220 + i * 40;
    sug.x = centerW.x + Math.cos(angle) * radius;
    sug.y = centerW.y + Math.sin(angle) * radius * 0.6;
    buildSuggestionNode(sug);
  });
}

function buildSuggestionNode(sug) {
  const R  = RADIUS_SIMPLIFY;
  const el = document.createElement('div');
  el.className  = 'node suggestion-node';
  el.dataset.id = sug.id;
  el.style.left   = (sug.x - R) + 'px';
  el.style.top    = (sug.y - R) + 'px';
  el.style.width  = (R * 2) + 'px';
  el.style.height = (R * 2) + 'px';

  const center  = document.createElement('div');
  center.className = 'node-center';
  const titleEl = document.createElement('div');
  titleEl.className   = 'node-title';
  titleEl.textContent = sug.label || '';
  center.appendChild(titleEl);
  el.appendChild(center);

  // Reason shown on hover
  if (sug.reason) {
    const tip = document.createElement('div');
    tip.className   = 'suggestion-reason';
    tip.textContent = sug.reason;
    el.appendChild(tip);
  }

  // Accept: convert to real node
  const acceptBtn = document.createElement('div');
  acceptBtn.className   = 'sug-accept-btn';
  acceptBtn.textContent = '+';
  acceptBtn.title       = 'accept';
  acceptBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    acceptSuggestion(sug, el);
  });
  el.appendChild(acceptBtn);

  // Ignore: fade out and remove
  const ignoreBtn = document.createElement('div');
  ignoreBtn.className   = 'sug-ignore-btn';
  ignoreBtn.textContent = '×';
  ignoreBtn.title       = 'ignore';
  ignoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ignoreSuggestion(sug, el);
  });
  el.appendChild(ignoreBtn);

  // Drag — shares the existing draggingNode system
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.sug-accept-btn') || e.target.closest('.sug-ignore-btn')) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    draggingNode = {
      fragment: sug, el,
      startMX: e.clientX, startMY: e.clientY,
      startFX: sug.x,   startFY: sug.y,
      isSuggestion: true,
    };
    el.style.opacity = '0.8';
    cContainer.style.cursor = 'grabbing';
  });

  cDiv.appendChild(el);
}

function acceptSuggestion(sug, el) {
  const frag = {
    id:          generateId(),
    timestamp:   new Date().toISOString(),
    title:       sug.label  || '',
    content:     sug.reason || '',
    type:        'observation',
    source:      'intuition',
    tags:        [],
    connections: [],
    weight:      0,
    x:           sug.x,
    y:           sug.y,
    sessionId:   currentSessionId,
    origin:      'extracted',
  };
  fragments.push(frag);
  const cur = sessions.find(s => s.id === currentSessionId);
  if (cur) { cur.fragmentIds.push(frag.id); saveSessions(); }
  saveFragments();

  el.remove();
  suggestedNodes = suggestedNodes.filter(s => s.id !== sug.id);
  buildNode(frag);
  refreshFilterOptions();
  updateHint();
  buildAllPaths();
}

function ignoreSuggestion(sug, el) {
  el.style.transition = 'opacity 0.4s ease';
  el.style.opacity    = '0';
  setTimeout(() => {
    el.remove();
    suggestedNodes = suggestedNodes.filter(s => s.id !== sug.id);
  }, 420);
}

// ═══════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════
function importProject(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      console.warn('[import] invalid JSON — file not loaded');
      return;
    }
    if (!Array.isArray(data.sessions) || !Array.isArray(data.fragments)) {
      console.warn('[import] missing sessions[] or fragments[] — file not loaded');
      return;
    }
    closeEditPanel();
    hideContextMenu();
    cDiv.querySelectorAll('.node').forEach(n => n.remove());
    const svg = document.getElementById('conn-svg');
    Array.from(svg.children).forEach(c => { if (c.tagName.toLowerCase() !== 'defs') c.remove(); });
    applyImportedState(data);
    titleInput.value = projectTitle;
    if (fragments.some(f => f.x == null)) {
      layoutFragments(fragments).forEach(({ id, x, y }) => {
        const f = fragments.find(fr => fr.id === id);
        if (f) { f.x = x; f.y = y; }
      });
    }
    applyTransform();
    fragments.forEach(f => buildNode(f));
    refreshFilterOptions();
    updateHint();
    buildAllPaths();
  };
  reader.readAsText(file);
}

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear all nodes? This cannot be undone.')) return;
  closeEditPanel();
  hideContextMenu();
  cDiv.querySelectorAll('.node').forEach(n => n.remove());
  suggestedNodes    = [];
  directionSuggestions = [];
  clearSuggestedRelationshipLines();
  const critPanel = document.getElementById('critique-panel');
  if (critPanel) { critPanel.innerHTML = ''; critPanel.style.display = 'none'; }
  const svg = document.getElementById('conn-svg');
  Array.from(svg.children).forEach(c => { if (c.tagName.toLowerCase() !== 'defs') c.remove(); });
  clearProject();
  refreshFilterOptions();
  updateHint();
});

document.getElementById('export-btn').addEventListener('click', exportProject);
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) { importProject(file); e.target.value = ''; }
});

// ═══════════════════════════════════════════════════════════════
// SUGGEST DIRECTIONS
// Entirely separate from the patch suggestion flow.
// Patch suggestions use renderSuggestedNodes/buildSuggestionNode
// (called from input.js and stored in the global suggestedNodes[]).
// Direction suggestions are tracked in directionSuggestions[] and
// never touch the patch system's state or the fragments[] array
// until the user explicitly accepts one.
// ═══════════════════════════════════════════════════════════════

// Local tracking array — direction suggestions only.
// Cleared on each new callSuggest run.
let directionSuggestions = [];

// Lookup a real fragment by id (used by mouseup drag handler).
function getNodeById(id) {
  return fragments.find(f => f.id === id) || null;
}

// Lookup a real fragment by its visible title (case-insensitive).
// Used to resolve relationship endpoints from labels.
function findFragmentByLabel(label) {
  if (!label) return null;
  const lc = label.toLowerCase().trim();
  return fragments.find(f => (f.title || '').toLowerCase().trim() === lc) || null;
}

// ── Parsing ────────────────────────────────────────────────────
// Accepts the already-fetched data object from callSuggest.
// Handles the edge case where the model wrapped its JSON in prose
// by extracting the first balanced { } block.
// Defaults any missing array field to [] rather than crashing.
function parseSuggestionsResponse(raw) {
  console.log('[Suggestions] Raw API response:', raw);

  let obj = raw;

  // If the payload somehow arrives as a string, try to parse it
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (_) {
      // Model may have wrapped JSON in prose — grab first { } block
      const match = obj.match(/\{[\s\S]*\}/);
      if (match) {
        try { obj = JSON.parse(match[0]); }
        catch (e) {
          console.warn('[Suggestions] Could not extract JSON from string:', e.message);
          return null;
        }
      } else {
        console.warn('[Suggestions] Response is not parseable JSON and has no { } block');
        return null;
      }
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.warn('[Suggestions] Parsed value is not a plain object:', obj);
    return null;
  }

  if (!Array.isArray(obj.suggestedNodes)) {
    console.warn('[Suggestions] suggestedNodes missing or not an array — defaulting to []');
  }
  if (!Array.isArray(obj.suggestedRelationships)) {
    console.warn('[Suggestions] suggestedRelationships missing or not an array — defaulting to []');
  }

  const result = {
    suggestedNodes:         Array.isArray(obj.suggestedNodes)         ? obj.suggestedNodes         : [],
    suggestedRelationships: Array.isArray(obj.suggestedRelationships) ? obj.suggestedRelationships : [],
    critique:               Array.isArray(obj.critique)               ? obj.critique               : [],
  };

  console.log('[Suggestions] Parsed response:', result);
  return result;
}

// ── Normalization ──────────────────────────────────────────────
// Map API-specific suggestion types to types the app understands,
// and build full local node objects with all required fields.
const SUGGEST_TYPE_MAP = {
  missing_question: 'question',
  bridge:           'observation',
  tension:          'tension',
  anchor:           'anchor',
  clarify:          'observation',
};

function normalizeSuggestedNodes(rawNodes) {
  const now = Date.now();
  return rawNodes
    .filter(n => n && typeof n.label === 'string' && n.label.trim())
    .map((n, i) => ({
      id:           'suggestion-' + now + '-' + i,
      label:        n.label.trim(),
      type:         SUGGEST_TYPE_MAP[n.type] || n.type || 'observation',
      reason:       n.reason || '',
      isSuggestion: true,
      accepted:     false,
      x:            0,
      y:            0,
      createdAt:    new Date(now).toISOString(),
      source:       'api-suggestion',
    }));
}

// ── Spatial placement ──────────────────────────────────────────
// For each suggestion, scan suggestedRelationships to find real
// fragment anchors, then place accordingly:
//   2+ anchors → midpoint between first two
//   1 anchor   → 130px arc from it
//   0 anchors  → spread around viewport center
function placeNodes(nodes, relationships) {
  const center = toWorld(window.innerWidth / 2, window.innerHeight / 2);

  nodes.forEach((node, i) => {
    const angleOffset = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const myLc = node.label.toLowerCase().trim();

    // Collect unique real-fragment anchors mentioned in any relationship touching this node
    const anchors = [];
    relationships.forEach(r => {
      const fromLc = (r.from || '').toLowerCase().trim();
      const toLc   = (r.to   || '').toLowerCase().trim();
      const otherLabel = fromLc === myLc ? r.to : (toLc === myLc ? r.from : null);
      if (!otherLabel) return;
      const frag = findFragmentByLabel(otherLabel);
      if (frag && !anchors.find(a => a.id === frag.id)) anchors.push(frag);
    });

    if (anchors.length >= 2) {
      // Place between the two anchors with a small offset to avoid overlap
      node.x = (anchors[0].x + anchors[1].x) / 2 + Math.cos(angleOffset) * 30;
      node.y = (anchors[0].y + anchors[1].y) / 2 + Math.sin(angleOffset) * 30;
    } else if (anchors.length === 1) {
      const arc = angleOffset + Math.PI * 0.5;
      node.x = anchors[0].x + Math.cos(arc) * 130;
      node.y = anchors[0].y + Math.sin(arc) * 130;
    } else {
      // No anchor found — spread around viewport center
      const angle = angleOffset + Math.PI * 0.25;
      node.x = center.x + Math.cos(angle) * (150 + i * 40);
      node.y = center.y + Math.sin(angle) * (100 + i * 30);
    }
  });
}

// ── Temporary relationship lines ───────────────────────────────
// Draws dashed SVG lines between resolved endpoints.
// Tagged "suggestion-conn" so clearSuggestedRelationshipLines()
// can remove them without touching real connection paths.
const REL_COLORS = {
  leads_to:    'rgba(80,120,100,0.45)',
  contradicts: 'rgba(160,80,80,0.45)',
  parallel:    'rgba(139,115,85,0.45)',
};

function renderSuggestedRelationships(relationships, nodeMap) {
  const svg = document.getElementById('conn-svg');
  relationships.forEach(rel => {
    const fromKey  = (rel.from || '').toLowerCase().trim();
    const toKey    = (rel.to   || '').toLowerCase().trim();
    const fromNode = nodeMap[fromKey];
    const toNode   = nodeMap[toKey];

    if (!fromNode || !toNode) {
      console.warn('[Suggestions] Skipped relationship — endpoint not found:', rel.from, '→', rel.to);
      return;
    }

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'suggestion-conn');
    line.setAttribute('x1', fromNode.x);
    line.setAttribute('y1', fromNode.y);
    line.setAttribute('x2', toNode.x);
    line.setAttribute('y2', toNode.y);
    line.setAttribute('stroke', REL_COLORS[rel.relationship] || 'rgba(100,140,200,0.4)');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
  });
}

function clearSuggestedRelationshipLines() {
  document.querySelectorAll('.suggestion-conn').forEach(el => el.remove());
}

// ── Critique panel ─────────────────────────────────────────────
// Shows critique items in a compact side panel.
// Items are never auto-converted to nodes.
function renderCritique(critique) {
  const panel = document.getElementById('critique-panel');
  if (!panel) return;

  panel.innerHTML = '';
  if (!critique.length) { panel.style.display = 'none'; return; }

  critique.forEach(item => {
    const row = document.createElement('div');
    row.className = 'critique-item';
    row.innerHTML =
      `<span class="crit-issue">${item.issue || ''}</span>` +
      `<span class="crit-note">${item.note || ''}</span>` +
      `<span class="crit-action">→ ${item.nextAction || ''}</span>`;
    panel.appendChild(row);
  });

  panel.style.display = 'block';
}

// ── Node DOM rendering ─────────────────────────────────────────
// Builds a direction-suggestion node element.
// data-src="direction" lets us target only these on the next clear,
// leaving patch suggestion nodes (data-src absent) untouched.
function renderDirectionSuggestionNode(s) {
  const R  = RADIUS_SIMPLIFY;
  const el = document.createElement('div');
  el.className    = 'node suggestion-node';
  el.dataset.id   = s.id;
  el.dataset.src  = 'direction';
  el.style.left   = (s.x - R) + 'px';
  el.style.top    = (s.y - R) + 'px';
  el.style.width  = (R * 2) + 'px';
  el.style.height = (R * 2) + 'px';

  const centerEl = document.createElement('div');
  centerEl.className = 'node-center';
  const titleEl = document.createElement('div');
  titleEl.className   = 'node-title';
  titleEl.textContent = s.label;
  centerEl.appendChild(titleEl);
  el.appendChild(centerEl);

  // Accept (✓) — left, promotes to a real persistent fragment
  const acceptBtn = document.createElement('div');
  acceptBtn.className   = 'sug-dir-accept';
  acceptBtn.textContent = '✓';
  acceptBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    convertSuggestionToRealNode(s, el);
  });
  el.appendChild(acceptBtn);

  // Decline (✕) — right, fades out and removes
  const declineBtn = document.createElement('div');
  declineBtn.className   = 'sug-dir-decline';
  declineBtn.textContent = '✕';
  declineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity    = '0';
    setTimeout(() => {
      el.remove();
      directionSuggestions = directionSuggestions.filter(d => d.id !== s.id);
      clearSuggestedRelationshipLines();
    }, 320);
  });
  el.appendChild(declineBtn);

  // Reason popup — click node body to toggle; auto-closes others
  if (s.reason) {
    const reasonEl = document.createElement('div');
    reasonEl.className     = 'sug-dir-reasoning';
    reasonEl.textContent   = s.reason;
    reasonEl.style.display = 'none';
    el.appendChild(reasonEl);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = reasonEl.style.display !== 'none';
      cDiv.querySelectorAll('.sug-dir-reasoning').forEach(r => { r.style.display = 'none'; });
      if (!isOpen) reasonEl.style.display = 'block';
    });
  }

  // Drag — plugs into existing draggingNode system; drop always converts
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.sug-dir-accept') || e.target.closest('.sug-dir-decline')) return;
    e.stopPropagation();
    e.preventDefault();
    draggingNode = {
      fragment: s, el,
      startMX: e.clientX, startMY: e.clientY,
      startFX: s.x,       startFY: s.y,
      isSuggestion:  true,
      convertOnDrop: true,
    };
    el.style.opacity = '0.8';
    cContainer.style.cursor = 'grabbing';
  });

  cDiv.appendChild(el);
}

// ── Accept: promote suggestion into a real persistent fragment ─
// Called by the ✓ button and the mouseup drag-drop handler.
// After promotion, removes the suggestion element and redraws paths.
function convertSuggestionToRealNode(sug, el) {
  const frag = {
    id:          generateId(),
    timestamp:   new Date().toISOString(),
    title:       sug.label || '',
    content:     sug.reason || '',
    type:        sug.type || 'observation',
    source:      'intuition',
    tags:        [],
    connections: [],
    weight:      0,
    x:           sug.x,
    y:           sug.y,
    sessionId:   currentSessionId,
    origin:      'suggested',
  };
  fragments.push(frag);
  const cur = sessions.find(s => s.id === currentSessionId);
  if (cur) { cur.fragmentIds.push(frag.id); saveSessions(); }
  saveFragments();

  el.remove();
  directionSuggestions = directionSuggestions.filter(d => d.id !== sug.id);
  clearSuggestedRelationshipLines();
  buildNode(frag);
  refreshFilterOptions();
  updateHint();
  buildAllPaths();
}

// ── Main entry point (called by callSuggest after fetch) ───────
function handleSuggestionsResponse(rawData) {
  // Step 1 — parse and validate
  const parsed = parseSuggestionsResponse(rawData);
  if (!parsed) {
    console.warn('[Suggestions] Parsing failed — aborting render');
    return;
  }

  const { suggestedNodes, suggestedRelationships, critique } = parsed;

  // Step 2 — clear stale direction suggestions from a previous call
  //           (does NOT touch patch suggestions, which lack data-src="direction")
  cDiv.querySelectorAll('.node.suggestion-node[data-src="direction"]').forEach(el => el.remove());
  clearSuggestedRelationshipLines();
  directionSuggestions = [];

  if (!suggestedNodes.length) {
    console.warn('[Suggestions] No suggestedNodes to render');
    renderCritique(critique);
    return;
  }

  // Step 3 — normalize raw nodes into full local objects
  const normalized = normalizeSuggestedNodes(suggestedNodes);
  console.log('[Suggestions] Normalized nodes:', normalized);

  // Step 4 — place each node spatially using relationship anchors
  placeNodes(normalized, suggestedRelationships);

  // Step 5 — render node elements and record in tracking array
  normalized.forEach(s => {
    renderDirectionSuggestionNode(s);
    directionSuggestions.push(s);
  });

  // Step 6 — draw dashed relationship lines
  //   Build a unified label→coords map from real fragments + new suggestions
  const nodeMap = {};
  fragments.forEach(f => { if (f.title) nodeMap[f.title.toLowerCase().trim()] = f; });
  normalized.forEach(s => { nodeMap[s.label.toLowerCase().trim()] = s; });
  renderSuggestedRelationships(suggestedRelationships, nodeMap);

  // Step 7 — render critique panel (separate from the graph)
  renderCritique(critique);
}

// ── API call ───────────────────────────────────────────────────
async function callSuggest(nodes) {
  const btn = document.getElementById('suggest-btn');
  if (btn) { btn.textContent = 'requesting...'; btn.disabled = true; }

  const reset = (label) => {
    if (!btn) return;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = 'suggest directions'; btn.disabled = false; }, 2500);
  };

  try {
    const resp = await fetch('/api/suggestDirections', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ nodes }),
    });
    const text = await resp.text();
    console.log('[Suggestions] Raw API response (first 400 chars):', text.slice(0, 400));

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`HTTP ${resp.status} — response is not JSON`); }

    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);

    handleSuggestionsResponse(data);
    const n = Array.isArray(data.suggestedNodes) ? data.suggestedNodes.length : 0;
    reset(n + ' suggestion' + (n !== 1 ? 's' : '') + ' added');
  } catch (err) {
    console.error('[Suggestions] Fetch error:', err.message);
    reset('error: ' + err.message.slice(0, 40));
  }
}

document.getElementById('suggest-btn')?.addEventListener('click', () => {
  const nodes = getCurrentNodesForAPI();
  if (!nodes.length) return;
  callSuggest(nodes);
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
  resizeParticleCanvas();
  loadState();
  titleInput.value = projectTitle;
  if (fragments.some(f => f.x == null)) {
    layoutFragments(fragments).forEach(({ id, x, y }) => {
      const f = fragments.find(fr => fr.id === id);
      if (f) { f.x = x; f.y = y; }
    });
  }
  applyTransform();
  fragments.forEach(f => buildNode(f));
  refreshFilterOptions();
  updateHint();
  buildAllPaths();
  requestAnimationFrame(loop);
}

init();
