import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { recoverFromFailedAtomicWrite, writeFileAtomic } from './atomicWrite';
import {
  DEFAULT_LANGUAGE_TOOL_SETTINGS,
  sanitizeLanguageToolSettings,
  type LanguageToolSettings,
} from './languageTool';

export type { LanguageToolSettings };

export const MAX_RECENT_PROJECTS = 10;

interface AppPrefs {
  lastProjectFile: string | null;
  recentProjectFiles?: string[];
  encoderName?: string;
  aiApi?: AiApiSettings;
  languageTool?: LanguageToolSettings;
  rememberWorkspaceOnStartup?: boolean;
  workspaceSession?: WorkspaceSession;
  entityDbFolder?: string | null;
  /** Explicit override for where achievements.json lives; see getAchievementsFolder. */
  achievementsFolder?: string | null;
  /** Last directory used in a system open/save dialog. */
  lastDialogDir?: string | null;
}

const PREFS_FILENAME = 'project-prefs.json';

export interface WorkspaceSession {
  activeFilePath: string | null;
  cursorPositions?: Record<string, WorkspaceCursorPosition>;
  openFilePaths: string[];
  projectFilePath: string | null;
}

export type WorkspaceCursorPosition =
  | { mode: 'source'; offset: number }
  | { mode: 'visual'; offsetInElementText: number; teiXPath: string };

export interface AiApiSettings {
  apiKey: string;
  baseUrl: string;
  customInstructions: string;
  model: string;
  temperature: number;
  /** Show verified chunks immediately instead of waiting for the full run. */
  streamResults: boolean;
  /**
   * How many times to resend a translation when the model drops placeholders
   * (0 = no retry; first attempt always runs). Hard-capped in sanitize.
   */
  placeholderRetryLimit: number;
  /** When true, AI curation runs unconditionally — no per-run opt-in checkbox (e.g. Disambiguate). */
  alwaysOn: boolean;
  /**
   * Simultaneous model requests for bulk runs (AI punctuation). 0 = automatic: 1 for a local
   * server, which gains nothing from parallel requests, more for a hosted API.
   */
  concurrency: number;
  /**
   * `reasoning_effort` sent to reasoning models (e.g. `minimal`, `low`, `none`); accepted values
   * depend on the model. Empty = send nothing. Dropped for the run if the API rejects it.
   */
  reasoningEffort: string;
  /** Successful connection test for this exact endpoint and model. */
  verifiedAt: string | null;
  verifiedBaseUrl: string;
  verifiedModel: string;
}

export const DEFAULT_AI_API_SETTINGS: AiApiSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:1234/v1',
  customInstructions: '',
  model: '',
  temperature: 0.1,
  streamResults: true,
  placeholderRetryLimit: 1,
  alwaysOn: false,
  concurrency: 0,
  reasoningEffort: '',
  verifiedAt: null,
  verifiedBaseUrl: '',
  verifiedModel: '',
};

/** Inclusive upper bound so the retry loop can never run away. */
export const MAX_PLACEHOLDER_RETRY_LIMIT = 5;

/** Inclusive upper bound on simultaneous model requests. */
export const MAX_AI_CONCURRENCY = 16;

