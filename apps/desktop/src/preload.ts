import { contextBridge, ipcRenderer, webFrame } from 'electron';

import type {
  ZoteroAvailability,
  ZoteroCaywResult,
  ZoteroSearchResult,
  ZoteroStyle,
} from './zoteroClient';

import type {
  AuthorityDownloadProgress,
  AuthoritySourceId,
  AuthoritySourceStatus,
} from './authorityDatabases';
import type { AuthorityRefLookupRequest, AuthorityRefLookupResult } from './authorityRefLookup';
import type { ProjectBundle } from './projectFile';
import type { MapTileBundleSpec } from './mapTiles';
import type { EntityDbBackupConfig, EntityDbBackupConfigView } from './entityDbBackupConfig';
import type {
  BackupResult,
  CloudSnapshot,
  EntityDbIntegrityReport,
  LastBackupMarker,
  RestoreResult,
} from './entityDbBackup';
import type { EntitySyncConfig } from './entitySyncConfig';
import type { EntitySyncConfigPatch, EntitySyncStatus, SyncRunSummary } from './entitySyncService';
import type { SyncConflict } from './entityDbSqlite/entitySyncRepo';

export interface EntityDbBackupStatus {
  config: EntityDbBackupConfigView;
  lastBackup: LastBackupMarker | null;
  integrity: EntityDbIntegrityReport;
  hasLocalDatabase: boolean;
}

export interface MapTilesProgress {
  bundleId: string;
  message: string;
  receivedBytes?: number;
  totalBytes?: number | null;
}

export interface MapTilesDownloadState {
  bundleId: string;
  message: string;
  receivedBytes?: number;
  totalBytes?: number | null;
}

export interface MapTilesDownloadComplete {
  bundleId: string;
  installed: boolean;
  path?: string;
  error?: string;
}
import type {
  SchemaUpdateApplyResult,
  SchemaUpdateCheckOptions,
  SchemaUpdateCheckResult,
} from '../../commons/src/desktop/schemaUpdateTypes';
import type { AppUpdateCheckResult } from '../../commons/src/desktop/appUpdateTypes';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface NativeMessageBoxOptions {
  buttons?: string[];
  cancelId?: number;
  defaultId?: number;
  detail?: string;
  message: string;
  title: string;
  type?: 'error' | 'info' | 'none' | 'question' | 'warning';
}

export interface NativeDialogOptions {
  id: string;
  type: 'settings' | 'schemaPicker' | 'schemaSetup' | 'projectMetadata';
  title?: string;
  initialState?: unknown;
}

export interface PickSchemaFilesResult {
  rngPath: string;
  cssPath: string | null;
}

export interface NamedPath {
  name: string;
  path: string;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

export type ImportableDocumentFormat = 'txt' | 'md' | 'rtf';

export interface DocumentImportSource {
  format: ImportableDocumentFormat;
  relativePath: string;
  sourcePath: string;
}

export interface TimeMachineSnapshotSummary {
  app: 'grognard';
  createdAt: string;
  fileCount: number;
  id: string;
  path: string;
  projectName: string;
  projectRootPath: string;
  sizeBytes: number;
  version: 1;
}

export interface AiApiSettings {
  apiKey: string;
  baseUrl: string;
  customInstructions: string;
  model: string;
  temperature: number;
  streamResults: boolean;
  placeholderRetryLimit: number;
  /** When true, AI curation runs unconditionally — no per-run opt-in checkbox (e.g. Disambiguate). */
  alwaysOn: boolean;
  verifiedAt: string | null;
  verifiedBaseUrl: string;
  verifiedModel: string;
}

export interface AiConnectionResult {
  error?: string;
  models?: string[];
  ok: boolean;
}

export interface LanguageToolSettings {
  enabled: boolean;
  baseUrl: string;
  verifiedAt: string | null;
  verifiedBaseUrl: string;
  checkMode: 'onDemand' | 'live';
  managedInstall: boolean;
  ngramsEnabled: boolean;
  installedVersion: string | null;
}

export interface LanguageToolConnectionResult {
  error?: string;
  languageCount?: number;
  ok: boolean;
}

export interface LanguageToolMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: string[];
  ruleId?: string;
}

export interface LanguageToolCheckRequest {
  text: string;
  language?: string | null;
  databasePaths?: string[];
}

export interface LanguageToolCheckResult {
  error?: string;
  language?: string;
  matches?: LanguageToolMatch[];
  ok: boolean;
}

export interface LanguageToolInstallStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  port: number;
  ngrams: { en: boolean };
  java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
  javaInstallOffered: boolean;
  managedJavaInstalled: boolean;
  server: 'stopped' | 'starting' | 'running' | 'failed';
  serverError?: string;
}

