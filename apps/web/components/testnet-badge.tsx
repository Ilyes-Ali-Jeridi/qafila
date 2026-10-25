'use client';
import ShinyText from '@/components/bits/ShinyText';
import { useHealth } from '@/lib/api/hooks';
import { usePublicConfig } from '@/lib/config';
import { cn } from '@/lib/utils';

/** Always visible on testnet (PLAN 9.1). Hidden only on mainnet. The dot shows indexer lag from GET /health. */
export function TestnetBadge() {
  const { data } = usePublicConfig();
  const health = useHealth();
  if (data?.network === 'mainnet') return null;
  const lag = health.data?.indexerLagSecs ?? null;
  const tone = health.isError ? 'bg-danger' : lag === null ? 'bg-ink-faint' : lag <= 15 ? 'bg-teal' : lag <= 60 ? 'bg-warning' : 'bg-danger';
  const lagText = health.isError ? 'API not reachable' : lag === null ? 'indexer lag unknown' : `indexer ${lag}s behind`;
  return (
    <div
      data-testid="testnet-badge"
      role="status"
      title={lagText}
      className="safe-bottom fixed bottom-3 left-3 z-50 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-surface-2/90 py-1 pl-2 pr-3 text-xs font-medium text-warning shadow-[0_0_0_1px_rgba(249,199,79,0.15),0_8px_30px_-8px_rgba(249,199,79,0.45)] backdrop-blur"
    >
      <span className="relative flex size-2">
        <span aria-hidden className={cn('live-dot absolute inline-flex size-full rounded-full', tone)} />
        <span className={cn('relative inline-flex size-2 rounded-full', tone)} />
      </span>
      <ShinyText text="Testnet, test money" color="#f9c74f" shineColor="#fff3c4" speed={5} glow={0} />
      <span className="sr-only">, {lagText}</span>
    </div>
  );
}
