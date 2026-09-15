import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  protocol,
  type WebContents,
  shell,
  systemPreferences,
} from 'electron';
import { fork, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, statSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseConnectionRef } from './entityDbConnectionRef';
import {
  hasTursoAuthToken,
  writeTursoAuthToken,
} from './entityDbTursoTokenStore';
import { TursoBackend } from './entityDbSqlite/tursoBackend';
import {
  resolvePluginApiStateFilePath,
  writePluginApiState,
} from '../../commons/src/desktop/pluginApiState';
import {
  closeAllNativeDialogs,
  getTopNativeDialogWindow,
  initNativeDialogs,
  prewarmNativeDialog,
  registerNativeDialogIpc,
} from './nativeDialogs';
import { GAME_ASSET_SCHEME, getGameAssetColorStats, registerGameAssetProtocol } from './gameAssets';
import { AVATAR_SCHEME, registerAvatarProtocol } from './avatarAssets';
import { BODY_SCHEME, registerBodyProtocol } from './bodyAssets';
import {
  getCachedLeaderboardToken,
  clearCachedLeaderboardToken,
  pollLeaderboardDeviceFlow,
  startLeaderboardDeviceFlow,
} from './leaderboardAuth';
import {
  buildTranslationRequestBody,
  isStructuredOutputRetryable,
  translationStructuredOutputModes,
  type StructuredOutputMode,
} from './aiTranslationLlm';
import {
  buildEntityGlossRequestBody,
  parseEntityGlossContent,
  type EntityGlossSuggestPayload,
  type EntityGlossSuggestResult,
} from './aiEntityGlossLlm';
import {
  applyTranslationSpellcheck,
  attachTranslationSpellcheckContextMenu,
} from './translationSpellcheck';
import {
  getAchievementsFolder,
  getAiApiSettings,
  getEncoderName,
  getEntityDbFolder,
  getLanguageToolSettings,
  getLastDialogDir,
  getLocalAuthorityAssetsDir,
  getMapTilesDir,
  getRecentProjects,
  getRememberWorkspaceOnStartup,
  getValidLastProjectFile,
  clearMissingProjectReferences,
  removeMissingRecentProject,
  setLastDialogDir,
  getWorkspaceSession,
  saveWorkspaceSession,
  setAchievementsFolder,
  setAiApiSettings,
  setEncoderName,
  setEntityDbFolder,
  setLanguageToolSettings,
  setRememberWorkspaceOnStartup,
  writeLastProjectFile,
  type AiApiSettings,
  type LanguageToolSettings,
  type WorkspaceSession,
} from './projectPrefs';
import {
  readBackupConfig,
  readBackupConfigView,
  writeBackupConfig,
  clearBackupConfig,
  type EntityDbBackupConfig,
} from './entityDbBackupConfig';
import {
  runBackup,
  runQuitBackup,
  startBackupTimer,
  getLastBackupMarker,
  listCloudSnapshots,
  restoreSnapshot,
  checkEntityDbIntegrity,
  probeBackupTarget,
  setActiveProjectPedb,
} from './entityDbBackup';
import {
  ensureDefaultEntityDatabase,
  notifyEntityDatabaseChanged,
  scaffoldEntityDatabaseInFolder,
  hasLocalEntityDatabase,
} from './ensureDefaultEntityDatabase';
import {
  runEntitySync,
  getEntitySyncStatus,
  setEntitySyncConfig,
  listEntitySyncConflicts,
  resolveEntitySyncConflict,
  startSyncTimer,
  scheduleLaunchSync,
} from './entitySyncService';
import type { EntitySyncConfigPatch } from './entitySyncService';
import { setAppLocale } from './appLocale';
import { migrateLegacyUserData } from './userDataMigration';
import { mainT } from './mainI18n';
import { checkLanguageToolText, testLanguageToolConnection } from './languageToolClient';
import { applyWhitelistToMatches, loadLanguageToolEntityWhitelist } from './languageToolWhitelist';
import { resolveLanguageToolCheckBaseUrl, sanitizeLanguageToolSettings } from './languageTool';
import {
  downloadAndInstallLanguageTool,
  downloadAndInstallManagedJre,
  downloadEnglishNgrams,
  ensureManagedLanguageToolServer,
  getLanguageToolInstallStatus,
  LANGUAGE_TOOL_MANAGED_PORT,
  removeManagedLanguageTool,
  stopManagedLanguageToolServer,
} from './languageToolManaged';
import {
  AUTHORITY_DB_DIRNAME,
  downloadAuthoritySource,
  getAuthorityStatuses,
  type AuthoritySourceId,
} from './authorityDatabases';
import {
  getAuthorityPackStatuses,
  installAuthorityPacksFrom,
  lookupAuthorityPackRowsByIds,
  readAuthorityPackFile,
} from './authorityPacks';
import {
  getAuthorityLifecycleStatus,
  maybeCheckAuthorityUpdates,
  readLifecycleConfig,
  recordDeclinedFirstPrompt,
  runAuthorityLifecyclePipeline,
  setAuthorityLifecycleEnabled,
  setAuthorityLifecycleReferenceDataEnabled,
} from './authorityLifecycle';
import { lookupAuthorityRef, type AuthorityRefLookupRequest } from './authorityRefLookup';
import {
  installMapTileBundle,
  listInstalledMapTileRegions,
  PMTILES_SCHEME,
  registerPmtilesProtocol,
  removeMapTileBundle,
  type MapTileBundleSpec,
} from './mapTiles';
import {
  dismissPluginLanguagePrompt,
  getPluginEntryModuleUrl,
  getPluginHostSnapshot,
  installPluginFromDirectory,
  isPluginEnabledInMain,
  seedDevPluginsIfEmpty,
  setPluginEnabled,
  setPluginProject,
  syncEnabledPluginContributions,
} from './plugins';
import { fetchRemotePluginIndex, installRemotePlugin } from './plugins/pluginRegistry';
import {
  loadOrCreateProject,
  loadProjectFile,
  writeProjectConfig,
  type ProjectBundle,
} from './projectFile';
import { resolveDialogDefaultPath } from './dialogDefaultPath';
import mammoth from 'mammoth';
import { extractOdtText } from './odtText';
import { readAchievementsFile, writeAchievementsFile } from './achievementsFile';
import {
  deleteSourceProfileFromFile,
  readSourceProfilesFile,
  upsertSourceProfileInFile,
} from './sourceProfilesFile';
import { decodeTextBuffer } from './textEncoding';
import {
  createDirectory,
  deletePath,
  findXmlFilesByName,
  listProjectXmlFiles,
  movePath,
  renamePath,
} from './explorerFileOps';
import { moveEntityDbFolder } from './moveEntityDb';
import { PROJECT_FILE_NAME } from './projectTypes';
import { OpenFileWatcher } from './openFileWatcher';
import {
  cancelZoteroPick,
  checkZoteroAvailability,
  listZoteroStyles,
  pickZoteroCitationCayw,
  searchZoteroItems,
} from './zoteroClient';
import { disposeLemminx, registerLemminxIpc } from './lemminx/lspBridge';
import { cancelBulkBridgeJob, killAllBulkBridgeJobs, startBulkBridgeJob } from './bulkBridgeJob';
import {
  cancelEntityIndexJob,
  killAllEntityIndexJobs,
  startEntityIndexJob,
} from './entityIndexJob';
import { checkForAppUpdatesManually, initAutoUpdater } from './updater';
import { installCatalogSchema, installLocalSchema } from './schemaSetup';
import { ensureSanmiaoDatesSchemaMerged } from './sanmiaoSchemaMerge';
import { fromLocalFileUrl } from '../../commons/src/desktop/localFileUrl';
import { applyCatalogSchemaUpdate, checkCatalogSchemaUpdate } from './checkSchemaUpdate';
import {
  createTimeMachineSnapshot,
  getDefaultTimeMachineRestorePath,
  listTimeMachineSnapshots,
  restoreTimeMachineSnapshotToProject,
  restoreTimeMachineSnapshotToDirectory,
} from './timeMachine';
import { invokePluginPython } from './pluginPythonBridge';
import {
  cloneKanripoWork,
  flushKanripoWork,
  kanripoCacheRoot,
  listKanripoTxtFiles,
} from './kanripoClone';
import { fetchCtextWikiParallel, listCtextWikiSections } from './ctextWikiParallel';
import { fetchParallelFromUrl } from './parallelUrlFetch';
import { getWikisourceModulePath, listWikisourceCatalog } from './wikisourceParallel';
import { startBrowserImportBridge } from './browserBridge';
import { searchKanripoWorks } from './kanripoWorks';
import { daozangCacheRoot, daozangCorpusStatus, daozangTextPath } from './daozangCorpus';
import { cbetaCorpusStatus, ensureCbetaCorpus } from './cbetaCorpus';
import { importBdrcToProject } from './bdrc/bdrcProjectImport';
import { loadBdrcImport } from './bdrc/bdrcRuntime';
import { searchDaozangWorks } from './daozangWorks';
import {
  closeEntitySqliteReadRepositories,
  acceptEntitySqliteDateAssertion,
  acceptEntitySqliteDescriptionAssertion,
  addEntitySqliteName,
  addEntitySqliteNationality,
  addEntitySqliteNobleTitle,
  addEntitySqliteOrigin,
  attachEntitySqliteAuthority,
  applyEntitySqliteConcordance,
  backfillEntitySqliteDecisionTargets,
  createPopulatedEntitySqlite,
  applyEntitySqliteAuthorityBackfillPatch,
  reconcileEntitySqliteXmlExtractedData,
  getEntitySqliteContentHash,
  replaceEntitySqliteContent,
  findEntitySqliteByAuthority,
  findEntitySqliteByNameDates,
  forceRejectEntitySqliteAssertion,
  decoupleEntitySqliteAuthority,
  exportEntitySqliteXml,
  getEntitySqlite,
  getEntitySqliteCentralId,
  getEntitySqliteDatabaseId,
  importEntitySqliteXml,
  listEntitySqliteCandidates,
  listEntitySqliteIds,
  listEntitySqlitePanelSummaries,
  listEntitySqliteAuthorityDuplicates,
  markEntitySqliteDuplicateIntentional,
  mergeEntitySqlite,
  createEntitySqliteRelation,
  listEntitySqliteRelations,
  updateEntitySqliteRelationStatus,
  rejectEntitySqliteAssertion,
  restoreEntitySqliteAssertion,
  rejectEntitySqliteConcordance,
  removeEntitySqliteAssertion,
  removeEntitySqliteName,
  renameEntitySqlitePrimaryName,
  searchEntitySqlite,
  setEntitySqliteRomanizedName,
  autoCleanEntitySqliteNames,
  setEntitySqliteUserDate,
  setEntitySqliteUserWorkAuthors,
  setEntitySqliteUserWorkDate,
  setEntitySqliteWorkType,
  setEntitySqliteCentralMapping,
  clearEntitySqliteCentralMapping,
  listEntitySqliteMappingsByCentralIds,
  listEntitySqliteAllCentralMappings,
  listEntitySqliteLinkedCentralIds,
  countEntitySqliteUnlinked,
  countEntitySqliteEntities,
  softDeleteEntitySqlite,
  tombstoneEntitySqliteNames,
  updateEntitySqliteDescription,
  updateEntitySqliteSubtype,
  getEntitySqliteNotes,
  setEntitySqliteNote,
  updateEntitySqliteNames,
  updateEntitySqliteNobleTitle,
  validateEntitySqliteAssertion,
} from './entityDbSqlite/readService';

const APP_NAME = 'Grognard';

// GTK4 (the Electron default on modern Linux desktops) renders popup menus
// with the wrong font size; GTK3 follows the system font settings.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('gtk-version', '3');
  // The XDG portal file chooser silently drops folder selections on some
  // GNOME/Wayland versions (dialog resolves as cancelled). Demand an
  // impossible portal version so Electron falls back to its GTK chooser.
  app.commandLine.appendSwitch('xdg-portal-required-version', '9999');
}

interface AiConnectionResult {
  error?: string;
  models?: string[];
  ok: boolean;
}

interface AiTranslationEntityRef {
  id: string;
  kind: string;
  primaryName?: string | null;
  romanizedName?: string | null;
  familyName?: string | null;
  dates?: string | null;
  description?: string | null;
}

interface AiTranslationDateRef {
  index: number;
  surface?: string | null;
  when?: string | null;
  gloss?: string | null;
}

interface AiTranslationMentionRef {
  index: number;
  kind: string;
}

interface AiTranslationRequest {
  /** 'note' is a synthetic unit type used for translating a stripped-out footnote independently. */
  alignmentUnit: 'div' | 'p' | 'ab' | 'note';
  sourceUnitXml: string;
  targetLanguage: string;
  mentions?: AiTranslationMentionRef[];
  entities?: AiTranslationEntityRef[];
  dates?: AiTranslationDateRef[];
  retryInstruction?: string;
}

interface AiTranslationResult {
  error?: string;
  ok: boolean;
  translationXml?: string;
}

type AiEntityGlossRequest = EntityGlossSuggestPayload;
type AiEntityGlossResult = EntityGlossSuggestResult;

type ImportableDocumentFormat = 'txt' | 'md' | 'rtf' | 'docx' | 'odt' | 'xml';

interface DocumentImportSource {
  format: ImportableDocumentFormat;
  relativePath: string;
  sourcePath: string;
}

const getImportableDocumentFormat = (filePath: string): ImportableDocumentFormat | null => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.txt') return 'txt';
  if (extension === '.md' || extension === '.markdown') return 'md';
  if (extension === '.rtf') return 'rtf';
  if (extension === '.docx') return 'docx';
  if (extension === '.odt') return 'odt';
  if (extension === '.xml') return 'xml';
  return null;
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};
const normalizeOpenAiBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://.');
  }
  return url.toString().replace(/\/+$/, '');
};

const testAiConnection = async (settings: Partial<AiApiSettings>): Promise<AiConnectionResult> => {
  const saved = await getAiApiSettings();
  const merged: AiApiSettings = { ...saved, ...settings };
  let baseUrl: string;

  try {
    baseUrl = normalizeOpenAiBaseUrl(merged.baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid base URL.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (merged.apiKey.trim()) headers.Authorization = `Bearer ${merged.apiKey.trim()}`;

    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `Server returned HTTP ${response.status}.` };
    }

    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const models = Array.isArray(body.data)
      ? body.data
          .map((model) => (typeof model.id === 'string' ? model.id : null))
          .filter((id): id is string => Boolean(id))
      : [];

    return { ok: true, models };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out.' };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the AI API.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

const listAiModels = async (settings: AiApiSettings): Promise<string[]> => {
  const baseUrl = normalizeOpenAiBaseUrl(settings.baseUrl);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) return [];

  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return Array.isArray(body.data)
    ? body.data
        .map((model) => (typeof model.id === 'string' ? model.id : null))
        .filter((id): id is string => Boolean(id))
    : [];
};

