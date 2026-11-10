import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calibrationSource, getDevice, pageSizeMm, type Engine } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const TEST_OUTPUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));
const MM_PER_PT = 25.4 / 72;
/** Dark pixels must exist this close to every page edge. */
const EDGE_PX = 2;

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
 * Number of dark pixels (all channels below 128) in the `EDGE_PX` px band along each edge of the
 * `widthPx` x `heightPx` page. The engine's PNG is 1 to 2 px larger than that, with white padding
 * at the right and bottom, so the page edge is not the image edge.
 */
function darkPixelsAtEdges(
  png: Uint8Array,
  widthPx: number,
  heightPx: number,
): { top: number; bottom: number; left: number; right: number } {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  const counts = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < Math.min(height, heightPx); y++) {
    for (let x = 0; x < Math.min(width, widthPx); x++) {
      const i = (y * width + x) * 4;
      if (data[i]! >= 128 || data[i + 1]! >= 128 || data[i + 2]! >= 128) continue;
      if (y < EDGE_PX) counts.top++;
      if (y >= heightPx - EDGE_PX) counts.bottom++;
      if (x < EDGE_PX) counts.left++;
      if (x >= widthPx - EDGE_PX) counts.right++;
    }
  }
  return counts;
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
    expect(result.log).not.toMatch(/error/i);

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
    const dark = darkPixelsAtEdges(png, device.widthPx, device.heightPx);
    expect(dark.top).toBeGreaterThan(0);
    expect(dark.bottom).toBeGreaterThan(0);
    expect(dark.left).toBeGreaterThan(0);
    expect(dark.right).toBeGreaterThan(0);
  });
});
