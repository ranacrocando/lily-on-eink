// Trusted files only: LilyPond can run shell commands in Node (spec §5.4). Dev tool; not distributed.
//
// Usage: npm run convert -- <file-or-folder>... --device <id> [--profile <id>] [--out <dir>] [--no-tagline]
// Each argument is converted as its own project. A folder converts every main file in it; a
// file converts only that file, with its directory loaded so that includes resolve. Keys are
// POSIX paths relative to the folder (or the file's directory).
// Exit codes: 0 success, 1 conversion failures, 2 usage errors.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { convert, getDevice, getProfile, type DeviceSpec, type ProjectFile } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const USAGE = 'usage: convert <file-or-folder>... --device <id> [--profile <id>] [--out <dir>] [--no-tagline]';
const SOURCE = /\.(ly|ily)$/i;
const toPosix = (p: string) => p.split(sep).join('/');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class UsageError extends Error {}

/** Every .ly/.ily file below `root`, keyed by its POSIX path relative to `root`. */
function loadFolder(root: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE.test(entry.name)) continue;
    const abs = join(entry.parentPath, entry.name);
    files.push({ path: toPosix(relative(root, abs)), content: readFileSync(abs) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** A folder argument loads the folder; a file argument loads its directory and selects the file. */
function loadProject(arg: string): { root: string; files: ProjectFile[]; mainFiles?: string[] } {
  if (!existsSync(arg)) throw new Error(`no such file or folder: ${arg}`);
  if (statSync(arg).isFile()) {
    const root = dirname(arg);
    return { root, files: loadFolder(root), mainFiles: [basename(arg)] };
  }
  return { root: arg, files: loadFolder(arg) };
}

function parseOptions() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        device: { type: 'string' },
        profile: { type: 'string', default: 'generic' },
        out: { type: 'string', default: 'out' },
        'no-tagline': { type: 'boolean', default: false },
      },
    });
    if (!values.device) throw new UsageError('missing --device');
    if (positionals.length === 0) throw new UsageError('no files or folders given');
    let device: DeviceSpec;
    try {
      device = getDevice(values.device);
      getProfile(values.profile);
    } catch (e) {
      throw new UsageError(message(e));
    }
    return { device, profile: values.profile, out: values.out, keepTagline: !values['no-tagline'], positionals };
  } catch (e) {
    throw e instanceof UsageError ? e : new UsageError(message(e));
  }
}

/** Appends " (2)", " (3)", ... before ".pdf" until the path is unused in this run. */
function uniquePath(dir: string, fileName: string, used: Set<string>): string {
  let target = join(dir, fileName);
  for (let n = 2; used.has(target); n++) target = join(dir, fileName.replace(/\.pdf$/, ` (${n}).pdf`));
  used.add(target);
  return target;
}

async function main(): Promise<number> {
  const opts = parseOptions();
  const outDir = join(opts.out, opts.device.id);
  const written = new Set<string>();
  const engine = createWasmEngine();
  let failed = false;
  try {
    for (const arg of opts.positionals) {
      try {
        const { root, files, mainFiles } = loadProject(arg);
        const result = await convert(
          files,
          {
            device: opts.device,
            profile: opts.profile,
            keepTagline: opts.keepTagline,
            ...(mainFiles ? { mainFiles } : {}),
            onProgress: (p) => {
              if (p.phase === 'compiling')
                console.log(`[${p.index + 1}/${p.total}] ${toPosix(join(root, p.mainFile))}`);
            },
          },
          engine,
        );
        for (const d of result.diagnostics) {
          console.log(`${toPosix(join(root, d.file))}:${d.line}: ${d.severity}: ${d.message}`);
          if (d.severity === 'error') failed = true;
        }
        for (const output of result.outputs) {
          if (!output.pdf) continue;
          mkdirSync(outDir, { recursive: true });
          const target = uniquePath(outDir, output.fileName, written);
          if (basename(target) !== output.fileName) {
            console.log(`warning: duplicate output name "${output.fileName}", writing ${toPosix(target)} instead`);
          }
          writeFileSync(target, output.pdf);
          console.log(`wrote ${toPosix(target)}`);
        }
      } catch (e) {
        console.error(`${arg}: error: ${message(e)}`);
        failed = true;
      }
    }
  } finally {
    engine.dispose();
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof UsageError ? `${error.message}\n${USAGE}` : message(error));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
