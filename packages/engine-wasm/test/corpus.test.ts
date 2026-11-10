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
  SYSTEM_START_ALLOWANCE_MM,
  type ConvertResult,
  type Engine,
  type ProjectFile,
} from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const CORPUS = fileURLToPath(new URL('../../../corpus/', import.meta.url));
const TEST_OUTPUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));

const MM_PER_PT = 25.4 / 72;
const SAGE_MM = { width: 121.92, height: 162.56 };
/** 1.5 mm at 300 dpi: nothing may be drawn this close to the page edge. */
const BAND_PX = Math.round((1.5 * 300) / 25.4);

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

/**
 * Number of pixels within `band` px of any edge that have a channel below 250.
 * With `leftRows`, only the left band within rows [from, to] is checked.
 */
function nonWhiteInBand(png: Uint8Array, band: number, leftRows?: [number, number]): number {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const [y0, y1] = leftRows ?? [0, height - 1];
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      const inBand = leftRows ? x < band : x < band || x >= width - band || y < band || y >= height - band;
      if (!inBand) continue;
      const i = (y * width + x) * 4;
      if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) count++;
    }
  }
  return count;
}

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Row range [first, last] of the first staff on the page, where the first system's instrument
 * name sits. Rows dark over more than half the width are staff lines; adjacent rows merge into
 * one line. The staff space is the measured spacing of the first two lines, and the staff
 * continues while the next gap stays under 1.5 staff spaces (the gap to the next staff, even a
 * TabStaff, is several staff spaces).
 */
function firstStaffRows(png: Uint8Array): [number, number] {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const lines: { from: number; to: number }[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4]! < 128) dark++;
    if (dark <= width / 2) continue;
    const prev = lines.at(-1);
    if (prev?.to === y - 1) prev.to = y;
    else lines.push({ from: y, to: y });
  }
  if (lines.length < 2) throw new Error('no staff found');
  const centres = lines.map((l) => (l.from + l.to) / 2);
  const threshold = 1.5 * (centres[1]! - centres[0]!);
  let last = 0;
  while (last + 1 < lines.length && centres[last + 1]! - centres[last]! < threshold) last++;
  return [lines[0]!.from, lines[last]!.to];
}

/**
 * Centres of the dark runs (any channel < 128) in the pixel column at `fraction` of the
 * width, top down. Runs longer than `maxRun` px (barlines, stems) are ignored.
 */
function darkRunCentres(png: Uint8Array, fraction: number, maxRun = 4): number[] {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const x = Math.floor(width * fraction);
  const centres: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const i = (y * width + x) * 4;
    const dark = y < height && (data[i]! < 128 || data[i + 1]! < 128 || data[i + 2]! < 128);
    if (dark && start < 0) start = y;
    if (!dark && start >= 0) {
      if (y - start <= maxRun) centres.push((start + y - 1) / 2);
      start = -1;
    }
  }
  return centres;
}

function savePages(name: string, pages: Uint8Array[]): void {
  mkdirSync(TEST_OUTPUT, { recursive: true });
  pages.forEach((page, i) => {
    writeFileSync(join(TEST_OUTPUT, `${name}-page${i + 1}.png`), page);
  });
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

  const expectBandWhite = async (c: Case) => {
    const { pngPages = [] } = (await convertOnSage(c)).outputs[0]!;
    expect(pngPages.length).toBeGreaterThan(0);
    for (const page of pngPages) expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
  };

  // leise-rieselt's two-column verse markup is wider than the line; the overlay scales it down.
  it.each(CASES)('$name draws nothing within 1.5 mm of the page edge', expectBandWhite);

  it('applies the staff size: 17 pt gives a staff space of about 17.7 px at 300 dpi', async () => {
    const files: ProjectFile[] = [
      { path: 'staff.ly', content: String.raw`\header { tagline = ##f } \new Staff { s1*8 }` },
    ];
    const result = await convert(files, { device: 'kobo-sage', staffSize: 17, outputs: ['png'] }, engine);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = result.outputs[0]?.pngPages?.[0];
    expect(page).toBeDefined();
    const gaps: number[] = [];
    for (const fraction of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const centres = darkRunCentres(page!, fraction).slice(0, 5);
      expect(centres).toHaveLength(5);
      gaps.push(...centres.slice(1).map((c, i) => c - centres[i]!));
    }
    expect(Math.abs(median(gaps) - 17.7)).toBeLessThanOrEqual(1);
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
      // Without configure! the overlay's book handler does not widen the indent again.
      omitConfigure: true,
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

    // Only the left band next to the first staff, where the "Bass" instrument name sits.
    const normal = (await convertOnSage(CASES[1])).outputs[0]!.pngPages![0]!;
    expect(nonWhiteInBand(normal, BAND_PX, firstStaffRows(normal))).toBe(0);
    expect(nonWhiteInBand(pages[0]!, BAND_PX, firstStaffRows(pages[0]!))).toBeGreaterThan(0);
  });
});

