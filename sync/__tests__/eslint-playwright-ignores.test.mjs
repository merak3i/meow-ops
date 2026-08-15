import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTIFACT_DIRS = ['test-results', 'playwright-report'];
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SYNTAX_ERROR = 'const !!! this is not valid javascript\n';

function artifactPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

function writeGeneratedTree() {
  for (const dir of ARTIFACT_DIRS) {
    rmSync(artifactPath(dir), { recursive: true, force: true });
    for (let i = 0; i < 8; i += 1) {
      const traces = artifactPath(dir, `.playwright-artifacts-${i}`, 'traces');
      mkdirSync(traces, { recursive: true });
      writeFileSync(join(traces, 'broken.js'), SYNTAX_ERROR);
      for (let j = 0; j < 8; j += 1) {
        writeFileSync(join(traces, `chunk-${j}.js`), `export const n${i}${j} = ${j};\n`);
      }
    }
  }
}

function removeGeneratedTrees() {
  for (const dir of ARTIFACT_DIRS) {
    rmSync(artifactPath(dir), { recursive: true, force: true });
  }
}

function runCommand(command, args, { env = {}, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      onStderr?.(text, child);
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test('eslint ignores Playwright output directories', async () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  assert.equal(await eslint.isPathIgnored(artifactPath('test-results', 'broken.js')), true);
  assert.equal(await eslint.isPathIgnored(artifactPath('playwright-report', 'assets', 'report.js')), true);
  assert.equal(await eslint.isPathIgnored(join(REPO_ROOT, 'sync', 'loop-review-fix.mjs')), false);
  assert.equal(await eslint.isPathIgnored(join(REPO_ROOT, 'eslint.config.js')), false);
});

test('generated Playwright JS does not fail lint, and a real source error still does', async () => {
  const probe = join(REPO_ROOT, 'sync', '__eslint_probe_tmp__.mjs');
  writeGeneratedTree();
  try {
    const ignored = await runCommand(NPM, ['run', 'lint']);
    assert.equal(ignored.code, 0, ignored.stderr || ignored.stdout);

    writeFileSync(probe, SYNTAX_ERROR);
    const source = await runCommand(NPM, ['exec', '--', 'eslint', probe]);
    assert.notEqual(source.code, 0);
    assert.match(`${source.stdout}\n${source.stderr}`, /Parsing error|__eslint_probe_tmp__/);
  } finally {
    rmSync(probe, { force: true });
    removeGeneratedTrees();
  }
});

test('lint survives Playwright-style cleanup of generated output dirs', async () => {
  writeGeneratedTree();
  let wiped = false;
  try {
    const result = await runCommand(NPM, ['run', 'lint'], {
      env: { DEBUG: 'eslint:eslint' },
      onStderr(text) {
        if (!wiped && text.includes('file(s) found')) {
          wiped = true;
          removeGeneratedTrees();
        }
      },
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stderr.includes('ENOENT'), false, result.stderr);
  } finally {
    removeGeneratedTrees();
  }
});
