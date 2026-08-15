import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../docs/local-usage-receipt-v1.schema.json'),
  'utf8',
));

function dedupeKey(schemaVersion, machineId, harness, sourceEventId) {
  return createHash('sha256')
    .update(JSON.stringify([schemaVersion, machineId, harness, sourceEventId]), 'utf8')
    .digest('hex');
}

function importerAcceptsDedupe(envelope) {
  if (!envelope || !Array.isArray(envelope.events)) return false;
  return envelope.events.every((evt) => (
    typeof evt.dedupe_key === 'string'
    && evt.dedupe_key === dedupeKey(
      envelope.schema_version,
      envelope.machine_id,
      evt.harness,
      evt.source_event_id,
    )
  ));
}

function deref(root, ref) {
  const path = ref.replace(/^#\//, '').split('/');
  return path.reduce((node, key) => node[key], root);
}

function typeOk(type, data) {
  if (type === 'null') return data === null;
  if (type === 'object') return data !== null && typeof data === 'object' && !Array.isArray(data);
  if (type === 'array') return Array.isArray(data);
  if (type === 'integer') return Number.isInteger(data) && Number.isFinite(data);
  if (type === 'number') return typeof data === 'number' && Number.isFinite(data);
  if (type === 'boolean') return typeof data === 'boolean';
  if (type === 'string') return typeof data === 'string';
  return false;
}

function check(node, data, root) {
  if (node.$ref) return check(deref(root, node.$ref), data, root);
  if (node.allOf && node.allOf.some((part) => !check(part, data, root))) return false;
  if (node.anyOf && !node.anyOf.some((part) => check(part, data, root))) return false;
  if (node.oneOf && node.oneOf.filter((part) => check(part, data, root)).length !== 1) return false;
  if (node.not && check(node.not, data, root)) return false;
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => typeOk(type, data))) return false;
  }
  if ('const' in node && data !== node.const) return false;
  if (node.enum && !node.enum.includes(data)) return false;
  if (typeof data === 'string') {
    if (node.minLength != null && data.length < node.minLength) return false;
    if (node.maxLength != null && data.length > node.maxLength) return false;
    if (node.pattern && !new RegExp(node.pattern, 'u').test(data)) return false;
  }
  if (typeof data === 'number') {
    if (node.minimum != null && data < node.minimum) return false;
    if (node.maximum != null && data > node.maximum) return false;
  }
  if (Array.isArray(data)) {
    if (node.minItems != null && data.length < node.minItems) return false;
    if (node.maxItems != null && data.length > node.maxItems) return false;
    if (node.uniqueItems && new Set(data.map((item) => JSON.stringify(item))).size !== data.length) return false;
    if (node.items && data.some((item) => !check(node.items, item, root))) return false;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (node.required && node.required.some((key) => !(key in data))) return false;
    if (node.additionalProperties === false && node.properties
      && Object.keys(data).some((key) => !(key in node.properties))) return false;
    if (node.properties) {
      for (const [key, value] of Object.entries(data)) {
        if (node.properties[key] && !check(node.properties[key], value, root)) return false;
      }
    }
  }
  if (node.if) {
    const matched = check(node.if, data, root);
    if (matched && node.then && !check(node.then, data, root)) return false;
    if (!matched && node.else && !check(node.else, data, root)) return false;
  }
  return true;
}

function valid(data) {
  return check(schema, data, schema);
}

const V = 'local-usage-receipt.v1';
const M1 = '550e8400-e29b-41d4-a716-446655440000';
const M2 = '6ba7b810-9dad-41d4-a716-446655440000';

const sourceQuantities = {
  tokens: {
    input: { available: true, value: 1, provenance: 'source' },
  },
  cost_usd: { available: true, value: 0, provenance: 'source' },
  tool_calls: { available: true, count: 0 },
};

function event(machineId, harness, sourceEventId, extra = {}) {
  return {
    source_event_id: sourceEventId,
    dedupe_key: dedupeKey(V, machineId, harness, sourceEventId),
    harness,
    model: 'local-a',
    availability: {
      model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
      tokens: 'source', cost: 'source', tool_calls: 'count',
    },
    provenance: {
      source_kind: 'sqlite', source_label: 'hermes.session_model_usage',
      schema_pin: 'hermes-schema-23', recorded_as: 'invocation',
    },
    ...extra,
  };
}

function receipt(machineId, events) {
  return {
    schema_version: V, kind: 'meow-ops.local-usage-receipt',
    machine_id: machineId, exported_at: '2026-08-15T20:00:00.000Z', events,
  };
}

