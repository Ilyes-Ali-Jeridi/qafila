import { cn } from '@/lib/utils';

/** FLOWS 5.5: the loss order as a three-step rail. Text comes from the deal (lossOrder). */
export function LossRail({ steps, className }: { steps: string[]; className?: string }) {
  const tones = ['bg-saffron text-saffron-ink shadow-[0_0_14px_rgba(242,178,62,0.6)]', 'bg-teal text-teal-ink shadow-[0_0_14px_rgba(45,226,195,0.55)]', 'bg-indigo-300 text-page shadow-[0_0_14px_rgba(142,155,255,0.6)]'];
  return (
    <ol className={cn('relative space-y-3', className)}>
      <span aria-hidden className="absolute left-[11px] top-3 h-[calc(100%-1.5rem)] w-px bg-gradient-to-b from-saffron/60 via-teal/50 to-indigo-300/40" />
      {steps.map((s, i) => (
        <li key={s} className="relative flex items-start gap-3">
          <span className={cn('tabular relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ring-4 ring-surface', tones[i] ?? tones[2])}>{i + 1}</span>
          <span className="min-w-0 pt-0.5 text-sm leading-snug">{s}</span>
        </li>
      ))}
    </ol>
  );
}
