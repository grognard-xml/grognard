/**
 * Entity-lookup services backed by installed authority packs (CBDB, DILA,
 * NDL): the same ndjson assets the auto-tagger uses, so lookup works offline
 * and matches every search-string variant a pack knows (alternate names,
 * NDL yomi readings, etc.).
 */
import type {
  AuthorityLookupParams,
  AuthorityLookupResult,
  AuthorityService,
  NamedEntityType,
} from '../types';
import {
  AUTHORITY_PACKS,
  type AuthorityPackDateFilter,
  type AuthorityPackId,
} from '../autoTagging/packPaths';
import { packReadFinished, packReadStarted } from '../autoTagging/authorityLoadProgress';
import { stringsMatchExactly } from '../autoTagging/disambiguationMatch';
import type { AuthorityCandidate } from '../autoTagging/authority';
import type { AuthorityPackContent } from '../autoTagging/packLoader';
import { bareNorbertAuthorityValue } from '../autoTagging/norbertAuthorityId';
import { clearNorbertExpanderCache } from '../autoTagging/norbertExpanderCache';
import { clearNorbertPersonConcordanceCache } from '../autoTagging/norbertPersonConcordance';
import { clearAuthorityPackEnrichmentCaches } from '../autoTagging/nameBackfill';
import {
  applyHuckbotGlossToPackRow,
  applyMaxiRicciGlossToPackRow,
  applyParentOfGlossToPackRow,
  clearOfficeGlossIndexCaches,
  loadHuckbotGlossIndex,
  loadHuckbotZhGlossIndex,
  loadMaxiRicciGlossIndex,
  loadParentOfIndex,
  type FrenchOfficeGlossIndex,
  type OfficeGlossIndex,
  type ParentOfIndex,
} from '../autoTagging/officeGlossLookup';
import { normalizeBdrcId } from '../autoTagging/bdrcIds';

export interface PackRow {
  authorityId?: string;
  primaryName?: string;
  displayName?: string;
  searchStrings?: string[];
  /** Typed names, when the pack export preserves name categories (字/號/…). */
  names?: { text: string; type?: string; lang?: string }[];
  metadata?: AuthorityCandidate['metadata'];
}

const MAX_RESULTS = 10;

type PackSource = 'cbdb' | 'dila' | 'chgis' | 'ndl' | 'norbert' | 'bdrc';

const SERVICES: {
  source: PackSource;
  id: string;
  name: string;
  url: string;
  packs: Partial<Record<NamedEntityType, AuthorityPackId>>;
}[] = [
  {
    source: 'cbdb',
    id: 'cbdb',
    name: 'CBDB',
    url: 'https://projects.iq.harvard.edu/cbdb',
    packs: { person: 'cbdb-persons', place: 'cbdb-places', office: 'cbdb-offices' },
  },
  {
    source: 'norbert',
    id: 'norbert',
    name: 'Norbert',
    url: 'urn:grognard:authority:norbert',
    packs: { person: 'norbert-persons', office: 'norbert-offices' },
  },
  {
    source: 'dila',
    id: 'dila',
    name: 'DILA',
    url: 'https://authority.dila.edu.tw/',
    packs: { person: 'dila-persons', place: 'dila-places' },
  },
  {
    source: 'chgis',
    id: 'chgis',
    name: 'CHGIS',
    url: 'urn:grognard:authority:chgis',
    packs: { place: 'chgis-places' },
  },
  {
    source: 'ndl',
    id: 'ndl',
    name: 'NDL',
    url: 'https://id.ndl.go.jp/auth/ndla',
    packs: {
      person: 'ndl-persons',
      place: 'ndl-places',
      organization: 'ndl-orgs',
      work: 'ndl-works',
      citation: 'ndl-works',
    },
  },
];

/**
 * BDRC lookup does not need the private BDRC CSV pack. Wikidata Tibetan packs
 * already carry P2477 (`crosswalk.bdrc`). The private pack is an extra name
 * list when it happens to be installed.
 */
