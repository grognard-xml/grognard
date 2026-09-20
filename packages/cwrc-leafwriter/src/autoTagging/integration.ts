import {
  buildDocIndex,
  locateAnchorInIndex,
  locateOccurrenceInIndex,
  type DocIndex,
} from './anchor';
import {
  clearFocusHighlight,
  focusHighlightMutatesDom,
  showFocusHighlight,
} from './editorFocusHighlight';
import { autoSyncEntitiesToCentral, autoSyncEntityToCentral } from './autoSync';
import {
  applySuggestions,
  applyWithWrapperCandidates,
  assignEntity,
  markUnresolved as markMentionUnresolved,
  revalidatePendingSuggestions,
  type ApplyOptions,
  type ApplyResult,
  type BatchResult,
  type UserRule,
} from './apply';
import { withApplyDiagnostics } from './applyDiagnostics';
import { canContainForAutoTagging } from './schemaContainment';
import { AuthorityCache } from './authorityCache';
import { DilaPlaceDetailCache } from './dilaPlaceDetailCache';
import type { DisambiguationCandidate } from './disambiguationCandidates';
import {
  asSyncedEntityCandidate,
  centralizeOwnDatabaseSources,
  collectGivenFamilyNamesForCandidate,
  collectTypedNamesForCandidate,
  loadSqliteDisambiguationCandidates,
  resolveCandidateForPedb,
  toAuthoritySourcedFields,
} from './disambiguationCandidates';
import { mintOrLinkEntitySqlite } from './sqliteLookupMint';
import { backfillEntitiesSqlite } from './sqliteAuthorityBackfill';
import { persistOfficeTranslationNames } from './officeGlossLookup';
import {
  biographicalYearsFromMetadata,
  floruitYearsFromMetadata,
  isFilterOnlyDateSource,
  scrubIndexYearFloruitClue,
} from './personDates';
import { SQLITE_REQUIRED_LOOKUP_MESSAGE } from './sqliteRequired';
import { entitySummaryFromSqlite } from './sqliteSummary';
import {
  parsePendingCache,
  serializePendingCache,
  setPendingCandidates,
  type PendingCache,
} from './disambiguationPending';
import { DecisionLogBuffer, type DecisionRecord } from './decisionLog';
import { TAG_TO_KIND, type EntityKind } from './entities';
import type { AuthorityCandidate } from './authority';
import { collectPluginPatternTagCandidates } from '../plugins/patternTagProducers';
import { suggestPersonNameSplit, suggestPersonRomanization } from '../plugins/personNameDefaults';
import { extractRegisteredEntityData } from '../plugins/entityDataExtractors';
import { personWrapperSource } from './entityExtraction';
import { autoTaggingDocumentKey } from './dateWorkflow';
import { preferCanonicalFamilyGiven } from './nameTypes';
import {
  nobleTitlesFromMetadata,
  personalNameForSegmentation,
  preferredEntityPrimaryName,
} from './nobleTitleHeadword';
import {
  ingestExtractedEntityDataSqlite,
  refreshExtractedEntityDataForDocumentSqlite,
} from './sqliteEntityExtraction';
import { autoRomanizeForKind } from '../utilities/romanize';
import { isTibetanLanguageCode } from '../utilities/languageCodes';
import { checkWellFormedness } from '../utilities/checkWellFormedness';
import { applyPurge, type PurgeOptions } from './purge';
import * as Comlink from 'comlink';
import {
  centralEntityStoreFromDesktop,
  desktopEntityFileApi,
  entityStoreFromDesktop,
  type DesktopEntityStoreGlobals,
  type EntityStore,
} from './entityStore';
import { readOrMintUserStableId } from './userStableId';
import {
  candidatesFromEntityDatabaseRecords,
  type EntityDatabaseCandidateRecord,
} from './ownDatabaseCandidates';
import {
  nameTypeTaggingPolicyFromSettings,
  readPersistedAuthoritySettings,
  matchAcrossLineBreaksFromSettings,
} from './authoritySettings';
import { crawlDocuments } from './crawl';
import { dictionaryTag, dictionaryTagProjection, type DictionaryEntry } from './dictionary';
import { compoundWrapperSuggestions, seedSuggestions, suggestionsFromSeedMatches } from './seed';
import {
  runGroupAndClean,
  parseChildlessNobleTitles,
  type GroupAndCleanResult,
} from './groupAndClean';
import { buildNobleTitleVocabulary } from './nobleTitleSpanParser';
import {
  autoResolveNobleTitles,
  buildPackTitleNorbertIndex,
  buildPersonTitleIndex,
  buildTitleOnlyPersonIndex,
  nobleTitleMatchKey,
  titleOnlyMatchKey,
} from './nobleTitleAutoResolve';
import { formatNorbertAuthorityValue, norbertAuthorityLookupValues } from './norbertAuthorityId';
import {
  buildWrapperDisambiguationIndexFromFacts,
  wrapperDisambiguationIndexFromPack,
  wrapperDisambiguationQueryFromElement,
  wrapperIdentityElement,
  type WrapperDisambiguationIndex,
} from './wrapperDisambiguationIndex';
import type { WrapperFactRecord } from './wrapperFactsLog';
import { cachedPackReader } from '../services/authority-pack-lookup';
import { DisambiguationAiCache } from './disambiguationAiCache';
import type { AiPromptProfile } from './aiPromptProfiles';
import type { LlmClient } from './llmClient';
import { LlmCache } from './llmCache';
import { llmSuggest, type LlmSuggestResult } from './llmSuggest';
import { collectTaggedSpans, prepareSuggestionsForReview } from './suggestionFilters';
import { keyedPersNameFloors, phase2StringsForEntity, shortFormTag } from './shortFormTag';
import { llmAudit, type LlmAuditResult } from './llmAudit';
import { normalizeDomText } from './normalize';
import { AUTHORITY_PACKS, authorityPackOrigin, type AuthorityPackId } from './packPaths';
import { tagFollowingStyleNames } from './styleNameTag';
import { MAX_AUTHORITY_SUGGESTIONS, runAuthorityTagBombOnDocument } from './authorityTagBomb';
import type { DateTagOptions, SanmiaoBatchResolveFn, SanmiaoBatchTagFn } from './sanmiaoDateTypes';
import {
  collectMentions,
  mergeMentionGroups,
  type MentionGroup,
  type MentionInstance,
} from './mentions';
import type { DecisionEvent } from './reviewController';
import type { Anchor, Suggestion, WhitespacePolicy } from './types';
import {
  iterateAuthorityNdjson,
  type AuthorityPackContent,
  type DateRangeFilter,
} from './packLoader';
import { getCachedNorbertExpanderCandidates, type ReadAuthorityPack } from './norbertExpanderCache';
import type { SearchTextRange } from './chunk';
import { resolveCurrentDocumentXml } from './documentContent';
import { findSelectionRangeInDocument, searchTextForDomRange } from './selectionScope';
import type { TagBombScope } from './tagBombScope';

export { MAX_AUTHORITY_SUGGESTIONS } from './authorityTagBomb';

/** Entity kind read from PEDB/CEDB entities.xml for each own-database pack id. */
export const OWN_DATABASE_KIND_BY_PACK_ID: Partial<Record<AuthorityPackId, EntityKind>> = {
  'pedb-persons': 'person',
  'pedb-places': 'place',
  'pedb-orgs': 'org',
  'pedb-works': 'work',
  'cedb-persons': 'person',
  'cedb-places': 'place',
  'cedb-orgs': 'org',
  'cedb-works': 'work',
};

/** The identity-bearing child of a person wrapper (not a posthumous/temple name). */
function wrapperPersonName(wrapper: Element): Element | null {
  return (
    Array.from(wrapper.getElementsByTagName('persName')).find(
      (element) => !element.getAttribute('type'),
    ) ?? null
  );
}

/**
 * Repair wrapper/inner-person keys from the local entity database.
 *
 * This is intentionally conservative: an exact local-name match must resolve
 * to one project entity. Conflicts are left untouched for the validation UI.
 */
export async function reconcilePersonWrapperKeys(
  doc: Document,
  findLocalIds: (surface: string) => Promise<string[]> | string[],
  entityExists?: (entityId: string) => Promise<boolean> | boolean,
): Promise<boolean> {
  let changed = false;
  for (const wrapper of Array.from(doc.getElementsByTagName('name'))) {
    if (wrapper.getAttribute('type') !== 'personWrapper') continue;
    const person = wrapperPersonName(wrapper);
    if (!person) continue;
    const wrapperKey = wrapper.getAttribute('key')?.trim() ?? '';
    const personKey = person.getAttribute('key')?.trim() ?? '';
    if (wrapperKey && personKey) {
      // A disagreement is evidence of a real disambiguation conflict.
      if (
        (wrapperKey !== personKey ||
          (entityExists && !(await Promise.resolve(entityExists(wrapperKey)))) ||
          (entityExists && !(await Promise.resolve(entityExists(personKey))))) &&
        wrapper.getAttribute('cert') !== 'unknown'
      ) {
        wrapper.setAttribute('cert', 'unknown');
        changed = true;
      }
      continue;
    }
    if (wrapperKey) {
      if (entityExists && !(await Promise.resolve(entityExists(wrapperKey)))) {
        if (wrapper.getAttribute('cert') !== 'unknown') {
          wrapper.setAttribute('cert', 'unknown');
          changed = true;
        }
        continue;
      }
      assignEntity({ element: person, entityId: wrapperKey });
      changed = true;
      continue;
    }
    if (personKey) {
      if (entityExists && !(await Promise.resolve(entityExists(personKey)))) {
        if (wrapper.getAttribute('cert') !== 'unknown') {
          wrapper.setAttribute('cert', 'unknown');
          changed = true;
        }
        continue;
      }
      assignEntity({ element: wrapper, entityId: personKey });
      changed = true;
      continue;
    }

    const surface = person.textContent?.trim() ?? '';
    if (!surface) continue;
    const ids = [...new Set(await Promise.resolve(findLocalIds(surface)))];
    if (ids.length !== 1) {
      if (wrapper.getAttribute('cert') !== 'unknown') {
        wrapper.setAttribute('cert', 'unknown');
        changed = true;
      }
      continue;
    }
    assignEntity({ element: person, entityId: ids[0]! });
    assignEntity({ element: wrapper, entityId: ids[0]! });
    changed = true;
  }
  return changed;
}

/**
 * Auto-resolve closed-set noble ranks and uniquely known titles
 * (place+role+posthumous) against PEDB / Norbert packs before Disambiguate
 * lists mentions. Returns true when the document was mutated.
 */
