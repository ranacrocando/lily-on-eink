import { describe, expect, it } from 'vitest';
import {
  analyzeProject,
  applyMoves,
  BUILTIN_INCLUDES,
  findIncludes,
  placeIncludes,
  versionWarnings,
} from '../src/project.js';

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
  it('gives the weak message for 2.20 to 2.23 and the step-by-step message below 2.20', () => {
    const w = versionWarnings({ 'a.ly': '2.22.1', 'b.ly': '2.18.2', 'c.ly': '2.9.5' });
    expect(w.map((d) => d.file)).toEqual(['a.ly', 'b.ly', 'c.ly']);
    expect(w.every((d) => d.severity === 'warning' && d.line === 0 && d.column === 0)).toBe(true);
    expect(w[0]!.message).toBe(
      'a.ly was written for an older LilyPond (2.22.1). It may still work. If the result looks wrong, the file may need to be updated to the current LilyPond format with the convert-ly tool (it comes with LilyPond).',
    );
    expect(w[1]!.message).toContain('lilypond.org');
    expect(w[1]!.message).toContain('convert-ly -e "b.ly"');
    expect(w[1]!.message).toContain('keep a copy');
    expect(w[2]!.message).toContain('convert-ly -e "c.ly"');
  });
  it('handles the boundaries numerically', () => {
    const strong = (v: string) => versionWarnings({ a: v })[0]?.message.includes('lilypond.org');
    expect(strong('2.19.99')).toBe(true);
    expect(strong('2.20.0')).toBe(false);
    expect(strong('2.23.5')).toBe(false);
    expect(versionWarnings({ a: '2.23.5' })).toHaveLength(1);
    expect(strong('2.9')).toBe(true);
    expect(versionWarnings({ a: '2.24.0', b: '2.25.80', c: '3.0.0', d: '2.26.1' })).toEqual([]);
  });
  it('shows the trimmed version and ignores unparseable or empty ones', () => {
    expect(versionWarnings({ a: ' 2.22.0 ' })[0]!.message).toContain('(2.22.0)');
    expect(versionWarnings({ a: 'banana', b: '', c: '2.x' })).toEqual([]);
    expect(versionWarnings({})).toEqual([]);
  });
});

describe('placeIncludes', () => {
  const inc = (...t: string[]) => t.map((x) => String.raw`\include "${x}"`).join('\n');

  it('moves a flat-uploaded file into the subfolder its includer expects', () => {
    const r = placeIncludes({ 'main.ly': inc('parts/voice.ily'), 'voice.ily': '' });
    expect(r).toEqual({
      moves: [{ from: 'voice.ily', to: 'parts/voice.ily', includedBy: 'main.ly' }],
      ambiguous: [],
    });
  });
  it('resolves nested includes relative to the new location (fixpoint)', () => {
    const texts = {
      'main.ly': inc('parts/voice.ily'),
      'voice.ily': inc('notes.ily', '../common/defs.ily'),
      'notes.ily': '',
      'defs.ily': '',
    };
    const r = placeIncludes(texts);
    expect(r.moves).toEqual([
      { from: 'voice.ily', to: 'parts/voice.ily', includedBy: 'main.ly' },
      { from: 'defs.ily', to: 'common/defs.ily', includedBy: 'parts/voice.ily' },
      { from: 'notes.ily', to: 'parts/notes.ily', includedBy: 'parts/voice.ily' },
    ]);
    const placed = applyMoves(texts, r.moves);
    expect(Object.keys(placed).sort()).toEqual(['common/defs.ily', 'main.ly', 'parts/notes.ily', 'parts/voice.ily']);
    expect(analyzeProject(placed).missingIncludes).toEqual([]);
  });
  it('reports several same-named candidates as ambiguous and moves nothing', () => {
    const r = placeIncludes({ 'main.ly': inc('parts/voice.ily'), 'voice.ily': '', 'x/voice.ily': '' });
    expect(r.moves).toEqual([]);
    expect(r.ambiguous).toEqual([
      { target: 'parts/voice.ily', includedBy: 'main.ly', candidates: ['voice.ily', 'x/voice.ily'] },
    ]);
  });
  it('does not move a file that is also the only candidate for two different targets', () => {
    const r = placeIncludes({ 'main.ly': inc('a/v.ily', 'b/v.ily'), 'v.ily': '' });
    expect(r.moves).toEqual([]);
    expect(r.ambiguous).toHaveLength(2);
  });
  it('does not steal a file another include already finds, and never overwrites', () => {
    const r = placeIncludes({ 'main.ly': inc('voice.ily', 'parts/voice.ily'), 'voice.ily': '' });
    expect(r.moves).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    const r2 = placeIncludes({ 'main.ly': inc('parts/voice.ily'), 'parts/voice.ily': 'a', 'voice.ily': 'b' });
    expect(r2.moves).toEqual([]);
  });
  it('leaves includes without any candidate alone and ignores builtins', () => {
    const r = placeIncludes({ 'main.ly': inc('english.ly', 'lib/none.ily'), 'english.ly': '' });
    expect(r).toEqual({ moves: [], ambiguous: [] });
    expect(placeIncludes({ 'm.ly': inc('x/english.ly'), 'english.ly': '' }, ['x/english.ly']).moves).toEqual([]);
  });
  it('makes a placed .ly stop being a main file', () => {
    const texts = { 'main.ly': inc('parts/voice.ly'), 'voice.ly': '' };
    expect(analyzeProject(texts).mainFiles).toEqual(['main.ly', 'voice.ly']);
    const placed = applyMoves(texts, placeIncludes(texts).moves);
    expect(analyzeProject(placed).mainFiles).toEqual(['main.ly']);
  });
  it('terminates on include cycles', () => {
    const r = placeIncludes({ 'a.ly': inc('d/b.ily'), 'b.ily': inc('../a.ily') });
    expect(r.moves).toEqual([{ from: 'b.ily', to: 'd/b.ily', includedBy: 'a.ly' }]);
  });
});
