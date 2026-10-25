import Link from 'next/link';
import { JoinCta } from '@/components/join-cta';
import { Faq } from '@/components/landing/faq';
import { Hero } from '@/components/landing/hero';
import { TxMarquee } from '@/components/landing/marquee';
import { ShariaBlock } from '@/components/landing/sharia';
import { StatsBento } from '@/components/landing/stats-bento';
import { StoryDynamic } from '@/components/landing/story-dynamic';
import ShinyText from '@/components/bits/ShinyText';
import { buttonClasses } from '@/components/ui/button';

export default function Landing() {
  return (
    <div className="space-y-20 sm:space-y-24">
      <Hero />

      <section aria-labelledby="stats" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="stats" className="eyebrow">
            <ShinyText text="Live on testnet" color="#9aa6c8" shineColor="#2de2c3" speed={4} glow={0} />
          </h2>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
            <span aria-hidden className="live-dot size-1.5 rounded-full bg-teal shadow-[0_0_8px_rgba(45,226,195,0.9)]" /> updates every 10 seconds
          </span>
        </div>
        <StatsBento />
      </section>

      <section aria-labelledby="how" className="space-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 id="how" className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Four steps. Every one of them on-chain.
          </h2>
        </div>
        <StoryDynamic />
      </section>

      <section aria-labelledby="feed" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="feed" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Happening on-chain
            </h2>
            <p className="text-sm text-ink-muted">Every step is a transaction on Stellar. Click one to see it on stellar.expert.</p>
          </div>
          <Link href="/charity" className="text-sm text-indigo underline-offset-2 hover:underline">
            Charity ledger
          </Link>
        </div>
        <TxMarquee />
      </section>

      <ShariaBlock />

      <section aria-labelledby="faq" className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 id="faq" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Questions
          </h2>
          <p className="mt-2 text-sm text-ink-muted">Short answers. The full design is in the deal pages and the charity ledger.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/invest" className={buttonClasses('primary')}>
              See the deals
            </Link>
            <JoinCta />
          </div>
        </div>
        <Faq />
      </section>
    </div>
  );
}
