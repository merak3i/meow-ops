import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const plist = readFileSync(join(repoRoot, 'sync', 'com.meowops.localapi.plist'), 'utf8');

test('local API LaunchAgent reloads imported helper code after an update', () => {
  assert.match(
    plist,
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>YOUR_NODE_PATH<\/string>\s*<string>--watch<\/string>\s*<string>YOUR_REPO_PATH\/sync\/local-api\.mjs<\/string>/,
  );
});

test('local API logs stay under the Meow Ops log directory', () => {
  const paths = [...plist.matchAll(/<key>Standard(?:Out|Error)Path<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((match) => match[1]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.startsWith('YOUR_HOME/Library/Logs/meow-ops/')));
});
