import { getDevice, pageSizeMm, type DeviceSpec } from './devices.js';
import { normalizeLog, parseDiagnostics, type Diagnostic } from './diagnostics.js';
import type { Engine, EngineFormat, EngineRequest, EngineResult } from './engine.js';
import { groupOutputs, outputFileName } from './outputs.js';
import { effectiveMarginsMm, effectiveStaffSize, getProfile } from './profiles.js';
import { analyzeProject, findIncludes, resolveInclude } from './project.js';
import { buildWrapper } from './wrapper.js';

/** A project file. `path` is relative and POSIX-style, e.g. `songs/a.ly`. */
export interface ProjectFile {
  path: string;
  content: Uint8Array | string;
}

export interface Progress {
  mainFile: string;
  index: number;
  total: number;
  phase: 'queued' | 'compiling' | 'rendering' | 'done' | 'failed';
}

export interface ConvertOptions {
  /** Preset id or custom spec. */
  device: string | DeviceSpec;
  /** Default 'generic'. */
  profile?: string;
  /** Overrides profile staff size plus device adjustment. */
  staffSize?: number;
  /** Default true. */
  keepTagline?: boolean;
  /** Default ['pdf']. PNG pages are rendered at the device ppi. */
  outputs?: EngineFormat[];
  /** Overrides main-file detection. */
  mainFiles?: string[];
  signal?: AbortSignal;
  /** Per main file. Default 60000. */
  timeoutMs?: number;
  onProgress?: (p: Progress) => void;
}

/** One entry per produced document. */
export interface ConvertOutput {
  mainFile: string;
  /** 0 unless the file has several `\book` blocks. */
  bookIndex: number;
  pdf?: Uint8Array;
  pngPages?: Uint8Array[];
  /** FAT32-safe "<title or basename>[ (n)] – <device name>.pdf". */
  fileName: string;
}

export interface ConvertResult {
  outputs: ConvertOutput[];
  /** Diagnostics without a known position use line 0 and column 0. */
  diagnostics: Diagnostic[];
  /** Per main file, paths normalized. */
  logs: Record<string, string>;
}

const WRAPPER_NAME = 'lily-on-eink-wrapper.ly';
const DEFAULT_TIMEOUT_MS = 60_000;

const isSource = (path: string) => /\.(ly|ily)$/i.test(path);
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const inDir = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function textOf(content: Uint8Array | string): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function error(file: string, message: string, line = 0): Diagnostic {
  return { file, line, column: 0, severity: 'error', message };
}

/** Line (1-based) of `\include "target"` in source, or 0 if not found. */
function includeLine(source: string, target: string): number {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(String.raw`\\include\s*"${escaped}"`).exec(source);
  return m ? source.slice(0, m.index).split('\n').length : 0;
}

/** Reads a LilyPond string literal starting at the opening quote; returns [value, indexAfter]. */
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

const HEADER = /\\header\s*\{/y;
const TITLE = /title\s*=\s*"/y;

/** The first plain-string `title = "…"` directly inside a top-level `\header` block. */
function findTitle(source: string): string | undefined {
  let depth = 0;
  let headerDepth = -1;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === '%') {
      const block = source[i + 1] === '{';
      const end = block ? source.indexOf('%}', i + 2) : source.indexOf('\n', i);
      i = end === -1 ? source.length : block ? end + 2 : end;
    } else if (c === '"') {
      i = readString(source, i)[1];
    } else if (c === '{') {
      depth += 1;
      i += 1;
    } else if (c === '}') {
      if (depth === headerDepth) headerDepth = -1;
      depth -= 1;
      i += 1;
    } else if (c === '\\' && depth === 0) {
      HEADER.lastIndex = i;
      const m = HEADER.exec(source);
      if (m) {
        depth += 1;
        headerDepth = depth;
        i += m[0].length;
      } else i += 2;
    } else if (headerDepth === depth && depth > 0 && !/[\w\-\\]/.test(source[i - 1] ?? ' ')) {
      TITLE.lastIndex = i;
      const m = TITLE.exec(source);
      if (m) return readString(source, i + m[0].length - 1)[0];
      i += 1;
    } else {
      i += 1;
    }
  }
  return undefined;
}

/** All files a main file reaches through includes, including itself. */
function reachable(main: string, texts: Record<string, string>): Set<string> {
  const seen = new Set<string>();
  const stack = [main];
  while (stack.length) {
    const path = stack.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const text = texts[path];
    if (text === undefined || !isSource(path)) continue;
    for (const target of findIncludes(text)) {
      const resolved = resolveInclude(path, target);
      if (resolved !== undefined && resolved in texts) stack.push(resolved);
    }
  }
  return seen;
}

