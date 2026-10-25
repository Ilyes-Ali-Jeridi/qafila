import { describe, expect, it } from 'vitest';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import type { DealTerms } from '@qafila/contract-client';
import { toHex } from '@qafila/shared/attestation';
import { dealTermsFieldOrder, dealTermsToScVal, decodeDealTerms, encodeDealTerms, listPayloadHashOf } from '../src/terms.ts';

export function sampleTerms(): DealTerms {
  return {
    importer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x02)).publicKey(),
    supplier: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x03)).publicKey(),
    share_token: Address.contract(Buffer.alloc(32, 0x44)).toString(),
    payout_token: Address.contract(Buffer.alloc(32, 0x55)).toString(),
    cost: 100_000_000_000n,
    deposit_bps: 3000,
    markup: 8_000_000_000n,
    platform_fee: 2_000_000_000n,
    late_fee: 500_000_000n,
    funding_deadline: 1_761_480_000n,
    accept_window_secs: 86_400n,
    tenor_secs: 7_776_000n,
    listing_fingerprint: Buffer.alloc(32, 0xaa),
    report_hash: Buffer.alloc(32, 0xbb),
    promise_hash: Buffer.alloc(32, 0xcc),
    halal_ok: true,
    payment_mode: { tag: 'Native', values: undefined },
    security: 20_000_000_000n,
  };
}

describe('DealTerms XDR encoding', () => {
  it('is deterministic', () => {
    expect(toHex(encodeDealTerms(sampleTerms()))).toBe(toHex(encodeDealTerms(sampleTerms())));
  });

  it('encodes as a map with symbol keys in sorted order (host canonical form)', () => {
    const scv = dealTermsToScVal(sampleTerms());
    expect(scv.type).toBe('scvMap');
    if (scv.type !== 'scvMap' || !scv.map) throw new Error('not a map');
    const keys = scv.map.map((e) => (e.key.type === 'scvSymbol' ? e.key.sym.toStringStrict() : '?'));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(dealTermsFieldOrder());
    expect(keys).toHaveLength(18);
    expect(keys).toContain('security');
  });

  it('types every field the way the Rust struct does', () => {
    const scv = dealTermsToScVal(sampleTerms());
    if (scv.type !== 'scvMap' || !scv.map) throw new Error('not a map');
    const byKey = new Map(scv.map.map((e) => [e.key.type === 'scvSymbol' ? e.key.sym.toStringStrict() : '?', e.val] as const));
    expect(byKey.get('cost')?.type).toBe('scvI128');
    expect(byKey.get('deposit_bps')?.type).toBe('scvU32');
    expect(byKey.get('tenor_secs')?.type).toBe('scvU64');
    expect(byKey.get('halal_ok')?.type).toBe('scvBool');
    expect(byKey.get('importer')?.type).toBe('scvAddress');
    expect(byKey.get('listing_fingerprint')?.type).toBe('scvBytes');
    const pm = byKey.get('payment_mode');
    expect(pm?.type).toBe('scvVec');
    if (pm?.type === 'scvVec') {
      expect(pm.vec?.length).toBe(1);
      expect(pm.vec?.[0]?.type).toBe('scvSymbol');
    }
  });

  it('round-trips through decode', () => {
    const t = sampleTerms();
    const back = decodeDealTerms(encodeDealTerms(t));
    expect(back.cost).toBe(t.cost);
    expect(back.importer).toBe(t.importer);
    expect(back.payment_mode.tag).toBe('Native');
    expect(Buffer.from(back.promise_hash).equals(t.promise_hash)).toBe(true);
  });

  it('changes the payload hash when any field changes', () => {
    const a = toHex(listPayloadHashOf(sampleTerms()));
    expect(toHex(listPayloadHashOf({ ...sampleTerms(), security: 1n }))).not.toBe(a);
    expect(toHex(listPayloadHashOf({ ...sampleTerms(), payment_mode: { tag: 'TrustlessWork', values: undefined } }))).not.toBe(a);
  });

  it('matches a hand-built ScVal for a tiny probe of the encoding rules', () => {
    // i128 8_000_000_000 -> hi 0, lo 8_000_000_000
    const scv = dealTermsToScVal(sampleTerms());
    if (scv.type !== 'scvMap' || !scv.map) throw new Error('not a map');
    const markup = scv.map.find((e) => e.key.type === 'scvSymbol' && e.key.sym.toStringStrict() === 'markup')?.val;
    const expected = xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 8_000_000_000n }));
    expect(markup?.toXdr('hex')).toBe(expected.toXdr('hex'));
  });
});
