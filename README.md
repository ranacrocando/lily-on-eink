# lily-on-eink

Converts LilyPond files to PDFs sized for an e-reader screen. This repository holds the core library (a LilyPond overlay, device presets, genre profiles and a TypeScript API) and a Node engine adapter.

If you only want PDFs, use the hosted app: [lily-on-eink-app](https://ranacrocando.github.io/lily-on-eink-app/) ([source](https://github.com/ranacrocando/lily-on-eink-app)).

## Install

Releases are tarballs on GitHub Releases, not on the npm registry. In `package.json`:

```json
"dependencies": {
  "@lily-on-eink/core": "https://github.com/ranacrocando/lily-on-eink/releases/download/v0.1.0/lily-on-eink-core-0.1.0.tgz",
  "@lily-on-eink/engine-wasm": "https://github.com/ranacrocando/lily-on-eink/releases/download/v0.1.0/lily-on-eink-engine-wasm-0.1.0.tgz"
},
"overrides": {
  "@lily-on-eink/core": "$@lily-on-eink/core"
}
```

The `overrides` entry is needed because `engine-wasm` depends on `core`, and npm would otherwise look for it on the registry. Requires Node 22 or newer.

## Use

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { convert, listDevices, listProfiles } from '@lily-on-eink/core';
import { createWasmEngine } from '@lily-on-eink/engine-wasm';

const engine = createWasmEngine();
try {
  const files = [{ path: 'score.ly', content: readFileSync('score.ly') }];
  const { outputs, diagnostics } = await convert(files, { device: 'kobo-sage', profile: 'organ' }, engine);
  for (const d of diagnostics) console.log(d.severity, d.message);
  for (const o of outputs) writeFileSync(o.fileName, o.pdf!);
} finally {
  engine.dispose();
}

console.log(listDevices().map((d) => d.id), listProfiles().map((p) => p.id));
```

Include files go into the same `files` array, with paths relative to the project. A failed main file yields diagnostics and the others still convert. See [the design spec](docs/specs/2026-11-09-lily-on-eink-design.md) (section 5.1) for all options.

## Devices and profiles

Device ids include `kobo-sage`, `kindle-paperwhite-2024`, `remarkable-2` and `boox-note-air3`; call `listDevices()` for the full list. Profiles are `generic`, `organ`, `piano`, `leadsheet`, `tab` and `accordion`. For a device that is not listed, pass a `DeviceSpec` object (see `packages/core/src/devices.ts`) instead of an id.

## Security

In Node, a `.ly` file can run shell commands. Convert only files you trust.

## Development

```sh
npm ci
npm test
npm run convert -- score.ly --device kobo-sage --profile organ --out out
```

The convert script takes files or folders, plus `--device`, `--profile`, `--out` and `--no-tagline`.

## Releasing

1. Bump `packages/core` and `packages/engine-wasm` to the new version, including engine-wasm's dependency on core, via a PR.
2. On GitHub, create a release (Releases, Draft a new release) with a new tag `vX.Y.Z` on `main`, and publish it. A tag alone builds nothing.
3. The Release workflow checks that the tag equals all three versions, runs the tests, smoke-installs the tarballs and uploads them to the release. Assets that already exist are kept, because the app lockfile pins their hashes. To re-run for an existing release, start the workflow by hand with the tag; `force` replaces existing assets.

If the version check fails, delete the release and the tag, fix the versions via a PR, and release again. Do not enable GitHub's "immutable releases": it blocks the upload after publishing. To test the tarballs locally, first delete `packages/*/dist` and `*.tsbuildinfo` (stale source maps would end up in the tarballs), then run `npm run build` and `npm pack -w packages/core -w packages/engine-wasm --pack-destination out`, then `node scripts/smoke-install.mjs out`.

## License

`packages/core` is MIT. `packages/engine-wasm` is GPL-3.0-or-later. Test scores in `corpus/` are licensed per file. See `REUSE.toml` and the design spec, section 2.
