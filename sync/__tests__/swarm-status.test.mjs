// Today · Swarm reader. Builds an AutoSwarm home on disk with the exact files
// AutoSwarm writes (config.json, calls/<id>/task|handle|result|cancel.json,
// approvals/<id>/request|decision|resolution.json) and checks what the page
// may claim from them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  autoswarmHome, canonicalProvider, readSwarmOverlay, readSwarmSnapshot, swarmOverlayPath, PROVIDERS,
} from '../swarm-status.mjs';

const NOW = Date.parse('2026-11-03T06:00:00.000Z');
const TOKEN = `AUTOSWARM_CHECK_${'a'.repeat(32)}`;
const LIVE_PID = 4242;
let root;
let swarm;
let home;

const json = (path, value) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function call(id, task, { result, handle, cancel, approvals = [] } = {}) {
  const dir = join(swarm, 'calls', id);
  json(join(dir, 'task.json'), { call_id: id, workspace: '/Users/someone/Repos/demo-app', return_mode: 'native', ...task });
  if (handle) json(join(dir, 'handle.json'), handle);
  if (result) json(join(dir, 'result.json'), result);
  if (cancel) json(join(dir, 'cancel.json'), { call_id: id });
  for (const approval of approvals) {
    const path = join(dir, 'approvals', approval.id);
    json(join(path, 'request.json'), approval.request);
    if (approval.decision) json(join(path, 'decision.json'), approval.decision);
    if (approval.resolution) json(join(path, 'resolution.json'), approval.resolution);
  }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'meow-swarm-'));
  swarm = join(root, 'autoswarm');
  home = join(root, 'home');
  mkdirSync(home, { recursive: true });

  // Codex resolves through an absolute override that really is executable.
  const bin = join(root, 'bin', 'codex');
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);
  json(join(swarm, 'config.json'), { providers: { codex: { command: [bin] } }, approvals: { delegate_to_parent: false } });

  // Claude Code: a full doctor probe pair, same native session, token echoed.
  call('call_01', { provider: 'claude-code', prompt: `Remember the exact phrase ${TOKEN}. Reply with only that phrase. Do not call tools or modify files.`, created_at: '2026-11-03T05:00:00.000Z' },
    { result: { outcome: 'completed', content: TOKEN, native_session_id: 'sess-claude', finished_at: '2026-11-03T05:00:09.000Z' } });
  call('call_02', { provider: 'claude-code', prompt: 'What exact phrase did I ask you to remember? Reply with only that phrase. Do not call tools.', previous_call: 'call_01', created_at: '2026-11-03T05:00:10.000Z' },
    { result: { outcome: 'completed', content: TOKEN, native_session_id: 'sess-claude', finished_at: '2026-11-03T05:00:15.000Z' } });

  // Cursor: replied once, then native resume failed.
  call('call_03', { provider: 'cursor-agent', prompt: `Remember the exact phrase ${TOKEN}. Reply with only that phrase.`, created_at: '2026-11-03T05:10:00.000Z' },
    { result: { outcome: 'completed', content: TOKEN, native_session_id: 'sess-cursor', finished_at: '2026-11-03T05:10:05.000Z' } });
  call('call_04', { provider: 'cursor', prompt: 'What exact phrase did I ask you to remember? Reply with only that phrase.', previous_call: 'call_03', created_at: '2026-11-03T05:10:06.000Z' },
    { result: { outcome: 'failed', error: 'session not found', error_code: 'resume_failed', content: '', finished_at: '2026-11-03T05:10:07.000Z' } });

  // Hermes: a live call waiting on one permission; the prompt carries a key.
  call('call_05', { provider: 'hermes', prompt: 'Deploy the preview. OPENAI_API_KEY=sk-live-abcdefghijklmnopqrstuvwx then report back', created_at: '2026-11-03T05:50:00.000Z', model: 'hermes-4', effort: 'high' },
    {
      handle: { pid: LIVE_PID, phase: 'running' },
      approvals: [
        { id: `approval_${'b'.repeat(32)}`, request: { kind: 'approval_required', created_at: '2026-11-03T05:51:00.000Z', native_request: { toolCall: { title: 'Run npm run deploy' } } } },
        { id: `approval_${'c'.repeat(32)}`, request: { kind: 'approval_required', created_at: '2026-11-03T05:50:30.000Z' }, decision: { decision: 'allow' }, resolution: { state: 'replied' } },
      ],
    });

  // DeepSeek Harness: the runner died without a receipt.
  call('call_06', { provider: 'deepseek-harness', prompt: 'Fill the staging form', created_at: '2026-11-01T05:00:00.000Z' }, { handle: { pid: 999999, phase: 'running' } });

  // An older Codex task whose output must never leave the reader.
  call('call_07', { provider: 'codex', prompt: 'Summarise the diff', created_at: '2026-10-20T05:00:00.000Z' },
    { result: { outcome: 'completed', content: 'PRIVATE_OUTPUT_TEXT', native_session_id: 'sess-codex', finished_at: '2026-10-20T05:01:00.000Z' } });

  json(join(home, '.meow-ops', 'swarm.json'), {
    owner: { name: 'Ops lead', title: 'approval gate' },
    workspace: '~/Repos/demo-app',
    providers: {
      claude: { name: 'Builder', role: 'Ships the code', cat: 'builder' },
      'cursor-agent': { cat: 'not-a-cat', note: 'x'.repeat(400) },
      unknown: { name: 'ignored' },
      opencode: { hidden: true },
    },
    extras: [
      { id: 'vm-agents', name: 'VM agents', role: 'Sovereign runs', cat: 'ghost', where: 'Local VM', source: 'antigravity' },
      { id: 'codex', name: 'collides with a provider' },
      { id: '../bad', name: 'unsafe id' },
    ],
  });
});