const sanitizeAiApiSettings = (value: Partial<AiApiSettings> | undefined): AiApiSettings => {
  const temperature =
    typeof value?.temperature === 'number' && Number.isFinite(value.temperature)
      ? Math.min(2, Math.max(0, value.temperature))
      : DEFAULT_AI_API_SETTINGS.temperature;
  const placeholderRetryLimit =
    typeof value?.placeholderRetryLimit === 'number' && Number.isFinite(value.placeholderRetryLimit)
      ? Math.min(MAX_PLACEHOLDER_RETRY_LIMIT, Math.max(0, Math.floor(value.placeholderRetryLimit)))
      : DEFAULT_AI_API_SETTINGS.placeholderRetryLimit;

  return {
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : DEFAULT_AI_API_SETTINGS.apiKey,
    baseUrl:
      typeof value?.baseUrl === 'string' && value.baseUrl.trim()
        ? value.baseUrl.trim()
        : DEFAULT_AI_API_SETTINGS.baseUrl,
    customInstructions:
      typeof value?.customInstructions === 'string' ? value.customInstructions : '',
    model: typeof value?.model === 'string' ? value.model.trim() : '',
    temperature,
    // Default on; only an explicit `false` from a saved project opts back out.
    streamResults: value?.streamResults !== false,
    placeholderRetryLimit,
    alwaysOn: value?.alwaysOn === true,
    concurrency:
      typeof value?.concurrency === 'number' && Number.isFinite(value.concurrency)
        ? Math.min(MAX_AI_CONCURRENCY, Math.max(0, Math.floor(value.concurrency)))
        : DEFAULT_AI_API_SETTINGS.concurrency,
    reasoningEffort:
      typeof value?.reasoningEffort === 'string' ? value.reasoningEffort.trim().toLowerCase() : '',
    verifiedAt: typeof value?.verifiedAt === 'string' ? value.verifiedAt : null,
    verifiedBaseUrl: typeof value?.verifiedBaseUrl === 'string' ? value.verifiedBaseUrl.trim() : '',
    verifiedModel: typeof value?.verifiedModel === 'string' ? value.verifiedModel.trim() : '',
  };
};

const sanitizeWorkspaceSession = (value: WorkspaceSession | undefined): WorkspaceSession => {
  const openFilePaths = Array.isArray(value?.openFilePaths)
    ? value.openFilePaths.filter((filePath): filePath is string => typeof filePath === 'string')
    : [];
  const cursorPositions: Record<string, WorkspaceCursorPosition> = {};

  if (value?.cursorPositions && typeof value.cursorPositions === 'object') {
    for (const [filePath, position] of Object.entries(value.cursorPositions)) {
      if (typeof filePath !== 'string' || !position || typeof position !== 'object') continue;
      if (position.mode === 'source' && typeof position.offset === 'number') {
        cursorPositions[filePath] = { mode: 'source', offset: position.offset };
      } else if (
        position.mode === 'visual' &&
        typeof position.teiXPath === 'string' &&
        typeof position.offsetInElementText === 'number'
      ) {
        cursorPositions[filePath] = {
          mode: 'visual',
          offsetInElementText: position.offsetInElementText,
          teiXPath: position.teiXPath,
        };
      }
    }
  }

  return {
    activeFilePath: typeof value?.activeFilePath === 'string' ? value.activeFilePath : null,
    cursorPositions,
    openFilePaths: Array.from(new Set(openFilePaths)),
    projectFilePath: typeof value?.projectFilePath === 'string' ? value.projectFilePath : null,
  };
};

const getPrefsPath = () => path.join(app.getPath('userData'), PREFS_FILENAME);

const DEFAULT_ENTITY_DB_DIRNAME = 'entity-database';

const getDefaultEntityDbFolder = () =>
  path.join(app.getPath('userData'), DEFAULT_ENTITY_DB_DIRNAME);

// Windows briefly removes the live prefs file while swapping `.tmp` into
// place. Readers must not recover that `.tmp` during the swap, or the writer
// will fail when it tries to rename a temp file that another reader stole.
let prefsWriteInProgress = false;

export const sanitizeRecentProjectFiles = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    recent.push(trimmed);
    if (recent.length >= MAX_RECENT_PROJECTS) break;
  }
  return recent;
};

const touchRecentProject = (prefs: AppPrefs, projectFilePath: string) => {
  prefs.lastProjectFile = projectFilePath;
  const withoutCurrent = sanitizeRecentProjectFiles(prefs.recentProjectFiles).filter(
    (entry) => entry !== projectFilePath,
  );
  prefs.recentProjectFiles = [projectFilePath, ...withoutCurrent].slice(0, MAX_RECENT_PROJECTS);
};

const defaultAppPrefs = (): AppPrefs => ({
  lastProjectFile: null,
  recentProjectFiles: [],
  encoderName: '',
  aiApi: DEFAULT_AI_API_SETTINGS,
  languageTool: DEFAULT_LANGUAGE_TOOL_SETTINGS,
  rememberWorkspaceOnStartup: true,
  workspaceSession: sanitizeWorkspaceSession(undefined),
  entityDbFolder: null,
  achievementsFolder: null,
});

