'use client';
import { formatAmount } from '@qafila/shared';
import { useToken } from '@/lib/config';
import { cn } from '@/lib/utils';

/**
 * Money, always from the API or the chain (i128 stroops as a string or bigint).
 * The token code and label ("test dollars") come from GET /config. Mono, integer part large,
 * decimals small; the text content stays exactly `1,234.56 qUSD`.
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
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showLabel?: boolean;
  sign?: boolean;
}) {
  const token = useToken();
  const n = BigInt(value);
  const text = formatAmount(n, token.code);
  const sp = text.lastIndexOf(' ');
  const number = sp > 0 ? text.slice(0, sp) : text;
  const code = sp > 0 ? text.slice(sp) : '';
  const dot = number.lastIndexOf('.');
  const whole = dot > 0 ? number.slice(0, dot) : number;
  const cents = dot > 0 ? number.slice(dot) : '';
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl font-semibold',
    xl: 'text-3xl font-semibold tracking-tight',
    '2xl': 'text-4xl font-bold tracking-tight sm:text-5xl',
  }[size];
  return (
    <span className={cn('tabular whitespace-nowrap font-mono', sizes, className)}>
      {sign && n > 0n ? '+' : ''}
      {whole}
      <span className="text-[0.72em] opacity-75">{cents}</span>
      <span className="text-[0.62em] font-normal text-ink-muted">{code}</span>
      {showLabel && token.label ? <span className="ml-1 font-sans text-xs font-normal text-ink-muted">({token.label})</span> : null}
    </span>
  );
}
