/**
 * Review finding R-2 (FLOWS A-1): the agent pays the supplier deposit only when every
 * registry and sanctions check passed. A `skipped` lookup (no company code) or an
 * `unavailable` adapter is not a pass.
 */
import { describe, expect, it } from 'vitest';
import { gateChecks } from '../src/jobs/agent.js';

describe('agent deposit gate', () => {
  it('passes only when every check with the prefix is pass', () => {
    const rows = [{ name: 'registry.status', status: 'pass' }, { name: 'registry.name_match', status: 'pass' }, { name: 'sanctions.supplier', status: 'review' }];
    expect(gateChecks(rows, 'registry.')).toEqual({ failed: [], passed: true });
    expect(gateChecks(rows, 'sanctions.')).toEqual({ failed: ['sanctions.supplier:review'], passed: false });
  });

  it('treats a skipped registry lookup as not passed', () => {
    const r = gateChecks([{ name: 'registry.lookup', status: 'skipped' }], 'registry.');
    expect(r.passed).toBe(false);
    expect(r.failed).toEqual(['registry.lookup:skipped']);
  });

  it('treats unavailable and fail as not passed, and no checks at all as not passed', () => {
    expect(gateChecks([{ name: 'registry.lookup', status: 'unavailable' }], 'registry.').passed).toBe(false);
    expect(gateChecks([{ name: 'registry.status', status: 'fail' }], 'registry.').passed).toBe(false);
    expect(gateChecks([], 'registry.').passed).toBe(false);
  });
});
