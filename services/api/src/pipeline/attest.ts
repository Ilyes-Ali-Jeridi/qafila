/**
 * Report signing (PLAN 3.3.6, 5.2): canonical JSON (RFC 8785), report_hash = sha256,
 * signed by the verifier key with purpose 10 (REPORT, deal_id 0) for x402 and ops, and
 * purpose 2 (SHIPPED) over sha256(bl_fingerprint || bl_report_hash) for the agent.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { ATTEST_PURPOSE, type VerificationReport } from '@qafila/shared';
import { canonicalJson, fromHex, sha256, shippedPayloadHash, signAttestation, toHex, verifierPublicKeyBytes } from '@qafila/shared/attestation';

export interface SignedReportBundle {
  canonical: string;
  reportHash: string;
  signature: string | null;
  verifierPublicKey: string | null;
  purpose: number;
  dealId: number;
}

export function canonicalReport(report: VerificationReport): { canonical: string; reportHash: string } {
  const canonical = canonicalJson(report);
  return { canonical, reportHash: toHex(sha256(canonical)) };
}

export function signReport(report: VerificationReport, opts: { verifierSecret: string | null; contractId: string | null; networkPassphrase: string }): SignedReportBundle {
  const { canonical, reportHash } = canonicalReport(report);
  if (!opts.verifierSecret || !opts.contractId) return { canonical, reportHash, signature: null, verifierPublicKey: null, purpose: ATTEST_PURPOSE.REPORT, dealId: 0 };
  const kp = Keypair.fromSecret(opts.verifierSecret);
  const sig = signAttestation(kp, { purpose: ATTEST_PURPOSE.REPORT, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId, dealId: 0, payloadHash: fromHex(reportHash) });
  return { canonical, reportHash, signature: toHex(sig), verifierPublicKey: toHex(verifierPublicKeyBytes(kp)), purpose: ATTEST_PURPOSE.REPORT, dealId: 0 };
}

/** SHIPPED attestation for confirm_shipment(agent, deal_id, bl_fingerprint, bl_report_hash, sig). */
export function signShipped(opts: { verifierSecret: string; contractId: string; networkPassphrase: string; dealId: number | bigint; blFingerprintHex: string; blReportHashHex: string }): { signature: Uint8Array; payloadHash: Uint8Array } {
  const payloadHash = shippedPayloadHash(fromHex(opts.blFingerprintHex), fromHex(opts.blReportHashHex));
  const signature = signAttestation(Keypair.fromSecret(opts.verifierSecret), { purpose: ATTEST_PURPOSE.SHIPPED, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId, dealId: opts.dealId, payloadHash });
  return { signature, payloadHash };
}

/** LIST attestation over sha256(DealTerms XDR). */
export function signList(opts: { verifierSecret: string; contractId: string; networkPassphrase: string; dealTermsXdr: Uint8Array }): { signature: Uint8Array; payloadHash: Uint8Array } {
  const payloadHash = sha256(opts.dealTermsXdr);
  const signature = signAttestation(Keypair.fromSecret(opts.verifierSecret), { purpose: ATTEST_PURPOSE.LIST, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId, dealId: 0, payloadHash });
  return { signature, payloadHash };
}

export const VERIFY_HOWTO = 'msg = sha256("QAFILA-ATTEST-V1" || u32be(purpose) || sha256(network_passphrase) || ScVal XDR of the contract address || u64be(deal_id) || payload_hash); check ed25519(verifier_public_key, msg, signature). payload_hash = report_hash = sha256(RFC 8785 canonical JSON of `report`). On-chain: call verify_attestation(purpose, deal_id, payload_hash, sig) on the Qafila contract; it traps on an invalid signature.';