const hermesExact = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-main', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  started_at: '2026-08-15T19:00:00.000Z', ended_at: '2026-08-15T19:05:00.000Z',
  tokens: {
    input: { available: true, value: 100, provenance: 'source' },
    output: { available: true, value: 20, provenance: 'source' },
    cache_read: { available: true, value: 4, provenance: 'source' },
    cache_write: { available: true, value: 2, provenance: 'source' },
    reasoning: { available: true, value: 0, provenance: 'source' },
    total: { available: true, value: 126, provenance: 'source' },
  },
  cost_usd: { available: true, value: 0.02, provenance: 'source' },
  tool_calls: { available: true, count: 3, names: ['Bash', 'Read'] },
})]);

const zeroCost = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-zero', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  tokens: {
    input: { available: true, value: 10, provenance: 'source' },
    output: { available: true, value: 2, provenance: 'source' },
  },
  cost_usd: { available: true, value: 0, provenance: 'source' },
  availability: {
    model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
    tokens: 'source', cost: 'source', tool_calls: 'unavailable',
  },
  tool_calls: { available: false },
})]);

const unavailable = receipt(M1, [event(M1, 'hermes', 'sess2-local-a-none', {
  session_id: 'sess2',
  tokens: {
    input: { available: false },
    output: { available: false },
    total: { available: false },
  },
  cost_usd: { available: false },
  tool_calls: { available: false },
  availability: {
    model: 'exact', runtime: 'unavailable', provider: 'unavailable', session: 'exact',
    tokens: 'unavailable', cost: 'unavailable', tool_calls: 'unavailable',
  },
})]);

const omittedUnavailable = receipt(M1, [event(M1, 'hermes', 'sess3-local-a-omit', {
  session_id: 'sess3',
  availability: {
    model: 'exact', runtime: 'unavailable', provider: 'unavailable', session: 'exact',
    tokens: 'unavailable', cost: 'unavailable', tool_calls: 'unavailable',
  },
})]);

const partialTokens = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-partial', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  tokens: {
    input: { available: true, value: 8, provenance: 'source' },
    output: { available: false },
  },
  cost_usd: { available: false },
  tool_calls: { available: false },
  availability: {
    model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
    tokens: 'partial', cost: 'unavailable', tool_calls: 'unavailable',
  },
})]);

const namesOnly = receipt(M1, [event(M1, 'hermes', 'sess1-local-a-names', {
  runtime: 'ollama', provider: 'ollama', session_id: 'sess1',
  ...sourceQuantities,
  tool_calls: { available: true, names: ['Bash'] },
  availability: {
    model: 'exact', runtime: 'exact', provider: 'exact', session: 'exact',
    tokens: 'source', cost: 'source', tool_calls: 'names',
  },
})]);

const multiModel = receipt(M1, [
  event(M1, 'hermes', 'sess1-local-a', {
    session_id: 'sess1', model: 'local-a', runtime: 'ollama', provider: 'ollama',
    ...sourceQuantities,
  }),
  event(M1, 'hermes', 'sess1-cloud-b', {
    session_id: 'sess1', model: 'cloud-b', runtime: 'openrouter', provider: 'openrouter',
    ...sourceQuantities,
  }),
]);

test('schema encodes fail-closed quantity, pin, and identifier rules', () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.definitions.event.additionalProperties, false);
  assert.equal(schema.definitions.tokenQuantity.properties.value.type, 'integer');
  assert.equal(schema.definitions.moneyQuantity.properties.value.type, 'number');
  assert.equal(schema.definitions.safeId.pattern, '^[a-z0-9][a-z0-9._-]{0,63}$');
  assert.deepEqual(schema.definitions.event.properties.provenance.then.required, ['schema_pin']);
  assert.deepEqual(schema.definitions.event.properties.provenance.properties.source_kind.enum, [
    'sqlite', 'jsonl', 'json', 'markdown', 'api-response',
  ]);
  assert.equal(schema.definitions.event.properties.provenance.properties.source_kind.enum.includes('receipt'), false);
  assert.deepEqual(schema.definitions.tokenAvailability.enum, ['source', 'partial', 'unavailable']);
  assert.deepEqual(schema.definitions.costAvailability.enum, ['source', 'unavailable']);
  assert.deepEqual(schema.definitions.toolCallAvailability.enum, ['count', 'names', 'unavailable']);
  assert.ok(schema.definitions.event.allOf.length >= 13);
});

test('pass: Hermes exact model with tokens and source cost', () => {
  assert.equal(valid(hermesExact), true);
});

test('pass: local model with explicit zero cost', () => {
  assert.equal(valid(zeroCost), true);
  assert.equal(zeroCost.events[0].cost_usd.value, 0);
});

test('pass: exact model with unavailable tokens and cost', () => {
  assert.equal(valid(unavailable), true);
  assert.equal('value' in unavailable.events[0].cost_usd, false);
});

