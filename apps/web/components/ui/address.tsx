'use client';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { shortAddress } from '@qafila/shared';
import { useExplorer } from '@/lib/config';
import { cn } from '@/lib/utils';

/** Address chip: `GB67…EXAKN` with a copy action, the full value on hover and focus, and an explorer link. */
export function Address({ value, className, link = true, head = 4, tail = 4 }: { value: string; className?: string; link?: boolean; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  const explorer = useExplorer();
  const href = link ? (value.startsWith('C') ? explorer.contract(value) : explorer.account(value)) : null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }
  return (
    <span className={cn('group relative inline-flex max-w-full items-center gap-0.5 rounded-full border border-line bg-white/[0.04] py-0.5 pl-2.5 pr-1 font-mono text-xs', className)}>
      <span title={value} className="truncate">
        {shortAddress(value, head, tail)}
      </span>
      <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy address'} className="rounded-full p-1 text-ink-muted transition-colors hover:bg-white/[0.08] hover:text-ink">
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label="Open on stellar.expert" className="rounded-full p-1 text-ink-muted transition-colors hover:bg-white/[0.08] hover:text-teal">
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      <span
        aria-hidden
        className="glass-strong pointer-events-none absolute left-0 top-full z-20 mt-1 hidden max-w-[calc(100vw-2rem)] break-all rounded-md px-2 py-1 text-[11px] text-ink group-focus-within:block group-hover:block"
      >
        {value}
      </span>
    </span>
  );
}
