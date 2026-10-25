import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { toHex, verifierPublicKeyBytes } from '@qafila/shared/attestation';
import { checkAttestation, signList, signReport, signShipped, verifierKeyBytes } from '../src/attest.ts';
import { sampleTerms } from './terms.test.ts';

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const PASSPHRASE = 'Test SDF Network ; September 2015';

describe('attestation wrappers', () => {
  const kp = Keypair.random();
  const ctx = { contractId: CONTRACT, passphrase: PASSPHRASE, verifierSecret: kp.secret() };

  it('LIST signs sha256(DealTerms XDR) with deal_id 0 and verifies', () => {
    const a = signList(sampleTerms(), ctx);
    expect(a.purpose).toBe(1);
    expect(a.dealId).toBe(0n);
    expect(a.sig.length).toBe(64);
    expect(a.termsXdr.length).toBeGreaterThan(100);
    expect(a.verifierPublicKeyHex).toBe(toHex(verifierPublicKeyBytes(kp)));
    expect(checkAttestation(verifierKeyBytes(kp), a, ctx)).toBe(true);
    expect(checkAttestation(verifierKeyBytes(Keypair.random()), a, ctx)).toBe(false);
    expect(checkAttestation(verifierKeyBytes(kp), a, { ...ctx, contractId: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' })).toBe(false);
  });

  it('SHIPPED binds the deal id and both hashes', () => {
    const a = signShipped(7, Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22), ctx);
    expect(a.purpose).toBe(2);
    expect(a.dealId).toBe(7n);
    expect(checkAttestation(a.verifierPublicKeyHex, a, ctx)).toBe(true);
    expect(checkAttestation(a.verifierPublicKeyHex, { ...a, dealId: 8n }, ctx)).toBe(false);
    expect(() => signShipped(7, Buffer.alloc(31), Buffer.alloc(32), ctx)).toThrow();
  });

  it('REPORT uses purpose 10 and deal id 0', () => {
    const a = signReport(Buffer.alloc(32, 0x33), ctx);
    expect(a.purpose).toBe(10);
    expect(a.dealId).toBe(0n);
    expect(checkAttestation(a.verifierPublicKeyHex, a, ctx)).toBe(true);
    expect(checkAttestation(a.verifierPublicKeyHex, { ...a, purpose: 1 }, ctx)).toBe(false);
  });
});
