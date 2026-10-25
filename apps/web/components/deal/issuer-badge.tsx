'use client';
import { useQuery } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import type { DealDetail } from '@qafila/shared';
import { Badge } from '@/components/ui/badge';
import { Address } from '@/components/ui/address';
import { usePublicConfig } from '@/lib/config';

interface HorizonAccount {
  signers: Array<{ key: string; weight: number; type: string }>;
  flags: { auth_required: boolean; auth_revocable: boolean; auth_clawback_enabled: boolean; auth_immutable: boolean };
}

/** "Issuer locked" from Horizon (PLAN 3.1): master key weight 0, no other signers, three flags set. */
export function IssuerBadge({ issuer }: { issuer: NonNullable<DealDetail['issuer']> }) {
  const { data: config } = usePublicConfig();
  const q = useQuery({
    queryKey: ['horizon-issuer', config?.horizonUrl, issuer.publicKey],
    enabled: Boolean(config?.horizonUrl),
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<{ locked: boolean; flags: string[] } | null> => {
      const res = await fetch(`${config!.horizonUrl}/accounts/${issuer.publicKey}`);
      if (!res.ok) return null;
      const a = (await res.json()) as HorizonAccount;
      const master = a.signers.find((s) => s.key === issuer.publicKey);
      const others = a.signers.filter((s) => s.key !== issuer.publicKey);
      const flags = [a.flags.auth_required && 'AUTH_REQUIRED', a.flags.auth_revocable && 'AUTH_REVOCABLE', a.flags.auth_clawback_enabled && 'AUTH_CLAWBACK_ENABLED'].filter(Boolean) as string[];
      return { locked: (master?.weight ?? 1) === 0 && others.length === 0 && flags.length === 3, flags };
    },
  });
  const horizon = q.data ?? null;
  const locked = horizon ? horizon.locked : issuer.locked;
  const flags = horizon ? horizon.flags : issuer.flags;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {locked ? (
          <Badge tone="success">
            <Lock className="size-3" /> Issuer locked
          </Badge>
        ) : (
          <Badge tone="warning">
            <LockOpen className="size-3" /> Issuer not locked
          </Badge>
        )}
        <span className="text-xs text-ink-muted">{q.isPending && config ? 'Checking Horizon…' : horizon ? 'Verified on Horizon' : 'From the API; Horizon check unavailable for this account'}</span>
      </div>
      <p className="text-ink-muted">Only the Qafila contract can mint, freeze or claw back shares. Nobody holds the issuer key.</p>
      <div className="flex flex-wrap gap-1">
        {flags.map((f) => (
          <code key={f} className="rounded bg-sand-100 px-1.5 py-0.5 text-[11px]">
            {f}
          </code>
        ))}
      </div>
      <Address value={issuer.publicKey} head={6} tail={6} />
    </div>
  );
}
