import type {
  ImportJobProgressEvent,
  ImportJobSnapshot,
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

export const setImportJobReviewReturn = (
  reviewReturn: ImportJobUiState['reviewReturn'],
): void => {
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
