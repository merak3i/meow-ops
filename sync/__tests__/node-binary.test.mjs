import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childFailureCode, resolveRuntimeNode, resolveStableNode } from '../node-binary.mjs';

const cellar = '/opt/homebrew/Cellar/node/22.23.1/bin/node';
const noWhich = () => { throw new Error('no which'); };

test('runtime node falls back to the Homebrew shim after the Cellar binary is removed', () => {
  const exists = (p) => p === '/opt/homebrew/bin/node';
  assert.equal(resolveRuntimeNode({ execPath: cellar, exists, run: noWhich }), '/opt/homebrew/bin/node');
  assert.equal(resolveRuntimeNode({ execPath: cellar, exists: () => true, run: noWhich }), cellar);
});

test('LaunchAgents get a version-independent node path', () => {
  assert.equal(resolveStableNode({ execPath: cellar, exists: () => true, run: noWhich }), '/opt/homebrew/bin/node');
  assert.equal(resolveStableNode({ execPath: '/x/node', exists: (p) => p === '/x/node', run: noWhich }), '/x/node');
});

test('failure codes distinguish spawn errors, signals and exits', () => {
  assert.equal(childFailureCode({ code: null, error: 'ENOENT' }), 'spawn_enoent');
  assert.equal(childFailureCode({ code: null, signal: 'SIGKILL' }), 'signal_sigkill');
  assert.equal(childFailureCode({ code: 3 }), 'exit_3');
  assert.equal(childFailureCode({ timedOut: true, code: null, signal: 'SIGTERM' }), 'timeout');
  assert.equal(childFailureCode({ code: null }), 'spawn_failed');
});