const BDRC_LOOKUP_PACKS: Partial<
  Record<NamedEntityType, { packId: AuthorityPackId; packSource: 'wikidata' | 'bdrc' }[]>
> = {
  person: [
    { packId: 'wikidata-persons-bo', packSource: 'wikidata' },
    { packId: 'bdrc-persons-bo', packSource: 'bdrc' },
  ],
  place: [
    { packId: 'wikidata-places-bo', packSource: 'wikidata' },
    { packId: 'bdrc-places-bo', packSource: 'bdrc' },
  ],
  organization: [{ packId: 'wikidata-orgs-bo', packSource: 'wikidata' }],
};

function bdrcIdFromRow(row: PackRow, packSource: 'wikidata' | 'bdrc'): string | null {
  if (packSource === 'bdrc') return normalizeBdrcId(String(row.authorityId ?? ''));
  const entry = row.metadata?.crosswalk?.bdrc;
  const raw = Array.isArray(entry) ? entry[0] : entry;
  return raw ? normalizeBdrcId(String(raw)) : null;
}

/**
 * Find BDRC persons/places in a Wikidata (or private BDRC) pack.
 * Identifier queries (`P…`, `G…`, BUDA URL) match `crosswalk.bdrc` / pack id.
 * Name queries match search strings, but only on rows that already have a BDRC id.
 */
export function searchBdrcLookupContent(
  content: AuthorityPackContent,
  packSource: 'wikidata' | 'bdrc',
  entityType: NamedEntityType,
  query: string,
  limit: number = MAX_RESULTS,
): AuthorityLookupResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryId = normalizeBdrcId(trimmed);
  const needles = queryId ? [...new Set([queryId, queryId.toUpperCase()])] : [trimmed];
  const exact: AuthorityLookupResult[] = [];
  const seen = new Set<string>();

  const lineHasNeedle = (line: string) => needles.some((needle) => line.includes(needle));

  const tryLine = (line: string): void => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    let row: PackRow;
    try {
      row = JSON.parse(trimmedLine) as PackRow;
    } catch {
      return;
    }
    if (!row.primaryName) return;
    const bdrcId = bdrcIdFromRow(row, packSource);
    if (!bdrcId) return;
    if (queryId) {
      if (bdrcId.toUpperCase() !== queryId.toUpperCase()) return;
    } else {
      const strings = row.searchStrings?.length ? row.searchStrings : [row.primaryName];
      if (!strings.some((s) => stringsMatchExactly(s, trimmed))) return;
    }
    const uri = packResultUri('bdrc', entityType, bdrcId);
    if (seen.has(uri)) return;
    seen.add(uri);
    const displayName = row.displayName?.trim() || row.primaryName;
    const qid = packSource === 'wikidata' ? String(row.authorityId ?? '').toUpperCase() : '';
    const wikidataUrl = /^Q\d+$/i.test(qid) ? `https://www.wikidata.org/wiki/${qid}` : null;
    exact.push({
      label: displayName,
      description: [describePackRow(row) ?? `BDRC ${bdrcId}`, wikidataUrl]
        .filter(Boolean)
        .join(' · '),
      uri,
    });
  };

  if (Array.isArray(content)) {
    for (const line of content) {
      if (exact.length >= limit) break;
      if (lineHasNeedle(line)) tryLine(line);
    }
  } else {
    const text = content as string;
    let searchFrom = 0;
    while (exact.length < limit) {
      let hit = -1;
      for (const needle of needles) {
        const at = text.indexOf(needle, searchFrom);
        if (at !== -1 && (hit === -1 || at < hit)) hit = at;
      }
      if (hit === -1) break;
      const lineStart = text.lastIndexOf('\n', hit) + 1;
      const nextNewline = text.indexOf('\n', hit);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      tryLine(text.slice(lineStart, lineEnd));
      searchFrom = lineEnd + 1;
    }
  }
  return exact;
}

