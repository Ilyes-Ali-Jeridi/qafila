import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@qafila/shared', '@qafila/contract-client'],
  serverExternalPackages: ['@stellar/stellar-sdk'],
};

export default nextConfig;
