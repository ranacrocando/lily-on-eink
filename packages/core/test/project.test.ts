import { describe, expect, it } from 'vitest';
import { analyzeProject, BUILTIN_INCLUDES, findIncludes } from '../src/project.js';

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
  it('reports includes escaping the root as missing', () => {
    const r = analyzeProject({ 'a.ly': String.raw`\include "../x.ily"` }, []);
    expect(r.missingIncludes).toEqual([{ from: 'a.ly', target: '../x.ily' }]);
  });
});
