# Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working end-to-end path from `.ly` file(s) to an e-reader-sized PDF via the WASM engine. It covers the core library, the `engine-wasm` adapter, a minimal overlay, a corpus slice with compile tests, a dev convert script, and CI with a privacy check.

**Architecture:**
- An npm-workspaces monorepo.
- `packages/core` (MIT):
  - generates a wrapper `.ly` that neutralises manual breaks, `\include`s the user's main file and then sets paper size, margins and staff size;
  - analyses includes and orchestrates compiles through an `Engine` interface.
- `packages/engine-wasm` (GPL) implements `Engine` on top of `@sightread/lilypond-wasm`.
- Hardening is **out of scope** and gets its own plan: `\book`/`\bookpart` hooks, the custom title markup, indent measurement, the full corpus, visual snapshots, the review page, rulesets and the release workflow.
- Slice choices are made so the hardening only *adds* code:
  - the overlay file already has its final name, `lily-on-eink.ily`;
  - paper dimensions are set directly, never through `set-paper-size` (spec §4.1).

**Tech stack:**
- Node 22, TypeScript 5 (ESM, `module`/`moduleResolution` `NodeNext`, project references), Vitest, ESLint 9 flat config with typescript-eslint and `globals`, `tsx`, `pngjs` (tests only).
- `@sightread/lilypond-wasm`, pinned to exactly `0.2.0`.

**References:**
- Spec: `docs/specs/2026-11-09-lily-on-eink-design.md`
- Engine facts: `docs/engine-findings.md`. Read it before Task 3.

**Ground rules for every task:**
- Conventional Commits for every commit message.
- No `Co-Authored-By` or other trailers that carry email addresses.
- Never commit absolute local paths, real names or private emails. Do not change git config.
- TDD: write the failing test first, see it fail, implement, see it pass, commit.
- LilyPond sources inside TypeScript/JavaScript are written as `String.raw` template literals. Plain strings swallow backslashes.
- Each task is reviewed by a different agent than its implementer before the next task starts.

**Delivery as PRs**, each branched from `main` after the previous one is merged:

| PR | Branch | Tasks |
|---|---|---|
| A | `ci/scaffold` | 1–2 |
| B1 | `feat/engine-wasm` | 3 |
| B2 | `feat/core-basics` | 4–6 |
| B3 | `feat/convert-corpus` | 7–8 |

---

## File structure (end state of this plan)

```
.nvmrc                              "22"
.gitignore
package.json                        private root: workspaces + scripts
tsconfig.base.json
tsconfig.json                       solution file: references core, engine-wasm
tsconfig.test.json                  typecheck for tests + scripts (noEmit)
eslint.config.js
vitest.config.ts                    aliases package names → src, serial engine files
REUSE.toml
.githooks/pre-push
.github/workflows/ci.yml            build, lint, typecheck, test, privacy
.github/workflows/pr-checks.yml     PR title + review checkbox
.github/pull_request_template.md
scripts/privacy-check.mjs
scripts/convert.ts                  dev batch converter (GPL; not distributed)
packages/core/                      @lily-on-eink/core (MIT)
  package.json  tsconfig.json  LICENSE
  src/presets/devices.json  src/presets/profiles.json
  src/ly/lily-on-eink.ily           overlay source (canonical file)
  src/overlay-sources.ts            OVERLAY_ILY string (kept equal to the .ily by a test)
  src/engine.ts  src/devices.ts  src/profiles.ts  src/wrapper.ts
  src/project.ts  src/diagnostics.ts  src/outputs.ts  src/convert.ts  src/index.ts
  test/*.test.ts                    pure unit tests (no engine)
packages/engine-wasm/               @lily-on-eink/engine-wasm (GPL-3.0-or-later)
  package.json  tsconfig.json  LICENSE  engine-version.json
  src/index.ts
  test/contract.test.ts
  test/corpus.test.ts               compile tests (lives here: imports the GPL engine)
corpus/
  SOURCES.md
  organ/reger-lobe-den-herren/reger-lobe-den-herren.ly
  bass/bass-etude-e-minor/bass-etude-e-minor.ly            (already committed with this plan)
  leadsheet/leise-rieselt-der-schnee/leise_rieselt_der_schnee.ly
  leadsheet/leise-rieselt-der-schnee/leise_rieselt_der_schnee_voices.ly
```

