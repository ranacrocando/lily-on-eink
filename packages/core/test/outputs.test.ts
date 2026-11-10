import { describe, expect, it } from 'vitest';
import { groupOutputs, outputFileName, safeFileName } from '../src/outputs.js';

const b = (n: number) => new Uint8Array([n]);

describe('groupOutputs', () => {
  it('maps pdfs', () => {
    const r = groupOutputs({ 'score.pdf': b(1), 'score-1.pdf': b(2) });
    expect(r.books).toEqual([
      { bookIndex: 0, pdf: b(1), pngPages: [] },
      { bookIndex: 1, pdf: b(2), pngPages: [] },
    ]);
  });
  it('maps pngs including book and page suffixes, in page order', () => {
    const r = groupOutputs({
      'score-page2.png': b(2),
      'score-page1.png': b(1),
      'score-1.png': b(3),
      'score-2-page2.png': b(5),
      'score-2-page1.png': b(4),
    });
    expect(r.books.map((x) => [x.bookIndex, x.pngPages])).toEqual([
      [0, [b(1), b(2)]],
      [1, [b(3)]],
      [2, [b(4), b(5)]],
    ]);
  });
  it('treats score.png as page 1 of book 0', () => {
    expect(groupOutputs({ 'score.png': b(9) }).books).toEqual([{ bookIndex: 0, pngPages: [b(9)] }]);
  });
  it('collects unrecognized names', () => {
    const r = groupOutputs({ 'other.pdf': b(1), 'score.midi': b(2), 'score.pdf': b(3) });
    expect(r.unrecognized.sort()).toEqual(['other.pdf', 'score.midi']);
    expect(r.books).toHaveLength(1);
  });
});

describe('outputFileName', () => {
  it('uses the title', () => {
    expect(outputFileName('Song', 'x.ly', 'Kobo Sage', 0)).toBe('Song – Kobo Sage.pdf');
  });
  it('falls back to the basename without extension', () => {
    expect(outputFileName(undefined, 'dir/x.ly', 'Dev', 0)).toBe('x – Dev.pdf');
    expect(outputFileName('', 'x.ly', 'Dev', 0)).toBe('x – Dev.pdf');
  });
  it('appends the book number for later books', () => {
    expect(outputFileName('Song', 'x.ly', 'Dev', 1)).toBe('Song (2) – Dev.pdf');
  });
  it('replaces FAT32-unsafe characters and trims trailing dots and spaces', () => {
    expect(outputFileName('a<b>:c"/d\\e|f?g*h\u0001', 'x.ly', 'Dev', 0)).toBe('a_b__c__d_e_f_g_h_ – Dev.pdf');
    expect(outputFileName('Song. . ', 'x.ly', 'Dev', 0)).toBe('Song – Dev.pdf');
  });
  it('caps the total length at 150 by truncating the base', () => {
    const n = outputFileName('x'.repeat(400), 'x.ly', 'Kobo Sage', 1);
    expect(n.length).toBeLessThanOrEqual(150);
    expect(n.endsWith(' (2) – Kobo Sage.pdf')).toBe(true);
  });
  it('truncates a very long device name and keeps the separator and extension', () => {
    const n = outputFileName('Song', 'x.ly', 'D'.repeat(400), 1);
    expect(n.length).toBeLessThanOrEqual(150);
    expect(n.startsWith('Song (2) – D')).toBe(true);
    expect(n.endsWith('.pdf')).toBe(true);
  });
  it('falls back to score for an empty base and never starts with a space', () => {
    expect(outputFileName('...', 'x.ly', 'Dev', 0)).toBe('score – Dev.pdf');
    expect(outputFileName('   ', '', 'Dev', 0)).toBe('score – Dev.pdf');
  });
  it('trims the title', () => {
    expect(outputFileName('  Song  ', 'x.ly', 'Dev', 0)).toBe('Song – Dev.pdf');
  });
  it('orders pages numerically', () => {
    const r = groupOutputs({ 'score-page10.png': b(10), 'score-page9.png': b(9), 'score-page2.png': b(2) });
    expect(r.books[0]!.pngPages).toEqual([b(2), b(9), b(10)]);
  });
});

describe('safeFileName', () => {
  it('replaces forbidden characters and trims trailing dots and spaces', () => {
    expect(safeFileName('a/b:c?.  ')).toBe('a_b_c_');
    expect(safeFileName('  Song. ')).toBe('Song');
  });
  it('falls back to score when empty', () => {
    expect(safeFileName('')).toBe('score');
    expect(safeFileName(' . ')).toBe('score');
  });
  it('caps at 150 characters', () => {
    expect(safeFileName('x'.repeat(300))).toHaveLength(150);
    expect(safeFileName(`${'x'.repeat(149)}.${'y'.repeat(10)}`)).toBe('x'.repeat(149));
  });
});
