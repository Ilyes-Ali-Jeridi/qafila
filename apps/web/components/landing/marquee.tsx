'use client';
/** Full-bleed marquee of the latest on-chain events, each with its stellar.expert link. Pauses on hover and focus; static under reduced motion. */
import Link from 'next/link';
import { useEvents } from '@/lib/api/hooks';
import { TxLink } from '@/components/ui/tx-link';
import { timeAgo } from '@/lib/utils';

export function TxMarquee() {
  const q = useEvents(12);
  if (q.isPending || q.isError || q.data.length === 0) return null;
  const items = q.data;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-3 pr-3" aria-hidden={hidden || undefined}>
      {items.map((e) => (
        <li key={`${e.txHash}-${e.type}`} className="glass flex shrink-0 items-center gap-3 rounded-full py-1.5 pl-3 pr-2 text-xs">
          {e.dealId ? (
            <Link href={`/deals/${e.dealId}`} className="font-medium text-ink hover:underline" tabIndex={hidden ? -1 : undefined}>
              Deal {e.dealNumber}
            </Link>
          ) : null}
          <span className="max-w-[16rem] truncate text-ink-muted">{e.summary}</span>
          <span className="font-mono text-ink-faint">{timeAgo(e.at)}</span>
          <span className="rounded-full bg-teal-100 px-2 py-0.5">
            <TxLink hash={e.txHash} short className="text-xs" />
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="marquee relative -mx-4 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] motion-reduce:overflow-x-auto motion-reduce:[mask-image:none]" aria-label="Recent transactions">
      <div className="marquee-track flex w-max" style={{ ['--marquee-duration' as string]: `${Math.max(30, items.length * 6)}s` }}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