---

### Task 1: Monorepo scaffold (build, lint, typecheck, test)

**Files:** every root config file listed above except the workflows and scripts; `packages/*/package.json`, `tsconfig.json`, `LICENSE`, `src/index.ts`; one placeholder test.

- [ ] **Step 1: Root config.**
  - `package.json`:
    - `"private": true`, `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": {"node": ">=22"}`.
    - Scripts:
      - `"build": "tsc -b"`
      - `"lint": "eslint ."`
      - `"typecheck": "tsc -b && tsc -p tsconfig.test.json"`
      - `"test": "vitest run"`
      - `"convert": "tsx scripts/convert.ts"`
      - `"privacy": "node scripts/privacy-check.mjs"`
      - `"prepare": "git config core.hooksPath .githooks || true"`
    - devDependencies with exact versions (`npm i -D -E`): `typescript`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `tsx`, `pngjs`, `@types/pngjs`, `@types/node`.
  - `tsconfig.base.json`:
    ```json
    { "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
      "strict": true, "noUncheckedIndexedAccess": true, "declaration": true, "sourceMap": true,
      "composite": true, "resolveJsonModule": true, "skipLibCheck": true } }
    ```
  - `tsconfig.json`: `{ "files": [], "references": [{ "path": "packages/core" }, { "path": "packages/engine-wasm" }] }`.
  - `tsconfig.test.json`:
    - extends the base with `"noEmit": true`, `"composite": false`, `"allowJs": true` and `"checkJs": false` (the tests import the untyped `scripts/privacy-check.mjs`);
    - includes `packages/*/test/**/*.ts` and `scripts/**/*.ts`;
    - `paths` maps both package names to their `src/index.ts`.
  - `vitest.config.ts`:
    ```ts
    import { defineConfig } from 'vitest/config';
    import { fileURLToPath } from 'node:url';
    export default defineConfig({
      resolve: { alias: {
        '@lily-on-eink/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
        '@lily-on-eink/engine-wasm': fileURLToPath(new URL('./packages/engine-wasm/src/index.ts', import.meta.url)),
      } },
      test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 60_000,
              fileParallelism: false },  // never two WASM engines at once
    });
    ```
  - `eslint.config.js`:
    - `@eslint/js` recommended plus `typescript-eslint` recommended;
    - `globals.node` for `scripts/**` and `**/*.mjs`;
    - ignore `**/dist`, `node_modules`, `out`, `test-output`.
  - `.gitignore`: `node_modules/`, `dist/`, `*.tsbuildinfo`, `out/`, `coverage/`, `test-output/`, `.privacy-denylist`.
