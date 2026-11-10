import { describe, expect, it } from 'vitest';
import { calibrationSource, CALIBRATION_HINT, CALIBRATION_SENTENCE, wrapWords } from '../src/calibration.js';
import { getDevice, pageSizeMm, type DeviceSpec } from '../src/devices.js';

const sage = getDevice('kobo-sage');

describe('calibrationSource', () => {
  it('starts with the given version and has no wrapper include', () => {
    const src = calibrationSource(sage, '2.26.0');
    expect(src.startsWith('\\version "2.26.0"\n')).toBe(true);
    expect(src).not.toContain('\\include');
  });

  it.each(['kobo-sage', 'kobo-clara-bw', 'remarkable-2'])(
    'sets the exact page size of %s, without set-paper-size',
    (id) => {
      const device = getDevice(id);
      const { width, height } = pageSizeMm(device);
      const src = calibrationSource(device, '2.26.0');
      expect(src).toContain(`paper-width = ${width}\\mm`);
      expect(src).toContain(`paper-height = ${height}\\mm`);
      expect(src).not.toContain('set-paper-size');
      for (const side of ['top', 'bottom', 'left', 'right']) expect(src).toContain(`${side}-margin = 0\\mm`);
    },
  );

  it('removes headers, footers, page numbers and the tagline', () => {
    const src = calibrationSource(sage, '2.26.0');
    expect(src).toContain('tagline = ##f');
    expect(src).toContain('print-page-number = ##f');
    for (const m of ['oddHeaderMarkup', 'evenHeaderMarkup', 'oddFooterMarkup', 'evenFooterMarkup']) {
      expect(src).toContain(`${m} = ##f`);
    }
  });

  it('shows the device data and the sentence', () => {
    const src = calibrationSource(sage, '2.26.0');
    expect(src).toContain('"Kobo Sage (2021)"');
    expect(src).toContain('"121.92 x 162.56 mm"');
    expect(src).toContain('"1440 x 1920 px"');
    expect(src).toContain('"300 ppi"');
    // The sentence is wrapped over several strings; their words, in order, are the sentence.
    const strings = [...src.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]).join(' ');
    expect(strings).toContain(CALIBRATION_SENTENCE);
    expect(CALIBRATION_SENTENCE).toBe(
      'If you can see all four border lines and the 0 marks, the whole page is visible.',
    );
  });

  it('escapes quotes and backslashes in the device name', () => {
    const device: DeviceSpec = { ...sage, name: String.raw`My "Reader" \ Pro` };
    const src = calibrationSource(device, '2.26.0');
    expect(src).toContain(String.raw`"My \"Reader\" \\ Pro"`);
    expect(src).not.toContain('"My "Reader"');
  });

  it('replaces newlines in the device name by a space and keeps non-ASCII Latin letters', () => {
    const device: DeviceSpec = { ...sage, name: 'Tolino Vision\nGröße é' };
    const src = calibrationSource(device, '2.26.0');
    expect(src).toContain('"Tolino Vision Größe é"');
    expect(src).not.toContain('Vision\n');
  });

  it('shrinks a long device name, down to a minimum size', () => {
    const nameSize = (name: string): number => {
      const m = /abs-fontsize #([\d.]+) \\center-align \\bold/.exec(calibrationSource({ ...sage, name }, '2.26.0'));
      return Number(m?.[1]);
    };
    expect(nameSize(sage.name)).toBe(13);
    expect(nameSize('A rather long custom device name, really')).toBeLessThan(13);
    expect(nameSize('A rather long custom device name'.repeat(5))).toBe(7);
  });

  it('shows the hint about the depth ruler', () => {
    const strings = [...calibrationSource(sage, '2.26.0').matchAll(/"([^"\\]*)"/g)].map((m) => m[1]).join(' ');
    expect(strings).toContain(CALIBRATION_HINT);
  });

  it('rejects a version that is not a dotted number', () => {
    expect(() => calibrationSource(sage, '2.26"0')).toThrow(/version/i);
  });
});

describe('wrapWords', () => {
  it('balances the lines instead of leaving an orphan', () => {
    const lines = wrapWords('aaa bbb ccc ddd eee fff', 14);
    expect(lines).toEqual(['aaa bbb ccc', 'ddd eee fff']);
  });

  it('keeps a text that fits on one line', () => {
    expect(wrapWords('short text', 40)).toEqual(['short text']);
  });
});