describe('corpus on other devices', () => {
  it.each(['kobo-clara-bw', 'remarkable-2'])('reger converts on %s with the device page size', async (id) => {
    const result = await convert(
      loadCorpusDir('organ/reger-lobe-den-herren'),
      { device: id, profile: 'organ' },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outputs).toHaveLength(1);
    const expected = pageSizeMm(getDevice(id));
    const [w, h] = pdfMediaBoxMm(result.outputs[0]!.pdf!);
    expect(Math.abs(w - expected.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h - expected.height)).toBeLessThanOrEqual(0.5);
  });
});

/**
 * The title area of a page: every row above the first staff line (with `fromBottom`, the
 * footer area: every row below the last staff line, listed bottom up). A staff line is a row
 * with a continuous dark run (any channel < 128) longer than a third of the width; text never
 * has one, although a bold, full-width title line can be dark over more than half of a row.
 */
function titleRows(png: Uint8Array, fromBottom = false): { width: number; rows: boolean[][] } {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const rows: boolean[][] = [];
  for (let n = 0; n < height; n++) {
    const y = fromBottom ? height - 1 - n : n;
    const row: boolean[] = [];
    let run = 0;
    let longest = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dark = data[i]! < 128 || data[i + 1]! < 128 || data[i + 2]! < 128;
      row.push(dark);
      run = dark ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest > width / 3) break;
    rows.push(row);
  }
  return { width, rows };
}

/**
 * Bounding box of the ink in the title area (rows and columns, inclusive). With `fromBottom`,
 * the footer area; rows then count from the bottom edge, so only the height is meaningful.
 */
function titleInk(
  png: Uint8Array,
  fromBottom = false,
): { top: number; bottom: number; left: number; right: number; width: number } {
  const { width, rows } = titleRows(png, fromBottom);
  const box = { top: -1, bottom: -1, left: width, right: -1, width };
  rows.forEach((row, y) => {
    const first = row.indexOf(true);
    if (first < 0) return;
    if (box.top < 0) box.top = y;
    box.bottom = y;
    box.left = Math.min(box.left, first);
    box.right = Math.max(box.right, row.lastIndexOf(true));
  });
  if (box.top < 0) throw new Error('no ink outside the staves');
  return box;
}

/** True if the title area has ink in the column range [from, to). */
function titleInkInColumns(png: Uint8Array, from: number, to: number): boolean {
  return titleRows(png).rows.some((row) => row.slice(from, to).includes(true));
}

