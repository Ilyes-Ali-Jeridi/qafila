/**
 * Intake (PLAN 5.2): sha256, MIME and size checks, PDF rasterised to page PNGs with
 * `pdftoppm` (poppler) at about 110 dpi, capped at 20 pages, plus the text layer from
 * `pdftotext -layout` as a second channel for verbatim evidence and hidden-text checks.
 * JPG and PNG go straight in as one page.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sha256Hex } from '../lib/hash.js';

const run = promisify(execFile);

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_PAGES = 20;
export const RASTER_DPI = 110;

export type DocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface IngestedPage {
  index: number; // 1-based
  format: 'png' | 'jpeg';
  bytes: Uint8Array;
}

export interface IngestedDocument {
  sha256: string;
  mime: DocumentMime;
  size: number;
  pageCount: number;
  pages: IngestedPage[];
  /** Text layer (PDF only); empty for images. */
  text: string;
  truncated: boolean;
}

export function sniffMime(bytes: Uint8Array, declared?: string): DocumentMime {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (declared === 'application/pdf' || declared === 'image/jpeg' || declared === 'image/png') throw new Error(`file content does not match declared type ${declared}`);
  throw new Error('unsupported file type: only PDF, JPEG and PNG are accepted');
}

export async function ingestDocument(bytes: Uint8Array, declaredMime?: string): Promise<IngestedDocument> {
  if (bytes.length === 0) throw new Error('empty file');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('file larger than 15 MB');
  const mime = sniffMime(bytes, declaredMime);
  const sha256 = sha256Hex(bytes);
  if (mime !== 'application/pdf') {
    return { sha256, mime, size: bytes.length, pageCount: 1, pages: [{ index: 1, format: mime === 'image/png' ? 'png' : 'jpeg', bytes }], text: '', truncated: false };
  }
  const dir = await mkdtemp(join(tmpdir(), 'qafila-doc-'));
  try {
    const pdf = join(dir, 'in.pdf');
    await writeFile(pdf, bytes);
    const [{ stdout: info }, { stdout: text }] = await Promise.all([
      run('pdfinfo', [pdf], { timeout: 30_000 }).catch(() => ({ stdout: '' })),
      run('pdftotext', ['-layout', '-l', String(MAX_PAGES), pdf, '-'], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }).catch(() => ({ stdout: '' })),
    ]);
    const pagesMatch = /Pages:\s+(\d+)/.exec(info);
    const pageCount = pagesMatch ? Number(pagesMatch[1]) : 0;
    await run('pdftoppm', ['-r', String(RASTER_DPI), '-png', '-l', String(MAX_PAGES), pdf, join(dir, 'page')], { timeout: 120_000 });
    const files = (await readdir(dir)).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort((x, y) => pageNo(x) - pageNo(y));
    if (files.length === 0) throw new Error('pdf has no renderable pages');
    const pages: IngestedPage[] = [];
    for (const f of files) pages.push({ index: pageNo(f), format: 'png', bytes: new Uint8Array(await readFile(join(dir, f))) });
    return { sha256, mime, size: bytes.length, pageCount: pageCount || pages.length, pages, text: text.replace(/\f/g, '\n\n'), truncated: pageCount > MAX_PAGES };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const pageNo = (f: string): number => Number(/-(\d+)\.png$/.exec(f)?.[1] ?? '0');

/** Deterministic hidden-text detector on the text layer (PLAN 5.5, packet 11). */
export function findInjectionText(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const addressed = /\b(ai|assistant|llm|language model|system|reviewer|verifier|chatgpt|claude|qwen|model)\b/i;
  const directive = /\b(approve|ignore|override|disregard|mark|rate|score|pass(ed)?|bypass|skip|do not (flag|reject)|must)\b/i;
  for (const l of lines) {
    if (addressed.test(l) && directive.test(l)) out.push(l.slice(0, 300));
  }
  return [...new Set(out)];
}
