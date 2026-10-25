'use client';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { shortAddress } from '@qafila/shared';
import { useExplorer } from '@/lib/config';
import { cn } from '@/lib/utils';

/** Shortened address with a copy button and, when the network has an explorer, a link (PLAN 9.2). */
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
    <span className={cn('inline-flex items-center gap-1 font-mono text-sm', className)}>
      <span title={value}>{shortAddress(value, head, tail)}</span>
      <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy address'} className="rounded p-1 text-ink-muted hover:bg-sand-200 hover:text-ink">
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label="Open on stellar.expert" className="rounded p-1 text-ink-muted hover:bg-sand-200 hover:text-ink">
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}
