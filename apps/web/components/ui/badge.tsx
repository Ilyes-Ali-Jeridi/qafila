import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'indigo' | 'success' | 'warning' | 'danger' | 'saffron' | 'teal';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.06] text-ink ring-white/10',
  indigo: 'bg-indigo-100 text-indigo ring-indigo-300/20',
  success: 'bg-success-100 text-success ring-success/20',
  warning: 'bg-warning-100 text-warning ring-warning/20',
  danger: 'bg-danger-100 text-danger ring-danger/20',
  saffron: 'bg-saffron-100 text-saffron-700 ring-saffron/25',
  teal: 'bg-teal-100 text-teal ring-teal/25',
};

export function Badge({ tone = 'neutral', className, dot, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ring-1 ring-inset', tones[tone], className)} {...rest}>
      {dot ? <span aria-hidden className="live-dot size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" /> : null}
      {rest.children}
    </span>
  );
}
