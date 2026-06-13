import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeService, safeText, summarizeServices } from '../superadmin-usage.mjs';

const fakeOpenAiKey = 'sk-' + 'exampleSECRET1234567890';
const fakeGithubToken = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz1234567890';

test('normalizes a SuperAdmin service row without leaking token-shaped text', () => {
  const row = normalizeService({
    service_name: 'OpenAI Codex',
    provider: 'OpenAI',
    category: 'AI',
    monthly_cost_usd: '200',
    usage: '80',
    limit: '100',
    note: `local key ${fakeOpenAiKey} should not appear`,
  });

  assert.equal(row.name, 'OpenAI Codex');
  assert.equal(row.vendor, 'OpenAI');
  assert.equal(row.status, 'watch');
  assert.equal(row.usagePct, 80);
  assert.equal(row.monthlyCostUsd, 200);
  assert.match(row.notes[0], /\[redacted\]/);
});

test('marks over-capacity services and summarizes spend', () => {
  const services = [
    normalizeService({ name: 'GitHub', monthlyCostUsd: 48, usageValue: 20, limitValue: 100 }),
    normalizeService({ name: 'Canva', monthlyCostUsd: 115, usageValue: 12, limitValue: 10 }),
  ];

  assert.equal(services[0].status, 'healthy');
  assert.equal(services[1].status, 'over');
  assert.deepEqual(summarizeServices(services), {
    services: 2,
    monthlyUsd: 163,
    watch: 0,
    over: 1,
    renewal30d: 0,
  });
});

test('redacts long secret-shaped strings', () => {
  assert.equal(
    safeText(`authorization token ${fakeGithubToken}`),
    'authorization token [redacted]',
  );
});
