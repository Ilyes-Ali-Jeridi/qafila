import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'saffron' | 'teal';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-[var(--ease-out-expo)] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100';
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-saffron text-saffron-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_24px_-10px_rgba(242,178,62,0.7)] hover:bg-saffron-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_12px_32px_-10px_rgba(242,178,62,0.8)]',
  saffron: 'bg-saffron text-saffron-ink glow-saffron hover:bg-saffron-700',
  teal: 'bg-teal text-teal-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_24px_-10px_rgba(45,226,195,0.7)] hover:bg-teal-700',
  secondary: 'border border-line-strong bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.11]',
  outline: 'border border-line-strong bg-transparent text-ink hover:border-white/30 hover:bg-white/[0.05]',
  ghost: 'text-ink hover:bg-white/[0.06]',
  danger: 'bg-danger text-white shadow-[0_8px_24px_-10px_rgba(255,92,92,0.6)] hover:brightness-110',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm sm:h-10',
  lg: 'h-12 px-5 text-base',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  icon,
  external,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  icon?: ReactNode;
  external?: boolean;
}) {
  const cls = buttonClasses(variant, size, className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {icon}
      {children}
    </Link>
  );
}
