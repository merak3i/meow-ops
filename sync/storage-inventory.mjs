// Metadata-only, bounded inventory. Never opens file contents or follows symlinks.
import { lstat, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

export const STORAGE_CATEGORIES = ['logs', 'diagnostics', 'database', 'derived', 'exports', 'backups', 'cache', 'weights', 'other'];
const DEFAULT_LIMITS = { maxEntries: 100_000, maxDepth: 32, maxDurationMs: 15_000, maxErrors: 50 };
const UNKNOWN_MODEL = Object.freeze({ kind: 'unknown', models: [] });

/** Known data locations only: no home-directory or arbitrary project traversal. */
export function registeredStorageRoots({ home = homedir(), env = process.env } = {}) {
  const meow = join(home, '.meow-ops');
  const roots = [];
  const add = (id, source, path, category, extra = {}) => roots.push({ id, source, path, category, ...extra });
  add('codex-sessions', 'codex', join(home, '.codex', 'sessions'), 'logs');
  add('codex-archived-sessions', 'codex', join(home, '.codex', 'archived_sessions'), 'logs');
  add('codex-diagnostics', 'codex', join(home, '.codex', 'log'), 'diagnostics');
  add('codex-app-diagnostics', 'codex', join(home, 'Library', 'Logs', 'com.openai.codex'), 'diagnostics');
  add('codex-databases', 'codex', join(home, '.codex'), 'database', { recursive: false, filePattern: '\\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$' });
  add('codex-cache', 'codex', join(home, '.codex', 'tmp'), 'cache');
  add('claude-sessions', 'claude', join(home, '.claude', 'projects'), 'logs');
  add('claude-diagnostics', 'claude', join(home, '.claude', 'debug'), 'diagnostics');
  add('claude-app-diagnostics', 'claude', join(home, 'Library', 'Logs', 'Claude'), 'diagnostics');
  add('cursor-transcripts', 'cursor', env.CURSOR_PROJECTS_DIR || join(home, '.cursor', 'projects'), 'logs');
  const cursorSupport = join(home, 'Library', 'Application Support', 'Cursor');
  add('cursor-workspace-storage', 'cursor', join(cursorSupport, 'User', 'workspaceStorage'), 'other');
  add('cursor-global-storage', 'cursor', join(cursorSupport, 'User', 'globalStorage'), 'other');
  add('cursor-diagnostics', 'cursor', join(cursorSupport, 'logs'), 'diagnostics');
  const hermesDb = env.HERMES_STATE_DB || join(home, '.hermes', 'state.db');
  for (const suffix of ['', '-wal', '-shm']) add(`hermes-database${suffix}`, 'hermes', `${hermesDb}${suffix}`, 'database');
  add('hermes-sessions', 'hermes', join(home, '.hermes', 'sessions'), 'logs');
  add('hermes-diagnostics', 'hermes', join(home, '.hermes', 'logs'), 'diagnostics');
  add('grokbot-daemon-diagnostics', 'grokbot', join(home, '.grokbot', 'local-exec-daemon.log'), 'diagnostics');
  add('pi-sessions', 'pi', join(home, '.pi', 'agent', 'sessions'), 'logs');
  const opencode = join(home, '.local', 'share', 'opencode');
  add('opencode-diagnostics', 'opencode', join(opencode, 'log'), 'diagnostics');
  for (const suffix of ['', '-wal', '-shm']) add(`opencode-database${suffix}`, 'opencode', join(opencode, `opencode.db${suffix}`), 'database');
  add('antigravity-data', 'antigravity', env.ANTIGRAVITY_DIR || join(home, '.gemini', 'antigravity'), 'other');
  for (const [id, key, fallback, category] of [
    ['meow-history', 'MEOW_SESSION_HISTORY_DIR', 'session-history', 'derived'],
    ['meow-evidence', 'MEOW_EVIDENCE_DIR', 'evidence', 'derived'],
    ['meow-runtime', 'MEOW_RUNTIME_DIR', 'runtime', 'diagnostics'],
    ['meow-intake', 'MEOW_INTAKE_DIR', 'intake', 'derived'],
    ['meow-backups', 'MEOW_BACKUP_DIR', 'backups', 'backups'],
  ]) add(id, 'meow-ops', env[key] || join(meow, fallback), category);
  if (env.MEOW_DATA_DIR) add('meow-exports', 'meow-ops', env.MEOW_DATA_DIR, 'exports');
  for (const [index, directory] of (env.AIDER_PROJECTS || '').split(':').filter(Boolean).entries()) {
    add(`aider-history-${index}`, 'aider', join(directory, '.aider.chat.history.md'), 'logs');
    add(`aider-input-${index}`, 'aider', join(directory, '.aider.input.history'), 'logs');
  }
  add('ollama-model-files', 'ollama', env.OLLAMA_MODELS || join(home, '.ollama', 'models'), 'weights');
  add('lmstudio-model-files', 'lmstudio', join(home, '.lmstudio', 'models'), 'weights');
  add('lmstudio-conversations', 'lmstudio', join(home, '.lmstudio', 'conversations'), 'logs');
  add('lmstudio-server-diagnostics', 'lmstudio', join(home, '.lmstudio', 'server-logs'), 'diagnostics');
  add('lmstudio-app-diagnostics', 'lmstudio', join(home, 'Library', 'Logs', 'LM Studio'), 'diagnostics');
  return roots;
}

/** Presence checks only; these locations are not claimed to be log directories. */
export async function detectUnresolvedStorageLocations({ home = homedir(), fs = { lstat } } = {}) {
  const locations = [];
  for (const [source, path] of [
    ['deepseek', join(home, '.local', 'share', 'deepseek-harness')],
    ['copilot', join(home, '.copilot')],
  ]) {
    try {
      const stat = await fs.lstat(path);
      if (stat.isDirectory()) locations.push({ source, detected: true, reason: 'Tool data is present, but its log storage location has not been confirmed.' });
    } catch { /* Missing or inaccessible installation evidence does not prove detection. */ }
  }
  return locations;
}

function attribution(input) {
  if (input?.confirmed !== true || !Array.isArray(input.models)) return UNKNOWN_MODEL;
  const models = [...new Set(input.models.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort();
  if (!models.length) return UNKNOWN_MODEL;
  return { kind: models.length === 1 ? 'single' : 'mixed', models };
}

export function classifyStorageFile(path, fallback = 'other') {
  const normalized = path.split(sep).join('/').toLowerCase();
  if (/(?:^|\/)(?:backups?|snapshots?)(?:\/|$)|\.(?:bak|backup)$/.test(normalized)) return 'backups';
  if (/(?:^|\/)exports?(?:\/|$)/.test(normalized)) return 'exports';
  if (/(?:^|\/)(?:\.?cache|caches|tmp|temp)(?:\/|$)/.test(normalized)) return 'cache';
  if (/\.(?:gguf|ggml|safetensors|onnx)$/.test(normalized)) return 'weights';
  if (/\.(?:db|sqlite|sqlite3|vscdb)(?:-wal|-shm)?$/.test(normalized)) return 'database';
  if (/(?:^|\/)(?:diagnostics?|debug)(?:\/|$)/.test(normalized)) return 'diagnostics';
  if (/\.log$/.test(normalized)) return 'diagnostics';
  if (/(?:^|\/)conversations\/[^/]+\.pb$/.test(normalized)) return 'database';
  if (/(?:^|\/)(?:transcripts?|agent-transcripts|logs)(?:\/|$)/.test(normalized)) return 'logs';
  if (/(?:^|\/)(?:brain|artifacts|generated)(?:\/|$)/.test(normalized)) return 'derived';
  if (fallback !== 'other' && STORAGE_CATEGORIES.includes(fallback)) return fallback;
  if (/\.jsonl$/.test(normalized)) return 'logs';
  return 'other';
}

const emptyTotals = () => ({ fileCount: 0, logicalBytes: 0, allocatedBytes: 0, allocatedFileCount: 0 });
function addTotals(target, value) {
  target.fileCount += value.fileCount;
  target.logicalBytes += value.logicalBytes;
  target.allocatedFileCount += value.allocatedFileCount;
  target.allocatedBytes = target.allocatedBytes === null || value.allocatedBytes === null ? null : target.allocatedBytes + value.allocatedBytes;
}
const within = (path, root) => { const part = relative(root, path); return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part)); };
const timestamp = value => Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
const changed = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'blocks'].some(key => a[key] !== b[key]);

