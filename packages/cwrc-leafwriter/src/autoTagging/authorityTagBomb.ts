import {
  candidatePassesDateFilter,
  dateFilterForLookup,
  iterateAuthorityNdjson,
  type AuthorityPackContent,
  type DateRangeFilter,
} from './packLoader';
import {
  AUTHORITY_PACKS,
  authorityPackOrigin,
  expandAuthorityPackIds,
  type AuthorityPackId,
} from './packPaths';
import type { AuthorityCandidate } from './authority';
import {
  filterCandidateForPhase1,
  resolveNameTypeTaggingPolicy,
  type NameTypeTaggingPolicy,
} from './nameTypeTaggingPolicy';
import {
  applyHuckbotGlossToCandidate,
  applyMaxiRicciGlossToCandidate,
  applyParentOfGlossToCandidate,
  loadHuckbotGlossIndex,
  loadHuckbotZhGlossIndex,
  loadMaxiRicciGlossIndex,
  loadParentOfIndex,
} from './officeGlossLookup';

/** CBDB before DILA so overlap merge prefers CBDB metadata as the base. CHGIS before DILA for place dates. */
const PACK_LOAD_ORDER: AuthorityPackId[] = [
  'cbdb-persons',
  'cbdb-places',
  'cbdb-offices',
  'chgis-places',
  'dila-persons',
  'dila-places',
  'wikidata-persons-pre-ming',
  'wikidata-persons-ming',
  'wikidata-persons-qing',
  'wikidata-persons-ja',
  'wikidata-persons-bo',
  'bdrc-persons-bo',
  'wikidata-places-zh-hant',
  'bdrc-places-bo',
  'wikidata-places-ja',
  'wikidata-places-bo',
  'wikidata-orgs-zh-hant',
  'wikidata-orgs-ja',
  'wikidata-orgs-bo',
  'wikidata-works-zh-hant',
  'wikidata-works-ja',
  'ndl-persons',
  'ndl-places',
  'ndl-orgs',
  'ndl-works',
  'norbert-persons',
  'norbert-person-wrappers',
  'norbert-wiki-nt',
  'noble-title-filter',
  'norbert-offices',
];

const sortPackIds = (packIds: AuthorityPackId[]): AuthorityPackId[] =>
  [...packIds].sort((a, b) => PACK_LOAD_ORDER.indexOf(a) - PACK_LOAD_ORDER.indexOf(b));
import {
  addCandidateToSeedIndex,
  createAuthoritySeedIndex,
  seedSuggestionsFromIndex,
  suggestionsFromSeedMatches,
} from './seed';
import { dedupeSuggestionsByLocation } from './suggestionFilters';
import type { Suggestion, WhitespacePolicy } from './types';
import { expandNorbertWikiNtCandidate } from './norbertWikiNt';
import { applyNobleTitleFilter, buildNobleTitleFilterIndex } from './nobleTitleFilter';

/** Review panel cap in the app; harness runs should omit this. */
export const MAX_AUTHORITY_SUGGESTIONS = 2000;

export interface AuthorityTagBombOptions {
  /** Phase B: match on milestone projection text (default off until Phase C apply). */
  useProjectionMatcher?: boolean;
  dateFilter?: DateRangeFilter;
  /** @deprecated Use {@link dateFilter}. */
  yearRange?: { start: number; end: number };
  /** @deprecated Use {@link dateFilter}. */
  hideUndated?: boolean;
  onProgress?: (message: string) => void;
  /** When set, cap suggestions (UI). Omit for full scoring in validation harness. */
  maxSuggestions?: number;
  /**
   * Pre-built candidates (e.g. from a PEDB/CEDB entities.xml, converted with
   * `candidatesFromEntityDatabase`) folded into the same seed index as the
   * NDJSON packs, subject to the same `dateFilter`. Grouped under `groupLabel`
   * in the returned `loaded` map (e.g. `'pedb-persons'`).
   */
  extraCandidates?: { groupLabel: string; candidates: AuthorityCandidate[] }[];
  /** When omitted, uses the Chinese default preset (legacy / test harness). */
  nameTypePolicy?: NameTypeTaggingPolicy;
}

