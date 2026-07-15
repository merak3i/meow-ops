import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  appendRecord, foldLatestById, newId, readLedger,
} from '../loop-ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 7441;
const BASE = `http://127.0.0.1:${PORT}`;
const LOCAL_HEADERS = { Origin: BASE, 'x-meow-ops-local': '1' };

let server;
let ledgerDir;
let sessionsFile;
let projectDir;
let soulDir;
let previousLoopDir;
let pendingProposal;
let draftProposal;
let reviewOnlyProposal;
let unsimulatedPendingProposal;
let usedNonce;

function validRun() {
  return {
    run_id: newId('run'),
    loop_id: 'api-test-loop',
    captured_at: '2026-07-06T00:00:00.000Z',
    sources: ['test'],
    session_ids: ['demo-session'],
    metrics: {
      sessions: 1,
      duration_seconds: 10,
      total_tokens: 100,
      message_count: 2,
    },
  };
}

function baseProposal(overrides = {}) {
  return {
    proposal_id: newId('prop'),
    loop_id: 'api-test-loop',
    created_at: '2026-07-06T00:00:00.000Z',
    created_by: 'assistant:risk',
    category: 'workflow',
    title: 'API test proposal',
    one_percent_target: 'Exercise the local decision API',
    diff: { target_path: 'sync/__tests__/local-api-loop-eng.test.mjs' },
    rationale: 'synthetic API test fixture',
    evidence: [{ kind: 'rule', ref: 'api-test' }],
    confidence: 0.8,
    risk: 'low',
    risk_notes: 'synthetic only',
    expected_benefit: 'proves the owner decision path',
    rollback: { plan: 'remove the synthetic fixture' },
    review_only: false,
    status: 'draft',
    ...overrides,
  };
}

function seedPendingProposal(overrides = {}) {
  const draft = appendRecord('proposal', baseProposal(overrides));
  const simulated = appendRecord('proposal', {
    ...draft,
    created_by: 'system:propose',
    status: 'simulated',
  });
  return appendRecord('proposal', {
    ...simulated,
    created_by: 'system:propose',
    status: 'pending_approval',
  });
}