function growth(current, previous, comparable) {
  if (!comparable || !previous) return { status: 'unavailable', logicalBytes: null, allocatedBytes: null, fileCount: null };
  return {
    status: 'available',
    logicalBytes: current.logicalBytes - previous.logicalBytes,
    allocatedBytes: current.allocatedBytes === null || previous.allocatedBytes === null ? null : current.allocatedBytes - previous.allocatedBytes,
    fileCount: current.fileCount - previous.fileCount,
  };
}

/**
 * fs is injectable for isolated failure tests. previous is a prior returned snapshot.
 * modelAttributionForFile may supply confirmed receipt metadata; it must never infer
 * bytes from tokens or model names in filenames. No contents are read by this module.
 * A caller may cache snapshots in memory; each new scan re-stats changed files.
 */
export async function scanStorageInventory(options = {}) {
  const fs = options.fs || { lstat, opendir };
  const clock = options.monotonicNow || (() => performance.now());
  const started = clock();
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const unresolved = options.unresolvedLocations ?? (options.roots ? [] : await detectUnresolvedStorageLocations({ home: options.home, fs }));
  const unresolvedLocations = (Array.isArray(unresolved) ? unresolved : [])
    .filter(item => item?.detected === true && typeof item.source === 'string' && item.source.trim())
    .map(item => ({ source: item.source.trim().slice(0, 80), status: 'detected-unresolved', reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : 'The storage location has not been confirmed.' }));
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const value = options.limits?.[key];
    return [key, Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback * 10) : fallback];
  }));
  const ids = new Set();
  const roots = (options.roots || registeredStorageRoots(options)).map(root => {
    if (!root || typeof root.id !== 'string' || !root.id || ids.has(root.id) || !isAbsolute(root.path || '')) throw new Error('Storage roots require unique IDs and absolute paths.');
    ids.add(root.id);
    if (root.filePattern && (typeof root.filePattern !== 'string' || root.filePattern.length > 500)) throw new Error('Invalid storage filename pattern.');
    return { ...root, path: resolve(root.path), category: STORAGE_CATEGORIES.includes(root.category) ? root.category : 'other', pattern: root.filePattern ? new RegExp(root.filePattern, 'i') : null };
  }).sort((a, b) => b.path.length - a.path.length || a.id.localeCompare(b.id));
  const scopeKey = createHash('sha256').update(JSON.stringify(roots.map(root => ({
    id: root.id, source: root.source, path: root.path, category: root.category, recursive: root.recursive !== false,
    filePattern: root.filePattern || null, model: attribution(root.modelAttribution),
  })))).digest('hex');
  const compatible = options.previous?.schemaVersion === 1 && options.previous.scopeKey === scopeKey
    && Date.parse(options.previous.generatedAt) < Date.parse(generatedAt);
  const inodeOwners = new Map();
  const directories = new Set();
  const totals = emptyTotals();
  const categoryTotals = new Map();
  const modelTotals = new Map();
  const errors = [];
  let errorCount = 0;
  let visitedEntries = 0;
  const reports = [];
  const boundary = () => visitedEntries >= limits.maxEntries ? 'ENTRY_LIMIT' : clock() - started >= limits.maxDurationMs ? 'TIME_LIMIT' : null;
  const error = (report, code, operation) => {
    report.status = 'partial'; report.errorCount++; errorCount++;
    if (errors.length < limits.maxErrors) errors.push({ rootId: report.id, code, operation });
  };
  const groupAdd = (map, key, value, extra) => {
    if (!map.has(key)) map.set(key, { ...extra, ...emptyTotals() });
    addTotals(map.get(key), value);
  };
  for (const root of roots) {
    const report = {
      id: root.id, source: root.source || 'unknown', path: root.path, category: root.category,
      recursive: root.recursive !== false, status: 'complete', ...emptyTotals(),
      oldestModifiedAt: null, newestModifiedAt: null, errorCount: 0,
      skipped: { symlinks: 0, hardlinks: 0, overlappingRoots: 0, excluded: 0, specialFiles: 0 },
      categories: [], modelBuckets: [],
    };
    const perCategory = new Map();
    const perModel = new Map();
    const walk = async (path, depth) => {
      const exceeded = boundary();
      if (exceeded) { error(report, exceeded, 'scan'); return; }
      visitedEntries++;
      let before;
      try { before = await fs.lstat(path); }
      catch (err) {
        if (path === root.path && err.code === 'ENOENT') { report.status = 'missing'; return; }
        error(report, ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(err.code) ? err.code : 'STAT_FAILED', 'stat'); return;
      }
      if (before.isSymbolicLink()) {
        report.skipped.symlinks++;
        if (path === root.path) error(report, 'SYMLINK_ROOT', 'scan');
        return;
      }
      const identity = `${before.dev}:${before.ino}`;
      if (before.isDirectory()) {
        if (path !== root.path && roots.some(other => other.id !== root.id && other.path === path)) { report.skipped.overlappingRoots++; return; }
        if (path !== root.path && root.recursive === false) { report.skipped.excluded++; return; }
        if (directories.has(identity)) { report.skipped.overlappingRoots++; return; }
        if (depth > limits.maxDepth) { error(report, 'DEPTH_LIMIT', 'scan'); return; }
        directories.add(identity);
        try {
          const directory = await fs.opendir(path);
          for await (const entry of directory) {
            await walk(join(path, entry.name), depth + 1);
            const stopped = boundary();
            if (stopped) { error(report, stopped, 'scan'); break; }
          }
          const after = await fs.lstat(path);
          if (!after.isDirectory() || changed(before, after)) error(report, 'DIRECTORY_CHANGED', 'stat');
        } catch (err) { error(report, ['EACCES', 'EPERM', 'ENOENT', 'EIO'].includes(err.code) ? err.code : 'READ_DIRECTORY_FAILED', 'list'); }
        return;
      }
      if (!before.isFile()) { report.skipped.specialFiles++; return; }
      if (root.pattern && !root.pattern.test(basename(path))) { report.skipped.excluded++; return; }
      if (roots.some(other => other.id !== root.id && within(path, other.path) && (other.path.length > root.path.length || (other.path === root.path && other.id.localeCompare(root.id) < 0)))) {
        report.skipped.overlappingRoots++; return;
      }
      if (inodeOwners.has(identity)) { report.skipped.hardlinks++; return; }
      let after;
      try { after = await fs.lstat(path); }
      catch { error(report, 'FILE_CHANGED', 'stat'); return; }
      if (!after.isFile() || changed(before, after)) { error(report, 'FILE_CHANGED', 'stat'); return; }
      if (!Number.isSafeInteger(before.size) || before.size < 0) { error(report, 'INVALID_SIZE', 'stat'); return; }
      inodeOwners.set(identity, root.id);
      const allocatedBytes = Number.isSafeInteger(before.blocks) && before.blocks >= 0 && Number.isSafeInteger(before.blocks * 512) ? before.blocks * 512 : null;
      const value = { fileCount: 1, logicalBytes: before.size, allocatedBytes, allocatedFileCount: allocatedBytes === null ? 0 : 1 };
      const category = classifyStorageFile(relative(root.path, path) || basename(path), root.category);
      let model = attribution(root.modelAttribution);
      if (options.modelAttributionForFile) {
        try { model = attribution(await options.modelAttributionForFile(path, root)); }
        catch { model = UNKNOWN_MODEL; error(report, 'ATTRIBUTION_UNAVAILABLE', 'attribute'); }
      }
      const modelKey = JSON.stringify(model);
      addTotals(report, value); addTotals(totals, value);
      groupAdd(perCategory, category, value, { category }); groupAdd(categoryTotals, category, value, { category });
      groupAdd(perModel, modelKey, value, model); groupAdd(modelTotals, modelKey, value, model);
      const modified = timestamp(before.mtime instanceof Date ? before.mtime.getTime() : before.mtimeMs);
      if (modified) {
        report.oldestModifiedAt = !report.oldestModifiedAt || modified < report.oldestModifiedAt ? modified : report.oldestModifiedAt;
        report.newestModifiedAt = !report.newestModifiedAt || modified > report.newestModifiedAt ? modified : report.newestModifiedAt;
      }
    };
    await walk(root.path, 0);
    report.categories = [...perCategory.values()].sort((a, b) => a.category.localeCompare(b.category));
    report.modelBuckets = [...perModel.values()];
    const previous = options.previous?.roots?.find(item => item.id === root.id);
    report.growth = growth(report, previous, compatible && report.status === 'complete' && previous?.status === 'complete');
    reports.push(report);
  }
  reports.sort((a, b) => a.id.localeCompare(b.id));
  const coverage = {
    status: reports.every(root => root.status === 'complete') && unresolvedLocations.length === 0 ? 'complete' : 'partial',
    registeredRoots: reports.length, completeRoots: reports.filter(root => root.status === 'complete').length,
    missingRoots: reports.filter(root => root.status === 'missing').length,
    partialRoots: reports.filter(root => root.status === 'partial').length,
    visitedEntries, errorCount, errorsTruncated: errorCount > errors.length,
    symlinkPolicy: 'excluded', hardlinkPolicy: 'counted-once',
  };
  return {
    schemaVersion: 1, generatedAt, scope: 'local-metadata-only', scopeKey,
    measurement: 'Logical file bytes and filesystem-reported allocated blocks. Shared APFS extents and filesystem overhead are not measured. Nested roots own their files; hardlinks belong to the first root in deterministic scan order.',
    durationMs: Math.max(0, Math.round(clock() - started)), limits, coverage, totals,
    growth: growth(totals, options.previous?.totals, compatible && coverage.status === 'complete' && options.previous?.coverage?.status === 'complete'),
    previousGeneratedAt: compatible ? options.previous.generatedAt : null,
    categories: [...categoryTotals.values()].sort((a, b) => a.category.localeCompare(b.category)),
    modelBuckets: [...modelTotals.values()], roots: reports, unresolvedLocations, errors,
  };
}
