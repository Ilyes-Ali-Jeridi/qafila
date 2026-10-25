/**
 * Golden attestation vectors (SP11, PLAN 3.3.6): deterministic test data that Rust
 * and TypeScript must reproduce byte for byte. The verifier key is derived from a
 * fixed seed and is NOT the production verifier.
 */
import { Address, Keypair } from '@stellar/stellar-sdk';
import type { DealTerms } from '@qafila/contract-client';
import { contractAddressXdr, networkId, toHex, verifierPublicKeyBytes } from '@qafila/shared/attestation';
import { ATTEST_PREFIX } from '@qafila/shared/constants';
import { signList, signReport, signShipped } from './attest.ts';
import { encodeDealTerms } from './terms.ts';

export const GOLDEN_PASSPHRASE = 'Test SDF Network ; September 2015';
export const GOLDEN_CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const GOLDEN_VERIFIER_SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)); // 0x01..0x20
export const goldenVerifier = Keypair.fromRawEd25519Seed(GOLDEN_VERIFIER_SEED);

export function goldenTerms(): DealTerms {
  return {
    importer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x02)).publicKey(),
    supplier: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x03)).publicKey(),
    share_token: Address.contract(Buffer.alloc(32, 0x44)).toString(),
    payout_token: Address.contract(Buffer.alloc(32, 0x55)).toString(),
    cost: 100_000_000_000n, // 10,000 qUSD (FLOWS 4 worked example)
    deposit_bps: 3000,
    markup: 8_000_000_000n, // 800
    platform_fee: 2_000_000_000n, // 200
    late_fee: 500_000_000n, // 50
    funding_deadline: 1_761_480_000n,
    accept_window_secs: 86_400n,
    tenor_secs: 7_776_000n, // 90 days
    listing_fingerprint: Buffer.alloc(32, 0xaa),
    report_hash: Buffer.alloc(32, 0xbb),
    promise_hash: Buffer.alloc(32, 0xcc),
    halal_ok: true,
    payment_mode: { tag: 'Native', values: undefined },
    security: 20_000_000_000n, // 2,000 = 20% of cost on a first deal
  };
}

function termsJson(t: DealTerms): Record<string, string | number | boolean> {
  return {
    importer: t.importer,
    supplier: t.supplier,
    share_token: t.share_token,
    payout_token: t.payout_token,
    cost: t.cost.toString(),
    deposit_bps: t.deposit_bps,
    markup: t.markup.toString(),
    platform_fee: t.platform_fee.toString(),
    late_fee: t.late_fee.toString(),
    funding_deadline: t.funding_deadline.toString(),
    accept_window_secs: t.accept_window_secs.toString(),
    tenor_secs: t.tenor_secs.toString(),
    listing_fingerprint: toHex(t.listing_fingerprint),
    report_hash: toHex(t.report_hash),
    promise_hash: toHex(t.promise_hash),
    halal_ok: t.halal_ok,
    payment_mode: t.payment_mode.tag,
    security: t.security.toString(),
  };
}

export type GoldenVectors = ReturnType<typeof buildVectors>;

export function buildVectors() {
  const ctx = { contractId: GOLDEN_CONTRACT_ID, passphrase: GOLDEN_PASSPHRASE, verifierSecret: goldenVerifier };
  const terms = goldenTerms();
  const list = signList(terms, ctx);
  const blFp = Buffer.alloc(32, 0x11);
  const blReport = Buffer.alloc(32, 0x22);
  const shipped = signShipped(7, blFp, blReport, ctx);
  const reportHash = Buffer.alloc(32, 0x33);
  const report = signReport(reportHash, ctx);

  return {
    version: 1,
    generatedBy: 'scripts/golden-vectors.ts',
    note: 'Deterministic test data. The verifier key is derived from seed 0x01..0x20 and is not the production verifier.',
    prefix: ATTEST_PREFIX,
    prefixHex: toHex(new TextEncoder().encode(ATTEST_PREFIX)),
    networkPassphrase: GOLDEN_PASSPHRASE,
    networkIdHex: toHex(networkId(GOLDEN_PASSPHRASE)),
    contractId: GOLDEN_CONTRACT_ID,
    contractAddressXdrHex: toHex(contractAddressXdr(GOLDEN_CONTRACT_ID)),
    verifierSeedHex: toHex(GOLDEN_VERIFIER_SEED),
    verifierPublicKeyHex: toHex(verifierPublicKeyBytes(goldenVerifier)),
    verifierPublicKey: goldenVerifier.publicKey(),
    dealTermsFieldOrder: [
      'accept_window_secs', 'cost', 'deposit_bps', 'funding_deadline', 'halal_ok', 'importer', 'late_fee',
      'listing_fingerprint', 'markup', 'payment_mode', 'payout_token', 'platform_fee', 'promise_hash',
      'report_hash', 'security', 'share_token', 'supplier', 'tenor_secs',
    ],
    vectors: [
      {
        name: 'LIST',
        purpose: 1,
        dealId: '0',
        dealTerms: termsJson(terms),
        dealTermsXdrHex: toHex(encodeDealTerms(terms)),
        payloadHashHex: toHex(list.payloadHash),
        messageHex: toHex(list.message),
        signatureHex: toHex(list.sig),
      },
      {
        name: 'SHIPPED',
        purpose: 2,
        dealId: '7',
        blFingerprintHex: toHex(blFp),
        blReportHashHex: toHex(blReport),
        payloadHashHex: toHex(shipped.payloadHash),
        messageHex: toHex(shipped.message),
        signatureHex: toHex(shipped.sig),
      },
      {
        name: 'REPORT',
        purpose: 10,
        dealId: '0',
        reportHashHex: toHex(reportHash),
        payloadHashHex: toHex(report.payloadHash),
        messageHex: toHex(report.message),
        signatureHex: toHex(report.sig),
      },
    ],
  };
}

/** Flat key=value hex lines for a dependency-free Rust test reader. */
export function toKv(v: GoldenVectors): string {
  const lines: string[] = [
    `prefix_hex=${v.prefixHex}`,
    `network_id_hex=${v.networkIdHex}`,
    `contract_id=${v.contractId}`,
    `contract_address_xdr_hex=${v.contractAddressXdrHex}`,
    `verifier_public_key_hex=${v.verifierPublicKeyHex}`,
    `verifier_seed_hex=${v.verifierSeedHex}`,
  ];
  for (const vec of v.vectors) {
    const p = vec.name.toLowerCase();
    lines.push(`${p}_purpose=${vec.purpose}`, `${p}_deal_id=${vec.dealId}`);
    for (const [k, val] of Object.entries(vec)) {
      if (typeof val === 'string' && k.endsWith('Hex')) lines.push(`${p}_${k.replace(/Hex$/, '').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_hex=${val}`);
    }
  }
  const t = v.vectors[0]?.dealTerms;
  if (t) for (const [k, val] of Object.entries(t)) lines.push(`list_terms_${k}=${String(val)}`);
  return `${lines.join('\n')}\n`;
}

