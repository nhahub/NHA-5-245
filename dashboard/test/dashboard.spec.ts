import { expect, test, type Page } from '@playwright/test';
import { previousUtcMonth, type GatewayRequest } from '../shared/contract.ts';
import { reportFixture, statusFixture } from './fixtures.ts';

async function simulateGateway(page: Page) {
  const requests: GatewayRequest[] = [];
  let liveHealth: 'up' | 'down' = 'up';
  await page.route('**/api/sla', async route => {
    const request = route.request().postDataJSON() as GatewayRequest;
    requests.push(request);
    const dataset = request.dataset ?? 'live';
    if (request.action === 'get_report' && request.month === '1970-01') {
      await route.fulfill({ status: 404, json: { ok: false, code: 'REPORT_NOT_FOUND', error: 'No saved report.' } });
      return;
    }
    const success = (result: unknown) => route.fulfill({ json: { ok: true, action: request.action, execution_id: 'fixture', result } });
    if (request.action === 'check') {
      liveHealth = 'down';
      await success({ check: statusFixture('live', liveHealth).latest_check, transition: 'outage_started', duplicate: false });
    } else if (request.action === 'status') {
      await success(statusFixture(dataset, dataset === 'demo' ? 'unknown' : liveHealth));
    } else {
      const result = reportFixture(dataset, request.month);
      await success(request.action === 'report' ? { ...result, duplicate: false } : result);
    }
  });
  return requests;
}

test('status refresh is read-only and a stored HTTP 503 displays as down', async ({ page }) => {
  const requests = await simulateGateway(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Website status' })).toContainText('Operational');
  await expect(page.getByRole('group', { name: /availability timeline/i })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect.poll(() => requests.filter(request => request.action === 'status').length).toBeGreaterThanOrEqual(2);
  expect(requests.some(request => request.action === 'check')).toBe(false);
  await page.getByRole('button', { name: 'Run health check' }).click();
  await expect(page.getByRole('status')).toContainText('Check saved · Down');
  await expect(page.getByRole('region', { name: 'Website status' })).toContainText('Down');
  await page.getByRole('link', { name: 'Monitoring History' }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring History', exact: true })).toBeVisible();
  await page.getByLabel('Check status filter').selectOption('down');
  const check = page.getByRole('row').filter({ hasText: '503' });
  await expect(check).toContainText('Outage began');
  await expect(page.getByRole('row')).toHaveCount(2);
});

test('demo preserves stale status and shows the saved breach and copyable draft', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await simulateGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(page.getByText('Synthetic demo evidence', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Website status' })).toContainText('Unknown');
  await expect(page.getByRole('region', { name: 'Website status' })).toContainText('Stale sample');
  await expect(page.getByRole('button', { name: 'Run health check' })).toBeDisabled();
  await page.getByRole('link', { name: 'SLA Reports', exact: true }).click();
  await expect(page.getByLabel('Billing month')).toHaveValue(previousUtcMonth());
  await expect(page.getByText('Breaches SLA', { exact: true })).toBeVisible();
  await expect(page.getByText('99.731183%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate assessment' }).click();
  await expect(page.getByText('Assessment saved · Revision 2')).toBeVisible();
  await page.getByRole('link', { name: 'Review claim', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Claim Review', exact: true })).toBeVisible();
  await expect(page.getByLabel('Claim draft text')).toContainText('SLA GUARD CLAIM DRAFT');
  await page.getByRole('button', { name: 'Copy claim' }).click();
  await expect(page.getByText('Claim text copied to clipboard.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('SLA GUARD CLAIM DRAFT');
});

test('missing reports and pending live claims are clear', async ({ page }) => {
  await simulateGateway(page);
  await page.goto('/claims');
  await expect(page.getByText('A claim requires a completed UTC billing month.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy claim' })).toHaveCount(0);
  await page.getByLabel('Billing month').fill('1970-01');
  await expect(page.getByText('No saved report', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open SLA reports' })).toBeVisible();
});

test('mobile navigation and the persisted theme work without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await simulateGateway(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Website status' })).toContainText('Operational');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use dark theme' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('Expected response')).toBeVisible();
});
