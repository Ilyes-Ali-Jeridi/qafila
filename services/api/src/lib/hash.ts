import { createHash } from 'node:crypto';
import { canonicalJson } from '@qafila/shared/attestation';

export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

/** Stable request hash for caching and fixtures: canonical JSON of the input. */
export const requestHash = (input: unknown): string => sha256Hex(canonicalJson(input));
