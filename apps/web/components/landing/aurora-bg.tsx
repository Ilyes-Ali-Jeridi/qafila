'use client';
/** Aurora hero background (ReactBits, WebGL). Loaded only in the browser; a static gradient stands in before and under reduced motion. */
import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';

const Aurora = dynamic(() => import('@/components/bits/Aurora'), { ssr: false });

export function AuroraBg() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_30%_0%,rgba(59,76,255,0.28),transparent_60%),radial-gradient(50%_40%_at_80%_10%,rgba(45,226,195,0.18),transparent_60%),radial-gradient(40%_30%_at_60%_0%,rgba(242,178,62,0.12),transparent_60%)]" />
      {reduce ? null : <Aurora colorStops={['#3B4CFF', '#2DE2C3', '#F2B23E']} amplitude={0.9} blend={0.55} speed={0.55} layers={2} opacity={0.75} direction="top" mouseInteraction={false} className="absolute inset-0 h-full w-full" />}
    </div>
  );
}