describe('titles on kobo-sage', () => {
  const device = getDevice('kobo-sage');
  const pxPerMm = device.ppi / 25.4;
  const margins = effectiveMarginsMm(getProfile('generic'), device);
  /** Left and right end of the line, in px from the left and right page edge. */
  const lineLeftPx = (margins.left + SYSTEM_START_ALLOWANCE_MM) * pxPerMm;
  const lineRightPx = margins.right * pxPerMm;
  const MUSIC = String.raw`\new Staff \with { \omit Clef \omit TimeSignature } { \repeat unfold 16 { c''1 } }`;

  /**
   * Page 1 of a synthetic score, through convert() (and so buildWrapper) on kobo-sage with the
   * generic profile and, unless asked for, no tagline. Clef and time signature are omitted and
   * the 16 bars fill the first system, so the only ink above its first staff line is the
   * titles (and below the last staff line, the footer). `score` replaces the default music.
   */
  async function renderTitles(
    name: string,
    header: string,
    opts: { paper?: string; score?: string; keepTagline?: boolean } = {},
  ): Promise<Uint8Array> {
    const source = String.raw`\header { ${header} }
${opts.paper ?? ''}
${opts.score ?? MUSIC}
`;
    const result = await convert(
      [{ path: 'titles.ly', content: source }],
      { device: 'kobo-sage', outputs: ['png'], keepTagline: opts.keepTagline ?? false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = result.outputs[0]?.pngPages?.[0];
    expect(page).toBeDefined();
    savePages(`title-${name}`, [page!]);
    return page!;
  }

  // Line count heuristic: the title area's ink height, compared with the ink height of a
  // one-line title made of the same words. "Long title" has ascenders (L, t, l) and a
  // descender (g), so no single line of these words can be taller than it; a ratio above
  // 1.8 therefore means at least two lines. This avoids counting blank-row gaps between
  // lines, which descenders and ascenders of adjacent lines can close.
  const WORDS = 'Long title';
  let singleLineHeight: Promise<number> | undefined;
  const oneLineHeight = () =>
    (singleLineHeight ??= renderTitles('one-line', `title = "${WORDS}"`).then((page) => {
      const box = titleInk(page);
      return box.bottom - box.top + 1;
    }));

  it('wraps a long string title onto several lines inside the page', async () => {
    const page = await renderTitles('long-string', `title = "${Array(8).fill(WORDS).join(' ')}"`);
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page);
    expect(box.bottom - box.top + 1).toBeGreaterThan(1.8 * (await oneLineHeight()));
  });

  it('scales a markup title that is too wide down to the line width, on one line', async () => {
    const page = await renderTitles(
      'long-markup',
      String.raw`title = \markup { \bold "Very long markup title that is far too wide for the narrow page of an e-reader" }`,
    );
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page);
    // Scaled, not wrapped: one line high at most, and it fills the line from end to end.
    expect(box.bottom - box.top + 1).toBeLessThanOrEqual(await oneLineHeight());
    expect(box.left).toBeGreaterThanOrEqual(lineLeftPx - 3);
    expect(box.width - 1 - box.right).toBeGreaterThanOrEqual(lineRightPx - 3);
    expect(box.right - box.left + 1).toBeGreaterThan(0.95 * (box.width - lineLeftPx - lineRightPx));
  });

  it('keeps a short title on one line, centred on the line', async () => {
    const page = await renderTitles('short', `title = "${WORDS}"`);
    const box = titleInk(page);
    expect(box.bottom - box.top + 1).toBeLessThanOrEqual(await oneLineHeight());
    // The line is not centred on the page (the left margin is wider), so compare the ink
    // margins with the line ends, not with the page edges.
    const left = box.left - lineLeftPx;
    const right = box.width - 1 - box.right - lineRightPx;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(4);
  });

  it('renders poet flush left and composer flush right', async () => {
    const page = await renderTitles(
      'poet-composer',
      `title = "${WORDS}" poet = "Poet Name" composer = "Composer Name"`,
    );
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const { width } = PNG.sync.read(Buffer.from(page));
    // The centred title stays in the middle; the outer quarters hold only poet and composer.
    expect(titleInkInColumns(page, 0, Math.round(width / 4))).toBe(true);
    expect(titleInkInColumns(page, Math.round((3 * width) / 4), width)).toBe(true);
  });

  it("overrides a bookTitleMarkup from the user's own \\paper block", async () => {
    // The user's markup would print the title on one line, overflowing both edges.
    const page = await renderTitles('user-paper', `title = "${Array(8).fill(WORDS).join(' ')}"`, {
      paper: String.raw`\paper { bookTitleMarkup = \markup \fill-line { \huge \fromproperty #'header:title } }`,
    });
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page);
    expect(box.bottom - box.top + 1).toBeGreaterThan(1.8 * (await oneLineHeight()));
  });

  it('stacks a long poet and a long composer when they do not fit side by side', async () => {
    // Reference: one poet line of the same words, at the poet's (normal) size.
    const reference = titleInk(await renderTitles('poet-one-line', `poet = "${WORDS}"`));
    const long = Array(4).fill(WORDS).join(' ');
    const page = await renderTitles('poet-composer-long', `poet = "${long}" composer = "${long}"`);
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page);
    expect(box.bottom - box.top + 1).toBeGreaterThan(1.8 * (reference.bottom - reference.top + 1));
  });

  it('fits the full title that print-all-headers repeats above a score', async () => {
    const long = Array(8).fill(WORDS).join(' ');
    const page = await renderTitles('print-all-headers', '', {
      paper: String.raw`\paper { print-all-headers = ##t }`,
      score: String.raw`\score { ${MUSIC} \header { title = "${long}" piece = "Piece" opus = "Op. 1" } }`,
    });
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page);
    expect(box.bottom - box.top + 1).toBeGreaterThan(1.8 * (await oneLineHeight()));
  });

  it('wraps a long tagline string inside the page', async () => {
    const tagline = Array(10).fill(WORDS).join(' ');
    const page = await renderTitles('tagline', `tagline = "${tagline}"`, { keepTagline: true });
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    // Unwrapped, this tagline would be about twice the line width.
    const box = titleInk(page, true);
    expect(box.left).toBeGreaterThanOrEqual(lineLeftPx - 3);
    expect(box.width - 1 - box.right).toBeGreaterThanOrEqual(lineRightPx - 3);
  });
});

