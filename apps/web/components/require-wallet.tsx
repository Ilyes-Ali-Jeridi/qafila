'use client';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { buttonClasses } from './ui/button';
import { EmptyState, SkeletonList } from './ui/states';
import { useWallet } from '@/lib/wallet/provider';

/** Gate for screens that need a connected wallet. Public pages never use it. */
export function RequireWallet({ children, title = 'Connect to continue', body }: { children: ReactNode; title?: string; body?: string }) {
  const w = useWallet();
  const path = usePathname();
  if (w.status === 'loading') return <SkeletonList count={3} />;
  if (w.status !== 'connected') {
    const next = encodeURIComponent(path);
    return (
      <EmptyState
        icon={<KeyRound className="size-5" />}
        title={title}
        body={body ?? 'Your wallet is a passkey on this device. Creating one takes about 20 seconds; no seed phrase, no XLM.'}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/onboarding?next=${next}`} className={buttonClasses('primary')} data-testid="gate-create">
              Create my wallet
            </Link>
            <Link href={`/onboarding?mode=signin&next=${next}`} className={buttonClasses('outline')} data-testid="gate-signin">
              Sign in
            </Link>
          </div>
        }
      />
    );
  }
  return <>{children}</>;
}
