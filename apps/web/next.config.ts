import type { NextConfig } from 'next';

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
    // smart-account-kit's optional wallet adapter imports the JSR scope; the npm build is the same API.
    config.resolve.alias = { ...config.resolve.alias, '@creit-tech/stellar-wallets-kit': '@creit.tech/stellar-wallets-kit' };
    return config;
  },
};

export default nextConfig;