/**
 * Canonical record URL, parseable back to (authority, id) by
 * `parseAuthorityUri` so resolve-on-select recognizes the pick.
 */
export function packResultUri(source: PackSource, entityType: NamedEntityType, id: string): string {
  switch (source) {
    case 'cbdb':
      return entityType === 'office'
        ? `urn:grognard:authority:cbdb:office:${id}`
        : entityType === 'place'
          ? `https://cbdb.fas.harvard.edu/cbdbapi/place.php?id=${id}`
          : `https://cbdb.fas.harvard.edu/cbdbapi/person.php?id=${id}`;
    case 'dila':
      return entityType === 'place'
        ? `https://authority.dila.edu.tw/place/?fromInner=${id}`
        : `https://authority.dila.edu.tw/person/?fromInner=${id}`;
    // CHGIS has no per-record public lookup page (unlike CBDB/DILA) — a
    // stable synthetic urn, like norbert's, is enough for id/de-dup purposes.
    case 'chgis':
      return `urn:grognard:authority:chgis:${entityType}:${id}`;
    case 'ndl':
      // Assumes name authorities (ndlna); refine if a pack ships ndlsh ids.
      return `https://id.ndl.go.jp/auth/ndlna/${id}`;
    case 'norbert':
      // Packs store typed ids (`office-4135`); URN keeps kind + bare numeric.
      return `urn:grognard:authority:norbert:${entityType}:${bareNorbertAuthorityValue(id)}`;
    case 'bdrc':
      return `https://library.bdrc.io/show/bdr:${id.replace(/^bdr:/i, '')}`;
  }
}