- [ ] **Step 2: Packages.**
  - Both packages get:
    - `"type": "module"`, `"version": "0.0.0"`;
    - `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, `"files": ["dist"]`;
    - `"scripts": { "build": "tsc -b" }`;
    - a `tsconfig.json` that extends the base with `rootDir: "src"`, `outDir: "dist"`, `include: ["src", "src/**/*.json"]`.
  - `packages/core/package.json`: `"name": "@lily-on-eink/core"`, `"license": "MIT"`.
  - `packages/engine-wasm/package.json`:
    - `"name": "@lily-on-eink/engine-wasm"`, `"license": "GPL-3.0-or-later"`;
    - `"dependencies": { "@sightread/lilypond-wasm": "0.2.0", "@lily-on-eink/core": "0.0.0" }`;
    - its `tsconfig.json` has `"references": [{ "path": "../core" }]`.
  - Licenses: copy the root `LICENSE` to `packages/core/LICENSE`. Copy the GPL-3.0 text from the sibling app repo's `LICENSE` to `packages/engine-wasm/LICENSE`.
  - `REUSE.toml`:
    - default MIT;
    - GPL-3.0-or-later for `packages/engine-wasm/**` and `scripts/convert.ts`;
    - `corpus/**` is excluded from the default (per-file, see `corpus/SOURCES.md`).
- [ ] **Step 3: Placeholder test and first run.** `packages/core/test/smoke.test.ts` contains `expect(1).toBe(1)`. Run `npm install && npm run build && npm test`. Expected: 1 passed.
- [ ] **Step 4: Lint and typecheck.** `npm run lint && npm run typecheck` exits 0.
- [ ] **Step 5: Commit.** `build: scaffold npm-workspaces monorepo with TypeScript, Vitest and ESLint`

### Task 2: CI, privacy check, PR checks, PR template

**Files:** `.github/workflows/ci.yml`, `.github/workflows/pr-checks.yml`, `scripts/privacy-check.mjs`, `.githooks/pre-push`, `.github/pull_request_template.md`, `packages/core/test/privacy-check.test.ts`

- [ ] **Step 1: Failing tests.**
  - Import `checkText` from `../../../scripts/privacy-check.mjs`.
  - **Build every forbidden input at runtime**, so the test file itself contains no literal:
    ```ts
    const winHome = 'C:' + '\\' + 'Us' + 'ers' + '\\someone\\x';
    const winHomeSlash = 'C:' + '/' + 'Us' + 'ers' + '/someone';
    const nixHome = '/' + 'home' + '/a/b';
    const macHome = '/' + 'Us' + 'ers' + '/a/b';
    const fileUrl = 'file:' + '///C:/x';
    const email = 'x' + '@' + 'example.org';
    ```
  - Expected findings:
    - each path → rule `abs-path`;
    - `email` → `email`;
    - a denylist entry `Secret Corp` matches `secret corp` → `denylist`.
  - No finding for:
    - the ranacrocando noreply address;
    - `noreply@github.com`, `support@github.com`;
    - `49699333+dependabot[bot]@users.noreply.github.com`;
    - version strings like `foo@1.2.3` and `actions/checkout@v4.1.1`.
- [ ] **Step 2: Run them.** They fail: the module is missing.
- [ ] **Step 3: Implement `scripts/privacy-check.mjs`.** Export `checkText(text, { denylist })` returning `{ rule, line }[]`. Rules:
  - `abs-path`:
    - `/[A-Za-z]:[\\/]+Users[\\/]/i`
    - `/(^|[\s"'(=:])\/(home|Users)\/[^\s/]+/`
    - `/file:\/\/\/?([A-Za-z]:|home\/|Users\/)/i`
  - `email`: `/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g`, minus these allowed addresses:
    - `179312672+ranacrocando@users.noreply.github.com`
    - `noreply@github.com`, `support@github.com`
    - anything ending in `[bot]@users.noreply.github.com`
  - `denylist`: case-insensitive substring match per entry.
  - `checkText` runs the rules **per line**, so the anchored regex works and findings carry a line number. It returns `{ rule, line }[]`.

  CLI behaviour, only when run directly. Guard with `if (import.meta.url === pathToFileURL(process.argv[1]).href)`.
  1. **Denylist source:** env `PRIVACY_DENYLIST` (newline-separated) plus the untracked `.privacy-denylist`.
     - If `CI === 'true'`, the event is not a fork PR, and the denylist is empty, **fail** with "PRIVACY_DENYLIST secret missing".
     - On fork PRs, skip the denylist with a notice. The workflow passes `IS_FORK`.
  2. **File scan:** every file from `git ls-files`, skipping binary extensions (`png`, `pdf`, `wasm`, `tgz`, `zip`, `otf`, `ttf`, `woff2`).
     - **Allowlist for `abs-path` and `email`:** `corpus/**`, `docs/**`, `LICENSE`, `packages/*/LICENSE`, `scripts/privacy-check.mjs`. These paths still get the `denylist` rule.
  3. **History scan:** commit author name and email, committer name and email, and the full message.
     - Scope: all commits with `--history`; otherwise `origin/main..HEAD` (all commits if `origin/main` is missing).
  4. **Output:** `path:line rule` or `commit <sha> rule`. Never print the matched text of `denylist` hits. Exit 1 on any finding.
- [ ] **Step 4: Run.** Tests pass. `npm run privacy` exits 0 on the repo (the denylist file is absent locally, which is fine outside CI).
- [ ] **Step 5: Hook.** `.githooks/pre-push` (POSIX sh) runs `node scripts/privacy-check.mjs || exit 1`. Make it executable: `git update-index --chmod=+x .githooks/pre-push`.
- [ ] **Step 6: `.github/workflows/ci.yml`.**
  - `on: { pull_request: {}, push: { branches: [main] } }`, `permissions: { contents: read }`.
  - Job `check`:
    1. `actions/checkout@v4`;
    2. `actions/setup-node@v4` with `node-version-file: .nvmrc`, `cache: npm`;
    3. `npm ci`;
    4. `npm run build`;
    5. `npm run lint`;
    6. `npm run typecheck`;
    7. `npm test`.
  - Job `privacy`:
    - checkout with `fetch-depth: 0`, then setup-node;
    - run `node scripts/privacy-check.mjs --history` with env:
      - `PRIVACY_DENYLIST: ${{ secrets.PRIVACY_DENYLIST }}`
      - `IS_FORK: ${{ github.event.pull_request.head.repo.fork || false }}`
- [ ] **Step 7: `.github/workflows/pr-checks.yml`.**
  - `on: pull_request: types: [opened, edited, synchronize, reopened]`, `permissions: { pull-requests: read }`.
  - Job `title`: `amannn/action-semantic-pull-request@v5` with `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
  - Job `review-evidence`:
    - one step with `env: BODY: ${{ github.event.pull_request.body }}`;
    - `run: printf '%s' "$BODY" | grep -Eq -- '- \[x\] Independent review done \(reviewer ≠ author\): .{10,}' && ! printf '%s' "$BODY" | grep -qF '<summary or link>' || { echo "Tick the review checkbox and replace the placeholder with the review summary/link"; exit 1; }`;
    - never interpolate `${{ }}` inside `run:`.
