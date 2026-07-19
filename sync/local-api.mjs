#!/usr/bin/env node
// sync/local-api.mjs — local sync API server
//
// Lets the dashboard (local dev or the Vercel-hosted page) trigger local
// work and read fresh local data. The browser calls http://127.0.0.1:7337
// — which runs on YOUR machine, not on Vercel — so it can read
// ~/.claude/projects/, ~/.codex/sessions/, and other local-only exports.
//
// All endpoints are local-only. Loop Engineering writes still pass through
// ledger validation, and execution can push only behind its explicit gate.
//
// Usage:
//   node sync/local-api.mjs
//   MEOW_LOCAL_API_PORT=7437 node sync/local-api.mjs
//   MEOW_SYNC_PORT=7437 node sync/local-api.mjs   # legacy alias

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

import {
  appendRecord, assertRedacted, foldLatestById, newId, readLedger,
} from './loop-ledger.mjs';
import { runDigest } from './loop-digest.mjs';
import { ask, FALLBACK_ANSWER } from './ask-engine.mjs';
import { askLlm } from './llm-gateway.mjs';
import { loadEnv } from './load-env.mjs';
import { buildProjectSnapshot } from './project-intelligence.mjs';
import { appendProjectClaim, confirmProjectClaim, readProjectClaims } from './project-ledger.mjs';
import {
  appendLearningCandidate, applyProjectAdapters, buildProjectControlSnapshot,
  decideLearningCandidate, previewProjectAdapters, readLearningCandidates,
  publishLearningCandidate, readProjectCatalog, rollbackProjectAdapters,
} from './project-control.mjs';
import { queryAgentEvidence } from './project-evidence.mjs';
import {
  appendLearningEvent, buildLearningQuestSnapshot, deleteLearningTopic, upsertLearningTopic,
} from './learning-quest.mjs';
import {
  applySoulPolicy, compileSoulInstructions, readSoulProfile, resetSoulProfile,
  resolveSoulProfile, saveSoulProfile, SOUL_PRESETS,
} from './companion-soul.mjs';
import {
  appendCompanionFeedback, applyPreferenceProposal, readPreferenceState,
  recordPreferenceDecision,
} from './companion-preferences.mjs';
import { getSyncRun, getSyncStatus, startSyncRun } from './sync-runner.mjs';
import { readLedgerLoopRuns } from './loop-ledger-to-runs.mjs';
import { querySessionHistory } from './session-history.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) loadEnv(ROOT);
const PORT = Number(process.env.MEOW_LOCAL_API_PORT || process.env.MEOW_SYNC_PORT || 7337);
const LOCAL_ACCESS_HEADER = 'x-meow-ops-local';
const LOOP_OPS_DIR = join(ROOT, 'public', 'data', 'loop-ops');
const SUPERADMIN_USAGE_FILE = join(ROOT, 'public', 'data', 'superadmin-usage.json');
const SESSIONS_FILE = process.env.MEOW_SESSIONS_FILE || join(ROOT, 'public', 'data', 'sessions.json');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://meow-ops.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];
const EXTRA_ALLOWED_ORIGINS = (process.env.MEOW_DASHBOARD_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);
const PRIVATE_PROJECT_ORIGINS = new Set(DEFAULT_ALLOWED_ORIGINS.filter((origin) => origin.startsWith('http://')));
const NONCES = [];
const NONCE_SET = new Set();

