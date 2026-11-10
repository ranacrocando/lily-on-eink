# lily-on-eink — Design Spec

Status: reviewed (2 independent review rounds), awaiting owner approval · Date: 2026-11-09

## 1. Goal

Re-engrave LilyPond (`.ly`) scores so that **one PDF page equals one e-reader screen at 1:1**. Today an A4 PDF is shrunk to about 50% on a 7–8" e-ink reader, which makes it unreadable.

The tool must also be usable by people who are not technical: they drop `.ly` files into a web page and download PDFs for their device.

Reference device: **Kobo Sage**, 8", 1440×1920 px, 300 ppi, about 122×163 mm.

A spike confirmed the approach before this spec was written:
- A Reger organ chorale prelude (CC0) renders to 2 pages and reads well on a Kobo Sage at an effective staff size of about 17.
- The WASM engine compiles it in about 3 s, about as fast as native LilyPond.

### Supported genres (v1)

| Genre | Typical LilyPond content |
|---|---|
| Organ | 2 manual staves plus a pedal staff |
| Piano | `PianoStaff` / `GrandStaff` |
| Lead sheet | `ChordNames` + melody `Staff` + `Lyrics` |
| Bass tab | `Staff` (`bass_8`) + `TabStaff` with `bass-tuning` |
| Ukulele | `TabStaff` with `ukulele-tuning`, `FretBoards` / fret diagrams |
| Accordion | register symbols (`\discant`, `\stdBass`, …), Stradella bass |

### Non-goals (v1)

- Chords over lyrics without a melody ("Ultimate-Guitar style"). Planned later as HTML-in-EPUB without LilyPond.
- Reformatting bought or scanned PDFs (system splitting, OMR).
- EPUB output for sheet music.
- Running `convert-ly` in the browser. It is Python and cannot run in the WASM build.
- Accounts, server-side storage or any server.

### Deferred (after v1, not designed in detail here)

- Native-LilyPond engine.
- PWA/offline mode.
- Page-turn-aware breaking (`ly:page-turn-breaking`).
- Landscape orientation.
- Genre auto-detection.
- npm publishing.

## 2. Repositories and licenses

| Repo / package | Contents | License |
|---|---|---|
| `lily-on-eink` → `packages/core` | LilyPond overlay (`.ily`), device presets, genre profiles, TypeScript core with an `Engine` *interface* only. **No engine code or engine assets** | MIT |
| `lily-on-eink` → `packages/engine-wasm` | Thin adapter that implements `Engine` on top of `@sightread/lilypond-wasm` | GPL-3.0-or-later |
| `lily-on-eink` → `corpus/` | Test scores, each under its own license (PD, CC0, MIT) | per file |
| `lily-on-eink-app` | Static web app; bundles core + `engine-wasm` + the engine | GPL-3.0-or-later |

Why these licenses:
- The MIT core never contains or conveys GPL code, so the overlay and library stay reusable under MIT.
- Everything that ships the GPL engine is GPL.
- The engine's own notices list:
  - LilyPond/Guile/etc. under GPL/LGPL,
  - Emmentaler under OFL,
  - TeX Gyre under GUST,
  - URW Base35 text fonts under AGPL-3.0 with the font exception, which covers documents and does not require AGPL for the app.
- Output PDFs are not affected by any of these licenses.

**Per-file licensing:**
- The repo uses a `REUSE.toml`, or SPDX headers, so it is unambiguous that the repo-wide `LICENSE` (MIT) does not cover `corpus/` or the GPL packages.
- Each GPL package has its own `LICENSE` file.
- MIT-licensed corpus files ship their original copyright notice next to the file.

**Engine assets are never committed.**
- `@sightread/lilypond-wasm` is installed from npm at an exact pinned version, with its lockfile integrity hash, and cached in CI.
- The app copies the assets from `node_modules` into its build output at build time.

Copyright holder for the project's own code: `ranacrocando`. Both repos are developed privately and made public once mature (§10).

## 3. Architecture overview

```
lily-on-eink (monorepo, npm workspaces)               lily-on-eink-app (GPL)
┌───────────────────────────────────────────┐        ┌────────────────────────────┐
│ packages/core (MIT)                       │        │ Static site (Vite + TS)    │
│   ly/lily-on-eink.ily  (overlay)          │        │  ├ UI (plain DOM)          │
│   presets/devices.json, profiles.json     │◄───────┤  ├ core (main thread)      │
│   devices · profiles · wrapper · project  │        │  │                         │
│   diagnostics · convert() · Engine (type) │        │  │                         │
│ packages/engine-wasm (GPL) → lilypond-wasm│◄───────┤  └ engine: one Web Worker  │
│ scripts/convert (dev script, not shipped) │        │                            │
│ corpus/ + tests                           │        │ hosted on GitHub Pages     │
└───────────────────────────────────────────┘        └────────────────────────────┘
```