async function autoResolveNobleTitlesInDocument(
  store: EntityStore,
  doc: Document,
): Promise<boolean> {
  const personRecords = (await store.sqliteCandidateRecords('person')) as
    | {
        id: string;
        nobleTitles?: {
          fief?: string | null;
          roleName?: string | null;
          posthumousName?: string | null;
        }[];
      }[]
    | null;
  const pedbTitleIndex = buildPersonTitleIndex(personRecords ?? []);

  const readPack = cachedPackReader();
  let packTitleIndex = new Map<string, string[]>();
  const packOfficeByRank = new Map<string, string>();
  let vocabularyRanks: Set<string> | undefined;
  let changedByParsing = false;
  if (readPack) {
    try {
      const wikiNt = await readPack('norbert-wiki-nt');
      const wikiCandidates = [...iterateAuthorityNdjson(wikiNt)];
      packTitleIndex = buildPackTitleNorbertIndex(wikiCandidates);
      const vocabulary = buildNobleTitleVocabulary(wikiCandidates);
      vocabularyRanks = vocabulary.ranks;
      // Decompose any still-flat <nobleTitle> spans (e.g. a bare mention
      // like 建安王薨 with no attached name) into structured children and
      // wrap them for Disambiguate, same as the manual "Group and Clean"
      // action — this must run automatically here so the feature doesn't
      // depend on the user remembering to invoke that toolbar action.
      const touched = new Set<Element>();
      if (
        doc.documentElement &&
        parseChildlessNobleTitles(doc.documentElement, vocabulary, touched) > 0
      ) {
        changedByParsing = true;
      }
    } catch {
      // Wiki-nt pack is optional.
    }
    try {
      const offices = await readPack('norbert-offices');
      for (const candidate of iterateAuthorityNdjson(offices)) {
        if (candidate.kind !== 'office') continue;
        const name = candidate.primaryName?.trim();
        if (!name) continue;
        const authorityId = String(candidate.authorityId ?? '').trim();
        if (!authorityId) continue;
        const formatted = formatNorbertAuthorityValue('office', authorityId);
        const existing = packOfficeByRank.get(name);
        // Only keep ranks with a unique pack office hit.
        if (existing && existing !== formatted) packOfficeByRank.set(name, '');
        else if (!existing) packOfficeByRank.set(name, formatted);
      }
      for (const [rank, value] of [...packOfficeByRank.entries()]) {
        if (!value) packOfficeByRank.delete(rank);
      }
    } catch {
      // Offices pack is optional for rank refs.
    }
  }

  const result = await autoResolveNobleTitles(doc, {
    vocabularyRanks,
    findOfficeIds: async (rank) => {
      const candidates = await loadSqliteDisambiguationCandidates(store, 'roleName', rank, 'pedb');
      if (candidates == null) return [];
      return [
        ...new Set(
          candidates
            .map((candidate) => candidate.localEntityId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    },
    findPackOfficeAuthority: (rank) => {
      const authority = packOfficeByRank.get(rank);
      return authority ? `NORBERT:${authority}` : null;
    },
    findPersonIdsByTitle: async ({ place, role, posthumous }) => {
      const key = nobleTitleMatchKey(place, role, posthumous);
      const pedbIds = pedbTitleIndex.get(key) ?? [];
      if (pedbIds.length === 1) return pedbIds;
      if (pedbIds.length > 1) return pedbIds;

      const norbertIds = packTitleIndex.get(key) ?? [];
      if (norbertIds.length !== 1) return pedbIds;
      const local: string[] = [];
      for (const value of norbertAuthorityLookupValues(norbertIds[0]!)) {
        const ids = await store.sqliteFindAllByAuthority('person', 'NORBERT', value);
        for (const id of ids) {
          if (!local.includes(id)) local.push(id);
        }
      }
      return local.length ? local : pedbIds;
    },
  });
  return result.changed || changedByParsing;
}

/**
 * Broader TEI tag synonyms crawled per category (mirrors `DEFAULT_CRAWL_TAGS`
 * in `crawl.ts`), keyed by a project/list pack's `defaultTag`.
 */
const CRAWL_TAGS_BY_DEFAULT_TAG: Record<string, string[]> = {
  persName: ['persName'],
  placeName: ['placeName', 'geogName'],
  orgName: ['orgName', 'org'],
  roleName: ['roleName'],
  title: ['title', 'name'],
};

export interface TagBombImportedList {
  name: string;
  entries: DictionaryEntry[];
}

export interface TagBombOptions {
  dateFilter?: DateRangeFilter;
  onProgress?: (message: string) => void;
  /** Parsed CSV/TSV/xlsx/ODS files chosen in the panel, filtered by the checked `list-*` categories. */
  importedLists?: TagBombImportedList[];
  /** Which document(s) to scan. Defaults to `currentFile` — the pre-scope behavior. */
  scope?: TagBombScope;
  /** Folder path, required when `scope` is `custom`. */
  customPath?: string;
}

export interface TagBombResult {
  /** Suggestions for the current/first-matched document — unchanged for `currentFile` scope. */
  suggestions: Suggestion[];
  candidateCount: number;
  matchCount: number;
  loaded: Partial<Record<AuthorityPackId, number>>;
  truncated: boolean;
  /**
   * Present when `scope` matched more than one document. One entry per
   * document that had at least one suggestion, for sequential per-document
   * review. `suggestions` above mirrors `byDocument[0]` in that case.
   */
  byDocument?: TagBombDocumentResult[];
}

export interface TagBombDocumentResult {
  filePath: string;
  suggestions: Suggestion[];
  matchCount: number;
}

export interface TagBombScopeDocument {
  doc: Document;
  filePath: string;
}

export interface TagTransformOptions extends PurgeOptions {
  scope?: TagBombScope;
  customPath?: string;
  validateOtherFiles?: boolean;
}

export interface TagTransformResult {
  filesChanged: number;
  matches: number;
}

/**
 * The slice of Writer this session needs. Kept structural so the session can
 * be tested without a live editor.
 */
export interface WriterLike {
  converter: { getDocumentContent: (includeRDF: boolean) => Promise<string | null | undefined> };
  getContent?: () => Promise<string | null | undefined>;
  loadDocumentXML: (xml: string) => unknown;
  schemaManager?: { isTagValidChildOfParent: (child: string, parent: string) => boolean };
  editor?: {
    getBody: () => HTMLElement;
    isNotDirty?: boolean;
    selection: {
      setRng: (range: Range) => void;
      getRng?: () => Range | null;
      scrollIntoView?: () => void;
    };
    getDoc: () => Document;
    getWin?: () => Window | null | undefined;
    undoManager?: { ignore?: (fn: () => void) => void };
    on?: (events: string, handler: () => void) => void;
    off?: (events: string, handler: () => void) => void;
  };
  overmindActions?: {
    editor?: { setContentHasChanged?: (value: boolean) => void };
    document?: { setDocumentXml?: (content: string) => void };
    project?: {
      markTabDirty?: (dirty: boolean) => void;
      updateTabContent?: (params: { content: string; filePath: string }) => void;
    };
  };
  overmindState?: {
    document?: { url?: string; xml?: string };
    editor?: { resource?: { filePath?: string } };
  };
  validate?: () => void;
}

/** Desktop file access for project-wide crawl (absent in the web app). */
interface DesktopProjectApi {
  listProjectXmlFiles: (rootPath: string) => Promise<{ name: string; path: string }[]>;
  readFile: (filePath: string) => Promise<string>;
}

export interface ProjectDocuments {
  /** The current (live) document plus every readable project XML file. */
  documents: Document[];
  /** True when a filesystem project was available (desktop app). */
  available: boolean;
}

/** Compare filesystem paths case-insensitively, normalizing separators. */
function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

export type ApplyProgressCallback = (done: number, total: number) => void;

/** Let the browser paint a progress overlay before heavy synchronous work. */
const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

/**
 * One auto-tagging run against a live document (Phase 2 integration).
 *
 * Apply strategy (decided): apply operates on the XML source — fetched from
 * the converter, mutated by the apply engine, and reloaded via
 * loadDocumentXML — the same round-trip the source editor uses. The
 * pre-apply XML string is the snapshot; revert() reloads it.
 */
export class AutoTaggingSession {
  private snapshots: string[] = [];
  private readonly decisions = new DecisionLogBuffer();
  private readonly store: EntityStore | null;
  private entitiesDoc: Document | null = null;
  private authorityCache: AuthorityCache | null = null;
  private dilaPlaceDetailCacheStore: DilaPlaceDetailCache | null = null;
  private llmCache: LlmCache | null = null;
  private disambiguationAiCacheStore: DisambiguationAiCache | null = null;
  private pendingCache: PendingCache = { version: 2, entries: {} };
  private personWrapperCandidatesPromise: Promise<AuthorityCandidate[]> | null = null;
  private wrapperDisambiguationIndexPromise: Promise<WrapperDisambiguationIndex> | null = null;
  /** Invalidated after every `appendWrapperFacts` so the next lookup sees what was just harvested. */
  private projectWrapperFactsIndexPromise: Promise<WrapperDisambiguationIndex> | null = null;
  private documentPaths = new Map<Document, string>();
  private projectLangPromise: Promise<string | null> | null = null;
  private focusIndex: { body: HTMLElement; index: DocIndex } | null = null;
  private focusIndexWatcher: WriterLike['editor'] | null = null;

  constructor(
    private readonly writer: WriterLike,
    readonly policy: WhitespacePolicy = 'ignore',
    store: EntityStore | null = entityStoreFromDesktop(),
  ) {
    this.store = store;
    if (store) {
      const globals = window as unknown as {
        electronAPI?: {
          readFile: (path: string) => Promise<string>;
          writeFile: (path: string, content: string) => Promise<void>;
          pathExists: (path: string) => Promise<boolean>;
          ensureDirectory: (dir: string) => Promise<void>;
        };
      };
      const api = globals.electronAPI;
      if (api) {
        this.authorityCache = new AuthorityCache(api, store.authorityCacheDir, {
          enableGlobalCache: true,
        });
        this.dilaPlaceDetailCacheStore = new DilaPlaceDetailCache(
          api,
          store.dilaPlaceDetailCacheDir,
        );
        this.llmCache = new LlmCache(api, store.aiCacheDir);
        this.disambiguationAiCacheStore = new DisambiguationAiCache(
          api,
          store.aiDisambiguationCacheDir,
        );
      }
    }
  }

  get entityStore(): EntityStore | null {
    return this.store;
  }

  private centralContextPromise: Promise<{
    store: EntityStore;
    userStableId: string;
  } | null> | null = null;

  /**
   * Resolve the central database + this user's stable id, when this project
   * has syncToCentral on - so disambiguation can also search the CEDB.
   * Memoized per session: this is called once per candidate lookup and the
   * result never changes mid-session.
   */
  async centralContext(): Promise<{ store: EntityStore; userStableId: string } | null> {
    if (!this.centralContextPromise) {
      this.centralContextPromise = (async () => {
        const project = (window as unknown as DesktopEntityStoreGlobals).__ljbLspProject;
        if (!project?.syncToCentral) return null;
        const api = desktopEntityFileApi();
        if (!api) return null;
        const centralFolder = project.entityDbFolder ?? null;
        const centralStore = centralEntityStoreFromDesktop(centralFolder);
        if (!centralStore) return null;
        const { id: userStableId } = await readOrMintUserStableId(api, centralFolder);
        return { store: centralStore, userStableId };
      })();
    }
    return this.centralContextPromise;
  }

  /** The `central` argument buildDisambiguationCandidates expects, or null when syncToCentral is off. */
  async candidateSearchCentralContext(): Promise<{
    doc?: Document;
    userStableId: string;
  } | null> {
    const central = await this.centralContext();
    if (!central) return null;
    // Migrated CEDB only — surface matches come from `disambiguationDbSources`.
    if (!(await central.store.hasSqliteDatabase())) {
      throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
    }
    return { userStableId: central.userStableId };
  }

  /**
   * PEDB/CEDB surface matches for disambiguation. Requires SQLite on each
   * store being searched — no XML/`loadEntities` fallthrough.
   *
   * When syncToCentral is on, the central database is the entity pool (same
   * mental model as the Database panel): promote any still-unlinked PEDB
   * hits for this surface, then return CEDB matches without Local/Central
   * provenance. Linked rows carry their PEDB id for document `@key` checks.
   */
  async disambiguationDbSources(
    tag: string,
    surface: string,
  ): Promise<{
    local: DisambiguationCandidate[];
    central?: {
      userStableId: string;
      candidates: DisambiguationCandidate[];
    };
    entitiesDoc: Document | null;
  }> {
    if (!this.store) {
      return { local: [], entitiesDoc: null };
    }

    const sqliteLocal = await loadSqliteDisambiguationCandidates(this.store, tag, surface, 'pedb');
    if (sqliteLocal == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);

    const central = await this.centralContext();
    if (!central) {
      return { local: sqliteLocal, entitiesDoc: this.getEntitiesDocument() };
    }

    const mappingsBefore =
      (await this.store.sqliteListAllCentralMappings(central.userStableId)) ?? [];
    const centralByPedb = new Map(
      mappingsBefore.map((row) => [row.projectEntityId, row.centralId]),
    );
    const unlinkedPedbIds = sqliteLocal
      .map((candidate) => candidate.localEntityId)
      .filter((id): id is string => !!id && !centralByPedb.has(id));
    if (unlinkedPedbIds.length > 0) {
      await autoSyncEntitiesToCentral(null, unlinkedPedbIds);
    }

    const sqliteCentral = await loadSqliteDisambiguationCandidates(
      central.store,
      tag,
      surface,
      'cedb',
    );
    if (sqliteCentral == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);

    const mappingsAfter =
      (await this.store.sqliteListAllCentralMappings(central.userStableId)) ?? [];
    const pedbByCentral = new Map(mappingsAfter.map((row) => [row.centralId, row.projectEntityId]));
    const coveredPedbIds = new Set(
      sqliteCentral
        .map((candidate) =>
          candidate.centralEntityId ? pedbByCentral.get(candidate.centralEntityId) : undefined,
        )
        .filter((id): id is string => !!id),
    );

    // PEDB surface hits that CEDB search did not return (e.g. an alternate name
    // only on the project mirror), plus any still-unlinked after promote failed.
    const projectOnly = sqliteLocal
      .filter(
        (candidate) => !!candidate.localEntityId && !coveredPedbIds.has(candidate.localEntityId),
      )
      .map((candidate) => ({
        ...candidate,
        sources: centralizeOwnDatabaseSources(candidate.sources),
      }));

    return {
      local: projectOnly,
      central: {
        userStableId: central.userStableId,
        candidates: sqliteCentral.map((candidate) =>
          asSyncedEntityCandidate(
            candidate,
            candidate.centralEntityId ? pedbByCentral.get(candidate.centralEntityId) : undefined,
          ),
        ),
      },
      entitiesDoc: this.getEntitiesDocument(),
    };
  }

  /**
   * Disambiguate candidates for a person wrapper whose title was mentioned
   * with no name attached at all (`bareNobleTitleQuery` — an empty identity
   * `<persName>`). The surface-based lookup `disambiguationDbSources` uses
   * can't help here — there's no name text to search on, only a fief+rank —
   * so this queries this project's own PEDB entities directly by fief+role
   * (`buildTitleOnlyPersonIndex`, deliberately not requiring a posthumous
   * name, unlike the strong auto-resolve case) and returns every match as an
   * ordinary candidate. Expected to return more than one hit often — many
   * people can hold the same title across different reigns — so this always
   * feeds the review list, never an auto-key.
   */
  async titleOnlyDisambiguationCandidates(
    fief: string,
    roleName: string,
  ): Promise<DisambiguationCandidate[]> {
    if (!this.store) return [];
    const records = (await this.store.sqliteCandidateRecords('person')) as
      { id: string; nobleTitles?: { fief?: string | null; roleName?: string | null }[] }[] | null;
    if (!records) return [];
    const index = buildTitleOnlyPersonIndex(records);
    const ids = index.get(titleOnlyMatchKey(fief, roleName)) ?? [];
    if (ids.length === 0) return [];

    const candidates: DisambiguationCandidate[] = [];
    for (const id of ids) {
      const summary = (await this.store.sqliteEntitySummary(id)) as {
        description?: string | null;
        authorities?: DisambiguationCandidate['authorityIds'];
        names?: { text: string; status?: string }[];
        startYear?: number | null;
        endYear?: number | null;
      } | null;
      if (!summary) continue;
      const nameTexts = (summary.names ?? [])
        .filter((name) => name.status !== 'rejected' && name.status !== 'withdrawn')
        .map((name) => name.text.trim())
        .filter(Boolean);
      candidates.push({
        id,
        label: nameTexts[0] ?? id,
        description: summary.description ?? undefined,
        sources: ['entity-file'],
        localEntityId: id,
        authorityIds: summary.authorities ?? [],
        fromEntityFile: true,
        startYear: summary.startYear ?? undefined,
        endYear: summary.endYear ?? undefined,
        projectLangName: nameTexts[0],
      });
    }
    return candidates;
  }

  /** Project source language (BCP-47) from the desktop bridge; cached for the session. */
  projectLanguage(): Promise<string | null> {
    this.projectLangPromise ??= (async () => {
      try {
        const globals = window as unknown as {
          __leafWriterProject?: { getProjectSourceLanguage?: () => Promise<string | null> };
        };
        return (await globals.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;
      } catch {
        return null;
      }
    })();
    return this.projectLangPromise;
  }

  private desktopLanguage(): string | null {
    try {
      return window.localStorage.getItem('i18nextLng');
    } catch {
      return null;
    }
  }

  get cache(): AuthorityCache | null {
    return this.authorityCache;
  }

  get dilaPlaceDetailCache(): DilaPlaceDetailCache | null {
    return this.dilaPlaceDetailCacheStore;
  }

  get aiCache(): LlmCache | null {
    return this.llmCache;
  }

  get disambiguationAiCache(): DisambiguationAiCache | null {
    return this.disambiguationAiCacheStore;
  }

  /**
   * The current editor selection as a whole-document search-text range, for
   * scoping producers to the selected blocks. Null when nothing is selected
   * or the selected text cannot be located in the serialized document (the
   * caller then runs on the whole document).
   */
  async getSelectionRange(): Promise<SearchTextRange | null> {
    const editor = this.writer.editor;
    const range = editor?.selection.getRng?.();
    if (!editor || !range || range.collapsed) return null;

    try {
      const bodyIndex = buildDocIndex(editor.getBody(), this.policy);
      const selected = searchTextForDomRange(bodyIndex, range);
      const doc = await this.getDocument();
      return findSelectionRangeInDocument(doc, selected, this.policy);
    } catch {
      // Selection scoping is a convenience — never let it block a run.
      return null;
    }
  }

  /**
   * Run AI suggest on the live document. Uses `.grognard/ai-cache/` when a project
   * store is available. `onProgress` reports completed chunk count. Pass
   * `range` (from getSelectionRange) to tag only the blocks it intersects.
   */
  async runAiSuggest(
    tags: string[],
    client: LlmClient,
    onProgress?: (done: number, total: number) => void,
    promptProfile?: AiPromptProfile,
    signal?: AbortSignal,
    range?: SearchTextRange | null,
    onChunk?: (suggestions: Suggestion[]) => void,
  ): Promise<LlmSuggestResult> {
    const doc = await this.getDocument();
    const tibetanTolerant = isTibetanLanguageCode(await this.projectLanguage());
    const result = await llmSuggest(doc, {
      tags,
      client,
      cache: this.llmCache ?? undefined,
      policy: this.policy,
      onProgress,
      promptProfile,
      signal,
      range,
      onChunk,
      tibetanTolerant,
    });
    const { suggestions, droppedNested } = prepareSuggestionsForReview(
      doc,
      this.policy,
      result.suggestions,
    );
    return {
      suggestions,
      unverifiableCount: result.unverifiableCount + droppedNested,
    };
  }

  /**
   * Run AI audit on the live document (existing tags rendered inline per chunk).
   * Uses `.grognard/ai-cache/` when a project store is available.
   */
  async runAiAudit(
    tags: string[],
    client: LlmClient,
    onProgress?: (done: number, total: number) => void,
    promptProfile?: AiPromptProfile,
    signal?: AbortSignal,
    range?: SearchTextRange | null,
    onChunk?: (suggestions: Suggestion[]) => void,
  ): Promise<LlmAuditResult> {
    const doc = await this.getDocument();
    const tibetanTolerant = isTibetanLanguageCode(await this.projectLanguage());
    const result = await llmAudit(doc, {
      tags,
      client,
      cache: this.llmCache ?? undefined,
      policy: this.policy,
      onProgress,
      promptProfile,
      signal,
      range,
      onChunk,
      tibetanTolerant,
    });
    const { suggestions, droppedNested } = prepareSuggestionsForReview(
      doc,
      this.policy,
      result.suggestions,
    );
    return {
      ...result,
      suggestions,
      unverifiableCount: result.unverifiableCount + droppedNested,
    };
  }

  /** True when the document has at least one tagged mention for any of `tags`. */
  async hasTaggedMentions(tags: string[]): Promise<boolean> {
    const doc = await this.getDocument();
    const index = buildDocIndex(doc, this.policy);
    return collectTaggedSpans(doc, index, new Set(tags)).length > 0;
  }

  /**
   * Tag bomb from pre-compiled authority NDJSON packs (Phase A2/A3).
   * Tag-only — no @key; clues on suggestions for review / later disambiguation.
   */
  async runAuthorityTagBomb(
    packIds: AuthorityPackId[],
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
    options: {
      dateFilter?: DateRangeFilter;
      /** @deprecated Use {@link dateFilter}. */
      yearRange?: { start: number; end: number };
      hideUndated?: boolean;
      onProgress?: (message: string) => void;
    } = {},
  ): Promise<{
    suggestions: Suggestion[];
    candidateCount: number;
    matchCount: number;
    loaded: Partial<Record<AuthorityPackId, number>>;
    truncated: boolean;
  }> {
    const doc = await this.getDocument();
    const result = await runAuthorityTagBombOnDocument(doc, packIds, readPackFile, this.policy, {
      ...options,
      useProjectionMatcher: matchAcrossLineBreaksFromSettings(readPersistedAuthoritySettings()),
      maxSuggestions: MAX_AUTHORITY_SUGGESTIONS,
      onProgress: (message) => {
        options.onProgress?.(message);
        void yieldToUi();
      },
    });
    const { suggestions } = prepareSuggestionsForReview(doc, this.policy, result.suggestions);
    return { ...result, suggestions };
  }

  /**
   * Second Norbert pass: after component tags have been applied, find wrapper
   * candidates spanning adjacent tagged components.  The returned suggestions
   * preserve those children and are intended for the normal review/apply path.
   */
  async runPersonWrapperConcatenation(
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
  ): Promise<{ suggestions: Suggestion[]; matchCount: number }> {
    const doc = await this.getDocument();
    this.personWrapperCandidatesPromise ??= (async () => {
      const packCandidates = await getCachedNorbertExpanderCandidates(
        readPackFile as ReadAuthorityPack,
      );
      return [...packCandidates, ...(await collectPluginPatternTagCandidates())];
    })();
    const candidates = await this.personWrapperCandidatesPromise;

    // Compound wrappers need their components already tagged as separate
    // adjacent elements; standalone noble titles (no full wrapper recipe)
    // are ordinary single-node 'add' suggestions and go through the normal
    // seed matcher instead.
    const wrapperMatches = compoundWrapperSuggestions(doc, candidates, this.policy);
    const nobleTitleOnly = candidates.filter((c) => !c.metadata?.wrapper && c.metadata?.nobleTitle);
    const nobleTitleMatches =
      nobleTitleOnly.length > 0 ? seedSuggestions(doc, nobleTitleOnly, this.policy) : [];
    const matches = [...wrapperMatches, ...nobleTitleMatches];

    const suggestions = prepareSuggestionsForReview(
      doc,
      this.policy,
      suggestionsFromSeedMatches(matches),
    ).suggestions;
    return { suggestions, matchCount: matches.length };
  }

  /**
   * Warm Norbert's pack-derived second-pass candidates while the review panel
   * is idle, so Apply/Refresh never have to begin by parsing the packs.
   */
  async warmPersonWrapperCandidates(
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
  ): Promise<void> {
    await getCachedNorbertExpanderCandidates(readPackFile as ReadAuthorityPack);
  }

  /**
   * Norbert "Group and clean": a post-validation cleanup pass over markup the
   * user has already reviewed/accepted — merges compound `<roleName>`s, nests
   * a governing `<placeName>` into its `<roleName>`, parses childless
   * `<nobleTitle>`s, wraps adjacent tagged person components in a
   * personWrapper, and gives every keyless wrapper a `@key` where it can.
   * Mutates the document directly (not via the suggestion-review path) and
   * persists the result. `scopeRoot` defaults to the whole document; pass the
   * current selection's containing element to restrict the pass to it.
   */
  async runGroupAndClean(
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
    scopeRoot?: Element,
  ): Promise<GroupAndCleanResult> {
    if (!this.store || !(await this.store.hasSqliteDatabase())) {
      throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
    }
    const doc = await this.getDocument();
    const root = scopeRoot ?? doc.documentElement;

    const [officeContent, wikiNtContent, reviewedTitleContent] = await Promise.all([
      readPackFile('norbert-offices').catch(() => null),
      readPackFile('norbert-wiki-nt').catch(() => null),
      readPackFile('noble-title-filter').catch(() => null),
    ]);

    const officeCandidates = officeContent ? [...iterateAuthorityNdjson(officeContent)] : [];
    const vocabulary = buildNobleTitleVocabulary(
      wikiNtContent ? iterateAuthorityNdjson(wikiNtContent) : [],
    );

    const findLocalIds = async (surface: string): Promise<string[]> => {
      const candidates = await loadSqliteDisambiguationCandidates(
        this.store!,
        'persName',
        surface,
        'pedb',
      );
      if (candidates == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
      return [
        ...new Set(
          candidates
            .map((candidate) => candidate.localEntityId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    };

    const reviewedTitleCandidates = reviewedTitleContent
      ? [...iterateAuthorityNdjson(reviewedTitleContent)]
      : [];
    const result = await runGroupAndClean(
      findLocalIds,
      root,
      officeCandidates,
      vocabulary,
      reviewedTitleCandidates,
    );

    await this.persistDocument(doc);
    return result;
  }

  /**
   * Refresh a review batch in place: re-check every still-pending suggestion
   * against the live document (dropping ones the user already tagged by hand,
   * or that would now violate the schema — e.g. landed inside a `<date>`),
   * and pull in any freshly available person-wrapper / noble-title candidates
   * now that more components are tagged.
   */
  async refreshReviewBatch(
    suggestions: Suggestion[],
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
    userRules: UserRule[] = [],
  ): Promise<{ suggestions: Suggestion[]; staleCount: number; wrapperMatchCount: number }> {
    const doc = await this.getDocument();
    const { staleCount } = revalidatePendingSuggestions(
      doc,
      suggestions,
      this.buildApplyOptions(userRules),
    );
    const wrapperBatch = await this.runPersonWrapperConcatenation(readPackFile);
    const merged = prepareSuggestionsForReview(doc, this.policy, [
      ...suggestions,
      ...wrapperBatch.suggestions,
    ]).suggestions;
    return { suggestions: merged, staleCount, wrapperMatchCount: wrapperBatch.matchCount };
  }

  private buildApplyOptions(
    userRules: UserRule[] = [],
    onProgress?: ApplyProgressCallback,
  ): ApplyOptions {
    const schemaManager = this.writer.schemaManager;
    return {
      policy: this.policy,
      ...(schemaManager
        ? {
            canContain: (parent: string, child: string) =>
              canContainForAutoTagging(schemaManager, parent, child),
          }
        : {}),
      userRules,
      onProgress,
    };
  }

  /**
   * Unified "Tag bomb": pools NDJSON authority packs, PEDB/CEDB (read live
   * from entities.xml), this project's already-tagged mentions (disambiguated
   * and not), and any imported CSV/TSV/xlsx/ODS lists into one run. The date
   * filter applies only to sources with real dates (packs, PEDB, CEDB) — project
   * tags and imported-list entries have none and pass through unfiltered.
   */
  async runTagBomb(
    packIds: AuthorityPackId[],
    readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
    options: TagBombOptions = {},
  ): Promise<TagBombResult> {
    const scope = options.scope ?? 'currentFile';
    const { documents: scopeDocs, error } = await this.resolveTagBombScopeDocuments(
      scope,
      options.customPath,
    );
    if (error) throw new Error(error);
    if (scopeDocs.length === 0) throw new Error('No documents matched the selected scope.');

    const sourceLang = await this.projectLanguage();
    const authoritySettings = readPersistedAuthoritySettings();
    const nameTypePolicy = nameTypeTaggingPolicyFromSettings(authoritySettings, sourceLang);
    const useProjectionMatcher = matchAcrossLineBreaksFromSettings(authoritySettings);
    const dictionaryMatch = (doc: Document, entries: DictionaryEntry[], sourceDetail: string) =>
      useProjectionMatcher
        ? dictionaryTagProjection(doc, entries, this.policy, sourceDetail)
        : dictionaryTag(doc, entries, this.policy, sourceDetail);

    const pedbIds = packIds.filter((id) => this.specOrigin(id) === 'pedb');
    const cedbIds = packIds.filter((id) => this.specOrigin(id) === 'cedb');
    const projectIds = packIds.filter((id) => this.specOrigin(id) === 'project');
    const listIds = packIds.filter((id) => this.specOrigin(id) === 'list');

    const extraCandidates: {
      groupLabel: string;
      candidates: ReturnType<typeof candidatesFromEntityDatabaseRecords>;
    }[] = [];
    if (pedbIds.length > 0 && this.store) {
      for (const id of pedbIds) {
        const kind = OWN_DATABASE_KIND_BY_PACK_ID[id];
        if (!kind) continue;
        const records = await this.store.sqliteCandidateRecords(kind);
        if (records == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
        extraCandidates.push({
          groupLabel: id,
          candidates: candidatesFromEntityDatabaseRecords(
            records as EntityDatabaseCandidateRecord[],
            'PEDB',
            nameTypePolicy,
          ),
        });
      }
    }
    if (cedbIds.length > 0) {
      const centralStore = centralEntityStoreFromDesktop(null);
      if (centralStore) {
        for (const id of cedbIds) {
          const kind = OWN_DATABASE_KIND_BY_PACK_ID[id];
          if (!kind) continue;
          const records = await centralStore.sqliteCandidateRecords(kind);
          if (records == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
          extraCandidates.push({
            groupLabel: id,
            candidates: candidatesFromEntityDatabaseRecords(
              records as EntityDatabaseCandidateRecord[],
              'CEDB',
              nameTypePolicy,
            ),
          });
        }
      }
    }

    // Project-tag dictionary is pooled across the whole project regardless of
    // scope — computed once and reused for every scanned document.
    let pooledProjectEntries: DictionaryEntry[] = [];
    if (projectIds.length > 0) {
      const crawlTags = [...new Set(projectIds.flatMap((id) => this.crawlTagsFor(id)))];
      if (crawlTags.length > 0) {
        const { documents } = await this.getProjectDocuments();
        pooledProjectEntries = crawlDocuments(documents, this.policy, crawlTags);
      }
    }

    const multiDoc = scopeDocs.length > 1;
    const byDocument: TagBombDocumentResult[] = [];
    let lastCandidateCount = 0;
    let totalMatchCount = 0;
    let lastLoaded: Partial<Record<AuthorityPackId, number>> = {};
    let anyTruncated = false;

    for (const { doc, filePath } of scopeDocs) {
      const authorityResult = await runAuthorityTagBombOnDocument(
        doc,
        packIds,
        readPackFile,
        this.policy,
        {
          dateFilter: options.dateFilter,
          extraCandidates,
          nameTypePolicy,
          useProjectionMatcher,
          onProgress: (message) => {
            options.onProgress?.(multiDoc ? `${filePath}: ${message}` : message);
            void yieldToUi();
          },
        },
      );

      const extraSuggestionGroups: Suggestion[][] = [];
      const loaded: Partial<Record<AuthorityPackId, number>> = { ...authorityResult.loaded };

      if (pooledProjectEntries.length > 0) {
        loaded['project' as AuthorityPackId] =
          (loaded['project' as AuthorityPackId] ?? 0) + pooledProjectEntries.length;
        extraSuggestionGroups.push(dictionaryMatch(doc, pooledProjectEntries, 'this project'));
      }

      if (listIds.length > 0 && (options.importedLists?.length ?? 0) > 0) {
        const listTags = new Set(
          listIds.map((id) => this.defaultTagFor(id)).filter((tag): tag is string => !!tag),
        );
        for (const file of options.importedLists ?? []) {
          const filtered = file.entries.filter((entry) => listTags.has(entry.tag));
          if (filtered.length === 0) continue;
          loaded['list' as AuthorityPackId] =
            (loaded['list' as AuthorityPackId] ?? 0) + filtered.length;
          extraSuggestionGroups.push(dictionaryMatch(doc, filtered, file.name));
        }
      }

      const merged = [authorityResult.suggestions, ...extraSuggestionGroups].flat();
      const { suggestions: deduped } = prepareSuggestionsForReview(doc, this.policy, merged);
      const truncated = authorityResult.truncated || deduped.length > MAX_AUTHORITY_SUGGESTIONS;
      const suggestions = deduped.slice(0, MAX_AUTHORITY_SUGGESTIONS);

      lastCandidateCount = authorityResult.candidateCount;
      lastLoaded = loaded;
      totalMatchCount += authorityResult.matchCount;
      anyTruncated = anyTruncated || truncated;

      if (!multiDoc || suggestions.length > 0) {
        byDocument.push({ filePath, suggestions, matchCount: authorityResult.matchCount });
      }
    }

    return {
      suggestions: byDocument[0]?.suggestions ?? [],
      candidateCount: lastCandidateCount,
      matchCount: totalMatchCount,
      loaded: lastLoaded,
      truncated: anyTruncated,
      ...(multiDoc ? { byDocument } : {}),
    };
  }

  /**
   * Phase-2 short-form pass: seed from keyed people in the active document,
   * match their phase-2 typed names (min length 1), always send hits to review.
   */
  async runShortFormTag(options?: { startFromFirstAppearance?: boolean }): Promise<{
    suggestions: Suggestion[];
    keyedEntityCount: number;
    stringCount: number;
    notice?: string;
  }> {
    if (!this.store || !(await this.store.hasSqliteDatabase())) {
      throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
    }

    const doc = await this.getDocument();
    const floors = keyedPersNameFloors(doc, this.policy);
    const keyedEntityCount = floors.size;

    if (keyedEntityCount === 0) {
      return {
        suggestions: [],
        keyedEntityCount: 0,
        stringCount: 0,
        notice:
          'No keyed person names in this document. Tag and link people first (tag bomb or manual), then run short-form tagging.',
      };
    }

    const entitiesById = new Map<string, ReturnType<typeof entitySummaryFromSqlite>>();
    for (const entityId of floors.keys()) {
      const snapshot = await this.store.sqliteEntitySummary(entityId);
      if (!snapshot) continue;
      const entity = entitySummaryFromSqlite(
        snapshot as Parameters<typeof entitySummaryFromSqlite>[0],
      );
      if (entity.kind === 'person') entitiesById.set(entityId, entity);
    }

    const sourceLang = await this.projectLanguage();
    const nameTypePolicy = nameTypeTaggingPolicyFromSettings(
      readPersistedAuthoritySettings(),
      sourceLang,
    );

    let stringCount = 0;
    for (const entityId of floors.keys()) {
      const entity = entitiesById.get(entityId);
      if (entity) stringCount += phase2StringsForEntity(entity, nameTypePolicy).length;
    }

    if (stringCount === 0) {
      return {
        suggestions: [],
        keyedEntityCount,
        stringCount: 0,
        notice:
          'The keyed people in this document have no phase-2 name strings in your entity database (courtesy / given names, short 號, etc.). Add typed names on those entities or run authority backfill when available.',
      };
    }

    const suggestions = shortFormTag(doc, entitiesById, floors, {
      policy: nameTypePolicy,
      whitespacePolicy: this.policy,
      startFromFirstAppearance: options?.startFromFirstAppearance,
    });

    if (suggestions.length === 0) {
      return {
        suggestions: [],
        keyedEntityCount,
        stringCount,
        notice:
          'No untagged short-form matches in this document (or every match falls before the first keyed appearance when that option is on).',
      };
    }

    return { suggestions, keyedEntityCount, stringCount };
  }

  private specOrigin(id: AuthorityPackId): ReturnType<typeof authorityPackOrigin> | undefined {
    const spec = AUTHORITY_PACKS.find((p) => p.id === id);
    return spec ? authorityPackOrigin(spec) : undefined;
  }

  /** Broader TEI tag synonyms to crawl for a `project-*` pack id's category. */
  private crawlTagsFor(id: AuthorityPackId): string[] {
    const tag = this.defaultTagFor(id);
    return tag ? (CRAWL_TAGS_BY_DEFAULT_TAG[tag] ?? [tag]) : [];
  }

  private defaultTagFor(id: AuthorityPackId): string | undefined {
    return AUTHORITY_PACKS.find((p) => p.id === id)?.defaultTag;
  }

  async runEastAsianDateTag(
    batchTag: SanmiaoBatchTagFn,
    options: DateTagOptions = {},
  ): Promise<{ suggestions: Suggestion[]; proposalCount: number }> {
    const { dateTagOnlyFromSanmiao } = await import('./dates');
    const doc = await this.getDocument();
    const suggestions = await dateTagOnlyFromSanmiao(doc, this.policy, batchTag, options);
    return { suggestions, proposalCount: suggestions.length };
  }

  async runEastAsianDateResolve(
    batchResolve: SanmiaoBatchResolveFn,
    options: DateTagOptions = {},
  ): Promise<{ suggestions: Suggestion[]; proposalCount: number }> {
    const { dateResolveFromDocument } = await import('./dates');
    const doc = await this.getDocument();
    const suggestions = await dateResolveFromDocument(doc, this.policy, batchResolve, options);
    return { suggestions, proposalCount: suggestions.length };
  }

  /** @deprecated Use {@link runEastAsianDateTag}. */
  async runEastAsianDates(
    batchTag: SanmiaoBatchTagFn,
    options: DateTagOptions = {},
  ): Promise<{ suggestions: Suggestion[]; proposalCount: number }> {
    return this.runEastAsianDateTag(batchTag, options);
  }

  /**
   * Record a review-walk decision for the decision log. Wire this to
   * `ReviewController.onDecision` (or ReviewPanel's `onDecision` prop).
   */
  logDecision(event: DecisionEvent): void {
    this.decisions.add(event);
  }

  get pendingDecisionCount(): number {
    return this.decisions.length;
  }

  /**
   * Flush buffered decisions to `/.grognard/entity-decisions.jsonl`. No-op (but
   * still clears the buffer) in the web app where no project store exists.
   * Returns the number of records written.
   */
  async flushDecisions(): Promise<number> {
    const records = this.decisions.pending;
    if (records.length === 0) return 0;
    if (this.store) await this.store.appendDecisions(records);
    this.decisions.flush(); // clear the buffer regardless
    return records.length;
  }

  /** Current document as a normalized XML DOM — the input for producers. */
  async getDocument(): Promise<Document> {
    const xml = await resolveCurrentDocumentXml(this.writer);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    normalizeDomText(doc);
    return doc;
  }

  /**
   * The current document plus every XML file in the project (desktop only),
   * for project-wide crawl. In the web app, or with no project open, returns
   * just the current document with `available: false`. Unreadable or malformed
   * files are skipped.
   */
  async getProjectDocuments(): Promise<ProjectDocuments> {
    const current = await this.getDocument();

    const globals = window as unknown as {
      electronAPI?: Partial<DesktopProjectApi>;
      __ljbLspProject?: { projectRoot?: string };
      writer?: { overmindState?: { editor?: { resource?: { filePath?: string } } } };
    };
    const api = globals.electronAPI;
    const root = globals.__ljbLspProject?.projectRoot;
    if (!api?.listProjectXmlFiles || !api.readFile || !root) {
      return { documents: [current], available: false };
    }

    const activePath = globals.writer?.overmindState?.editor?.resource?.filePath;
    this.documentPaths.set(current, activePath ?? 'current');
    const documents = await this.readXmlFilesUnder(root, activePath ?? '', current);
    return { documents, available: true };
  }

  /** `current` plus every readable, parseable XML file under `root` (skipping `activePath`). */
  private async readXmlFilesUnder(
    root: string,
    activePath: string,
    current: Document,
  ): Promise<Document[]> {
    const globals = window as unknown as { electronAPI?: Partial<DesktopProjectApi> };
    const api = globals.electronAPI;
    const documents = [current];
    if (!api?.listProjectXmlFiles || !api.readFile) return documents;

    const files = await api.listProjectXmlFiles(root);
    for (const file of files) {
      if (activePath && samePath(file.path, activePath)) continue;
      try {
        const xml = await api.readFile(file.path);
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) continue;
        normalizeDomText(doc);
        documents.push(doc);
        this.documentPaths.set(doc, file.path);
      } catch {
        // skip files that can't be read or parsed
      }
    }
    return documents;
  }

  /**
   * Resolve the document set for a tag bomb `scope`. `currentFile` is the
   * legacy single-document behavior; the others gather documents from open
   * tabs, the whole project, or an arbitrary folder (desktop only).
   */
  async resolveTagBombScopeDocuments(
    scope: TagBombScope,
    customPath?: string,
  ): Promise<{ documents: TagBombScopeDocument[]; error?: string }> {
    const current = await this.getDocument();
    const globals = window as unknown as {
      writer?: { overmindState?: { editor?: { resource?: { filePath?: string } } } };
      __ljbLspProject?: { projectRoot?: string };
      __leafWriterProject?: {
        getOpenTabs?: () => { filePath: string; content: string }[];
      };
    };
    const activePath = globals.writer?.overmindState?.editor?.resource?.filePath ?? 'current';
    this.documentPaths.set(current, activePath);

    if (scope === 'currentFile') {
      return { documents: [{ doc: current, filePath: activePath }] };
    }

    if (scope === 'openTabs') {
      const tabs = globals.__leafWriterProject?.getOpenTabs?.() ?? [];
      if (tabs.length === 0) return { documents: [], error: 'No files are open.' };

      const documents: TagBombScopeDocument[] = [];
      for (const tab of tabs) {
        if (samePath(tab.filePath, activePath)) {
          documents.push({ doc: current, filePath: activePath });
          continue;
        }
        try {
          const doc = new DOMParser().parseFromString(tab.content, 'application/xml');
          if (doc.getElementsByTagName('parsererror').length > 0) continue;
          normalizeDomText(doc);
          this.documentPaths.set(doc, tab.filePath);
          documents.push({ doc, filePath: tab.filePath });
        } catch {
          // skip files that can't be parsed
        }
      }
      return { documents };
    }

    if (scope === 'project') {
      const root = globals.__ljbLspProject?.projectRoot;
      if (!root) return { documents: [], error: 'Open a project folder first.' };
      const documents = await this.readXmlFilesUnder(root, activePath, current);
      return {
        documents: documents.map((doc) => ({
          doc,
          filePath: this.documentPaths.get(doc) ?? activePath,
        })),
      };
    }

    const folder = customPath?.trim();
    if (!folder) return { documents: [], error: 'Enter a folder path.' };
    let documents = await this.readXmlFilesUnder(folder, activePath, current);
    const normalizedFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const activeInFolder =
      activePath !== 'current' &&
      (samePath(activePath, folder) ||
        activePath.replace(/\\/g, '/').toLowerCase().startsWith(`${normalizedFolder}/`));
    if (!activeInFolder)
      documents = documents.filter((doc) => this.documentPaths.get(doc) !== activePath);
    return {
      documents: documents.map((doc) => ({
        doc,
        filePath: this.documentPaths.get(doc) ?? activePath,
      })),
    };
  }

  async loadEntities(): Promise<Document> {
    if (!this.store) throw new Error('No entity store available');
    this.entitiesDoc = await this.store.loadEntities();
    const pending = await this.store.readDisambiguationPending();
    this.pendingCache = parsePendingCache(pending);
    return this.entitiesDoc;
  }

  async savePendingCache(): Promise<void> {
    if (!this.store) return;
    await this.store.writeDisambiguationPending(serializePendingCache(this.pendingCache));
  }

  getEntitiesDocument(): Document | null {
    return this.entitiesDoc;
  }

  getPendingCandidates(tag: string, surface: string): DisambiguationCandidate[] | null {
    return this.pendingCache.entries[`${tag}\0${surface}`]?.candidates ?? null;
  }

  rememberPendingCandidates(
    tag: string,
    surface: string,
    candidates: DisambiguationCandidate[],
  ): void {
    this.pendingCache = setPendingCandidates(this.pendingCache, tag, surface, candidates);
  }

  /** Scan corpus XML for mentions needing disambiguation (current document by default). */
  async scanMentions(
    options: {
      includeResolved?: boolean;
      /** `current` = open editor file only; `project` = every project XML file. */
      scope?: 'current' | 'project';
      onProgress?: (done: number, total: number) => void;
    } = {},
  ): Promise<MentionGroup[]> {
    const scope = options.scope ?? 'current';

    if (scope === 'current') {
      options.onProgress?.(0, 1);
      const doc = await this.getDocument();
      const globals = window as unknown as {
        writer?: { overmindState?: { editor?: { resource?: { filePath?: string } } } };
      };
      const documentId = globals.writer?.overmindState?.editor?.resource?.filePath ?? 'current';
      this.documentPaths.set(doc, documentId);
      let groups = collectMentions(doc, this.policy, documentId, options);
      if (this.store && (await this.store.hasSqliteDatabase())) {
        const findLocalIds = async (surface: string): Promise<string[]> => {
          const candidates = await loadSqliteDisambiguationCandidates(
            this.store!,
            'persName',
            surface,
            'pedb',
          );
          if (candidates == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
          return [
            ...new Set(
              candidates
                .map((candidate) => candidate.localEntityId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
        };
        let changed = await reconcilePersonWrapperKeys(
          doc,
          findLocalIds,
          async (entityId) => (await this.store!.sqliteEntitySummary(entityId)) != null,
        );
        if (await autoResolveNobleTitlesInDocument(this.store, doc)) changed = true;
        if (changed) {
          await this.persistDocument(doc);
          groups = collectMentions(doc, this.policy, documentId, options);
        }
        await refreshExtractedEntityDataForDocumentSqlite(
          this.store,
          doc,
          documentId,
          (wrapper, key) => extractRegisteredEntityData({ wrapper, documentKey: key }),
        );
      }
      options.onProgress?.(1, 1);
      return groups;
    }

    const { documents } = await this.getProjectDocuments();
    const total = documents.length;
    const groups: MentionGroup[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      options.onProgress?.(i, total);
      const documentId = this.documentPaths.get(doc) ?? `doc-${i}`;
      let documentGroups = collectMentions(doc, this.policy, documentId, options);
      if (this.store && (await this.store.hasSqliteDatabase())) {
        const findLocalIds = async (surface: string): Promise<string[]> => {
          const candidates = await loadSqliteDisambiguationCandidates(
            this.store!,
            'persName',
            surface,
            'pedb',
          );
          if (candidates == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
          return [
            ...new Set(
              candidates
                .map((candidate) => candidate.localEntityId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
        };
        let changed = await reconcilePersonWrapperKeys(
          doc,
          findLocalIds,
          async (entityId) => (await this.store!.sqliteEntitySummary(entityId)) != null,
        );
        if (await autoResolveNobleTitlesInDocument(this.store, doc)) changed = true;
        if (changed) {
          await this.persistDocument(doc);
          documentGroups = collectMentions(doc, this.policy, documentId, options);
        }
        await refreshExtractedEntityDataForDocumentSqlite(
          this.store,
          doc,
          documentId,
          (wrapper, key) => extractRegisteredEntityData({ wrapper, documentKey: key }),
        );
      }
      groups.push(...documentGroups);
      if (i < documents.length - 1) await yieldToUi();
    }

    options.onProgress?.(total, total);
    return mergeMentionGroups(groups);
  }

  /**
   * loadDocumentXML clears dirty state via documentLoaded. Restore unsaved
   * tracking and in-memory tab content so close/switch keeps applied edits.
   */
  private syncUnsavedStateAfterReload(editorXml: string): void {
    const merge = window.__desktopMergeEditorBodyWithStoredHeader;
    const contentForStorage = typeof merge === 'function' ? merge(editorXml) : editorXml;

    const filePath =
      this.writer.overmindState?.editor?.resource?.filePath ??
      this.writer.overmindState?.document?.url;

    // Always refresh the desktop stored snapshot first so any concurrent
    // header-merge / validation path sees the tagged body, not the pre-apply
    // document that caused apply to "flash then revert".
    if (window.electronAPI) {
      window.__desktopStoredDocumentXml = contentForStorage;
    }
    this.writer.overmindActions?.document?.setDocumentXml?.(contentForStorage);

    if (filePath) {
      this.writer.overmindActions?.project?.updateTabContent?.({
        filePath,
        content: contentForStorage,
      });
    }

    this.writer.overmindActions?.project?.markTabDirty?.(true);
    this.writer.overmindActions?.editor?.setContentHasChanged?.(true);
    if (this.writer.editor) this.writer.editor.isNotDirty = false;
  }

  private invalidateFocusIndex(): void {
    this.focusIndex = null;
  }

  private async persistDocument(doc: Document): Promise<void> {
    const xml = new XMLSerializer().serializeToString(doc);
    const path = this.documentPaths.get(doc);
    const globals = window as unknown as {
      electronAPI?: { writeFile: (filePath: string, content: string) => Promise<void> };
      writer?: { overmindState?: { editor?: { resource?: { filePath?: string } } } };
    };
    const activePath = globals.writer?.overmindState?.editor?.resource?.filePath;

    if (!path || path === 'current' || (activePath && samePath(path, activePath))) {
      this.invalidateFocusIndex();
      this.writer.loadDocumentXML(xml);
      this.syncUnsavedStateAfterReload(xml);
      // The editor's own tag/attribute definitions aren't necessarily settled
      // immediately after a reload (worse if a modal briefly stole DOM focus,
      // e.g. a confirmation dialog) — give it a couple of frames before asking
      // it to re-derive XML for validation, and don't let a validate failure
      // surface as an unhandled rejection since persistence already succeeded.
      await yieldToUi();
      try {
        await this.writer.validate?.();
      } catch {
        // best-effort — validation feedback only, not required for persistence
      }
      return;
    }

    if (globals.electronAPI?.writeFile) {
      await globals.electronAPI.writeFile(path, xml);
    }
  }

  /** Apply a text-preserving tag transform to the selected document scope. */
  async runTagTransform(options: Partial<TagTransformOptions> = {}): Promise<TagTransformResult> {
    const scope = options.scope ?? 'currentFile';
    const { documents, error } = await this.resolveTagBombScopeDocuments(scope, options.customPath);
    if (error) throw new Error(error);
    if (documents.length === 0) throw new Error('No documents matched the selected scope.');

    const changed: { filePath: string; xml: string; doc: Document; matches: number }[] = [];
    let matches = 0;
    const schemaManager = this.writer.schemaManager;
    const transformOptions: TagTransformOptions = {
      string: options.string ?? '',
      tagName: options.tagName ?? '*',
      ...options,
      canInsertTag: schemaManager?.isTagValidChildOfParent
        ? (tagName, parentName) => schemaManager.isTagValidChildOfParent(tagName, parentName)
        : options.canInsertTag,
    };
    for (const entry of documents) {
      const count = applyPurge(entry.doc, transformOptions);
      if (count === 0) continue;
      const xml = new XMLSerializer().serializeToString(entry.doc);
      const wellFormed = checkWellFormedness(xml);
      if (!wellFormed.valid) throw new Error(`Transform would make ${entry.filePath} invalid XML.`);
      changed.push({ ...entry, xml, matches: count });
      matches += count;
    }
    if (changed.length === 0) return { filesChanged: 0, matches: 0 };

    if (
      options.validateOtherFiles &&
      changed.some(({ filePath }) => !this.isActiveFile(filePath))
    ) {
      for (const item of changed) {
        if (this.isActiveFile(item.filePath)) continue;
        const valid = await this.validateXmlAgainstCurrentSchema(item.xml);
        if (!valid)
          throw new Error(
            `Transform was not committed because ${item.filePath} failed validation.`,
          );
      }
    }

    const api = (
      window as unknown as {
        electronAPI?: { writeFile?: (path: string, content: string) => Promise<void> };
      }
    ).electronAPI;
    for (const item of changed) {
      if (this.isActiveFile(item.filePath)) {
        this.invalidateFocusIndex();
        this.writer.loadDocumentXML(item.xml);
        this.syncUnsavedStateAfterReload(item.xml);
      } else if (api?.writeFile) {
        await api.writeFile(item.filePath, item.xml);
        await (
          window as unknown as {
            __leafWriterProject?: { reloadFileFromDisk?: (path: string) => Promise<void> };
          }
        ).__leafWriterProject?.reloadFileFromDisk?.(item.filePath);
      } else {
        throw new Error('File access is not available.');
      }
    }
    return { filesChanged: changed.length, matches };
  }

  private isActiveFile(filePath: string): boolean {
    const active =
      this.writer.overmindState?.editor?.resource?.filePath ??
      this.writer.overmindState?.document?.url;
    return !active || filePath === 'current' || samePath(active, filePath);
  }

  private async validateXmlAgainstCurrentSchema(xml: string): Promise<boolean> {
    if (!checkWellFormedness(xml).valid) return false;
    const validator = (
      window as unknown as {
        leafwriterValidator?: { validate: (value: string, callback: unknown) => Promise<void> };
      }
    ).leafwriterValidator;
    if (!validator) return false;
    return new Promise<boolean>((resolve) => {
      void validator
        .validate(
          xml,
          Comlink.proxy((result: { valid?: boolean; state?: { valueOf: () => number } }) => {
            if (result.state && result.state.valueOf() <= 2) return;
            resolve(result.valid === true);
          }),
        )
        .catch(() => resolve(false));
    });
  }

  private logResolution(
    instance: MentionInstance,
    action: DecisionRecord['action'],
    entityId?: string,
    rejectedCandidate?: string,
  ): void {
    this.decisions.addRecord({
      when: new Date().toISOString(),
      documentId: instance.documentId,
      surface: instance.surface,
      tag: instance.tag,
      action,
      source: 'disambiguation',
      entityId,
      rejectedCandidate,
      scope: 'occurrence',
      occurrence: instance.anchor.occurrence,
      nodeHash: instance.anchor.nodeHash,
    });
  }

  async resolveMention(
    instance: MentionInstance,
    candidate: DisambiguationCandidate,
    options: {
      createNew?: boolean;
      name?: string;
      kind?: EntityKind;
      description?: string;
      romanizedName?: string;
    } = {},
  ): Promise<string> {
    if (!this.store) throw new Error('No entity store available');
    const kind = options.kind ?? (instance.tag === 'name' ? 'person' : TAG_TO_KIND[instance.tag]);
    if (!kind) throw new Error(`Unsupported tag: ${instance.tag}`);

    // A candidate picked from the central database (syncToCentral merged
    // search) needs a project mirror minted/linked before it can be treated
    // as an ordinary local match.
    if (candidate.centralEntityId) {
      const central = await this.centralContext();
      if (central) {
        candidate = await resolveCandidateForPedb(
          candidate,
          this.store,
          central.store,
          central.userStableId,
        );
      }
    }

    const projectLang = await this.projectLanguage();
    const wrapperPerson = instance.tag === 'name' ? wrapperPersonName(instance.element) : null;
    const name = options.name ?? wrapperPerson?.textContent?.trim() ?? instance.surface;
    const projectLangName = options.createNew ? undefined : candidate.projectLangName;
    const typedNames = await collectTypedNamesForCandidate(candidate);
    const titleParts = nobleTitlesFromMetadata(candidate.authorityMetadata);
    const headword = projectLangName ?? name;
    // Prefer pack personal primary / 姓+名 over a display-only title headword.
    const mintName =
      kind === 'person'
        ? preferredEntityPrimaryName(headword, typedNames ?? [])
        : headword.normalize('NFC').trim();
    // 姓/名 splits are person-only — never invent them for offices, places, etc.
    let familyName: string | undefined;
    let givenName: string | undefined;
    let romanizedName = options.romanizedName ?? candidate.romanizedName ?? undefined;
    if (kind === 'person') {
      const authorityGivenFamilyNames = await collectGivenFamilyNamesForCandidate(
        candidate,
        projectLang,
      );
      const nameForSplit = personalNameForSegmentation(headword, typedNames ?? [], titleParts);
      const preferredFromPack = preferCanonicalFamilyGiven(nameForSplit, typedNames);
      const needsPluginSplit =
        Boolean(nameForSplit) &&
        (!(authorityGivenFamilyNames.familyName || preferredFromPack.familyName) ||
          !(authorityGivenFamilyNames.givenName || preferredFromPack.givenName));
      const pluginSplit = needsPluginSplit
        ? suggestPersonNameSplit(nameForSplit!, projectLang)
        : null;
      familyName =
        authorityGivenFamilyNames.familyName ??
        preferredFromPack.familyName ??
        pluginSplit?.familyName;
      givenName =
        authorityGivenFamilyNames.givenName ??
        preferredFromPack.givenName ??
        pluginSplit?.givenName;
      if (!romanizedName && nameForSplit) {
        romanizedName =
          (pluginSplit ? suggestPersonRomanization(nameForSplit, projectLang) : null) ??
          autoRomanizeForKind(nameForSplit, projectLang, kind) ??
          undefined;
      }
    } else if (!romanizedName) {
      romanizedName = autoRomanizeForKind(mintName, projectLang, kind) ?? undefined;
    }

    const metaBioYears = candidate.authorityMetadata
      ? biographicalYearsFromMetadata(candidate.authorityMetadata)
      : {};
    const metaFloruitYears = candidate.authorityMetadata
      ? floruitYearsFromMetadata(candidate.authorityMetadata)
      : {};
    // authorityMetadata may carry only ancillary data (e.g. nationality) with no
    // date fields of its own — fall back to the candidate's own startYear/endYear
    // rather than treating "meta present" as "meta is authoritative for dates".
    const hasMetaYears =
      metaBioYears.startYear != null ||
      metaBioYears.endYear != null ||
      metaFloruitYears.startYear != null ||
      metaFloruitYears.endYear != null;
    const fallbackYears =
      isFilterOnlyDateSource(candidate.dateSource) || candidate.dateSource === 'floruit'
        ? {}
        : {
            ...(candidate.startYear != null ? { startYear: candidate.startYear } : {}),
            ...(candidate.endYear != null ? { endYear: candidate.endYear } : {}),
          };
    const fallbackFloruitYears =
      candidate.dateSource === 'floruit'
        ? {
            ...(candidate.startYear != null ? { startYear: candidate.startYear } : {}),
            ...(candidate.endYear != null ? { endYear: candidate.endYear } : {}),
          }
        : {};
    const bioYears = hasMetaYears ? metaBioYears : fallbackYears;
    const floruitYears = hasMetaYears ? metaFloruitYears : fallbackFloruitYears;
    const asFloruit = Boolean(floruitYears.startYear != null || floruitYears.endYear != null);
    const mintDescription =
      candidate.dateSource === 'index'
        ? scrubIndexYearFloruitClue(options.description ?? candidate.description)
        : (options.description ?? candidate.description);
    const authorityAssertions =
      toAuthoritySourcedFields(candidate.authorityAssertions) ??
      (asFloruit || bioYears.startYear != null || bioYears.endYear != null
        ? toAuthoritySourcedFields([candidate])
        : undefined);

    const { id: entityId } = await mintOrLinkEntitySqlite(this.store, {
      kind,
      name: mintName,
      nameLang: projectLang ?? undefined,
      romanizedName,
      familyName,
      givenName,
      authorityIds: candidate.authorityIds,
      authoritySource: candidate.authorityIds?.[0]
        ? `${candidate.authorityIds[0].type}:${candidate.authorityIds[0].value}`
        : undefined,
      description: mintDescription,
      startYear: asFloruit ? floruitYears.startYear : bioYears.startYear,
      endYear: asFloruit ? floruitYears.endYear : bioYears.endYear,
      asFloruit: asFloruit || undefined,
      origin: candidate.authorityMetadata?.origin,
      authorityAssertions,
      localEntityId: options.createNew ? undefined : candidate.localEntityId,
      geo: kind === 'place' ? candidate.geo : undefined,
    });
    // Keep display-only title headwords as searchable variants when we minted
    // a reconstructed personal name instead.
    if (headword && mintName !== headword.normalize('NFC').trim()) {
      await this.store.sqliteAddName({
        entityId,
        text: headword,
        nameType: 'variant',
        language: projectLang ?? undefined,
        origin: 'authority',
        source: candidate.authorityIds?.[0]?.type,
      });
    }
    for (const typed of typedNames ?? []) {
      await this.store.sqliteAddName({
        entityId,
        text: typed.text,
        nameType: typed.type,
        language: typed.lang,
        origin: 'authority',
        source: candidate.authorityIds?.[0]?.type,
      });
    }
    // Persist pack / Huckbot / MaxiRicci glosses onto office entities so the
    // Database Window and AI placeholders see them via entity_translations.
    if (kind === 'office') {
      await persistOfficeTranslationNames(this.store, entityId, {
        translation: candidate.authorityMetadata?.translation,
        translationFr: candidate.authorityMetadata?.translationFr,
        enSource:
          candidate.authorityMetadata?.translationSource ??
          candidate.authorityIds?.[0]?.type ??
          'Huckbot5000',
        frSource: candidate.authorityMetadata?.translationFrSource ?? 'MaxiRicci7000',
        primaryName: mintName,
      });
    }

    assignEntity({ element: instance.element, entityId });
    if (wrapperPerson) assignEntity({ element: wrapperPerson, entityId });
    if (instance.tag === 'name' && instance.element.getAttribute('type') === 'personWrapper') {
      const documentKey = instance.documentId;
      const wrappers = Array.from(
        instance.element.ownerDocument!.getElementsByTagName('name'),
      ).filter((candidate) => candidate.getAttribute('type') === 'personWrapper');
      const source = personWrapperSource(documentKey, wrappers.indexOf(instance.element) + 1);
      const assertions = extractRegisteredEntityData({
        wrapper: instance.element,
        documentKey,
      });
      if (assertions.length > 0) {
        await ingestExtractedEntityDataSqlite(
          this.store,
          documentKey,
          entityId,
          source,
          assertions,
        );
      }
    }
    if (instance.tag === 'persName') {
      tagFollowingStyleNames(instance.element.ownerDocument!);
    }
    // Wikidata work/person side-mint stays on backfill for SQLite-first installs.
    if (kind === 'work' || kind === 'person') {
      const wikidata = candidate.authorityIds?.find(
        (authority) => authority.type.trim().toUpperCase() === 'WIKIDATA',
      );
      if (wikidata && window.electronAPI?.entitySqliteApplyAuthorityBackfillPatch) {
        await backfillEntitiesSqlite(this.store, {
          entityIds: [entityId],
          projectLang,
          desktopLanguage: this.desktopLanguage(),
          expandWikidataWorks: kind === 'person',
          lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
        }).catch(() => undefined);
      }
    }
    await autoSyncEntityToCentral(null, entityId);
    await this.persistDocument(instance.element.ownerDocument!);
    this.logResolution(instance, 'resolved', entityId);
    return entityId;
  }

  async resolveMentions(
    instances: MentionInstance[],
    candidate: DisambiguationCandidate,
  ): Promise<string> {
    if (instances.length === 0) throw new Error('No mentions to resolve');
    const first = instances[0]!;
    const entityId = await this.resolveMention(first, candidate);
    for (const instance of instances.slice(1)) {
      assignEntity({ element: instance.element, entityId });
      await this.persistDocument(instance.element.ownerDocument!);
      this.logResolution(instance, 'resolved', entityId);
    }
    return entityId;
  }

  async markUnresolved(
    instance: MentionInstance,
    candidates: DisambiguationCandidate[],
  ): Promise<void> {
    markMentionUnresolved(instance.element);
    this.rememberPendingCandidates(instance.tag, instance.surface, candidates);
    await this.savePendingCache();
    await this.persistDocument(instance.element.ownerDocument!);
    this.logResolution(instance, 'unresolved');
  }

  /** Remove @key from a resolved mention so it can be disambiguated again. */
  async clearMentionResolution(instance: MentionInstance): Promise<void> {
    markMentionUnresolved(instance.element);
    await this.persistDocument(instance.element.ownerDocument!);
    this.logResolution(instance, 'unresolved');
  }

  async clearMentionResolutions(instances: MentionInstance[]): Promise<void> {
    if (instances.length === 0) return;
    for (const instance of instances) markMentionUnresolved(instance.element);
    const docs = new Set(instances.map((item) => item.element.ownerDocument!));
    for (const doc of docs) await this.persistDocument(doc);
    for (const instance of instances) this.logResolution(instance, 'unresolved');
  }

  /** This project's own harvested wrapper facts, cached until the next `appendWrapperFacts`. */
  private async loadProjectWrapperFactsIndex(): Promise<WrapperDisambiguationIndex | null> {
    if (!this.store) return null;
    try {
      this.projectWrapperFactsIndexPromise ??= (async () =>
        buildWrapperDisambiguationIndexFromFacts(await this.store!.readWrapperFacts()))();
      return await this.projectWrapperFactsIndexPromise;
    } catch {
      this.projectWrapperFactsIndexPromise = null;
      return null;
    }
  }

  /**
   * Auto-key newly applied person wrappers (from `groupWrapperCandidateSuggestions`
   * / `applyWithWrapperCandidates`) whose found combination of dynasty/office/
   * title/origin/name resolves unambiguously — the same "only when unique"
   * caution as `autoResolveNobleTitles`'s strong case. Checks this project's
   * own previously harvested combinations first (`wrapperFactsLog.ts`) —
   * more specific than, and free of any dependency on, the global pack — and
   * only falls back to Norbert's compiled person data when the project
   * hasn't seen this combination before. A fresh Norbert-backed resolution
   * mints or links a local entity (the same path a manually accepted
   * disambiguation candidate uses) and is itself harvested as a new fact, so
   * the next occurrence — this project or later — resolves from project
   * knowledge alone. Either way, the wrapper's own structured content is
   * also intaken into the resolved entity's SQLite record immediately (see
   * `ingestWrapperData` below) — the same step a manually accepted
   * disambiguation candidate triggers, so this doesn't have to wait for the
   * next full-document reconciliation. Best-effort throughout: an
   * already-keyed wrapper (e.g. from a `retag`/manual edit racing this) is
   * left alone, and any missing pack/store dependency just skips auto-keying
   * for that wrapper.
   */
  private async autoKeyWrapperCandidates(results: ApplyResult[]): Promise<void> {
    if (!this.store) return;
    const wrapperElements = results
      .filter(
        (result) =>
          result.outcome === 'applied' &&
          (result.suggestion.compoundMembers?.length ?? 0) > 0 &&
          result.element,
      )
      .map((result) => result.element!);
    if (wrapperElements.length === 0) return;

    const projectIndex = await this.loadProjectWrapperFactsIndex();
    const readPack = cachedPackReader();
    const newFacts: WrapperFactRecord[] = [];
    const documentKey = autoTaggingDocumentKey(this.writer);

    // Immediately intake the wrapper's structured content (nobleTitle,
    // origin, office, nationality) into the resolved entity's own SQLite
    // record — the same step a manually accepted Disambiguate candidate
    // triggers right after keying. Without this, the facts would only reach
    // SQLite on the next full-document reconciliation (scanMentions), not now.
    const ingestWrapperData = async (wrapper: Element, entityId: string): Promise<void> => {
      const occurrence =
        Array.from(wrapper.ownerDocument!.getElementsByTagName('name'))
          .filter((candidate) => candidate.getAttribute('type') === 'personWrapper')
          .indexOf(wrapper) + 1;
      const source = personWrapperSource(documentKey, occurrence);
      const assertions = extractRegisteredEntityData({ wrapper, documentKey });
      if (assertions.length === 0) return;
      try {
        await ingestExtractedEntityDataSqlite(
          this.store!,
          documentKey,
          entityId,
          source,
          assertions,
        );
      } catch (error) {
        console.warn('[auto-tagging] Wrapper data intake failed:', error);
      }
    };

    for (const wrapper of wrapperElements) {
      if (wrapper.getAttribute('key')?.trim()) continue;
      const query = wrapperDisambiguationQueryFromElement(wrapper);
      if (!query) continue;
      const identity = wrapperIdentityElement(wrapper);
      if (!identity) continue;

      const projectMatches = projectIndex?.resolve(query) ?? [];
      if (projectMatches.length === 1) {
        assignEntity({ element: identity, entityId: projectMatches[0]! });
        await ingestWrapperData(wrapper, projectMatches[0]!);
        continue;
      }
      if (projectMatches.length > 1 || !readPack) continue;

      let norbertIndex: WrapperDisambiguationIndex;
      try {
        this.wrapperDisambiguationIndexPromise ??= (async () =>
          wrapperDisambiguationIndexFromPack(await readPack('norbert-persons')))();
        norbertIndex = await this.wrapperDisambiguationIndexPromise;
      } catch {
        continue; // Pack is optional.
      }
      const matches = norbertIndex.resolve(query);
      if (matches.length !== 1) continue;

      try {
        const { id: entityId } = await mintOrLinkEntitySqlite(this.store, {
          kind: 'person',
          name: query.persName,
          authorityIds: [{ type: 'NORBERT', value: matches[0]! }],
          authoritySource: `NORBERT:${matches[0]!}`,
        });
        assignEntity({ element: identity, entityId });
        await ingestWrapperData(wrapper, entityId);
        newFacts.push({ when: new Date().toISOString(), query, entityId });
      } catch (error) {
        console.warn('[auto-tagging] Wrapper auto-key failed:', error);
      }
    }

    if (newFacts.length > 0) {
      try {
        await this.store.appendWrapperFacts(newFacts);
        this.projectWrapperFactsIndexPromise = null;
      } catch (error) {
        console.warn('[auto-tagging] Failed to record wrapper facts:', error);
      }
    }
  }

  /**
   * Apply accepted suggestions to a fresh copy of the XML source and reload
   * the editor. Returns the apply engine's per-suggestion outcomes.
   */
  async apply(
    accepted: Suggestion[],
    userRules: UserRule[] = [],
    onProgress?: ApplyProgressCallback,
  ): Promise<BatchResult> {
    const total = accepted.length;
    onProgress?.(0, total);
    await yieldToUi();

    const doc = await this.getDocument();
    const applyOptions = this.buildApplyOptions(userRules, onProgress);
    const raw = await applyWithWrapperCandidates(doc, accepted, applyOptions);
    const result = withApplyDiagnostics(doc, raw, applyOptions);

    if (result.applied > 0) {
      await this.autoKeyWrapperCandidates(result.results);
      onProgress?.(total, total);
      await yieldToUi();
      this.snapshots.push(result.snapshot);
      const xml = new XMLSerializer().serializeToString(doc);
      this.invalidateFocusIndex();
      this.writer.loadDocumentXML(xml);
      this.syncUnsavedStateAfterReload(xml);
      this.writer.validate?.();
    }
    return result;
  }

  /**
   * Apply suggestions straight to `filePath`, bypassing the review panel
   * ("Skip review"). Reloads the live editor when it's the active document;
   * otherwise re-reads, patches, and writes the file directly, then asks the
   * app shell to refresh a matching open tab if one exists.
   */
  async applyTagBombDocument(
    filePath: string,
    suggestions: Suggestion[],
    userRules: UserRule[] = [],
  ): Promise<BatchResult> {
    const globals = window as unknown as {
      writer?: { overmindState?: { editor?: { resource?: { filePath?: string } } } };
      __leafWriterProject?: { reloadFileFromDisk?: (filePath: string) => Promise<void> };
      electronAPI?: {
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<void>;
      };
    };
    const activePath = globals.writer?.overmindState?.editor?.resource?.filePath;
    // Tag-bomb review of the open file uses the sentinel path "current".
    // That must hit the live editor — never electronAPI.readFile("current").
    if (filePath === 'current' || (activePath && samePath(filePath, activePath))) {
      return this.apply(suggestions, userRules);
    }

    const api = globals.electronAPI;
    if (!api?.readFile || !api.writeFile) {
      throw new Error('File access is not available.');
    }
    const xml = await api.readFile(filePath);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    normalizeDomText(doc);
    const applyOptions = this.buildApplyOptions(userRules);
    const raw = await applySuggestions(doc, suggestions, applyOptions);
    const result = withApplyDiagnostics(doc, raw, applyOptions);
    if (result.applied > 0) {
      const serialized = new XMLSerializer().serializeToString(doc);
      await api.writeFile(filePath, serialized);
      await globals.__leafWriterProject?.reloadFileFromDisk?.(filePath);
    }
    return result;
  }

  get canRevert(): boolean {
    return this.snapshots.length > 0;
  }

  /** Undo the most recent apply by reloading its pre-apply snapshot. */
  revertLastApply(): boolean {
    const snapshot = this.snapshots.pop();
    if (!snapshot) return false;
    this.invalidateFocusIndex();
    this.writer.loadDocumentXML(snapshot);
    this.syncUnsavedStateAfterReload(snapshot);
    return true;
  }

  /**
   * Jump the editor to a suggestion. The editor holds a converted HTML
   * representation, so structural anchor fields don't apply; we locate the
   * surface by document-wide occurrence index in the editor body's text
   * stream (which matches the XML's, since conversion preserves text).
   * Best-effort: returns false when the editor is absent or the text differs.
   */
  focusMention(instance: MentionInstance): boolean {
    return this.focusAnchor(instance.anchor.surface, instance.anchor.occurrence, instance.anchor);
  }

  focus(suggestion: Suggestion): boolean {
    const editor = this.writer.editor;
    if (!editor) return false;

    try {
      const displaySurface =
        suggestion.source === 'dates' && suggestion.dateResolution
          ? (suggestion.dateResolution.displaySurface ?? suggestion.anchor.surface)
          : suggestion.anchor.surface;
      if (this.focusAnchor(displaySurface, suggestion.anchor.occurrence, suggestion.anchor))
        return true;
      return this.focusAnchor(
        suggestion.anchor.surface,
        suggestion.anchor.occurrence,
        suggestion.anchor,
      );
    } catch {
      return false;
    }
  }

  /** Drop the editor's "you are here" marker (panel closed, or applying). */
  clearFocusHighlight(): void {
    clearFocusHighlight(this.writer.editor);
  }

  /**
   * The editor body's search index, rebuilt whenever the editor content has
   * changed under us. The cache used to be keyed on the body element alone,
   * but TinyMCE keeps the same body across reloads and edits: a stale index
   * then pointed at detached text nodes, and every jump silently did nothing.
   */
  private editorDocIndex(body: HTMLElement): DocIndex {
    this.watchEditorContentChanges();
    const cached = this.focusIndex;
    if (cached?.body === body && cached.index.nodes[0]?.node.isConnected) return cached.index;
    const index = buildDocIndex(body, this.policy);
    this.focusIndex = { body, index };
    return index;
  }

  /** Invalidate the focus index on any editor-side content change. */
  private watchEditorContentChanges(): void {
    const editor = this.writer.editor;
    if (this.focusIndexWatcher === editor || !editor?.on) return;
    this.focusIndexWatcher = editor;
    editor.on('SetContent LoadContent input Undo Redo', () => {
      clearFocusHighlight(this.writer.editor);
      this.invalidateFocusIndex();
    });
    // Clicking into the text moves the user's own caret — the panel's marker
    // has served its purpose and would only be stale from here on. The span
    // fallback is left alone: unwrapping it mid-click would move the caret.
    editor.on('mousedown', () => {
      if (!focusHighlightMutatesDom()) clearFocusHighlight(this.writer.editor);
    });
  }

  private focusAnchor(
    surface: string,
    occurrence: number,
    anchor?: Pick<Anchor, 'surface' | 'occurrence' | 'contextBefore' | 'contextAfter'>,
  ): boolean {
    const editor = this.writer.editor;
    if (!editor) return false;

    try {
      const index = this.editorDocIndex(editor.getBody());
      // Use the Nth document-wide occurrence — never indexOf's first hit.
      // Flat search text also covers date strings that span element boundaries.
      // With an anchor in hand, its stored context breaks ties when the editor
      // copy and the XML disagree about how many occurrences precede this one.
      const located = anchor
        ? locateAnchorInIndex(index, anchor, surface)
        : locateOccurrenceInIndex(index, surface, occurrence);
      if (!located) return false;

      const range = editor.getDoc().createRange();
      range.setStart(located.node, located.start);
      range.setEnd(located.node, located.end);
      editor.selection.setRng(range);
      editor.selection.scrollIntoView?.();
      // A selection in the (unfocused) editor iframe is not painted while the
      // panel has focus, so paint the mention ourselves as well.
      if (!showFocusHighlight(editor, located.node, located.start, located.end)) {
        (located.node.parentElement as HTMLElement | null)?.scrollIntoView?.({ block: 'center' });
      } else if (focusHighlightMutatesDom()) {
        // Only the span fallback splits text nodes; that invalidates the index.
        this.invalidateFocusIndex();
      }
      return true;
    } catch {
      // focusing is a convenience; never let it break the review walk
    }
    return false;
  }
}
