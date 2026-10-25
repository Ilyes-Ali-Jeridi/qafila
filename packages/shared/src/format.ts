import { DECIMALS, NETWORKS, type NetworkName } from './constants';

/** i128 stroops (bigint or decimal string) to a display string with two decimals. */
export function formatAmount(stroops: bigint | string | number, code = 'qUSD'): string {
  const n = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10n ** BigInt(DECIMALS);
  const frac = abs % 10n ** BigInt(DECIMALS);
  const cents = (frac / 10n ** BigInt(DECIMALS - 2)).toString().padStart(2, '0');
  const wholeStr = whole.toLocaleString('en-US');
  return `${neg ? '-' : ''}${wholeStr}.${cents} ${code}`;
}

/** Decimal string like "2000" or "2000.50" to i128 stroops. Rejects more than 7 decimals. */
export function parseAmount(input: string): bigint {
  const m = /^\s*(\d+)(?:\.(\d{1,7}))?\s*$/.exec(input);
  if (!m) throw new Error('invalid amount');
  const whole = BigInt(m[1]!);
  const frac = (m[2] ?? '').padEnd(DECIMALS, '0');
  return whole * 10n ** BigInt(DECIMALS) + BigInt(frac);
}

export function shortAddress(addr: string, head = 4, tail = 4): string {
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function expertTxUrl(network: NetworkName, hash: string): string | null {
  const base = NETWORKS[network].expert;
  return base ? `${base}/tx/${hash}` : null;
}

export function expertContractUrl(network: NetworkName, id: string): string | null {
  const base = NETWORKS[network].expert;
  return base ? `${base}/contract/${id}` : null;
}

export function expertAccountUrl(network: NetworkName, id: string): string | null {
  const base = NETWORKS[network].expert;
  return base ? `${base}/account/${id}` : null;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Expected investor profit for `amount` (PLAN 9.2): amount * (markup - fee) / cost, floor. */
export function expectedProfit(amount: bigint, markup: bigint, platformFee: bigint, cost: bigint): bigint {
  if (cost <= 0n) return 0n;
  return (amount * (markup - platformFee)) / cost;
}

/** FLOWS 8: ceil(cost * max(floor, min - onTime*step) / 10000). */
export function requiredSecurity(
  cost: bigint,
  onTime: number,
  cfg: { minSecurityBps: number; securityStepBps: number; securityFloorBps: number },
): bigint {
  const reduced = Math.max(cfg.securityFloorBps, cfg.minSecurityBps - onTime * cfg.securityStepBps);
  const num = cost * BigInt(reduced);
  return (num + 9999n) / 10000n;
}
