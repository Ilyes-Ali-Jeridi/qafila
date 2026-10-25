import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  attestationMessage,
  canonicalJson,
  listingFingerprint,
  shipmentFingerprint,
  signAttestation,
  toHex,
  verifyAttestation,
  verifierPublicKeyBytes,
} from '../src/attestation.js';
import { formatAmount, parseAmount, requiredSecurity, expectedProfit } from '../src/format.js';
import { riskScore } from '../src/report.js';

const CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'; // any valid C address
const PASSPHRASE = 'Test SDF Network ; September 2015';

describe('canonical JSON (RFC 8785)', () => {
  it('sorts keys, drops whitespace and undefined, keeps arrays ordered', () => {
    expect(canonicalJson({ b: 1, a: [3, { z: null, y: 'x' }], c: undefined })).toBe('{"a":[3,{"y":"x","z":null}],"b":1}');
  });
  it('formats numbers like ES6', () => {
    expect(canonicalJson({ n: 1.0, m: 1e21, k: 0.000001 })).toBe('{"k":0.000001,"m":1e+21,"n":1}');
  });
});

describe('attestation message', () => {
  const payload = new Uint8Array(32).fill(9);
  const base = { purpose: 1, networkPassphrase: PASSPHRASE, contractId: CONTRACT, dealId: 0, payloadHash: payload };
  it('is 32 bytes and deterministic', () => {
    const a = attestationMessage(base);
    expect(a.length).toBe(32);
    expect(toHex(a)).toBe(toHex(attestationMessage({ ...base })));
  });
  it('changes with purpose, network, contract, deal id and payload', () => {
    const a = toHex(attestationMessage(base));
    expect(toHex(attestationMessage({ ...base, purpose: 2 }))).not.toBe(a);
    expect(toHex(attestationMessage({ ...base, networkPassphrase: 'x' }))).not.toBe(a);
    expect(toHex(attestationMessage({ ...base, dealId: 1 }))).not.toBe(a);
    expect(toHex(attestationMessage({ ...base, payloadHash: new Uint8Array(32) }))).not.toBe(a);
  });
  it('signs and verifies with ed25519; a wrong key fails', () => {
    const kp = Keypair.random();
    const sig = signAttestation(kp, base);
    expect(sig.length).toBe(64);
    expect(verifyAttestation(verifierPublicKeyBytes(kp), base, sig)).toBe(true);
    expect(verifyAttestation(verifierPublicKeyBytes(Keypair.random()), base, sig)).toBe(false);
    expect(verifyAttestation(verifierPublicKeyBytes(kp), { ...base, purpose: 2 }, sig)).toBe(false);
  });
});

describe('fingerprints', () => {
  it('listing fingerprint ignores case and whitespace, depends on every field', () => {
    const a = listingFingerprint({ supplierKey: '91110108551385082Q', invoiceNumber: 'inv-001 ', invoiceDate: '2026-10-01', total: '12000.00', currency: 'usd' });
    const b = listingFingerprint({ supplierKey: '91110108551385082q', invoiceNumber: 'INV-001', invoiceDate: '2026-10-01', total: '12000.00', currency: 'USD' });
    const c = listingFingerprint({ supplierKey: '91110108551385082Q', invoiceNumber: 'INV-002', invoiceDate: '2026-10-01', total: '12000.00', currency: 'USD' });
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
  });
  it('shipment fingerprint sorts and dedupes containers', () => {
    const a = shipmentFingerprint({ carrier: 'MAEU', blNumber: 'MAEU123', containers: ['MSKU9070323', 'CSQU3054383'] });
    const b = shipmentFingerprint({ carrier: 'maeu', blNumber: 'MAEU123', containers: ['CSQU3054383', 'MSKU9070323', 'MSKU9070323'] });
    expect(toHex(a)).toBe(toHex(b));
  });
});

describe('amounts', () => {
  it('parses and formats with 7 decimals', () => {
    expect(parseAmount('2000')).toBe(20_000_000_000n);
    expect(parseAmount('2000.5')).toBe(20_005_000_000n);
    expect(formatAmount(20_005_000_000n)).toBe('2,000.50 qUSD');
    expect(() => parseAmount('1.12345678')).toThrow();
  });
  it('required security follows FLOWS 8 (20%, minus 2.5 points per on-time deal, floor 10%)', () => {
    const cfg = { minSecurityBps: 2000, securityStepBps: 250, securityFloorBps: 1000 };
    const cost = parseAmount('10000');
    expect(requiredSecurity(cost, 0, cfg)).toBe(parseAmount('2000'));
    expect(requiredSecurity(cost, 2, cfg)).toBe(parseAmount('1500'));
    expect(requiredSecurity(cost, 10, cfg)).toBe(parseAmount('1000'));
    expect(requiredSecurity(parseAmount('0.0000001'), 0, cfg)).toBe(1n); // ceil
  });
  it('expected profit is amount * (markup - fee) / cost', () => {
    expect(expectedProfit(parseAmount('500'), parseAmount('800'), parseAmount('200'), parseAmount('10000'))).toBe(parseAmount('30'));
  });
  it('risk score subtracts weights of non-pass checks, floor 0', () => {
    expect(riskScore([{ name: 'a', status: 'pass', severity: 'info', detail: '', weight: 50 }])).toBe(100);
    expect(riskScore([{ name: 'a', status: 'fail', severity: 'critical', detail: '', weight: 60 }, { name: 'b', status: 'review', severity: 'low', detail: '', weight: 60 }])).toBe(0);
  });
});
