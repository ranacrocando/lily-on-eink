// Trusted files only: LilyPond can run shell commands in Node (spec §5.4). Dev tool; not distributed.
//
// Usage: npm run convert -- <file-or-folder>... --device <id> [--profile <id>] [--out <dir>] [--no-tagline]
// Each argument is converted as its own project. Keys are POSIX paths relative to the folder
// (or, for a single file, to its directory).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { convert, getDevice, type ProjectFile } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const SOURCE = /\.(ly|ily)$/i;
const toPosix = (p: string) => p.split(sep).join('/');

/** Loads a file or every .ly/.ily file below a folder, keyed relative to the project root. */
function loadProject(arg: string): { root: string; files: ProjectFile[] } {
  if (statSync(arg).isFile()) {
    return { root: dirname(arg), files: [{ path: basename(arg), content: readFileSync(arg) }] };
  }
  const files: ProjectFile[] = [];
  for (const entry of readdirSync(arg, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE.test(entry.name)) continue;
    const abs = join(entry.parentPath, entry.name);
    files.push({ path: toPosix(relative(arg, abs)), content: readFileSync(abs) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root: arg, files };
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      device: { type: 'string' },
      profile: { type: 'string', default: 'generic' },
      out: { type: 'string', default: 'out' },
      'no-tagline': { type: 'boolean', default: false },
    },
  });
  if (!values.device || positionals.length === 0) {
    console.error('usage: convert <file-or-folder>... --device <id> [--profile <id>] [--out <dir>] [--no-tagline]');
    return 2;
  }
  const device = getDevice(values.device);
  const outDir = join(values.out, device.id);
  const engine = createWasmEngine();
  let failed = false;
  try {
    for (const arg of positionals) {
      const { root, files } = loadProject(arg);
      const result = await convert(
        files,
        {
          device,
          profile: values.profile,
          keepTagline: !values['no-tagline'],
          onProgress: (p) => {
            if (p.phase === 'compiling') console.log(`[${p.index + 1}/${p.total}] ${toPosix(join(root, p.mainFile))}`);
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
        const target = join(outDir, output.fileName);
        writeFileSync(target, output.pdf);
        console.log(`wrote ${toPosix(target)}`);
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
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