export interface AuthorityTagBombResult {
  suggestions: Suggestion[];
  candidateCount: number;
  matchCount: number;
  loaded: Partial<Record<AuthorityPackId, number>>;
  truncated: boolean;
}

/**
 * Tag bomb on a document: stream NDJSON packs, build matcher index, return
 * tag-stage suggestions. Used by AutoTaggingSession and the validation harness.
 */
export async function runAuthorityTagBombOnDocument(
  doc: Document,
  packIds: AuthorityPackId[],
  readPackFile: (
    packId: AuthorityPackId,
    dateFilter?: DateRangeFilter,
  ) => Promise<AuthorityPackContent>,
  policy: WhitespacePolicy,
  options: AuthorityTagBombOptions = {},
): Promise<AuthorityTagBombResult> {
  // Widen past the UI-visible cutoff so near-contemporary people are not
  // dropped when the slider is set from a work year (or manually).
  const dateFilter: DateRangeFilter | undefined = dateFilterForLookup(
    options.dateFilter ??
      (options.yearRange
        ? {
            mode: 'limit',
            start: options.yearRange.start,
            end: options.yearRange.end,
          }
        : undefined),
  );

  const index = createAuthoritySeedIndex();
  const nameTypePolicy = options.nameTypePolicy ?? resolveNameTypeTaggingPolicy(undefined, null);
  const loaded: Partial<Record<AuthorityPackId, number>> = {};
  let candidateCount = 0;
  const norbertNamesByAuthorityId = new Map<string, string[]>();
  // The reviewed replacement pack is always loaded when installed. It is a
  // policy layer, not a user-selected authority source: otherwise an approved
  // title could re-enter as a generic persName whenever the source checkbox
  // changed.
  let nobleTitleFilter = buildNobleTitleFilterIndex([]);
  try {
    const filterContent = await readPackFile('noble-title-filter');
    const filterCandidates = [...iterateAuthorityNdjson(filterContent)].filter((candidate) =>
      Boolean(candidate.metadata?.nobleTitleFilter),
    );
    nobleTitleFilter = buildNobleTitleFilterIndex(filterCandidates);
    for (const candidate of filterCandidates) addCandidateToSeedIndex(index, candidate);
  } catch {
    // Older installations do not have the new pack; preserve legacy behavior.
  }

  // Non-file origins (pedb/cedb/project/list) have no NDJSON to stream —
  // callers route those to `extraCandidates` instead.
  const filePackIds = expandAuthorityPackIds(packIds).filter((id) => {
    const spec = AUTHORITY_PACKS.find((p) => p.id === id);
    return spec ? authorityPackOrigin(spec) === 'file' : true;
  });

  const needsOfficeGlosses = filePackIds.some(
    (id) => id === 'cbdb-offices' || id === 'norbert-offices',
  );
  const officeGlosses = needsOfficeGlosses ? await loadHuckbotGlossIndex(readPackFile) : new Map();
  const frenchOfficeGlosses = needsOfficeGlosses
    ? await loadMaxiRicciGlossIndex(readPackFile)
    : { byOfficeId: new Map(), byZhDynasty: new Map(), byZh: new Map() };
  const parentOfIndex = needsOfficeGlosses ? await loadParentOfIndex(readPackFile) : new Map();
  const huckbotZhGlosses = needsOfficeGlosses
    ? await loadHuckbotZhGlossIndex(readPackFile)
    : new Map();

  for (const packId of sortPackIds(filePackIds)) {
    options.onProgress?.(`Loading ${packId}…`);
    let packCount = 0;
    // The desktop cached reader may select date chunks before crossing IPC;
    // plain/test readers can ignore the optional second argument.
    const content = await readPackFile(packId, dateFilter);
    for (const candidate of iterateAuthorityNdjson(content)) {
      const withEn = applyHuckbotGlossToCandidate(candidate, officeGlosses);
      const withFr = applyMaxiRicciGlossToCandidate(withEn, frenchOfficeGlosses);
      const withGloss = applyParentOfGlossToCandidate(
        withFr,
        parentOfIndex,
        huckbotZhGlosses,
        frenchOfficeGlosses.byZh,
      );
      const runtimeCandidates =
        packId === 'norbert-wiki-nt'
          ? expandNorbertWikiNtCandidate(withGloss, norbertNamesByAuthorityId)
          : [withGloss];
      for (const runtimeCandidate of runtimeCandidates) {
        const titleFilterResult = applyNobleTitleFilter(runtimeCandidate, nobleTitleFilter);
        const candidatesToAdd = [
          ...(titleFilterResult.candidate ? [titleFilterResult.candidate] : []),
          ...titleFilterResult.titleCandidates,
        ];
        for (const filteredCandidate of candidatesToAdd) {
          if (dateFilter && !candidatePassesDateFilter(filteredCandidate, dateFilter)) continue;
          const filtered = filterCandidateForPhase1(filteredCandidate, nameTypePolicy);
          if (filtered.searchStrings.length === 0) continue;
          if (packId === 'norbert-persons') {
            const names = [
              filtered.primaryName,
              ...(filtered.names ?? []).map((name) => name.text),
            ].filter(Boolean);
            norbertNamesByAuthorityId.set(filtered.authorityId, [...new Set(names)]);
          }
          addCandidateToSeedIndex(index, filtered);
          packCount += 1;
          candidateCount += 1;
        }
      }
    }
    loaded[packId] = packCount;
  }

  for (const group of options.extraCandidates ?? []) {
    let groupCount = 0;
    for (const candidate of group.candidates) {
      const titleFilterResult = applyNobleTitleFilter(candidate, nobleTitleFilter);
      const candidatesToAdd = [
        ...(titleFilterResult.candidate ? [titleFilterResult.candidate] : []),
        ...titleFilterResult.titleCandidates,
      ];
      for (const replacement of candidatesToAdd) {
        if (dateFilter && !candidatePassesDateFilter(replacement, dateFilter)) continue;
        const filtered = filterCandidateForPhase1(replacement, nameTypePolicy);
        if (filtered.searchStrings.length === 0) continue;
        addCandidateToSeedIndex(index, filtered);
        groupCount += 1;
        candidateCount += 1;
      }
    }
    loaded[group.groupLabel as AuthorityPackId] = groupCount;
  }

  options.onProgress?.(`Matching ${candidateCount.toLocaleString()} authority entries…`);

  const matches = seedSuggestionsFromIndex(doc, index, policy, {
    useProjectionMatcher: options.useProjectionMatcher,
  });
  const allSuggestions = suggestionsFromSeedMatches(matches);

  // Deduplicate suggestions by location in case any slipped through
  const deduped = dedupeSuggestionsByLocation(allSuggestions);

  const cap = options.maxSuggestions;
  const truncated = cap != null && deduped.length > cap;
  const suggestions = truncated && cap != null ? deduped.slice(0, cap) : deduped;

  return {
    suggestions,
    candidateCount,
    matchCount: matches.length,
    loaded,
    truncated,
  };
}

/** One-line summary for the review panel after a tag bomb (pack counts + matches). */
export function formatAuthorityTagBombNotice(
  result: Pick<
    AuthorityTagBombResult,
    'candidateCount' | 'matchCount' | 'loaded' | 'truncated' | 'suggestions'
  >,
): string | undefined {
  const loadedParts = Object.entries(result.loaded)
    .map(([id, n]) => `${id}: ${(n ?? 0).toLocaleString()}`)
    .join(' · ');
  const parts = [
    `${result.candidateCount.toLocaleString()} entries loaded${loadedParts ? ` (${loadedParts})` : ''}`,
    `${result.matchCount.toLocaleString()} matches in document`,
  ];
  if (result.truncated) {
    parts.push(
      `showing first ${result.suggestions.length.toLocaleString()} suggestions — narrow packs or add a year filter`,
    );
  }
  return parts.join(' · ');
}