const aiTranslationDebugLogPath = (): string =>
  path.join(app.getPath('userData'), 'ai-translation-debug.jsonl');

/** Appends one JSON line per AI translation attempt so failures (e.g. malformed or
 * truncated XML) can be diagnosed from the raw response after the fact. */
const logAiTranslationDebug = async (entry: Record<string, unknown>): Promise<void> => {
  try {
    await fs.appendFile(
      aiTranslationDebugLogPath(),
      JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n',
      'utf8',
    );
  } catch (error) {
    console.error('[grognard] Failed to write AI translation debug log:', error);
  }
};

const parseTranslationXmlFromResponse = (content: string): string | null => {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as { translationXml?: unknown; translation?: unknown };
    const value = parsed.translationXml ?? parsed.translation;
    return typeof value === 'string' ? value.trim() : null;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced?.[1]) return null;
    try {
      const parsed = JSON.parse(fenced[1].trim()) as { translationXml?: unknown };
      return typeof parsed.translationXml === 'string' ? parsed.translationXml.trim() : null;
    } catch {
      return null;
    }
  }
};

const readErrorResponse = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return `Server returned HTTP ${response.status}.`;

  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Fall through to raw text.
  }

  return `Server returned HTTP ${response.status}: ${text.slice(0, 500)}`;
};

const postAiTranslation = async (
  baseUrl: string,
  settings: AiApiSettings,
  request: AiTranslationRequest,
  model: string,
  signal: AbortSignal,
  mode: StructuredOutputMode,
): Promise<Response> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

  return fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify(buildTranslationRequestBody(model, settings, request, baseUrl, mode)),
    headers,
    method: 'POST',
    signal,
  });
};

const postAiTranslationWithStructuredOutputFallback = async (
  baseUrl: string,
  settings: AiApiSettings,
  request: AiTranslationRequest,
  model: string,
  signal: AbortSignal,
): Promise<Response> => {
  const modes = translationStructuredOutputModes(baseUrl);
  let response = await postAiTranslation(baseUrl, settings, request, model, signal, modes[0]!);

  if (!response.ok) {
    let error = await readErrorResponse(response.clone());
    for (let i = 1; i < modes.length; i++) {
      if (!isStructuredOutputRetryable(response.status, error)) break;
      response = await postAiTranslation(baseUrl, settings, request, model, signal, modes[i]!);
      if (response.ok) break;
      error = await readErrorResponse(response.clone());
    }
  }

  return response;
};

const generateAiTranslation = async ({
  alignmentUnit,
  sourceUnitXml,
  targetLanguage,
  mentions,
  entities,
  dates,
  retryInstruction,
}: AiTranslationRequest): Promise<AiTranslationResult> => {
  const settings = await getAiApiSettings();
  const request = {
    alignmentUnit,
    sourceUnitXml,
    targetLanguage,
    mentions,
    entities,
    dates,
    retryInstruction,
  };
  let baseUrl: string;

  try {
    baseUrl = normalizeOpenAiBaseUrl(settings.baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid base URL.' };
  }

  let model = settings.model.trim();
  if (!model) {
    const models = await listAiModels(settings).catch(() => []);
    model = models[0] ?? '';
  }
  if (!model) {
    return { ok: false, error: 'Choose an AI model in Settings before generating.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    let response = await postAiTranslationWithStructuredOutputFallback(
      baseUrl,
      settings,
      request,
      model,
      controller.signal,
    );

    if (response.status === 404 && settings.model.trim()) {
      const models = await listAiModels(settings).catch(() => []);
      const fallbackModel = models.find((candidate) => candidate !== model);
      if (fallbackModel) {
        response = await postAiTranslationWithStructuredOutputFallback(
          baseUrl,
          settings,
          request,
          fallbackModel,
          controller.signal,
        );
      }
    }

    if (!response.ok) {
      return { ok: false, error: await readErrorResponse(response) };
    }

    const body = (await response.json()) as {
      choices?: { finish_reason?: unknown; message?: { content?: unknown } }[];
      usage?: unknown;
    };
    const choice = body.choices?.[0];
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    const content = choice?.message?.content;
    const debugBase = {
      model,
      finishReason,
      usage: body.usage ?? null,
      sourceUnitXmlLength: sourceUnitXml.length,
      entityCount: entities?.length ?? 0,
      contentLength: typeof content === 'string' ? content.length : null,
      rawContent: typeof content === 'string' ? content : null,
    };

    if (typeof content !== 'string') {
      await logAiTranslationDebug({ ...debugBase, outcome: 'no-message-content' });
      return { ok: false, error: 'AI response did not include message content.' };
    }

    if (finishReason === 'length') {
      await logAiTranslationDebug({ ...debugBase, outcome: 'truncated' });
      return {
        ok: false,
        error:
          'AI response was cut off by the token limit (finish_reason=length) — the passage is too long for the model settings.',
      };
    }

    const translationXml = parseTranslationXmlFromResponse(content);
    if (!translationXml) {
      await logAiTranslationDebug({ ...debugBase, outcome: 'no-translation-xml' });
      return { ok: false, error: 'AI response did not include translationXml.' };
    }

    await logAiTranslationDebug({
      ...debugBase,
      outcome: 'ok',
      translationXmlLength: translationXml.length,
    });
    return { ok: true, translationXml };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Translation request timed out.' };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'AI translation failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

const postAiEntityGloss = async (
  baseUrl: string,
  settings: AiApiSettings,
  request: AiEntityGlossRequest,
  model: string,
  signal: AbortSignal,
  mode: StructuredOutputMode,
): Promise<Response> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

  return fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify(buildEntityGlossRequestBody(model, settings, request, baseUrl, mode)),
    headers,
    method: 'POST',
    signal,
  });
};

const postAiEntityGlossWithStructuredOutputFallback = async (
  baseUrl: string,
  settings: AiApiSettings,
  request: AiEntityGlossRequest,
  model: string,
  signal: AbortSignal,
): Promise<Response> => {
  const modes = translationStructuredOutputModes(baseUrl);
  let response = await postAiEntityGloss(baseUrl, settings, request, model, signal, modes[0]!);

  if (!response.ok) {
    let error = await readErrorResponse(response.clone());
    for (let i = 1; i < modes.length; i++) {
      if (!isStructuredOutputRetryable(response.status, error)) break;
      response = await postAiEntityGloss(baseUrl, settings, request, model, signal, modes[i]!);
      if (response.ok) break;
      error = await readErrorResponse(response.clone());
    }
  }

  return response;
};

const suggestEntityGloss = async (request: AiEntityGlossRequest): Promise<AiEntityGlossResult> => {
  if (!request.targetLanguage?.trim()) {
    return { ok: false, error: 'A target language is required.' };
  }

  const settings = await getAiApiSettings();
  let baseUrl: string;

  try {
    baseUrl = normalizeOpenAiBaseUrl(settings.baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid base URL.' };
  }

  let model = settings.model.trim();
  if (!model) {
    const models = await listAiModels(settings).catch(() => []);
    model = models[0] ?? '';
  }
  if (!model) {
    return { ok: false, error: 'Choose an AI model in Settings before generating.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let response = await postAiEntityGlossWithStructuredOutputFallback(
      baseUrl,
      settings,
      request,
      model,
      controller.signal,
    );

    if (response.status === 404 && settings.model.trim()) {
      const models = await listAiModels(settings).catch(() => []);
      const fallbackModel = models.find((candidate) => candidate !== model);
      if (fallbackModel) {
        response = await postAiEntityGlossWithStructuredOutputFallback(
          baseUrl,
          settings,
          request,
          fallbackModel,
          controller.signal,
        );
      }
    }

    if (!response.ok) {
      return { ok: false, error: await readErrorResponse(response) };
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    const gloss = parseEntityGlossContent(content);
    if (!gloss) {
      return { ok: false, error: 'AI response did not include a gloss.' };
    }
    return { ok: true, gloss };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Gloss suggestion timed out.' };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'AI gloss suggestion failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};

// Hide macOS-injected Edit menu items (Emoji & Symbols, Start Dictation).
if (process.platform === 'darwin') {
  systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
  systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
}

// Must run before app.ready so macOS uses this name in the menu bar (dev and packaged).
app.setName(APP_NAME);

// One-time import of the user's profile from the pre-rename app ("Le Jean-Baptiste").
// Must run after setName (so userData resolves to the new location) and before
// anything reads a userData path.
migrateLegacyUserData();

const getIconPath = () => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'branding')
    : path.join(__dirname, '../resources/branding');
  const pngPath = path.join(base, 'icon.png');
  const svgPath = path.join(base, 'icon.svg');

  // nativeImage loads PNG reliably; SVG often returns empty on macOS.
  if (existsSync(pngPath)) return pngPath;
  if (existsSync(svgPath)) return svgPath;
  return pngPath;
};

const getAppIcon = () => {
  const icon = nativeImage.createFromPath(getIconPath());
  return icon.isEmpty() ? undefined : icon;
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'grognard',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: GAME_ASSET_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: AVATAR_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: BODY_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: PMTILES_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const registerGrognardProtocol = () => {
  protocol.registerFileProtocol('grognard', (request, callback) => {
    try {
      const filePath = fromLocalFileUrl(request.url);
      if (!filePath) throw new Error('invalid grognard:// url');
      callback({ path: path.normalize(filePath) });
    } catch {
      callback({ error: -2 });
    }
  });
};

const isDev = !app.isPackaged;
// Allow opening DevTools in a packaged build too, but only when explicitly requested via env
// var — this keeps it unreachable for normal end users while letting us inspect release builds
// (e.g. `set GROGNARD_OPEN_DEVTOOLS=1 && "Grognard.exe"` on Windows) where devtools would
// otherwise be completely inaccessible.
const devToolsEnabled = isDev || process.env.GROGNARD_OPEN_DEVTOOLS === '1';
const DEV_COMMONS_URL = process.env.COMMONS_URL ?? 'http://localhost:3000';
const PROD_SERVER_PORT = process.env.GROGNARD_SERVER_PORT ?? '3847';
const DEV_READY_TIMEOUT_MS = 120_000;
const DEV_READY_POLL_MS = 1_000;
const PROD_READY_TIMEOUT_MS = 30_000;

const devCommonsUrl = (routePath: string): string => {
  const base = new URL(DEV_COMMONS_URL);
  const route = new URL(routePath, base);
  // Preserve opt-in flags such as ?overmindDevtools=1 when the desktop shell
  // adds its route to COMMONS_URL.
  route.search = base.search;
  route.hash = base.hash;
  return route.toString();
};

if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
}

let mainWindow: BrowserWindow | null = null;
let browserImportServer: import('http').Server | null = null;
let isQuitting = false;
let quitPreparationInProgress = false;
let serverProcess: ChildProcess | null = null;
let openFileWatcher: OpenFileWatcher | null = null;
let activeProjectRoot: string | null = null;
/** Every project root opened this session. Keeps in-flight entity-DB work on a
 * just-left project from being rejected when the active root flips early
 * (open-project IPC activates before renderer onboarding finishes). */
const sessionProjectRoots = new Set<string>();
const approvedRendererReadRoots = new Set<string>();
const approvedRendererWriteRoots = new Set<string>();
/**
 * Every Turso PEDB url declared by a project opened this session — read
 * from that project's own config file by this process, never supplied by
 * the renderer. A `grognard-turso:` reference the renderer sends is only
 * honored if its url is in this set (mirrors sessionProjectRoots for local
 * filesystem paths); an arbitrary url a compromised renderer might invent
 * is not.
 */
const sessionTursoUrls = new Set<string>();

// Read-only pairing token for the external Word add-in's local API (see
// apps/commons/src-server/routes/plugins.ts). Regenerated each launch — the
// add-in re-pairs rather than expecting a stable token across restarts.
const pluginApiToken = randomUUID();

const syncPluginApiState = (): void => {
  void (async () => {
    try {
      const centralEntitiesFolder = await getEntityDbFolder();
      await writePluginApiState(resolvePluginApiStateFilePath(app.getPath('userData')), {
        token: pluginApiToken,
        projectRoot: activeProjectRoot,
        centralEntitiesFolder,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[plugin-api] failed to write plugin API state:', error);
    }
  })();
};

const setActiveProjectRoot = (rootPath: string | null): void => {
  activeProjectRoot = rootPath ? path.resolve(rootPath) : null;
  if (activeProjectRoot) sessionProjectRoots.add(activeProjectRoot);
  syncPluginApiState();
};

const activateProjectBundle = (bundle: ProjectBundle | null): void => {
  setActiveProjectRoot(bundle?.rootPath ?? null);
  setPluginProject(bundle?.projectFilePath ?? null, bundle?.config.plugins ?? []);
  if (bundle?.config.pedb?.backend === 'turso') sessionTursoUrls.add(bundle.config.pedb.url);
  setActiveProjectPedb(bundle?.config.pedb ?? null);
  buildApplicationMenu();
};

const isPathWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const collectRendererPathRoots = async (): Promise<string[]> => {
  const roots = [app.getPath('temp'), app.getPath('userData'), ...sessionProjectRoots];
  if (activeProjectRoot) roots.push(activeProjectRoot);
  const entityDbFolder = await getEntityDbFolder();
  if (entityDbFolder) roots.push(entityDbFolder);
  return roots;
};

/**
 * A `grognard-turso:<url>` reference isn't a filesystem path at all, so it
 * can't be checked with isPathWithin — instead it's approved only if its url
 * belongs to a project this process itself opened this session
 * (sessionTursoUrls, populated from that project's own config file, never
 * from the renderer). Returns null for an ordinary local path, meaning "not
 * a Turso reference, fall through to the existing filesystem check".
 */
const isApprovedTursoRef = (candidate: string): boolean | null => {
  const parsed = parseConnectionRef(candidate);
  return parsed.backend === 'turso' ? sessionTursoUrls.has(parsed.url) : null;
};

const assertRendererWritePath = async (candidate: string): Promise<void> => {
  const tursoApproval = isApprovedTursoRef(candidate);
  if (tursoApproval !== null) {
    if (tursoApproval) return;
    throw new Error('This Turso database is not part of any project opened this session.');
  }
  const roots = await collectRendererPathRoots();
  if (roots.some((root) => isPathWithin(root, candidate))) return;
  if ([...approvedRendererWriteRoots].some((root) => isPathWithin(root, candidate))) return;
  console.error('[writeFile] rejected path outside approved roots:', {
    candidate,
    activeProjectRoot,
    roots,
    approvedRendererWriteRoots: [...approvedRendererWriteRoots],
  });
  throw new Error(
    'Renderer file writes are restricted to the active project and app data folders.',
  );
};

const approveRendererReadRoot = (root: string): void => {
  approvedRendererReadRoots.add(path.resolve(root));
};

const approveRendererWriteRoot = (root: string): void => {
  approvedRendererWriteRoots.add(path.resolve(root));
};

const assertRendererReadPath = async (candidate: string): Promise<void> => {
  const tursoApproval = isApprovedTursoRef(candidate);
  if (tursoApproval !== null) {
    if (tursoApproval) return;
    throw new Error('This Turso database is not part of any project opened this session.');
  }
  const roots = await collectRendererPathRoots();
  if (roots.some((root) => isPathWithin(root, candidate))) return;
  if ([...approvedRendererReadRoots].some((root) => isPathWithin(root, candidate))) return;
  // Logged rather than only thrown: this has been hard to pin down from user
  // reports alone (e.g. auto-tag/disambiguate on a fresh file), so capture
  // exactly what was rejected against what was allowed for the next repro.
  console.error('[readFile] rejected path outside approved roots:', {
    candidate,
    activeProjectRoot,
    roots,
    sessionProjectRoots: [...sessionProjectRoots],
    approvedRendererReadRoots: [...approvedRendererReadRoots],
  });
  throw new Error('Renderer file reads are restricted to approved application paths.');
};

const getCommonsPaths = () => {
  if (isDev) {
    return {
      publicPath: path.join(__dirname, '../../commons/public'),
      serverPath: path.join(__dirname, '../../commons/server/index.mjs'),
    };
  }
  return {
    publicPath: path.join(process.resourcesPath, 'commons/public'),
    serverPath: path.join(process.resourcesPath, 'commons/server/index.mjs'),
  };
};

const startCommonsServer = async (): Promise<void> => {
  const { serverPath } = getCommonsPaths();
  const stderr: string[] = [];

  const child = fork(serverPath, [], {
    env: { ...process.env, PORT: PROD_SERVER_PORT, NODE_ENV: 'production' },
    stdio: 'pipe',
  });
  serverProcess = child;

  child.stdout?.on('data', (data: Buffer) => {
    if (process.env.GROGNARD_DEBUG === '1') console.log('[commons-server]', data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    stderr.push(text);
    if (stderr.length > 20) stderr.shift();
    console.error('[commons-server]', text);
  });

  // The child dying before it answers is the usual packaged-build failure (port
  // already taken, a resource missing from the bundle). Carry its stderr out so
  // the startup dialog can say what actually happened.
  const died = new Promise<never>((_, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const why = signal ?? `code ${code}`;
      const tail = stderr.join('').trim();
      reject(new Error(`Bundled server exited early (${why})${tail ? `:\n${tail}` : '.'}`));
    });
  });

  // Poll the server itself rather than trusting a fixed delay: the old 2s timer
  // resolved whether or not anything was listening, so a slow or failed start
  // surfaced as an unexplained blank-window failure one line later.
  await Promise.race([
    waitForUrl(`http://127.0.0.1:${PROD_SERVER_PORT}/project`, PROD_READY_TIMEOUT_MS),
    died,
  ]);
};

const waitForUrl = (url: string, timeoutMs = DEV_READY_TIMEOUT_MS): Promise<void> => {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = net.request({ method: 'HEAD', url });

      request.on('response', (response) => {
        const ok =
          response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 400;

        if (ok) {
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url} (status ${response.statusCode})`));
          return;
        }

        setTimeout(attempt, DEV_READY_POLL_MS);
      });

      request.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(attempt, DEV_READY_POLL_MS);
      });

      request.end();
    };

    attempt();
  });
};

const waitForDevCommons = async () => {
  await waitForUrl(devCommonsUrl('/project'));
  // Webpack dev build can take ~30s on first run; wait for the app bundle too.
  await waitForUrl(`${DEV_COMMONS_URL}/js/app.js`);
};

const getAppUrl = async (routePath = '/project'): Promise<string> => {
  if (isDev) {
    await waitForDevCommons();
    return devCommonsUrl(routePath);
  }
  await startCommonsServer();
  return `http://127.0.0.1:${PROD_SERVER_PORT}${routePath}`;
};

const sortEntries = (
  a: { name: string; isDirectory: boolean },
  b: { name: string; isDirectory: boolean },
) => {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
};

const collectImportSourcesFromPath = async (
  entryPath: string,
  rootPath = entryPath,
): Promise<DocumentImportSource[]> => {
  const stat = await fs.stat(entryPath);

  if (stat.isFile()) {
    const format = getImportableDocumentFormat(entryPath);
    if (!format) return [];
    if (format === 'xml' && path.basename(entryPath).toLowerCase() === 'entities.xml') {
      return [];
    }

    return [
      {
        format,
        relativePath:
          rootPath === entryPath
            ? path.basename(entryPath)
            : path.relative(rootPath, entryPath) || path.basename(entryPath),
        sourcePath: entryPath,
      },
    ];
  }

  if (!stat.isDirectory()) return [];

  const entries = await fs.readdir(entryPath, { withFileTypes: true });
  const collected = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => collectImportSourcesFromPath(path.join(entryPath, entry.name), rootPath)),
  );

  return collected.flat();
};

const sendMenuAction = (action: string) => {
  mainWindow?.webContents.send('app:menu-action', action);
};

const sendOpenRecentProject = (projectFilePath: string) => {
  mainWindow?.webContents.send('app:open-recent-project', projectFilePath);
};

let cachedRecentProjectFiles: string[] = [];

const refreshRecentProjectsCache = async () => {
  cachedRecentProjectFiles = await getRecentProjects();
};

const rebuildApplicationMenu = () => {
  void refreshRecentProjectsCache().finally(() => buildApplicationMenu());
};

const formatRecentProjectMenuLabel = (
  projectFilePath: string,
  allProjectFilePaths: string[],
): string => {
  const rootPath = path.dirname(projectFilePath);
  const folderName = path.basename(rootPath);
  const duplicateCount = allProjectFilePaths.filter(
    (candidate) => path.basename(path.dirname(candidate)) === folderName,
  ).length;

  if (duplicateCount <= 1) return folderName;

  const parentName = path.basename(path.dirname(rootPath));
  return parentName ? `${folderName} (${parentName})` : folderName;
};

const buildRecentProjectsSubmenu = (): Electron.MenuItemConstructorOptions[] => {
  if (cachedRecentProjectFiles.length === 0) {
    return [{ label: 'No Recent Projects', enabled: false }];
  }

  return cachedRecentProjectFiles.map((projectFilePath) => ({
    label: formatRecentProjectMenuLabel(projectFilePath, cachedRecentProjectFiles),
    click: () => {
      void handleOpenRecentProjectMenu(projectFilePath);
    },
  }));
};

const isMainWindowLive = (): boolean => mainWindow !== null && !mainWindow.isDestroyed();

/**
 * The editor's `beforeunload` handler deliberately permits an application
 * quit after this flag is set. It must be acknowledged by the renderer before
 * Electron starts closing windows; merely firing executeJavaScript and then
 * returning from `before-quit` races the renderer and can leave Windows quit
 * blocked by the unload guard.
 */
const prepareRendererForQuit = async (): Promise<void> => {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;

  try {
    await window.webContents.executeJavaScript('window.__ljbAppQuitting = true');
  } catch (error) {
    // A renderer that is already gone cannot block window shutdown. Continue
    // with Electron's normal quit path; the error is useful when diagnosing a
    // genuinely unresponsive renderer but should never trap the user in app.
    console.warn('[grognard] could not prepare renderer for quit:', error);
  }
};

const waitForMainWindowLoad = (window: BrowserWindow): Promise<void> =>
  new Promise((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => resolve());
      return;
    }
    resolve();
  });