### How the app gets the core

- **Locally:** both repos are checked out side by side, and the app depends on `file:../lily-on-eink/packages/core` and `file:../lily-on-eink/packages/engine-wasm`.
- **In app CI** (both repos private):
  - The workflow checks out `lily-on-eink` next to the app with `actions/checkout`, at a **pinned ref** (tag or commit SHA recorded in a single config file, `core-ref.txt`).
  - It uses a fine-grained, read-only token (`contents:read` on `lily-on-eink` only) stored as the secret `CORE_REPO_TOKEN`.
  - It builds core, then the app.
  - Once the repos are public the token is no longer needed.

### Distribution of core (no npm registry in v1)

npm cannot install a workspace sub-package straight from a git tag. Core is therefore distributed as **tarballs attached to GitHub Releases**:
- A release workflow in `lily-on-eink` runs **only when a GitHub Release is published** (`on: release: types: [published]`). Pushing a tag alone builds nothing.
- The maintainer creates the release in the GitHub UI, with a new tag `vX.Y.Z` on `main`. The workflow then:
  1. asserts that the release tag equals every package's `package.json` version, and fails the run otherwise. To fix a failed release, delete the release and its tag, fix the version on `main` via a PR, and create the release again. The workflow also offers `workflow_dispatch` with a tag input, to re-run the upload for an existing release;
  2. builds the packages;
  3. runs `npm pack` for `core` and `engine-wasm`;
  4. **installs both tarballs into a clean temporary project as a smoke check**, using the same `overrides` entry as the app (see below);
  5. uploads the `.tgz` files to that same release with `gh release upload --clobber`. The workflow sets `permissions: contents: write` and `GH_TOKEN: ${{ github.token }}`.
- The workflow also runs for prereleases and for drafts once they are published. Releases must be created by a person, because releases created with `GITHUB_TOKEN` do not trigger workflows.
- Once the repo is public, the app depends on **both** release tarball URLs. `engine-wasm` declares `@lily-on-eink/core` as a normal semver dependency, so the app also adds an `overrides` entry that maps `@lily-on-eink/core` to the core tarball URL. Otherwise npm would look for core on the registry. The lockfile pins the URLs and integrity hashes.

  ```json
  "dependencies": {
    "@lily-on-eink/core": "https://github.com/ranacrocando/lily-on-eink/releases/download/v0.1.0/lily-on-eink-core-0.1.0.tgz",
    "@lily-on-eink/engine-wasm": "https://github.com/ranacrocando/lily-on-eink/releases/download/v0.1.0/lily-on-eink-engine-wasm-0.1.0.tgz"
  },
  "overrides": {
    "@lily-on-eink/core": "$@lily-on-eink/core"
  }
  ```
- **App CI after the switch:**
  - It installs the tarballs.
  - For the parity test (§9) it additionally checks out `lily-on-eink` at **the same tag**, without a token once public, to get the corpus and reference snapshots.
  - `core-ref.txt` is then replaced by the version in the tarball URLs, and `CORE_REPO_TOKEN` is removed.
- **Until then** (private repos) the app uses the pinned checkout described above.
- **Bumping core in the app is manual:** update the tarball URLs (or `core-ref.txt`) in a PR. Dependabot does not update URL or `file:` dependencies.
- Publishing to the public npm registry stays optional. It is decided in M3, only if third parties want to use the library.

**Engine version consistency.**
- The app **never depends on `@sightread/lilypond-wasm` directly**. It gets the engine only transitively through `@lily-on-eink/engine-wasm`, so exactly one engine version exists in both repos.
- The app's Dependabot config ignores that package.

### Engine and version policy

- **One LilyPond version everywhere**, through `@sightread/lilypond-wasm` pinned to an exact version (currently 0.2.0, believed to bundle 2.26).
  - The core reads the engine's real version (`(lilypond-version)` evaluated in the engine; recorded in `packages/engine-wasm/engine-version.json`) and writes **that** into the wrapper's `\version`.
  - It never hard-codes 2.26.
