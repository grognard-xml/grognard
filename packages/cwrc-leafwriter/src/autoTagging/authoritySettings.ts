import { persistProjectConfigPatch } from './projectConfigPersist';
import { persistedPacksFromUi, uiPacksFromPersisted, type AuthorityPackId } from './packPaths';
import type { DateFilterMode } from './packLoader';
import { DEFAULT_UNTAGGABLE_TYPES, normalizeNameType, type NameTypeId } from './nameTypes';
import {
  excludedFromPhase1Types,
  resolveNameTypeTaggingPolicy,
  type CustomNameType,
  type NameTypeTaggingBucket,
  type NameTypeTaggingPolicy,
} from './nameTypeTaggingPolicy';
import type { CustomThingType } from './thingTypePolicy';

export type { CustomNameType, NameTypeTaggingBucket, NameTypeTaggingPolicy };
export type { CustomThingType };
export {
  DEFAULT_ART_MIN_CODEPOINTS,
  bucketForTypedName,
  defaultPolicyForLanguage,
  filterCandidateForPhase1,
  isPhase1SeedName,
  isPhase2SeedName,
  phase1SearchStringsFromCandidate,
  resolveNameTypeTaggingPolicy,
  validateCustomNameTypeId,
} from './nameTypeTaggingPolicy';
export { validateCustomThingTypeId } from './thingTypePolicy';

/** Per-project authority tag-bomb settings (stored in the project file (grognard.project.json)). */
export interface AutoTaggingAuthoritySettings {
  packs?: AuthorityPackId[];
  /** Show the live authority-pack string totals in the tag-bomb panel (off by default because the scan is expensive). */
  showPackStringCounts?: boolean;
  /**
   * Match authority tag-bomb strings across empty `<lb>`, `<pb>`, and similar
   * milestones (projection matcher). Off by default until validated on your corpus.
   */
  matchAcrossLineBreaks?: boolean;
  dateFilter?: DateFilterMode;
  yearStart?: number;
  yearEnd?: number;
  /**
   * Name types barred from seeding corpus auto-tagging (default: courtesy
   * names 字, which are common words and produce nonsense tags). Excluded
   * types stay searchable and usable for manual disambiguation.
   * @deprecated Migrated to {@link nameTypeTaggingPolicy} (phase2 bucket).
   */
  excludedNameTypes?: string[];
  /** Per-type seed bucket overrides (phase1 / phase2 / never). */
  nameTypeTaggingPolicy?: Record<string, NameTypeTaggingBucket>;
  /** Project-scoped custom name types with default buckets. */
  customNameTypes?: CustomNameType[];
  /** Project-scoped custom `<rs>` sub-types (e.g. "philosophical concept"). */
  customThingTypes?: CustomThingType[];
  /** Code-point threshold for length-gated `art` names (default 3). */
  artMinCodePoints?: number;
  /** @deprecated Use {@link dateFilter}. */
  yearFilterEnabled?: boolean;
  /** @deprecated Folded into {@link dateFilter} (`limit` vs `exclude`). */
  hideUndated?: boolean;
}

/**
 * Normalized exclusion list for {@link isTaggableNameType}. Honors legacy
 * `excludedNameTypes` when present; otherwise derives phase2+never from the
 * resolved three-bucket policy.
 */
export function excludedNameTypesFromSettings(
  settings?: AutoTaggingAuthoritySettings,
  sourceLanguage?: string | null,
): NameTypeId[] {
  if (!settings) return DEFAULT_UNTAGGABLE_TYPES;
  if ('excludedNameTypes' in settings) {
    if (!settings.excludedNameTypes) return DEFAULT_UNTAGGABLE_TYPES;
    return settings.excludedNameTypes
      .map((raw) => normalizeNameType(raw))
      .filter((type): type is NameTypeId => type !== null);
  }
  return excludedFromPhase1Types(resolveNameTypeTaggingPolicy(settings, sourceLanguage));
}

/** Resolved name-type tagging policy from persisted settings and project language. */
export function nameTypeTaggingPolicyFromSettings(
  settings?: AutoTaggingAuthoritySettings,
  sourceLanguage?: string | null,
): NameTypeTaggingPolicy {
  return resolveNameTypeTaggingPolicy(settings, sourceLanguage);
}

