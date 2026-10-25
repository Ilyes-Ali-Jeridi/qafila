import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Seconds to a short human duration: "90 days", "2 h", "45 s". */
export function humanDuration(secs: number): string {
  if (secs >= 86_400) {
    const d = Math.round(secs / 86_400);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (secs >= 3_600) {
    const h = Math.round(secs / 3_600);
    return `${h} h`;
  }
  if (secs >= 60) {
    const m = Math.round(secs / 60);
    return `${m} min`;
  }
  return `${Math.max(0, Math.round(secs))} s`;
}

/** Unix seconds or ISO string to a short local date-time. */
export function formatDateTime(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === 0) return 'not set';
  const d = typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  if (Number.isNaN(d.getTime())) return 'not set';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === 0) return 'not set';
  const d = typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  if (Number.isNaN(d.getTime())) return 'not set';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Relative time for feeds: "just now", "3 min ago", "2 h ago". */
export function timeAgo(input: number | string): string {
  const t = typeof input === 'number' ? input * 1000 : new Date(input).getTime();
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3_600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3_600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** bigint percentage of part/whole with one decimal, clamped 0..100. */
export function percentOf(part: bigint | string, whole: bigint | string): number {
  const p = BigInt(part);
  const w = BigInt(whole);
  if (w <= 0n) return 0;
  const pct = Number((p * 1000n) / w) / 10;
  return Math.min(100, Math.max(0, pct));
}
