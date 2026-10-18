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
  /** Tokens the AI used for this juan (AI punctuation only). */
  tokens?: { input: number; output: number };
  /** What the juan is doing right now, shown while it runs. */
  detail?: string;
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

/**
 * The project configuration a job needs to wrap TEI. Only the part the main process reads is
 * typed; the whole object is passed through, so the project's own config type is assignable.
 */
export interface ImportJobProjectConfig {
  schema?: { catalogId?: string };
}

export interface ImportJobAiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  concurrency?: number;
}

/** USD per million tokens, from the provider's price list; needed to turn token use into a cost. */
export interface ImportJobAiPricing {
  inputPerMillion: number;
  outputPerMillion: number;
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
  /** Used with token counts to work out the cost of an AI import; without it only tokens are counted. */
  aiPricing?: ImportJobAiPricing | null;
  /** USD cap; the job blocks when actualCost reaches it. Needs `aiPricing`. */
  spendCap?: number | null;
  /** Parallel juan when AI punctuating (default 1). */
  juanConcurrency?: number;
  /** Skip these stems. */
  skipStems?: string[];
  /** Pause after the first juan so it can be checked before the rest (the AI "trial"). */
  pauseAfterFirst?: boolean;
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
  actualTokens?: { input: number; output: number };
  blockReason?: string;
  /** Why the job is paused when it did not happen at the user's request. */
  pauseReason?: 'trial';
  /** The juan written as the trial (see `pauseAfterFirst`). */
  trialStem?: string;
  /** Rolling average ms per finished juan (for ETA). */
  avgMsPerJuan?: number;
  finishedAt?: string;
  dismissed?: boolean;
}

export type ImportJobControlAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'accept' | 'dismiss';

/** Sent with Resume: the app's current AI settings, since the API key is never saved with a job. */
export interface ImportJobResumeOptions {
  aiSettings?: ImportJobAiSettings | null;
}

export interface ImportJobControlRequest {
  jobId: string;
  action: ImportJobControlAction;
  stem?: string;
}

export interface ImportJobProgressEvent {
  jobs: ImportJobSnapshot[];
  activeJobId: string | null;
}
