/**
 * Attestation encoding (PLAN 3.3.6), byte for byte the same as the Rust side.
 *
 * msg = sha256("QAFILA-ATTEST-V1" || u32be purpose || network_id || contract_address_xdr || u64be deal_id || payload_hash)
 *
 * Node only (uses node:crypto). The web app never signs; it reads signatures from the API.
 */
import { createHash } from 'node:crypto';
import { Address, Keypair } from '@stellar/stellar-sdk';
import { ATTEST_PREFIX } from './constants.js';

export function sha256(data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
export const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

/** RFC 8785 canonical JSON: sorted keys, no whitespace, ES6 number formatting. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function hashCanonical(value: unknown): Uint8Array {
  return sha256(canonicalJson(value));
}

export function networkId(passphrase: string): Uint8Array {
  return sha256(passphrase);
}

/** ScVal XDR bytes of a contract address, matching `Address::to_xdr` in Rust. */
export function contractAddressXdr(contractId: string): Uint8Array {
  return new Uint8Array(Address.fromString(contractId).toScVal().toXDR());
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function u64be(n: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface AttestationInput {
  purpose: number;
  networkPassphrase: string;
  contractId: string;
  dealId: bigint | number;
  payloadHash: Uint8Array;
}

/** The 32-byte message the verifier signs and the contract re-derives. */
export function attestationMessage(input: AttestationInput): Uint8Array {
  if (input.payloadHash.length !== 32) throw new Error('payloadHash must be 32 bytes');
  const prefix = new TextEncoder().encode(ATTEST_PREFIX);
  if (prefix.length !== 16) throw new Error('prefix must be 16 bytes');
  return sha256(
    concat(
      prefix,
      u32be(input.purpose),
      networkId(input.networkPassphrase),
      contractAddressXdr(input.contractId),
      u64be(input.dealId),
      input.payloadHash,
    ),
  );
}

export function signAttestation(secret: string | Keypair, input: AttestationInput): Uint8Array {
  const kp = typeof secret === 'string' ? Keypair.fromSecret(secret) : secret;
  return new Uint8Array(kp.sign(Buffer.from(attestationMessage(input))));
}

export function verifyAttestation(publicKey: Uint8Array | string, input: AttestationInput, sig: Uint8Array): boolean {
  const kp = typeof publicKey === 'string' ? Keypair.fromPublicKey(publicKey) : new Keypair({ type: 'ed25519', publicKey: Buffer.from(publicKey) });
  return kp.verify(Buffer.from(attestationMessage(input)), Buffer.from(sig));
}

/** LIST payload: sha256 of the DealTerms ScVal XDR (encode with the contract spec). */
export function listPayloadHash(dealTermsXdr: Uint8Array): Uint8Array {
  return sha256(dealTermsXdr);
}

/** SHIPPED payload: sha256(bl_fingerprint || bl_report_hash). */
export function shippedPayloadHash(blFingerprint: Uint8Array, blReportHash: Uint8Array): Uint8Array {
  return sha256(concat(blFingerprint, blReportHash));
}

/** Listing fingerprint (PLAN 5.2): supplier key, invoice number, invoice date, total, currency. */
export function listingFingerprint(p: {
  supplierKey: string; // USCC, or normalised legal name when there is no code
  invoiceNumber: string;
  invoiceDate: string; // ISO date
  total: string; // decimal string, 2 places
  currency: string;
}): Uint8Array {
  return hashCanonical({
    supplier: p.supplierKey.trim().toUpperCase(),
    invoice_number: p.invoiceNumber.trim().toUpperCase(),
    invoice_date: p.invoiceDate,
    total: p.total,
    currency: p.currency.trim().toUpperCase(),
  });
}

/** Shipment fingerprint (PLAN 5.2): carrier, B/L number, sorted container numbers. */
export function shipmentFingerprint(p: { carrier: string; blNumber: string; containers: string[] }): Uint8Array {
  return hashCanonical({
    carrier: p.carrier.trim().toUpperCase(),
    bl_number: p.blNumber.trim().toUpperCase(),
    containers: [...new Set(p.containers.map((c) => c.trim().toUpperCase()))].sort(),
  });
}

export function reportHash(report: unknown): Uint8Array {
  return hashCanonical(report);
}

/** A verifier keypair's raw 32-byte public key, as stored in the contract. */
export function verifierPublicKeyBytes(secretOrKeypair: string | Keypair): Uint8Array {
  const kp = typeof secretOrKeypair === 'string' ? Keypair.fromSecret(secretOrKeypair) : secretOrKeypair;
  return new Uint8Array(kp.rawPublicKey());
}
