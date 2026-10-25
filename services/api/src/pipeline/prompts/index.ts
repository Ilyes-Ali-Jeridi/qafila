/**
 * Versioned prompt files (PLAN 5.5). Each prompt lives in `<name>.v<version>.md`; the
 * version goes into the report. Bump the version whenever the text changes, because
 * LLM fixtures are keyed by prompt version.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Prompt {
  name: string;
  version: string;
  text: string;
}

const dir = import.meta.dirname;
const cache = new Map<string, Prompt>();

export function loadPrompt(name: string): Prompt {
  const hit = cache.get(name);
  if (hit) return hit;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${name}.v`) && f.endsWith('.md'));
  if (files.length === 0) throw new Error(`prompt ${name} not found in ${dir}`);
  const latest = files.sort((a, b) => versionOf(b).localeCompare(versionOf(a), undefined, { numeric: true }))[0]!;
  const p = { name, version: `${name}.v${versionOf(latest)}`, text: readFileSync(join(dir, latest), 'utf8').trim() };
  cache.set(name, p);
  return p;
}

const versionOf = (f: string): string => /\.v([0-9.]+)\.md$/.exec(f)?.[1] ?? '0';

export function listPrompts(): Prompt[] {
  const names = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.v[0-9.]+\.md$/, '')));
  return [...names].sort().map(loadPrompt);
}
