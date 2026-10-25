'use client';
/**
 * Number ticks for stats and amounts. The value is always a real number from the API; the
 * tick only animates between the previous and the new value. Reduced motion renders at once.
 */
import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export function useTicked(value: number, duration = 1.1): number {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduce || prev.current === value) {
      prev.current = value;
      setShown(value);
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        prev.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduce]);
  return shown;
}

export function Tick({ value, decimals = 0, className, prefix = '', suffix = '' }: { value: number; decimals?: number; className?: string; prefix?: string; suffix?: string }) {
  const v = useTicked(value);
  return (
    <span className={className}>
      {prefix}
      {v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