const readCommonPrefs = (
  parsed: Partial<AppPrefs> & { lastRootPath?: string | null },
): Omit<AppPrefs, 'lastProjectFile' | 'aiApi' | 'languageTool'> & {
  aiApi: AiApiSettings;
  languageTool: LanguageToolSettings;
} => ({
  encoderName: typeof parsed.encoderName === 'string' ? parsed.encoderName : '',
  aiApi: sanitizeAiApiSettings(parsed.aiApi),
  languageTool: sanitizeLanguageToolSettings(parsed.languageTool),
  rememberWorkspaceOnStartup: parsed.rememberWorkspaceOnStartup !== false,
  workspaceSession: sanitizeWorkspaceSession(parsed.workspaceSession),
  entityDbFolder:
    typeof parsed.entityDbFolder === 'string' ? parsed.entityDbFolder.trim() || null : null,
  achievementsFolder:
    typeof parsed.achievementsFolder === 'string' ? parsed.achievementsFolder.trim() || null : null,
});

const resolveLastProjectFile = (
  parsed: Partial<AppPrefs> & { lastRootPath?: string | null },
): string | null => {
  if (typeof parsed.lastProjectFile === 'string') {
    return parsed.lastProjectFile;
  }

  if (typeof parsed.lastRootPath === 'string') {
    return path.join(parsed.lastRootPath, 'jean-baptiste.project.json');
  }

  return null;
};

/** Parse stored prefs JSON. Exported for unit tests. */
export const parseAppPrefs = (
  parsed: Partial<AppPrefs> & { lastRootPath?: string | null },
): AppPrefs & { aiApi: AiApiSettings; languageTool: LanguageToolSettings } => {
  const common = readCommonPrefs(parsed);
  const lastProjectFile = resolveLastProjectFile(parsed);
  let recentProjectFiles = sanitizeRecentProjectFiles(parsed.recentProjectFiles);

  if (recentProjectFiles.length === 0 && lastProjectFile) {
    recentProjectFiles = [lastProjectFile];
  }

  return {
    ...common,
    lastProjectFile,
    recentProjectFiles,
  };
};

