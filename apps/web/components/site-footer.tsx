import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10 text-xs text-ink-muted">
      <hr className="hairline mb-8" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-md space-y-2">
          <p className="font-display text-base font-semibold text-ink">Qafila</p>
          <p>Qafila is designed for Sharia compliance; formal review is pending. Built for HackMeridian 2026 on Stellar testnet with test money.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/invest" className="hover:text-ink">Deals</Link>
          <Link href="/importer" className="hover:text-ink">Importers</Link>
          <Link href="/charity" className="hover:text-ink">Charity ledger</Link>
          <Link href="/verifier" className="hover:text-ink">Verifier key</Link>
        </nav>
      </div>
    </footer>
  );
}
