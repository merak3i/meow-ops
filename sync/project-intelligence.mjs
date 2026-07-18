import { homedir } from 'node:os';
import { basename } from 'node:path';

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const GENERIC_PROJECT_NAMES = new Set([
  'desktop', 'documents', 'downloads', 'home', 'repos', 'scripts', 'services', 'sync', 'unknown',
]);
GENERIC_PROJECT_NAMES.add(basename(homedir()).toLowerCase());

const rows = (value) => (Array.isArray(value) ? value : []);
const PROFILE_FIELDS = ['mission', 'vision', 'current_phase', 'outcome', 'constraint', 'non_goal', 'priority'];

function dateKey(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone });
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function periodFor(question, now, timeZone) {
  const q = question.toLowerCase();
  const nowKey = dateKey(now, timeZone);
  if (q.includes('today')) return { label: 'today', includes: (key) => key === nowKey };

  const zonedNow = new Date(now.toLocaleString('en-US', { timeZone }));
  if (q.includes('week')) {
    const start = new Date(zonedNow);
    const daysSinceMonday = start.getDay() === 0 ? 6 : start.getDay() - 1;
    start.setDate(start.getDate() - daysSinceMonday);
    const startKey = localDateKey(start);
    return { label: 'this week', includes: (key) => key >= startKey && key <= nowKey };
  }
  if (q.includes('month')) {
    const prefix = nowKey.slice(0, 7);
    return { label: 'this month', includes: (key) => key.startsWith(prefix) };
  }
  return { label: 'all time', includes: () => true };
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function isTopProjectTimeQuestion(question) {
  const q = question.toLowerCase();
  return q.includes('project') && (
    q.includes('most time')
    || q.includes('time on')
    || q.includes('spent the most')
    || q.includes('spent most')
  );
}

function isCurrentProjectQuestion(question) {
  const q = question.toLowerCase();
  return q.includes('project') && [
    'working on', 'onto right now', 'on right now', 'current project', 'which project',
  ].some((phrase) => q.includes(phrase));
}

function isGenericProject(name) {
  const clean = name.toLowerCase();
  return GENERIC_PROJECT_NAMES.has(clean)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name);
}

function foldClaims(claims) {
  const latest = new Map();
  for (const claim of claims) latest.set(`${claim.project_id}:${claim.field}`, claim);
  return [...latest.values()];
}

function profileField(question) {
  const q = question.toLowerCase();
  if (q.includes('vision')) return 'vision';
  if (q.includes('mission')) return 'mission';
  if (q.includes('phase')) return 'current_phase';
  if (q.includes('constraint') || q.includes('guardrail')) return 'constraint';
  if (q.includes('non-goal') || q.includes('non goal') || q.includes('out of scope')) return 'non_goal';
  if (q.includes('priority')) return 'priority';
  if (q.includes('outcome') || q.includes('goal') || q.includes('aim') || q.includes('trying to achieve')) return 'outcome';
  return null;
}

function fieldLabel(field) {
  return field.replaceAll('_', ' ');
}

function findProject(question, projects) {
  const q = question.toLowerCase();
  return [...projects]
    .sort((a, b) => b.matchNames.join('').length - a.matchNames.join('').length)
    .find((project) => project.matchNames.some((name) => q.includes(name.toLowerCase())));
}

function answerProfileField(question, projects) {
  const field = profileField(question);
  if (!field) return null;
  const project = findProject(question, projects);
  if (!project) {
    return {
      answer: 'I can answer that after you name the project.',
      gate: 'known_unknown',
      confidence: 1,
      evidence: [],
      unknowns: ['Target project'],
      next_question: 'Which project should I use?',
      learning: { field },
    };
  }

  const claim = project.facts[field];
  const label = fieldLabel(field);
  if (!claim || claim.status === 'stale' || claim.status === 'contradicted') {
    return {
      answer: `I do not have a current, owner-confirmed ${label} for ${project.name}.`,
      gate: 'known_unknown',
      confidence: 1,
      evidence: claim ? [{ kind: 'project_claim', ref: claim.claim_id, detail: `status: ${claim.status}` }] : [],
      unknowns: [`${project.name} ${label}`],
      next_question: `What is the current ${label} for ${project.name}?`,
      learning: { project_id: project.id, project_name: project.name, field },
    };
  }

  const inferred = claim.status === 'inferred';
  return {
    answer: inferred
      ? `I am noticing this possible ${label} for ${project.name}: ${claim.value}`
      : `${project.name} ${label}: ${claim.value}`,
    gate: inferred ? 'unknown_known' : 'known_known',
    confidence: Number(claim.confidence) || (inferred ? 0.65 : 1),
    evidence: [{
      kind: 'project_claim',
      ref: claim.claim_id,
      detail: `${claim.source || 'unknown source'}, recorded ${String(claim.recorded_at || 'unknown date').slice(0, 10)}`,
    }],
    unknowns: inferred ? [`Whether this ${label} matches your intent`] : [],
    claim_id: claim.claim_id,
    claim_status: claim.status,
    learning: { project_id: project.id, project_name: project.name, field },
  };
}

