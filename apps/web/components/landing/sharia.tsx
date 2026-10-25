import { SHARIA } from './data';

/** The Sharia design in five plain sentences, as a dark editorial block. */
export function ShariaBlock() {
  return (
    <section aria-labelledby="sharia" className="glass-strong hairline-top relative -mx-4 overflow-hidden rounded-none px-5 py-10 sm:mx-0 sm:rounded-card sm:px-10 sm:py-12">
      <div aria-hidden className="dot-field pointer-events-none absolute inset-0 opacity-60" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(242,178,62,0.22),transparent)] blur-2xl" />
      <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="eyebrow text-saffron">Designed for Sharia compliance</p>
          <h2 id="sharia" className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Five sentences, no small print.
          </h2>
          <p className="mt-4 text-sm text-ink-muted">Based on AAOIFI Shari&apos;ah Standard No. 8 (Murabahah). Formal review by a Sharia board is pending.</p>
        </div>
        <ol className="divide-y divide-line">
          {SHARIA.map((s, i) => (
            <li key={s} className="flex gap-5 py-4 first:pt-0 last:pb-0">
              <span className="tabular shrink-0 font-display text-3xl font-extrabold leading-none text-saffron/70">{String(i + 1).padStart(2, '0')}</span>
              <p className="pt-1 text-base leading-relaxed sm:text-lg">{s}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