- [ ] **Step 8: PR template** with these sections:
  - Summary
  - Test plan
  - Checklist:
    - `- [ ] Independent review done (reviewer ≠ author): <summary or link>`
    - `- [ ] Conventional Commit PR title`
- [ ] **Step 9: Commit.** `ci: add CI and PR-check workflows, privacy check with pre-push hook, PR template`

**PR A opens here.** Maintainer action: add the secret `PRIVACY_DENYLIST` (one entry per line) **twice**: under Settings → Secrets → **Actions**, and under Settings → Secrets → **Dependabot**. Workflows triggered by Dependabot can only read Dependabot secrets.

### Task 3: Engine interface and `engine-wasm` adapter with contract tests

**Files:** `packages/core/src/engine.ts` (+ export from `index.ts`), `packages/engine-wasm/src/index.ts`, `packages/engine-wasm/engine-version.json`, `packages/engine-wasm/test/contract.test.ts`

- [ ] **Step 1: Interface** in `packages/core/src/engine.ts`:
  ```ts
  export type EngineFormat = 'pdf' | 'png';
  export interface EngineRequest {
    source: string;                                 // wrapper source
    filename: string;                               // POSIX relative, no '.' segments, e.g. 'a/lily-on-eink-wrapper.ly'
    files: Record<string, string | Uint8Array>;     // POSIX relative keys
    includePaths?: string[];                        // non-empty relative dirs only
    formats: EngineFormat[];
    resolution?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
  export interface EngineResult { ok: boolean; exitCode: number; files: Record<string, Uint8Array>; log: string; aborted?: boolean }
  export interface Engine { lilypondVersion(): Promise<string>; compile(req: EngineRequest): Promise<EngineResult>; dispose(): void }
  ```
- [ ] **Step 2: Failing contract tests.** Use one engine per file (`beforeAll` / `afterAll` → `dispose`). Expectations come from `docs/engine-findings.md`:
  1. `lilypondVersion()` equals `engine-version.json`.`lilypond` (`2.26.0`).
  2. **PDF and PNG at 300 dpi** for a source that sets `\paper { paper-width = 122\mm paper-height = 163\mm }`.
     - The result has `score.pdf` and `score.png`.
     - The PDF `/MediaBox [0 0 w h]` is within ±0.5 mm of 122×163, where mm = pt × 25.4/72.
     - The PNG IHDR size (bytes 16–23) is within ±6 px of 122/25.4×300 by 163/25.4×300.
  3. **No point-and-click:** the PDF (latin1) does not contain `textedit`.
  4. **Two books:** `\book { { c1 } } \book { { d1 } }` with formats pdf and png at 50 dpi gives `score.pdf`, `score-1.pdf`, `score.png` and `score-1.png`.
  5. **Multi-page PNG:** a long score on a small page gives `score-page1.png`, `score-page2.png`, … in order.
  6. **Multi-book multi-page PNG:** confirm the real naming (expected `score-1-page1.png`) and assert exactly what the engine produces. Task 6 uses this result.
  7. **Includes:**
     - Pass the including file only as `source` with `filename: 'a/x.ly'` (not in `files`). It includes `"b.ily"` and `"../c.ily"`; `files` contains only `a/b.ily` and `c.ily`. Both resolve.
     - A second variant includes `"c.ily"` without `../` from `a/x.ly`. Record whether it resolves; that tells us if the root is searched. Task 6's `analyzeProject` copies that rule.
  8. **Errors:** a source with an undefined command gives `ok === false`, `exitCode !== 0`, and the log matches `/:\d+:\d+: error/m`.
  9. **Known risk is pinned:** `#(ly:message (format #f "SYSTEMRET=~a" (system "exit 7")))` logs `SYSTEMRET=1792`. The test name says it documents the Node shell risk (spec §5.4).
  10. **Abort:** abort after 300 ms on a long score gives `aborted: true`. The next compile succeeds on the same engine.
  11. **Timeout:** `timeoutMs: 300` gives `aborted: true`. Leaving `timeoutMs` out never times out.
