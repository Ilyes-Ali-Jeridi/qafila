/**
 * DealTerms encoding for the LIST attestation (PLAN 3.3.6).
 *
 * Rust side: `terms.to_xdr(&env)` on a `#[contracttype]` struct produces an ScVal
 * map whose keys are symbols in sorted field order. The generated contract spec
 * lists the fields in that same order, so `spec.nativeToScVal(terms, DealTerms)`
 * reproduces the bytes. We still sort the map entries defensively.
 */
import type { DealTerms } from '@qafila/contract-client';
import { xdr } from '@stellar/stellar-sdk';
import { listPayloadHash } from '@qafila/shared/attestation';
import { qafilaSpec } from './spec.ts';

function udt(name: string): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}

function symbolName(v: xdr.ScVal): string {
  if (v.type !== 'scvSymbol') throw new Error('map key is not a symbol');
  return v.sym.toStringStrict();
}

/** Returns the ScVal for `DealTerms` with map entries sorted by key, as the host does. */
export function dealTermsToScVal(terms: DealTerms): xdr.ScVal {
  const scv = qafilaSpec().nativeToScVal(terms, udt('DealTerms'));
  if (scv.type !== 'scvMap') throw new Error('DealTerms did not encode as a map');
  const entries = scv.map;
  if (!entries || entries.length === 0) throw new Error('DealTerms map is empty');
  const sorted = [...entries].sort((a, b) => {
    const ka = symbolName(a.key);
    const kb = symbolName(b.key);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return xdr.ScVal.scvMap(sorted);
}

/** ScVal XDR bytes of `DealTerms`, byte for byte what Rust `terms.to_xdr(&env)` returns. */
export function encodeDealTerms(terms: DealTerms): Uint8Array {
  return new Uint8Array(dealTermsToScVal(terms).toXdr());
}

/** `payload_hash` for the LIST attestation: sha256 of the DealTerms XDR. */
export function listPayloadHashOf(terms: DealTerms): Uint8Array {
  return listPayloadHash(encodeDealTerms(terms));
}

/** Sorted field names of DealTerms as the spec declares them. */
export function dealTermsFieldOrder(): string[] {
  for (const e of qafilaSpec().entries) {
    if (e.type === 'scSpecEntryUdtStructV0' && e.udtStructV0.name.toStringStrict() === 'DealTerms') {
      return e.udtStructV0.fields.map((f) => f.name.toStringStrict());
    }
  }
  throw new Error('DealTerms not in spec');
}

/** Decodes DealTerms XDR bytes back to the generated type (for checks and tests). */
export function decodeDealTerms(bytes: Uint8Array): DealTerms {
  const scv = xdr.ScVal.fromXdr(bytes);
  return qafilaSpec().scValToNative<DealTerms>(scv, udt('DealTerms'));
}
