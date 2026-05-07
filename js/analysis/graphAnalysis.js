// ═══════════════════════════════════════════════════════════════
// GRAPH ANALYSIS
// Runs entirely in the browser — no API needed.
// Computes structural metrics from the live fragment graph.
// These metrics are then fed to classifyThinkingState().
//
// Relationship types:
//   leads_to    — one thought develops into another (directional)
//   contradicts — two thoughts are in tension / opposition
//   parallel    — two thoughts echo or resonate beside each other
// ═══════════════════════════════════════════════════════════════

function analyzeGraph(nodes, relationships, previousSessions) {
  if (!Array.isArray(nodes))           nodes            = [];
  if (!Array.isArray(relationships))   relationships    = [];
  if (!Array.isArray(previousSessions)) previousSessions = [];

  const nodeCount = nodes.length;
  const edgeCount = relationships.length;
  const edgeDensity = nodeCount > 0 ? edgeCount / nodeCount : 0;

  const leadToCount      = relationships.filter(r => r.type === 'leads_to').length;
  const contradictsCount = relationships.filter(r => r.type === 'contradicts').length;
  const parallelCount    = relationships.filter(r => r.type === 'parallel').length;

  const leadToRatio        = edgeCount > 0 ? leadToCount      / edgeCount : 0;
  const contradictionRatio = edgeCount > 0 ? contradictsCount / edgeCount : 0;
  const parallelRatio      = edgeCount > 0 ? parallelCount    / edgeCount : 0;

  // Isolated nodes: no incoming or outgoing connections
  const connectedIds = new Set();
  relationships.forEach(r => {
    if (r.from) connectedIds.add(r.from);
    if (r.to)   connectedIds.add(r.to);
  });
  const isolatedNodeCount = nodes.filter(n => !connectedIds.has(n.id)).length;

  // Longest directed chain made only of leads_to edges
  const longestLeadChain = _longestLeadsToChainLength(nodes, relationships);

  // Approximate count of nodes whose labels/tags recur across sessions
  const recurringThemeCount = _countRecurringThemes(nodes, previousSessions);

  return {
    nodeCount,
    edgeCount,
    edgeDensity,
    leadToCount,
    contradictsCount,
    parallelCount,
    leadToRatio,
    contradictionRatio,
    parallelRatio,
    isolatedNodeCount,
    longestLeadChain,
    recurringThemeCount,
  };
}

// Find the longest directed path using only leads_to edges.
// DFS with per-call visiting set to handle cycles safely.
function _longestLeadsToChainLength(nodes, relationships) {
  if (!nodes.length) return 0;

  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  relationships
    .filter(r => r.type === 'leads_to')
    .forEach(r => { if (adj[r.from]) adj[r.from].push(r.to); });

  const memo = {};
  function dfs(id, visiting) {
    if (visiting.has(id)) return 0;
    if (id in memo) return memo[id];
    visiting.add(id);
    const best = (adj[id] || []).reduce((m, nid) => Math.max(m, dfs(nid, visiting)), 0);
    visiting.delete(id);
    memo[id] = 1 + best;
    return memo[id];
  }

  return nodes.reduce((best, n) => Math.max(best, dfs(n.id, new Set())), 0);
}

// Count nodes whose label or tags appear in more than one session.
// Uses exact label match or shared tag — simple, modular, improvable later.
// Relies on the global `fragments` array to map sessionId → fragments.
function _countRecurringThemes(nodes, previousSessions) {
  if (!previousSessions.length || !nodes.length) return 0;

  // Build sessionId → fragments lookup from the global fragments array
  const sessionFragMap = {};
  if (typeof fragments !== 'undefined') {
    fragments.forEach(f => {
      if (!f.sessionId) return;
      if (!sessionFragMap[f.sessionId]) sessionFragMap[f.sessionId] = [];
      sessionFragMap[f.sessionId].push(f);
    });
  }

  if (previousSessions.length < 2) return 0;

  // For each label/tag, record which sessionIds contain it
  const labelSessions = {};
  const tagSessions   = {};

  previousSessions.forEach(s => {
    (sessionFragMap[s.id] || []).forEach(f => {
      const label = (f.title || '').toLowerCase().trim();
      if (label) {
        if (!labelSessions[label]) labelSessions[label] = new Set();
        labelSessions[label].add(s.id);
      }
      (f.tags || []).forEach(tag => {
        const t = tag.toLowerCase().trim();
        if (!tagSessions[t]) tagSessions[t] = new Set();
        tagSessions[t].add(s.id);
      });
    });
  });

  // Count current nodes that appear in 2+ sessions
  let count = 0;
  nodes.forEach(n => {
    const label = (n.title || '').toLowerCase().trim();
    if (label && labelSessions[label] && labelSessions[label].size >= 2) {
      count++;
      return;
    }
    const recurring = (n.tags || []).some(tag => {
      const t = tag.toLowerCase().trim();
      return tagSessions[t] && tagSessions[t].size >= 2;
    });
    if (recurring) count++;
  });

  return count;
}
