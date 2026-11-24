export type AppUpdateCheckResult =
  | { status: 'unsupported' }
  | { status: 'current' }
  | { status: 'updateAvailable'; version: string }
  | { status: 'error'; message: string };

/** Progress of the background download of an app update, pushed from the main process. */
export type AppUpdateStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string };
