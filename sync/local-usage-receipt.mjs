// Local Usage Receipt v1: sanitized, manual-import usage evidence.
//
// Architecture (accepted audit design):
//   computer/harness
//     → read-only adapter or explicit receipt writer
//     → sanitized receipt JSONL
//     → manual import directory (MEOW_LOCAL_USAGE_IMPORTS)
//     → Meow Ops aggregate dashboard
//
// Evidence boundaries:
//   * Hermes session_model_usage is an official supported source.
//   * Ollama / LM Studio installed or loaded model lists are not usage.
//   * Harnesses without durable history use the receipt-writer integration
//     point. This module does not invent a parser for them.
//   * No automatic LAN discovery, cloud backend, public upload, or live
//     paid API calls.
//   * Existing Hermes and Cursor tracking stay in place. Receipts never
//     overwrite official usage already assigned to a session.

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const RECEIPT_SCHEMA = 'meow.local_usage_receipt';
export const RECEIPT_SCHEMA_VERSION = 1;
export const SUPPORTED_HARNESSES = Object.freeze(['hermes', 'receipt-writer']);

export const LOCAL_USAGE_LIMITATION = [
  'Local Usage Receipt v1 imports sanitized JSONL from operator-chosen directories.',
  'Hermes session_model_usage is the only official read-only adapter.',
  'Ollama and LM Studio model inventories are not treated as usage.',
  'Harnesses without durable history must write receipts explicitly.',
  'Session assignment requires an exact stable session identifier.',
  'Unmatched receipts stay as aggregates and are never guessed onto a session.',
  'Source-reported cost is preserved. Unknown cost stays unavailable, not $0.',
].join(' ');

export const UNSUPPORTED_LOCAL_USAGE_SOURCES = Object.freeze([
  'ollama-installed-model-list',
  'lmstudio-loaded-model-list',
  'cursor-local-transcript-usage',
  'automatic-lan-discovery',
  'cloud-upload',
  'live-paid-api-calls',
]);

const ALLOWED_RECEIPT_KEYS = Object.freeze([
  'schema',
  'schema_version',
  'machine_id',
  'harness',
  'source_event_id',
  'occurred_at',
  'runtime',
  'provider',
  'model',
  'session_id',
  'tokens',
  'cost_usd',
]);

const ALLOWED_TOKEN_KEYS = Object.freeze([
  'input',
  'output',
  'cache_read',
  'cache_write',
  'reasoning',
]);

const FORBIDDEN_KEYS = Object.freeze([
  'prompt', 'prompts', 'response', 'responses', 'transcript', 'transcripts',
  'message', 'messages', 'content', 'text', 'username', 'user', 'user_name',
  'hostname', 'host', 'computer_name', 'cwd', 'path', 'filepath', 'abs_path',
  'absolute_path', 'remote', 'remotes', 'git_remote', 'repo_remote',
  'repository', 'url', 'uri', 'credential', 'credentials', 'password',
  'token', 'api_key', 'authorization', 'cookie', 'home', 'homedir',
  'serial', 'mac', 'hardware_id', 'machine_name',
]);

const FORBIDDEN_KEY_RE = /prompt|transcript|username|hostname|password|secret|credential|api[_-]?key/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECRET_RES = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/,
  /\bcrsr_[A-Za-z0-9_]{8,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]+\b/,
  /\bAKIA[A-Z0-9]{12,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}/i,
];

