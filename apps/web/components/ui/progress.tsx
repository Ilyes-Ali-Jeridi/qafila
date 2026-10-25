import { cn } from '@/lib/utils';

export function Progress({ value, className, label, tone = 'indigo' }: { value: number; className?: string; label?: string; tone?: 'indigo' | 'success' | 'saffron' }) {
  const pct = Math.min(100, Math.max(0, value));
  const bar = { indigo: 'bg-indigo', success: 'bg-success', saffron: 'bg-saffron' }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label ?? 'progress'}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-sand-200', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-700', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
