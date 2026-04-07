const CAT_TYPES = {
  builder: { label: 'Builder', color: 'var(--green)', icon: '🏗️' },
  detective: { label: 'Detective', color: 'var(--cyan)', icon: '🔍' },
  commander: { label: 'Commander', color: 'var(--amber)', icon: '💻' },
  architect: { label: 'Architect', color: 'var(--purple)', icon: '📐' },
  guardian: { label: 'Guardian', color: 'var(--accent)', icon: '🛡️' },
  storyteller: { label: 'Storyteller', color: 'var(--red)', icon: '📝' },
  ghost: { label: 'Ghost', color: 'var(--text-muted)', icon: '👻' },
};

export function classifyCat(toolCounts) {
  if (!toolCounts || typeof toolCounts !== 'object') return 'ghost';
  const total = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'ghost';

  const ratio = (tool) => (toolCounts[tool] || 0) / total;

  if (ratio('Write') + ratio('Edit') > 0.4) return 'builder';
  if (ratio('Read') + ratio('Grep') + ratio('Glob') > 0.5) return 'detective';
  if (ratio('Bash') > 0.4) return 'commander';
  if (ratio('Agent') + ratio('EnterPlanMode') > 0.2) return 'architect';

  const top = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0];
  if (top && ['Bash', 'Write', 'Edit'].includes(top[0])) return 'builder';
  return 'detective';
}

export function getCatMeta(type) {
  return CAT_TYPES[type] || CAT_TYPES.ghost;
}

export { CAT_TYPES };
