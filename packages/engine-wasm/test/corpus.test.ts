import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWrapper,
  convert,
  effectiveMarginsMm,
  effectiveStaffSize,
  getDevice,
  getProfile,
  pageSizeMm,
  type ConvertResult,
  type Engine,
  type ProjectFile,
} from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const CORPUS = fileURLToPath(new URL('../../../corpus/', import.meta.url));
const TEST_OUTPUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));

const MM_PER_PT = 25.4 / 72;
const SAGE_MM = { width: 121.92, height: 162.56 };
/** 2.5 mm at 300 dpi. */
const BAND_PX = Math.round((2.5 * 300) / 25.4);

/** Loads every file under corpus/<dir>, keyed by its POSIX path relative to corpus/. */
function loadCorpusDir(dir: string): ProjectFile[] {
  const root = join(CORPUS, dir);
  const out: ProjectFile[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    out.push({ path: relative(CORPUS, abs).split(sep).join('/'), content: readFileSync(abs, 'utf8') });
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function pdfMediaBoxMm(pdf: Uint8Array): [number, number] {
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(latin1(pdf));
  if (!m) throw new Error('no MediaBox in PDF');
  return [Number(m[1]) * MM_PER_PT, Number(m[2]) * MM_PER_PT];
}

function pdfPageCount(pdf: Uint8Array): number {
  return latin1(pdf).match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

/** Number of pixels within `band` px of any edge that have a channel below 250. */
function nonWhiteInBand(png: Uint8Array, band: number): number {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * 4;
      if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) count++;
    }
  }
  return count;
}

/** Centres of the dark runs (any channel < 128) in the pixel column at 50% width, top down. */
function darkRunCentres(png: Uint8Array): number[] {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const x = Math.floor(width / 2);
  const centres: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const i = (y * width + x) * 4;
    const dark = y < height && (data[i]! < 128 || data[i + 1]! < 128 || data[i + 2]! < 128);
    if (dark && start < 0) start = y;
    if (!dark && start >= 0) {
      centres.push((start + y - 1) / 2);
      start = -1;
    }
  }
  return centres;
}

function savePages(name: string, pages: Uint8Array[]): void {
  mkdirSync(TEST_OUTPUT, { recursive: true });
  pages.forEach((page, i) => writeFileSync(join(TEST_OUTPUT, `${name}-page${i + 1}.png`), page));
}

const CASES = [
  { name: 'reger', dir: 'organ/reger-lobe-den-herren', profile: 'organ' },
  { name: 'bass-etude', dir: 'bass/bass-etude-e-minor', profile: 'tab' },
  { name: 'leise-rieselt', dir: 'leadsheet/leise-rieselt-der-schnee', profile: 'leadsheet' },
] as const;

let engine: Engine;

beforeAll(() => {
  engine = createWasmEngine();
});

afterAll(() => {
  engine.dispose();
});

type Case = (typeof CASES)[number];
const sageResults = new Map<string, Promise<ConvertResult>>();

/** Converts a case once on kobo-sage (PDF and PNG); later tests reuse the result. */
function convertOnSage({ name, dir, profile }: Case): Promise<ConvertResult> {
  let result = sageResults.get(name);
  if (!result) {
    result = convert(loadCorpusDir(dir), { device: 'kobo-sage', profile, outputs: ['pdf', 'png'] }, engine);
    sageResults.set(name, result);
  }
  return result;
}

describe('corpus on kobo-sage', () => {
  it.each(CASES)('$name converts cleanly with profile $profile', async (c) => {
    const { name } = c;
    const result = await convertOnSage(c);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outputs).toHaveLength(1);
    const { pdf, pngPages = [] } = result.outputs[0]!;
    expect(pdf).toBeDefined();
    savePages(name, pngPages);

    const [w, h] = pdfMediaBoxMm(pdf!);
    expect(Math.abs(w - SAGE_MM.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h - SAGE_MM.height)).toBeLessThanOrEqual(0.5);

    const pages = pdfPageCount(pdf!);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
    expect(pngPages).toHaveLength(pages);

    expect(latin1(pdf!)).not.toContain('textedit');
  });

  // KNOWN FAILURE with the slice overlay (3 mm margin, no indent handling, no title markup).
  // Measured ink inside the 29 px band on the 300 dpi pages:
  // - all three: bar numbers (and, for reger and bass-etude, the system-start bracket or brace)
  //   sit left of the staff, x 0..28;
  // - reger: the long title overflows both edges;
  // - leise-rieselt: the verse markup (two columns) overflows the right edge.
  // `it.fails` turns red as soon as a case passes, so this flips back to `it` when fixed.
  it.fails.each(CASES)('$name keeps the 2.5 mm margin band white on every page', async (c) => {
    const { pngPages = [] } = (await convertOnSage(c)).outputs[0]!;
    expect(pngPages.length).toBeGreaterThan(0);
    for (const page of pngPages) expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
  });

  it('applies the staff size: 17 pt gives a staff space of about 17.7 px at 300 dpi', async () => {
    const files: ProjectFile[] = [
      { path: 'staff.ly', content: String.raw`\header { tagline = ##f } \new Staff { s1*8 }` },
    ];
    const result = await convert(files, { device: 'kobo-sage', staffSize: 17, outputs: ['png'] }, engine);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = result.outputs[0]?.pngPages?.[0];
    expect(page).toBeDefined();
    const centres = darkRunCentres(page!).slice(0, 5);
    expect(centres).toHaveLength(5);
    const gaps = centres.slice(1).map((c, i) => c - centres[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.abs(mean - 17.7)).toBeLessThanOrEqual(1);
  });

  it('negative control: indent = 0 pushes the instrument name into the margin band', async () => {
    const device = getDevice('kobo-sage');
    const profile = getProfile('tab');
    const dir = 'bass/bass-etude-e-minor';
    const files: Record<string, string | Uint8Array> = {};
    for (const f of loadCorpusDir(dir)) files[f.path] = f.content;
    const wrapper = buildWrapper({
      mainBasename: 'bass-etude-e-minor.ly',
      pageMm: pageSizeMm(device),
      marginsMm: effectiveMarginsMm(profile, device),
      staffSize: effectiveStaffSize(profile, device),
      keepTagline: true,
      lilypondVersion: await engine.lilypondVersion(),
      extraPaper: 'indent = 0',
    });
    files[`${dir}/${wrapper.overlay.name}`] = wrapper.overlay.content;
    const result = await engine.compile({
      source: wrapper.source,
      filename: `${dir}/lily-on-eink-wrapper.ly`,
      files,
      formats: ['png'],
      resolution: device.ppi,
    });
    expect(result.ok).toBe(true);
    const pages = Object.entries(result.files)
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([, bytes]) => bytes);
    savePages('negative-control-indent-0', pages);
    expect(nonWhiteInBand(pages[0]!, BAND_PX)).toBeGreaterThan(0);
  });
});

describe('corpus on other devices', () => {
  it.each(['kobo-clara-bw', 'remarkable-2'])('reger converts on %s with the device page size', async (id) => {
    const result = await convert(loadCorpusDir('organ/reger-lobe-den-herren'), { device: id, profile: 'organ' }, engine);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outputs).toHaveLength(1);
    const expected = pageSizeMm(getDevice(id));
    const [w, h] = pdfMediaBoxMm(result.outputs[0]!.pdf!);
    expect(Math.abs(w - expected.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h - expected.height)).toBeLessThanOrEqual(0.5);
  });
});