const ABSOLUTE_PATH_RE = /(?:^|[\s"'`=(])(?:\/(?:Users|home|var|etc|private|opt|root|Volumes)\/|[A-Za-z]:\\|~\/|\\\\)/;
const USER_AT_HOST_RE = /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const GIT_REMOTE_RE = /(?:git@|https?:\/\/)[A-Za-z0-9._-]+[:/][A-Za-z0-9._/-]+\.git\b/i;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,255}$/;
const OFFICIAL_USAGE_SOURCES = new Set(['cursor-admin-api', 'hermes']);

function identityHints(extra = []) {
  const hints = [];
  try {
    const user = userInfo();
    if (user?.username) hints.push(String(user.username));
  } catch { /* environments without passwd stay hint-free */ }
  try {
    const host = hostname();
    if (host) hints.push(String(host));
  } catch { /* ignore */ }
  for (const value of extra) {
    if (value) hints.push(String(value));
  }
  return [...new Set(hints.filter((value) => value && value.length >= 2))];
}

function emptyTokenBag() {
  return {
    input: null,
    output: null,
    cache_read: null,
    cache_write: null,
    reasoning: null,
  };
}

function emptyTotals() {
  return {
    receipts: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    cost_available: false,
    receipts_with_cost: 0,
    receipts_with_tokens: 0,
  };
}

function emptyRejectReasons() {
  return {
    malformed: 0,
    unsupported_version: 0,
    secret: 0,
    identity: 0,
    forbidden_field: 0,
    inventory: 0,
    escape: 0,
  };
}

export function emptyLocalUsageReport(overrides = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    schema_version: RECEIPT_SCHEMA_VERSION,
    status: 'skipped',
    enabled: false,
    limitation: LOCAL_USAGE_LIMITATION,
    supported_harnesses: [...SUPPORTED_HARNESSES],
    unsupported: [...UNSUPPORTED_LOCAL_USAGE_SOURCES],
    import_roots: 0,
    files_scanned: 0,
    files_skipped: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    rejected_reasons: emptyRejectReasons(),
    matched_sessions: 0,
    matched_receipts: 0,
    applied_receipts: 0,
    unmatched_receipts: 0,
    totals: emptyTotals(),
    by_machine: [],
    by_harness: [],
    by_provider: [],
    by_model: [],
    unmatched: {
      totals: emptyTotals(),
      by_machine: [],
      by_harness: [],
      by_provider: [],
      by_model: [],
    },
    ...overrides,
  };
}

export function generateMachineId() {
  return randomUUID();
}

export function machineDisplayLabel(machineId) {
  const hex = String(machineId || '').replace(/-/g, '').toLowerCase();
  if (hex.length < 8) return 'machine-unknown';
  return `machine-${hex.slice(0, 8)}`;
}

export function defaultMachineIdPath() {
  return join(homedir(), '.meow-ops', 'machine-id');
}

export function defaultLocalUsageStorePath() {
  return join(homedir(), '.meow-ops', 'local-usage-store.jsonl');
}

export function assertOutsideWorktree(dir) {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      throw new Error('local usage identity/store path refuses a git worktree');
    }
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

