'use client';
import { ChevronDown, KeyRound, LogOut, Settings, Briefcase, Wallet, ShieldCheck, LineChart } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { shortAddress } from '@qafila/shared';
import { useMe } from '@/lib/api/hooks';
import { useWallet } from '@/lib/wallet/provider';
import { buttonClasses } from './ui/button';
import { Skeleton } from './ui/states';

/** Header control: create or sign in when disconnected; the wallet menu when connected. */
export function WalletButton() {
  const w = useWallet();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (w.status === 'loading') return <Skeleton className="h-9 w-28" />;

  if (w.status !== 'connected' || !w.address) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/onboarding?mode=signin" className={buttonClasses('ghost', 'sm', 'hidden sm:inline-flex')}>
          Sign in
        </Link>
        <Link href="/onboarding" className={buttonClasses('primary', 'sm')} data-testid="nav-create-wallet">
          Create my wallet
        </Link>
      </div>
    );
  }

  const roles = me.data?.profile.roles ?? [];
  const isOps = roles.includes('ops') || roles.includes('sharia');
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="nav-wallet"
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface pl-2 pr-3 text-sm hover:bg-sand-100"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-indigo-50 text-indigo">
          {w.kind === 'freighter' ? <Wallet className="size-3.5" /> : <KeyRound className="size-3.5" />}
        </span>
        <span className="max-w-28 truncate font-medium">{w.label ?? me.data?.profile.displayName ?? shortAddress(w.address)}</span>
        <ChevronDown className="size-4 text-ink-muted" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-card border border-line bg-surface shadow-pop rise">
          <div className="border-b border-line px-3 py-2">
            <p className="eyebrow">Wallet</p>
            <p className="truncate font-mono text-xs" title={w.address}>
              {shortAddress(w.address, 8, 6)}
            </p>
          </div>
          <MenuLink href="/invest/portfolio" icon={<LineChart className="size-4" />} label="Portfolio" onClick={() => setOpen(false)} />
          <MenuLink href="/importer" icon={<Briefcase className="size-4" />} label="Importer" onClick={() => setOpen(false)} />
          {isOps ? <MenuLink href="/ops" icon={<ShieldCheck className="size-4" />} label="Ops console" onClick={() => setOpen(false)} /> : null}
          <MenuLink href="/settings" icon={<Settings className="size-4" />} label="Settings" onClick={() => setOpen(false)} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void w.disconnect();
            }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-ink-muted hover:bg-sand-100 hover:text-ink"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, icon, label, onClick }: { href: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Link href={href} role="menuitem" onClick={onClick} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sand-100">
      {icon} {label}
    </Link>
  );
}
