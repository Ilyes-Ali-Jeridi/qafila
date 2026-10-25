import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attestationMessage, fromHex, toHex, verifyAttestation, shippedPayloadHash, listPayloadHash } from '@qafila/shared/attestation';
import { buildVectors, goldenTerms, GOLDEN_CONTRACT_ID, GOLDEN_PASSPHRASE, toKv } from '../src/golden.ts';
import { encodeDealTerms } from '../src/terms.ts';
import { repoRoot } from '../src/env.ts';

describe('golden attestation vectors', () => {
  const v = buildVectors();
  const pk = fromHex(v.verifierPublicKeyHex);

  it('are deterministic', () => {
    expect(JSON.stringify(buildVectors())).toBe(JSON.stringify(v));
  });

  it('every signature verifies and every message re-derives from its inputs', () => {
    for (const vec of v.vectors) {
      const payloadHash = fromHex(vec.payloadHashHex);
      const input = { purpose: vec.purpose, networkPassphrase: v.networkPassphrase, contractId: v.contractId, dealId: BigInt(vec.dealId), payloadHash };
      expect(toHex(attestationMessage(input))).toBe(vec.messageHex);
      expect(verifyAttestation(pk, input, fromHex(vec.signatureHex))).toBe(true);
      expect(verifyAttestation(pk, { ...input, purpose: vec.purpose + 1 }, fromHex(vec.signatureHex))).toBe(false);
    }
  });

  it('LIST payload is sha256 of the DealTerms XDR; SHIPPED is sha256(fp || report)', () => {
    const list = v.vectors[0]!;
    expect(list.name).toBe('LIST');
    expect(list.dealTermsXdrHex).toBe(toHex(encodeDealTerms(goldenTerms())));
    expect(list.payloadHashHex).toBe(toHex(listPayloadHash(fromHex(list.dealTermsXdrHex!))));
    const shipped = v.vectors[1]!;
    expect(shipped.payloadHashHex).toBe(toHex(shippedPayloadHash(fromHex(shipped.blFingerprintHex!), fromHex(shipped.blReportHashHex!))));
    const report = v.vectors[2]!;
    expect(report.payloadHashHex).toBe(report.reportHashHex);
    expect(v.contractId).toBe(GOLDEN_CONTRACT_ID);
    expect(v.networkPassphrase).toBe(GOLDEN_PASSPHRASE);
  });

  it('kv export carries every hex field', () => {
    const kv = toKv(v);
    expect(kv).toContain(`list_signature_hex=${v.vectors[0]!.signatureHex}`);
    expect(kv).toContain(`shipped_bl_fingerprint_hex=`);
    expect(kv).toContain('list_terms_cost=100000000000');
  });

  it('matches the committed data/golden/attestation_vectors.json when present', () => {
    const path = resolve(repoRoot(), 'data/golden/attestation_vectors.json');
    if (!existsSync(path)) return;
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(v)));
  });
});
