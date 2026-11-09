/** Output formats an engine can produce. */
export type EngineFormat = 'pdf' | 'png';

export interface EngineRequest {
  /** Wrapper source. */
  source: string;
  /** POSIX relative path without '.' segments, e.g. 'a/lily-on-eink-wrapper.ly'. */
  filename: string;
  /** Extra files visible to `\include`, keyed by POSIX relative path. */
  files: Record<string, string | Uint8Array>;
  /** Non-empty relative directories only. */
  includePaths?: string[];
  formats: EngineFormat[];
  /** PNG dots per inch. */
  resolution?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EngineResult {
  ok: boolean;
  exitCode: number;
  files: Record<string, Uint8Array>;
  log: string;
  aborted?: boolean;
}

export interface Engine {
  lilypondVersion(): Promise<string>;
  compile(req: EngineRequest): Promise<EngineResult>;
  dispose(): void;
}
