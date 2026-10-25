'use client';
/** Hero headline split by word (ReactBits SplitText on GSAP). Loaded only in the browser; the text itself is always in the DOM for assistive tech and tests. */
import dynamic from 'next/dynamic';
import { HEADLINE } from './data';

const SplitText = dynamic(() => import('@/components/bits/SplitText'), { ssr: false, loading: () => <span className="invisible">{HEADLINE}</span> });

export function HeroTitle({ className }: { className: string }) {
  return (
    <h1 className={className}>
      <span className="sr-only">{HEADLINE}</span>
      <span aria-hidden className="block">
        <SplitText text={HEADLINE} tag="span" splitType="words" effect="blur" trigger="load" delay={45} duration={0.9} staggerFrom="start" className="block" />
      </span>
    </h1>
  );
}