const readAppPrefs = async (): Promise<AppPrefs> => {
  const prefsPath = getPrefsPath();
  try {
    if (!prefsWriteInProgress) await recoverFromFailedAtomicWrite(prefsPath);
    const raw = await fs.readFile(prefsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppPrefs> & { lastRootPath?: string | null };
    return parseAppPrefs(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // One more recovery pass: a concurrent Windows atomic write may have
      // just left `.bak`/`.tmp` behind with the real prefs.
      if (!prefsWriteInProgress && (await recoverFromFailedAtomicWrite(prefsPath))) {
        try {
          const raw = await fs.readFile(prefsPath, 'utf-8');
          const parsed = JSON.parse(raw) as Partial<AppPrefs> & { lastRootPath?: string | null };
          return parseAppPrefs(parsed);
        } catch {
          // fall through to defaults
        }
      }
      return defaultAppPrefs();
    }
    const corruptPath = `${prefsPath}.corrupt-${Date.now()}`;
    await fs.rename(prefsPath, corruptPath).catch(() => undefined);
    return defaultAppPrefs();
  }
};

const writeAppPrefs = async (prefs: AppPrefs) => {
  await writeFileAtomic(getPrefsPath(), JSON.stringify(prefs, null, 2));
};

/** Serialize read-modify-write so concurrent saves cannot clobber fields like entityDbFolder. */
let prefsWriteChain: Promise<void> = Promise.resolve();

const mutateAppPrefs = async (mutator: (prefs: AppPrefs) => void): Promise<void> => {
  // A failed write must not leave every later preference save rejected by the
  // same promise chain. The next save gets a chance to recover `.tmp`/`.bak`.
  prefsWriteChain = prefsWriteChain
    .catch(() => undefined)
    .then(async () => {
      const prefs = await readAppPrefs();
      mutator(prefs);
      prefsWriteInProgress = true;
      try {
        await writeAppPrefs(prefs);
      } finally {
        prefsWriteInProgress = false;
      }
    });
  await prefsWriteChain;
};

/**
 * In-memory copy of the configured entity-database folder. Avoids re-reading
 * (and risking a mid-write ENOENT → false “unset”) on every renderer readFile
 * path check. Invalidated whenever the folder is set explicitly.
 */
let cachedEntityDbFolder: string | null | undefined;

export const writeLastProjectFile = async (projectFilePath: string) => {
  await mutateAppPrefs((prefs) => {
    touchRecentProject(prefs, projectFilePath);
  });
};

export const removeMissingRecentProject = async (projectFilePath: string) => {
  await mutateAppPrefs((prefs) => {
    prefs.recentProjectFiles = sanitizeRecentProjectFiles(prefs.recentProjectFiles).filter(
      (entry) => entry !== projectFilePath,
    );
    if (prefs.lastProjectFile === projectFilePath) {
      prefs.lastProjectFile = prefs.recentProjectFiles[0] ?? null;
    }
  });
};

/** Forget a project that was moved or renamed, allowing startup to recover normally. */
export const clearMissingProjectReferences = async (): Promise<void> => {
  await mutateAppPrefs((prefs) => {
    prefs.lastProjectFile = null;
    prefs.recentProjectFiles = [];
    prefs.workspaceSession = undefined;
  });
};

export const getRecentProjects = async (): Promise<string[]> => {
  const prefs = await readAppPrefs();
  const candidates = sanitizeRecentProjectFiles(prefs.recentProjectFiles);
  const validated: string[] = [];

  for (const projectFilePath of candidates) {
    try {
      const stat = await fs.stat(projectFilePath);
      if (stat.isFile()) validated.push(projectFilePath);
    } catch {
      // Drop entries whose project file was moved or deleted.
    }
  }

  const changed =
    validated.length !== candidates.length ||
    validated.some((entry, index) => entry !== candidates[index]);

  if (changed) {
    await mutateAppPrefs((nextPrefs) => {
      nextPrefs.recentProjectFiles = validated;
      if (nextPrefs.lastProjectFile && !validated.includes(nextPrefs.lastProjectFile)) {
        nextPrefs.lastProjectFile = validated[0] ?? null;
      }
    });
  }

  return validated;
};

export const getValidLastProjectFile = async (): Promise<string | null> => {
  const prefs = await readAppPrefs();
  if (!prefs.lastProjectFile) return null;

  try {
    const stat = await fs.stat(prefs.lastProjectFile);
    if (stat.isFile()) return prefs.lastProjectFile;
  } catch {
    // Project file was moved or deleted.
  }

  return null;
};

export const getEncoderName = async (): Promise<string> => {
  const prefs = await readAppPrefs();
  return prefs.encoderName?.trim() ?? '';
};

export const setEncoderName = async (encoderName: string) => {
  await mutateAppPrefs((prefs) => {
    prefs.encoderName = encoderName.trim();
  });
};

export const getLastDialogDir = async (): Promise<string | null> => {
  const prefs = await readAppPrefs();
  const dir = prefs.lastDialogDir?.trim();
  return dir || null;
};

export const setLastDialogDir = async (dir: string | null) => {
  await mutateAppPrefs((prefs) => {
    prefs.lastDialogDir = dir?.trim() || null;
  });
};

/**
 * Returns the user's chosen entity-database folder, or auto-creates and
 * persists a fixed default under Electron's per-platform app-data directory
 * the first time this is called. Never returns null in practice; callers
 * that picked a custom folder in the past keep using it unchanged.
 *
 * Deliberately trusts prefs.entityDbFolder as-is with no existence checks,
 * retries, or fallback to some other previously-used folder: this used to
 * auto-recover from history when entities.xml wasn't immediately found, but
 * that misfired on ordinary transient conditions (a synced/network folder
 * not yet mounted) and silently pointed people at the wrong database. If
 * this folder is genuinely unreachable, callers see that directly instead of
 * being quietly redirected somewhere else.
 *
 * Defaulting is done inside the serialized prefs write chain, and only when
 * the stored value is still empty — a concurrent workspace-session save must
 * never be able to briefly hide prefs and trick us into overwriting a real
 * ShareDocs/Dropbox path with the empty app-data default.
 */
let hasShownEntityDbCreationError = false;

export const getEntityDbFolder = async (): Promise<string | null> => {
  if (typeof cachedEntityDbFolder === 'string' && cachedEntityDbFolder.trim()) {
    return cachedEntityDbFolder;
  }

  const prefs = await readAppPrefs();
  const existing = prefs.entityDbFolder?.trim();
  if (existing) {
    cachedEntityDbFolder = existing;
    return existing;
  }

  const defaultFolder = getDefaultEntityDbFolder();
  try {
    await fs.mkdir(defaultFolder, { recursive: true });
    // Only write the default if nothing else won the race while we were
    // mkdir'ing — otherwise we would clobber a folder the user just set
    // (or that a recovered prefs file already had).
    await mutateAppPrefs((p) => {
      if (!p.entityDbFolder?.trim()) p.entityDbFolder = defaultFolder;
    });
  } catch (error) {
    // Surface the failure instead of throwing: an uncaught rejection here
    // propagates through the IPC call and leaves the settings panel showing
    // a blank folder path with no indication why. console.error alone is
    // invisible in a packaged build with devtools closed, so also show a
    // native dialog once per session - entity tagging is fully blocked
    // until this folder exists, so this needs to reach the user, not just
    // the log. (mkdir failing means nothing gets persisted, so every call
    // here retries and would otherwise re-show the dialog every time.)
    console.error('Failed to create default entity database folder:', error);
    if (!hasShownEntityDbCreationError) {
      hasShownEntityDbCreationError = true;
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        'Could not create your entity database folder',
        `Grognard could not create:\n${defaultFolder}\n\n${detail}\n\nEntity tagging will be unavailable until you choose a writable folder in Settings > Entity database.`,
      );
    }
    cachedEntityDbFolder = defaultFolder;
    return defaultFolder;
  }

  const after = await readAppPrefs();
  const resolved = after.entityDbFolder?.trim() || defaultFolder;
  cachedEntityDbFolder = resolved;
  return resolved;
};

