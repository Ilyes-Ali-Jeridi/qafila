import Link from 'next/link';
import { LiveStats } from '@/components/live-stats';

const STEPS: [string, string][] = [
  ['Verify', 'The importer uploads the invoice, packing list and supplier licence. AI checks them against each other, the company register, sanctions lists and live carrier data. A person signs off.'],
  ['Fund', 'Investors fund the shipment and receive locked shares. The importer has already locked a security deposit.'],
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
      <section className="space-y-6 pt-6">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Fund a real shipment for an importer that banks turn down.
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          For centuries, caravans crossing the Sahara were financed by partners who pooled money, bought goods and shared the profit of a real trade. Qafila is that partnership on Stellar.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/invest" className="rounded-md bg-indigo px-4 py-2 text-white hover:bg-indigo-700">
            See the deals
          </Link>
          <Link href="/importer" className="rounded-md border border-indigo px-4 py-2 text-indigo hover:bg-sand-200">
            I am an importer
          </Link>
        </div>
      </section>

      <section aria-labelledby="stats">
        <h2 id="stats" className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-muted">
          Live on testnet
        </h2>
        <LiveStats />
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-6 text-2xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-card border border-sand-200 bg-surface p-5">
              <p className="text-sm text-saffron">Step {i + 1}</p>
              <p className="mt-1 text-lg font-medium">{title}</p>
              <p className="mt-2 text-sm text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sharia" className="rounded-card bg-indigo p-8 text-white">
        <h2 id="sharia" className="text-2xl font-semibold">
          Why this is designed for Sharia compliance
        </h2>
        <ul className="mt-4 space-y-2 text-white/90">
          {SHARIA.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-white/70">Formal review by a Sharia board is pending.</p>
      </section>

      <section aria-labelledby="faq">
        <h2 id="faq" className="mb-4 text-2xl font-semibold">
          Questions
        </h2>
        <dl className="divide-y divide-sand-200">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm text-ink-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
