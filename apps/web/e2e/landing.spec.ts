import { expect, test } from '@playwright/test';

test('landing renders the hook and the testnet badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('real shipment');
  await expect(page.getByTestId('testnet-badge')).toBeVisible();
});