after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const snapshot = (extra = {}) => readSwarmSnapshot({
  env: { PATH: '' }, homeDir: home, platform: 'darwin', now: NOW, autoswarmHome: swarm,
  isAlive: (pid) => pid === LIVE_PID, ...extra,
});
const provider = (snap, id) => snap.providers.find((item) => item.id === id);

test('home resolution follows AutoSwarm: env first, then the platform state folder', () => {
  assert.equal(autoswarmHome({ env: { AUTOSWARM_HOME: '~/x' }, home: '/h', platform: 'darwin' }), '/h/x');
  assert.equal(autoswarmHome({ env: {}, home: '/h', platform: 'darwin' }), '/h/Library/Application Support/autoswarm');
  assert.equal(autoswarmHome({ env: { XDG_STATE_HOME: '/s' }, home: '/h', platform: 'linux' }), '/s/autoswarm');
  assert.equal(autoswarmHome({ env: {}, home: '/h', platform: 'linux' }), '/h/.local/state/autoswarm');
  assert.equal(swarmOverlayPath({ env: {}, home: '/h' }), '/h/.meow-ops/swarm.json');
  assert.equal(canonicalProvider('deepseek-harness'), 'dsh');
  assert.equal(canonicalProvider('claude'), 'claude-code');
  assert.equal(canonicalProvider('nope'), null);
  assert.equal(PROVIDERS.length, 12);
});

test('a missing AutoSwarm home reports nothing invented', () => {
  const snap = snapshot({ autoswarmHome: join(root, 'absent') });
  assert.equal(snap.autoswarm.exists, false);
  assert.equal(snap.calls.length, 0);
  assert.equal(snap.totals.verified, 0);
  assert.ok(snap.providers.every((item) => item.state === 'off' && item.evidence.reply === 'none'));
});

test('a doctor probe pair with one native session is verified, nothing less is', () => {
  const snap = snapshot();
  const claude = provider(snap, 'claude-code');
  assert.equal(claude.evidence.probe.status, 'verified');
  assert.equal(claude.evidence.reply, 'verified');
  assert.equal(claude.evidence.resume, 'verified');
  assert.equal(claude.state, 'verified');

  const cursor = provider(snap, 'cursor');
  assert.equal(cursor.evidence.probe.status, 'resume-failed');
  assert.equal(cursor.evidence.reply, 'observed');
  assert.equal(cursor.evidence.resume, 'failed');
  assert.equal(cursor.evidence.probe.errorCode, 'resume_failed');
  assert.equal(cursor.state, 'failing');
  assert.equal(snap.totals.verified, 1);
});