describe('top-level markup on kobo-sage', () => {
  const device = getDevice('kobo-sage');
  const pxPerMm = device.ppi / 25.4;
  const margins = effectiveMarginsMm(getProfile('leadsheet'), device);
  const lineRightPx = margins.right * pxPerMm;
  const MUSIC = String.raw`\relative c'' { \time 3/4 c4 d e | f2. | e4 d c | c2. \bar "|." }`;
  const VERSE = String.raw`\line { \bold "2." \column { "Morning light on the river," "boats drift slowly along," "gulls are calling the harbour," "humming their morning song." } }`;

  /** Page 1 of `files` on kobo-sage with the leadsheet profile and no tagline. */
  async function renderPage(name: string, files: ProjectFile[]): Promise<Uint8Array> {
    const result = await convert(
      files,
      { device: 'kobo-sage', profile: 'leadsheet', outputs: ['png'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = result.outputs[0]?.pngPages?.[0];
    expect(page).toBeDefined();
    savePages(`markup-${name}`, [page!]);
    return page!;
  }

  /**
   * Height of the lowest block of ink on the page: the markup after the score. The block ends
   * (upwards) at the first run of `gap` blank rows; lines and rows of verses are closer than
   * that, the last system is further away.
   */
  const markupHeight = (page: Uint8Array, gap = 40) => {
    const { width, height, data } = PNG.sync.read(Buffer.from(page));
    const inked = (y: number) => {
      for (let x = 0; x < width; x++) if (data[(y * width + x) * 4]! < 128) return true;
      return false;
    };
    let bottom = height - 1;
    while (bottom >= 0 && !inked(bottom)) bottom--;
    let top = bottom;
    for (let y = bottom, blank = 0; y >= 0 && blank < gap; y--) {
      if (inked(y)) {
        top = y;
        blank = 0;
      } else blank++;
    }
    return bottom - top + 1;
  };

  it('reflows four side-by-side verses into rows at full size instead of shrinking them', async () => {
    const page = await renderPage('wide-verses', loadCorpusDir('leadsheet/wide-verses'));
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    // Reference: one verse of four lines, which fits unscaled. Scaled down to fit, the four
    // verses side by side would be about half as high as that; reflowed into two rows of two,
    // they are about twice as high.
    const reference = await renderPage('one-verse', [
      { path: 'one-verse.ly', content: `${MUSIC}\n\\markup ${VERSE}\n` },
    ]);
    expect(markupHeight(page)).toBeGreaterThan(1.8 * markupHeight(reference));
  });

  it('scales a slightly too wide markup and markup list line down to the line width', async () => {
    const wide = 'A remark that is a little too wide for the narrow page of an e-reader, by some way.';
    const page = await renderPage('slightly-wide', [
      {
        path: 'slightly-wide.ly',
        content: String.raw`${MUSIC}
\markup \line { "${wide}" }
\markuplist \column-lines { "Short line." "${wide}" }
`,
      },
    ]);
    expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    const box = titleInk(page, true);
    expect(box.width - 1 - box.right).toBeGreaterThanOrEqual(lineRightPx - 3);
    // Scaled, not reflowed: the remark still fills the line.
    expect(box.right).toBeGreaterThan(box.width - lineRightPx - 10);
  });
});

describe('device paper inside \\book and \\bookpart on kobo-sage', () => {
  const BOOKS = [
    { name: 'book-paper', dir: 'books/book-paper', outputs: 1 },
    { name: 'bookpart-paper', dir: 'books/bookpart-paper', outputs: 2 },
    { name: 'book-paper-commands', dir: 'books/book-paper-commands', outputs: 1 },
  ] as const;

  it.each(BOOKS)('$name gets the device page size and draws nothing in the edge band', async (c) => {
    const result = await convert(
      loadCorpusDir(c.dir),
      { device: 'kobo-sage', outputs: ['pdf', 'png'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outputs).toHaveLength(c.outputs);
    result.outputs.forEach((output, i) => {
      const [w, h] = pdfMediaBoxMm(output.pdf!);
      expect(Math.abs(w - SAGE_MM.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(h - SAGE_MM.height)).toBeLessThanOrEqual(0.5);
      const pages = output.pngPages ?? [];
      expect(pages.length).toBeGreaterThan(0);
      savePages(`${c.name}-${i}`, pages);
      for (const page of pages) expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
    });
  });

  it('overrides a top-level line-width (the implicit book passes the same handler)', async () => {
    const source = String.raw`\paper { line-width = 200\mm } \new Staff { \repeat unfold 24 { c''4 d'' e'' f'' } }`;
    const result = await convert(
      [{ path: 'line-width.ly', content: source }],
      { device: 'kobo-sage', outputs: ['png'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pages = result.outputs[0]!.pngPages!;
    savePages('line-width', pages);
    for (const page of pages) expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
  });

  it('keeps the staff size against set-global-staff-size inside a \\book', async () => {
    const result = await convert(
      loadCorpusDir('books/book-paper-commands'),
      { device: 'kobo-sage', staffSize: 17, outputs: ['png'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = result.outputs[0]!.pngPages![0]!;
    // First to last staff line: four staff spaces (plus one line thickness). 17 pt = 17.7 px.
    const [first, last] = firstStaffRows(page);
    expect(Math.abs((last - first) / 4 - 17.7)).toBeLessThanOrEqual(1);
  });

  it('drops the tagline of an explicit \\book when keepTagline is false', async () => {
    const result = await convert(
      loadCorpusDir('books/book-paper'),
      { device: 'kobo-sage', outputs: ['png'], keepTagline: false },
      engine,
    );
    const { width, height, data } = PNG.sync.read(Buffer.from(result.outputs[0]!.pngPages![0]!));
    // The music ends in the upper half; the footer area (bottom 15 %) has no copyright in this
    // file and must have no tagline either.
    let ink = 0;
    for (let i = Math.floor(0.85 * height) * width * 4; i < data.length; i += 4) if (data[i]! < 128) ink++;
    expect(ink).toBe(0);
  });
});

describe('instrument names on kobo-sage', () => {
  const device = getDevice('kobo-sage');
  const pxPerMm = device.ppi / 25.4;
  /** The profile's left margin; names may use it down to 0.5 mm less, never the page edge. */
  const minLeftPx = (effectiveMarginsMm(getProfile('generic'), device).left - 0.5) * pxPerMm;
  const RIGHT = String.raw`\relative c'' { \repeat unfold 16 { c4 d e f } }`;
  const LEFT = String.raw`\relative c { \clef bass \repeat unfold 16 { c4 g c g } }`;
  const NAMES = [
    {
      name: 'piano',
      source: String.raw`\new PianoStaff \with { instrumentName = "Piano" shortInstrumentName = "Pno." } << \new Staff ${RIGHT} \new Staff ${LEFT} >>`,
    },
    {
      name: 'long-name',
      source: String.raw`\new Staff \with { instrumentName = "Klavier rechts" } ${RIGHT}`,
    },
    {
      name: 'layout-indent-0',
      source: String.raw`\score {
  \new Staff { \set Staff.instrumentName = "Klavier rechts" \set Staff.shortInstrumentName = "Kl. re." ${RIGHT} }
  \layout { indent = 0 short-indent = 0 }
}`,
    },
    {
      name: 'toplevel-layout-indent-0',
      source: String.raw`\layout { indent = 0 short-indent = 0 }
\new Staff \with { instrumentName = "Violoncello primo" shortInstrumentName = "Vc. I" } ${RIGHT}`,
    },
    {
      name: 'deep-nesting',
      source: String.raw`\layout { indent = 0 short-indent = 0 }
\new StaffGroup << \new StaffGroup <<
  \new ChoirStaff <<
    \new Staff \with { instrumentName = "Sopran I" shortInstrumentName = "Sopran I" } ${RIGHT}
    \new Staff \with { instrumentName = "Alt" shortInstrumentName = "Alt" } ${RIGHT}
  >>
  \new GrandStaff \with { instrumentName = "Klavier" shortInstrumentName = "Klavier" } << \new Staff ${RIGHT} \new Staff ${LEFT} >>
>> >>`,
    },
  ];

  /** Staff lines (rows dark over more than half the width), merged, with their first dark column. */
  function staffLines(png: Uint8Array): { row: number; start: number }[] {
    const { width, height, data } = PNG.sync.read(Buffer.from(png));
    const lines: { row: number; start: number }[] = [];
    for (let y = 0; y < height; y++) {
      let dark = 0;
      let start = -1;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4]! < 128) {
          dark++;
          if (start < 0) start = x;
        }
      }
      if (dark <= width / 2) continue;
      if (lines.at(-1)?.row === y - 1) lines.at(-1)!.row = y;
      else lines.push({ row: y, start });
    }
    return lines;
  }

  /** Leftmost dark column (any channel < 128) in rows [from, to]. */
  function leftmostInk(png: Uint8Array, from: number, to: number): number {
    const { width, data } = PNG.sync.read(Buffer.from(png));
    let left = width;
    for (let y = from; y <= to; y++) {
      for (let x = 0; x < left; x++) {
        const i = (y * width + x) * 4;
        if (data[i]! < 128 || data[i + 1]! < 128 || data[i + 2]! < 128) left = x;
      }
    }
    return left;
  }

  async function render(name: string, source: string): Promise<Uint8Array[]> {
    const result = await convert(
      [{ path: `${name}.ly`, content: source }],
      { device: 'kobo-sage', outputs: ['png'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pages = result.outputs[0]!.pngPages!;
    expect(pages.length).toBeGreaterThan(0);
    savePages(`names-${name}`, pages);
    return pages;
  }

  it.each(NAMES)('$name keeps the instrument names inside the left margin', async ({ name, source }) => {
    for (const page of await render(name, source)) {
      expect(nonWhiteInBand(page, BAND_PX)).toBe(0);
      // Every system, from the first to the last staff line on the page: names, braces and
      // brackets stay right of the profile margin.
      const lines = staffLines(page);
      expect(leftmostInk(page, lines[0]!.row, lines.at(-1)!.row)).toBeGreaterThanOrEqual(minLeftPx);
    }
  });

  it('widens the indent only for the score that has names', async () => {
    const [page] = await render(
      'mixed-scores',
      String.raw`\score { \new Staff \with { instrumentName = "Violoncello primo" } ${RIGHT} }
\score { \new Staff ${RIGHT} \layout { indent = 0 } }`,
    );
    const lines = staffLines(page!);
    expect(leftmostInk(page!, lines[0]!.row, lines.at(-1)!.row)).toBeGreaterThanOrEqual(minLeftPx);
    // The second score starts after the first score's systems. Its first system keeps
    // indent = 0: its staff lines start at the line start, like the unindented systems.
    const starts = lines.map((l) => l.start);
    const lineStart = Math.min(...starts);
    const firstStart = starts[0]!;
    expect(firstStart).toBeGreaterThan(lineStart + 100);
    // Exactly one staff (five lines) is indented: the first system of the first score.
    expect(starts.filter((s) => s > lineStart + 10)).toHaveLength(5);
  });
});

describe('book output names on kobo-sage', () => {
  it('ignores \\bookOutputName and \\bookOutputSuffix, so every book is an output', async () => {
    const music = String.raw`\relative c'' { \repeat unfold 12 { c4 d e f } }`;
    const source = String.raw`\book { \bookOutputSuffix "eins" \score { ${music} } }
\book { \score { ${music} } }
\book { \bookOutputName "drittes" \score { ${music} } }
`;
    const result = await convert(
      [{ path: 'books.ly', content: source }],
      { device: 'kobo-sage', outputs: ['pdf'], keepTagline: false },
      engine,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outputs).toHaveLength(3);
    for (const output of result.outputs) expect(output.pdf).toBeDefined();
  });
});
