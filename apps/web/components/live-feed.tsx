'use client';
/** Live feed: the latest indexed on-chain events with stellar.expert links, refreshed every 8 s. The ledger variant streams rows in the hero. */
import { ExternalLink } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import DecryptedText from '@/components/bits/DecryptedText';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useEvents } from '@/lib/api/hooks';
import { useExplorer } from '@/lib/config';
import { cn, timeAgo } from '@/lib/utils';

export function LiveFeed({ limit = 8, variant = 'list' }: { limit?: number; variant?: 'list' | 'ledger' }) {
  const q = useEvents(limit);
  const explorer = useExplorer();
  const reduce = useReducedMotion();
  const ledger = variant === 'ledger';
  if (q.isPending) {
    return (
      <ul className={cn('divide-y divide-line', !ledger && 'glass rounded-card')}>
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3 py-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-16" />
          </li>
        ))}
      </ul>
    );
  }
  if (q.isError) return <ErrorState compact title="The live feed is not available" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) return <p className="rounded-card border border-dashed border-line-strong p-4 text-sm text-ink-muted">No on-chain events yet. The first one appears when an importer signs a purchase promise.</p>;
  return (
    <ul className={cn('divide-y divide-line', !ledger && 'glass rounded-card')} data-testid="live-feed" aria-live="polite">
      <AnimatePresence initial={false}>
        {q.data.map((e) => {
          const href = explorer.tx(e.txHash);
          const short = `${e.txHash.slice(0, 6)}…${e.txHash.slice(-4)}`;
          return (
            <motion.li
              key={`${e.txHash}-${e.type}`}
              layout={!reduce}
              initial={{ opacity: 0, y: reduce ? 0 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={cn('flex gap-3 text-sm', ledger ? 'items-start px-3 py-2.5' : 'flex-col px-4 py-3 sm:flex-row sm:items-center sm:justify-between')}
            >
              {ledger ? <span className="tabular w-16 shrink-0 pt-0.5 font-mono text-[11px] text-ink-faint">{timeAgo(e.at)}</span> : null}
              <div className="min-w-0 flex-1">
                <p className="leading-snug">
                  {e.dealId ? (
                    <Link href={`/deals/${e.dealId}`} className="font-medium text-ink underline-offset-2 hover:underline">
                      Deal {e.dealNumber}
                    </Link>
                  ) : null}{' '}
                  <span className={ledger ? 'text-ink-muted' : undefined}>{e.summary}</span>
                </p>
                {ledger ? (
                  href ? (
                    <a href={href} target="_blank" rel="noreferrer" title={e.txHash} className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-teal hover:underline">
                      <DecryptedText text={short} animateOn="view" sequential speed={28} maxIterations={8} className="text-teal" encryptedClassName="text-teal/50" />
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-ink-faint">{short}</span>
                  )
                ) : null}
              </div>
              {!ledger ? (
                <div className="flex shrink-0 items-center gap-3 text-xs text-ink-muted">
                  <span className="tabular font-mono">{timeAgo(e.at)}</span>
                  <TxLink hash={e.txHash} short />
                </div>
              ) : null}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
