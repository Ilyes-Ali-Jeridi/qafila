import { STEPS } from './data';
import { cn } from '@/lib/utils';

export function StoryStack({ className }: { className?: string }) {
  return (
    <ol className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {STEPS.map((s) => (
        <li key={s.n} className="glass hairline-top relative overflow-hidden rounded-card p-6">
          <p className={cn('font-display text-5xl font-extrabold leading-none tracking-tighter opacity-25', s.accent)}>{s.n}</p>
          <p className="mt-3 font-display text-xl font-bold tracking-tight">{s.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
