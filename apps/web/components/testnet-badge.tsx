'use client';
import { usePublicConfig } from '@/lib/config';

/** Always visible on testnet (PLAN 9.1). Hidden only on mainnet. */
export function TestnetBadge() {
  const { data } = usePublicConfig();
  if (data?.network === 'mainnet') return null;
  return (
    <div
      data-testid="testnet-badge"
      role="status"
      className="fixed bottom-3 left-3 z-50 rounded-full bg-warning px-3 py-1 text-xs font-medium text-white shadow"
    >
      Testnet, test money
    </div>
  );
}
