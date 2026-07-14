#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HOME = homedir();
const AGENTS_DIR = join(HOME, 'Library', 'LaunchAgents');
const LOG_DIR = join(HOME, 'Library', 'Logs', 'meow-ops');

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(name) {
  return readFileSync(join(HERE, name), 'utf8')
    .replaceAll('YOUR_REPO_PATH', xml(ROOT))
    .replaceAll('YOUR_HOME', xml(HOME))
    .replaceAll('YOUR_NODE_PATH', xml(process.execPath));
}

function launchctl(args, optional = false) {
  try {
    execFileSync('launchctl', args, { stdio: optional ? 'ignore' : 'inherit' });
  } catch (error) {
    if (!optional) throw error;
  }
}

export function install({ activate = false } = {}) {
  mkdirSync(AGENTS_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const files = [
    ['com.meowops.localapi.plist', 'com.meowops.localapi'],
    ['com.meowops.daily-digest.plist', 'com.meowops.daily'],
  ];
  for (const [name] of files) writeFileSync(join(AGENTS_DIR, name), render(name));

  if (activate) {
    const domain = `gui/${userInfo().uid}`;
    for (const legacy of ['com.meow-ops.sync', 'com.meowcreativehaus.meow-ops-sync', 'com.meowops.daily-digest']) {
      launchctl(['bootout', `${domain}/${legacy}`], true);
    }
    for (const legacyFile of ['com.meow-ops.sync.plist', 'com.meowcreativehaus.meow-ops-sync.plist']) {
      try { unlinkSync(join(AGENTS_DIR, legacyFile)); } catch {}
    }
    for (const [name, label] of files) {
      if (existsSync(join(AGENTS_DIR, name))) launchctl(['bootout', `${domain}/${label}`], true);
      launchctl(['bootstrap', domain, join(AGENTS_DIR, name)]);
    }
  }
  return files.map(([name, label]) => ({ name, label, path: join(AGENTS_DIR, name) }));
}

const activate = process.argv.includes('--activate');
const installed = install({ activate });
for (const item of installed) console.log(`${activate ? 'activated' : 'wrote'} ${item.label}: ${item.path}`);