function answerKnownUnknowns(question, projects) {
  const q = question.toLowerCase();
  if (!(q.includes("don't you know") || q.includes('do not know') || q.includes('known unknown') || q.includes('missing about'))) {
    return null;
  }
  const project = findProject(question, projects);
  if (!project) {
    return {
      answer: 'Name a project and I will list the important facts that are still missing.',
      gate: 'known_unknown', confidence: 1, evidence: [], unknowns: ['Target project'],
      next_question: 'Which project should I inspect?',
    };
  }
  const missing = PROFILE_FIELDS.filter((field) => {
    const claim = project.facts[field];
    return !claim || claim.status !== 'owner_confirmed';
  });
  if (missing.length === 0) {
    return {
      answer: `${project.name} has owner-confirmed coverage for every core project field.`,
      gate: 'known_known', confidence: 1,
      evidence: Object.values(project.facts).map((claim) => ({
        kind: 'project_claim', ref: claim.claim_id, detail: `${fieldLabel(claim.field)} is owner-confirmed`,
      })),
      unknowns: [],
    };
  }
  const labels = missing.map(fieldLabel);
  const first = missing[0];
  return {
    answer: `${project.name} still needs owner-confirmed: ${labels.join(', ')}.`,
    gate: 'known_unknown', confidence: 1, evidence: [],
    unknowns: labels.map((label) => `${project.name} ${label}`),
    next_question: `What is the current ${fieldLabel(first)} for ${project.name}?`,
    learning: { project_id: project.id, project_name: project.name, field: first },
  };
}

function canonicalProjectName(name, projects) {
  const clean = name.toLowerCase();
  const match = projects.find((project) => project.matchNames.some(
    (candidate) => candidate.toLowerCase() === clean,
  ));
  return match?.name || name;
}

function answerTopProjectTime(question, sessions, projects, now, timeZone) {
  const period = periodFor(question, now, timeZone);
  const byProject = new Map();
  for (const session of sessions) {
    const key = dateKey(session.ended_at || session.started_at, timeZone);
    if (!key || !period.includes(key)) continue;
    const rawProject = String(session.project || '').trim();
    if (!rawProject || isGenericProject(rawProject)) continue;
    const project = canonicalProjectName(rawProject, projects);
    const current = byProject.get(project) || { seconds: 0, sessions: 0, sources: new Set() };
    current.seconds += Math.max(0, Number(session.duration_seconds) || 0);
    current.sessions += 1;
    if (session.source) current.sources.add(String(session.source));
    byProject.set(project, current);
  }

  const [winner] = [...byProject.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  if (!winner) {
    return {
      answer: `I do not have tracked project time for ${period.label} yet. Run session sync, then ask again.`,
      gate: 'known_unknown',
      confidence: 1,
      evidence: [],
      unknowns: [`Tracked project time for ${period.label}`],
      next_question: 'Have all local session sources been synced?',
    };
  }

  const [project, metric] = winner;
  const sourceLabel = [...metric.sources].sort().join(', ') || 'local sessions';
  return {
    answer: `${project} received the most tracked time ${period.label}: ${formatDuration(metric.seconds)} across ${metric.sessions} session${metric.sessions === 1 ? '' : 's'}.`,
    gate: 'known_known',
    confidence: 0.98,
    evidence: [{
      kind: 'session_aggregate',
      ref: project,
      detail: `${metric.sessions} sessions, ${metric.seconds} seconds, sources: ${sourceLabel}`,
    }],
    unknowns: [],
  };
}

function answerCurrentProject(sessions, projects) {
  const latest = [...sessions]
    .filter((session) => {
      const project = String(session.project || '').trim();
      return project && !isGenericProject(project);
    })
    .sort((a, b) => Date.parse(b.ended_at || b.started_at || '') - Date.parse(a.ended_at || a.started_at || ''))[0];
  if (!latest) {
    return {
      answer: 'I do not have a recent project session to identify your current project.',
      gate: 'known_unknown', confidence: 1, evidence: [],
      unknowns: ['Current project session'],
      next_question: 'Which project are you working on right now?',
    };
  }
  const project = canonicalProjectName(latest.project, projects);
  return {
    answer: `Your most recent tracked project is ${project}.`,
    gate: 'known_known',
    confidence: 0.95,
    evidence: [{
      kind: 'session',
      ref: latest.session_id || project,
      detail: `${latest.source || 'local'} session at ${latest.ended_at || latest.started_at || 'unknown time'}`,
    }],
    unknowns: [],
  };
}

export function buildProjectSnapshot({ sessions = [], claims = [] } = {}) {
  const sessionRows = rows(sessions);
  const claimRows = foldClaims(rows(claims));
  const byId = new Map();
  const ensure = (id, name) => {
    if (!byId.has(id)) byId.set(id, { id, name, matchNames: [name], facts: {} });
    return byId.get(id);
  };
  for (const session of sessionRows) {
    const name = String(session.project || '').trim();
    if (!name || name.toLowerCase() === 'unknown') continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    ensure(id, name);
  }
  for (const claim of claimRows) {
    const project = ensure(claim.project_id, claim.project_name || claim.project_id);
    if (claim.project_name && !project.matchNames.includes(claim.project_name)) {
      project.matchNames.push(claim.project_name);
      project.name = claim.project_name;
    }
    if (claim.field === 'alias') {
      if (!project.matchNames.includes(claim.value)) project.matchNames.push(claim.value);
    } else if (PROFILE_FIELDS.includes(claim.field)) {
      project.facts[claim.field] = claim;
    }
  }
  return { sessions: sessionRows, claims: claimRows, projects: [...byId.values()] };
}

export function answerProjectQuestion(question, snapshot, {
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const clean = String(question || '').trim();
  if (!clean) return null;
  if (isCurrentProjectQuestion(clean)) {
    return answerCurrentProject(rows(snapshot?.sessions), rows(snapshot?.projects));
  }
  if (isTopProjectTimeQuestion(clean)) {
    return answerTopProjectTime(
      clean,
      rows(snapshot?.sessions),
      rows(snapshot?.projects),
      now,
      timeZone,
    );
  }
  const unknownsAnswer = answerKnownUnknowns(clean, rows(snapshot?.projects));
  if (unknownsAnswer) return unknownsAnswer;
  const profileAnswer = answerProfileField(clean, rows(snapshot?.projects));
  if (profileAnswer) return profileAnswer;
  return null;
}
