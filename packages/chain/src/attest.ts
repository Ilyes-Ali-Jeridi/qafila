/**
 * Attestation signing wrappers (PLAN 3.3.6) over `@qafila/shared/attestation`.
 * Purposes: 1 LIST, 2 SHIPPED, 10 REPORT. The verifier secret never leaves this process.
 */
import type { DealTerms } from '@qafila/contract-client';
import { Keypair } from '@stellar/stellar-sdk';
import {
  attestationMessage,
  shippedPayloadHash,
  signAttestation,
  verifyAttestation,
  verifierPublicKeyBytes,
  toHex,
} from '@qafila/shared/attestation';
import { ATTEST_PURPOSE } from '@qafila/shared/constants';
import { listPayloadHashOf, encodeDealTerms } from './terms.ts';

export interface AttestContext {
  contractId: string;
  passphrase: string;
  /** Verifier ed25519 secret (S...) or Keypair. */
  verifierSecret: string | Keypair;
}

export interface Attestation {
  purpose: number;
  dealId: bigint;
  payloadHash: Uint8Array;
  message: Uint8Array;
  sig: Buffer;
  verifierPublicKeyHex: string;
}

function keypairOf(secret: string | Keypair): Keypair {
  return typeof secret === 'string' ? Keypair.fromSecret(secret) : secret;
}

function sign(ctx: AttestContext, purpose: number, dealId: bigint, payloadHash: Uint8Array): Attestation {
  if (payloadHash.length !== 32) throw new Error('payloadHash must be 32 bytes');
  const kp = keypairOf(ctx.verifierSecret);
  const input = { purpose, networkPassphrase: ctx.passphrase, contractId: ctx.contractId, dealId, payloadHash };
  const message = attestationMessage(input);
  const sig = Buffer.from(signAttestation(kp, input));
  return { purpose, dealId, payloadHash, message, sig, verifierPublicKeyHex: toHex(verifierPublicKeyBytes(kp)) };
}

/** LIST: `deal_id = 0`, payload = sha256(DealTerms XDR). Also returns the XDR used. */
export function signList(terms: DealTerms, ctx: AttestContext): Attestation & { termsXdr: Uint8Array } {
  const termsXdr = encodeDealTerms(terms);
  return { ...sign(ctx, ATTEST_PURPOSE.LIST, 0n, listPayloadHashOf(terms)), termsXdr };
}

/** SHIPPED: payload = sha256(bl_fingerprint || bl_report_hash). */
export function signShipped(
  dealId: bigint | number,
  blFingerprint: Uint8Array,
  blReportHash: Uint8Array,
  ctx: AttestContext,
): Attestation {
  if (blFingerprint.length !== 32 || blReportHash.length !== 32) throw new Error('fingerprint and report hash must be 32 bytes');
  return sign(ctx, ATTEST_PURPOSE.SHIPPED, BigInt(dealId), shippedPayloadHash(blFingerprint, blReportHash));
}

/** REPORT (x402): `deal_id = 0`, payload = report hash. */
export function signReport(reportHash: Uint8Array, ctx: AttestContext): Attestation {
  return sign(ctx, ATTEST_PURPOSE.REPORT, 0n, reportHash);
}

/** Local check of any attestation against a verifier public key (raw 32 bytes, hex, or G address). */
export function checkAttestation(
  verifierPublicKey: Uint8Array | string,
  a: Pick<Attestation, 'purpose' | 'dealId' | 'payloadHash' | 'sig'>,
  ctx: Pick<AttestContext, 'contractId' | 'passphrase'>,
): boolean {
  const pk =
    typeof verifierPublicKey === 'string' && /^[0-9a-f]{64}$/i.test(verifierPublicKey)
      ? new Uint8Array(Buffer.from(verifierPublicKey, 'hex'))
      : verifierPublicKey;
  return verifyAttestation(
    pk,
    { purpose: a.purpose, networkPassphrase: ctx.passphrase, contractId: ctx.contractId, dealId: a.dealId, payloadHash: a.payloadHash },
    new Uint8Array(a.sig),
  );
}

/** The verifier's raw public key as the contract stores it (BytesN<32>). */
export function verifierKeyBytes(secret: string | Keypair): Buffer {
  return Buffer.from(verifierPublicKeyBytes(keypairOf(secret)));
}
