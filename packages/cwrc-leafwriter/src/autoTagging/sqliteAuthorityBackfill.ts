/**
 * SQLite-backed authority refresh/backfill. Same pack + Wikidata enrichment as
 * `backfillEntityNames`, but writes through typed SQLite patches instead of
 * export → DOM mutate → re-import.
 */

import type { AuthorityCandidate } from './authority';
import type { AuthorityPackId } from './packPaths';
import type { AuthorityPackContent } from './packLoader';
import {
  collectGivenFamilyNamesForCandidate,
  collectTypedNamesForCandidate,
  extractWikidataId,
  type DisambiguationCandidate,
  type TypedName,
} from './disambiguationCandidates';
import { mintEntityId, type EntityKind } from './entities';
import type { EntityStore } from './entityStore';
import {
  normalizeNameType,
  normalizeTypedNamesForIntake,
  preferCanonicalFamilyGiven,
} from './nameTypes';
import {
  inventedTitleSplitCleanup,
  nobleTitlesFromMetadata,
  personalNameForSegmentation,
} from './nobleTitleHeadword';
import {
  authorityEnrichmentForEntity,
  authorityEnrichmentsForEntity,
  buildOfficePackNameIndexForAuthorities,
  buildPackNameIndexForAuthorities,
  buildPlacePackIndexForAuthorities,
  buildUniqueOfficeAuthorityByName,
  firstAuthorityEnrichment,
  nobleTitleIndexFromPackNameIndex,
  packTypedNamesForEntity,
  type AuthorityEnrichment,
  type AuthorityPackRowsByIdsFn,
  type NameBackfillProgress,
  type NameBackfillResult,
} from './nameBackfill';
import {
  cleanPublishableOfficeGloss,
  HUCKBOT_PROCEDURAL_SOURCE,
  loadHuckbotGlossIndex,
  loadMaxiRicciGlossIndex,
  lookupEnglishOfficeGloss,
  lookupFrenchOfficeGloss,
  MAXIRICCI_PROCEDURAL_SOURCE,
  persistOfficeTranslationNames,
} from './officeGlossLookup';
import { tryProceduralOfficeTranslation } from './proceduralOfficeGloss';
import { suggestPersonNameSplit, suggestPersonRomanization } from '../plugins/personNameDefaults';
import { autoRomanize, autoRomanizeForKind, latnLangFor } from '../utilities/romanize';
import { norbertAuthorityLookupValues } from './norbertAuthorityId';
import {
  attachPersonCrosswalkAuthorities,
  loadNorbertPersonConcordance,
} from './norbertPersonConcordance';
import {
  biographicalYearsFromMetadata,
  filterYearsFromMetadata,
  finiteBiographicalYear,
  floruitYearsFromMetadata,
} from './personDates';
import { fetchWikidataLifespan } from './wikidataDates';
import { fetchWikidataNationality } from './wikidataNationality';
import { fetchWikidataPlaceOfBirth } from './wikidataPlaceOfBirth';
import { fetchWikidataPersonWorks } from './wikidataPersonWorks';
import { fetchWikidataWorkDetails } from './wikidataWorkDetails';

type AuthorityRefLookupFn = (request: {
  source: 'cbdb' | 'dila' | 'norbert';
  authorityId: string;
}) => Promise<{
  source?: string;
  authorityId?: string;
  primaryName?: string;
  names?: { text: string; type?: string; lang?: string }[];
  metadata?: Record<string, unknown>;
} | null>;

const REF_SOURCE_BY_AUTHORITY: Record<string, 'cbdb' | 'dila' | 'norbert'> = {
  CBDB: 'cbdb',
  DILA: 'dila',
  NORBERT: 'norbert',
};

/** Authority sources whose birth/death rows are treated as biographical truth. */
const FINE_AUTHORITY_DATE_SOURCES = new Set(['WIKIDATA', 'DILA']);

/**
 * Clear user/Central lifespan rows that are known pollution: year `0`, or a
 * year that matches none of the fine authority birth/death assertions we just
 * collected or that already sit on the entity (typical of minting
 * dynasty/floruit pack intervals as user dates).
 */
async function repairPollutedUserLifespanDates(
  store: EntityStore,
  entityId: string,
  fineDates: readonly { startYear?: number | null; endYear?: number | null }[],
): Promise<boolean> {
  const summary = (await store.sqliteEntitySummary(entityId)) as {
    assertions?: {
      element: string;
      origin: string;
      status: string;
      value: string;
      source?: string | null;
    }[];
  } | null;
  if (!summary?.assertions?.length) return false;

  const fineBirths = new Set<number>();
  const fineDeaths = new Set<number>();
  for (const date of fineDates) {
    const birth = finiteBiographicalYear(date.startYear);
    const death = finiteBiographicalYear(date.endYear);
    if (birth != null) fineBirths.add(birth);
    if (death != null) fineDeaths.add(death);
  }
  // Also trust fine-ish authority rows already stored (e.g. DILA/Wikidata from
  // an earlier run) when this pass did not re-fetch them.
  for (const assertion of summary.assertions) {
    if (assertion.status !== 'active' || assertion.origin !== 'authority') continue;
    const source = (assertion.source ?? '').split(':')[0]?.trim().toUpperCase() ?? '';
    if (!FINE_AUTHORITY_DATE_SOURCES.has(source)) continue;
    const year = finiteBiographicalYear(Number(assertion.value));
    if (year == null) continue;
    if (assertion.element === 'birth') fineBirths.add(year);
    if (assertion.element === 'death') fineDeaths.add(year);
  }

  let changed = false;
  const userBirth = summary.assertions.find(
    (assertion) =>
      assertion.element === 'birth' && assertion.origin === 'user' && assertion.status === 'active',
  );
  const userDeath = summary.assertions.find(
    (assertion) =>
      assertion.element === 'death' && assertion.origin === 'user' && assertion.status === 'active',
  );

  if (userBirth) {
    const year = Number(userBirth.value);
    const missing = !Number.isFinite(year) || year === 0;
    const disagrees =
      fineBirths.size > 0 && Number.isFinite(year) && year !== 0 && !fineBirths.has(year);
    if (missing || disagrees) {
      await store.sqliteSetUserDate({ entityId, part: 'birth', year: null });
      changed = true;
    }
  }
  if (userDeath) {
    const year = Number(userDeath.value);
    const missing = !Number.isFinite(year) || year === 0;
    const disagrees =
      fineDeaths.size > 0 && Number.isFinite(year) && year !== 0 && !fineDeaths.has(year);
    if (missing || disagrees) {
      await store.sqliteSetUserDate({ entityId, part: 'death', year: null });
      changed = true;
    }
  }
  return changed;
}

