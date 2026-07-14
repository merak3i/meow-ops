import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const plistPath = join(repoRoot, 'sync', 'com.meowops.daily-digest.plist');
const plist = readFileSync(plistPath, 'utf8');

test('daily LaunchAgent points at the single operator cycle', () => {
  assert.match(plist, /<key>Label<\/key>\s*<string>com\.meowops\.daily<\/string>/);
  assert.match(plist, /<string>YOUR_REPO_PATH\/sync\/daily-operator\.mjs<\/string>/);
  assert.match(plist, /<key>StartCalendarInterval<\/key>\s*<dict>[\s\S]*<key>Hour<\/key>\s*<integer>8<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>30<\/integer>/);
  assert.ok(existsSync(join(repoRoot, 'sync', 'daily-operator.mjs')));
});

test('daily digest logs stay under the meow-ops log directory', () => {
  const paths = [...plist.matchAll(/<key>Standard(?:Out|Error)Path<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((match) => match[1]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.startsWith('YOUR_HOME/Library/Logs/meow-ops/')));
});

test('daily template contains no developer-specific absolute path', () => {
  assert.doesNotMatch(plist, /\/Users\/(?!YOUR_HOME)/);
  assert.match(plist, /<string>YOUR_NODE_PATH<\/string>/);
});
