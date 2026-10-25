'use client';
/** Ops console frame: wallet gate, role check (ops or sharia from GET /me), section nav. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireWallet } from '@/components/require-wallet';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { describeError } from '@/lib/api/client';
import { useMe } from '@/lib/api/hooks';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/ops', label: 'Queue', match: (p: string) => p === '/ops' || p.startsWith('/ops/deals') },
  { href: '/ops/kyc', label: 'KYC', match: (p: string) => p.startsWith('/ops/kyc') },
  { href: '/ops/agent', label: 'Agent', match: (p: string) => p.startsWith('/ops/agent') },
  { href: '/ops/policy', label: 'Policy', match: (p: string) => p.startsWith('/ops/policy') },
  { href: '/ops/health', label: 'Health', match: (p: string) => p.startsWith('/ops/health') },
];

export function OpsShell({ title, lead, action, children }: { title: ReactNode; lead?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ops console" title={title} lead={lead} action={action} />
      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" aria-label="Ops sections">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm', s.match(path) ? 'border-indigo font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
            {s.label}
          </Link>
        ))}
      </nav>
      <RequireWallet title="Connect with your ops wallet">
        <RoleGate>{children}</RoleGate>
      </RequireWallet>
    </div>
  );
}

function RoleGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <SkeletonList count={3} />;
  if (me.isError) return <ErrorState title="Could not check your role" body={describeError(me.error)} onRetry={() => void me.refetch()} />;
  const roles = me.data.profile.roles;
  if (!roles.includes('ops') && !roles.includes('sharia')) {
    return <EmptyState title="This wallet is not an ops account" body="Ops and Sharia board roles are granted by hand. Sign in with the right wallet." />;
  }
  return <>{children}</>;
}

export function useIsSharia(): boolean {
  const me = useMe();
  return me.data?.profile.roles.includes('sharia') ?? false;
}
