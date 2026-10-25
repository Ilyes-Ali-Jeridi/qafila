'use client';
import { ExternalLink } from 'lucide-react';
import { useExplorer } from '@/lib/config';
import { cn } from '@/lib/utils';

/** Every on-chain action shows a stellar.expert link for the right network (CLAUDE.md). Teal marks on-chain. */
export function TxLink({ hash, className, label = 'View on stellar.expert', short }: { hash: string; className?: string; label?: string; short?: boolean }) {
  const explorer = useExplorer();
  const href = explorer.tx(hash);
  const text = short ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : label;
  if (!href) {
    return (
      <span className={cn('font-mono text-xs text-ink-muted', className)} title={hash}>
        tx {hash.slice(0, 8)}…
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex max-w-full items-center gap-1 text-sm text-teal underline-offset-2 transition-colors hover:text-teal-700 hover:underline', className)}
      title={hash}
    >
      <span className={cn('truncate', short ? 'font-mono text-xs' : undefined)}>{text}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

export function ContractLink({ id, className, label }: { id: string; className?: string; label?: string }) {
  const explorer = useExplorer();
  const href = explorer.contract(id);
  if (!href) return <span className={cn('font-mono text-xs', className)}>{id}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={id} className={cn('inline-flex max-w-full items-center gap-1 font-mono text-sm text-teal underline-offset-2 transition-colors hover:text-teal-700 hover:underline', className)}>
      <span className="truncate">{label ?? `${id.slice(0, 6)}…${id.slice(-4)}`}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
