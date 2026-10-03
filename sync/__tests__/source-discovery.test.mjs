import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSourceDirectory, statSourcePath, walkSourceJsonl } from '../source-discovery.mjs';
import { scanCursorSessions } from '../parse-cursor.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'meow-discovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function failPath(t, method, path, code) {
  const original = fs[method];
  t.mock.method(fs, method, (candidate, ...args) => {
    if (candidate === path) throw Object.assign(new Error(`private failure at ${path}`), { code });
    return original(candidate, ...args);
  });
}

test('Claude JSONL discovery reports unreadable children and vanished entries while continuing siblings', t => {
  const dir = fixture(t);
  const denied = join(dir, 'a-denied');
  const vanished = join(dir, 'b-vanished.jsonl');
  const good = join(dir, 'c-readable.jsonl');
  const subagents = join(dir, 'd-readable', 'subagents');
  fs.mkdirSync(denied);
  fs.mkdirSync(subagents, { recursive: true });
  fs.writeFileSync(vanished, '{}\n');
  fs.writeFileSync(good, '{}\n');
  fs.writeFileSync(join(subagents, 'child.jsonl'), '{}\n');
  failPath(t, 'readdirSync', denied, 'EACCES');
  failPath(t, 'statSync', vanished, 'ENOENT');
  const reports = [];
  const files = [...walkSourceJsonl(dir, { onCoverage: report => reports.push(report) })];
  assert.deepEqual(files.map(file => [file.name, file.isSubagent]), [
    ['c-readable.jsonl', false], ['child.jsonl', true],
  ]);
  assert.deepEqual(reports.map(report => [report.mode, report.stage, report.operation]), [
    ['failed', 'discovery', 'readdir'], ['failed', 'discovery', 'stat'],
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /private|denied|vanished|meow-discovery/);
});

test('optional missing roots are quiet but permissions on an optional root remain a coverage failure', t => {
  const dir = fixture(t);
  const absent = join(dir, 'absent');
  const denied = join(dir, 'denied');
  fs.mkdirSync(denied);
  const reports = [];
  const options = { optional: true, onCoverage: report => reports.push(report) };
  assert.equal(statSourcePath(absent, options), null);
  assert.deepEqual(readSourceDirectory(absent, options), []);
  assert.equal(reports.length, 0);
  failPath(t, 'statSync', denied, 'EACCES');
  failPath(t, 'readdirSync', denied, 'EACCES');
  assert.equal(statSourcePath(denied, options), null);
  assert.deepEqual(readSourceDirectory(denied, options), []);
  assert.equal(reports.length, 2);
});

test('Claude discovery does not recurse through a symlink back to an ancestor', t => {
  const dir = fixture(t);
  fs.writeFileSync(join(dir, 'one.jsonl'), '{}\n');
  fs.symlinkSync(dir, join(dir, 'loop'), 'dir');
  assert.deepEqual([...walkSourceJsonl(dir)].map(file => file.name), ['one.jsonl']);
});

test('Cursor discovery retains readable sessions and reports failed listing/stat coverage', t => {
  const dir = fixture(t);
  const transcripts = join(dir, 'example', 'agent-transcripts');
  const denied = join(transcripts, 'a-denied');
  const vanished = join(transcripts, 'b-vanished.jsonl');
  fs.mkdirSync(denied, { recursive: true });
  fs.writeFileSync(vanished, '{}\n');
  fs.writeFileSync(join(transcripts, 'readable.jsonl'), JSON.stringify({
    role: 'user', content: 'fixture', timestamp: '2026-10-03T00:00:00Z',
  }) + '\n');
  failPath(t, 'readdirSync', denied, 'EACCES');
  failPath(t, 'statSync', vanished, 'ENOENT');
  const reports = [];
  const sessions = scanCursorSessions(dir, { onCoverage: report => reports.push(report) });
  assert.deepEqual(sessions.map(session => session.session_id), ['cursor-readable']);
  const failures = reports.filter(report => report.mode === 'failed');
  assert.deepEqual(failures.map(report => report.operation), ['readdir', 'stat']);
  assert.doesNotMatch(JSON.stringify(failures), /private|denied|vanished|meow-discovery/);
});
