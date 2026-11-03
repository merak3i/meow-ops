// sync/swarm-models.mjs: which models each agent harness can run, and how we know.
//
// AutoSwarm deliberately keeps no model catalog: a child runs its harness's
// native default unless --model names a native id. So Meow Ops learns models
// from evidence, re-read on every refresh:
//
//   config    the harness's own settings file names a default or profile model
//   sessions  a session Meow Ops parsed from that harness's logs ran the model
//   autoswarm a delegated call asked for it (accepted or rejected, with proof)
//   roster    you pinned it in ~/.meow-ops/swarm.json
//
// The first time a model id appears it is stamped in ~/.meow-ops/swarm/models.json
// and flagged new for seven days. Nothing here runs a harness binary.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL_ID = /^[A-Za-z0-9][\w.:/@[\]=,+-]{1,79}$/;
const NOT_MODELS = new Set(['true', 'false', 'null', 'none', 'default', 'auto', 'inherit', 'native']);
export const SOURCE_TO_PROVIDER = Object.freeze({ codex: 'codex', claude: 'claude-code', cursor: 'cursor', hermes: 'hermes', deepseek: 'dsh' });

// Settings files per harness, read-only. Paths that do not exist are skipped.
function configFiles(provider, { home, env }) {
  const files = {
    codex: [join(env.CODEX_HOME || join(home, '.codex'), 'config.toml')],
    'claude-code': [join(home, '.claude', 'settings.json'), join(home, '.claude', 'settings.local.json')],
    cursor: [join(home, '.cursor', 'cli-config.json')],
    hermes: [join(env.HERMES_HOME || join(home, '.hermes'), 'config.yaml'), join(env.HERMES_HOME || join(home, '.hermes'), 'config.yml')],
    dsh: listConfig(join(home, '.dsh'), 2),
    kimi: [join(env.KIMI_CODE_HOME || join(home, '.kimi-code'), 'config.toml'), join(home, '.kimi', 'config.toml')],
    grok: listConfig(join(home, '.grok'), 1),
    copilot: [join(home, '.copilot', 'config.json')],
    opencode: [join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', 'opencode.json')],
  };
  return files[provider] ?? [];
}

function listConfig(dir, depth) {
  const found = [];
  const walk = (path, level) => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= 20) return;
      const full = join(path, entry.name);
      if (entry.isDirectory() && level < depth && !/^(sessions?|logs?|cache|history|node_modules|\.git)$/i.test(entry.name)) walk(full, level + 1);
      else if (entry.isFile() && ['.json', '.toml', '.yaml', '.yml'].includes(extname(entry.name).toLowerCase())) found.push(full);
    }
  };
  walk(dir, 1);
  return found;
}

const looksLikeModel = (value) => typeof value === 'string' && MODEL_ID.test(value.trim()) && !NOT_MODELS.has(value.trim().toLowerCase()) && !/^(https?:|\/|~)/.test(value.trim());

/** Model ids named under model-ish keys in JSON, TOML or YAML text. Lenient on purpose. */
export function modelsInText(text, extension) {
  const found = [];
  const add = (value, isDefault) => { if (looksLikeModel(value)) found.push({ id: value.trim(), isDefault }); };
  if (extension === '.json') {
    try {
      const walk = (value, key = '', depth = 0) => {
        if (depth > 6 || value === null) return;
        if (typeof value === 'string' && /(^|_)model(_?id)?$|^default_?model$/i.test(key)) add(value, /^(model|default_?model)$/i.test(key));
        else if (Array.isArray(value) && /models$/i.test(key)) value.forEach((item) => (typeof item === 'string' ? add(item, false) : walk(item, '', depth + 1)));
        else if (typeof value === 'object') for (const [child, inner] of Object.entries(value)) walk(inner, child, depth + 1);
      };
      walk(JSON.parse(text));
    } catch { /* unreadable config is simply no evidence */ }
    return found;
  }
  let section = '';
  for (const line of text.split(/\r?\n/).slice(0, 4000)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { section = header[1]; continue; }
    const pair = line.match(/^\s*(model|default_model|model_id|modelId)\s*[:=]\s*["']?([^"'#\s]+)["']?/i);
    if (pair) add(pair[2], !section && /^(model|default_model)$/i.test(pair[1]));
  }
  return found;
}

