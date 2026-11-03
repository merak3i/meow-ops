import { expect, test, type Page, type Route } from '@playwright/test';
import { SAMPLE_SWARM, type SwarmSnapshot } from '../src/lib/swarm-api';

// Swarm against a mocked helper: the Agents view reads one GET and writes
// nothing; Control drafts, dispatches with a nonce, and relays an approval.
test.use({ serviceWorkers: 'block' });

const snapshot: SwarmSnapshot = {
  ...SAMPLE_SWARM,
  scope: 'local-only',
  owner: { name: 'Ops lead', title: 'approval gate' },
  overlay: { path: '/private-fixture/.meow-ops/swarm.json', loaded: true, error: null },
  workspace: '/private-fixture/ws',
  workspaceSource: 'swarm.json',
  control: { dispatch: true, launcher: 'path', error: null, home: '/private-fixture/autoswarm', enabled: true },
};

type Json = Record<string, unknown>;
async function mockHelper(page: Page, handler: (path: string, method: string, body: Json | null) => unknown) {
  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):7337\//, (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/sync/status') return route.fulfill({ json: { ok: true, state: 'succeeded' } });
    expect(request.headers()['x-meow-ops-local']).toBe('1');
    const result = handler(path, request.method(), request.method() === 'POST' ? request.postDataJSON() as Json : null);
    return result === undefined ? route.abort() : route.fulfill({ json: result });
  });
}

test('Agents draws the orbit and proof per agent, and writes nothing', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => { if (/:7337\//.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  await mockHelper(page, (path) => (path === '/swarm/status' ? snapshot : undefined));
  await page.goto('/#/today/swarm');
  await expect(page).toHaveURL(/#\/swarm\/agents$/);
  await expect(page.getByRole('button', { name: /^Swarm/ }).first()).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute('aria-selected', 'true');
  const orbit = page.getByRole('group', { name: /^Agent swarm: 5 agents/ });
  await expect(orbit.getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Verification by agent' }).getByRole('row')).toHaveCount(6);
  await expect(page.getByRole('region', { name: 'Models by harness' })).toContainText('example-codex-mini');
  await orbit.getByRole('button', { name: /^Cursor, Found, not verified/ }).click();
  await expect(page.getByRole('heading', { name: 'Cursor', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('g w opens Swarm control, and an unverifiable status draws nothing', async ({ page }) => {
  await mockHelper(page, (path) => (path === '/swarm/status' ? { ok: true, schemaVersion: 1, providers: 'not-an-array' } : path === '/swarm/runs' ? { ok: true, runs: [] } : undefined));
  await page.goto('/#/ledger');
  await expect(page.getByRole('heading', { name: 'Ledger', exact: true })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('w');
  await expect(page).toHaveURL(/#\/swarm\/control$/);
  await expect(page.getByText(/could not be verified/)).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('group', { name: /^Agent swarm/ })).toHaveCount(0);
});

test('Control turns a template into a run, dispatches with a nonce and relays an approval', async ({ page }) => {
  const posts: { path: string; body: Json | null }[] = [];
  let run: Json | null = null;
  let nonce = 0;
  await mockHelper(page, (path, method, body) => {
    if (path === '/swarm/status') return snapshot;
    if (path === '/swarm/nonce') return { nonce: `nonce-${++nonce}` };
    if (method === 'POST') posts.push({ path, body });
    if (path === '/swarm/runs' && method === 'POST') {
      const plan = body?.plan as Json;
      run = { schemaVersion: 1, id: 'run_20261103120000_abcdef', purpose: 'work', title: plan.title, brief: plan.brief, workspace: plan.workspace, maxParallel: 3, peers: false, tags: [], status: 'draft', controllerId: null, createdAt: '2026-11-03T12:00:00Z', updatedAt: '2026-11-03T12:00:00Z', dispatchedAt: null, finishedAt: null, events: [], proposal: null,
        steps: (plan.steps as Json[]).map((step) => ({ ...step, status: 'draft', callId: null, nativeSessionId: null, startedAt: null, finishedAt: null, output: null, outputChars: 0, errorCode: null, error: null, pending: [], attempts: [] })) };
      return { ok: true, run };
    }
    if (path.endsWith('/dispatch')) {
      const steps = (run?.steps as Json[]).map((step, index) => ({ ...step, status: index === 0 ? 'waiting' : 'queued', callId: index === 0 ? 'call_abc' : null, startedAt: index === 0 ? '2026-11-03T12:00:01Z' : null, pending: index === 0 ? [{ requestId: `approval_${'a'.repeat(32)}`, kind: 'permission', title: 'Run npm test', createdAt: '2026-11-03T12:00:02Z' }] : [] }));
      run = { ...run, status: 'running', dispatchedAt: '2026-11-03T12:00:01Z', steps };
      return { ok: true, run };
    }
    if (path.endsWith('/decide')) {
      const steps = (run?.steps as Json[]).map((step, index) => (index === 0 ? { ...step, status: 'running', pending: [] } : step));
      run = { ...run, steps };
      return { ok: true, run };
    }
    if (path.startsWith('/swarm/runs/') && method === 'GET') return { ok: true, run };
    return undefined;
  });
  await page.goto('/#/swarm/control');
  await page.evaluate(() => localStorage.removeItem('meow-ops-swarm-plan'));
  await page.reload();
  await page.getByPlaceholder(/What should the team get done/).fill('Add rate limiting with tests');
  await page.getByRole('button', { name: /Build, review, fix/ }).click();
  await expect(page.getByRole('group', { name: 'Plan pipeline' }).locator('.sc-node')).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Plan pipeline' }).locator('.sc-node__title', { hasText: 'Review' })).toBeVisible();
  await expect(page.getByText('autoswarm run --agent codex --cwd /private-fixture/ws --background --no-parent --input prompts/s1-1.md', { exact: false })).toBeAttached();
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm dispatch' });
  await expect(dialog).toContainText('spends model calls');
  await dialog.getByRole('button', { name: /Dispatch now/ }).click();
  await expect(page.getByRole('group', { name: /^Pipeline for/ })).toBeVisible();
  await expect(page.getByText('Run npm test')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved\. The agent continues\./)).toBeVisible();

  const paths = posts.map((item) => item.path);
  expect(paths).toEqual(['/swarm/runs', '/swarm/runs/run_20261103120000_abcdef/dispatch', '/swarm/runs/run_20261103120000_abcdef/steps/s1/decide']);
  expect(posts[1]?.body?.nonce).toBe('nonce-1');
  expect(posts[2]?.body).toMatchObject({ nonce: 'nonce-2', decision: 'allow', requestId: `approval_${'a'.repeat(32)}` });
  const plan = posts[0]?.body?.plan as Json;
  expect((plan.steps as Json[]).map((step) => step.kind)).toEqual(['execute', 'review', 'execute']);
});
