import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calibrationSource, getDevice, pageSizeMm, type Engine } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const TEST_OUTPUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));
const MM_PER_PT = 25.4 / 72;
/** In the middle third of each edge, at least this share of the outermost row/column is dark. */
const MIN_DARK_SHARE = 0.9;

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
 * Share of dark pixels (all channels below 128) in the middle third of the outermost row or
 * column of the `widthPx` x `heightPx` device page, per edge.
 *
 * The engine rounds the page size up: its PNG is 1 to 2 px larger than the device, with white
 * padding at the right and bottom (kobo-sage: 1442 x 1921 for 1440 x 1920). So the device edge
 * is not the image edge, and a consumer must crop the PNG to the device size, not resize it.
 */
function edgeDarkShare(
  png: Uint8Array,
  widthPx: number,
  heightPx: number,
): { top: number; bottom: number; left: number; right: number } {
  const { width, data } = PNG.sync.read(Buffer.from(png));
  const dark = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    return data[i]! < 128 && data[i + 1]! < 128 && data[i + 2]! < 128;
  };
  const share = (length: number, at: (i: number) => boolean): number => {
    const from = Math.floor(length / 3);
    const to = Math.ceil((2 * length) / 3);
    let n = 0;
    for (let i = from; i < to; i++) if (at(i)) n++;
    return n / (to - from);
  };
  return {
    top: share(widthPx, (x) => dark(x, 0)),
    bottom: share(widthPx, (x) => dark(x, heightPx - 1)),
    left: share(heightPx, (y) => dark(0, y)),
    right: share(heightPx, (y) => dark(widthPx - 1, y)),
  };
}

let engine: Engine;

beforeAll(() => {
  engine = createWasmEngine();
});

afterAll(() => {
  engine.dispose();
});

describe('calibration page', () => {
  it.each(['kobo-sage', 'remarkable-2'])('compiles on %s to one page of the device size', async (id) => {
    const device = getDevice(id);
    const result = await engine.compile({
      source: calibrationSource(device, await engine.lilypondVersion()),
      filename: 'calibration.ly',
      files: {},
      formats: ['pdf', 'png'],
      resolution: device.ppi,
    });
    expect(result.ok).toBe(true);
    // No error and no warning, e.g. "page 1 has been compressed".
    expect(result.log).not.toMatch(/error|warning/i);

    const pdf = result.files['score.pdf'];
    expect(pdf).toBeDefined();
    expect(pdfPageCount(pdf!)).toBe(1);
    const expected = pageSizeMm(device);
    const [w, h] = pdfMediaBoxMm(pdf!);
    expect(Math.abs(w - expected.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h - expected.height)).toBeLessThanOrEqual(0.5);

    const pngs = Object.keys(result.files).filter((name) => name.endsWith('.png'));
    expect(pngs).toHaveLength(1);
    const png = result.files[pngs[0]!]!;
    mkdirSync(TEST_OUTPUT, { recursive: true });
    writeFileSync(join(TEST_OUTPUT, `calibration-${id}.png`), png);

    const size = PNG.sync.read(Buffer.from(png));
    expect(Math.abs(size.width - device.widthPx)).toBeLessThanOrEqual(2);
    expect(Math.abs(size.height - device.heightPx)).toBeLessThanOrEqual(2);
    const share = edgeDarkShare(png, device.widthPx, device.heightPx);
    expect(share.top).toBeGreaterThanOrEqual(MIN_DARK_SHARE);
    expect(share.bottom).toBeGreaterThanOrEqual(MIN_DARK_SHARE);
    expect(share.left).toBeGreaterThanOrEqual(MIN_DARK_SHARE);
    expect(share.right).toBeGreaterThanOrEqual(MIN_DARK_SHARE);
  });
});