- [ ] **Step 3: Run.** Fails: the module is missing.
- [ ] **Step 4: Implement `createWasmEngine(): Engine`.**
  - Keep one `createReusableCompiler()` instance, created lazily.
  - `compile(req)`:
    1. `const signals = [req.signal, req.timeoutMs !== undefined ? AbortSignal.timeout(req.timeoutMs) : undefined].filter((s): s is AbortSignal => s !== undefined)`; `const signal = signals.length ? AbortSignal.any(signals) : undefined`.
    2. Add `'lily-on-eink-settings.ly'` with content `#(ly:set-option 'point-and-click #f)` to `files` and pass `includeSettings: 'lily-on-eink-settings.ly'`.
    3. Call `compiler.compile(req.source, { filename, files, includePaths, format: req.formats, resolution, signal })`.
    4. Success: `{ ok: true, exitCode: 0, files: result.files, log: result.logs.join('\n') }`.
    5. Catch:
       - if `signal?.aborted`, return `{ ok: false, exitCode: -1, aborted: true, files: {}, log: '' }`;
       - else if the error is a `LilyPondCompileError`, return `{ ok: false, exitCode: e.exitCode, files: {}, log: e.logs.join('\n') }`;
       - else rethrow.
    6. **Recovery:** if a compile throws an error saying the compiler is disposed or unusable, create a new compiler once and retry that compile once. There is no health-check compile after an abort; the findings show the compiler stays usable.
  - `lilypondVersion()`: compile `#(ly:message (string-append "LYVERSION=" (lilypond-version)))` with format pdf, parse `/LYVERSION=(\d+\.\d+\.\d+)/`, and cache the result.
  - `dispose()`: dispose the compiler and set a `disposed` flag. After that, `compile` and `lilypondVersion` reject with "engine disposed", and the recovery in step 6 never revives a disposed engine.
- [ ] **Step 5: Run.** All tests pass. Update `docs/engine-findings.md` with the results of tests 6 and 7. Lint and typecheck pass.
- [ ] **Step 6: Commit.** `feat(engine-wasm): add WASM engine adapter with engine contract tests`

**PR B1 opens here** (Task 3).

### Task 4: Devices and profiles

**Files:** `packages/core/src/presets/devices.json`, `packages/core/src/presets/profiles.json`, `packages/core/src/devices.ts`, `packages/core/src/profiles.ts`, `packages/core/test/devices.test.ts`, `packages/core/test/profiles.test.ts`

- [ ] **Step 1: Verify the presets** on the manufacturer's spec pages (WebSearch / WebFetch). Use a teardown or a reputable review only if the manufacturer publishes nothing.

  | Device | Expected |
  |---|---|
  | Kobo Sage (2021) | 1440×1920, 300 ppi |
  | Kobo Clara BW (2024) | 1072×1448, 300 ppi |
  | reMarkable 2 | 1404×1872, 226 ppi |

  Record the source URL per device. **If a value can't be verified, stop and report it. Don't guess.**
