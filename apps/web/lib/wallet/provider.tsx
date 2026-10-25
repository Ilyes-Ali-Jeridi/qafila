'use client';
/**
 * Wallet context (PLAN 4): passkey smart accounts through smart-account-kit with sponsored
 * fees, Freighter and other G wallets through Stellar Wallets Kit, and an offline mock chain
 * for development and e2e against the mock API. Every money action is authorised by the
 * wallet itself; the session only remembers who is connected.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicConfig } from '@qafila/shared';
import { usePublicConfig } from '../config';
import { clearSession, readSession, writeSession } from '../session';
import { makeQafilaClient } from '../stellar/client';
import type { ContractCall } from '../stellar/calls';
import { toWalletError, WalletError } from './errors';
import { getKit, smartAccountReady } from './kit';
import { connectExternalWallet, disconnectExternalWallet, externalSignTransaction } from './freighter';
import { MOCK_CHAIN, mockChainCall, mockWalletAddress } from './mock-chain';

export type WalletKind = 'passkey' | 'freighter' | 'mock';
export type SubmitMode = WalletKind;

/**
 * How passkey calls reach the contract (SP5, docs/SPIKES-product.md): `direct` builds the call with the
 * generated client and the smart account signs its own auth entry (`kit.signAndSubmit`); `execute` routes
 * through the smart account's `execute` (`kit.executeAndSubmit`). Both passed; direct is PLAN 4.1's path.
 */
export const PASSKEY_PATH: 'execute' | 'direct' = process.env['NEXT_PUBLIC_PASSKEY_PATH'] === 'execute' ? 'execute' : 'direct';

export interface TxReceipt {
  hash: string;
  mode: SubmitMode;
}

