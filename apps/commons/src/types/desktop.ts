import type {
  AuthorityDownloadProgress,
  AuthoritySourceId,
  AuthoritySourceStatus,
} from '@src/desktop/authorityDbTypes';
import type {
  AuthorityLifecycleProgress,
  AuthorityLifecycleRunResult,
  AuthorityLifecycleSetEnabledOptions,
  AuthorityLifecycleStatus,
} from '@src/desktop/authorityLifecycleTypes';
import type {
  AuthorityRefLookupRequest,
  AuthorityRefLookupResult,
} from '@src/desktop/authorityRefTypes';
import type { ProjectBundle } from '@src/desktop/projectFile';
import type {
  SchemaUpdateApplyResult,
  SchemaUpdateCheckOptions,
  SchemaUpdateCheckResult,
} from '@src/desktop/schemaUpdateTypes';
import type { AppUpdateCheckResult } from '@src/desktop/appUpdateTypes';

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

export type NativeDialogType = 'settings' | 'schemaPicker' | 'schemaSetup' | 'projectMetadata';

export interface PickSchemaFilesResult {
  rngPath: string;
  cssPath: string | null;
}

export interface NativeDialogOptions {
  id: string;
  type: NativeDialogType;
  title?: string;
  initialState?: unknown;
}

export interface SchemaPickerOpenerOptions {
  mappingIds: string[];
  onSchemaSelect: (schema: {
    id: string;
    name: string;
    mapping: string;
    rng: string[];
    css: string[];
  }) => void | Promise<void>;
  onClose: (action: string) => void;
}

