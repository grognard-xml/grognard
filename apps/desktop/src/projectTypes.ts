import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The project config filename. Renamed from `jean-baptiste.project.json`
 * when the app became Grognard — `LEGACY_PROJECT_FILE_NAME` stays around so
 * every project created before the rename keeps working under its existing
 * filename forever (no forced rename: that file is often git-tracked and
 * shared, and silently renaming a tracked file out from under a
 * collaboration is exactly the kind of surprise this app exists to avoid).
 * Only a brand-new project gets the new name — see `resolveProjectFileName`.
 *
 * Duplicated (by necessity — apps/desktop, apps/commons, and
 * cwrc-leafwriter can't share this constant across their build boundaries,
 * and apps/commons's copy must stay free of Node imports since it's
 * bundled into the renderer) in `apps/commons/src/desktop/projectTypes.ts`
 * and `packages/cwrc-leafwriter/src/autoTagging/dateWorkflow.ts`. Keep all
 * three in sync.
 */
export const PROJECT_FILE_NAME = 'grognard.project.json';
export const LEGACY_PROJECT_FILE_NAME = 'jean-baptiste.project.json';
export const DEFAULT_METADATA_PATH = 'schema/project-metadata.json';

/**
 * Which project-file name actually exists in `rootPath` — the new name if
 * present, the pre-rename name for an existing project that still uses it,
 * or the new name as the default for a folder that has neither yet (a
 * brand-new project).
 */
export const resolveProjectFileName = async (rootPath: string): Promise<string> => {
  try {
    await fs.access(path.join(rootPath, PROJECT_FILE_NAME));
    return PROJECT_FILE_NAME;
  } catch {
    // fall through
  }
  try {
    await fs.access(path.join(rootPath, LEGACY_PROJECT_FILE_NAME));
    return LEGACY_PROJECT_FILE_NAME;
  } catch {
    return PROJECT_FILE_NAME;
  }
};

/** True if `rootPath` already contains a project file, under either name. */
export const isExistingProjectFolder = async (rootPath: string): Promise<boolean> => {
  for (const name of [PROJECT_FILE_NAME, LEGACY_PROJECT_FILE_NAME]) {
    try {
      await fs.access(path.join(rootPath, name));
      return true;
    } catch {
      // keep checking
    }
  }
  return false;
};

export interface ProjectSchemaConfig {
  rng: string;
  css?: string;
  catalogId?: string;
  sourceUrl?: string;
  sourceCssUrl?: string;
  sourceHash?: string;
  sourceCssHash?: string;
  installedVersion?: string;
  installedAt?: string;
  lastCheckedAt?: string;
}

export interface ProjectFileConfig {
  version: 1;
  name: string;
  schema?: ProjectSchemaConfig;
  metadata?: string;
  /**
   * Stable identity for this project, independent of its filesystem path.
   * Generated once and persisted here (not derived from rootPath) so the
   * same project checked out at different absolute paths - e.g. Mac vs
   * Windows checkouts of the same repo - is recognized as one project by
   * the achievements engine instead of accumulating two separate,
   * double-counted entries.
   */
  projectId?: string;
  /** UUID fingerprint of the linked entities.xml database file. */
  entityDatabaseId?: string;
  /**
   * Where this project's live entity database (PEDB) lives. Omitted, or
   * `{ backend: 'local' }`, means the default local `entities.sqlite` file
   * beside the corpus — unchanged from before this field existed. `url` is
   * not secret (it's the Turso database's connection URL, safe to live in
   * this shared, git-synced file — matches how the entity-sync Worker
   * endpoint is stored today); each collaborator's own auth token is never
   * stored here — see entityDbTursoTokenStore.ts.
   */
  pedb?: { backend: 'local' } | { backend: 'turso'; url: string };
  /** When true, this project's PEDB is kept auto-synced with the CEDB (Promote on create, no manual Bridge). */
  syncToCentral?: boolean;
  /** Saved authority tag-bomb pack/year settings for this project. */
  autoTaggingAuthority?: AutoTaggingAuthoritySettings;
  /** AI validation preferences for auto-tagging review (pre-select / warnings). */
  autoTaggingValidation?: AutoTaggingValidationSettings;
  /** Disambiguation panel preferences for this project. */
  disambiguation?: DisambiguationSettings;
  /** Plugin ids enabled for this project (plugins remain installed app-wide). */
  plugins?: string[];
}

/** Persisted in jean-baptiste.project.json — mirrors cwrc-leafwriter validationSettings. */
export interface AutoTaggingValidationSettings {
  aiValidation?: boolean;
  autoAcceptThreshold?: number;
  /** Reject AI-curated suggestions below this confidence (0–1). */
  curateRejectBelow?: number;
}

export interface DisambiguationSettings {
  aiCuration?: boolean;
  disableCaching?: boolean;
  /** Date-range filter for the disambiguation panel's own candidate filter. */
  dateFilter?: 'none' | 'limit' | 'exclude';
  yearStart?: number;
  yearEnd?: number;
  placeProximityKm?: number;
}

/** Persisted in jean-baptiste.project.json — mirrors cwrc-leafwriter authoritySettings. */
export interface AutoTaggingAuthoritySettings {
  packs?: string[];
  showPackStringCounts?: boolean;
  matchAcrossLineBreaks?: boolean;
  dateFilter?: 'none' | 'limit' | 'exclude';
  yearFilterEnabled?: boolean;
  yearStart?: number;
  yearEnd?: number;
  /** @deprecated Migrated to nameTypeTaggingPolicy (phase2 bucket). */
  excludedNameTypes?: string[];
  nameTypeTaggingPolicy?: Record<string, 'phase1' | 'phase2' | 'never'>;
  customNameTypes?: {
    id: string;
    label: string;
    labelsByLang?: Record<string, string>;
    bucket: 'phase1' | 'phase2' | 'never';
  }[];
  /** Project-scoped custom `<rs>` sub-types (e.g. "philosophical concept"). */
  customThingTypes?: { id: string; label: string }[];
  artMinCodePoints?: number;
  hideUndated?: boolean;
}

export interface ProjectMetadataFile {
  version: 1;
  catalogId?: string;
  fields: Record<string, string>;
  custom: { path: string; label: string; value: string }[];
}

export interface ProjectBundle {
  config: ProjectFileConfig;
  projectFilePath: string;
  rootPath: string;
}
