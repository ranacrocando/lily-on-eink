export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

// Absolute prefix (POSIX or drive letter) ending in a separator; not preceded by a path character.
const ABS_PREFIX = /(?<![\w.\-/\\])(?:[A-Za-z]:)?[\\/](?:[^\s:'"`\\/]+[\\/])+/g;
const VIRTUAL_ROOT = /(?<![\w.\-/\\])\/input\//g;

/** Strips the engine's virtual root `/input/` and replaces other absolute prefixes with `<abs>/`. */
export function normalizeLog(log: string): string {
  return log.replace(VIRTUAL_ROOT, '').replace(ABS_PREFIX, '<abs>/');
}

const LINE = /^(.+?):(\d+):(\d+): (error|warning): (.*)$/;

export function parseDiagnostics(log: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of normalizeLog(log).split('\n')) {
    const m = LINE.exec(raw.replace(/\r$/, ''));
    if (m) {
      out.push({
        file: m[1]!,
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4] as 'error' | 'warning',
        message: m[5]!,
      });
    }
  }
  return out;
}
