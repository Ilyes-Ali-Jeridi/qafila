'use client';
/**
 * The four steps as a pinned scroll story (GSAP ScrollTrigger). Pinned only on wide screens
 * without reduced motion; everywhere else the same four cards stack. Loaded only in the browser.
 */
import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { STEPS } from './data';
import { StoryStack } from './story-stack';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function Story() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        el.classList.add('is-pinned');
        const panels = gsap.utils.toArray<HTMLElement>('[data-step-panel]', el);
        const items = gsap.utils.toArray<HTMLElement>('[data-step-item]', el);
        const progress = el.querySelector<HTMLElement>('[data-progress]');
        gsap.set(panels.slice(1), { autoAlpha: 0, y: 28 });
        gsap.set(items.slice(1), { opacity: 0.45 });
        const tl = gsap.timeline({
          scrollTrigger: { trigger: el, pin: true, start: 'top 88px', end: `+=${panels.length * 90}%`, scrub: 0.7, anticipatePin: 1 },
        });
        panels.forEach((p, i) => {
          if (i === 0) return;
          tl.to(panels[i - 1]!, { autoAlpha: 0, y: -28, duration: 0.6, ease: 'power2.in' }, i - 0.3);
          tl.to(items[i - 1]!, { opacity: 0.45, duration: 0.3 }, i - 0.3);
          tl.fromTo(p, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' }, i);
          tl.to(items[i]!, { opacity: 1, duration: 0.3 }, i);
        });
        if (progress) tl.fromTo(progress, { scaleY: 0 }, { scaleY: 1, ease: 'none', duration: panels.length - 0.3 }, 0.3);
        return () => el.classList.remove('is-pinned');
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative">
      {/* Pinned layout (wide screens, motion allowed). */}
      <div className="hidden [.is-pinned_&]:grid lg:[.is-pinned_&]:grid-cols-[320px_1fr] lg:[.is-pinned_&]:gap-12">
        <ol className="relative space-y-7 pl-8">
          <span aria-hidden className="absolute left-[7px] top-2 h-[calc(100%-1rem)] w-px bg-white/10" />
          <span aria-hidden data-progress className="absolute left-[7px] top-2 h-[calc(100%-1rem)] w-px origin-top aurora-line shadow-[0_0_10px_rgba(45,226,195,0.7)]" style={{ transform: 'scaleY(0)' }} />
          {STEPS.map((s) => (
            <li key={s.n} data-step-item className="relative">
              <span aria-hidden className="absolute -left-8 top-1.5 size-[15px] rounded-full border border-white/20 bg-page ring-4 ring-page" />
              <p className={cn('font-mono text-xs', s.accent)}>{s.n}</p>
              <p className="font-display text-2xl font-bold tracking-tight">{s.title}</p>
            </li>
          ))}
        </ol>
        <div className="relative min-h-[380px]">
          {STEPS.map((s) => (
            <article key={s.n} data-step-panel className="glass-strong hairline-top absolute inset-0 flex flex-col justify-between rounded-card p-8">
              <p className={cn('font-display text-[7rem] font-extrabold leading-none tracking-tighter opacity-20', s.accent)}>{s.n}</p>
              <div>
                <h3 className="font-display text-3xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      {/* Stacked layout (phones, reduced motion). */}
      <StoryStack className="[.is-pinned_&]:hidden" />
    </div>
  );
}

