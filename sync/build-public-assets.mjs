import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const demoFiles = new Set(['demo-sessions.json', 'demo-cost-summary.json', 'demo-superadmin-usage.json']);
const approvedFixtureHashes = Object.freeze({
  'demo-sessions.json': 'a51da8adc70fd62f97b2c7235c70799fd990d3950cc8a8fadf93628697ff15eb',
  'demo-cost-summary.json': 'fe8a61aacfe2e750a71a8dae90b41306f0ffb043349bc3513a956e1acd880a35',
  'demo-superadmin-usage.json': '37d0b656748c378a7d96a1982293d6e645c9849e22a4387c983766ae670e9763',
});
const forbiddenKeys = new Set(['cwd', 'rawref', 'sessiontitle', 'firstusermessage', 'transcript', 'prompt', 'authorization', 'cookie', 'password', 'apikey', 'secret']);
const allowedKeys = new Set([
  'Bash', 'Edit', 'Read', 'Write', 'active_projects', 'aider', 'agent_depth', 'agent_id', 'agent_slug',
  'antigravity', 'artifactCount', 'artifactGb', 'assistant_message_count', 'allTime', 'bySource', 'cache_creation_tokens',
  'cache_read_tokens', 'cacheGb', 'cancelled', 'cat_type', 'category', 'claude', 'codex', 'conclusion',
  'cost', 'currency', 'cursor', 'daily_summary', 'date', 'duration_seconds', 'ended_at', 'endedAt', 'entrypoint',
  'estimated_cost_usd', 'estimatedMinutes', 'environment', 'exportedAt', 'failed', 'generatedAt',
  'git_branch', 'githubActions', 'health', 'hermes', 'ghost_count', 'id', 'inProgress', 'input_tokens',
  'is_ghost', 'is_sidechain', 'is_subagent', 'label', 'lastCheckedAt', 'lastMonth', 'lastWeek',
  'latestRun', 'limitLabel', 'limitValue', 'limits', 'message_count', 'meta', 'minutesIncluded',
  'model', 'monthlyCostUsd', 'monthlyUsd', 'name', 'notVerified', 'notes', 'output_tokens', 'over',
  'owner', 'parent_session_id', 'period', 'patherle', 'plan', 'privacy', 'project', 'read', 'repo',
  'repos', 'renewal30d', 'renewalDate', 'runs', 'saas', 'session_count', 'session_id', 'sessions',
  'services', 'source', 'sources', 'started_at', 'startedAt', 'state', 'status', 'storageGbIncluded', 'successful',
  'surface', 'thisMonth', 'thisWeek', 'thisYear', 'today', 'tokens', 'total_cache_creation',
  'total_cache_read', 'total_duration_seconds', 'total_input_tokens', 'total_output_tokens', 'total_tokens',
  'totals', 'tools', 'url', 'usageLabel', 'usagePct', 'usageValue', 'user_message_count', 'vendor',
  'visibility', 'watch', 'workflows', 'workspace',
].map((key) => key.replaceAll('_', '').replaceAll('-', '').toLowerCase()));
const unsafeStringPatterns = [
  /(?:^|[\s"'(])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root\/|[A-Za-z]:\\Users\\[^\\\s]+)/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,})\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];
const safeEnumValues = new Map([
  ['agent_id', new Set(['', ...Array.from({ length: 8 }, (_, index) => `demo-agent-${String(index * 7 + 8).padStart(3, '0')}`)])],
  ['cat_type', new Set(['builder', 'detective', 'commander', 'architect', 'guardian', 'storyteller', 'ghost'])],
  ['source', new Set(['claude', 'codex', 'cursor', 'aider', 'antigravity', 'hermes', 'synthetic-demo'])],
  ['health', new Set(['healthy', 'watch'])],
  ['category', new Set(['Development', 'Storage', 'Monitoring'])],
  ['environment', new Set(['Example'])],
  ['vendor', new Set(['Example vendor'])],
  ['notVerified', new Set([
    'Generated example data only',
    'No provider API was queried',
    'No billing or production values are represented',
  ])],
  ['currency', new Set(['USD'])],
  ['conclusion', new Set(['success'])],
  ['status', new Set(['completed', 'success', 'demo'])],
  ['state', new Set(['success'])],
  ['visibility', new Set(['private'])],
]);
const syntheticLabelPattern = /^(?:demo|sample|synthetic|example)(?:[- /]|$)[\p{L}\p{N} /._-]*$/iu;
const reservedUrlPattern = /^https:\/\/example\.(?:invalid|test)(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/;

function isAllowedPublicString(key, value) {
  if (value === '' || syntheticLabelPattern.test(value) || safeEnumValues.get(key)?.has(value)) return true;
  if (/^\d{4}-\d{2}(?:-\d{2})?(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) {
    return true;
  }
  return reservedUrlPattern.test(value);
}

function validateDemoAsset(fileName, source, expectedHash) {
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== expectedHash) {
    throw new Error(`${fileName} must match an approved synthetic fixture snapshot.`);
  }

  let value;
  try {
    value = JSON.parse(source.toString('utf8'));
  } catch {
    throw new Error(`${fileName} must be valid JSON before it can be published.`);
  }

  const baseName = fileName.slice('data/'.length);
  if (baseName === 'demo-sessions.json') {
    const validSession = row => row
      && /^demo-session-\d{4}$/.test(row.session_id)
      && /^Sample Archive [A-E]$/.test(row.project)
      && /^Demo Model [1-3]$/.test(row.model)
      && /^demo\/archive-[a-e]$/.test(row.git_branch);
    if (!Array.isArray(value) || value.length === 0 || value.some(row => !validSession(row))) {
      throw new Error(`${fileName} contains disallowed public demo data; synthetic labels are required.`);
    }
  }
  if (baseName === 'demo-cost-summary.json' && value?.source !== 'synthetic-demo') {
    throw new Error(`${fileName} must identify its values as synthetic.`);
  }
  if (baseName === 'demo-superadmin-usage.json' && value?.meta?.source !== 'synthetic-demo') {
    throw new Error(`${fileName} must identify its values as synthetic.`);
  }

  function visit(item, key = '') {
    if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
      return;
    }
    if (!item || typeof item !== 'object') {
      if (typeof item === 'string') {
        if (unsafeStringPatterns.some(pattern => pattern.test(item)) || !isAllowedPublicString(key, item)) {
          throw new Error(`${fileName} contains disallowed public demo data at field ${key || '(root)'}.`);
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      const normalizedKey = key.replaceAll('_', '').replaceAll('-', '').toLowerCase();
      if (forbiddenKeys.has(normalizedKey) || !allowedKeys.has(normalizedKey)) {
        throw new Error(`${fileName} contains disallowed public demo data.`);
      }
      visit(child, key);
    }
  }

  visit(value);
}

// Build output is shareable. Local data stays behind the loopback helper,
// even when building from a developer checkout containing private imports.
export async function collectPublicAssets(root, fixtureHashes = approvedFixtureHashes) {
  const assets = [];
  async function visit(relative = '') {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name.startsWith('data/') && !demoFiles.has(name.slice(5))) continue;
      if (entry.isSymbolicLink()) throw new Error('Public asset symlinks require explicit review before building.');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const source = await readFile(join(root, name));
        if (name.startsWith('data/') && demoFiles.has(name.slice(5))) {
          validateDemoAsset(name, source, fixtureHashes[name.slice(5)]);
        }
        assets.push({ fileName: name, source });
      }
    }
  }
  await visit();
  return assets;
}

export function publicDemoAssets(root) {
  return {
    name: 'public-demo-assets',
    apply: 'build',
    async generateBundle() {
      for (const asset of await collectPublicAssets(root)) this.emitFile({ type: 'asset', ...asset });
    },
  };
}
