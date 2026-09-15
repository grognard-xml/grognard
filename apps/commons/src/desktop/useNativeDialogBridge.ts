import { leafwriterAtom } from '@src/jotai';
import { useActions, useAppState } from '@src/overmind';
import type { Locales } from '@src/i18n';
import type { PaletteMode } from '@src/types';
import { isDesktop, type AiApiSettings, type LanguageToolSettings } from '@src/types/desktop';
import { useAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { parseIsoYear } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import type { NameTypeTaggingBucket } from '../../../../packages/cwrc-leafwriter/src/autoTagging/nameTypeTaggingPolicy';
import type { NameTypeId } from '../../../../packages/cwrc-leafwriter/src/autoTagging/nameTypes';
import { getActiveTabXml } from './fileMetadata';
import { buildProjectSchemas, type ProjectBundle } from './projectFile';
import { getProjectSourceLanguage } from './projectLanguage';
import { readSourceDescriptionFromXml } from './sourceDescription';
import {
  loadNameTypeTaggingPolicyState,
  loadProjectMetadataDialogState,
  loadThingTypePolicyState,
  persistNameTypeTaggingPolicyChanges,
  persistThingTypePolicyChanges,
  saveProjectMetadataChanges,
  type ProjectMetadataSaveDeps,
  type ProjectMetadataSavePayload,
} from './projectMetadataSave';
import type { ProjectMetadataDialogMode } from './projectMetadataSession';
import {
  clearProjectMetadataSession,
  getProjectMetadataSession,
  subscribeProjectMetadataDialogClosed,
} from './projectMetadataSession';
import { setActiveProjectBundle, resolveProjectBundleByPath } from './activeProjectBundle';
import { buildProjectMetadataDialogState } from './projectMetadataDialogState';
import { registerDesktopSchemas } from './registerDesktopSchemas';
import { getTieredCatalogForSetup } from './schemaCatalog';
import {
  clearSchemaPickerSession,
  getSchemaPickerSession,
  subscribeNativeDialogClosed,
} from './schemaPickerSession';
import {
  clearSchemaSetupSession,
  getSchemaSetupSession,
  subscribeSchemaSetupDialogClosed,
} from './schemaSetupSession';
import type {
  AutoTaggingAuthoritySettings,
  AutoTaggingValidationSettings,
  DisambiguationSettings,
} from './projectTypes';

declare global {
  interface Window {
    __ljbNativeBridge?: {
      invoke: (method: string, args: unknown) => Promise<unknown>;
    };
    __leafWriterProject?: {
      getProjectFilePath: () => string;
      getProjectSourceLanguage?: () => Promise<string | null>;
      /** Signed year (negative = BCE) from the active file's profileDesc/creation/date, or null if unset/no file. */
      getActiveFileWorkYear?: () => number | null;
      /** Every open editor tab, for `openTabs`-scoped tag bomb runs. */
      getOpenTabs?: () => { filePath: string; content: string }[];
      getActiveFileXml?: () => string;
      getActiveFilePath?: () => string | null;
      /** Re-read `filePath` from disk into its open tab, if any, after a direct (skip-review) write. */
      reloadFileFromDisk?: (filePath: string) => Promise<void>;
      /** Open (or switch to) `filePath` as the active editor tab. */
      openFile?: (filePath: string) => Promise<void>;
      getProjectRootPath?: () => string;
      getProjectConfig?: () => import('./projectTypes').ProjectFileConfig | undefined;
      isProjectReady?: () => boolean;
      refreshExplorer?: () => Promise<void>;
      /** Guardrail hook: snapshot the project before a multi-document automated edit (tag bomb, purge, propagate). */
      createTimeMachineSnapshot?: (label?: string) => Promise<{ ok: boolean; path?: string }>;
      getAutoTaggingAuthoritySettings: () => AutoTaggingAuthoritySettings | undefined;
      setAutoTaggingAuthoritySettings: (settings: AutoTaggingAuthoritySettings) => void;
      getAutoTaggingValidationSettings: () => AutoTaggingValidationSettings | undefined;
      setAutoTaggingValidationSettings: (settings: AutoTaggingValidationSettings) => void;
      getDisambiguationSettings: () => DisambiguationSettings | undefined;
      setDisambiguationSettings: (settings: DisambiguationSettings) => void;
      /** Apply a bundle returned by `updateProjectFileConfig` to caches + Overmind. */
      applyProjectConfigBundle?: (bundle: ProjectBundle) => void;
      loadProjectMetadataState?: (
        mode?: ProjectMetadataDialogMode,
      ) => ReturnType<typeof loadProjectMetadataDialogState>;
      saveProjectMetadata?: (
        payload: ProjectMetadataSavePayload,
      ) => ReturnType<typeof saveProjectMetadataChanges>;
      getNameTypeTaggingPolicyState?: () => ReturnType<typeof loadNameTypeTaggingPolicyState>;
      persistNameTypeTaggingPolicy?: (payload: {
        buckets: Record<NameTypeId, NameTypeTaggingBucket>;
        customTypes?: AutoTaggingAuthoritySettings['customNameTypes'];
        artMinCodePoints?: number;
      }) => ReturnType<typeof persistNameTypeTaggingPolicyChanges>;
      getThingTypePolicyState?: () => ReturnType<typeof loadThingTypePolicyState>;
      persistThingTypePolicy?: (payload: {
        customTypes: AutoTaggingAuthoritySettings['customThingTypes'];
      }) => ReturnType<typeof persistThingTypePolicyChanges>;
    };
  }
}

interface SchemaPickerStatePayload {
  defaultSchemaId: string | null;
  schemas: { id: string; name: string }[];
}

const getStringArg = (args: unknown, key: string): string | null => {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const getLeafWriterPaletteMode = (mode: PaletteMode): 'light' | 'dark' => {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getWriterSchemasList = (): {
  id: string;
  name: string;
  mapping: string;
  rng: string[];
  css: string[];
}[] => {
  const writer = window.writer;
  if (!writer?.overmindState?.editor) return [];

  const { schemasList } = writer.overmindState.editor as {
    schemasList: {
      id: string;
      name: string;
      mapping: string;
      rng: string[];
      css: string[];
    }[];
  };

  return schemasList;
};

export const useNativeDialogBridge = () => {
  const { t } = useTranslation();
  const { currentLocale, skipExplorerDeleteConfirm, themeAppearance } = useAppState().ui;
  const { activeTabPath, config, isProjectReady, openTabs, projectFilePath, rootPath } =
    useAppState().project;
  const { setSkipExplorerDeleteConfirm, setThemeAppearance, switchLanguage, notifyViaSnackbar } =
    useActions().ui;
  const { openFile, refreshExplorer, reloadTabFromDisk } = useActions().project;
  const [leafWriter] = useAtom(leafwriterAtom);
  const authoritySettingsCache = useRef<AutoTaggingAuthoritySettings | undefined>(undefined);
  const validationSettingsCache = useRef<AutoTaggingValidationSettings | undefined>(undefined);
  const disambiguationSettingsCache = useRef<DisambiguationSettings | undefined>(undefined);
  const bridgedProjectFilePathRef = useRef<string | null>(null);
  const metadataSaveDepsRef = useRef<() => ProjectMetadataSaveDeps>(() => {
    throw new Error('Project metadata save is not ready.');
  });
  const policySaveDepsRef = useRef<
    () => Pick<
      ProjectMetadataSaveDeps,
      'electronAPI' | 'getAuthoritySettings' | 'setAuthoritySettings'
    >
  >(() => {
    throw new Error('Name-type policy save is not ready.');
  });
  const activeTabPathRef = useRef(activeTabPath);
  const openTabsRef = useRef(openTabs);
  useEffect(() => {
    activeTabPathRef.current = activeTabPath;
    openTabsRef.current = openTabs;
  }, [activeTabPath, openTabs]);

  useEffect(() => {
    if (!isDesktop()) return;

    const unsubPicker = subscribeNativeDialogClosed();
    const unsubSetup = subscribeSchemaSetupDialogClosed();
    const unsubMetadata = subscribeProjectMetadataDialogClosed();

    return () => {
      unsubPicker();
      unsubSetup();
      unsubMetadata();
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;

    // These deps must be ready during first-run onboarding, which opens the
    // project-metadata dialog *before* Overmind has loaded the new project
    // (completeProjectOnboarding → openNativeProjectMetadata → loadProjectBundle).
    // Save resolves the target project from the dialog session path, not from
    // the currently-loaded Overmind project.
    const getAuthoritySettings = (bundle: ProjectBundle) =>
      authoritySettingsCache.current ?? bundle.config.autoTaggingAuthority;
    const setAuthoritySettings = (settings: AutoTaggingAuthoritySettings) => {
      authoritySettingsCache.current = settings;
    };
    metadataSaveDepsRef.current = () => ({
      electronAPI: window.electronAPI!,
      openTabs: openTabsRef.current,
      reloadTabFromDisk,
      notifyViaSnackbar,
      t,
      getAuthoritySettings,
      setAuthoritySettings,
    });
    policySaveDepsRef.current = () => ({
      electronAPI: window.electronAPI!,
      getAuthoritySettings,
      setAuthoritySettings,
    });
  }, [notifyViaSnackbar, reloadTabFromDisk, t]);

  useEffect(() => {
    if (!isDesktop()) {
      setActiveProjectBundle(null);
      return;
    }
    if (!rootPath || !projectFilePath || !config) {
      setActiveProjectBundle(null);
      return;
    }

    if (bridgedProjectFilePathRef.current !== projectFilePath) {
      authoritySettingsCache.current = undefined;
      validationSettingsCache.current = undefined;
      disambiguationSettingsCache.current = undefined;
      bridgedProjectFilePathRef.current = projectFilePath;
    }

    setActiveProjectBundle({ rootPath, projectFilePath, config });

    const getAuthoritySettings = (bundle: ProjectBundle) =>
      authoritySettingsCache.current ?? bundle.config.autoTaggingAuthority;
    const setAuthoritySettings = (settings: AutoTaggingAuthoritySettings) => {
      authoritySettingsCache.current = settings;
    };
    const metadataSaveDeps = () => ({
      electronAPI: window.electronAPI!,
      openTabs,
      reloadTabFromDisk,
      notifyViaSnackbar,
      t,
      getAuthoritySettings,
      setAuthoritySettings,
    });
    const policySaveDeps = () => ({
      electronAPI: window.electronAPI!,
      getAuthoritySettings,
      setAuthoritySettings,
    });
    metadataSaveDepsRef.current = metadataSaveDeps;
    policySaveDepsRef.current = policySaveDeps;

    window.__leafWriterProject = {
      getProjectFilePath: () => projectFilePath,
      getProjectSourceLanguage: () =>
        getProjectSourceLanguage({ rootPath, projectFilePath, config }),
      getActiveFileWorkYear: () => {
        const xml = getActiveTabXml(activeTabPathRef.current, openTabsRef.current);
        if (!xml) return null;
        const { workDate } = readSourceDescriptionFromXml(xml);
        return parseIsoYear(workDate.when) ?? parseIsoYear(workDate.notBefore);
      },
      getOpenTabs: () =>
        openTabsRef.current.map((tab) => ({ filePath: tab.filePath, content: tab.content })),
      getActiveFileXml: () => getActiveTabXml(activeTabPathRef.current, openTabsRef.current),
      getActiveFilePath: () => activeTabPathRef.current,
      reloadFileFromDisk: async (filePath) => {
        if (openTabsRef.current.some((tab) => tab.filePath === filePath)) {
          await reloadTabFromDisk(filePath);
        }
      },
      openFile: (filePath) => openFile(filePath),
      getProjectRootPath: () => rootPath ?? '',
      getProjectConfig: () => config,
      isProjectReady: () => isProjectReady,
      refreshExplorer: () => refreshExplorer(),
      createTimeMachineSnapshot: async (label) => {
        if (!rootPath || !window.electronAPI) return { ok: false };
        try {
          const snapshot = await window.electronAPI.createTimeMachineSnapshot(
            rootPath,
            label ?? 'auto',
          );
          notifyViaSnackbar({ message: t('LWC.desktop.time_machine.snapshot_created') });
          return { ok: true, path: snapshot.path };
        } catch {
          return { ok: false };
        }
      },
      getAutoTaggingAuthoritySettings: () =>
        authoritySettingsCache.current ?? config.autoTaggingAuthority,
      setAutoTaggingAuthoritySettings: (settings) => {
        authoritySettingsCache.current = settings;
      },
      getAutoTaggingValidationSettings: () =>
        validationSettingsCache.current ?? config.autoTaggingValidation,
      setAutoTaggingValidationSettings: (settings) => {
        validationSettingsCache.current = settings;
      },
      getDisambiguationSettings: () => disambiguationSettingsCache.current ?? config.disambiguation,
      setDisambiguationSettings: (settings) => {
        disambiguationSettingsCache.current = settings;
      },
      applyProjectConfigBundle: (bundle) => {
        setActiveProjectBundle(bundle);
        authoritySettingsCache.current = bundle.config.autoTaggingAuthority;
        validationSettingsCache.current = bundle.config.autoTaggingValidation;
        disambiguationSettingsCache.current = bundle.config.disambiguation;
        if (projectFilePath === bundle.projectFilePath) {
          window.writer?.overmindActions?.project?.syncProjectFileConfig?.(bundle);
        }
      },
      loadProjectMetadataState: (mode = 'edition') =>
        loadProjectMetadataDialogState(projectFilePath, mode),
      saveProjectMetadata: (payload) => saveProjectMetadataChanges(metadataSaveDeps(), payload),
      getNameTypeTaggingPolicyState: () =>
        loadNameTypeTaggingPolicyState(projectFilePath, getAuthoritySettings),
      persistNameTypeTaggingPolicy: (payload) =>
        persistNameTypeTaggingPolicyChanges(projectFilePath, payload, policySaveDeps()),
      getThingTypePolicyState: () =>
        loadThingTypePolicyState(projectFilePath, getAuthoritySettings),
      persistThingTypePolicy: (payload) =>
        persistThingTypePolicyChanges(projectFilePath, payload, policySaveDeps()),
    };
    return () => {
      delete window.__leafWriterProject;
    };
  }, [
    rootPath,
    projectFilePath,
    config,
    isProjectReady,
    openFile,
    refreshExplorer,
    reloadTabFromDisk,
    notifyViaSnackbar,
    t,
  ]);

  useEffect(() => {
    if (!isDesktop()) return;
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const resolveProjectBundle = async (
      sessionProjectFilePath: string,
    ): Promise<ProjectBundle | null> => resolveProjectBundleByPath(sessionProjectFilePath);

    window.__ljbNativeBridge = {
      invoke: async (method: string, args: unknown) => {
        switch (method) {
          case 'getInterfaceSettings':
            return {
              currentLocale,
              skipExplorerDeleteConfirm,
              themeAppearance,
            };
          case 'getEncoderName':
            return (await electronAPI.getEncoderName()) ?? '';
          case 'getEntityDbFolder':
            return (await electronAPI.getEntityDbFolder?.()) ?? null;
          case 'pickEntityDbFolder': {
            const picked = await electronAPI.pickEntityDbFolder?.();
            if (picked) await electronAPI.setEntityDbFolder?.(picked);
            return picked ?? null;
          }
          case 'setEncoderName':
            await electronAPI.setEncoderName(String(args ?? ''));
            return true;
          case 'getAiApiSettings':
            return electronAPI.getAiApiSettings() ?? null;
          case 'setAiApiSettings':
            await electronAPI.setAiApiSettings((args ?? {}) as Partial<AiApiSettings>);
            return true;
          case 'getLanguageToolSettings':
            return electronAPI.getLanguageToolSettings?.() ?? null;
          case 'setLanguageToolSettings':
            await electronAPI.setLanguageToolSettings?.(
              (args ?? {}) as Partial<LanguageToolSettings>,
            );
            return true;
          case 'getRememberWorkspaceOnStartup':
            return (await electronAPI.getRememberWorkspaceOnStartup?.()) ?? true;
          case 'setRememberWorkspaceOnStartup':
            await electronAPI.setRememberWorkspaceOnStartup?.(Boolean(args));
            return true;
          case 'testAiConnection':
            return (
              (await electronAPI.testAiConnection?.((args ?? {}) as Partial<AiApiSettings>)) ?? {
                ok: false,
                error: t('LWC.desktop.ai_api_bridge_unavailable'),
              }
            );
          case 'testLanguageToolConnection':
            return (
              (await electronAPI.testLanguageToolConnection?.(
                (args ?? {}) as Partial<LanguageToolSettings>,
              )) ?? {
                ok: false,
                error: 'Desktop LanguageTool bridge is unavailable.',
              }
            );
          case 'setThemeAppearance': {
            const mode = args as PaletteMode;
            setThemeAppearance(mode);
            leafWriter?.setThemeAppearance?.(getLeafWriterPaletteMode(mode));
            return true;
          }
          case 'setLocale': {
            const locale = args as Locales;
            switchLanguage(locale);
            leafWriter?.switchLocale?.(locale);
            return true;
          }
          case 'setSkipExplorerDeleteConfirm': {
            setSkipExplorerDeleteConfirm(Boolean(args));
            return true;
          }
          case 'getSchemaPickerState': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getSchemaPickerSession(dialogId) : undefined;
            if (!session) return null;

            const possibleSchemas = getWriterSchemasList().filter((schema) =>
              session.mappingIds.includes(schema.mapping),
            );

            const defaultSchema = session.mappingIds.includes('tei')
              ? possibleSchemas.find((schema) => schema.id === 'teiAll')
              : possibleSchemas[0];

            const payload: SchemaPickerStatePayload = {
              schemas: possibleSchemas.map(({ id, name }) => ({ id, name })),
              defaultSchemaId: defaultSchema?.id ?? null,
            };
            return payload;
          }
          case 'applySchemaPickerSelection': {
            const dialogId = getStringArg(args, 'dialogId');
            const schemaId = getStringArg(args, 'schemaId');
            if (!dialogId || !schemaId) return { ok: false };
            const session = getSchemaPickerSession(dialogId);
            if (!session || !schemaId) return { ok: false };

            const schema = getWriterSchemasList().find(({ id }) => id === schemaId);
            if (!schema) return { ok: false };

            clearSchemaPickerSession(dialogId);
            await session.onSchemaSelect(schema);
            session.onClose('select');
            return { ok: true };
          }
          case 'cancelSchemaPicker': {
            const dialogId = getStringArg(args, 'dialogId');
            if (!dialogId) return { ok: false };
            const session = getSchemaPickerSession(dialogId);
            if (!session) return { ok: false };

            clearSchemaPickerSession(dialogId);
            session.onClose('cancel');
            return { ok: true };
          }
          case 'getSchemaSetupState': {
            const tiered = getTieredCatalogForSetup();
            return {
              primary: tiered.primary,
              more: tiered.more,
              defaultCatalogId: tiered.primary[0]?.id ?? 'teiAll',
            };
          }
          case 'installCatalogSchema': {
            const dialogId = getStringArg(args, 'dialogId');
            const catalogId = getStringArg(args, 'catalogId');
            if (!dialogId || !catalogId) {
              return { ok: false, error: 'Invalid schema setup session.' };
            }
            const session = getSchemaSetupSession(dialogId);
            if (!session || !catalogId || !electronAPI.installCatalogSchema) {
              return { ok: false, error: 'Invalid schema setup session.' };
            }

            try {
              const bundle = await electronAPI.installCatalogSchema(
                session.projectFilePath,
                catalogId,
              );
              registerDesktopSchemas(buildProjectSchemas(bundle.rootPath, bundle.config));
              clearSchemaSetupSession(dialogId);
              session.onComplete(bundle);
              return { ok: true };
            } catch (error) {
              return {
                ok: false,
                error:
                  error instanceof Error ? error.message : t('LWC.desktop.schema_download_failed'),
              };
            }
          }
          case 'installLocalSchema': {
            const dialogId = getStringArg(args, 'dialogId');
            if (!dialogId) return { ok: false, error: 'Invalid schema setup session.' };
            const session = getSchemaSetupSession(dialogId);
            if (!session || !electronAPI.pickSchemaFiles || !electronAPI.installLocalSchema) {
              return { ok: false, error: 'Invalid schema setup session.' };
            }
            const picked = await electronAPI.pickSchemaFiles();
            if (!picked) return { ok: false, error: 'cancelled' };

            try {
              const bundle = await electronAPI.installLocalSchema(
                session.projectFilePath,
                picked.rngPath,
                picked.cssPath,
              );
              registerDesktopSchemas(buildProjectSchemas(bundle.rootPath, bundle.config));
              clearSchemaSetupSession(dialogId);
              session.onComplete(bundle);
              return { ok: true };
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : t('LWC.desktop.copy_schema_failed'),
              };
            }
          }
          case 'getProjectMetadataState': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return null;

            const bundle = await resolveProjectBundle(session.projectFilePath);
            if (!bundle) return null;
            return buildProjectMetadataDialogState(bundle, session.mode);
          }
          case 'saveProjectMetadata': {
            const {
              values,
              custom,
              applyToDocuments,
              translationAlignmentUnit,
              translationLanguages,
              syncToCentral,
            } = (args ?? {}) as {
              values?: Record<string, string>;
              custom?: { path: string; label: string; value: string }[];
              applyToDocuments?: boolean;
              translationAlignmentUnit?: 'div' | 'p' | 'ab';
              translationLanguages?: { code: string; label: string }[];
              syncToCentral?: boolean;
            };
            const dialogId = getStringArg(args, 'dialogId');
            if (!dialogId) {
              return { ok: false, error: 'Invalid metadata session.' };
            }
            const session = getProjectMetadataSession(dialogId);
            if (!session) {
              return { ok: false, error: 'Invalid metadata session.' };
            }

            const result = await saveProjectMetadataChanges(metadataSaveDepsRef.current(), {
              projectFilePath: session.projectFilePath,
              mode: session.mode,
              values: values ?? {},
              custom: custom ?? [],
              applyToDocuments: Boolean(applyToDocuments),
              translationAlignmentUnit,
              translationLanguages,
              syncToCentral,
            });
            if (!result.ok) return result;

            clearProjectMetadataSession(dialogId);
            session.onSave();
            return result;
          }
          case 'cancelProjectMetadata': {
            const dialogId = getStringArg(args, 'dialogId');
            if (!dialogId) return { ok: false };
            const session = getProjectMetadataSession(dialogId);
            if (!session) return { ok: false };

            clearProjectMetadataSession(dialogId);
            session.onCancel();
            return { ok: true };
          }
          case 'getPedbState': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return null;
            const bundle = await resolveProjectBundle(session.projectFilePath);
            return bundle?.config.pedb ?? null;
          }
          case 'savePedb': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return { ok: false, error: 'Invalid metadata session.' };
            const { pedb } = (args ?? {}) as {
              pedb?: { backend: 'local' } | { backend: 'turso'; url: string };
            };
            if (!pedb || !electronAPI.updateProjectFileConfig) {
              return { ok: false, error: 'Not available.' };
            }
            await electronAPI.updateProjectFileConfig(session.projectFilePath, { pedb });
            return { ok: true };
          }
          case 'migratePedbLocalData': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return { ok: false, error: 'Invalid metadata session.' };
            return (
              (await electronAPI.entityDbTursoMigrateLocalData?.(session.projectFilePath)) ?? {
                ok: false,
                error: 'Not available.',
              }
            );
          }
          case 'getNameTypeTaggingPolicyState': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return null;
            return loadNameTypeTaggingPolicyState(
              session.projectFilePath,
              (bundle) => authoritySettingsCache.current ?? bundle.config.autoTaggingAuthority,
            );
          }
          case 'persistNameTypeTaggingPolicy': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return { ok: false, error: 'Invalid metadata session.' };

            const payload = (args ?? {}) as {
              buckets?: Record<NameTypeId, NameTypeTaggingBucket>;
              customTypes?: AutoTaggingAuthoritySettings['customNameTypes'];
              artMinCodePoints?: number;
            };
            if (!payload.buckets) {
              return { ok: false, error: 'Missing name-type policy.' };
            }

            return persistNameTypeTaggingPolicyChanges(
              session.projectFilePath,
              {
                buckets: payload.buckets,
                customTypes: payload.customTypes,
                artMinCodePoints: payload.artMinCodePoints,
              },
              policySaveDepsRef.current(),
            );
          }
          case 'getThingTypePolicyState': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return null;
            return loadThingTypePolicyState(
              session.projectFilePath,
              (bundle) => authoritySettingsCache.current ?? bundle.config.autoTaggingAuthority,
            );
          }
          case 'persistThingTypePolicy': {
            const dialogId = getStringArg(args, 'dialogId');
            const session = dialogId ? getProjectMetadataSession(dialogId) : undefined;
            if (!session) return { ok: false, error: 'Invalid metadata session.' };

            const payload = (args ?? {}) as {
              customTypes?: AutoTaggingAuthoritySettings['customThingTypes'];
            };
            if (!payload.customTypes) {
              return { ok: false, error: 'Missing thing-type list.' };
            }

            return persistThingTypePolicyChanges(
              session.projectFilePath,
              { customTypes: payload.customTypes },
              policySaveDepsRef.current(),
            );
          }
          default:
            return null;
        }
      },
    };

    return () => {
      delete window.__ljbNativeBridge;
    };
  }, [
    config,
    currentLocale,
    leafWriter,
    notifyViaSnackbar,
    openTabs,
    projectFilePath,
    reloadTabFromDisk,
    rootPath,
    setSkipExplorerDeleteConfirm,
    t,
    setThemeAppearance,
    skipExplorerDeleteConfirm,
    switchLanguage,
    themeAppearance,
  ]);
};
