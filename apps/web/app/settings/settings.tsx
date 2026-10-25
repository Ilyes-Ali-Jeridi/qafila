'use client';
import { KeyRound, Mail } from 'lucide-react';
import { useState } from 'react';
import { Address } from '@/components/ui/address';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { KV } from '@/components/ui/kv';
import { PageHeader } from '@/components/ui/page-header';
import { InlineError, InlineNotice, SkeletonCard } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { RequireWallet } from '@/components/require-wallet';
import { describeError } from '@/lib/api/client';
import { useMe } from '@/lib/api/hooks';
import { useWallet } from '@/lib/wallet/provider';

export function SettingsScreen() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" lead="Your wallet, a backup passkey and notifications." />
      <RequireWallet>
        <Inner />
      </RequireWallet>
    </div>
  );
}

function Inner() {
  const w = useWallet();
  const me = useMe();
  const [label, setLabel] = useState('Backup');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function backup() {
    setError(null);
    setHash(null);
    try {
      const r = await w.addBackupPasskey(label.trim() || 'Backup');
      setHash(r.hash);
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader eyebrow="Wallet" title={w.kind === 'freighter' ? 'Stellar wallet' : 'Passkey wallet'} />
        <CardBody>
          {me.isPending ? (
            <SkeletonCard lines={2} />
          ) : (
            <KV
              rows={[
                { k: 'Address', v: w.address ? <Address value={w.address} head={6} tail={6} /> : '' },
                { k: 'Name', v: w.label ?? me.data?.profile.displayName ?? 'not set' },
                { k: 'Investor approval', v: me.data?.investorApproved ? <span className="text-success">approved</span> : me.isError ? 'unknown' : 'not yet' },
                me.data?.investorApproveTxHash ? { k: 'Approval transaction', v: <TxLink hash={me.data.investorApproveTxHash} short /> } : null,
                me.data?.importer ? { k: 'Company', v: `${me.data.importer.legalName} (${me.data.importer.kybStatus})` } : null,
              ]}
            />
          )}
        </CardBody>
      </Card>

      {w.kind !== 'freighter' ? (
        <Card>
          <CardHeader eyebrow="Recovery" title="Add a backup passkey" />
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">If you lose this phone, a second passkey on another device keeps your wallet. The new passkey is added to your wallet on-chain; you confirm once with the current one.</p>
            <Field label="Name for the backup" htmlFor="bk">
              <Input id="bk" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} />
            </Field>
            {error ? <InlineError>{error}</InlineError> : null}
            {hash ? (
              <InlineNotice tone="success">
                Backup passkey added. <TxLink hash={hash} />
              </InlineNotice>
            ) : null}
            <Button onClick={backup} loading={w.busy} icon={<KeyRound className="size-4" />}>
              Add a backup passkey
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader eyebrow="Notifications" title="Email" />
        <CardBody className="space-y-3">
          {me.data?.profile.email ? (
            <KV rows={[{ k: 'Sends to', v: me.data.profile.email }]} />
          ) : (
            <Callout tone="neutral">
              <p className="flex items-center gap-2">
                <Mail className="size-4" /> No email on file. Notifications (funded, shipment confirmed, ready to claim) need one; add it when you sign in with email.
              </p>
            </Callout>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
