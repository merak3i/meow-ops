import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const PROJECT_CONSTITUTION_FIELDS = [
  'mission', 'vision', 'current_phase', 'outcome', 'constraint', 'non_goal', 'priority',
];
export const PROJECT_AGENT_SOURCES = ['antigravity', 'claude', 'codex', 'cursor', 'hermes'];
export const LEARNING_KINDS = [
  'decision', 'failure', 'fact', 'memory', 'permission', 'practice', 'rule', 'skill', 'workflow',
];

const CATALOG_FILE = 'projects.json';
const LEARNING_FILE = 'learnings.jsonl';
const START = '<!-- meow-ops:learning-state:start -->';
const END = '<!-- meow-ops:learning-state:end -->';

const cleanText = (value, field, max = 2_000) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`[project-control] invalid ${field}`);
  return result;
};

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const slug = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'project';

export function resolveProjectControlDir(env = process.env) {
  return resolve(env.MEOW_PROJECT_CONTROL_DIR || join(homedir(), '.meow-ops', 'project-control'));
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

export function readProjectCatalog() {
  const value = readJson(join(resolveProjectControlDir(), CATALOG_FILE), []);
  return Array.isArray(value) ? value : [];
}

export function registerProject(input = {}) {
  const name = cleanText(input.name, 'name', 120);
  const root = resolve(cleanText(input.root, 'root', 2_000));
  const identity = String(input.git_remote || root).trim().toLowerCase();
  const project_id = `${slug(name)}-${sha256(identity).slice(0, 10)}`;
  const catalog = readProjectCatalog();
  const previous = catalog.find((project) => project.project_id === project_id);
  const aliases = [...new Set([
    ...(previous?.aliases || []),
    ...(Array.isArray(input.aliases) ? input.aliases : []),
  ].map((alias) => String(alias).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const now = new Date().toISOString();
  const project = {
    project_id,
    name,
    aliases,
    root,
    learning_state_path: join(root, '.meow', 'learning-state'),
    git_remote: input.git_remote ? String(input.git_remote).trim() : previous?.git_remote || null,
    registered_at: previous?.registered_at || now,
    updated_at: now,
  };
  const next = catalog.filter((item) => item.project_id !== project_id);
  next.push(project);
  next.sort((a, b) => a.name.localeCompare(b.name));
  atomicJson(join(resolveProjectControlDir(), CATALOG_FILE), next);
  return project;
}

function learningPath() {
  return join(resolveProjectControlDir(), LEARNING_FILE);
}

function appendLearningRecord(record) {
  const path = learningPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function learningRecords() {
  try {
    return readFileSync(learningPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function readLearningCandidates() {
  const latest = new Map();
  for (const record of learningRecords()) latest.set(record.learning_id, record);
  return [...latest.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function appendLearningCandidate(input = {}) {
  const project_id = cleanText(input.project_id, 'project_id', 120);
  if (!readProjectCatalog().some((project) => project.project_id === project_id)) {
    throw new Error('[project-control] project is not registered');
  }
  const kind = cleanText(input.kind, 'kind', 40);
  if (!LEARNING_KINDS.includes(kind)) throw new Error('[project-control] invalid kind');
  const impact = String(input.impact || 'medium');
  if (!['low', 'medium', 'high'].includes(impact)) throw new Error('[project-control] invalid impact');
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('[project-control] confidence must be between 0 and 1');
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence.map((item) => ({
    kind: cleanText(item?.kind, 'evidence kind', 80),
    ref: cleanText(item?.ref, 'evidence ref', 500),
    ...(item?.detail ? { detail: cleanText(item.detail, 'evidence detail', 1_000) } : {}),
  })) : [];
  if (evidence.length === 0) throw new Error('[project-control] evidence is required');
  const now = new Date().toISOString();
  return appendLearningRecord({
    learning_id: input.learning_id || `learn_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`,
    project_id,
    kind,
    title: cleanText(input.title, 'title', 160),
    proposed_content: cleanText(input.proposed_content, 'proposed_content', 20_000),
    rationale: cleanText(input.rationale, 'rationale', 4_000),
    evidence,
    impact,
    confidence,
    scope: input.scope === 'portfolio' ? 'portfolio' : 'project',
    expires_at: input.expires_at || null,
    destinations: Array.isArray(input.destinations) ? input.destinations.map(String) : [],
    status: 'proposed',
    created_at: now,
    updated_at: now,
  });
}

export function decideLearningCandidate(learningId, input = {}) {
  const learning_id = cleanText(learningId, 'learning_id', 120);
  const candidate = readLearningCandidates().find((item) => item.learning_id === learning_id);
  if (!candidate) throw new Error('[project-control] learning candidate not found');
  const decision = cleanText(input.decision, 'decision', 40);
  if (!['approved', 'rejected', 'deferred'].includes(decision)) {
    throw new Error('[project-control] invalid decision');
  }
  if (candidate.status !== 'proposed' && candidate.status !== 'deferred') {
    throw new Error('[project-control] learning candidate is already decided');
  }
  const now = new Date().toISOString();
  return appendLearningRecord({
    ...candidate,
    status: decision,
    updated_at: now,
    decision: {
      decision,
      decided_by: cleanText(input.decided_by || 'owner', 'decided_by', 120),
      reason: cleanText(input.reason, 'reason', 2_000),
      decided_at: now,
    },
  });
}

function publicationTarget(stateRoot, candidate) {
  const suffix = candidate.learning_id.replace(/^learn_/, '').slice(-10);
  const name = `${slug(candidate.title)}-${suffix}`;
  if (candidate.kind === 'skill') return join(stateRoot, 'skills', slug(candidate.title), 'SKILL.md');
  if (candidate.kind === 'decision') return join(stateRoot, 'decisions', `${name}.md`);
  if (candidate.kind === 'failure') return join(stateRoot, 'failures', `${name}.md`);
  return join(stateRoot, 'practices', `${name}.md`);
}

function publicationContent(candidate) {
  const evidence = candidate.evidence.map((item) => (
    `- ${item.kind}: ${item.ref}${item.detail ? ` (${item.detail})` : ''}`
  )).join('\n');
  if (candidate.kind === 'skill') {
    const name = slug(candidate.title);
    return `---\nname: ${name}\ndescription: ${JSON.stringify(`${candidate.rationale} Use when this project needs ${candidate.title.toLowerCase()}.`)}\n---\n\n# ${candidate.title}\n\n${candidate.proposed_content}\n\n## Evidence\n\n${evidence}\n`;
  }
  return `# ${candidate.title}\n\n- Status: Owner-approved\n- Kind: ${candidate.kind}\n- Impact: ${candidate.impact}\n- Confidence: ${candidate.confidence}\n- Approved: ${candidate.decision?.decided_at || candidate.updated_at}\n\n## Learning\n\n${candidate.proposed_content}\n\n## Why it matters\n\n${candidate.rationale}\n\n## Evidence\n\n${evidence}\n`;
}

function updatePublishedIndex(project, candidates) {
  const indexPath = join(project.learning_state_path, 'INDEX.md');
  const existing = readText(indexPath) || '# Project Learning\n';
  const start = '<!-- meow-ops:published-learning:start -->';
  const end = '<!-- meow-ops:published-learning:end -->';
  const published = candidates.filter((candidate) => candidate.status === 'published' && candidate.publication);
  const body = [
    start,
    '## Published learning',
    '',
    ...(published.length > 0
      ? published.map((candidate) => `- [${candidate.title}](${candidate.publication.relative_path})`)
      : ['- No published learning yet.']),
    end,
  ].join('\n');
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, body)
    : `${existing.trimEnd()}\n\n${body}\n`;
  writeTextAtomic(indexPath, next, existsSync(indexPath) ? statSync(indexPath).mode & 0o777 : 0o644);
}

export function publishLearningCandidate(learningId) {
  const learning_id = cleanText(learningId, 'learning_id', 120);
  const candidate = readLearningCandidates().find((item) => item.learning_id === learning_id);
  if (!candidate) throw new Error('[project-control] learning candidate not found');
  if (candidate.status === 'published' && candidate.publication) return candidate;
  if (candidate.status !== 'approved') throw new Error('[project-control] learning must be owner-approved before publication');
  if (candidate.scope === 'portfolio') {
    throw new Error('[project-control] portfolio learning requires a separate promotion approval');
  }
  const project = readProjectCatalog().find((item) => item.project_id === candidate.project_id);
  if (!project) throw new Error('[project-control] project is not registered');
  const stateRoot = resolve(project.learning_state_path);
  const path = resolve(publicationTarget(stateRoot, candidate));
  if (!path.startsWith(`${stateRoot}${sep}`)) throw new Error('[project-control] unsafe publication path');
  const content = publicationContent(candidate);
  writeTextAtomic(path, content, 0o644);
  const now = new Date().toISOString();
  const published = appendLearningRecord({
    ...candidate,
    status: 'published',
    updated_at: now,
    publication: {
      path,
      relative_path: relative(stateRoot, path),
      checksum: sha256(content),
      published_at: now,
    },
  });
  updatePublishedIndex(project, readLearningCandidates());
  const manifestPath = join(stateRoot, 'manifest.json');
  const manifest = readJson(manifestPath, {});
  atomicJson(manifestPath, {
    ...manifest,
    schema_version: Number(manifest.schema_version) || 1,
    project_id: project.project_id,
    project_name: project.name,
    revision: (Number(manifest.revision) || 0) + 1,
    approved_at: now,
    approved_by: 'owner',
    raw_evidence_in_git: false,
  });
  return published;
}

function sourceName(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildProjectControlSnapshot({ project_id, sessions = [], claims = [] } = {}) {
  const id = cleanText(project_id, 'project_id', 120);
  const project = readProjectCatalog().find((item) => item.project_id === id);
  if (!project) throw new Error('[project-control] project is not registered');
  const names = new Set([project.name, ...(project.aliases || [])].map((name) => String(name).trim().toLowerCase()));
  const belongsToProject = (row) => row?.project_id === id
    || names.has(String(row?.project_name || row?.project || '').trim().toLowerCase());
  const latestClaims = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (belongsToProject(claim) && PROJECT_CONSTITUTION_FIELDS.includes(claim.field)) {
      latestClaims.set(claim.field, claim);
    }
  }
  const confirmed = [...latestClaims.values()].filter((claim) => claim.status === 'owner_confirmed').length;
  const observed = [...new Set((Array.isArray(sessions) ? sessions : []).filter(belongsToProject)
    .map((session) => sourceName(session.source))
    .filter((source) => PROJECT_AGENT_SOURCES.includes(source)))].sort();
  const candidates = readLearningCandidates().filter((item) => item.project_id === id);
  const counts = {};
  for (const candidate of candidates) counts[candidate.status] = (counts[candidate.status] || 0) + 1;
  return {
    project,
    constitution: {
      fields: Object.fromEntries(PROJECT_CONSTITUTION_FIELDS.map((field) => [field, latestClaims.get(field) || null])),
      coverage: {
        confirmed,
        total: PROJECT_CONSTITUTION_FIELDS.length,
        ratio: confirmed / PROJECT_CONSTITUTION_FIELDS.length,
      },
    },
    agents: {
      observed,
      blind_spots: PROJECT_AGENT_SOURCES.filter((source) => !observed.includes(source)),
    },
    learning: { counts, candidates },
  };
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function managed(existing, body) {
  const block = `${START}\n${body.trim()}\n${END}`;
  const pattern = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (pattern.test(existing)) return `${existing.replace(pattern, block).trimEnd()}\n`;
  return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`;
}

function target(agent, path, body, existing = readText(path)) {
  const content = managed(existing, body);
  return {
    agent,
    path,
    exists: existsSync(path),
    changed: content !== existing,
    content,
    checksum: sha256(content),
  };
}

function hermesPath(root) {
  const candidates = [
    join(root, '.hermes.md'),
    join(root, 'HERMES.md'),
    join(root, '.hermes', 'HERMES.md'),
  ];
  return candidates.find(existsSync) || join(root, 'HERMES.md');
}

export function previewProjectAdapters({ projectRoot } = {}) {
  const root = resolve(cleanText(projectRoot, 'projectRoot', 2_000));
  const index = '.meow/learning-state/INDEX.md';
  return {
    project_root: root,
    generated_at: new Date().toISOString(),
    targets: [
      target('codex', join(root, 'AGENTS.md'), `## Meow Ops project learning\n\nRead \`${index}\` before planning or changing this project. Load linked learning topics only when relevant.`),
      target('claude', join(root, 'CLAUDE.md'), `# Meow Ops project learning\n\n@${index}`),
      target('cursor', join(root, '.cursor', 'rules', 'meow-learning-state.mdc'), `---\ndescription: Owner-approved Meow Ops project learning\nalwaysApply: true\n---\n\nRead \`${index}\` before planning or changing this project. Load linked topics only when relevant.`),
      target('antigravity', join(root, '.agents', 'rules', 'meow-learning-state.md'), `# Meow Ops project learning\n\nRead \`${index}\` before planning or changing this project. Approved skills live under \`.meow/learning-state/skills/\`.`),
      target('hermes', hermesPath(root), `# Meow Ops project learning\n\nRead \`${index}\` before planning or changing this project. Load approved project skills only when relevant.`),
    ],
  };
}

function writeTextAtomic(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, content, { encoding: 'utf8', mode });
  renameSync(temp, path);
  chmodSync(path, mode);
}

function adapterSyncLedgerPath() {
  return join(resolveProjectControlDir(), 'adapter-syncs.jsonl');
}

function appendAdapterSync(record) {
  const path = adapterSyncLedgerPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return record;
}

export function readAdapterSyncs() {
  try {
    return readFileSync(adapterSyncLedgerPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function applyProjectAdapters({ projectRoot, expectedChecksums } = {}) {
  const root = resolve(cleanText(projectRoot, 'projectRoot', 2_000));
  if (!existsSync(join(root, '.meow', 'learning-state', 'INDEX.md'))) {
    throw new Error('[project-control] approved learning-state INDEX.md is missing');
  }
  if (!expectedChecksums || typeof expectedChecksums !== 'object') {
    throw new Error('[project-control] expected preview checksums are required');
  }
  const preview = previewProjectAdapters({ projectRoot: root });
  for (const target of preview.targets) {
    if (expectedChecksums[target.agent] !== target.checksum) {
      throw new Error(`[project-control] stale preview for ${target.agent}`);
    }
  }

  const sync_id = `sync_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
  const backupDir = join(resolveProjectControlDir(), 'adapter-backups', sync_id);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backups = preview.targets.map((target) => {
    const existed = existsSync(target.path);
    const before = existed ? readFileSync(target.path, 'utf8') : '';
    const mode = existed ? statSync(target.path).mode & 0o777 : 0o644;
    const backupPath = join(backupDir, `${target.agent}.json`);
    atomicJson(backupPath, { agent: target.agent, path: target.path, existed, before, mode });
    chmodSync(backupPath, 0o600);
    return { agent: target.agent, path: target.path, existed, before, mode, backupPath };
  });

  const applied = [];
  try {
    for (const target of preview.targets) {
      const backup = backups.find((item) => item.agent === target.agent);
      writeTextAtomic(target.path, target.content, backup.mode);
      applied.push({
        agent: target.agent,
        path: target.path,
        checksum: target.checksum,
        changed: target.changed,
      });
    }
  } catch (error) {
    const appliedAgents = new Set(applied.map((item) => item.agent));
    for (const backup of backups.filter((item) => appliedAgents.has(item.agent)).reverse()) {
      if (backup.existed) writeTextAtomic(backup.path, backup.before, backup.mode);
      else if (existsSync(backup.path)) unlinkSync(backup.path);
    }
    throw error;
  }

  appendAdapterSync({
    sync_id,
    action: 'applied',
    project_root: root,
    created_at: new Date().toISOString(),
    backup_dir: backupDir,
    targets: applied,
  });
  return { sync_id, applied, backup_dir: backupDir };
}

export function rollbackProjectAdapters(syncId) {
  const sync_id = cleanText(syncId, 'sync_id', 120);
  const records = readAdapterSyncs();
  const applied = [...records].reverse().find((record) => record.sync_id === sync_id && record.action === 'applied');
  if (!applied) throw new Error('[project-control] adapter sync not found');
  if (records.some((record) => record.sync_id === sync_id && record.action === 'rolled_back')) {
    throw new Error('[project-control] adapter sync is already rolled back');
  }
  const restored = [];
  for (const target of [...applied.targets].reverse()) {
    const backupPath = join(applied.backup_dir, `${target.agent}.json`);
    const backup = readJson(backupPath, null);
    if (!backup || backup.path !== target.path) throw new Error(`[project-control] missing backup for ${target.agent}`);
    const current = readText(target.path);
    if (current && sha256(current) !== target.checksum) {
      throw new Error(`[project-control] adapter drift blocks rollback for ${target.agent}`);
    }
    if (backup.existed) writeTextAtomic(backup.path, backup.before, backup.mode);
    else if (existsSync(backup.path)) unlinkSync(backup.path);
    restored.push({ agent: target.agent, path: target.path });
  }
  appendAdapterSync({
    sync_id,
    action: 'rolled_back',
    project_root: applied.project_root,
    created_at: new Date().toISOString(),
    restored,
  });
  return { sync_id, restored };
}
