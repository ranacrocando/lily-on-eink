import { describe, expect, it } from 'vitest';
import { normalizeLog, parseDiagnostics } from '../src/diagnostics.js';

const log = [
  '/input/song.ly:3:3: error: unknown escaped string: `\\zzzNotDefined\'',
  '  \\zzzNotDefined',
  'a/x.ly:1:10: error: cannot find file: `c.ily\'',
  '/input/a/x.ly:2:1: warning: something odd',
  'fatal error: failed files: "/input/song.ly"',
].join('\n');

describe('normalizeLog', () => {
  it('strips the virtual root', () => {
    const n = normalizeLog(log);
    expect(n).not.toContain('/input/');
    expect(n).toContain('song.ly:3:3: error');
    expect(n).toContain('failed files: "song.ly"');
  });
  it('replaces other absolute prefixes', () => {
    expect(normalizeLog('/opt/ly/share/x.ly:1:1: warning: w')).toBe('<abs>/x.ly:1:1: warning: w');
    expect(normalizeLog('C:\\fake\\dir\\x.ly:1:1: warning: w')).toBe('<abs>/x.ly:1:1: warning: w');
  });
  it('keeps relative paths intact', () => {
    expect(normalizeLog('a/x.ly:1:10: error: cannot find file: `../c.ily\'')).toBe(
      'a/x.ly:1:10: error: cannot find file: `../c.ily\'',
    );
  });
});

describe('parseDiagnostics', () => {
  it('parses errors and warnings', () => {
    expect(parseDiagnostics(log)).toEqual([
      { file: 'song.ly', line: 3, column: 3, severity: 'error', message: 'unknown escaped string: `\\zzzNotDefined\'' },
      { file: 'a/x.ly', line: 1, column: 10, severity: 'error', message: 'cannot find file: `c.ily\'' },
      { file: 'a/x.ly', line: 2, column: 1, severity: 'warning', message: 'something odd' },
    ]);
  });
  it('handles file names with spaces', () => {
    expect(parseDiagnostics('/input/my song/a b.ly:4:2: error: boom')).toEqual([
      { file: 'my song/a b.ly', line: 4, column: 2, severity: 'error', message: 'boom' },
    ]);
  });
  it('returns nothing for empty logs', () => {
    expect(parseDiagnostics('')).toEqual([]);
  });
});
