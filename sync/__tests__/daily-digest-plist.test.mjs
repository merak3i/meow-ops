import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const plistPath = join(repoRoot, 'sync', 'com.meowops.daily-digest.plist');
const plist = readFileSync(plistPath, 'utf8');

test('daily digest LaunchAgent points at the loop digest schedule', () => {
  assert.match(plist, /<key>Label<\/key>\s*<string>com\.meowops\.daily-digest<\/string>/);
  assert.match(plist, /<string>\/Users\/napster\/Documents\/meow-ops\/sync\/loop-digest\.mjs<\/string>/);
  assert.match(plist, /<key>StartCalendarInterval<\/key>\s*<dict>[\s\S]*<key>Hour<\/key>\s*<integer>3<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
  assert.ok(existsSync(join(repoRoot, 'sync', 'loop-digest.mjs')));
});

test('daily digest logs stay under the meow-ops log directory', () => {
  const paths = [...plist.matchAll(/<key>Standard(?:Out|Error)Path<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((match) => match[1]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.startsWith('/Users/napster/Library/Logs/meow-ops/')));
});
