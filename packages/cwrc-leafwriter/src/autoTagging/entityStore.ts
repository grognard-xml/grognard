import {
  makeDeleteSuggestion,
  makeMergeSuggestion,
  makeMergeSuggestionResolution,
  readMergeSuggestionResolutions as readMergeSuggestionResolutionsFile,
  readMergeSuggestions as readMergeSuggestionsFile,
  recordMergeSuggestion as recordMergeSuggestionFile,
  recordMergeSuggestionResolution as recordMergeSuggestionResolutionFile,
  type CentralDeleteSuggestion,
  type CentralMergeSuggestion,
  type CentralSuggestion,
  type MergeSuggestionAction,
  type MergeSuggestionResolution,
} from './centralMergeSuggestions';
import { appendRecords, type DecisionRecord } from './decisionLog';
import {
  appendWrapperFactRecords,
  parseWrapperFacts,
  type WrapperFactRecord,
} from './wrapperFactsLog';
import {
  createEntitiesScaffold,
  isEntityDatabase,
  parseEntities,
  serializeEntities,
  type EntityKind,
} from './entities';
import {
  makeOrder,
  readAppliedOrderIds,
  readOrders,
  recordOrder,
  writeAppliedOrderIds,
  type EntityOrder,
} from './entityOrders';
import { registerProject, resolveProjectRoots } from './entityProjectRegistry';
import {
  resolveEntityStorePaths,
  type EntityStoreMode,
  type EntityStorePaths,
  type EntityStorePedb,
  type EntityStoreResolveInput,
} from './entityStoreResolve';
import { joinPath } from './pathJoin';
import { SQLITE_SAVE_REQUIRES_IMPORT_FLAG_MESSAGE } from './sqliteRequired';

/**
 * Persistence for the entity authority file and per-project hidden infra
 * (`.grognard/` decision log, authority cache, etc.). Kept behind a narrow file API
 * so it is testable without Electron.
 */
export interface EntityFileApi {
  ensureDirectory: (dirPath: string) => Promise<void>;
  pathExists: (filePath: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  /**
   * Arm the watcher immediately before a write starts, so a slow renderer can't lose
   * the race against the watcher's debounce timer between the write landing on disk
   * and `notifyOwnWrite` confirming it.
   */
  armOwnWrite?: (filePath: string) => Promise<void>;
  /** Tell the desktop file watcher to ignore the next change at this path (our own write). */
  notifyOwnWrite?: (filePath: string) => Promise<void>;
  /** Runtime entity database bridge; XML remains only the DOM compatibility layer. */
  entitySqliteExportXml?: (request: { databasePath: string }) => Promise<string | null>;
  entitySqliteImportXml?: (request: { databasePath: string; xml: string }) => Promise<unknown>;
  entitySqliteCandidates?: (request: {
    databasePath: string;
    kind: EntityKind;
  }) => Promise<unknown[] | null>;
  entitySqliteGet?: (input: { databasePath: string; entityId: string }) => Promise<unknown | null>;
  entitySqliteDatabaseId?: (databasePath: string) => Promise<string | null>;
  entitySqliteListIds?: (input: {
    databasePath: string;
    kind?: EntityKind;
  }) => Promise<string[] | null>;
  entitySqliteListPanelSummaries?: (input: {
    databasePath: string;
    kind?: EntityKind;
  }) => Promise<unknown[] | null>;
  entitySqliteSearch?: (input: {
    databasePath: string;
    kind: EntityKind;
    query: string;
    limit?: number;
  }) => Promise<
    | {
        id: string;
        label: string;
        description?: string;
        idnos: { type: string; value: string }[];
      }[]
    | null
  >;
  entitySqliteAuthorityDuplicates?: (databasePath: string) => Promise<unknown[] | null>;
  entitySqliteUpdateNames?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
    nameType?: string | null;
    language?: string | null;
  }) => Promise<number>;
  entitySqliteTombstoneNames?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
    reason?: string;
  }) => Promise<number>;
  entitySqliteUpdateDescription?: (input: {
    databasePath: string;
    entityId: string;
    description: string | null;
  }) => Promise<void>;
  entitySqliteUpdateSubtype?: (input: {
    databasePath: string;
    entityId: string;
    subtype: string | null;
  }) => Promise<void>;
  entitySqliteGetNotes?: (input: {
    databasePath: string;
    entityId: string;
  }) => Promise<{ xml: string }[]>;
  entitySqliteSetNote?: (input: {
    databasePath: string;
    entityId: string;
    xml: string;
  }) => Promise<void>;
  entitySqliteRemoveName?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
  }) => Promise<boolean>;
  entitySqliteAddName?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
    nameType?: string | null;
    nameRole?: string;
    language?: string | null;
    isPrimary?: boolean;
    origin?: 'user' | 'authority' | 'xml';
    source?: string | null;
  }) => Promise<unknown>;
  entitySqliteSetUserDate?: (input: {
    databasePath: string;
    entityId: string;
    part: 'birth' | 'death';
    year: number | null;
    precision?: string | null;
  }) => Promise<void>;
  entitySqliteSetUserWorkDate?: (input: {
    databasePath: string;
    entityId: string;
    startYear: number | null;
    endYear?: number | null;
    startPrecision?: string | null;
    endPrecision?: string | null;
  }) => Promise<void>;
  entitySqliteSetWorkType?: (input: {
    databasePath: string;
    entityId: string;
    workType: string | null;
  }) => Promise<void>;
  entitySqliteAddNationality?: (input: {
    databasePath: string;
    entityId: string;
    label: string;
    ref?: string | null;
    source?: string | null;
    origin?: 'user' | 'authority' | 'xml';
  }) => Promise<boolean>;
  entitySqliteAddOrigin?: (input: {
    databasePath: string;
    entityId: string;
    label: string;
    ref?: string | null;
    source?: string | null;
    origin?: 'user' | 'authority' | 'xml';
  }) => Promise<boolean>;
  entitySqliteAddNobleTitle?: (input: {
    databasePath: string;
    entityId: string;
    input: {
      dynasty?: string;
      fief?: string;
      posthumousName?: string;
      title?: string;
      source?: string | null;
      origin?: 'user' | 'authority' | 'xml';
    };
  }) => Promise<boolean>;
  entitySqliteUpdateNobleTitle?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
    input: {
      dynasty?: string;
      fief?: string;
      posthumousName?: string;
      title?: string;
    };
  }) => Promise<boolean>;
  entitySqliteSetUserWorkAuthors?: (input: {
    databasePath: string;
    entityId: string;
    authors: { name: string; ref?: string | null; key?: string | null }[];
  }) => Promise<void>;
  entitySqliteCreateRelation?: (input: {
    databasePath: string;
    subjectEntityId: string;
    objectEntityId: string;
    relationType: string;
    symmetric?: boolean;
    reference?: string | null;
  }) => Promise<number>;
  entitySqliteListRelations?: (input: { databasePath: string; entityId: string }) => Promise<
    {
      id: number;
      relationType: string;
      isSubject: boolean;
      symmetric: boolean;
      reference: string | null;
      otherEntityId: string | null;
      otherEntityKind: EntityKind | null;
      otherEntityName: string | null;
    }[]
  >;
  entitySqliteUpdateRelationStatus?: (input: {
    databasePath: string;
    relationId: number;
    status: 'active' | 'rejected' | 'withdrawn';
  }) => Promise<boolean>;
  entitySqliteAttachAuthority?: (input: {
    databasePath: string;
    entityId: string;
    type: string;
    value: string;
  }) => Promise<boolean>;
  entitySqliteDecoupleAuthority?: (input: {
    databasePath: string;
    entityId: string;
    type: string;
    value: string;
  }) => Promise<number>;
  entitySqliteRejectAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteRestoreAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteRemoveAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteValidateAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteAcceptDateAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteAcceptDescriptionAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
  entitySqliteRenamePrimaryName?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
  }) => Promise<boolean>;
  entitySqliteSetRomanizedName?: (input: {
    databasePath: string;
    entityId: string;
    text: string;
    language?: string;
  }) => Promise<void>;
  entitySqliteAutoCleanNames?: (input: { databasePath: string }) => Promise<{
    dedupedNames: number;
    removedNan: number;
    removedInvalidFamilyGiven: number;
    removedUntyped: number;
    promotedRomanizations: number;
  }>;
  entitySqliteApplyConcordance?: (input: {
    databasePath: string;
    associations: {
      source: string;
      canonicalId: string;
      mergedFromId: string;
      notes?: string;
      sourceRef?: string;
    }[];
  }) => Promise<{
    applied: number;
    alreadyPresent: number;
    rejected: number;
    unresolved: number;
    conflicts: {
      association: {
        source: string;
        canonicalId: string;
        mergedFromId: string;
        notes?: string;
        sourceRef?: string;
      };
      entityIds: string[];
    }[];
  }>;
  entitySqliteRejectConcordance?: (input: {
    databasePath: string;
    association: {
      source: string;
      canonicalId: string;
      mergedFromId: string;
      notes?: string;
      sourceRef?: string;
    };
    entityId?: string;
    reason?: string;
  }) => Promise<boolean>;
  entitySqliteMarkDuplicateIntentional?: (input: {
    databasePath: string;
    entityIds: string[];
  }) => Promise<boolean>;
  entitySqliteBackfillDecisionTargets?: (input: {
    databasePath: string;
  }) => Promise<{ updated: number; inserted: number; unchanged: number } | null>;
  entitySqliteSoftDelete?: (input: { databasePath: string; entityId: string }) => Promise<boolean>;
  entitySqliteMerge?: (input: {
    databasePath: string;
    keepId: string;
    dropIds: string[];
  }) => Promise<{
    keepId: string;
    remap: Record<string, string>;
    centralConflicts: {
      userStableId: string;
      keptCentralId: string;
      droppedCentralId: string;
    }[];
  }>;
  entitySqliteCreatePopulated?: (input: {
    databasePath: string;
    id: string;
    kind: EntityKind;
    description?: string | null;
    names?: {
      text: string;
      nameType?: string | null;
      language?: string | null;
      isPrimary?: boolean;
      origin?: 'user' | 'authority' | 'xml';
      source?: string | null;
    }[];
    authorities?: {
      type: string;
      value: string;
      origin?: 'user' | 'authority' | 'xml';
      source?: string | null;
    }[];
    familyName?: string | null;
    givenName?: string | null;
  }) => Promise<unknown>;
  entitySqliteApplyAuthorityBackfillPatch?: (input: {
    databasePath: string;
    entityId: string;
    names?: {
      text: string;
      nameType?: string | null;
      language?: string | null;
      source?: string | null;
    }[];
    familyName?: string | null;
    givenName?: string | null;
    rewriteUnvalidatedPersonNames?: boolean;
    romanized?: { text: string; language?: string | null } | null;
    dates?: {
      source: string;
      startYear?: number | null;
      endYear?: number | null;
      asFloruit?: boolean;
    }[];
    clearAuthorityVitalSources?: string[];
    nationalities?: { label: string; ref?: string | null; source: string }[];
    origins?: {
      label: string;
      ref?: string | null;
      source: string;
      nameType?: string | null;
    }[];
    offices?: { label: string; ref?: string | null; source: string }[];
    nobleTitles?: {
      placeName: string;
      roleName: string;
      posthumousName?: string | null;
      dynasty?: string | null;
      ref?: string | null;
      source: string;
    }[];
    authorityCaches?: {
      authorityType: string;
      source?: string | null;
      payload: unknown;
    }[];
    workAuthors?: {
      name: string;
      personId?: string | null;
      ref?: string | null;
      source?: string | null;
    }[];
    workDate?: {
      source: string;
      startYear?: number | null;
      endYear?: number | null;
    } | null;
  }) => Promise<{ changed: boolean; namesAdded: number }>;
  entitySqliteReconcileXmlExtractedData?: (input: {
    databasePath: string;
    documentKey: string;
    wrappers: {
      entityId: string;
      source: string;
      assertions: {
        element: string;
        value: string;
        ref?: string | null;
        children?: { element: string; value: string; ref?: string | null }[];
      }[];
    }[];
    purgeOrphanSources?: boolean;
  }) => Promise<{ wrappers: number; added: number; removed: number; retained: number }>;
  entitySqliteEntityContentHash?: (input: {
    databasePath: string;
    entityId: string;
  }) => Promise<string | null>;
  entitySqliteReplaceEntityContent?: (input: {
    sourceDatabasePath: string;
    sourceEntityId: string;
    targetDatabasePath: string;
    targetEntityId: string;
  }) => Promise<{ changed: boolean }>;
  entitySqliteGetCentralId?: (input: {
    databasePath: string;
    entityId: string;
    userStableId: string;
  }) => Promise<string | null>;
  entitySqliteSetCentralMapping?: (input: {
    databasePath: string;
    entityId: string;
    userStableId: string;
    centralId: string;
  }) => Promise<boolean>;
  entitySqliteClearCentralMapping?: (input: {
    databasePath: string;
    entityId: string;
    userStableId: string;
  }) => Promise<boolean>;
  entitySqliteListMappingsByCentralIds?: (input: {
    databasePath: string;
    userStableId: string;
    centralIds: string[];
  }) => Promise<{ projectEntityId: string; centralId: string; label: string | null }[]>;
  entitySqliteListAllCentralMappings?: (input: {
    databasePath: string;
    userStableId: string;
  }) => Promise<{ projectEntityId: string; centralId: string }[]>;
  entitySqliteListLinkedCentralIds?: (input: {
    databasePath: string;
    userStableId: string;
  }) => Promise<string[] | null>;
  entitySqliteCountUnlinked?: (input: {
    databasePath: string;
    userStableId: string;
  }) => Promise<number | null>;
  entitySqliteFindByAuthority?: (input: {
    databasePath: string;
    kind: EntityKind;
    type: string;
    value: string;
  }) => Promise<string[]>;
  entitySqliteFindByNameDates?: (input: {
    databasePath: string;
    kind: EntityKind;
    name: string;
    startYear?: number | null;
    endYear?: number | null;
  }) => Promise<string | null>;
  entitySqliteForceRejectAssertion?: (input: {
    databasePath: string;
    entityId: string;
    key: string;
  }) => Promise<boolean>;
}

