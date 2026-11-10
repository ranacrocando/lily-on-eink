import type { Diagnostic } from './diagnostics.js';

// Candidate for an engine-provided list.
export const BUILTIN_INCLUDES: readonly string[] = [
  'english.ly',
  'deutsch.ly',
  'italiano.ly',
  'espanol.ly',
  'predefined-guitar-fretboards.ly',
  'predefined-ukulele-fretboards.ly',
  'predefined-mandolin-fretboards.ly',
];

export interface MissingInclude {
  from: string;
  target: string;
}

export interface ProjectAnalysis {
  mainFiles: string[];
  missingIncludes: MissingInclude[];
  /** `\version` string per file that declares one. */
  versions: Record<string, string>;
}

/** Reads a string literal starting at the opening quote; returns [value, indexAfter]. */
function readString(src: string, start: number): [string, number] {
  let i = start + 1;
  let out = '';
  while (i < src.length && src[i] !== '"') {
    if (src[i] === '\\' && i + 1 < src.length) {
      out += src.charAt(i + 1);
      i += 2;
    } else {
      out += src.charAt(i);
      i += 1;
    }
  }
  return [out, i + 1];
}

const DIRECTIVE = /\\(include|version)\s*"/y;

function scan(src: string): { includes: string[]; version?: string } {
  const includes: string[] = [];
  let version: string | undefined;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '%') {
      if (src[i + 1] === '{') {
        const end = src.indexOf('%}', i + 2);
        i = end === -1 ? src.length : end + 2;
      } else {
        const end = src.indexOf('\n', i);
        i = end === -1 ? src.length : end;
      }
    } else if (c === '"') {
      i = readString(src, i)[1];
    } else if (c === '\\') {
      DIRECTIVE.lastIndex = i;
      const m = DIRECTIVE.exec(src);
      if (m) {
        const [value, next] = readString(src, i + m[0].length - 1);
        if (m[1] === 'include') includes.push(value);
        else version ??= value;
        i = next;
      } else {
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return { includes, version };
}

/** Returns the `\include "x"` targets of a LilyPond source, skipping comments and other strings. */
export function findIncludes(source: string): string[] {
  return scan(source).includes;
}

/** Resolves `target` against `dir` (POSIX, `..` handled). Returns undefined if it escapes the root. */
function resolvePath(dir: string, target: string): string | undefined {
  if (target.startsWith('/') || target.includes('\\')) return undefined;
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Resolves an `\include` target of file `from` the way the engine does: relative to the
 * including file's directory only. Returns undefined if the path escapes the project root.
 */
export function resolveInclude(from: string, target: string): string | undefined {
  return resolvePath(dirOf(from), target);
}

/**
 * Analyzes project files (path to source). Includes resolve relative to the including
 * file's directory only, never the project root, as the engine does.
 */
export function analyzeProject(
  files: Record<string, string>,
  builtinIncludes: readonly string[] = BUILTIN_INCLUDES,
): ProjectAnalysis {
  const known = new Set(Object.keys(files));
  const included = new Set<string>();
  const missingIncludes: MissingInclude[] = [];
  const versions: Record<string, string> = {};
  for (const path of Object.keys(files).sort()) {
    if (!/\.(ly|ily)$/i.test(path)) continue;
    const text = files[path];
    if (text === undefined) continue;
    const { includes, version } = scan(text);
    if (version !== undefined) versions[path] = version;
    for (const target of includes) {
      const resolved = resolveInclude(path, target);
      if (resolved !== undefined && known.has(resolved)) included.add(resolved);
      else if (!builtinIncludes.includes(target)) missingIncludes.push({ from: path, target });
    }
  }
  const mainFiles = [...known].filter((p) => /\.ly$/i.test(p) && !included.has(p)).sort();
  return { mainFiles, missingIncludes, versions };
}

export interface IncludeMove {
  /** Original upload path. */
  from: string;
  /** Path the including file expects (new location). */
  to: string;
  /** Including file, at its final location. */
  includedBy: string;
}

export interface AmbiguousInclude {
  /** Path the include expects. */
  target: string;
  /** Including file, at its final location. */
  includedBy: string;
  /** Uploaded files with the same basename (final locations). */
  candidates: string[];
}

export interface PlacementPlan {
  moves: IncludeMove[];
  ambiguous: AmbiguousInclude[];
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * Decides where flat-uploaded include files belong (a browser file picker gives bare names). Pure:
 * the caller applies the result with `applyMoves`. An unresolved include (relative to the including
 * file, builtins ignored) is satisfied by the one uploaded file with the same basename, unless that
 * file is already found by another include at its current path or is also the only candidate for
 * a different missing path. Several candidates are reported as ambiguous and nothing moves.
 * Repeats until stable, because a moved file's own includes resolve from its new directory.
 * Never overwrites an existing path; deterministic (sorted) order.
 */
export function placeIncludes(
  texts: Record<string, string>,
  builtins: readonly string[] = BUILTIN_INCLUDES,
): PlacementPlan {
  const current = new Map<string, string>(); // current path -> original path
  const content = new Map<string, string>(); // current path -> text
  for (const [path, text] of Object.entries(texts)) {
    current.set(path, path);
    content.set(path, text);
  }
  const moves: { original: string; to: string; includer: string }[] = [];
  let ambiguous: { target: string; includer: string; candidates: string[] }[] = [];

  // Every pass either moves at least one file (which then stays put, as an include resolves it) or stops.
  for (let pass = 0; pass <= content.size + 1; pass++) {
    const resolvedNow = new Set<string>();
    const wanted = new Map<string, string[]>(); // expected path -> includers
    for (const path of [...content.keys()].sort()) {
      if (!/\.(ly|ily)$/i.test(path)) continue;
      for (const target of scan(content.get(path) ?? '').includes) {
        const resolved = resolveInclude(path, target);
        if (resolved === undefined) continue;
        if (content.has(resolved)) resolvedNow.add(resolved);
        else if (!builtins.includes(target)) wanted.set(resolved, [...(wanted.get(resolved) ?? []), path]);
      }
    }
    const candidatesOf = new Map<string, string[]>();
    const claims = new Map<string, number>();
    for (const expected of wanted.keys()) {
      const list = [...content.keys()].filter((p) => baseName(p) === baseName(expected) && !resolvedNow.has(p)).sort();
      candidatesOf.set(expected, list);
      for (const c of list) claims.set(c, (claims.get(c) ?? 0) + 1);
    }
    const step: { from: string; to: string; includer: string }[] = [];
    ambiguous = [];
    for (const expected of [...wanted.keys()].sort()) {
      const includer = [...(wanted.get(expected) ?? [])].sort()[0] ?? '';
      const list = candidatesOf.get(expected) ?? [];
      const only = list[0];
      if (list.length === 1 && only !== undefined && claims.get(only) === 1) {
        step.push({ from: only, to: expected, includer });
      } else if (list.length > 0) {
        ambiguous.push({ target: expected, includer, candidates: list });
      }
    }
    if (step.length === 0) break;
    for (const m of step) {
      const original = current.get(m.from);
      const text = content.get(m.from);
      if (original === undefined || text === undefined) continue;
      current.delete(m.from);
      content.delete(m.from);
      current.set(m.to, original);
      content.set(m.to, text);
      moves.push({ original, to: m.to, includer: m.includer });
    }
  }

  // Report with the final location of every file.
  const finalOf = new Map<string, string>();
  for (const [path, original] of current) finalOf.set(original, path);
  const originalOf = new Map(moves.map((m) => [m.to, m.original]));
  const at = (path: string) => finalOf.get(originalOf.get(path) ?? path) ?? path;
  return {
    moves: moves.map((m) => ({ from: m.original, to: finalOf.get(m.original) ?? m.to, includedBy: at(m.includer) })),
    ambiguous: ambiguous.map((a) => ({ target: a.target, includedBy: at(a.includer), candidates: a.candidates })),
  };
}

/** Applies `placeIncludes` moves to any path-keyed map (texts, bytes, ...). Returns a new object. */
export function applyMoves<T>(
  files: Record<string, T>,
  moves: readonly { from: string; to: string }[],
): Record<string, T> {
  const target = new Map(moves.map((m) => [m.from, m.to]));
  const out: Record<string, T> = {};
  for (const [path, value] of Object.entries(files)) out[target.get(path) ?? path] = value;
  return out;
}

/** Parses "2.24.1" style versions to [major, minor]; undefined if unparseable. */
function parseVersion(raw: string): [number, number] | undefined {
  const m = /^\s*(\d+)\.(\d+)(?:\.\d+)*/.exec(raw);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

const olderThan = ([major, minor]: [number, number], maj: number, min: number) =>
  major < maj || (major === maj && minor < min);

/**
 * Warnings for files written for old LilyPond versions (input: `analyzeProject(...).versions`).
 * Files without a parseable version produce nothing. Line is 0 because the position is not known.
 */
export function versionWarnings(versions: Record<string, string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [file, raw] of Object.entries(versions)) {
    const v = parseVersion(raw);
    if (!v) continue;
    const shown = raw.trim();
    let message: string;
    if (olderThan(v, 2, 20)) {
      message =
        `${file} was written for a very old LilyPond (${shown}) and will probably not work as it is. ` +
        `To update it to the current LilyPond format: 1. Install LilyPond from lilypond.org (it includes the convert-ly tool). ` +
        `2. Run \`convert-ly -e "${file}"\` (this changes the file; keep a copy). 3. Upload the file again.`;
    } else if (olderThan(v, 2, 24)) {
      message =
        `${file} was written for an older LilyPond (${shown}). It may still work. If the result looks wrong, ` +
        `the file may need to be updated to the current LilyPond format with the convert-ly tool (it comes with LilyPond).`;
    } else continue;
    out.push({ file, line: 0, column: 0, severity: 'warning', message });
  }
  return out;
}
