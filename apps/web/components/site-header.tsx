'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './wallet-button';
import { useFlag } from '@/lib/config';
import { cn } from '@/lib/utils';

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/invest', label: 'Deals', match: (p) => p === '/invest' || p.startsWith('/invest/') || p.startsWith('/deals/') },
  { href: '/importer', label: 'Importers', match: (p) => p.startsWith('/importer') },
  { href: '/charity', label: 'Charity ledger', match: (p) => p.startsWith('/charity') },
];

export function SiteHeader() {
  const path = usePathname();
  const qr = useFlag('FF_QR_JOIN');
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span aria-hidden className="inline-block size-2.5 rounded-sm bg-saffron" />
            Qafila
          </Link>
          <div className="hidden items-center gap-1 text-sm md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cn('rounded-md px-2.5 py-1.5 hover:bg-indigo-50', n.match(path) ? 'bg-indigo-50 font-medium text-indigo' : 'text-ink-muted')}>
                {n.label}
              </Link>
            ))}
            {qr ? (
              <Link href="/join" className={cn('rounded-md px-2.5 py-1.5 hover:bg-indigo-50', path.startsWith('/join') ? 'bg-indigo-50 font-medium text-indigo' : 'text-ink-muted')}>
                Join
              </Link>
            ) : null}
          </div>
        </div>
        <WalletButton />
      </nav>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn('shrink-0 rounded-md px-2.5 py-1 hover:bg-indigo-50', n.match(path) ? 'bg-indigo-50 font-medium text-indigo' : 'text-ink-muted')}>
            {n.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
