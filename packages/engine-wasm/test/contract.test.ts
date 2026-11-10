import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine, EngineRequest } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const engineVersion = JSON.parse(
  readFileSync(new URL('../engine-version.json', import.meta.url), 'utf8'),
) as { lilypond: string };

const MM_PER_PT = 25.4 / 72;

function req(source: string, extra: Partial<EngineRequest> = {}): EngineRequest {
  return { source, filename: 'score.ly', files: {}, formats: ['pdf'], ...extra };
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function pdfMediaBoxMm(pdf: Uint8Array): [number, number] {
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(latin1(pdf));
  if (!m) throw new Error('no MediaBox in PDF');
  return [Number(m[1]) * MM_PER_PT, Number(m[2]) * MM_PER_PT];
}

function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** Sorts names like score-page10.png after score-page9.png. */
function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

const smallPaper = String.raw`\paper { paper-width = 60\mm paper-height = 60\mm }`;
const longMusic = String.raw`{ \repeat unfold 60 { c'8 d' e' f' g' a' b' c'' } }`;
/** Still well over 300 ms of compile time, but much faster than veryLongMusic. */
const mediumMusic = String.raw`{ \repeat unfold 300 { c'16 d' e' f' g' a' b' c'' } }`;
/** Enough music that a compile takes well over a second. */
const veryLongMusic = String.raw`{ \repeat unfold 1500 { c'16 d' e' f' g' a' b' c'' } }`;

let engine: Engine;

beforeAll(() => {
  engine = createWasmEngine();
});

afterAll(() => {
  engine.dispose();
});

describe('engine-wasm contract', () => {
  it('reports the LilyPond version pinned in engine-version.json', async () => {
    expect(await engine.lilypondVersion()).toBe(engineVersion.lilypond);
  });

  it('writes PDF and PNG at 300 dpi with the requested paper size', async () => {
    const source = String.raw`\version "2.26.0"
\paper { paper-width = 122\mm paper-height = 163\mm }
{ c'4 d' e' f' }`;
    const result = await engine.compile(req(source, { formats: ['pdf', 'png'], resolution: 300 }));
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    const pdf = result.files['score.pdf'];
    const png = result.files['score.png'];
    expect(pdf).toBeDefined();
    expect(png).toBeDefined();

    const [wMm, hMm] = pdfMediaBoxMm(pdf!);
    expect(Math.abs(wMm - 122)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(hMm - 163)).toBeLessThanOrEqual(0.5);

    const [wPx, hPx] = pngSize(png!);
    expect(Math.abs(wPx - (122 / 25.4) * 300)).toBeLessThanOrEqual(6);
    expect(Math.abs(hPx - (163 / 25.4) * 300)).toBeLessThanOrEqual(6);
  });

  it('writes no point-and-click links into the PDF', async () => {
    const result = await engine.compile(req(String.raw`{ c'4 d' e' f' }`));
    expect(result.ok).toBe(true);
    expect(latin1(result.files['score.pdf']!)).not.toContain('textedit');
  });

  it('names the outputs of two books score.* and score-1.*', async () => {
    const result = await engine.compile(
      req(String.raw`\book { { c1 } } \book { { d1 } }`, { formats: ['pdf', 'png'], resolution: 50 }),
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.files).sort()).toEqual(
      ['score-1.pdf', 'score-1.png', 'score.pdf', 'score.png'],
    );
  });

  it('names multi-page PNGs score-page1.png, score-page2.png, ...', async () => {
    const result = await engine.compile(
      req(`${smallPaper}\n${longMusic}`, { formats: ['png'], resolution: 50 }),
    );
    expect(result.ok).toBe(true);
    const names = naturalSort(Object.keys(result.files));
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toEqual(names.map((_, i) => `score-page${i + 1}.png`));
  });

  it('names multi-book multi-page PNGs score-pageN.png and score-1-pageN.png', async () => {
    const source = `${smallPaper}\n\\book { ${longMusic} }\n\\book { ${longMusic} }`;
    const result = await engine.compile(req(source, { formats: ['png'], resolution: 50 }));
    expect(result.ok).toBe(true);
    const names = naturalSort(Object.keys(result.files));
    const first = names.filter((n) => n.startsWith('score-page'));
    const second = names.filter((n) => n.startsWith('score-1-page'));
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(second.length).toBeGreaterThanOrEqual(2);
    expect(first).toEqual(first.map((_, i) => `score-page${i + 1}.png`));
    expect(second).toEqual(second.map((_, i) => `score-1-page${i + 1}.png`));
    expect(names).toHaveLength(first.length + second.length);
  });

  it('resolves includes relative to the including file and its parent', async () => {
    const source = String.raw`\include "b.ily"
\include "../c.ily"
{ \bNote \cNote }`;
    const result = await engine.compile(
      req(source, {
        filename: 'a/x.ly',
        files: { 'a/b.ily': String.raw`bNote = c'1`, 'c.ily': String.raw`cNote = d'1` },
      }),
    );
    expect(result.log).not.toMatch(/error/);
    expect(result.ok).toBe(true);
  });

  it('does not resolve an include without ../ from the project root (measured)', async () => {
    // Measured fact, recorded in docs/engine-findings.md: the root is not searched, although
    // LilyPond lists `/input` in the search path it prints.
    const source = String.raw`\include "c.ily"
{ \cNote }`;
    const result = await engine.compile(
      req(source, { filename: 'a/x.ly', files: { 'c.ily': String.raw`cNote = d'1` } }),
    );
    expect(result.ok).toBe(false);
    expect(result.log).toMatch(/a\/x\.ly:1:\d+: error: cannot find file: `c\.ily'/);
  });

  it('reports a LilyPond error with exit code and file:line:col log', async () => {
    const result = await engine.compile(req(String.raw`{ \undefinedCommandXyz c'4 }`));
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.log).toMatch(/:\d+:\d+: error/m);
  });

  it('documents the Node shell risk (spec §5.4): (system ...) runs a real shell', async () => {
    const result = await engine.compile(
      req(String.raw`#(ly:message (format #f "SYSTEMRET=~a" (system "exit 7")))
{ c'1 }`),
    );
    expect(result.log).toContain('SYSTEMRET=1792');
  });

  it('aborts via signal and compiles again afterwards on the same engine', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const aborted = await engine.compile(req(veryLongMusic, { signal: controller.signal }));
    expect(aborted).toMatchObject({ ok: false, exitCode: -1, aborted: true, files: {} });

    const next = await engine.compile(req(String.raw`{ c'1 }`));
    expect(next.ok).toBe(true);
    expect(next.files['score.pdf']).toBeDefined();
  });

  it('returns aborted for an already-aborted signal', async () => {
    const result = await engine.compile(req(String.raw`{ c'1 }`, { signal: AbortSignal.abort() }));
    expect(result).toMatchObject({ ok: false, aborted: true, exitCode: -1 });
  });

  it('aborts after timeoutMs and never times out without it', async () => {
    const timedOut = await engine.compile(req(veryLongMusic, { timeoutMs: 300 }));
    expect(timedOut).toMatchObject({ ok: false, exitCode: -1, aborted: true });

    const unbounded = await engine.compile(req(mediumMusic));
    expect(unbounded.ok).toBe(true);
    expect(unbounded.aborted).toBeUndefined();
  });

  it('rejects after dispose', async () => {
    const own = createWasmEngine();
    own.dispose();
    await expect(own.compile(req(String.raw`{ c'1 }`))).rejects.toThrow('engine disposed');
    await expect(own.lilypondVersion()).rejects.toThrow('engine disposed');
  });

  it('preloads the engine and still compiles afterwards', async () => {
    const own = createWasmEngine();
    try {
      await own.preload?.();
      const result = await own.compile(req(String.raw`{ c'1 }`));
      expect(result.ok).toBe(true);
    } finally {
      own.dispose();
    }
  });

  it('rejects preload after dispose', async () => {
    const own = createWasmEngine();
    own.dispose();
    await expect(own.preload?.()).rejects.toThrow('engine disposed');
  });
});
