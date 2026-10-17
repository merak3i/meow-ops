import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact, serializeError, formatLine, newRunId } from '../log.mjs';

function capture() {
  const out = [];
  const err = [];
  return {
    out, err,
    stdout: { write: (line) => out.push(line) },
    stderr: { write: (line) => err.push(line) },
  };
}

test('emits one JSON object per line with bound fields and routes warn/error to stderr', () => {
  const sink = capture();
  const log = createLogger({ component: 'sync-runner', run_id: 'run-1' }, {
    env: {}, stdout: sink.stdout, stderr: sink.stderr, now: () => new Date('2026-10-17T00:00:00.000Z'),
  });
  log.info('sync.start', { trigger: 'scheduled' });
  log.error('sync.failed', { duration_ms: 1200 });
  assert.equal(sink.out.length, 1);
  assert.equal(sink.err.length, 1);
  const info = JSON.parse(sink.out[0]);
  assert.deepEqual(info, { ts: '2026-10-17T00:00:00.000Z', level: 'info', msg: 'sync.start', component: 'sync-runner', run_id: 'run-1', trigger: 'scheduled' });
  const error = JSON.parse(sink.err[0]);
  assert.equal(error.level, 'error');
  assert.equal(error.duration_ms, 1200);
});

test('secret-shaped values, forbidden keys and home paths never reach a log line', () => {
  const sink = capture();
  const log = createLogger({ component: 't' }, { env: {}, stdout: sink.stdout, stderr: sink.stderr });
  log.info('probe', {
    token: 'should-be-dropped',
    authorization: 'Bearer abc',
    note: 'key sk-1234567890abcdef leaked from /Users/napster/Repos/meow-ops/.env',
    jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
  });
  const record = JSON.parse(sink.out[0]);
  assert.equal(record.token, undefined);
  assert.equal(record.authorization, undefined);
  assert.doesNotMatch(record.note, /sk-1234567890abcdef/);
  assert.doesNotMatch(record.note, /\/Users\/napster/);
  assert.match(record.note, /\[redacted\]/);
  assert.doesNotMatch(record.jwt, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
});

test('errors serialize with name, message, code and a truncated stack; LOG_LEVEL gates output', () => {
  const sink = capture();
  const log = createLogger({}, { env: { LOG_LEVEL: 'warn' }, stdout: sink.stdout, stderr: sink.stderr });
  log.info('hidden');
  const err = Object.assign(new Error('boom at /home/me/x'), { code: 'EBOOM' });
  log.error('failed', { error: err });
  assert.equal(sink.out.length, 0);
  const record = JSON.parse(sink.err[0]);
  assert.equal(record.error.name, 'Error');
  assert.equal(record.error.message, 'boom at ~/x');
  assert.equal(record.error.code, 'EBOOM');
  assert.ok(record.error.stack.split('\n').length <= 6);
});

test('pretty format, child loggers and run ids behave', () => {
  const sink = capture();
  const log = createLogger({ component: 'a' }, { env: { LOG_FORMAT: 'pretty' }, stdout: sink.stdout, stderr: sink.stderr, now: () => new Date('2026-10-17T00:00:00.000Z') });
  log.child({ run_id: 'r1' }).info('hello', { n: 1 });
  assert.match(sink.out[0], /^2026-10-17T00:00:00\.000Z INFO {2}hello \{"component":"a","run_id":"r1","n":1\}\n$/);
  assert.match(newRunId(), /^[0-9a-f-]{36}$/);
  assert.equal(formatLine({ ts: 't', level: 'info', msg: 'm' }), '{"ts":"t","level":"info","msg":"m"}');
  assert.equal(redact('telegram 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789'), 'telegram [redacted]');
  assert.deepEqual(serializeError(null), undefined);
});
