#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  applyProjectAdapters, previewProjectAdapters, readProjectCatalog, registerProject,
  rollbackProjectAdapters,
} from './project-control.mjs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitRemote(root) {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function inferredName(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (pkg.name) return String(pkg.name).split(/[-_ ]+/).map(
      (part) => part ? part[0].toUpperCase() + part.slice(1) : '',
    ).join(' ');
  } catch {}
  return basename(root);
}

const action = process.argv[2] || 'status';

if (action === 'register') {
  const root = resolve(option('root') || process.cwd());
  const name = option('name') || inferredName(root);
  const aliases = process.argv.flatMap((value, index, values) => (
    value === '--alias' && values[index + 1] ? [values[index + 1]] : []
  ));
  const project = registerProject({
    name,
    root,
    git_remote: option('git-remote') || gitRemote(root),
    aliases,
  });
  console.log(JSON.stringify({ ok: true, project }, null, 2));
} else if (action === 'status') {
  console.log(JSON.stringify({ ok: true, projects: readProjectCatalog() }, null, 2));
} else if (action === 'adapters-preview') {
  const root = resolve(option('root') || process.cwd());
  const preview = previewProjectAdapters({ projectRoot: root });
  console.log(JSON.stringify({
    ok: true,
    preview: {
      ...preview,
      targets: preview.targets.map(({ content, ...target }) => target),
    },
  }, null, 2));
} else if (action === 'adapters-apply') {
  if (!process.argv.includes('--confirm')) {
    throw new Error('[project-control] --confirm is required after reviewing adapters-preview');
  }
  const root = resolve(option('root') || process.cwd());
  const preview = previewProjectAdapters({ projectRoot: root });
  const result = applyProjectAdapters({
    projectRoot: root,
    expectedChecksums: Object.fromEntries(preview.targets.map((target) => [target.agent, target.checksum])),
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} else if (action === 'adapters-rollback') {
  if (!process.argv.includes('--confirm')) {
    throw new Error('[project-control] --confirm is required for rollback');
  }
  console.log(JSON.stringify({
    ok: true,
    result: rollbackProjectAdapters(option('sync')),
  }, null, 2));
} else {
  console.error('Usage: project-control-cli.mjs register|status|adapters-preview|adapters-apply|adapters-rollback');
  process.exitCode = 1;
}