export const GROGNARD_DIR = '.grognard';
export const ENTITIES_FILE = 'entities.xml';
export const DECISIONS_FILE = 'entity-decisions.jsonl';
export const AUTHORITY_CACHE_DIR = 'authority-cache';
export const AI_CACHE_DIR = 'ai-cache';
export const AI_DISAMBIGUATION_CACHE_DIR = 'ai-disambiguation-cache';
export const DILA_PLACE_DETAIL_CACHE_DIR = 'dila-place-detail-cache';
export const DISAMBIGUATION_PENDING_FILE = 'disambiguation-pending.json';
export const WRAPPER_FACTS_FILE = 'wrapper-facts.jsonl';

/** @deprecated Use GROGNARD_DIR */
export const INFRA_DIR = GROGNARD_DIR;

export {
  resolveEntityStorePaths,
  type EntityStoreMode,
  type EntityStorePaths,
  type EntityStorePedb,
};

/**
 * Must match TURSO_REF_PREFIX in apps/desktop/src/entityDbConnectionRef.ts
 * exactly — this package can't import that file (packages don't depend on
 * apps), so the sentinel format is duplicated here rather than shared.
 * Carries no secret; the auth token is resolved main-process-side only.
 */
function tursoConnectionRef(url: string): string {
  return `grognard-turso:${url}`;
}

export class EntityStore {
  readonly mode: EntityStoreMode;
  readonly entitiesPath: string;
  /** SQLite read authority paired with the legacy XML interchange file. */
  readonly sqlitePath: string;
  readonly projectGrognardDir: string;
  readonly projectRoot: string;
  readonly centralFolder: string | null;
  readonly decisionsPath: string;
  readonly authorityCacheDir: string;
  readonly aiCacheDir: string;
  readonly aiDisambiguationCacheDir: string;
  readonly dilaPlaceDetailCacheDir: string;
  readonly disambiguationPendingPath: string;
  readonly wrapperFactsPath: string;

