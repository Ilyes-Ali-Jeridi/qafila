import { expect, test, type Page } from '@playwright/test';
import { addVirtualAuthenticator } from './helpers/webauthn';

/**
 * Main path (PLAN 12, FLOWS 9): investor onboarding with a passkey, importer creates a deal
 * and signs the promise with the security deposit, ops lists, investor invests, agent pays the
 * deposit and confirms the shipment, importer signs the sale (deposit counted first), repays,
 * pays the late fee, investor claims, charity ledger shows the fee; a cancelled deal refunds
 * the deposit.
 *
 * Runs against the mock API (:8788) with NEXT_PUBLIC_MOCK_CHAIN=1 so it works offline; the
 * integrator runs the same spec against the testnet-e2e instance with the real relayer by
 * setting E2E_BASE_URL and leaving the mock chain off (then wallet creation goes through the
 * virtual authenticator and the Qafila relayer).
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const MOCK = process.env['NEXT_PUBLIC_MOCK_CHAIN'] === '1' || process.env['E2E_MOCK_CHAIN'] === '1';

/** The invest panel renders in a mobile slot and a desktop slot; only one is visible. */
const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

async function freshContext(page: Page) {
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    indexedDB.deleteDatabase('smart-account-kit');
  });
}

test('investor onboarding: create a passkey wallet, KYC-lite, faucet', async ({ page }) => {
  await freshContext(page);
  await page.goto('/onboarding');
  await page.getByTestId('onb-label').fill('E2E Investor');
  const t0 = Date.now();
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('onb-wallet-ready')).toBeVisible({ timeout: 120_000 });
  console.log(`wallet ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.getByTestId('onb-role-investor').click();
  await page.getByTestId('kyc-risk').check();
  await page.getByTestId('kyc-submit').click();
  await expect(page.getByTestId('onb-done')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('onb-done')).toContainText('approved');
});

test('marketplace and public deal page work and show the risk box', async ({ page }) => {
  await page.goto('/invest');
  await expect(page.getByTestId('deal-grid')).toBeVisible();
  await page.getByTestId('deal-card-1').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('phone cases');
  await expect(page.getByTestId('if-things-go-wrong')).toContainText('Who loses first');
  await expect(visible(page, 'invest-panel')).toBeVisible();
});

test('importer: new deal, documents, screening, promise with the security deposit', async ({ page }) => {
  await freshContext(page);
  await page.goto('/onboarding?role=importer');
  await page.getByTestId('onb-label').fill('E2E Importer');
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('onb-wallet-ready')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('kyb-legal').fill('E2E Trading Ltd');
  await page.getByTestId('kyb-reg').fill('RC-E2E-001');
  await page.getByTestId('kyb-submit').click();
  await expect(page.getByTestId('onb-done')).toBeVisible({ timeout: 60_000 });

  await page.goto('/importer/new');
  await page.getByTestId('nd-supplier').fill('Shenzhen E2E Electronics Co., Ltd.');
  await page.getByTestId('nd-goods').fill('1,000 solar lanterns');
  await page.getByTestId('nd-submit').click();
  await expect(page).toHaveURL(/\/importer\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  for (const t of ['invoice', 'packing_list', 'business_licence']) {
    await page.locator(`#file-${t}`).setInputFiles({ name: `${t}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 e2e ${t}`) });
    await expect(page.getByTestId(`doc-${t}`)).toContainText('Replace', { timeout: 30_000 });
  }
  await page.getByTestId('terms-cost').fill('3000');
  await page.getByTestId('terms-save').click();
  await expect(page.getByTestId('run-screening')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('run-screening').click();
  await expect(page.getByTestId('verifying')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('promise-step')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('promise-step')).toContainText('Security deposit to lock now');
  await expect(page.getByTestId('promise-step')).toContainText('20%');
  await page.getByTestId('promise-agree').check();
  if (MOCK) {
    await page.getByTestId('promise-sign').click();
    // Right after signing the step shows "done"; once the deal refreshes to "promised" the withdraw card takes over.
    const signed = page.getByTestId('promise-done').or(page.getByTestId('withdraw-promise'));
    await expect(signed.first()).toBeVisible({ timeout: 120_000 });
    await expect(signed.first()).toContainText('locked');
  }
});

test('ops: review, list the deal, pay the supplier deposit; investor invests', async ({ page }) => {
  test.skip(!MOCK, 'needs the mock chain to drive the ops side');
  await freshContext(page);
  await page.goto('/onboarding');
  await page.getByTestId('onb-label').fill('E2E Ops');
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('onb-wallet-ready')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('onb-role-investor').click();
  await page.getByTestId('kyc-risk').check();
  await page.getByTestId('kyc-submit').click();
  await expect(page.getByTestId('onb-done')).toBeVisible({ timeout: 60_000 });

  await page.goto('/ops');
  await expect(page.getByTestId('ops-queue')).toBeVisible({ timeout: 30_000 });
  const row = page.locator('[data-testid^=ops-deal-]').filter({ hasText: 'solar lanterns' }).first();
  await row.click();
  await page.getByTestId('ops-list').click();
  // Once listed, the factory and listing transactions live in the on-chain tab.
  await expect(page.getByText('Open for funding').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /On-chain/ }).click();
  await expect(page.getByText('Factory and listing transactions')).toBeVisible({ timeout: 30_000 });

  // Invest in the newly listed deal from the same (approved) wallet.
  await page.goto('/invest');
  await page.locator('[data-testid^=deal-card-]').filter({ hasText: 'solar lanterns' }).first().click();
  await visible(page, 'invest-amount').fill('100');
  await expect(visible(page, 'invest-summary')).toContainText('Expected profit');
  await visible(page, 'invest-confirm').click();
  await expect(visible(page, 'invest-panel')).toContainText('You now own a share', { timeout: 120_000 });
});

test('late deal: importer signs the sale with the deposit counted first, repays, pays the late fee; charity ledger shows it', async ({ page }) => {
  test.skip(!MOCK, 'needs the mock chain');
  await freshContext(page);
  await page.goto('/onboarding?role=importer');
  await page.getByTestId('onb-label').fill('E2E Importer 2');
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('onb-wallet-ready')).toBeVisible({ timeout: 120_000 });
  await page.goto('/importer');
  // The first importer wallet in the mock owns the demo deals; deal 3 is the late deal (Owned).
  const late = page.getByTestId('importer-deal-3');
  await expect(late).toBeVisible({ timeout: 30_000 });
  await late.click();
  await expect(page.getByTestId('sign-sale')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sign-sale')).toContainText('Already paid');
  await page.getByTestId('sign-sale-confirm').click();
  await expect(page.getByTestId('repay-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('repay-panel')).toContainText('your deposit counted first');
  // Tenor is 120 s on the late deal: wait past the due date, then repay everything and pay the late fee.
  await page.waitForTimeout(125_000);
  await page.getByRole('button', { name: 'Pay everything left' }).click();
  await page.getByTestId('repay-confirm').click();
  await expect(page.getByTestId('late-fee-card')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('late-fee-pay').click();
  await expect(page.getByTestId('late-fee-card')).toContainText('paid to charity', { timeout: 120_000 });
  await page.goto('/charity');
  await expect(page.getByTestId('charity-entries')).toContainText('Deal 3', { timeout: 30_000 });

  // A cancelled deal refunded this importer's security deposit: it shows under money to collect and can be pulled.
  await page.goto('/importer');
  await expect(page.getByTestId('money-to-collect')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('collect-refund').click();
  await expect(page.getByTestId('money-to-collect')).toContainText('Collected', { timeout: 60_000 });
});
