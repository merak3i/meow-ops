import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { collectPublicAssets } from '../build-public-assets.mjs';
import { loadConfigFromFile } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const demoFileNames = ['demo-sessions.json', 'demo-cost-summary.json', 'demo-superadmin-usage.json'];

test('Vite config loads with only the sync modules allowed into Vercel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meow-vercel-config-'));
  try {
    const ignore = await readFile(join(ROOT, '.vercelignore'), 'utf8');
    const modules = ignore.split(/\r?\n/).filter(line => /^!sync\/[\w-]+\.mjs$/.test(line));
    await mkdir(join(root, 'sync'));
    for (const entry of modules) {
      const path = entry.slice(1);
      await copyFile(join(ROOT, path), join(root, path));
    }
    await cp(join(ROOT, 'src/pages/loop-ops'), join(root, 'src/pages/loop-ops'), { recursive: true });
    await copyFile(join(ROOT, 'vite.config.js'), join(root, 'vite.config.js'));
    await copyFile(join(ROOT, 'package.json'), join(root, 'package.json'));
    await symlink(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
    const result = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'vite.config.js'), root);
    assert.ok(result?.config, 'the packaged build config must resolve its dependencies');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function collectTestAssets(root) {
  const fixtureHashes = {};
  for (const fileName of demoFileNames) {
    try {
      const source = await readFile(join(root, 'data', fileName));
      fixtureHashes[fileName] = createHash('sha256').update(source).digest('hex');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return collectPublicAssets(root, fixtureHashes);
}

test('production assets include demo data and static files but exclude all private data names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meow-public-build-'));
  try {
    await mkdir(join(root, 'data/private'), { recursive: true });
    await writeFile(join(root, 'data', 'demo-sessions.json'), JSON.stringify([{
      session_id: 'demo-session-0001', project: 'Sample Archive A', model: 'Demo Model 1', git_branch: 'demo/archive-a',
    }]));
    await writeFile(join(root, 'data', 'demo-cost-summary.json'), JSON.stringify({ source: 'synthetic-demo' }));
    await writeFile(join(root, 'data', 'demo-superadmin-usage.json'), JSON.stringify({ meta: { source: 'synthetic-demo' } }));
    for (const name of ['sessions.json', 'rate-limits.json', 'new-private-report.json', 'private/events.json']) {
      await writeFile(join(root, 'data', name), 'PRIVATE_FIXTURE');
    }
    await writeFile(join(root, 'sw.js'), 'STATIC');
    const assets = await collectTestAssets(root);
    assert.deepEqual(assets.map(asset => asset.fileName).sort(), [
      'data/demo-cost-summary.json', 'data/demo-sessions.json', 'data/demo-superadmin-usage.json', 'sw.js',
    ]);
    assert.ok(assets.every(asset => !asset.source.includes('PRIVATE_FIXTURE')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production assets reject local session fields and identifying or credential-like demo strings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meow-public-demo-safety-'));
  const file = join(root, 'data', 'demo-sessions.json');
  try {
    await mkdir(join(root, 'data'), { recursive: true });
    const session = {
      session_id: 'demo-session-0001', project: 'Sample Archive A', model: 'Demo Model 1', git_branch: 'demo/archive-a',
    };
    const unsafeSamples = [
      { ...session, cwd: '/Users/example/private-project' },
      { ...session, first_user_message: 'private source content' },
      { ...session, source: ['demo', '@', 'example.invalid'].join('') },
      { ...session, source: ['sk-', 'demo-test-', 'value-12345'].join('') },
      { ...session, source: ['ghp_', '0123456789', '0123456789', '01234567890123456789'].join('') },
      { ...session, project: 'Private client name' },
      { ...session, owner: 'Fictional Client 42' },
      { ...session, user_id: 'unreviewed-field' },
    ];
    for (const sample of unsafeSamples) {
      await writeFile(file, JSON.stringify([sample]));
      await assert.rejects(collectTestAssets(root), /contains disallowed public demo data/);
    }
    await writeFile(file, JSON.stringify([{ ...session, owner: 'Demo Client 42' }]));
    assert.equal((await collectTestAssets(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production accepts only the pinned synthetic metrics, even when an altered file keeps its marker', async () => {
  const publicRoot = join(ROOT, 'public');
  const pinnedAssets = await collectPublicAssets(publicRoot);
  assert.deepEqual(
    pinnedAssets.map(asset => asset.fileName).filter(name => name.startsWith('data/')).sort(),
    demoFileNames.map(name => `data/${name}`).sort(),
  );

  const root = await mkdtemp(join(tmpdir(), 'meow-public-metrics-pin-'));
  try {
    const source = JSON.parse(await readFile(join(publicRoot, 'data', 'demo-cost-summary.json'), 'utf8'));
    source.today.cost += 1;
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'demo-cost-summary.json'), JSON.stringify(source));
    await assert.rejects(collectPublicAssets(root), /approved synthetic fixture snapshot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production public assets cannot follow a symlink outside their directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meow-public-link-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'secret'), 'PRIVATE_FIXTURE');
    await symlink(join(root, 'secret'), join(root, 'public', 'linked'));
    await assert.rejects(collectPublicAssets(join(root, 'public')), /symlinks require explicit review/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Vercel does not retain public demo JSON in client or CDN caches', async () => {
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const cacheHeaders = new Map(config.headers.map((entry) => [
    entry.source,
    Object.fromEntries(entry.headers.map(({ key, value }) => [key, value])),
  ]));
  for (const path of [
    '/data/sessions.json',
    '/data/demo-sessions.json',
    '/data/cost-summary.json',
    '/data/demo-cost-summary.json',
    '/data/demo-superadmin-usage.json',
  ]) {
    assert.equal(cacheHeaders.get(path)?.['Cache-Control'], 'no-store', path);
    assert.equal(cacheHeaders.get(path)?.['Vercel-CDN-Cache-Control'], 'no-store', path);
  }
});

test('Vercel removes wildcard CORS from every response', async () => {
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const transform = config.routes
    .find((route) => route.src === '/(.*)')
    ?.transforms?.find((entry) => entry.type === 'response.headers'
      && entry.op === 'delete'
      && entry.target?.key === 'Access-Control-Allow-Origin');

  assert.ok(transform, 'a catch-all response transform must remove Access-Control-Allow-Origin');
});

test('service worker deletes its prior cache and passes public demo data through', async () => {
  const source = await readFile(join(ROOT, 'public', 'sw.js'), 'utf8');
  const handlers = new Map();
  const deleted = [];
  const cache = { addAll: async () => undefined };
  const self = {
    location: new URL('http://localhost:4173/'),
    clients: { claim: async () => undefined },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: () => undefined,
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['meow-ops-v2', 'meow-ops-v3'],
    delete: async (name) => { deleted.push(name); return true; },
    match: async () => undefined,
  };
  runInNewContext(source, { self, caches, URL, fetch: async () => new Response() });

  let activation;
  handlers.get('activate')({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['meow-ops-v2']);

  for (const path of [
    '/data/sessions.json',
    '/data/demo-sessions.json',
    '/data/cost-summary.json',
    '/data/demo-cost-summary.json',
    '/data/demo-superadmin-usage.json',
  ]) {
    let intercepted = false;
    handlers.get('fetch')({
      request: {
        url: `http://localhost:4173${path}`,
        method: 'GET',
        cache: 'default',
        mode: 'cors',
      },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false, path);
  }
});
