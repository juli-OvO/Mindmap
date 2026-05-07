// ═══════════════════════════════════════════════════════════════
// THINKING STATE CLASSIFIER
// Maps graph metrics → a named thinking state.
// Runs locally after analyzeGraph() — no API round-trip needed.
//
// Why local (not API):
//   State classification must be instant and deterministic.
//   It drives layout and particle behavior before anything renders,
//   so it can't wait for a network call. The classification is
//   structural — it comes from edge counts, not semantic meaning.
//
// States (priority order):
//   split      — high contradiction density
//   trajectory — long leads_to chain or strong directional flow
//   echo       — many parallel relationships
//   return     — recurring themes across sessions
//   scatter    — default loose constellation
// ═══════════════════════════════════════════════════════════════

function classifyThinkingState(metrics) {
  if (!metrics || metrics.nodeCount === 0) {
    return { state: 'scatter', confidence: 0.5, reasons: ['Empty graph'] };
  }

  // Split: opposing thought clusters detected
  if (metrics.contradictionRatio > 0.25 || metrics.contradictsCount >= 2) {
    const excess = Math.max(metrics.contradictionRatio - 0.25, 0);
    const confidence = Math.min(0.95,
      0.70 + excess * 1.2 + (metrics.contradictsCount >= 2 ? 0.10 : 0));
    return {
      state: 'split',
      confidence,
      reasons: ['High contradiction density', 'Opposing thought clusters detected'],
    };
  }

  // Trajectory: thoughts are developing directionally
  if (metrics.longestLeadChain >= 4 || metrics.leadToRatio > 0.45) {
    const excess     = Math.max(metrics.leadToRatio - 0.45, 0);
    const chainBonus = Math.max(0, (metrics.longestLeadChain - 4) * 0.05);
    const confidence = Math.min(0.95, 0.65 + excess * 1.5 + chainBonus);
    return {
      state: 'trajectory',
      confidence,
      reasons: ['Long leads_to chain detected', 'Thoughts are developing directionally'],
    };
  }

  // Echo: thoughts are resonating in similar lanes
  if (metrics.parallelRatio > 0.35 || metrics.parallelCount >= 3) {
    const excess = Math.max(metrics.parallelRatio - 0.35, 0);
    const confidence = Math.min(0.95,
      0.65 + excess * 1.5 + (metrics.parallelCount >= 3 ? 0.10 : 0));
    return {
      state: 'echo',
      confidence,
      reasons: ['Many parallel relationships', 'Thoughts are resonating in similar lanes'],
    };
  }

  // Return: current thoughts echo older fragments
  if (metrics.recurringThemeCount >= 3) {
    const confidence = Math.min(0.90, 0.60 + (metrics.recurringThemeCount - 3) * 0.07);
    return {
      state: 'return',
      confidence,
      reasons: ['Recurring themes found across sessions', 'Current thoughts echo older fragments'],
    };
  }

  // Scatter: default — fragments still loosely connected
  const confidence = metrics.edgeDensity < 0.3 ? 0.80 : 0.50;
  return {
    state: 'scatter',
    confidence,
    reasons: ['Low relationship density', 'Fragments are still loosely connected'],
  };
}
