// Aggregate the complete local archive without returning individual records.
export function summarizeEternal(snapshot) {
  if (!snapshot.updatedAt || !Array.isArray(snapshot.sessions)) return null;
  const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  return snapshot.sessions.reduce((stats, session) => {
    stats.totalSpend += valid(session.estimated_cost_usd);
    stats.totalTokens += valid(session.total_tokens);
    stats.ghostCount += session.is_ghost === true ? 1 : 0;
    return stats;
  }, { totalSpend: 0, totalTokens: 0, ghostCount: 0, totalSessions: snapshot.sessions.length,
    scope: 'archive', importedAt: snapshot.updatedAt });
}
