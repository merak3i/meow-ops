import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnv } from '../load-env.mjs';

function withTempRepo(fn) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'meow-load-env-'));
  try {
    return fn(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function withoutEnv(keys, fn) {
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const key of keys) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('loadEnv parses KEY=VALUE lines, quotes, comments, and ignores malformed lines', () => {
  withoutEnv(['MEOW_ENV_ONE', 'MEOW_ENV_TWO', 'MEOW_ENV_THREE', 'MEOW_ENV_BAD'], () => {
    withTempRepo((repoRoot) => {
      writeFileSync(join(repoRoot, '.env'), [
        '# local fixture only',
        '',
        'MEOW_ENV_ONE=plain',
        'MEOW_ENV_TWO="quoted value"',
        "MEOW_ENV_THREE='single quoted'",
        'not valid',
        '1BAD=ignored',
        '=ignored',
        'MEOW_ENV_BAD',
        '',
      ].join('\n'));

      loadEnv(repoRoot);

      assert.equal(process.env.MEOW_ENV_ONE, 'plain');
      assert.equal(process.env.MEOW_ENV_TWO, 'quoted value');
      assert.equal(process.env.MEOW_ENV_THREE, 'single quoted');
      assert.equal(process.env.MEOW_ENV_BAD, undefined);
    });
  });
});

test('loadEnv never overrides shell environment values', () => {
  withoutEnv(['MEOW_ENV_SHELL_WINS'], () => {
    process.env.MEOW_ENV_SHELL_WINS = 'from-shell';
    withTempRepo((repoRoot) => {
      writeFileSync(join(repoRoot, '.env'), 'MEOW_ENV_SHELL_WINS=from-file\n');
      loadEnv(repoRoot);
      assert.equal(process.env.MEOW_ENV_SHELL_WINS, 'from-shell');
    });
  });
});

test('loadEnv silently no-ops when .env is missing', () => {
  withoutEnv(['MEOW_ENV_MISSING_FILE'], () => {
    withTempRepo((repoRoot) => {
      assert.doesNotThrow(() => loadEnv(repoRoot));
      assert.equal(process.env.MEOW_ENV_MISSING_FILE, undefined);
    });
  });
});
