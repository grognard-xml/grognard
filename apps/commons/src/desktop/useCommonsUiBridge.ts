import { useActions, useAppState } from '@src/overmind';
import { registerLeafWriterCommonsI18n } from '@src/desktop/registerLeafWriterCommonsI18n';
import {
  isDesktop,
  type AiApiSettings,
  type EntityDbBackupConfig,
  type EntityDbBackupConfigView,
  type EntityDbBackupProbeResult,
  type EntityDbBackupResult,
  type EntityDbBackupStatus,
  type EntityDbCloudSnapshot,
  type EntityDbRestoreResult,
  type EntitySyncConfig,
  type EntitySyncConfigPatch,
  type EntitySyncConflict,
  type EntitySyncRunSummary,
  type EntitySyncStatus,
  type LanguageToolSettings,
} from '@src/types/desktop';
import { clearAchievementsCache } from '@src/desktop/achievements/store';
import type {
  AuthorityLifecycleRunResult,
  AuthorityLifecycleSetEnabledOptions,
  AuthorityLifecycleStatus,
} from '@src/desktop/authorityLifecycleTypes';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createEntitiesScaffold } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { refreshCbdbConcordanceAfterPackLifecycle } from '../../../../packages/cwrc-leafwriter/src/autoTagging/cbdbConcordance';
import { clearPackContentCache } from '../../../../packages/cwrc-leafwriter/src/services/authority-pack-lookup';
import { PROJECT_FILE_NAME, LEGACY_PROJECT_FILE_NAME } from '@src/desktop/projectFile';
import { ensureEntityDbFolder } from './entityDbOnboarding';
import { refreshPluginsInRenderer } from './ensureLanguagePlugins';

const afterAuthorityPackLifecycleSuccess = async (): Promise<void> => {
  clearPackContentCache();
  // PEDB only — matches Database panel reload. Failures are non-fatal; reload is the safety net.
  try {
    await refreshCbdbConcordanceAfterPackLifecycle();
  } catch {
    // Pack install already succeeded; concordance can wait for panel reload.
  }
};

