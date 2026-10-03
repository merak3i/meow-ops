import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, renderInstallation } from '../install-macos-agents.mjs';

test('installation shares one config across three current services and escapes XML paths', () => {
  const jobs = renderInstallation({ repoRoot: '/fixture/A & B', home: '/fixture/home', node: '/fixture/node' });
  assert.deepEqual(jobs.map(job => job.label), ['com.meowops.sanctum-helper', 'com.meowops.dashboard', 'com.meowops.harness-sync']);
  for (const job of jobs) {
    assert.match(job.content, /A &amp; B/);
    assert.match(job.content, /MEOW_CONFIG_FILE/);
    assert.match(job.content, /\.config\/meow-ops\/local.env/);
  }
  assert.match(jobs[2].content, /StartInterval<\/key><integer>300/);
});

test('reinstall preserves owner config, backs up changed jobs, and leaves obsolete jobs intact', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-install-'));
  try {
    const first = install({ home, repoRoot: '/fixture/repo' });
    const config = readFileSync(first.configFile, 'utf8');
    assert.equal(first.activated, false);
    assert.match(config, /MEOW_SKIP_CURSOR="0"/);
    writeFileSync(first.configFile, 'MEOW_DATA_DIR=/owner/chosen\n');
    const legacy = join(home, 'Library', 'LaunchAgents', 'com.meowops.localapi.plist');
    writeFileSync(legacy, 'keep');
    const second = install({ home, repoRoot: '/fixture/new-repo' });
    assert.deepEqual(second.obsolete, ['com.meowops.localapi']);
    assert.equal(readFileSync(first.configFile, 'utf8'), 'MEOW_DATA_DIR=/owner/chosen\n');
    assert.equal(readFileSync(legacy, 'utf8'), 'keep');
    assert.ok(existsSync(join(second.backup, first.jobs[0].name)));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('activation refuses a missing build or a loaded obsolete service before changing jobs', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-install-gate-'));
  const repoRoot = join(home, 'repo');
  try {
    assert.throws(() => install({ home, repoRoot, activate: true }), /Build the dashboard/);
    mkdirSync(join(repoRoot, 'dist'), { recursive: true });
    writeFileSync(join(repoRoot, 'dist', 'index.html'), '<!doctype html>');
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(join(home, 'Library', 'LaunchAgents', 'com.meowops.localapi.plist'), 'keep');
    assert.throws(() => install({ home, repoRoot, activate: true, run() {} }), /Legacy service/);
    assert.equal(existsSync(join(home, '.config')), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('reinstall migrates private locations from old service overrides without losing owner config', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-install-migrate-'));
  try {
    const first = install({ home, repoRoot: '/fixture/repo' });
    writeFileSync(first.configFile, 'MEOW_SESSION_HISTORY_DIR=/owner/archive\n');
    const helper = first.jobs[0].path;
    writeFileSync(helper, readFileSync(helper, 'utf8').replace('<key>PATH</key>', '<key>MEOW_DATA_DIR</key><string>/owner/private-data</string><key>MEOW_SKIP_CURSOR</key><string>1</string><key>PATH</key>'));
    const result = install({ home, repoRoot: '/fixture/new' });
    const config = readFileSync(result.configFile, 'utf8');
    assert.match(config, /MEOW_SESSION_HISTORY_DIR=\/owner\/archive/);
    assert.match(config, /MEOW_DATA_DIR="\/owner\/private-data"/);
    assert.match(config, /MEOW_SKIP_CURSOR="1"/);
    assert.equal(readFileSync(join(result.backup, 'local.env'), 'utf8'), 'MEOW_SESSION_HISTORY_DIR=/owner/archive\n');
    const again = install({ home, repoRoot: '/fixture/new' });
    assert.equal(readFileSync(again.configFile, 'utf8'), config);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('reinstall accepts a valid service plist without optional environment overrides', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-install-no-env-'));
  try {
    const first = install({ home, repoRoot: '/fixture/repo' });
    writeFileSync(first.jobs[0].path, '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.meowops.sanctum-helper</string></dict></plist>');
    const second = install({ home, repoRoot: '/fixture/new-repo' });
    assert.equal(second.activated, false);
    assert.ok(existsSync(second.jobs[0].path));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
