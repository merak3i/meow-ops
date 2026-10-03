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
  evidence: Array<{ source: string; sessionId: string; project: string }>;
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
    name: 'Code investigation activity',
    match: (session, tools, total) =>
      session.cat_type === 'detective' || ratio(tools, total, ['Read', 'Grep', 'Glob']) > 0.45,
    technical: (ctx) =>
      `Read, Grep, and Glob made up a large share of recorded tool calls across ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. The logs show investigation activity, not whether a cause was found.`,
    layman: (ctx) =>
      `The session metadata shows repeated reading and searching in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'idempotent-retries',
    name: 'Retry-related work',
    match: (session) =>
      /retry|retries|timeout|fetch helper|same bug|same error/.test(textOf(session)),
    technical: (ctx) =>
      `Retry or timeout wording appeared in ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. The wording does not establish that a retry was safe or successful.`,
    layman: (ctx) =>
      `The session labels mention retries or timeouts in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'shell-debugging',
    name: 'Terminal-heavy sessions',
    match: (_session, tools, total) => ratio(tools, total, ['Bash']) > 0.35,
    technical: (ctx) =>
      `Bash accounted for a large share of recorded tool calls in ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. This indicates terminal activity, not a verified diagnosis.`,
    layman: (ctx) =>
      `The logs record frequent terminal-tool use in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'refactoring',
    name: 'Code editing sessions',
    match: (session, tools, total) =>
      ratio(tools, total, ['Edit', 'Write']) > 0.4 && (session.duration_seconds || 0) > 15 * 60,
    technical: (ctx) =>
      `Edit and Write tools appeared frequently in sessions lasting over 15 minutes in ${projectLabel(ctx.projects)}. The metadata cannot tell whether the work was a refactor or whether behavior stayed the same.`,
    layman: (ctx) =>
      `The logs show extended editing activity in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'code-search',
    name: 'Code search activity',
    match: (_session, tools, total) => ratio(tools, total, ['Grep', 'Glob']) > 0.25,
    technical: (ctx) =>
      `Grep and Glob made up a notable share of recorded tool calls across ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. The log does not establish the order or result of the search.`,
    layman: (ctx) =>
      `The metadata records repeated code-search activity in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'multi-agent',
    name: 'Agent coordination activity',
    match: (session) => Boolean(session.is_subagent || (session.agent_depth && session.agent_depth > 0)),
    technical: (ctx) =>
      `Parent and child-agent metadata appears in ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. It does not establish that the child work was reviewed or merged.`,
    layman: (ctx) =>
      `The session tree records work associated with child agents in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'abandoned-starts',
    name: 'Sessions without output',
    match: (session) => Boolean(session.is_ghost),
    technical: (ctx) =>
      `${ctx.count} session(s) in ${projectLabel(ctx.projects)} are marked as having no assistant output. That can mean a cancelled start, missing collection, or work that continued elsewhere.`,
    layman: (ctx) =>
      `Some sessions in ${projectLabel(ctx.projects)} have no recorded assistant output.`,
  },
  {
    id: 'prompt-iteration',
    name: 'Long back-and-forth sessions',
    match: (session) => (session.user_message_count || 0) >= 8,
    technical: (ctx) =>
      `${ctx.count} session(s) in ${projectLabel(ctx.projects)} contain at least eight user messages. The count does not show whether the request changed or repeated.`,
    layman: (ctx) =>
      `Some sessions in ${projectLabel(ctx.projects)} contain many user turns.`,
  },
  {
    id: 'test-repair',
    name: 'Test-related session labels',
    match: (session, tools, total) => {
      const text = textOf(session);
      return /test|spec|failing|assert/.test(text) || (ratio(tools, total, ['Bash']) > 0.2 && /fix|fail/.test(text));
    },
    technical: (ctx) =>
      `The session title or first request refers to tests, failures, or assertions in ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. The session metadata cannot establish whether any test ran or passed.`,
    layman: (ctx) =>
      `The recorded labels suggest test-related work in ${projectLabel(ctx.projects)}.`,
  },
  {
    id: 'planning',
    name: 'Planning-tool activity',
    match: (_session, tools, total) => ratio(tools, total, ['Agent', 'EnterPlanMode', 'Task']) > 0.15,
    technical: (ctx) =>
      `Agent, Task, or plan-mode tools appeared in ${ctx.count} session(s) in ${projectLabel(ctx.projects)}. Tool presence does not prove a plan was followed.`,
    layman: (ctx) =>
      `The session logs record planning-related tool activity in ${projectLabel(ctx.projects)}.`,
  },
];

export function inferPractice(sessions: Session[]): PracticeConcept[] {
  const seen = new Set<string>();
  const live = sessions.filter((session) => {
    if (session.is_subagent || session.is_sidechain || (session.agent_depth || 0) > 0) return false;
    const key = JSON.stringify([session.source || 'claude', session.session_id]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      evidence: hits.slice(0, 6).map((session) => ({
        source: session.source || 'claude',
        sessionId: session.session_id,
        project: session.project || 'unknown',
      })),
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