const pendingRendererReadyResolvers: (() => void)[] = [];

const waitForRendererReady = (timeoutMs = 10_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      const index = pendingRendererReadyResolvers.indexOf(onReady);
      if (index >= 0) pendingRendererReadyResolvers.splice(index, 1);
      reject(new Error('Timed out waiting for renderer'));
    }, timeoutMs);

    pendingRendererReadyResolvers.push(onReady);
  });

const ensureMainWindowReady = async (): Promise<BrowserWindow | null> => {
  if (isMainWindowLive()) {
    await waitForMainWindowLoad(mainWindow!);
    mainWindow!.focus();
    return mainWindow;
  }

  await createWindow();
  if (!isMainWindowLive()) return null;

  await waitForMainWindowLoad(mainWindow!);
  mainWindow!.focus();
  return mainWindow;
};

const handleOpenProjectMenu = async () => {
  const reopening = !isMainWindowLive();
  if (!(await ensureMainWindowReady())) return;

  if (reopening) {
    try {
      await waitForRendererReady();
      await new Promise<void>((resolve) => setImmediate(resolve));
    } catch (error) {
      console.error('[grognard] Renderer not ready for open project:', error);
      return;
    }
  }

  sendMenuAction('open-project');
};

const handleOpenRecentProjectMenu = async (projectFilePath: string) => {
  const reopening = !isMainWindowLive();
  if (!(await ensureMainWindowReady())) return;

  if (reopening) {
    try {
      await waitForRendererReady();
      await new Promise<void>((resolve) => setImmediate(resolve));
    } catch (error) {
      console.error('[grognard] Renderer not ready for recent project:', error);
      return;
    }
  }

  sendOpenRecentProject(projectFilePath);
};

const menuSeparator = (): Electron.MenuItemConstructorOptions => ({ type: 'separator' });

const buildEditMenu = (): Electron.MenuItemConstructorOptions => ({
  label: 'Edit',
  submenu: [
    {
      label: 'Undo',
      accelerator: 'CommandOrControl+Z',
      click: () => sendMenuAction('undo'),
    },
    {
      label: 'Redo',
      accelerator: 'CommandOrControl+Shift+Z',
      click: () => sendMenuAction('redo'),
    },
    menuSeparator(),
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    menuSeparator(),
    {
      label: 'Find',
      accelerator: 'CommandOrControl+F',
      click: () => sendMenuAction('open-find'),
    },
    ...(process.platform === 'darwin'
      ? ([
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ] as Electron.MenuItemConstructorOptions[])
      : ([
          { role: 'delete' },
          menuSeparator(),
          { role: 'selectAll' },
        ] as Electron.MenuItemConstructorOptions[])),
  ],
});

const buildViewMenu = (): Electron.MenuItemConstructorOptions => ({
  label: 'View',
  submenu: [
    {
      label: 'Refresh',
      accelerator: 'F5',
      click: () => sendMenuAction('refresh'),
    },
    { role: 'reload' },
    { role: 'forceReload' },
    ...(devToolsEnabled
      ? ([{ role: 'toggleDevTools' }] as Electron.MenuItemConstructorOptions[])
      : []),
    menuSeparator(),
    { role: 'togglefullscreen' },
  ],
});

function buildApplicationMenu() {
  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: 'Settings',
    accelerator: 'CommandOrControl+,',
    click: () => sendMenuAction('open-settings'),
  };

  const recentProjectsItem: Electron.MenuItemConstructorOptions = {
    label: 'Recent Projects',
    submenu: buildRecentProjectsSubmenu(),
  };

  const openProjectItem: Electron.MenuItemConstructorOptions = {
    label: 'Open Project',
    accelerator: 'CommandOrControl+O',
    click: () => {
      void handleOpenProjectMenu();
    },
  };

  const closeProjectItem: Electron.MenuItemConstructorOptions = {
    label: 'Close Project',
    click: () => sendMenuAction('close-project'),
  };

  const saveItem: Electron.MenuItemConstructorOptions = {
    label: 'Save',
    accelerator: 'CommandOrControl+S',
    click: () => sendMenuAction('save'),
  };

  const saveAsItem: Electron.MenuItemConstructorOptions = {
    label: 'Save As',
    accelerator: 'CommandOrControl+Shift+S',
    click: () => sendMenuAction('save-as'),
  };

  const closeTabItem: Electron.MenuItemConstructorOptions = {
    label: 'Close Tab',
    accelerator: 'CommandOrControl+W',
    click: () => sendMenuAction('close-tab'),
  };

  const lookForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: 'Look for Updates',
    click: () => sendMenuAction('look-for-updates'),
  };

  const timeMachineItem: Electron.MenuItemConstructorOptions = {
    label: 'Time Machine',
    click: () => sendMenuAction('open-time-machine'),
  };

  const newFileItem: Electron.MenuItemConstructorOptions = {
    label: 'New File',
    accelerator: 'CommandOrControl+N',
    click: () => sendMenuAction('new-file'),
  };

  const importDocumentsItem: Electron.MenuItemConstructorOptions = {
    label: 'Import Documents',
    click: () => sendMenuAction('import-documents'),
  };

  const importWikisourceItem: Electron.MenuItemConstructorOptions = {
    label: 'Import from Wikisource…',
    click: () => sendMenuAction('wikisource-import'),
  };

  const pluginFileMenuItems: Electron.MenuItemConstructorOptions[] = [];
  if (isPluginEnabledInMain('kanripo-import')) {
    pluginFileMenuItems.push({
      label: 'Import from Kanripo…',
      click: () => sendMenuAction('kanripo-import.open'),
    });
  }
  if (isPluginEnabledInMain('daozang-import')) {
    pluginFileMenuItems.push({
      label: 'Import from Daozang…',
      click: () => sendMenuAction('daozang-import.open'),
    });
  }
  if (isPluginEnabledInMain('cbeta-import')) {
    pluginFileMenuItems.push({
      label: 'Import from CBETA…',
      click: () => sendMenuAction('cbeta-import.open'),
    });
  }
  if (isPluginEnabledInMain('bdrc-import')) {
    pluginFileMenuItems.push({
      label: 'Import from BDRC…',
      click: () => sendMenuAction('bdrc-import.open'),
    });
  }

  const pluginToolsMenuItems: Electron.MenuItemConstructorOptions[] = [];

  const exportDocumentItem: Electron.MenuItemConstructorOptions = {
    label: 'Export Document…',
    click: () => sendMenuAction('export-document'),
  };

  // Shared File actions. On Windows/Linux the hamburger pops the application
  // menu as a flat list, so these must be top-level (not nested under File /
  // View) or the user has to drill into a second submenu.
  const fileMenuItems: Electron.MenuItemConstructorOptions[] = [
    newFileItem,
    importDocumentsItem,
    importWikisourceItem,
    ...pluginFileMenuItems,
    saveItem,
    saveAsItem,
    exportDocumentItem,
    closeTabItem,
    menuSeparator(),
    recentProjectsItem,
    openProjectItem,
    closeProjectItem,
    lookForUpdatesItem,
    timeMachineItem,
    menuSeparator(),
    ...(pluginToolsMenuItems.length > 0 ? [...pluginToolsMenuItems, menuSeparator()] : []),
    ...(process.platform !== 'darwin'
      ? [
          settingsItem,
          menuSeparator(),
          {
            label: 'About Grognard',
            click: () => sendMenuAction('open-about'),
          },
          menuSeparator(),
        ]
      : []),
    process.platform === 'darwin'
      ? {
          label: 'Close Window',
          click: () => mainWindow?.close(),
        }
      : { role: 'quit' },
  ];

  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: APP_NAME,
            submenu: [
              {
                label: `About ${APP_NAME}`,
                click: () => sendMenuAction('open-about'),
              },
              menuSeparator(),
              settingsItem,
              menuSeparator(),
              { role: 'services' },
              menuSeparator(),
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              menuSeparator(),
              {
                label: `Quit ${APP_NAME}`,
                accelerator: 'CommandOrControl+Q',
                click: () => app.quit(),
              },
            ],
          },
          { label: 'File', submenu: fileMenuItems },
          buildEditMenu(),
          buildViewMenu(),
          ...(pluginToolsMenuItems.length > 0
            ? [{ label: 'Tools', submenu: pluginToolsMenuItems }]
            : []),
        ]
      : fileMenuItems;

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const setMainWindowTitle = (title?: string) => {
  mainWindow?.setTitle(title?.trim() ? title : APP_NAME);
};

