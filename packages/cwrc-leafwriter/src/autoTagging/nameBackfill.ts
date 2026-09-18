/**
 * Non-destructive enrichment of person entities with typed names from authority
 * packs (CBDB/DILA `names[]`) and live Wikidata claims. Reuses the same
 * collectors as link-time disambiguation; the caller persists the document.
 */

import type { AuthorityPackId } from './packPaths';
import { iterateAuthorityNdjson, type AuthorityPackContent } from './packLoader';
import {
  collectGivenFamilyNamesForCandidate,
  collectTypedNamesForCandidate,
  type DisambiguationCandidate,
  type TypedName,
} from './disambiguationCandidates';
import {
  addEntityName,
  getFamilyName,
  getGivenName,
  listEntities,
  setFamilyName,
  setGivenName,
  setRomanizedName,
  type EntitySummary,
} from './entityOps';
import {
  appendAuthorityDates,
  appendAuthorityNobleTitles,
  appendAuthoritySourcedValues,
  findEntity,
  setAuthorityCache,
  touchEntity,
} from './entities';
import { biographicalYearsFromMetadata } from './personDates';
import type { AuthorityCandidate } from './authority';
import {
  normalizeNameType,
  normalizeTypedNamesForIntake,
  preferCanonicalFamilyGiven,
  type NameTypeId,
} from './nameTypes';
import { personalNameForSegmentation, nobleTitlesFromMetadata } from './nobleTitleHeadword';
import { suggestPersonNameSplit, suggestPersonRomanization } from '../plugins/personNameDefaults';
import { fetchWikidataLifespan } from './wikidataDates';
import { fetchWikidataNationality } from './wikidataNationality';
import { fetchWikidataPlaceOfBirth } from './wikidataPlaceOfBirth';
import { formatNorbertAuthorityValue, norbertAuthorityLookupValues } from './norbertAuthorityId';

export interface NameBackfillProgress {
  done: number;
  total: number;
  entityId?: string;
  entityLabel?: string;
  addedNames?: number;
}

export interface NameBackfillResult {
  entitiesScanned: number;
  entitiesUpdated: number;
  namesAdded: number;
  skippedNoAuthority: number;
  cancelled: boolean;
  /** Norbert↔CBDB/DILA/Wikidata idnos attached during this run. */
  bridgeLinksAttached?: number;
  /** Same-name duplicate cards merged because a bridge target was already claimed. */
  bridgeDuplicatesMerged?: number;
  /** Bridge targets owned by a differently-named person (needs manual review). */
  bridgeConflicts?: number;
}

/** Same filter as link-time pack ingestion: skip primary (already the headword). */
function typedNamesFromPackRow(
  names: { text: string; type?: string; lang?: string }[] | undefined,
): TypedName[] {
  if (!names?.length) return [];
  const raw: TypedName[] = [];
  for (const name of names) {
    const text = name.text?.trim();
    if (!text) continue;
    const type = normalizeNameType(name.type) ?? 'variant';
    if (type === 'primary') continue;
    raw.push({ text, type, lang: name.lang });
  }
  return normalizeTypedNamesForIntake(raw);
}

export interface AuthorityEnrichment {
  names: TypedName[];
  primaryName?: string;
  metadata?: AuthorityCandidate['metadata'];
}

export interface NorbertNobleTitleCandidate {
  placeName: string;
  roleName: string;
  posthumousName?: string;
  posthumousNameAbbr?: string;
  dynasty?: string;
  /** The wiki-nt-links record's own authorityId, e.g. "wiki-nt:1610". */
  ref: string;
}

/** Norbert's `person_nt` table is canonical: every title it records for a
 * person should be backfillable regardless of whether a zh.wikipedia
 * noble-title list page happens to cover it (most emperors/founders never
 * are — see `norbert-direct` records in the compiled asset). Keyed by the
 * person's Norbert authority id (`metadata.crosswalk.norbert`).
 */
let norbertNobleTitleIndexPromise: Promise<Map<string, NorbertNobleTitleCandidate[]>> | null = null;
let packNameIndexPromise: Promise<Map<string, AuthorityEnrichment>> | null = null;
let officeAuthorityByNamePromise: Promise<
  Map<string, { type: 'NORBERT' | 'CBDB'; value: string }[]>
> | null = null;

/** Drop memoized pack enrichment indexes (call when packs are reinstalled). */
export function clearAuthorityPackEnrichmentCaches(): void {
  norbertNobleTitleIndexPromise = null;
  packNameIndexPromise = null;
  officeAuthorityByNamePromise = null;
}

