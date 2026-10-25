'use client';
import { useState } from 'react';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { Client as GenericClient } from '@stellar/stellar-sdk/contract';
import { ONE } from '@qafila/shared';
import { Button } from '@/components/ui/button';
import { TxLink } from '@/components/ui/tx-link';
import { usePublicConfig } from '@/lib/config';
import { apiPost } from '@/lib/api/client';
import { FaucetResponseSchema } from '@/lib/api/schemas';
import { getKit } from '@/lib/wallet/kit';
import { toWalletError } from '@/lib/wallet/errors';
import { useWallet } from '@/lib/wallet/provider';

interface Line {
  t: number;
  text: string;
  hash?: string;
  ok?: boolean;
}

export function Sp5Harness() {
  const { data: config } = usePublicConfig();
  const wallet = useWallet();
  const [lines, setLines] = useState<Line[]>([]);
  const [probe, setProbe] = useState(process.env['NEXT_PUBLIC_PROBE_CONTRACT_ID'] ?? '');
  const log = (text: string, extra: Partial<Line> = {}) => setLines((xs) => [...xs, { t: Date.now(), text, ...extra }]);

  async function step(name: string, fn: () => Promise<string | undefined>) {
    const t0 = performance.now();
    log(`${name}: starting`);
    try {
      const hash = await fn();
      log(`${name}: PASS in ${((performance.now() - t0) / 1000).toFixed(1)} s`, { hash, ok: true });
    } catch (e) {
      const w = toWalletError(e);
      const raw = e instanceof Error ? e.message : JSON.stringify(e);
      log(`${name}: FAIL after ${((performance.now() - t0) / 1000).toFixed(1)} s: ${w.message} [${raw.slice(0, 400)}]`, { ok: false });
      console.error(name, e);
    }
  }

  const token = config?.settlementToken.id ?? '';
  const to = config?.charityAddress ?? '';

  return (
    <div className="space-y-6" data-testid="sp5">
      <h1 className="text-2xl font-semibold">SP5 harness (development only)</h1>
      <p className="text-sm text-ink-muted">Passkey smart account calls the probe contract (require_auth + SAC transfer) with sponsored fees through the relayer.</p>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <dt>Relayer</dt>
        <dd className="font-mono break-all">{config?.smartAccount.relayerUrl ?? 'none'}</dd>
        <dt>Wasm hash</dt>
        <dd className="font-mono break-all">{config?.smartAccount.wasmHash ?? 'none'}</dd>
        <dt>WebAuthn verifier</dt>
        <dd className="font-mono break-all">{config?.smartAccount.webauthnVerifier ?? 'none'}</dd>
        <dt>Token (qUSD SAC)</dt>
        <dd className="font-mono break-all">{token || 'none'}</dd>
        <dt>Wallet</dt>
        <dd className="font-mono break-all" data-testid="sp5-address">
          {wallet.address ?? 'not connected'} ({wallet.status})
        </dd>
      </dl>
      <label className="block text-sm">
        Probe contract id
        <input data-testid="sp5-probe" value={probe} onChange={(e) => setProbe(e.target.value.trim())} className="mt-1 w-full rounded border border-line-strong px-2 py-1 font-mono text-xs" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="sp5-create" onClick={() => step('create wallet', async () => { await wallet.createWallet(`sp5-${Date.now()}`); return undefined; })} disabled={!wallet.passkeysReady || wallet.busy}>
          1. Create wallet
        </Button>
        <Button data-testid="sp5-signin" variant="outline" onClick={() => step('sign in', async () => { await wallet.signIn(); return undefined; })} disabled={!wallet.passkeysReady || wallet.busy}>
          Sign in
        </Button>
        <Button
          data-testid="sp5-faucet"
          variant="secondary"
          onClick={() =>
            step('faucet', async () => {
              const r = await apiPost('/faucet', {}, FaucetResponseSchema);
              return r.txHash;
            })
          }
          disabled={!wallet.address}
        >
          2. Faucet (50 test dollars)
        </Button>
        <Button
          data-testid="sp5-execute"
          variant="saffron"
          onClick={() =>
            step('probe via execute (sponsored)', async () => {
              if (!config || !wallet.address) throw new Error('connect first');
              const kit = await getKit(config);
              const args = [new Address(wallet.address).toScVal(), new Address(token).toScVal(), new Address(to).toScVal(), nativeToScVal(ONE, { type: 'i128' })];
              const r = await kit.executeAndSubmit(probe, 'probe', args);
              if (!r.success) throw r.error;
              return r.hash;
            })
          }
          disabled={!wallet.address || !probe}
        >
          3. Probe via wallet.execute
        </Button>
        <Button
          data-testid="sp5-direct"
          variant="outline"
          onClick={() =>
            step('probe direct signAndSubmit', async () => {
              if (!config || !wallet.address) throw new Error('connect first');
              const kit = await getKit(config);
              const client = await GenericClient.from({ contractId: probe, rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase, publicKey: kit.deployerPublicKey });
              const method = (client as unknown as Record<string, (a: Record<string, unknown>, o?: unknown) => Promise<never>>)['probe'];
              if (!method) throw new Error('probe method missing in the fetched spec');
              const tx = await method({ caller: wallet.address, token, to, amount: ONE }, { timeoutInSeconds: 60 });
              const r = await kit.signAndSubmit(tx);
              if (!r.success) throw r.error;
              return r.hash;
            })
          }
          disabled={!wallet.address || !probe}
        >
          4. Probe direct (signAndSubmit)
        </Button>
      </div>
      <ol className="space-y-1 text-xs" data-testid="sp5-log">
        {lines.map((l) => (
          <li key={l.t + l.text} data-ok={l.ok} className={l.ok === false ? 'text-danger' : l.ok ? 'text-success' : ''}>
            {new Date(l.t).toLocaleTimeString()} {l.text} {l.hash ? <TxLink hash={l.hash} short /> : null}
            {l.hash ? <span className="sr-only" data-testid="sp5-hash">{l.hash}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
