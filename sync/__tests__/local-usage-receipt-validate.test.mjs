import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_SCHEMA_PINS, SCHEMA_VERSION, canonicalDedupeKey, machineIdPath,
  readOrCreateMachineId, validateReceipt,
} from '../local-usage-receipt.mjs';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MODULE_URL = new URL('../local-usage-receipt.mjs', import.meta.url).href;
const M1 = '550e8400-e29b-41d4-a716-446655440000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tmpHome = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const modeOf = (path) => statSync(path).mode & 0o777;

function event(harness, sourceEventId, extra = {}) {
  return {
    source_event_id: sourceEventId,
    dedupe_key: canonicalDedupeKey(SCHEMA_VERSION, M1, harness, sourceEventId),
    harness, model: 'local-a', runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
    availability: {
      model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
      tokens: 'source', cost: 'source', tool_calls: 'unavailable',
    },
    provenance: {
      source_kind: 'sqlite', source_label: 'hermes.session_model_usage',
      schema_pin: 'hermes-schema-23', recorded_as: 'invocation',
    },
    tokens: { input: { available: true, value: 10, provenance: 'source' } },
    cost_usd: { available: true, value: 0, provenance: 'source' },
    ...extra,
  };
}

const receipt = (events) => ({
  schema_version: SCHEMA_VERSION, kind: 'meow-ops.local-usage-receipt',
  machine_id: M1, exported_at: '2026-08-15T20:00:00.000Z', events,
});
const edit = (base, mutate) => { const copy = structuredClone(base); mutate(copy); return copy; };
const valid = receipt([event('hermes', 'chat-1')]);

test('accepts a valid envelope, audited pins, zero cost, and recomputed keys', () => {
  const row = receipt([
    event('hermes', 'chat-1'),
    event('ollama', 'chat-2', { model: 'ollama/llama3.2' }),
    event('lmstudio', 'chat-3', { model: 'llama3.2:latest' }),
  ]);
  assert.equal(validateReceipt(row).ok, true);
  for (const evt of row.events) {
    assert.equal(evt.dedupe_key, canonicalDedupeKey(SCHEMA_VERSION, M1, evt.harness, evt.source_event_id));
  }
  assert.equal(valid.events[0].cost_usd.value, 0);
  const omitted = edit(valid, (r) => { delete r.events[0].cost_usd; r.events[0].availability.cost = 'unavailable'; });
  assert.equal(validateReceipt(omitted).ok, true);
  assert.equal('cost_usd' in omitted.events[0], false);
  assert.deepEqual(AUDITED_SCHEMA_PINS, {
    'hermes-schema-20': { grain: 'pre-task' },
    'hermes-schema-22': { grain: 'task-key' },
    'hermes-schema-23': { grain: 'task-key' },
  });
  for (const pin of Object.keys(AUDITED_SCHEMA_PINS)) {
    assert.equal(validateReceipt(edit(valid, (r) => { r.events[0].provenance.schema_pin = pin; })).ok, true, pin);
  }
});

const rejects = [
  ['plausible wrong hash', (r) => { r.events[0].dedupe_key = 'a'.repeat(64); }, 'dedupe_key'],
  ['duplicate dedupe keys', (r) => { r.events.push(event('hermes', 'chat-1')); }, 'duplicate_dedupe_key'],
  ['fractional tokens', (r) => { r.events[0].tokens.input.value = 1.5; }, 'malformed'],
  ['negative tokens', (r) => { r.events[0].tokens.input.value = -1; }, 'malformed'],
  ['NaN tokens', (r) => { r.events[0].tokens.input.value = Number.NaN; }, 'malformed'],
  ['infinite tokens', (r) => { r.events[0].tokens.input.value = Number.POSITIVE_INFINITY; }, 'malformed'],
  ['contradictory availability', (r) => { r.events[0].availability.tokens = 'unavailable'; }, 'malformed'],
  ['source_kind receipt', (r) => { r.events[0].provenance.source_kind = 'receipt'; }, 'malformed'],
  ['SQLite missing schema pin', (r) => { delete r.events[0].provenance.schema_pin; }, 'malformed'],
  ['unknown pin', (r) => { r.events[0].provenance.schema_pin = 'unknown-pin-1'; }, 'schema_pin'],
  ['unverified hermes-schema-21', (r) => { r.events[0].provenance.schema_pin = 'hermes-schema-21'; }, 'schema_pin'],
  ['future hermes-schema-24', (r) => { r.events[0].provenance.schema_pin = 'hermes-schema-24'; }, 'schema_pin'],
  ['guessed hermes-schema-020', (r) => { r.events[0].provenance.schema_pin = 'hermes-schema-020'; }, 'schema_pin'],
  ['forbidden content', (r) => { r.events[0].prompt = 'ignored'; }, 'malformed'],
  ['unknown field', (r) => { r.events[0].note = 'extra'; }, 'malformed'],
  ['path value', (r) => { r.events[0].source_event_id = '/Users/alice/evt'; }, 'malformed'],
  ['URL value', (r) => { r.events[0].model = 'https://example.invalid/model'; }, 'malformed'],
  ['traversal value', (r) => { r.events[0].model = 'local/../secret'; }, 'malformed'],
  ['credential-shaped value', (r) => { r.events[0].model = `sk-${'a'.repeat(24)}`; }, 'secret'],
];

