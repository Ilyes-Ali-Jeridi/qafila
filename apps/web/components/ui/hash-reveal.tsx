'use client';
/** A transaction hash revealing character by character (ReactBits DecryptedText), with the stellar.expert link. */
import { ExternalLink } from 'lucide-react';
import DecryptedText from '@/components/bits/DecryptedText';
import { useExplorer } from '@/lib/config';
import { cn } from '@/lib/utils';

export function HashReveal({ hash, className, head = 8, tail = 6 }: { hash: string; className?: string; head?: number; tail?: number }) {
  const explorer = useExplorer();
  const href = explorer.tx(hash);
  const short = `${hash.slice(0, head)}…${hash.slice(-tail)}`;
  const inner = <DecryptedText text={short} animateOn="view" sequential speed={26} maxIterations={10} className="text-teal" encryptedClassName="text-teal/40" />;
  if (!href) return <span className={cn('font-mono text-sm', className)} title={hash}>{inner}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={hash} className={cn('inline-flex items-center gap-1.5 font-mono text-sm text-teal underline-offset-2 hover:underline', className)}>
      {inner}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">View on stellar.expert</span>
    </a>
  );
}
