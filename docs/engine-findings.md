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
| Errors | Rejects with `LilyPondCompileError` (`exitCode`, `logs`). Logs contain `file:line:col` | The diagnostics parser works on the joined logs |
| `system()` in Node | **Runs a real shell.** `(system "exit 7")` → 1792 (= 7 << 8) | Node use is for trusted files only. Not an issue in browsers |
| Cancel | Aborting via `AbortSignal` rejects with `AbortError` after about 0.5 s. **The same reusable compiler keeps working afterwards** | No need to recreate the compiler ourselves |
| Speed | Earlier spike: preload 2.2 s, first compile 6.1 s, later compiles 2.8 s (Reger, 2 pages) | |
