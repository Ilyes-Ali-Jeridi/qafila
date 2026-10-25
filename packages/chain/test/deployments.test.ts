import { describe, expect, it } from 'vitest';
import { DeploymentFileSchema } from '../src/deployments.ts';
import { shareAssetCode, verifyIssuerLocked } from '../src/shareToken.ts';
import { decimalToStroops, stroopsToDecimal } from '../src/qusd.ts';
import { ChainEnvSchema } from '../src/env.ts';
import type { HorizonAccount } from '../src/horizon.ts';

const G = 'GCRLD7ZL5HKXFEUZNYYHSGVOC443RNHT4S34LRQ2F7KX2NDPPGXTFQBH';
const C = 'CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ';

describe('deployment file schema', () => {
  const good = {
    network: 'testnet',
    instance: 'main',
    contractId: C,
    wasmHash: 'ab'.repeat(32),
    verifierPublicKeyHex: 'cd'.repeat(32),
    verifierPublicKey: G,
    admin: G,
    agent: G,
    charity: G,
    treasury: G,
    settlementToken: { id: C, code: 'qUSD', issuer: G },
    gitCommit: '52b2bab',
    deployedAt: '2026-10-25T15:20:00+01:00',
    config: {
      max_markup_bps: 1500,
      max_deposit_bps: 3000,
      max_investors_per_deal: 100,
      min_tenor_secs: 60,
      grace_secs: 60,
      base_importer_limit: '200000000000',
      limit_step: '100000000000',
      min_security_bps: 2000,
      security_step_bps: 250,
      security_floor_bps: 1000,
      max_extension_secs: 600,
    },
  };
  it('accepts a complete file and defaults txs', () => {
    const p = DeploymentFileSchema.parse(good);
    expect(p.txs).toEqual({});
  });
  it('rejects a bad contract id, a short wasm hash and an unknown instance', () => {
    expect(() => DeploymentFileSchema.parse({ ...good, contractId: G })).toThrow();
    expect(() => DeploymentFileSchema.parse({ ...good, wasmHash: 'ab' })).toThrow();
    expect(() => DeploymentFileSchema.parse({ ...good, instance: 'prod' })).toThrow();
  });
});

describe('shareAssetCode', () => {
  it('pads to QF + 8 digits', () => {
    expect(shareAssetCode(1)).toBe('QF00000001');
    expect(shareAssetCode(42n)).toBe('QF00000042');
    expect(shareAssetCode(99_999_999)).toBe('QF99999999');
    expect(shareAssetCode(42).length).toBeLessThanOrEqual(12);
  });
  it('rejects 0 and overflow', () => {
    expect(() => shareAssetCode(0)).toThrow();
    expect(() => shareAssetCode(100_000_000)).toThrow();
  });
});

describe('verifyIssuerLocked', () => {
  const acc = (over: Partial<HorizonAccount> = {}): HorizonAccount => ({
    id: G,
    account_id: G,
    sequence: '1',
    home_domain: 'qafila.dev',
    flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true },
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: G, weight: 0, type: 'ed25519_public_key' }],
    balances: [],
    ...over,
  });
  it('passes a locked issuer', () => {
    expect(verifyIssuerLocked(acc(), 'qafila.dev').masterWeight).toBe(0);
  });
  it('fails on a missing flag, a live master key or an extra signer', () => {
    expect(() => verifyIssuerLocked(acc({ flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: false } }), 'qafila.dev')).toThrow(/CLAWBACK/);
    expect(() => verifyIssuerLocked(acc({ signers: [{ key: G, weight: 1, type: 'ed25519_public_key' }] }), 'qafila.dev')).toThrow(/master weight/);
    expect(() => verifyIssuerLocked(acc({ signers: [{ key: G, weight: 0, type: 'ed25519_public_key' }, { key: C, weight: 1, type: 'sha256_hash' }] }), 'qafila.dev')).toThrow(/1 signer/);
  });
});

describe('amounts', () => {
  it('converts stroops and decimals both ways', () => {
    expect(stroopsToDecimal(20_000_000_000n)).toBe('2000.0000000');
    expect(stroopsToDecimal(5n)).toBe('0.0000005');
    expect(decimalToStroops('2000')).toBe(20_000_000_000n);
    expect(decimalToStroops('2000.5')).toBe(20_005_000_000n);
    expect(() => decimalToStroops('1.12345678')).toThrow();
  });
});

describe('env schema', () => {
  it('defaults the network values and rejects a malformed secret', () => {
    const p = ChainEnvSchema.parse({});
    expect(p.STELLAR_NETWORK).toBe('testnet');
    expect(p.SETTLEMENT_TOKEN_CODE).toBe('qUSD');
    expect(() => ChainEnvSchema.parse({ ADMIN_SECRET: 'not-a-secret' })).toThrow();
  });
});
