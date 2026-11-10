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