async function referenceEnrichmentsForEntity(
  entity: { authorities: { type: string; value: string }[] },
  lookupAuthorityRef: AuthorityRefLookupFn,
): Promise<{ source: string; enrichment: AuthorityEnrichment }[]> {
  const out: { source: string; enrichment: AuthorityEnrichment }[] = [];
  for (const auth of entity.authorities) {
    const sourceKey = REF_SOURCE_BY_AUTHORITY[auth.type.trim().toUpperCase()];
    if (!sourceKey) continue;
    try {
      const hit = await lookupAuthorityRef({
        source: sourceKey,
        authorityId: auth.value,
      });
      if (!hit) continue;
      const names: TypedName[] = [];
      for (const name of hit.names ?? []) {
        const text = name.text?.trim();
        if (!text) continue;
        const type = normalizeNameType(name.type) ?? 'variant';
        if (type === 'primary') continue;
        names.push({ text, type, lang: name.lang });
      }
      out.push({
        source: auth.type.trim().toUpperCase(),
        enrichment: {
          names: normalizeTypedNamesForIntake(names),
          primaryName: hit.primaryName,
          metadata: hit.metadata as AuthorityCandidate['metadata'],
        },
      });
    } catch {
      // Reference tier optional — pack/Wikidata still apply.
    }
  }
  return out;
}

function mergeEnrichmentRows(
  packRows: { source: string; enrichment: AuthorityEnrichment }[],
  refRows: { source: string; enrichment: AuthorityEnrichment }[],
): { source: string; enrichment: AuthorityEnrichment }[] {
  const bySource = new Map<string, { source: string; enrichment: AuthorityEnrichment }>();
  for (const row of packRows) bySource.set(row.source, row);
  for (const row of refRows) bySource.set(row.source, row); // reference wins
  return [...bySource.values()];
}

/** Drop invented 姓/名 on offices and repair person-style romanizations. */
async function scrubPersonOnlyNamesFromOffice(
  store: EntityStore,
  summary: PanelPerson,
  projectLang?: string | null,
): Promise<boolean> {
  let changed = false;
  for (const name of summary.names) {
    const type = (name.nameType ?? '').toLowerCase();
    if (type !== 'family' && type !== 'given' && type !== 'familyname' && type !== 'givenname') {
      continue;
    }
    const removed = await store.sqliteTombstoneNames(
      summary.id,
      name.text,
      'non-person-name-scrub',
    );
    if (removed > 0) changed = true;
  }
  const primary =
    summary.names
      .find((name) => name.nameType === 'primary')
      ?.text?.normalize('NFC')
      .trim() || summary.names[0]?.text?.normalize('NFC').trim();
  const romanized = summary.names.find((name) => isLatnLang(name.language))?.text?.trim();
  if (primary && romanized) {
    const personStyle = suggestPersonRomanization(primary, projectLang ?? null);
    const officeStyle = autoRomanizeForKind(primary, projectLang, 'office');
    if (personStyle && officeStyle && romanized === personStyle && romanized !== officeStyle) {
      await store.sqliteSetRomanizedName(summary.id, officeStyle, latnLangFor(projectLang ?? null));
      changed = true;
    }
  }
  return changed;
}

interface PanelPerson {
  id: string;
  kind: string;
  names: { text: string; nameType?: string | null; language?: string | null }[];
  authorities: { type: string; value: string }[];
  familyName: string | null;
  givenName: string | null;
}

const isLatnLang = (lang: string | null | undefined): boolean =>
  Boolean(lang && /(^|-)Latn(-|$)/i.test(lang));

function toBackfillEntity(summary: PanelPerson) {
  const nameEntries = summary.names.map((name) => ({
    text: name.text,
    type: name.nameType ?? null,
    lang: name.language ?? null,
  }));
  return {
    id: summary.id,
    kind: summary.kind as EntityKind,
    names: nameEntries.map((entry) => entry.text),
    nameEntries,
    romanized: nameEntries.find((entry) => isLatnLang(entry.lang))?.text ?? null,
    authorities: summary.authorities,
    familyName: summary.familyName,
    givenName: summary.givenName,
  };
}