function seedUnsimulatedPendingProposal(overrides = {}) {
  const draft = appendRecord('proposal', baseProposal(overrides));
  const simulated = appendRecord('proposal', {
    ...draft,
    created_by: 'owner',
    status: 'simulated',
  });
  return appendRecord('proposal', {
    ...simulated,
    created_by: 'owner',
    status: 'pending_approval',
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/loop-eng/summary`, { headers: LOCAL_HEADERS });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('local-api loop-eng test server did not start');
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: LOCAL_HEADERS });
  return { status: res.status, body: await res.json() };
}

async function postDecision(payload) {
  const res = await fetch(`${BASE}/loop-eng/decisions`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function postAsk(question) {
  const res = await fetch(`${BASE}/loop-eng/ask`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return { status: res.status, body: await res.json() };
}

async function postProjectClaim(payload) {
  const res = await fetch(`${BASE}/project-intelligence/claims`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, nonce: await nonce() }),
  });
  return { status: res.status, body: await res.json() };
}

async function postProjectConfirm(claim_id) {
  const res = await fetch(`${BASE}/project-intelligence/confirm`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim_id, nonce: await nonce() }),
  });
  return { status: res.status, body: await res.json() };
}

async function postSoul(profile) {
  const res = await fetch(`${BASE}/companion/soul`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, nonce: await nonce() }),
  });
  return { status: res.status, body: await res.json() };
}

async function resetSoul() {
  const res = await fetch(`${BASE}/companion/soul/reset`, {
    method: 'POST',
    headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: await nonce() }),
  });
  return { status: res.status, body: await res.json() };
}

async function nonce() {
  const res = await getJson('/loop-eng/nonce');
  assert.equal(res.status, 200);
  assert.ok(res.body.nonce);
  return res.body.nonce;
}

before(async () => {
  ledgerDir = mkdtempSync(join(tmpdir(), 'meow-loop-api-ledger-'));
  sessionsFile = join(ledgerDir, 'sessions.json');
  projectDir = join(ledgerDir, 'project-intelligence');
  soulDir = join(ledgerDir, 'companion-soul');
  writeFileSync(sessionsFile, JSON.stringify([
    { project: 'BergLabs', duration_seconds: 7200, started_at: new Date().toISOString(), source: 'codex' },
    { project: 'Patherle', duration_seconds: 1800, started_at: new Date().toISOString(), source: 'claude' },
  ]));
  previousLoopDir = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = ledgerDir;

  const run = appendRecord('run', validRun());
  appendRecord('comparison', {
    comparison_id: newId('cmp'),
    run_id: run.run_id,
    baseline_run_id: run.run_id,
    loop_id: run.loop_id,
    computed_at: '2026-07-06T00:01:00.000Z',
    deltas: { duration_seconds: { before: 10, after: 10, delta_pct: 0 } },
    flags: [],
  });
  pendingProposal = seedPendingProposal();
  draftProposal = appendRecord('proposal', baseProposal({ title: 'Still a draft' }));
  unsimulatedPendingProposal = seedUnsimulatedPendingProposal({ title: 'Owner advanced without simulation' });
  reviewOnlyProposal = seedPendingProposal({
    category: 'policy',
    title: 'Review-only policy proposal',
    diff: { target_path: 'sync/com.meowops.localapi.plist' },
    review_only: true,
  });

  server = spawn('node', [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEOW_LOCAL_API_PORT: String(PORT),
      MEOW_LOOP_DIR: ledgerDir,
      MEOW_SESSIONS_FILE: sessionsFile,
      MEOW_PROJECT_INTELLIGENCE_DIR: projectDir,
      MEOW_COMPANION_SOUL_DIR: soulDir,
    },
    stdio: 'pipe',
  });
  await waitForServer();
});

after(() => {
  server?.kill();
  if (previousLoopDir === undefined) delete process.env.MEOW_LOOP_DIR;
  else process.env.MEOW_LOOP_DIR = previousLoopDir;
  rmSync(ledgerDir, { recursive: true, force: true });
});

test('GET /loop-eng endpoints return ledger-backed JSON shapes', async () => {
  const runs = await getJson('/loop-eng/runs');
  assert.equal(runs.status, 200);
  assert.equal(runs.body.length, 1);

  const comparisons = await getJson('/loop-eng/comparisons');
  assert.equal(comparisons.status, 200);
  assert.equal(comparisons.body.length, 1);

  const proposals = await getJson('/loop-eng/proposals');
  assert.equal(proposals.status, 200);
  assert.ok(proposals.body.find((proposal) => proposal.proposal_id === pendingProposal.proposal_id));

  const decisions = await getJson('/loop-eng/decisions');
  assert.equal(decisions.status, 200);
  assert.deepEqual(decisions.body, []);

  const simulations = await getJson('/loop-eng/simulations');
  assert.equal(simulations.status, 200);
  assert.deepEqual(simulations.body, []);

  const outcomes = await getJson('/loop-eng/outcomes');
  assert.equal(outcomes.status, 200);
  assert.deepEqual(outcomes.body, []);

  const summary = await getJson('/loop-eng/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.counts_by_status.pending_approval, 3);
  assert.equal(summary.body.counts_by_status.draft, 1);
  assert.equal(summary.body.open_per_loop['api-test-loop'], 4);
});

test('POST /loop-eng/ask answers project time from the session artifact', async () => {
  const res = await postAsk('what project did I spend the most time on today?');
  assert.equal(res.status, 200);
  assert.equal(res.body.gate, 'known_known');
  assert.match(res.body.answer, /BergLabs/);
  assert.match(res.body.answer, /2h/);
  assert.equal(res.body.evidence[0].kind, 'session_aggregate');
});

test('owner can teach one project fact and Companion answers from it', async () => {
  const taught = await postProjectClaim({
    project_name: 'BergLabs',
    field: 'vision',
    value: 'Build an agentic operations company with measurable customer outcomes.',
  });
  assert.equal(taught.status, 201);
  assert.equal(taught.body.claim.status, 'owner_confirmed');

  const answer = await postAsk('what is the vision for BergLabs?');
  assert.equal(answer.status, 200);
  assert.equal(answer.body.gate, 'known_known');
  assert.match(answer.body.answer, /agentic operations company/);
  assert.equal(answer.body.claim_id, taught.body.claim.claim_id);

  const confirmed = await postProjectConfirm(taught.body.claim.claim_id);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.claim.status, 'owner_confirmed');
});

test('owner can personalize Companion while evidence permissions remain authoritative', async () => {
  const initial = await getJson('/companion/soul');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.profile.preset, 'clear-operator');
  assert.equal(initial.body.presets.length, 4);

  const saved = await postSoul({
    ...initial.body.profile,
    name: 'Maven',
    preset: 'critical-partner',
    custom_instructions: 'Challenge scope creep and identify the smallest decisive move.',
    uncertainty_policy: 'strict',
    memory: { session_metrics: false, project_facts: true, inferred_claims: false },
    model_synthesis: false,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.revision, 1);
  assert.equal(saved.body.profile.name, 'Maven');

  const answer = await postAsk('what project did I spend the most time on today?');
  assert.equal(answer.body.gate, 'known_unknown');
  assert.match(answer.body.answer, /do not have tracked project time/i);
  assert.equal(answer.body.soul.name, 'Maven');

  const reset = await resetSoul();
  assert.equal(reset.status, 200);
  assert.equal(reset.body.profile.name, 'Companion');
  assert.equal(reset.body.profile.revision, 2);
});

test('GET /loop-eng/summary reports system-expired drafts outside rejected counts', async () => {
  const draft = appendRecord('proposal', baseProposal({
    proposal_id: newId('prop'),
    title: 'Expired system draft',
    created_at: '2026-06-01T00:00:00.000Z',
  }));
  appendRecord('decision', {
    decision_id: newId('dec'),
    proposal_id: draft.proposal_id,
    decided_at: '2026-07-06T00:00:00.000Z',
    decision: 'rejected',
    decided_by: 'system:expire',
    created_by: 'system:expire',
    reason: 'expired stale draft',
  });
  appendRecord('proposal', {
    ...draft,
    created_by: 'system:expire',
    status: 'rejected',
  });

  const summary = await getJson('/loop-eng/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.counts_by_status.expired, 1);
  assert.equal(summary.body.counts_by_status.rejected || 0, 0);
});

test('POST /loop-eng/decisions approves a pending proposal with a fresh nonce', async () => {
  usedNonce = await nonce();
  const res = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'approved',
    reason: 'synthetic happy path',
    nonce: usedNonce,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision.decision, 'approved');
  assert.equal(res.body.proposal.status, 'approved');

  const decisions = readLedger('decision');
  assert.ok(decisions.find((decision) => (
    decision.proposal_id === pendingProposal.proposal_id && decision.decision === 'approved'
  )));
  const latest = foldLatestById(readLedger('proposal'), 'proposal_id')
    .find((proposal) => proposal.proposal_id === pendingProposal.proposal_id);
  assert.equal(latest.status, 'approved');
});

test('POST /loop-eng/decisions can undo an approval then re-approve with a fresh nonce', async () => {
  const firstDecision = readLedger('decision')
    .find((decision) => decision.proposal_id === pendingProposal.proposal_id);
  assert.equal(firstDecision.decision, 'approved');

  const undo = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'undone',
    undo_of: firstDecision.decision_id,
    reason: 'synthetic undo path',
    nonce: await nonce(),
  });
  assert.equal(undo.status, 200);
  assert.equal(undo.body.ok, true);
  assert.equal(undo.body.decision.decision, 'undone');
  assert.equal(undo.body.decision.undo_of, firstDecision.decision_id);
  assert.equal(undo.body.proposal.status, 'pending_approval');

  const reopened = foldLatestById(readLedger('proposal'), 'proposal_id')
    .find((proposal) => proposal.proposal_id === pendingProposal.proposal_id);
  assert.equal(reopened.status, 'pending_approval');

  const reapprove = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'approved',
    reason: 'synthetic re-approval path',
    nonce: await nonce(),
  });
  assert.equal(reapprove.status, 200);
  assert.equal(reapprove.body.ok, true);
  assert.equal(reapprove.body.decision.decision, 'approved');
  assert.equal(reapprove.body.proposal.status, 'approved');
});

test('POST /loop-eng/decisions rejects unknown undo_of', async () => {
  const res = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'undone',
    undo_of: 'dec_missing',
    reason: 'unknown undo target',
    nonce: await nonce(),
  });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /\[undo_of\]/);
});

test('POST /loop-eng/decisions rejects non-latest undo_of', async () => {
  const firstDecision = readLedger('decision')
    .find((decision) => decision.proposal_id === pendingProposal.proposal_id && decision.decision === 'approved');
  const res = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'undone',
    undo_of: firstDecision.decision_id,
    reason: 'stale undo target',
    nonce: await nonce(),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /\[undo_of\]/);
});

test('POST /loop-eng/decisions rejects undo when status is not approved or rejected', async () => {
  const deferred = await postDecision({
    proposal_id: reviewOnlyProposal.proposal_id,
    decision: 'deferred',
    reason: 'leave review-only proposal pending',
    nonce: await nonce(),
  });
  assert.equal(deferred.status, 200);
  assert.equal(deferred.body.decision.decision, 'deferred');
  assert.equal(deferred.body.proposal.status, 'pending_approval');

  const undo = await postDecision({
    proposal_id: reviewOnlyProposal.proposal_id,
    decision: 'undone',
    undo_of: deferred.body.decision.decision_id,
    reason: 'status is still pending',
    nonce: await nonce(),
  });
  assert.equal(undo.status, 409);
  assert.match(undo.body.error, /\[status-flow\]/);
});

test('POST /loop-eng/decisions rejects undo_of with decision other than undone', async () => {
  const latestDecision = readLedger('decision')
    .filter((decision) => decision.proposal_id === pendingProposal.proposal_id)
    .at(-1);
  const res = await postDecision({
    proposal_id: pendingProposal.proposal_id,
    decision: 'approved',
    undo_of: latestDecision.decision_id,
    reason: 'wrong decision enum for undo',
    nonce: await nonce(),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /\[decision\]/);
});

test('POST /loop-eng/decisions rejects a bad nonce', async () => {
  const res = await postDecision({
    proposal_id: reviewOnlyProposal.proposal_id,
    decision: 'rejected',
    reason: 'bad nonce case',
    nonce: 'not-a-real-nonce',
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /\[nonce\]/);
});

test('POST /loop-eng/decisions rejects a reused nonce', async () => {
  const res = await postDecision({
    proposal_id: reviewOnlyProposal.proposal_id,
    decision: 'rejected',
    reason: 'reused nonce case',
    nonce: usedNonce,
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /\[nonce\]/);
});

test('POST /loop-eng/decisions rejects a non-pending proposal', async () => {
  const res = await postDecision({
    proposal_id: draftProposal.proposal_id,
    decision: 'approved',
    reason: 'draft cannot be decided',
    nonce: await nonce(),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /\[status-flow\]/);
});

test('POST /loop-eng/decisions rejects approval on review_only proposals', async () => {
  const res = await postDecision({
    proposal_id: reviewOnlyProposal.proposal_id,
    decision: 'approved',
    reason: 'review only cannot approve',
    nonce: await nonce(),
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /\[review_only\]/);
});

test('POST /loop-eng/decisions rejects approval without simulation unless system:propose advanced it', async () => {
  const res = await postDecision({
    proposal_id: unsimulatedPendingProposal.proposal_id,
    decision: 'approved',
    reason: 'missing simulation',
    nonce: await nonce(),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /\[simulation\]/);
});

test('browser-origin loop-eng calls require the local helper header', async () => {
  const res = await fetch(`${BASE}/loop-eng/summary`, { headers: { Origin: BASE } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Missing local access header/);
});
