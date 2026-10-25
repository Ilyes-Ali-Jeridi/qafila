'use client';
/** Magnetic wrapper for a primary call to action (ReactBits Magnet). Static under reduced motion. */
import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import Magnet from '@/components/bits/Magnet';

export function MagnetCta({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Magnet padding={40} magnetStrength={4} disabled={Boolean(reduce)} wrapperClassName={className} innerClassName="inline-flex">
      {children}
    </Magnet>
  );
}
