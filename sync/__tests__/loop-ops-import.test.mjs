// loop-ops-import.mjs — fail-loud validation contract (spec §Phase 3).
// Synthetic workbooks are built per-case so the suite runs on any machine;
// the real Master Spec test skips when the workbook is absent.
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
const REAL_SPEC = '/Users/napster/Downloads/Patherle/Agentic Harness/PATHERLE_HARNESS_MASTER_SPEC_v1_2026-06-07.xlsx';

const HEADERS = ['#', 'surface_key', 'family', 'group', 'archetype', 'riskClass', 'modelTier',
  'confidenceFloor', 'pass_threshold', 'evalGate', 'enabled', 'promptVersion', 'redaction_ref',
  'wave', 'phase', 'notes'];

function defaultRows() {
  // 26 surfaces across the exact four groups (22 tenant / 2 customer / 1 admin / 1 doer).
  const rows = [];
  for (let i = 0; i < 22; i++) rows.push({ surface_key: `assist.t${i}`, group: 'tenant' });
  rows.push({ surface_key: 'rag.core', group: 'customer' }, { surface_key: 'voice.live', group: 'customer' });
  rows.push({ surface_key: 'ops.copilot', group: 'admin' }, { surface_key: 'genie.execute', group: 'doer' });
  return rows.map((r, i) => ({
    '#': i + 1, family: 'intelligentAssist', archetype: 'A2', riskClass: 'suggest',
    modelTier: 'flash', confidenceFloor: 0.28, pass_threshold: 0.78, evalGate: true,
    enabled: true, promptVersion: `${r.surface_key}@v1`, redaction_ref: 'policy',
    wave: (i % 4) + 1, phase: 1, notes: `Surface ${i}`, ...r,
  }));
}

async function makeWorkbook(rows, { dropColumn } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('1 · Registry');
  const headers = HEADERS.filter((h) => h !== dropColumn);
  ws.addRow(['TAB 1 — SURFACE REGISTRY']);
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

test('valid 26-surface workbook imports: 31 entities, 30 edges, no truth-sync', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows()));
  assert.equal(res.code, 0, res.stderr);
  const spec = JSON.parse(readFileSync(join(res.out, 'spec.json'), 'utf8'));
  assert.equal(spec.meta.entityCount, 31);
  assert.equal(spec.meta.assistantCount, 26);
  assert.equal(spec.entities.filter((e) => e.kind === 'director').length, 4);
  assert.equal(spec.edges.length, 30);
  assert.equal(spec.meta.productionWritesEnabled, false);
  assert.equal(spec.meta.truthSync, null);
  // Without a truth snapshot every assistant is 'covered' and says so.
  const assistant = spec.entities.find((e) => e.kind === 'assistant');
  assert.equal(assistant.status, 'covered');
  assert.match(assistant.detail.notVerified.join(' '), /No truth-sync snapshot/);
  const gates = JSON.parse(readFileSync(join(res.out, 'gates.json'), 'utf8'));
  assert.equal(gates.filter((g) => g.gateType === 'eval').length, 26);
});

test('25 rows fails loudly naming the count rule', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows().slice(0, 25)));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /exactly 26/);
  assert.match(res.stderr, /found 25/);
});

test('unknown fifth group fails loudly naming the groups rule', async () => {
  const rows = defaultRows();
  rows[0].group = 'ghost';
  const res = await runImporter(await makeWorkbook(rows));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /groups must be exactly/);
  assert.match(res.stderr, /ghost/);
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
  // Assembled at runtime so no secret-shaped literal sits in the repo.
  rows[3].notes = `key ${'sk-' + 'a1b2c3d4'.repeat(3)}`;
  const res = await runImporter(await makeWorkbook(rows));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /secret-pattern hit/);
});

test('failed validation writes nothing — no partial output', async () => {
  const res = await runImporter(await makeWorkbook(defaultRows().slice(0, 10)));
  assert.equal(res.code, 1);
  assert.equal(existsSync(join(res.out, 'spec.json')), false);
  assert.equal(existsSync(join(res.out, 'gates.json')), false);
  assert.equal(readdirSync(res.out).length, 0);
});

test('real Master Spec workbook imports with truth-sync enrichment', { skip: !existsSync(REAL_SPEC) }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'loopops-real-'));
  const { stdout } = await exec('node', [IMPORTER, '--spec', REAL_SPEC, '--out', out]);
  assert.match(stdout, /31 entities \(26 surfaces\)/);
  const spec = JSON.parse(readFileSync(join(out, 'spec.json'), 'utf8'));
  const groups = new Set(spec.entities.filter((e) => e.kind === 'assistant').map((e) => e.group));
  assert.deepEqual([...groups].sort(), ['admin', 'customer', 'doer', 'tenant']);
  // The four Wave-1 LOCKED golden cases are the only passing eval gates today.
  const gates = JSON.parse(readFileSync(join(out, 'gates.json'), 'utf8'));
  const passed = gates.filter((g) => g.gateType === 'eval' && g.status === 'passed').map((g) => g.entityId).sort();
  assert.deepEqual(passed, ['assist.catalogue', 'assist.chatSandbox', 'assist.integrations', 'rag.core']);
});
