import { Ship } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Origin to destination as a dashed line with a ship marker. Used on deal cards and headers. */
export function RouteLine({ origin, destination, className, compact }: { origin: string; destination: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="min-w-0 truncate font-medium">{origin}</span>
      <span aria-hidden className="relative h-px min-w-6 flex-1 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.35)_0_4px,transparent_4px_8px)]">
        <span className="absolute left-1/2 top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-teal/40 bg-page text-teal">
          <Ship className={compact ? 'size-2.5' : 'size-3'} />
        </span>
      </span>
      <span className="min-w-0 truncate font-medium">{destination}</span>
    </div>
  );
}