test('live calls, pending approvals and dead runners keep their own states', () => {
  const snap = snapshot();
  const hermes = provider(snap, 'hermes');
  assert.equal(hermes.state, 'waiting');
  assert.equal(hermes.pendingApprovals, 1);
  assert.equal(hermes.evidence.approvalRelay, 'verified');
  assert.equal(snap.approvals.length, 1);
  assert.equal(snap.approvals[0].title, 'Run npm run deploy');
  assert.equal(snap.totals.waiting, 1);
  assert.equal(snap.totals.running, 1);

  const dsh = provider(snap, 'dsh');
  assert.equal(snap.calls.find((item) => item.id === 'call_06').status, 'interrupted');
  assert.equal(dsh.state, 'failing');

  assert.equal(provider(snap, 'nanobot').evidence.approvalRelay, 'unsupported');
  assert.equal(provider(snap, 'dsh').evidence.approvalRelay, 'none');
  assert.equal(snap.autoswarm.delegateApprovals.value, false);
  assert.equal(snap.autoswarm.delegateApprovals.source, 'config');
});

test('configured absolute commands resolve without running them', () => {
  const codex = provider(snapshot(), 'codex');
  assert.equal(codex.command.executable, 'found');
  assert.equal(codex.command.overridden, true);
  assert.equal(codex.state, 'replied');
  assert.equal(provider(snapshot(), 'grok').state, 'off');
});

test('prompts leave as redacted snippets, probes and outputs never leave', () => {
  const snap = snapshot();
  const text = JSON.stringify(snap);
  assert.equal(text.includes('PRIVATE_OUTPUT_TEXT'), false);
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('sk-live-abcdefghijklmnopqrstuvwx'), false);
  const hermesCall = snap.calls.find((item) => item.id === 'call_05');
  assert.match(hermesCall.snippet, /OPENAI_API_KEY=\[redacted\]/);
  assert.equal(hermesCall.workspaceName, 'demo-app');
  assert.equal(snap.calls.find((item) => item.id === 'call_01').snippet, null);
  assert.equal(snapshot({ snippets: false }).calls.find((item) => item.id === 'call_05').snippet, null);
  assert.equal(snapshot({ env: { PATH: '', MEOW_NO_SNIPPETS: '1' } }).calls.every((item) => item.snippet === null), true);
});

test('the personal roster renames and recasts, and cannot inject anything else', () => {
  const snap = snapshot();
  assert.deepEqual(snap.owner, { name: 'Ops lead', title: 'approval gate' });
  assert.equal(snap.workspace, '~/Repos/demo-app');
  assert.equal(snap.workspaceSource, 'swarm.json');
  const claude = provider(snap, 'claude-code');
  assert.equal(claude.name, 'Builder');
  assert.equal(claude.role, 'Ships the code');
  const cursor = provider(snap, 'cursor');
  assert.equal(cursor.cat, 'commander');
  assert.equal(cursor.note.length, 220);
  assert.equal(provider(snap, 'opencode').hidden, true);
  assert.deepEqual(snap.extras.map((item) => item.id), ['vm-agents']);
  assert.equal(snap.extras[0].meowSource, 'antigravity');
});

test('a broken roster is reported, not fatal', () => {
  const path = join(root, 'broken.json');
  writeFileSync(path, '{ not json');
  const overlay = readSwarmOverlay(path);
  assert.equal(overlay.loaded, false);
  assert.match(overlay.error, /not valid JSON/);
  const snap = snapshot({ overlayPath: path });
  assert.equal(snap.overlay.error, overlay.error);
  assert.equal(snap.owner, null);
  assert.equal(snap.workspace, '/Users/someone/Repos/demo-app');
  assert.equal(snap.workspaceSource, 'latest-call');
});

test('scanning is bounded and says so', () => {
  const snap = snapshot({ maxCalls: 3 });
  assert.equal(snap.coverage.callDirectories, 7);
  assert.equal(snap.coverage.scanned, 3);
  assert.equal(snap.coverage.truncated, true);
});
