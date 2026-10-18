import type {
  ImportJobProgressEvent,
  ImportJobSnapshot,
  ImportJuanRecord,
  ImportJuanState,
} from '../../../../apps/commons/src/desktop/importJobTypes';

export interface ImportJobUiState {
  jobs: ImportJobSnapshot[];
  activeJobId: string | null;
  expanded: boolean;
  /** When set, the panel focuses the attention queue for this job. */
  focusAttentionJobId: string | null;
  /** Chip shown in the editor while reviewing a flagged juan. */
  reviewReturn: { jobId: string; remaining: number } | null;
}

let current: ImportJobUiState = {
  jobs: [],
  activeJobId: null,
  expanded: false,
  focusAttentionJobId: null,
  reviewReturn: null,
};

const listeners = new Set<() => void>();

export const getImportJobUiState = (): ImportJobUiState => current;
export const subscribeImportJobUiState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

export const applyImportJobProgress = (event: ImportJobProgressEvent): void => {
  current = {
    ...current,
    jobs: event.jobs.filter((job) => !job.dismissed),
    activeJobId: event.activeJobId,
  };
  notify();
};

export const setImportJobPanelExpanded = (expanded: boolean): void => {
  current = { ...current, expanded };
  notify();
};

export const focusImportJobAttention = (jobId: string | null): void => {
  current = {
    ...current,
    focusAttentionJobId: jobId,
    expanded: jobId ? true : current.expanded,
  };
  notify();
};

export const setImportJobReviewReturn = (reviewReturn: ImportJobUiState['reviewReturn']): void => {
  current = { ...current, reviewReturn };
  notify();
};

export const visibleImportJobs = (state: ImportJobUiState = current): ImportJobSnapshot[] =>
  state.jobs.filter((job) => {
    if (job.dismissed) return false;
    if (job.status === 'completed') {
      const attention = job.juan.some((j) => j.state === 'needs_attention');
      if (!attention && job.finishedAt) {
        const age = Date.now() - new Date(job.finishedAt).getTime();
        if (age > 24 * 60 * 60 * 1000) return false;
      }
    }
    return true;
  });

const FINISHED_STATES: ImportJuanState[] = ['done', 'needs_attention', 'failed', 'skipped'];

/** Juan finished (in any way) out of the total, and the fraction for a progress bar. */
export const jobProgress = (
  job: ImportJobSnapshot,
): { done: number; total: number; fraction: number } => {
  const total = job.juan.length;
  const done = job.juan.filter((j) => FINISHED_STATES.includes(j.state)).length;
  return { done, total, fraction: total > 0 ? done / total : 0 };
};

/**
 * What the AI trial juan cost and what the rest would, worked out from the tokens it really used.
 * `cost` is only known when prices were given; otherwise only tokens are reported.
 */
export const trialSummary = (
  job: ImportJobSnapshot,
): {
  stem: string;
  tokens: number;
  cost: number | null;
  remaining: number;
  remainingTokens: number;
  remainingCost: number | null;
} | null => {
  if (job.pauseReason !== 'trial' || !job.trialStem) return null;
  const trial = job.juan.find((j) => j.stem === job.trialStem);
  const tokens = trial?.tokens ? trial.tokens.input + trial.tokens.output : 0;
  const remaining = job.juan.filter((j) => j.state === 'pending').length;
  const cost = trial?.cost != null && trial.cost > 0 ? trial.cost : null;
  return {
    stem: job.trialStem,
    tokens,
    cost,
    remaining,
    remainingTokens: tokens * remaining,
    remainingCost: cost != null ? cost * remaining : null,
  };
};

export interface JobFileChanges {
  /** Files written for the first time (or again after a retry): header entities are created. */
  written: string[];
  /** Files written again after having been written before: an open editor must reload them. */
  rewritten: string[];
}

/** Which output files appeared between two states of the job list. */
export const newlyWrittenFiles = (
  before: ImportJobSnapshot[],
  after: ImportJobSnapshot[],
): JobFileChanges => {
  const written: string[] = [];
  const rewritten: string[] = [];
  for (const job of after) {
    const previous = before.find((j) => j.jobId === job.jobId);
    for (const juan of job.juan) {
      if (!juan.outputPath) continue;
      if (juan.state !== 'done' && juan.state !== 'needs_attention') continue;
      const was = previous?.juan.find(
        (j) => j.stem === juan.stem && j.sourceKey === juan.sourceKey,
      );
      if (was && (was.state === 'done' || was.state === 'needs_attention')) continue;
      if (was?.outputPath) rewritten.push(juan.outputPath);
      else written.push(juan.outputPath);
    }
  }
  return { written, rewritten };
};

export interface JuanListView {
  shown: ImportJuanRecord[];
  hiddenDone: number;
  hiddenOther: number;
}

/**
 * The juan worth listing: those running, flagged or failed first, then the ones waiting. The
 * finished ones are only counted, so a job with a thousand sections stays a short list.
 */
export const visibleJuan = (job: ImportJobSnapshot, showAll: boolean, limit = 30): JuanListView => {
  if (showAll) return { shown: job.juan, hiddenDone: 0, hiddenOther: 0 };
  const rank = (j: ImportJuanRecord) =>
    j.state === 'running' ? 0 : j.state === 'needs_attention' || j.state === 'failed' ? 1 : 2;
  const candidates = job.juan.filter((j) => j.state !== 'done' && j.state !== 'skipped');
  const shown = candidates
    .map((juan, index) => ({ juan, index }))
    .sort((a, b) => rank(a.juan) - rank(b.juan) || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.juan);
  return {
    shown,
    hiddenDone: job.juan.length - candidates.length,
    hiddenOther: candidates.length - shown.length,
  };
};
