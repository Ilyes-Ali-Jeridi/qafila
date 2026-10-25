import { defineConfig, devices } from '@playwright/test';

/** E2E against the separate testnet instance (PLAN 12). The virtual WebAuthn authenticator is set up per test via CDP. */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
});
