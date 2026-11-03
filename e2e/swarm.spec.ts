import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_SWARM, type SwarmSnapshot } from '../src/lib/swarm-api';

// Today · Swarm against a mocked helper. The page must read one GET, draw the
// orbit and the proof per agent, hand out exact commands, and write nothing.
test.use({ serviceWorkers: 'block' });

const fixture: SwarmSnapshot = {
  ...SAMPLE_SWARM,
  scope: 'local-only',
  owner: { name: 'Ops lead', title: 'approval gate' },
  overlay: { path: '/private-fixture/.meow-ops/swarm.json', loaded: true, error: null },
  workspaceSource: 'swarm.json',
};

async function mockHelper(page: Page, body: unknown) {
  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):7337\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/swarm/status') {
      expect(request.method()).toBe('GET');
      expect(request.headers()['x-meow-ops-local']).toBe('1');
      return route.fulfill({ json: body });
    }
    if (path === '/sync/status') return route.fulfill({ json: { ok: true, state: 'succeeded' } });
    return route.abort();
  });
}

test('Swarm draws the orbit, proof per agent and copyable commands, and starts nothing', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (/:7337\//.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await mockHelper(page, fixture);
  await page.goto('/#/swarm');

  await expect(page).toHaveURL(/#\/today\/swarm$/);
  await expect(page.getByRole('tab', { name: 'Swarm', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Read only · commands run in your terminal')).toBeVisible();

  const orbit = page.getByRole('group', { name: /^Agent swarm: 5 agents/ });
  await expect(orbit).toBeVisible();
  await expect(orbit.getByRole('button')).toHaveCount(5);
  await expect(orbit.getByText('Ops lead')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Verification by agent' }).getByRole('row')).toHaveCount(6);
  await expect(page.getByText('autoswarm doctor --agent cursor --agent hermes --agent dsh --probe --cwd ~/projects/example-app', { exact: true })).toBeVisible();

  await orbit.getByRole('button', { name: /^Cursor, Found, not verified/ }).click();
  await expect(page.getByRole('heading', { name: 'Cursor', exact: true })).toBeVisible();
  await expect(page.getByText('autoswarm doctor --agent cursor --probe --cwd ~/projects/example-app', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Cursor', exact: true })).toHaveCount(0);

  expect(writes).toEqual([]);
});

test('g w jumps to the swarm, and an unverifiable response draws nothing', async ({ page }) => {
  await mockHelper(page, { ok: true, schemaVersion: 1, providers: 'not-an-array' });
  await page.goto('/#/ledger');
  await expect(page.getByRole('heading', { name: 'Ledger', exact: true })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('w');
  await expect(page).toHaveURL(/#\/today\/swarm$/);
  await expect(page.getByText(/could not be verified/)).toBeVisible();
  await expect(page.getByRole('group', { name: /^Agent swarm/ })).toHaveCount(0);
});
