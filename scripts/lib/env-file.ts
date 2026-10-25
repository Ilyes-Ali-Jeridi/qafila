/**
 * Read and update `.env` at the repo root without ever printing a value.
 * Lines are replaced in place when the key exists, appended otherwise.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '@qafila/chain';

export function envPath(): string {
  return resolve(repoRoot(), '.env');
}

export function readEnvValue(key: string): string | undefined {
  const p = envPath();
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] === key) {
      const raw = (m[2] ?? '').trim();
      const unquoted = raw.replace(/^"(.*)"$/, '$1');
      return unquoted === '' ? undefined : unquoted;
    }
  }
  return undefined;
}

export function setEnvValues(values: Record<string, string>): void {
  const p = envPath();
  const lines = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && m[1] && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(p, `${out.join('\n')}\n`, { mode: 0o600 });
  for (const k of Object.keys(values)) process.env[k] = values[k];
}
