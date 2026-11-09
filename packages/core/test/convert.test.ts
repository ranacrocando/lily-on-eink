import { describe, expect, it } from 'vitest';
import { convert, type ConvertOptions, type Progress, type ProjectFile } from '../src/convert.js';
import type { Engine, EngineRequest, EngineResult } from '../src/engine.js';
import { OVERLAY_ILY } from '../src/overlay-sources.js';

const PDF = new Uint8Array([1]);
const PNG = new Uint8Array([2]);

/** Fake engine: records requests and answers with a canned result per wrapper filename. */
function fakeEngine(answer: (req: EngineRequest) => EngineResult | Promise<EngineResult> = () => ok()) {
  const requests: EngineRequest[] = [];
  const engine: Engine = {
    lilypondVersion: () => Promise.resolve('2.26.0'),
    compile: async (req) => {
      requests.push(req);
      return answer(req);
    },
    dispose: () => {},
  };
  return { engine, requests };
}

function ok(files: Record<string, Uint8Array> = { 'score.pdf': PDF }, log = ''): EngineResult {
  return { ok: true, exitCode: 0, files, log };
}

const sage: ConvertOptions = { device: 'kobo-sage' };

describe('convert', () => {
  it('places wrapper and overlay next to the main file and passes project files through', async () => {
    const { engine, requests } = fakeEngine();
    const files: ProjectFile[] = [
      { path: 'songs/a.ly', content: String.raw`\include "inc.ily" { c'1 }` },
      { path: 'songs/inc.ily', content: 'x = 1' },
    ];
    const result = await convert(files, { ...sage, outputs: ['pdf', 'png'], timeoutMs: 1234 }, engine);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.filename).toBe('songs/lily-on-eink-wrapper.ly');
    expect(req.source).toContain(String.raw`\include "a.ly"`);
    expect(req.source).toContain(String.raw`\version "2.26.0"`);
    expect(req.files['songs/lily-on-eink.ily']).toBe(OVERLAY_ILY);
    expect(req.files['songs/a.ly']).toBe(files[0]!.content);
    expect(req.files['songs/inc.ily']).toBe('x = 1');
    expect(req.formats).toEqual(['pdf', 'png']);
    expect(req.resolution).toBe(300);
    expect(req.timeoutMs).toBe(1234);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ mainFile: 'songs/a.ly', bookIndex: 0, pdf: PDF });
  });

  it('uses a root-level wrapper name without ./ and defaults to pdf output', async () => {
    const { engine, requests } = fakeEngine();
    await convert([{ path: 'a.ly', content: "{ c'1 }" }], sage, engine);
    expect(requests[0]!.filename).toBe('lily-on-eink-wrapper.ly');
    expect(Object.keys(requests[0]!.files)).toContain('lily-on-eink.ily');
    expect(requests[0]!.formats).toEqual(['pdf']);
  });

  it('applies profile staff size and margins plus the tagline option', async () => {
    const { engine, requests } = fakeEngine();
    await convert([{ path: 'a.ly', content: "{ c'1 }" }], { ...sage, profile: 'leadsheet', keepTagline: false }, engine);
    expect(requests[0]!.source).toContain('(set-global-staff-size 18)');
    expect(requests[0]!.source).toContain(String.raw`left-margin = 6\mm`);
    expect(requests[0]!.source).toContain(String.raw`\header { tagline = ##f }`);
    await convert([{ path: 'a.ly', content: "{ c'1 }" }], { ...sage, staffSize: 15 }, engine);
    expect(requests[1]!.source).toContain('(set-global-staff-size 15)');
    expect(requests[1]!.source).not.toContain('tagline');
  });

  it('decodes binary .ly content for analysis', async () => {
    const { engine, requests } = fakeEngine();
    const bytes = new TextEncoder().encode(String.raw`\include "inc.ily"`);
    await convert(
      [
        { path: 'a.ly', content: bytes },
        { path: 'inc.ily', content: '' },
      ],
      sage,
      engine,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.files['a.ly']).toBe(bytes);
  });

  it('takes the title from the main file header, else the basename', async () => {
    const { engine } = fakeEngine();
    const titled = String.raw`\header { subtitle = "Sub" title = "My \"Song\"" } { c'1 }`;
    const r1 = await convert([{ path: 'x/a.ly', content: titled }], sage, engine);
    expect(r1.outputs[0]!.fileName).toBe('My _Song_ – Kobo Sage (2021).pdf');
    const r2 = await convert([{ path: 'x/b.ly', content: String.raw`\header { title = \foo }` }], sage, engine);
    expect(r2.outputs[0]!.fileName).toBe('b – Kobo Sage (2021).pdf');
  });

  it('reports missing includes and skips only the affected main file', async () => {
    const { engine, requests } = fakeEngine();
    const result = await convert(
      [
        { path: 'a.ly', content: String.raw`\include "inc.ily"` },
        { path: 'inc.ily', content: String.raw`\include "gone.ily"` },
        { path: 'b.ly', content: "{ c'1 }" },
      ],
      sage,
      engine,
    );
    expect(requests.map((r) => r.source)).toEqual([expect.stringContaining(String.raw`\include "b.ly"`)]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'inc.ily', line: 1, severity: 'error', message: expect.stringContaining('gone.ily') }),
    );
    expect(result.outputs.map((o) => o.mainFile)).toEqual(['b.ly']);
  });

  it('honours mainFiles and reports unknown ones', async () => {
    const { engine, requests } = fakeEngine();
    const result = await convert(
      [
        { path: 'a.ly', content: "{ c'1 }" },
        { path: 'b.ly', content: "{ c'1 }" },
      ],
      { ...sage, mainFiles: ['b.ly', 'nope.ly'] },
      engine,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.source).toContain(String.raw`\include "b.ly"`);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'nope.ly', severity: 'error' }),
    );
  });

  it('groups books, warns about unrecognized outputs and normalizes the log', async () => {
    const { engine } = fakeEngine(() =>
      ok(
        { 'score.pdf': PDF, 'score-1.pdf': PDF, 'score-page1.png': PNG, 'weird.txt': PNG },
        '/input/a.ly:2:3: warning: hm',
      ),
    );
    const result = await convert([{ path: 'a.ly', content: "{ c'1 }" }], sage, engine);
    expect(result.outputs.map((o) => [o.bookIndex, o.fileName])).toEqual([
      [0, 'a – Kobo Sage (2021).pdf'],
      [1, 'a (2) – Kobo Sage (2021).pdf'],
    ]);
    expect(result.outputs[0]!.pngPages).toEqual([PNG]);
    expect(result.logs['a.ly']).toBe('a.ly:2:3: warning: hm');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'a.ly', line: 2, column: 3, severity: 'warning', message: 'hm' }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'a.ly', severity: 'warning', message: expect.stringContaining('weird.txt') }),
    );
  });

  it('continues after a failed, an aborted and a throwing main file, with progress', async () => {
    const { engine } = fakeEngine((req) => {
      if (req.source.includes('"a.ly"')) return { ok: false, exitCode: 1, files: {}, log: 'a.ly:1:1: error: bad' };
      if (req.source.includes('"b.ly"')) return { ok: false, exitCode: -1, aborted: true, files: {}, log: '' };
      if (req.source.includes('"c.ly"')) throw new Error('boom');
      return ok();
    });
    const progress: Progress[] = [];
    const files = ['a.ly', 'b.ly', 'c.ly', 'd.ly'].map((path) => ({ path, content: "{ c'1 }" }));
    const result = await convert(files, { ...sage, onProgress: (p) => progress.push(p) }, engine);
    expect(result.outputs.map((o) => o.mainFile)).toEqual(['d.ly']);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.file)).toEqual(['a.ly', 'a.ly', 'b.ly', 'c.ly']);
    expect(errors[3]!.message).toContain('boom');
    expect(progress.filter((p) => p.phase !== 'compiling')).toEqual([
      { mainFile: 'a.ly', index: 0, total: 4, phase: 'failed' },
      { mainFile: 'b.ly', index: 1, total: 4, phase: 'failed' },
      { mainFile: 'c.ly', index: 2, total: 4, phase: 'failed' },
      { mainFile: 'd.ly', index: 3, total: 4, phase: 'done' },
    ]);
    expect(progress.filter((p) => p.phase === 'compiling')).toHaveLength(4);
  });

  it('stops with one error and no further engine calls once the signal is aborted', async () => {
    const controller = new AbortController();
    const { engine, requests } = fakeEngine(() => {
      controller.abort();
      return { ok: false, exitCode: -1, aborted: true, files: {}, log: '' };
    });
    const files = ['a.ly', 'b.ly', 'c.ly'].map((path) => ({ path, content: "{ c'1 }" }));
    const result = await convert(files, { ...sage, signal: controller.signal }, engine);
    expect(requests).toHaveLength(1);
    const aborted = result.diagnostics.filter((d) => d.message === 'conversion aborted');
    expect(aborted).toHaveLength(1);
    expect(aborted[0]!.severity).toBe('error');

    const pre = fakeEngine();
    const r2 = await convert(files, { ...sage, signal: AbortSignal.abort() }, pre.engine);
    expect(pre.requests).toHaveLength(0);
    expect(r2.diagnostics.filter((d) => d.message === 'conversion aborted')).toHaveLength(1);
  });

  it('survives a throwing onProgress with a single warning', async () => {
    const { engine } = fakeEngine();
    const files = ['a.ly', 'b.ly'].map((path) => ({ path, content: "{ c'1 }" }));
    const result = await convert(
      files,
      {
        ...sage,
        onProgress: () => {
          throw new Error('ui gone');
        },
      },
      engine,
    );
    expect(result.outputs).toHaveLength(2);
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('ui gone');
  });

  it('warns when a project file is replaced by the overlay', async () => {
    const { engine, requests } = fakeEngine();
    const result = await convert(
      [
        { path: 'x/a.ly', content: "{ c'1 }" },
        { path: 'x/lily-on-eink.ily', content: '% mine' },
      ],
      sage,
      engine,
    );
    expect(requests[0]!.files['x/lily-on-eink.ily']).toBe(OVERLAY_ILY);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file: 'x/lily-on-eink.ily', severity: 'warning', message: expect.stringContaining('replaced') }),
    );
  });

  it('passes the signal through', async () => {
    const { engine, requests } = fakeEngine();
    const controller = new AbortController();
    await convert([{ path: 'a.ly', content: "{ c'1 }" }], { ...sage, signal: controller.signal }, engine);
    expect(requests[0]!.signal).toBe(controller.signal);
  });
});