  constructor(
    private readonly api: EntityFileApi,
    paths: EntityStorePaths,
  ) {
    this.mode = paths.mode;
    this.entitiesPath = paths.entitiesPath;
    this.sqlitePath =
      paths.pedb?.backend === 'turso'
        ? tursoConnectionRef(paths.pedb.url)
        : this.entitiesPath.replace(/entities\.xml$/i, 'entities.sqlite');
    this.projectGrognardDir = paths.projectGrognardDir;
    this.projectRoot = paths.projectRoot;
    this.centralFolder = paths.centralFolder;
    this.decisionsPath = joinPath(paths.projectGrognardDir, DECISIONS_FILE);
    this.authorityCacheDir = joinPath(paths.projectGrognardDir, AUTHORITY_CACHE_DIR);
    this.aiCacheDir = joinPath(paths.projectGrognardDir, AI_CACHE_DIR);
    this.aiDisambiguationCacheDir = joinPath(paths.projectGrognardDir, AI_DISAMBIGUATION_CACHE_DIR);
    this.dilaPlaceDetailCacheDir = joinPath(paths.projectGrognardDir, DILA_PLACE_DETAIL_CACHE_DIR);
    this.disambiguationPendingPath = joinPath(
      paths.projectGrognardDir,
      DISAMBIGUATION_PENDING_FILE,
    );
    this.wrapperFactsPath = joinPath(paths.projectGrognardDir, WRAPPER_FACTS_FILE);
  }

  static fromPaths(api: EntityFileApi, paths: EntityStorePaths): EntityStore {
    return new EntityStore(api, paths);
  }

  /** True when the bridge actually implements sqliteApplyAuthorityBackfillPatch. */
  get supportsAuthorityBackfillPatch(): boolean {
    return !!this.api.entitySqliteApplyAuthorityBackfillPatch;
  }

  static resolve(input: EntityStoreResolveInput): EntityStorePaths {
    return resolveEntityStorePaths(input);
  }

  private pathsMatch(a: string, b: string): boolean {
    const normalize = (value: string) =>
      value
        .split(/[/\\]+/)
        .filter(Boolean)
        .join('/')
        .toLowerCase();
    return normalize(a) === normalize(b);
  }

  /** Central mode must not write the default project-local slot unless that IS the central folder. */
  private assertEntitiesPathForMode(): void {
    if (this.mode !== 'central') return;

    const projectLocalPath = joinPath(this.projectRoot, ENTITIES_FILE);
    if (!this.pathsMatch(this.entitiesPath, projectLocalPath)) return;

    if (this.centralFolder && this.pathsMatch(this.centralFolder, this.projectRoot)) return;

    throw new Error(
      'Central entity database must not use a project-local entities.xml file when the central folder is elsewhere.',
    );
  }

  /**
   * Load the entity file, creating `entities.xml` from the scaffold on first
   * use. Returns the parsed document.
   *
   * `pathExists` returning false is treated as "genuinely missing, safe to
   * scaffold" - but a synced/network/cloud folder (exactly what the central
   * database commonly lives in) can report false transiently while still
   * mounting, and a scaffolded empty file here gets silently overwritten
   * back onto disk by the next `saveEntities` call, destroying whatever was
   * really there. A single false reading is not enough evidence of "missing"
   * to justify that - retry briefly before concluding it's real.
   */
  async loadEntities(): Promise<Document> {
    this.assertEntitiesPathForMode();
    if (this.api.entitySqliteExportXml && (await this.hasSqliteDatabase())) {
      const xml = await this.api.entitySqliteExportXml({ databasePath: this.sqlitePath });
      if (xml) {
        const doc = parseEntities(xml);
        if (!isEntityDatabase(doc))
          throw new Error(`Invalid SQLite entity database: ${this.sqlitePath}`);
        return doc;
      }
    }
    const entitiesDir = this.entitiesPath.replace(/[/\\][^/\\]+$/, '');
    await this.api.ensureDirectory(entitiesDir);
    if (!(await this.existsWithRetry(this.entitiesPath))) {
      await this.api.armOwnWrite?.(this.entitiesPath);
      await this.api.writeFile(this.entitiesPath, createEntitiesScaffold());
      await this.api.notifyOwnWrite?.(this.entitiesPath);
    }
    const xml = await this.api.readFile(this.entitiesPath);
    const doc = parseEntities(xml);
    if (!isEntityDatabase(doc)) {
      throw new Error(`Not an entity database file: ${this.entitiesPath}`);
    }
    return doc;
  }