export interface WalletApi {
  status: 'loading' | 'disconnected' | 'connected';
  address: string | null;
  kind: WalletKind | null;
  label: string | null;
  busy: boolean;
  /** Config loaded and smart accounts configured (or mock chain on). */
  passkeysReady: boolean;
  contractReady: boolean;
  config: PublicConfig | undefined;
  createWallet(label: string): Promise<string>;
  signIn(): Promise<string>;
  connectExternal(): Promise<string>;
  disconnect(): Promise<void>;
  invoke(call: ContractCall): Promise<TxReceipt>;
  /** Read-only contract view by simulation (or the mock chain). */
  view<T>(fn: 'refund_of' | 'required_security' | 'quote_claim' | 'is_investor_approved' | 'importer_limit', args: Record<string, unknown>): Promise<T>;
  addBackupPasskey(label: string): Promise<TxReceipt>;
}

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { data: config } = usePublicConfig();
  const qc = useQueryClient();
  const [status, setStatus] = useState<WalletApi['status']>('loading');
  const [address, setAddress] = useState<string | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restored = useRef(false);

  const connectedState = useCallback(
    (addr: string, k: WalletKind, lbl: string | null) => {
      setAddress(addr);
      setKind(k);
      setLabel(lbl);
      setStatus('connected');
      writeSession({ address: addr, kind: k === 'freighter' ? 'g_account' : 'smart_account', label: lbl });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    [qc],
  );

  // Silent restore on return visits (PLAN 4.1): kit.connectWallet() without a prompt.
  useEffect(() => {
    if (!config || restored.current) return;
    restored.current = true;
    const s = readSession();
    (async () => {
      if (!s.address) return setStatus('disconnected');
      if (MOCK_CHAIN) return connectedState(s.address, 'mock', s.label);
      if (s.kind === 'g_account') return connectedState(s.address, 'freighter', s.label);
      if (!smartAccountReady(config)) return setStatus('disconnected');
      try {
        const kit = await getKit(config);
        const r = await kit.connectWallet();
        if (r?.contractId) return connectedState(r.contractId, 'passkey', s.label);
      } catch (e) {
        console.warn('[wallet] silent restore failed', e);
      }
      setStatus('disconnected');
    })();
  }, [config, connectedState]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      throw toWalletError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  const createWallet = useCallback(
    (lbl: string) =>
      run(async () => {
        if (!config) throw new WalletError('Still loading. Try again in a second.', 'config');
        if (MOCK_CHAIN) {
          const addr = mockWalletAddress();
          connectedState(addr, 'mock', lbl);
          return addr;
        }
        const kit = await getKit(config);
        const r = await kit.createWallet('Qafila', lbl, { autoSubmit: true });
        if (r.submitResult && !r.submitResult.success) throw r.submitResult.error;
        if (!kit.isConnected) await kit.connectWallet({ contractId: r.contractId });
        connectedState(r.contractId, 'passkey', lbl);
        return r.contractId;
      }),
    [config, connectedState, run],
  );

  const signIn = useCallback(
    () =>
      run(async () => {
        if (!config) throw new WalletError('Still loading. Try again in a second.', 'config');
        if (MOCK_CHAIN) {
          const addr = mockWalletAddress();
          connectedState(addr, 'mock', readSession().label);
          return addr;
        }
        const kit = await getKit(config);
        const r = await kit.connectWallet({ prompt: true });
        if (!r) throw new WalletError('No wallet was found for this passkey.', 'not_found');
        connectedState(r.contractId, 'passkey', readSession().label);
        return r.contractId;
      }),
    [config, connectedState, run],
  );

  const connectExternal = useCallback(
    () =>
      run(async () => {
        if (!config) throw new WalletError('Still loading. Try again in a second.', 'config');
        const addr = await connectExternalWallet(config);
        connectedState(addr, 'freighter', null);
        return addr;
      }),
    [config, connectedState, run],
  );

  const disconnect = useCallback(async () => {
    try {
      if (config && kind === 'passkey') (await getKit(config)).disconnect().catch(() => undefined);
      if (config && kind === 'freighter') await disconnectExternalWallet(config);
    } finally {
      clearSession();
      setAddress(null);
      setKind(null);
      setLabel(null);
      setStatus('disconnected');
      qc.clear();
    }
  }, [config, kind, qc]);

  const invoke = useCallback(
    (call: ContractCall) =>
      run(async (): Promise<TxReceipt> => {
        if (!config) throw new WalletError('Still loading. Try again in a second.', 'config');
        if (!address || !kind) throw new WalletError('Connect your wallet first.', 'disconnected');
        if (kind === 'mock') {
          const r = await mockChainCall(call.method, call.args);
          return { hash: r.hash, mode: 'mock' };
        }
        if (!config.contractId) throw new WalletError('The Qafila contract is not deployed on this network yet.', 'no_contract');
        if (kind === 'freighter') {
          const client = makeQafilaClient(config, { publicKey: address, signTransaction: (xdr, opts) => externalSignTransaction(config, xdr, opts) });
          const tx = await call.assemble(client);
          const sent = await tx.signAndSend();
          const hash = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash;
          if (!hash) throw new WalletError('The transaction was not sent.', 'no_hash');
          return { hash, mode: 'freighter' };
        }
        const kit = await getKit(config);
        if (!kit.isConnected) {
          const r = await kit.connectWallet();
          if (!r) throw new WalletError('Your session expired. Sign in again.', 'session');
        }
        let result;
        if (PASSKEY_PATH === 'execute') {
          result = await kit.executeAndSubmit(config.contractId, call.method, call.scArgs());
        } else {
          // The generated client and the kit share one SDK copy (webpack alias), so the assembled
          // transaction's auth entries are signed by the passkey and re-simulated by the kit.
          const client = makeQafilaClient(config, { publicKey: kit.deployerPublicKey });
          const tx = await call.assemble(client);
          result = await kit.signAndSubmit(tx as unknown as Parameters<typeof kit.signAndSubmit>[0]);
        }
        if (!result.success) throw result.error;
        return { hash: result.hash, mode: 'passkey' };
      }),
    [address, config, kind, run],
  );

  const view = useCallback(
    async <T,>(fn: 'refund_of' | 'required_security' | 'quote_claim' | 'is_investor_approved' | 'importer_limit', args: Record<string, unknown>): Promise<T> => {
      if (!config) throw new WalletError('Still loading.', 'config');
      if (MOCK_CHAIN || kind === 'mock') {
        const r = await mockChainCall(fn, args);
        return (r.result ?? '0') as unknown as T;
      }
      if (!config.contractId) throw new WalletError('The Qafila contract is not deployed on this network yet.', 'no_contract');
      const client = makeQafilaClient(config);
      const method = client[fn] as (a: never) => Promise<{ result: unknown }>;
      const tx = await method(args as never);
      const r = tx.result as { isOk?: () => boolean; unwrap?: () => T } | T;
      if (r && typeof r === 'object' && 'isOk' in r && typeof r.isOk === 'function') return (r as { unwrap: () => T }).unwrap();
      return r as T;
    },
    [config, kind],
  );

  const addBackupPasskey = useCallback(
    (lbl: string) =>
      run(async (): Promise<TxReceipt> => {
        if (!config) throw new WalletError('Still loading.', 'config');
        if (kind === 'mock') return { hash: '0'.repeat(64), mode: 'mock' };
        if (kind !== 'passkey') throw new WalletError('Backup passkeys are for passkey wallets.', 'kind');
        const kit = await getKit(config);
        const { transaction } = await kit.signers.addPasskey(0, 'Qafila', lbl, { nickname: lbl });
        const result = await kit.signAndSubmitAdmin(transaction);
        if (!result.success) throw result.error;
        return { hash: result.hash, mode: 'passkey' };
      }),
    [config, kind, run],
  );

  const value = useMemo<WalletApi>(
    () => ({
      status,
      address,
      kind,
      label,
      busy,
      passkeysReady: Boolean(config && (MOCK_CHAIN || smartAccountReady(config))),
      contractReady: Boolean(config && (MOCK_CHAIN || config.contractId)),
      config,
      createWallet,
      signIn,
      connectExternal,
      disconnect,
      invoke,
      view,
      addBackupPasskey,
    }),
    [status, address, kind, label, busy, config, createWallet, signIn, connectExternal, disconnect, invoke, view, addBackupPasskey],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
