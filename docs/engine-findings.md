# Engine findings: `@sightread/lilypond-wasm` 0.2.0

Probed on 2026-11-09 in Node 22, in an offline container (no network, 2 CPUs).

| Topic | Finding | Consequence |
|---|---|---|
| LilyPond version | `2.26.0`, from `(lilypond-version)` | Wrapper `\version "2.26.0"`. `engine-version.json` = `2.26.0` |
| Formats | `pdf` and `png` together in one call work. `resolution` sets the PNG dpi | Preview and snapshots need no PDF rasterizer |
| Custom paper | `paper-alist` entry 122×163 mm → PDF MediaBox `346×463` pt (122.06×163.3 mm). PNG at 300 dpi: 1442×1929 px | LilyPond rounds the page to whole points. Tests allow ±0.5 mm |
| Point-and-click | No `textedit://` in the PDF by default. `#(ly:set-option 'point-and-click #f)` via `includeSettings` works too | Always set it explicitly through the settings file. The engine has **no free-form CLI options**, so every `-d` option goes through `includeSettings` |
| Output names | Always `score.*`. Several `\book`s → `score.pdf`, `score-1.pdf`, … (the first has no suffix). Several PNG pages → `score-page1.png`, `score-page2.png`, … | Mapping to `bookIndex`: unsuffixed = 0, `-N` = N |
| `\include` | Works via the `files` map (relative keys such as `sub/inc.ily`) | |
| Multi-book multi-page PNG | Two `\book`s, each over several pages, PNG only → `score-page1.png`, `score-page2.png`, … for the first book and `score-1-page1.png`, `score-1-page2.png`, … for the second. Nothing else is written | PNG name pattern: `score(-N)?(-pageM)?.png`; no `-N` = book 0, no `-pageM` = single page. Pinned by contract test 6 |
| Include resolution | With `filename: 'a/x.ly'` (source not in `files`), `\include "b.ily"` finds `a/b.ily` and `\include "../c.ily"` finds root `c.ily`. `\include "c.ily"` from `a/x.ly` does **not** find root `c.ily`: ``a/x.ly:1:10: error: cannot find file: `c.ily'``, although the printed search path lists `/input/a:/input:…` | Only the including file's directory (and `includePaths`) is searched, never the project root. `analyzeProject` must resolve relative to the including file only. Pinned by contract test 7 |
| `system()` on Windows | Contract test 9 also passes on Windows Node: `(system "exit 7")` → `SYSTEMRET=1792` | Same Node shell risk on every OS |
| Errors | Rejects with `LilyPondCompileError` (`exitCode`, `logs`). Logs contain `file:line:col` | The diagnostics parser works on the joined logs |
| `system()` in Node | **Runs a real shell.** `(system "exit 7")` → 1792 (= 7 << 8) | Node use is for trusted files only. Not an issue in browsers |
| Cancel | Aborting via `AbortSignal` rejects with `AbortError` after about 0.5 s. **The same reusable compiler keeps working afterwards** | No need to recreate the compiler ourselves |
| Speed | Earlier spike: preload 2.2 s, first compile 6.1 s, later compiles 2.8 s (Reger, 2 pages) | |
| Title markups: `line-width` | Probed 2026-11-09: in `bookTitleMarkup` and `oddFooterMarkup`, `(chain-assoc-get 'line-width props)` is set and equals `(ly:output-def-lookup layout 'line-width)`, e.g. 75.6 staff spaces for Kobo Sage with the organ profile | The overlay's title command reads the props and falls back to `layout` |
| Title markups: stacking | `\column` places each item at the larger of `baseline-skip` (origin to origin) and touching extents (padding 0) | A wrapped field's origin is put on its last line, so the next field follows it at the normal `baseline-skip` |
| Title markups: precedence | A `bookTitleMarkup` set in the wrapper's `\paper` block, which follows the user's `\include`, beats one from the user's top-level `\paper` (pinned by a corpus test) | Title and footer overrides live in that block, not in the overlay |
| Top-level text handlers | Probed 2026-11-10: `toplevel-text-handler` (1 arg), `book-text-handler` and `bookpart-text-handler` (book, text) always receive a **markup list**; a `\markup` arrives as a list of one. Markup props carry `line-width` | The overlay wraps the three handlers and passes the text on inside its markup list command |
| Book printing | A `\book` is printed by `toplevel-book-handler` as soon as it is read. The implicit book of a file without `\book` (with top-level `\bookpart`s as its parts) goes through the same handler at the end of the file. Every book and book part has an output def from `ly:book-paper` there | A wrapper `\paper` after the include never reaches an explicit `\book`; the overlay's book handler applies the device settings instead |
| Paper units | In a paper output def, `mm` = 1.0 and `pt` = 0.3515: lengths are in mm. `layout-set-absolute-staff-size-in-module` changes `staff-height` and `output-scale`, not `mm` | Device lengths are written in mm (times the paper's `mm`) |
