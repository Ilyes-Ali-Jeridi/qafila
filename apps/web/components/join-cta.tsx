'use client';
import Link from 'next/link';
import { QrCode } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { useFlag } from '@/lib/config';

/** Join button for the venue (S6). Renders only when FF_QR_JOIN is on (CLAUDE.md: flag off, nothing renders). */
export function JoinCta({ className }: { className?: string }) {
  const on = useFlag('FF_QR_JOIN');
  if (!on) return null;
  return (
    <Link href="/join" className={buttonClasses('saffron', 'md', className)} data-testid="join-cta">
      <QrCode className="size-4" /> Join at the venue
    </Link>
  );
}
