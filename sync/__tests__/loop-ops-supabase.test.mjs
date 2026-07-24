import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsToTruthCsv, TRUTH_COLUMNS } from '../loop-ops-supabase.mjs';

test('maps rows to the importer truth-CSV columns, in order', () => {
  const csv = rowsToTruthCsv([
    { surface_key: 'catalogue.assist', correlation_status: 'OK', latest_gate: 'pass',
      status: 'covered', current_truth: 'live', last_verified_at_utc: '2026-06-13T00:00:00Z' },
  ]);
  const [header, row] = csv.trim().split('\n');
  assert.equal(header, TRUTH_COLUMNS.join(','));
  // surface_key first, latest_gate present, blanks for absent columns
  assert.ok(row.startsWith('catalogue.assist,OK,pass,'));
});

test('honors a column remap', () => {
  const csv = rowsToTruthCsv(
    [{ surface_key: 'x', e2e_gate: 'fail' }],
    { latest_gate: 'e2e_gate' },
  );
  const row = csv.trim().split('\n')[1];
  // latest_gate is column index 2 → "x,,fail,..."
  assert.equal(row.split(',')[2], 'fail');
});

test('drops rows with no surface_key (the join key)', () => {
  const csv = rowsToTruthCsv([
    { surface_key: '', status: 'passed' },
    { surface_key: '   ', status: 'passed' },
    { surface_key: 'real', status: 'passed' },
  ]);
  assert.equal(csv.trim().split('\n').length, 2); // header + 1 real row
});

test('CSV-escapes commas, quotes, and newlines', () => {
  const csv = rowsToTruthCsv([
    { surface_key: 'k', current_truth: 'has, comma and "quote"\nand newline' },
  ]);
  assert.ok(csv.includes('"has, comma and ""quote""'));
});

test('empty / non-array input yields a header-only CSV (safe no-op)', () => {
  assert.equal(rowsToTruthCsv([]).trim(), TRUTH_COLUMNS.join(','));
  assert.equal(rowsToTruthCsv(null).trim(), TRUTH_COLUMNS.join(','));
});
