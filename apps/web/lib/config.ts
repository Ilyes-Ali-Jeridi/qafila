/**
 * Runtime config from GET /config (CLAUDE.md: never a hard-coded contract id).
 * Server components call getPublicConfig(); client components use usePublicConfig().
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { PublicConfigSchema, type PublicConfig } from '@qafila/shared';
import { apiGet } from './api/client';

export async function getPublicConfig(): Promise<PublicConfig> {
  return apiGet('/config', PublicConfigSchema);
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['config'], queryFn: getPublicConfig, staleTime: 60_000 });
}