- [ ] **Step 2: Write the JSON files.**
  - `devices.json` is an array of `{ id, name, widthPx, heightPx, ppi, safeAreaMm: {top,right,bottom,left}, staffSizeAdjust, source }`.
    - ids: `kobo-sage`, `kobo-clara-bw`, `remarkable-2`.
    - `staffSizeAdjust`: −1 for `kobo-clara-bw`, 0 otherwise.
    - `safeAreaMm`: all 0.
  - `profiles.json` is an array of `{ id, name, staffSize, marginMm }`:

    | id | staffSize | marginMm |
    |---|---|---|
    | generic | 17 | 3 |
    | organ | 17 | 3 |
    | piano | 17 | 3 |
    | leadsheet | 18 | 3 |
    | tab | 18 | 3 |
    | accordion | 17 | 3 |
- [ ] **Step 3: Failing tests.**
  - `pageSizeMm(getDevice('kobo-sage'))` returns `{ width: 121.92, height: 162.56 }`, rounded to 0.01.
  - `getDevice('nope')` throws, and the message lists the valid ids.
  - A custom `DeviceSpec` object is accepted wherever an id is.
  - `effectiveStaffSize(getProfile('organ'), getDevice('kobo-clara-bw'))` = 16.
  - An explicit override of 19 wins.
  - `effectiveMarginsMm(profile, device)` = the profile margin + the safe area, per side.
- [ ] **Step 4: Implement.** Import the JSON with `import devices from './presets/devices.json' with { type: 'json' };`. `tsc` copies it to `dist/presets/`.

  Exports: `DeviceSpec`, `Profile`, `getDevice`, `listDevices`, `pageSizeMm`, `getProfile`, `listProfiles`, `effectiveStaffSize`, `effectiveMarginsMm`.
- [ ] **Step 5: Run and commit.** Tests pass. Commit: `feat(core): add verified device presets and genre profiles`

### Task 5: Overlay file and wrapper generation

**Files:** `packages/core/src/ly/lily-on-eink.ily`, `packages/core/src/overlay-sources.ts`, `packages/core/src/wrapper.ts`, `packages/core/test/wrapper.test.ts`

- [ ] **Step 1: Write the overlay** `src/ly/lily-on-eink.ily` from scratch. Do not copy LilyPond init files.
  ```lilypond
  % lily-on-eink overlay (slice). MIT. Neutralises manual layout before the user's file is read.
  break = {}
  noBreak = {}
  autoBreaksOff = {}
  autoLineBreaksOff = {}
  autoPageBreaksOff = {}
  % Page-marker commands are legal at top level; return a neutral page marker instead of {}.
  #(define (lily-on-eink:neutral-page-marker)
     (make-music 'EventChord 'page-marker #t 'elements '()))
  pageBreak = #(define-music-function () () (lily-on-eink:neutral-page-marker))
  noPageBreak = #(define-music-function () () (lily-on-eink:neutral-page-marker))
  pageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))
  noPageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))
  allowPageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))
  ```
- [ ] **Step 2: `src/overlay-sources.ts`** exports `OVERLAY_ILY` with the identical text as a `String.raw` literal. That keeps the code browser-safe, with no `fs`. A unit test reads `src/ly/lily-on-eink.ily` from disk with `node:fs` and asserts it equals `OVERLAY_ILY`, so the two cannot drift. This is the only mechanism; there is no embed script.
- [ ] **Step 3: Failing snapshot tests.**
  - Input: `buildWrapper({ mainBasename: 'song.ly', pageMm: { width: 121.92, height: 162.56 }, marginsMm: { top: 3, right: 3, bottom: 3, left: 3 }, staffSize: 17, keepTagline: true, lilypondVersion: '2.26.0' })`.
  - Expected `source`, exactly:
    ```lilypond
    \version "2.26.0"
    \include "lily-on-eink.ily"
    \include "song.ly"
    \paper {
      paper-width = 121.92\mm
      paper-height = 162.56\mm
      top-margin = 3\mm
      bottom-margin = 3\mm
      left-margin = 3\mm
      right-margin = 3\mm
      ragged-last-bottom = ##t
      print-page-number = ##f
    }
    #(set-global-staff-size 17)
    ```
  - `keepTagline: false` appends `\header { tagline = ##f }`.
  - Numbers have at most 2 decimals and no locale formatting.
  - `mainBasename` values containing `"` or `\` are escaped as `\"` and `\\`.
- [ ] **Step 4: Implement** `buildWrapper(opts): { source: string; overlay: { name: 'lily-on-eink.ily'; content: string } }`.
  - No `set-paper-size`: it would rescale margins and indent from A4 (spec §4.1).
  - No `indent` override in the slice.
  - Known slice limits, recorded as a comment and fixed in the hardening plan:
    - `\book` blocks with their own `\paper`;
    - a file-level `line-width`;
    - long titles.