test('pass: unavailable declarations may omit tokens, cost, and tool_calls', () => {
  assert.equal(valid(omittedUnavailable), true);
  assert.equal('tokens' in omittedUnavailable.events[0], false);
  assert.equal('cost_usd' in omittedUnavailable.events[0], false);
  assert.equal('tool_calls' in omittedUnavailable.events[0], false);
});

test('pass: partial tokens with one available category', () => {
  assert.equal(valid(partialTokens), true);
  assert.equal(partialTokens.events[0].tokens.input.available, true);
  assert.equal(partialTokens.events[0].tokens.output.available, false);
});

test('pass: tool_calls names without count', () => {
  assert.equal(valid(namesOnly), true);
  assert.equal('count' in namesOnly.events[0].tool_calls, false);
});

test('pass: provider/model id', () => {
  assert.equal(valid(mutate(hermesExact, (row) => { row.events[0].model = 'ollama/llama3.2'; })), true);
});

test('pass: model:tag id', () => {
  assert.equal(valid(mutate(hermesExact, (row) => { row.events[0].model = 'llama3.2:latest'; })), true);
});

test('pass: multi-model events sharing one session', () => {
  assert.equal(valid(multiModel), true);
  assert.equal(multiModel.events[0].session_id, multiModel.events[1].session_id);
  assert.notEqual(multiModel.events[0].dedupe_key, multiModel.events[1].dedupe_key);
});

test('pass: same model from two random machine ids', () => {
  const a = receipt(M1, [event(M1, 'hermes', 'shared-evt', { model: 'local-a', runtime: 'ollama', provider: 'ollama', session_id: 'sess1', ...sourceQuantities })]);
  const b = receipt(M2, [event(M2, 'hermes', 'shared-evt', { model: 'local-a', runtime: 'ollama', provider: 'ollama', session_id: 'sess1', ...sourceQuantities })]);
  assert.equal(valid(a), true);
  assert.equal(valid(b), true);
  assert.notEqual(a.events[0].dedupe_key, b.events[0].dedupe_key);
});

test('dedupe key is JSON.stringify array SHA-256, not newline-joined', () => {
  const canonical = dedupeKey(V, M1, 'hermes', 'evt-1');
  assert.match(canonical, /^[a-f0-9]{64}$/);
  const newlineJoin = createHash('sha256').update(`${V}\n${M1}\nhermes\nevt-1`, 'utf8').digest('hex');
  assert.notEqual(canonical, newlineJoin);
  const left = JSON.stringify([V, M1, 'a\nb', 'c']);
  const right = JSON.stringify([V, M1, 'a', 'b\nc']);
  assert.notEqual(left, right);
  assert.notEqual(
    createHash('sha256').update(left, 'utf8').digest('hex'),
    createHash('sha256').update(right, 'utf8').digest('hex'),
  );
});

test('importer helper accepts recomputed dedupe_key and rejects a plausible wrong hash', () => {
  assert.equal(valid(hermesExact), true);
  assert.equal(importerAcceptsDedupe(hermesExact), true);
  const spoofed = mutate(hermesExact, (row) => {
    row.events[0].dedupe_key = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  });
  assert.match(spoofed.events[0].dedupe_key, /^[a-f0-9]{64}$/);
  assert.notEqual(spoofed.events[0].dedupe_key, hermesExact.events[0].dedupe_key);
  assert.equal(valid(spoofed), true);
  assert.equal(importerAcceptsDedupe(spoofed), false);
});

function mutate(base, edit) {
  const copy = structuredClone(base);
  edit(copy);
  return copy;
}