export function describePackRow(row: PackRow): string | undefined {
  const meta = row.metadata;
  if (!meta) return undefined;
  if (meta.description) return meta.description;
  const years =
    meta.startYear != null || meta.endYear != null
      ? `${meta.startYear ?? '?'}–${meta.endYear ?? '?'}`
      : undefined;
  const parts = [meta.dynasty, years, meta.pinyin ?? meta.yomi, meta.translation].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function describeRow(row: PackRow): string | undefined {
  return describePackRow(row);
}

/**
 * Scan pack ndjson for rows whose search strings match the query exactly
 * (Unicode-normalized). A row's alternate names (e.g. 王導's alt name
 * 王茂弘) are only ever compared for equality against the query — never
 * substring-contained — so a query like 王茂 cannot spuriously match a
 * longer alt name that merely contains it. Lines are substring-prefiltered
 * before JSON parsing, so scanning a large pack per search stays cheap.
 */
export function searchPackContent(
  content: AuthorityPackContent,
  source: PackSource,
  entityType: NamedEntityType,
  query: string,
  limit: number = MAX_RESULTS,
  officeGlosses?: OfficeGlossIndex,
  frenchOfficeGlosses?: FrenchOfficeGlossIndex,
  parentOfIndex?: ParentOfIndex,
  enZhGlosses?: Map<string, string>,
): AuthorityLookupResult[] {
  return searchPackRows(
    content,
    source,
    entityType,
    query,
    limit,
    officeGlosses,
    frenchOfficeGlosses,
    parentOfIndex,
    enZhGlosses,
  ).map((match) => match.result);
}

export interface PackSearchMatch {
  result: AuthorityLookupResult;
  /** The parsed ndjson row the result came from (authorityId, metadata, …). */
  row: PackRow;
}

/**
 * Like {@link searchPackContent}, but also returns each match's parsed pack row
 * so callers needing metadata (years, dynasty, authorityId) don't have to
 * re-parse the whole pack to recover it.
 */
export function searchPackRows(
  content: AuthorityPackContent,
  source: PackSource,
  entityType: NamedEntityType,
  query: string,
  limit: number = MAX_RESULTS,
  officeGlosses?: OfficeGlossIndex,
  frenchOfficeGlosses?: FrenchOfficeGlossIndex,
  parentOfIndex?: ParentOfIndex,
  enZhGlosses?: Map<string, string>,
): PackSearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // For place names, also try stripping a trailing administrative division
  // marker (省 市 區 府 縣 郡) so "會稽省" matches a pack row named "會稽" — but
  // keep the raw query too, since many DILA/CBDB place names legitimately end
  // in one of these characters as part of the canonical name (e.g. "武陵郡").
  const queries = [trimmed];
  if (entityType === 'place') {
    const stripped = trimmed.replace(/[省市區府縣郡]$/, '');
    if (stripped && stripped !== trimmed) queries.push(stripped);
  }
  // The shortest query is a prefix of every other query, so requiring the line
  // to contain it is a safe (inclusive) prefilter before the exact-match check.
  const shortestQuery = queries.reduce((a, b) => (b.length < a.length ? b : a));

  const exact: PackSearchMatch[] = [];
  const seen = new Set<string>();

  // A hit only ever adds one row, so this is shared between both scan
  // strategies below — the difference is just how each locates candidate lines.
  const tryLine = (line: string): void => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    let row: PackRow;
    try {
      row = JSON.parse(trimmedLine) as PackRow;
    } catch {
      return;
    }
    if (!row.authorityId || !row.primaryName) return;
    // Captured here, before the gloss passes: both only ever touch `row.metadata`,
    // but their generic signature re-widens `primaryName` back to optional, losing
    // the narrowing from the guard above.
    const primaryName = row.primaryName;
    if (entityType === 'office' && officeGlosses?.size) {
      row = applyHuckbotGlossToPackRow(row, source, officeGlosses);
    }
    if (entityType === 'office' && frenchOfficeGlosses) {
      row = applyMaxiRicciGlossToPackRow(row, source, frenchOfficeGlosses);
    }
    if (entityType === 'office' && parentOfIndex?.size) {
      row = applyParentOfGlossToPackRow(
        row,
        parentOfIndex,
        enZhGlosses ?? new Map(),
        frenchOfficeGlosses?.byZh ?? new Map(),
      );
    }

    const strings = row.searchStrings?.length ? row.searchStrings : [primaryName];
    // Track which search string actually matched — for places it may be an
    // alternate/historical name (e.g. DILA tags 吳興 as an alias of 湖州府),
    // not the row's primary name, so it's worth surfacing why this row matched.
    let matchedString: string | undefined;
    for (const q of queries) {
      matchedString = strings.find((s) => stringsMatchExactly(s, q));
      if (matchedString) break;
    }
    if (!matchedString) return;

    const uri = packResultUri(source, entityType, String(row.authorityId));
    if (seen.has(uri)) return;
    seen.add(uri);

    const displayName = row.displayName?.trim() || primaryName;
    const label =
      entityType === 'place' && matchedString !== displayName
        ? `${displayName}（${matchedString}）`
        : displayName;

    exact.push({
      result: {
        label,
        description: describeRow(row),
        uri,
      },
      row,
    });
  };

  if (Array.isArray(content)) {
    // Pack already split into lines (the desktop bridge's shape for packs too
    // large to hold as one string) — a plain scan, prefiltered the same way.
    for (const line of content) {
      if (exact.length >= limit) break;
      if (line.includes(shortestQuery)) tryLine(line);
    }
  } else {
    const text = content as string;
    // Scan with indexOf jumps instead of splitting into lines: a matching row
    // must contain the shortest candidate query verbatim, and hits are rare, so
    // letting the native string search skip over non-matching content avoids
    // allocating a line array and iterating hundreds of thousands of lines on
    // every lookup. Only the (few) lines containing a hit are sliced and parsed.
    let searchFrom = 0;
    while (exact.length < limit) {
      const hit = text.indexOf(shortestQuery, searchFrom);
      if (hit === -1) break;
      const lineStart = text.lastIndexOf('\n', hit) + 1;
      const nextNewline = text.indexOf('\n', hit);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      // Resume after this line — multiple hits within one line must not re-add it.
      searchFrom = lineEnd + 1;
      tryLine(text.slice(lineStart, lineEnd));
    }
  }

  return exact.slice(0, limit);
}

