'use client';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';
import { FAQ } from './data';
import { cn } from '@/lib/utils';

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div className="glass divide-y divide-line rounded-card">
      {FAQ.map(([q, a], i) => {
        const on = open === i;
        return (
          <div key={q}>
            <h3>
              <button
                type="button"
                aria-expanded={on}
                aria-controls={`${id}-${i}`}
                onClick={() => setOpen(on ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium transition-colors hover:bg-white/[0.03]"
              >
                <span className="min-w-0">{q}</span>
                <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-ink-muted transition-transform duration-300 ease-[var(--ease-out-expo)]', on && 'rotate-180')} />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {on ? (
                <motion.div
                  id={`${id}-${i}`}
                  key="body"
                  initial={{ opacity: 0, y: reduce ? 0 : -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -4 }}
                  transition={{ duration: reduce ? 0.15 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="px-5 pb-5 text-sm leading-relaxed text-ink-muted">{a}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
