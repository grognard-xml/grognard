/**
 * Renamed from `jean-baptiste.project.json` when the app became Grognard.
 * `LEGACY_PROJECT_FILE_NAME` stays around so an existing project keeps
 * working under its current filename forever — no forced rename. See the
 * matching (fuller) comment on the desktop copy of this constant in
 * `apps/desktop/src/projectTypes.ts`, which also has the fs-based
 * `resolveProjectFileName`/`isExistingProjectFolder` helpers this file
 * deliberately doesn't (it's bundled into the renderer, so it stays free of
 * Node imports; anywhere here that needs to check which name a folder
 * actually uses goes through an IPC call instead). Also duplicated in
 * `packages/cwrc-leafwriter/src/autoTagging/dateWorkflow.ts`. Keep all
 * three in sync.
 */
export const PROJECT_FILE_NAME = 'grognard.project.json';
export const LEGACY_PROJECT_FILE_NAME = 'jean-baptiste.project.json';
export const DEFAULT_METADATA_PATH = 'schema/project-metadata.json';

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
  /**
   * Stable identity for this project, independent of its filesystem path.
   * Used as the achievements engine's project key instead of the OS path,
   * so the same project checked out at different absolute paths (e.g. Mac
   * vs Windows checkouts of the same repo) is recognized as one project
   * instead of accumulating two separate, double-counted entries.
   */
  projectId?: string;
  schema?: ProjectSchemaConfig;
  /** Relative path, default schema/project-metadata.json */
  metadata?: string;
  /** Relative path, default schema/translation-settings.json */
  translationSettings?: string;
  /** UUID fingerprint of the linked entities.xml database file. */
  entityDatabaseId?: string;
  /** When true, this project's PEDB is kept auto-synced with the CEDB (Promote on create, no manual Bridge). */
  syncToCentral?: boolean;
  /**
   * Where this project's PEDB lives — mirrors ProjectFileConfig.pedb in
   * apps/desktop/src/projectTypes.ts. Omitted/local means today's default
   * local entities.sqlite.
   */
  pedb?: { backend: 'local' } | { backend: 'turso'; url: string };
  /** Saved authority tag-bomb pack/year settings for this project. */
  autoTaggingAuthority?: AutoTaggingAuthoritySettings;
  /** AI validation preferences for auto-tagging review (pre-select / warnings). */
  autoTaggingValidation?: AutoTaggingValidationSettings;
  disambiguation?: DisambiguationSettings;
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
  /** Show the live authority-pack string totals in the tag-bomb panel. */
  showPackStringCounts?: boolean;
  /** Match tag-bomb strings across empty lb/pb milestones (projection matcher). */
  matchAcrossLineBreaks?: boolean;
  dateFilter?: 'none' | 'limit' | 'exclude';
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
  /** @deprecated */
  yearFilterEnabled?: boolean;
  /** @deprecated */
  hideUndated?: boolean;
}

export interface ProjectMetadataFile {
  version: 1;
  catalogId?: string;
  fields: Record<string, string>;
  custom: { path: string; label: string; value: string }[];
  /** Snapshot written after bulk apply to existing files. */
  lastApplied?: {
    at: string;
    fields: Record<string, string>;
    custom: { path: string; value: string }[];
  };
}

export interface ProjectBundle {
  config: ProjectFileConfig;
  projectFilePath: string;
  rootPath: string;
}