export async function buildNorbertNobleTitleIndex(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, NorbertNobleTitleCandidate[]>> {
  if (!norbertNobleTitleIndexPromise) {
    norbertNobleTitleIndexPromise = buildNorbertNobleTitleIndexUncached(readPackFile).catch(
      (error) => {
        norbertNobleTitleIndexPromise = null;
        throw error;
      },
    );
  }
  return norbertNobleTitleIndexPromise;
}

async function buildNorbertNobleTitleIndexUncached(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, NorbertNobleTitleCandidate[]>> {
  const index = new Map<string, NorbertNobleTitleCandidate[]>();
  try {
    const content = await readPackFile('norbert-persons');
    for (const row of iterateAuthorityNdjson(content)) {
      const rawPersonId = row.authorityId;
      const titles = row.metadata?.nobleTitles;
      if (!rawPersonId || !Array.isArray(titles)) continue;
      const personId = formatNorbertAuthorityValue('person', rawPersonId);
      const list = index.get(personId) ?? [];
      for (const title of titles) {
        if (!title?.fief && !title?.roleName) continue;
        list.push({
          placeName: title.fief ?? '',
          roleName: title.roleName ?? '',
          posthumousName: title.posthumousName,
          posthumousNameAbbr: title.posthumousNameAbbr,
          dynasty: row.metadata?.dynasty,
          ref: `person:${personId}`,
        });
      }
      if (!list.length) continue;
      index.set(personId, list);
      for (const key of norbertAuthorityLookupValues(personId)) {
        if (key !== personId) index.set(key, list);
      }
    }
  } catch {
    // Older packs lack person-level title metadata; fall back to the
    // dedicated canonical-title asset below.
  }
  try {
    const content = await readPackFile('norbert-wiki-nt');
    for (const row of iterateAuthorityNdjson(content)) {
      const rawPersonId = row.metadata?.crosswalk?.norbert;
      const title = row.metadata?.nobleTitle;
      if (!rawPersonId || !title || (!title.fief && !title.roleName)) continue;
      const personId = formatNorbertAuthorityValue('person', rawPersonId);
      const list = index.get(personId) ?? [];
      list.push({
        placeName: title.fief ?? '',
        roleName: title.roleName ?? '',
        posthumousName: title.posthumousName,
        posthumousNameAbbr: title.posthumousNameAbbr,
        dynasty: row.metadata?.dynasty,
        ref: row.authorityId,
      });
      index.set(personId, list);
      // Also index bare id so older packs still resolve during migration.
      for (const key of norbertAuthorityLookupValues(personId)) {
        if (key !== personId) index.set(key, list);
      }
    }
  } catch {
    // Pack missing or unreadable — skip silently, matching buildPackNameIndex.
  }
  return index;
}

/** Appends Norbert-canonical noble titles linked to an entity's Norbert authority id. */
function applyNorbertNobleTitles(
  doc: Document,
  entityId: string,
  titles: NorbertNobleTitleCandidate[],
): boolean {
  const item = findEntity(doc, entityId);
  if (!item) return false;
  return appendAuthorityNobleTitles(
    doc,
    item,
    titles.map((title) => ({
      placeName: title.placeName,
      roleName: title.roleName,
      posthumousName: title.posthumousName,
      dynasty: title.dynasty,
      ref: title.ref,
      source: `Norbert:${title.ref}`,
    })),
  );
}

export async function buildPackNameIndex(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, AuthorityEnrichment>> {
  if (!packNameIndexPromise) {
    packNameIndexPromise = buildPackNameIndexUncached(readPackFile).catch((error) => {
      packNameIndexPromise = null;
      throw error;
    });
  }
  return packNameIndexPromise;
}

const PERSON_ENRICHMENT_PACKS: { packId: AuthorityPackId; source: string }[] = [
  { packId: 'cbdb-persons', source: 'CBDB' },
  { packId: 'dila-persons', source: 'DILA' },
  // Norbert's persons pack carries names, dates, nationality, and
  // place-of-origin assertions alongside CBDB/DILA-style metadata.
  { packId: 'norbert-persons', source: 'NORBERT' },
];

const OFFICE_ENRICHMENT_PACKS: { packId: AuthorityPackId; source: string }[] = [
  { packId: 'cbdb-offices', source: 'CBDB' },
  { packId: 'norbert-offices', source: 'NORBERT' },
];

/** CBDB/CHGIS are the two place sources with real coordinate coverage —
 * see docs/placename-geo-disambiguation-planning.md Phase 0/1. DILA is
 * dropped (0.3% coverage, not worth a pack read here). */
const PLACE_ENRICHMENT_PACKS: { packId: AuthorityPackId; source: string }[] = [
  { packId: 'cbdb-places', source: 'CBDB' },
  { packId: 'chgis-places', source: 'CHGIS' },
];

function addPackRowToNameIndex(
  index: Map<string, AuthorityEnrichment>,
  source: string,
  row: AuthorityCandidate,
): void {
  const typed = typedNamesFromPackRow(row.names);
  if (typed.length === 0 && !row.metadata) return;
  const enrichment = {
    names: typed,
    primaryName: row.primaryName,
    metadata: row.metadata,
  };
  const idKeys =
    source === 'NORBERT'
      ? norbertAuthorityLookupValues(String(row.authorityId ?? ''))
      : [String(row.authorityId ?? '').trim()].filter(Boolean);
  for (const idKey of idKeys) {
    index.set(`${source}:${idKey}`, enrichment);
  }
}

async function buildPackNameIndexUncached(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, AuthorityEnrichment>> {
  const index = new Map<string, AuthorityEnrichment>();
  for (const { packId, source } of PERSON_ENRICHMENT_PACKS) {
    try {
      const content = await readPackFile(packId);
      for (const row of iterateAuthorityNdjson(content)) {
        addPackRowToNameIndex(index, source, row);
      }
    } catch {
      // Pack missing or unreadable — skip silently.
    }
  }
  return index;
}

export type AuthorityPackRowsByIdsFn = (
  packId: AuthorityPackId,
  authorityIds: string[],
) => Promise<AuthorityPackContent>;

/**
 * Build a pack enrichment index for only the authority ids already linked to
 * entities. Prefer {@link lookupPackRowsByIds} (main-process stream) so the
 * renderer never materializes the full CBDB persons pack.
 */
export async function buildPackNameIndexForAuthorities(
  authorities: readonly { type: string; value: string }[],
  options: {
    lookupPackRowsByIds?: AuthorityPackRowsByIdsFn;
    readPackFile?: (packId: AuthorityPackId) => Promise<AuthorityPackContent>;
    onPackProgress?: (label: string) => void;
  },
): Promise<Map<string, AuthorityEnrichment>> {
  const idsBySource = new Map<string, Set<string>>();
  for (const auth of authorities) {
    const source = auth.type.trim().toUpperCase();
    if (source !== 'CBDB' && source !== 'DILA' && source !== 'NORBERT') continue;
    const set = idsBySource.get(source) ?? new Set<string>();
    if (source === 'NORBERT') {
      for (const key of norbertAuthorityLookupValues(auth.value)) set.add(key);
    } else {
      const id = auth.value.trim();
      if (id) set.add(id);
    }
    idsBySource.set(source, set);
  }

  const index = new Map<string, AuthorityEnrichment>();
  for (const { packId, source } of PERSON_ENRICHMENT_PACKS) {
    const ids = [...(idsBySource.get(source) ?? [])];
    if (ids.length === 0) continue;
    options.onPackProgress?.(`Reading ${source} pack…`);
    try {
      let content: AuthorityPackContent | undefined;
      if (options.lookupPackRowsByIds) {
        content = await options.lookupPackRowsByIds(packId, ids);
      } else if (options.readPackFile) {
        // Fallback: load the pack then filter. Avoid this for CBDB in the UI.
        const all = await options.readPackFile(packId);
        const wanted = new Set(ids);
        const lines: string[] = [];
        for (const row of iterateAuthorityNdjson(all)) {
          const id = String(row.authorityId ?? '').trim();
          if (!id || !wanted.has(id)) continue;
          lines.push(JSON.stringify(row));
          wanted.delete(id);
          if (wanted.size === 0) break;
        }
        content = lines;
      }
      if (!content) continue;
      for (const row of iterateAuthorityNdjson(content)) {
        addPackRowToNameIndex(index, source, row);
      }
    } catch {
      // Pack missing or unreadable — skip silently.
    }
  }
  return index;
}

/**
 * Same as {@link buildPackNameIndexForAuthorities} but for office packs —
 * used to pull `metadata.translation` onto office entity cards.
 */
export async function buildOfficePackNameIndexForAuthorities(
  authorities: readonly { type: string; value: string }[],
  options: {
    lookupPackRowsByIds?: AuthorityPackRowsByIdsFn;
    readPackFile?: (packId: AuthorityPackId) => Promise<AuthorityPackContent>;
    onPackProgress?: (label: string) => void;
  },
): Promise<Map<string, AuthorityEnrichment>> {
  const idsBySource = new Map<string, Set<string>>();
  for (const auth of authorities) {
    const source = auth.type.trim().toUpperCase();
    if (source !== 'CBDB' && source !== 'NORBERT') continue;
    const set = idsBySource.get(source) ?? new Set<string>();
    if (source === 'NORBERT') {
      for (const key of norbertAuthorityLookupValues(auth.value)) set.add(key);
    } else {
      const id = auth.value.trim();
      if (id) set.add(id);
    }
    idsBySource.set(source, set);
  }

  const index = new Map<string, AuthorityEnrichment>();
  for (const { packId, source } of OFFICE_ENRICHMENT_PACKS) {
    const ids = [...(idsBySource.get(source) ?? [])];
    if (ids.length === 0) continue;
    options.onPackProgress?.(`Reading ${source} offices…`);
    try {
      let content: AuthorityPackContent | undefined;
      if (options.lookupPackRowsByIds) {
        content = await options.lookupPackRowsByIds(packId, ids);
      } else if (options.readPackFile) {
        const all = await options.readPackFile(packId);
        const wanted = new Set(ids);
        const lines: string[] = [];
        for (const row of iterateAuthorityNdjson(all)) {
          const id = String(row.authorityId ?? '').trim();
          if (!id || !wanted.has(id)) continue;
          lines.push(JSON.stringify(row));
          wanted.delete(id);
          if (wanted.size === 0) break;
        }
        content = lines;
      }
      if (!content) continue;
      for (const row of iterateAuthorityNdjson(content)) {
        addPackRowToNameIndex(index, source, row);
      }
    } catch {
      // Pack missing or unreadable — skip silently.
    }
  }
  return index;
}

/**
 * Same as {@link buildOfficePackNameIndexForAuthorities} but for place packs
 * (CBDB/CHGIS) — used to pull `metadata.geo` onto place entity cards.
 */
export async function buildPlacePackIndexForAuthorities(
  authorities: readonly { type: string; value: string }[],
  options: {
    lookupPackRowsByIds?: AuthorityPackRowsByIdsFn;
    readPackFile?: (packId: AuthorityPackId) => Promise<AuthorityPackContent>;
    onPackProgress?: (label: string) => void;
  },
): Promise<Map<string, AuthorityEnrichment>> {
  const idsBySource = new Map<string, Set<string>>();
  for (const auth of authorities) {
    const source = auth.type.trim().toUpperCase();
    if (source !== 'CBDB' && source !== 'CHGIS') continue;
    const set = idsBySource.get(source) ?? new Set<string>();
    const id = auth.value.trim();
    if (id) set.add(id);
    idsBySource.set(source, set);
  }

  const index = new Map<string, AuthorityEnrichment>();
  for (const { packId, source } of PLACE_ENRICHMENT_PACKS) {
    const ids = [...(idsBySource.get(source) ?? [])];
    if (ids.length === 0) continue;
    options.onPackProgress?.(`Reading ${source} places…`);
    try {
      let content: AuthorityPackContent | undefined;
      if (options.lookupPackRowsByIds) {
        content = await options.lookupPackRowsByIds(packId, ids);
      } else if (options.readPackFile) {
        const all = await options.readPackFile(packId);
        const wanted = new Set(ids);
        const lines: string[] = [];
        for (const row of iterateAuthorityNdjson(all)) {
          const id = String(row.authorityId ?? '').trim();
          if (!id || !wanted.has(id)) continue;
          lines.push(JSON.stringify(row));
          wanted.delete(id);
          if (wanted.size === 0) break;
        }
        content = lines;
      }
      if (!content) continue;
      for (const row of iterateAuthorityNdjson(content)) {
        addPackRowToNameIndex(index, source, row);
      }
    } catch {
      // Pack missing or unreadable — skip silently.
    }
  }
  return index;
}

/**
 * Noble-title index from already-loaded Norbert person enrichments (avoids a
 * second full `norbert-persons` read during targeted backfill).
 */
export function nobleTitleIndexFromPackNameIndex(
  packIndex: Map<string, AuthorityEnrichment>,
): Map<string, NorbertNobleTitleCandidate[]> {
  const index = new Map<string, NorbertNobleTitleCandidate[]>();
  for (const [key, enrichment] of packIndex) {
    if (!key.startsWith('NORBERT:')) continue;
    const titles = enrichment.metadata?.nobleTitles;
    if (!Array.isArray(titles) || titles.length === 0) continue;
    const rawPersonId = key.slice('NORBERT:'.length);
    const personId = formatNorbertAuthorityValue('person', rawPersonId);
    const list = index.get(personId) ?? [];
    for (const title of titles) {
      if (!title?.fief && !title?.roleName) continue;
      list.push({
        placeName: title.fief ?? '',
        roleName: title.roleName ?? '',
        posthumousName: title.posthumousName,
        posthumousNameAbbr: title.posthumousNameAbbr,
        dynasty: enrichment.metadata?.dynasty,
        ref: `person:${personId}`,
      });
    }
    if (!list.length) continue;
    index.set(personId, list);
    for (const alias of norbertAuthorityLookupValues(personId)) {
      if (alias !== personId) index.set(alias, list);
    }
  }
  return index;
}

/**
 * Unique office primary-name → authority id map for safe PEDB backfill.
 * Homonyms (same name, multiple pack rows) are dropped — never attach by name
 * alone when the match is ambiguous.
 */
export async function buildUniqueOfficeAuthorityByName(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, { type: 'NORBERT' | 'CBDB'; value: string }[]>> {
  if (!officeAuthorityByNamePromise) {
    officeAuthorityByNamePromise = buildUniqueOfficeAuthorityByNameUncached(readPackFile).catch(
      (error) => {
        officeAuthorityByNamePromise = null;
        throw error;
      },
    );
  }
  return officeAuthorityByNamePromise;
}

async function buildUniqueOfficeAuthorityByNameUncached(
  readPackFile: (packId: AuthorityPackId) => Promise<AuthorityPackContent>,
): Promise<Map<string, { type: 'NORBERT' | 'CBDB'; value: string }[]>> {
  const packs: { packId: AuthorityPackId; type: 'NORBERT' | 'CBDB' }[] = [
    { packId: 'norbert-offices', type: 'NORBERT' },
    { packId: 'cbdb-offices', type: 'CBDB' },
  ];
  /** name → type → set of authority ids seen */
  const byName = new Map<string, Map<string, Set<string>>>();
  for (const { packId, type } of packs) {
    try {
      const content = await readPackFile(packId);
      for (const row of iterateAuthorityNdjson(content)) {
        const name = row.primaryName?.normalize('NFC').trim();
        const value = row.authorityId == null ? '' : String(row.authorityId).trim();
        if (!name || !value) continue;
        const typeMap = byName.get(name) ?? new Map();
        const ids = typeMap.get(type) ?? new Set();
        ids.add(type === 'NORBERT' ? formatNorbertAuthorityValue('office', value) : value);
        typeMap.set(type, ids);
        byName.set(name, typeMap);
      }
    } catch {
      // Pack missing or unreadable — skip silently.
    }
  }
  const out = new Map<string, { type: 'NORBERT' | 'CBDB'; value: string }[]>();
  for (const [name, typeMap] of byName) {
    const unique: { type: 'NORBERT' | 'CBDB'; value: string }[] = [];
    for (const [type, ids] of typeMap) {
      if (ids.size !== 1) continue;
      unique.push({ type: type as 'NORBERT' | 'CBDB', value: [...ids][0]! });
    }
    if (unique.length) out.set(name, unique);
  }
  return out;
}

export function packTypedNamesForEntity(
  entity: Pick<EntitySummary, 'authorities'>,
  index: Map<string, AuthorityEnrichment> | null,
): TypedName[] {
  if (!index) return [];
  const byText = new Map<string, TypedName>();
  for (const auth of entity.authorities) {
    // Normalize casing to match buildPackNameIndex's keys (and
    // authorityEnrichmentsForEntity's lookup below) — idno @type casing
    // varies by source (e.g. "Norbert" vs "CBDB"/"DILA").
    const source = auth.type.trim().toUpperCase();
    const values =
      source === 'NORBERT' ? norbertAuthorityLookupValues(auth.value) : [auth.value.trim()];
    for (const value of values) {
      const enrichment = index.get(`${source}:${value}`);
      if (!enrichment) continue;
      for (const name of enrichment.names) {
        byText.set(name.text.normalize('NFC'), name);
      }
    }
  }
  return [...byText.values()];
}

export function authorityEnrichmentForEntity(
  entity: Pick<EntitySummary, 'authorities'>,
  index: Map<string, AuthorityEnrichment> | null,
): AuthorityCandidate['metadata'] | undefined {
  if (!index) return undefined;
  const rows = authorityEnrichmentsForEntity(entity, index)
    .map(({ enrichment }) => enrichment.metadata)
    .filter((metadata): metadata is NonNullable<AuthorityCandidate['metadata']> =>
      Boolean(metadata),
    );
  if (rows.length === 0) return undefined;
  return {
    ...rows[0],
    startYear: rows.find((row) => row.startYear != null)?.startYear,
    endYear: rows.find((row) => row.endYear != null)?.endYear,
    nationality: [
      ...new Map(
        rows.flatMap((row) => row.nationality ?? []).map((value) => [value.canonicalId, value]),
      ).values(),
    ],
    origin: [
      ...new Map(
        rows
          .flatMap((row) => row.origin ?? [])
          .map((value) => [`${value.source}:${value.placeAuthorityId ?? value.placeName}`, value]),
      ).values(),
    ],
    appointments: [
      ...new Map(
        rows
          .flatMap((row) => row.appointments ?? [])
          .map((value) => [`${value.source}:${value.authorityId}`, value]),
      ).values(),
    ],
  };
}

/** Return every pack enrichment linked to an entity, retaining its source. */
export function authorityEnrichmentsForEntity(
  entity: Pick<EntitySummary, 'authorities'>,
  index: Map<string, AuthorityEnrichment> | null,
): { source: string; enrichment: AuthorityEnrichment }[] {
  if (!index) return [];
  return entity.authorities.flatMap((auth) => {
    const source = auth.type.trim().toUpperCase();
    const values =
      source === 'NORBERT' ? norbertAuthorityLookupValues(auth.value) : [auth.value.trim()];
    for (const value of values) {
      const enrichment = index.get(`${source}:${value}`);
      if (enrichment) return [{ source, enrichment }];
    }
    return [];
  });
}

export function firstAuthorityEnrichment(
  entity: Pick<EntitySummary, 'authorities'>,
  index: Map<string, AuthorityEnrichment> | null,
): AuthorityEnrichment | undefined {
  return authorityEnrichmentsForEntity(entity, index)[0]?.enrichment;
}

/** Apply the same scalar/repeatable authority fields written when disambiguating. */
function applyAuthorityMetadata(
  doc: Document,
  entityId: string,
  metadata: AuthorityCandidate['metadata'] | undefined,
  source: string,
): boolean {
  if (!metadata) return false;
  const item = findEntity(doc, entityId);
  if (!item) return false;
  const normalizedSource = source.trim().toUpperCase();
  let changed = appendAuthorityDates(doc, item, source, biographicalYearsFromMetadata(metadata));
  if (metadata.nationality?.length) {
    const nationalityChanged = appendAuthoritySourcedValues(
      doc,
      item,
      'nationality',
      metadata.nationality.map((value) => ({
        text: value.label,
        ref: value.canonicalId,
        source: normalizedSource,
      })),
    );
    changed = changed || nationalityChanged;
  }
  if (metadata.origin?.length) {
    const originChanged = appendAuthoritySourcedValues(
      doc,
      item,
      'placeName',
      metadata.origin
        .filter((value) => value.placeName?.trim())
        .map((value) => ({
          text: value.placeName,
          ref: value.placeAuthorityId,
          source: value.source ?? normalizedSource,
          type: value.originType,
        })),
    );
    changed = changed || originChanged;
  }
  if (metadata.appointments?.length) {
    const sourceNote = Array.from(item.children).find(
      (child) =>
        child.localName === 'note' &&
        child.getAttribute('type') === 'authority-cache' &&
        child.getAttribute('source') === source.trim().toUpperCase(),
    );
    const previous = sourceNote?.textContent ?? '';
    const next = JSON.stringify(metadata);
    if (previous !== next) {
      setAuthorityCache(doc, entityId, source.trim().toUpperCase(), metadata);
      changed = true;
    }
    const rolesChanged = appendAuthoritySourcedValues(
      doc,
      item,
      'affiliation',
      metadata.appointments
        .filter((appointment) => appointment.office?.name?.trim())
        .map((appointment) => ({
          text: appointment.office.name,
          ref: appointment.office.authorityId,
          source: appointment.source ?? normalizedSource,
        })),
    );
    changed = changed || rolesChanged;
  }
  if (changed) touchEntity(item);
  return changed;
}

function nameTypeForText(
  doc: Document,
  entityId: string,
  text: string,
): NameTypeId | null | undefined {
  return listEntities(doc)
    .find((entity) => entity.id === entityId)
    ?.nameEntries.find((entry) => entry.text === text)?.type;
}

/**
 * Apply one typed name non-destructively. Returns true when a new name was added
 * or an existing untyped name was upgraded with `@type`.
 */
function applyTypedName(
  doc: Document,
  entityId: string,
  typed: TypedName,
  source?: string,
): boolean {
  const beforeType = nameTypeForText(doc, entityId, typed.text);
  const added = addEntityName(doc, entityId, typed.text, {
    type: typed.type,
    lang: typed.lang,
    origin: 'authority',
    source,
  });
  if (added) return true;
  if (beforeType == null) {
    const afterType = nameTypeForText(doc, entityId, typed.text);
    return afterType === typed.type;
  }
  return false;
}

/**
 * Enrich persons with typed names from packs + Wikidata.
 * @param entityIds if provided, only those ids; else all persons with authorities
 */
export async function backfillEntityNames(
  doc: Document,
  options: {
    entityIds?: string[];
    readPackFile?: (packId: AuthorityPackId) => Promise<AuthorityPackContent>;
    projectLang?: string | null;
    desktopLanguage?: string | null;
    signal?: AbortSignal;
    onProgress?: (p: NameBackfillProgress) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<NameBackfillResult> {
  const { entityIds, readPackFile, projectLang, signal, onProgress, fetchImpl } = options;

  const allPersons = listEntities(doc).filter((entity) => entity.kind === 'person');
  const idFilter = entityIds ? new Set(entityIds) : null;
  const targets = allPersons.filter(
    (entity) => entity.authorities.length > 0 && (!idFilter || idFilter.has(entity.id)),
  );
  // Work / person→works minting lives on SQLite backfill (`sqliteAuthorityBackfill`).
  const totalTargets = targets.length;

  const skippedNoAuthority = idFilter
    ? entityIds!.filter((id) => {
        const entity = allPersons.find((row) => row.id === id);
        return !entity || entity.authorities.length === 0;
      }).length
    : allPersons.filter((entity) => entity.authorities.length === 0).length;

  const packIndex = readPackFile ? await buildPackNameIndex(readPackFile) : null;
  const nobleTitleIndex = readPackFile ? await buildNorbertNobleTitleIndex(readPackFile) : null;

  let entitiesScanned = 0;
  let entitiesUpdated = 0;
  let namesAdded = 0;
  let cancelled = false;

  for (const entity of targets) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    entitiesScanned++;
    let addedThisEntity = 0;
    let entityChanged = false;

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
    if (primaryName && primaryName !== entity.names[0]) {
      if (
        applyTypedName(
          doc,
          entity.id,
          { text: primaryName, type: 'variant' },
          entity.authorities[0]?.type,
        )
      ) {
        namesAdded++;
        entityChanged = true;
      }
    }
    candidate.startYear = metadata?.startYear;
    candidate.endYear = metadata?.endYear;
    candidate.authorityMetadata = metadata;

    const givenFamily = await collectGivenFamilyNamesForCandidate(
      candidate,
      projectLang,
      fetchImpl,
    );
    const familyNames = [
      ...(givenFamily.familyName ? [givenFamily.familyName] : []),
      ...(getFamilyName(doc, entity.id) ? [getFamilyName(doc, entity.id)!] : []),
      ...(candidate.typedNames ?? [])
        .filter((name) => name.type === 'family')
        .map((name) => name.text),
    ];
    const typedNames = normalizeTypedNamesForIntake(
      await collectTypedNamesForCandidate(candidate, fetchImpl),
      familyNames,
    );

    for (const typed of typedNames) {
      if (applyTypedName(doc, entity.id, typed, entity.authorities[0]?.type)) {
        addedThisEntity++;
        entityChanged = true;
      }
    }

    const preferred = preferCanonicalFamilyGiven(
      personalNameForSegmentation(
        entity.names[0] ?? null,
        typedNames,
        nobleTitlesFromMetadata(metadata),
      ),
      typedNames,
    );
    const nextFamily = givenFamily.familyName || preferred.familyName || null;
    const nextGiven = givenFamily.givenName || preferred.givenName || null;
    if (nextFamily && !getFamilyName(doc, entity.id)) {
      setFamilyName(doc, entity.id, nextFamily);
      entityChanged = true;
    } else if (
      nextFamily &&
      getFamilyName(doc, entity.id) &&
      getFamilyName(doc, entity.id) !== nextFamily
    ) {
      const packFamilies = new Set(
        typedNames.filter((name) => name.type === 'family').map((name) => name.text),
      );
      const currentFamily = getFamilyName(doc, entity.id)!;
      if (packFamilies.has(currentFamily)) {
        setFamilyName(doc, entity.id, nextFamily);
        entityChanged = true;
      } else if (
        !personalNameForSegmentation(
          entity.names[0] ?? null,
          typedNames,
          nobleTitlesFromMetadata(metadata),
        ) &&
        packFamilies.size > 0
      ) {
        // Title headword: replace an invented family with the pack surname.
        setFamilyName(doc, entity.id, nextFamily);
        entityChanged = true;
      }
    }
    if (nextGiven && !getGivenName(doc, entity.id)) {
      setGivenName(doc, entity.id, nextGiven);
      entityChanged = true;
    } else if (
      nextGiven &&
      getGivenName(doc, entity.id) &&
      getGivenName(doc, entity.id) !== nextGiven
    ) {
      const packGivens = new Set(
        typedNames.filter((name) => name.type === 'given').map((name) => name.text),
      );
      if (packGivens.has(getGivenName(doc, entity.id)!)) {
        setGivenName(doc, entity.id, nextGiven);
        entityChanged = true;
      }
    }

    // Norbert surname segmenter — only on personal names, never on title headwords.
    const splitSurface = personalNameForSegmentation(
      entity.names[0] ?? '',
      typedNames,
      nobleTitlesFromMetadata(metadata),
    );
    const norbertSplit = splitSurface
      ? suggestPersonNameSplit(splitSurface, projectLang ?? null)
      : null;
    if (norbertSplit?.familyName && !getFamilyName(doc, entity.id)) {
      setFamilyName(doc, entity.id, norbertSplit.familyName);
      entityChanged = true;
    }
    if (norbertSplit?.givenName && !getGivenName(doc, entity.id)) {
      setGivenName(doc, entity.id, norbertSplit.givenName);
      entityChanged = true;
    }
    if (!entity.romanized) {
      const authorityRomanized = metadata?.pinyin ?? metadata?.yomi;
      const romanized =
        authorityRomanized?.trim() ||
        (splitSurface ? suggestPersonRomanization(splitSurface, projectLang ?? null) : null);
      if (romanized) {
        setRomanizedName(doc, entity.id, romanized, projectLang ?? null);
        entityChanged = true;
      }
    }

    // Refresh every linked authority independently. Dates are stored as
    // source-specific assertions, so a DILA value is retained even when a
    // user value or another authority already supplied a different year.
    for (const { source, enrichment } of authorityEnrichmentsForEntity(entity, packIndex)) {
      if (applyAuthorityMetadata(doc, entity.id, enrichment.metadata, source)) {
        entityChanged = true;
      }
    }

    const norbertIdno = entity.authorities.find(
      (auth) => auth.type.trim().toUpperCase() === 'NORBERT',
    );
    if (norbertIdno && nobleTitleIndex) {
      let titles: NorbertNobleTitleCandidate[] | undefined;
      for (const key of norbertAuthorityLookupValues(norbertIdno.value)) {
        titles = nobleTitleIndex.get(key);
        if (titles?.length) break;
      }
      if (titles?.length && applyNorbertNobleTitles(doc, entity.id, titles)) {
        entityChanged = true;
      }
    }

    // Packs only cover CBDB/DILA; a Wikidata-linked entity needs its own
    // live fetch so refresh isn't a no-op for it.
    const wikidataIdno = entity.authorities.find(
      (auth) => auth.type.trim().toUpperCase() === 'WIKIDATA',
    );
    if (wikidataIdno) {
      const [lifespan, nationality, placeOfBirth] = await Promise.all([
        fetchWikidataLifespan(wikidataIdno.value, fetchImpl).catch(() => null),
        fetchWikidataNationality(wikidataIdno.value, fetchImpl, projectLang).catch(() => null),
        fetchWikidataPlaceOfBirth(wikidataIdno.value, fetchImpl, projectLang).catch(() => null),
      ]);
      if (lifespan || nationality || placeOfBirth) {
        const changed = applyAuthorityMetadata(
          doc,
          entity.id,
          {
            dateSource: 'fine',
            startYear: lifespan?.birthYear,
            endYear: lifespan?.deathYear,
            nationality: nationality?.map((value) => ({
              id: value.canonicalId,
              canonicalId: value.canonicalId,
              label: value.label,
            })),
            origin: placeOfBirth?.map((value) => ({
              placeName: value.label,
              placeAuthorityId: value.canonicalId,
              source: 'Wikidata',
            })),
          },
          'Wikidata',
        );
        if (changed) entityChanged = true;
      }
    }

    if (entityChanged) entitiesUpdated++;
    namesAdded += addedThisEntity;

    onProgress?.({
      done: entitiesScanned,
      total: totalTargets,
      entityId: entity.id,
      entityLabel: entity.names[0],
      addedNames: addedThisEntity,
    });
  }

  return {
    entitiesScanned,
    entitiesUpdated,
    namesAdded,
    skippedNoAuthority,
    cancelled,
  };
}
