import { Notification, app } from 'electron';
import { autoUpdater } from 'electron-updater';

import type {
  AppUpdateCheckResult,
  AppUpdateStatus,
} from '../../commons/src/desktop/appUpdateTypes';
import { maybeCheckAuthorityUpdates, runAuthorityLifecyclePipeline } from './authorityLifecycle';
import { getLocalAuthorityAssetsDir } from './projectPrefs';
import { updateInstalledPlugins } from './plugins/pluginRegistry';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Auto-updates from GitHub releases (electron-updater reads the embedded
 * app-update.yml generated from the electron-builder `publish` config).
 * macOS updates via the zip target; the pkg is only the first install.
 *
 * We force allowPrerelease=false so the updater uses GitHub's /releases/latest
 * (the release marked Latest). If we leave the default (true whenever the
 * installed build itself is a prerelease), electron-updater treats the first
 * prerelease identifier as a "channel": `0.0.2-rc9` only accepts other `rc9`
 * tags, and skips `0.0.3-rc.11` (channel `rc`). That made Look for updates
 * report "up to date" forever across our dotted vs undotted RC tags.
 */
const configureAutoUpdater = (): void => {
  autoUpdater.allowPrerelease = false;
};

export interface InitAutoUpdaterOptions {
  /** Invoked after authority packs have been replaced in the background. */
  onAuthorityUpdated?: () => void;
  /** Invoked after one or more installed plugins were updated in the background. */
  onPluginsUpdated?: () => void;
  /** Invoked as an app update is found, downloads, and is ready to install. */
  onUpdateStatus?: (status: AppUpdateStatus) => void;
}

let lastUpdateStatus: AppUpdateStatus = { phase: 'idle' };

/** The latest update status, for a window that opened after the download started. */
export const getAppUpdateStatus = (): AppUpdateStatus => lastUpdateStatus;

let lastAuthorityNotifyKey = '';
let lastPluginNotifyKey = '';

/**
 * Background check for authority packs + plugins (same cadence as the app updater).
 * Installed authority packs and installed plugins both update themselves in
 * place; per-project enable state is keyed by id, so it survives. Auto-update
 * never *adds* a plugin the user has not installed. Both are silent on network
 * errors.
 */
export const checkCompanionUpdatesInBackground = async (
  options?: InitAutoUpdaterOptions,
): Promise<void> => {
  try {
    const folder = await getLocalAuthorityAssetsDir();
    const status = await maybeCheckAuthorityUpdates(folder, { force: true });
    if (status?.enabled && status.updateAvailable) {
      const result = await runAuthorityLifecyclePipeline({ entityDbFolder: folder });
      if (result.ok) {
        options?.onAuthorityUpdated?.();
        const notification = new Notification({
          title: 'Authority packs updated',
          body: 'New tagging and reference data is ready to use.',
        });
        notification.show();
      } else {
        const key =
          status.packBundleVersion ??
          status.rawSources.map((source) => `${source.id}:${source.version ?? ''}`).join('|') ??
          'authority-update';
        if (key !== lastAuthorityNotifyKey) {
          lastAuthorityNotifyKey = key;
          console.warn('[updater] authority pack update failed:', result.error ?? 'Unknown error');
        }
      }
    }
  } catch (error) {
    console.warn(
      '[updater] authority pack check failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const { updated, failed } = await updateInstalledPlugins();

    if (updated.length > 0) {
      options?.onPluginsUpdated?.();
      const notification = new Notification({
        title: updated.length === 1 ? 'Plugin updated' : 'Plugins updated',
        body:
          updated.length === 1
            ? `${updated[0].id} is now at ${updated[0].to}.`
            : `${updated.length} plugins were updated to their latest versions.`,
      });
      notification.show();
    }

    if (failed.length > 0) {
      const key = failed
        .map((entry) => entry.id)
        .sort()
        .join(',');
      if (key !== lastPluginNotifyKey) {
        lastPluginNotifyKey = key;
        console.warn(
          '[updater] plugin auto-update failed:',
          failed.map((entry) => `${entry.id}: ${entry.error}`).join('; '),
        );
      }
    } else {
      lastPluginNotifyKey = '';
    }
  } catch (error) {
    console.warn(
      '[updater] plugin auto-update check failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
};

const runScheduledChecks = (options?: InitAutoUpdaterOptions): void => {
  if (app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')) {
    void autoUpdater.checkForUpdatesAndNotify();
  }
  void checkCompanionUpdatesInBackground(options);
};

export const initAutoUpdater = (options?: InitAutoUpdaterOptions): (() => void) => {
  const supportsAppBinaryUpdates =
    app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');

  if (supportsAppBinaryUpdates) {
    configureAutoUpdater();
    const onError = (error: Error) => {
      console.warn('[updater] update check failed:', error.message);
    };
    const report = (status: AppUpdateStatus) => {
      lastUpdateStatus = status;
      options?.onUpdateStatus?.(status);
    };
    const onUpdateAvailable = (info: { version: string }) => {
      report({ phase: 'downloading', version: info.version, percent: 0 });
    };
    const onDownloadProgress = (progress: { percent: number }) => {
      if (lastUpdateStatus.phase !== 'downloading') return;
      report({
        phase: 'downloading',
        version: lastUpdateStatus.version,
        percent: Math.max(0, Math.min(100, progress.percent)),
      });
    };
    const onUpdateDownloaded = (info: { version: string }) => {
      console.log(`[updater] version ${info.version} downloaded; installs on quit`);
      report({ phase: 'ready', version: info.version });
    };
    const onUpdateError = () => {
      // A failed download leaves nothing to show; the next scheduled check tries again.
      if (lastUpdateStatus.phase === 'downloading') report({ phase: 'idle' });
    };
    autoUpdater.on('error', onError);
    autoUpdater.on('error', onUpdateError);
    autoUpdater.on('update-available', onUpdateAvailable);
    autoUpdater.on('download-progress', onDownloadProgress);
    autoUpdater.on('update-downloaded', onUpdateDownloaded);

    runScheduledChecks(options);
    const interval = setInterval(() => runScheduledChecks(options), CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      autoUpdater.removeListener('error', onError);
      autoUpdater.removeListener('error', onUpdateError);
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('download-progress', onDownloadProgress);
      autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
    };
  }

  // Dev / Linux: still poll packs + plugins on the same cadence.
  runScheduledChecks(options);
  const interval = setInterval(() => runScheduledChecks(options), CHECK_INTERVAL_MS);
  return () => clearInterval(interval);
};

/**
 * User-triggered check (menu action), separate from the silent background poll above.
 * Reuses the same autoUpdater singleton, so a found update still downloads in the
 * background and installs on quit via the 'update-downloaded' listener already registered.
 */
export const checkForAppUpdatesManually = async (): Promise<AppUpdateCheckResult> => {
  if (!app.isPackaged) return { status: 'unsupported' };
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    return { status: 'unsupported' };

  configureAutoUpdater();

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      return { status: 'current' };
    }
    return { status: 'updateAvailable', version: result.updateInfo.version };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

/** @internal test helper */
export const _resetCompanionNotifyStateForTests = (): void => {
  lastAuthorityNotifyKey = '';
  lastPluginNotifyKey = '';
};
