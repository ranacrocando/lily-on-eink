import { describe, expect, it } from 'vitest';
import { analyzeProject, BUILTIN_INCLUDES, findIncludes, versionWarnings } from '../src/project.js';

describe('findIncludes', () => {
  it('finds include targets', () => {
    expect(findIncludes(String.raw`\include "a.ily" \include "b/c.ily"`)).toEqual(['a.ily', 'b/c.ily']);
  });
  it('ignores line and block comments', () => {
    const src = String.raw`% \include "no.ily"
%{ \include "no2.ily"
\include "no3.ily" %}
\include "yes.ily"`;
    expect(findIncludes(src)).toEqual(['yes.ily']);
  });
  it('ignores include inside other strings', () => {
    expect(findIncludes(String.raw`title = "see \include \"x.ily\" here" \include "ok.ily"`)).toEqual(['ok.ily']);
  });
  it('does not treat % inside a string as a comment', () => {
    expect(findIncludes(String.raw`x = "100%" \include "ok.ily"`)).toEqual(['ok.ily']);
  });
});

describe('analyzeProject', () => {
  it('resolves relative to the including file only', () => {
    const r = analyzeProject(
      {
        'a/x.ly': String.raw`\version "2.24.3" \include "b.ily" \include "../c.ily" \include "c.ily"`,
        'a/b.ily': '',
        'c.ily': '',
      },
      BUILTIN_INCLUDES,
    );
    expect(r.missingIncludes).toEqual([{ from: 'a/x.ly', target: 'c.ily' }]);
    expect(r.mainFiles).toEqual(['a/x.ly']);
    expect(r.versions).toEqual({ 'a/x.ly': '2.24.3' });
  });
  it('resolves nested includes relative to the included file', () => {
    const r = analyzeProject(
      { 'm.ly': String.raw`\include "lib/a.ily"`, 'lib/a.ily': String.raw`\include "b.ily"`, 'lib/b.ily': '' },
      [],
    );
    expect(r.missingIncludes).toEqual([]);
    expect(r.mainFiles).toEqual(['m.ly']);
  });
  it('accepts builtin includes and never lists .ily as main', () => {
    const r = analyzeProject({ 'a.ly': String.raw`\include "english.ly"`, 'b.ily': '', 'c.ly': '' }, BUILTIN_INCLUDES);
    expect(r.missingIncludes).toEqual([]);
    expect(r.mainFiles).toEqual(['a.ly', 'c.ly']);
  });
  it('treats absolute and backslash targets as missing', () => {
    const r = analyzeProject(
      { 'a.ly': String.raw`\include "/abs.ily" \include "b\\c.ily"`, 'abs.ily': '', 'b/c.ily': '' },
      [],
    );
    expect(r.missingIncludes.map((m) => m.target)).toEqual(['/abs.ily', 'b\\c.ily']);
  });
  it('allows a newline between include and the string', () => {
    expect(findIncludes('\\include\n   "a.ily"')).toEqual(['a.ily']);
    expect(findIncludes('\\include' + ' '.repeat(100) + '"a.ily"')).toEqual(['a.ily']);
  });
  it('reports includes escaping the root as missing', () => {
    const r = analyzeProject({ 'a.ly': String.raw`\include "../x.ily"` }, []);
    expect(r.missingIncludes).toEqual([{ from: 'a.ly', target: '../x.ily' }]);
  });
});

describe('versionWarnings', () => {
  it('warns for versions older than 2.24 and gives steps below 2.20', () => {
    const w = versionWarnings({ 'a.ly': '2.22.1', 'b.ly': '2.18.2', 'c.ly': '2.9.5' });
    expect(w.map((d) => d.file)).toEqual(['a.ly', 'b.ly', 'c.ly']);
    expect(w.every((d) => d.severity === 'warning' && d.line === 0 && d.column === 0)).toBe(true);
    expect(w[0]!.message).toBe(
      'a.ly was written for LilyPond 2.22.1. It may need updating with convert-ly; if the result looks wrong, update the file first.',
    );
    expect(w[1]!.message).toContain('lilypond.org');
    expect(w[1]!.message).toContain('convert-ly -e b.ly');
    expect(w[2]!.message).toContain('convert-ly -e c.ly');
  });
  it('compares numerically and ignores current, unparseable or missing versions', () => {
    expect(versionWarnings({ a: '2.24.0', b: '2.26.1', c: '3.0', d: 'banana', e: '', f: '2.x' })).toEqual([]);
    expect(versionWarnings({ a: '2.9' })[0]!.message).toContain('convert-ly -e');
    expect(versionWarnings({ a: '2.20.0' })[0]!.message).not.toContain('lilypond.org');
    expect(versionWarnings({})).toEqual([]);
  });
});
