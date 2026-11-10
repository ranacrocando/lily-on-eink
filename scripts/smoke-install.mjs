// Smoke test for the release tarballs: installs them into a clean temporary project (with the
// app's `overrides` entry) and converts one corpus file.
// Usage: node scripts/smoke-install.mjs <dir with the two .tgz files>
// Works in a fresh temp directory, which is removed afterwards.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const [tarDir] = process.argv.slice(2);
if (!tarDir) {
  console.error('usage: node scripts/smoke-install.mjs <tarball-dir>');
  process.exit(2);
}
const repo = resolve(import.meta.dirname, '..');
const find = (prefix) => {
  const hits = readdirSync(tarDir).filter((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
  if (hits.length !== 1) throw new Error(`expected exactly one ${prefix}*.tgz in ${tarDir}, found ${hits.length}`);
  return resolve(tarDir, hits[0]);
};
const core = find('lily-on-eink-core-');
const engine = find('lily-on-eink-engine-wasm-');

const work = mkdtempSync(join(tmpdir(), 'lily-smoke-'));

const toFileDep = (p) => `file:${p.split(sep).join('/')}`;
writeFileSync(
  join(work, 'package.json'),
  JSON.stringify(
    {
      private: true,
      type: 'module',
      dependencies: {
        '@lily-on-eink/core': toFileDep(core),
        '@lily-on-eink/engine-wasm': toFileDep(engine),
      },
      // The app has the same entry. Here it is only a safety net: the root's core tarball already
      // satisfies engine-wasm's exact dependency.
      overrides: { '@lily-on-eink/core': '$@lily-on-eink/core' },
    },
    null,
    2,
  ),
);

const run = (cmd, args, cwd) => {
  const r = spawnSync([cmd, ...args].join(' '), { cwd, stdio: 'inherit', shell: true }); // constant arguments only
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status ?? r.signal})`);
};
try {
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], work);

  // Both packages must come from the tarballs, and engine-wasm must not get its own copy of core.
  const packages = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8')).packages;
  for (const [name, tarball] of [
    ['core', core],
    ['engine-wasm', engine],
  ]) {
    const entry = packages[`node_modules/@lily-on-eink/${name}`];
    if (!entry?.resolved?.startsWith('file:') || !entry.resolved.endsWith(basename(tarball)))
      throw new Error(`@lily-on-eink/${name} does not resolve to ${basename(tarball)}: ${entry?.resolved}`);
  }
  const nested = 'node_modules/@lily-on-eink/engine-wasm/node_modules/@lily-on-eink/core';
  if (packages[nested]) throw new Error(`unexpected nested copy of core: ${nested}`);

  const corpusFile = resolve(repo, 'corpus/accordion/alle-meine-entchen/alle-meine-entchen.ly');
  writeFileSync(
    join(work, 'smoke.mjs'),
    `import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { convert } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const file = ${JSON.stringify(corpusFile)};
const engine = createWasmEngine();
try {
  const { outputs, diagnostics } = await convert(
    [{ path: basename(file), content: readFileSync(file) }],
    { device: 'kobo-sage', profile: 'generic' },
    engine,
  );
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const pdf = outputs[0]?.pdf;
  if (errors.length || !pdf || Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') {
    console.error(JSON.stringify(diagnostics, null, 2));
    throw new Error('conversion failed');
  }
  console.log('smoke ok:', outputs[0].fileName, pdf.length, 'bytes');
} finally {
  engine.dispose();
}
`,
  );
  run('node', ['smoke.mjs'], work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