export function readOrCreateMachineId(options = {}) {
  const path = options.path || process.env.MEOW_MACHINE_ID_PATH || defaultMachineIdPath();
  const allowWorktree = options.allowWorktree === true
    || process.env.MEOW_MACHINE_ID_ALLOW_WORKTREE === '1';
  if (!allowWorktree) assertOutsideWorktree(dirname(path));

  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (!UUID_RE.test(raw)) {
      throw new Error('machine_id file is not a random UUID; refusing to invent a replacement');
    }
    return raw;
  }

  const id = generateMachineId();
  if (!UUID_RE.test(id)) {
    throw new Error('machine_id generator produced a non-UUID value');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${id}\n`, { encoding: 'utf8', mode: 0o600 });
  return id;
}

export function receiptIdentity(receipt) {
  return [
    String(receipt?.machine_id || '').trim(),
    String(receipt?.harness || '').trim(),
    String(receipt?.source_event_id || '').trim(),
  ].join('\0');
}

function isForbiddenKey(key) {
  const lower = String(key).toLowerCase();
  return FORBIDDEN_KEYS.includes(lower) || FORBIDDEN_KEY_RE.test(key);
}

function looksLikeInventory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schema === RECEIPT_SCHEMA) return false;
  if (Array.isArray(value.models)) return true;
  if (value.object === 'list' && Array.isArray(value.data)) return true;
  if ((value.digest || value.modified_at) && (value.size != null || value.quantization)) return true;
  return false;
}

function hasSecretShape(text) {
  const value = String(text);
  return SECRET_RES.some((re) => re.test(value));
}

function hasPathOrRemoteLeak(text) {
  const value = String(text);
  return ABSOLUTE_PATH_RE.test(value)
    || USER_AT_HOST_RE.test(value)
    || GIT_REMOTE_RE.test(value);
}

function hasIdentityHintLeak(text, hints) {
  const lower = String(text).toLowerCase();
  for (const hint of hints) {
    const needle = String(hint).toLowerCase();
    if (needle.length < 2) continue;
    if (lower === needle) return true;
    if (lower.includes(`/${needle}/`) || lower.endsWith(`/${needle}`)) return true;
  }
  return false;
}

function scanStrings(value, visit) {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) scanStrings(child, visit);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key);
      scanStrings(child, visit);
    }
  }
}

function optionalToken(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function optionalCost(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function optionalLabel(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!LABEL_RE.test(text)) return null;
  return text;
}

function reject(reason) {
  return { ok: false, reason, receipt: null };
}

export function validateReceipt(value, options = {}) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return reject('malformed');
  }
  if (looksLikeInventory(value)) return reject('inventory');

  for (const key of Object.keys(value)) {
    if (isForbiddenKey(key)) return reject('forbidden_field');
  }

  const version = Number(value.schema_version);
  if (value.schema !== RECEIPT_SCHEMA) return reject('malformed');
  if (!Number.isInteger(version)) return reject('malformed');
  if (version !== RECEIPT_SCHEMA_VERSION) return reject('unsupported_version');

  const hints = identityHints(options.identityHints || []);
  let leak = null;
  scanStrings(value, (text) => {
    if (leak) return;
    if (hasSecretShape(text)) leak = 'secret';
    else if (hasPathOrRemoteLeak(text)) leak = 'identity';
  });
  if (leak) return reject(leak);
  const identityFields = [value.machine_id, value.source_event_id, value.session_id];
  if (identityFields.some((field) => field != null && hasIdentityHintLeak(field, hints))) {
    return reject('identity');
  }

  const machineId = String(value.machine_id || '').trim();
  if (!UUID_RE.test(machineId)) return reject('malformed');

  const harness = String(value.harness || '').trim();
  if (!SUPPORTED_HARNESSES.includes(harness)) return reject('malformed');

  const sourceEventId = String(value.source_event_id || '').trim();
  if (!EVENT_ID_RE.test(sourceEventId)) return reject('malformed');

  const occurredAt = String(value.occurred_at || '').trim();
  const occurredMs = Date.parse(occurredAt);
  if (!occurredAt || Number.isNaN(occurredMs)) return reject('malformed');

  const tokensIn = value.tokens && typeof value.tokens === 'object' && !Array.isArray(value.tokens)
    ? value.tokens
    : {};
  for (const key of Object.keys(tokensIn)) {
    if (isForbiddenKey(key)) return reject('forbidden_field');
    if (!ALLOWED_TOKEN_KEYS.includes(key)) return reject('malformed');
  }

  const tokens = emptyTokenBag();
  for (const key of ALLOWED_TOKEN_KEYS) {
    if (!(key in tokensIn)) continue;
    const parsed = optionalToken(tokensIn[key]);
    if (tokensIn[key] != null && tokensIn[key] !== '' && parsed == null) return reject('malformed');
    tokens[key] = parsed;
  }

  const cost = optionalCost(value.cost_usd);
  if (value.cost_usd != null && value.cost_usd !== '' && cost == null) return reject('malformed');

  const runtime = optionalLabel(value.runtime);
  if (value.runtime != null && value.runtime !== '' && runtime == null) return reject('malformed');
  const provider = optionalLabel(value.provider);
  if (value.provider != null && value.provider !== '' && provider == null) return reject('malformed');
  const model = optionalLabel(value.model);
  if (value.model != null && value.model !== '' && model == null) return reject('malformed');

  let sessionId = null;
  if (value.session_id != null && value.session_id !== '') {
    sessionId = String(value.session_id).trim();
    if (!EVENT_ID_RE.test(sessionId)) return reject('malformed');
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    schema_version: RECEIPT_SCHEMA_VERSION,
    machine_id: machineId,
    harness,
    source_event_id: sourceEventId,
    occurred_at: new Date(occurredMs).toISOString(),
    runtime,
    provider,
    model,
    session_id: sessionId,
    tokens,
    cost_usd: cost,
  };

  return { ok: true, reason: null, receipt };
}

export function serializeReceipt(receipt) {
  const validated = validateReceipt(receipt);
  if (!validated.ok) {
    throw new Error(`receipt rejected: ${validated.reason}`);
  }
  const out = {};
  for (const key of ALLOWED_RECEIPT_KEYS) out[key] = validated.receipt[key];
  return JSON.stringify(out);
}

function hasDotDot(pathValue) {
  return String(pathValue).split(/[\\/]/).includes('..');
}

export function isInsideRoot(root, candidate) {
  const base = resolve(root);
  const next = resolve(candidate);
  if (base === next) return true;
  const rel = relative(base, next);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

export function parseImportRoots(spec) {
  const raw = spec == null ? '' : String(spec);
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  const roots = [];
  const skipped = [];
  for (const part of parts) {
    if (part.includes('\0') || hasDotDot(part)) {
      skipped.push('escape');
      continue;
    }
    const resolved = resolve(part);
    let real;
    try {
      real = realpathSync(resolved);
    } catch {
      skipped.push('missing');
      continue;
    }
    let stat;
    try {
      stat = statSync(real);
    } catch {
      skipped.push('missing');
      continue;
    }
    if (!stat.isDirectory()) {
      skipped.push('not-dir');
      continue;
    }
    roots.push(real);
  }
  return { roots: [...new Set(roots)], skipped };
}

export function listReceiptFiles(root) {
  const files = [];
  let escaped = 0;
  const stack = [root];
  const seen = new Set();

  while (stack.length > 0) {
    const dir = stack.pop();
    let realDir;
    try {
      realDir = realpathSync(dir);
    } catch {
      escaped += 1;
      continue;
    }
    if (!isInsideRoot(root, realDir)) {
      escaped += 1;
      continue;
    }
    if (seen.has(realDir)) continue;
    seen.add(realDir);

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      escaped += 1;
      continue;
    }

    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      let lstat;
      try {
        lstat = lstatSync(full);
      } catch {
        escaped += 1;
        continue;
      }

      if (lstat.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(full);
        } catch {
          escaped += 1;
          continue;
        }
        if (!isInsideRoot(root, target)) {
          escaped += 1;
          continue;
        }
        let targetStat;
        try {
          targetStat = statSync(target);
        } catch {
          escaped += 1;
          continue;
        }
        if (targetStat.isDirectory()) stack.push(target);
        else if (targetStat.isFile() && target.endsWith('.jsonl')) files.push(target);
        continue;
      }

      if (lstat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (lstat.isFile() && entry.name.endsWith('.jsonl')) {
        let real;
        try {
          real = realpathSync(full);
        } catch {
          escaped += 1;
          continue;
        }
        if (!isInsideRoot(root, real)) {
          escaped += 1;
          continue;
        }
        files.push(real);
      }
    }
  }

  return { files: [...new Set(files)].sort(), escaped };
}

function readJsonlRecords(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    try {
      records.push({ ok: true, value: JSON.parse(line) });
    } catch {
      records.push({ ok: false, value: null });
    }
  }
  return records;
}

function addUsage(target, receipt) {
  target.receipts += 1;
  const tokens = receipt.tokens || emptyTokenBag();
  let anyToken = false;
  if (tokens.input != null) { target.input_tokens += tokens.input; anyToken = true; }
  if (tokens.output != null) { target.output_tokens += tokens.output; anyToken = true; }
  if (tokens.cache_read != null) { target.cache_read_tokens += tokens.cache_read; anyToken = true; }
  if (tokens.cache_write != null) { target.cache_write_tokens += tokens.cache_write; anyToken = true; }
  if (tokens.reasoning != null) { target.reasoning_tokens += tokens.reasoning; anyToken = true; }
  if (anyToken) target.receipts_with_tokens += 1;
  target.total_tokens = target.input_tokens + target.output_tokens
    + target.cache_read_tokens + target.cache_write_tokens + target.reasoning_tokens;
  if (receipt.cost_usd != null && Number.isFinite(receipt.cost_usd)) {
    if (!target.cost_available) {
      target.cost_usd = 0;
      target.cost_available = true;
    }
    target.cost_usd += receipt.cost_usd;
    target.receipts_with_cost += 1;
  }
}

function bumpGroup(map, key, receipt) {
  if (!map.has(key)) map.set(key, { key, ...emptyTotals() });
  addUsage(map.get(key), receipt);
}

function sortGroups(map) {
  return [...map.values()].sort((a, b) => (
    b.total_tokens - a.total_tokens
    || (b.cost_usd || 0) - (a.cost_usd || 0)
    || a.key.localeCompare(b.key)
  ));
}

function aggregateReceipts(receipts) {
  const totals = emptyTotals();
  const byMachine = new Map();
  const byHarness = new Map();
  const byProvider = new Map();
  const byModel = new Map();
  for (const receipt of receipts) {
    addUsage(totals, receipt);
    bumpGroup(byMachine, machineDisplayLabel(receipt.machine_id), receipt);
    bumpGroup(byHarness, receipt.harness || 'unknown', receipt);
    bumpGroup(byProvider, receipt.provider || receipt.runtime || 'unknown', receipt);
    bumpGroup(byModel, receipt.model || 'unknown', receipt);
  }
  if (totals.cost_available && totals.cost_usd != null) {
    totals.cost_usd = Number(totals.cost_usd.toFixed(6));
  }
  return {
    totals,
    by_machine: sortGroups(byMachine),
    by_harness: sortGroups(byHarness),
    by_provider: sortGroups(byProvider),
    by_model: sortGroups(byModel),
  };
}

function loadStore(storePath) {
  if (!storePath || !existsSync(storePath)) return [];
  const receipts = [];
  for (const record of readJsonlRecords(storePath)) {
    if (!record.ok) continue;
    const validated = validateReceipt(record.value);
    if (validated.ok) receipts.push(validated.receipt);
  }
  return receipts;
}

function writeStoreAtomic(storePath, receipts) {
  if (!storePath) return;
  mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
  const tmp = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  const body = receipts.map((receipt) => JSON.stringify(receipt)).join('\n');
  try {
    writeFileSync(tmp, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, storePath);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* keep prior store */ }
    throw error;
  }
}

export function importLocalUsageReceipts(options = {}) {
  const spec = options.importSpec ?? process.env.MEOW_LOCAL_USAGE_IMPORTS ?? '';
  const storePath = options.storePath ?? process.env.MEOW_LOCAL_USAGE_STORE ?? defaultLocalUsageStorePath();
  const allowWorktree = options.allowWorktree === true
    || process.env.MEOW_LOCAL_USAGE_ALLOW_WORKTREE === '1';
  if (storePath && !allowWorktree) {
    try { assertOutsideWorktree(dirname(storePath)); } catch {
      return {
        receipts: [],
        report: emptyLocalUsageReport({ status: 'error' }),
      };
    }
  }

  const report = emptyLocalUsageReport();
  const parsedRoots = parseImportRoots(spec);
  report.files_skipped += parsedRoots.skipped.length;
  report.import_roots = parsedRoots.roots.length;

  const prior = loadStore(storePath);
  const byId = new Map(prior.map((receipt) => [receiptIdentity(receipt), receipt]));

  if (parsedRoots.roots.length === 0 && byId.size === 0) {
    return { receipts: [], report };
  }

  report.enabled = true;
  report.status = 'ok';

  for (const root of parsedRoots.roots) {
    const listed = listReceiptFiles(root);
    report.files_skipped += listed.escaped;
    report.rejected_reasons.escape += listed.escaped;
    for (const file of listed.files) {
      report.files_scanned += 1;
      let records;
      try {
        records = readJsonlRecords(file);
      } catch {
        report.rejected += 1;
        report.rejected_reasons.malformed += 1;
        continue;
      }
      for (const record of records) {
        if (!record.ok) {
          report.rejected += 1;
          report.rejected_reasons.malformed += 1;
          continue;
        }
        const validated = validateReceipt(record.value, options);
        if (!validated.ok) {
          report.rejected += 1;
          if (report.rejected_reasons[validated.reason] != null) {
            report.rejected_reasons[validated.reason] += 1;
          } else {
            report.rejected_reasons.malformed += 1;
          }
          continue;
        }
        const id = receiptIdentity(validated.receipt);
        if (byId.has(id)) {
          report.duplicates += 1;
          continue;
        }
        byId.set(id, validated.receipt);
        report.accepted += 1;
      }
    }
  }

  const receipts = [...byId.values()];
  try {
    writeStoreAtomic(storePath, receipts);
  } catch {
    // Prior store remains. Newly accepted receipts from this pass are still
    // returned for the current export so a store write failure does not drop
    // already-validated in-memory imports.
  }

  const aggregated = aggregateReceipts(receipts);
  report.totals = aggregated.totals;
  report.by_machine = aggregated.by_machine;
  report.by_harness = aggregated.by_harness;
  report.by_provider = aggregated.by_provider;
  report.by_model = aggregated.by_model;
  if (report.rejected > 0 && receipts.length > 0) report.status = 'partial';
  if (receipts.length === 0 && report.rejected > 0) report.status = 'rejected';
  return { receipts, report };
}

export function localSessionJoinIds(session) {
  if (!session || typeof session !== 'object') return [];
  const ids = [
    session.session_id,
    session.composer_id,
    session.conversation_id,
    session.cloud_agent_id,
  ];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
}

function indexSessionsByJoinId(sessions) {
  const index = new Map();
  for (const session of sessions) {
    for (const id of localSessionJoinIds(session)) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(session);
    }
  }
  return index;
}

function resolveExactSession(sessionId, index) {
  if (!sessionId) return null;
  const matches = index.get(sessionId) || [];
  if (matches.length === 1) return matches[0];
  return null;
}

function sessionHasOfficialUsage(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.usage_source && OFFICIAL_USAGE_SOURCES.has(session.usage_source)) return true;
  if (session.pricing_source === 'cursor-admin-api') return true;
  if (session.source === 'hermes' && session.usage_available === true) return true;
  return false;
}

function applyReceiptsToSession(session, receipts) {
  const bag = {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    reasoning: 0,
  };
  let hasToken = false;
  let cost = null;
  let costAvailable = false;
  const models = new Set();

  for (const receipt of receipts) {
    const tokens = receipt.tokens || emptyTokenBag();
    for (const key of ALLOWED_TOKEN_KEYS) {
      if (tokens[key] != null) {
        bag[key] += tokens[key];
        hasToken = true;
      }
    }
    if (receipt.model) models.add(receipt.model);
    if (receipt.cost_usd != null && Number.isFinite(receipt.cost_usd)) {
      cost = (cost == null ? 0 : cost) + receipt.cost_usd;
      costAvailable = true;
    }
  }

  if (!hasToken && !costAvailable) return false;

  session.input_tokens = bag.input;
  session.output_tokens = bag.output;
  session.cache_creation_tokens = bag.cache_write;
  session.cache_read_tokens = bag.cache_read;
  session.reasoning_tokens = bag.reasoning;
  session.total_tokens = bag.input + bag.output + bag.cache_read + bag.cache_write + bag.reasoning;
  session.usage_available = true;
  session.cost_available = costAvailable;
  session.estimated_cost_usd = costAvailable ? Number(cost.toFixed(6)) : 0;
  session.pricing_source = costAvailable ? 'source-reported' : 'unavailable';
  session.usage_source = 'local-usage-receipt';
  if (models.size === 1) session.model = [...models][0];
  else if (models.size > 1) session.model = null;
  return true;
}

export function applyLocalUsageReceipts(sessions, receipts, report = emptyLocalUsageReport()) {
  const list = Array.isArray(sessions) ? sessions : [];
  const incoming = Array.isArray(receipts) ? receipts : [];
  const index = indexSessionsByJoinId(list);
  const matched = new Map();
  const unmatched = [];

  for (const receipt of incoming) {
    const session = resolveExactSession(receipt?.session_id, index);
    if (!session) {
      unmatched.push(receipt);
      continue;
    }
    if (!matched.has(session)) matched.set(session, []);
    matched.get(session).push(receipt);
  }

  let applied = 0;
  for (const [session, rows] of matched) {
    if (sessionHasOfficialUsage(session)) continue;
    if (applyReceiptsToSession(session, rows)) applied += rows.length;
  }

  const allAgg = aggregateReceipts(incoming);
  const unmatchedAgg = aggregateReceipts(unmatched);
  report.totals = allAgg.totals;
  report.by_machine = allAgg.by_machine;
  report.by_harness = allAgg.by_harness;
  report.by_provider = allAgg.by_provider;
  report.by_model = allAgg.by_model;
  report.matched_sessions = matched.size;
  report.matched_receipts = [...matched.values()].reduce((sum, rows) => sum + rows.length, 0);
  report.applied_receipts = applied;
  report.unmatched_receipts = unmatched.length;
  report.unmatched = unmatchedAgg;
  return { sessions: list, report: toPublicLocalUsageReport(report) };
}

export function toPublicLocalUsageReport(report) {
  const src = report && typeof report === 'object' ? report : emptyLocalUsageReport();
  const publicTotals = sanitizeTotals(src.totals);
  return {
    schema: RECEIPT_SCHEMA,
    schema_version: RECEIPT_SCHEMA_VERSION,
    status: src.status || 'skipped',
    enabled: src.enabled === true,
    limitation: LOCAL_USAGE_LIMITATION,
    supported_harnesses: [...SUPPORTED_HARNESSES],
    unsupported: [...UNSUPPORTED_LOCAL_USAGE_SOURCES],
    import_roots: Number(src.import_roots) || 0,
    files_scanned: Number(src.files_scanned) || 0,
    files_skipped: Number(src.files_skipped) || 0,
    accepted: Number(src.accepted) || 0,
    duplicates: Number(src.duplicates) || 0,
    rejected: Number(src.rejected) || 0,
    rejected_reasons: { ...emptyRejectReasons(), ...(src.rejected_reasons || {}) },
    matched_sessions: Number(src.matched_sessions) || 0,
    matched_receipts: Number(src.matched_receipts) || 0,
    applied_receipts: Number(src.applied_receipts) || 0,
    unmatched_receipts: Number(src.unmatched_receipts) || 0,
    totals: publicTotals,
    by_machine: sanitizeGroups(src.by_machine),
    by_harness: sanitizeGroups(src.by_harness),
    by_provider: sanitizeGroups(src.by_provider),
    by_model: sanitizeGroups(src.by_model),
    unmatched: {
      totals: sanitizeTotals(src.unmatched?.totals),
      by_machine: sanitizeGroups(src.unmatched?.by_machine),
      by_harness: sanitizeGroups(src.unmatched?.by_harness),
      by_provider: sanitizeGroups(src.unmatched?.by_provider),
      by_model: sanitizeGroups(src.unmatched?.by_model),
    },
  };
}

function sanitizeTotals(totals) {
  const next = { ...emptyTotals(), ...(totals || {}) };
  if (!next.cost_available) next.cost_usd = null;
  else if (next.cost_usd != null) next.cost_usd = Number(Number(next.cost_usd).toFixed(6));
  return next;
}

function sanitizeGroups(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    key: String(row?.key || 'unknown'),
    ...sanitizeTotals(row),
  }));
}

export function enrichSessionsWithLocalUsage(sessions, options = {}) {
  const imported = importLocalUsageReceipts(options);
  return applyLocalUsageReceipts(sessions, imported.receipts, imported.report);
}

export function appendReceiptLine(filePath, receipt) {
  const line = serializeReceipt(receipt);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const fd = openSync(filePath, 'a', 0o600);
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return JSON.parse(line);
}