- [ ] **Step 5: Run and commit.** Tests pass. Commit: `feat(core): add overlay and wrapper generation`

### Task 6: Project analysis, diagnostics, output mapping

**Files:** `packages/core/src/project.ts`, `packages/core/src/diagnostics.ts`, `packages/core/src/outputs.ts`, plus a test per module

- [ ] **Step 1: `project.ts`** (TDD).
  - `findIncludes(source)` returns `\include "x"` targets. It ignores `%` line comments, `%{ … %}` block comments, and `\include` occurring inside other string literals.
  - `analyzeProject(files, builtinIncludes)` returns `{ mainFiles, missingIncludes: { from, target }[], versions }`.
    - Resolution follows the rule measured in Task 3, contract test 7: relative to the including file's directory, then the project root **only if** the engine does that.
    - POSIX paths, with `..` resolved.
    - Main file = a `.ly` file that no other file includes. `.ily` files are never main files.
    - Missing = not in the project and not in `builtinIncludes`.
    - `versions` comes from `\version "x.y.z"`.
  - `BUILTIN_INCLUDES`: `english.ly`, `deutsch.ly`, `italiano.ly`, `espanol.ly`, `predefined-guitar-fretboards.ly`, `predefined-ukulele-fretboards.ly`, `predefined-mandolin-fretboards.ly`. A comment notes it is a candidate for an engine-provided list.
- [ ] **Step 2: `diagnostics.ts`** (TDD).
  - `normalizeLog(log)`:
    - strips the engine's virtual root `/input/` (see `docs/engine-findings.md`);
    - replaces any remaining absolute-path prefix with `<abs>/`.
  - `parseDiagnostics(log)` returns `{ file, line, column, severity, message }` for every line matching `^(.+?):(\d+):(\d+): (error|warning): (.*)$`.
  - Tests use literal log excerpts produced by the Task 3 contract tests. Copy them in from a real run.
- [ ] **Step 3: `outputs.ts`** (TDD).
  - `groupOutputs(files)` returns `{ books: { bookIndex, pdf?, pngPages: Uint8Array[] }[], unrecognized: string[] }`.
    - PDF: `score.pdf` → book 0; `score-N.pdf` → book N.
    - PNG: `score.png` → page 1 of book 0; `score-pageK.png` → page K of book 0; `score-N.png` → page 1 of book N; multi-book multi-page names follow the pattern verified in Task 3, test 6.
    - Anything else (e.g. from `\bookOutputName`) goes to `unrecognized`. The caller turns it into a warning.
  - `outputFileName(title, basename, deviceName, bookIndex)`:
    - Base = title, or the basename without extension if there is no title.
    - When bookIndex > 0, append ` (bookIndex+1)`.
    - Then append ` – <deviceName>.pdf`.
    - FAT32-safe: `<>:"/\|?*` and control characters become `_`; trailing dots and spaces are trimmed.
    - The **total length including `.pdf`** is at most 150 characters; truncate the base first.
- [ ] **Step 4: Run and commit.** Tests pass. Commit: `feat(core): add project analysis, diagnostics parsing and output mapping`

**PR B2 opens here** (Tasks 4–6).

### Task 7: `convert()` and the corpus slice with compile tests

**Files:** `packages/core/src/convert.ts`, `packages/core/src/index.ts`, `corpus/**`, `corpus/SOURCES.md`, `packages/engine-wasm/test/corpus.test.ts`

- [ ] **Step 1: Add the corpus files**, keeping their original headers:
  - Reger, from `https://raw.githubusercontent.com/ranacrocando/lilypond-scores/main/max-reger-lobe-den-herren/max-reger-lobe-den-herren.ly`. CC0 per the file header. Save it as `corpus/organ/reger-lobe-den-herren/reger-lobe-den-herren.ly`.
  - "Leise rieselt der Schnee": both files from `ranacrocando/kinder-wollen-singen`, path `books/weihnachtslieder/`. CC0 per the repo LICENSE.
  - The bass etude is already committed.
  - `SOURCES.md` table with one row per file:
    - path, title, upstream URL;
    - license and how it was verified;
    - original `\version`;
    - **conversion:** "compiles unchanged on 2.26.0" if the corpus test passes without edits; otherwise "converted with convert-ly <version>" plus the command used.