/** Map one SQLite panel/entity summary into the slim shape backfill needs. */
function panelPersonFromSummary(raw: unknown): PanelPerson | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as {
    id?: unknown;
    kind?: unknown;
    names?: {
      text?: unknown;
      nameType?: unknown;
      language?: unknown;
      status?: unknown;
    }[];
    authorities?: { type?: unknown; value?: unknown }[];
    familyName?: unknown;
    givenName?: unknown;
  };
  if (typeof row.id !== 'string' || typeof row.kind !== 'string') return null;
  const names = (row.names ?? [])
    .filter((name) => name.status == null || name.status === 'active')
    .map((name) => ({
      text: String(name.text ?? ''),
      nameType: (name.nameType as string | null | undefined) ?? null,
      language: (name.language as string | null | undefined) ?? null,
    }))
    .filter((name) => name.text.trim());
  return {
    id: row.id,
    kind: row.kind,
    names,
    authorities: (row.authorities ?? [])
      .map((auth) => ({ type: String(auth.type ?? ''), value: String(auth.value ?? '') }))
      .filter((auth) => auth.type && auth.value),
    familyName: typeof row.familyName === 'string' ? row.familyName : null,
    givenName: typeof row.givenName === 'string' ? row.givenName : null,
  };
}

/**
 * Prefer per-id summaries when the caller scoped the job — loading every
 * person/work via `sqlitePanelSummaries` rebuilds the whole catalogue.
 */
async function loadBackfillPanelPeople(
  store: EntityStore,
  entityIds: string[] | undefined,
): Promise<{ personSummaries: PanelPerson[]; workSummaries: PanelPerson[] }> {
  if (entityIds && entityIds.length > 0) {
    const personSummaries: PanelPerson[] = [];
    const workSummaries: PanelPerson[] = [];
    for (const id of entityIds) {
      const summary = panelPersonFromSummary(await store.sqliteEntitySummary(id));
      if (!summary) continue;
      if (summary.kind === 'person') personSummaries.push(summary);
      else if (summary.kind === 'work') workSummaries.push(summary);
    }
    return { personSummaries, workSummaries };
  }
  return {
    personSummaries: ((await store.sqlitePanelSummaries('person')) ?? []) as PanelPerson[],
    workSummaries: ((await store.sqlitePanelSummaries('work')) ?? []) as PanelPerson[],
  };
}

async function resolveOrCreateByAuthority(
  store: EntityStore,
  kind: 'person' | 'work',
  name: string,
  authorityType: string,
  authorityValue: string,
  extras?: { romanized?: string | null; language?: string | null },
): Promise<string> {
  const existing = await store.sqliteFindByAuthority(kind, authorityType, authorityValue);
  if (existing) {
    await store.sqliteApplyAuthorityBackfillPatch({
      entityId: existing,
      names: [{ text: name, nameType: 'variant', source: authorityType }],
      ...(extras?.romanized
        ? { romanized: { text: extras.romanized, language: extras.language ?? null } }
        : {}),
    });
    return existing;
  }
  const id = mintEntityId(kind);
  await store.sqliteCreatePopulated({
    id,
    kind,
    names: [{ text: name, isPrimary: true, origin: 'authority', source: authorityType }],
    authorities: [
      { type: authorityType, value: authorityValue, origin: 'authority', source: authorityType },
    ],
  });
  if (extras?.romanized) {
    await store.sqliteApplyAuthorityBackfillPatch({
      entityId: id,
      romanized: { text: extras.romanized, language: extras.language ?? null },
    });
  }
  return id;
}

/**
 * Enrich linked persons (and Wikidata works) via SQLite authority patches.
 */
