import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (PLAN 12). Default target is the local dev server against the mock API on :8788.
 * The integrator points E2E_BASE_URL at the testnet-e2e instance. The virtual WebAuthn
 * authenticator is set up per test via CDP (e2e/helpers/webauthn.ts).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 180_000,
        env: { NEXT_PUBLIC_API_BASE_URL: process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:8788', NEXT_PUBLIC_MOCK_CHAIN: process.env['NEXT_PUBLIC_MOCK_CHAIN'] ?? '0' },
      },
});
