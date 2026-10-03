#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from './load-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = ['com.meowops.localapi', 'com.meowops.daily', 'com.meowops.daily-digest', 'com.meow-ops.sync', 'com.meowcreativehaus.meow-ops-sync'];
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const MIGRATED_KEYS = ['MEOW_DATA_DIR', 'MEOW_SESSION_HISTORY_DIR', 'MEOW_EVIDENCE_DIR', 'MEOW_PROJECT_CONTROL_DIR', 'MEOW_RUNTIME_DIR', 'MEOW_LOOP_DIR', 'MEOW_SKIP_CURSOR', 'MEOW_REFRESH_LIMITS'];

function installedOverrides(jobs, agents, configured) {
  const inherited = {};
  for (const job of jobs) {
    const file = join(agents, job.name);
    if (!existsSync(file)) continue;
    let plist;
    try { plist = readFileSync(file, 'utf8'); }
    catch { throw new Error('An installed Meow Ops service could not be inspected; preserve it before reinstalling.'); }
    if (!plist.includes('<plist') || !plist.includes('</plist>')) {
      throw new Error('An installed Meow Ops service could not be inspected; preserve it before reinstalling.');
    }
    const environment = plist.match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/)?.[1];
    if (environment === undefined) continue;
    for (const key of MIGRATED_KEYS) {
      const keyPattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
      const match = environment.match(keyPattern);
      if (configured[key] !== undefined || !match) continue;
      const value = match[1].replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
      if (inherited[key] !== undefined && inherited[key] !== value) throw new Error(`Installed services disagree about ${key}; set it in the shared config before reinstalling.`);
      inherited[key] = value;
    }
  }
  return inherited;
}

export function renderInstallation({ repoRoot = ROOT, home = homedir(), node = process.execPath,
  configFile = join(home, '.config', 'meow-ops', 'local.env') } = {}) {
  const jobs = [
    { label: 'com.meowops.sanctum-helper', args: [node, 'sync/local-api.mjs'], keepAlive: true },
    { label: 'com.meowops.dashboard', args: [node, 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4273', '--strictPort'], keepAlive: true },
    { label: 'com.meowops.harness-sync', args: [node, 'sync/sync-runner.mjs', '--no-limits'], interval: 300 },
  ];
  return jobs.map(job => ({
    label: job.label, name: `${job.label}.plist`,
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(job.label)}</string>
<key>ProgramArguments</key><array>${job.args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(repoRoot)}</string>
<key>EnvironmentVariables</key><dict><key>MEOW_CONFIG_FILE</key><string>${xml(configFile)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/>
${job.keepAlive ? '<key>KeepAlive</key><true/>' : `<key>StartInterval</key><integer>${job.interval}</integer>`}
<key>StandardOutPath</key><string>${xml(join(home, 'Library', 'Logs', 'meow-ops', `${job.label}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(join(home, 'Library', 'Logs', 'meow-ops', `${job.label}.error.log`))}</string>
</dict></plist>`,
  }));
}

export function install({ activate = false, repoRoot = ROOT, home = homedir(), node = process.execPath,
  configFile = join(home, '.config', 'meow-ops', 'local.env'), run = execFileSync } = {}) {
  const agents = join(home, 'Library', 'LaunchAgents');
  const backup = join(home, '.meow-ops', 'backups', `agents-${Date.now()}`);
  const domain = `gui/${userInfo().uid}`;
  const jobs = renderInstallation({ repoRoot, home, node, configFile });
  const obsolete = LEGACY.filter(label => existsSync(join(agents, `${label}.plist`)));
  if (activate) {
    if (!existsSync(join(repoRoot, 'dist', 'index.html'))) throw new Error('Build the dashboard before activating local services.');
    for (const label of obsolete) {
      let loaded = false;
      try { run('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }); loaded = true; } catch { /* Not loaded. */ }
      if (loaded) throw new Error(`Legacy service ${label} is active. Resolve it before activating overlapping services.`);
    }
  }
  const configured = {};
  loadEnv(repoRoot, { env: configured, home, configFile });
  const inherited = installedOverrides(jobs, agents, configured);
  mkdirSync(agents, { recursive: true });
  mkdirSync(join(home, 'Library', 'Logs', 'meow-ops'), { recursive: true });
  if (!existsSync(configFile)) {
    mkdirSync(dirname(configFile), { recursive: true, mode: 0o700 });
    const privateRoot = join(home, '.meow-ops');
    const config = Object.entries({
      MEOW_DATA_DIR: join(privateRoot, 'data'), MEOW_SESSION_HISTORY_DIR: join(privateRoot, 'session-history'),
      MEOW_EVIDENCE_DIR: join(privateRoot, 'evidence'), MEOW_PROJECT_CONTROL_DIR: join(privateRoot, 'project-control'),
      MEOW_RUNTIME_DIR: join(privateRoot, 'runtime'), MEOW_REFRESH_LIMITS: '0', MEOW_SKIP_CURSOR: '0',
      ...inherited,
    }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
    writeFileSync(configFile, `${config}\n`, { mode: 0o600, flag: 'wx' });
  } else if (Object.keys(inherited).length) {
    // Existing LaunchAgent-only locations would otherwise be lost when those
    // jobs are replaced. Copy only the explicit non-secret configuration keys.
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    copyFileSync(configFile, join(backup, 'local.env'));
    chmodSync(join(backup, 'local.env'), 0o600);
    writeFileSync(configFile, `\n${Object.entries(inherited).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`, { flag: 'a' });
    chmodSync(configFile, 0o600);
  }
  for (const job of jobs) {
    const path = join(agents, job.name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== job.content) {
      mkdirSync(backup, { recursive: true, mode: 0o700 });
      copyFileSync(path, join(backup, job.name));
    }
    writeFileSync(path, job.content, { mode: 0o600 });
    job.path = path;
  }
  if (activate) {
    for (const job of jobs) {
      try { run('launchctl', ['bootout', `${domain}/${job.label}`], { stdio: 'ignore' }); } catch { /* First install. */ }
      run('launchctl', ['bootstrap', domain, job.path], { stdio: 'inherit' });
    }
  }
  return { jobs, obsolete, backup: existsSync(backup) ? backup : null, configFile, activated: activate };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = install({ activate: process.argv.includes('--activate') });
  process.stdout.write(`${JSON.stringify({ activated: result.activated, jobs: result.jobs.map(job => job.label), obsolete: result.obsolete, backup: result.backup })}\n`);
}
