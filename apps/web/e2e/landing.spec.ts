import { expect, test } from '@playwright/test';

test('landing renders the hook, live stats, the feed and the testnet badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('real shipment');
  await expect(page.getByTestId('testnet-badge')).toBeVisible();
  await expect(page.getByTestId('live-stats')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('live-feed')).toBeVisible({ timeout: 30_000 });
});

test('charity ledger and verifier page work logged out', async ({ page }) => {
  await page.goto('/charity');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Charity ledger');
  await page.goto('/verifier');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Verifier key');
});