for (const [name, mutate, reason] of rejects) {
  test(`rejects ${name}`, () => {
    const result = validateReceipt(edit(valid, mutate));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.receipt, null);
    assert.equal(JSON.stringify(result).includes('sk-aaaaaaaa'), false);
  });
}

test('machine identity is a stable UUID v4 with private modes', () => {
  const home = tmpHome('meow-machine-id-');
  const first = readOrCreateMachineId(home);
  assert.equal(readOrCreateMachineId(home), first);
  assert.match(first, UUID_RE);
  assert.equal(modeOf(dirname(machineIdPath(home))), 0o700);
  assert.equal(modeOf(machineIdPath(home)), 0o600);
});

test('machine identity refuses worktrees, symlinks, and non-regular files', () => {
  const bad = tmpHome('meow-machine-bad-');
  mkdirSync(dirname(machineIdPath(bad)), { recursive: true, mode: 0o700 });
  writeFileSync(machineIdPath(bad), 'not-a-uuid\n', { encoding: 'utf8', mode: 0o600 });
  assert.throws(() => readOrCreateMachineId(bad), /malformed/);
  assert.equal(readFileSync(machineIdPath(bad), 'utf8').trim(), 'not-a-uuid');
  assert.throws(() => readOrCreateMachineId(REPO), /worktree/);
  const gitFileHome = tmpHome('meow-git-file-');
  writeFileSync(join(gitFileHome, '.git'), 'gitdir: /tmp/elsewhere\n');
  assert.throws(() => readOrCreateMachineId(gitFileHome), /worktree/);
  const work = tmpHome('meow-git-dir-');
  mkdirSync(join(work, '.git'));
  const target = join(work, 'inside');
  mkdirSync(target);
  chmodSync(target, 0o755);
  const home = tmpHome('meow-dir-link-');
  symlinkSync(target, join(home, '.meow-ops'));
  assert.throws(() => readOrCreateMachineId(home), /symlink/);
  assert.equal(modeOf(target), 0o755);
  assert.deepEqual(readdirSync(target), []);
  const fileHome = tmpHome('meow-file-link-');
  const other = join(fileHome, 'other');
  mkdirSync(join(fileHome, '.meow-ops'), { recursive: true, mode: 0o700 });
  writeFileSync(other, 'secret\n', { encoding: 'utf8', mode: 0o644 });
  symlinkSync(other, machineIdPath(fileHome));
  assert.throws(() => readOrCreateMachineId(fileHome), /symlink/);
  assert.equal(readFileSync(other, 'utf8'), 'secret\n');
  assert.equal(modeOf(other), 0o644);
  const dirHome = tmpHome('meow-nonreg-');
  mkdirSync(machineIdPath(dirHome), { recursive: true, mode: 0o700 });
  assert.throws(() => readOrCreateMachineId(dirHome), /non-regular/);
});

test('concurrent first creation preserves one stable identity', async () => {
  const home = tmpHome('meow-machine-race-');
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import { readOrCreateMachineId } from ${JSON.stringify(MODULE_URL)};
       process.stdout.write(readOrCreateMachineId(${JSON.stringify(home)}));`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && UUID_RE.test(out)) resolve(out);
      else reject(new Error('concurrent identity child failed'));
    });
  });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a, b);
  assert.equal(readOrCreateMachineId(home), a);
  assert.equal(modeOf(dirname(machineIdPath(home))), 0o700);
  assert.equal(modeOf(machineIdPath(home)), 0o600);
});