/** Async helper for UI and tag-bomb: reads persisted settings + project source language. */
export async function readProjectNameTypeTaggingPolicy(): Promise<NameTypeTaggingPolicy> {
  const settings = readPersistedAuthoritySettings();
  let sourceLanguage: string | null;
  try {
    sourceLanguage = (await window.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;
  } catch {
    sourceLanguage = null;
  }
  return resolveNameTypeTaggingPolicy(settings, sourceLanguage);
}

/** Slider bounds shared by the tag-bomb dialog and the disambiguation panel's date filter. */
export const AUTHORITY_YEAR_MIN = -500;
export const AUTHORITY_YEAR_MAX = 2000;

/** Full slider span — not a dynasty preset. Dynasty chips are explicit user choices. */
export const DEFAULT_AUTHORITY_YEAR_RANGE: [number, number] = [
  AUTHORITY_YEAR_MIN,
  AUTHORITY_YEAR_MAX,
];
/** No date filter until the user chooses one or the active file supplies a work year. */
export const DEFAULT_AUTHORITY_DATE_FILTER: DateFilterMode = 'none';

export function defaultAuthorityPacksRecord(
  overrides: Partial<Record<AuthorityPackId, boolean>> = {},
): Record<AuthorityPackId, boolean> {
  return {
    ...uiPacksFromPersisted(),
    'dila-persons': true,
    ...overrides,
  };
}

/**
 * Resolve the tag-bomb date-filter mode:
 * 1. last explicit user choice (persisted `dateFilter`)
 * 2. active file work year from TEI metadata → `exclude`
 * 3. no filter
 *
 * Never falls back to a dynasty preset (e.g. Eastern Han).
 */
export function migrateDateFilter(
  settings?: AutoTaggingAuthoritySettings,
  workYear?: number | null,
): DateFilterMode {
  if (settings?.dateFilter) return settings.dateFilter;
  if (settings?.yearFilterEnabled === false) return 'none';
  if (workYear != null) return 'exclude';
  return DEFAULT_AUTHORITY_DATE_FILTER;
}

function yearRangeFromAuthoritySettings(
  settings?: AutoTaggingAuthoritySettings,
  workYear?: number | null,
): [number, number] {
  // Only treat stored years as "last user choice" when a date filter was
  // saved with them — otherwise packs-only project JSON must not pin the
  // slider to an old Eastern Han default.
  if (settings?.dateFilter && (settings.yearStart != null || settings.yearEnd != null)) {
    const yearStart = settings.yearStart ?? DEFAULT_AUTHORITY_YEAR_RANGE[0];
    const yearEnd = settings.yearEnd ?? DEFAULT_AUTHORITY_YEAR_RANGE[1];
    return [Math.min(yearStart, yearEnd), Math.max(yearStart, yearEnd)];
  }
  if (workYear != null) return [Math.min(workYear, AUTHORITY_YEAR_MAX), AUTHORITY_YEAR_MAX];
  return DEFAULT_AUTHORITY_YEAR_RANGE;
}

export function packsRecordFromSettings(
  settings?: AutoTaggingAuthoritySettings,
): Record<AuthorityPackId, boolean> {
  return uiPacksFromPersisted(settings?.packs);
}

export function settingsFromUiState(input: {
  packs: Record<AuthorityPackId, boolean>;
  showPackStringCounts: boolean;
  dateFilter: DateFilterMode;
  yearRange: [number, number];
  /** When omitted, name-type policy fields are preserved from persisted settings. */
  preserve?: AutoTaggingAuthoritySettings;
}): AutoTaggingAuthoritySettings {
  const [yearStart, yearEnd] = input.yearRange;
  const preserved = input.preserve ?? readPersistedAuthoritySettings() ?? {};
  return {
    ...preserved,
    packs: persistedPacksFromUi(input.packs),
    showPackStringCounts: input.showPackStringCounts,
    dateFilter: input.dateFilter,
    yearStart: Math.min(yearStart, yearEnd),
    yearEnd: Math.max(yearStart, yearEnd),
  };
}

/** @param workYear Signed year of the active file's work, when known — see {@link migrateDateFilter}. */
export function uiStateFromSettings(
  settings?: AutoTaggingAuthoritySettings,
  workYear?: number | null,
): {
  packs: Record<AuthorityPackId, boolean>;
  showPackStringCounts: boolean;
  dateFilter: DateFilterMode;
  yearRange: [number, number];
} {
  return {
    packs: packsRecordFromSettings(settings),
    showPackStringCounts: settings?.showPackStringCounts === true,
    dateFilter: migrateDateFilter(settings, workYear),
    yearRange: yearRangeFromAuthoritySettings(settings, workYear),
  };
}

/** Whether the projection matcher is enabled for authority / dictionary tag bomb. */
export function matchAcrossLineBreaksFromSettings(
  settings?: AutoTaggingAuthoritySettings,
): boolean {
  return settings?.matchAcrossLineBreaks === true;
}

export function readPersistedAuthoritySettings(): AutoTaggingAuthoritySettings | undefined {
  const raw = window.__leafWriterProject?.getAutoTaggingAuthoritySettings?.();
  if (!raw) return undefined;
  return {
    // Stored as a plain string[] in the project file; uiPacksFromPersisted/
    // packsRecordFromSettings narrow it back to known ids.
    packs: raw.packs as AuthorityPackId[] | undefined,
    showPackStringCounts: raw.showPackStringCounts === true,
    matchAcrossLineBreaks: raw.matchAcrossLineBreaks === true,
    dateFilter: raw.dateFilter,
    yearStart: raw.yearStart,
    yearEnd: raw.yearEnd,
    excludedNameTypes: raw.excludedNameTypes,
    nameTypeTaggingPolicy: raw.nameTypeTaggingPolicy as
      Record<string, NameTypeTaggingBucket> | undefined,
    customNameTypes: raw.customNameTypes as CustomNameType[] | undefined,
    customThingTypes: raw.customThingTypes as CustomThingType[] | undefined,
    artMinCodePoints: raw.artMinCodePoints,
    yearFilterEnabled: raw.yearFilterEnabled,
    hideUndated: raw.hideUndated,
  };
}

export async function persistAuthoritySettings(
  settings: AutoTaggingAuthoritySettings,
): Promise<void> {
  const saved = await persistProjectConfigPatch({ autoTaggingAuthority: settings });
  if (!saved) return;
  window.__leafWriterProject?.setAutoTaggingAuthoritySettings?.(settings);
}

/**
 * Persist just the date-filter portion (read-modify-write), so toggling the
 * filter or dragging the slider becomes the next session's "last user choice"
 * without requiring a tag-bomb run.
 */
export async function persistAuthorityDateFilter(
  dateFilter: DateFilterMode,
  yearRange: [number, number],
): Promise<void> {
  const current = readPersistedAuthoritySettings() ?? {};
  await persistAuthoritySettings({
    ...current,
    dateFilter,
    yearStart: Math.min(...yearRange),
    yearEnd: Math.max(...yearRange),
  });
}
