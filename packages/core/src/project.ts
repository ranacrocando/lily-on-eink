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
      out += src[i + 1];
      i += 2;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return [out, i + 1];
}

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
      const m = /^\\(include|version)\s*"/.exec(src.slice(i, i + 40));
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
    const { includes, version } = scan(files[path]!);
    if (version !== undefined) versions[path] = version;
    for (const target of includes) {
      const resolved = resolvePath(dirOf(path), target);
      if (resolved !== undefined && known.has(resolved)) included.add(resolved);
      else if (!builtinIncludes.includes(target)) missingIncludes.push({ from: path, target });
    }
  }
  const mainFiles = [...known].filter((p) => /\.ly$/i.test(p) && !included.has(p)).sort();
  return { mainFiles, missingIncludes, versions };
}
