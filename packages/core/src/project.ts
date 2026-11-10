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

/** Line (1-based) of `\include "target"` in source, or 0 if not found. */
export function includeLine(source: string, target: string): number {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(String.raw`\\include\s*"${escaped}"`).exec(source);
  return m ? source.slice(0, m.index).split('\n').length : 0;
}

export interface IncludeMove {
  /** Original upload path (always a top-level file). */
  from: string;
  /** Path the including file expects. Several moves may share `from`: the file is copied to each. */
  to: string;
  /** Including file, at its final location. */
  includedBy: string;
  /** Line of the `\include` in `includedBy`, or 0. */
  line: number;
}

export interface AmbiguousInclude {
  /** Path the include expects (the first one, if the name is wanted at several paths). */
  target: string;
  /** Including file, at its final location. */
  includedBy: string;
  /** Uploaded files with the same basename. */
  candidates: string[];
}

export interface PlacementPlan {
  moves: IncludeMove[];
  ambiguous: AmbiguousInclude[];
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * Decides where flat-uploaded include files belong (the web "Choose files" picker gives bare names).
 * Pure: the caller applies the result with `applyMoves`.
 *
 * Only top-level files (no `/` in the path) are ever moved, so folder uploads are untouched. A file's
 * own includes are followed only once its location is settled: files nothing wants by name are
 * settled from the start, a moved file is settled at its new location. From the settled files, an
 * unresolved include (relative to the including file, builtins ignored) is satisfied by the one
 * unsettled top-level file with the same basename. A file wanted at several paths is copied to each
 * (several moves with the same `from`). Several uploaded files with that name (any folder): ambiguous, no move.
 * Each file moves at most once, so include cycles without a settled entry point move nothing.
 * A file is moved even if an unsettled file would have found it at its old path (a flat upload
 * cannot be rebuilt otherwise). Never overwrites a path; deterministic (sorted) order.
 */
export function placeIncludes(
  texts: Record<string, string>,
  builtins: readonly string[] = BUILTIN_INCLUDES,
): PlacementPlan {
  const isSource = (p: string) => /\.(ly|ily)$/i.test(p);
  const loc = new Map<string, string>(); // current location -> key in texts
  for (const path of Object.keys(texts)) loc.set(path, path);
  const includesAt = (location: string): string[] => {
    const key = loc.get(location);
    return key !== undefined && isSource(key) ? scan(texts[key] ?? '').includes : [];
  };

  // Names that some include wants and cannot find: their top-level files are candidates (unsettled).
  const wantedNames = new Set<string>();
  for (const path of loc.keys()) {
    for (const target of includesAt(path)) {
      const r = resolveInclude(path, target);
      if (r !== undefined && !loc.has(r) && !builtins.includes(target)) wantedNames.add(baseName(r));
    }
  }
  const settled = new Set([...loc.keys()].filter((p) => p.includes('/') || !wantedNames.has(baseName(p))));

  const found = new Set<string>(); // locations some settled include resolves to
  const placedAt = new Set<string>();
  const placedFrom = new Map<string, string>(); // name -> uploaded top-level path it was placed from
  const moves: IncludeMove[] = [];
  let ambiguous: AmbiguousInclude[];
  for (let pass = 0; pass <= loc.size * 2 + 2; pass++) {
    // Files found by a settled include are in place.
    for (let changed = true; changed;) {
      changed = false;
      for (const path of [...settled].sort()) {
        for (const target of includesAt(path)) {
          const r = resolveInclude(path, target);
          if (r === undefined || !loc.has(r)) continue;
          found.add(r);
          if (!settled.has(r)) {
            settled.add(r);
            changed = true;
          }
        }
      }
    }
    // name -> expected path -> first (sorted) settled includer and its include target
    const wanted = new Map<string, Map<string, { includer: string; target: string }>>();
    for (const path of [...settled].sort()) {
      for (const target of includesAt(path)) {
        const r = resolveInclude(path, target);
        if (r === undefined || loc.has(r) || builtins.includes(target)) continue;
        const byPath = wanted.get(baseName(r)) ?? new Map<string, { includer: string; target: string }>();
        if (!byPath.has(r)) byPath.set(r, { includer: path, target });
        wanted.set(baseName(r), byPath);
      }
    }
    ambiguous = [];
    let progress = false;
    for (const name of [...wanted.keys()].sort()) {
      const byPath = wanted.get(name);
      if (!byPath) continue;
      // Uploaded files of that name that no include already found; only a top-level one can move.
      const candidates = [...loc.keys()]
        .filter((p) => baseName(p) === name && !found.has(p) && !placedAt.has(p))
        .sort();
      const expected = [...byPath.keys()].sort();
      const only = candidates[0];
      const source =
        candidates.length === 1 && only === name ? only : candidates.length === 0 ? placedFrom.get(name) : undefined;
      if (source !== undefined) {
        for (const to of expected) {
          const info = byPath.get(to);
          if (!info) continue;
          const includerKey = loc.get(info.includer) ?? info.includer;
          moves.push({
            from: source,
            to,
            includedBy: info.includer,
            line: includeLine(texts[includerKey] ?? '', info.target),
          });
          loc.set(to, source);
          settled.add(to);
          placedAt.add(to);
        }
        loc.delete(source);
        placedFrom.set(name, source);
        progress = true;
      } else if (candidates.length > 1) {
        const first = expected[0];
        const info = first === undefined ? undefined : byPath.get(first);
        if (first !== undefined && info) ambiguous.push({ target: first, includedBy: info.includer, candidates });
      }
    }
    if (!progress) return { moves, ambiguous };
  }
  return { moves: [], ambiguous: [] };
}

/**
 * Applies `placeIncludes` moves to any path-keyed map (texts, bytes, ...). Returns a new object.
 * A file with several moves is copied to every target and no longer exists at its old path.
 */
export function applyMoves<T>(
  files: Record<string, T>,
  moves: readonly { from: string; to: string }[],
): Record<string, T> {
  const targets = new Map<string, string[]>();
  for (const m of moves) targets.set(m.from, [...(targets.get(m.from) ?? []), m.to]);
  const out: Record<string, T> = {};
  for (const [path, value] of Object.entries(files)) {
    const to = targets.get(path);
    if (to) for (const t of to) out[t] = value;
    else out[path] = value;
  }
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
