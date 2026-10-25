/**
 * Runtime config from GET /config (CLAUDE.md: never a hard-coded contract id).
 * Everything chain-related in the browser comes from here: network, RPC, contract id,
 * settlement token, smart-account deployments, feature flags.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { NETWORKS, PublicConfigSchema, type FeatureFlag, type PublicConfig } from '@qafila/shared';
import { apiGet } from './api/client';

export async function getPublicConfig(): Promise<PublicConfig> {
  return apiGet('/config', PublicConfigSchema);
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['config'], queryFn: getPublicConfig, staleTime: 60_000, retry: 2 });
}

/** Settlement token code and label ("test dollars" on testnet). Empty until config loads. */
export function useToken(): { code: string; label: string; id: string | null } {
  const { data } = usePublicConfig();
  if (!data) return { code: '', label: '', id: null };
  return { code: data.settlementToken.code, label: data.settlementToken.label, id: data.settlementToken.id };
}

/** stellar.expert links for the configured network; null on a local network. */
export function useExplorer() {
  const { data } = usePublicConfig();
  const base = data ? NETWORKS[data.network].expert : null;
  return {
    base,
    tx: (hash: string) => (base ? `${base}/tx/${hash}` : null),
    contract: (id: string) => (base ? `${base}/contract/${id}` : null),
    account: (id: string) => (base ? `${base}/account/${id}` : null),
    asset: (code: string, issuer: string) => (base ? `${base}/asset/${code}-${issuer}` : null),
  };
}

/** A feature flag is false until config loads, so flagged UI never flashes (CLAUDE.md). */
export function useFlag(flag: FeatureFlag): boolean {
  const { data } = usePublicConfig();
  return data?.flags[flag] ?? false;
}