- The **WASM engine is the only engine in v1.** It is used for the tests, CI, the dev convert script and the app, so layouts are identical everywhere. A spike showed that LilyPond 2.24 and 2.26 already differ in bars per line.
- Every compile disables point-and-click (`#(ly:set-option 'point-and-click #f)` through the engine's `includeSettings` file, because the engine accepts no `-d` command-line options). Otherwise PDFs contain `textedit://` links with absolute paths: a tap on a note on e-ink would try to follow them, and they leak local paths.
- The `Engine` interface allows other engines later, e.g. native LilyPond.

### Cancellation and timeouts

- The engine runs compiles in its own worker (a Web Worker in the browser, `worker_threads` in Node). Cancel and timeout use its `AbortSignal` support. Verified: the compile rejects with `AbortError` after about 0.5 s, and **the reusable compiler stays usable** (`docs/engine-findings.md`).
- `engine-wasm` only falls back to disposing and recreating the compiler if an abort ever leaves it unusable.
- `engine-wasm` encapsulates this. Callers just pass an `AbortSignal` / `timeoutMs`.

## 4. The overlay (LilyPond layer)

The overlay is the heart of the project. It must work with arbitrary real-world `.ly` files without editing them.

All overlay code is **written from scratch, with no code copied from LilyPond's `ly/` or `scm/` files**, so it can stay MIT.

The claims below were checked against the 2.24 init files. Each must be re-verified against the engine's actual version as the first overlay task.

### 4.1 Wrapper and three-point strategy

The core generates a **wrapper** that is compiled instead of the user's file:

```lilypond
\version "<engine version>"
\include "lily-on-eink.ily"           % defines functions, hooks, break no-ops
#(lily-on-eink:configure! '((paper-width-mm . 122) (paper-height-mm . 163)
                            (margins-mm . (3 3 3 3)) (staff-size . 17) ...))
\include "<user-main-file>.ly"
#(lily-on-eink:finalize!)
```

The overlay acts at three points.

**(1) Before the include, in `configure!`:**
- Set the device paper on `$defaultpaper`:
  - Set `paper-width`, `paper-height` and **every margin explicitly**. `set-paper-dimensions` is private and scales margins from A4, so it is not used.
  - `module-remove!` `line-width`.
- Set the staff size with `layout-set-absolute-staff-size-in-module` on both the paper and the default layout.
- Install the hooks and the break no-ops.

**(2) Hooks: wrap `toplevel-book-handler`, `toplevel-bookpart-handler` and `toplevel-score-handler`.** Just before rendering, each hook applies the "device paper" procedure to the book's `\paper` and to every score's `\layout`. The procedure:

1. Sets `paper-width`, `paper-height`, `top-margin`, `bottom-margin`, `left-margin` and `right-margin`.
2. Removes or neutralizes `line-width`, `inner-margin`, `outer-margin`, `binding-offset` and `two-sided`. Sets `landscape = ##f` and removes `papersizename`, because `set-default-paper-size … 'landscape` sets them and the backend would rotate the page.
3. Removes `system-count`, `page-count`, `systems-per-page`, `min-systems-per-page` and `max-systems-per-page`. Resets `page-breaking` to the profile's breaker (default `ly:optimal-breaking`).
4. Re-applies the staff size with `layout-set-absolute-staff-size-in-module`. This is needed because a user's `#(set-global-staff-size …)` replaces `$defaultpaper` with a clone, which throws away the pre-include setup.
5. Applies the profile's thickness and font settings (§4.4).
6. Sets `print-page-number = ##f`, `ragged-last-bottom = ##t`, and the title, page header and footer handling below. (In the current slice this lives in the wrapper's final `\paper` block, which follows the user's `\include`; see "Titles".)
7. Sets the indent (see "Indent" below).

The book hook **recurses** through `ly:book-book-parts` and `ly:book-scores`, because nested `\bookpart`s inside a `\book` never reach `toplevel-bookpart-handler`.

**(3) After the include, in `finalize!`:**
- Re-apply the device paper to `$defaultpaper` and the default layout.
- This covers files without `\book` whose implicit book is built at end of file, and files that called `set-global-staff-size` or `set-default-paper-size` at top level.

**Neutralizing manual breaks.** These are defined before the user file is included:
- `\break`, `\noBreak`, `\autoBreaksOff`, `\autoLineBreaksOff` and `\autoPageBreaksOff` are redefined as music that does nothing.
- **Page-marker commands are special:** `\pageBreak`, `\pageTurn`, `\noPageBreak`, `\noPageTurn` and `\allowPageTurn`. They are legal at top level between scores, where they produce a page marker. An empty `{}` there would become a score of its own.
  - They are redefined as music functions that return a neutral `EventChord` with `'page-marker #t` and no break or turn permissions.
  - A fixture with a top-level `\pageBreak` and a top-level `\noPageBreak` between scores covers this.

**Indent.**
- There is no blanket `indent = 0`. The bass tab fixture showed that it cuts off instrument names.
- The score hook walks the score's music, context mods and `\layout` context definitions for `instrumentName` / `shortInstrumentName`.
- It measures them with `interpret-markup` and sets `indent` / `short-indent` to the measured width plus padding (2 mm). If there are no names, the indent is 0.
- This needs no TypeScript heuristic.

**Titles.**
- The overlay defines **custom markup commands** (MIT, written from scratch):
  - `\lily-on-eink-field`: string fields are split greedily at ASCII spaces into **centred** lines that fit `line-width`; markup fields that are too wide are scaled down to `line-width`.
  - `\lily-on-eink-field-pair`: two fields flush left and flush right on one line (poet/composer, meter/arranger, piece/opus), stacked when they do not fit side by side.
  - `\lily-on-eink-score-title`: the piece/opus pair; with `print-all-headers`, the full title block above it.
  - `\lily-on-eink-page-header`: the instrument on every page of a book part but its first. No page numbers.
  - `\lily-on-eink-footer`: copyright on the first page of each book part, tagline on the last page of the book.
- It applies to every header field the title markups render: `dedication`, `title`, `subtitle`, `subsubtitle`, `instrument`, `poet`, `composer`, `meter`, `arranger`, `piece` and `opus`, plus `copyright` and `tagline`.
- The title is `\huge \bold`, two font-size steps below LilyPond's A4 default, so that typical titles fit one line on a 6–8" page.
- **Installation:** the wrapper's final `\paper` block, after the user's `\include`, sets `bookTitleMarkup`, `scoreTitleMarkup`, `oddHeaderMarkup`, `evenHeaderMarkup`, `oddFooterMarkup` and `evenFooterMarkup` to the overlay's markups. Being the last write to the default paper, it wins over LilyPond's defaults and the user's top-level `\paper`.
- **Known limits:**
  - The user's own page headers and footers are replaced, and so is a `bookTitleMarkup` (including `bookTitleMarkup = ##f` used to hide titles).
  - A `\paper` block inside `\book` or `\bookpart` is not covered yet; its title markups stay as the user wrote them.
- `\wordwrap-field` is not used: it returns an empty stencil for markup values and is left-aligned.

**Tagline.**
- Kept by default, because taglines often carry license or attribution text. It is rendered one size smaller and wrapped with the same custom markup command, by `\lily-on-eink-footer`.
- `keepTagline: false` drops it.

### 4.2 Physical sizing and margins

The PDF page always has **exactly the device's full physical screen size**, so the reader displays it at 1:1 without scaling or letterboxing. LilyPond's staff size in pt is therefore the physical size on screen.

**Margins** come from two sources, added together:
- **Profile base margin:** 3 mm on all sides by default, set per profile.
- **Device safe area:** the space covered by reader UI that is **drawn over** the page and can't be hidden, e.g. Kindle's progress footer. It is added to the matching margin and never shrinks the page. Values are in mm.

**Staff size:**
- The staff size belongs to the **genre profile** and means the same physical size on every device.
- A device may define `staffSizeAdjust` (e.g. −1 for 6" screens). This exception exists because small screens fit very few bars per line at the default size: the user trades a slightly smaller staff for usable line lengths.
- Users can still override the staff size explicitly.

### 4.3 Device presets (`packages/core/presets/devices.json`)

```json
{
  "id": "kobo-sage",
  "name": "Kobo Sage (8\", 2021)",
  "widthPx": 1440, "heightPx": 1920, "ppi": 300,
  "safeAreaMm": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "staffSizeAdjust": 0,
  "source": "<manufacturer spec URL>"
}
```

- Page size in mm is derived: `px / ppi × 25.4`.
- Each preset names an exact model and generation, and cites the source of its values.
- **M1 presets** (values verified before merge):
  - Kobo Sage, the reference device,
  - one 6" device at 300 ppi (Kobo Clara BW/Colour or Clara 2E, whichever is verified),
  - one device at 227 ppi or lower (e.g. reMarkable 2).
- **M2 presets:** Kobo Libra Colour, Kobo Elipsa 2E, Kindle Paperwhite (12th gen), Kindle Scribe, PocketBook Era. Each is added only once its values are verified.
- Users of the library can pass extra presets. The app also accepts a custom `widthPx` × `heightPx` at `ppi`.

### 4.4 Genre profiles (`packages/core/presets/profiles.json`)

A profile sets:
- staff size,
- base margin,
- lyric and chord-name font sizes relative to the staff,
- line-thickness factors (staff lines, stems, ledger lines, bar lines, fret diagrams, tab numbers),
- page-breaking procedure (v1: always `ly:optimal-breaking`).

v1 profiles: `generic` (default), `organ`, `piano`, `leadsheet`, `tab` (bass and ukulele), `accordion`. The user picks the profile.

Starting values, all to be tuned with the corpus:
- `generic`, `piano` and `organ`: 17 pt (the docs suggest 8"+ devices for organ),
- `leadsheet`: 18 pt,
- `tab`: 18 pt with larger tab numbers.

**Thickness by ppi:**
- `ppi ≥ 280`: the profile's base thickness.
- `ppi < 280`: an extra boost so thin lines don't render as grey anti-aliased mush. It applies to custom sizes too.
- The factors are tuned with renders at device resolution.

## 5. Core library (`packages/core`)

### 5.1 Public API

```ts
interface ConvertOptions {
  device: string | DeviceSpec;          // preset id or custom spec
  profile?: string;                     // default 'generic'
  staffSize?: number;                   // overrides profile + device adjust
  keepTagline?: boolean;                // default true
  outputs?: Array<'pdf' | 'png'>;       // png = preview/snapshot at device ppi
  mainFiles?: string[];                 // override main-file detection
  signal?: AbortSignal;
  timeoutMs?: number;                   // default 60000 per main file
  onProgress?: (p: Progress) => void;
}

interface ProjectFile { path: string; content: Uint8Array | string }   // relative, POSIX-style

convert(files: ProjectFile[], options: ConvertOptions, engine: Engine): Promise<ConvertResult>

interface ConvertResult {
  outputs: Array<{                      // ONE ENTRY PER PRODUCED DOCUMENT
    mainFile: string;
    bookIndex: number;                  // 0 unless the file has several \book blocks
    pdf?: Uint8Array;
    pngPages?: Uint8Array[];
    fileName: string;                   // "<title or basename>[ (n)] – <device name>.pdf", FAT32-safe
  }>;
  diagnostics: Diagnostic[];            // all files; severity error|warning|info
  logs: Record<string, string>;         // per main file, paths normalized
}

interface Engine {
  readonly lilypondVersion: string;
  compile(req: { mainFile: string; files: ProjectFile[]; includePaths: string[];
                 formats: Array<'pdf'|'png'>; resolution?: number; options: string[];
                 signal?: AbortSignal; timeoutMs?: number })
    : Promise<{ files: Record<string, Uint8Array>; log: string; exitCode: number }>;
}
```

```ts
interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  file?: string; line?: number; column?: number;   // project-relative
  code: string;                                     // e.g. 'missing-include', 'old-version', 'lilypond'
  message: string;                                  // user-facing text
  raw?: string;                                     // original log excerpt
}
interface Progress { mainFile: string; index: number; total: number;
                     phase: 'queued' | 'compiling' | 'rendering' | 'done' | 'failed' }
```

A main file with several `\book` blocks yields several outputs. They are not merged.
- `bookIndex` follows the order in which the engine reports the output files. The first book's output is unsuffixed (`score.pdf`, bookIndex 0), and later books are `score-1.pdf`, `score-2.pdf`, … (bookIndex = N). PNG pages are named `score-page1.png`, `score-page2.png`, …
- The overlay's book hook records each book's `\bookOutputName` / `\bookOutputSuffix`. The core uses this to map renamed outputs back to their index.
- Final file names always come from `fileName`, never from the engine's names.

A failed main file produces diagnostics, and the others still convert.

### 5.2 Project analysis (`project.ts`)

- **Include graph:** parse `\include "…"` statements, ignoring comments and strings. Resolve paths relative to the including file, then the include paths.
- **Main files:** `.ly` files that no other uploaded file includes. `.ily` files are never main files. `mainFiles` overrides the detection.
- **Missing includes** are reported before compiling.
  - Exception: names that exist in the engine's own `ly/` directory (e.g. `english.ly`, `predefined-ukulele-fretboards.ly`) are not missing. The engine provides that list.
- **Version check** reads `\version`:
  - older than 2.24: warning, "may need convert-ly";
  - older than 2.20: stronger warning with step-by-step guidance.

### 5.3 Diagnostics

- LilyPond errors and warnings are parsed from the log into `{ file, line, column, severity, message }`.
- Absolute and virtual-FS paths are normalized to project-relative paths, for privacy and for stable snapshots.
- Messages are written for non-technical users, with the raw log available as details.

### 5.4 Security

- **Browser:** the user's own `.ly` files run Scheme inside their own tab. No extra risk.
- **Node** (tests, dev script, future CLI): the Emscripten glue implements `system()` with `child_process`. **Verified: a `.ly` file can run real shell commands in Node** (`(system "exit 7")` returned 1792, i.e. exit status 7 << 8). The engine package offers no hook to stub this.
  - Node usage is therefore for **trusted files only**, and this is stated in the README.
  - Before the CLI ships (post-MVP), mitigation is evaluated again, e.g. redefining `system`, `system*` and `open-pipe` in the settings file. That would be partial only.

### 5.5 Output metadata

- The PDF Title comes from `\header { title }`. Verify that the engine sets it.
- Filenames are sanitized for FAT32, because e-readers mount as FAT.

## 6. CLI: post-MVP (phase 2)

A published CLI (`packages/cli`, GPL) is **not part of the MVP**. The MVP is the core plus the web app.

- Once the MVP shows what the CLI should look like (commands, batch behaviour, GitHub Action use), a GitHub issue describing it is opened. An independent agent reviews the issue before it is filed.
- Until then, a **dev script** in the core repo covers batch conversion for the maintainer:
  - `npm run convert -- <files or folders> --device kobo-sage [--profile organ] [--out dir]`
  - It writes `<out>/<device-id>/<file>.pdf`.
  - It is not published and has no stability promise.
  - It imports the GPL `engine-wasm` package but is never distributed (no package, no release asset), so it has no license implication for the MIT core.

## 7. Web app (`lily-on-eink-app`, M2)

**Stack:** Vite, TypeScript and plain DOM, no UI framework. Core runs on the main thread. The engine package runs compiles in one Web Worker that it keeps across compiles (respawned after an abort or timeout); cancel and timeout abort the running compile (§3).

### Flow

1. **Engine load.** The engine (about 30 MB) loads with a progress bar. After that the normal HTTP cache applies; offline mode is deferred.
2. **Input.**
   - Drop or select `.ly` / `.ily` files or a whole folder (`webkitGetAsEntry`), so relative includes work.
   - The app shows the detected main files and lets the user change the selection.
   - Missing includes are listed with an explanation.
3. **Settings.**
   - Device dropdown, remembered in localStorage with try/catch.
   - Custom size (px × px at ppi).
   - Genre profile.
   - Note-size slider (relative to the profile default).
4. **Preview.**
   - The first page is rendered as PNG at the device's ppi, mapped to 16 grey levels, and shown in a frame with the device's proportions.
   - This relies on the engine's PNG output, which the spike verified (`docs/engine-findings.md`). If it fails, the fallback is rasterizing the PDF with pdf.js.
5. **Convert.**
   - Progress shows "2 of 5".
   - A cancel button and a 60 s timeout apply per main file.
   - One failed file doesn't stop the others.
6. **Download.**
   - One PDF directly, or a ZIP for several.
   - Per-device help on getting the PDF onto the reader: USB for Kobo, Send-to-Kindle caveats, PocketBook email, reMarkable app.

**Calibration PDF:** a page with a border, an mm ruler, a grid and edge markers, generated for the selected device. Users check how much of the page edge their reader really shows, and report safe-area values.

**Hosting:**
- GitHub Pages.
- The Vite `base` is configurable: `/lily-on-eink-app/` for the default Pages URL, `/` for a custom domain.

**About / Licenses page** shows:
- the GPL notice,
- the engine's third-party notices, copied from the package's `licenses/` directory rather than restated,
- a link to the corresponding source (§10).

## 8. Test corpus (`corpus/`)

Rules for the corpus:
- Each file must compile on the engine's LilyPond version. Files that do not compile unchanged are **converted once** with native `convert-ly` of the same version, as a developer tool. `SOURCES.md` records which applies per file.
- The original upstream version and the conversion are recorded in `corpus/SOURCES.md`.
- Every file must be at most about 2 pages on the reference device.

| Genre | File | Source | License |
|---|---|---|---|
| Organ | Reger, "Lobe den Herren", Op. 135a No. 15 | ranacrocando/lilypond-scores | CC0 (file header) |
| Organ | Bach, BWV 600 "Gott, durch deine Güte" | Mutopia | Public Domain (file header) |
| Piano | Bach, Menuet in G, BWV Anh. 114 | Mutopia | Public Domain (file header) |
| Piano | Czerny, Op. 821 No. 1 | Mutopia | Public Domain (file header) |
| Lead sheet | "Leise rieselt der Schnee" (multi-file include) | ranacrocando/kinder-wollen-singen | CC0 (repo LICENSE) |
| Lead sheet | "Alle Jahre wieder" (extra verses as markup) | ranacrocando/kinder-wollen-singen | CC0 (repo LICENSE) |
| Lead sheet | "Dona nobis pacem" (traditional; the owner's arrangement) | ranacrocando/lilypond-scores | CC0, dedicated by the owner; a CC0 header is added to the corpus copy |
| Bass tab | "Etüde in E-Moll für E-Bass" | own fixture | CC0 |
| Ukulele | "The Rattlin' Bog" | tleguern/Music | CC0 (repo LICENSE) |
| Ukulele | "Still, still, still" (relative `../../lib` include) | ukely/ukely | MIT (notice shipped alongside) |
| Accordion | accordion-register-symbols | LilyPond snippets (2.24 branch) | Public Domain (snippet header) |
| Accordion | "Greensleeves" (Stradella bass) | Mutopia | Public Domain (file header) |
| Accordion | own short piece with register symbols | own fixture | CC0 |

**Edge-case fixtures** (own, CC0):
- long title and long composer line,
- a markup title,
- top-level `\book` with its own `\paper`,
- `\book` containing `\bookpart`s,
- two `\book` blocks in one file (two outputs),
- multiple `\score` blocks,
- `\pageBreak` inside music and at top level between scores,
- `set-global-staff-size` in the file,
- `#(set-default-paper-size "a4" 'landscape)`,
- a score-level `\layout` with `line-width` and `indent`,
- `systems-per-page` in `\paper`,
- instrument names (the bass etude already has them),
- an include of a LilyPond built-in (`english.ly`),
- a missing include (negative test),
- a syntax error (negative test).

Licensing rules:
- No CC-BY-SA, GPL or unlicensed material.
- Check each file's header, not just website listings. Mutopia listings were found to disagree with file headers.

## 9. Testing

1. **Unit tests** (Vitest):
   - devices: mm derivation, custom specs, the ppi thickness threshold,
   - include graph and main-file detection,
   - diagnostics parsing,
   - path normalization,
   - generated wrapper text as snapshots.
2. **Compile tests:** every corpus file × every M1 preset × its matching profile, using `engine-wasm` in Node. Each run must pass these checks:
   - no LilyPond errors (negative fixtures expect specific diagnostics);
   - every PDF page size equals the device's full screen size within ±0.5 mm, because LilyPond rounds the page to whole points;
   - page count and output count are within the expected range per fixture (default ≤ 2 pages on the reference device);
   - **nothing outside the margins:** in the PNG render, the band between the page edge and the effective margin (base margin + safe area − 0.5 mm) is pure white;
   - no `textedit://` links in the PDF.
3. **Visual snapshots:**
   - A PNG per page at device ppi, **quantized to 16 greys** to keep the repo small, compared to committed reference images.
   - The output is expected to be bit-identical: the engine is pinned, and the Node version is pinned in `.nvmrc` and CI.
   - Comparison uses a near-zero per-pixel threshold plus a **cap on the number of differing pixels** (e.g. 0.01%), so a thinner staff line cannot pass unnoticed.
   - Runs on the reference device plus the ≤227 ppi device.
   - `npm run test:update` regenerates the references. Diff images are uploaded as a CI artifact when a run fails.
4. **Engine contract tests** (`packages/engine-wasm`, every CI run, a few seconds). We do not test LilyPond's engraving itself, only our assumptions about the engine:
   - the reported LilyPond version equals the expected version, which is recorded in `packages/engine-wasm/engine-version.json` and updated in the same PR as an engine bump;
   - PDF and PNG output are produced at a custom resolution;
   - point-and-click is disabled through `includeSettings`: no `textedit://` in the PDF;
   - the PDF page size equals the requested paper size;
   - `\include` resolves through virtual files and include paths;
   - errors come back with file and line number;
   - **known risk, pinned by a test:** `system()` runs a real shell in Node (no stub exists). If an engine update changes this, the test fails and we re-evaluate (§5.4);
   - an abort rejects with `AbortError`, and the same compiler works for the next compile.

   An engine version bump is its own PR. The contract tests show *which* assumption broke, and the visual snapshots show *what* changed in the layout.
5. **No native LilyPond in tests or CI.** All LilyPond tests run through the same WASM engine the app ships, installed by `npm ci`. Native LilyPond is only a developer tool, used to `convert-ly` corpus files (§8).
6. **Review page:** `npm run review` writes a static HTML contact sheet of all fixtures × devices, in e-ink greys, for human review of layout changes.
7. **App tests (M2):**
   - unit tests for UI logic;
   - a build check;
   - a Playwright smoke test: load the app, drop a fixture, convert, check the download;
   - a **browser/Node parity test**: in a real browser (Chromium), convert one corpus fixture to PNG and compare it with core's Node snapshot of the same fixture and device. A match confirms that the WASM engine behaves the same in the browser as in the Node tests, so the core test suite also holds for the app.

## 10. CI, governance, privacy, publishing

### CI (GitHub Actions, both repos)

Runs on every pull request and on pushes to `main`. Jobs, all of which are required checks:
1. lint (ESLint) and typecheck (`tsc`);
2. unit tests;
3. compile and visual tests (overlay repo);
4. build plus Playwright smoke (app repo, using the pinned core checkout from §3);
5. PR title check (conventional commits, see below).

CI deliberately stays lean: no privacy job and no PR-description checks (owner decision).

Infrastructure:
- The npm cache includes the engine package.
- The Node version is pinned.
- Visual snapshot jobs run in a Node container image pinned by digest, so the environment is identical on every run.

### Dependency updates (Dependabot, both repos)

`.github/dependabot.yml` covers two ecosystems:
- `npm` at the repo root (workspaces included),
- `github-actions`.

Settings:
- Schedule: **monthly**.
- Minor and patch updates are grouped into one PR per ecosystem.
- Major updates get separate PRs.
- `@sightread/lilypond-wasm` (core repo only) is in its own group and never grouped with other updates. An engine bump changes layouts and needs a deliberate snapshot review (§9). That PR also updates `engine-version.json`; the contract test fails until it does, by design.
- The app repo ignores `@sightread/lilypond-wasm` (see "Engine version consistency" in §3).

Known gaps, handled manually:
- In the app repo, Dependabot cannot resolve `file:../lily-on-eink/...` dependencies while repos are private. Its npm job may report errors until the switch to tarballs.
- Dependabot never bumps core in the app (§3).
- Dependabot does not update `.nvmrc` or `container:` image digests in workflows. These are bumped manually, at least when Dependabot's Node or Actions updates land.

Dependabot PRs go through the same CI and review rules as any other PR.

### Branch protection

A ruleset is committed as `.github/rulesets/main.json` and applied with `gh api` when the repo becomes public. Rulesets do not apply to private repos on a free plan. It enforces on `main`:
- changes only via pull requests,
- all required checks green,
- no force push, no deletion,
- linear history (squash merges).

**Approvals are not required**, because a single maintainer account cannot approve its own PRs. Until then the same discipline is followed by convention.

### Conventional commits

- All commits and **all PR titles** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`, `refactor:`, `perf:`, with an optional scope, and `!` for breaking changes.
- PRs are squash-merged, so the PR title becomes the commit on `main`.
- A required CI check validates the PR title (e.g. `amannn/action-semantic-pull-request`).
- Dependabot PRs use `chore(deps): …` (or `chore(deps-dev): …` for dev dependencies) for npm, and `ci(deps): …` for GitHub Actions. The title check allows any scope.

### Review policy

- Every change (code, docs, spec, CI, tests) is reviewed by an agent or person **other than its author** before merge.
- The review result is reported to the maintainer together with the merge request. It is not enforced by CI.

### Privacy

Owner decision: keep it simple, with no privacy machinery in CI.
- Commits are only ever authored as `ranacrocando` with the GitHub noreply address. This is set via a per-folder git identity on the maintainer's machine.
- A **local pre-push hook** (`scripts/privacy-check.mjs`) blocks a push if tracked files or commit metadata contain:
  - absolute local paths;
  - email addresses other than the noreply ones;
  - entries of an untracked local denylist (`.privacy-denylist`, git-ignored) with the maintainer's private data.
  - Allowlisted: `corpus/**` and `docs/**` (for paths and emails only), plus the license files.
- Test logs and snapshots must contain only relative paths.

### Going public checklist

1. A full-history privacy scan passes.
2. Corpus licenses, `SOURCES.md`, `REUSE.toml` and the MIT notices are re-verified.
3. **Corresponding source for the bundled engine** at the exact pinned version is available:
   - the `lilypond-wasm` build scripts and patches,
   - every upstream source tarball they reference (LilyPond, Guile, Cairo, Pango, FreeType, fonts, …),
   - these are mirrored as a release asset of the app repo and linked from the About page.

   This is required because the app conveys GPL object code.
4. Switch the repos to public, apply the rulesets, enable GitHub Pages for the app, and remove `CORE_REPO_TOKEN`.

## 11. Milestones

1. **M1, overlay and core.** Steps, in this order:
   1. **Engine verification spike:** done; results in `docs/engine-findings.md`.
   2. Re-verify the §4 LilyPond internals against that version.
   3. The `.ily` overlay with the three-point strategy, custom title markup and indent measurement.
   4. Three verified presets and all profiles.
   5. Core API, `engine-wasm`, the dev convert script.
   6. The full corpus with compile and visual tests, and CI.

   Done when every corpus file passes on every M1 preset and looks right on a real Kobo Sage.
2. **M2, web app:** the app per §7, the remaining presets, the calibration PDF, Playwright smoke, CI and the About/License page.
3. **M3, publish:**
   - run the going-public checklist;
   - switch the app's dependency to the core release tarballs (§3);
   - then decide on npm-registry publishing and the deferred features from §1.

**After the MVP (outside the milestone list), Phase 2:** the CLI issue and its implementation (§6).

## 12. Risks and open questions

| Risk | Mitigation |
|---|---|
| The hook strategy fails for exotic files (custom book handlers, heavy Scheme) | The corpus and edge fixtures catch regressions. Give a clear diagnostic and document the limits |
| LilyPond internals differ in the engine's version | M1 step 2 re-verifies them before overlay work |
| `lilypond-wasm` is maintained by a single person | Pinned version with integrity hash, `Engine` interface, mirrored sources |
| The engine's PNG output stops working after an engine update | Contract test. Fallback: pdf.js rasterization in the app, mupdf in tests |
| Safe-area values per device are unknown | Default 0; calibration PDF in M2; refined from user reports |
| Performance on phones and old laptops | Progress UI, cancel, Worker; measure in M2 |
| A user file needs `convert-ly` (2.18 or older) | Version warning with step-by-step guidance |