export interface NamedPath {
  name: string;
  path: string;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

export type ImportableDocumentFormat = 'txt' | 'md' | 'rtf' | 'docx' | 'odt' | 'xml';

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

/** Entity database cloud backup (see apps/desktop/src/entityDbBackup*.ts). */
export interface EntityDbBackupConfig {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix: string;
  intervalMinutes: number;
}

/** Redacted config safe for the renderer — proves a secret is set without revealing it. */
export interface EntityDbBackupConfigView {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  bucket: string;
  prefix: string;
  intervalMinutes: number;
  hasSecret: boolean;
  encryptionAvailable: boolean;
  /** Credentials are stored but could not be decrypted (e.g. a keychain prompt
   * that was dismissed). Automatic backups stay off until this clears. */
  credentialsLocked: boolean;
}

export interface EntityDbBackupResult {
  ok: boolean;
  reason: 'timer' | 'quit' | 'manual';
  key?: string;
  uploadedBytes?: number;
  sourceBytes?: number;
  sha256?: string;
  durationMs?: number;
  prunedKeys?: string[];
  skipped?: 'not-configured' | 'disabled' | 'in-progress' | 'no-database';
  error?: string;
}

export interface EntityDbBackupLastMarker {
  at: string;
  reason: 'timer' | 'quit' | 'manual';
  key: string;
  uploadedBytes: number;
  sourceBytes: number;
  sha256: string;
}

export interface EntityDbCloudSnapshot {
  key: string;
  size: number;
  lastModified: string;
  reason: string;
  timestamp: string;
}

export interface EntityDbRestoreResult {
  ok: boolean;
  restoredFromKey: string;
  restoredBytes: number;
  previousCopyDir: string;
  achievementsRestored?: boolean;
  error?: string;
}

export interface EntityDbIntegrityReport {
  ok: boolean;
  problems: string[];
  checked: boolean;
}

export interface EntityDbBackupStatus {
  config: EntityDbBackupConfigView;
  lastBackup: EntityDbBackupLastMarker | null;
  integrity: EntityDbIntegrityReport;
  hasLocalDatabase: boolean;
}

export interface EntityDbBackupProbeResult {
  ok: boolean;
  error?: string;
  objectCount?: number;
}

/** Cross-device entity sync (see apps/desktop/src/entitySync*.ts). */
export type SyncAuthMode = 'github' | 'oidc' | 'bearer';

export interface EntitySyncAuth {
  mode: SyncAuthMode;
  issuer?: string;
  clientId?: string;
}

export interface EntitySyncConfig {
  enabled: boolean;
  endpoint: string;
  intervalMinutes: number;
  auth: EntitySyncAuth;
}

/** setConfig patch: deep-partial auth + a transient bearer token (stored encrypted, never returned). */
export type EntitySyncConfigPatch = Partial<Omit<EntitySyncConfig, 'auth'>> & {
  auth?: Partial<EntitySyncAuth>;
  bearerToken?: string;
};

export interface EntitySyncRunSummary {
  ok: boolean;
  reason: 'manual' | 'timer' | 'launch';
  skipped?: 'disabled' | 'in-progress' | 'no-database' | 'not-signed-in' | 'write-quota';
  stoppedEarly?: 'write-quota';
  error?: string;
  pulledApplied?: number;
  pulledConflicts?: number;
  pushedApplied?: number;
  pushedReconciled?: number;
  pushedConflicts?: number;
  openConflicts?: number;
  cursor?: number;
  durationMs?: number;
  at?: string;
}

export interface EntitySyncStatus {
  config: EntitySyncConfig;
  signedIn: boolean;
  hasLocalDatabase: boolean;
  cursor: number | null;
  openConflicts: number | null;
  lastRun: EntitySyncRunSummary | null;
}

export interface EntitySyncConflict {
  id: number;
  projectEntityId: string;
  centralEntityId: string;
  reason: string;
  projectRevision: number;
  centralRevision: number;
  projectSnapshot: string;
  centralSnapshot: string;
  createdAt: string;
}

export interface AiApiSettings {
  apiKey: string;
  baseUrl: string;
  customInstructions: string;
  model: string;
  temperature: number;
  streamResults: boolean;
  /** Extra AI attempts after placeholders are dropped (0–5). First attempt always runs. */
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
  /** Optional — prefer omitting; names cause the model to expand placeholders. */
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

export interface AiTranslationMentionRef {
  index: number;
  kind: string;
}

export interface AiTranslationRequest {
  alignmentUnit: 'div' | 'p' | 'ab';
  sourceUnitXml: string;
  targetLanguage: string;
  mentions?: AiTranslationMentionRef[];
  /** @deprecated Prefer mentions. */
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

export interface ZoteroStyle {
  id: string;
  label: string;
  xml: string;
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

export type DesktopRightPanelTab =
  'fileMetadata' | 'attributes' | 'css' | 'imageViewer' | 'validation' | 'translation';

export interface DesktopValidatorInstrumentation {
  workerLoading: boolean;
  workerLoaded: boolean;
  schemaLoading: boolean;
  schemaLoaded: boolean;
  validationRunning: boolean;
  validationPanelRequested: boolean;
  validationPanelMounted: boolean;
}

export interface LeafWriterSourceFindBridge {
  applyJump: (params: {
    content: string;
    ignoreCase: boolean;
    query: string;
    useRegex: boolean;
    start: number;
    end: number;
  }) => boolean;
  clear: () => void;
  replaceRange: (params: {
    content: string;
    end: number;
    replacement: string;
    start: number;
  }) => boolean;
  revealRange: (params: {
    content: string;
    end: number;
    focusEditor?: boolean;
    start: number;
  }) => boolean;
  scrollToHit: (params: { content: string; end: number; start: number }) => boolean;
  getCursorOffset: () => number | null;
  setCursorOffset: (params: { focusEditor?: boolean; offset: number }) => boolean;
  undo: () => Promise<string | null>;
  redo: () => Promise<string | null>;
}

export interface WorkspaceSessionRestore {
  activeFilePath: string | null;
  bundle: ProjectBundle;
  cursorPositions?: Record<string, WorkspaceCursorPosition>;
  openFilePaths: string[];
}

export interface ElectronAPI {
  /** IPC methods are versioned independently from the shared renderer contract. */
  [method: string]: any;
  openProject: () => Promise<ProjectBundle | null>;
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
  pathExists: (filePath: string) => Promise<boolean>;
  statFile: (filePath: string) => Promise<FileStat>;
  syncWatchedFiles: (paths: string[]) => Promise<void>;
  ignoreFileChange: (filePath: string, mtimeMs: number) => Promise<void>;
  armFileWrite: (filePath: string) => Promise<void>;
  findXmlFilesByName: (rootPath: string, query: string) => Promise<NamedPath[]>;
  listProjectXmlFiles: (rootPath: string) => Promise<NamedPath[]>;
  reloadProjectBundle: (projectFilePath: string) => Promise<ProjectBundle | null>;
  /** Undo main-process project activation when renderer onboarding is cancelled. */
  clearActiveProject?: () => Promise<boolean>;
  installCatalogSchema: (projectFilePath: string, catalogId: string) => Promise<ProjectBundle>;
  installLocalSchema: (
    projectFilePath: string,
    rngPath: string,
    cssPath?: string | null,
  ) => Promise<ProjectBundle>;
  ensureSanmiaoDatesSchema?: (projectFilePath: string) => Promise<{ merged: boolean }>;
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
  /** Desktop app version from package.json / Electron app.getVersion(). */
  getAppVersion?: () => Promise<string>;
  getEncoderName: () => Promise<string>;
  setEncoderName: (name: string) => Promise<void>;
  /** Enable Chromium spellcheck for the translation pane and set dictionary languages. */
  setTranslationSpellcheck?: (options: {
    enabled: boolean;
    languageCodes?: string[];
  }) => Promise<void>;
  readAchievementsFile?: () => Promise<string | null>;
  writeAchievementsFile?: (content: string) => Promise<void>;
  readSourceProfiles?: () => Promise<import('../desktop/sourceProfileTypes').SourceProfileFile>;
  upsertSourceProfile?: (
    profile: import('../desktop/sourceProfileTypes').SourceProfile,
  ) => Promise<import('../desktop/sourceProfileTypes').SourceProfileFile>;
  deleteSourceProfile?: (
    profileId: string,
  ) => Promise<import('../desktop/sourceProfileTypes').SourceProfileFile>;
  getGameAssetColorStats?: (
    key: string,
  ) => Promise<{ lightness: number; saturation: number } | null>;
  saveCertificatePng?: (bytes: Uint8Array, suggestedName: string) => Promise<boolean>;
  getCachedLeaderboardToken?: () => Promise<string | null>;
  clearCachedLeaderboardToken?: () => Promise<void>;
  startLeaderboardDeviceFlow?: () => Promise<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
  }>;
  pollLeaderboardDeviceFlow?: (
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
  ) => Promise<{ token: string } | { error: string }>;
  mapTilesStatus?: () => Promise<{
    installed: boolean;
    path: string | null;
    regions: {
      id: string;
      sha256: string;
      installedAt: string;
      /** Highest zoom present in the installed .pmtiles (from the archive header). */
      maxZoom?: number;
      minZoom?: number;
    }[];
  }>;
  mapTilesDownloadBackground?: (bundle: {
    id: string;
    source?: string;
    url: string;
    bbox?: [number, number, number, number];
    fileName: string;
    bytes?: number;
    sha256?: string;
  }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>;
  mapTilesDownloadStatus?: () => Promise<{
    active: {
      bundleId: string;
      message: string;
      receivedBytes?: number;
      totalBytes?: number | null;
    }[];
  }>;
  mapTilesRemove?: (bundleId: string) => Promise<{ ok: boolean; error?: string }>;
  onMapTilesProgress?: (
    callback: (progress: {
      bundleId: string;
      message: string;
      receivedBytes?: number;
      totalBytes?: number | null;
    }) => void,
  ) => () => void;
  onMapTilesDownloadComplete?: (
    callback: (result: {
      bundleId: string;
      installed: boolean;
      path?: string;
      error?: string;
    }) => void,
  ) => () => void;
  getEntityDbFolder: () => Promise<string | null>;
  setEntityDbFolder: (folder: string | null) => Promise<void>;
  pickEntityDbFolder: () => Promise<string | null>;
  createEntityDatabase: (folder: string, content: string) => Promise<void>;
  bulkBridgeStart?: (
    request: import('../desktop/bulkBridgeTypes').BulkBridgeJobRequest,
  ) => Promise<string>;
  bulkBridgeCancel?: (jobId: string) => Promise<boolean>;
  onBulkBridgeProgress?: (
    callback: (event: import('../desktop/bulkBridgeTypes').BulkBridgeJobEvent) => void,
  ) => () => void;
  entityIndexStart?: (
    request: import('../desktop/entityIndexTypes').EntityIndexJobRequest,
  ) => Promise<string>;
  entityIndexCancel?: (jobId: string) => Promise<boolean>;
  onEntityIndexProgress?: (
    callback: (event: import('../desktop/entityIndexTypes').EntityIndexJobEvent) => void,
  ) => () => void;
  approveEntityRegistryRoots: (roots: string[]) => Promise<boolean>;
  moveEntityDbFolder: () => Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    folder?: string;
  }>;
  pickAuthorityPacksSource?: () => Promise<string | null>;
  authorityDbStatuses?: () => Promise<AuthoritySourceStatus[]>;
  authorityDbDownload?: (sourceId: AuthoritySourceId) => Promise<{ ok: boolean; error?: string }>;
  authorityDbPromptDownload?: () => Promise<'accepted' | 'declined'>;
  authorityRefLookup?: (
    request: AuthorityRefLookupRequest,
  ) => Promise<AuthorityRefLookupResult | null>;
  onAuthorityDbProgress?: (callback: (progress: AuthorityDownloadProgress) => void) => () => void;
  authorityPackStatuses?: () => Promise<
    import('@src/desktop/authorityPackTypes').AuthorityPackStatus[]
  >;
  authorityPackRead?: (
    packId: import('@src/desktop/authorityPackTypes').AuthorityPackId,
    dateFilter?: import('@src/desktop/authorityPackTypes').AuthorityPackDateFilter,
  ) => Promise<string[]>;
  authorityPackLookupByIds?: (
    packId: import('@src/desktop/authorityPackTypes').AuthorityPackId,
    authorityIds: string[],
  ) => Promise<string[]>;
  authorityPackInstallFrom?: (
    sourcePacksRoot: string,
  ) => Promise<{ ok: boolean; copied?: string[]; error?: string }>;
  pluginsGetSnapshot?: () => Promise<
    import('../../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsSetEnabled?: (
    pluginId: string,
    enabled: boolean,
  ) => Promise<
    import('../../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsInstallFrom?: (
    sourceDir: string,
  ) => Promise<
    import('../../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  pluginsPickInstallFolder?: () => Promise<string | null>;
  pluginsDismissLanguagePrompt?: (pluginId: string) => Promise<void>;
  pluginsIsEnabled?: (pluginId: string) => Promise<boolean>;
  pluginsGetModuleUrl?: (pluginId: string) => Promise<string | null>;
  pluginsGetRemoteIndex?: () => Promise<
    import('../desktop/pluginRegistryTypes').PluginReleaseIndex
  >;
  pluginsInstallRemote?: (
    entry: import('../desktop/pluginRegistryTypes').PluginReleaseEntry,
  ) => Promise<
    import('../../../../packages/cwrc-leafwriter/src/plugins/types').PluginHostSnapshotView
  >;
  authorityLifecycleGet?: () => Promise<AuthorityLifecycleStatus>;
  authorityLifecycleSetEnabled?: (
    options: AuthorityLifecycleSetEnabledOptions,
  ) => Promise<AuthorityLifecycleRunResult>;
  authorityLifecycleSetReferenceDataEnabled?: (
    enabled: boolean,
  ) => Promise<AuthorityLifecycleRunResult>;
  authorityLifecycleUpdate?: () => Promise<AuthorityLifecycleRunResult>;
  authorityLifecycleMaybeCheckUpdates?: (options?: {
    force?: boolean;
  }) => Promise<AuthorityLifecycleStatus | null>;
  authorityLifecyclePromptEnable?: (
    profile?: import('@src/desktop/authorityLifecycleTypes').AuthorityLifecycleProfile,
    strings?: import('@src/desktop/authorityLifecycleTypes').AuthorityLifecyclePromptStrings,
  ) => Promise<'accepted' | 'declined'>;
  authorityLifecycleRevealFolder?: () => Promise<boolean>;
  getShouldUseDarkColors?: () => Promise<boolean>;
  setNativeThemeSource?: (source: 'system' | 'light' | 'dark') => Promise<boolean>;
  onNativeThemeChanged?: (callback: (shouldUseDarkColors: boolean) => void) => () => void;
  onAuthorityLifecycleProgress?: (
    callback: (progress: AuthorityLifecycleProgress) => void,
  ) => () => void;
  onAuthorityLifecycleUpdated?: (callback: () => void) => () => void;
  /** Fired after the background updater replaced one or more installed plugins. */
  onPluginsUpdated?: (callback: () => void) => () => void;
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
  onPluginPythonProgress?: (
    pluginId: string,
    callback: (
      progress: import('../../../../packages/cwrc-leafwriter/src/autoTagging/dates').SanmiaoChunkProgressEvent,
    ) => void,
  ) => () => void;
  updateProjectFileConfig: (
    projectFilePath: string,
    patch: Record<string, unknown>,
  ) => Promise<ProjectBundle>;
  getAiApiSettings: () => Promise<AiApiSettings>;
  setAiApiSettings: (settings: Partial<AiApiSettings>) => Promise<void>;
  testAiConnection: (settings: Partial<AiApiSettings>) => Promise<AiConnectionResult>;
  entityDbBackupGetStatus?: () => Promise<EntityDbBackupStatus>;
  entityDbBackupSetConfig?: (
    patch: Partial<EntityDbBackupConfig>,
  ) => Promise<EntityDbBackupConfigView>;
  entityDbBackupClearConfig?: () => Promise<void>;
  entityDbBackupTestConnection?: (
    patch: Partial<EntityDbBackupConfig>,
  ) => Promise<EntityDbBackupProbeResult>;
  entityDbBackupRunNow?: () => Promise<EntityDbBackupResult>;
  entityDbBackupListSnapshots?: () => Promise<EntityDbCloudSnapshot[]>;
  entityDbBackupRestore?: (key: string) => Promise<EntityDbRestoreResult>;
  /** Per-project Turso PEDB auth token, stored encrypted, keyed by database url. */
  entityDbTursoHasToken?: (url: string) => Promise<boolean>;
  entityDbTursoSetToken?: (url: string, token: string | null) => Promise<void>;
  entityDbTursoTestConnection?: (
    url: string,
    token: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  entityDatabaseEnsure?: () => Promise<{ folder: string; dbPath: string; created: boolean } | null>;
  onEntityDatabaseChanged?: (callback: () => void) => () => void;
  entitySyncGetStatus?: () => Promise<EntitySyncStatus>;
  entitySyncSetConfig?: (patch: EntitySyncConfigPatch) => Promise<EntitySyncConfig>;
  entitySyncRunNow?: () => Promise<EntitySyncRunSummary>;
  entitySyncListConflicts?: () => Promise<EntitySyncConflict[]>;
  entitySyncResolveConflict?: (request: {
    id: number;
    keep: 'local' | 'remote';
  }) => Promise<{ ok: boolean }>;
  getLanguageToolSettings: () => Promise<LanguageToolSettings>;
  setLanguageToolSettings: (settings: Partial<LanguageToolSettings>) => Promise<void>;
  testLanguageToolConnection: (
    settings: Partial<LanguageToolSettings>,
  ) => Promise<LanguageToolConnectionResult>;
  checkLanguageTool: (request: LanguageToolCheckRequest) => Promise<LanguageToolCheckResult>;
  languageToolGetInstallStatus?: () => Promise<LanguageToolInstallStatus>;
  languageToolInstallJava?: () => Promise<LanguageToolInstallStatus>;
  languageToolInstall?: () => Promise<LanguageToolInstallStatus>;
  languageToolRemove?: () => Promise<LanguageToolInstallStatus>;
  languageToolInstallNgrams?: () => Promise<LanguageToolInstallStatus>;
  languageToolEnsureServer?: () => Promise<{ ok: boolean; error?: string; port?: number }>;
  onLanguageToolInstallProgress?: (
    callback: (progress: LanguageToolInstallProgress) => void,
  ) => () => void;
  generateAiTranslation: (request: AiTranslationRequest) => Promise<AiTranslationResult>;
  suggestEntityGloss: (request: AiEntityGlossRequest) => Promise<AiEntityGlossResult>;
  zoteroListStyles: () => Promise<ZoteroStyle[]>;
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
  popupAppMenu?: (x?: number, y?: number) => Promise<void>;
  openExternalUrl: (url: string) => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
  onAppMenuAction: (callback: (action: string) => void) => () => void;
  onOpenRecentProject?: (callback: (projectFilePath: string) => void) => () => void;
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
  setUiZoomFactor?: (factor: number) => void;
  getUiZoomFactor?: () => number;
}

declare global {
  interface JQuery {
    dialog(method: 'option', optionName: string): any;
    dialog(...args: unknown[]): JQuery;
  }

  interface Window {
    electronAPI?: ElectronAPI;
    __desktopRightPanel?: {
      collapse: () => void;
      expand: () => void;
      showTab: (tab: DesktopRightPanelTab) => void;
      dismissTab: (tab: DesktopRightPanelTab) => void;
    };
    __desktopRightPanelPendingTab?: DesktopRightPanelTab;
    __desktopValidatorInstrumentation?: DesktopValidatorInstrumentation;
    __ljbCommonsUi?: {
      aiApiSettings: AiApiSettings | null;
      languageToolSettings: LanguageToolSettings | null;
      encoderName: string;
      encoderNameLoaded: boolean;
      entityDbFolder: string | null;
      rememberWorkspaceOnStartup: boolean;
      skipEntityDetachConfirm: boolean;
      skipExplorerDeleteConfirm: boolean;
      pickEntityDbFolder: () => Promise<string | null>;
      moveEntityDbFolder: () => Promise<{
        ok: boolean;
        cancelled?: boolean;
        error?: string;
        folder?: string;
      }>;
      entityDbBackupStatus: EntityDbBackupStatus | null;
      refreshEntityDbBackupStatus: () => Promise<void>;
      setEntityDbBackupConfig: (
        patch: Partial<EntityDbBackupConfig>,
      ) => Promise<EntityDbBackupConfigView | null>;
      clearEntityDbBackupConfig: () => Promise<void>;
      testEntityDbBackupConnection: (
        patch: Partial<EntityDbBackupConfig>,
      ) => Promise<EntityDbBackupProbeResult>;
      runEntityDbBackupNow: () => Promise<EntityDbBackupResult>;
      listEntityDbBackupSnapshots: () => Promise<EntityDbCloudSnapshot[]>;
      restoreEntityDbBackup: (key: string) => Promise<EntityDbRestoreResult>;
      entitySyncStatus: EntitySyncStatus | null;
      refreshEntitySyncStatus: () => Promise<void>;
      setEntitySyncConfig: (patch: EntitySyncConfigPatch) => Promise<EntitySyncConfig | null>;
      runEntitySyncNow: () => Promise<EntitySyncRunSummary>;
      listEntitySyncConflicts: () => Promise<EntitySyncConflict[]>;
      resolveEntitySyncConflict: (request: {
        id: number;
        keep: 'local' | 'remote';
      }) => Promise<{ ok: boolean }>;
      setAiApiSettings: (settings: Partial<AiApiSettings>) => void | Promise<void>;
      setLanguageToolSettings: (settings: Partial<LanguageToolSettings>) => void | Promise<void>;
      githubConnected: boolean;
      connectGithub: (
        onStarted?: (userCode: string) => void,
      ) => Promise<{ ok: boolean; error?: string }>;
      disconnectGithub: () => Promise<void>;
      setEncoderName: (name: string) => void | Promise<void>;
      setRememberWorkspaceOnStartup: (value: boolean) => void | Promise<void>;
      setSkipEntityDetachConfirm: (value: boolean) => void;
      setSkipExplorerDeleteConfirm: (value: boolean) => void;
      testAiConnection: (settings: Partial<AiApiSettings>) => Promise<AiConnectionResult>;
      testLanguageToolConnection: (
        settings: Partial<LanguageToolSettings>,
      ) => Promise<LanguageToolConnectionResult>;
      authorityLifecycleStatus: AuthorityLifecycleStatus | null;
      refreshAuthorityLifecycle: () => Promise<void>;
      setAuthorityLifecycleEnabled: (
        options: AuthorityLifecycleSetEnabledOptions,
      ) => Promise<AuthorityLifecycleRunResult>;
      setAuthorityLifecycleReferenceDataEnabled: (
        enabled: boolean,
      ) => Promise<AuthorityLifecycleRunResult>;
      runAuthorityLifecycleUpdate: () => Promise<AuthorityLifecycleRunResult>;
      revealAuthorityLifecycleFolder: () => Promise<void>;
    };
    __ljbOpenNativeSchemaPicker?: (options: SchemaPickerOpenerOptions) => Promise<void>;
    /** Registered by the project-settings form while it has unsaved edits.
     * Mirrors the declaration in the editor package's globals.d.ts; commons
     * resolves its Window globals from this file, not from that one. */
    __ljbConfirmDiscardProjectSettings?: () => boolean;
    /** Desktop: strip teiHeader before WYSIWYG load (registered by useLeafWriter). */
    __desktopStripTeiHeaderForVisualEditor?: (xml: string) => string;
    /** Desktop: merge visual editor body XML into the stored full document. */
    __desktopMergeEditorBodyWithStoredHeader?: (editorXml: string, storedXml?: string) => string;
    /** Desktop: canonical tab XML with header (for validation merge). */
    __desktopStoredDocumentXml?: string;
    /** Desktop: merge stored header into editor XML before validation. */
    __desktopMergeHeaderForValidation?: (editorXml: string) => string;
    /** Desktop: whether the Translation tab is currently open (gates automatic reindex-on-save). */
    __desktopTranslationTabActive?: boolean;
    /** One-shot: next external sync into the Monaco source editor resets the undo stack
     * instead of pushing an undoable edit (set by reload paths after translation reindexing). */
    __leafWriterNextSourceSyncResetsUndo?: boolean;
    __leafWriterTranslationPane?: {
      filePath: string | null;
      isActive: () => boolean;
      redo: () => Promise<boolean>;
      replaceContent: (filePath: string, content: string) => boolean;
      undo: () => Promise<boolean>;
    };
    __leafWriterSourceFind?: LeafWriterSourceFindBridge;
    /** Zoom the visual editor pane (published by cwrc-leafwriter on editor init). */
    __leafWriterEditorZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
    /** Zoom the source (Monaco) view font (published while a source editor is mounted). */
    __leafWriterSourceZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
    /** Zoom the translation pane font (published while the pane is mounted). */
    __leafWriterTranslationZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
  }
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.electronAPI;