const fail = [
  ['fractional tokens', (row) => { row.events[0].tokens = { input: { available: true, value: 1.5, provenance: 'source' } }; }],
  ['available=false with a value', (row) => { row.events[0].cost_usd = { available: false, value: 100, provenance: 'source' }; }],
  ['missing exact model', (row) => { delete row.events[0].model; }],
  ['selected provenance', (row) => { row.events[0].provenance.recorded_as = 'selected'; }],
  ['inventory provenance', (row) => { row.events[0].provenance.recorded_as = 'inventory'; }],
  ['sqlite without schema_pin', (row) => { delete row.events[0].provenance.schema_pin; }],
  ['malformed dedupe key', (row) => { row.events[0].dedupe_key = 'ABC'; }],
  ['newline in source_event_id', (row) => { row.events[0].source_event_id = 'evt\n2'; }],
  ['control character in source_label', (row) => { row.events[0].provenance.source_label = 'hermes.session\tusage'; }],
  ['forbidden prompt field', (row) => { row.events[0].prompt = 'ignored'; }],
  ['forbidden content field', (row) => { row.events[0].content = 'ignored'; }],
  ['unix path source_event_id', (row) => { row.events[0].source_event_id = '/tmp/state.db'; }],
  ['windows path source_event_id', (row) => { row.events[0].source_event_id = 'C:/state.db'; }],
  ['url source_label', (row) => { row.events[0].provenance.source_label = 'https://example.invalid'; }],
  ['credential field', (row) => { row.events[0].api_key = 'sk-test'; }],
  ['unknown top-level field', (row) => { row.hostname = 'box'; }],
  ['unknown event field', (row) => { row.events[0].username = 'ops'; }],
  ['tool_calls unavailable with names', (row) => { row.events[0].tool_calls = { available: false, names: ['Bash'] }; }],
  ['tool_calls unavailable with count', (row) => { row.events[0].tool_calls = { available: false, count: 1 }; }],
  ['future schema version', (row) => { row.schema_version = 'local-usage-receipt.v2'; }],
  ['source_kind receipt', (row) => { row.events[0].provenance.source_kind = 'receipt'; }],
  ['tokens unavailable with available category', (row) => { row.events[0].availability.tokens = 'unavailable'; }],
  ['tokens source with tokens omitted', (row) => { delete row.events[0].tokens; }],
  ['tokens source with all categories unavailable', (row) => {
    row.events[0].tokens = { input: { available: false }, output: { available: false } };
  }],
  ['tokens partial with tokens omitted', (row) => {
    delete row.events[0].tokens;
    row.events[0].availability.tokens = 'partial';
  }],
  ['tokens partial with all categories unavailable', (row) => {
    row.events[0].availability.tokens = 'partial';
    row.events[0].tokens = { input: { available: false }, output: { available: false } };
  }],
  ['cost unavailable carrying a value', (row) => { row.events[0].availability.cost = 'unavailable'; }],
  ['cost source with cost omitted', (row) => { delete row.events[0].cost_usd; }],
  ['cost source with no value', (row) => { row.events[0].cost_usd = { available: true, provenance: 'source' }; }],
  ['cost source marked unavailable', (row) => { row.events[0].cost_usd = { available: false }; }],
  ['runtime unavailable with value', (row) => { row.events[0].availability.runtime = 'unavailable'; }],
  ['runtime exact with value omitted', (row) => { delete row.events[0].runtime; }],
  ['runtime exact with null', (row) => { row.events[0].runtime = null; }],
  ['provider unavailable with value', (row) => { row.events[0].availability.provider = 'unavailable'; }],
  ['provider source with value omitted', (row) => {
    delete row.events[0].provider;
    row.events[0].availability.provider = 'source';
  }],
  ['session unavailable with value', (row) => { row.events[0].availability.session = 'unavailable'; }],
  ['session exact with value omitted', (row) => { delete row.events[0].session_id; }],
  ['session exact with null', (row) => { row.events[0].session_id = null; }],
  ['tool_calls unavailable with available true', (row) => { row.events[0].availability.tool_calls = 'unavailable'; }],
  ['tool_calls count with tool_calls omitted', (row) => { delete row.events[0].tool_calls; }],
  ['tool_calls count with available false', (row) => { row.events[0].tool_calls = { available: false }; }],
  ['tool_calls count without count', (row) => { row.events[0].tool_calls = { available: true, names: ['Bash'] }; }],
  ['tool_calls names with tool_calls omitted', (row) => {
    delete row.events[0].tool_calls;
    row.events[0].availability.tool_calls = 'names';
  }],
  ['tool_calls names with available false', (row) => {
    row.events[0].availability.tool_calls = 'names';
    row.events[0].tool_calls = { available: false };
  }],
  ['tool_calls names without names', (row) => {
    row.events[0].availability.tool_calls = 'names';
    row.events[0].tool_calls = { available: true, count: 2 };
  }],
  ['model file URI with one slash', (row) => { row.events[0].model = 'file:/Users/me/weights.gguf'; }],
  ['model file URI with three slashes', (row) => { row.events[0].model = 'file:///Users/me/weights.gguf'; }],
  ['model embedded parent path', (row) => { row.events[0].model = 'local/../secret'; }],
  ['model absolute home path', (row) => { row.events[0].model = 'x/Users/me/weights'; }],
  ['model https URL', (row) => { row.events[0].model = 'https://example.invalid/model'; }],
  ['model http URL', (row) => { row.events[0].model = 'http://127.0.0.1/model'; }],
  ['model windows drive path', (row) => { row.events[0].model = 'C:/models/local-a'; }],
  ['model UNC path', (row) => { row.events[0].model = '\\\\server\\share\\model'; }],
];

for (const [name, edit] of fail) {
  test(`fail: ${name}`, () => {
    assert.equal(valid(mutate(hermesExact, edit)), false);
  });
}
