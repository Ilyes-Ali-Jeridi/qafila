import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { addVirtualAuthenticator } from './helpers/webauthn';

/**
 * SP5 (PLAN 3.2): a passkey smart account created with smart-account-kit calls a contract
 * function that does require_auth on it and a SAC transfer, with fees sponsored by the relayer.
 * Runs against the dev harness at /dev/sp5 with a virtual authenticator. Needs the mock API
 * (for /config and the testnet faucet) and testnet reachability.
 */
test.describe.configure({ timeout: 420_000 });

test('SP5: passkey wallet calls probe(require_auth + transfer) with sponsored fees', async ({ page }) => {
  await addVirtualAuthenticator(page);
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser:${m.type()}] ${m.text().slice(0, 300)}`);
  });
  await page.goto('/dev/sp5');
  await expect(page.getByTestId('sp5')).toBeVisible();
  const probe = process.env['PROBE_CONTRACT_ID'];
  if (probe) await page.getByTestId('sp5-probe').fill(probe);

  const results: Record<string, { ok: boolean; line: string; hash?: string; secs?: number }> = {};
  async function run(step: string, button: string, timeout: number) {
    const before = await page.getByTestId('sp5-log').locator('li').count();
    const t0 = Date.now();
    await page.getByTestId(button).click();
    const done = page.getByTestId('sp5-log').locator('li[data-ok]').nth(await page.getByTestId('sp5-log').locator('li[data-ok]').count());
    await expect(done).toBeVisible({ timeout });
    const items = await page.getByTestId('sp5-log').locator('li').allTextContents();
    const line = items.slice(before).find((l) => /PASS|FAIL/.test(l)) ?? items[items.length - 1]!;
    const hash = (await done.locator('[data-testid=sp5-hash]').textContent().catch(() => null)) ?? undefined;
    results[step] = { ok: /PASS/.test(line), line, hash, secs: (Date.now() - t0) / 1000 };
    console.log(`SP5 ${step}: ${line}`);
  }

  await run('create_wallet', 'sp5-create', 240_000);
  expect(results['create_wallet']?.ok, results['create_wallet']?.line).toBe(true);
  const address = await page.getByTestId('sp5-address').textContent();
  console.log(`SP5 wallet: ${address}`);
  await run('faucet', 'sp5-faucet', 120_000);
  await run('probe_execute', 'sp5-execute', 240_000);
  await run('probe_direct', 'sp5-direct', 240_000);

  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/sp5.json', JSON.stringify({ address, results, at: new Date().toISOString() }, null, 2));
  expect(results['probe_execute']?.ok || results['probe_direct']?.ok, JSON.stringify(results, null, 2)).toBe(true);
});