export interface LanguageToolInstallProgress {
  phase: 'download' | 'extract' | 'done';
  receivedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export interface AiTranslationEntityRef {
  id: string;
  kind: string;
  primaryName?: string | null;
  romanizedName?: string | null;
  familyName?: string | null;
  dates?: string | null;
  description?: string | null;
}

export interface AiTranslationDateRef {
  index: number;
  surface?: string | null;
  when?: string | null;
  gloss?: string | null;
}

export interface AiTranslationRequest {
  /** 'note' is a synthetic unit type used for translating a stripped-out footnote independently. */
  alignmentUnit: 'div' | 'p' | 'ab' | 'note';
  sourceUnitXml: string;
  targetLanguage: string;
  entities?: AiTranslationEntityRef[];
  dates?: AiTranslationDateRef[];
  retryInstruction?: string;
}

export interface AiTranslationResult {
  error?: string;
  ok: boolean;
  translationXml?: string;
}

export interface AiEntityGlossRequest {
  kind: string;
  primaryName: string | null;
  romanizedName: string | null;
  chineseName?: string | null;
  description?: string | null;
  targetLanguage: string;
}

export interface AiEntityGlossResult {
  error?: string;
  ok: boolean;
  gloss?: string;
}

export interface WorkspaceSession {
  activeFilePath: string | null;
  cursorPositions?: Record<string, WorkspaceCursorPosition>;
  openFilePaths: string[];
  projectFilePath: string | null;
}

export type WorkspaceCursorPosition =
  | { mode: 'source'; offset: number }
  | { mode: 'visual'; offsetInElementText: number; teiXPath: string };

export interface WorkspaceSessionRestore {
  activeFilePath: string | null;
  bundle: ProjectBundle;
  cursorPositions?: Record<string, WorkspaceCursorPosition>;
  openFilePaths: string[];
}

export interface ElectronAPI {
  openProject: () => Promise<ProjectBundle | null>;
  /** Open a project by its jean-baptiste.project.json path (recent-projects menu). */
  openProjectAtPath: (projectFilePath: string) => Promise<ProjectBundle | null>;
  /** @deprecated Use openProject */
  openProjectFolder: () => Promise<ProjectBundle | null>;
  restoreLastProject: () => Promise<ProjectBundle | null>;
  setAppLocale: (locale: string) => Promise<void>;
  getRememberWorkspaceOnStartup: () => Promise<boolean>;
  setRememberWorkspaceOnStartup: (remember: boolean) => Promise<void>;
  saveWorkspaceSession: (session: WorkspaceSession) => Promise<void>;
  restoreWorkspaceSession: () => Promise<WorkspaceSessionRestore | null>;
  readDirectory: (dirPath: string, options?: { allFiles?: boolean }) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  readFileAutoEncoding: (filePath: string) => Promise<{ encoding: string; text: string }>;
  extractDocxText: (filePath: string) => Promise<{ text: string; warnings: string[] }>;
  extractOdtText: (filePath: string) => Promise<{ text: string; warnings: string[] }>;
  writeClipboardRich: (flavors: { text: string; html?: string; rtf?: string }) => Promise<void>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  writeBinaryFile: (filePath: string, bytes: Uint8Array) => Promise<void>;
  pathExists: (filePath: string) => Promise<boolean>;
  statFile: (filePath: string) => Promise<FileStat>;
  syncWatchedFiles: (paths: string[]) => Promise<void>;
  ignoreFileChange: (filePath: string, mtimeMs: number) => Promise<void>;
  armFileWrite: (filePath: string) => Promise<void>;
  findXmlFilesByName: (rootPath: string, query: string) => Promise<NamedPath[]>;
  listProjectXmlFiles: (rootPath: string) => Promise<NamedPath[]>;
  reloadProjectBundle: (projectFilePath: string) => Promise<ProjectBundle | null>;
  clearActiveProject?: () => Promise<boolean>;
  installCatalogSchema: (projectFilePath: string, catalogId: string) => Promise<ProjectBundle>;
  installLocalSchema: (
    projectFilePath: string,
    rngPath: string,
    cssPath?: string | null,
  ) => Promise<ProjectBundle>;
  ensureSanmiaoDatesSchema?: (projectFilePath: string) => Promise<{ merged: boolean }>;
  pluginsEnsureSchemaContribution?: (
    pluginId: string,
    projectFilePath: string,
  ) => Promise<{ merged: boolean }>;
  pluginsInvokePython?: (pluginId: string, payload: Record<string, unknown>) => Promise<unknown>;
  kanripoSearch?: (query: string) => Promise<
    {
      id: string;
      title: string;
      section: string;
      dynasty: string;
      authors: string;
      dzid: string;
    }[]
  >;
  kanripoClone?: (krId: string) => Promise<{ cachePath: string; reused: boolean; files: string[] }>;
  viafFetchCluster?: (viafId: string) => Promise<unknown>;
  kanripoFetchJuan?: (
    krId: string,
    juan: string,
  ) => Promise<{ kr_id: string; loc: string; path: string; files: string[]; reused: boolean }>;
  kanripoFlush?: (krId: string) => Promise<{ ok: boolean }>;
  kanripoFetchCtextParallel?: (options: {
    url: string;
    row?: number | string;
    id?: string;
    contains?: string;
    section?: string;
  }) => Promise<{
    text: string;
    label: string;
    section?: string;
    rowId?: string;
    rowIds?: string[];
    sections?: { id: string; slug: string; title: string; rowCount: number }[];
  }>;
  kanripoListCtextSections?: (
    url: string,
  ) => Promise<{ id: string; slug: string; title: string; rowCount: number }[]>;
  kanripoListWikisourceVolumes?: (
    url: string,
  ) => Promise<{ id: string; slug: string; title: string; rowCount: number }[]>;
  wikisourceInspect?: (url: string) => Promise<unknown>;
  wikisourceFetchPage?: (options: { apiHost: string; title: string }) => Promise<{
    title: string;
    stem: string;
    bodyXml: string;
    header: { title?: string; author?: string; section?: string; notes?: string } | null;
    hasPb: boolean;
  }>;
  onWikisourceImportOrder?: (
    callback: (order: {
      action: string;
      url: string;
      title?: string;
      wiki?: string;
      scope?: 'page' | 'work';
    }) => void,
  ) => () => void;
  onKanripoImportOrder?: (
    callback: (order: {
      action: string;
      url: string;
      kr_id: string;
      scope?: 'work' | 'juan';
      juan?: string;
      loc?: string;
    }) => void,
  ) => () => void;
  onBdrcImportOrder?: (
    callback: (order: { action: string; url: string; etext_id: string; scope?: 'volume' }) => void,
  ) => () => void;
  kanripoFetchParallelUrl?: (options: {
    url: string;
    section?: string;
    contains?: string;
    fetchAll?: boolean;
  }) => Promise<{
    text: string;
    label: string;
    kind: 'wikisource' | 'generic' | 'ctext';
    url: string;
    pageTitle?: string;
    section?: string;
    rowId?: string;
    rowIds?: string[];
    sections?: { id: string; slug: string; title: string; rowCount: number }[];
  }>;
  daozangStatus?: () => Promise<{
    ready: boolean;
    textCount: number;
    source?: 'user-cache' | 'bundled' | 'none';
    manifest?: Record<string, unknown>;
    cacheRoot?: string;
  }>;
  daozangSearch?: (query: string) => Promise<
    {
      id: string;
      dz_no: string;
      title: string;
      rel_path: string;
      section: string;
      dynasty: string;
      authors: string;
      file_title: string;
    }[]
  >;
  daozangResolveText?: (relPath: string) => Promise<string>;
  daozangReadText?: (relPath: string) => Promise<{ text: string; rel_path: string; path: string }>;
  bdrcInspect?: (input: string) => Promise<{
    utId: string;
    sourceId: string;
    from: 'ut' | 've';
    veId?: string | null;
    title: string;
    titleLang?: string;
    access: string | null;
    status: string | null;
    restricted: boolean;
    unsupported: boolean;
    workId: string | null;
    instanceId: string | null;
    imageGroupId: string | null;
    paginated: boolean;
    bampoCount?: number;
  }>;
  bdrcImport?: (
    input: string,
    opts?: { windowSize?: number; forceRefresh?: boolean; split?: boolean },
  ) => Promise<{
    restricted: boolean;
    unsupported: boolean;
    warnings: string[];
    fromCache: boolean;
    split?: boolean;
    partCount: number;
    revision: string;
    meta: { utId: string; instanceId?: string; workId?: string; volumeId?: string };
    headerFields: Record<string, unknown>;
    sections: {
      n: number | null;
      label: string;
      bodyXml: string;
      pbCount: number;
      structure: 'flat' | 'outline';
    }[];
  }>;
  bdrcImportToProject?: (
    input: string,
    opts: {
      projectRoot: string;
      forceRefresh?: boolean;
      split?: boolean;
      windowSize?: number;
    },
  ) => Promise<{
    restricted: boolean;
    unsupported: boolean;
    warnings: string[];
    fromCache: boolean;
    split?: boolean;
    partCount: number;
    meta: { utId: string; instanceId?: string; workId?: string };
    written: string[];
    pbCount: number;
  }>;
  cbetaCorpusStatus?: () => Promise<{
    present: boolean;
    path: string | null;
    source: 'bundled' | 'legacy-cache' | 'none';
  }>;
  cbetaEnsureCorpus?: () => Promise<{ present: boolean; action?: string }>;
  onPluginPythonProgress?: (
    pluginId: string,
    callback: (
      progress: import('../../../packages/cwrc-leafwriter/src/autoTagging/dates').SanmiaoChunkProgressEvent,
    ) => void,
  ) => () => void;
  checkSchemaUpdate: (
    projectFilePath: string,
    options?: SchemaUpdateCheckOptions,
  ) => Promise<SchemaUpdateCheckResult>;
  applyCatalogSchemaUpdate: (projectFilePath: string) => Promise<SchemaUpdateApplyResult>;
  checkForAppUpdates: () => Promise<AppUpdateCheckResult>;
  listTimeMachineSnapshots: (projectRootPath: string) => Promise<TimeMachineSnapshotSummary[]>;
  createTimeMachineSnapshot: (
    projectRootPath: string,
    projectName: string,
  ) => Promise<TimeMachineSnapshotSummary>;
  pickTimeMachineRestoreDestination: (
    projectRootPath: string,
    snapshotId: string,
  ) => Promise<string | null>;
  restoreTimeMachineSnapshot: (snapshotPath: string, destinationPath: string) => Promise<void>;
  restoreTimeMachineSnapshotToProject: (
    projectRootPath: string,
    projectName: string,
    snapshotPath: string,
  ) => Promise<{ beforeRestoreSnapshot: TimeMachineSnapshotSummary }>;
  pickSchemaFiles: () => Promise<PickSchemaFilesResult | null>;
  pickDocumentImportSources: () => Promise<DocumentImportSource[] | null>;
  createTempDocument: (content: string) => Promise<{ filePath: string; filename: string }>;
  /** Desktop app version from package.json / app.getVersion(). */
  getAppVersion: () => Promise<string>;
  getEncoderName: () => Promise<string>;
  setEncoderName: (name: string) => Promise<void>;
  setTranslationSpellcheck: (options: {
    enabled: boolean;
    languageCodes?: string[];
  }) => Promise<void>;
  readAchievementsFile: () => Promise<string | null>;
  writeAchievementsFile: (content: string) => Promise<void>;
  readSourceProfiles: () => Promise<
    import('../../commons/src/desktop/sourceProfileTypes').SourceProfileFile
  >;
  upsertSourceProfile: (
    profile: import('../../commons/src/desktop/sourceProfileTypes').SourceProfile,
  ) => Promise<import('../../commons/src/desktop/sourceProfileTypes').SourceProfileFile>;
  deleteSourceProfile: (
    profileId: string,
  ) => Promise<import('../../commons/src/desktop/sourceProfileTypes').SourceProfileFile>;
  getGameAssetColorStats: (
    key: string,
  ) => Promise<{ lightness: number; saturation: number } | null>;
  saveCertificatePng: (bytes: Uint8Array, suggestedName: string) => Promise<boolean>;
  getCachedLeaderboardToken: () => Promise<string | null>;
  clearCachedLeaderboardToken: () => Promise<void>;
  startLeaderboardDeviceFlow: () => Promise<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
  }>;
  pollLeaderboardDeviceFlow: (
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
  ) => Promise<{ token: string } | { error: string }>;
  getEntityDbFolder: () => Promise<string | null>;
  setEntityDbFolder: (folder: string | null) => Promise<void>;
  pickEntityDbFolder: () => Promise<string | null>;
  createEntityDatabase: (folder: string, content: string) => Promise<void>;
  bulkBridgeStart: (
    request: import('../../commons/src/desktop/bulkBridgeTypes').BulkBridgeJobRequest,
  ) => Promise<string>;
  bulkBridgeCancel: (jobId: string) => Promise<boolean>;
  onBulkBridgeProgress: (
    callback: (
      event: import('../../commons/src/desktop/bulkBridgeTypes').BulkBridgeJobEvent,
    ) => void,
  ) => () => void;
  entityIndexStart: (
    request: import('../../commons/src/desktop/entityIndexTypes').EntityIndexJobRequest,
  ) => Promise<string>;
  entityIndexCancel: (jobId: string) => Promise<boolean>;
  onEntityIndexProgress: (
    callback: (
      event: import('../../commons/src/desktop/entityIndexTypes').EntityIndexJobEvent,
    ) => void,
  ) => () => void;
  entitySqliteSearch: (
    request: import('./entityDbSqlite/readService').EntitySqliteReadRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityLookupResult[] | null>;
  entitySqliteGet: (
    request: import('./entityDbSqlite/readService').EntitySqliteGetRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityPanelSummary | null>;
  entitySqliteDatabaseId: (databasePath: string) => Promise<string | null>;
  entitySqliteListIds: (
    request: import('./entityDbSqlite/readService').EntitySqliteListIdsRequest,
  ) => Promise<string[] | null>;
  entitySqliteListPanelSummaries: (
    request: import('./entityDbSqlite/readService').EntitySqliteListIdsRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityPanelSummary[] | null>;
  entitySqliteAuthorityDuplicates: (
    databasePath: string,
  ) => Promise<import('./entityDbSqlite/repository').SqliteDuplicateGroup[] | null>;
  entitySqliteCandidates: (
    request: import('./entityDbSqlite/readService').EntitySqliteCandidatesRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityCandidateRecord[] | null>;
  entitySqliteUpdateNames: (
    request: import('./entityDbSqlite/readService').EntitySqliteUpdateNamesRequest,
  ) => Promise<number>;
  entitySqliteTombstoneNames: (
    request: import('./entityDbSqlite/readService').EntitySqliteTombstoneNamesRequest,
  ) => Promise<number>;
  entitySqliteUpdateDescription: (
    request: import('./entityDbSqlite/readService').EntitySqliteUpdateDescriptionRequest,
  ) => Promise<void>;
  entitySqliteUpdateSubtype: (
    request: import('./entityDbSqlite/readService').EntitySqliteUpdateSubtypeRequest,
  ) => Promise<void>;
  entitySqliteGetNotes: (
    request: import('./entityDbSqlite/readService').EntitySqliteNotesRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityNote[]>;
  entitySqliteSetNote: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetNoteRequest,
  ) => Promise<void>;
  entitySqliteRemoveName: (
    request: import('./entityDbSqlite/readService').EntitySqliteRemoveNameRequest,
  ) => Promise<boolean>;
  entitySqliteAddName: (
    request: import('./entityDbSqlite/readService').EntitySqliteAddNameRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteName>;
  entitySqliteSetUserDate: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetUserEntityDateRequest,
  ) => Promise<void>;
  entitySqliteSetUserWorkDate: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetUserWorkDateRequest,
  ) => Promise<void>;
  entitySqliteSetWorkType: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetWorkTypeRequest,
  ) => Promise<void>;
  entitySqliteAddNationality: (
    request: import('./entityDbSqlite/readService').EntitySqliteAddLabeledValueRequest,
  ) => Promise<boolean>;
  entitySqliteAddOrigin: (
    request: import('./entityDbSqlite/readService').EntitySqliteAddLabeledValueRequest,
  ) => Promise<boolean>;
  entitySqliteAddNobleTitle: (
    request: import('./entityDbSqlite/readService').EntitySqliteNobleTitleRequest,
  ) => Promise<boolean>;
  entitySqliteUpdateNobleTitle: (
    request: import('./entityDbSqlite/readService').EntitySqliteUpdateNobleTitleRequest,
  ) => Promise<boolean>;
  entitySqliteSetUserWorkAuthors: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetUserWorkAuthorsRequest,
  ) => Promise<void>;
  entitySqliteAttachAuthority: (
    request: import('./entityDbSqlite/readService').EntitySqliteAuthorityRefRequest,
  ) => Promise<boolean>;
  entitySqliteDecoupleAuthority: (
    request: import('./entityDbSqlite/readService').EntitySqliteAuthorityRefRequest,
  ) => Promise<number>;
  entitySqliteRejectAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteRestoreAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteRemoveAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteValidateAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteAcceptDateAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteAcceptDescriptionAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteRenamePrimaryName: (
    request: import('./entityDbSqlite/readService').EntitySqliteRenamePrimaryNameRequest,
  ) => Promise<boolean>;
  entitySqliteSetRomanizedName: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetRomanizedNameRequest,
  ) => Promise<void>;
  entitySqliteAutoCleanNames: (
    request: import('./entityDbSqlite/readService').EntitySqliteAutoCleanNamesRequest,
  ) => Promise<import('./entityDbSqlite/readService').EntitySqliteAutoCleanNamesResult>;
  entitySqliteApplyConcordance: (
    request: import('./entityDbSqlite/readService').EntitySqliteApplyConcordanceRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteConcordanceImportResult>;
  entitySqliteRejectConcordance: (
    request: import('./entityDbSqlite/readService').EntitySqliteRejectConcordanceRequest,
  ) => Promise<boolean>;
  entitySqliteMarkDuplicateIntentional: (
    request: import('./entityDbSqlite/readService').EntitySqliteMarkDuplicateIntentionalRequest,
  ) => Promise<boolean>;
  entitySqliteBackfillDecisionTargets: (
    request: import('./entityDbSqlite/readService').EntitySqliteBackfillDecisionTargetsRequest,
  ) => Promise<import('./entityDbSqlite/repository').DecisionTargetBackfillReport | null>;
  entitySqliteSoftDelete: (
    request: import('./entityDbSqlite/readService').EntitySqliteSoftDeleteRequest,
  ) => Promise<boolean>;
  entitySqliteMerge: (
    request: import('./entityDbSqlite/readService').EntitySqliteMergeRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteMergeResult>;
  entitySqliteCreateRelation: (
    request: import('./entityDbSqlite/readService').EntitySqliteCreateRelationRequest,
  ) => Promise<number>;
  entitySqliteListRelations: (
    request: import('./entityDbSqlite/readService').EntitySqliteListRelationsRequest,
  ) => Promise<import('./entityDbSqlite/repository').SqliteEntityRelation[]>;
  entitySqliteUpdateRelationStatus: (
    request: import('./entityDbSqlite/readService').EntitySqliteUpdateRelationStatusRequest,
  ) => Promise<boolean>;
  entitySqliteCreatePopulated: (
    request: import('./entityDbSqlite/readService').EntitySqliteCreatePopulatedRequest,
  ) => Promise<unknown>;
  entitySqliteApplyAuthorityBackfillPatch: (
    request: import('./entityDbSqlite/repository').AuthorityBackfillPatch & {
      databasePath: string;
    },
  ) => Promise<import('./entityDbSqlite/repository').AuthorityBackfillPatchResult>;
  entitySqliteReconcileXmlExtractedData: (
    request: import('./entityDbSqlite/repository').XmlExtractedRefreshInput & {
      databasePath: string;
    },
  ) => Promise<import('./entityDbSqlite/repository').XmlExtractedRefreshResult>;
  entitySqliteEntityContentHash: (request: {
    databasePath: string;
    entityId: string;
  }) => Promise<string | null>;
  entitySqliteReplaceEntityContent: (request: {
    sourceDatabasePath: string;
    sourceEntityId: string;
    targetDatabasePath: string;
    targetEntityId: string;
  }) => Promise<{ changed: boolean }>;
  entitySqliteGetCentralId: (
    request: import('./entityDbSqlite/readService').EntitySqliteGetCentralIdRequest,
  ) => Promise<string | null>;
  entitySqliteSetCentralMapping: (
    request: import('./entityDbSqlite/readService').EntitySqliteSetCentralMappingRequest,
  ) => Promise<boolean>;
  entitySqliteClearCentralMapping: (
    request: import('./entityDbSqlite/readService').EntitySqliteGetCentralIdRequest,
  ) => Promise<boolean>;
  entitySqliteListMappingsByCentralIds: (request: {
    databasePath: string;
    userStableId: string;
    centralIds: string[];
  }) => Promise<{ projectEntityId: string; centralId: string; label: string | null }[]>;
  entitySqliteListAllCentralMappings: (request: {
    databasePath: string;
    userStableId: string;
  }) => Promise<{ projectEntityId: string; centralId: string }[]>;
  entitySqliteListLinkedCentralIds: (request: {
    databasePath: string;
    userStableId: string;
  }) => Promise<string[] | null>;
  entitySqliteCountUnlinked: (request: {
    databasePath: string;
    userStableId: string;
  }) => Promise<number | null>;
  entitySqliteCountEntities: (request: { databasePath: string }) => Promise<number | null>;
  entitySqliteFindByAuthority: (
    request: import('./entityDbSqlite/readService').EntitySqliteFindByAuthorityRequest,
  ) => Promise<string[]>;
  entitySqliteFindByNameDates: (
    request: import('./entityDbSqlite/readService').EntitySqliteFindByNameDatesRequest,
  ) => Promise<string | null>;
  entitySqliteForceRejectAssertion: (
    request: import('./entityDbSqlite/readService').EntitySqliteForceRejectAssertionRequest,
  ) => Promise<boolean>;
  entitySqliteExportXml: (
    request: import('./entityDbSqlite/readService').EntitySqliteXmlRequest,
  ) => Promise<string | null>;
  entitySqliteImportXml: (
    request: import('./entityDbSqlite/readService').EntitySqliteImportXmlRequest,
  ) => Promise<import('./entityDbSqlite/xmlCodec').XmlImportReport>;
  approveEntityRegistryRoots: (roots: string[]) => Promise<boolean>;
  moveEntityDbFolder: () => Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    folder?: string;
  }>;
  pickAuthorityPacksSource: () => Promise<string | null>;
  authorityDbStatuses: () => Promise<AuthoritySourceStatus[]>;
  authorityDbDownload: (sourceId: AuthoritySourceId) => Promise<{ ok: boolean; error?: string }>;
  authorityDbPromptDownload: () => Promise<'accepted' | 'declined'>;
  authorityRefLookup: (
    request: AuthorityRefLookupRequest,
  ) => Promise<AuthorityRefLookupResult | null>;
  onAuthorityDbProgress: (callback: (progress: AuthorityDownloadProgress) => void) => () => void;
  mapTilesStatus: () => Promise<{
    installed: boolean;
    path: string | null;
    regions: {
      id: string;
      sha256: string;
      installedAt: string;
      maxZoom?: number;
      minZoom?: number;
    }[];
  }>;
  mapTilesPromptDownload: () => Promise<'accepted' | 'declined'>;
  mapTilesDownload: (
    bundle: MapTileBundleSpec,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  mapTilesDownloadBackground: (
    bundle: MapTileBundleSpec,
  ) => Promise<{ ok: boolean; queued?: boolean; error?: string }>;
  mapTilesRemove: (bundleId: string) => Promise<{ ok: boolean; error?: string }>;
  mapTilesDownloadStatus: () => Promise<{ active: MapTilesDownloadState[] }>;
  onMapTilesProgress: (callback: (progress: MapTilesProgress) => void) => () => void;
  onMapTilesDownloadComplete: (callback: (result: MapTilesDownloadComplete) => void) => () => void;
  authorityPackStatuses?: () => Promise<
    import('../../commons/src/desktop/authorityPackTypes').AuthorityPackStatus[]
  >;
  authorityPackRead?: (
    packId: import('../../commons/src/desktop/authorityPackTypes').AuthorityPackId,
    dateFilter?: import('../../commons/src/desktop/authorityPackTypes').AuthorityPackDateFilter,
  ) => Promise<string[]>;
  /** Stream a pack in main; return only NDJSON lines for the given authority ids. */
  authorityPackLookupByIds?: (
    packId: import('../../commons/src/desktop/authorityPackTypes').AuthorityPackId,
    authorityIds: string[],
  ) => Promise<string[]>;
  authorityPackInstallFrom?: (
    sourcePacksRoot: string,
  ) => Promise<{ ok: boolean; copied?: string[]; error?: string }>;
  pluginsGetSnapshot?: () => Promise<
    import('../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsSetEnabled?: (
    pluginId: string,
    enabled: boolean,
  ) => Promise<
    import('../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsInstallFrom?: (
    sourceDir: string,
  ) => Promise<
    import('../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsPickInstallFolder?: () => Promise<string | null>;
  pluginsDismissLanguagePrompt?: (pluginId: string) => Promise<void>;
  pluginsIsEnabled?: (pluginId: string) => Promise<boolean>;
  pluginsGetModuleUrl?: (pluginId: string) => Promise<string | null>;
  pluginsGetRemoteIndex?: () => Promise<
    import('../../commons/src/desktop/pluginRegistryTypes').PluginReleaseIndex
  >;
  pluginsInstallRemote?: (
    entry: import('../../commons/src/desktop/pluginRegistryTypes').PluginReleaseEntry,
  ) => Promise<
    import('../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  authorityLifecycleGet?: () => Promise<
    import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleStatus
  >;
  authorityLifecycleSetEnabled?: (
    options: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleSetEnabledOptions,
  ) => Promise<
    import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleRunResult
  >;
  authorityLifecycleSetReferenceDataEnabled?: (
    enabled: boolean,
  ) => Promise<
    import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleRunResult
  >;
  authorityLifecycleUpdate?: () => Promise<
    import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleRunResult
  >;
  authorityLifecycleMaybeCheckUpdates?: (options?: {
    force?: boolean;
  }) => Promise<
    import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleStatus | null
  >;
  authorityLifecyclePromptEnable?: (
    profile?: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleProfile,
    strings?: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecyclePromptStrings,
  ) => Promise<'accepted' | 'declined'>;
  authorityLifecycleRevealFolder?: () => Promise<boolean>;
  getShouldUseDarkColors?: () => Promise<boolean>;
  setNativeThemeSource?: (source: 'system' | 'light' | 'dark') => Promise<boolean>;
  onNativeThemeChanged?: (callback: (shouldUseDarkColors: boolean) => void) => () => void;
  onAuthorityLifecycleProgress?: (
    callback: (
      progress: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleProgress,
    ) => void,
  ) => () => void;
  onAuthorityLifecycleUpdated?: (callback: () => void) => () => void;
  onPluginsUpdated?: (callback: () => void) => () => void;
  updateProjectFileConfig: (
    projectFilePath: string,
    patch: Record<string, unknown>,
  ) => Promise<ProjectBundle>;
  getAiApiSettings: () => Promise<AiApiSettings>;
  setAiApiSettings: (settings: Partial<AiApiSettings>) => Promise<void>;
  testAiConnection: (settings: Partial<AiApiSettings>) => Promise<AiConnectionResult>;
  getLanguageToolSettings: () => Promise<LanguageToolSettings>;
  setLanguageToolSettings: (settings: Partial<LanguageToolSettings>) => Promise<void>;
  testLanguageToolConnection: (
    settings: Partial<LanguageToolSettings>,
  ) => Promise<LanguageToolConnectionResult>;
  checkLanguageTool: (request: LanguageToolCheckRequest) => Promise<LanguageToolCheckResult>;
  languageToolGetInstallStatus: () => Promise<LanguageToolInstallStatus>;
  languageToolInstallJava: () => Promise<LanguageToolInstallStatus>;
  languageToolInstall: () => Promise<LanguageToolInstallStatus>;
  languageToolRemove: () => Promise<LanguageToolInstallStatus>;
  languageToolInstallNgrams: () => Promise<LanguageToolInstallStatus>;
  languageToolEnsureServer: () => Promise<{ ok: boolean; error?: string; port?: number }>;
  onLanguageToolInstallProgress: (
    callback: (progress: LanguageToolInstallProgress) => void,
  ) => () => void;
  generateAiTranslation: (request: AiTranslationRequest) => Promise<AiTranslationResult>;
  suggestEntityGloss: (request: AiEntityGlossRequest) => Promise<AiEntityGlossResult>;
  zoteroCheckAvailability: () => Promise<ZoteroAvailability>;
  zoteroSearchItems: (query: string) => Promise<ZoteroSearchResult[]>;
  zoteroListStyles: () => Promise<ZoteroStyle[]>;
  zoteroPickCitation: () => Promise<ZoteroCaywResult>;
  zoteroCancelPick: () => Promise<void>;
  renamePath: (oldPath: string, newPath: string) => Promise<string>;
  movePath: (sourcePath: string, destDir: string) => Promise<string>;
  deletePath: (targetPath: string) => Promise<void>;
  createDirectory: (parentDir: string, folderName: string) => Promise<string>;
  ensureDirectory: (dirPath: string) => Promise<void>;
  pickMoveDestination: (defaultDir?: string) => Promise<string | null>;
  saveFileAs: (defaultPath?: string) => Promise<string | null>;
  setWindowTitle: (title: string) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  popupAppMenu: (x?: number, y?: number) => Promise<void>;
  openExternalUrl: (url: string) => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
  onAppMenuAction: (callback: (action: string) => void) => () => void;
  onOpenRecentProject: (callback: (projectFilePath: string) => void) => () => void;
  signalRendererReady: () => Promise<void>;
  onExternalFileChange: (callback: (filePath: string) => void) => () => void;
  showNativeMessageBox: (
    options: NativeMessageBoxOptions,
  ) => Promise<{ response: number; checkboxChecked: boolean }>;
  openNativeDialog: (options: NativeDialogOptions) => Promise<{ ok: boolean }>;
  closeNativeDialog: (id: string) => Promise<{ ok: boolean }>;
  updateNativeDialogState: (payload: {
    dialogId: string;
    initialState: unknown;
  }) => Promise<{ ok: boolean }>;
  nativeDialogInvoke: (payload: {
    dialogId: string;
    method: string;
    args?: unknown;
  }) => Promise<unknown>;
  onNativeDialogClosed: (callback: (id: string) => void) => () => void;
  onNativeDialogOpen: (
    callback: (payload: { dialogId: string; title?: string; initialState?: unknown }) => void,
  ) => () => void;
  onNativeDialogStateUpdate: (
    callback: (payload: { dialogId: string; initialState: unknown }) => void,
  ) => () => void;
  lspStart: (options?: {
    defaultSchemaRng?: string;
    projectRoot?: string;
  }) => Promise<{ ok: boolean; error?: string; initializationOptions?: unknown }>;
  lspStop: () => Promise<{ ok: boolean }>;
  lspSend: (message: unknown) => Promise<{ ok: boolean }>;
  onLspMessage: (callback: (message: unknown) => void) => () => void;
  /** Interface (window chrome) zoom — scales the entire UI, unlike the per-pane text zooms. */
  setUiZoomFactor: (factor: number) => void;
  getUiZoomFactor: () => number;

  /** Entity-database cloud backup (Settings › Entity database › Cloud backup). */
  entityDbBackupGetStatus: () => Promise<EntityDbBackupStatus>;
  entityDbBackupSetConfig: (
    patch: Partial<EntityDbBackupConfig>,
  ) => Promise<EntityDbBackupConfigView>;
  entityDbBackupClearConfig: () => Promise<void>;
  entityDbBackupTestConnection: (
    patch: Partial<EntityDbBackupConfig>,
  ) => Promise<{ ok: boolean; error?: string; objectCount?: number }>;
  entityDbBackupRunNow: () => Promise<BackupResult>;
  entityDbBackupListSnapshots: () => Promise<CloudSnapshot[]>;
  entityDbBackupRestore: (key: string) => Promise<RestoreResult>;

  /**
   * Turso-backed shared PEDB: the database url itself is ordinary project
   * config (config.pedb, via updateProjectFileConfig) — these three cover
   * only the per-collaborator auth token, which is encrypted, per-machine,
   * and keyed by url rather than by project.
   */
  entityDbTursoHasToken: (url: string) => Promise<boolean>;
  entityDbTursoSetToken: (url: string, token: string | null) => Promise<void>;
  entityDbTursoTestConnection: (url: string, token: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * One-time copy of an existing local `entities.sqlite`'s rows into the
   * Turso database this project's config now points at — the switch itself
   * never moves data on its own. Refuses if the target already has rows.
   */
  entityDbTursoMigrateLocalData: (
    projectFilePath: string,
  ) => Promise<{ ok: boolean; tables?: number; rows?: number; error?: string }>;

  /** Ensure the configured central entity database folder contains entities.sqlite. */
  entityDatabaseEnsure: () => Promise<{ folder: string; dbPath: string; created: boolean } | null>;
  onEntityDatabaseChanged: (callback: () => void) => () => void;

  /** Cross-device entity sync (Settings › Profil › Cross-device sync). */
  entitySyncGetStatus: () => Promise<EntitySyncStatus>;
  entitySyncSetConfig: (patch: EntitySyncConfigPatch) => Promise<EntitySyncConfig>;
  entitySyncRunNow: () => Promise<SyncRunSummary>;
  entitySyncListConflicts: () => Promise<SyncConflict[]>;
  entitySyncResolveConflict: (request: {
    id: number;
    keep: 'local' | 'remote';
  }) => Promise<{ ok: boolean }>;
}

const electronAPI: ElectronAPI = {
  setUiZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  getUiZoomFactor: () => webFrame.getZoomFactor(),
  openProject: () => ipcRenderer.invoke('openProject'),
  openProjectAtPath: (projectFilePath: string) =>
    ipcRenderer.invoke('openProjectAtPath', projectFilePath),
  openProjectFolder: () => ipcRenderer.invoke('openProject'),
  restoreLastProject: () => ipcRenderer.invoke('restoreLastProject'),
  setAppLocale: (locale: string) => ipcRenderer.invoke('setAppLocale', locale),
  getRememberWorkspaceOnStartup: () => ipcRenderer.invoke('getRememberWorkspaceOnStartup'),
  setRememberWorkspaceOnStartup: (remember: boolean) =>
    ipcRenderer.invoke('setRememberWorkspaceOnStartup', remember),
  saveWorkspaceSession: (session: WorkspaceSession) =>
    ipcRenderer.invoke('saveWorkspaceSession', session),
  restoreWorkspaceSession: () => ipcRenderer.invoke('restoreWorkspaceSession'),
  readDirectory: (dirPath: string, options?: { allFiles?: boolean }) =>
    ipcRenderer.invoke('readDirectory', dirPath, options),
  readFile: (filePath: string) => ipcRenderer.invoke('readFile', filePath),
  readFileAutoEncoding: (filePath: string) => ipcRenderer.invoke('readFileAutoEncoding', filePath),
  extractDocxText: (filePath: string) => ipcRenderer.invoke('extractDocxText', filePath),
  extractOdtText: (filePath: string) => ipcRenderer.invoke('extractOdtText', filePath),
  writeClipboardRich: (flavors: { text: string; html?: string; rtf?: string }) =>
    ipcRenderer.invoke('writeClipboardRich', flavors),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('writeFile', filePath, content),
  writeBinaryFile: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('writeBinaryFile', filePath, bytes),
  pathExists: (filePath: string) => ipcRenderer.invoke('pathExists', filePath),
  statFile: (filePath: string) => ipcRenderer.invoke('statFile', filePath),
  syncWatchedFiles: (paths: string[]) => ipcRenderer.invoke('syncWatchedFiles', paths),
  ignoreFileChange: (filePath: string, mtimeMs: number) =>
    ipcRenderer.invoke('ignoreFileChange', filePath, mtimeMs),
  armFileWrite: (filePath: string) => ipcRenderer.invoke('armFileWrite', filePath),
  findXmlFilesByName: (rootPath: string, query: string) =>
    ipcRenderer.invoke('findXmlFilesByName', rootPath, query),
  listProjectXmlFiles: (rootPath: string) => ipcRenderer.invoke('listProjectXmlFiles', rootPath),
  reloadProjectBundle: (projectFilePath: string) =>
    ipcRenderer.invoke('reloadProjectBundle', projectFilePath),
  clearActiveProject: () => ipcRenderer.invoke('clearActiveProject'),
  installCatalogSchema: (projectFilePath: string, catalogId: string) =>
    ipcRenderer.invoke('installCatalogSchema', projectFilePath, catalogId),
  installLocalSchema: (projectFilePath: string, rngPath: string, cssPath?: string | null) =>
    ipcRenderer.invoke('installLocalSchema', projectFilePath, rngPath, cssPath),
  ensureSanmiaoDatesSchema: (projectFilePath: string) =>
    ipcRenderer.invoke('plugins:ensureSchemaContribution', 'cjk-dates', projectFilePath),
  pluginsEnsureSchemaContribution: (pluginId: string, projectFilePath: string) =>
    ipcRenderer.invoke('plugins:ensureSchemaContribution', pluginId, projectFilePath),
  pluginsInvokePython: (pluginId: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke('plugins:invokePython', pluginId, payload),
  kanripoSearch: (query: string) => ipcRenderer.invoke('kanripo:search', query),
  kanripoClone: (krId: string) => ipcRenderer.invoke('kanripo:clone', krId),
  viafFetchCluster: (viafId: string) => ipcRenderer.invoke('viaf:fetchCluster', viafId),
  kanripoFetchJuan: (krId: string, juan: string) =>
    ipcRenderer.invoke('kanripo:fetchJuan', krId, juan),
  kanripoFlush: (krId: string) => ipcRenderer.invoke('kanripo:flush', krId),
  kanripoFetchCtextParallel: (options) => ipcRenderer.invoke('kanripo:fetchCtextParallel', options),
  kanripoListCtextSections: (url: string) => ipcRenderer.invoke('kanripo:listCtextSections', url),
  kanripoListWikisourceVolumes: (url: string) =>
    ipcRenderer.invoke('kanripo:listWikisourceVolumes', url),
  wikisourceInspect: (url: string) => ipcRenderer.invoke('wikisource:inspect', url),
  wikisourceFetchPage: (options: { apiHost: string; title: string }) =>
    ipcRenderer.invoke('wikisource:fetchPage', options),
  kanripoFetchParallelUrl: (options) => ipcRenderer.invoke('kanripo:fetchParallelUrl', options),
  daozangStatus: () => ipcRenderer.invoke('daozang:status'),
  daozangSearch: (query: string) => ipcRenderer.invoke('daozang:search', query),
  daozangResolveText: (relPath: string) => ipcRenderer.invoke('daozang:resolveText', relPath),
  daozangReadText: (relPath: string) => ipcRenderer.invoke('daozang:readText', relPath),
  bdrcInspect: (input: string) => ipcRenderer.invoke('bdrc:inspect', input),
  bdrcImport: (
    input: string,
    opts?: { windowSize?: number; forceRefresh?: boolean; split?: boolean },
  ) => ipcRenderer.invoke('bdrc:import', input, opts),
  bdrcImportToProject: (
    input: string,
    opts: {
      projectRoot: string;
      forceRefresh?: boolean;
      split?: boolean;
      windowSize?: number;
    },
  ) => ipcRenderer.invoke('bdrc:importToProject', input, opts),
  cbetaCorpusStatus: () => ipcRenderer.invoke('cbeta:corpusStatus'),
  cbetaEnsureCorpus: () => ipcRenderer.invoke('cbeta:ensureCorpus'),
  onPluginPythonProgress: (pluginId, callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      eventPluginId: string,
      progress: import('../../../packages/cwrc-leafwriter/src/autoTagging/dates').SanmiaoChunkProgressEvent,
    ) => {
      if (eventPluginId === pluginId) callback(progress);
    };
    ipcRenderer.on('plugins:pythonProgress', listener);
    return () => ipcRenderer.removeListener('plugins:pythonProgress', listener);
  },
  checkSchemaUpdate: (projectFilePath: string, options?: SchemaUpdateCheckOptions) =>
    ipcRenderer.invoke('checkSchemaUpdate', projectFilePath, options),
  applyCatalogSchemaUpdate: (projectFilePath: string) =>
    ipcRenderer.invoke('applyCatalogSchemaUpdate', projectFilePath),
  checkForAppUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  listTimeMachineSnapshots: (projectRootPath: string) =>
    ipcRenderer.invoke('timeMachine:listSnapshots', projectRootPath),
  createTimeMachineSnapshot: (projectRootPath: string, projectName: string) =>
    ipcRenderer.invoke('timeMachine:createSnapshot', projectRootPath, projectName),
  pickTimeMachineRestoreDestination: (projectRootPath: string, snapshotId: string) =>
    ipcRenderer.invoke('timeMachine:pickRestoreDestination', projectRootPath, snapshotId),
  restoreTimeMachineSnapshot: (snapshotPath: string, destinationPath: string) =>
    ipcRenderer.invoke('timeMachine:restoreSnapshot', snapshotPath, destinationPath),
  restoreTimeMachineSnapshotToProject: (
    projectRootPath: string,
    projectName: string,
    snapshotPath: string,
  ) =>
    ipcRenderer.invoke(
      'timeMachine:restoreSnapshotToProject',
      projectRootPath,
      projectName,
      snapshotPath,
    ),
  pickSchemaFiles: () => ipcRenderer.invoke('pickSchemaFiles'),
  pickDocumentImportSources: () => ipcRenderer.invoke('pickDocumentImportSources'),
  createTempDocument: (content: string) => ipcRenderer.invoke('createTempDocument', content),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
  getEncoderName: () => ipcRenderer.invoke('getEncoderName'),
  setEncoderName: (name: string) => ipcRenderer.invoke('setEncoderName', name),
  setTranslationSpellcheck: (options: { enabled: boolean; languageCodes?: string[] }) =>
    ipcRenderer.invoke('setTranslationSpellcheck', options),
  readAchievementsFile: () => ipcRenderer.invoke('readAchievementsFile'),
  writeAchievementsFile: (content: string) => ipcRenderer.invoke('writeAchievementsFile', content),
  readSourceProfiles: () => ipcRenderer.invoke('readSourceProfiles'),
  upsertSourceProfile: (
    profile: import('../../commons/src/desktop/sourceProfileTypes').SourceProfile,
  ) => ipcRenderer.invoke('upsertSourceProfile', profile),
  deleteSourceProfile: (profileId: string) => ipcRenderer.invoke('deleteSourceProfile', profileId),
  getGameAssetColorStats: (key: string) => ipcRenderer.invoke('getGameAssetColorStats', key),
  saveCertificatePng: (bytes: Uint8Array, suggestedName: string) =>
    ipcRenderer.invoke('saveCertificatePng', bytes, suggestedName),
  getCachedLeaderboardToken: () => ipcRenderer.invoke('getCachedLeaderboardToken'),
  clearCachedLeaderboardToken: () => ipcRenderer.invoke('clearCachedLeaderboardToken'),
  startLeaderboardDeviceFlow: () => ipcRenderer.invoke('startLeaderboardDeviceFlow'),
  pollLeaderboardDeviceFlow: (
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
  ) =>
    ipcRenderer.invoke('pollLeaderboardDeviceFlow', deviceCode, intervalSeconds, expiresInSeconds),
  getEntityDbFolder: () => ipcRenderer.invoke('getEntityDbFolder'),
  setEntityDbFolder: (folder: string | null) => ipcRenderer.invoke('setEntityDbFolder', folder),
  pickEntityDbFolder: () => ipcRenderer.invoke('pickEntityDbFolder'),
  createEntityDatabase: (folder, content) =>
    ipcRenderer.invoke('createEntityDatabase', folder, content),
  bulkBridgeStart: (request) => ipcRenderer.invoke('bulkBridge:start', request),
  bulkBridgeCancel: (jobId) => ipcRenderer.invoke('bulkBridge:cancel', jobId),
  onBulkBridgeProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: import('../../commons/src/desktop/bulkBridgeTypes').BulkBridgeJobEvent,
    ) => callback(progress);
    ipcRenderer.on('bulkBridge:progress', listener);
    return () => ipcRenderer.removeListener('bulkBridge:progress', listener);
  },
  entityIndexStart: (request) => ipcRenderer.invoke('entityIndex:start', request),
  entityIndexCancel: (jobId) => ipcRenderer.invoke('entityIndex:cancel', jobId),
  onEntityIndexProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: import('../../commons/src/desktop/entityIndexTypes').EntityIndexJobEvent,
    ) => callback(progress);
    ipcRenderer.on('entityIndex:progress', listener);
    return () => ipcRenderer.removeListener('entityIndex:progress', listener);
  },
  entitySqliteSearch: (request) => ipcRenderer.invoke('entitySqlite:search', request),
  entitySqliteGet: (request) => ipcRenderer.invoke('entitySqlite:get', request),
  entitySqliteDatabaseId: (databasePath) =>
    ipcRenderer.invoke('entitySqlite:databaseId', databasePath),
  entitySqliteListIds: (request) => ipcRenderer.invoke('entitySqlite:listIds', request),
  entitySqliteListPanelSummaries: (request) =>
    ipcRenderer.invoke('entitySqlite:listPanelSummaries', request),
  entitySqliteAuthorityDuplicates: (databasePath) =>
    ipcRenderer.invoke('entitySqlite:authorityDuplicates', databasePath),
  entitySqliteCandidates: (request) => ipcRenderer.invoke('entitySqlite:candidates', request),
  entitySqliteUpdateNames: (request) => ipcRenderer.invoke('entitySqlite:updateNames', request),
  entitySqliteTombstoneNames: (request) =>
    ipcRenderer.invoke('entitySqlite:tombstoneNames', request),
  entitySqliteUpdateDescription: (request) =>
    ipcRenderer.invoke('entitySqlite:updateDescription', request),
  entitySqliteUpdateSubtype: (request) => ipcRenderer.invoke('entitySqlite:updateSubtype', request),
  entitySqliteGetNotes: (request) => ipcRenderer.invoke('entitySqlite:getNotes', request),
  entitySqliteSetNote: (request) => ipcRenderer.invoke('entitySqlite:setNote', request),
  entitySqliteRemoveName: (request) => ipcRenderer.invoke('entitySqlite:removeName', request),
  entitySqliteAddName: (request) => ipcRenderer.invoke('entitySqlite:addName', request),
  entitySqliteSetUserDate: (request) => ipcRenderer.invoke('entitySqlite:setUserDate', request),
  entitySqliteSetUserWorkDate: (request) =>
    ipcRenderer.invoke('entitySqlite:setUserWorkDate', request),
  entitySqliteSetWorkType: (request) => ipcRenderer.invoke('entitySqlite:setWorkType', request),
  entitySqliteAddNationality: (request) =>
    ipcRenderer.invoke('entitySqlite:addNationality', request),
  entitySqliteAddOrigin: (request) => ipcRenderer.invoke('entitySqlite:addOrigin', request),
  entitySqliteAddNobleTitle: (request) => ipcRenderer.invoke('entitySqlite:addNobleTitle', request),
  entitySqliteUpdateNobleTitle: (request) =>
    ipcRenderer.invoke('entitySqlite:updateNobleTitle', request),
  entitySqliteSetUserWorkAuthors: (request) =>
    ipcRenderer.invoke('entitySqlite:setUserWorkAuthors', request),
  entitySqliteAttachAuthority: (request) =>
    ipcRenderer.invoke('entitySqlite:attachAuthority', request),
  entitySqliteDecoupleAuthority: (request) =>
    ipcRenderer.invoke('entitySqlite:decoupleAuthority', request),
  entitySqliteRejectAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:rejectAssertion', request),
  entitySqliteRestoreAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:restoreAssertion', request),
  entitySqliteRemoveAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:removeAssertion', request),
  entitySqliteValidateAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:validateAssertion', request),
  entitySqliteAcceptDateAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:acceptDateAssertion', request),
  entitySqliteAcceptDescriptionAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:acceptDescriptionAssertion', request),
  entitySqliteRenamePrimaryName: (request) =>
    ipcRenderer.invoke('entitySqlite:renamePrimaryName', request),
  entitySqliteSetRomanizedName: (request) =>
    ipcRenderer.invoke('entitySqlite:setRomanizedName', request),
  entitySqliteAutoCleanNames: (request) =>
    ipcRenderer.invoke('entitySqlite:autoCleanNames', request),
  entitySqliteApplyConcordance: (request) =>
    ipcRenderer.invoke('entitySqlite:applyConcordance', request),
  entitySqliteRejectConcordance: (request) =>
    ipcRenderer.invoke('entitySqlite:rejectConcordance', request),
  entitySqliteMarkDuplicateIntentional: (request) =>
    ipcRenderer.invoke('entitySqlite:markDuplicateIntentional', request),
  entitySqliteBackfillDecisionTargets: (request) =>
    ipcRenderer.invoke('entitySqlite:backfillDecisionTargets', request),
  entitySqliteSoftDelete: (request) => ipcRenderer.invoke('entitySqlite:softDelete', request),
  entitySqliteMerge: (request) => ipcRenderer.invoke('entitySqlite:merge', request),
  entitySqliteCreateRelation: (request) =>
    ipcRenderer.invoke('entitySqlite:createRelation', request),
  entitySqliteListRelations: (request) => ipcRenderer.invoke('entitySqlite:listRelations', request),
  entitySqliteUpdateRelationStatus: (request) =>
    ipcRenderer.invoke('entitySqlite:updateRelationStatus', request),
  entitySqliteCreatePopulated: (request) =>
    ipcRenderer.invoke('entitySqlite:createPopulated', request),
  entitySqliteApplyAuthorityBackfillPatch: (request) =>
    ipcRenderer.invoke('entitySqlite:applyAuthorityBackfillPatch', request),
  entitySqliteReconcileXmlExtractedData: (request) =>
    ipcRenderer.invoke('entitySqlite:reconcileXmlExtractedData', request),
  entitySqliteEntityContentHash: (request) =>
    ipcRenderer.invoke('entitySqlite:entityContentHash', request),
  entitySqliteReplaceEntityContent: (request) =>
    ipcRenderer.invoke('entitySqlite:replaceEntityContent', request),
  entitySqliteGetCentralId: (request) => ipcRenderer.invoke('entitySqlite:getCentralId', request),
  entitySqliteSetCentralMapping: (request) =>
    ipcRenderer.invoke('entitySqlite:setCentralMapping', request),
  entitySqliteClearCentralMapping: (request) =>
    ipcRenderer.invoke('entitySqlite:clearCentralMapping', request),
  entitySqliteListMappingsByCentralIds: (request) =>
    ipcRenderer.invoke('entitySqlite:listMappingsByCentralIds', request),
  entitySqliteListAllCentralMappings: (request) =>
    ipcRenderer.invoke('entitySqlite:listAllCentralMappings', request),
  entitySqliteListLinkedCentralIds: (request) =>
    ipcRenderer.invoke('entitySqlite:listLinkedCentralIds', request),
  entitySqliteCountUnlinked: (request) => ipcRenderer.invoke('entitySqlite:countUnlinked', request),
  entitySqliteCountEntities: (request) => ipcRenderer.invoke('entitySqlite:countEntities', request),
  entitySqliteFindByAuthority: (request) =>
    ipcRenderer.invoke('entitySqlite:findByAuthority', request),
  entitySqliteFindByNameDates: (request) =>
    ipcRenderer.invoke('entitySqlite:findByNameDates', request),
  entitySqliteForceRejectAssertion: (request) =>
    ipcRenderer.invoke('entitySqlite:forceRejectAssertion', request),
  entitySqliteExportXml: (request) => ipcRenderer.invoke('entitySqlite:exportXml', request),
  entitySqliteImportXml: (request) => ipcRenderer.invoke('entitySqlite:importXml', request),
  approveEntityRegistryRoots: (roots: string[]) =>
    ipcRenderer.invoke('approveEntityRegistryRoots', roots),
  moveEntityDbFolder: () => ipcRenderer.invoke('moveEntityDbFolder'),
  pickAuthorityPacksSource: () => ipcRenderer.invoke('pickAuthorityPacksSource'),
  authorityDbStatuses: () => ipcRenderer.invoke('authorityDb:statuses'),
  authorityDbDownload: (sourceId: AuthoritySourceId) =>
    ipcRenderer.invoke('authorityDb:download', sourceId),
  authorityDbPromptDownload: () => ipcRenderer.invoke('authorityDb:promptDownload'),
  authorityRefLookup: (request: AuthorityRefLookupRequest) =>
    ipcRenderer.invoke('authorityRef:lookup', request),
  onAuthorityDbProgress: (callback: (progress: AuthorityDownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AuthorityDownloadProgress) =>
      callback(progress);
    ipcRenderer.on('authorityDb:progress', listener);
    return () => ipcRenderer.removeListener('authorityDb:progress', listener);
  },
  mapTilesStatus: () => ipcRenderer.invoke('mapTiles:status'),
  mapTilesPromptDownload: () => ipcRenderer.invoke('mapTiles:promptDownload'),
  mapTilesDownload: (bundle: MapTileBundleSpec) => ipcRenderer.invoke('mapTiles:download', bundle),
  mapTilesDownloadBackground: (bundle: MapTileBundleSpec) =>
    ipcRenderer.invoke('mapTiles:downloadBackground', bundle),
  mapTilesRemove: (bundleId: string) => ipcRenderer.invoke('mapTiles:remove', bundleId),
  mapTilesDownloadStatus: () => ipcRenderer.invoke('mapTiles:downloadStatus'),
  onMapTilesProgress: (callback: (progress: MapTilesProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: MapTilesProgress) =>
      callback(progress);
    ipcRenderer.on('mapTiles:progress', listener);
    return () => ipcRenderer.removeListener('mapTiles:progress', listener);
  },
  onMapTilesDownloadComplete: (callback: (result: MapTilesDownloadComplete) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: MapTilesDownloadComplete) =>
      callback(result);
    ipcRenderer.on('mapTiles:downloadComplete', listener);
    return () => ipcRenderer.removeListener('mapTiles:downloadComplete', listener);
  },
  authorityPackStatuses: () => ipcRenderer.invoke('authorityPack:statuses'),
  authorityPackRead: (packId: string, dateFilter?: unknown) =>
    ipcRenderer.invoke('authorityPack:read', packId, dateFilter),
  authorityPackLookupByIds: (packId: string, authorityIds: string[]) =>
    ipcRenderer.invoke('authorityPack:lookupByIds', packId, authorityIds),
  authorityPackInstallFrom: (sourcePacksRoot: string) =>
    ipcRenderer.invoke('authorityPack:installFrom', sourcePacksRoot),
  pluginsGetSnapshot: () => ipcRenderer.invoke('plugins:getSnapshot'),
  pluginsSetEnabled: (pluginId: string, enabled: boolean) =>
    ipcRenderer.invoke('plugins:setEnabled', pluginId, enabled),
  pluginsInstallFrom: (sourceDir: string) => ipcRenderer.invoke('plugins:installFrom', sourceDir),
  pluginsPickInstallFolder: () => ipcRenderer.invoke('plugins:pickInstallFolder'),
  pluginsDismissLanguagePrompt: (pluginId: string) =>
    ipcRenderer.invoke('plugins:dismissLanguagePrompt', pluginId),
  pluginsIsEnabled: (pluginId: string) => ipcRenderer.invoke('plugins:isEnabled', pluginId),
  pluginsGetModuleUrl: (pluginId: string) => ipcRenderer.invoke('plugins:getModuleUrl', pluginId),
  pluginsGetRemoteIndex: () => ipcRenderer.invoke('plugins:getRemoteIndex'),
  pluginsInstallRemote: (entry) => ipcRenderer.invoke('plugins:installRemote', entry),
  authorityLifecycleGet: () => ipcRenderer.invoke('authorityLifecycle:get'),
  authorityLifecycleSetEnabled: (options) =>
    ipcRenderer.invoke('authorityLifecycle:setEnabled', options),
  authorityLifecycleSetReferenceDataEnabled: (enabled) =>
    ipcRenderer.invoke('authorityLifecycle:setReferenceDataEnabled', enabled),
  authorityLifecycleUpdate: () => ipcRenderer.invoke('authorityLifecycle:update'),
  authorityLifecycleMaybeCheckUpdates: (options) =>
    ipcRenderer.invoke('authorityLifecycle:maybeCheckUpdates', options),
  authorityLifecyclePromptEnable: (profile, strings) =>
    ipcRenderer.invoke('authorityLifecycle:promptEnable', profile, strings),
  authorityLifecycleRevealFolder: () => ipcRenderer.invoke('authorityLifecycle:revealFolder'),
  getShouldUseDarkColors: () => ipcRenderer.invoke('nativeTheme:shouldUseDarkColors'),
  setNativeThemeSource: (source: 'system' | 'light' | 'dark') =>
    ipcRenderer.invoke('nativeTheme:setThemeSource', source),
  onNativeThemeChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, shouldUseDarkColors: boolean) =>
      callback(shouldUseDarkColors);
    ipcRenderer.on('nativeTheme:updated', listener);
    return () => ipcRenderer.removeListener('nativeTheme:updated', listener);
  },
  onAuthorityLifecycleProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: import('../../commons/src/desktop/authorityLifecycleTypes').AuthorityLifecycleProgress,
    ) => callback(progress);
    ipcRenderer.on('authorityLifecycle:progress', listener);
    return () => ipcRenderer.removeListener('authorityLifecycle:progress', listener);
  },
  onAuthorityLifecycleUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('authorityLifecycle:updated', listener);
    return () => ipcRenderer.removeListener('authorityLifecycle:updated', listener);
  },
  onPluginsUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('plugins:updated', listener);
    return () => ipcRenderer.removeListener('plugins:updated', listener);
  },
  updateProjectFileConfig: (projectFilePath: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('updateProjectFileConfig', projectFilePath, patch),
  getAiApiSettings: () => ipcRenderer.invoke('getAiApiSettings'),
  setAiApiSettings: (settings: Partial<AiApiSettings>) =>
    ipcRenderer.invoke('setAiApiSettings', settings),
  testAiConnection: (settings: Partial<AiApiSettings>) =>
    ipcRenderer.invoke('testAiConnection', settings),
  getLanguageToolSettings: () => ipcRenderer.invoke('getLanguageToolSettings'),
  setLanguageToolSettings: (settings: Partial<LanguageToolSettings>) =>
    ipcRenderer.invoke('setLanguageToolSettings', settings),
  testLanguageToolConnection: (settings: Partial<LanguageToolSettings>) =>
    ipcRenderer.invoke('testLanguageToolConnection', settings),
  checkLanguageTool: (request: LanguageToolCheckRequest) =>
    ipcRenderer.invoke('checkLanguageTool', request),
  languageToolGetInstallStatus: () => ipcRenderer.invoke('languageToolGetInstallStatus'),
  languageToolInstallJava: () => ipcRenderer.invoke('languageToolInstallJava'),
  languageToolInstall: () => ipcRenderer.invoke('languageToolInstall'),
  languageToolRemove: () => ipcRenderer.invoke('languageToolRemove'),
  languageToolInstallNgrams: () => ipcRenderer.invoke('languageToolInstallNgrams'),
  languageToolEnsureServer: () => ipcRenderer.invoke('languageToolEnsureServer'),
  onLanguageToolInstallProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: LanguageToolInstallProgress) =>
      callback(progress);
    ipcRenderer.on('languageTool:installProgress', listener);
    return () => ipcRenderer.removeListener('languageTool:installProgress', listener);
  },
  generateAiTranslation: (request: AiTranslationRequest) =>
    ipcRenderer.invoke('generateAiTranslation', request),
  suggestEntityGloss: (request: AiEntityGlossRequest) =>
    ipcRenderer.invoke('suggestEntityGloss', request),
  zoteroCheckAvailability: () => ipcRenderer.invoke('zoteroCheckAvailability'),
  zoteroSearchItems: (query: string) => ipcRenderer.invoke('zoteroSearchItems', query),
  zoteroListStyles: () => ipcRenderer.invoke('zoteroListStyles'),
  zoteroPickCitation: () => ipcRenderer.invoke('zoteroPickCitation'),
  zoteroCancelPick: () => ipcRenderer.invoke('zoteroCancelPick'),
  renamePath: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('renamePath', oldPath, newPath),
  movePath: (sourcePath: string, destDir: string) =>
    ipcRenderer.invoke('movePath', sourcePath, destDir),
  deletePath: (targetPath: string) => ipcRenderer.invoke('deletePath', targetPath),
  createDirectory: (parentDir: string, folderName: string) =>
    ipcRenderer.invoke('createDirectory', parentDir, folderName),
  ensureDirectory: (dirPath: string) => ipcRenderer.invoke('ensureDirectory', dirPath),
  pickMoveDestination: (defaultDir?: string) =>
    ipcRenderer.invoke('pickMoveDestination', defaultDir),
  saveFileAs: (defaultPath?: string) => ipcRenderer.invoke('saveFileAs', defaultPath),
  setWindowTitle: (title: string) => ipcRenderer.invoke('setWindowTitle', title),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  popupAppMenu: (x?: number, y?: number) => ipcRenderer.invoke('popup-app-menu', x, y),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  onAppMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('app:menu-action', listener);
    return () => ipcRenderer.removeListener('app:menu-action', listener);
  },
  onOpenRecentProject: (callback: (projectFilePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, projectFilePath: string) =>
      callback(projectFilePath);
    ipcRenderer.on('app:open-recent-project', listener);
    return () => ipcRenderer.removeListener('app:open-recent-project', listener);
  },
  onWikisourceImportOrder: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      order: {
        action: string;
        url: string;
        title?: string;
        wiki?: string;
        scope?: 'page' | 'work';
      },
    ) => callback(order);
    ipcRenderer.on('wikisource:import-order', listener);
    return () => ipcRenderer.removeListener('wikisource:import-order', listener);
  },
  onKanripoImportOrder: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      order: {
        action: string;
        url: string;
        kr_id: string;
        scope?: 'work' | 'juan';
        juan?: string;
        loc?: string;
      },
    ) => callback(order);
    ipcRenderer.on('kanripo:import-order', listener);
    return () => ipcRenderer.removeListener('kanripo:import-order', listener);
  },
  onBdrcImportOrder: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      order: { action: string; url: string; etext_id: string; scope?: 'volume' },
    ) => callback(order);
    ipcRenderer.on('bdrc:import-order', listener);
    return () => ipcRenderer.removeListener('bdrc:import-order', listener);
  },
  signalRendererReady: () => ipcRenderer.invoke('signalRendererReady'),
  onExternalFileChange: (callback: (filePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { filePath: string }) => {
      if (payload?.filePath) callback(payload.filePath);
    };
    ipcRenderer.on('file:external-change', listener);
    return () => ipcRenderer.removeListener('file:external-change', listener);
  },
  showNativeMessageBox: (options) => ipcRenderer.invoke('showNativeMessageBox', options),
  openNativeDialog: (options) => ipcRenderer.invoke('openNativeDialog', options),
  closeNativeDialog: (id: string) => ipcRenderer.invoke('closeNativeDialog', id),
  updateNativeDialogState: (payload) => ipcRenderer.invoke('updateNativeDialogState', payload),
  nativeDialogInvoke: (payload) => ipcRenderer.invoke('nativeDialog:invoke', payload),
  onNativeDialogClosed: (callback: (id: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('native-dialog:closed', listener);
    return () => ipcRenderer.removeListener('native-dialog:closed', listener);
  },
  onNativeDialogOpen: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { dialogId: string; title?: string; initialState?: unknown },
    ) => callback(payload);
    ipcRenderer.on('native-dialog:open', listener);
    return () => ipcRenderer.removeListener('native-dialog:open', listener);
  },
  onNativeDialogStateUpdate: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { dialogId: string; initialState: unknown },
    ) => callback(payload);
    ipcRenderer.on('native-dialog:state-update', listener);
    return () => ipcRenderer.removeListener('native-dialog:state-update', listener);
  },
  lspStart: (options) => ipcRenderer.invoke('lsp:start', options),
  lspStop: () => ipcRenderer.invoke('lsp:stop'),
  lspSend: (message) => ipcRenderer.invoke('lsp:send', message),
  onLspMessage: (callback: (message: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message);
    ipcRenderer.on('lsp:message', listener);
    return () => ipcRenderer.removeListener('lsp:message', listener);
  },
  entityDbBackupGetStatus: () => ipcRenderer.invoke('entityDbBackup:getStatus'),
  entityDbBackupSetConfig: (patch) => ipcRenderer.invoke('entityDbBackup:setConfig', patch),
  entityDbBackupClearConfig: () => ipcRenderer.invoke('entityDbBackup:clearConfig'),
  entityDbBackupTestConnection: (patch) =>
    ipcRenderer.invoke('entityDbBackup:testConnection', patch),
  entityDbBackupRunNow: () => ipcRenderer.invoke('entityDbBackup:runNow'),
  entityDbBackupListSnapshots: () => ipcRenderer.invoke('entityDbBackup:listSnapshots'),
  entityDbBackupRestore: (key: string) => ipcRenderer.invoke('entityDbBackup:restore', key),
  entityDbTursoHasToken: (url: string) => ipcRenderer.invoke('entityDbTurso:hasToken', url),
  entityDbTursoSetToken: (url: string, token: string | null) =>
    ipcRenderer.invoke('entityDbTurso:setToken', url, token),
  entityDbTursoTestConnection: (url: string, token: string) =>
    ipcRenderer.invoke('entityDbTurso:testConnection', url, token),
  entityDbTursoMigrateLocalData: (projectFilePath: string) =>
    ipcRenderer.invoke('entityDbTurso:migrateLocalData', projectFilePath),
  entityDatabaseEnsure: () => ipcRenderer.invoke('entityDatabase:ensure'),
  onEntityDatabaseChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('entityDatabase:changed', listener);
    return () => ipcRenderer.removeListener('entityDatabase:changed', listener);
  },
  entitySyncGetStatus: () => ipcRenderer.invoke('entitySync:getStatus'),
  entitySyncSetConfig: (patch) => ipcRenderer.invoke('entitySync:setConfig', patch),
  entitySyncRunNow: () => ipcRenderer.invoke('entitySync:runNow'),
  entitySyncListConflicts: () => ipcRenderer.invoke('entitySync:listConflicts'),
  entitySyncResolveConflict: (request) => ipcRenderer.invoke('entitySync:resolveConflict', request),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
