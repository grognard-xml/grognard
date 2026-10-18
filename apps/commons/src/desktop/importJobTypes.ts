/** Shared types for durable background corpus-import jobs (main ↔ renderer). */

export type ImportJobKind = 'kanripo' | 'cbeta' | 'daozang';

export type ImportJobStatus =
  'queued' | 'running' | 'paused' | 'blocked' | 'completed' | 'cancelled';

export type ImportJuanState =
  'pending' | 'running' | 'done' | 'needs_attention' | 'failed' | 'skipped';

export interface ImportJuanCoverage {
  start: number;
  end: number;
  covered_chars: number;
  total_chars: number;
  ratio: number;
  empty: boolean;
}

export interface ImportJuanRecord {
  stem: string;
  /** Absolute path of the source .txt (Kanripo) or stable section id (CBETA/Daozang). */
  sourceKey: string;
  state: ImportJuanState;
  outputPath?: string;
  reason?: string;
  coverage?: ImportJuanCoverage;
  cost?: number;
  warnings?: { code: string; severity: 'info' | 'warning'; message: string }[];
}

export interface ImportJobParallelSource {
  id: string;
  label: string;
  text: string;
  kind?: string;
  url?: string;
  chapters?: { id: string; title: string; text: string }[];
}

export interface ImportJobAlignedParagraphMatch {
  ref_juan_id: string;
  ref_para_idx: number;
  source_file: string | null;
  source_para_idx: number | null;
  source_para_end_idx: number | null;
  score: number;
  match_type: string;
}

/** Snapshot of project config fields the main process needs to wrap TEI. */
export interface ImportJobProjectConfig {
  schema?: { catalogId?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ImportJobAiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  concurrency?: number;
}

export interface KanripoImportJobOptions {
  kind: 'kanripo';
  krId: string;
  title: string;
  projectRoot: string;
  destDir: string;
  importScope: 'work' | 'juan';
  juanInput?: string;
  normalize: 'off' | 'dpm';
  punctMode: 'as-is' | 'parallel' | 'ai';
  alignMode: 'tape' | 'segmented';
  sources: ImportJobParallelSource[];
  /** Pre-confirmed folder-reference alignment (dialog already asked the user). */
  alignedJuanSources?: Record<string, ImportJobParallelSource[]>;
  alignedMatches?: ImportJobAlignedParagraphMatch[];
  alignedSourcesPayload?: { id: string; label: string; text: string }[];
  projectConfig: ImportJobProjectConfig;
  gaijiOverrides?: Record<string, string>;
  aiSettings?: ImportJobAiSettings | null;
  /** USD cap; job blocks when actualCost reaches this. */
  spendCap?: number | null;
  /** Parallel juan when AI punctuating (default 1). */
  juanConcurrency?: number;
  /** Skip these stems (already written as trial juan 1). */
  skipStems?: string[];
  /** Estimated USD before start (UI only; also stored for the panel). */
  estimatedCost?: number | null;
}

export interface CbetaImportJobOptions {
  kind: 'cbeta';
  workId: string;
  title: string;
  projectRoot: string;
  destDir: string;
  projectConfig: ImportJobProjectConfig;
  cleanImport: boolean;
  stripLineBreaks: boolean;
  splitUnit: 'mulu' | 'juan';
  crossFamily: boolean;
}

export interface DaozangImportJobOptions {
  kind: 'daozang';
  workId: string;
  title: string;
  relPath: string;
  projectRoot: string;
  destDir: string;
  projectConfig: ImportJobProjectConfig;
}

export type ImportJobOptions =
  KanripoImportJobOptions | CbetaImportJobOptions | DaozangImportJobOptions;

export interface ImportJobSnapshot {
  jobId: string;
  kind: ImportJobKind;
  title: string;
  workId: string;
  status: ImportJobStatus;
  options: ImportJobOptions;
  juan: ImportJuanRecord[];
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  actualCost: number;
  blockReason?: string;
  /** Rolling average ms per finished juan (for ETA). */
  avgMsPerJuan?: number;
  finishedAt?: string;
  dismissed?: boolean;
}

export type ImportJobControlAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'accept' | 'dismiss';

export interface ImportJobControlRequest {
  jobId: string;
  action: ImportJobControlAction;
  stem?: string;
}

export interface ImportJobProgressEvent {
  jobs: ImportJobSnapshot[];
  activeJobId: string | null;
}
