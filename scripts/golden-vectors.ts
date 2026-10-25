/**
 * Writes data/golden/attestation_vectors.json and .kv (SP11, PLAN 3.3.6).
 * The vectors themselves live in packages/chain/src/golden.ts so tests import them.
 *
 * Usage: pnpm golden-vectors
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildVectors, repoRoot, toKv } from '@qafila/chain';

const out = resolve(repoRoot(), 'data/golden');
mkdirSync(out, { recursive: true });
const vectors = buildVectors();
writeFileSync(resolve(out, 'attestation_vectors.json'), `${JSON.stringify(vectors, null, 2)}\n`);
writeFileSync(resolve(out, 'attestation_vectors.kv'), toKv(vectors));
console.log(`wrote ${resolve(out, 'attestation_vectors.json')} (${vectors.vectors.length} vectors) and attestation_vectors.kv`);
