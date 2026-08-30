// Glossary — one definition per term, rendered by <HelpTip term="..." />.
//
// Product Law 5 says a name that needs a glossary entry is the wrong name, and
// most of the old vocabulary was renamed rather than documented ("Scrying
// Sanctum" became a Cinematic view, "Eagle Eye" became Summary). What survives
// here are the terms where the short form genuinely is the industry term and
// spelling it out in the label would be worse.

export const GLOSSARY = {
  ghost: {
    term: 'Ghost session',
    definition:
      'A session that produced no assistant output. Usually a launch you abandoned, or a crash. Ghosts still cost tokens, which is why they are tracked separately.',
  },
  'ghost-rate': {
    term: 'Ghost rate',
    definition:
      'Share of sessions in this range that produced no assistant output. Above 15% usually means sessions are being started and abandoned.',
  },
  tpm: {
    term: 'TPM',
    definition: 'Tokens per minute. Total session tokens divided by wall-clock session duration.',
  },
  opm: {
    term: 'OPM',
    definition: 'Output tokens per minute. Counts only what the model wrote back, so it tracks useful throughput rather than context size.',
  },
  sei: {
    term: 'SEI',
    definition:
      'Session efficiency index: output tokens per minute of wall-clock time. Used to flag statistical outliers against your own baseline.',
  },
  p95: {
    term: 'p95',
    definition: '95th percentile. 95 out of 100 sessions score at or below this value, so it describes your bad days rather than your average day.',
  },
  'z-score': {
    term: 'Z-score',
    definition: 'How many standard deviations a session sits from your own mean. Beyond 2.5 is flagged as an anomaly.',
  },
  'burn-rate': {
    term: 'Burn rate',
    definition: 'Linear regression over daily spend across the complete archive, projected forward 30 days. A trend line, not a commitment.',
  },
  archive: {
    term: 'Complete archive',
    definition:
      'Every session ever parsed, stored append-only on this machine. Totals and date ranges read from here.',
  },
  preview: {
    term: 'Bounded preview',
    definition:
      'The newest 1,000 sessions written to sessions.json for browser compatibility. Some tables read from this rather than the full archive; when they do, they say so.',
  },
  'cost-estimate': {
    term: 'Estimated cost',
    definition:
      'Token counts multiplied by published per-model prices. Not a bill. Sources that do not expose tokens on disk (Antigravity, Cursor without an admin key) are never estimated.',
  },
  proposal: {
    term: 'Proposal',
    definition: 'A suggested change to one of your loops, generated from session evidence. Nothing is applied until you approve it.',
  },
  evidence: {
    term: 'Evidence',
    definition: 'The local sessions and files a claim was derived from. Every proposal and project fact links back to its evidence.',
  },
  adapter: {
    term: 'Context adapter',
    definition:
      'A write into a coding tool\u2019s own config file (AGENTS.md, CLAUDE.md, .cursor/rules) so the tool picks up what this project has learned. Always previewed before it is applied, and always reversible.',
  },
  intention: {
    term: 'Project intention',
    definition:
      'The owner-confirmed statement of what a project is for and what it must not do. Coverage measures how much of it you have actually filled in.',
  },
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;

export function lookup(term: GlossaryTerm) {
  return GLOSSARY[term];
}
