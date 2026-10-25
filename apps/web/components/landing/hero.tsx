'use client';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { JoinCta } from '@/components/join-cta';
import { LiveFeed } from '@/components/live-feed';
import { Item, Stagger } from '@/components/motion/reveal';
import { buttonClasses } from '@/components/ui/button';
import { MagnetCta } from '@/components/ui/magnet-cta';
import { AuroraBg } from './aurora-bg';
import { HeroTitle } from './hero-title';

/** Hero: copy left, the live ledger streaming right, aurora behind. */
export function Hero() {
  return (
    <section className="relative -mx-4 overflow-hidden px-4 pb-10 pt-8 sm:pt-14 lg:pb-16">
      <AuroraBg />
      <div aria-hidden className="grid-field pointer-events-none absolute inset-0 -z-10" />
      <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
        <Stagger className="relative space-y-6 lg:pt-6">
          <Item>
            <p className="eyebrow flex items-center gap-2">
              <span aria-hidden className="live-dot size-1.5 rounded-full bg-teal shadow-[0_0_10px_rgba(45,226,195,0.9)]" />
              Halal trade finance on Stellar
            </p>
          </Item>
          <Item y={0}>
            <HeroTitle className="max-w-3xl font-display text-[2.6rem] font-bold leading-[1.02] tracking-[-0.03em] sm:text-6xl lg:text-[4.4rem]" />
          </Item>
          <Item>
            <p className="max-w-xl text-lg leading-relaxed text-ink-muted">
              For centuries, caravans crossing the Sahara were financed by partners who pooled money, bought goods and shared the profit of a real trade. Qafila is that partnership on Stellar: shared ownership of real goods, profit from a sale instead of interest, and proof at every step.
            </p>
          </Item>
          <Item className="flex flex-wrap items-center gap-3">
            <MagnetCta>
              <Link href="/invest" className={buttonClasses('primary', 'lg', 'halo')} data-testid="hero-deals">
                See the deals <ArrowRight className="size-4" aria-hidden />
              </Link>
            </MagnetCta>
            <Link href="/importer" className={buttonClasses('outline', 'lg')}>
              I am an importer
            </Link>
            <JoinCta className="h-12 px-5 text-base" />
          </Item>
          <Item>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
              <li>Passkey wallet, no seed phrase</li>
              <li>Fixed profit from a sale</li>
              <li>Every step on-chain</li>
            </ul>
          </Item>
        </Stagger>

        <Stagger delay={0.25} className="relative lg:-mr-2 lg:mt-2">
          <Item y={20} className="glass-strong hairline-top relative rounded-card">
            <div className="flex items-center justify-between gap-3 px-4 pt-4">
              <div className="min-w-0">
                <p className="eyebrow flex items-center gap-2 text-teal">
                  <span aria-hidden className="live-dot-ring size-1.5 rounded-full bg-teal text-teal" />
                  Live ledger
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">The latest transactions on the Qafila contract.</p>
              </div>
              <Link href="/charity" className="shrink-0 text-xs text-ink-muted hover:text-ink">
                Charity ledger
              </Link>
            </div>
            <div className="p-2 pt-3">
              <LiveFeed limit={8} variant="ledger" />
            </div>
          </Item>
        </Stagger>
      </div>
    </section>
  );
}