const getDialogDefaultPath = async (): Promise<string> => {
  const entityDbFolder = await getEntityDbFolder();
  const lastDir = await getLastDialogDir();
  const lastProjectFile = await getValidLastProjectFile();

  return resolveDialogDefaultPath({
    entityDbFolder,
    homeDir: app.getPath('home'),
    lastDialogDir: lastDir,
    lastProjectFile,
    pathExists: existsSync,
  });
};

const rememberDialogDir = (pickedPath: string, kind: 'directory' | 'file') => {
  const dir = kind === 'directory' ? pickedPath : path.dirname(pickedPath);
  void setLastDialogDir(dir).catch(() => undefined);
};

const activateOpenedProject = async (bundle: ProjectBundle) => {
  activateProjectBundle(bundle);
  await writeLastProjectFile(bundle.projectFilePath);
  rebuildApplicationMenu();
  return bundle;
};

const openProjectFromPath = async (projectFilePath: string) => {
  if (!mainWindow) {
    await createWindow();
    if (!mainWindow) return null;
  }

  mainWindow.focus();

  try {
    const stat = await fs.stat(projectFilePath);
    if (!stat.isFile()) {
      await removeMissingRecentProject(projectFilePath);
      rebuildApplicationMenu();
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: APP_NAME,
        message: mainT('open_recent_project_failed_message'),
        detail: projectFilePath,
      });
      return null;
    }
  } catch {
    await removeMissingRecentProject(projectFilePath);
    rebuildApplicationMenu();
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: APP_NAME,
      message: mainT('open_recent_project_failed_message'),
      detail: projectFilePath,
    });
    return null;
  }

  rememberDialogDir(path.dirname(projectFilePath), 'directory');

  try {
    const bundle = await loadProjectFile(projectFilePath);
    if (!bundle) {
      throw new Error(`Could not load project file: ${projectFilePath}`);
    }
    return await activateOpenedProject(bundle);
  } catch (error) {
    console.error('[grognard] openProjectAtPath failed:', error);
    if (!mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: APP_NAME,
        message: mainT('open_project_failed_message'),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
};

const openProjectFromDialog = async () => {
  if (!mainWindow) {
    await createWindow();
    if (!mainWindow) return null;
  }

  mainWindow.focus();

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: mainT('open_project_folder_title'),
    defaultPath: await getDialogDefaultPath(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const pickedFolder = result.filePaths[0].replace(/[/\\]+$/, '');
  const entityDbFolder = await getEntityDbFolder();
  if (entityDbFolder && pickedFolder === entityDbFolder.replace(/[/\\]+$/, '')) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: mainT('entity_db_is_project_title'),
      message: `${pickedFolder}\n\n${mainT('entity_db_is_project_message')}`,
      buttons: [mainT('ok')],
    });
    return null;
  }

  rememberDialogDir(result.filePaths[0], 'directory');

  try {
    const bundle = await loadOrCreateProject(result.filePaths[0]);
    return await activateOpenedProject(bundle);
  } catch (error) {
    console.error('[grognard] openProject failed:', error);
    if (!mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: APP_NAME,
        message: mainT('open_project_failed_message'),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
};

const registerIpcHandlers = () => {
  // On Linux (GNOME/Wayland in particular), Chromium's `prefers-color-scheme`
  // media query does not reliably live-update when the OS theme changes —
  // Electron's nativeTheme module tracks it through the native APIs instead,
  // so we rebroadcast its 'updated' event to the renderer.
  ipcMain.handle('nativeTheme:shouldUseDarkColors', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('nativeTheme:setThemeSource', (_event, source: 'system' | 'light' | 'dark') => {
    if (source !== 'system' && source !== 'light' && source !== 'dark') return false;
    // Pin Chromium's prefers-color-scheme to the app preference so OS dark
    // does not briefly restyle chrome when the user chose light (and vice versa).
    nativeTheme.themeSource = source;
    return true;
  });
  nativeTheme.on('updated', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('nativeTheme:updated', nativeTheme.shouldUseDarkColors);
      }
    }
  });

  ipcMain.handle('signalRendererReady', () => {
    const resolvers = [...pendingRendererReadyResolvers];
    pendingRendererReadyResolvers.length = 0;
    resolvers.forEach((resolve) => resolve());
  });

  ipcMain.handle(
    'bulkBridge:start',
    async (event, request: import('./bulkBridgeJob').BulkBridgeJobRequest) => {
      await assertRendererReadPath(request.sourceEntitiesPath);
      await assertRendererReadPath(request.centralEntitiesPath);
      await assertRendererWritePath(request.sourceEntitiesPath);
      await assertRendererWritePath(request.centralEntitiesPath);
      await assertRendererWritePath(
        path.join(request.centralGrognardDir, 'bulk-import-proposals.jsonl'),
      );
      return startBulkBridgeJob(
        request,
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('bulkBridge:progress', progress);
        },
        openFileWatcher
          ? {
              armWrite: (filePath) => openFileWatcher?.armWrite(filePath),
              ignoreChange: (filePath, mtimeMs) => openFileWatcher?.ignoreChange(filePath, mtimeMs),
            }
          : undefined,
      );
    },
  );
  ipcMain.handle('bulkBridge:cancel', (_event, jobId: string) => cancelBulkBridgeJob(jobId));
  ipcMain.handle(
    'entityIndex:start',
    async (
      event,
      request: import('../../commons/src/desktop/entityIndexTypes').EntityIndexJobRequest,
    ) => {
      await assertRendererReadPath(request.entitiesPath);
      if (request.indexCachePath) await assertRendererWritePath(request.indexCachePath);
      return startEntityIndexJob(request, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('entityIndex:progress', progress);
      });
    },
  );
  ipcMain.handle('entityIndex:cancel', (_event, jobId: string) => cancelEntityIndexJob(jobId));
  ipcMain.handle(
    'entitySqlite:search',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteReadRequest) => {
      await assertRendererReadPath(request.databasePath);
      return searchEntitySqlite(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:get',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteGetRequest) => {
      await assertRendererReadPath(request.databasePath);
      return getEntitySqlite(request);
    },
  );
  ipcMain.handle('entitySqlite:databaseId', async (_event, databasePath: string) => {
    await assertRendererReadPath(databasePath);
    return getEntitySqliteDatabaseId(databasePath);
  });
  ipcMain.handle(
    'entitySqlite:listIds',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteListIdsRequest) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteIds(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:listPanelSummaries',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteListIdsRequest) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqlitePanelSummaries(request);
    },
  );
  ipcMain.handle('entitySqlite:authorityDuplicates', async (_event, databasePath: string) => {
    await assertRendererReadPath(databasePath);
    return listEntitySqliteAuthorityDuplicates(databasePath);
  });
  ipcMain.handle(
    'entitySqlite:applyConcordance',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteApplyConcordanceRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return applyEntitySqliteConcordance(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:rejectConcordance',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteRejectConcordanceRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return rejectEntitySqliteConcordance(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:markDuplicateIntentional',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteMarkDuplicateIntentionalRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return markEntitySqliteDuplicateIntentional(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:backfillDecisionTargets',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteBackfillDecisionTargetsRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return backfillEntitySqliteDecisionTargets(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:softDelete',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSoftDeleteRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return softDeleteEntitySqlite(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:merge',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteMergeRequest) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return mergeEntitySqlite(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:createRelation',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteCreateRelationRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return createEntitySqliteRelation(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:listRelations',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteListRelationsRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteRelations(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:updateRelationStatus',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteUpdateRelationStatusRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return updateEntitySqliteRelationStatus(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:createPopulated',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteCreatePopulatedRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return createPopulatedEntitySqlite(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:applyAuthorityBackfillPatch',
    async (
      _event,
      request: import('./entityDbSqlite/repository').AuthorityBackfillPatch & {
        databasePath: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return applyEntitySqliteAuthorityBackfillPatch(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:reconcileXmlExtractedData',
    async (
      _event,
      request: import('./entityDbSqlite/repository').XmlExtractedRefreshInput & {
        databasePath: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return reconcileEntitySqliteXmlExtractedData(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:entityContentHash',
    async (_event, request: { databasePath: string; entityId: string }) => {
      await assertRendererReadPath(request.databasePath);
      return getEntitySqliteContentHash(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:replaceEntityContent',
    async (
      _event,
      request: {
        sourceDatabasePath: string;
        sourceEntityId: string;
        targetDatabasePath: string;
        targetEntityId: string;
      },
    ) => {
      await assertRendererReadPath(request.sourceDatabasePath);
      await assertRendererReadPath(request.targetDatabasePath);
      await assertRendererWritePath(request.targetDatabasePath);
      return replaceEntitySqliteContent(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:getCentralId',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteGetCentralIdRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      return getEntitySqliteCentralId(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setCentralMapping',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetCentralMappingRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteCentralMapping(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:clearCentralMapping',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteGetCentralIdRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return clearEntitySqliteCentralMapping(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:listMappingsByCentralIds',
    async (
      _event,
      request: {
        databasePath: string;
        userStableId: string;
        centralIds: string[];
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteMappingsByCentralIds(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:listAllCentralMappings',
    async (
      _event,
      request: {
        databasePath: string;
        userStableId: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteAllCentralMappings(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:listLinkedCentralIds',
    async (
      _event,
      request: {
        databasePath: string;
        userStableId: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteLinkedCentralIds(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:countUnlinked',
    async (
      _event,
      request: {
        databasePath: string;
        userStableId: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      return countEntitySqliteUnlinked(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:countEntities',
    async (
      _event,
      request: {
        databasePath: string;
      },
    ) => {
      await assertRendererReadPath(request.databasePath);
      return countEntitySqliteEntities(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:findByAuthority',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteFindByAuthorityRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      return findEntitySqliteByAuthority(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:findByNameDates',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteFindByNameDatesRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      return findEntitySqliteByNameDates(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:forceRejectAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteForceRejectAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return forceRejectEntitySqliteAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:candidates',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteCandidatesRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      return listEntitySqliteCandidates(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:updateNames',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteUpdateNamesRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return updateEntitySqliteNames(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:tombstoneNames',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteTombstoneNamesRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return tombstoneEntitySqliteNames(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:updateDescription',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteUpdateDescriptionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return updateEntitySqliteDescription(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:updateSubtype',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteUpdateSubtypeRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return updateEntitySqliteSubtype(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:getNotes',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteNotesRequest) => {
      await assertRendererReadPath(request.databasePath);
      return getEntitySqliteNotes(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setNote',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteSetNoteRequest) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteNote(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:removeName',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteRemoveNameRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return removeEntitySqliteName(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:addName',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteAddNameRequest) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return addEntitySqliteName(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setUserDate',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetUserEntityDateRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteUserDate(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setUserWorkDate',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetUserWorkDateRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteUserWorkDate(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setWorkType',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetWorkTypeRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteWorkType(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:addNationality',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAddLabeledValueRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return addEntitySqliteNationality(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:addOrigin',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAddLabeledValueRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return addEntitySqliteOrigin(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:addNobleTitle',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteNobleTitleRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return addEntitySqliteNobleTitle(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:updateNobleTitle',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteUpdateNobleTitleRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return updateEntitySqliteNobleTitle(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setUserWorkAuthors',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetUserWorkAuthorsRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteUserWorkAuthors(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:attachAuthority',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAuthorityRefRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return attachEntitySqliteAuthority(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:decoupleAuthority',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAuthorityRefRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return decoupleEntitySqliteAuthority(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:rejectAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return rejectEntitySqliteAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:restoreAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return restoreEntitySqliteAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:removeAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return removeEntitySqliteAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:validateAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return validateEntitySqliteAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:acceptDateAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return acceptEntitySqliteDateAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:acceptDescriptionAssertion',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return acceptEntitySqliteDescriptionAssertion(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:renamePrimaryName',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteRenamePrimaryNameRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return renameEntitySqlitePrimaryName(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:setRomanizedName',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteSetRomanizedNameRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return setEntitySqliteRomanizedName(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:autoCleanNames',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteAutoCleanNamesRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return autoCleanEntitySqliteNames(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:exportXml',
    async (_event, request: import('./entityDbSqlite/readService').EntitySqliteXmlRequest) => {
      await assertRendererReadPath(request.databasePath);
      return exportEntitySqliteXml(request);
    },
  );
  ipcMain.handle(
    'entitySqlite:importXml',
    async (
      _event,
      request: import('./entityDbSqlite/readService').EntitySqliteImportXmlRequest,
    ) => {
      await assertRendererReadPath(request.databasePath);
      await assertRendererWritePath(request.databasePath);
      return importEntitySqliteXml(request);
    },
  );

  ipcMain.handle('openProject', openProjectFromDialog);
  ipcMain.handle('openProjectFolder', openProjectFromDialog);
  ipcMain.handle('openProjectAtPath', (_event, projectFilePath: string) =>
    openProjectFromPath(String(projectFilePath)),
  );

  ipcMain.handle('restoreLastProject', async () => {
    if (!(await getRememberWorkspaceOnStartup())) return null;
    const projectFilePath = await getValidLastProjectFile();
    if (!projectFilePath) return null;
    const bundle = await loadProjectFile(projectFilePath);
    activateProjectBundle(bundle);
    return bundle;
  });

  ipcMain.handle('setAppLocale', (_event, locale: string) => setAppLocale(locale));

  ipcMain.handle('getRememberWorkspaceOnStartup', () => getRememberWorkspaceOnStartup());
  ipcMain.handle('setRememberWorkspaceOnStartup', (_event, remember: boolean) =>
    setRememberWorkspaceOnStartup(Boolean(remember)),
  );

  ipcMain.handle('saveWorkspaceSession', (_event, session: WorkspaceSession) =>
    saveWorkspaceSession(session),
  );

  ipcMain.handle('restoreWorkspaceSession', async () => {
    if (!(await getRememberWorkspaceOnStartup())) return null;

    const session = await getWorkspaceSession();
    const projectFilePath = session?.projectFilePath ?? (await getValidLastProjectFile());
    if (!projectFilePath) return null;

    try {
      const stat = await fs.stat(projectFilePath);
      if (!stat.isFile()) {
        await clearMissingProjectReferences();
        return null;
      }
    } catch {
      await clearMissingProjectReferences();
      return null;
    }

    const bundle = await loadProjectFile(projectFilePath);
    if (!bundle) return null;
    activateProjectBundle(bundle);

    const openFilePaths: string[] = [];
    for (const filePath of session?.openFilePaths ?? []) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) openFilePaths.push(filePath);
      } catch {
        // File was moved or deleted since the last session.
      }
    }

    const activeFilePath =
      session?.activeFilePath && openFilePaths.includes(session.activeFilePath)
        ? session.activeFilePath
        : (openFilePaths[0] ?? null);

    const cursorPositions = Object.fromEntries(
      Object.entries(session?.cursorPositions ?? {}).filter(([filePath]) =>
        openFilePaths.includes(filePath),
      ),
    );

    return { activeFilePath, bundle, cursorPositions, openFilePaths };
  });

  ipcMain.handle(
    'readDirectory',
    async (_event, dirPath: string, options?: { allFiles?: boolean }) => {
      await assertRendererReadPath(dirPath);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => {
          if (entry.name.startsWith('.')) return false;
          if (options?.allFiles) return true;
          return entry.isDirectory() || entry.name.toLowerCase().endsWith('.xml');
        })
        .map((entry) => ({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          isDirectory: entry.isDirectory(),
        }))
        .sort(sortEntries);
    },
  );

  ipcMain.handle('readFile', async (_event, filePath: string) => {
    await assertRendererReadPath(filePath);
    const text = await fs.readFile(filePath, 'utf-8');
    // Unlike TextDecoder, Node's 'utf-8' fs encoding leaves a leading BOM in
    // place. Project config files (project.json, project-metadata.json, …)
    // are JSON/XML and can pick up a BOM from Windows-native tools (Notepad,
    // some editors default to it) — an unstripped BOM makes JSON.parse throw,
    // which callers then silently treat as "file doesn't exist".
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  });

  ipcMain.handle('readFileAutoEncoding', async (_event, filePath: string) => {
    await assertRendererReadPath(filePath);
    return decodeTextBuffer(await fs.readFile(filePath));
  });

  ipcMain.handle(
    'writeClipboardRich',
    (_event, flavors: { text: string; html?: string; rtf?: string }) => {
      clipboard.write({
        text: flavors.text,
        ...(flavors.html ? { html: flavors.html } : {}),
        ...(flavors.rtf ? { rtf: flavors.rtf } : {}),
      });
    },
  );

  ipcMain.handle('extractOdtText', async (_event, filePath: string) => {
    await assertRendererReadPath(filePath);
    return extractOdtText(filePath);
  });

  ipcMain.handle('extractDocxText', async (_event, filePath: string) => {
    await assertRendererReadPath(filePath);
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      warnings: result.messages.map((message) => message.message),
    };
  });

  ipcMain.handle('writeFile', async (_event, filePath: string, content: string) => {
    await assertRendererWritePath(filePath);
    await fs.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('writeBinaryFile', async (_event, filePath: string, bytes: Uint8Array) => {
    await assertRendererWritePath(filePath);
    await fs.writeFile(filePath, Buffer.from(bytes));
  });

  ipcMain.handle('pathExists', async (_event, filePath: string) => {
    return pathExists(filePath);
  });

  ipcMain.handle('readAchievementsFile', async () => {
    return readAchievementsFile();
  });

  ipcMain.handle('writeAchievementsFile', async (_event, content: string) => {
    await writeAchievementsFile(content);
  });

  ipcMain.handle('readSourceProfiles', async () => readSourceProfilesFile());

  ipcMain.handle(
    'upsertSourceProfile',
    async (_event, profile: import('../../commons/src/desktop/sourceProfileTypes').SourceProfile) =>
      upsertSourceProfileInFile(profile),
  );

  ipcMain.handle('deleteSourceProfile', async (_event, profileId: string) =>
    deleteSourceProfileFromFile(profileId),
  );

  ipcMain.handle('getGameAssetColorStats', (_event, key: string) => {
    return getGameAssetColorStats(key);
  });

  ipcMain.handle('saveCertificatePng', async (_event, bytes: Uint8Array, suggestedName: string) => {
    if (!mainWindow) return false;
    mainWindow.focus();
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(await getDialogDefaultPath(), suggestedName),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    rememberDialogDir(result.filePath, 'file');
    return true;
  });

  ipcMain.handle('getCachedLeaderboardToken', () => getCachedLeaderboardToken());
  ipcMain.handle('clearCachedLeaderboardToken', () => clearCachedLeaderboardToken());
  ipcMain.handle('startLeaderboardDeviceFlow', () => startLeaderboardDeviceFlow());
  ipcMain.handle(
    'pollLeaderboardDeviceFlow',
    (_event, deviceCode: string, intervalSeconds: number, expiresInSeconds: number) =>
      pollLeaderboardDeviceFlow(deviceCode, intervalSeconds, expiresInSeconds),
  );

  ipcMain.handle('statFile', async (_event, filePath: string) => {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  });

  ipcMain.handle('syncWatchedFiles', (_event, paths: string[]) => {
    openFileWatcher?.sync(Array.isArray(paths) ? paths : []);
  });

  ipcMain.handle('ignoreFileChange', (_event, filePath: string, mtimeMs: number) => {
    openFileWatcher?.ignoreChange(filePath, mtimeMs);
  });

  ipcMain.handle('armFileWrite', (_event, filePath: string) => {
    openFileWatcher?.armWrite(filePath);
  });

  ipcMain.handle('findXmlFilesByName', async (_event, rootPath: string, query: string) => {
    return findXmlFilesByName(rootPath, query);
  });

  ipcMain.handle('listProjectXmlFiles', async (_event, rootPath: string) => {
    return listProjectXmlFiles(rootPath);
  });

  ipcMain.handle('reloadProjectBundle', async (_event, projectFilePath: string) => {
    const bundle = await loadProjectFile(projectFilePath);
    if (bundle) activateProjectBundle(bundle);
    return bundle;
  });

  ipcMain.handle('clearActiveProject', async () => {
    activateProjectBundle(null);
    return true;
  });

  ipcMain.handle(
    'installCatalogSchema',
    async (_event, projectFilePath: string, catalogId: string) => {
      return installCatalogSchema(projectFilePath, catalogId);
    },
  );

  ipcMain.handle(
    'installLocalSchema',
    async (_event, projectFilePath: string, rngPath: string, cssPath?: string | null) => {
      return installLocalSchema(projectFilePath, rngPath, cssPath);
    },
  );

  ipcMain.handle(
    'plugins:ensureSchemaContribution',
    async (_event, pluginId: string, projectFilePath: string) => {
      if (pluginId !== 'cjk-dates' || !isPluginEnabledInMain(pluginId)) return { merged: false };
      const bundle = await loadProjectFile(projectFilePath);
      if (!bundle) return { merged: false };
      const merged = await ensureSanmiaoDatesSchemaMerged(bundle);
      return { merged };
    },
  );

  ipcMain.handle(
    'plugins:invokePython',
    async (event, pluginId: string, payload: Record<string, unknown>) => {
      const useStream = Boolean(payload.chunks || payload.dates);
      return invokePluginPython(
        pluginId,
        payload,
        useStream
          ? (progress) => {
              event.sender.send('plugins:pythonProgress', pluginId, progress);
            }
          : undefined,
      );
    },
  );

  ipcMain.handle('kanripo:search', async (_event, query: string) => {
    return searchKanripoWorks(typeof query === 'string' ? query : '');
  });

  ipcMain.handle('kanripo:clone', async (_event, krId: string) => {
    const { cachePath, reused } = await cloneKanripoWork(String(krId));
    const files = await listKanripoTxtFiles(cachePath);
    return { cachePath, reused, files };
  });

  ipcMain.handle('kanripo:fetchJuan', async (_event, krId: string, juan: string) => {
    const result = (await invokePluginPython('kanripo-import', {
      op: 'fetch_juan',
      kr_id: String(krId),
      juan: String(juan),
      cache_root: kanripoCacheRoot(),
    })) as { kr_id: string; loc: string; path: string; files: string[] };
    return { ...result, reused: false };
  });

  ipcMain.handle('kanripo:flush', async (_event, krId: string) => {
    await flushKanripoWork(String(krId));
    return { ok: true };
  });

  ipcMain.handle('daozang:status', async () => {
    if (!isPluginEnabledInMain('daozang-import')) {
      return {
        ready: false,
        textCount: 0,
        source: 'none',
        manifest: {},
        cacheRoot: daozangCacheRoot(),
      };
    }
    return daozangCorpusStatus();
  });

  ipcMain.handle('daozang:search', async (_event, query: string) => {
    return searchDaozangWorks(typeof query === 'string' ? query : '');
  });

  ipcMain.handle('daozang:resolveText', async (_event, relPath: string) => {
    const abs = daozangTextPath(String(relPath || ''));
    approveRendererReadRoot(path.dirname(abs));
    return abs;
  });

  ipcMain.handle('daozang:readText', async (_event, relPath: string) => {
    if (!isPluginEnabledInMain('daozang-import')) {
      throw new Error('Enable the Daozang import plugin first.');
    }
    const { ready } = daozangCorpusStatus();
    if (!ready) {
      throw new Error('Daozang corpus is not ready.');
    }
    const rel = String(relPath || '').trim();
    if (!rel) throw new Error('No Daozang text selected.');
    const abs = daozangTextPath(rel);
    if (!existsSync(abs)) {
      throw new Error(`Daozang text not found: ${rel}`);
    }
    const decoded = decodeTextBuffer(await fs.readFile(abs));
    return { text: decoded.text, rel_path: rel, path: abs };
  });

  ipcMain.handle(
    'kanripo:fetchCtextParallel',
    async (
      _event,
      options: {
        url?: string;
        row?: number | string;
        id?: string;
        contains?: string;
        section?: string;
      },
    ) => {
      const url = String(options?.url || '').trim();
      if (!url) throw new Error('Missing ctext wiki URL.');
      return fetchCtextWikiParallel({
        url,
        row: options?.row,
        id: options?.id,
        contains: options?.contains,
        section: options?.section,
      });
    },
  );

  ipcMain.handle('kanripo:listCtextSections', async (_event, url: string) => {
    return listCtextWikiSections(String(url || '').trim());
  });

  ipcMain.handle(
    'kanripo:fetchParallelUrl',
    async (
      _event,
      options: {
        url?: string;
        row?: number | string;
        id?: string;
        contains?: string;
        section?: string;
        fetchAll?: boolean;
      },
    ) => {
      const url = String(options?.url || '').trim();
      if (!url) throw new Error('Missing parallel URL.');
      return fetchParallelFromUrl({
        url,
        section: options?.section,
        contains: options?.contains,
        fetchAll: options?.fetchAll,
      });
    },
  );

  ipcMain.handle('kanripo:listWikisourceVolumes', async (_event, url: string) => {
    return listWikisourceCatalog(String(url || '').trim());
  });

  const loadWikisourceImport = async () => {
    const moduleDir = path.dirname(getWikisourceModulePath());
    return import(pathToFileURL(path.join(moduleDir, 'wikisourceImport.mjs')).href) as Promise<{
      inspectWikisourceImport: (url: string) => Promise<unknown>;
      fetchWikisourceImportPages: (options: {
        apiHost: string;
        titles: string[];
      }) => Promise<unknown[]>;
    }>;
  };

  ipcMain.handle('viaf:fetchCluster', async (_event, viafId: string) => {
    const id = String(viafId || '').replace(/\D/g, '');
    if (!id) throw new Error('Missing VIAF id');
    const response = await fetch(`https://viaf.org/viaf/${id}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`VIAF cluster ${id} failed (${response.status})`);
    }
    return response.json();
  });

  ipcMain.handle('wikisource:inspect', async (_event, url: string) => {
    const mod = await loadWikisourceImport();
    return mod.inspectWikisourceImport(String(url || '').trim());
  });

  ipcMain.handle('bdrc:inspect', async (_event, input: string) => {
    if (!isPluginEnabledInMain('bdrc-import'))
      throw new Error('Enable the BDRC import plugin first.');
    const mod = await loadBdrcImport();
    return mod.inspectBdrcEtext(String(input || '').trim());
  });

  ipcMain.handle('bdrc:import', async (_event, input: string, opts?: { windowSize?: number }) => {
    if (!isPluginEnabledInMain('bdrc-import'))
      throw new Error('Enable the BDRC import plugin first.');
    const mod = await loadBdrcImport();
    return mod.runBdrcImport(String(input || '').trim(), opts ?? {});
  });

  ipcMain.handle(
    'bdrc:importToProject',
    async (
      _event,
      input: string,
      opts: {
        projectRoot: string;
        forceRefresh?: boolean;
        split?: boolean;
        windowSize?: number;
      },
    ) => {
      if (!isPluginEnabledInMain('bdrc-import'))
        throw new Error('Enable the BDRC import plugin first.');
      return importBdrcToProject(String(input || '').trim(), opts);
    },
  );

  ipcMain.handle('cbeta:corpusStatus', () => cbetaCorpusStatus());
  ipcMain.handle('cbeta:ensureCorpus', () => ensureCbetaCorpus());

  ipcMain.handle(
    'wikisource:fetchPage',
    async (_event, options: { apiHost?: string; title?: string }) => {
      const apiHost = String(options?.apiHost || '').trim();
      const title = String(options?.title || '').trim();
      if (!apiHost || !title) throw new Error('Missing Wikisource host or title.');
      const mod = await loadWikisourceImport();
      const pages = await mod.fetchWikisourceImportPages({ apiHost, titles: [title] });
      return pages[0];
    },
  );

  ipcMain.handle(
    'checkSchemaUpdate',
    async (_event, projectFilePath: string, options?: { force?: boolean }) => {
      return checkCatalogSchemaUpdate(projectFilePath, options);
    },
  );

  ipcMain.handle('applyCatalogSchemaUpdate', async (_event, projectFilePath: string) => {
    return applyCatalogSchemaUpdate(projectFilePath);
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    return checkForAppUpdatesManually();
  });

  ipcMain.handle('timeMachine:listSnapshots', async (_event, projectRootPath: string) => {
    return listTimeMachineSnapshots(projectRootPath);
  });

  ipcMain.handle(
    'timeMachine:createSnapshot',
    async (_event, projectRootPath: string, projectName: string) => {
      return createTimeMachineSnapshot(projectRootPath, projectName);
    },
  );

  ipcMain.handle(
    'timeMachine:pickRestoreDestination',
    async (_event, projectRootPath: string, snapshotId: string) => {
      if (!mainWindow) return null;

      mainWindow.focus();
      const result = await dialog.showOpenDialog(mainWindow, {
        defaultPath: getDefaultTimeMachineRestorePath(projectRootPath, snapshotId),
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose restore destination',
      });

      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    },
  );

  ipcMain.handle(
    'timeMachine:restoreSnapshot',
    async (_event, snapshotPath: string, destinationPath: string) => {
      await restoreTimeMachineSnapshotToDirectory(snapshotPath, destinationPath);
    },
  );

  ipcMain.handle(
    'timeMachine:restoreSnapshotToProject',
    async (_event, projectRootPath: string, projectName: string, snapshotPath: string) => {
      return restoreTimeMachineSnapshotToProject(projectRootPath, projectName, snapshotPath);
    },
  );

  ipcMain.handle('pickSchemaFiles', async () => {
    const dialogParent = getTopNativeDialogWindow() ?? mainWindow;
    if (!dialogParent) return null;
    dialogParent.focus();
    const rngResult = await dialog.showOpenDialog(dialogParent, {
      properties: ['openFile'],
      filters: [{ name: 'RelaxNG schema', extensions: ['rng', 'rnc'] }],
      title: mainT('choose_schema_file_title'),
      defaultPath: await getDialogDefaultPath(),
    });
    if (rngResult.canceled || !rngResult.filePaths[0]) return null;
    approveRendererReadRoot(rngResult.filePaths[0]);
    rememberDialogDir(rngResult.filePaths[0], 'file');

    const cssResult = await dialog.showOpenDialog(dialogParent, {
      properties: ['openFile'],
      filters: [{ name: 'CSS stylesheet', extensions: ['css'] }],
      title: mainT('choose_css_file_title'),
      message: mainT('choose_css_file_message'),
    });
    if (!cssResult.canceled && cssResult.filePaths[0])
      approveRendererReadRoot(cssResult.filePaths[0]);
    return {
      rngPath: rngResult.filePaths[0],
      cssPath: cssResult.canceled || !cssResult.filePaths[0] ? null : cssResult.filePaths[0],
    };
  });

  ipcMain.handle('pickDocumentImportSources', async () => {
    if (!mainWindow) return null;

    mainWindow.focus();
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        {
          name: 'Importable documents',
          extensions: ['txt', 'md', 'markdown', 'rtf', 'docx', 'odt', 'xml'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
      message: mainT('import_documents_message'),
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      title: mainT('import_documents_title'),
      defaultPath: await getDialogDefaultPath(),
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    rememberDialogDir(path.dirname(result.filePaths[0]), 'directory');
    for (const filePath of result.filePaths) approveRendererReadRoot(filePath);

    const collected = await Promise.all(
      result.filePaths.map((filePath) => collectImportSourcesFromPath(filePath)),
    );

    return collected.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  });

  ipcMain.handle('createTempDocument', async (_event, content: string) => {
    const dir = path.join(app.getPath('temp'), 'grognard', `${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'untitled.xml');
    await fs.writeFile(filePath, content, 'utf-8');
    return { filePath, filename: 'untitled.xml' };
  });

  // Reads apps/desktop/package.json version (stamped from the release tag in CI).
  ipcMain.handle('getAppVersion', () => app.getVersion());

  ipcMain.handle('getEncoderName', async () => getEncoderName());

  ipcMain.handle('setEncoderName', async (_event, name: string) => {
    await setEncoderName(name);
  });

  ipcMain.handle(
    'setTranslationSpellcheck',
    (event, options: { enabled: boolean; languageCodes?: string[] }): void => {
      applyTranslationSpellcheck(event.sender, {
        enabled: options?.enabled === true,
        languageCodes: Array.isArray(options?.languageCodes)
          ? options.languageCodes.filter((code): code is string => typeof code === 'string')
          : [],
      });
    },
  );

  ipcMain.handle('getEntityDbFolder', async () => getEntityDbFolder());

  const getAuthorityDbDir = async (): Promise<string | null> => {
    const folder = await getLocalAuthorityAssetsDir();
    return path.join(folder, AUTHORITY_DB_DIRNAME);
  };

  ipcMain.handle('authorityDb:statuses', async () =>
    getAuthorityStatuses(await getAuthorityDbDir()),
  );

  ipcMain.handle('authorityRef:lookup', async (_event, request: AuthorityRefLookupRequest) =>
    lookupAuthorityRef(await getAuthorityDbDir(), request),
  );

  const activeAuthorityDownloads = new Set<AuthoritySourceId>();

  ipcMain.handle('authorityDb:download', async (event, sourceId: AuthoritySourceId) => {
    const baseDir = await getAuthorityDbDir();
    if (!baseDir) return { ok: false, error: 'No entity database folder configured.' };
    if (activeAuthorityDownloads.has(sourceId)) {
      return { ok: false, error: 'Download already in progress.' };
    }

    activeAuthorityDownloads.add(sourceId);
    // Throttle progress events: these fire per network chunk.
    let lastSent = 0;
    try {
      const manifest = await downloadAuthoritySource(baseDir, sourceId, (progress) => {
        const now = Date.now();
        if (now - lastSent < 250) return;
        lastSent = now;
        if (!event.sender.isDestroyed()) event.sender.send('authorityDb:progress', progress);
      });
      new Notification({
        title: 'Authority database installed',
        body: `${sourceId.toUpperCase()} ${manifest.version} is ready to use.`,
      }).show();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notification({
        title: 'Authority database download failed',
        body: `${sourceId.toUpperCase()}: ${message}`,
      }).show();
      return { ok: false, error: message };
    } finally {
      activeAuthorityDownloads.delete(sourceId);
    }
  });

  ipcMain.handle('authorityDb:promptDownload', async () => {
    if (!mainWindow) return 'declined';

    // A past decline is remembered so the user isn't nagged on every project
    // open; downloads stay available from the authority UI later.
    const baseDir = await getAuthorityDbDir();
    if (!baseDir) return 'declined';
    const declinedMarker = path.join(baseDir, 'download-declined.json');
    if (existsSync(declinedMarker)) return 'declined';

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [mainT('download'), mainT('not_now')],
      defaultId: 0,
      cancelId: 1,
      message: mainT('download_chinese_authority_question'),
      detail: mainT('download_chinese_authority_detail'),
    });
    if (result.response !== 0) {
      await fs.mkdir(baseDir, { recursive: true });
      await fs.writeFile(
        declinedMarker,
        JSON.stringify({ declinedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      );
      return 'declined';
    }
    return 'accepted';
  });

  ipcMain.handle('mapTiles:status', async () => {
    const mapTilesDir = await getMapTilesDir();
    const regions = await listInstalledMapTileRegions(mapTilesDir);
    return {
      installed: regions.length > 0,
      path: regions.length > 0 ? mapTilesDir : null,
      regions,
    };
  });

  ipcMain.handle('mapTiles:remove', async (_event, bundleId: string) => {
    try {
      const mapTilesDir = await getMapTilesDir();
      await removeMapTileBundle(mapTilesDir, bundleId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  const notifyMapTilesDownload = (bundle: MapTileBundleSpec, ok: boolean, detail: string) => {
    if (!mainWindow) return;
    new Notification({
      title: ok ? 'Map tiles installed' : 'Map tiles download failed',
      body: `${bundle.label ?? bundle.id}: ${detail}`,
    }).show();
  };

  const activeMapTileDownloads = new Set<string>();
  const activeMapTileDownloadState = new Map<
    string,
    { bundleId: string; message: string; receivedBytes?: number; totalBytes?: number | null }
  >();

  ipcMain.handle('mapTiles:downloadStatus', async () => ({
    active: [...activeMapTileDownloadState.values()],
  }));

  const runMapTilesDownload = async (event: { sender: WebContents }, bundle: MapTileBundleSpec) => {
    if (activeMapTileDownloads.has(bundle.id)) {
      return { ok: false, error: 'Download already in progress.' };
    }
    activeMapTileDownloads.add(bundle.id);
    let lastSent = 0;
    try {
      const mapTilesDir = await getMapTilesDir();
      activeMapTileDownloadState.set(bundle.id, {
        bundleId: bundle.id,
        message: mainT('preparing_download'),
      });
      const { path: installedPath } = await installMapTileBundle({
        mapTilesDir,
        bundle,
        onProgress: (message, receivedBytes, totalBytes) => {
          const now = Date.now();
          if (now - lastSent < 250) return;
          lastSent = now;
          activeMapTileDownloadState.set(bundle.id, {
            bundleId: bundle.id,
            message,
            receivedBytes,
            totalBytes,
          });
          if (!event.sender.isDestroyed()) {
            event.sender.send('mapTiles:progress', {
              bundleId: bundle.id,
              message,
              receivedBytes,
              totalBytes,
            });
          }
        },
      });
      activeMapTileDownloadState.delete(bundle.id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('mapTiles:downloadComplete', {
          bundleId: bundle.id,
          installed: true,
          path: installedPath,
        });
      }
      notifyMapTilesDownload(bundle, true, 'ready to use.');
      return { ok: true, path: installedPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      activeMapTileDownloadState.delete(bundle.id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('mapTiles:downloadComplete', {
          bundleId: bundle.id,
          installed: false,
          error: message,
        });
      }
      notifyMapTilesDownload(bundle, false, message);
      return { ok: false, error: message };
    } finally {
      activeMapTileDownloads.delete(bundle.id);
    }
  };

  ipcMain.handle('mapTiles:promptDownload', async () => {
    if (!mainWindow) return 'declined';

    const mapTilesDir = await getMapTilesDir();
    const declinedMarker = path.join(mapTilesDir, 'download-declined.json');
    if (existsSync(declinedMarker)) return 'declined';

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [mainT('download'), mainT('not_now')],
      defaultId: 0,
      cancelId: 1,
      message: mainT('download_map_tiles_question'),
      detail: mainT('download_map_tiles_detail'),
    });
    if (result.response !== 0) {
      await fs.mkdir(mapTilesDir, { recursive: true });
      await fs.writeFile(
        declinedMarker,
        JSON.stringify({ declinedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      );
      return 'declined';
    }
    return 'accepted';
  });

  ipcMain.handle('mapTiles:download', async (event, bundle: MapTileBundleSpec) => {
    return runMapTilesDownload(event, bundle);
  });

  ipcMain.handle('mapTiles:downloadBackground', async (event, bundle: MapTileBundleSpec) => {
    void runMapTilesDownload(event, bundle);
    return { ok: true, queued: true };
  });

  // Named "OrNull" for historical reasons (it used to wrap getEntityDbFolder,
  // which really can be unconfigured) - getLocalAuthorityAssetsDir always
  // resolves, but every call site below already handles a null folder, so
  // this stays a thin passthrough rather than touching every handler.
  const getEntityDbFolderOrNull = async () => getLocalAuthorityAssetsDir();

  ipcMain.handle('authorityPack:statuses', async () => {
    const folder = await getEntityDbFolderOrNull();
    if (!folder) return [];
    return await getAuthorityPackStatuses(folder);
  });

  ipcMain.handle('authorityPack:read', async (_event, packId: string, dateFilter?: unknown) => {
    const folder = await getEntityDbFolderOrNull();
    if (!folder) throw new Error('No entity database folder configured.');
    try {
      return await readAuthorityPackFile(
        folder,
        packId as import('../../commons/src/desktop/authorityPackTypes').AuthorityPackId,
        dateFilter as
          | import('../../commons/src/desktop/authorityPackTypes').AuthorityPackDateFilter
          | undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/^Unknown pack:/i.test(message)) return [];
      throw error;
    }
  });

  ipcMain.handle(
    'authorityPack:lookupByIds',
    async (_event, packId: string, authorityIds: unknown) => {
      const folder = await getEntityDbFolderOrNull();
      if (!folder) throw new Error('No entity database folder configured.');
      const ids = Array.isArray(authorityIds)
        ? authorityIds.map((id) => String(id ?? '').trim()).filter(Boolean)
        : [];
      return lookupAuthorityPackRowsByIds(
        folder,
        packId as import('../../commons/src/desktop/authorityPackTypes').AuthorityPackId,
        ids,
      );
    },
  );

  ipcMain.handle('authorityPack:installFrom', async (_event, sourcePacksRoot: string) => {
    const folder = await getEntityDbFolderOrNull();
    if (!folder) return { ok: false, error: 'No entity database folder configured.' };
    try {
      const { copied } = await installAuthorityPacksFrom(sourcePacksRoot, folder);
      return { ok: true, copied };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('plugins:getSnapshot', async () => {
    const snapshot = await getPluginHostSnapshot();
    return {
      plugins: snapshot.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        license: plugin.license,
        author: plugin.author,
        homepage: plugin.homepage,
        languages: plugin.languages,
        enabled: plugin.enabled,
        manifestError: plugin.manifestError,
        manifest: plugin.manifestError
          ? undefined
          : {
              languagePrompt: plugin.manifest.languagePrompt,
              contributions: plugin.manifest.contributions,
            },
      })),
      state: snapshot.state,
    };
  });

  ipcMain.handle('plugins:setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    const snapshot = await setPluginEnabled(pluginId, enabled);
    buildApplicationMenu();
    return {
      plugins: snapshot.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        license: plugin.license,
        author: plugin.author,
        homepage: plugin.homepage,
        languages: plugin.languages,
        enabled: plugin.enabled,
        manifestError: plugin.manifestError,
        manifest: plugin.manifestError
          ? undefined
          : {
              languagePrompt: plugin.manifest.languagePrompt,
              contributions: plugin.manifest.contributions,
            },
      })),
      state: snapshot.state,
    };
  });

  ipcMain.handle('plugins:installFrom', async (_event, sourceDir: string) => {
    const snapshot = await installPluginFromDirectory(sourceDir);
    buildApplicationMenu();
    return {
      plugins: snapshot.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        license: plugin.license,
        author: plugin.author,
        homepage: plugin.homepage,
        languages: plugin.languages,
        enabled: plugin.enabled,
        manifestError: plugin.manifestError,
        manifest: plugin.manifestError
          ? undefined
          : {
              languagePrompt: plugin.manifest.languagePrompt,
              contributions: plugin.manifest.contributions,
            },
      })),
      state: snapshot.state,
    };
  });

  ipcMain.handle('plugins:getRemoteIndex', async () => fetchRemotePluginIndex());

  ipcMain.handle('plugins:installRemote', async (_event, entry) => {
    const index = await fetchRemotePluginIndex();
    const canonical = index.plugins.find(
      (candidate) =>
        candidate.id === entry?.id &&
        candidate.version === entry?.version &&
        candidate.fileName === entry?.fileName &&
        candidate.sha256 === entry?.sha256,
    );
    if (!canonical) throw new Error('Plugin release is no longer present in the remote registry.');
    await installRemotePlugin(canonical);
    const snapshot = await getPluginHostSnapshot();
    buildApplicationMenu();
    return {
      plugins: snapshot.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        license: plugin.license,
        author: plugin.author,
        homepage: plugin.homepage,
        languages: plugin.languages,
        enabled: plugin.enabled,
        manifestError: plugin.manifestError,
        manifest: plugin.manifestError
          ? undefined
          : {
              languagePrompt: plugin.manifest.languagePrompt,
              contributions: plugin.manifest.contributions,
            },
      })),
      state: snapshot.state,
    };
  });

  ipcMain.handle('plugins:pickInstallFolder', async () => {
    const parent = getTopNativeDialogWindow() ?? mainWindow ?? undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: mainT('install_plugin_title'),
      message: mainT('select_plugin_folder_message'),
      defaultPath: await getDialogDefaultPath(),
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    // The renderer may create entities.xml immediately for a newly selected
    // folder, before setEntityDbFolder persists it. Treat the explicit folder
    // selection as approval for that initial write.
    approveRendererWriteRoot(result.filePaths[0]);
    rememberDialogDir(result.filePaths[0], 'directory');
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('plugins:dismissLanguagePrompt', async (_event, pluginId: string) => {
    await dismissPluginLanguagePrompt(pluginId);
  });

  ipcMain.handle('plugins:isEnabled', async (_event, pluginId: string) => {
    return isPluginEnabledInMain(pluginId);
  });

  ipcMain.handle('plugins:getModuleUrl', async (_event, pluginId: string) => {
    return getPluginEntryModuleUrl(pluginId);
  });

  const emitAuthorityLifecycleProgress = (
    event: Electron.IpcMainInvokeEvent,
    progress: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleProgress,
  ) => {
    if (!event.sender.isDestroyed()) event.sender.send('authorityLifecycle:progress', progress);
  };

  ipcMain.handle('authorityLifecycle:get', async () => {
    const folder = await getEntityDbFolderOrNull();
    return getAuthorityLifecycleStatus(folder);
  });

  ipcMain.handle(
    'authorityLifecycle:maybeCheckUpdates',
    async (_event, options?: { force?: boolean }) => {
      const folder = await getEntityDbFolderOrNull();
      return maybeCheckAuthorityUpdates(folder, options);
    },
  );

  ipcMain.handle('authorityLifecycle:revealFolder', async () => {
    // Reveals the local authority-assets folder (packs/databases), not the
    // entity database folder - these live separately now, see
    // getLocalAuthorityAssetsDir in projectPrefs.ts.
    const folder = await getEntityDbFolderOrNull();
    if (!folder) return false;
    const error = await shell.openPath(folder);
    if (error) {
      console.error('Failed to reveal authority assets folder:', error);
      return false;
    }
    return true;
  });

  ipcMain.handle(
    'authorityLifecycle:setEnabled',
    async (
      event,
      options: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleSetEnabledOptions,
    ) => {
      const folder = await getEntityDbFolderOrNull();
      const result = await setAuthorityLifecycleEnabled(folder, options, (progress) =>
        emitAuthorityLifecycleProgress(event, progress),
      );
      if (result.ok && options.enabled) {
        const label =
          options.profile === 'japanese'
            ? 'NDL and Wikidata tagging packs'
            : options.profile === 'tibetan'
              ? 'Wikidata tagging packs'
              : 'CBDB, DILA, and Wikidata tagging packs';
        new Notification({
          title: 'Offline authorities ready',
          body: `${label} were installed from the registry.`,
        }).show();
      } else if (!result.ok) {
        new Notification({
          title: 'Authority setup failed',
          body: result.error ?? 'Could not download or compile authority data.',
        }).show();
      }
      return result;
    },
  );

  ipcMain.handle('authorityLifecycle:setReferenceDataEnabled', async (event, enabled: boolean) => {
    const folder = await getEntityDbFolderOrNull();
    const result = await setAuthorityLifecycleReferenceDataEnabled(
      folder,
      Boolean(enabled),
      (progress) => emitAuthorityLifecycleProgress(event, progress),
    );
    if (result.ok && enabled) {
      new Notification({
        title: 'Reference databases ready',
        body: 'CBDB, Norbert, and DILA reference data were installed for enrichment.',
      }).show();
    } else if (!result.ok) {
      new Notification({
        title: 'Reference data setup failed',
        body: result.error ?? 'Could not download reference databases.',
      }).show();
    }
    return result;
  });

  ipcMain.handle('authorityLifecycle:update', async (event) => {
    const folder = await getEntityDbFolderOrNull();
    if (!folder) return { ok: false, error: 'No entity database folder configured.' };
    const lifecycle = await readLifecycleConfig(folder);
    const result = await runAuthorityLifecyclePipeline({
      entityDbFolder: folder,
      profile: lifecycle.profile,
      forceDownload: false,
      onProgress: (progress) => emitAuthorityLifecycleProgress(event, progress),
    });
    if (result.ok) {
      const label =
        lifecycle.profile === 'japanese'
          ? 'NDL and Wikidata tagging packs'
          : lifecycle.profile === 'tibetan'
            ? 'Wikidata tagging packs'
            : 'CBDB, DILA, and Wikidata tagging packs';
      new Notification({
        title: 'Authority data updated',
        body: `${label} were refreshed from the registry.`,
      }).show();
    } else {
      new Notification({
        title: 'Authority update failed',
        body: result.error ?? 'Update could not complete.',
      }).show();
    }
    return result;
  });

  ipcMain.handle(
    'authorityLifecycle:promptEnable',
    async (
      _event,
      profile = 'chinese',
      strings?: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecyclePromptStrings,
    ) => {
      if (!mainWindow) return 'declined';

      const folder = await getEntityDbFolderOrNull();
      if (!folder) return 'declined';

      const lifecycle = await readLifecycleConfig(folder);
      if (lifecycle.enabled && lifecycle.profile === profile) return 'declined';
      if (lifecycle.declinedFirstPrompt && lifecycle.profile === profile) return 'declined';

      const legacyDeclined = path.join(folder, AUTHORITY_DB_DIRNAME, 'download-declined.json');
      if (existsSync(legacyDeclined)) {
        await recordDeclinedFirstPrompt(folder, profile);
        return 'declined';
      }

      const fallbackMessage =
        profile === 'japanese'
          ? 'Download Japanese authority packs?'
          : profile === 'tibetan'
            ? 'Download Tibetan authority packs?'
            : 'Download Chinese authority databases?';
      const fallbackDetail =
        profile === 'japanese'
          ? 'This project uses Japanese as its source language. LEAF-Writer can download NDL and Wikidata authority packs for automated tagging, and install Sanmiao (East Asian dates) for date tagging. They are stored locally on this machine, not synced with your entity database.'
          : profile === 'tibetan'
            ? 'This project uses Tibetan as its source language. LEAF-Writer can download Wikidata authority packs for automated tagging. They are stored locally on this machine, not synced with your entity database.'
            : 'This project uses Chinese as its source language. LEAF-Writer can download CBDB (China Biographical Database, ~600 MB), the DILA Buddhist Studies authorities (~85 MB), and Wikidata authority packs for automated tagging. They are stored locally on this machine, not synced with your entity database.';

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [strings?.downloadButton ?? 'Download', strings?.notNowButton ?? 'Not now'],
        defaultId: 0,
        cancelId: 1,
        message: strings?.message ?? fallbackMessage,
        detail: strings?.detail ?? fallbackDetail,
      });
      if (result.response !== 0) {
        await recordDeclinedFirstPrompt(folder, profile);
        return 'declined';
      }
      return 'accepted';
    },
  );

  ipcMain.handle('setEntityDbFolder', async (_event, folder: string | null) => {
    await setEntityDbFolder(folder);
  });

  // Merging/deleting entities propagates the key remap across every project
  // registered against the shared entity database (entity-projects.json),
  // not just the one currently open - so those roots need read/write
  // approval too. The renderer resolves them from that registry file, which
  // is itself only readable via the same restricted API, and each is
  // re-checked here as a real existing directory before being trusted.
  ipcMain.handle('approveEntityRegistryRoots', async (_event, roots: unknown) => {
    if (!Array.isArray(roots)) return false;
    for (const root of roots) {
      if (typeof root !== 'string' || !root.trim()) continue;
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      approveRendererReadRoot(root);
      approveRendererWriteRoot(root);
    }
    return true;
  });

  ipcMain.handle('pickEntityDbFolder', async () => {
    const parent = getTopNativeDialogWindow() ?? mainWindow ?? undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose entity database folder',
      message:
        'A blank folder is fine — Grognard will set up the database. Prefer a folder synced by Dropbox, iCloud, or OneDrive so it can travel between machines.',
      defaultPath: await getDialogDefaultPath(),
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    // The renderer creates entities.xml immediately for a newly selected
    // folder, before setEntityDbFolder persists it. Treat the explicit
    // folder selection as approval for that initial write.
    approveRendererWriteRoot(result.filePaths[0]);
    rememberDialogDir(result.filePaths[0], 'directory');
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('createEntityDatabase', async (_event, folder: string, content: string) => {
    const normalizedFolder = path.resolve(folder);
    const entityFile = path.join(normalizedFolder, 'entities.xml');
    const sqliteFile = path.join(normalizedFolder, 'entities.sqlite');

    // The folder must have come from the native picker in this session;
    // assertRendererWritePath also permits the configured entity database.
    await assertRendererWritePath(entityFile);
    await assertRendererWritePath(sqliteFile);
    if (!statSync(normalizedFolder).isDirectory()) {
      throw new Error('The selected entity database path is not a folder.');
    }
    await scaffoldEntityDatabaseInFolder(normalizedFolder, content);
  });

  ipcMain.handle('moveEntityDbFolder', async () => {
    const source = await getEntityDbFolder();
    if (!source) {
      return { ok: false, error: 'No entity database folder configured.' };
    }

    const parent = getTopNativeDialogWindow() ?? mainWindow ?? undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose new entity database folder',
      message:
        'Select where to move your entity database (entities.xml, authority packs, and related files).',
      defaultPath: await getDialogDefaultPath(),
    };
    const pickResult = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (pickResult.canceled || pickResult.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }

    const dest = pickResult.filePaths[0]?.replace(/[/\\]+$/, '') ?? '';
    if (!dest) return { ok: false, cancelled: true };
    rememberDialogDir(dest, 'directory');

    if (existsSync(path.join(dest, PROJECT_FILE_NAME))) {
      return {
        ok: false,
        error:
          'That folder is a Grognard project. Choose a different folder for your entity database.',
      };
    }

    const confirmParent = parent ?? mainWindow;
    if (!confirmParent) {
      return { ok: false, error: 'Cannot show confirmation dialog.' };
    }

    const confirmed = await dialog.showMessageBox(confirmParent, {
      type: 'warning',
      title: mainT('move_entity_db_title'),
      message: mainT('move_entity_db_message', { source, dest }),
      buttons: [mainT('move'), mainT('cancel')],
      defaultId: 0,
      cancelId: 1,
    });
    if (confirmed.response !== 0) {
      return { ok: false, cancelled: true };
    }

    try {
      await moveEntityDbFolder(source, dest);
      await setEntityDbFolder(dest);
      const achievementsFolder = await getAchievementsFolder();
      if (achievementsFolder && path.resolve(achievementsFolder) === path.resolve(source)) {
        await setAchievementsFolder(dest);
      }
      return { ok: true, folder: dest };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Move failed.';
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('pickAuthorityPacksSource', async () => {
    const parent = getTopNativeDialogWindow() ?? mainWindow ?? undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: mainT('choose_authority_packs_folder_title'),
      message: mainT('choose_authority_packs_folder_message'),
      defaultPath: await getDialogDefaultPath(),
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    rememberDialogDir(result.filePaths[0], 'directory');
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'updateProjectFileConfig',
    async (_event, projectFilePath: string, patch: Record<string, unknown>) =>
      writeProjectConfig(projectFilePath, patch),
  );

  ipcMain.handle('getAiApiSettings', async () => getAiApiSettings());

  ipcMain.handle('setAiApiSettings', async (_event, settings: Partial<AiApiSettings>) => {
    await setAiApiSettings(settings);
  });

  ipcMain.handle('testAiConnection', async (_event, settings: Partial<AiApiSettings>) => {
    return testAiConnection(settings);
  });

  ipcMain.handle('getLanguageToolSettings', async () => getLanguageToolSettings());

  ipcMain.handle(
    'setLanguageToolSettings',
    async (_event, settings: Partial<LanguageToolSettings>) => {
      await setLanguageToolSettings(settings);
    },
  );

  ipcMain.handle('entityDbBackup:getStatus', async () => {
    const [config, lastBackup, integrity, hasLocalDatabase] = await Promise.all([
      readBackupConfigView(),
      getLastBackupMarker(),
      checkEntityDbIntegrity(),
      hasLocalEntityDatabase(),
    ]);
    return { config, lastBackup, integrity, hasLocalDatabase };
  });

  ipcMain.handle(
    'entityDbBackup:setConfig',
    async (_event, patch: Partial<EntityDbBackupConfig>) => {
      const view = await writeBackupConfig(patch);
      await startBackupTimer();
      return view;
    },
  );

  ipcMain.handle('entityDbBackup:clearConfig', async () => {
    await clearBackupConfig();
    await startBackupTimer();
  });

  ipcMain.handle(
    'entityDbBackup:testConnection',
    async (_event, patch: Partial<EntityDbBackupConfig>) => {
      // Merge the form patch over the stored config so a blank secret field
      // reuses the saved secret instead of failing the probe.
      const stored = await readBackupConfig().catch(() => null);
      const merged = {
        enabled: patch.enabled ?? stored?.enabled ?? false,
        endpoint: (patch.endpoint ?? stored?.endpoint ?? '').replace(/\/$/, ''),
        accessKeyId: patch.accessKeyId ?? stored?.accessKeyId ?? '',
        secretAccessKey: patch.secretAccessKey || stored?.secretAccessKey || '',
        bucket: patch.bucket ?? stored?.bucket ?? '',
        prefix: patch.prefix ?? stored?.prefix ?? 'entity-db-backups/',
        intervalMinutes: patch.intervalMinutes ?? stored?.intervalMinutes ?? 15,
      } satisfies EntityDbBackupConfig;
      return probeBackupTarget(merged);
    },
  );

  ipcMain.handle('entityDbBackup:runNow', async () => runBackup('manual'));

  ipcMain.handle('entityDbBackup:listSnapshots', async () => listCloudSnapshots());

  ipcMain.handle('entityDbBackup:restore', async (_event, key: string) => {
    // Drop cached read handles so the file swap isn't fighting open fds.
    await closeEntitySqliteReadRepositories();
    const result = await restoreSnapshot(key);
    if (result.ok) notifyEntityDatabaseChanged();
    return result;
  });

  ipcMain.handle('entityDatabase:ensure', async () => ensureDefaultEntityDatabase());

  // Turso PEDB: the database url itself lives in the (shared, git-synced)
  // project file via the existing generic 'updateProjectFileConfig' channel
  // (config.pedb); only the per-collaborator auth token needs its own
  // channel, since it's encrypted, per-machine, and keyed by url rather
  // than by project.
  ipcMain.handle('entityDbTurso:hasToken', async (_event, url: string) => hasTursoAuthToken(url));

  ipcMain.handle(
    'entityDbTurso:setToken',
    async (_event, url: string, token: string | null) => writeTursoAuthToken(url, token),
  );

  ipcMain.handle(
    'entityDbTurso:testConnection',
    async (_event, url: string, token: string): Promise<{ ok: boolean; error?: string }> => {
      const backend = new TursoBackend({ url, authToken: token });
      try {
        await backend.get('SELECT 1');
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        await backend.close();
      }
    },
  );

  ipcMain.handle('entitySync:getStatus', async () => getEntitySyncStatus());

  ipcMain.handle('entitySync:setConfig', async (_event, patch: EntitySyncConfigPatch) =>
    setEntitySyncConfig(patch),
  );

  ipcMain.handle('entitySync:runNow', async () => runEntitySync('manual'));

  ipcMain.handle('entitySync:listConflicts', async () => listEntitySyncConflicts());

  ipcMain.handle(
    'entitySync:resolveConflict',
    async (_event, request: { id: number; keep: 'local' | 'remote' }) =>
      resolveEntitySyncConflict(request.id, request.keep),
  );

  ipcMain.handle('languageToolGetInstallStatus', async () => getLanguageToolInstallStatus());

  ipcMain.handle('languageToolInstallJava', async (event) => {
    await downloadAndInstallManagedJre((progress) => {
      event.sender.send('languageTool:installProgress', progress);
    });
    return getLanguageToolInstallStatus();
  });

  ipcMain.handle('languageToolInstall', async (event) => {
    const status = await downloadAndInstallLanguageTool((progress) => {
      event.sender.send('languageTool:installProgress', progress);
    });
    await setLanguageToolSettings({
      managedInstall: true,
      enabled: true,
      installedVersion: status.version,
      baseUrl: `http://127.0.0.1:${LANGUAGE_TOOL_MANAGED_PORT}`,
      verifiedAt: new Date().toISOString(),
      verifiedBaseUrl: `http://127.0.0.1:${LANGUAGE_TOOL_MANAGED_PORT}`,
    });
    return status;
  });

  ipcMain.handle('languageToolRemove', async () => {
    const status = await removeManagedLanguageTool();
    await setLanguageToolSettings({
      managedInstall: false,
      installedVersion: null,
      ngramsEnabled: false,
    });
    return status;
  });

  ipcMain.handle('languageToolInstallNgrams', async (event) => {
    const status = await downloadEnglishNgrams((progress) => {
      event.sender.send('languageTool:installProgress', progress);
    });
    await setLanguageToolSettings({ ngramsEnabled: true });
    return status;
  });

  ipcMain.handle('languageToolEnsureServer', async () => {
    const settings = await getLanguageToolSettings();
    if (!settings.managedInstall) {
      return { ok: true, port: LANGUAGE_TOOL_MANAGED_PORT };
    }
    return ensureManagedLanguageToolServer({ ngramsEnabled: settings.ngramsEnabled });
  });

  ipcMain.handle(
    'testLanguageToolConnection',
    async (_event, settings: Partial<LanguageToolSettings>) => {
      const merged = sanitizeLanguageToolSettings({
        ...(await getLanguageToolSettings()),
        ...settings,
      });
      if (merged.managedInstall) {
        const ensured = await ensureManagedLanguageToolServer({
          ngramsEnabled: merged.ngramsEnabled,
        });
        if (!ensured.ok) return { ok: false, error: ensured.error };
      }
      const baseUrl = resolveLanguageToolCheckBaseUrl(merged, LANGUAGE_TOOL_MANAGED_PORT);
      return testLanguageToolConnection(baseUrl);
    },
  );

  ipcMain.handle(
    'checkLanguageTool',
    async (
      _event,
      request: { text: string; language?: string | null; databasePaths?: string[] },
    ) => {
      const settings = await getLanguageToolSettings();
      if (!settings.enabled) {
        return {
          ok: false,
          error: 'LanguageTool is disabled in Settings.',
        };
      }
      if (settings.managedInstall) {
        const ensured = await ensureManagedLanguageToolServer({
          ngramsEnabled: settings.ngramsEnabled,
        });
        if (!ensured.ok) {
          return { ok: false, error: ensured.error ?? 'Could not start LanguageTool.' };
        }
      }
      const baseUrl = resolveLanguageToolCheckBaseUrl(settings, LANGUAGE_TOOL_MANAGED_PORT);
      const result = await checkLanguageToolText(baseUrl, {
        text: request.text ?? '',
        language: request.language,
      });
      if (!result.ok || !result.matches) return result;
      const whitelist = await loadLanguageToolEntityWhitelist(request.databasePaths ?? []);
      return {
        ...result,
        matches: applyWhitelistToMatches(request.text ?? '', result.matches, whitelist),
      };
    },
  );

  ipcMain.handle('generateAiTranslation', async (_event, request: AiTranslationRequest) => {
    return generateAiTranslation(request);
  });

  ipcMain.handle('suggestEntityGloss', async (_event, request: AiEntityGlossRequest) => {
    return suggestEntityGloss(request);
  });

  ipcMain.handle('zoteroCheckAvailability', async () => checkZoteroAvailability());

  ipcMain.handle('zoteroSearchItems', async (_event, query: string) => searchZoteroItems(query));

  ipcMain.handle('zoteroListStyles', async () => listZoteroStyles());

  ipcMain.handle('zoteroPickCitation', async () => pickZoteroCitationCayw());

  ipcMain.handle('zoteroCancelPick', async () => {
    cancelZoteroPick();
  });

  ipcMain.handle('renamePath', async (_event, oldPath: string, newPath: string) => {
    await assertRendererWritePath(oldPath);
    await assertRendererWritePath(newPath);
    return renamePath(oldPath, newPath);
  });

  ipcMain.handle('movePath', async (_event, sourcePath: string, destDir: string) => {
    await assertRendererWritePath(sourcePath);
    await assertRendererWritePath(destDir);
    return movePath(sourcePath, destDir);
  });

  ipcMain.handle('deletePath', async (_event, targetPath: string) => {
    await assertRendererWritePath(targetPath);
    await deletePath(targetPath);
  });

  ipcMain.handle('createDirectory', async (_event, parentDir: string, folderName: string) => {
    return createDirectory(parentDir, folderName);
  });

  ipcMain.handle('ensureDirectory', async (_event, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true });
  });

  ipcMain.handle('pickMoveDestination', async (_event, defaultDir?: string) => {
    if (!mainWindow) return null;

    mainWindow.focus();
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: defaultDir ?? (await getDialogDefaultPath()),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    rememberDialogDir(result.filePaths[0], 'directory');
    return result.filePaths[0];
  });

  ipcMain.handle('saveFileAs', async (_event, defaultPath?: string) => {
    if (!mainWindow) return null;

    mainWindow.focus();
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath ?? (await getDialogDefaultPath()),
      filters: [{ name: 'XML Documents', extensions: ['xml'] }],
    });

    if (result.canceled || !result.filePath) return null;
    rememberDialogDir(result.filePath, 'file');
    return result.filePath;
  });

  ipcMain.handle('setWindowTitle', (_event, title: string) => {
    setMainWindowTitle(title);
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('popup-app-menu', (_event, x?: number, y?: number) => {
    if (!mainWindow) return;
    Menu.getApplicationMenu()?.popup({
      window: mainWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    });
  });
};

let backgroundServicesStarted = false;

/**
 * Backup and sync startup work, deferred until the window is up.
 *
 * These read credentials through Electron `safeStorage`, which is synchronous
 * and can put a *blocking* OS keychain prompt in front of the main process. Run
 * from `whenReady`, a prompt the user cannot answer (a login keychain out of
 * sync with the account password, say) stalls the bundled server before it is
 * even forked, and the app reports that as "could not start the bundled
 * server". Run from `did-finish-load`, the worst it can block is a window that
 * is already on screen.
 */
const startBackgroundServices = (): void => {
  if (backgroundServicesStarted) return;
  backgroundServicesStarted = true;
  void startBackupTimer();
  void startSyncTimer();
  scheduleLaunchSync();
};

const createWindow = async () => {
  if (isMainWindowLive()) return;

  const icon = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 10 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  attachTranslationSpellcheckContextMenu(mainWindow.webContents);

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized', false));

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Surface renderer console output in the terminal for startup debugging.
  mainWindow.webContents.on('console-message', (event) => {
    if (
      process.env.GROGNARD_DEBUG === '1' ||
      event.level === 'warning' ||
      event.level === 'error'
    ) {
      console.log(`[renderer:${event.level}] ${event.message}`);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    setMainWindowTitle(APP_NAME);
    prewarmNativeDialog('projectMetadata');
    startBackgroundServices();
  });

  // On Windows, clicking the title-bar close button otherwise starts closing
  // the renderer before `before-quit` can prepare it. Route it through
  // app.quit() so menu Quit, Alt+F4, and the title-bar button share one
  // reliable shutdown path.
  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32' || isQuitting) return;
    event.preventDefault();
    app.quit();
  });

  // A bare Alt press-and-release opens the app menu (standard menu-bar
  // behavior on Linux/Windows); any other key in between cancels it.
  let altMenuPending = false;
  mainWindow.on('blur', () => {
    altMenuPending = false;
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (process.platform !== 'darwin') {
      if (input.type === 'keyDown') {
        altMenuPending = input.key === 'Alt' && !input.control && !input.meta && !input.shift;
      } else if (input.type === 'keyUp' && input.key === 'Alt') {
        if (altMenuPending && mainWindow) {
          altMenuPending = false;
          event.preventDefault();
          Menu.getApplicationMenu()?.popup({ window: mainWindow, x: 8, y: 36 });
        }
        altMenuPending = false;
      }
    }

    const isFindShortcut =
      input.type === 'keyDown' &&
      (input.meta || input.control) &&
      !input.shift &&
      !input.alt &&
      input.key?.toLowerCase() === 'f';

    if (!isFindShortcut) return;

    event.preventDefault();
    sendMenuAction('open-find');
  });

  try {
    const url = await getAppUrl();
    await mainWindow.loadURL(url);
  } catch (error) {
    console.error('[grognard] Failed to load app URL:', error);
    const message = isDev
      ? 'Could not connect to the LEAF-Writer dev server.'
      : 'Could not start the bundled LEAF-Writer server.';
    const detail = isDev
      ? 'Make sure leafwriter-commons is running on port 3000, then restart the desktop app.\n\nFrom the repo root: npm run dev -w leafwriter-commons'
      : 'The packaged app could not start its bundled server. Quit the app and open it again. If the problem persists, rebuild the installer and make sure the packaged Commons server was included.';
    const reason = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: APP_NAME,
      message,
      detail: `${detail}\n\n${reason}`,
    });
    app.quit();
    return;
  }

  if (devToolsEnabled && process.env.GROGNARD_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    openFileWatcher?.dispose();
    openFileWatcher = null;
    closeAllNativeDialogs();
    disposeLemminx();
    pendingRendererReadyResolvers.length = 0;
    mainWindow = null;
  });

  openFileWatcher = new OpenFileWatcher(() => mainWindow);
};

initNativeDialogs({
  getAppUrl,
  getParentWindow: () => mainWindow,
  getAppIcon,
  getPreloadPath: () => path.join(__dirname, 'preload.js'),
  isAppQuitting: () => isQuitting,
});

// Launching again (e.g. from the launcher icon) must focus the running app,
// not race it for the server port and user data.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    void createWindow();
  }
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === 'darwin') {
    const icon = getAppIcon();
    if (icon) app.dock?.setIcon(icon);
  }

  syncPluginApiState();
  registerGrognardProtocol();
  registerGameAssetProtocol();
  registerAvatarProtocol();
  registerBodyProtocol();
  registerPmtilesProtocol();
  registerIpcHandlers();
  registerNativeDialogIpc();
  browserImportServer = startBrowserImportBridge(() => mainWindow);
  registerLemminxIpc(() => mainWindow);
  initAutoUpdater({
    onAuthorityUpdated: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('authorityLifecycle:updated');
    },
    onPluginsUpdated: () => {
      buildApplicationMenu();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('plugins:updated');
    },
  });
  void (async () => {
    await seedDevPluginsIfEmpty();
    await getPluginHostSnapshot();
    await refreshRecentProjectsCache();
    await ensureDefaultEntityDatabase();
    buildApplicationMenu();
    await syncEnabledPluginContributions();
  })();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    quitPreparationInProgress = true;
    void closeEntitySqliteReadRepositories();
    closeAllNativeDialogs();

    // A best-effort snapshot on the way out, in parallel with renderer
    // teardown. runQuitBackup caps its own runtime and no-ops when backup is
    // disabled or unconfigured, so this can't hang shutdown.
    void Promise.allSettled([prepareRendererForQuit(), runQuitBackup()]).finally(() => {
      quitPreparationInProgress = false;
      app.quit();
    });
    return;
  }

  // If another quit request arrives while the renderer preparation is still
  // in flight, keep the original request paused until it completes.
  if (quitPreparationInProgress) {
    event.preventDefault();
    return;
  }

  void closeEntitySqliteReadRepositories();
  closeAllNativeDialogs();
});

app.on('window-all-closed', () => {
  void stopManagedLanguageToolServer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  browserImportServer?.close();
  browserImportServer = null;
  killAllBulkBridgeJobs();
  killAllEntityIndexJobs();
  disposeLemminx();
  if (process.platform !== 'darwin' || isQuitting) app.quit();
});

app.on('will-quit', () => {
  void stopManagedLanguageToolServer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  killAllBulkBridgeJobs();
  killAllEntityIndexJobs();
});