- [ ] **Step 2: Failing corpus tests** in `packages/engine-wasm/test/corpus.test.ts` (GPL path). Use one engine for the file.
  - **Sage cases:** for each main file × `kobo-sage` with its profile (organ, tab, leadsheet), run `convert` with `outputs: ['pdf','png']`. Assert:
    1. no `error` diagnostics, and exactly 1 output;
    2. PDF MediaBox within ±0.5 mm of 121.92×162.56;
    3. page count between 1 and 2;
    4. no `textedit` in the PDF;
    5. **margin band is white:** decode each PNG page with `pngjs`. Every pixel within `2.5 mm × 300/25.4 ≈ 29 px` of all 4 edges has every channel ≥ 250;
    6. **staff size took effect:** a separate test on a synthetic project file `staff.ly` containing `\header { tagline = ##f } 
ew Staff { s1*8 }`. Compile it with `convert` (device `kobo-sage`, `staffSize: 17`, PNG at 300 dpi). In the first page, scan the pixel column at 50% of the width from the top and take the first five dark runs (channel < 128). The mean distance between their centres must be 17.7 ± 1 px (17 pt staff ⇒ 4.25 pt staff space ⇒ 17.7 px).
  - **Negative control:** compile the bass etude with a wrapper variant that adds `indent = 0` to `\paper`. Use a test-only option `extraPaper: 'indent = 0'` on `buildWrapper`, not exposed in `convert`. The white-band check **must fail**. This proves the check detects clipped instrument names.
  - **Other devices:** Reger × `kobo-clara-bw` and Reger × `remarkable-2`: no errors, page size matches.
- [ ] **Step 3: Implement `convert(files, options, engine)`** per spec §5.1, slice subset:
  1. Run `analyzeProject`. `options.mainFiles` overrides the detected main files.
  2. Emit a `missing-include` error per missing include, and skip affected main files.
  3. For each main file:
     - Build the wrapper with `mainBasename` = the file's basename.
     - Put the wrapper at `<mainDir>/lily-on-eink-wrapper.ly`, or `lily-on-eink-wrapper.ly` at the root. Never use `./`.
     - Put the overlay at `<mainDir>/lily-on-eink.ily`, so it resolves relative to the wrapper.
     - Call `engine.compile` with:
       - `files`: the project files plus the overlay;
       - `formats` from `options.outputs` (default `['pdf']`);
       - `resolution` = device ppi;
       - `signal` and `timeoutMs` passed through.
  4. Run `groupOutputs`. Turn `unrecognized` names into warnings.
  5. Title: from `title = "…"` in the main file's `\header`, else the basename.
  6. Diagnostics: `parseDiagnostics(normalizeLog(log))`.
  7. Call `onProgress` per file. A failed or aborted file adds an error diagnostic, and the loop continues.
  - Export the public API from `index.ts`.
- [ ] **Step 4: Run all tests.** They pass. Write each Sage page PNG to `test-output/` (gitignored) and **look at them**: full width, nothing clipped, title readable.
- [ ] **Step 5: Commit.** `feat(core): add convert() with corpus compile tests for organ, bass tab and lead sheet`

### Task 8: Dev convert script

**Files:** `scripts/convert.ts`

- [ ] **Step 1: Implement.**
  - Parse arguments with `node:util` `parseArgs`:
    - positional files or folders;
    - `--device` (required);
    - `--profile` (default `generic`);
    - `--out` (default `out`);
    - `--no-tagline`.
  - Walk folders for `.ly` and `.ily` files. Keys are POSIX paths relative to each root.
  - Run `convert` with `createWasmEngine()`. Write `<out>/<device-id>/<fileName>`.
  - Print diagnostics as `file:line: severity: message`. Exit 1 if any error occurred.
  - Header comment: **"Trusted files only: LilyPond can run shell commands in Node (spec §5.4). Dev tool; not distributed."**
- [ ] **Step 2: Verify manually.** `npm run convert -- corpus/organ --device kobo-sage --profile organ` writes one PDF to `out/kobo-sage/`. Open it and check it.
- [ ] **Step 3: Commit.** `feat: add dev convert script for batch conversion`

**PR B3 opens here** (Tasks 7–8).