// launchd and background processes don't always inherit a useful PATH.
// Prefer the exact Node binary running this file, then stable install locations.
function resolveNode() {
  const candidates = [
    process.execPath,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  try {
    return execFileSync('/usr/bin/env', ['which', 'node'], { encoding: 'utf8' }).trim();
  } catch {}
  return 'node';
}
const NODE = resolveNode();

// DNS-rebinding defense: a rebound attacker domain resolves to 127.0.0.1 but
// still sends its own Host header. Only accept localhost Host values.
function hostIsLocal(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/[[\]]/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true };
  if (!ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, statusCode: 403, error: 'Forbidden origin' };
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${LOCAL_ACCESS_HEADER}`);
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  return { ok: true };
}

function requireBrowserHeader(req, res) {
  if (!req.headers.origin) return true;
  if (req.headers[LOCAL_ACCESS_HEADER] === '1') return true;
  res.statusCode = 400;
  res.end(JSON.stringify({ ok: false, error: 'Missing local access header' }));
  return false;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function readJsonArray(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function buildAskContext({ proposals, decisions, runs, digest, sync, sessionHistory }) {
  const rows = (value) => (Array.isArray(value) ? value : []);
  const text = (value, fallback = 'none') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const date = (value) => Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString().slice(0, 10) : 'unknown date';
  const proposalRows = rows(proposals);
  const titleById = new Map(proposalRows.map((proposal) => [proposal.proposal_id, text(proposal.title, 'Untitled proposal')]));
  const pending = proposalRows.filter((proposal) => proposal.status === 'pending_approval');
  const recent = [...rows(decisions)].sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))).slice(0, 5);
  const sum = (key) => rows(runs).reduce((total, run) => total + (Number(run.metrics?.[key]) || 0), 0);
  const health = digest?.health || {};
  const flagged = rows(health.agents).filter((agent) => rows(agent.flags).length > 0).slice(0, 5);
  const archiveTotal = Number(sessionHistory?.archive?.total) || 0;
  const previewTotal = Number(sync?.artifact?.sessions) || 0;
  return [
    `Pending proposals (${pending.length}): ${pending.slice(0, 5).map((proposal) => text(proposal.title, 'Untitled proposal')).join(', ') || 'none'}`,
    `Recent decisions: ${recent.map((decision) => `${date(decision.decided_at)} ${text(decision.decision, 'unknown')} ${titleById.get(decision.proposal_id) || 'Untitled proposal'}`).join('; ') || 'none'}`,
    `Total cost: $${sum('cost_usd_real').toFixed(2)} real / $${sum('cost_usd_notional').toFixed(2)} notional`,
    `Agent health: ${Number(health.agents_total) || 0} total, ${Number(health.flagged) || 0} flagged (${flagged.map((agent) => `${text(agent.label, 'unknown agent')}: ${rows(agent.flags).map(String).join(', ')}`).join('; ') || 'none'})`,
    `Session sync: ${text(sync?.state, 'unknown')} at ${text(sync?.phase, 'no active phase')}; complete archive ${archiveTotal || 'unknown'} sessions; browser preview ${previewTotal} sessions; issue: ${text(sync?.failure?.summary || sync?.warning?.summary, 'none')}`,
  ].join('\n');
}

function ruleError(res, statusCode, rule, message) {
  sendJson(res, statusCode, { ok: false, error: `[${rule}] ${message}` });
}

function createNonce() {
  const nonce = randomBytes(18).toString('hex');
  NONCES.push(nonce);
  NONCE_SET.add(nonce);
  while (NONCES.length > 10) {
    const old = NONCES.shift();
    NONCE_SET.delete(old);
  }
  return nonce;
}

function consumeNonce(nonce) {
  if (!nonce || !NONCE_SET.has(nonce)) return false;
  NONCE_SET.delete(nonce);
  const index = NONCES.indexOf(nonce);
  if (index >= 0) NONCES.splice(index, 1);
  return true;
}

function readJsonBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error('[body-too-large] request body exceeds limit'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('[json] invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function proposalSummary() {
  const proposals = foldLatestById(readLedger('proposal'), 'proposal_id');
  const expiredIds = new Set(readLedger('decision')
    .filter((decision) => decision.created_by === 'system:expire' || decision.decided_by === 'system:expire')
    .map((decision) => decision.proposal_id));
  const counts_by_status = {};
  const open_per_loop = {};
  for (const proposal of proposals) {
    const status = expiredIds.has(proposal.proposal_id) ? 'expired' : proposal.status;
    counts_by_status[status] = (counts_by_status[status] || 0) + 1;
    if (!['approved', 'rejected'].includes(proposal.status)) {
      open_per_loop[proposal.loop_id] = (open_per_loop[proposal.loop_id] || 0) + 1;
    }
  }
  return { counts_by_status, open_per_loop, total: proposals.length };
}

function simulationExemptProposal(proposal, proposalRecords = readLedger('proposal')) {
  if (proposal.simulation_id) return true;
  return proposalRecords.some((record) => (
    record.proposal_id === proposal.proposal_id
    && record.created_by === 'system:propose'
    && ['simulated', 'pending_approval'].includes(record.status)
  ));
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!hostIsLocal(req)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ ok: false, error: 'forbidden host' }));
    return;
  }

  const cors = applyCors(req, res);
  if (!cors.ok) {
    res.statusCode = cors.statusCode;
    res.end(JSON.stringify({ ok: false, error: cors.error }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  const path = requestUrl.pathname;
  const exposesPrivateProjectData = path === '/projects'
    || path.startsWith('/projects/')
    || path.startsWith('/project-intelligence/');
  if (exposesPrivateProjectData && req.headers.origin && !PRIVATE_PROJECT_ORIGINS.has(req.headers.origin)) {
    sendJson(res, 403, { ok: false, error: 'Private project data requires the local dashboard.' });
    return;
  }
  const needsBrowserHeader =
    path.startsWith('/sync')
    || path === '/data/sessions.json'
    || path === '/data/cost-summary.json'
    || path.startsWith('/session-history/')
    || path.startsWith('/loop-eng/')
    || path === '/projects'
    || path.startsWith('/projects/')
    || path.startsWith('/project-intelligence/')
    || path.startsWith('/learning-quest/')
    || path.startsWith('/companion/');

  if (needsBrowserHeader && !requireBrowserHeader(req, res)) return;

  // ── GET /sync/status ──────────────────────────────────────────────────────
  if (path === '/sync/status' && req.method === 'GET') {
    sendJson(res, 200, getSyncStatus({ repoRoot: ROOT }));
    return;
  }

  if (path.startsWith('/sync/runs/') && req.method === 'GET') {
    const run = getSyncRun(path.slice('/sync/runs/'.length));
    sendJson(res, run ? 200 : 404, run || { ok: false, error: 'Sync run not found' });
    return;
  }

  // ── GET /data/sessions.json or /data/cost-summary.json ────────────────────
  // Serve local files directly so the browser gets instant fresh data.
  if (req.method === 'GET' && (path === '/data/sessions.json' || path === '/data/cost-summary.json')) {
    const filename = path === '/data/sessions.json' ? 'sessions.json' : 'cost-summary.json';
    const filePath = join(ROOT, 'public', 'data', filename);
    try {
      const data = readFileSync(filePath, 'utf8');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'File not found - run a sync first' }));
    }
    return;
  }

  // ── GET /session-history/sessions ────────────────────────────────────────
  // Filter the complete local archive before slicing a bounded browser page.
  if (req.method === 'GET' && path === '/session-history/sessions') {
    try {
      const result = querySessionHistory({
        limit: requestUrl.searchParams.get('limit'),
        cursor: requestUrl.searchParams.get('cursor'),
        from: requestUrl.searchParams.get('from'),
        to: requestUrl.searchParams.get('to'),
        project: requestUrl.searchParams.get('project'),
        source: requestUrl.searchParams.get('source'),
        model: requestUrl.searchParams.get('model'),
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // ── POST /sync ────────────────────────────────────────────────────────────
  if (path === '/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] Sync triggered from browser`);
    const started = startSyncRun({
      repoRoot: ROOT,
      node: NODE,
      trigger: 'dashboard',
      env: { ...process.env },
    });
    sendJson(res, started.accepted ? 202 : 409, {
      ok: started.accepted,
      accepted: started.accepted,
      busy: started.busy,
      run_id: started.run_id,
      status: started.snapshot,
    });
    return;
  }

  // ── Loop Engineering API — local ledger read/write with owner decisions ──
  // Every write still goes through appendRecord(), and browser-origin calls
  // require the local helper header above.

  if (path === '/loop-eng/runs' && req.method === 'GET') {
    sendJson(res, 200, readLedger('run'));
    return;
  }

  if (path === '/loop-eng/comparisons' && req.method === 'GET') {
    sendJson(res, 200, readLedger('comparison'));
    return;
  }

  if (path === '/loop-eng/proposals' && req.method === 'GET') {
    sendJson(res, 200, foldLatestById(readLedger('proposal'), 'proposal_id'));
    return;
  }

  if (path === '/loop-eng/decisions' && req.method === 'GET') {
    sendJson(res, 200, readLedger('decision'));
    return;
  }

  if (path === '/loop-eng/simulations' && req.method === 'GET') {
    sendJson(res, 200, readLedger('simulation'));
    return;
  }

  if (path === '/loop-eng/outcomes' && req.method === 'GET') {
    sendJson(res, 200, readLedger('outcome'));
    return;
  }

  if (path === '/loop-eng/summary' && req.method === 'GET') {
    sendJson(res, 200, proposalSummary());
    return;
  }

  if (path === '/loop-eng/digest' && req.method === 'GET') {
    try {
      const data = readFileSync(join(ROOT, 'public', 'data', 'loop-engineering', 'digest.json'), 'utf8');
      sendJson(res, 200, JSON.parse(data));
    } catch {
      sendJson(res, 404, { ok: false, error: 'No digest available' });
    }
    return;
  }

  if (path === '/loop-eng/digest' && req.method === 'POST') {
    try {
      const digest = await runDigest();
      sendJson(res, 200, { ok: true, digest });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/loop-eng/digest/history' && req.method === 'GET') {
    try {
      const lines = readFileSync(join(ROOT, 'public', 'data', 'loop-engineering', 'digest-history.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
      sendJson(res, 200, lines.slice(-30).reverse());
    } catch {
      sendJson(res, 200, []);
    }
    return;
  }

  // Project Control Plane. The private catalog maps stable project IDs to
  // roots; responses never discover or accept an arbitrary filesystem path.
  if (path === '/projects' && req.method === 'GET') {
    const sessions = readJsonArray(SESSIONS_FILE);
    const claims = readProjectClaims();
    const projects = readProjectCatalog().map((project) => buildProjectControlSnapshot({
      project_id: project.project_id, sessions, claims,
    }));
    sendJson(res, 200, { ok: true, projects });
    return;
  }

  const projectRoute = path.match(/^\/projects\/([^/]+)\/(control-snapshot|learning-state|evidence|learnings|adapters\/(?:preview|apply|rollback))$/);
  const learningDecisionRoute = path.match(/^\/projects\/([^/]+)\/learnings\/([^/]+)\/decision$/);
  const catalogProject = (id) => readProjectCatalog().find((project) => project.project_id === decodeURIComponent(id));

  // Learning Quest exposes only an allowlisted conceptual projection. Stored
  // topics, project links, event records, paths, and proof metadata stay local.
  if (path === '/learning-quest/snapshot' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, ...buildLearningQuestSnapshot() });
    return;
  }

  if (path === '/learning-quest/topics' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req, 32_000); }
    catch (err) { ruleError(res, 400, 'json', err.message); return; }
    if (!consumeNonce(body.nonce)) { ruleError(res, 403, 'nonce', 'invalid or already used nonce'); return; }
    try {
      upsertLearningTopic({ ...body, approved_for_projection: body.approved_for_projection === true });
      sendJson(res, 200, { ok: true, ...buildLearningQuestSnapshot() });
    } catch (err) { ruleError(res, 400, 'learning-quest', err instanceof Error ? err.message : String(err)); }
    return;
  }

  if (path === '/learning-quest/topics/delete' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req, 8_000); }
    catch (err) { ruleError(res, 400, 'json', err.message); return; }
    if (!consumeNonce(body.nonce)) { ruleError(res, 403, 'nonce', 'invalid or already used nonce'); return; }
    try {
      deleteLearningTopic(body.topic_id);
      sendJson(res, 200, { ok: true, ...buildLearningQuestSnapshot() });
    } catch (err) { ruleError(res, 400, 'learning-quest', err instanceof Error ? err.message : String(err)); }
    return;
  }

  if (path === '/learning-quest/events' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req, 16_000); }
    catch (err) { ruleError(res, 400, 'json', err.message); return; }
    if (!consumeNonce(body.nonce)) { ruleError(res, 403, 'nonce', 'invalid or already used nonce'); return; }
    try {
      appendLearningEvent(body);
      sendJson(res, 200, { ok: true, ...buildLearningQuestSnapshot() });
    } catch (err) { ruleError(res, 400, 'learning-quest', err instanceof Error ? err.message : String(err)); }
    return;
  }

  if (projectRoute) {
    const project = catalogProject(projectRoute[1]);
    if (!project) {
      ruleError(res, 404, 'project-control', 'project not found');
      return;
    }
    const action = projectRoute[2];
    if (action === 'control-snapshot' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        ...buildProjectControlSnapshot({
          project_id: project.project_id,
          sessions: readJsonArray(SESSIONS_FILE),
          claims: readProjectClaims(),
        }),
      });
      return;
    }
    if (action === 'learning-state' && req.method === 'GET') {
      const files = {};
      for (const name of ['INDEX.md', 'constitution.md', 'current-state.md', 'manifest.json']) {
        try { files[name] = readFileSync(join(project.learning_state_path, name), 'utf8'); }
        catch { files[name] = null; }
      }
      sendJson(res, 200, { ok: true, project, files });
      return;
    }
    if (action === 'evidence' && req.method === 'GET') {
      const normalized = queryAgentEvidence({
        project_id: project.project_id,
        limit: requestUrl.searchParams.get('limit') || 100,
        from: requestUrl.searchParams.get('from'),
        to: requestUrl.searchParams.get('to'),
        source: requestUrl.searchParams.get('source'),
        event_type: requestUrl.searchParams.get('event_type'),
        search: requestUrl.searchParams.get('search'),
      });
      if (normalized.total > 0) {
        sendJson(res, 200, { ok: true, project_id: project.project_id, evidence_kind: 'agent_event', ...normalized });
        return;
      }
      const fallback = querySessionHistory({
        limit: requestUrl.searchParams.get('limit') || 100,
        cursor: requestUrl.searchParams.get('cursor'),
        from: requestUrl.searchParams.get('from'),
        to: requestUrl.searchParams.get('to'),
        project: project.name,
        source: requestUrl.searchParams.get('source'),
        model: requestUrl.searchParams.get('model'),
      });
      sendJson(res, 200, { ok: true, project_id: project.project_id, evidence_kind: 'session_summary', ...fallback });
      return;
    }
    if (action === 'learnings' && req.method === 'POST') {
      let body;
      try { body = await readJsonBody(req, 64_000); }
      catch (err) { ruleError(res, 400, 'json', err.message); return; }
      if (!consumeNonce(body.nonce)) {
        ruleError(res, 403, 'nonce', 'invalid or already used nonce');
        return;
      }
      try {
        const learning = appendLearningCandidate({ ...body, project_id: project.project_id });
        sendJson(res, 201, { ok: true, learning });
      } catch (err) {
        ruleError(res, 400, 'project-control', err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (action === 'adapters/preview' && req.method === 'POST') {
      sendJson(res, 200, { ok: true, preview: previewProjectAdapters({ projectRoot: project.root }) });
      return;
    }
    if ((action === 'adapters/apply' || action === 'adapters/rollback') && req.method === 'POST') {
      let body;
      try { body = await readJsonBody(req, 64_000); }
      catch (err) { ruleError(res, 400, 'json', err.message); return; }
      if (!consumeNonce(body.nonce)) {
        ruleError(res, 403, 'nonce', 'invalid or already used nonce');
        return;
      }
      try {
        const result = action === 'adapters/apply'
          ? applyProjectAdapters({
            projectRoot: project.root,
            expectedChecksums: body.expected_checksums,
          })
          : rollbackProjectAdapters(body.sync_id);
        sendJson(res, 200, { ok: true, result });
      } catch (err) {
        ruleError(res, 400, 'project-control', err instanceof Error ? err.message : String(err));
      }
      return;
    }
  }

  if (learningDecisionRoute && req.method === 'POST') {
    const project = catalogProject(learningDecisionRoute[1]);
    if (!project) { ruleError(res, 404, 'project-control', 'project not found'); return; }
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { ruleError(res, 400, 'json', err.message); return; }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      const learningId = decodeURIComponent(learningDecisionRoute[2]);
      const candidate = readLearningCandidates().find((item) => item.learning_id === learningId);
      if (!candidate || candidate.project_id !== project.project_id) {
        ruleError(res, 404, 'project-control', 'learning not found for project');
        return;
      }
      const decided = decideLearningCandidate(learningId, {
        decision: body.decision, reason: body.reason, decided_by: 'owner',
      });
      const learning = decided.status === 'approved'
        ? publishLearningCandidate(learningId)
        : decided;
      sendJson(res, 200, { ok: true, learning });
    } catch (err) {
      ruleError(res, 400, 'project-control', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/project-intelligence/snapshot' && req.method === 'GET') {
    const snapshot = buildProjectSnapshot({
      sessions: readJsonArray(SESSIONS_FILE),
      claims: readProjectClaims(),
    });
    sendJson(res, 200, {
      ok: true,
      projects: snapshot.projects,
      claim_count: snapshot.claims.length,
      session_count: snapshot.sessions.length,
    });
    return;
  }

  if (path === '/project-intelligence/claims' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      const claim = appendProjectClaim({
        project_name: body.project_name,
        project_id: body.project_id,
        field: body.field,
        value: body.value,
        status: 'owner_confirmed',
        source: 'owner',
        supersedes: body.supersedes,
      });
      sendJson(res, 201, { ok: true, claim });
    } catch (err) {
      ruleError(res, 400, 'project-claim', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/project-intelligence/confirm' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      const claim = confirmProjectClaim(body.claim_id);
      sendJson(res, 200, { ok: true, claim });
    } catch (err) {
      ruleError(res, 400, 'project-claim', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/companion/soul' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, profile: readSoulProfile(), presets: SOUL_PRESETS });
    return;
  }

  if (path === '/companion/soul' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req, 512_000);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      sendJson(res, 200, { ok: true, profile: saveSoulProfile(body.profile) });
    } catch (err) {
      ruleError(res, 400, 'companion-soul', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/companion/soul/reset' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      sendJson(res, 200, { ok: true, profile: resetSoulProfile() });
    } catch (err) {
      ruleError(res, 400, 'companion-soul', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/companion/preferences' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, ...readPreferenceState(readSoulProfile()) });
    return;
  }

  if (path === '/companion/feedback' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      const feedback = appendCompanionFeedback(body);
      sendJson(res, 201, {
        ok: true,
        feedback,
        preferences: readPreferenceState(readSoulProfile()),
      });
    } catch (err) {
      ruleError(res, 400, 'companion-feedback', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/companion/preferences/decision' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    try {
      const current = readSoulProfile();
      const proposal = readPreferenceState(current).proposals
        .find((candidate) => candidate.proposal_id === body.proposal_id);
      if (!proposal) {
        ruleError(res, 404, 'companion-preference', 'preference proposal not found');
        return;
      }
      if (!['applied', 'dismissed'].includes(body.decision)) {
        ruleError(res, 400, 'companion-preference', 'decision must be applied or dismissed');
        return;
      }
      const profile = body.decision === 'applied'
        ? saveSoulProfile(applyPreferenceProposal(current, proposal))
        : current;
      const decision = recordPreferenceDecision({
        proposal_id: proposal.proposal_id,
        decision: body.decision,
        soul_revision: profile.revision,
      });
      sendJson(res, 200, {
        ok: true,
        decision,
        profile,
        preferences: readPreferenceState(profile),
      });
    } catch (err) {
      ruleError(res, 400, 'companion-preference', err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (path === '/loop-eng/ask' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question || question.length > 500) {
        sendJson(res, 400, { ok: false, error: 'question must be a non-empty string <= 500 chars' });
        return;
      }
      let digest = null;
      try {
        const data = readFileSync(join(ROOT, 'public', 'data', 'loop-engineering', 'digest.json'), 'utf8');
        digest = JSON.parse(data);
      } catch {}
      const storedSoul = readSoulProfile();
      const rawData = {
        proposals: readLedger('proposal'),
        decisions: readLedger('decision'),
        runs: readLedger('run'),
        sessions: readJsonArray(SESSIONS_FILE),
        claims: readProjectClaims(),
        digest,
        sync: getSyncStatus({ repoRoot: ROOT }),
        sessionHistory: querySessionHistory({ limit: 1 }),
      };
      rawData.projectControls = readProjectCatalog().map((project) => buildProjectControlSnapshot({
        project_id: project.project_id,
        sessions: rawData.sessions,
        claims: rawData.claims,
      }));
      const soul = resolveSoulProfile(
        storedSoul,
        question,
        buildProjectSnapshot({ sessions: rawData.sessions, claims: rawData.claims }).projects,
      );
      const soulPolicy = applySoulPolicy(soul, rawData);
      const data = soulPolicy.context;
      const result = ask(question, data);
      let finalAnswer = result.answer;
      let source = 'keyword';
      if (result.answer === FALLBACK_ANSWER && process.env.DEEPSEEK_API_KEY && soulPolicy.allow_model_synthesis) {
        const llm = await askLlm({
          question,
          context: buildAskContext(data),
          instructions: compileSoulInstructions(soul),
          env: process.env,
          now: new Date(),
        });
        if (llm.status === 'ok') {
          finalAnswer = `Unverified model synthesis: ${assertRedacted(llm.answer, 'llm-answer')}`;
          source = 'llm';
        }
      }
      sendJson(res, 200, {
        ok: true,
        ...result,
        answer: finalAnswer,
        source,
        gate: result.gate || 'known_known',
        confidence: result.confidence ?? 1,
        evidence: result.evidence || [{
          kind: 'local_reasoning',
          ref: 'loop-eng/ask',
          detail: 'Deterministic local ledger, digest, or sync evidence',
        }],
        unknowns: result.unknowns || [],
        soul: {
          name: soul.name,
          preset: soul.preset,
          revision: soul.revision,
          uncertainty_policy: soul.uncertainty_policy,
          project_overlay: soul.active_project_overlay ? {
            project_id: soul.active_project_overlay.project_id,
            project_name: soul.active_project_overlay.project_name,
          } : null,
        },
        suggestions: ['What has this project learned?', 'Which agents know this project?', 'What should become a skill?', 'What should I fix next?'],
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (path === '/loop-eng/nonce' && req.method === 'GET') {
    sendJson(res, 200, { nonce: createNonce() });
    return;
  }

  if (path === '/loop-eng/decisions' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }

    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }

    const proposalRecords = readLedger('proposal');
    const proposals = foldLatestById(proposalRecords, 'proposal_id');
    const proposal = proposals.find((p) => p.proposal_id === body.proposal_id);
    if (!proposal) {
      ruleError(res, 404, 'proposal', 'proposal not found');
      return;
    }

    if (body.undo_of) {
      if (body.decision !== 'undone') {
        ruleError(res, 400, 'decision', 'undo_of requires decision "undone"');
        return;
      }

      const decisions = readLedger('decision');
      const referenced = decisions.find((decision) => decision.decision_id === body.undo_of);
      if (!referenced || referenced.proposal_id !== proposal.proposal_id) {
        ruleError(res, 404, 'undo_of', 'referenced decision not found for proposal');
        return;
      }
      const latest = decisions
        .filter((decision) => decision.proposal_id === proposal.proposal_id)
        .at(-1);
      if (!latest || latest.decision_id !== referenced.decision_id) {
        ruleError(res, 409, 'undo_of', 'referenced decision is not the latest decision for proposal');
        return;
      }
      if (referenced.decision === 'undone') {
        ruleError(res, 409, 'undo_of', 'undone decisions cannot be undone again');
        return;
      }
      if (!['approved', 'rejected'].includes(proposal.status)) {
        ruleError(res, 409, 'status-flow', 'proposal must be approved or rejected before undo');
        return;
      }

      const decision = appendRecord('decision', {
        decision_id: newId('dec'),
        proposal_id: proposal.proposal_id,
        decided_at: new Date().toISOString(),
        decision: 'undone',
        decided_by: 'owner',
        reason: String(body.reason || 'undo'),
        undo_of: referenced.decision_id,
      });
      const nextProposal = appendRecord('proposal', {
        ...proposal,
        created_by: 'owner',
        status: 'pending_approval',
      });
      sendJson(res, 200, { ok: true, decision, proposal: nextProposal });
      return;
    }

    if (!['approved', 'rejected', 'deferred'].includes(body.decision)) {
      ruleError(res, 400, 'decision', 'decision must be approved, rejected, deferred, or undone with undo_of');
      return;
    }

    if (proposal.status !== 'pending_approval') {
      ruleError(res, 409, 'status-flow', 'proposal must be pending_approval before a decision');
      return;
    }
    if (proposal.review_only === true && body.decision === 'approved') {
      ruleError(res, 403, 'review_only', 'review-only proposals cannot be approved through the local API');
      return;
    }
    if (body.decision === 'approved' && !simulationExemptProposal(proposal, proposalRecords)) {
      ruleError(res, 409, 'simulation', 'proposal must pass simulation before approval');
      return;
    }

    const decision = appendRecord('decision', {
      decision_id: newId('dec'),
      proposal_id: proposal.proposal_id,
      decided_at: new Date().toISOString(),
      decision: body.decision,
      decided_by: 'owner',
      reason: String(body.reason || 'owner decision'),
    });
    let nextProposal = proposal;
    if (body.decision === 'approved' || body.decision === 'rejected') {
      nextProposal = appendRecord('proposal', {
        ...proposal,
        created_by: 'owner',
        status: body.decision,
      });
    }
    sendJson(res, 200, { ok: true, decision, proposal: nextProposal });
    return;
  }

  if (path === '/loop-eng/execute' && req.method === 'POST') {
    if (process.env.MEOW_EXECUTOR_ENABLED !== '1') {
      ruleError(res, 404, 'executor-disabled', 'executor is not enabled');
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      ruleError(res, 400, 'json', err.message.replace(/^\[json\]\s*/, ''));
      return;
    }
    if (!consumeNonce(body.nonce)) {
      ruleError(res, 403, 'nonce', 'invalid or already used nonce');
      return;
    }
    const mode = body.mode === 'push' ? 'push' : 'dry-run';
    const child = spawn(NODE, [join(ROOT, 'sync', 'loop-execute.mjs'), '--proposal', body.proposal_id, '--mode', mode], {
      cwd: ROOT,
      env: { ...process.env, MEOW_EXECUTOR_ENABLED: '1' },
      stdio: 'pipe',
    });
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill(), 600_000);
    child.on('close', () => clearTimeout(timer)); child.on('error', () => clearTimeout(timer));
    sendJson(res, 202, { ok: true, status: 'started', proposal_id: body.proposal_id, mode });
    return;
  }

  // ── Loop-Ops endpoints (spec §Phase 4) — read/local-only ─────────────────
  // GET /loop-ops/spec, /loop-ops/runs, and /loop-ops/gates serve local JSON;
  // POST /loop-ops/sync re-runs the workbook importer. No push path exists
  // here by construction — the importer never touches git.

  if (req.method === 'GET' && ['/loop-ops/spec', '/loop-ops/runs', '/loop-ops/gates'].includes(path)) {
    const file = path === '/loop-ops/spec' ? 'spec.json' : path === '/loop-ops/runs' ? 'runs.json' : 'gates.json';
    try {
      res.end(readFileSync(join(LOOP_OPS_DIR, file), 'utf8'));
    } catch {
      if (path === '/loop-ops/runs') {
        res.end(JSON.stringify(readLedgerLoopRuns()));
      } else if (path === '/loop-ops/gates') {
        res.end('[]');
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'spec.json not found - POST /loop-ops/sync to import a Loop Ops workbook' }));
      }
    }
    return;
  }

  if (path === '/loop-ops/status' && req.method === 'GET') {
    const files = {};
    for (const name of ['spec.json', 'gates.json', 'runs.json']) {
      try {
        const st = statSync(join(LOOP_OPS_DIR, name));
        files[name] = { mtime: st.mtimeMs, size: st.size };
      } catch {
        files[name] = null;
      }
    }
    let entityCount = null;
    try {
      entityCount = JSON.parse(readFileSync(join(LOOP_OPS_DIR, 'spec.json'), 'utf8')).meta?.entityCount ?? null;
    } catch {}
    res.end(JSON.stringify({ ok: files['spec.json'] !== null, files, entityCount, productionWritesEnabled: false }));
    return;
  }

  if (path === '/loop-ops/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] Loop-Ops import triggered from browser`);
    const child = spawn(NODE, [join(ROOT, 'sync', 'loop-ops-import.mjs')], {
      cwd: ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; process.stdout.write(c); });
    child.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => child.kill(), 90_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let mtime = null;
      try { mtime = statSync(join(LOOP_OPS_DIR, 'spec.json')).mtimeMs; } catch {}
      res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // ── SuperAdmin Capacity & Usage endpoints — read/local-only ──────────────
  // GET /superadmin-usage/data serves the sanitized local snapshot. POST
  // /superadmin-usage/sync refreshes it from local operator-owned sources.
  // No endpoint accepts provider credentials and no endpoint writes git.

  if (path === '/superadmin-usage/data' && req.method === 'GET') {
    try {
      res.end(readFileSync(SUPERADMIN_USAGE_FILE, 'utf8'));
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'superadmin-usage.json not found — POST /superadmin-usage/sync first' }));
    }
    return;
  }

  if (path === '/superadmin-usage/status' && req.method === 'GET') {
    try {
      const st = statSync(SUPERADMIN_USAGE_FILE);
      res.end(JSON.stringify({ ok: true, mtime: st.mtimeMs, size: st.size, productionWritesEnabled: false }));
    } catch {
      res.end(JSON.stringify({ ok: false, productionWritesEnabled: false }));
    }
    return;
  }

  if (path === '/superadmin-usage/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] SuperAdmin usage refresh triggered from browser`);
    const child = spawn(NODE, [join(ROOT, 'sync', 'superadmin-usage.mjs')], {
      cwd: ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; process.stdout.write(c); });
    child.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => child.kill(), 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let mtime = null;
      try { mtime = statSync(SUPERADMIN_USAGE_FILE).mtimeMs; } catch {}
      res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Meow Ops local sync API');
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log('  POST /sync                    - start an observable background sync');
  console.log('  GET  /sync/status             - current phase, artifact, and last result');
  console.log('  GET  /sync/runs/:id           - persisted sanitized run metadata');
  console.log('  GET  /data/sessions.json      - exported session metrics');
  console.log('  GET  /data/cost-summary.json  - exported spend summary');
  console.log('  GET  /session-history/sessions - filtered, paginated session archive');
  console.log('  GET  /loop-ops/spec           - Loop-Ops entities (local import)');
  console.log('  GET  /loop-ops/status         - Loop-Ops file freshness');
  console.log('  GET  /loop-ops/runs           - recorded loop runs');
  console.log('  GET  /loop-ops/gates          - local verification gates');
  console.log('  POST /loop-ops/sync           - re-import the Loop Ops workbook');
  console.log('  GET  /loop-eng/proposals      - Loop Engineering proposals');
  console.log('  GET  /loop-eng/simulations    - Loop Engineering simulations');
  console.log('  GET  /loop-eng/outcomes       - Loop Engineering outcomes');
  console.log('  GET  /loop-eng/summary        - Loop Engineering queue summary');
  console.log('  GET  /loop-eng/digest         - last Loop Engineering digest');
  console.log('  POST /loop-eng/digest         - run Loop Engineering digest');
  console.log('  GET  /loop-eng/digest/history - Loop Engineering digest history');
  console.log('  POST /loop-eng/ask            - keyword query + budgeted AI fallback');
  console.log('  GET  /project-intelligence/snapshot - project facts and evidence coverage');
  console.log('  GET  /learning-quest/snapshot     - privacy-safe learning projection');
  console.log('  POST /learning-quest/topics       - owner-nonce topic create/update');
  console.log('  POST /learning-quest/events       - owner-nonce learning evidence');
  console.log('  POST /project-intelligence/claims   - owner-confirm one project fact');
  console.log('  POST /project-intelligence/confirm  - promote one inferred fact');
  console.log('  GET  /companion/soul                   - current private soul profile');
  console.log('  POST /companion/soul                   - save a versioned soul profile');
  console.log('  POST /companion/soul/reset             - append the default soul profile');
  console.log('  POST /loop-eng/decisions      - owner decision with nonce');
  console.log('  POST /loop-eng/execute        - dry-run/push executor with nonce');
  console.log('  GET  /superadmin-usage/data   - sanitized local usage snapshot');
  console.log('  GET  /superadmin-usage/status - usage snapshot freshness');
  console.log('  POST /superadmin-usage/sync   - refresh local usage snapshot');
  console.log(`\n  Allowed browser origins: ${Array.from(ALLOWED_ORIGINS).join(', ')}\n`);
});
