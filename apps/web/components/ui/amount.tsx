'use client';
import { formatAmount } from '@qafila/shared';
import { useToken } from '@/lib/config';
import { cn } from '@/lib/utils';

/**
 * Money, always from the API or the chain (i128 stroops as a string or bigint).
 * The token code and label ("test dollars") come from GET /config.
 */
export function Amount({
  value,
  className,
  size = 'md',
  showLabel = false,
  sign,
}: {
  value: bigint | string | number;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  sign?: boolean;
}) {
  const token = useToken();
  const n = BigInt(value);
  const text = formatAmount(n, token.code);
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-xl font-semibold', xl: 'text-3xl font-semibold tracking-tight' }[size];
  return (
    <span className={cn('tabular whitespace-nowrap', sizes, className)}>
      {sign && n > 0n ? '+' : ''}
      {text}
      {showLabel && token.label ? <span className="ml-1 text-xs font-normal text-ink-muted">({token.label})</span> : null}
    </span>
  );
}
