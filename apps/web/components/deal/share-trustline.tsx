'use client';
/**
 * SP4 fallback (PLAN 3.1): a G-address (Freighter) investor must hold the share trustline before
 * `invest`, because the share asset has AUTH_REQUIRED and the contract mints to the holder. Smart
 * accounts need nothing. Asset code is QF + the 8-digit on-chain deal id; the issuer comes from the
 * deal. The trustline is a classic changeTrust signed in the wallet and submitted to Horizon.
 */
import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Asset, BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { DealDetail } from '@qafila/shared';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/card';
import { InlineError } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { usePublicConfig } from '@/lib/config';
import { externalSignTransaction } from '@/lib/wallet/freighter';
import { toWalletError } from '@/lib/wallet/errors';
import { useWallet } from '@/lib/wallet/provider';

export function shareAssetCode(onchainId: number): string {
  return `QF${String(onchainId).padStart(8, '0')}`;
}

interface HorizonAccount {
  balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

export function useShareTrustline(deal: DealDetail) {
  const w = useWallet();
  const { data: config } = usePublicConfig();
  const needed = w.kind === 'freighter' && Boolean(w.address) && deal.onchainId !== null && Boolean(deal.issuer?.publicKey);
  const code = deal.onchainId !== null ? shareAssetCode(deal.onchainId) : null;
  const q = useQuery({
    queryKey: ['trustline', config?.horizonUrl, w.address, code, deal.issuer?.publicKey],
    enabled: needed && Boolean(config?.horizonUrl),
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const res = await fetch(`${config!.horizonUrl}/accounts/${w.address}`);
      if (res.status === 404) throw new Error('This account is not funded on this network yet.');
      if (!res.ok) throw new Error('Horizon did not answer.');
      const a = (await res.json()) as HorizonAccount;
      return a.balances.some((b) => b.asset_code === code && b.asset_issuer === deal.issuer!.publicKey);
    },
  });
  return { needed, has: q.data === true, loading: needed && q.isPending, error: q.error, refetch: q.refetch, code };
}

export function ShareTrustline({ deal }: { deal: DealDetail }) {
  const w = useWallet();
  const { data: config } = usePublicConfig();
  const t = useShareTrustline(deal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  if (!t.needed || t.has || !config || !deal.issuer || !t.code) return null;

  async function add() {
    if (!w.address || !deal.issuer || !t.code) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${config!.horizonUrl}/accounts/${w.address}`);
      if (!res.ok) throw new Error('This account is not funded on this network yet.');
      const acct = (await res.json()) as { sequence: string };
      const { Account } = await import('@stellar/stellar-sdk');
      const tx = new TransactionBuilder(new Account(w.address, acct.sequence), { fee: BASE_FEE, networkPassphrase: config!.networkPassphrase })
        .addOperation(Operation.changeTrust({ asset: new Asset(t.code, deal.issuer.publicKey) }))
        .setTimeout(120)
        .build();
      const signed = await externalSignTransaction(config!, tx.toXDR(), { address: w.address });
      const submit = await fetch(`${config!.horizonUrl}/transactions`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: signed.signedTxXdr }) });
      const body = (await submit.json()) as { hash?: string; extras?: { result_codes?: unknown } };
      if (!submit.ok || !body.hash) throw new Error(`Horizon rejected the trustline: ${JSON.stringify(body.extras?.result_codes ?? submit.status)}`);
      setHash(body.hash);
      await t.refetch();
    } catch (e) {
      setError(toWalletError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Callout tone="indigo" title="One step for Stellar wallets: add the share trustline">
      <p>
        Your {t.code} shares are a Stellar asset with authorization flags. Your account needs a trustline to it before the contract can mint them. Smart-account wallets skip this.
      </p>
      {t.error ? <InlineError>{t.error instanceof Error ? t.error.message : 'Could not check the trustline.'}</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {hash ? (
        <p>
          Trustline added. <TxLink hash={hash} />
        </p>
      ) : (
        <Button size="sm" onClick={add} loading={busy} icon={<Link2 className="size-4" />} data-testid="add-trustline">
          Add {t.code} trustline
        </Button>
      )}
    </Callout>
  );
}