/** Converts a LilyPond project to e-reader-sized documents, one engine call per main file. */
export async function convert(files: ProjectFile[], options: ConvertOptions, engine: Engine): Promise<ConvertResult> {
  const device = getDevice(options.device);
  const profile = getProfile(options.profile ?? 'generic');
  const formats = options.outputs ?? ['pdf'];
  const outputs: ConvertOutput[] = [];
  const diagnostics: Diagnostic[] = [];
  const logs: Record<string, string> = {};

  const texts: Record<string, string> = {};
  const engineFiles: Record<string, string | Uint8Array> = {};
  for (const f of files) {
    texts[f.path] = isSource(f.path) ? textOf(f.content) : '';
    engineFiles[f.path] = f.content;
  }

  const analysis = analyzeProject(texts);
  for (const { from, target } of analysis.missingIncludes) {
    diagnostics.push(error(from, `cannot find included file "${target}"`, includeLine(texts[from]!, target)));
  }
  const brokenFiles = new Set(analysis.missingIncludes.map((m) => m.from));

  const mainFiles: string[] = [];
  for (const main of options.mainFiles ?? analysis.mainFiles) {
    if (!(main in texts)) diagnostics.push(error(main, 'main file is not part of the project'));
    else if (![...reachable(main, texts)].some((p) => brokenFiles.has(p))) mainFiles.push(main);
  }

  const wrapperOptions = {
    pageMm: pageSizeMm(device),
    marginsMm: effectiveMarginsMm(profile, device),
    staffSize: effectiveStaffSize(profile, device, options.staffSize),
    keepTagline: options.keepTagline ?? true,
    lilypondVersion: await engine.lilypondVersion(),
  };

  let progressFailed = false;
  for (const [index, mainFile] of mainFiles.entries()) {
    if (options.signal?.aborted) {
      diagnostics.push(error(mainFile, 'conversion aborted'));
      break;
    }
    const progress = (phase: Progress['phase']) => {
      try {
        options.onProgress?.({ mainFile, index, total: mainFiles.length, phase });
      } catch (e) {
        if (progressFailed) return;
        progressFailed = true;
        const message = `onProgress callback failed: ${e instanceof Error ? e.message : String(e)}`;
        diagnostics.push({ file: mainFile, line: 0, column: 0, severity: 'warning', message });
      }
    };
    progress('compiling');
    const dir = dirOf(mainFile);
    const wrapper = buildWrapper({ ...wrapperOptions, mainBasename: baseOf(mainFile) });
    const overlayPath = inDir(dir, wrapper.overlay.name);
    if (overlayPath in engineFiles) {
      diagnostics.push({
        file: overlayPath,
        line: 0,
        column: 0,
        severity: 'warning',
        message: 'project file replaced by the lily-on-eink overlay of the same name',
      });
    }
    const req: EngineRequest = {
      source: wrapper.source,
      filename: inDir(dir, WRAPPER_NAME),
      files: { ...engineFiles, [overlayPath]: wrapper.overlay.content },
      formats,
      resolution: device.ppi,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    if (options.signal) req.signal = options.signal;

    let result: EngineResult;
    try {
      result = await engine.compile(req);
    } catch (e) {
      diagnostics.push(error(mainFile, `engine error: ${e instanceof Error ? e.message : String(e)}`));
      progress('failed');
      continue;
    }

    const log = normalizeLog(result.log);
    logs[mainFile] = log;
    diagnostics.push(...parseDiagnostics(log));
    if (!result.ok) {
      diagnostics.push(
        error(mainFile, result.aborted ? 'conversion aborted or timed out' : `LilyPond failed (exit code ${result.exitCode})`),
      );
      progress('failed');
      continue;
    }

    const grouped = groupOutputs(result.files);
    for (const name of grouped.unrecognized) {
      diagnostics.push({ file: mainFile, line: 0, column: 0, severity: 'warning', message: `ignored unexpected engine output "${name}"` });
    }
    const title = findTitle(texts[mainFile]!);
    for (const book of grouped.books) {
      const out: ConvertOutput = {
        mainFile,
        bookIndex: book.bookIndex,
        fileName: outputFileName(title, baseOf(mainFile), device.name, book.bookIndex),
      };
      if (book.pdf) out.pdf = book.pdf;
      if (book.pngPages.length) out.pngPages = book.pngPages;
      outputs.push(out);
    }
    progress('done');
  }

  return { outputs, diagnostics, logs };
}