export async function backfillEntitiesSqlite(
  store: EntityStore,
  options: {
    entityIds?: string[];
    readPackFile?: (packId: AuthorityPackId) => Promise<AuthorityPackContent>;
    projectLang?: string | null;
    desktopLanguage?: string | null;
    /** Project's configured translation-mode language codes — widens Wikidata title-label
     * fetches beyond `en` + `desktopLanguage` so translations land for every project language. */
    translationLanguages?: string[];
    signal?: AbortSignal;
    onProgress?: (p: NameBackfillProgress) => void;
    fetchImpl?: typeof fetch;
    /**
     * When true, expand each Wikidata-linked person into their works (many
     * network round-trips). Default false — the Database Window bulk job skips
     * this; pass true for a deep single-entity refresh.
     */
    expandWikidataWorks?: boolean;
    /**
     * When false, never call live Wikidata for names/dates/nationality/PoB.
     * Default true, but pack data is preferred: live calls are skipped when
     * packs already supply typed names / lifespan / nationality / origins.
     */
    liveWikidata?: boolean;
    /**
     * Optional A6 reference lookup (CBDB/DILA/Norbert sqlite/XML). When present,
     * results take precedence over pack metadata for the same authority id.
     */
    lookupAuthorityRef?: AuthorityRefLookupFn;
    /**
     * Main-process pack scan that returns only matching NDJSON lines. Required
     * for safe bulk backfill of CBDB (full pack is ~570MB over IPC).
     */
    lookupPackRowsByIds?: AuthorityPackRowsByIdsFn;
    /** Yield between entities so the UI can paint progress (default: microtask). */
    yieldFn?: () => Promise<void>;
  } = {},
): Promise<NameBackfillResult> {
  const {
    entityIds,
    readPackFile,
    projectLang,
    desktopLanguage,
    translationLanguages,
    signal,
    onProgress,
    fetchImpl,
    expandWikidataWorks = false,
    liveWikidata = true,
    lookupAuthorityRef,
    lookupPackRowsByIds,
    yieldFn = () => new Promise((resolve) => setTimeout(resolve, 0)),
  } = options;

  const { personSummaries, workSummaries } = await loadBackfillPanelPeople(store, entityIds);
  const idFilter = entityIds ? new Set(entityIds) : null;

  const targets = personSummaries
    .map(toBackfillEntity)
    .filter((entity) => entity.authorities.length > 0 && (!idFilter || idFilter.has(entity.id)));
  const workTargets = workSummaries
    .map(toBackfillEntity)
    .filter(
      (entity) =>
        entity.authorities.some((auth) => auth.type.trim().toUpperCase() === 'WIKIDATA') &&
        (!idFilter || idFilter.has(entity.id)),
    );
  const totalTargets = targets.length + workTargets.length;

  const skippedNoAuthority = idFilter
    ? entityIds!.filter((id) => {
        const entity = personSummaries.find((row) => row.id === id);
        return !entity || entity.authorities.length === 0;
      }).length
    : personSummaries.filter((entity) => entity.authorities.length === 0).length;

  // Load pack names/metadata only for authority ids already on the targets.
  // Never pull the full CBDB persons pack into the renderer (select-all used to
  // hang on "Reading packs…" then die). Prefer main-process id lookup.
  const linkedAuthorities = targets.flatMap((entity) => entity.authorities);
  const canReadPacks = Boolean(lookupPackRowsByIds || readPackFile);
  const packIndex = canReadPacks
    ? await buildPackNameIndexForAuthorities(linkedAuthorities, {
        lookupPackRowsByIds,
        readPackFile,
        onPackProgress: (label) =>
          onProgress?.({ done: 0, total: Math.max(totalTargets, 1), entityLabel: label }),
      })
    : null;
  // Norbert↔CBDB/DILA/Wikidata bridge links — used to repair Central imports that
  // only carry NORBERT after a full Norbert database ingest.
  const norbertConcordance = readPackFile ? await loadNorbertPersonConcordance(readPackFile) : null;
  // Titles come from the Norbert person rows already fetched above (and from
  // A6 reference). Do not scan the full wiki-nt / persons packs here — that
  // reintroduces the select-all hang.
  const nobleTitleIndex =
    packIndex && packIndex.size > 0 ? nobleTitleIndexFromPackNameIndex(packIndex) : null;
  // Office name→authority attach is a catalogue-wide scan — only for bulk or
  // explicitly selected office ids.
  const needsOfficeAttach =
    Boolean(readPackFile) && (!idFilter || entityIds!.some((id) => id.startsWith('office-')));
  const officeAuthorityByName = needsOfficeAttach
    ? await buildUniqueOfficeAuthorityByName(readPackFile!)
    : null;

  let entitiesScanned = 0;
  let entitiesUpdated = 0;
  let namesAdded = 0;
  let cancelled = false;
  let bridgeLinksAttached = 0;
  let bridgeDuplicatesMerged = 0;
  let bridgeConflicts = 0;

  // Offices: scrub legacy 姓/名 pollution, attach missing idnos, and write
  // CBDB / Huckbot English + MaxiRicci French roleName translations.
  if (!idFilter || entityIds!.some((id) => id.startsWith('office-'))) {
    try {
      const officeSummaries = (
        idFilter
          ? (
              await Promise.all(
                entityIds!
                  .filter((id) => id.startsWith('office-'))
                  .map((id) => store.sqliteEntitySummary(id)),
              )
            )
              .map(panelPersonFromSummary)
              .filter((row): row is PanelPerson => Boolean(row))
          : ((await store.sqlitePanelSummaries('office')) ?? [])
              .map(panelPersonFromSummary)
              .filter((row): row is PanelPerson => Boolean(row))
      ) as PanelPerson[];
      let officePackIndex =
        canReadPacks && officeSummaries.length > 0
          ? await buildOfficePackNameIndexForAuthorities(
              officeSummaries.flatMap((row) => row.authorities),
              {
                lookupPackRowsByIds,
                readPackFile,
                onPackProgress: (label) =>
                  onProgress?.({
                    done: entitiesScanned,
                    total: Math.max(totalTargets + officeSummaries.length, 1),
                    entityLabel: label,
                  }),
              },
            )
          : null;
      const huckbotGlosses = readPackFile ? await loadHuckbotGlossIndex(readPackFile) : new Map();
      const maxiGlosses = readPackFile
        ? await loadMaxiRicciGlossIndex(readPackFile)
        : { byOfficeId: new Map(), byZhDynasty: new Map(), byZh: new Map() };
      for (const summary of officeSummaries) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        if (idFilter && !idFilter.has(summary.id)) continue;
        const primary =
          summary.names
            .find((name) => name.nameType === 'primary')
            ?.text?.normalize('NFC')
            .trim() || summary.names[0]?.text?.normalize('NFC').trim();
        entitiesScanned++;
        let changed = await scrubPersonOnlyNamesFromOffice(store, summary, projectLang);
        const authorities = [...summary.authorities];
        const newlyAttached: { type: 'NORBERT' | 'CBDB'; value: string }[] = [];
        if (officeAuthorityByName && primary) {
          const candidates = officeAuthorityByName.get(primary);
          for (const hit of candidates ?? []) {
            const already = authorities.some(
              (auth) =>
                auth.type.trim().toUpperCase() === hit.type && auth.value.trim() === hit.value,
            );
            if (already) continue;
            const claimed = await store.sqliteFindByAuthority('office', hit.type, hit.value);
            if (claimed && claimed !== summary.id) continue;
            const ok = await store.sqliteAttachAuthority(summary.id, hit.type, hit.value);
            if (ok) {
              changed = true;
              authorities.push(hit);
              newlyAttached.push(hit);
            }
          }
        }
        if (newlyAttached.length > 0 && canReadPacks) {
          const extra = await buildOfficePackNameIndexForAuthorities(newlyAttached, {
            lookupPackRowsByIds,
            readPackFile,
          });
          if (!officePackIndex) officePackIndex = extra;
          else for (const [key, value] of extra) officePackIndex.set(key, value);
        }
        const hasLang = (lang: string) =>
          summary.names.some(
            (name) =>
              (name.nameType ?? '').toLowerCase() === 'translation' &&
              Boolean(name.language && name.language.toLowerCase().startsWith(lang)),
          );
        let translation: string | null = null;
        let translationFr: string | null = null;
        let enSource: string | null = null;
        let dynasty: string | null = null;
        if (officePackIndex) {
          for (const auth of authorities) {
            const source = auth.type.trim().toUpperCase();
            const values =
              source === 'NORBERT'
                ? norbertAuthorityLookupValues(auth.value)
                : [auth.value.trim()].filter(Boolean);
            for (const value of values) {
              const meta = officePackIndex.get(`${source}:${value}`)?.metadata;
              if (!meta) continue;
              dynasty = dynasty ?? meta.dynasty ?? null;
              const en = cleanPublishableOfficeGloss(meta.translation);
              if (en && !translation) {
                translation = en;
                enSource = source;
              }
              const fr = cleanPublishableOfficeGloss(meta.translationFr);
              if (fr && !translationFr) translationFr = fr;
            }
          }
        }
        if (!translation) {
          translation =
            cleanPublishableOfficeGloss(lookupEnglishOfficeGloss(huckbotGlosses, authorities)) ??
            null;
          if (translation) enSource = 'Huckbot5000';
        }
        if (!translationFr) {
          translationFr =
            cleanPublishableOfficeGloss(
              lookupFrenchOfficeGloss(maxiGlosses, authorities, primary, dynasty),
            ) ?? null;
        }
        let frSource = 'MaxiRicci7000';
        if ((!translation || !translationFr) && primary) {
          const procedural = tryProceduralOfficeTranslation(primary);
          if (procedural) {
            if (!translation) {
              translation = procedural.en;
              enSource = HUCKBOT_PROCEDURAL_SOURCE;
            }
            if (!translationFr) {
              translationFr = procedural.fr;
              frSource = MAXIRICCI_PROCEDURAL_SOURCE;
            }
          }
        }
        const added = await persistOfficeTranslationNames(store, summary.id, {
          translation: hasLang('en') ? null : translation,
          translationFr: hasLang('fr') ? null : translationFr,
          enSource,
          frSource,
        });
        if (added > 0) {
          namesAdded += added;
          changed = true;
        }
        if (changed) entitiesUpdated++;
        onProgress?.({
          done: entitiesScanned,
          total: Math.max(totalTargets + officeSummaries.length, 1),
          entityId: summary.id,
          entityLabel: primary || summary.id,
          addedNames: added,
        });
        await yieldFn();
      }
    } catch {
      // Attach/panel APIs unavailable — skip office backfill silently.
    }
  }

  // Places: pull coordinates from already-linked CBDB/CHGIS authorities.
  if (!idFilter || entityIds!.some((id) => id.startsWith('place-'))) {
    try {
      const placeSummaries = (
        idFilter
          ? (
              await Promise.all(
                entityIds!
                  .filter((id) => id.startsWith('place-'))
                  .map((id) => store.sqliteEntitySummary(id)),
              )
            )
              .map(panelPersonFromSummary)
              .filter((row): row is PanelPerson => Boolean(row))
          : ((await store.sqlitePanelSummaries('place')) ?? [])
              .map(panelPersonFromSummary)
              .filter((row): row is PanelPerson => Boolean(row))
      ) as PanelPerson[];
      const placePackIndex =
        canReadPacks && placeSummaries.length > 0
          ? await buildPlacePackIndexForAuthorities(
              placeSummaries.flatMap((row) => row.authorities),
              {
                lookupPackRowsByIds,
                readPackFile,
                onPackProgress: (label) =>
                  onProgress?.({
                    done: entitiesScanned,
                    total: Math.max(totalTargets + placeSummaries.length, 1),
                    entityLabel: label,
                  }),
              },
            )
          : null;
      for (const summary of placeSummaries) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        if (idFilter && !idFilter.has(summary.id)) continue;
        const primary =
          summary.names
            .find((name) => name.nameType === 'primary')
            ?.text?.normalize('NFC')
            .trim() || summary.names[0]?.text?.normalize('NFC').trim();
        entitiesScanned++;
        let changed = false;
        if (placePackIndex) {
          const geo: { source: string; lat: number; lon: number }[] = [];
          for (const auth of summary.authorities) {
            const source = auth.type.trim().toUpperCase();
            if (source !== 'CBDB' && source !== 'CHGIS') continue;
            const point = placePackIndex.get(`${source}:${auth.value.trim()}`)?.metadata?.geo;
            if (point && Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
              geo.push({ source, lat: point.lat, lon: point.lon });
            }
          }
          if (geo.length > 0) {
            const result = await store.sqliteApplyAuthorityBackfillPatch({
              entityId: summary.id,
              geo,
            });
            if (result.changed) changed = true;
          }
        }
        if (changed) entitiesUpdated++;
        onProgress?.({
          done: entitiesScanned,
          total: Math.max(totalTargets + placeSummaries.length, 1),
          entityId: summary.id,
          entityLabel: primary || summary.id,
        });
        await yieldFn();
      }
    } catch {
      // Attach/panel APIs unavailable — skip place backfill silently.
    }
  }

  for (const entity of targets) {
    if (signal?.aborted || cancelled) {
      cancelled = true;
      break;
    }
    entitiesScanned++;
    let addedThisEntity = 0;
    let entityChanged = false;

    // Attach missing bridge authorities (Norbert concordance + pack crosswalks)
    // before name/date enrichment so newly linked packs can contribute too.
    const packCrosswalks = authorityEnrichmentsForEntity(entity, packIndex).map(
      (row) =>
        row.enrichment.metadata?.crosswalk as
          Record<string, string | string[] | undefined> | undefined,
    );
    const bridge = await attachPersonCrosswalkAuthorities(store, entity.id, entity.authorities, {
      concordance: norbertConcordance,
      packCrosswalks,
      primaryName: entity.names[0] ?? null,
    });
    bridgeLinksAttached += bridge.attached + bridge.reverseAttached;
    bridgeDuplicatesMerged += bridge.mergedInto.length;
    bridgeConflicts += bridge.conflicts.length;
    if (bridge.mergedInto.length > 0) {
      // This card was merged into a same-name duplicate that already held the
      // bridge target — skip further enrichment on the dropped id.
      entitiesUpdated++;
      onProgress?.({
        done: entitiesScanned,
        total: totalTargets,
        entityId: entity.id,
        entityLabel: entity.names[0],
        addedNames: 0,
      });
      await yieldFn();
      continue;
    }
    if (bridge.attached > 0) {
      entityChanged = true;
      const refreshed = panelPersonFromSummary(await store.sqliteEntitySummary(entity.id));
      if (refreshed) {
        entity.authorities = refreshed.authorities;
      }
      if (canReadPacks && packIndex) {
        const extra = await buildPackNameIndexForAuthorities(entity.authorities, {
          lookupPackRowsByIds,
          readPackFile,
        });
        for (const [key, value] of extra) packIndex.set(key, value);
      }
    }

    const candidate: DisambiguationCandidate = {
      id: entity.id,
      label: entity.names[0] ?? entity.id,
      sources: entity.authorities.map((auth) => auth.type),
      uri: '',
      authorityIds: entity.authorities,
      localEntityId: entity.id,
      typedNames: (() => {
        const fromPack = packTypedNamesForEntity(entity, packIndex);
        return fromPack.length > 0 ? fromPack : undefined;
      })(),
    };
    const metadata = authorityEnrichmentForEntity(entity, packIndex);
    const firstEnrichment = firstAuthorityEnrichment(entity, packIndex);
    const primaryName = firstEnrichment?.primaryName?.trim();
    const namePatches: {
      text: string;
      nameType?: string | null;
      language?: string | null;
      source?: string | null;
    }[] = [];

    if (primaryName && primaryName !== entity.names[0]) {
      namePatches.push({
        text: primaryName,
        nameType: 'variant',
        source: entity.authorities[0]?.type,
      });
    }

    candidate.startYear = metadata?.startYear;
    candidate.endYear = metadata?.endYear;
    candidate.authorityMetadata = metadata;

    const packTypedNames = candidate.typedNames ?? [];
    const refRows = lookupAuthorityRef
      ? await referenceEnrichmentsForEntity(entity, lookupAuthorityRef)
      : [];
    const refTypedNames = refRows.flatMap((row) => row.enrichment.names ?? []);
    // Union pack + reference. Taking only reference dropped CBDB 姓/名 whenever
    // DILA returned any other typed names (or when reference was empty/missing).
    const mergedTypedNames = normalizeTypedNamesForIntake(
      [...packTypedNames, ...refTypedNames],
      [
        ...packTypedNames.filter((name) => name.type === 'family').map((name) => name.text),
        ...refTypedNames.filter((name) => name.type === 'family').map((name) => name.text),
      ],
    );
    const packHasTypedNames = mergedTypedNames.length > 0;
    const packHasFamily = mergedTypedNames.some((name) => name.type === 'family');
    const packHasGiven = mergedTypedNames.some((name) => name.type === 'given');

    const givenFamily =
      liveWikidata && !(entity.familyName && entity.givenName) && !(packHasFamily && packHasGiven)
        ? await collectGivenFamilyNamesForCandidate(candidate, projectLang, fetchImpl)
        : {};
    const familyNames = [
      ...(givenFamily.familyName ? [givenFamily.familyName] : []),
      ...(entity.familyName ? [entity.familyName] : []),
      ...mergedTypedNames.filter((name) => name.type === 'family').map((name) => name.text),
    ];
    // Prefer reference/pack typed names when present; only hit Wikidata when empty.
    const typedNames = normalizeTypedNamesForIntake(
      packHasTypedNames || !liveWikidata
        ? mergedTypedNames
        : await collectTypedNamesForCandidate(candidate, fetchImpl),
      familyNames,
    );
    for (const typed of typedNames) {
      namePatches.push({
        text: typed.text,
        nameType: typed.type,
        language: typed.lang,
        source: entity.authorities[0]?.type,
      });
    }

    const titleParts = nobleTitlesFromMetadata(metadata);
    const headword = primaryName || entity.names[0] || null;
    const splitSurface = personalNameForSegmentation(headword, typedNames, titleParts);
    const preferred = preferCanonicalFamilyGiven(splitSurface, typedNames);
    // Authority backfill rewrites unvalidated 姓/名 to pack truth (or clears them).
    // Never invent a split from a noble-title headword.
    let familyName =
      givenFamily.familyName ||
      preferred.familyName ||
      (splitSurface
        ? suggestPersonNameSplit(splitSurface, projectLang ?? null)?.familyName
        : null) ||
      null;
    let givenName =
      givenFamily.givenName ||
      preferred.givenName ||
      (splitSurface
        ? suggestPersonNameSplit(splitSurface, projectLang ?? null)?.givenName
        : null) ||
      null;

    const titleCleanup = inventedTitleSplitCleanup({
      headword,
      nameEntries: entity.nameEntries,
      familyName: entity.familyName,
      givenName: entity.givenName,
      typedNames,
      nobleTitles: titleParts,
    });
    if (titleCleanup.preferredFamily) familyName = titleCleanup.preferredFamily;
    if (titleCleanup.clearGivenName) givenName = null;
    // Drop invented title-split texts from the additive name list — rewrite
    // withdraws leftover authority family/given rows not in this patch.
    if (titleCleanup.tombstoneTexts.length) {
      const drop = new Set(titleCleanup.tombstoneTexts);
      for (let i = namePatches.length - 1; i >= 0; i -= 1) {
        const patch = namePatches[i]!;
        if (drop.has(patch.text.normalize('NFC').trim())) namePatches.splice(i, 1);
      }
    }

    let romanized: { text: string; language?: string | null } | null = null;
    if (!entity.romanized) {
      const authorityRomanized = metadata?.pinyin ?? metadata?.yomi;
      const familyRom =
        preferred.familyName &&
        autoRomanize(preferred.familyName, projectLang ?? null, { concatenate: true });
      const givenRom =
        preferred.givenName &&
        autoRomanize(preferred.givenName, projectLang ?? null, { concatenate: true });
      const fromParts = familyRom && givenRom ? `${familyRom} ${givenRom}` : '';
      const text =
        authorityRomanized?.trim() ||
        fromParts ||
        (splitSurface ? suggestPersonRomanization(splitSurface, projectLang ?? null) : null);
      if (text) romanized = { text, language: projectLang ?? null };
    }

    const dates: {
      source: string;
      startYear?: number | null;
      endYear?: number | null;
      asFloruit?: boolean;
    }[] = [];
    const clearAuthorityVitalSources: string[] = [];
    const nationalities: { label: string; ref?: string | null; source: string }[] = [];
    const origins: {
      label: string;
      ref?: string | null;
      source: string;
      nameType?: string | null;
    }[] = [];
    const offices: { label: string; ref?: string | null; source: string }[] = [];
    const authorityCaches: {
      authorityType: string;
      source?: string | null;
      payload: unknown;
    }[] = [];

    for (const { source, enrichment } of mergeEnrichmentRows(
      authorityEnrichmentsForEntity(entity, packIndex),
      refRows,
    )) {
      const meta = enrichment.metadata;
      if (!meta) continue;
      const normalizedSource = source.trim().toUpperCase();
      const bioYears = biographicalYearsFromMetadata(meta);
      const floruitYears = floruitYearsFromMetadata(meta);
      if (bioYears.startYear != null || bioYears.endYear != null) {
        dates.push({
          source: normalizedSource,
          startYear: bioYears.startYear,
          endYear: bioYears.endYear,
        });
      } else if (floruitYears.startYear != null || floruitYears.endYear != null) {
        // Real floruit: store as dates+fl.; clear any birth/death wrongly minted earlier.
        dates.push({
          source: normalizedSource,
          startYear: floruitYears.startYear,
          endYear: floruitYears.endYear,
          asFloruit: true,
        });
        clearAuthorityVitalSources.push(normalizedSource);
      } else if (
        meta.dateSource === 'index' ||
        meta.dateSource === 'nationality' ||
        // Same test the candidate builder applies: a pack may omit `dateSource`
        // entirely — the Norbert person pack does, on every row — so ask the years
        // where they came from rather than trusting the label. Without this the
        // cleanup could never fire for Norbert people, which is why dynasty spans
        // stored as birth/death by earlier mints survived being cleaned.
        filterYearsFromMetadata(meta).derivedFromDynasty
      ) {
        // Drop index/dynasty years that older mints stored as birth/death.
        clearAuthorityVitalSources.push(normalizedSource);
      }
      for (const value of meta.nationality ?? []) {
        nationalities.push({
          label: value.label,
          ref: value.canonicalId,
          source: normalizedSource,
        });
      }
      for (const value of meta.origin ?? []) {
        if (!value.placeName?.trim()) continue;
        origins.push({
          label: value.placeName,
          ref: value.placeAuthorityId,
          source: value.source ?? normalizedSource,
          nameType: value.originType,
        });
      }
      if (meta.appointments?.length) {
        authorityCaches.push({
          authorityType: normalizedSource,
          source: normalizedSource,
          payload: meta,
        });
        for (const appointment of meta.appointments) {
          if (!appointment.office?.name?.trim()) continue;
          offices.push({
            label: appointment.office.name,
            ref: appointment.office.authorityId,
            source: appointment.source ?? normalizedSource,
          });
        }
      }
    }

    const nobleTitles: {
      placeName: string;
      roleName: string;
      posthumousName?: string | null;
      dynasty?: string | null;
      ref?: string | null;
      source: string;
    }[] = [];
    const norbertIdno = entity.authorities.find(
      (auth) => auth.type.trim().toUpperCase() === 'NORBERT',
    );
    if (norbertIdno && nobleTitleIndex) {
      let titles: ReturnType<typeof nobleTitleIndex.get> = undefined;
      for (const key of norbertAuthorityLookupValues(norbertIdno.value)) {
        titles = nobleTitleIndex.get(key);
        if (titles?.length) break;
      }
      for (const title of titles ?? []) {
        nobleTitles.push({
          placeName: title.placeName,
          roleName: title.roleName,
          posthumousName: title.posthumousName,
          dynasty: title.dynasty,
          ref: title.ref,
          source: `Norbert:${title.ref}`,
        });
      }
    }
    for (const row of refRows) {
      const titles = (
        row.enrichment.metadata as
          | {
              nobleTitles?: {
                fief?: string;
                rank?: string;
                posthumous?: string;
                dynasty?: string;
                id?: string;
              }[];
            }
          | undefined
      )?.nobleTitles;
      for (const title of titles ?? []) {
        if (!title.fief && !title.rank) continue;
        nobleTitles.push({
          placeName: title.fief ?? '',
          roleName: title.rank ?? '',
          posthumousName: title.posthumous,
          dynasty: title.dynasty,
          ref: title.id ? `NORBERT:person_nt:${title.id}` : null,
          source: 'NORBERT',
        });
      }
    }

    const wikidataIdno = entity.authorities.find(
      (auth) => auth.type.trim().toUpperCase() === 'WIKIDATA',
    );
    if (wikidataIdno && liveWikidata) {
      // Always ask Wikidata for P569/P570 when linked — pack floruit/index years
      // must not suppress real birth/death.
      const needNationality = nationalities.length === 0;
      const needOrigin = origins.length === 0;
      const [lifespan, nationality, placeOfBirth] = await Promise.all([
        fetchWikidataLifespan(wikidataIdno.value, fetchImpl).catch(() => null),
        needNationality
          ? fetchWikidataNationality(wikidataIdno.value, fetchImpl, projectLang).catch(() => null)
          : Promise.resolve(null),
        needOrigin
          ? fetchWikidataPlaceOfBirth(wikidataIdno.value, fetchImpl, projectLang).catch(() => null)
          : Promise.resolve(null),
      ]);
      const wikiBirth = finiteBiographicalYear(lifespan?.birthYear);
      const wikiDeath = finiteBiographicalYear(lifespan?.deathYear);
      if (wikiBirth != null || wikiDeath != null) {
        dates.push({
          source: 'WIKIDATA',
          startYear: wikiBirth,
          endYear: wikiDeath,
        });
      }
      for (const value of nationality ?? []) {
        nationalities.push({
          label: value.label,
          ref: value.canonicalId,
          source: 'WIKIDATA',
        });
      }
      for (const value of placeOfBirth ?? []) {
        origins.push({
          label: value.label,
          ref: value.canonicalId,
          source: 'WIKIDATA',
        });
      }

      if (expandWikidataWorks) {
        const qid = extractWikidataId(wikidataIdno.value) ?? wikidataIdno.value;
        const personWorks = await fetchWikidataPersonWorks(qid, fetchImpl, projectLang).catch(
          () => [],
        );
        for (const work of personWorks) {
          const workId = await resolveOrCreateByAuthority(
            store,
            'work',
            work.label,
            'Wikidata',
            work.qid,
          );
          const workDetails = await fetchWikidataWorkDetails(
            work.qid,
            fetchImpl,
            desktopLanguage,
            translationLanguages,
          ).catch(() => null);
          const workPatchNames =
            workDetails?.titles.map((title) => ({
              text: title.label,
              nameType: 'translation',
              language: title.language,
              source: 'Wikidata',
            })) ?? [];
          const workResult = await store.sqliteApplyAuthorityBackfillPatch({
            entityId: workId,
            names: workPatchNames,
            workAuthors: [
              {
                name: entity.names[0] ?? entity.id,
                personId: entity.id,
                ref: `#${entity.id}`,
                source: 'Wikidata',
              },
            ],
            workDate:
              workDetails?.publicationYear != null
                ? { source: 'WIKIDATA', startYear: workDetails.publicationYear, endYear: null }
                : null,
          });
          if (workResult.changed) entityChanged = true;
        }
      }
    }

    const result = await store.sqliteApplyAuthorityBackfillPatch({
      entityId: entity.id,
      names: namePatches,
      familyName,
      givenName,
      // Only rewrite 姓/名 when authority actually supplied a split — empty
      // rewrites used to withdraw/tombstone CBDB family/given on card refresh.
      rewriteUnvalidatedPersonNames: Boolean(familyName || givenName),
      romanized,
      dates,
      clearAuthorityVitalSources,
      nationalities,
      origins,
      offices,
      nobleTitles,
      authorityCaches,
    });
    if (result.changed) entityChanged = true;
    if (await repairPollutedUserLifespanDates(store, entity.id, dates)) entityChanged = true;
    addedThisEntity += result.namesAdded;
    if (entityChanged) entitiesUpdated++;
    namesAdded += addedThisEntity;

    onProgress?.({
      done: entitiesScanned,
      total: totalTargets,
      entityId: entity.id,
      entityLabel: entity.names[0],
      addedNames: addedThisEntity,
    });
    await yieldFn();
  }

  for (const entity of workTargets) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    entitiesScanned++;
    const wikidata = entity.authorities.find(
      (auth) => auth.type.trim().toUpperCase() === 'WIKIDATA',
    );
    const qid = extractWikidataId(wikidata?.value ?? '');
    let enriched = false;
    if (qid) {
      const details = await fetchWikidataWorkDetails(
        qid,
        fetchImpl,
        desktopLanguage,
        translationLanguages,
      ).catch(() => null);
      if (details) {
        const authorIds: { name: string; personId: string }[] = [];
        for (const author of details.authors) {
          const personId = await resolveOrCreateByAuthority(
            store,
            'person',
            author.label,
            'Wikidata',
            author.qid,
            {
              romanized: autoRomanize(author.label, projectLang ?? null),
              language: projectLang ?? null,
            },
          );
          authorIds.push({ name: author.label, personId });
        }
        const result = await store.sqliteApplyAuthorityBackfillPatch({
          entityId: entity.id,
          names: details.titles.map((title) => ({
            text: title.label,
            nameType: 'translation',
            language: title.language,
            source: 'Wikidata',
          })),
          workAuthors: authorIds.map((author) => ({
            name: author.name,
            personId: author.personId,
            ref: `#${author.personId}`,
            source: 'Wikidata',
          })),
          workDate:
            details.publicationYear != null
              ? { source: 'WIKIDATA', startYear: details.publicationYear, endYear: null }
              : null,
        });
        enriched = result.changed;
      }
    }
    if (enriched) entitiesUpdated++;
    onProgress?.({
      done: entitiesScanned,
      total: totalTargets,
      entityId: entity.id,
      entityLabel: entity.names[0],
    });
    await yieldFn();
  }

  return {
    entitiesScanned,
    entitiesUpdated,
    namesAdded,
    skippedNoAuthority,
    cancelled,
    bridgeLinksAttached,
    bridgeDuplicatesMerged,
    bridgeConflicts,
  };
}
