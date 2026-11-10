import { createReusableCompiler, LilyPondCompileError } from '@sightread/lilypond-wasm';
import type { CompileResult, ReusableCompiler } from '@sightread/lilypond-wasm';
import type { Engine, EnginePreloadOptions, EngineRequest, EngineResult } from '@lily-on-eink/core';

// Reserved, namespaced name: it overrides a project file of the same name.
const SETTINGS_FILE = 'lily-on-eink-settings.ly';
const SETTINGS = String.raw`#(ly:set-option 'point-and-click #f)`;
const VERSION_SOURCE = String.raw`#(ly:message (string-append "LYVERSION=" (lilypond-version)))`;

/** True for errors that mean the compiler itself is gone, not that the score failed. */
function isCompilerUnusable(error: unknown): boolean {
  return error instanceof Error && /disposed|unusable/i.test(error.message);
}

/** Creates an engine backed by LilyPond compiled to WebAssembly. */
export function createWasmEngine(): Engine {
  let compiler: ReusableCompiler | undefined;
  let disposed = false;
  let version: Promise<string> | undefined;

  const assertUsable = () => {
    if (disposed) throw new Error('engine disposed');
  };

  const run = async (source: string, options: Parameters<ReusableCompiler['compile']>[1]): Promise<CompileResult> => {
    compiler ??= createReusableCompiler();
    try {
      return await compiler.compile(source, options);
    } catch (error) {
      if (disposed || !isCompilerUnusable(error)) throw error;
      // Recover once: a fresh compiler, then retry this compile.
      compiler.dispose();
      compiler = createReusableCompiler();
      return await compiler.compile(source, options);
    }
  };

  const compile = async (req: EngineRequest): Promise<EngineResult> => {
    assertUsable();
    const signals = [req.signal, req.timeoutMs !== undefined ? AbortSignal.timeout(req.timeoutMs) : undefined].filter(
      (s): s is AbortSignal => s !== undefined,
    );
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    try {
      const result = await run(req.source, {
        filename: req.filename,
        files: { ...req.files, [SETTINGS_FILE]: SETTINGS },
        includeSettings: SETTINGS_FILE,
        includePaths: req.includePaths,
        format: req.formats,
        resolution: req.resolution,
        signal,
      });
      return { ok: true, exitCode: 0, files: { ...result.files }, log: result.logs.join('\n') };
    } catch (error) {
      if (signal?.aborted) return { ok: false, exitCode: -1, aborted: true, files: {}, log: '' };
      if (error instanceof LilyPondCompileError) {
        return { ok: false, exitCode: error.exitCode, files: {}, log: error.logs.join('\n') };
      }
      throw error;
    }
  };

  return {
    preload(options?: EnginePreloadOptions) {
      try {
        assertUsable();
      } catch (error) {
        return Promise.reject(error);
      }
      compiler ??= createReusableCompiler();
      return compiler.preload(options);
    },
    lilypondVersion() {
      try {
        assertUsable();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      version ??= (async () => {
        const result = await compile({
          source: VERSION_SOURCE,
          filename: 'version.ly',
          files: {},
          formats: ['pdf'],
        });
        const match = /LYVERSION=(\d+\.\d+\.\d+)/.exec(result.log);
        if (!match?.[1]) throw new Error(`cannot read LilyPond version from log:\n${result.log}`);
        return match[1];
      })();
      version.catch(() => {
        version = undefined;
      });
      return version;
    },
    compile,
    dispose() {
      disposed = true;
      compiler?.dispose();
      compiler = undefined;
    },
  };
}