export function readDeclaredModels(providerIds, { home = homedir(), env = process.env } = {}) {
  const out = {};
  for (const provider of providerIds) {
    const models = [];
    for (const file of configFiles(provider, { home, env })) {
      try {
        if (!existsSync(file) || statSync(file).size > 256_000) continue;
        models.push(...modelsInText(readFileSync(file, 'utf8'), extname(file).toLowerCase()));
      } catch { /* skip */ }
    }
    out[provider] = models;
  }
  return out;
}

function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value && typeof value === 'object' && value.schemaVersion === 1 && value.seen && typeof value.seen === 'object') return value;
  } catch { /* first run */ }
  return null;
}

function writeState(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch { /* the catalog still works for this read */ }
}

const rejectsModel = (call) => /invalid_model|invalid_selection|model/i.test(`${call.errorCode ?? ''} ${call.error ?? ''}`) && !/reasoning-effort|effort/i.test(call.error ?? '');
const rejectsEffort = (call) => /reasoning-effort control|effort/i.test(call.error ?? '') && call.status === 'failed';

/**
 * Per-provider model evidence. `calls` are reader call records, `sessions`
 * are Meow Ops session rows ({ source, model, started_at }).
 */
export function modelCatalog(providerIds, { calls = [], sessions = [], declared = {}, roster = {}, statePath = null, now = Date.now() } = {}) {
  const previous = statePath ? readState(statePath) : null;
  const state = previous ?? { schemaVersion: 1, createdAt: new Date(now).toISOString(), seen: {} };
  const catalog = {};
  const touch = (provider, id, source, at, isDefault = false) => {
    const key = `${provider}\u0000${id}`;
    const entry = catalog[provider].models.get(id) ?? { id, sources: new Set(), default: false, lastSeen: null, accepted: 0, rejected: 0, effortRejected: 0 };
    entry.sources.add(source);
    entry.default ||= isDefault;
    if (at && (!entry.lastSeen || at > entry.lastSeen)) entry.lastSeen = at;
    catalog[provider].models.set(id, entry);
    state.seen[key] ??= new Date(now).toISOString();
    return entry;
  };
  for (const provider of providerIds) catalog[provider] = { models: new Map(), effort: { supported: 'unknown', evidence: null } };

  for (const provider of providerIds) {
    for (const item of declared[provider] ?? []) touch(provider, item.id, 'config', null, item.isDefault);
    for (const id of roster[provider] ?? []) if (looksLikeModel(id)) touch(provider, id, 'roster', null);
  }
  for (const session of sessions) {
    const provider = SOURCE_TO_PROVIDER[session?.source];
    if (!provider || !catalog[provider] || !looksLikeModel(session.model)) continue;
    touch(provider, session.model.trim(), 'sessions', session.started_at || session.ended_at || null);
  }
  for (const call of calls) {
    if (!catalog[call.provider]) continue;
    if (call.model) {
      const entry = touch(call.provider, call.model, 'autoswarm', call.createdAt);
      if (call.status === 'completed') entry.accepted += 1;
      else if (call.status === 'failed' && rejectsModel(call)) entry.rejected += 1;
      if (rejectsEffort(call)) entry.effortRejected += 1;
    }
    if (call.effort && call.status === 'completed') catalog[call.provider].effort = { supported: true, evidence: call.id };
    else if (call.effort && rejectsEffort(call) && catalog[call.provider].effort.supported !== true) catalog[call.provider].effort = { supported: false, evidence: call.id };
  }

  const baseline = Date.parse(state.createdAt);
  const out = {};
  for (const provider of providerIds) {
    out[provider] = {
      effort: catalog[provider].effort,
      models: [...catalog[provider].models.values()].map((entry) => {
        const firstSeen = state.seen[`${provider}\u0000${entry.id}`];
        const first = Date.parse(firstSeen);
        return {
          id: entry.id,
          sources: [...entry.sources].sort(),
          default: entry.default,
          firstSeen,
          lastSeen: entry.lastSeen,
          accepted: entry.accepted,
          rejected: entry.rejected,
          effortRejected: entry.effortRejected,
          // A model present at the very first scan is history, not news.
          new: Boolean(previous) && first > baseline + 60 * 60 * 1000 && now - first < 7 * DAY_MS,
        };
      }).sort((a, b) => Number(b.default) - Number(a.default) || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.id.localeCompare(b.id)),
    };
  }
  if (statePath) writeState(statePath, state);
  return out;
}

export function defaultModelStatePath({ env = process.env, home = homedir() } = {}) {
  return join(env.MEOW_SWARM_DIR || join(home, '.meow-ops', 'swarm'), 'models.json');
}
