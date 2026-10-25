import Link from 'next/link';
import { JoinCta } from '@/components/join-cta';
import { LiveFeed } from '@/components/live-feed';
import { LiveStats } from '@/components/live-stats';
import { buttonClasses } from '@/components/ui/button';

const STEPS: [string, string][] = [
  ['Verify', 'The importer uploads the invoice, packing list and supplier licence. AI checks them against each other, the company register, sanctions lists and live carrier data. A person signs off.'],
  ['Fund', 'The importer locks a security deposit first. Investors fund the shipment and receive locked shares.'],
  ['Ship', 'The contract pays the supplier. The bill of lading is made out to Qafila. An agent confirms the loading event from carrier tracking and the balance is paid.'],
  ['Repay', 'The importer buys the goods at a price fixed from day one and repays by the due date. Investors claim principal plus profit. Late fees go to charity.'],
];

const SHARIA: string[] = [
  'The deal owns real goods before it sells them.',
  'Profit comes from a sale at a price fixed at the start, and nothing grows with time.',
  'The importer puts money in first and loses it first if they let investors down.',
  'Late fees go to charity, never to investors or to Qafila.',
  'Shares cannot be sold on, so a debt is never traded at a discount.',
];

const FAQ: [string, string][] = [
  ['Is this a loan?', 'No. The deal buys goods and resells them at a fixed price. Nobody is charged for time.'],
  ['Can I lose money?', 'Yes. If the importer does not pay and nothing is recovered, losses are shared by all holders, after the importer’s own money. Qafila loses alongside you on its 5% stake.'],
  ['Do I need a crypto wallet?', 'No. Your wallet is a passkey on your phone. No seed phrase, no XLM.'],
  ['Is this real money?', 'Not during the hackathon. Everything runs on Stellar testnet with test dollars.'],
];

export default function Landing() {
  return (
    <div className="space-y-16">
      <section className="relative -mx-4 overflow-hidden px-4 pb-8 pt-6 sm:pt-10">
        <div aria-hidden className="ledger-bg pointer-events-none absolute inset-0" />
        <div className="relative space-y-6">
          <p className="eyebrow rise">Halal trade finance on Stellar</p>
          <h1 className="rise rise-1 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">Fund a real shipment for an importer that banks turn down.</h1>
          <p className="rise rise-2 max-w-2xl text-lg text-ink-muted">
            For centuries, caravans crossing the Sahara were financed by partners who pooled money, bought goods and shared the profit of a real trade. Qafila is that partnership on Stellar: shared ownership of real goods, profit from a sale instead of interest, and proof at every step.
          </p>
          <div className="rise rise-3 flex flex-wrap gap-3">
            <Link href="/invest" className={buttonClasses('primary', 'lg')} data-testid="hero-deals">
              See the deals
            </Link>
            <Link href="/importer" className={buttonClasses('outline', 'lg')}>
              I am an importer
            </Link>
            <JoinCta className="h-12 px-5 text-base" />
          </div>
        </div>
      </section>

      <section aria-labelledby="stats" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="stats" className="eyebrow">
            Live on testnet
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden className="live-dot size-1.5 rounded-full bg-success" /> updates every 10 seconds
          </span>
        </div>
        <LiveStats />
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-6 text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <p className="tabular text-sm font-medium text-saffron">Step {i + 1}</p>
              <p className="mt-1 text-lg font-semibold">{title}</p>
              <p className="mt-2 text-sm text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="feed" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="feed" className="text-2xl font-semibold tracking-tight">
              Happening on-chain
            </h2>
            <p className="text-sm text-ink-muted">Every step is a transaction on Stellar. Click one to see it on stellar.expert.</p>
          </div>
          <Link href="/charity" className="text-sm text-indigo hover:underline">
            Charity ledger
          </Link>
        </div>
        <LiveFeed />
      </section>

      <section aria-labelledby="sharia" className="rounded-card bg-indigo p-8 text-white">
        <h2 id="sharia" className="text-2xl font-semibold tracking-tight">
          Why this is designed for Sharia compliance
        </h2>
        <ul className="mt-4 space-y-2 text-white/90">
          {SHARIA.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="tabular text-saffron">{i + 1}</span>
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-white/70">Based on AAOIFI Shari&apos;ah Standard No. 8 (Murabahah). Formal review by a Sharia board is pending.</p>
      </section>

      <section aria-labelledby="faq">
        <h2 id="faq" className="mb-4 text-2xl font-semibold tracking-tight">
          Questions
        </h2>
        <dl className="divide-y divide-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm text-ink-muted">{a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/invest" className={buttonClasses('primary')}>
            See the deals
          </Link>
          <JoinCta />
        </div>
      </section>
    </div>
  );
}