export const useCommonsUiBridge = () => {
  const { t } = useTranslation();
  const { skipEntityDetachConfirm, skipExplorerDeleteConfirm, themeAppearance, currentLocale } =
    useAppState().ui;
  const {
    setSkipEntityDetachConfirm,
    setSkipExplorerDeleteConfirm,
    setThemeAppearance,
    switchLanguage,
  } = useActions().ui;
  const [encoderName, setEncoderNameState] = useState('');
  const [encoderNameLoaded, setEncoderNameLoaded] = useState(false);
  const [aiApiSettings, setAiApiSettingsState] = useState<AiApiSettings | null>(null);
  const [languageToolSettings, setLanguageToolSettingsState] =
    useState<LanguageToolSettings | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [entityDbFolder, setEntityDbFolderState] = useState<string | null>(null);
  const [rememberWorkspaceOnStartup, setRememberWorkspaceOnStartupState] = useState(true);
  const [authorityLifecycleStatus, setAuthorityLifecycleStatusState] =
    useState<AuthorityLifecycleStatus | null>(null);
  const [entityDbBackupStatus, setEntityDbBackupStatusState] =
    useState<EntityDbBackupStatus | null>(null);
  const [entitySyncStatus, setEntitySyncStatusState] = useState<EntitySyncStatus | null>(null);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getEncoderName) return;

    void window.electronAPI.getEncoderName().then((name) => {
      setEncoderNameState(name ?? '');
      setEncoderNameLoaded(true);
    });
  }, []);

  useEffect(() => {
    const syncInheritedEncoderName = (event: Event) => {
      const name = (event as CustomEvent<string>).detail?.trim();
      if (name) setEncoderNameState(name);
    };
    window.addEventListener('grognardEncoderNameInherited', syncInheritedEncoderName);
    return () =>
      window.removeEventListener('grognardEncoderNameInherited', syncInheritedEncoderName);
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getAiApiSettings) return;

    void window.electronAPI.getAiApiSettings().then((settings) => {
      setAiApiSettingsState(settings);
    });
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.entityDbBackupGetStatus) return;
    void window.electronAPI
      .entityDbBackupGetStatus()
      .then(setEntityDbBackupStatusState)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.entitySyncGetStatus) return;
    void window.electronAPI
      .entitySyncGetStatus()
      .then(setEntitySyncStatusState)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getLanguageToolSettings) return;

    void window.electronAPI.getLanguageToolSettings().then((settings) => {
      setLanguageToolSettingsState(settings);
    });
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getCachedLeaderboardToken) return;

    void window.electronAPI.getCachedLeaderboardToken().then((token) => {
      setGithubConnected(Boolean(token));
    });
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getEntityDbFolder) return;

    void window.electronAPI
      .getEntityDbFolder()
      .then(async (folder) => {
        setEntityDbFolderState(typeof folder === 'string' && folder.trim() ? folder : null);
        // Default folder is only mkdir'd by main; scaffold entities.xml so a
        // brand-new install is ready without an explicit "choose folder" step.
        await ensureEntityDbFolder();
        const refreshed = await window.electronAPI?.getEntityDbFolder?.();
        if (typeof refreshed === 'string' && refreshed.trim()) {
          setEntityDbFolderState(refreshed);
        }
      })
      .catch((error) => {
        console.error('Failed to load entity database folder:', error);
      });
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.getRememberWorkspaceOnStartup) return;

    void window.electronAPI.getRememberWorkspaceOnStartup().then((remember) => {
      if (typeof remember === 'boolean') setRememberWorkspaceOnStartupState(remember);
    });
  }, []);

  const refreshAuthorityLifecycle = useCallback(async () => {
    if (!window.electronAPI?.authorityLifecycleGet) return;
    const next = await window.electronAPI.authorityLifecycleGet();
    setAuthorityLifecycleStatusState(next);
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.authorityLifecycleGet) return;
    void refreshAuthorityLifecycle();
  }, [entityDbFolder, refreshAuthorityLifecycle]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.authorityLifecycleMaybeCheckUpdates) return;
    void window.electronAPI.authorityLifecycleMaybeCheckUpdates().then((status) => {
      if (status) setAuthorityLifecycleStatusState(status);
    });
  }, [entityDbFolder]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!isDesktop() || !api?.onAuthorityLifecycleUpdated) return;
    return api.onAuthorityLifecycleUpdated(() => {
      void afterAuthorityPackLifecycleSuccess();
      void refreshAuthorityLifecycle();
    });
  }, [refreshAuthorityLifecycle]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!isDesktop() || !api?.onPluginsUpdated) return;
    // Background updater swapped an installed plugin on disk. Re-read the
    // snapshot so manifest-derived contributions (authority pack specs, tools
    // menu, auto-tagging producers) reflect the new version immediately. An
    // already-loaded plugin's JS entry module is not hot-swapped mid-session;
    // it picks up the new code on next app start.
    return api.onPluginsUpdated(() => {
      void refreshPluginsInRenderer();
    });
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;

    const syncThemeFromStorage = () => {
      const stored = localStorage.getItem('themeAppearance');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        if (stored !== themeAppearance) setThemeAppearance(stored);
      }
    };

    const syncLanguageFromStorage = () => {
      const stored = localStorage.getItem('i18nextLng');
      if (stored && stored !== currentLocale) switchLanguage(stored as typeof currentLocale);
    };

    window.addEventListener('changeTheme', syncThemeFromStorage);
    window.addEventListener('changeLanguage', syncLanguageFromStorage);
    return () => {
      window.removeEventListener('changeTheme', syncThemeFromStorage);
      window.removeEventListener('changeLanguage', syncLanguageFromStorage);
    };
  }, [currentLocale, setThemeAppearance, switchLanguage, themeAppearance]);

  useEffect(() => {
    if (!isDesktop()) return;
    void window.electronAPI?.setAppLocale?.(currentLocale);
  }, [currentLocale]);

  const setEncoderName = useCallback(async (name: string) => {
    const trimmed = name.trim();
    setEncoderNameState(trimmed);
    await window.electronAPI?.setEncoderName?.(trimmed);
  }, []);

  const setAiApiSettings = useCallback(
    async (settings: Partial<AiApiSettings>) => {
      const next = {
        ...(aiApiSettings ?? {
          apiKey: '',
          baseUrl: 'http://localhost:1234/v1',
          customInstructions: '',
          model: '',
          temperature: 0.1,
          streamResults: true,
          placeholderRetryLimit: 1,
          alwaysOn: false,
          verifiedAt: null,
          verifiedBaseUrl: '',
          verifiedModel: '',
        }),
        ...settings,
      };
      setAiApiSettingsState(next);
      await window.electronAPI?.setAiApiSettings?.(next);
    },
    [aiApiSettings],
  );

  const testAiConnection = useCallback(async (settings: Partial<AiApiSettings>) => {
    return (
      (await window.electronAPI?.testAiConnection?.(settings)) ?? {
        ok: false,
        error: 'Desktop AI API bridge is unavailable.',
      }
    );
  }, []);

  const refreshEntityDbBackupStatus = useCallback(async () => {
    if (!window.electronAPI?.entityDbBackupGetStatus) return;
    try {
      setEntityDbBackupStatusState(await window.electronAPI.entityDbBackupGetStatus());
    } catch {
      // Leave the last-known status in place; the panel shows its own errors.
    }
  }, []);

  const setEntityDbBackupConfig = useCallback(
    async (patch: Partial<EntityDbBackupConfig>): Promise<EntityDbBackupConfigView | null> => {
      if (!window.electronAPI?.entityDbBackupSetConfig) return null;
      const view = await window.electronAPI.entityDbBackupSetConfig(patch);
      await refreshEntityDbBackupStatus();
      return view;
    },
    [refreshEntityDbBackupStatus],
  );

  const clearEntityDbBackupConfig = useCallback(async () => {
    await window.electronAPI?.entityDbBackupClearConfig?.();
    await refreshEntityDbBackupStatus();
  }, [refreshEntityDbBackupStatus]);

  const testEntityDbBackupConnection = useCallback(
    async (patch: Partial<EntityDbBackupConfig>): Promise<EntityDbBackupProbeResult> =>
      (await window.electronAPI?.entityDbBackupTestConnection?.(patch)) ?? {
        ok: false,
        error: 'Desktop entity database backup bridge is unavailable.',
      },
    [],
  );

  const runEntityDbBackupNow = useCallback(async (): Promise<EntityDbBackupResult> => {
    const result = (await window.electronAPI?.entityDbBackupRunNow?.()) ?? {
      ok: false,
      reason: 'manual' as const,
      error: 'Desktop entity database backup bridge is unavailable.',
    };
    await refreshEntityDbBackupStatus();
    return result;
  }, [refreshEntityDbBackupStatus]);

  const listEntityDbBackupSnapshots = useCallback(
    async (): Promise<EntityDbCloudSnapshot[]> =>
      (await window.electronAPI?.entityDbBackupListSnapshots?.()) ?? [],
    [],
  );

  const restoreEntityDbBackup = useCallback(
    async (key: string): Promise<EntityDbRestoreResult> => {
      const result = (await window.electronAPI?.entityDbBackupRestore?.(key)) ?? {
        ok: false,
        restoredFromKey: key,
        restoredBytes: 0,
        previousCopyDir: '',
        error: 'Desktop entity database backup bridge is unavailable.',
      };
      await refreshEntityDbBackupStatus();
      return result;
    },
    [refreshEntityDbBackupStatus],
  );

  const refreshEntitySyncStatus = useCallback(async () => {
    if (!window.electronAPI?.entitySyncGetStatus) return;
    try {
      setEntitySyncStatusState(await window.electronAPI.entitySyncGetStatus());
    } catch {
      // best-effort; the panel shows its own errors
    }
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onEntityDatabaseChanged) return;
    const unsubscribe = window.electronAPI.onEntityDatabaseChanged(() => {
      void refreshEntityDbBackupStatus();
      void refreshEntitySyncStatus();
      window.dispatchEvent(new CustomEvent('grognard-entity-database-changed'));
    });
    return unsubscribe;
  }, [refreshEntityDbBackupStatus, refreshEntitySyncStatus]);

  const setEntitySyncConfig = useCallback(
    async (patch: EntitySyncConfigPatch): Promise<EntitySyncConfig | null> => {
      if (!window.electronAPI?.entitySyncSetConfig) return null;
      const config = await window.electronAPI.entitySyncSetConfig(patch);
      await refreshEntitySyncStatus();
      return config;
    },
    [refreshEntitySyncStatus],
  );

  const runEntitySyncNow = useCallback(async (): Promise<EntitySyncRunSummary> => {
    const result = (await window.electronAPI?.entitySyncRunNow?.()) ?? {
      ok: false,
      reason: 'manual' as const,
      error: 'Desktop entity sync bridge is unavailable.',
    };
    await refreshEntitySyncStatus();
    return result;
  }, [refreshEntitySyncStatus]);

  const listEntitySyncConflicts = useCallback(
    async (): Promise<EntitySyncConflict[]> =>
      (await window.electronAPI?.entitySyncListConflicts?.()) ?? [],
    [],
  );

  const resolveEntitySyncConflict = useCallback(
    async (request: { id: number; keep: 'local' | 'remote' }): Promise<{ ok: boolean }> => {
      const result = (await window.electronAPI?.entitySyncResolveConflict?.(request)) ?? {
        ok: false,
      };
      await refreshEntitySyncStatus();
      return result;
    },
    [refreshEntitySyncStatus],
  );

  const setLanguageToolSettings = useCallback(
    async (settings: Partial<LanguageToolSettings>) => {
      const next = {
        ...(languageToolSettings ?? {
          enabled: false,
          baseUrl: 'http://localhost:8010',
          verifiedAt: null,
          verifiedBaseUrl: '',
          checkMode: 'onDemand' as const,
          managedInstall: false,
          ngramsEnabled: false,
          installedVersion: null,
        }),
        ...settings,
      };
      setLanguageToolSettingsState(next);
      await window.electronAPI?.setLanguageToolSettings?.(next);
    },
    [languageToolSettings],
  );

  const testLanguageToolConnection = useCallback(
    async (settings: Partial<LanguageToolSettings>) => {
      return (
        (await window.electronAPI?.testLanguageToolConnection?.(settings)) ?? {
          ok: false,
          error: 'Desktop LanguageTool bridge is unavailable.',
        }
      );
    },
    [],
  );

  const connectGithub = useCallback(async (onStarted?: (userCode: string) => void) => {
    const api = window.electronAPI;
    if (!api?.startLeaderboardDeviceFlow || !api.pollLeaderboardDeviceFlow) {
      return { ok: false, error: 'Desktop GitHub bridge is unavailable.' };
    }

    try {
      const flow = await api.startLeaderboardDeviceFlow();
      onStarted?.(flow.userCode);
      const result = await api.pollLeaderboardDeviceFlow(
        flow.deviceCode,
        flow.interval,
        flow.expiresIn,
      );
      if ('token' in result) {
        setGithubConnected(true);
        return { ok: true };
      }
      return { ok: false, error: result.error };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not connect to GitHub.',
      };
    }
  }, []);

  const disconnectGithub = useCallback(async () => {
    await window.electronAPI?.clearCachedLeaderboardToken?.();
    setGithubConnected(false);
  }, []);

  const pickEntityDbFolder = useCallback(async (): Promise<string | null> => {
    const picked = await window.electronAPI?.pickEntityDbFolder?.();
    if (!picked) return null;

    const folder = picked.replace(/[/\\]+$/, '');

    const isProjectFolder =
      (await window.electronAPI?.pathExists?.(`${folder}/${PROJECT_FILE_NAME}`)) ||
      (await window.electronAPI?.pathExists?.(`${folder}/${LEGACY_PROJECT_FILE_NAME}`));
    if (isProjectFolder) {
      await window.electronAPI?.showNativeMessageBox?.({
        type: 'warning',
        title: t('LWC.desktop.entity_db_setup.folder_is_project_title'),
        message: `${folder}\n\n${t('LWC.desktop.entity_db_setup.folder_is_project_message')}`,
        buttons: [t('LWC.desktop.entity_db_setup.ok')],
      });
      return null;
    }

    const entitiesHere = await window.electronAPI?.pathExists?.(`${folder}/entities.xml`);
    if (!entitiesHere) {
      // Choosing a blank folder means create one there. Do not require
      // entities.xml already (that would be circular for first install), and
      // do not open a second in-app dialog — splash/settings may already be
      // modal, so confirm via native box only when the parent looks like the
      // real database (common mistake: picking a project subfolder).
      const parent = folder.replace(/[/\\][^/\\]+$/, '');
      const entitiesInParent =
        parent.length > 0 && (await window.electronAPI?.pathExists?.(`${parent}/entities.xml`));
      if (entitiesInParent) {
        const choice = await window.electronAPI?.showNativeMessageBox?.({
          type: 'warning',
          title: t('LWC.desktop.entity_db_setup.create_here_title'),
          message: `${t('LWC.desktop.entity_db_setup.parent_has_db_intro')}\n${parent}\n\n${t('LWC.desktop.entity_db_setup.parent_has_db_detail')}\n${folder}`,
          buttons: [
            t('LWC.desktop.entity_db_setup.cancel'),
            t('LWC.desktop.entity_db_setup.use_parent_folder'),
            t('LWC.desktop.entity_db_setup.create_here'),
          ],
          defaultId: 1,
          cancelId: 0,
        });
        if (choice?.response === 1) {
          try {
            await window.electronAPI?.setEntityDbFolder?.(parent);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void window.electronAPI?.showNativeMessageBox?.({
              type: 'warning',
              title: t('LWC.desktop.entity_db_setup.save_folder_failed_title'),
              message: `${parent}\n\n${t('LWC.desktop.entity_db_setup.save_parent_folder_failed')}`,
              detail,
              buttons: [t('LWC.desktop.entity_db_setup.ok')],
            });
          }
          setEntityDbFolderState(parent);
          return parent;
        }
        if (choice?.response !== 2) return null;
      }

      try {
        await window.electronAPI?.createEntityDatabase?.(folder, createEntitiesScaffold());
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await window.electronAPI?.showNativeMessageBox?.({
          type: 'warning',
          title: t('LWC.desktop.entity_db_setup.create_db_failed_title'),
          message: `${folder}\n\n${t('LWC.desktop.entity_db_setup.create_db_failed_message')}`,
          detail,
          buttons: [t('LWC.desktop.entity_db_setup.ok')],
        });
        return null;
      }
    }

    try {
      await window.electronAPI?.setEntityDbFolder?.(picked);
    } catch (error) {
      // Still reflect the pick in the UI (and let the caller proceed) even if
      // persisting it failed - otherwise a prefs-write error here silently
      // reverts the folder field to empty with no explanation.
      const detail = error instanceof Error ? error.message : String(error);
      void window.electronAPI?.showNativeMessageBox?.({
        type: 'warning',
        title: t('LWC.desktop.entity_db_setup.save_folder_failed_title'),
        message: `${folder}\n\n${t('LWC.desktop.entity_db_setup.save_folder_failed_session')}`,
        detail,
        buttons: [t('LWC.desktop.entity_db_setup.ok')],
      });
    }
    setEntityDbFolderState(picked);
    return picked;
  }, [t]);

  const setRememberWorkspaceOnStartup = useCallback(async (value: boolean) => {
    setRememberWorkspaceOnStartupState(value);
    await window.electronAPI?.setRememberWorkspaceOnStartup?.(value);
  }, []);

  const setAuthorityLifecycleEnabled = useCallback(
    async (options: AuthorityLifecycleSetEnabledOptions): Promise<AuthorityLifecycleRunResult> => {
      const result = (await window.electronAPI?.authorityLifecycleSetEnabled?.(options)) ?? {
        ok: false,
        error: 'Authority lifecycle bridge is unavailable.',
      };
      if (result.ok && options.enabled) {
        await afterAuthorityPackLifecycleSuccess();
      }
      await refreshAuthorityLifecycle();
      return result;
    },
    [refreshAuthorityLifecycle],
  );

  const setAuthorityLifecycleReferenceDataEnabled = useCallback(
    async (enabled: boolean): Promise<AuthorityLifecycleRunResult> => {
      const result = (await window.electronAPI?.authorityLifecycleSetReferenceDataEnabled?.(
        enabled,
      )) ?? {
        ok: false,
        error: 'Authority lifecycle bridge is unavailable.',
      };
      if (result.ok && enabled) {
        await afterAuthorityPackLifecycleSuccess();
      }
      await refreshAuthorityLifecycle();
      return result;
    },
    [refreshAuthorityLifecycle],
  );

  const runAuthorityLifecycleUpdate =
    useCallback(async (): Promise<AuthorityLifecycleRunResult> => {
      const result = (await window.electronAPI?.authorityLifecycleUpdate?.()) ?? {
        ok: false,
        error: 'Authority lifecycle bridge is unavailable.',
      };
      if (result.ok) {
        await afterAuthorityPackLifecycleSuccess();
      }
      await refreshAuthorityLifecycle();
      return result;
    }, [refreshAuthorityLifecycle]);

  const revealAuthorityLifecycleFolder = useCallback(async () => {
    await window.electronAPI?.authorityLifecycleRevealFolder?.();
  }, []);

  const moveEntityDbFolder = useCallback(async (): Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    folder?: string;
  }> => {
    const result = await window.electronAPI?.moveEntityDbFolder?.();
    if (!result) {
      return { ok: false, error: 'Desktop entity database bridge is unavailable.' };
    }
    if (result.ok && result.folder) {
      setEntityDbFolderState(result.folder);
      clearAchievementsCache();
      await refreshAuthorityLifecycle();
    }
    return result;
  }, [refreshAuthorityLifecycle]);

  useEffect(() => {
    if (!isDesktop()) return;
    registerLeafWriterCommonsI18n();

    window.__ljbCommonsUi = {
      encoderName,
      encoderNameLoaded,
      aiApiSettings,
      languageToolSettings,
      githubConnected,
      connectGithub,
      disconnectGithub,
      entityDbFolder,
      rememberWorkspaceOnStartup,
      skipEntityDetachConfirm,
      skipExplorerDeleteConfirm,
      authorityLifecycleStatus,
      setAiApiSettings,
      setLanguageToolSettings,
      setEncoderName,
      setRememberWorkspaceOnStartup,
      setSkipEntityDetachConfirm,
      setSkipExplorerDeleteConfirm,
      pickEntityDbFolder,
      testAiConnection,
      testLanguageToolConnection,
      refreshAuthorityLifecycle,
      setAuthorityLifecycleEnabled,
      setAuthorityLifecycleReferenceDataEnabled,
      runAuthorityLifecycleUpdate,
      revealAuthorityLifecycleFolder,
      moveEntityDbFolder,
      entityDbBackupStatus,
      refreshEntityDbBackupStatus,
      setEntityDbBackupConfig,
      clearEntityDbBackupConfig,
      testEntityDbBackupConnection,
      runEntityDbBackupNow,
      listEntityDbBackupSnapshots,
      restoreEntityDbBackup,
      entitySyncStatus,
      refreshEntitySyncStatus,
      setEntitySyncConfig,
      runEntitySyncNow,
      listEntitySyncConflicts,
      resolveEntitySyncConflict,
    };

    window.dispatchEvent(new Event('grognardCommonsUiChanged'));

    return () => {
      delete window.__ljbCommonsUi;
    };
  }, [
    aiApiSettings,
    languageToolSettings,
    connectGithub,
    disconnectGithub,
    githubConnected,
    authorityLifecycleStatus,
    encoderName,
    encoderNameLoaded,
    entityDbFolder,
    rememberWorkspaceOnStartup,
    pickEntityDbFolder,
    refreshAuthorityLifecycle,
    runAuthorityLifecycleUpdate,
    revealAuthorityLifecycleFolder,
    moveEntityDbFolder,
    entityDbBackupStatus,
    refreshEntityDbBackupStatus,
    setEntityDbBackupConfig,
    clearEntityDbBackupConfig,
    testEntityDbBackupConnection,
    runEntityDbBackupNow,
    listEntityDbBackupSnapshots,
    restoreEntityDbBackup,
    entitySyncStatus,
    refreshEntitySyncStatus,
    setEntitySyncConfig,
    runEntitySyncNow,
    listEntitySyncConflicts,
    resolveEntitySyncConflict,
    setAiApiSettings,
    setLanguageToolSettings,
    setAuthorityLifecycleEnabled,
    setAuthorityLifecycleReferenceDataEnabled,
    setEncoderName,
    setRememberWorkspaceOnStartup,
    setSkipEntityDetachConfirm,
    setSkipExplorerDeleteConfirm,
    skipEntityDetachConfirm,
    skipExplorerDeleteConfirm,
    testAiConnection,
    testLanguageToolConnection,
  ]);
};