const ENTITY_TYPE_TAG: Partial<Record<NamedEntityType, string>> = {
  person: 'persName',
  place: 'placeName',
  organization: 'orgName',
  work: 'title',
  citation: 'title',
  office: 'roleName',
};

/** Restrict a pack list to those holding the given entity type (by pack tag). */
export function packIdsForEntityType(
  packIds: AuthorityPackId[],
  entityType: NamedEntityType,
): AuthorityPackId[] {
  const tag = ENTITY_TYPE_TAG[entityType];
  if (!tag) return [];
  return packIds.filter((id) => AUTHORITY_PACKS.find((spec) => spec.id === id)?.defaultTag === tag);
}

/** Session-lifetime cache of pack contents (packs only change on reinstall). */
const packContentCache = new Map<string, Promise<AuthorityPackContent>>();

const cacheKey = (packId: AuthorityPackId, dateFilter?: AuthorityPackDateFilter): string =>
  dateFilter
    ? `${packId}:${dateFilter.mode}:${Math.min(dateFilter.start, dateFilter.end)}:${Math.max(dateFilter.start, dateFilter.end)}`
    : packId;

export function readPackCached(
  packId: AuthorityPackId,
  dateFilter?: AuthorityPackDateFilter,
): Promise<AuthorityPackContent> {
  const readPack = window.electronAPI?.authorityPackRead;
  if (!readPack) return Promise.reject(new Error('Authority packs unavailable'));
  const key = cacheKey(packId, dateFilter);
  let cached = packContentCache.get(key);
  if (!cached) {
    packReadStarted();
    cached = readPack(packId, dateFilter)
      .catch((error: unknown) => {
        packContentCache.delete(key);
        throw error;
      })
      .finally(packReadFinished);
    packContentCache.set(key, cached);
  }
  return cached;
}

/**
 * Session-cached pack reader for callers that take an optional reader, or
 * undefined when the desktop bridge is unavailable. Prefer this over passing
 * `window.electronAPI?.authorityPackRead` directly — the raw bridge call
 * re-reads the multi-megabyte ndjson file over IPC on every invocation.
 */
export function cachedPackReader():
  ((packId: AuthorityPackId) => Promise<AuthorityPackContent>) | undefined {
  return window.electronAPI?.authorityPackRead ? readPackCached : undefined;
}

/**
 * Main-process filtered pack reader for backfill. Returns only NDJSON lines for
 * the requested authority ids — safe for CBDB persons (~570MB full pack).
 */
export function packRowsByIdsReader():
  ((packId: AuthorityPackId, authorityIds: string[]) => Promise<AuthorityPackContent>) | undefined {
  const lookup = window.electronAPI?.authorityPackLookupByIds;
  return lookup ? (packId, authorityIds) => lookup(packId, authorityIds) : undefined;
}

/**
 * Reader for one-shot operations such as tag bomb. Do not retain the raw
 * NDJSON arrays in the session cache while the operation builds its own
 * parsed index; that doubles the live memory for the duration of the run.
 */
export function uncachedPackReader():
  | ((
      packId: AuthorityPackId,
      dateFilter?: AuthorityPackDateFilter,
    ) => Promise<AuthorityPackContent>)
  | undefined {
  const readPack = window.electronAPI?.authorityPackRead;
  return readPack ? (packId, dateFilter) => readPack(packId, dateFilter) : undefined;
}

/**
 * Drop cached pack contents so a subsequent read re-fetches from disk.
 * Call after any (re)install so the tag-bomb dialog and lookup services pick
 * up new file contents without requiring an app restart. Omit `packIds` to
 * clear everything (e.g. after a plugin enable/reinstall, whose set of
 * touched packs isn't known to the caller).
 */
