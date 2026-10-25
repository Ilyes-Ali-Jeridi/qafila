import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'indigo' | 'success' | 'warning' | 'danger' | 'saffron';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sand-200 text-ink',
  indigo: 'bg-indigo-50 text-indigo',
  success: 'bg-success-100 text-success',
  warning: 'bg-warning-100 text-warning',
  danger: 'bg-danger-100 text-danger',
  saffron: 'bg-saffron-100 text-saffron-700',
};

export function Badge({ tone = 'neutral', className, dot, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5', tones[tone], className)} {...rest}>
      {dot ? <span aria-hidden className="live-dot size-1.5 rounded-full bg-current" /> : null}
      {rest.children}
    </span>
  );
}
