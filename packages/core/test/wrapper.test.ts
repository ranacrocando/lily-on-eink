import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OVERLAY_ILY } from '../src/overlay-sources.js';
import { buildWrapper, type WrapperOptions } from '../src/wrapper.js';

const base: WrapperOptions = {
  mainBasename: 'song.ly',
  pageMm: { width: 121.92, height: 162.56 },
  marginsMm: { top: 3, right: 3, bottom: 3, left: 3 },
  staffSize: 17,
  keepTagline: true,
  lilypondVersion: '2.26.0',
};

const expected = String.raw`\version "2.26.0"
\include "lily-on-eink.ily"
\include "song.ly"
\paper {
  paper-width = 121.92\mm
  paper-height = 162.56\mm
  top-margin = 3\mm
  bottom-margin = 3\mm
  left-margin = 6\mm
  right-margin = 3\mm
  ragged-last-bottom = ##t
  print-page-number = ##f
  bookTitleMarkup = \lilyOnEinkBookTitleMarkup
  scoreTitleMarkup = \lilyOnEinkScoreTitleMarkup
  oddHeaderMarkup = \lilyOnEinkPageHeaderMarkup
  evenHeaderMarkup = \lilyOnEinkPageHeaderMarkup
  oddFooterMarkup = \lilyOnEinkFooterMarkup
  evenFooterMarkup = \lilyOnEinkFooterMarkup
}
#(set-global-staff-size 17)
`;

describe('buildWrapper', () => {
  it('matches the expected source', () => {
    const w = buildWrapper(base);
    expect(w.source).toBe(expected);
    expect(w.overlay).toEqual({ name: 'lily-on-eink.ily', content: OVERLAY_ILY });
  });
  it('appends a tagline suppression', () => {
    expect(buildWrapper({ ...base, keepTagline: false }).source).toBe(
      expected + String.raw`\header { tagline = ##f }` + '\n',
    );
  });
  it('limits numbers to 2 decimals without locale formatting', () => {
    const s = buildWrapper({ ...base, pageMm: { width: 1234.5678, height: 100.1 }, staffSize: 16.456 }).source;
    expect(s).toContain(String.raw`paper-width = 1234.57\mm`);
    expect(s).toContain(String.raw`paper-height = 100.1\mm`);
    expect(s).toContain('(set-global-staff-size 16.46)');
  });
  it('escapes quotes and backslashes in the basename', () => {
    expect(buildWrapper({ ...base, mainBasename: String.raw`a"b\c.ly` }).source).toContain(
      String.raw`\include "a\"b\\c.ly"`,
    );
  });
  it('appends extraPaper (test only) as the last line of the \\paper block', () => {
    expect(buildWrapper({ ...base, extraPaper: 'indent = 0' }).source).toContain(
      String.raw`  evenFooterMarkup = \lilyOnEinkFooterMarkup
  indent = 0
}`,
    );
  });
});

describe('overlay', () => {
  it('embedded text equals the .ily file on disk', () => {
    const disk = readFileSync(new URL('../src/ly/lily-on-eink.ily', import.meta.url), 'utf8');
    expect(OVERLAY_ILY).toBe(disk.replace(/\r\n/g, '\n'));
  });
});