export function clearPackContentCache(packIds?: AuthorityPackId[]): void {
  // Norbert's derived wrapper/title candidates depend on the same pack files.
  clearNorbertExpanderCache();
  // Backfill enrichment indexes are built from the same packs.
  clearAuthorityPackEnrichmentCaches();
  clearOfficeGlossIndexCaches();
  clearNorbertPersonConcordanceCache();
  if (!packIds) {
    packContentCache.clear();
    return;
  }
  for (const packId of packIds) {
    for (const key of packContentCache.keys()) {
      if (key === packId || key.startsWith(`${packId}:`)) packContentCache.delete(key);
    }
  }
}

async function installedPackIds(): Promise<Set<AuthorityPackId>> {
  const statuses = (await window.electronAPI?.authorityPackStatuses?.()) ?? [];
  return new Set(statuses.filter((status) => status.installed).map((status) => status.id));
}

function makeSearch(spec: (typeof SERVICES)[number]) {
  return async ({ query, entityType }: AuthorityLookupParams): Promise<AuthorityLookupResult[]> => {
    const packId = spec.packs[entityType];
    if (!packId) return [];
    if (!(await installedPackIds()).has(packId)) return [];
    const content = await readPackCached(packId);
    const officeGlosses =
      entityType === 'office' ? await loadHuckbotGlossIndex(readPackCached) : undefined;
    const frenchOfficeGlosses =
      entityType === 'office' ? await loadMaxiRicciGlossIndex(readPackCached) : undefined;
    const parentOfIndex =
      entityType === 'office' ? await loadParentOfIndex(readPackCached) : undefined;
    const enZhGlosses =
      entityType === 'office' ? await loadHuckbotZhGlossIndex(readPackCached) : undefined;
    return searchPackContent(
      content,
      spec.source,
      entityType,
      query,
      undefined,
      officeGlosses,
      frenchOfficeGlosses,
      parentOfIndex,
      enZhGlosses,
    );
  };
}

function makeBdrcSearch() {
  return async ({ query, entityType }: AuthorityLookupParams): Promise<AuthorityLookupResult[]> => {
    const specs = BDRC_LOOKUP_PACKS[entityType];
    if (!specs?.length) return [];
    const installed = await installedPackIds();
    const out: AuthorityLookupResult[] = [];
    const seen = new Set<string>();
    for (const spec of specs) {
      if (!installed.has(spec.packId)) continue;
      const content = await readPackCached(spec.packId);
      for (const row of searchBdrcLookupContent(content, spec.packSource, entityType, query)) {
        if (seen.has(row.uri)) continue;
        seen.add(row.uri);
        out.push(row);
        if (out.length >= MAX_RESULTS) return out;
      }
    }
    return out;
  };
}

/** Pack-backed lookup services (desktop only; empty when the bridge is missing). */
export function authorityPackLookupServices(): AuthorityService[] {
  if (typeof window === 'undefined' || !window.electronAPI?.authorityPackRead) return [];

  const packServices = SERVICES.map((spec) => ({
    id: spec.id,
    name: spec.name,
    url: spec.url,
    description: `${spec.name} authority (installed local packs)`,
    entityTypes: new Map(
      (Object.keys(spec.packs) as NamedEntityType[]).map((name) => [name, { name }]),
    ),
    isLocal: true,
    search: makeSearch(spec),
  }));

  const bdrcTypes = new Map(
    (Object.keys(BDRC_LOOKUP_PACKS) as NamedEntityType[]).map((name) => [name, { name }]),
  );

  return [
    ...packServices,
    {
      id: 'bdrc',
      name: 'BDRC',
      url: 'https://library.bdrc.io',
      description:
        'BDRC (BUDA) is a closed catalogue and forbids scraping their website. Lookup uses Wikidata identifiers (P2477), not library.bdrc.io. Links still open the official BUDA page.',
      entityTypes: bdrcTypes,
      isLocal: true,
      search: makeBdrcSearch(),
    },
  ];
}
