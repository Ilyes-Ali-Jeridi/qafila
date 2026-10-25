import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const localRequire = createRequire(import.meta.url);
/** Resolve a package entry (ESM when the runtime can, else CJS) to pin one stellar-sdk copy in the browser. */
function entry(spec: string): string {
  try {
    return fileURLToPath(import.meta.resolve(spec));
  } catch {
    return localRequire.resolve(spec);
  }
}

/**
 * Webpack is used (dev and build) because packages/shared imports its own files with `.js`
 * extensions (TypeScript ESM style) and Turbopack does not map `.js` to `.ts` inside a
 * transpiled workspace package. extensionAlias below does. Track B was asked to drop the
 * extensions (/.shared/requests-product.md); then Turbopack can come back.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  transpilePackages: ['@qafila/shared', '@qafila/contract-client'],
  serverExternalPackages: ['@stellar/stellar-sdk'],
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    config.resolve.alias = {
      ...config.resolve.alias,
      // smart-account-kit's optional wallet adapter imports the JSR scope; the npm build is the same API.
      '@creit-tech/stellar-wallets-kit': '@creit.tech/stellar-wallets-kit',
      // One stellar-sdk copy in the browser (16.4.1, required by smart-account-kit 0.8.0); the generated
      // bindings declare 17.4.0 but use only the stable contract client API. See docs/SPIKES-product.md.
      '@stellar/stellar-sdk$': entry('@stellar/stellar-sdk'),
      '@stellar/stellar-sdk/contract$': entry('@stellar/stellar-sdk/contract'),
      '@stellar/stellar-sdk/rpc$': entry('@stellar/stellar-sdk/rpc'),
    };
    return config;
  },
};

export default nextConfig;
