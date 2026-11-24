/**
 * Progress of the background app-update download, shown in the BottomBar. The desktop app feeds
 * it from the updater's status events; it holds no knowledge of Electron.
 */
export interface AppUpdateProgress {
  active: boolean;
  /** 0-100 while downloading; null once the download is done. */
  percent: number | null;
  label: string;
  /** Longer explanation for the tooltip. */
  detail: string;
}

const IDLE: AppUpdateProgress = { active: false, percent: null, label: '', detail: '' };

let current: AppUpdateProgress = IDLE;
const listeners = new Set<() => void>();

export const getAppUpdateProgress = (): AppUpdateProgress => current;
export const subscribeAppUpdateProgress = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const setAppUpdateProgress = (next: AppUpdateProgress): void => {
  current = next;
  listeners.forEach((listener) => listener());
};
export const clearAppUpdateProgress = (): void => setAppUpdateProgress(IDLE);
