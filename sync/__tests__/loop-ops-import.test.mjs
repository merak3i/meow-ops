// loop-ops-import.mjs — fail-loud validation contract.
// Synthetic workbooks are built per-case so the suite runs on any machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';

const exec = promisify(execFile);
const IMPORTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'loop-ops-import.mjs');
const ROOT_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

const HEADERS = ['#', 'surface_key', 'family', 'group', 'archetype', 'riskClass', 'modelTier',
  'confidenceFloor', 'pass_threshold', 'evalGate', 'enabled', 'promptVersion', 'redaction_ref',
  'wave', 'phase', 'notes'];

function defaultRows() {
  const groups = ['research', 'build', 'review', 'ops'];
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ surface_key: `worker.${i + 1}`, group: groups[i % groups.length] });
  return rows.map((r, i) => ({
    '#': i + 1, family: 'loopOpsDemo', archetype: 'A2', riskClass: 'suggest',
    modelTier: 'fast', confidenceFloor: 0.28, pass_threshold: 0.78, evalGate: true,
    enabled: true, promptVersion: `${r.surface_key}@v1`, redaction_ref: 'policy',
    wave: (i % 4) + 1, phase: 1, notes: `Worker ${i + 1}`, ...r,
  }));
}

async function makeWorkbook(rows, { dropColumn } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('1 · Registry');
  const headers = HEADERS.filter((h) => h !== dropColumn);
  ws.addRow(['TAB 1 - SURFACE REGISTRY']);
  ws.addRow(['synthetic test workbook']);
  ws.addRow([]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? ''));
  const dir = mkdtempSync(join(tmpdir(), 'loopops-wb-'));
  const path = join(dir, 'spec.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}

async function runImporter(specPath) {
  const out = mkdtempSync(join(tmpdir(), 'loopops-out-'));
  try {
    const { stdout } = await exec('node', [IMPORTER, '--spec', specPath, '--truth', '/nonexistent.csv', '--out', out]);
    return { code: 0, stdout, stderr: '', out };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '', out };
  }
}

test('valid workbook imports with coordinator, four directors, workers, and no truth-sync', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows()));
  assert.equal(res.code, 0, res.stderr);
  const spec = JSON.parse(readFileSync(join(res.out, 'spec.json'), 'utf8'));
  assert.equal(spec.meta.entityCount, 17);
  assert.equal(spec.meta.assistantCount, 12);
  assert.equal(spec.entities.filter((e) => e.kind === 'director').length, 4);
  assert.equal(spec.edges.length, 16);
  assert.equal(spec.meta.productionWritesEnabled, false);
  assert.equal(spec.meta.truthSync, null);
  const assistant = spec.entities.find((e) => e.kind === 'assistant');
  assert.equal(assistant.status, 'covered');
  assert.match(assistant.detail.notVerified.join(' '), /No truth snapshot/);
  const gates = JSON.parse(readFileSync(join(res.out, 'gates.json'), 'utf8'));
  assert.equal(gates.filter((g) => g.gateType === 'eval').length, 12);
});

test('empty registry fails loudly naming the count rule', async () => {
  const res = await runImporter(await makeWorkbook([]));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /at least one worker surface/);
});

test('unknown group fails loudly naming the groups rule', async () => {
  const rows = defaultRows();
  rows[0].group = 'private-client-lane';
  const res = await runImporter(await makeWorkbook(rows));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /groups must be drawn from/);
  assert.match(res.stderr, /private-client-lane/);
});

test('duplicate surface_key fails loudly naming both rows', async () => {
  const rows = defaultRows();
  rows[1].surface_key = rows[0].surface_key;
  const res = await runImporter(await makeWorkbook(rows));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /duplicate surface_key/);
});

test('missing required column fails loudly naming the column', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows(), { dropColumn: 'riskClass' }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /missing required registry column "riskClass"/);
});

test('secret pattern in workbook content aborts before writing', async () => {
  const rows = defaultRows();
  rows[3].notes = `key ${'sk-' + 'a1b2c3d4'.repeat(3)}`;
  const res = await runImporter(await makeWorkbook(rows));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /secret-pattern hit/);
});

test('failed validation writes nothing - no partial output', async () => {
  const res = await runImporter(await makeWorkbook([{ ...defaultRows()[0], group: 'unknown' }]));
  assert.equal(res.code, 1);
  assert.equal(existsSync(join(res.out, 'spec.json')), false);
  assert.equal(existsSync(join(res.out, 'gates.json')), false);
  assert.equal(readdirSync(res.out).length, 0);
});

test('metadata contains no private project clone awareness', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows()));
  assert.equal(res.code, 0, res.stderr);
  const spec = JSON.parse(readFileSync(join(res.out, 'spec.json'), 'utf8'));
  assert.equal('privateProject' in spec.meta, false);
  assert.deepEqual(Object.keys(spec.meta.links), ['meowOps']);
  const assistant = spec.entities.find((e) => e.kind === 'assistant');
  assert.match(assistant.detail.validationCommand, /npm run (build|test:sync)/);
});

test('loop-ops sources contain zero private project write calls', async () => {
  const { readdirSync: rd, readFileSync: rf, statSync: st } = await import('node:fs');
  const files = [];
  const walk = (dir) => {
    for (const name of rd(dir)) {
      const full = join(dir, name);
      if (st(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(join(ROOT_SRC, 'pages', 'loop-ops'));
  files.push(join(ROOT_SRC, 'pages', 'LoopOps.tsx'));

  const offenders = [];
  for (const f of files) {
    const text = rf(f, 'utf8');
    if (/fetch\([^)]*?(supabase|railway|vercel)/i.test(text)) offenders.push(`${f}: external-host fetch`);
    if (/from '@supabase|createClient\(/.test(text)) offenders.push(`${f}: supabase client`);
    if (!f.endsWith('api.ts') && /method:\s*'(POST|PUT|DELETE|PATCH)'/.test(text)) offenders.push(`${f}: non-GET outside api.ts`);
    if (/execSync|spawn\(|child_process/.test(text)) offenders.push(`${f}: process execution in frontend`);
  }
  const apiText = rf(join(ROOT_SRC, 'pages', 'loop-ops', 'api.ts'), 'utf8');
  const posts = apiText.match(/method:\s*'(POST|PUT|DELETE|PATCH)'/g) ?? [];
  if (posts.length !== 1 || !posts[0].includes('POST')) offenders.push(`api.ts: unexpected mutation methods ${posts.join()}`);

  assert.deepEqual(offenders, []);
});