/** Setting a new folder forgets the old one completely - no history is kept to fall back to. */
export const setEntityDbFolder = async (folder: string | null) => {
  const next = folder?.trim() || null;
  cachedEntityDbFolder = next ?? undefined;
  await mutateAppPrefs((prefs) => {
    prefs.entityDbFolder = next;
  });
  cachedEntityDbFolder = next;
};

const LOCAL_AUTHORITY_ASSETS_DIRNAME = 'authority-assets';
/** Historically these lived inside the (often cloud-synced) entity database folder; see getLocalAuthorityAssetsDir. */
const MIGRATED_AUTHORITY_SUBDIRS = ['authority-packs', 'authority-databases'] as const;
let authorityAssetsMigrationAttempted = false;

const moveDirectory = async (source: string, dest: string): Promise<void> => {
  try {
    await fs.rename(source, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    // Source and destination are on different volumes - fall back to copy+delete.
    await fs.cp(source, dest, { recursive: true });
    await fs.rm(source, { recursive: true, force: true });
  }
};

/**
 * Base directory for downloaded authority-pack/database assets (CBDB, DILA,
 * compiled Wikidata packs, CHGIS, etc.) - always the local per-machine
 * app-data folder, never inside the entity database folder. These can run
 * into the hundreds of MB, and the entity database folder is commonly
 * synced (Dropbox/iCloud/etc.); syncing that much data would be slow and
 * wasteful, and it re-creates exactly the "is this folder really here yet"
 * race that has already caused real data loss elsewhere in this app (see
 * EntityStore.loadEntities()'s retry logic).
 *
 * One-time, best-effort migration: if a legacy install already downloaded
 * these under the entity database folder, move them here instead of forcing
 * a re-download. Attempted at most once per app session; a failure just
 * leaves the legacy copy in place and retries on next launch.
 */
export const getLocalAuthorityAssetsDir = async (): Promise<string> => {
  const dir = path.join(app.getPath('userData'), LOCAL_AUTHORITY_ASSETS_DIRNAME);
  await fs.mkdir(dir, { recursive: true });

  if (!authorityAssetsMigrationAttempted) {
    authorityAssetsMigrationAttempted = true;
    const legacyFolder = await getEntityDbFolder();
    if (legacyFolder) {
      for (const name of MIGRATED_AUTHORITY_SUBDIRS) {
        const legacyPath = path.join(legacyFolder, name);
        const newPath = path.join(dir, name);
        try {
          const [legacyExists, newExists] = await Promise.all([
            fs
              .access(legacyPath)
              .then(() => true)
              .catch(() => false),
            fs
              .access(newPath)
              .then(() => true)
              .catch(() => false),
          ]);
          if (legacyExists && !newExists) {
            await moveDirectory(legacyPath, newPath);
          }
        } catch (error) {
          console.error(`Failed to migrate ${name} out of the entity database folder:`, error);
        }
      }
    }
  }

  return dir;
};

const MAP_TILES_DIRNAME = 'map-tiles';

/**
 * Base directory for the downloaded MBTiles basemap bundle used by the
 * place-name geo-comparison map (docs/placename-geo-disambiguation-planning.md,
 * Phase 6) — a sibling of authority-packs/authority-databases under the same
 * local, per-machine assets folder, for the same reason: this can run into
 * hundreds of MB and must never live in a (commonly synced) entity database
 * folder.
 */
export const getMapTilesDir = async (): Promise<string> => {
  const dir = path.join(await getLocalAuthorityAssetsDir(), MAP_TILES_DIRNAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

/**
 * Explicit override for where achievements.json lives. Returns null when
 * unset, meaning achievementsFile.ts uses the entity database folder, then
 * userData. Default for all users is co-location with the entity database.
 */
export const getAchievementsFolder = async (): Promise<string | null> => {
  const prefs = await readAppPrefs();
  return prefs.achievementsFolder?.trim() || null;
};

export const setAchievementsFolder = async (folder: string | null) => {
  await mutateAppPrefs((prefs) => {
    prefs.achievementsFolder = folder?.trim() || null;
  });
};

export const getAiApiSettings = async (): Promise<AiApiSettings> => {
  const prefs = await readAppPrefs();
  return sanitizeAiApiSettings(prefs.aiApi);
};

export const setAiApiSettings = async (settings: Partial<AiApiSettings>) => {
  await mutateAppPrefs((prefs) => {
    const current = sanitizeAiApiSettings(prefs.aiApi);
    prefs.aiApi = sanitizeAiApiSettings({ ...current, ...settings });
  });
};

export const getLanguageToolSettings = async (): Promise<LanguageToolSettings> => {
  const prefs = await readAppPrefs();
  return sanitizeLanguageToolSettings(prefs.languageTool);
};

export const setLanguageToolSettings = async (settings: Partial<LanguageToolSettings>) => {
  await mutateAppPrefs((prefs) => {
    const current = sanitizeLanguageToolSettings(prefs.languageTool);
    prefs.languageTool = sanitizeLanguageToolSettings({ ...current, ...settings });
  });
};

export const getRememberWorkspaceOnStartup = async (): Promise<boolean> => {
  const prefs = await readAppPrefs();
  return prefs.rememberWorkspaceOnStartup !== false;
};

export const setRememberWorkspaceOnStartup = async (remember: boolean) => {
  await mutateAppPrefs((prefs) => {
    prefs.rememberWorkspaceOnStartup = remember;
  });
};

export const saveWorkspaceSession = async (session: WorkspaceSession) => {
  await mutateAppPrefs((prefs) => {
    const nextSession = sanitizeWorkspaceSession(session);
    const previousSession = sanitizeWorkspaceSession(prefs.workspaceSession);
    const openFilePathSet = new Set(nextSession.openFilePaths);
    nextSession.cursorPositions = {
      ...Object.fromEntries(
        Object.entries(previousSession.cursorPositions ?? {}).filter(([filePath]) =>
          openFilePathSet.has(filePath),
        ),
      ),
      ...(nextSession.cursorPositions ?? {}),
    };
    prefs.workspaceSession = nextSession;
    if (prefs.workspaceSession.projectFilePath) {
      touchRecentProject(prefs, prefs.workspaceSession.projectFilePath);
    }
  });
};

export const getWorkspaceSession = async (): Promise<WorkspaceSession | null> => {
  const prefs = await readAppPrefs();
  const session = sanitizeWorkspaceSession(prefs.workspaceSession);
  return session.projectFilePath ? session : null;
};
