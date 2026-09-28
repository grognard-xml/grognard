/** Global progress for a background AI suggest or audit run. */
export interface AiRunProgress {
  active: boolean;
  cancel: (() => void) | null;
  done: number;
  total: number;
  label: string;
}

let state: AiRunProgress = { active: false, cancel: null, done: 0, total: 0, label: '' };
const listeners = new Set<() => void>();

const emit = (next: Partial<AiRunProgress>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export const getAiRunProgress = (): AiRunProgress => state;
export const subscribeAiRunProgress = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
// A long, unattended AI run left the system free to sleep can crash the
// editor when it wakes (Chromium suspends the renderer's timers/network
// activity, and TinyMCE's undo-manager internals aren't robust to resuming
// after that — a null-dereference crash with no partial write ever having
// happened, not something fixable from here). Held for exactly this run's
// duration; no-op outside the desktop app.
export const startAiRunProgress = (label: string, cancel: () => void) => {
  emit({ active: true, cancel, done: 0, total: 0, label });
  void window.electronAPI?.startAiRunPowerSaveBlocker?.();
};
export const updateAiRunProgress = (done: number, total: number) => emit({ done, total });
export const finishAiRunProgress = () => {
  emit({ active: false, cancel: null, done: 0, total: 0, label: '' });
  void window.electronAPI?.stopAiRunPowerSaveBlocker?.();
};
