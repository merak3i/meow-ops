import type { Session } from '../types/session';

// Mines concepts the operator already practiced. Not a course. Not a search box.

export interface PracticeConcept {
  id: string;
  name: string;
  technical: string;
  layman: string;
  source: string;
  projects: string[];
  sessionCount: number;
}

interface HitContext {
  projects: string[];
  count: number;
  tools: string[];
}

interface Rule {
  id: string;
  name: string;
  match: (session: Session, tools: Record<string, number>, total: number) => boolean;
  technical: (ctx: HitContext) => string;
  layman: (ctx: HitContext) => string;
}

function toolMap(session: Session): Record<string, number> {
  return session.tools && typeof session.tools === 'object' ? session.tools : {};
}

function toolTotal(tools: Record<string, number>): number {
  return Object.values(tools).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function ratio(tools: Record<string, number>, total: number, names: string[]): number {
  if (total <= 0) return 0;
  return names.reduce((sum, name) => sum + (tools[name] || 0), 0) / total;
}

function textOf(session: Session): string {
  return `${session.session_title || ''} ${session.first_user_message || ''}`.toLowerCase();
}

function projectLabel(projects: string[]): string {
  const named = projects.filter((name) => name && name !== 'unknown').slice(0, 2);
  if (named.length === 0) return 'this work';
  if (named.length === 1) return named[0] ?? 'this work';
  return `${named[0]} and ${named[1]}`;
}

function topTools(sessions: Session[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const [name, value] of Object.entries(toolMap(session))) {
      counts.set(name, (counts.get(name) ?? 0) + (Number(value) || 0));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function sourceLine(ctx: HitContext): string {
  const project = projectLabel(ctx.projects);
  const tools = ctx.tools.length > 0 ? `, ${ctx.tools.join(' + ')}` : '';
  return `${project}, ${ctx.count} session${ctx.count === 1 ? '' : 's'}${tools}`;
}

const RULES: readonly Rule[] = [
  {
    id: 'stack-tracing',
    name: 'Stack tracing',
    match: (session, tools, total) =>
      session.cat_type === 'detective' || ratio(tools, total, ['Read', 'Grep', 'Glob']) > 0.45,
    technical: (ctx) =>
      `You followed a failure through the call stack by reading and searching instead of guessing. That is stack tracing: start at the symptom, walk frames and call sites, then change the frame that actually throws. Read, Grep, and Glob were the instruments in ${projectLabel(ctx.projects)}.`,
    layman: (ctx) =>
      `You jumped between files in ${projectLabel(ctx.projects)} to chase one bug.`,
  },
  {
    id: 'idempotent-retries',
    name: 'Idempotent retries',
    match: (session) =>
      /retry|retries|timeout|fetch helper|same bug|same error/.test(textOf(session)),
    technical: (ctx) =>
      `You were mutating a request path until a failed call could be safely repeated without double-applying side effects. That is idempotency on a retry loop: the second run must leave the same durable state as the first success. The rewrite loop showed up in ${projectLabel(ctx.projects)}.`,
    layman: (ctx) =>
      `You kept rewriting the same helper in ${projectLabel(ctx.projects)} until a refresh stopped making a mess.`,
  },
  {
    id: 'shell-debugging',
    name: 'Shell debugging',
    match: (_session, tools, total) => ratio(tools, total, ['Bash']) > 0.35,
    technical: (ctx) =>
      `You treated the terminal as the debugger: reproduce, inspect stdout and exit codes, change one assumption, run again. That is shell debugging, not IDE-stepping. Bash led the tool mix in ${projectLabel(ctx.projects)}.`,
    layman: (ctx) =>
      `You ran command after command in ${projectLabel(ctx.projects)} until the error went away.`,
  },
  {
    id: 'refactoring',
    name: 'Refactoring',
    match: (session, tools, total) =>
      ratio(tools, total, ['Edit', 'Write']) > 0.4 && (session.duration_seconds || 0) > 15 * 60,
    technical: (ctx) =>
      `You changed structure without intending to change behavior. That is refactoring: extract, rename, and move while tests or a manual check keep the contract. Long Edit and Write sessions in ${projectLabel(ctx.projects)} were the signal.`,
    layman: (ctx) =>
      `You spent a long stretch editing code that already existed in ${projectLabel(ctx.projects)}, not starting a new file from zero.`,
  },
  {
    id: 'code-search',
    name: 'Code search',
    match: (_session, tools, total) => ratio(tools, total, ['Grep', 'Glob']) > 0.25,
    technical: (ctx) =>
      `You located a symbol or path before you edited it. That is code search: Grep and Glob as the index, then a narrow Read. ${projectLabel(ctx.projects)} showed that order.`,
    layman: (ctx) =>
      `You searched the tree in ${projectLabel(ctx.projects)} before changing anything.`,
  },
  {
    id: 'multi-agent',
    name: 'Multi-agent orchestration',
    match: (session) => Boolean(session.is_subagent || (session.agent_depth && session.agent_depth > 0)),
    technical: (ctx) =>
      `You split one job across parent and child agents with separate tool loops. That is multi-agent orchestration: a coordinator, scoped workers, and a merge of their results. The session tree in ${projectLabel(ctx.projects)} is the evidence.`,
    layman: (ctx) =>
      `You had more than one agent running pieces of the same job in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'abandoned-starts',
    name: 'Abandoned starts',
    match: (session) => Boolean(session.is_ghost),
    technical: (ctx) =>
      `You paid context setup and then produced no assistant output. That is an abandoned start, sometimes called a ghost session: tokens spent on launch, nothing shipped. ${projectLabel(ctx.projects)} has ${ctx.count} of them in this range.`,
    layman: (ctx) =>
      `You opened a session in ${projectLabel(ctx.projects)} and left before anything came back.`,
  },
  {
    id: 'prompt-iteration',
    name: 'Prompt iteration',
    match: (session) => (session.user_message_count || 0) >= 8,
    technical: (ctx) =>
      `You refined the same request across many user turns instead of one-shotting it. That is prompt iteration: each turn adds constraint, evidence, or a correction. ${projectLabel(ctx.projects)} had sessions with eight or more user messages.`,
    layman: (ctx) =>
      `You kept talking the agent through the same problem in ${projectLabel(ctx.projects)} instead of starting over.`,
  },
  {
    id: 'test-repair',
    name: 'Test-driven repair',
    match: (session, tools, total) => {
      const text = textOf(session);
      return /test|spec|failing|assert/.test(text) || (ratio(tools, total, ['Bash']) > 0.2 && /fix|fail/.test(text));
    },
    technical: (ctx) =>
      `You used a failing check as the specification, then changed code until the check passed. That is test-driven repair: red, change, green. Titles or Bash loops in ${projectLabel(ctx.projects)} pointed at tests.`,
    layman: (ctx) =>
      `You treated a failing test as the compass in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'planning',
    name: 'Plan then code',
    match: (_session, tools, total) => ratio(tools, total, ['Agent', 'EnterPlanMode', 'Task']) > 0.15,
    technical: (ctx) =>
      `You separated planning from mutation. That is plan-then-code: enumerate the change, then edit. Agent, Task, or plan-mode tools in ${projectLabel(ctx.projects)} marked the split.`,
    layman: (ctx) =>
      `You sketched the work before editing files in ${projectLabel(ctx.projects)}.`,
  },
];

export function inferPractice(sessions: Session[]): PracticeConcept[] {
  const live = sessions.filter((session) => !session.is_subagent);
  const concepts: PracticeConcept[] = [];

  for (const rule of RULES) {
    const hits = live.filter((session) => {
      const tools = toolMap(session);
      return rule.match(session, tools, toolTotal(tools));
    });
    if (hits.length === 0) continue;
    const ctx: HitContext = {
      projects: [...new Set(hits.map((session) => session.project || 'unknown'))],
      count: hits.length,
      tools: topTools(hits),
    };
    concepts.push({
      id: rule.id,
      name: rule.name,
      technical: rule.technical(ctx),
      layman: rule.layman(ctx),
      source: sourceLine(ctx),
      projects: ctx.projects,
      sessionCount: ctx.count,
    });
  }

  return concepts.sort((a, b) => b.sessionCount - a.sessionCount);
}

const LEARNED_KEY = 'meow-ops-learned-concepts';

export function loadLearned(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function saveLearned(next: Record<string, boolean>) {
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}
