/** Deterministic normalisation (PLAN 5.2 Normalise). */

/** Full-width ASCII and punctuation to half-width; remove all bracket pairs; strip spaces. */
export function normaliseZhName(s: string | null | undefined): string {
  if (!s) return '';
  let out = '';
  for (const ch of s.normalize('NFKC')) {
    const code = ch.charCodeAt(0);
    out += code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : ch;
  }
  return out
    .replace(/[（）()\[\]【】「」『』〈〉《》]/g, '')
    .replace(/[\s　.,，。、·\-_/]/g, '')
    .toLowerCase();
}

const SUFFIXES: Array<[RegExp, string]> = [
  [/\bcompany\b/g, 'co'],
  [/\bcorporation\b/g, 'corp'],
  [/\bincorporated\b/g, 'inc'],
  [/\blimited\b/g, 'ltd'],
  [/\bco\.?,?\s*ltd\.?\b/g, 'co ltd'],
  [/\bltd\.?\b/g, 'ltd'],
  [/\bco\.\b/g, 'co'],
  [/\bimport\s*(&|and)\s*export\b/g, 'import export'],
  [/\bimp\s*(&|and)\s*exp\b/g, 'import export'],
];

/** Lower case, ASCII punctuation removed, legal suffixes unified, single spaces. */
export function normaliseEnName(s: string | null | undefined): string {
  if (!s) return '';
  let t = s.normalize('NFKC').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9&\s.,]/g, ' ');
  for (const [re, rep] of SUFFIXES) t = t.replace(re, rep);
  return t
    .replace(/[.,&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Core tokens of an English company name, without legal-form words, for loose comparison. */
export function coreEnName(s: string | null | undefined): string {
  return normaliseEnName(s)
    .split(' ')
    .filter((w) => !['co', 'ltd', 'corp', 'inc', 'the', 'of', 'and', 'group', 'international', 'intl'].includes(w))
    .join(' ');
}

export function normalisePort(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(port of|port|china|nigeria|kenya|p\.r\.c|prc|cn)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function unlocodeOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /\b([A-Z]{2}[A-Z2-9]{3})\b/.exec(s.toUpperCase());
  return m ? m[1]! : null;
}

export function normaliseContainer(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normaliseVessel(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\b(M\/?V|MV|MS|M\/?S|VESSEL|V\.)\b/g, ' ')
    .replace(/\b[0-9]{2,4}[A-Z]{0,2}\b$/g, ' ') // trailing voyage number
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseCurrency(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.toUpperCase().trim();
  const map: Record<string, string> = { US$: 'USD', USD$: 'USD', $: 'USD', RMB: 'CNY', '¥': 'CNY', 'RMB¥': 'CNY', '€': 'EUR', '£': 'GBP' };
  if (map[t]) return map[t]!;
  const m = /\b(USD|CNY|EUR|GBP|NGN|KES|AED|HKD|JPY)\b/.exec(t);
  return m ? m[1]! : t.length === 3 ? t : null;
}

export function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function normaliseUnit(u: string | null | undefined): string {
  const t = (u ?? '').toLowerCase().replace(/[.\s]/g, '');
  const map: Record<string, string> = { pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', unit: 'piece', units: 'piece', ea: 'piece', each: 'piece', set: 'set', sets: 'set', m: 'metre', mtr: 'metre', mtrs: 'metre', meter: 'metre', meters: 'metre', metre: 'metre', metres: 'metre', kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', sqm: 'sqm', m2: 'sqm', 'm²': 'sqm', sqmeter: 'sqm', pair: 'pair', pairs: 'pair', prs: 'pair', bottle: 'bottle', bottles: 'bottle', btl: 'bottle', btls: 'bottle', ton: 'tonne', tons: 'tonne', tonne: 'tonne', tonnes: 'tonne', mt: 'tonne', ctn: 'carton', ctns: 'carton', carton: 'carton', cartons: 'carton', dozen: 'dozen', dz: 'dozen', roll: 'roll', rolls: 'roll', box: 'box', boxes: 'box', bag: 'bag', bags: 'bag', w: 'watt', watt: 'watt', watts: 'watt' };
  return map[t] ?? (t || 'piece');
}
