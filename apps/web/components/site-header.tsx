'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './wallet-button';
import { useFlag } from '@/lib/config';
import { useWallet } from '@/lib/wallet/provider';
import { cn } from '@/lib/utils';

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/invest', label: 'Deals', match: (p) => p === '/invest' || p.startsWith('/invest/') || p.startsWith('/deals/') },
  { href: '/importer', label: 'Importers', match: (p) => p.startsWith('/importer') },
  { href: '/charity', label: 'Charity ledger', match: (p) => p.startsWith('/charity') },
];

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative shrink-0 rounded-full px-3 py-1.5 text-sm transition-[color,background-color] duration-200',
        active ? 'bg-white/[0.07] font-medium text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_24px_-6px_rgba(45,226,195,0.6)]' : 'text-ink-muted hover:bg-white/[0.05] hover:text-ink',
      )}
    >
      {children}
      {active ? <span aria-hidden className="absolute inset-x-3 -bottom-px h-px bg-teal/80" /> : null}
    </Link>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const qr = useFlag('FF_QR_JOIN');
  const demo = useFlag('FF_DEMO_MODE');
  const w = useWallet();
  const links = [...(qr ? [...NAV, { href: '/join', label: 'Join', match: (p: string) => p.startsWith('/join') }] : NAV), ...(demo ? [{ href: '/demo', label: 'Demo', match: (p: string) => p.startsWith('/demo') }] : [])];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/70 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5" aria-label="Main">
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
            <span aria-hidden className="relative inline-flex size-6 items-center justify-center">
              <span className="absolute inset-0 rounded-md aurora-line opacity-90" />
              <span className="absolute inset-[3px] rounded-[4px] bg-page" />
              <span className="relative size-1.5 rounded-full bg-saffron" />
            </span>
            Qafila
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {links.map((n) => (
              <NavLink key={n.href} href={n.href} active={n.match(path)}>
                {n.label}
              </NavLink>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {w.kind === 'demo' ? (
            <span className="hidden items-center rounded-full border border-saffron/40 bg-saffron-100 px-2.5 py-1 text-xs font-medium text-saffron sm:inline-flex" data-testid="demo-pill">
              Demo view, read-only
            </span>
          ) : null}
          <WalletButton />
        </div>
      </nav>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Sections">
        {links.map((n) => (
          <NavLink key={n.href} href={n.href} active={n.match(path)}>
            {n.label}
          </NavLink>
        ))}
      </div>
    </header>
  );
}