  private async existsWithRetry(filePath: string): Promise<boolean> {
    if (await this.api.pathExists(filePath)) return true;
    const delays = [200, 500, 1000, 2000];
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (await this.api.pathExists(filePath)) return true;
    }
    return false;
  }

  /**
   * Write the entity document back to disk.
   *
   * When a sibling `entities.sqlite` exists, this would full-reimport SQLite
   * from the DOM XML — which clobbers live typed edits. That path is refused
   * unless `options.allowSqliteFullReimport` is set (import/export tooling
   * and fixtures only). Without SQLite, writes the interchange `entities.xml`.
   */
  async saveEntities(
    doc: Document,
    options?: { allowSqliteFullReimport?: boolean },
  ): Promise<void> {
    this.assertEntitiesPathForMode();
    if (!isEntityDatabase(doc)) {
      throw new Error('Refusing to save: document is not a valid entity database.');
    }
    if (this.api.entitySqliteImportXml && (await this.hasSqliteDatabase())) {
      if (!options?.allowSqliteFullReimport) {
        throw new Error(SQLITE_SAVE_REQUIRES_IMPORT_FLAG_MESSAGE);
      }
      await this.api.entitySqliteImportXml({
        databasePath: this.sqlitePath,
        xml: serializeEntities(doc),
      });
      return;
    }
    const entitiesDir = this.entitiesPath.replace(/[/\\][^/\\]+$/, '');
    await this.api.ensureDirectory(entitiesDir);
    await this.api.armOwnWrite?.(this.entitiesPath);
    await this.api.writeFile(this.entitiesPath, serializeEntities(doc));
    await this.api.notifyOwnWrite?.(this.entitiesPath);
  }

  async sqliteCandidateRecords(kind: EntityKind): Promise<unknown[] | null> {
    if (!this.api.entitySqliteCandidates || !(await this.hasSqliteDatabase()))
      return null;
    return this.api.entitySqliteCandidates({ databasePath: this.sqlitePath, kind });
  }

  async sqliteEntitySummary(entityId: string): Promise<unknown | null> {
    if (!this.api.entitySqliteGet) throw new Error('SQLite entity summaries are unavailable.');
    return this.api.entitySqliteGet({ databasePath: this.sqlitePath, entityId });
  }

  async sqliteDatabaseId(): Promise<string | null> {
    if (!this.api.entitySqliteDatabaseId)
      throw new Error('SQLite database metadata is unavailable.');
    return this.api.entitySqliteDatabaseId(this.sqlitePath);
  }

  /**
   * A Turso-backed project has no local file to check for — its existence
   * is "does the connection work", which happens naturally when it's
   * actually used, not eagerly here. `pathExists` (a raw filesystem check)
   * would otherwise always say false for a `grognard-turso:` sqlitePath and
   * silently disable every entity operation this gates.
   */
  async hasSqliteDatabase(): Promise<boolean> {
    if (this.sqlitePath.startsWith('grognard-turso:')) return true;
    return this.api.pathExists(this.sqlitePath);
  }

  async sqliteEntityIds(kind?: EntityKind): Promise<string[] | null> {
    if (!this.api.entitySqliteListIds) throw new Error('SQLite entity IDs are unavailable.');
    return this.api.entitySqliteListIds({
      databasePath: this.sqlitePath,
      ...(kind ? { kind } : {}),
    });
  }

  async sqlitePanelSummaries(kind?: EntityKind): Promise<unknown[] | null> {
    if (!this.api.entitySqliteListPanelSummaries)
      throw new Error('SQLite panel summaries are unavailable.');
    return this.api.entitySqliteListPanelSummaries({
      databasePath: this.sqlitePath,
      ...(kind ? { kind } : {}),
    });
  }

  async sqliteAuthorityDuplicates(): Promise<unknown[] | null> {
    if (!this.api.entitySqliteAuthorityDuplicates)
      throw new Error('SQLite duplicate-authority queries are unavailable.');
    return this.api.entitySqliteAuthorityDuplicates(this.sqlitePath);
  }

  async sqliteUpdateNames(input: {
    entityId: string;
    text: string;
    nameType?: string | null;
    language?: string | null;
  }): Promise<number> {
    if (!this.api.entitySqliteUpdateNames) throw new Error('SQLite name updates are unavailable.');
    return this.api.entitySqliteUpdateNames({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteTombstoneNames(entityId: string, text: string, reason?: string): Promise<number> {
    if (!this.api.entitySqliteTombstoneNames)
      throw new Error('SQLite name tombstones are unavailable.');
    return this.api.entitySqliteTombstoneNames({
      databasePath: this.sqlitePath,
      entityId,
      text,
      ...(reason ? { reason } : {}),
    });
  }

  async sqliteUpdateDescription(entityId: string, description: string | null): Promise<void> {
    if (!this.api.entitySqliteUpdateDescription)
      throw new Error('SQLite description updates are unavailable.');
    await this.api.entitySqliteUpdateDescription({
      databasePath: this.sqlitePath,
      entityId,
      description,
    });
  }

  async sqliteUpdateSubtype(entityId: string, subtype: string | null): Promise<void> {
    if (!this.api.entitySqliteUpdateSubtype)
      throw new Error('SQLite subtype updates are unavailable.');
    await this.api.entitySqliteUpdateSubtype({
      databasePath: this.sqlitePath,
      entityId,
      subtype,
    });
  }

  async sqliteGetNote(entityId: string): Promise<string | null> {
    if (!this.api.entitySqliteGetNotes) return null;
    const notes = await this.api.entitySqliteGetNotes({
      databasePath: this.sqlitePath,
      entityId,
    });
    return notes[0]?.xml ?? null;
  }

  async sqliteSetNote(entityId: string, xml: string): Promise<void> {
    if (!this.api.entitySqliteSetNote) throw new Error('SQLite entity notes are unavailable.');
    await this.api.entitySqliteSetNote({ databasePath: this.sqlitePath, entityId, xml });
  }

  async sqliteRemoveName(entityId: string, text: string): Promise<boolean> {
    if (!this.api.entitySqliteRemoveName) throw new Error('SQLite name removal is unavailable.');
    return this.api.entitySqliteRemoveName({ databasePath: this.sqlitePath, entityId, text });
  }

  async sqliteAddName(input: {
    entityId: string;
    text: string;
    nameType?: string | null;
    nameRole?: string;
    language?: string | null;
    isPrimary?: boolean;
    origin?: 'user' | 'authority' | 'xml';
    source?: string | null;
  }): Promise<unknown> {
    if (!this.api.entitySqliteAddName) throw new Error('SQLite name creation is unavailable.');
    return this.api.entitySqliteAddName({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteSetUserDate(input: {
    entityId: string;
    part: 'birth' | 'death';
    year: number | null;
    precision?: string | null;
  }): Promise<void> {
    if (!this.api.entitySqliteSetUserDate) throw new Error('SQLite date updates are unavailable.');
    await this.api.entitySqliteSetUserDate({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteSetUserWorkDate(input: {
    entityId: string;
    startYear: number | null;
    endYear?: number | null;
    startPrecision?: string | null;
    endPrecision?: string | null;
  }): Promise<void> {
    if (!this.api.entitySqliteSetUserWorkDate)
      throw new Error('SQLite work-date updates are unavailable.');
    await this.api.entitySqliteSetUserWorkDate({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteSetWorkType(input: { entityId: string; workType: string | null }): Promise<void> {
    if (!this.api.entitySqliteSetWorkType)
      throw new Error('SQLite work-type updates are unavailable.');
    await this.api.entitySqliteSetWorkType({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteAddNationality(input: {
    entityId: string;
    label: string;
    ref?: string | null;
    source?: string | null;
    origin?: 'user' | 'authority' | 'xml';
  }): Promise<boolean> {
    if (!this.api.entitySqliteAddNationality)
      throw new Error('SQLite nationality updates are unavailable.');
    return this.api.entitySqliteAddNationality({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteAddOrigin(input: {
    entityId: string;
    label: string;
    ref?: string | null;
    source?: string | null;
    origin?: 'user' | 'authority' | 'xml';
  }): Promise<boolean> {
    if (!this.api.entitySqliteAddOrigin) throw new Error('SQLite origin updates are unavailable.');
    return this.api.entitySqliteAddOrigin({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteAddNobleTitle(input: {
    entityId: string;
    dynasty?: string;
    fief?: string;
    posthumousName?: string;
    title?: string;
    source?: string | null;
    origin?: 'user' | 'authority' | 'xml';
  }): Promise<boolean> {
    if (!this.api.entitySqliteAddNobleTitle)
      throw new Error('SQLite noble-title updates are unavailable.');
    const { entityId, ...title } = input;
    return this.api.entitySqliteAddNobleTitle({
      databasePath: this.sqlitePath,
      entityId,
      input: title,
    });
  }

  async sqliteUpdateNobleTitle(
    entityId: string,
    key: string,
    input: {
      dynasty?: string;
      fief?: string;
      posthumousName?: string;
      title?: string;
    },
  ): Promise<boolean> {
    if (!this.api.entitySqliteUpdateNobleTitle)
      throw new Error('SQLite noble-title updates are unavailable.');
    return this.api.entitySqliteUpdateNobleTitle({
      databasePath: this.sqlitePath,
      entityId,
      key,
      input,
    });
  }

  async sqliteSetUserWorkAuthors(
    entityId: string,
    authors: { name: string; ref?: string | null; key?: string | null }[],
  ): Promise<void> {
    if (!this.api.entitySqliteSetUserWorkAuthors)
      throw new Error('SQLite author updates are unavailable.');
    await this.api.entitySqliteSetUserWorkAuthors({
      databasePath: this.sqlitePath,
      entityId,
      authors,
    });
  }

  async sqliteCreateRelation(input: {
    subjectEntityId: string;
    objectEntityId: string;
    relationType: string;
    symmetric?: boolean;
    reference?: string | null;
  }): Promise<number> {
    if (!this.api.entitySqliteCreateRelation)
      throw new Error('SQLite relation creation is unavailable.');
    return this.api.entitySqliteCreateRelation({
      databasePath: this.sqlitePath,
      ...input,
    });
  }

  async sqliteListRelations(entityId: string): Promise<
    {
      id: number;
      relationType: string;
      isSubject: boolean;
      symmetric: boolean;
      reference: string | null;
      otherEntityId: string | null;
      otherEntityKind: EntityKind | null;
      otherEntityName: string | null;
    }[]
  > {
    if (!this.api.entitySqliteListRelations)
      throw new Error('SQLite relation listing is unavailable.');
    return this.api.entitySqliteListRelations({ databasePath: this.sqlitePath, entityId });
  }

  async sqliteUpdateRelationStatus(
    relationId: number,
    status: 'active' | 'rejected' | 'withdrawn',
  ): Promise<boolean> {
    if (!this.api.entitySqliteUpdateRelationStatus)
      throw new Error('SQLite relation status update is unavailable.');
    return this.api.entitySqliteUpdateRelationStatus({
      databasePath: this.sqlitePath,
      relationId,
      status,
    });
  }

  async sqliteAttachAuthority(entityId: string, type: string, value: string): Promise<boolean> {
    if (!this.api.entitySqliteAttachAuthority)
      throw new Error('SQLite authority attach is unavailable.');
    return this.api.entitySqliteAttachAuthority({
      databasePath: this.sqlitePath,
      entityId,
      type,
      value,
    });
  }

  async sqliteDecoupleAuthority(entityId: string, type: string, value: string): Promise<number> {
    if (!this.api.entitySqliteDecoupleAuthority)
      throw new Error('SQLite authority decoupling is unavailable.');
    return this.api.entitySqliteDecoupleAuthority({
      databasePath: this.sqlitePath,
      entityId,
      type,
      value,
    });
  }

  async sqliteRejectAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteRejectAssertion)
      throw new Error('SQLite assertion rejection is unavailable.');
    return this.api.entitySqliteRejectAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteRestoreAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteRestoreAssertion)
      throw new Error('SQLite assertion restore is unavailable.');
    return this.api.entitySqliteRestoreAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteRemoveAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteRemoveAssertion)
      throw new Error('SQLite assertion removal is unavailable.');
    return this.api.entitySqliteRemoveAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteValidateAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteValidateAssertion)
      throw new Error('SQLite assertion validation is unavailable.');
    return this.api.entitySqliteValidateAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteAcceptDateAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteAcceptDateAssertion)
      throw new Error('SQLite date acceptance is unavailable.');
    return this.api.entitySqliteAcceptDateAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteAcceptDescriptionAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteAcceptDescriptionAssertion)
      throw new Error('SQLite description acceptance is unavailable.');
    return this.api.entitySqliteAcceptDescriptionAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  async sqliteRenamePrimaryName(entityId: string, text: string): Promise<boolean> {
    if (!this.api.entitySqliteRenamePrimaryName)
      throw new Error('SQLite primary-name rename is unavailable.');
    return this.api.entitySqliteRenamePrimaryName({
      databasePath: this.sqlitePath,
      entityId,
      text,
    });
  }

  async sqliteSetRomanizedName(entityId: string, text: string, language?: string): Promise<void> {
    if (!this.api.entitySqliteSetRomanizedName)
      throw new Error('SQLite romanized-name updates are unavailable.');
    await this.api.entitySqliteSetRomanizedName({
      databasePath: this.sqlitePath,
      entityId,
      text,
      language,
    });
  }

  async sqliteAutoCleanNames(): Promise<{
    dedupedNames: number;
    removedNan: number;
    removedInvalidFamilyGiven: number;
    removedUntyped: number;
    promotedRomanizations: number;
  }> {
    if (!this.api.entitySqliteAutoCleanNames) throw new Error('SQLite auto-clean is unavailable.');
    return this.api.entitySqliteAutoCleanNames({ databasePath: this.sqlitePath });
  }

  async sqliteApplyConcordance(
    associations: {
      source: string;
      canonicalId: string;
      mergedFromId: string;
      notes?: string;
      sourceRef?: string;
    }[],
  ): Promise<{
    applied: number;
    alreadyPresent: number;
    rejected: number;
    unresolved: number;
    conflicts: {
      association: {
        source: string;
        canonicalId: string;
        mergedFromId: string;
        notes?: string;
        sourceRef?: string;
      };
      entityIds: string[];
    }[];
  }> {
    if (!this.api.entitySqliteApplyConcordance)
      throw new Error('SQLite concordance application is unavailable.');
    return this.api.entitySqliteApplyConcordance({
      databasePath: this.sqlitePath,
      associations,
    });
  }

  async sqliteRejectConcordance(
    association: {
      source: string;
      canonicalId: string;
      mergedFromId: string;
      notes?: string;
      sourceRef?: string;
    },
    entityId?: string,
    reason?: string,
  ): Promise<boolean> {
    if (!this.api.entitySqliteRejectConcordance)
      throw new Error('SQLite concordance rejection is unavailable.');
    return this.api.entitySqliteRejectConcordance({
      databasePath: this.sqlitePath,
      association,
      entityId,
      reason,
    });
  }

  async sqliteMarkDuplicateIntentional(entityIds: string[]): Promise<boolean> {
    if (!this.api.entitySqliteMarkDuplicateIntentional)
      throw new Error('SQLite intentional-duplicate marking is unavailable.');
    return this.api.entitySqliteMarkDuplicateIntentional({
      databasePath: this.sqlitePath,
      entityIds,
    });
  }

  async sqliteBackfillDecisionTargets(): Promise<{
    updated: number;
    inserted: number;
    unchanged: number;
  } | null> {
    if (!this.api.entitySqliteBackfillDecisionTargets) return null;
    return this.api.entitySqliteBackfillDecisionTargets({ databasePath: this.sqlitePath });
  }

  async sqliteSoftDelete(entityId: string): Promise<boolean> {
    if (!this.api.entitySqliteSoftDelete) throw new Error('SQLite entity delete is unavailable.');
    return this.api.entitySqliteSoftDelete({ databasePath: this.sqlitePath, entityId });
  }

  async sqliteMerge(
    keepId: string,
    dropIds: string[],
  ): Promise<{
    keepId: string;
    remap: Record<string, string>;
    centralConflicts: {
      userStableId: string;
      keptCentralId: string;
      droppedCentralId: string;
    }[];
  }> {
    if (!this.api.entitySqliteMerge) throw new Error('SQLite entity merge is unavailable.');
    return this.api.entitySqliteMerge({ databasePath: this.sqlitePath, keepId, dropIds });
  }

  async sqliteCreatePopulated(input: {
    id: string;
    kind: EntityKind;
    description?: string | null;
    names?: {
      text: string;
      nameType?: string | null;
      language?: string | null;
      isPrimary?: boolean;
      origin?: 'user' | 'authority' | 'xml';
      source?: string | null;
    }[];
    authorities?: {
      type: string;
      value: string;
      origin?: 'user' | 'authority' | 'xml';
      source?: string | null;
    }[];
    familyName?: string | null;
    givenName?: string | null;
  }): Promise<unknown> {
    if (!this.api.entitySqliteCreatePopulated)
      throw new Error('SQLite entity creation is unavailable.');
    return this.api.entitySqliteCreatePopulated({ databasePath: this.sqlitePath, ...input });
  }

  async sqliteApplyAuthorityBackfillPatch(input: {
    entityId: string;
    names?: {
      text: string;
      nameType?: string | null;
      language?: string | null;
      source?: string | null;
    }[];
    familyName?: string | null;
    givenName?: string | null;
    rewriteUnvalidatedPersonNames?: boolean;
    romanized?: { text: string; language?: string | null } | null;
    dates?: {
      source: string;
      startYear?: number | null;
      endYear?: number | null;
      asFloruit?: boolean;
    }[];
    clearAuthorityVitalSources?: string[];
    nationalities?: { label: string; ref?: string | null; source: string }[];
    origins?: {
      label: string;
      ref?: string | null;
      source: string;
      nameType?: string | null;
    }[];
    offices?: { label: string; ref?: string | null; source: string }[];
    nobleTitles?: {
      placeName: string;
      roleName: string;
      posthumousName?: string | null;
      dynasty?: string | null;
      ref?: string | null;
      source: string;
    }[];
    authorityCaches?: {
      authorityType: string;
      source?: string | null;
      payload: unknown;
    }[];
    workAuthors?: {
      name: string;
      personId?: string | null;
      ref?: string | null;
      source?: string | null;
    }[];
    workDate?: {
      source: string;
      startYear?: number | null;
      endYear?: number | null;
    } | null;
  }): Promise<{ changed: boolean; namesAdded: number }> {
    if (!this.api.entitySqliteApplyAuthorityBackfillPatch)
      throw new Error('SQLite authority backfill is unavailable.');
    return this.api.entitySqliteApplyAuthorityBackfillPatch({
      databasePath: this.sqlitePath,
      ...input,
    });
  }

  async sqliteReconcileXmlExtractedData(input: {
    documentKey: string;
    wrappers: {
      entityId: string;
      source: string;
      assertions: {
        element: string;
        value: string;
        ref?: string | null;
        children?: { element: string; value: string; ref?: string | null }[];
      }[];
    }[];
    purgeOrphanSources?: boolean;
  }): Promise<{ wrappers: number; added: number; removed: number; retained: number }> {
    if (!this.api.entitySqliteReconcileXmlExtractedData) {
      return { wrappers: 0, added: 0, removed: 0, retained: 0 };
    }
    return this.api.entitySqliteReconcileXmlExtractedData({
      databasePath: this.sqlitePath,
      ...input,
    });
  }

  async sqliteEntityContentHash(entityId: string): Promise<string | null> {
    if (!this.api.entitySqliteEntityContentHash) return null;
    return this.api.entitySqliteEntityContentHash({
      databasePath: this.sqlitePath,
      entityId,
    });
  }

  async sqliteReplaceEntityContentFrom(
    sourceDatabasePath: string,
    sourceEntityId: string,
    targetEntityId: string,
  ): Promise<boolean> {
    if (!this.api.entitySqliteReplaceEntityContent)
      throw new Error('SQLite entity content replace is unavailable.');
    const result = await this.api.entitySqliteReplaceEntityContent({
      sourceDatabasePath,
      sourceEntityId,
      targetDatabasePath: this.sqlitePath,
      targetEntityId,
    });
    return result.changed;
  }

  async sqliteGetCentralId(entityId: string, userStableId: string): Promise<string | null> {
    if (!this.api.entitySqliteGetCentralId) return null;
    return this.api.entitySqliteGetCentralId({
      databasePath: this.sqlitePath,
      entityId,
      userStableId,
    });
  }

  async sqliteSetCentralMapping(
    entityId: string,
    userStableId: string,
    centralId: string,
  ): Promise<boolean> {
    if (!this.api.entitySqliteSetCentralMapping)
      throw new Error('SQLite central mapping updates are unavailable.');
    return this.api.entitySqliteSetCentralMapping({
      databasePath: this.sqlitePath,
      entityId,
      userStableId,
      centralId,
    });
  }

  async sqliteClearCentralMapping(entityId: string, userStableId: string): Promise<boolean> {
    if (!this.api.entitySqliteClearCentralMapping)
      throw new Error('SQLite central mapping clears are unavailable.');
    return this.api.entitySqliteClearCentralMapping({
      databasePath: this.sqlitePath,
      entityId,
      userStableId,
    });
  }

  async sqliteListMappingsByCentralIds(
    userStableId: string,
    centralIds: string[],
  ): Promise<{ projectEntityId: string; centralId: string; label: string | null }[]> {
    if (!this.api.entitySqliteListMappingsByCentralIds) return [];
    return this.api.entitySqliteListMappingsByCentralIds({
      databasePath: this.sqlitePath,
      userStableId,
      centralIds,
    });
  }

  async sqliteListAllCentralMappings(
    userStableId: string,
  ): Promise<{ projectEntityId: string; centralId: string }[]> {
    if (!this.api.entitySqliteListAllCentralMappings) return [];
    return this.api.entitySqliteListAllCentralMappings({
      databasePath: this.sqlitePath,
      userStableId,
    });
  }

  async sqliteListLinkedCentralIds(userStableId: string): Promise<string[] | null> {
    if (!this.api.entitySqliteListLinkedCentralIds || !(await this.hasSqliteDatabase()))
      return null;
    return this.api.entitySqliteListLinkedCentralIds({
      databasePath: this.sqlitePath,
      userStableId,
    });
  }

  async sqliteCountUnlinked(userStableId: string): Promise<number | null> {
    if (!this.api.entitySqliteCountUnlinked || !(await this.hasSqliteDatabase())) return null;
    return this.api.entitySqliteCountUnlinked({
      databasePath: this.sqlitePath,
      userStableId,
    });
  }

  async sqliteSearchNames(
    kind: EntityKind,
    query: string,
    limit = 20,
  ): Promise<
    | {
        id: string;
        label: string;
        description?: string;
        idnos: { type: string; value: string }[];
      }[]
    | null
  > {
    if (!this.api.entitySqliteSearch || !(await this.hasSqliteDatabase())) return null;
    return this.api.entitySqliteSearch({
      databasePath: this.sqlitePath,
      kind,
      query,
      limit,
    });
  }

  async sqliteFindAllByAuthority(kind: EntityKind, type: string, value: string): Promise<string[]> {
    if (!this.api.entitySqliteFindByAuthority) return [];
    return this.api.entitySqliteFindByAuthority({
      databasePath: this.sqlitePath,
      kind,
      type,
      value,
    });
  }

  async sqliteFindByAuthority(
    kind: EntityKind,
    type: string,
    value: string,
  ): Promise<string | null> {
    const ids = await this.sqliteFindAllByAuthority(kind, type, value);
    return ids[0] ?? null;
  }

  async sqliteFindByNameDates(
    kind: EntityKind,
    name: string,
    startYear?: number | null,
    endYear?: number | null,
  ): Promise<string | null> {
    if (!this.api.entitySqliteFindByNameDates) return null;
    return this.api.entitySqliteFindByNameDates({
      databasePath: this.sqlitePath,
      kind,
      name,
      startYear,
      endYear,
    });
  }

  async sqliteForceRejectAssertion(entityId: string, key: string): Promise<boolean> {
    if (!this.api.entitySqliteForceRejectAssertion)
      throw new Error('SQLite assertion rejection is unavailable.');
    return this.api.entitySqliteForceRejectAssertion({
      databasePath: this.sqlitePath,
      entityId,
      key,
    });
  }

  /** Check this project into the shared-database registry (entity-projects.json). */
  async registerProjectInRegistry(): Promise<string[]> {
    return registerProject(this.api, this.entitiesPath, this.projectRoot);
  }

  /** Registered project roots that still exist, always including this project. */
  async registryProjectRoots(): Promise<string[]> {
    return resolveProjectRoots(this.api, this.entitiesPath, this.projectRoot);
  }

  /**
   * Record a merge/delete as a durable order beside the entity database, so
   * projects not reachable right now converge on their next open (see
   * `entityOrders.ts`). Prefer passing `dbId` from `sqliteDatabaseId()`;
   * without it, SQLite databases resolve the fingerprint from metadata (no
   * DOM `loadEntities` fallthrough).
   */
  async recordEntityOrder(
    remap: Record<string, string | null>,
    dbId?: string,
  ): Promise<EntityOrder | null> {
    if (Object.keys(remap).length === 0) return null;
    let fingerprint = dbId ?? null;
    if (!fingerprint) {
      if (await this.hasSqliteDatabase()) {
        fingerprint = await this.sqliteDatabaseId();
      } else {
        throw new Error(
          'recordEntityOrder requires a database fingerprint. Pass dbId from sqliteDatabaseId().',
        );
      }
    }
    if (!fingerprint) return null;
    const order = makeOrder(fingerprint, remap);
    await recordOrder(this.api, this.entitiesPath, order);
    return order;
  }

  /** All recorded orders in the log beside `entities.xml`. */
  async readEntityOrders(): Promise<EntityOrder[]> {
    return readOrders(this.api, this.entitiesPath);
  }

  /** Order ids this project checkout has already applied. */
  async readAppliedOrderIds(): Promise<Set<string>> {
    return readAppliedOrderIds(this.api, this.projectGrognardDir);
  }

  /** Persist the applied-order-id set for this project checkout. */
  async writeAppliedOrderIds(applied: Set<string>): Promise<void> {
    await writeAppliedOrderIds(this.api, this.projectGrognardDir, applied);
  }

  /**
   * Raise a merge docket suggestion beside `entities.xml`: two central ids
   * that might be duplicates (surfaced by a PEDB merge whose two sides
   * mapped the same user to different central ids). A no-op for a
   * degenerate same-id pair.
   */
  async recordMergeSuggestion(
    sourceDbId: string,
    centralIds: [string, string],
  ): Promise<CentralMergeSuggestion | null> {
    if (centralIds[0] === centralIds[1]) return null;
    const suggestion = makeMergeSuggestion(sourceDbId, centralIds);
    await recordMergeSuggestionFile(this.api, this.entitiesPath, suggestion);
    return suggestion;
  }

  /**
   * Raise a merge docket suggestion beside `entities.xml`: a central id whose
   * PEDB counterpart was deleted (purged), so it may now be an orphan worth
   * reviewing for deletion too.
   */
  async recordDeleteSuggestion(
    sourceDbId: string,
    centralId: string,
  ): Promise<CentralDeleteSuggestion | null> {
    if (!centralId) return null;
    const suggestion = makeDeleteSuggestion(sourceDbId, centralId);
    await recordMergeSuggestionFile(this.api, this.entitiesPath, suggestion);
    return suggestion;
  }

  /** All merge-docket suggestions (merge and delete) ever raised beside `entities.xml`. */
  async readMergeSuggestions(): Promise<CentralSuggestion[]> {
    return readMergeSuggestionsFile(this.api, this.entitiesPath);
  }

  /** Every recorded decision (merged/deleted/ignored) on a merge-docket suggestion. */
  async readMergeSuggestionResolutions(): Promise<MergeSuggestionResolution[]> {
    return readMergeSuggestionResolutionsFile(this.api, this.entitiesPath);
  }

  /** Record the user's decision on a merge-docket suggestion, so it never resurfaces. */
  async recordMergeSuggestionResolution(
    suggestionId: string,
    action: MergeSuggestionAction,
  ): Promise<void> {
    await recordMergeSuggestionResolutionFile(
      this.api,
      this.entitiesPath,
      makeMergeSuggestionResolution(suggestionId, action),
    );
  }

  /** Append decision records to the JSONL log, creating it if needed. */
  async appendDecisions(records: DecisionRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.api.ensureDirectory(this.projectGrognardDir);
    const existing = (await this.api.pathExists(this.decisionsPath))
      ? await this.api.readFile(this.decisionsPath)
      : '';
    await this.api.writeFile(this.decisionsPath, appendRecords(existing, records));
  }

  /**
   * Append harvested person-wrapper facts (see `wrapperFactsLog.ts`) to this
   * project's JSONL log, creating it if needed.
   */
  async appendWrapperFacts(records: WrapperFactRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.api.ensureDirectory(this.projectGrognardDir);
    const existing = (await this.api.pathExists(this.wrapperFactsPath))
      ? await this.api.readFile(this.wrapperFactsPath)
      : '';
    await this.api.writeFile(this.wrapperFactsPath, appendWrapperFactRecords(existing, records));
  }

  /** Read every harvested person-wrapper fact this project has recorded so far. */
  async readWrapperFacts(): Promise<WrapperFactRecord[]> {
    if (!(await this.api.pathExists(this.wrapperFactsPath))) return [];
    return parseWrapperFacts(await this.api.readFile(this.wrapperFactsPath));
  }

  async readDisambiguationPending(): Promise<string | null> {
    if (!(await this.api.pathExists(this.disambiguationPendingPath))) return null;
    return this.api.readFile(this.disambiguationPendingPath);
  }

  async writeDisambiguationPending(content: string): Promise<void> {
    await this.api.ensureDirectory(this.projectGrognardDir);
    await this.api.writeFile(this.disambiguationPendingPath, content);
  }

  projectGrognardFilePath(relativeName: string): string {
    return joinPath(this.projectGrognardDir, relativeName);
  }

  async readProjectGrognardFile(relativeName: string): Promise<string | null> {
    const path = this.projectGrognardFilePath(relativeName);
    if (!(await this.api.pathExists(path))) return null;
    return this.api.readFile(path);
  }

  async writeProjectGrognardFile(relativeName: string, content: string): Promise<void> {
    await this.api.ensureDirectory(this.projectGrognardDir);
    const path = this.projectGrognardFilePath(relativeName);
    await this.api.armOwnWrite?.(path);
    await this.api.writeFile(path, content);
    await this.api.notifyOwnWrite?.(path);
  }
}

export interface DesktopEntityStoreGlobals {
  electronAPI?: Partial<EntityFileApi>;
  __ljbLspProject?: {
    projectRoot?: string;
    entityDbFolder?: string | null;
    /** When true, this project's PEDB is auto-synced with the CEDB. */
    syncToCentral?: boolean;
    /** Where this project's PEDB lives — mirrors ProjectFileConfig.pedb. */
    pedb?: EntityStorePedb;
  };
}

type DesktopGlobals = DesktopEntityStoreGlobals & {
  electronAPI?: DesktopEntityStoreGlobals['electronAPI'] & {
    statFile?: (filePath: string) => Promise<{ mtimeMs: number }>;
    ignoreFileChange?: (filePath: string, mtimeMs: number) => Promise<void>;
    armFileWrite?: (filePath: string) => Promise<void>;
  };
};

/** Build the desktop-backed EntityFileApi, or null when the bridge is missing. */
export function desktopEntityFileApi(): EntityFileApi | null {
  const rawApi = (window as unknown as DesktopGlobals).electronAPI;
  if (!rawApi?.ensureDirectory || !rawApi.pathExists || !rawApi.readFile || !rawApi.writeFile) {
    return null;
  }
  return {
    ensureDirectory: (dirPath) => rawApi.ensureDirectory!(dirPath),
    pathExists: (filePath) => rawApi.pathExists!(filePath),
    readFile: (filePath) => rawApi.readFile!(filePath),
    writeFile: (filePath, content) => rawApi.writeFile!(filePath, content),
    entitySqliteExportXml: rawApi.entitySqliteExportXml
      ? (request) => rawApi.entitySqliteExportXml!(request)
      : undefined,
    entitySqliteImportXml: rawApi.entitySqliteImportXml
      ? (request) => rawApi.entitySqliteImportXml!(request)
      : undefined,
    entitySqliteCandidates: rawApi.entitySqliteCandidates
      ? (request) => rawApi.entitySqliteCandidates!(request)
      : undefined,
    entitySqliteGetNotes: rawApi.entitySqliteGetNotes
      ? (input) => rawApi.entitySqliteGetNotes!(input)
      : undefined,
    entitySqliteSetNote: rawApi.entitySqliteSetNote
      ? (input) => rawApi.entitySqliteSetNote!(input)
      : undefined,
    entitySqliteGet: rawApi.entitySqliteGet ? (input) => rawApi.entitySqliteGet!(input) : undefined,
    entitySqliteDatabaseId: rawApi.entitySqliteDatabaseId
      ? (databasePath) => rawApi.entitySqliteDatabaseId!(databasePath)
      : undefined,
    entitySqliteListIds: rawApi.entitySqliteListIds
      ? (input) => rawApi.entitySqliteListIds!(input)
      : undefined,
    entitySqliteListPanelSummaries: rawApi.entitySqliteListPanelSummaries
      ? (input) => rawApi.entitySqliteListPanelSummaries!(input)
      : undefined,
    entitySqliteSearch: rawApi.entitySqliteSearch
      ? (input) => rawApi.entitySqliteSearch!(input)
      : undefined,
    entitySqliteAuthorityDuplicates: rawApi.entitySqliteAuthorityDuplicates
      ? (databasePath) => rawApi.entitySqliteAuthorityDuplicates!(databasePath)
      : undefined,
    entitySqliteUpdateNames: rawApi.entitySqliteUpdateNames
      ? (input) => rawApi.entitySqliteUpdateNames!(input)
      : undefined,
    entitySqliteTombstoneNames: rawApi.entitySqliteTombstoneNames
      ? (input) => rawApi.entitySqliteTombstoneNames!(input)
      : undefined,
    entitySqliteUpdateDescription: rawApi.entitySqliteUpdateDescription
      ? (input) => rawApi.entitySqliteUpdateDescription!(input)
      : undefined,
    entitySqliteUpdateSubtype: rawApi.entitySqliteUpdateSubtype
      ? (input) => rawApi.entitySqliteUpdateSubtype!(input)
      : undefined,
    entitySqliteCreateRelation: rawApi.entitySqliteCreateRelation
      ? (input) => rawApi.entitySqliteCreateRelation!(input)
      : undefined,
    entitySqliteListRelations: rawApi.entitySqliteListRelations
      ? (input) => rawApi.entitySqliteListRelations!(input)
      : undefined,
    entitySqliteUpdateRelationStatus: rawApi.entitySqliteUpdateRelationStatus
      ? (input) => rawApi.entitySqliteUpdateRelationStatus!(input)
      : undefined,
    entitySqliteRemoveName: rawApi.entitySqliteRemoveName
      ? (input) => rawApi.entitySqliteRemoveName!(input)
      : undefined,
    entitySqliteAddName: rawApi.entitySqliteAddName
      ? (input) => rawApi.entitySqliteAddName!(input)
      : undefined,
    entitySqliteSetUserDate: rawApi.entitySqliteSetUserDate
      ? (input) => rawApi.entitySqliteSetUserDate!(input)
      : undefined,
    entitySqliteSetUserWorkDate: rawApi.entitySqliteSetUserWorkDate
      ? (input) => rawApi.entitySqliteSetUserWorkDate!(input)
      : undefined,
    entitySqliteSetWorkType: rawApi.entitySqliteSetWorkType
      ? (input) => rawApi.entitySqliteSetWorkType!(input)
      : undefined,
    entitySqliteAddNationality: rawApi.entitySqliteAddNationality
      ? (input) => rawApi.entitySqliteAddNationality!(input)
      : undefined,
    entitySqliteAddOrigin: rawApi.entitySqliteAddOrigin
      ? (input) => rawApi.entitySqliteAddOrigin!(input)
      : undefined,
    entitySqliteAddNobleTitle: rawApi.entitySqliteAddNobleTitle
      ? (input) => rawApi.entitySqliteAddNobleTitle!(input)
      : undefined,
    entitySqliteUpdateNobleTitle: rawApi.entitySqliteUpdateNobleTitle
      ? (input) => rawApi.entitySqliteUpdateNobleTitle!(input)
      : undefined,
    entitySqliteSetUserWorkAuthors: rawApi.entitySqliteSetUserWorkAuthors
      ? (input) => rawApi.entitySqliteSetUserWorkAuthors!(input)
      : undefined,
    entitySqliteAttachAuthority: rawApi.entitySqliteAttachAuthority
      ? (input) => rawApi.entitySqliteAttachAuthority!(input)
      : undefined,
    entitySqliteDecoupleAuthority: rawApi.entitySqliteDecoupleAuthority
      ? (input) => rawApi.entitySqliteDecoupleAuthority!(input)
      : undefined,
    entitySqliteRejectAssertion: rawApi.entitySqliteRejectAssertion
      ? (input) => rawApi.entitySqliteRejectAssertion!(input)
      : undefined,
    entitySqliteRestoreAssertion: rawApi.entitySqliteRestoreAssertion
      ? (input) => rawApi.entitySqliteRestoreAssertion!(input)
      : undefined,
    entitySqliteRemoveAssertion: rawApi.entitySqliteRemoveAssertion
      ? (input) => rawApi.entitySqliteRemoveAssertion!(input)
      : undefined,
    entitySqliteValidateAssertion: rawApi.entitySqliteValidateAssertion
      ? (input) => rawApi.entitySqliteValidateAssertion!(input)
      : undefined,
    entitySqliteAcceptDateAssertion: rawApi.entitySqliteAcceptDateAssertion
      ? (input) => rawApi.entitySqliteAcceptDateAssertion!(input)
      : undefined,
    entitySqliteAcceptDescriptionAssertion: rawApi.entitySqliteAcceptDescriptionAssertion
      ? (input) => rawApi.entitySqliteAcceptDescriptionAssertion!(input)
      : undefined,
    entitySqliteRenamePrimaryName: rawApi.entitySqliteRenamePrimaryName
      ? (input) => rawApi.entitySqliteRenamePrimaryName!(input)
      : undefined,
    entitySqliteSetRomanizedName: rawApi.entitySqliteSetRomanizedName
      ? (input) => rawApi.entitySqliteSetRomanizedName!(input)
      : undefined,
    entitySqliteAutoCleanNames: rawApi.entitySqliteAutoCleanNames
      ? (input) => rawApi.entitySqliteAutoCleanNames!(input)
      : undefined,
    entitySqliteApplyConcordance: rawApi.entitySqliteApplyConcordance
      ? (input) => rawApi.entitySqliteApplyConcordance!(input)
      : undefined,
    entitySqliteRejectConcordance: rawApi.entitySqliteRejectConcordance
      ? (input) => rawApi.entitySqliteRejectConcordance!(input)
      : undefined,
    entitySqliteMarkDuplicateIntentional: rawApi.entitySqliteMarkDuplicateIntentional
      ? (input) => rawApi.entitySqliteMarkDuplicateIntentional!(input)
      : undefined,
    entitySqliteBackfillDecisionTargets: rawApi.entitySqliteBackfillDecisionTargets
      ? (input) => rawApi.entitySqliteBackfillDecisionTargets!(input)
      : undefined,
    entitySqliteSoftDelete: rawApi.entitySqliteSoftDelete
      ? (input) => rawApi.entitySqliteSoftDelete!(input)
      : undefined,
    entitySqliteMerge: rawApi.entitySqliteMerge
      ? (input) => rawApi.entitySqliteMerge!(input)
      : undefined,
    entitySqliteCreatePopulated: rawApi.entitySqliteCreatePopulated
      ? (input) => rawApi.entitySqliteCreatePopulated!(input)
      : undefined,
    entitySqliteApplyAuthorityBackfillPatch: rawApi.entitySqliteApplyAuthorityBackfillPatch
      ? (input) => rawApi.entitySqliteApplyAuthorityBackfillPatch!(input)
      : undefined,
    entitySqliteReconcileXmlExtractedData: rawApi.entitySqliteReconcileXmlExtractedData
      ? (input) => rawApi.entitySqliteReconcileXmlExtractedData!(input)
      : undefined,
    entitySqliteEntityContentHash: rawApi.entitySqliteEntityContentHash
      ? (input) => rawApi.entitySqliteEntityContentHash!(input)
      : undefined,
    entitySqliteReplaceEntityContent: rawApi.entitySqliteReplaceEntityContent
      ? (input) => rawApi.entitySqliteReplaceEntityContent!(input)
      : undefined,
    entitySqliteGetCentralId: rawApi.entitySqliteGetCentralId
      ? (input) => rawApi.entitySqliteGetCentralId!(input)
      : undefined,
    entitySqliteSetCentralMapping: rawApi.entitySqliteSetCentralMapping
      ? (input) => rawApi.entitySqliteSetCentralMapping!(input)
      : undefined,
    entitySqliteClearCentralMapping: rawApi.entitySqliteClearCentralMapping
      ? (input) => rawApi.entitySqliteClearCentralMapping!(input)
      : undefined,
    entitySqliteListMappingsByCentralIds: rawApi.entitySqliteListMappingsByCentralIds
      ? (input) => rawApi.entitySqliteListMappingsByCentralIds!(input)
      : undefined,
    entitySqliteListAllCentralMappings: rawApi.entitySqliteListAllCentralMappings
      ? (input) => rawApi.entitySqliteListAllCentralMappings!(input)
      : undefined,
    entitySqliteListLinkedCentralIds: rawApi.entitySqliteListLinkedCentralIds
      ? (input) => rawApi.entitySqliteListLinkedCentralIds!(input)
      : undefined,
    entitySqliteCountUnlinked: rawApi.entitySqliteCountUnlinked
      ? (input) => rawApi.entitySqliteCountUnlinked!(input)
      : undefined,
    entitySqliteFindByAuthority: rawApi.entitySqliteFindByAuthority
      ? (input) => rawApi.entitySqliteFindByAuthority!(input)
      : undefined,
    entitySqliteFindByNameDates: rawApi.entitySqliteFindByNameDates
      ? (input) => rawApi.entitySqliteFindByNameDates!(input)
      : undefined,
    entitySqliteForceRejectAssertion: rawApi.entitySqliteForceRejectAssertion
      ? (input) => rawApi.entitySqliteForceRejectAssertion!(input)
      : undefined,
    armOwnWrite: async (filePath) => {
      if (!rawApi.armFileWrite) return;
      try {
        await rawApi.armFileWrite(filePath);
      } catch {
        // ignore — worst case is the old post-write-only race, not a hard failure
      }
    },
    notifyOwnWrite: async (filePath) => {
      if (!rawApi.statFile || !rawApi.ignoreFileChange) return;
      try {
        const { mtimeMs } = await rawApi.statFile(filePath);
        await rawApi.ignoreFileChange(filePath, mtimeMs);
      } catch {
        // ignore — watcher may still fire, but disambiguation must not fail
      }
    },
  };
}

/**
 * Build an EntityStore from the desktop globals, or null in the web app / when
 * no project is open.
 *
 * `overrides.projectRoot` lets callers resolve a store for a project that
 * isn't loaded into the editor yet (e.g. the first-setup metadata dialog runs
 * before `window.__ljbLspProject` is populated, since that only happens once
 * `loadProjectBundle` mounts the editor — after this dialog has already
 * closed).
 */
export function entityStoreFromDesktop(overrides?: {
  projectRoot?: string;
  entityDbFolder?: string | null;
}): EntityStore | null {
  const api = desktopEntityFileApi();
  const project = (window as unknown as DesktopGlobals).__ljbLspProject;
  const root = overrides?.projectRoot ?? project?.projectRoot;
  if (!api || !root) return null;
  try {
    const paths = resolveEntityStorePaths({
      projectRoot: root,
      centralFolder: overrides?.entityDbFolder ?? project?.entityDbFolder ?? null,
      pedb: project?.pedb,
    });
    return EntityStore.fromPaths(api, paths);
  } catch {
    return null;
  }
}

/**
 * Build a **central-mode** EntityStore (the user's personal CEDB), regardless of
 * what store the project itself uses — the second half the Bridge needs.
 * Returns null when no central folder is configured.
 *
 * `overrideProjectRoot` mirrors entityStoreFromDesktop's override, for
 * callers resolving this before the project is loaded into the editor.
 */
export function centralEntityStoreFromDesktop(
  centralFolder: string | null,
  overrideProjectRoot?: string,
): EntityStore | null {
  const api = desktopEntityFileApi();
  const project = (window as unknown as DesktopGlobals).__ljbLspProject;
  const folder = centralFolder ?? project?.entityDbFolder ?? null;
  if (!api || !folder) return null;
  // Central browsing (database viewer, settings) must work before any project
  // is open — fall back to the central folder itself for infra paths.
  const root = overrideProjectRoot ?? project?.projectRoot ?? folder;
  try {
    const paths = resolveEntityStorePaths({
      projectRoot: root,
      entityStore: 'central',
      centralFolder: folder,
    });
    return EntityStore.fromPaths(api, paths);
  } catch {
    return null;
  }
}
