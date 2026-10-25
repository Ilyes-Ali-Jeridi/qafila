import { cn } from '@/lib/utils';

/** Progress bar. The fill animates with a transform, never a layout property. */
export function Progress({ value, className, label, tone = 'indigo' }: { value: number; className?: string; label?: string; tone?: 'indigo' | 'success' | 'saffron' | 'teal' }) {
  const pct = Math.min(100, Math.max(0, value));
  const bar = {
    indigo: 'aurora-line shadow-[0_0_14px_rgba(45,226,195,0.45)]',
    teal: 'bg-teal shadow-[0_0_14px_rgba(45,226,195,0.55)]',
    success: 'bg-success shadow-[0_0_14px_rgba(61,220,151,0.5)]',
    saffron: 'bg-saffron shadow-[0_0_14px_rgba(242,178,62,0.5)]',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label ?? 'progress'}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]', className)}
    >
      <div className={cn('h-full w-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out-expo)]', bar)} style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
