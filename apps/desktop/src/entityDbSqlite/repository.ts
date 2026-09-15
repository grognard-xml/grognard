import { stringsMatchExactly } from '../../../../packages/cwrc-leafwriter/src/autoTagging/disambiguationMatch';
import { canonicalNationalityLabel } from '../../../../packages/cwrc-leafwriter/src/autoTagging/dynastyCrosswalk';
import {
  isLatnLang,
  latnLangFor,
} from '../../../../packages/cwrc-leafwriter/src/utilities/languageCodes';
import type { EntityDbBackend } from './backend';
import { NodeSqliteBackend } from './nodeSqliteBackend';
import { applyEntityDbMigrations } from './schema';

export type SqliteEntityKind = 'person' | 'place' | 'work' | 'office' | 'org' | 'thing';
export type SqliteValueOrigin = 'user' | 'authority' | 'xml';
export type SqliteValueStatus = 'active' | 'rejected' | 'withdrawn';

export interface SqliteEntity {
  id: string;
  kind: SqliteEntityKind;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt: string | null;
}

export interface SqliteName {
  id: number;
  entityId: string;
  text: string;
  nameType: string | null;
  nameRole: string;
  language: string | null;
  isPrimary: boolean;
  origin: SqliteValueOrigin;
  source: string | null;
  status: SqliteValueStatus;
  createdAt: string;
  updatedAt: string;
}

/** Vernacular gloss (fr/en/…), separate from romanization / name variants. */
export interface SqliteTranslation {
  id: number;
  entityId: string;
  text: string;
  language: string;
  origin: SqliteValueOrigin;
  source: string | null;
  status: SqliteValueStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SqliteEntitySummary extends SqliteEntity {
  names: SqliteName[];
}

/** A typed relation to another entity, from the queried entity's point of view. */
export interface SqliteEntityRelation {
  id: number;
  relationType: string;
  /** True when the queried entity is the relation's subject, false when it's the object. */
  isSubject: boolean;
  symmetric: boolean;
  reference: string | null;
  otherEntityId: string | null;
  otherEntityKind: SqliteEntityKind | null;
  otherEntityName: string | null;
}

export interface SqliteEntityLookupResult {
  id: string;
  label: string;
  description?: string;
  idnos: { type: string; value: string }[];
}

export interface SqliteEntityCandidateRecord {
  id: string;
  kind: SqliteEntityKind;
  names: { text: string; type?: string }[];
  description?: string;
  startYear?: number;
  endYear?: number;
  /** thing kind only: user-defined sub-category id from Project Settings. */
  subtype?: string;
  nobleTitles: {
    fief?: string;
    roleName?: string;
    posthumousName?: string;
    dynasty?: string;
  }[];
}

export interface SqliteEntityAssertion {
  key: string;
  element: string;
  value: string;
  origin: SqliteValueOrigin;
  source: string | null;
  status: SqliteValueStatus;
  precision?: string | null;
  noteType?: string | null;
  ref: string | null;
}

export interface SqliteEntityNote {
  xml: string;
}

export interface SqliteConcordanceAssociation {
  source: string;
  canonicalId: string;
  mergedFromId: string;
  notes?: string;
  sourceRef?: string;
}

export interface SqliteConcordanceRejection {
  source: string;
  leftId: string;
  rightId: string;
  reason: string | null;
  entityId: string | null;
}

export interface SqliteConcordanceImportResult {
  applied: number;
  alreadyPresent: number;
  rejected: number;
  unresolved: number;
  conflicts: { association: SqliteConcordanceAssociation; entityIds: string[] }[];
}

export interface SqliteEntityPanelSummary extends SqliteEntitySummary {
  authorities: { type: string; value: string }[];
  familyName: string | null;
  givenName: string | null;
  startYear: number | null;
  endYear: number | null;
  workDate: {
    startYear: number | null;
    endYear: number | null;
    startPrecision: string | null;
    endPrecision: string | null;
  } | null;
  /** work kind only: 'book' | 'chapter' | 'poem' | 'painting' | 'object'. */
  workType: string | null;
  /** thing kind only: user-defined sub-category id from Project Settings (entity_metadata key='subtype'). */
  subtype: string | null;
  /** Vernacular glosses (fr/en/…); not searched as names. */
  translations: SqliteTranslation[];
  nationalities: string[];
  placesOfOrigin: string[];
  roles: string[];
  /** First active `office_classifications` label (office kind only) — semantics not fully
   * documented upstream (likely a CBDB office-category code), surfaced as-is. */
  classification: string | null;
  origins: SqliteValueOrigin[];
  authors: {
    key: string;
    name: string;
    ref: string | null;
    origin: SqliteValueOrigin;
    source: string | null;
    status: SqliteValueStatus;
  }[];
  nobleTitles: {
    key: string;
    dynasty: string;
    fief: string;
    posthumousName: string;
    title: string;
    origin: SqliteValueOrigin;
    source: string | null;
    status: SqliteValueStatus;
  }[];
  assertions: SqliteEntityAssertion[];
  rejectedConcordances: SqliteConcordanceRejection[];
}

export interface SqliteDuplicateGroup {
  type: string;
  value: string;
  entityIds: string[];
}

export interface CreateEntityInput {
  id: string;
  kind: SqliteEntityKind;
  description?: string | null;
  now?: string;
}

export interface AddNameInput {
  entityId: string;
  text: string;
  nameType?: string | null;
  nameRole?: string;
  language?: string | null;
  isPrimary?: boolean;
  origin?: SqliteValueOrigin;
  source?: string | null;
  status?: SqliteValueStatus;
  now?: string;
}

export interface UpdateNamesByTextInput {
  entityId: string;
  text: string;
  nameType?: string | null;
  language?: string | null;
  now?: string;
}

export type SqliteDatePart = 'birth' | 'death';

export interface SetUserEntityDateInput {
  entityId: string;
  part: SqliteDatePart;
  year: number | null;
  precision?: string | null;
  now?: string;
}

export interface SetUserWorkDateInput {
  entityId: string;
  startYear: number | null;
  endYear?: number | null;
  startPrecision?: string | null;
  endPrecision?: string | null;
  now?: string;
}

export type WorkType = 'book' | 'chapter' | 'poem' | 'painting' | 'object';

export interface SetWorkTypeInput {
  entityId: string;
  workType: WorkType | null;
  now?: string;
}

export interface AddLabeledValueInput {
  entityId: string;
  label: string;
  ref?: string | null;
  source?: string | null;
  /** Defaults to `user` for panel edits; XML ingest passes `xml`. */
  origin?: SqliteValueOrigin;
  now?: string;
}

export interface NobleTitleMutationInput {
  dynasty?: string;
  fief?: string;
  posthumousName?: string;
  title?: string;
  source?: string | null;
  /** Defaults to `user` for panel edits; XML ingest passes `xml`. */
  origin?: SqliteValueOrigin;
}

export interface AddOfficeValueInput {
  entityId: string;
  label: string;
  ref?: string | null;
  source?: string | null;
  origin?: SqliteValueOrigin;
  now?: string;
}

/**
 * One person-wrapper's extracted TEI assertions, keyed by the stable
 * `xml:<document>#personWrapper:<n>` source used in entities.xml provenance.
 */
export interface XmlExtractedAssertionInput {
  element: string;
  value: string;
  ref?: string | null;
  children?: { element: string; value: string; ref?: string | null }[];
}

export interface XmlExtractedWrapperInput {
  entityId: string;
  source: string;
  assertions: XmlExtractedAssertionInput[];
}

export interface XmlExtractedRefreshInput {
  documentKey: string;
  wrappers: XmlExtractedWrapperInput[];
  /**
   * When true (default), drop active xml rows for personWrapper sources in
   * this document that are not among `wrappers`. Pass false for one-shot
   * resolveMention ingest so sibling wrappers are left alone.
   */
  purgeOrphanSources?: boolean;
  now?: string;
}

export interface XmlExtractedRefreshResult {
  wrappers: number;
  added: number;
  removed: number;
  retained: number;
}

export interface SetUserWorkAuthorsInput {
  entityId: string;
  authors: { name: string; ref?: string | null; key?: string | null }[];
  now?: string;
}

export interface AuthorityRefInput {
  entityId: string;
  type: string;
  value: string;
  now?: string;
  origin?: SqliteValueOrigin;
  source?: string | null;
}

export interface DecisionTargetBackfillEntry {
  entityId: string;
  decisionType: 'duplicate-ok' | 'concordance-rejected';
  targetRefs: string;
  source?: string | null;
  payloadJson?: string | null;
}

export interface DecisionTargetBackfillReport {
  updated: number;
  inserted: number;
  unchanged: number;
}

export interface SqliteCentralMapping {
  userStableId: string;
  centralId: string;
}

export interface SqliteCentralMergeConflict {
  userStableId: string;
  keptCentralId: string;
  droppedCentralId: string;
}

export interface SqliteMergeResult {
  keepId: string;
  remap: Record<string, string>;
  centralConflicts: SqliteCentralMergeConflict[];
}

export interface CreatePopulatedEntityInput {
  id: string;
  kind: SqliteEntityKind;
  description?: string | null;
  names?: {
    text: string;
    nameType?: string | null;
    language?: string | null;
    isPrimary?: boolean;
    origin?: SqliteValueOrigin;
    source?: string | null;
  }[];
  authorities?: {
    type: string;
    value: string;
    origin?: SqliteValueOrigin;
    source?: string | null;
  }[];
  familyName?: string | null;
  givenName?: string | null;
  now?: string;
}

/**
 * One-entity enrichment payload for authority refresh/backfill.
 * Mirrors DOM helpers in `nameBackfill.ts` / `entities.ts` (non-destructive,
 * source-keyed dates, skip when a tombstoned row already claims the identity).
 */
export interface AuthorityBackfillPatch {
  entityId: string;
  names?: {
    text: string;
    nameType?: string | null;
    language?: string | null;
    source?: string | null;
  }[];
  /** Set only when the person has no family name yet (unless rewriteUnvalidatedPersonNames). */
  familyName?: string | null;
  /** Set only when the person has no given name yet (unless rewriteUnvalidatedPersonNames). */
  givenName?: string | null;
  /**
   * When true, withdraw active origin=authority family/given name rows that are
   * not in this patch, and force people.family_name / given_name from the patch
   * when the patch carries a positive family or given. Empty patches no longer
   * clear or tombstone existing splits (that was wiping CBDB 姓/名 on card
   * refresh when the reference DB was missing). Never touches origin=user rows.
   */
  rewriteUnvalidatedPersonNames?: boolean;
  /** Set only when the entity has no Latin-script name yet. */
  romanized?: { text: string; language?: string | null } | null;
  dates?: {
    source: string;
    startYear?: number | null;
    endYear?: number | null;
    /** Real floruit range → `date_kind=dates` + `start_precision=fl.` (not birth/death). */
    asFloruit?: boolean;
  }[];
  /**
   * Delete active authority birth/death rows for these sources (e.g. CBDB
   * index/nationality years that were wrongly minted as vitals, or floruit
   * that was wrongly stored as birth/death before the dates+fl. path).
   */
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
  /** Authority-origin work date (`date_kind = dates`), keyed by source. */
  workDate?: {
    source: string;
    startYear?: number | null;
    endYear?: number | null;
  } | null;
  now?: string;
}

export interface AuthorityBackfillPatchResult {
  changed: boolean;
  namesAdded: number;
}

/** Match the XML concordance helper: CBDB ids drop leading zeros; refs are SOURCE:id. */
function concordanceRef(source: string, id: string): string {
  const value = /^cbdb$/i.test(source) ? id.replace(/^0+(?=\d)/, '') : id;
  return `${source.trim().toUpperCase()}:${value.trim()}`;
}

function concordanceRefs(association: SqliteConcordanceAssociation): [string, string] {
  return [
    concordanceRef(association.source, association.canonicalId),
    concordanceRef(association.source, association.mergedFromId),
  ].sort() as [string, string];
}

const CENTRAL_AUTHORITY_TYPE = 'grognard-central';

const ASSERTION_OWNER: Record<string, string> = {
  entity_names: 'entity_id',
  entity_translations: 'entity_id',
  entity_authorities: 'entity_id',
  entity_dates: 'entity_id',
  entity_metadata: 'entity_id',
  person_nationalities: 'person_id',
  person_origins: 'person_id',
  person_titles: 'person_id',
  person_offices: 'person_id',
  work_authors: 'work_id',
};

function nowIso(): string {
  return new Date().toISOString();
}

function isoYearString(year: number): string {
  const abs = String(Math.abs(year)).padStart(4, '0');
  return year < 0 ? `-${abs}` : abs;
}

function normalizeAuthorityValue(type: string, value: string): string {
  const trimmed = value.trim();
  if (/^wikidata$/i.test(type)) {
    const match = trimmed.match(/(Q\d+)\s*$/i);
    if (match) return match[1]!.toUpperCase();
  }
  if (/^viaf$/i.test(type)) {
    const match = trimmed.match(/(\d+)\s*\/?\s*$/);
    if (match) return match[1]!;
  }
  return trimmed;
}

/** Store authority types with the conventional casing used in TEI idnos. */
function canonicalizeAuthorityType(type: string): string {
  const trimmed = type.trim();
  const known: Record<string, string> = {
    wikidata: 'Wikidata',
    viaf: 'VIAF',
    cbdb: 'CBDB',
    dila: 'DILA',
    geonames: 'Geonames',
    getty: 'Getty',
    gnd: 'GND',
    norbert: 'NORBERT',
    ndl: 'NDL',
  };
  return known[trimmed.toLowerCase()] ?? trimmed;
}

function parseAssertionKey(
  key: string,
):
  { kind: 'row'; table: string; rowId: number } | { kind: 'description'; entityId: string } | null {
  if (key.startsWith('entities:description:')) {
    return { kind: 'description', entityId: key.slice('entities:description:'.length) };
  }
  const separator = key.lastIndexOf(':');
  if (separator <= 0) return null;
  const table = key.slice(0, separator);
  const rowId = Number(key.slice(separator + 1));
  if (!ASSERTION_OWNER[table] || !Number.isInteger(rowId) || rowId < 1) return null;
  return { kind: 'row', table, rowId };
}

function rowEntity(row: Record<string, unknown>): SqliteEntity {
  return {
    id: String(row.id),
    kind: row.kind as SqliteEntityKind,
    description: (row.description as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revision: Number(row.revision),
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
}

function groupRowsByKey(
  rows: Record<string, unknown>[],
  key: string,
): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = String(row[key]);
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

/** Assemble one Database-tab snapshot from already-fetched row bags (no extra queries). */
function assemblePanelSummary(
  entity: SqliteEntity,
  names: SqliteName[],
  bags: {
    activeAuthorities: { type: string; value: string }[];
    allAuthorities: Record<string, unknown>[];
    person: { family_name: string | null; given_name: string | null } | undefined;
    work: { work_type: string | null } | undefined;
    dates: Record<string, unknown>[];
    nationalityRows: Record<string, unknown>[];
    originRows: Record<string, unknown>[];
    officeRows: Record<string, unknown>[];
    authorRows: Record<string, unknown>[];
    titleRows: Record<string, unknown>[];
    nameAssertionRows: Record<string, unknown>[];
    translationRows: Record<string, unknown>[];
    descriptionRows: Record<string, unknown>[];
    classificationRows: Record<string, unknown>[];
    subtype: string | null;
  },
  allRejections: SqliteConcordanceRejection[],
): SqliteEntityPanelSummary {
  const authorities = bags.activeAuthorities;
  const authorityRefs = new Set(
    authorities
      .filter((authority) => authority.type !== CENTRAL_AUTHORITY_TYPE)
      .map((authority) => concordanceRef(authority.type, authority.value)),
  );
  const rejectedConcordances = allRejections.filter(
    (rejection) => authorityRefs.has(rejection.leftId) || authorityRefs.has(rejection.rightId),
  );
  const familyFromNames =
    names.find((name) => name.nameRole === 'family' || name.nameType === 'family')?.text ?? null;
  const givenFromNames =
    names.find((name) => name.nameRole === 'given' || name.nameType === 'given')?.text ?? null;
  const dates = bags.dates;
  const nationalities = bags.nationalityRows
    .filter((row) => row.status === 'active')
    .map((row) =>
      canonicalNationalityLabel(
        typeof row.source === 'string' ? row.source : null,
        typeof row.reference === 'string' ? row.reference : null,
        String(row.label),
      ),
    );
  const origins = bags.originRows
    .filter((row) => row.status === 'active')
    .map((row) => String(row.label));
  const roles = bags.officeRows
    .filter((row) => row.status === 'active')
    .map((row) => String(row.office_label));
  const offices = bags.officeRows;
  const authors = bags.authorRows;
  const nobleTitles = bags.titleRows;
  const classification =
    (bags.classificationRows.find((row) => row.status === 'active')?.label as string | null) ??
    null;
  const translations = bags.translationRows
    .filter((row) => !row.status || row.status === 'active')
    .map((row) => rowTranslation(row));

  const assertions: SqliteEntityAssertion[] = [];
  const addAssertion = (assertion: SqliteEntityAssertion) => {
    if (assertion.value || assertion.element === 'idno') assertions.push(assertion);
  };
  const nameElement =
    entity.kind === 'person'
      ? 'persName'
      : entity.kind === 'place'
        ? 'placeName'
        : entity.kind === 'work'
          ? 'title'
          : entity.kind === 'office'
            ? 'roleName'
            : entity.kind === 'thing'
              ? 'name'
              : 'orgName';
  for (const name of bags.nameAssertionRows) {
    addAssertion({
      key: `entity_names:${name.id}`,
      element: nameElement,
      value: String(name.text),
      origin: name.origin as SqliteValueOrigin,
      source: (name.source as string | null) ?? null,
      status: name.status as SqliteValueStatus,
      ref: null,
    });
  }
  for (const translation of bags.translationRows) {
    addAssertion({
      key: `entity_translations:${translation.id}`,
      element: nameElement,
      value: String(translation.text),
      origin: translation.origin as SqliteValueOrigin,
      source: (translation.source as string | null) ?? null,
      status: translation.status as SqliteValueStatus,
      ref: null,
    });
  }
  for (const authority of bags.allAuthorities) {
    addAssertion({
      key: `entity_authorities:${authority.id}`,
      element: 'idno',
      value: String(authority.authority_value),
      origin: authority.origin as SqliteValueOrigin,
      source: (authority.source as string | null) ?? null,
      status: authority.status as SqliteValueStatus,
      ref: String(authority.authority_type),
    });
  }
  for (const date of dates) {
    const kind = String(date.date_kind);
    const value = String(
      date.when_value ?? date.raw_text ?? date.start_year ?? date.end_year ?? '',
    );
    addAssertion({
      key: `entity_dates:${date.id}`,
      element: kind === 'birth' || kind === 'death' ? kind : 'note',
      value,
      origin: date.origin as SqliteValueOrigin,
      source: (date.source as string | null) ?? null,
      status: date.status as SqliteValueStatus,
      precision: (date.start_precision as string | null) ?? null,
      noteType: kind === 'birth' || kind === 'death' ? null : 'dates',
      ref: null,
    });
  }
  for (const row of bags.nationalityRows) {
    addAssertion({
      key: `person_nationalities:${row.id}`,
      element: 'nationality',
      value: String(row.label),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      ref: (row.reference as string | null) ?? null,
    });
  }
  for (const row of bags.originRows) {
    addAssertion({
      key: `person_origins:${row.id}`,
      element: 'placeName',
      value: String(row.label),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      ref: (row.reference as string | null) ?? null,
    });
  }
  for (const row of offices) {
    addAssertion({
      key: `person_offices:${row.id}`,
      element: 'affiliation',
      value: String(row.office_label),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      ref: (row.reference as string | null) ?? null,
    });
  }
  for (const row of nobleTitles) {
    addAssertion({
      key: `person_titles:${row.id}`,
      element: 'nobleTitle',
      value: String(row.role_name ?? row.place_name ?? ''),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      ref: (row.reference as string | null) ?? null,
    });
  }
  for (const row of authors) {
    addAssertion({
      key: `work_authors:${row.id}`,
      element: 'author',
      value: String(row.label),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      ref: (row.reference as string | null) ?? null,
    });
  }
  for (const row of bags.descriptionRows) {
    addAssertion({
      key: `entity_metadata:${row.id}`,
      element: 'note',
      value: String(row.value),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
      noteType: 'description',
      ref: null,
    });
  }
  if (
    entity.description &&
    !assertions.some(
      (assertion) =>
        assertion.noteType === 'description' &&
        assertion.origin === 'user' &&
        assertion.value === entity.description,
    )
  ) {
    addAssertion({
      key: `entities:description:${entity.id}`,
      element: 'note',
      value: entity.description,
      origin: 'user',
      source: null,
      status: 'active',
      noteType: 'description',
      ref: null,
    });
  }
  const activeDates = dates.filter((date) => date.status === 'active');
  const firstDate = (kind: string) =>
    activeDates.find((date) => date.date_kind === kind) as Record<string, unknown> | undefined;
  // Prefer a non-sentinel year: skip CBDB/legacy `0`, and prefer user rows that
  // are real years, then authority rows. DILA before CBDB so TEI birth/death
  // beat dynasty-span rows that older mints stored under CBDB.
  const preferredVitalYear = (kind: 'birth' | 'death'): number | null => {
    const rows = activeDates.filter((date) => date.date_kind === kind) as Record<string, unknown>[];
    const yearOf = (row: Record<string, unknown>) => {
      const year = row.start_year;
      return typeof year === 'number' && Number.isFinite(year) && year !== 0 ? year : null;
    };
    const user = rows.find((row) => row.origin === 'user' && yearOf(row) != null);
    if (user) return yearOf(user);
    const preferredSources = ['WIKIDATA', 'DILA', 'CBDB', 'NORBERT'];
    for (const source of preferredSources) {
      const hit = rows.find(
        (row) =>
          String(row.source ?? '')
            .trim()
            .toUpperCase() === source && yearOf(row) != null,
      );
      if (hit) return yearOf(hit);
    }
    for (const row of rows) {
      const year = yearOf(row);
      if (year != null) return year;
    }
    return null;
  };
  // A generic (non birth/death) date row — the only kind of existence-period date that
  // place/org/office ever get today (imported from <note type="dates">). `work` prefers
  // this same row over the legacy 'work'-kind row; every other kind falls back to it only
  // when it has no birth/death row of its own.
  const genericDatesRow = firstDate('dates');
  const workDateRow =
    entity.kind === 'work' ? (genericDatesRow ?? firstDate('work') ?? undefined) : undefined;
  const birthRow = entity.kind === 'work' ? undefined : firstDate('birth');
  const deathRow = entity.kind === 'work' ? undefined : firstDate('death');
  // Precision-carrying date range: `work` prefers its own workDateRow; every other kind
  // (notably office, for period-disambiguation — see docs/entity-display-translations-planning.md
  // Phase 3) gets the generic dates row too, but only when it has no birth/death row of its own.
  const dateRangeRow =
    entity.kind === 'work' ? workDateRow : !birthRow && !deathRow ? genericDatesRow : undefined;
  const workDate = dateRangeRow
    ? {
        startYear: (dateRangeRow.start_year as number | null) ?? null,
        endYear: (dateRangeRow.end_year as number | null) ?? null,
        startPrecision: (dateRangeRow.start_precision as string | null) ?? null,
        endPrecision: (dateRangeRow.end_precision as string | null) ?? null,
      }
    : null;
  const fallbackStartYear =
    entity.kind === 'work'
      ? null
      : (preferredVitalYear('birth') ?? (genericDatesRow?.start_year as number | null) ?? null);
  const fallbackEndYear =
    entity.kind === 'work'
      ? null
      : (preferredVitalYear('death') ?? (genericDatesRow?.end_year as number | null) ?? null);
  return {
    ...entity,
    // Merge glosses into names so the entity editor / sqliteSummary keep working
    // without a parallel accordion. Search still uses entity_names only.
    names: [...names, ...translations.map(translationAsDisplayName)],
    translations,
    authorities,
    // 姓/名 are person-only. Offices/places/orgs sometimes inherit polluted
    // family/given name rows from older mint paths — never surface them here.
    familyName: entity.kind === 'person' ? (bags.person?.family_name ?? familyFromNames) : null,
    givenName: entity.kind === 'person' ? (bags.person?.given_name ?? givenFromNames) : null,
    startYear: entity.kind === 'work' ? (workDate?.startYear ?? null) : fallbackStartYear,
    endYear: entity.kind === 'work' ? (workDate?.endYear ?? null) : fallbackEndYear,
    workDate,
    workType: bags.work?.work_type ?? (entity.kind === 'work' ? 'book' : null),
    subtype: entity.kind === 'thing' ? bags.subtype : null,
    classification,
    nationalities: Array.from(new Set(nationalities)),
    placesOfOrigin: Array.from(new Set(origins)),
    roles: Array.from(new Set(roles)),
    origins: Array.from(
      new Set(assertions.filter((item) => item.status === 'active').map((item) => item.origin)),
    ),
    authors: authors.map((row) => ({
      key: `work_authors:${row.id}`,
      name: String(row.label),
      ref: (row.reference as string | null) ?? null,
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
    })),
    nobleTitles: nobleTitles.map((row) => ({
      key: `person_titles:${row.id}`,
      dynasty: String(row.dynasty ?? ''),
      fief: String(row.place_name ?? ''),
      posthumousName: String(row.posthumous_name ?? ''),
      title: String(row.role_name ?? ''),
      origin: row.origin as SqliteValueOrigin,
      source: (row.source as string | null) ?? null,
      status: row.status as SqliteValueStatus,
    })),
    assertions,
    rejectedConcordances,
  };
}

function rowName(row: Record<string, unknown>): SqliteName {
  const rawType = (row.name_type as string | null) ?? null;
  const nameType =
    rawType === 'familyName' ? 'family' : rawType === 'givenName' ? 'given' : rawType;
  const rawRole = String(row.name_role ?? 'variant');
  const nameRole =
    rawRole === 'familyName'
      ? 'family'
      : rawRole === 'givenName'
        ? 'given'
        : nameType === 'family' || nameType === 'given'
          ? nameType
          : rawRole;
  return {
    id: Number(row.id),
    entityId: String(row.entity_id),
    text: String(row.text),
    nameType,
    nameRole,
    language: (row.language as string | null) ?? null,
    isPrimary: Number(row.is_primary) === 1,
    origin: row.origin as SqliteValueOrigin,
    source: (row.source as string | null) ?? null,
    status: row.status as SqliteValueStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowTranslation(row: Record<string, unknown>): SqliteTranslation {
  return {
    id: Number(row.id),
    entityId: String(row.entity_id),
    text: String(row.text),
    language: String(row.language ?? ''),
    origin: row.origin as SqliteValueOrigin,
    source: (row.source as string | null) ?? null,
    status: row.status as SqliteValueStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Present glosses in the names list for the entity editor (type=translation). */
function translationAsDisplayName(translation: SqliteTranslation): SqliteName {
  return {
    id: translation.id,
    entityId: translation.entityId,
    text: translation.text,
    nameType: 'translation',
    nameRole: 'variant',
    language: translation.language,
    isPrimary: false,
    origin: translation.origin,
    source: translation.source,
    status: translation.status,
    createdAt: translation.createdAt,
    updatedAt: translation.updatedAt,
  };
}

function normalizePersonNameType(
  nameType: string | null | undefined,
): 'family' | 'given' | string | null {
  if (!nameType) return null;
  if (nameType === 'familyName' || nameType === 'family') return 'family';
  if (nameType === 'givenName' || nameType === 'given') return 'given';
  return nameType;
}

/** Romanization rows always carry a `*-Latn` language tag. */
function languageForRomanization(language: string | null | undefined): string {
  if (isLatnLang(language)) return String(language).trim();
  return latnLangFor(language);
}

export class EntitySqliteRepository {
  /** The real connection. Swapped for a transaction's own handle in `transaction()`. */
  private readonly rootBackend: EntityDbBackend;
  /** What every query method reads from — `rootBackend` outside a transaction. */
  private activeBackend: EntityDbBackend;

  private constructor(backend: EntityDbBackend) {
    this.rootBackend = backend;
    this.activeBackend = backend;
  }

  /** Opens (and migrates) a local-file-backed repository. Mirrors today's `new EntitySqliteRepository(path)`. */
  static async open(databasePath = ':memory:'): Promise<EntitySqliteRepository> {
    const backend = new NodeSqliteBackend(databasePath);
    await applyEntityDbMigrations(backend);
    return new EntitySqliteRepository(backend);
  }

  async close(): Promise<void> {
    await this.rootBackend.close();
  }

  async integrityCheck(): Promise<string[]> {
    return (await this.activeBackend.all('PRAGMA integrity_check'))
      .map((row) => String((row as Record<string, unknown>).integrity_check));
  }

  async getDatabaseId(): Promise<string | null> {
    const row = (await this.activeBackend.get("SELECT value FROM database_metadata WHERE key = 'database_id'")) as { value?: string } | undefined;
    return row?.value ? String(row.value) : null;
  }

  async getMetadata(key: string): Promise<string | null> {
    const row = (await this.activeBackend.get('SELECT value FROM database_metadata WHERE key = ?', [key])) as
      { value?: string } | undefined;
    return row?.value != null ? String(row.value) : null;
  }

  async setMetadata(key: string, value: string): Promise<void> {
    (await this.activeBackend.run('INSERT OR REPLACE INTO database_metadata (key, value) VALUES (?, ?)', [key, value]));
  }

  /**
   * Runs `work` inside a transaction. Nestable (an inner call reuses the
   * outer transaction, matching the previous `BEGIN IMMEDIATE` depth
   * tracking). While inside a transaction, `this.activeBackend` is the
   * transaction's own handle — important for a network backend, where
   * queries must go through the same connection as the transaction.
   */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeBackend !== this.rootBackend) {
      // Already inside a transaction: reuse it.
      return work();
    }
    return this.rootBackend.transaction(async (tx) => {
      this.activeBackend = tx;
      try {
        return await work();
      } finally {
        this.activeBackend = this.rootBackend;
      }
    });
  }

  async createEntity(input: CreateEntityInput): Promise<SqliteEntity> {
    const now = input.now ?? nowIso();
    await this.transaction(async () => {
      (await this.activeBackend.run(`INSERT INTO entities (id, kind, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`, [input.id, input.kind, input.description ?? null, now, now]));
      const tableByKind: Record<SqliteEntityKind, string> = {
        person: 'people',
        place: 'places',
        work: 'works',
        office: 'offices',
        org: 'organizations',
        thing: 'things',
      };
      if (input.kind === 'work') {
        (await this.activeBackend.run(`INSERT INTO works (entity_id, work_type) VALUES (?, 'book')`, [input.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO ${tableByKind[input.kind]} (entity_id) VALUES (?)`, [input.id]));
      }
    });
    return (await this.getEntity(input.id))!;
  }

  /**
   * Create an entity and populate common seed fields in one transaction.
   * Soft-deleted ids cannot be reused (no-resurrection).
   */
  async createPopulatedEntity(input: CreatePopulatedEntityInput): Promise<SqliteEntity> {
    const now = input.now ?? nowIso();
    const existing = (await this.getEntity(input.id));
    if (existing) {
      if (existing.deletedAt) {
        throw new Error(`Cannot resurrect soft-deleted entity: ${input.id}`);
      }
      throw new Error(`Entity already exists: ${input.id}`);
    }
    return this.transaction(async () => {
      (await this.activeBackend.run(`INSERT INTO entities (id, kind, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`, [input.id, input.kind, input.description ?? null, now, now]));
      const tableByKind: Record<SqliteEntityKind, string> = {
        person: 'people',
        place: 'places',
        work: 'works',
        office: 'offices',
        org: 'organizations',
        thing: 'things',
      };
      if (input.kind === 'work') {
        (await this.activeBackend.run(`INSERT INTO works (entity_id, work_type) VALUES (?, 'book')`, [input.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO ${tableByKind[input.kind]} (entity_id) VALUES (?)`, [input.id]));
      }

      const insertName = (
        text: string,
        nameType: string | null,
        isPrimary: boolean,
        language: string | null,
        origin: SqliteValueOrigin,
        source: string | null,
      ) => {
        const normalizedType = normalizePersonNameType(nameType);
        const nameRole =
          normalizedType === 'family' || normalizedType === 'given'
            ? normalizedType
            : isPrimary
              ? 'primary'
              : 'variant';
        if (isPrimary) {
          (await this.activeBackend.run('UPDATE entity_names SET is_primary = 0 WHERE entity_id = ?', [input.id]));
        }
        (await this.activeBackend.run(`INSERT INTO entity_names
               (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [input.id,
            text,
            normalizedType,
            nameRole,
            language,
            isPrimary ? 1 : 0,
            origin,
            source,
            now,
            now,]));
        (await this.syncPersonNameScalars(input.id, text, normalizedType, now));
      };

      for (const [index, name] of (input.names ?? []).entries()) {
        const text = name.text.trim();
        if (!text) continue;
        insertName(
          text,
          name.nameType ?? null,
          name.isPrimary ?? index === 0,
          name.language ?? null,
          name.origin ?? 'user',
          name.source ?? null,
        );
      }
      if (input.kind === 'person') {
        if (input.familyName?.trim()) {
          insertName(input.familyName.trim(), 'family', false, null, 'user', null);
        }
        if (input.givenName?.trim()) {
          insertName(input.givenName.trim(), 'given', false, null, 'user', null);
        }
      }
      for (const authority of input.authorities ?? []) {
        const type = authority.type.trim();
        const value = authority.value.trim();
        if (!type || !value) continue;
        (await this.activeBackend.run(`INSERT INTO entity_authorities
               (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`, [input.id,
            type,
            value,
            authority.origin ?? 'user',
            authority.source ?? null,
            now,
            now,]));
      }
      (await this.normalizeEntityNameIntegrity(input.id, now));
      (await this.bumpEntity(input.id, now));
      return (await this.getEntity(input.id))!;
    });
  }

  /** Soft-delete: hide from lists/exports while preserving tombstone history. */
  async softDeleteEntity(entityId: string, now = nowIso()): Promise<boolean> {
    const entity = (await this.getEntity(entityId));
    if (!entity || entity.deletedAt) return false;
    (await this.activeBackend.run(`UPDATE entities
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ?`, [now, now, entityId]));
    return true;
  }

  /**
   * Every active non-deleted entity of `kind` sharing an authority type+value.
   * Used by lookup planning for conflict detection; single-id callers use
   * {@link findEntityIdByAuthority}.
   */
  async findAllEntityIdsByAuthority(kind: SqliteEntityKind, type: string, value: string): Promise<string[]> {
    const wantedType = type.trim();
    const wantedValue = normalizeAuthorityValue(wantedType, value);
    if (!wantedType || !wantedValue) return [];
    const rows = (await this.activeBackend.all(`SELECT a.entity_id, a.authority_value
         FROM entity_authorities a
         JOIN entities e ON e.id = a.entity_id
         WHERE e.kind = ?
           AND e.deleted_at IS NULL
           AND a.status = 'active'
           AND lower(a.authority_type) = lower(?)
         ORDER BY a.entity_id`, [kind, wantedType])) as { entity_id: string; authority_value: string }[];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (normalizeAuthorityValue(wantedType, row.authority_value) !== wantedValue) continue;
      if (seen.has(row.entity_id)) continue;
      seen.add(row.entity_id);
      ids.push(row.entity_id);
    }
    return ids;
  }

  /** First active non-deleted entity of `kind` sharing an authority type+value. */
  async findEntityIdByAuthority(kind: SqliteEntityKind, type: string, value: string): Promise<string | null> {
    return (await this.findAllEntityIdsByAuthority(kind, type, value))[0] ?? null;
  }

  /**
   * Exactly one active entity whose primary name matches and whose years do
   * not conflict — same rule as DOM `findCentralByNameDates`.
   *
   * Uses one bulk SQL read of primary names + years for `kind`, then filters
   * in memory. Never maps `getPanelSummary` across the catalogue: on a large
   * CEDB that N+1 path takes on the order of a minute per promote.
   */
  async findEntityIdByNameDates(
    kind: SqliteEntityKind,
    name: string,
    startYear?: number | null,
    endYear?: number | null,
  ): Promise<string | null> {
    if (!name.trim()) return null;
    // Primary name = first active name by is_primary DESC, id (same as listNames).
    // Person years: birth/death `start_year`. Work years: first active dates|work row.
    const rows = (await this.activeBackend.all(`SELECT e.id AS id,
                n.text AS primary_name,
                CASE
                  WHEN e.kind = 'work' THEN (
                    SELECT d.start_year FROM entity_dates d
                    WHERE d.entity_id = e.id AND d.status = 'active'
                      AND d.date_kind IN ('dates', 'work')
                    ORDER BY CASE d.date_kind WHEN 'dates' THEN 0 ELSE 1 END, d.id
                    LIMIT 1
                  )
                  ELSE (
                    SELECT d.start_year FROM entity_dates d
                    WHERE d.entity_id = e.id AND d.status = 'active' AND d.date_kind = 'birth'
                    ORDER BY d.id LIMIT 1
                  )
                END AS start_year,
                CASE
                  WHEN e.kind = 'work' THEN (
                    SELECT d.end_year FROM entity_dates d
                    WHERE d.entity_id = e.id AND d.status = 'active'
                      AND d.date_kind IN ('dates', 'work')
                    ORDER BY CASE d.date_kind WHEN 'dates' THEN 0 ELSE 1 END, d.id
                    LIMIT 1
                  )
                  ELSE (
                    SELECT d.start_year FROM entity_dates d
                    WHERE d.entity_id = e.id AND d.status = 'active' AND d.date_kind = 'death'
                    ORDER BY d.id LIMIT 1
                  )
                END AS end_year
         FROM entities e
         JOIN entity_names n
           ON n.entity_id = e.id
          AND n.status = 'active'
          AND n.id = (
            SELECT n2.id FROM entity_names n2
            WHERE n2.entity_id = e.id AND n2.status = 'active'
            ORDER BY n2.is_primary DESC, n2.id
            LIMIT 1
          )
         WHERE e.kind = ? AND e.deleted_at IS NULL`, [kind])) as {
      id: string;
      primary_name: string;
      start_year: number | null;
      end_year: number | null;
    }[];

    const matches: string[] = [];
    for (const row of rows) {
      if (!stringsMatchExactly(name, row.primary_name)) continue;
      if (startYear != null && row.start_year != null && row.start_year !== startYear) continue;
      if (endYear != null && row.end_year != null && row.end_year !== endYear) continue;
      matches.push(row.id);
    }
    return matches.length === 1 ? matches[0]! : null;
  }

  /** Force an assertion to rejected (tombstone propagation across databases). */
  async forceRejectAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    const parsed = parseAssertionKey(key);
    if (!parsed || parsed.kind !== 'row') return false;
    const ownerCol = ASSERTION_OWNER[parsed.table];
    if (!ownerCol) return false;
    return this.transaction(async () => {
      const row = (await this.activeBackend.get(`SELECT * FROM ${parsed.table} WHERE id = ?`, [parsed.rowId])) as Record<string, unknown> | undefined;
      if (!row || String(row[ownerCol]) !== entityId) return false;
      if (String(row.status) === 'rejected') return false;
      (await this.activeBackend.run(`UPDATE ${parsed.table}
           SET status = 'rejected', updated_at = ?
           WHERE id = ?`, [now, parsed.rowId]));
      (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
             (entity_id, table_name, row_id, reason, created_at)
           VALUES (?, ?, ?, 'propagated-rejected', ?)`, [entityId, parsed.table, parsed.rowId, now]));
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async listCentralMappings(entityId: string): Promise<SqliteCentralMapping[]> {
    return (
      (await this.activeBackend.all(`SELECT user_stable_id, central_entity_id
           FROM central_mappings WHERE project_entity_id = ? ORDER BY user_stable_id`, [entityId])) as { user_stable_id: string; central_entity_id: string }[]
    ).map((row) => ({
      userStableId: row.user_stable_id,
      centralId: row.central_entity_id,
    }));
  }

  async getCentralId(entityId: string, userStableId: string): Promise<string | null> {
    const row = (await this.activeBackend.get(`SELECT central_entity_id FROM central_mappings
         WHERE project_entity_id = ? AND user_stable_id = ?`, [entityId, userStableId])) as { central_entity_id?: string } | undefined;
    return row?.central_entity_id ? String(row.central_entity_id) : null;
  }

  async setCentralMapping(
    entityId: string,
    userStableId: string,
    centralId: string,
    now = nowIso(),
  ): Promise<boolean> {
    const entity = (await this.getEntity(entityId));
    if (!entity || entity.deletedAt) throw new Error(`Unknown entity id: ${entityId}`);
    const existing = (await this.getCentralId(entityId, userStableId));
    if (existing === centralId) return false;
    (await this.activeBackend.run(`INSERT INTO central_mappings
           (project_entity_id, central_entity_id, user_stable_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_entity_id, user_stable_id) DO UPDATE SET
           central_entity_id = excluded.central_entity_id,
           updated_at = excluded.updated_at`, [entityId, centralId, userStableId, now, now]));
    // Concordance writes deliberately do not bump entity revision/updated_at.
    return true;
  }

  async clearCentralMapping(entityId: string, userStableId: string): Promise<boolean> {
    const result = (await this.activeBackend.run(`DELETE FROM central_mappings
         WHERE project_entity_id = ? AND user_stable_id = ?`, [entityId, userStableId]));
    return Number(result.changes) > 0;
  }

  /**
   * Central entity ids already linked from this PEDB for `userStableId`.
   * Used to hide mirrored CEDB rows from disambiguation candidate lists.
   */
  async listLinkedCentralIds(userStableId: string): Promise<string[]> {
    return (
      (await this.activeBackend.all(`SELECT DISTINCT m.central_entity_id
           FROM central_mappings m
           JOIN entities e ON e.id = m.project_entity_id
           WHERE m.user_stable_id = ?
             AND e.deleted_at IS NULL
           ORDER BY m.central_entity_id`, [userStableId])) as { central_entity_id: string }[]
    ).map((row) => String(row.central_entity_id));
  }

  /**
   * Active PEDB entities with no central mapping for `userStableId`.
   * Used to decide whether catch-up sync is needed without promoting.
   */
  async countUnlinkedForUser(userStableId: string): Promise<number> {
    const row = (await this.activeBackend.get(`SELECT COUNT(*) AS count
         FROM entities e
         WHERE e.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM central_mappings m
             WHERE m.project_entity_id = e.id
               AND m.user_stable_id = ?
           )`, [userStableId])) as { count: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  /** Active (non-deleted) entity count — cheap for achievements / status UI. */
  async countActiveEntities(): Promise<number> {
    const row = (await this.activeBackend.get(`SELECT COUNT(*) AS count FROM entities WHERE deleted_at IS NULL`)) as { count: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  /**
   * Project entities for this user whose central mapping is one of `centralIds`.
   * Used to apply CEDB merge/delete orders to PEDB concordance rows.
   */
  async listMappingsByCentralIds(
    userStableId: string,
    centralIds: string[],
  ): Promise<{ projectEntityId: string; centralId: string; label: string | null }[]> {
    if (centralIds.length === 0) return [];
    const placeholders = centralIds.map(() => '?').join(', ');
    const rows = (await this.activeBackend.all(`SELECT m.project_entity_id, m.central_entity_id,
                (SELECT n.text FROM entity_names n
                 WHERE n.entity_id = m.project_entity_id AND n.status = 'active'
                 ORDER BY n.is_primary DESC, n.id LIMIT 1) AS label
         FROM central_mappings m
         JOIN entities e ON e.id = m.project_entity_id
         WHERE m.user_stable_id = ?
           AND e.deleted_at IS NULL
           AND m.central_entity_id IN (${placeholders})`, [userStableId, ...centralIds])) as {
      project_entity_id: string;
      central_entity_id: string;
      label: string | null;
    }[];
    return rows.map((row) => ({
      projectEntityId: row.project_entity_id,
      centralId: row.central_entity_id,
      label: row.label,
    }));
  }

  /**
   * Every active PEDB↔CEDB mapping for one user. Used by the database viewer to
   * show project keys when browsing central (and the reverse on the project view).
   */
  async listAllCentralMappingsForUser(
    userStableId: string,
  ): Promise<{ projectEntityId: string; centralId: string }[]> {
    const rows = (await this.activeBackend.all(`SELECT m.project_entity_id, m.central_entity_id
         FROM central_mappings m
         JOIN entities e ON e.id = m.project_entity_id
         WHERE m.user_stable_id = ?
           AND e.deleted_at IS NULL`, [userStableId])) as {
      project_entity_id: string;
      central_entity_id: string;
    }[];
    return rows.map((row) => ({
      projectEntityId: row.project_entity_id,
      centralId: row.central_entity_id,
    }));
  }

  /**
   * Merge dropIds into keepId. Dropped entities are soft-deleted.
   * Mirrors XML mergeEntities for names, authorities, central mappings,
   * description, family/given, and authority caches.
   */
  async mergeEntities(keepId: string, dropIds: string[]): Promise<SqliteMergeResult> {
    const keeper = (await this.getEntity(keepId));
    if (!keeper || keeper.deletedAt) throw new Error(`Unknown entity id: ${keepId}`);
    const remap: Record<string, string> = {};
    const centralConflicts: SqliteCentralMergeConflict[] = [];
    await this.transaction(async () => {
      const now = nowIso();
      for (const dropId of dropIds) {
        if (dropId === keepId) continue;
        const dropped = (await this.getEntity(dropId));
        if (!dropped || dropped.deletedAt) throw new Error(`Unknown entity id: ${dropId}`);
        if (dropped.kind !== keeper.kind) {
          throw new Error(
            `Cannot merge ${dropId} (${dropped.kind}) into ${keepId} (${keeper.kind}): different kinds.`,
          );
        }

        const keepNames = new Set(
          (
            (await this.activeBackend.all(`SELECT text FROM entity_names WHERE entity_id = ? AND status = 'active'`, [keepId])) as { text: string }[]
          ).map((row) => row.text),
        );
        for (const name of (await this.activeBackend.all(`SELECT text, name_type, language, origin, source FROM entity_names
             WHERE entity_id = ? AND status = 'active' ORDER BY id`, [dropId])) as {
          text: string;
          name_type: string | null;
          language: string | null;
          origin: SqliteValueOrigin;
          source: string | null;
        }[]) {
          if (keepNames.has(name.text)) continue;
          const rawType = normalizePersonNameType(name.name_type);
          const nameType = rawType === 'primary' ? 'variant' : rawType;
          const nameRole = nameType === 'family' || nameType === 'given' ? nameType : 'variant';
          (await this.activeBackend.run(`INSERT INTO entity_names
                 (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?)`, [keepId,
              name.text,
              nameType,
              nameRole,
              name.language,
              name.origin,
              name.source,
              now,
              now,]));
          (await this.syncPersonNameScalars(keepId, name.text, nameType, now));
          keepNames.add(name.text);
        }

        for (const authority of (await this.activeBackend.all(`SELECT authority_type AS type, authority_value AS value, origin, source
             FROM entity_authorities
             WHERE entity_id = ? AND status = 'active' AND authority_type != ?`, [dropId, CENTRAL_AUTHORITY_TYPE])) as {
          type: string;
          value: string;
          origin: SqliteValueOrigin;
          source: string | null;
        }[]) {
          const normalized = normalizeAuthorityValue(authority.type, authority.value);
          const existing = (await this.activeBackend.all(`SELECT id, authority_value, status FROM entity_authorities
               WHERE entity_id = ? AND authority_type = ?`, [keepId, authority.type])) as {
            id: number;
            authority_value: string;
            status: string;
          }[];
          const match = existing.find(
            (row) => normalizeAuthorityValue(authority.type, row.authority_value) === normalized,
          );
          if (match) {
            if (match.status !== 'active') {
              (await this.activeBackend.run(`UPDATE entity_authorities
                   SET authority_value = ?, status = 'active', origin = ?, source = ?, updated_at = ?
                   WHERE id = ?`, [authority.value, authority.origin, authority.source, now, match.id]));
            }
          } else {
            (await this.activeBackend.run(`INSERT INTO entity_authorities
                   (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`, [keepId,
                authority.type,
                authority.value,
                authority.origin,
                authority.source,
                now,
                now,]));
          }
        }

        for (const mapping of (await this.listCentralMappings(dropId))) {
          const keptCentralId = (await this.getCentralId(keepId, mapping.userStableId));
          if (!keptCentralId) {
            (await this.activeBackend.run(`INSERT INTO central_mappings
                   (project_entity_id, central_entity_id, user_stable_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(project_entity_id, user_stable_id) DO UPDATE SET
                   central_entity_id = excluded.central_entity_id,
                   updated_at = excluded.updated_at`, [keepId, mapping.centralId, mapping.userStableId, now, now]));
          } else if (keptCentralId !== mapping.centralId) {
            centralConflicts.push({
              userStableId: mapping.userStableId,
              keptCentralId,
              droppedCentralId: mapping.centralId,
            });
          }
        }

        const freshKeeper = (await this.getEntity(keepId));
        if (!freshKeeper?.description && dropped.description) {
          (await this.activeBackend.run('UPDATE entities SET description = ?, updated_at = ? WHERE id = ?', [dropped.description, now, keepId]));
        }

        if (keeper.kind === 'person') {
          const keepPerson = (await this.activeBackend.get('SELECT family_name, given_name FROM people WHERE entity_id = ?', [keepId])) as { family_name: string | null; given_name: string | null } | undefined;
          const dropPerson = (await this.activeBackend.get('SELECT family_name, given_name FROM people WHERE entity_id = ?', [dropId])) as { family_name: string | null; given_name: string | null } | undefined;
          if (
            !keepPerson?.family_name &&
            dropPerson?.family_name &&
            !keepNames.has(dropPerson.family_name)
          ) {
            (await this.activeBackend.run(`INSERT INTO entity_names
                   (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, 'family', 'family', NULL, 0, 'xml', NULL, 'active', ?, ?)`, [keepId, dropPerson.family_name, now, now]));
            (await this.syncPersonNameScalars(keepId, dropPerson.family_name, 'family', now));
            keepNames.add(dropPerson.family_name);
          }
          if (
            !keepPerson?.given_name &&
            dropPerson?.given_name &&
            !keepNames.has(dropPerson.given_name)
          ) {
            (await this.activeBackend.run(`INSERT INTO entity_names
                   (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, 'given', 'given', NULL, 0, 'xml', NULL, 'active', ?, ?)`, [keepId, dropPerson.given_name, now, now]));
            (await this.syncPersonNameScalars(keepId, dropPerson.given_name, 'given', now));
            keepNames.add(dropPerson.given_name);
          }
        }

        const keepCacheSources = new Set(
          (
            (await this.activeBackend.all(`SELECT authority_type, source FROM authority_caches WHERE entity_id = ?`, [keepId])) as { authority_type: string; source: string | null }[]
          ).map((row) => `${row.authority_type}\t${row.source ?? ''}`),
        );
        for (const cache of (await this.activeBackend.all(`SELECT authority_type, source, payload_json, retrieved_at, status
             FROM authority_caches WHERE entity_id = ?`, [dropId])) as {
          authority_type: string;
          source: string | null;
          payload_json: string;
          retrieved_at: string | null;
          status: string;
        }[]) {
          const key = `${cache.authority_type}\t${cache.source ?? ''}`;
          if (keepCacheSources.has(key)) continue;
          (await this.activeBackend.run(`INSERT OR REPLACE INTO authority_caches
                 (entity_id, authority_type, source, payload_json, retrieved_at, status)
               VALUES (?, ?, ?, ?, ?, ?)`, [keepId,
              cache.authority_type,
              cache.source,
              cache.payload_json,
              cache.retrieved_at,
              cache.status,]));
          keepCacheSources.add(key);
        }

        (await this.activeBackend.run(`UPDATE entities
             SET deleted_at = ?, updated_at = ?, revision = revision + 1
             WHERE id = ?`, [now, now, dropId]));
        remap[dropId] = keepId;
      }
      if (Object.keys(remap).length > 0) (await this.bumpEntity(keepId, nowIso()));
    });
    return { keepId, remap, centralConflicts };
  }

  async getEntity(id: string): Promise<SqliteEntity | null> {
    const row = (await this.activeBackend.get('SELECT * FROM entities WHERE id = ?', [id])) as
      Record<string, unknown> | undefined;
    return row ? rowEntity(row) : null;
  }

  async getSummary(id: string): Promise<SqliteEntitySummary | null> {
    const entity = (await this.getEntity(id));
    if (!entity) return null;
    return { ...entity, names: (await this.listNames(id)) };
  }

  async getPanelSummary(
    id: string,
    allRejections?: SqliteConcordanceRejection[],
  ): Promise<SqliteEntityPanelSummary | null> {
    const entity = (await this.getEntity(id));
    if (!entity || entity.deletedAt) return null;
    const names = (await this.listNames(id));
    const activeAuthorities = (await this.activeBackend.all(`SELECT authority_type AS type, authority_value AS value
         FROM entity_authorities WHERE entity_id = ? AND status = 'active' ORDER BY id`, [id])) as { type: string; value: string }[];
    return assemblePanelSummary(
      entity,
      names,
      {
        activeAuthorities,
        allAuthorities: (await this.activeBackend.all(`SELECT id, authority_type, authority_value, origin, source, status
             FROM entity_authorities WHERE entity_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        person: (await this.activeBackend.get('SELECT family_name, given_name FROM people WHERE entity_id = ?', [id])) as { family_name: string | null; given_name: string | null } | undefined,
        work: (await this.activeBackend.get('SELECT work_type FROM works WHERE entity_id = ?', [id])) as
          { work_type: string | null } | undefined,
        dates: (await this.activeBackend.all(`SELECT id, date_kind, start_year, end_year, start_precision, end_precision,
                    when_value, not_before, not_after, from_value, to_value,
                    raw_text, origin, source, status
             FROM entity_dates WHERE entity_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        nationalityRows: (await this.activeBackend.all(`SELECT id, label, reference, origin, source, status
             FROM person_nationalities WHERE person_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        originRows: (await this.activeBackend.all(`SELECT id, label, reference, origin, source, status
             FROM person_origins WHERE person_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        officeRows: (await this.activeBackend.all(`SELECT id, office_label, reference, origin, source, status
             FROM person_offices WHERE person_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        authorRows: (await this.activeBackend.all(`SELECT id, label, reference, origin, source, status
             FROM work_authors WHERE work_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        titleRows: (await this.activeBackend.all(`SELECT id, dynasty, place_name, role_name, posthumous_name,
                    reference, origin, source, status
             FROM person_titles WHERE person_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        nameAssertionRows: (await this.activeBackend.all(`SELECT id, text, origin, source, status, name_type FROM entity_names
             WHERE entity_id = ? ORDER BY is_primary DESC, id`, [id])) as Record<string, unknown>[],
        translationRows: (await this.activeBackend.all(`SELECT id, entity_id, text, language, origin, source, status, created_at, updated_at
             FROM entity_translations WHERE entity_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        descriptionRows: (await this.activeBackend.all(`SELECT id, value, origin, source, status
             FROM entity_metadata
             WHERE entity_id = ? AND key = 'description'
             ORDER BY id`, [id])) as Record<string, unknown>[],
        classificationRows: (await this.activeBackend.all(`SELECT id, classification_id, reference, label, origin, source, status
             FROM office_classifications WHERE office_id = ? ORDER BY id`, [id])) as Record<string, unknown>[],
        subtype:
          (
            (await this.activeBackend.get(`SELECT value FROM entity_metadata
                 WHERE entity_id = ? AND key = 'subtype' AND status = 'active'
                 ORDER BY id DESC LIMIT 1`, [id])) as { value: string } | undefined
          )?.value ?? null,
      },
      allRejections ?? (await this.listConcordanceRejections()),
    );
  }

  /**
   * Load every Database-tab snapshot with a handful of bulk queries.
   * Prefer this over mapping `getPanelSummary` across tens of thousands of
   * entities — that path runs N+1 SQLite calls on Electron's main thread and
   * freezes Reload / DevTools while the spinner spins.
   */
  async listPanelSummaries(
    kind?: SqliteEntityKind,
    allRejections?: SqliteConcordanceRejection[],
  ): Promise<SqliteEntityPanelSummary[]> {
    const rejections = allRejections ?? (await this.listConcordanceRejections());
    const entityRows = (
      kind
        ? (await this.activeBackend.all('SELECT * FROM entities WHERE kind = ? AND deleted_at IS NULL ORDER BY id', [kind]))
        : (await this.activeBackend.all('SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY id'))
    ) as Record<string, unknown>[];
    if (entityRows.length === 0) return [];

    const namesByEntity = groupRowsByKey(
      (await this.activeBackend.all('SELECT * FROM entity_names ORDER BY is_primary DESC, id')) as Record<
        string,
        unknown
      >[],
      'entity_id',
    );
    const translationsByEntity = groupRowsByKey(
      (await this.activeBackend.all('SELECT * FROM entity_translations ORDER BY id')) as Record<
        string,
        unknown
      >[],
      'entity_id',
    );
    const authoritiesByEntity = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, entity_id, authority_type, authority_value, origin, source, status
           FROM entity_authorities ORDER BY id`)) as Record<string, unknown>[],
      'entity_id',
    );
    const peopleByEntity = new Map(
      (
        (await this.activeBackend.all('SELECT entity_id, family_name, given_name FROM people')) as Record<
          string,
          unknown
        >[]
      ).map((row) => [
        String(row.entity_id),
        {
          family_name: (row.family_name as string | null) ?? null,
          given_name: (row.given_name as string | null) ?? null,
        },
      ]),
    );
    const worksByEntity = new Map(
      (
        (await this.activeBackend.all('SELECT entity_id, work_type FROM works')) as Record<string, unknown>[]
      ).map((row) => [
        String(row.entity_id),
        { work_type: (row.work_type as string | null) ?? null },
      ]),
    );
    const datesByEntity = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, entity_id, date_kind, start_year, end_year, start_precision, end_precision,
                  when_value, not_before, not_after, from_value, to_value,
                  raw_text, origin, source, status
           FROM entity_dates ORDER BY id`)) as Record<string, unknown>[],
      'entity_id',
    );
    const nationalityByPerson = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, person_id, label, reference, origin, source, status
           FROM person_nationalities ORDER BY id`)) as Record<string, unknown>[],
      'person_id',
    );
    const originByPerson = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, person_id, label, reference, origin, source, status
           FROM person_origins ORDER BY id`)) as Record<string, unknown>[],
      'person_id',
    );
    const officeByPerson = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, person_id, office_label, reference, origin, source, status
           FROM person_offices ORDER BY id`)) as Record<string, unknown>[],
      'person_id',
    );
    const authorByWork = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, work_id, label, reference, origin, source, status
           FROM work_authors ORDER BY id`)) as Record<string, unknown>[],
      'work_id',
    );
    const titleByPerson = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, person_id, dynasty, place_name, role_name, posthumous_name,
                  reference, origin, source, status
           FROM person_titles ORDER BY id`)) as Record<string, unknown>[],
      'person_id',
    );
    const descriptionByEntity = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, entity_id, value, origin, source, status
           FROM entity_metadata WHERE key = 'description' ORDER BY id`)) as Record<string, unknown>[],
      'entity_id',
    );
    const subtypeByEntity = new Map<string, string>();
    for (const row of (await this.activeBackend.all(`SELECT entity_id, value FROM entity_metadata
         WHERE key = 'subtype' AND status = 'active' ORDER BY id`)) as { entity_id: string; value: string }[]) {
      subtypeByEntity.set(row.entity_id, row.value);
    }
    const classificationByOffice = groupRowsByKey(
      (await this.activeBackend.all(`SELECT id, office_id, classification_id, reference, label, origin, source, status
           FROM office_classifications ORDER BY id`)) as Record<string, unknown>[],
      'office_id',
    );

    const empty: Record<string, unknown>[] = [];
    return entityRows.map((row) => {
      const entity = rowEntity(row);
      const id = entity.id;
      const nameRows = namesByEntity.get(id) ?? empty;
      const authorityRows = authoritiesByEntity.get(id) ?? empty;
      const names = nameRows
        .filter((name) => name.status === 'active')
        .map((name) => rowName(name));
      return assemblePanelSummary(
        entity,
        names,
        {
          activeAuthorities: authorityRows
            .filter((authority) => authority.status === 'active')
            .map((authority) => ({
              type: String(authority.authority_type),
              value: String(authority.authority_value),
            })),
          allAuthorities: authorityRows,
          person: peopleByEntity.get(id),
          work: worksByEntity.get(id),
          dates: datesByEntity.get(id) ?? empty,
          nationalityRows: nationalityByPerson.get(id) ?? empty,
          originRows: originByPerson.get(id) ?? empty,
          officeRows: officeByPerson.get(id) ?? empty,
          authorRows: authorByWork.get(id) ?? empty,
          titleRows: titleByPerson.get(id) ?? empty,
          nameAssertionRows: nameRows,
          translationRows: translationsByEntity.get(id) ?? empty,
          descriptionRows: descriptionByEntity.get(id) ?? empty,
          classificationRows: classificationByOffice.get(id) ?? empty,
          subtype: subtypeByEntity.get(id) ?? null,
        },
        rejections,
      );
    });
  }

  async listEntities(kind?: SqliteEntityKind): Promise<SqliteEntity[]> {
    const rows = kind
      ? (await this.activeBackend.all('SELECT * FROM entities WHERE kind = ? ORDER BY id', [kind]))
      : (await this.activeBackend.all('SELECT * FROM entities ORDER BY kind, id'));
    return rows.map((row) => rowEntity(row as Record<string, unknown>));
  }

  async listEntityIds(kind?: SqliteEntityKind): Promise<string[]> {
    const rows = kind
      ? (await this.activeBackend.all('SELECT id FROM entities WHERE kind = ? AND deleted_at IS NULL ORDER BY id', [kind]))
      : (await this.activeBackend.all('SELECT id FROM entities WHERE deleted_at IS NULL ORDER BY id'));
    return rows.map((row) => String((row as Record<string, unknown>).id));
  }

  async searchNames(kind: SqliteEntityKind, query: string, limit = 20): Promise<SqliteEntityLookupResult[]> {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized) return [];
    const rows = (await this.activeBackend.all(`SELECT e.id, e.description,
              (SELECT n2.text FROM entity_names n2
               WHERE n2.entity_id = e.id AND n2.status = 'active'
               ORDER BY n2.is_primary DESC, n2.id LIMIT 1) AS label
       FROM entities e
       JOIN entity_names n ON n.entity_id = e.id
       WHERE e.kind = ? AND e.deleted_at IS NULL AND n.status = 'active'
         AND lower(trim(n.text)) = ?
       GROUP BY e.id, e.description
       ORDER BY MAX(n.is_primary) DESC, e.id
       LIMIT ?`, [kind, normalized, limit])) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      ...(row.description ? { description: String(row.description) } : {}),
      idnos: (await this.activeBackend.all("SELECT authority_type AS type, authority_value AS value FROM entity_authorities WHERE entity_id = ? AND status = 'active' ORDER BY id", [String(row.id)])) as { type: string; value: string }[],
    }));
  }

  async listAuthorityDuplicates(): Promise<SqliteDuplicateGroup[]> {
    const rows = (await this.activeBackend.all(`SELECT a.authority_type, a.authority_value, a.entity_id
         FROM entity_authorities a
         JOIN entities e ON e.id = a.entity_id
         WHERE a.status = 'active' AND e.deleted_at IS NULL
         ORDER BY a.authority_type, a.authority_value, a.entity_id`)) as { authority_type: string; authority_value: string; entity_id: string }[];
    const groups = new Map<string, SqliteDuplicateGroup>();
    for (const row of rows) {
      const value = /^wikidata$/i.test(row.authority_type)
        ? (row.authority_value.match(/(Q\d+)\s*$/i)?.[1]?.toUpperCase() ??
          row.authority_value.trim())
        : /^viaf$/i.test(row.authority_type)
          ? (row.authority_value.match(/(\d+)\s*\/?\s*$/)?.[1] ?? row.authority_value.trim())
          : row.authority_value.trim();
      const key = `${row.authority_type.toLowerCase()}\t${value}`;
      const group = groups.get(key) ?? {
        type: row.authority_type,
        value,
        entityIds: [],
      };
      if (!group.entityIds.includes(row.entity_id)) group.entityIds.push(row.entity_id);
      groups.set(key, group);
    }
    const intentional = (await this.activeBackend.all(`SELECT target_refs FROM entity_decisions
         WHERE decision_type = 'duplicate-ok' AND target_refs IS NOT NULL`))
      .map((row) =>
        String((row as { target_refs: string }).target_refs)
          .split(/\s+/)
          .map((id) => id.replace(/^#/, ''))
          .filter(Boolean),
      )
      .filter((ids) => ids.length > 1);
    return Array.from(groups.values()).filter(
      (group) =>
        group.entityIds.length > 1 &&
        !intentional.some((ids) => group.entityIds.every((id) => ids.includes(id))),
    );
  }

  async listConcordanceRejections(): Promise<SqliteConcordanceRejection[]> {
    const rows = (await this.activeBackend.all(`SELECT entity_id, source, target_refs, payload_json
         FROM entity_decisions
         WHERE decision_type = 'concordance-rejected' AND target_refs IS NOT NULL
         ORDER BY id`)) as {
      entity_id: string;
      source: string | null;
      target_refs: string;
      payload_json: string | null;
    }[];
    const rejections: SqliteConcordanceRejection[] = [];
    for (const row of rows) {
      const parts = row.target_refs.split(/\s+/).filter(Boolean).sort();
      if (parts.length !== 2) continue;
      let reason: string | null = null;
      const payload = row.payload_json?.trim() || null;
      if (payload) {
        try {
          const parsed = JSON.parse(payload) as { reason?: string | null };
          if (parsed && typeof parsed === 'object' && 'reason' in parsed) {
            reason = parsed.reason ?? null;
          }
        } catch {
          // Plain-text payload is concordance notes, not a reason.
        }
      }
      rejections.push({
        source: row.source ?? parts[0]!.split(':')[0] ?? '',
        leftId: parts[0]!,
        rightId: parts[1]!,
        reason,
        entityId: row.entity_id,
      });
    }
    return rejections;
  }

  async isConcordanceRejected(association: SqliteConcordanceAssociation): Promise<boolean> {
    const [left, right] = concordanceRefs(association);
    return (await this.listConcordanceRejections()).some(
      (rejection) => rejection.leftId === left && rejection.rightId === right,
    );
  }

  async rejectConcordance(
    association: SqliteConcordanceAssociation,
    entityId?: string,
    reason = 'user',
  ): Promise<boolean> {
    if ((await this.isConcordanceRejected(association))) return false;
    const [left, right] = concordanceRefs(association);
    const ownerId =
      entityId ??
      (await this.activeBackend.all(`SELECT a.entity_id AS id
           FROM entity_authorities a
           JOIN entities e ON e.id = a.entity_id
           WHERE a.status = 'active' AND e.deleted_at IS NULL
             AND a.authority_type != ?
           ORDER BY a.id`, [CENTRAL_AUTHORITY_TYPE]))
        .map((row) => row as { id: string })
        .find((row) => {
          const refs = (await this.activeAuthorityRefs(row.id));
          return refs.includes(left) || refs.includes(right);
        })?.id;
    if (!ownerId || !(await this.getEntity(ownerId))) return false;
    const now = nowIso();
    const payload =
      association.notes || reason
        ? JSON.stringify({ reason, notes: association.notes ?? null })
        : null;
    (await this.activeBackend.run(`INSERT INTO entity_decisions
           (entity_id, decision_type, target_refs, payload_json, origin, source, created_at)
         VALUES (?, 'concordance-rejected', ?, ?, 'user', ?, ?)`, [ownerId, `${left} ${right}`, payload, association.source, now]));
    (await this.bumpEntity(ownerId, now));
    return true;
  }

  /**
   * Record that a set of entities intentionally share an authority id.
   * Mirrors XML `note type="duplicate-ok" target="#a #b"`.
   */
  async markDuplicateIntentional(ids: string[]): Promise<boolean> {
    const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (unique.length < 2) {
      throw new Error('An intentional-duplicate group needs at least two ids.');
    }
    for (const id of unique) {
      if (!(await this.getEntity(id))) throw new Error(`Unknown entity id: ${id}`);
    }
    const ownerId = unique[0]!;
    const targetRefs = unique.map((id) => `#${id}`).join(' ');
    const existing = (await this.activeBackend.get(`SELECT id FROM entity_decisions
         WHERE entity_id = ? AND decision_type = 'duplicate-ok' AND target_refs = ?`, [ownerId, targetRefs])) as { id: number } | undefined;
    if (existing) return false;
    const now = nowIso();
    (await this.activeBackend.run(`INSERT INTO entity_decisions
           (entity_id, decision_type, target_refs, payload_json, origin, source, created_at)
         VALUES (?, 'duplicate-ok', ?, NULL, 'user', NULL, ?)`, [ownerId, targetRefs, now]));
    (await this.bumpEntity(ownerId, now));
    return true;
  }

  /**
   * Restore missing `target_refs` (and insert absent decision rows) from a
   * sibling XML parse. Idempotent: matching target_refs are left alone.
   */
  async backfillDecisionTargets(entries: DecisionTargetBackfillEntry[]): Promise<DecisionTargetBackfillReport> {
    const report: DecisionTargetBackfillReport = { updated: 0, inserted: 0, unchanged: 0 };
    return this.transaction(async () => {
      for (const entry of entries) {
        if (!(await this.getEntity(entry.entityId))) continue;
        const targetRefs = entry.targetRefs.trim();
        if (!targetRefs) continue;
        const same = (await this.activeBackend.get(`SELECT id FROM entity_decisions
             WHERE entity_id = ? AND decision_type = ? AND target_refs = ?`, [entry.entityId, entry.decisionType, targetRefs])) as { id: number } | undefined;
        if (same) {
          report.unchanged += 1;
          continue;
        }
        const missing = (await this.activeBackend.get(`SELECT id FROM entity_decisions
             WHERE entity_id = ? AND decision_type = ?
               AND (target_refs IS NULL OR trim(target_refs) = '')
             ORDER BY id LIMIT 1`, [entry.entityId, entry.decisionType])) as { id: number } | undefined;
        if (missing) {
          (await this.activeBackend.run(`UPDATE entity_decisions
               SET target_refs = ?,
                   source = COALESCE(?, source),
                   payload_json = COALESCE(?, payload_json)
               WHERE id = ?`, [targetRefs, entry.source ?? null, entry.payloadJson ?? null, missing.id]));
          report.updated += 1;
          continue;
        }
        (await this.activeBackend.run(`INSERT INTO entity_decisions
               (entity_id, decision_type, target_refs, payload_json, origin, source, created_at)
             VALUES (?, ?, ?, ?, 'xml', ?, ?)`, [entry.entityId,
            entry.decisionType,
            targetRefs,
            entry.payloadJson ?? null,
            entry.source ?? null,
            nowIso(),]));
        report.inserted += 1;
      }
      return report;
    });
  }

  async applyConcordanceAssociations(
    associations: SqliteConcordanceAssociation[],
  ): Promise<SqliteConcordanceImportResult> {
    return this.transaction(async () => {
      const result: SqliteConcordanceImportResult = {
        applied: 0,
        alreadyPresent: 0,
        rejected: 0,
        unresolved: 0,
        conflicts: [],
      };
      const ownersByRef = new Map<string, string[]>();
      const authorityRows = (await this.activeBackend.all(`SELECT a.entity_id, a.authority_type, a.authority_value
           FROM entity_authorities a
           JOIN entities e ON e.id = a.entity_id
           WHERE a.status = 'active' AND e.deleted_at IS NULL
             AND a.authority_type != ?`, [CENTRAL_AUTHORITY_TYPE])) as {
        entity_id: string;
        authority_type: string;
        authority_value: string;
      }[];
      for (const row of authorityRows) {
        const ref = concordanceRef(row.authority_type, row.authority_value);
        const owners = ownersByRef.get(ref) ?? [];
        if (!owners.includes(row.entity_id)) owners.push(row.entity_id);
        ownersByRef.set(ref, owners);
      }

      const rejectedPairs = new Set(
        (await this.listConcordanceRejections()).map(
          (rejection) => `${rejection.leftId}\t${rejection.rightId}`,
        ),
      );

      for (const association of associations) {
        const [left, right] = concordanceRefs(association);
        if (rejectedPairs.has(`${left}\t${right}`)) {
          result.rejected += 1;
          continue;
        }
        const owners = Array.from(
          new Set([...(ownersByRef.get(left) ?? []), ...(ownersByRef.get(right) ?? [])]),
        );
        if (owners.length === 0) {
          result.unresolved += 1;
          continue;
        }
        if (owners.length > 1) {
          result.conflicts.push({ association, entityIds: owners });
          continue;
        }
        const ownerId = owners[0]!;
        const refs = new Set((await this.activeAuthorityRefs(ownerId)));
        const missing = [
          [association.source, association.canonicalId],
          [association.source, association.mergedFromId],
        ].filter(([, id]) => !refs.has(concordanceRef(association.source, id))) as [
          string,
          string,
        ][];
        if (!missing.length) {
          result.alreadyPresent += 1;
          continue;
        }
        for (const [type, value] of missing) {
          (await this.attachAuthority({
            entityId: ownerId,
            type,
            value,
            origin: 'authority',
            source: association.source,
          }));
          const ref = concordanceRef(type, value);
          const mapped = ownersByRef.get(ref) ?? [];
          if (!mapped.includes(ownerId)) mapped.push(ownerId);
          ownersByRef.set(ref, mapped);
        }
        result.applied += 1;
      }
      return result;
    });
  }

  private async activeAuthorityRefs(entityId: string): Promise<string[]> {
    return (
      (await this.activeBackend.all(`SELECT authority_type AS type, authority_value AS value
           FROM entity_authorities
           WHERE entity_id = ? AND status = 'active' AND authority_type != ?`, [entityId, CENTRAL_AUTHORITY_TYPE])) as { type: string; value: string }[]
    ).map((row) => concordanceRef(row.type, row.value));
  }

  async listCandidateRecords(kind: SqliteEntityKind): Promise<SqliteEntityCandidateRecord[]> {
    const entities = (await this.activeBackend.all(`SELECT e.id, e.kind, e.description
         FROM entities e
         WHERE e.kind = ? AND e.deleted_at IS NULL
         ORDER BY e.id`, [kind])) as Record<string, unknown>[];
    const namesSql = `SELECT text, name_type FROM entity_names
       WHERE entity_id = ? AND status = 'active'
       ORDER BY is_primary DESC, id`;
    const datesSql = `SELECT date_kind, start_year, end_year FROM entity_dates
       WHERE entity_id = ? AND status = 'active'
       ORDER BY id`;
    const titlesSql = `SELECT place_name, role_name, posthumous_name, dynasty
       FROM person_titles WHERE person_id = ? AND status = 'active' ORDER BY id`;
    const subtypeSql = `SELECT value FROM entity_metadata
       WHERE entity_id = ? AND key = 'subtype' AND status = 'active'
       ORDER BY id DESC LIMIT 1`;
    const records: SqliteEntityCandidateRecord[] = [];
    for (const entity of entities) {
      const id = String(entity.id);
      const entityNames = (await this.activeBackend.all(namesSql, [id])) as Record<string, unknown>[];
      const entityDates = (await this.activeBackend.all(datesSql, [id])) as Record<string, unknown>[];
      const startYears = entityDates
        .map((date) => date.start_year)
        .filter((value): value is number => typeof value === 'number');
      const endYears = entityDates
        .map((date) => date.end_year)
        .filter((value): value is number => typeof value === 'number');
      const entityTitles = (await this.activeBackend.all(titlesSql, [id])) as Record<string, unknown>[];
      const subtypeRow =
        entity.kind === 'thing'
          ? ((await this.activeBackend.get(subtypeSql, [id])) as { value: string } | undefined)
          : undefined;
      records.push({
        id,
        kind: entity.kind as SqliteEntityKind,
        names: entityNames.map((name) => ({
          text: String(name.text),
          ...(name.name_type ? { type: String(name.name_type) } : {}),
        })),
        ...(entity.description ? { description: String(entity.description) } : {}),
        ...(startYears.length ? { startYear: Math.min(...startYears) } : {}),
        ...(endYears.length ? { endYear: Math.max(...endYears) } : {}),
        ...(subtypeRow ? { subtype: subtypeRow.value } : {}),
        nobleTitles: entityTitles.map((title) => ({
          ...(title.place_name ? { fief: String(title.place_name) } : {}),
          ...(title.role_name ? { roleName: String(title.role_name) } : {}),
          ...(title.posthumous_name ? { posthumousName: String(title.posthumous_name) } : {}),
          ...(title.dynasty ? { dynasty: String(title.dynasty) } : {}),
        })),
      });
    }
    return records;
  }

  async listNames(entityId: string, includeInactive = false): Promise<SqliteName[]> {
    const sql = includeInactive
      ? 'SELECT * FROM entity_names WHERE entity_id = ? ORDER BY is_primary DESC, id'
      : `SELECT * FROM entity_names
           WHERE entity_id = ? AND status = 'active'
           ORDER BY is_primary DESC, id`;
    const rows = (await this.activeBackend.all(sql, [entityId])) as Record<string, unknown>[];
    return rows.map((row) => rowName(row));
  }

  async listTranslations(entityId: string, includeInactive = false): Promise<SqliteTranslation[]> {
    const sql = includeInactive
      ? 'SELECT * FROM entity_translations WHERE entity_id = ? ORDER BY id'
      : `SELECT * FROM entity_translations
           WHERE entity_id = ? AND status = 'active'
           ORDER BY id`;
    const rows = (await this.activeBackend.all(sql, [entityId])) as Record<string, unknown>[];
    return rows.map((row) => rowTranslation(row));
  }

  async addTranslation(input: {
    entityId: string;
    text: string;
    language: string;
    origin?: SqliteValueOrigin;
    source?: string | null;
    status?: SqliteValueStatus;
    now?: string;
  }): Promise<SqliteTranslation> {
    const text = input.text.trim();
    const language = input.language.trim();
    if (!text) throw new Error('Entity translations cannot be empty.');
    if (!language) throw new Error('Entity translations require a language.');
    const now = input.now ?? nowIso();
    return this.transaction(async () => {
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_translations
           WHERE entity_id = ? AND text = ? AND language = ? AND status = 'active'
           LIMIT 1`, [input.entityId, text, language])) as { id: number } | undefined;
      if (existing) {
        const row = (await this.activeBackend.get('SELECT * FROM entity_translations WHERE id = ?', [existing.id])) as Record<string, unknown>;
        return rowTranslation(row);
      }
      const result = (await this.activeBackend.run(`INSERT INTO entity_translations
             (entity_id, text, language, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [input.entityId,
          text,
          language,
          input.origin ?? 'user',
          input.source ?? null,
          input.status ?? 'active',
          now,
          now,]));
      (await this.bumpEntity(input.entityId, now));
      const row = (await this.activeBackend.get('SELECT * FROM entity_translations WHERE id = ?', [Number(result.lastInsertRowid)])) as Record<string, unknown>;
      return rowTranslation(row);
    });
  }

  async addName(input: AddNameInput): Promise<SqliteName> {
    const text = input.text.trim();
    if (!text) throw new Error('Entity names cannot be empty.');
    const now = input.now ?? nowIso();
    const nameType = normalizePersonNameType(input.nameType ?? null);
    if (nameType === 'translation') {
      const language = (input.language ?? '').trim();
      if (!language) throw new Error('Translations require a language.');
      const translation = (await this.addTranslation({
        entityId: input.entityId,
        text,
        language,
        origin: input.origin,
        source: input.source,
        status: input.status,
        now,
      }));
      return translationAsDisplayName(translation);
    }
    const nameRole =
      input.nameRole ??
      (nameType === 'family' || nameType === 'given'
        ? nameType
        : input.isPrimary
          ? 'primary'
          : 'variant');
    const language =
      nameType === 'romanization'
        ? languageForRomanization(input.language)
        : (input.language ?? null);
    return this.transaction(async () => {
      if (input.isPrimary) {
        (await this.activeBackend.run('UPDATE entity_names SET is_primary = 0 WHERE entity_id = ?', [input.entityId]));
      }
      const result = (await this.activeBackend.run(`INSERT INTO entity_names
             (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.entityId,
          text,
          nameType,
          nameRole,
          language,
          input.isPrimary ? 1 : 0,
          input.origin ?? 'user',
          input.source ?? null,
          input.status ?? 'active',
          now,
          now,]));
      (await this.syncPersonNameScalars(input.entityId, text, nameType, now));
      const inserted = (await this.getName(Number(result.lastInsertRowid)))!;
      (await this.normalizeEntityNameIntegrity(input.entityId, now));
      (await this.bumpEntity(input.entityId, now));
      return inserted;
    });
  }

  async updateNamesByText(input: UpdateNamesByTextInput): Promise<number> {
    const text = input.text.normalize('NFC').trim();
    if (!text) throw new Error('Entity names cannot be empty.');
    const now = input.now ?? nowIso();
    const nameType =
      input.nameType === undefined ? undefined : normalizePersonNameType(input.nameType);
    return this.transaction(async () => {
      const existingTranslations = (await this.activeBackend.all(`SELECT id, language FROM entity_translations
           WHERE entity_id = ? AND text = ? AND status = 'active'`, [input.entityId, text])) as { id: number; language: string }[];

      // Target is (or becomes) a vernacular gloss → entity_translations.
      if (
        nameType === 'translation' ||
        (nameType === undefined && existingTranslations.length > 0)
      ) {
        const language =
          input.language === undefined
            ? (existingTranslations[0]?.language ?? '')
            : (input.language ?? '').trim();
        if (!language) throw new Error('Translations require a language.');

        // Move off entity_names if present.
        const nameRows = (await this.activeBackend.all(`SELECT id, origin FROM entity_names
             WHERE entity_id = ? AND text = ? AND status = 'active'`, [input.entityId, text])) as { id: number; origin: SqliteValueOrigin }[];
        for (const row of nameRows) {
          if (row.origin === 'user') {
            (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [row.id]));
          } else {
            (await this.activeBackend.run(`UPDATE entity_names SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [now, row.id]));
          }
        }

        if (existingTranslations.length === 0) {
          (await this.activeBackend.run(`INSERT INTO entity_translations
                 (entity_id, text, language, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, 'user', NULL, 'active', ?, ?)`, [input.entityId, text, language, now, now]));
        } else {
          for (const row of existingTranslations) {
            (await this.activeBackend.run(`UPDATE entity_translations SET language = ?, updated_at = ? WHERE id = ?`, [language, now, row.id]));
          }
        }
        (await this.bumpEntity(input.entityId, now));
        return Math.max(1, existingTranslations.length);
      }

      // Demote gloss → ordinary name: leave translations table, write entity_names.
      if (existingTranslations.length > 0 && nameType !== undefined && nameType !== 'translation') {
        for (const row of existingTranslations) {
          (await this.activeBackend.run('DELETE FROM entity_translations WHERE id = ?', [row.id]));
        }
      }

      const existing = (await this.activeBackend.all(`SELECT id, name_type, language FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active'`, [input.entityId, text])) as {
        id: number;
        name_type: string | null;
        language: string | null;
      }[];

      if (existing.length === 0) {
        // Classify-from-mention (Attributes panel): insert any typed name that
        // isn't already on the entity. Clearing (null) with no row is a no-op.
        // Matches legacy XML setNameType → addEntityName.
        if (!nameType) return 0;
        const nameRole =
          nameType === 'family' || nameType === 'given'
            ? nameType
            : nameType === 'primary'
              ? 'primary'
              : 'variant';
        const language =
          nameType === 'romanization'
            ? languageForRomanization(input.language)
            : (input.language ?? null);
        const result = (await this.activeBackend.run(`INSERT INTO entity_names
               (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, 'user', NULL, 'active', ?, ?)`, [input.entityId, text, nameType, nameRole, language, now, now]));
        (await this.syncPersonNameScalars(input.entityId, text, nameType, now));
        (await this.normalizeEntityNameIntegrity(input.entityId, now));
        (await this.bumpEntity(input.entityId, now));
        return Number(result.changes);
      }

      for (const row of existing) {
        const previousType = normalizePersonNameType(row.name_type);
        const nextType = nameType === undefined ? previousType : nameType;
        const nextRole =
          nextType === 'family' || nextType === 'given'
            ? nextType
            : nextType === 'primary'
              ? 'primary'
              : previousType === 'family' || previousType === 'given'
                ? 'variant'
                : undefined;
        let nextLanguage = input.language === undefined ? row.language : input.language;
        if (nextType === 'romanization') {
          nextLanguage = languageForRomanization(nextLanguage);
        }
        (await this.activeBackend.run(`UPDATE entity_names
             SET name_type = ?, name_role = COALESCE(?, name_role), language = ?, updated_at = ?
             WHERE id = ?`, [nextType, nextRole ?? null, nextLanguage, now, row.id]));
        (await this.syncPersonNameScalarsAfterTypeChange(
          input.entityId,
          text,
          previousType,
          nextType,
          now,
        ));
      }
      (await this.normalizeEntityNameIntegrity(input.entityId, now));
      (await this.bumpEntity(input.entityId, now));
      return existing.length;
    });
  }

  async tombstoneName(nameId: number, reason = 'user-deleted', now = nowIso()): Promise<void> {
    await this.transaction(async () => {
      const row = (await this.activeBackend.get('SELECT entity_id, status FROM entity_names WHERE id = ?', [nameId])) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Name not found: ${nameId}`);
      if (row.status === 'active') {
        (await this.activeBackend.run(`UPDATE entity_names SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [now, nameId]));
        (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
               (entity_id, table_name, row_id, reason, created_at)
             VALUES (?, 'entity_names', ?, ?, ?)`, [String(row.entity_id), nameId, reason, now]));
        (await this.bumpEntity(String(row.entity_id), now));
      }
    });
  }

  async tombstoneNamesByText(
    entityId: string,
    text: string,
    reason = 'user-deleted',
    now = nowIso(),
  ): Promise<number> {
    const normalized = text.trim();
    if (!normalized) return 0;
    return this.transaction(async () => {
      const rows = (await this.activeBackend.all(`SELECT id FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active'`, [entityId, normalized])) as { id: number }[];
      for (const row of rows) {
        (await this.activeBackend.run(`UPDATE entity_names SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [now, row.id]));
        (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
               (entity_id, table_name, row_id, reason, created_at)
             VALUES (?, 'entity_names', ?, ?, ?)`, [entityId, row.id, reason, now]));
      }
      if (rows.length > 0) (await this.bumpEntity(entityId, now));
      return rows.length;
    });
  }

  async removeNameByText(entityId: string, text: string, now = nowIso()): Promise<boolean> {
    const normalized = text.trim();
    if (!normalized) return false;
    return this.transaction(async () => {
      const translationTargets = (await this.activeBackend.all(`SELECT id, origin FROM entity_translations
           WHERE entity_id = ? AND text = ? AND status = 'active'`, [entityId, normalized])) as { id: number; origin: SqliteValueOrigin }[];
      if (translationTargets.length > 0) {
        for (const target of translationTargets) {
          if (target.origin === 'user') {
            (await this.activeBackend.run('DELETE FROM entity_translations WHERE id = ?', [target.id]));
          } else {
            (await this.activeBackend.run(`UPDATE entity_translations SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, target.id]));
            (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
                   (entity_id, table_name, row_id, reason, created_at)
                 VALUES (?, 'entity_translations', ?, 'user-deleted', ?)`, [entityId, target.id, now]));
          }
        }
        (await this.bumpEntity(entityId, now));
        return true;
      }

      const active = (await this.activeBackend.all(`SELECT id, origin, is_primary, name_type, name_role FROM entity_names
           WHERE entity_id = ? AND status = 'active' ORDER BY is_primary DESC, id`, [entityId])) as {
        id: number;
        origin: SqliteValueOrigin;
        is_primary: number;
        name_type: string | null;
        name_role: string;
      }[];
      if (active.length <= 1) return false;
      const targets = (await this.activeBackend.all(`SELECT id, origin, is_primary, name_type, name_role FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active'`, [entityId, normalized])) as {
        id: number;
        origin: SqliteValueOrigin;
        is_primary: number;
        name_type: string | null;
        name_role: string;
      }[];
      if (targets.length === 0) return false;

      for (const target of targets) {
        if (target.origin === 'user') {
          (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [target.id]));
        } else {
          (await this.activeBackend.run(`UPDATE entity_names SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, target.id]));
          (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
                 (entity_id, table_name, row_id, reason, created_at)
               VALUES (?, 'entity_names', ?, 'user-deleted', ?)`, [entityId, target.id, now]));
        }
        const removedType =
          normalizePersonNameType(target.name_type) ??
          (target.name_role === 'family' || target.name_role === 'given' ? target.name_role : null);
        if (removedType === 'family' || removedType === 'given') {
          (await this.syncPersonNameScalarsAfterTypeChange(entityId, normalized, removedType, null, now));
        }
      }

      const survivor = (await this.activeBackend.get(`SELECT id FROM entity_names
           WHERE entity_id = ? AND status = 'active'
           ORDER BY is_primary DESC, id LIMIT 1`, [entityId])) as { id: number } | undefined;
      if (survivor) {
        (await this.activeBackend.run('UPDATE entity_names SET is_primary = 0 WHERE entity_id = ?', [entityId]));
        (await this.activeBackend.run('UPDATE entity_names SET is_primary = 1 WHERE id = ?', [survivor.id]));
      }
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async updateDescription(entityId: string, description: string | null, now = nowIso()): Promise<void> {
    await this.transaction(async () => {
      const trimmed = description?.trim() || null;
      (await this.activeBackend.run('UPDATE entities SET description = ?, updated_at = ?, revision = revision + 1 WHERE id = ?', [trimmed, now, entityId]));
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_metadata
           WHERE entity_id = ? AND key = 'description' AND origin = 'user'
           ORDER BY id LIMIT 1`, [entityId])) as { id: number } | undefined;
      if (!trimmed) {
        if (existing) (await this.activeBackend.run('DELETE FROM entity_metadata WHERE id = ?', [existing.id]));
        return;
      }
      if (existing) {
        (await this.activeBackend.run(`UPDATE entity_metadata
             SET value = ?, status = 'active', updated_at = ?
             WHERE id = ?`, [trimmed, now, existing.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO entity_metadata
               (entity_id, key, value, origin, source, status, created_at, updated_at)
             VALUES (?, 'description', ?, 'user', NULL, 'active', ?, ?)`, [entityId, trimmed, now, now]));
      }
    });
  }

  /** `thing` entities only — the user-defined sub-category id (entity_metadata key='subtype'). No dedicated column, unlike description. */
  async updateSubtype(entityId: string, subtype: string | null, now = nowIso()): Promise<void> {
    await this.transaction(async () => {
      const trimmed = subtype?.trim() || null;
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_metadata
           WHERE entity_id = ? AND key = 'subtype' AND origin = 'user'
           ORDER BY id LIMIT 1`, [entityId])) as { id: number } | undefined;
      if (!trimmed) {
        if (existing) (await this.activeBackend.run('DELETE FROM entity_metadata WHERE id = ?', [existing.id]));
        return;
      }
      if (existing) {
        (await this.activeBackend.run(`UPDATE entity_metadata
             SET value = ?, status = 'active', updated_at = ?
             WHERE id = ?`, [trimmed, now, existing.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO entity_metadata
               (entity_id, key, value, origin, source, status, created_at, updated_at)
             VALUES (?, 'subtype', ?, 'user', NULL, 'active', ?, ?)`, [entityId, trimmed, now, now]));
      }
    });
  }

  /**
   * A typed cross-entity relation, from `entityId`'s point of view — the
   * "other" fields describe whichever side of `entity_relations` isn't
   * `entityId`, so the same row renders sensibly whether `entityId` is the
   * subject or the object (e.g. "influenced X" vs. "influenced by Y").
   */
  async createRelation(input: {
    subjectEntityId: string;
    objectEntityId: string;
    relationType: string;
    symmetric?: boolean;
    reference?: string | null;
    origin?: SqliteValueOrigin;
    source?: string | null;
    now?: string;
  }): Promise<number> {
    const now = input.now ?? nowIso();
    return this.transaction(async () => {
      const result = (await this.activeBackend.run(`INSERT INTO entity_relations
             (relation_type, subject_entity_id, object_entity_id, active, passive, symmetric, reference, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [input.relationType,
          input.subjectEntityId,
          input.objectEntityId,
          `#${input.subjectEntityId}`,
          `#${input.objectEntityId}`,
          input.symmetric ? 1 : 0,
          input.reference ?? null,
          input.origin ?? 'user',
          input.source ?? null,
          now,
          now,]));
      (await this.bumpEntity(input.subjectEntityId, now));
      (await this.bumpEntity(input.objectEntityId, now));
      return Number(result.lastInsertRowid);
    });
  }

  /** Active relations where `entityId` is either the subject or the object. */
  async listRelationsForEntity(entityId: string): Promise<SqliteEntityRelation[]> {
    const rows = (await this.activeBackend.all(`SELECT r.id AS id,
                r.relation_type AS relation_type,
                r.subject_entity_id AS subject_entity_id,
                r.object_entity_id AS object_entity_id,
                r.symmetric AS symmetric,
                r.reference AS reference,
                other.id AS other_id,
                other.kind AS other_kind,
                (
                  SELECT n.text FROM entity_names n
                  WHERE n.entity_id = other.id AND n.status = 'active'
                  ORDER BY n.is_primary DESC, n.id LIMIT 1
                ) AS other_name
         FROM entity_relations r
         JOIN entities other
           ON other.id = (
             CASE WHEN r.subject_entity_id = ? THEN r.object_entity_id ELSE r.subject_entity_id END
           )
         WHERE r.status = 'active'
           AND (r.subject_entity_id = ? OR r.object_entity_id = ?)
         ORDER BY r.id`, [entityId, entityId, entityId])) as {
      id: number;
      relation_type: string;
      subject_entity_id: string;
      object_entity_id: string | null;
      symmetric: number;
      reference: string | null;
      other_id: string | null;
      other_kind: SqliteEntityKind | null;
      other_name: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      relationType: row.relation_type,
      isSubject: row.subject_entity_id === entityId,
      symmetric: row.symmetric === 1,
      reference: row.reference,
      otherEntityId: row.other_id,
      otherEntityKind: row.other_kind,
      otherEntityName: row.other_name,
    }));
  }

  /** Soft-remove a relation (status = 'withdrawn'); the row is kept for provenance. */
  async updateRelationStatus(relationId: number, status: SqliteValueStatus, now = nowIso()): Promise<boolean> {
    const result = (await this.activeBackend.run(`UPDATE entity_relations SET status = ?, updated_at = ? WHERE id = ?`, [status, now, relationId]));
    return Number(result.changes) > 0;
  }

  async getEntityNotes(entityId: string): Promise<SqliteEntityNote[]> {
    const rows = [
      ...((await this.activeBackend.all(`SELECT xml FROM entity_xml_fragments
           WHERE entity_id = ? AND xml LIKE '%grognard-entity-note%'
           ORDER BY ordinal`, [entityId])) as { xml: string }[]),
      ...((await this.activeBackend.all(`SELECT xml FROM entity_extensions
           WHERE entity_id = ? AND xml LIKE '%grognard-entity-note%'
           ORDER BY ordinal`, [entityId])) as { xml: string }[]),
    ];
    return rows.map((row) => ({ xml: String(row.xml) }));
  }

  async setEntityNote(entityId: string, xml: string, now = nowIso()): Promise<void> {
    await this.transaction(async () => {
      (await this.activeBackend.run(`DELETE FROM entity_xml_fragments
           WHERE entity_id = ? AND xml LIKE '%grognard-entity-note%'`, [entityId]));
      (await this.activeBackend.run(`DELETE FROM entity_extensions
           WHERE entity_id = ? AND xml LIKE '%grognard-entity-note%'`, [entityId]));
      const ordinal = (await this.activeBackend.get('SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM entity_xml_fragments WHERE entity_id = ?', [entityId])) as { ordinal: number };
      (await this.activeBackend.run(`INSERT INTO entity_xml_fragments (entity_id, ordinal, xml)
           VALUES (?, ?, ?)`, [entityId, ordinal.ordinal, xml]));
      (await this.bumpEntity(entityId, now));
    });
  }

  async setUserEntityDate(input: SetUserEntityDateInput): Promise<void> {
    const now = input.now ?? nowIso();
    await this.transaction(async () => {
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_dates
           WHERE entity_id = ? AND date_kind = ? AND origin = 'user' AND status = 'active'
           ORDER BY id LIMIT 1`, [input.entityId, input.part])) as { id: number } | undefined;
      if (input.year == null) {
        if (existing) {
          (await this.activeBackend.run('DELETE FROM entity_dates WHERE id = ?', [existing.id]));
          (await this.bumpEntity(input.entityId, now));
        }
        return;
      }
      const whenValue = isoYearString(input.year);
      const precision = input.precision?.trim() || null;
      if (existing) {
        (await this.activeBackend.run(`UPDATE entity_dates
             SET start_year = ?, when_value = ?, start_precision = ?, updated_at = ?
             WHERE id = ?`, [input.year, whenValue, precision, now, existing.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO entity_dates
               (entity_id, date_kind, start_year, when_value, start_precision,
                origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'user', NULL, 'active', ?, ?)`, [input.entityId, input.part, input.year, whenValue, precision, now, now]));
      }
      (await this.bumpEntity(input.entityId, now));
    });
  }

  async setUserWorkDate(input: SetUserWorkDateInput): Promise<void> {
    const now = input.now ?? nowIso();
    await this.transaction(async () => {
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_dates
           WHERE entity_id = ? AND date_kind IN ('dates', 'work') AND origin = 'user' AND status = 'active'
           ORDER BY CASE date_kind WHEN 'dates' THEN 0 ELSE 1 END, id
           LIMIT 1`, [input.entityId])) as { id: number } | undefined;
      if (input.startYear == null && (input.endYear == null || input.endYear === undefined)) {
        if (existing) {
          (await this.activeBackend.run('DELETE FROM entity_dates WHERE id = ?', [existing.id]));
          (await this.bumpEntity(input.entityId, now));
        }
        return;
      }
      const startPrecision = input.startPrecision?.trim() || null;
      const endPrecision = input.endPrecision?.trim() || null;
      const rawText = [
        input.startYear != null ? isoYearString(input.startYear) : '',
        input.endYear != null ? isoYearString(input.endYear) : '',
      ].join('/');
      if (existing) {
        (await this.activeBackend.run(`UPDATE entity_dates
             SET date_kind = 'dates', start_year = ?, end_year = ?,
                 from_value = ?, to_value = ?, start_precision = ?, end_precision = ?,
                 raw_text = ?, updated_at = ?
             WHERE id = ?`, [input.startYear,
            input.endYear ?? null,
            input.startYear != null ? isoYearString(input.startYear) : null,
            input.endYear != null ? isoYearString(input.endYear) : null,
            startPrecision,
            endPrecision,
            rawText,
            now,
            existing.id,]));
      } else {
        (await this.activeBackend.run(`INSERT INTO entity_dates
               (entity_id, date_kind, start_year, end_year, from_value, to_value,
                start_precision, end_precision, raw_text, origin, source, status, created_at, updated_at)
             VALUES (?, 'dates', ?, ?, ?, ?, ?, ?, ?, 'user', NULL, 'active', ?, ?)`, [input.entityId,
            input.startYear,
            input.endYear ?? null,
            input.startYear != null ? isoYearString(input.startYear) : null,
            input.endYear != null ? isoYearString(input.endYear) : null,
            startPrecision,
            endPrecision,
            rawText,
            now,
            now,]));
      }
      (await this.bumpEntity(input.entityId, now));
    });
  }

  async setWorkType(input: SetWorkTypeInput): Promise<void> {
    const now = input.now ?? nowIso();
    // Unset means "use the scholarly default" — persist as book rather than NULL.
    const workType = input.workType ?? 'book';
    await this.transaction(async () => {
      (await this.activeBackend.run('UPDATE works SET work_type = ? WHERE entity_id = ?', [workType, input.entityId]));
      (await this.bumpEntity(input.entityId, now));
    });
  }

  async addNationality(input: AddLabeledValueInput): Promise<boolean> {
    return (await this.addPersonLabeledValue('person_nationalities', input));
  }

  async addOrigin(input: AddLabeledValueInput): Promise<boolean> {
    return (await this.addPersonLabeledValue('person_origins', input));
  }

  async addNobleTitle(entityId: string, input: NobleTitleMutationInput, now = nowIso()): Promise<boolean> {
    const values = {
      dynasty: input.dynasty?.trim() ?? '',
      fief: input.fief?.trim() ?? '',
      posthumousName: input.posthumousName?.trim() ?? '',
      title: input.title?.trim() ?? '',
    };
    if (!values.dynasty && !values.fief && !values.posthumousName && !values.title) return false;
    const origin = input.origin ?? 'user';
    const source = input.source ?? null;
    return this.transaction(async () => {
      if (!(await this.getEntity(entityId)) || (await this.getEntity(entityId))?.kind !== 'person') return false;
      const exists = (await this.activeBackend.get(`SELECT 1 FROM person_titles
           WHERE person_id = ? AND status = 'active'
             AND COALESCE(dynasty, '') = ?
             AND COALESCE(place_name, '') = ?
             AND COALESCE(role_name, '') = ?
             AND COALESCE(posthumous_name, '') = ?`, [entityId, values.dynasty, values.fief, values.title, values.posthumousName]));
      if (exists) return false;
      (await this.activeBackend.run(`INSERT INTO person_titles
             (person_id, dynasty, place_name, role_name, posthumous_name,
              origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [entityId,
          values.dynasty || null,
          values.fief,
          values.title,
          values.posthumousName || null,
          origin,
          source,
          now,
          now,]));
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async addOffice(input: AddOfficeValueInput): Promise<boolean> {
    const label = input.label.trim();
    if (!label) return false;
    const now = input.now ?? nowIso();
    const origin = input.origin ?? 'user';
    return this.transaction(async () => {
      if ((await this.getEntity(input.entityId))?.kind !== 'person') return false;
      const exists = (await this.activeBackend.get(`SELECT 1 FROM person_offices
           WHERE person_id = ? AND status = 'active' AND office_label = ?`, [input.entityId, label]));
      if (exists) return false;
      const officeId = input.ref?.replace(/^#/, '').trim() || null;
      const officeExists =
        officeId &&
        (await this.activeBackend.get("SELECT 1 FROM entities WHERE id = ? AND kind = 'office'", [officeId]))
          ? officeId
          : null;
      (await this.activeBackend.run(`INSERT INTO person_offices
             (person_id, office_id, office_label, reference, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [input.entityId,
          officeExists,
          label,
          input.ref ?? null,
          origin,
          input.source ?? null,
          now,
          now,]));
      (await this.bumpEntity(input.entityId, now));
      return true;
    });
  }

  /**
   * Reconcile Norbert/XML person-wrapper facts into typed person tables.
   * Mirrors DOM `refreshExtractedEntityDataForDocument`: add missing
   * origin=xml rows, delete vanished unvalidated xml rows for live sources,
   * and purge orphaned xml sources for wrappers that left the document.
   * Rejected and user (validated) rows are left alone.
   */
  async reconcileXmlExtractedData(input: XmlExtractedRefreshInput): Promise<XmlExtractedRefreshResult> {
    const now = input.now ?? nowIso();
    const liveSources = new Set(input.wrappers.map((wrapper) => wrapper.source));
    let wrappers = 0;
    let added = 0;
    let removed = 0;
    let retained = 0;

    return this.transaction(async () => {
      for (const wrapper of input.wrappers) {
        const result = (await this.ingestXmlExtractedForSource(wrapper, now));
        wrappers += 1;
        added += result.added;
        removed += result.removed;
        retained += result.retained;
      }

      if (input.purgeOrphanSources !== false) {
        const sourcePrefix = `xml:${input.documentKey}#personWrapper:`;
        const orphanTables: { table: string; ownerCol: string }[] = [
          { table: 'person_nationalities', ownerCol: 'person_id' },
          { table: 'person_origins', ownerCol: 'person_id' },
          { table: 'person_offices', ownerCol: 'person_id' },
          { table: 'person_titles', ownerCol: 'person_id' },
        ];
        const touched = new Set<string>();
        for (const { table, ownerCol } of orphanTables) {
          const rows = (await this.activeBackend.all(`SELECT id, ${ownerCol} AS owner_id, source, status
               FROM ${table}
               WHERE origin = 'xml' AND source LIKE ?`, [`${sourcePrefix}%`])) as {
            id: number;
            owner_id: string;
            source: string | null;
            status: string;
          }[];
          for (const row of rows) {
            if (!row.source || liveSources.has(row.source)) continue;
            if (row.status !== 'active') {
              retained += 1;
              continue;
            }
            (await this.activeBackend.run(`DELETE FROM ${table} WHERE id = ?`, [row.id]));
            removed += 1;
            touched.add(row.owner_id);
          }
        }
        for (const entityId of touched) (await this.bumpEntity(entityId, now));
      }

      return { wrappers, added, removed, retained };
    });
  }

  async updateNobleTitle(
    entityId: string,
    key: string,
    input: NobleTitleMutationInput,
    now = nowIso(),
  ): Promise<boolean> {
    const parsed = parseAssertionKey(key);
    if (!parsed || parsed.kind !== 'row' || parsed.table !== 'person_titles') return false;
    const values = {
      dynasty: input.dynasty?.trim() ?? '',
      fief: input.fief?.trim() ?? '',
      posthumousName: input.posthumousName?.trim() ?? '',
      title: input.title?.trim() ?? '',
    };
    return this.transaction(async () => {
      const row = (await this.activeBackend.get('SELECT person_id FROM person_titles WHERE id = ?', [parsed.rowId])) as { person_id: string } | undefined;
      if (!row || row.person_id !== entityId) return false;
      (await this.activeBackend.run(`UPDATE person_titles
           SET dynasty = ?, place_name = ?, role_name = ?, posthumous_name = ?, updated_at = ?
           WHERE id = ?`, [values.dynasty || null,
          values.fief,
          values.title,
          values.posthumousName || null,
          now,
          parsed.rowId,]));
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async setUserWorkAuthors(input: SetUserWorkAuthorsInput): Promise<void> {
    const now = input.now ?? nowIso();
    await this.transaction(async () => {
      (await this.activeBackend.run(`DELETE FROM work_authors WHERE work_id = ? AND origin = 'user'`, [input.entityId]));
      const seen = new Set<string>();
      for (const author of input.authors) {
        const name = author.name.trim();
        const ref = (author.key ? `#${author.key.replace(/^#/, '')}` : author.ref?.trim()) || null;
        const dedupe = `${name}\0${ref ?? ''}`;
        if (!name || seen.has(dedupe)) continue;
        seen.add(dedupe);
        const personId = author.key?.replace(/^#/, '') || null;
        (await this.activeBackend.run(`INSERT INTO work_authors
               (work_id, person_id, label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'user', NULL, 'active', ?, ?)`, [input.entityId, personId, name, ref, now, now]));
      }
      (await this.bumpEntity(input.entityId, now));
    });
  }

  async attachAuthority(input: AuthorityRefInput): Promise<boolean> {
    const now = input.now ?? nowIso();
    const type = canonicalizeAuthorityType(input.type);
    const rawValue = input.value.trim();
    if (!type || !rawValue) return false;
    const origin = input.origin ?? 'user';
    const source = input.source ?? null;
    const value = normalizeAuthorityValue(type, rawValue);
    const normalized = value;
    return this.transaction(async () => {
      const existing = (await this.activeBackend.all(`SELECT id, authority_type, authority_value, status FROM entity_authorities
           WHERE entity_id = ? AND lower(authority_type) = lower(?)`, [input.entityId, type])) as {
        id: number;
        authority_type: string;
        authority_value: string;
        status: string;
      }[];
      const match = existing.find(
        (row) => normalizeAuthorityValue(type, row.authority_value) === normalized,
      );
      if (match) {
        if (
          match.status === 'active' &&
          match.authority_type === type &&
          match.authority_value === value
        )
          return false;
        (await this.activeBackend.run(`UPDATE entity_authorities
             SET authority_type = ?, authority_value = ?, status = 'active',
                 origin = ?, source = ?, updated_at = ?
             WHERE id = ?`, [type, value, origin, source, now, match.id]));
        (await this.bumpEntity(input.entityId, now));
        return true;
      }
      (await this.activeBackend.run(`INSERT INTO entity_authorities
             (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`, [input.entityId, type, value, origin, source, now, now]));
      (await this.bumpEntity(input.entityId, now));
      return true;
    });
  }

  async decoupleAuthority(input: AuthorityRefInput): Promise<number> {
    const now = input.now ?? nowIso();
    const type = input.type.trim();
    const value = input.value.trim();
    if (!type || !value) return 0;
    const normalized = normalizeAuthorityValue(type, value);
    return this.transaction(async () => {
      let removed = 0;
      const authorities = (await this.activeBackend.all(`SELECT id, authority_value, origin, status FROM entity_authorities WHERE entity_id = ?`, [input.entityId])) as {
        id: number;
        authority_value: string;
        origin: SqliteValueOrigin;
        status: string;
      }[];
      for (const row of authorities) {
        if (normalizeAuthorityValue(type, row.authority_value) !== normalized) continue;
        if (row.origin === 'authority' || row.status !== 'active') {
          (await this.activeBackend.run('DELETE FROM entity_authorities WHERE id = ?', [row.id]));
          removed += 1;
        } else {
          (await this.activeBackend.run('DELETE FROM entity_authorities WHERE id = ?', [row.id]));
          removed += 1;
        }
      }

      const sourcePrefix = `${type}:`;
      const purgeBySource = (table: string, ownerCol: string) => {
        const rows = (await this.activeBackend.all(`SELECT id, origin, source, status FROM ${table} WHERE ${ownerCol} = ?`, [input.entityId])) as {
          id: number;
          origin: SqliteValueOrigin;
          source: string | null;
          status: string;
        }[];
        for (const row of rows) {
          if (!row.source?.startsWith(sourcePrefix)) continue;
          const sourceValue = row.source.slice(sourcePrefix.length);
          if (normalizeAuthorityValue(type, sourceValue) !== normalized) continue;
          if (row.origin !== 'authority') continue;
          if (row.status === 'active' || (row.status === 'rejected' && table === 'entity_dates')) {
            (await this.activeBackend.run(`DELETE FROM ${table} WHERE id = ?`, [row.id]));
            removed += 1;
          }
        }
      };
      purgeBySource('entity_names', 'entity_id');
      purgeBySource('entity_dates', 'entity_id');
      purgeBySource('person_nationalities', 'person_id');
      purgeBySource('person_origins', 'person_id');
      purgeBySource('person_titles', 'person_id');
      purgeBySource('person_offices', 'person_id');
      purgeBySource('work_authors', 'work_id');

      (await this.activeBackend.run(`DELETE FROM authority_caches
           WHERE entity_id = ? AND (authority_type = ? OR source = ? OR source = ?)`, [input.entityId, type, type, `${type}:${value}`]));

      if (removed > 0) (await this.bumpEntity(input.entityId, now));
      return removed;
    });
  }

  async rejectAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    return (await this.mutateAssertion(entityId, key, 'reject', now));
  }

  async restoreAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    return (await this.mutateAssertion(entityId, key, 'restore', now));
  }

  async removeAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    return (await this.mutateAssertion(entityId, key, 'remove', now));
  }

  async validateAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    return (await this.mutateAssertion(entityId, key, 'validate', now));
  }

  async acceptDateAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    const parsed = parseAssertionKey(key);
    if (!parsed || parsed.kind !== 'row' || parsed.table !== 'entity_dates') return false;
    return this.transaction(async () => {
      const row = (await this.activeBackend.get('SELECT * FROM entity_dates WHERE id = ?', [parsed.rowId])) as
        Record<string, unknown> | undefined;
      if (!row || String(row.entity_id) !== entityId) return false;
      const kind = String(row.date_kind);
      if (kind !== 'birth' && kind !== 'death') return false;
      const others = (await this.activeBackend.all(`SELECT id FROM entity_dates
           WHERE entity_id = ? AND date_kind = ? AND origin = 'user' AND id != ?`, [entityId, kind, parsed.rowId])) as { id: number }[];
      for (const other of others) {
        (await this.activeBackend.run('DELETE FROM entity_dates WHERE id = ?', [other.id]));
      }
      (await this.activeBackend.run(`UPDATE entity_dates
           SET origin = 'user', source = NULL, status = 'active', updated_at = ?
           WHERE id = ?`, [now, parsed.rowId]));
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async acceptDescriptionAssertion(entityId: string, key: string, now = nowIso()): Promise<boolean> {
    const parsed = parseAssertionKey(key);
    if (parsed?.kind === 'description') {
      if (parsed.entityId !== entityId) return false;
      return true;
    }
    if (!parsed || parsed.kind !== 'row' || parsed.table !== 'entity_metadata') return false;
    return this.transaction(async () => {
      const row = (await this.activeBackend.get('SELECT * FROM entity_metadata WHERE id = ?', [parsed.rowId])) as Record<string, unknown> | undefined;
      if (!row || String(row.entity_id) !== entityId || String(row.key) !== 'description') {
        return false;
      }
      const value = String(row.value ?? '').trim();
      if (!value) return false;
      const others = (await this.activeBackend.all(`SELECT id FROM entity_metadata
           WHERE entity_id = ? AND key = 'description' AND origin = 'user' AND id != ?`, [entityId, parsed.rowId])) as { id: number }[];
      for (const other of others) {
        (await this.activeBackend.run('DELETE FROM entity_metadata WHERE id = ?', [other.id]));
      }
      (await this.activeBackend.run(`UPDATE entity_metadata
           SET origin = 'user', source = NULL, status = 'active', updated_at = ?
           WHERE id = ?`, [now, parsed.rowId]));
      (await this.activeBackend.run('UPDATE entities SET description = ?, updated_at = ?, revision = revision + 1 WHERE id = ?', [value, now, entityId]));
      return true;
    });
  }

  async renamePrimaryName(entityId: string, text: string, now = nowIso()): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return this.transaction(async () => {
      const primary = (await this.activeBackend.get(`SELECT id, text FROM entity_names
           WHERE entity_id = ? AND status = 'active'
           ORDER BY is_primary DESC, id LIMIT 1`, [entityId])) as { id: number; text: string } | undefined;
      if (!primary || primary.text === trimmed) return false;
      (await this.activeBackend.run('UPDATE entity_names SET text = ?, updated_at = ? WHERE id = ?', [trimmed, now, primary.id]));
      const duplicates = (await this.activeBackend.all(`SELECT id FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active' AND id != ?`, [entityId, trimmed, primary.id])) as { id: number }[];
      for (const duplicate of duplicates) {
        (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [duplicate.id]));
      }
      (await this.normalizeEntityNameIntegrity(entityId, now));
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  async setRomanizedName(entityId: string, text: string, language = 'und-Latn', now = nowIso()): Promise<void> {
    const trimmed = text.trim();
    const latnLanguage = languageForRomanization(language);
    await this.transaction(async () => {
      const existing = (await this.activeBackend.get(`SELECT id FROM entity_names
           WHERE entity_id = ? AND status = 'active' AND language LIKE '%-Latn'
           ORDER BY id LIMIT 1`, [entityId])) as { id: number } | undefined;
      if (!trimmed) {
        if (existing) {
          (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [existing.id]));
          (await this.bumpEntity(entityId, now));
        }
        return;
      }
      if (existing) {
        (await this.activeBackend.run(`UPDATE entity_names
             SET text = ?, language = ?, name_type = 'romanization',
                 updated_at = ?
             WHERE id = ?`, [trimmed, latnLanguage, now, existing.id]));
      } else {
        (await this.activeBackend.run(`INSERT INTO entity_names
               (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
             VALUES (?, ?, 'romanization', 'variant', ?, 0, 'user', NULL, 'active', ?, ?)`, [entityId, trimmed, latnLanguage, now, now]));
      }
      (await this.normalizeEntityNameIntegrity(entityId, now));
      (await this.bumpEntity(entityId, now));
    });
  }

  /**
   * Batch mechanical name cleanup:
   * 1. Promote Latn rows (untyped / legacy translation|variant) to `romanization`
   * 2. Remove literal `nan` placeholder rows
   * 3. Deduplicate identical text+type within an entity (keep best row)
   * 4. Remove the invalid family/given pair `n` + `an`
   * 5. Remove remaining non-primary rows with no name type
   */
  async autoCleanNames(now = nowIso()): Promise<{
    dedupedNames: number;
    removedNan: number;
    removedInvalidFamilyGiven: number;
    removedUntyped: number;
    promotedRomanizations: number;
  }> {
    return this.transaction(async () => {
      const touched = new Set<string>();

      const latnToPromote = (await this.activeBackend.all(`SELECT id, entity_id AS entityId FROM entity_names
           WHERE status = 'active'
             AND language LIKE '%-Latn'
             AND is_primary = 0
             AND (
               name_type IS NULL
               OR TRIM(name_type) = ''
               OR name_type IN ('translation', 'variant')
             )`)) as { id: number; entityId: string }[];
      for (const row of latnToPromote) {
        (await this.activeBackend.run(`UPDATE entity_names SET name_type = 'romanization', updated_at = ? WHERE id = ?`, [now, row.id]));
        touched.add(row.entityId);
      }
      const promotedRomanizations = latnToPromote.length;

      const dupGroups = (await this.activeBackend.all(`SELECT entity_id AS entityId, text,
                  COALESCE(name_type, '') AS nameTypeKey,
                  COUNT(*) AS c
           FROM entity_names
           WHERE status = 'active'
           GROUP BY entity_id, text, COALESCE(name_type, '')
           HAVING c > 1`)) as { entityId: string; text: string; nameTypeKey: string; c: number }[];

      let dedupedNames = 0;
      for (const group of dupGroups) {
        const rows = (await this.activeBackend.all(`SELECT id, origin, is_primary AS isPrimary, name_type AS nameType
             FROM entity_names
             WHERE entity_id = ? AND text = ? AND status = 'active'
               AND COALESCE(name_type, '') = ?
             ORDER BY is_primary DESC,
                      CASE WHEN name_type IS NULL OR TRIM(name_type) = '' THEN 1 ELSE 0 END,
                      id ASC`, [group.entityId, group.text, group.nameTypeKey])) as {
          id: number;
          origin: SqliteValueOrigin;
          isPrimary: number;
          nameType: string | null;
        }[];
        const [, ...extras] = rows;
        for (const extra of extras) {
          if (extra.origin === 'user') {
            (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [extra.id]));
          } else {
            (await this.activeBackend.run(`UPDATE entity_names SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [now, extra.id]));
            (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
                   (entity_id, table_name, row_id, reason, created_at)
                 VALUES (?, 'entity_names', ?, 'auto-clean-duplicate', ?)`, [group.entityId, extra.id, now]));
          }
          dedupedNames += 1;
          touched.add(group.entityId);
        }
      }

      let removedNan = 0;
      let removedInvalidFamilyGiven = 0;
      const entityIds = (await this.activeBackend.all(`SELECT id FROM entities
           WHERE id IN (SELECT DISTINCT entity_id FROM entity_names) OR kind = 'person'`)) as { id: string }[];
      for (const { id: entityId } of entityIds) {
        const result = (await this.normalizeEntityNameIntegrity(entityId, now));
        removedNan += result.removedNan;
        removedInvalidFamilyGiven += result.removedInvalidFamilyGiven;
        if (result.removedNan || result.removedInvalidFamilyGiven) touched.add(entityId);
      }

      const untyped = (await this.activeBackend.all(`SELECT id, entity_id AS entityId, origin
           FROM entity_names
           WHERE status = 'active'
             AND (name_type IS NULL OR TRIM(name_type) = '')
             AND is_primary = 0`)) as { id: number; entityId: string; origin: SqliteValueOrigin }[];

      let removedUntyped = 0;
      for (const row of untyped) {
        if (row.origin === 'user') {
          (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [row.id]));
        } else {
          (await this.activeBackend.run(`UPDATE entity_names SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, row.id]));
          (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
                 (entity_id, table_name, row_id, reason, created_at)
               VALUES (?, 'entity_names', ?, 'auto-clean-untyped', ?)`, [row.entityId, row.id, now]));
        }
        removedUntyped += 1;
        touched.add(row.entityId);
      }

      for (const entityId of touched) (await this.bumpEntity(entityId, now));

      return {
        dedupedNames,
        removedNan,
        removedInvalidFamilyGiven,
        removedUntyped,
        promotedRomanizations,
      };
    });
  }

  /**
   * Replace this entity's body with another entity's body (same kind).
   * Preserves the target id, kind, and `central_mappings`. Used by synchronized
   * mirror content sync — equivalent to DOM `copyEntityContent`.
   */
  async replaceEntityContentFrom(
    source: EntitySqliteRepository,
    sourceId: string,
    targetId: string,
    now = nowIso(),
  ): Promise<boolean> {
    const sourceEntity = source.getEntity(sourceId);
    const targetEntity = (await this.getEntity(targetId));
    if (!sourceEntity || sourceEntity.deletedAt || !targetEntity || targetEntity.deletedAt) {
      return false;
    }
    if (sourceEntity.kind !== targetEntity.kind) return false;

    return this.transaction(async () => {
      (await this.clearEntityBody(targetId));
      (await this.copyEntityBodyFrom(source, sourceId, targetId));
      (await this.activeBackend.run(`UPDATE entities
           SET description = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`, [sourceEntity.description, now, targetId]));
      return true;
    });
  }

  /** Delete all content rows for an entity, keeping the entity row and central mappings. */
  private async clearEntityBody(entityId: string): Promise<void> {
    const tables: [string, string][] = [
      ['entity_names', 'entity_id'],
      ['entity_authorities', 'entity_id'],
      ['entity_dates', 'entity_id'],
      ['entity_metadata', 'entity_id'],
      ['authority_caches', 'entity_id'],
      ['entity_decisions', 'entity_id'],
      ['entity_attributes', 'entity_id'],
      ['entity_extensions', 'entity_id'],
      ['entity_xml_fragments', 'entity_id'],
      ['person_nationalities', 'person_id'],
      ['person_origins', 'person_id'],
      ['person_titles', 'person_id'],
      ['person_offices', 'person_id'],
      ['work_authors', 'work_id'],
      ['office_classifications', 'office_id'],
    ];
    for (const [table, ownerCol] of tables) {
      try {
        (await this.activeBackend.run(`DELETE FROM ${table} WHERE ${ownerCol} = ?`, [entityId]));
      } catch {
        // Older schema may lack a table (e.g. entity_xml_fragments already migrated away).
      }
    }
    (await this.activeBackend.run('DELETE FROM entity_tombstones WHERE entity_id = ?', [entityId]));
    (await this.activeBackend.run('DELETE FROM entity_provenance WHERE entity_id = ?', [entityId]));
    const kind = (await this.getEntity(entityId))?.kind;
    if (kind === 'person') {
      (await this.activeBackend.run('UPDATE people SET family_name = NULL, given_name = NULL WHERE entity_id = ?', [entityId]));
    }
  }

  private async copyEntityBodyFrom(
    source: EntitySqliteRepository,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    const insertRows = (
      table: string,
      ownerCol: string,
      rows: Record<string, unknown>[],
      remap?: (row: Record<string, unknown>) => Record<string, unknown> | null,
    ) => {
      for (const row of rows) {
        const next: Record<string, unknown> = { ...row, [ownerCol]: targetId };
        delete next.id;
        const mapped = remap ? remap(next) : next;
        if (!mapped) continue;
        const columns = Object.keys(mapped);
        if (columns.length === 0) continue;
        (await this.activeBackend.run(`INSERT INTO ${table} (${columns.join(', ')})
             VALUES (${columns.map(() => '?').join(', ')})`, [...columns.map((column) => mapped[column] as string | number | null | bigint)]));
      }
    };

    const sourceRows = (table: string, ownerCol: string) =>
      source.db.prepare(`SELECT * FROM ${table} WHERE ${ownerCol} = ?`).all(sourceId) as Record<
        string,
        unknown
      >[];

    const dateIdMap = new Map<number, number>();
    for (const row of sourceRows('entity_dates', 'entity_id')) {
      const oldId = Number(row.id);
      const next: Record<string, unknown> = { ...row, entity_id: targetId };
      delete next.id;
      const columns = Object.keys(next);
      const result = (await this.activeBackend.run(`INSERT INTO entity_dates (${columns.join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`, [...columns.map((column) => next[column] as string | number | null | bigint)]));
      dateIdMap.set(oldId, Number(result.lastInsertRowid));
    }

    insertRows('entity_names', 'entity_id', sourceRows('entity_names', 'entity_id'));
    insertRows(
      'entity_authorities',
      'entity_id',
      sourceRows('entity_authorities', 'entity_id'),
      (row) => (String(row.authority_type) === CENTRAL_AUTHORITY_TYPE ? null : row),
    );
    insertRows('entity_metadata', 'entity_id', sourceRows('entity_metadata', 'entity_id'));
    insertRows('authority_caches', 'entity_id', sourceRows('authority_caches', 'entity_id'));
    insertRows('entity_decisions', 'entity_id', sourceRows('entity_decisions', 'entity_id'));
    insertRows('entity_attributes', 'entity_id', sourceRows('entity_attributes', 'entity_id'));
    try {
      insertRows('entity_extensions', 'entity_id', sourceRows('entity_extensions', 'entity_id'));
    } catch {
      /* optional */
    }
    try {
      insertRows(
        'entity_xml_fragments',
        'entity_id',
        sourceRows('entity_xml_fragments', 'entity_id'),
      );
    } catch {
      /* optional */
    }

    const entityExists = (id: string | null | undefined) =>
      Boolean(id && (await this.activeBackend.get('SELECT 1 FROM entities WHERE id = ?', [id])));

    insertRows(
      'person_nationalities',
      'person_id',
      sourceRows('person_nationalities', 'person_id'),
      (row) => {
        const nationalityId = row.nationality_entity_id ? String(row.nationality_entity_id) : null;
        return {
          ...row,
          nationality_entity_id: entityExists(nationalityId) ? nationalityId : null,
        };
      },
    );
    insertRows('person_origins', 'person_id', sourceRows('person_origins', 'person_id'));
    insertRows('person_titles', 'person_id', sourceRows('person_titles', 'person_id'));
    insertRows('person_offices', 'person_id', sourceRows('person_offices', 'person_id'), (row) => {
      const officeId = row.office_id ? String(row.office_id) : null;
      const startDateId =
        row.start_date_id != null ? dateIdMap.get(Number(row.start_date_id)) : null;
      const endDateId = row.end_date_id != null ? dateIdMap.get(Number(row.end_date_id)) : null;
      return {
        ...row,
        office_id: entityExists(officeId) ? officeId : null,
        start_date_id: startDateId ?? null,
        end_date_id: endDateId ?? null,
      };
    });
    insertRows('work_authors', 'work_id', sourceRows('work_authors', 'work_id'), (row) => {
      const personId = row.person_id ? String(row.person_id) : null;
      return {
        ...row,
        person_id: entityExists(personId) ? personId : null,
      };
    });
    insertRows(
      'office_classifications',
      'office_id',
      sourceRows('office_classifications', 'office_id'),
    );

    const kind = (await this.getEntity(targetId))?.kind;
    if (kind === 'person') {
      const person = source.db
        .prepare('SELECT family_name, given_name FROM people WHERE entity_id = ?')
        .get(sourceId) as { family_name: string | null; given_name: string | null } | undefined;
      if (person) {
        (await this.activeBackend.run('UPDATE people SET family_name = ?, given_name = ? WHERE entity_id = ?', [person.family_name, person.given_name, targetId]));
      }
    }

    // Rebuild audit tables from copied provenance/status (same as XML import).
    for (const [table, entityColumn] of [
      ['entity_names', 'entity_id'],
      ['entity_authorities', 'entity_id'],
      ['entity_dates', 'entity_id'],
      ['person_nationalities', 'person_id'],
      ['person_origins', 'person_id'],
      ['person_titles', 'person_id'],
      ['work_authors', 'work_id'],
      ['person_offices', 'person_id'],
      ['office_classifications', 'office_id'],
      ['entity_metadata', 'entity_id'],
    ] as const) {
      (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones (entity_id, table_name, row_id, reason, created_at)
           SELECT ${entityColumn}, ?, id, ?, updated_at
           FROM ${table}
           WHERE ${entityColumn} = ? AND status <> 'active'`, [table, `mirror-copy-${table}-status`, targetId]));
      (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_provenance (entity_id, table_name, row_id, origin, source, recorded_at)
           SELECT ${entityColumn}, ?, id, origin, source, updated_at
           FROM ${table}
           WHERE ${entityColumn} = ?`, [table, targetId]));
    }
  }

  /**
   * Apply authority-sourced enrichment for one entity in a single transaction.
   * Skips identities that already exist at any status (including rejected
   * tombstones) so refresh cannot silently resurrect rejected values.
   */
  async applyAuthorityBackfillPatch(patch: AuthorityBackfillPatch): Promise<AuthorityBackfillPatchResult> {
    const now = patch.now ?? nowIso();
    return this.transaction(async () => {
      const entity = (await this.getEntity(patch.entityId));
      if (!entity || entity.deletedAt) {
        return { changed: false, namesAdded: 0 };
      }

      let changed = false;
      let namesAdded = 0;

      const upsertAuthorityDate = (
        dateKind: 'birth' | 'death' | 'dates',
        source: string,
        startYear: number | null | undefined,
        endYear: number | null | undefined,
        startPrecision?: string | null,
      ) => {
        const normalizedSource = source.trim().toUpperCase();
        if (dateKind === 'dates') {
          if (startYear == null && endYear == null) return;
          const precision = startPrecision?.trim() || null;
          const existing = (await this.activeBackend.all(`SELECT id, start_year, end_year, start_precision, status FROM entity_dates
               WHERE entity_id = ? AND date_kind IN ('dates', 'work')
                 AND origin = 'authority' AND UPPER(COALESCE(source, '')) = ?
               ORDER BY id`, [patch.entityId, normalizedSource])) as {
            id: number;
            start_year: number | null;
            end_year: number | null;
            start_precision: string | null;
            status: string;
          }[];
          const exact = existing.find(
            (row) =>
              row.start_year === (startYear ?? null) &&
              row.end_year === (endYear ?? null) &&
              (row.start_precision ?? null) === precision,
          );
          if (exact) return;
          for (const row of existing) {
            (await this.activeBackend.run('DELETE FROM entity_dates WHERE id = ?', [row.id]));
          }
          const rawText = [
            startYear != null ? isoYearString(startYear) : '',
            endYear != null ? isoYearString(endYear) : '',
          ].join('/');
          (await this.activeBackend.run(`INSERT INTO entity_dates
                 (entity_id, date_kind, start_year, end_year, from_value, to_value, raw_text,
                  start_precision, origin, source, status, created_at, updated_at)
               VALUES (?, 'dates', ?, ?, ?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
              startYear ?? null,
              endYear ?? null,
              startYear != null ? isoYearString(startYear) : null,
              endYear != null ? isoYearString(endYear) : null,
              rawText,
              precision,
              normalizedSource,
              now,
              now,]));
          changed = true;
          return;
        }

        if (startYear == null) return;
        const existing = (await this.activeBackend.all(`SELECT id, start_year, status FROM entity_dates
             WHERE entity_id = ? AND date_kind = ? AND origin = 'authority'
               AND UPPER(COALESCE(source, '')) = ?
             ORDER BY id`, [patch.entityId, dateKind, normalizedSource])) as {
          id: number;
          start_year: number | null;
          status: string;
        }[];
        const exact = existing.find((row) => row.start_year === startYear);
        if (exact) return;
        for (const row of existing) {
          (await this.activeBackend.run('DELETE FROM entity_dates WHERE id = ?', [row.id]));
        }
        (await this.activeBackend.run(`INSERT INTO entity_dates
               (entity_id, date_kind, start_year, when_value, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
            dateKind,
            startYear,
            isoYearString(startYear),
            normalizedSource,
            now,
            now,]));
        changed = true;
      };

      for (const name of patch.names ?? []) {
        const text = name.text.trim();
        if (!text) continue;
        const nameType = normalizePersonNameType(name.nameType ?? null);
        const existing = (await this.activeBackend.all(`SELECT id, name_type, language, status FROM entity_names
             WHERE entity_id = ? AND text = ?
             ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id`, [patch.entityId, text])) as {
          id: number;
          name_type: string | null;
          language: string | null;
          status: string;
        }[];
        const active = existing.find((row) => row.status === 'active');
        if (active) {
          let upgraded = false;
          if (nameType && !active.name_type) {
            (await this.activeBackend.run(`UPDATE entity_names
                 SET name_type = ?, name_role = CASE
                   WHEN ? IN ('family', 'given') THEN ?
                   ELSE name_role
                 END, updated_at = ?
                 WHERE id = ?`, [nameType, nameType, nameType, now, active.id]));
            if (nameType !== 'family' && nameType !== 'given') {
              (await this.syncPersonNameScalars(patch.entityId, text, nameType, now));
            }
            upgraded = true;
          }
          if (name.language && !active.language) {
            (await this.activeBackend.run('UPDATE entity_names SET language = ?, updated_at = ? WHERE id = ?', [name.language, now, active.id]));
            upgraded = true;
          }
          if (upgraded) changed = true;
          continue;
        }
        if (existing.length > 0) {
          // User-rejected names stay dead. Withdrawn family/given (mirror sync or
          // an empty rewrite pass) may be restored when authority refresh asserts them.
          const canRestoreSplit = nameType === 'family' || nameType === 'given';
          const withdrawn = canRestoreSplit
            ? existing.find((row) => row.status === 'withdrawn')
            : undefined;
          if (withdrawn && !existing.some((row) => row.status === 'active')) {
            (await this.activeBackend.run(`UPDATE entity_names
                 SET status = 'active', name_type = ?, name_role = ?, origin = 'authority',
                     source = COALESCE(?, source), language = COALESCE(?, language), updated_at = ?
                 WHERE id = ?`, [nameType,
                nameType,
                name.source?.trim() || null,
                name.language ?? null,
                now,
                withdrawn.id,]));
            (await this.activeBackend.run(`DELETE FROM entity_tombstones
                 WHERE entity_id = ? AND table_name = 'entity_names' AND row_id = ?`, [patch.entityId, withdrawn.id]));
            namesAdded += 1;
            changed = true;
            continue;
          }
          continue;
        }
        const nameRole = nameType === 'family' || nameType === 'given' ? nameType : 'variant';
        (await this.activeBackend.run(`INSERT INTO entity_names
               (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
            text,
            nameType,
            nameRole,
            name.language ?? null,
            name.source?.trim() || null,
            now,
            now,]));
        // Do not sync 姓/名 scalars here: multiple family/given variants may be
        // inserted in one patch, and the dedicated familyName/givenName fields
        // below choose the canonical pair.
        if (nameType !== 'family' && nameType !== 'given') {
          (await this.syncPersonNameScalars(patch.entityId, text, nameType, now));
        }
        namesAdded += 1;
        changed = true;
      }

      for (const source of patch.clearAuthorityVitalSources ?? []) {
        const normalizedSource = source.trim().toUpperCase();
        if (!normalizedSource) continue;
        const removed = (await this.activeBackend.run(`DELETE FROM entity_dates
             WHERE entity_id = ? AND origin = 'authority'
               AND date_kind IN ('birth', 'death')
               AND UPPER(COALESCE(source, '')) = ?`, [patch.entityId, normalizedSource]));
        if (removed.changes > 0) changed = true;
      }

      if (entity.kind === 'person') {
        const person = (await this.activeBackend.get('SELECT family_name, given_name FROM people WHERE entity_id = ?', [patch.entityId])) as
          { family_name: string | null; given_name: string | null } | undefined;
        const familyVariants = new Set(
          (patch.names ?? [])
            .filter((name) => normalizePersonNameType(name.nameType ?? null) === 'family')
            .map((name) => name.text.trim())
            .filter(Boolean),
        );
        const givenVariants = new Set(
          (patch.names ?? [])
            .filter((name) => normalizePersonNameType(name.nameType ?? null) === 'given')
            .map((name) => name.text.trim())
            .filter(Boolean),
        );
        const nextFamily = patch.familyName?.trim() || null;
        const nextGiven = patch.givenName?.trim() || null;
        const hasPositivePersonSplit = Boolean(
          nextFamily || nextGiven || familyVariants.size > 0 || givenVariants.size > 0,
        );

        if (patch.rewriteUnvalidatedPersonNames && hasPositivePersonSplit) {
          const authorityNameRows = (await this.activeBackend.all(`SELECT id, text, name_type, name_role, origin FROM entity_names
               WHERE entity_id = ? AND status = 'active'
                 AND origin IN ('authority', 'xml')
                 AND (
                   name_type IN ('family', 'given', 'familyName', 'givenName')
                   OR name_role IN ('family', 'given', 'familyName', 'givenName')
                 )`, [patch.entityId])) as {
            id: number;
            text: string;
            name_type: string | null;
            name_role: string | null;
            origin: string;
          }[];
          for (const row of authorityNameRows) {
            const type = normalizePersonNameType(row.name_type) ?? row.name_role;
            const text = row.text.trim();
            if (!text) continue;
            const keep =
              type === 'family'
                ? familyVariants.has(text) || text === nextFamily
                : type === 'given'
                  ? givenVariants.has(text) || text === nextGiven
                  : true;
            if (keep) continue;
            (await this.activeBackend.run(`UPDATE entity_names SET status = 'withdrawn', updated_at = ? WHERE id = ?`, [now, row.id]));
            (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
                   (entity_id, table_name, row_id, reason, created_at)
                 VALUES (?, 'entity_names', ?, 'authority-backfill-rewrite', ?)`, [patch.entityId, row.id, now]));
            changed = true;
          }

          const userValidatedFamily = (await this.activeBackend.get(`SELECT 1 FROM entity_names
               WHERE entity_id = ? AND status = 'active' AND origin = 'user'
                 AND text = ? AND (name_type IN ('family', 'familyName') OR name_role IN ('family', 'familyName'))`, [patch.entityId, person?.family_name?.trim() || ''])) as { 1?: number } | undefined;
          const userValidatedGiven = (await this.activeBackend.get(`SELECT 1 FROM entity_names
               WHERE entity_id = ? AND status = 'active' AND origin = 'user'
                 AND text = ? AND (name_type IN ('given', 'givenName') OR name_role IN ('given', 'givenName'))`, [patch.entityId, person?.given_name?.trim() || ''])) as { 1?: number } | undefined;

          const currentFamily = person?.family_name?.trim() || null;
          const currentGiven = person?.given_name?.trim() || null;

          const ensureSplitNameRow = (text: string, type: 'family' | 'given') => {
            const rows = (await this.activeBackend.all(`SELECT id, status FROM entity_names
                 WHERE entity_id = ? AND text = ?
                 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'withdrawn' THEN 1 ELSE 2 END, id`, [patch.entityId, text])) as { id: number; status: string }[];
            const active = rows.find((row) => row.status === 'active');
            if (active) return;
            const withdrawn = rows.find((row) => row.status === 'withdrawn');
            if (withdrawn) {
              (await this.activeBackend.run(`UPDATE entity_names
                   SET status = 'active', name_type = ?, name_role = ?, origin = 'authority',
                       updated_at = ?
                   WHERE id = ?`, [type, type, now, withdrawn.id]));
              (await this.activeBackend.run(`DELETE FROM entity_tombstones
                   WHERE entity_id = ? AND table_name = 'entity_names' AND row_id = ?`, [patch.entityId, withdrawn.id]));
              namesAdded += 1;
              return;
            }
            (await this.activeBackend.run(`INSERT INTO entity_names
                   (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, NULL, 0, 'authority', NULL, 'active', ?, ?)`, [patch.entityId, text, type, type, now, now]));
            namesAdded += 1;
          };

          if (!userValidatedFamily && nextFamily) {
            const before = namesAdded;
            ensureSplitNameRow(nextFamily, 'family');
            if (currentFamily !== nextFamily) {
              (await this.activeBackend.run('UPDATE people SET family_name = ? WHERE entity_id = ?', [nextFamily, patch.entityId]));
              changed = true;
            } else if (namesAdded > before) {
              changed = true;
            }
          }

          if (!userValidatedGiven && nextGiven) {
            const before = namesAdded;
            ensureSplitNameRow(nextGiven, 'given');
            if (currentGiven !== nextGiven) {
              (await this.activeBackend.run('UPDATE people SET given_name = ? WHERE entity_id = ?', [nextGiven, patch.entityId]));
              changed = true;
            } else if (namesAdded > before) {
              changed = true;
            }
          } else if (
            !userValidatedGiven &&
            !nextGiven &&
            currentGiven &&
            (nextFamily || familyVariants.size > 0)
          ) {
            // Authority split without a 名 (e.g. noble-title cleanup) clears an
            // invented given scalar; empty patches never reach this branch.
            (await this.activeBackend.run('UPDATE people SET given_name = ? WHERE entity_id = ?', [null, patch.entityId]));
            changed = true;
          }
        } else if (!patch.rewriteUnvalidatedPersonNames) {
          if (patch.familyName?.trim()) {
            const text = patch.familyName.trim();
            const current = person?.family_name?.trim() || null;
            // Set when empty, or when the current scalar is merely another pack
            // family variant (re-backfill can correct 元 → 拓拔 for 拓拔建).
            const shouldSet = !current || (current !== text && familyVariants.has(current));
            if (shouldSet) {
              const hasName = (await this.activeBackend.get(`SELECT 1 FROM entity_names WHERE entity_id = ? AND text = ? AND status = 'active'`, [patch.entityId, text]));
              if (!hasName) {
                (await this.activeBackend.run(`INSERT INTO entity_names
                       (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
                     VALUES (?, ?, 'family', 'family', NULL, 0, 'authority', NULL, 'active', ?, ?)`, [patch.entityId, text, now, now]));
                namesAdded += 1;
              }
              (await this.activeBackend.run('UPDATE people SET family_name = ? WHERE entity_id = ?', [text, patch.entityId]));
              changed = true;
            }
          }
          if (patch.givenName?.trim()) {
            const text = patch.givenName.trim();
            const current = person?.given_name?.trim() || null;
            const shouldSet = !current || (current !== text && givenVariants.has(current));
            if (shouldSet) {
              const hasName = (await this.activeBackend.get(`SELECT 1 FROM entity_names WHERE entity_id = ? AND text = ? AND status = 'active'`, [patch.entityId, text]));
              if (!hasName) {
                (await this.activeBackend.run(`INSERT INTO entity_names
                       (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
                     VALUES (?, ?, 'given', 'given', NULL, 0, 'authority', NULL, 'active', ?, ?)`, [patch.entityId, text, now, now]));
                namesAdded += 1;
              }
              (await this.activeBackend.run('UPDATE people SET given_name = ? WHERE entity_id = ?', [text, patch.entityId]));
              changed = true;
            }
          }
        }
      }

      if (patch.romanized?.text?.trim()) {
        const hasLatn = (await this.activeBackend.get(`SELECT 1 FROM entity_names
             WHERE entity_id = ? AND status = 'active' AND language LIKE '%-Latn'`, [patch.entityId]));
        if (!hasLatn) {
          const language = patch.romanized.language?.trim() || 'und-Latn';
          const latnLang = language.includes('-Latn') ? language : `${language}-Latn`;
          (await this.activeBackend.run(`INSERT INTO entity_names
                 (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
               VALUES (?, ?, 'romanization', 'variant', ?, 0, 'authority', NULL, 'active', ?, ?)`, [patch.entityId, patch.romanized.text.trim(), latnLang, now, now]));
          changed = true;
        }
      }

      for (const date of patch.dates ?? []) {
        if (date.asFloruit) {
          upsertAuthorityDate('dates', date.source, date.startYear, date.endYear, 'fl.');
        } else {
          upsertAuthorityDate('birth', date.source, date.startYear, undefined);
          upsertAuthorityDate('death', date.source, date.endYear, undefined);
        }
      }

      if (patch.workDate) {
        upsertAuthorityDate(
          'dates',
          patch.workDate.source,
          patch.workDate.startYear,
          patch.workDate.endYear,
        );
      }

      for (const value of patch.nationalities ?? []) {
        const label = value.label.trim();
        if (!label) continue;
        const source = value.source.trim().toUpperCase();
        const identity = (value.ref?.trim() || label).trim();
        const exists = (await this.activeBackend.get(`SELECT 1 FROM person_nationalities
             WHERE person_id = ?
               AND UPPER(COALESCE(source, '')) = ?
               AND COALESCE(reference, label) = ?`, [patch.entityId, source, identity]));
        if (exists) continue;
        (await this.activeBackend.run(`INSERT INTO person_nationalities
               (person_id, label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId, label, value.ref?.trim() || null, source, now, now]));
        changed = true;
      }

      for (const value of patch.origins ?? []) {
        const label = value.label.trim();
        if (!label) continue;
        const source = value.source.trim().toUpperCase();
        const identity = (value.ref?.trim() || label).trim();
        const exists = (await this.activeBackend.get(`SELECT 1 FROM person_origins
             WHERE person_id = ?
               AND UPPER(COALESCE(source, '')) = ?
               AND COALESCE(reference, label) = ?`, [patch.entityId, source, identity]));
        if (exists) continue;
        (await this.activeBackend.run(`INSERT INTO person_origins
               (person_id, label, reference, name_type, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
            label,
            value.ref?.trim() || null,
            value.nameType?.trim() || null,
            source,
            now,
            now,]));
        changed = true;
      }

      for (const office of patch.offices ?? []) {
        const label = office.label.trim();
        if (!label) continue;
        const source = office.source.trim().toUpperCase();
        const identity = (office.ref?.trim() || label).trim();
        const exists = (await this.activeBackend.get(`SELECT 1 FROM person_offices
             WHERE person_id = ?
               AND UPPER(COALESCE(source, '')) = ?
               AND COALESCE(reference, office_label) = ?`, [patch.entityId, source, identity]));
        if (exists) continue;
        const officeId = office.ref?.replace(/^#/, '').trim() || null;
        const officeExists =
          officeId &&
          (await this.activeBackend.get("SELECT 1 FROM entities WHERE id = ? AND kind = 'office'", [officeId]))
            ? officeId
            : null;
        (await this.activeBackend.run(`INSERT INTO person_offices
               (person_id, office_id, office_label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId, officeExists, label, office.ref?.trim() || null, source, now, now]));
        changed = true;
      }

      for (const title of patch.nobleTitles ?? []) {
        const place = title.placeName.trim();
        const role = title.roleName.trim();
        if (!place && !role) continue;
        const posthumous = title.posthumousName?.trim() ?? '';
        const dynasty = title.dynasty?.trim() ?? '';
        const key = title.ref?.trim() || [place, role, posthumous].join('\u001f');
        const exists = (await this.activeBackend.get(`SELECT 1 FROM person_titles
             WHERE person_id = ?
               AND (
                 (reference IS NOT NULL AND reference = ?)
                 OR (
                   COALESCE(place_name, '') = ?
                   AND COALESCE(role_name, '') = ?
                   AND COALESCE(posthumous_name, '') = ?
                 )
               )`, [patch.entityId, key, place, role, posthumous]));
        if (exists) continue;
        (await this.activeBackend.run(`INSERT INTO person_titles
               (person_id, dynasty, place_name, role_name, posthumous_name, reference,
                origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
            dynasty || null,
            place,
            role,
            posthumous || null,
            title.ref?.trim() || null,
            title.source.trim(),
            now,
            now,]));
        changed = true;
      }

      for (const cache of patch.authorityCaches ?? []) {
        const authorityType = cache.authorityType.trim();
        if (!authorityType) continue;
        const source = cache.source?.trim() || null;
        const payload = JSON.stringify(cache.payload ?? null);
        const previous = (await this.activeBackend.get(`SELECT id, payload_json FROM authority_caches
             WHERE entity_id = ? AND authority_type = ? AND COALESCE(source, '') = COALESCE(?, '')`, [patch.entityId, authorityType, source])) as
          { id: number; payload_json: string } | undefined;
        if (previous?.payload_json === payload) continue;
        if (previous) {
          (await this.activeBackend.run(`UPDATE authority_caches
               SET payload_json = ?, retrieved_at = ?, status = 'active'
               WHERE id = ?`, [payload, now, previous.id]));
        } else {
          (await this.activeBackend.run(`INSERT INTO authority_caches
                 (entity_id, authority_type, source, payload_json, retrieved_at, status)
               VALUES (?, ?, ?, ?, ?, 'active')`, [patch.entityId, authorityType, source, payload, now]));
        }
        changed = true;
      }

      for (const author of patch.workAuthors ?? []) {
        const name = author.name.trim();
        if (!name) continue;
        const personId = author.personId?.replace(/^#/, '').trim() || null;
        const reference = author.ref?.trim() || (personId ? `#${personId}` : null);
        const exists = (await this.activeBackend.get(`SELECT 1 FROM work_authors
             WHERE work_id = ?
               AND (
                 (person_id IS NOT NULL AND person_id = ?)
                 OR (reference IS NOT NULL AND reference = ?)
               )`, [patch.entityId, personId, reference]));
        if (exists) continue;
        // Also skip tombstoned same-label+ref identities without person_id.
        const tombstoned = (await this.activeBackend.get(`SELECT 1 FROM work_authors
             WHERE work_id = ? AND label = ? AND COALESCE(reference, '') = ? AND status != 'active'`, [patch.entityId, name, reference ?? '']));
        if (tombstoned) continue;
        (await this.activeBackend.run(`INSERT INTO work_authors
               (work_id, person_id, label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'authority', ?, 'active', ?, ?)`, [patch.entityId,
            personId,
            name,
            reference,
            author.source?.trim() || 'Wikidata',
            now,
            now,]));
        changed = true;
      }

      const normalizedNames = (await this.normalizeEntityNameIntegrity(patch.entityId, now));
      if (
        normalizedNames.dedupedNames ||
        normalizedNames.removedNan ||
        normalizedNames.removedInvalidFamilyGiven
      ) {
        changed = true;
      }
      if (changed) (await this.bumpEntity(patch.entityId, now));
      return { changed, namesAdded };
    });
  }

  private async addPersonLabeledValue(
    table: 'person_nationalities' | 'person_origins',
    input: AddLabeledValueInput,
  ): Promise<boolean> {
    const label = input.label.trim();
    if (!label) return false;
    const now = input.now ?? nowIso();
    const origin = input.origin ?? 'user';
    return this.transaction(async () => {
      if ((await this.getEntity(input.entityId))?.kind !== 'person') return false;
      const exists = (await this.activeBackend.get(`SELECT 1 FROM ${table}
           WHERE person_id = ? AND status = 'active' AND label = ?`, [input.entityId, label]));
      if (exists) return false;
      (await this.activeBackend.run(`INSERT INTO ${table}
             (person_id, label, reference, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`, [input.entityId, label, input.ref ?? null, origin, input.source ?? null, now, now]));
      (await this.bumpEntity(input.entityId, now));
      return true;
    });
  }

  /**
   * Reconcile one wrapper source against person_* rows. Identity is
   * element+source+value (or structured title parts), matching DOM
   * `entityValueKey` so validated (origin=user) and rejected rows block
   * re-inserts without being deleted by refresh.
   */
  private async ingestXmlExtractedForSource(
    wrapper: XmlExtractedWrapperInput,
    now: string,
  ): Promise<{ added: number; removed: number; retained: number }> {
    if ((await this.getEntity(wrapper.entityId))?.kind !== 'person') {
      return { added: 0, removed: 0, retained: 0 };
    }

    type Mapped =
      | { kind: 'nationality' | 'origin' | 'office'; label: string; ref: string | null }
      | {
          kind: 'title';
          place: string;
          role: string;
          posthumous: string;
          ref: string | null;
          placeRef: string | null;
          roleRef: string | null;
          posthumousRef: string | null;
        };

    const mapped: Mapped[] = [];
    const currentKeys = new Set<string>();
    const addKey = (element: string, value: string) => {
      currentKeys.add([element, wrapper.source, value].join('\u001f'));
    };

    for (const assertion of wrapper.assertions) {
      const element = assertion.element.trim();
      const value = assertion.value.trim();
      const ref = assertion.ref?.trim() || null;
      if (element === 'nationality' && value) {
        addKey('nationality', value);
        mapped.push({ kind: 'nationality', label: value, ref });
      } else if (element === 'placeName' && value) {
        addKey('placeName', value);
        mapped.push({ kind: 'origin', label: value, ref });
      } else if ((element === 'state' || element === 'affiliation') && value) {
        // Norbert emits `state` for officeName; TEI export uses `affiliation`.
        addKey('state', value);
        addKey('affiliation', value);
        mapped.push({ kind: 'office', label: value, ref });
      } else if (element === 'nobleTitle' && value) {
        addKey('nobleTitle', value);
        const place = assertion.children?.find((part) => part.element === 'placeName');
        const role = assertion.children?.find((part) => part.element === 'roleName');
        const posthumous = assertion.children?.find((part) => part.element === 'persName');
        mapped.push({
          kind: 'title',
          place: place?.value.trim() ?? '',
          role: role?.value.trim() ?? '',
          posthumous: posthumous?.value.trim() ?? '',
          ref,
          placeRef: place?.ref?.trim() || null,
          roleRef: role?.ref?.trim() || null,
          posthumousRef: posthumous?.ref?.trim() || null,
        });
      }
    }

    let added = 0;
    let removed = 0;
    let retained = 0;
    let changed = false;

    const withdrawLabeled = (
      table: 'person_nationalities' | 'person_origins' | 'person_offices',
      elements: string[],
      labelCol: string,
    ) => {
      const rows = (await this.activeBackend.all(`SELECT id, ${labelCol} AS label, origin, status
           FROM ${table}
           WHERE person_id = ? AND source = ?`, [wrapper.entityId, wrapper.source])) as {
        id: number;
        label: string;
        origin: string;
        status: string;
      }[];
      for (const row of rows) {
        const label = String(row.label).trim();
        const present = elements.some((element) =>
          currentKeys.has([element, wrapper.source, label].join('\u001f')),
        );
        if (row.origin !== 'xml' || row.status !== 'active') {
          retained += 1;
          continue;
        }
        if (!present) {
          (await this.activeBackend.run(`DELETE FROM ${table} WHERE id = ?`, [row.id]));
          removed += 1;
          changed = true;
        } else {
          retained += 1;
        }
      }
    };

    withdrawLabeled('person_nationalities', ['nationality'], 'label');
    withdrawLabeled('person_origins', ['placeName'], 'label');
    withdrawLabeled('person_offices', ['state', 'affiliation'], 'office_label');

    {
      const rows = (await this.activeBackend.all(`SELECT id, place_name, role_name, posthumous_name, origin, status
           FROM person_titles
           WHERE person_id = ? AND source = ?`, [wrapper.entityId, wrapper.source])) as {
        id: number;
        place_name: string | null;
        role_name: string | null;
        posthumous_name: string | null;
        origin: string;
        status: string;
      }[];
      for (const row of rows) {
        if (row.origin !== 'xml' || row.status !== 'active') {
          retained += 1;
          continue;
        }
        const place = String(row.place_name ?? '').trim();
        const role = String(row.role_name ?? '').trim();
        const posthumous = String(row.posthumous_name ?? '').trim();
        const stillPresent = mapped.some(
          (item) =>
            item.kind === 'title' &&
            item.place === place &&
            item.role === role &&
            item.posthumous === posthumous,
        );
        if (!stillPresent) {
          (await this.activeBackend.run(`DELETE FROM person_titles WHERE id = ?`, [row.id]));
          removed += 1;
          changed = true;
        } else {
          retained += 1;
        }
      }
    }

    const rowExists = (sql: string, ...params: (string | number | bigint | null)[]) =>
      Boolean((await this.activeBackend.get(sql, [...params])));

    for (const item of mapped) {
      if (item.kind === 'nationality') {
        if (
          rowExists(
            `SELECT 1 FROM person_nationalities
             WHERE person_id = ? AND source = ? AND label = ?`,
            wrapper.entityId,
            wrapper.source,
            item.label,
          )
        )
          continue;
        (await this.activeBackend.run(`INSERT INTO person_nationalities
               (person_id, label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, 'xml', ?, 'active', ?, ?)`, [wrapper.entityId, item.label, item.ref, wrapper.source, now, now]));
        added += 1;
        changed = true;
      } else if (item.kind === 'origin') {
        if (
          rowExists(
            `SELECT 1 FROM person_origins
             WHERE person_id = ? AND source = ? AND label = ?`,
            wrapper.entityId,
            wrapper.source,
            item.label,
          )
        )
          continue;
        (await this.activeBackend.run(`INSERT INTO person_origins
               (person_id, label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, 'xml', ?, 'active', ?, ?)`, [wrapper.entityId, item.label, item.ref, wrapper.source, now, now]));
        added += 1;
        changed = true;
      } else if (item.kind === 'office') {
        if (
          rowExists(
            `SELECT 1 FROM person_offices
             WHERE person_id = ? AND source = ? AND office_label = ?`,
            wrapper.entityId,
            wrapper.source,
            item.label,
          )
        )
          continue;
        const officeId = item.ref?.replace(/^#/, '') || null;
        const officeExists =
          officeId &&
          (await this.activeBackend.get("SELECT 1 FROM entities WHERE id = ? AND kind = 'office'", [officeId]))
            ? officeId
            : null;
        (await this.activeBackend.run(`INSERT INTO person_offices
               (person_id, office_id, office_label, reference, origin, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'xml', ?, 'active', ?, ?)`, [wrapper.entityId, officeExists, item.label, item.ref, wrapper.source, now, now]));
        added += 1;
        changed = true;
      } else if (item.kind === 'title') {
        if (
          rowExists(
            `SELECT 1 FROM person_titles
             WHERE person_id = ? AND source = ?
               AND COALESCE(place_name, '') = ?
               AND COALESCE(role_name, '') = ?
               AND COALESCE(posthumous_name, '') = ?`,
            wrapper.entityId,
            wrapper.source,
            item.place,
            item.role,
            item.posthumous,
          )
        )
          continue;
        (await this.activeBackend.run(`INSERT INTO person_titles
               (person_id, dynasty, place_name, role_name, posthumous_name, reference,
                place_reference, role_reference, posthumous_reference,
                origin, source, status, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'xml', ?, 'active', ?, ?)`, [wrapper.entityId,
            item.place,
            item.role,
            item.posthumous || null,
            item.ref,
            item.placeRef,
            item.roleRef,
            item.posthumousRef,
            wrapper.source,
            now,
            now,]));
        added += 1;
        changed = true;
      }
    }

    if (changed) (await this.bumpEntity(wrapper.entityId, now));
    return { added, removed, retained };
  }

  private async mutateAssertion(
    entityId: string,
    key: string,
    mode: 'reject' | 'remove' | 'validate' | 'restore',
    now: string,
  ): Promise<boolean> {
    const parsed = parseAssertionKey(key);
    if (!parsed) return false;
    if (parsed.kind === 'description') {
      if (parsed.entityId !== entityId) return false;
      if (mode === 'remove' || mode === 'reject') {
        (await this.updateDescription(entityId, null, now));
        return true;
      }
      return false;
    }
    const ownerCol = ASSERTION_OWNER[parsed.table];
    if (!ownerCol) return false;
    return this.transaction(async () => {
      const row = (await this.activeBackend.get(`SELECT * FROM ${parsed.table} WHERE id = ?`, [parsed.rowId])) as Record<string, unknown> | undefined;
      if (!row || String(row[ownerCol]) !== entityId) return false;
      const origin = String(row.origin) as SqliteValueOrigin;
      const status = String(row.status) as SqliteValueStatus;
      if (mode === 'validate') {
        if (origin === 'user' && status === 'active') return false;
        (await this.activeBackend.run(`UPDATE ${parsed.table}
             SET origin = 'user', status = 'active', updated_at = ?
             WHERE id = ?`, [now, parsed.rowId]));
        (await this.bumpEntity(entityId, now));
        return true;
      }
      if (mode === 'restore') {
        if (status !== 'rejected' || origin === 'user') return false;
        (await this.activeBackend.run(`UPDATE ${parsed.table}
             SET status = 'active', updated_at = ?
             WHERE id = ?`, [now, parsed.rowId]));
        (await this.bumpEntity(entityId, now));
        return true;
      }
      if (mode === 'reject') {
        if (origin === 'user' || status === 'rejected') return false;
        (await this.activeBackend.run(`UPDATE ${parsed.table}
             SET status = 'rejected', updated_at = ?
             WHERE id = ?`, [now, parsed.rowId]));
        (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
               (entity_id, table_name, row_id, reason, created_at)
             VALUES (?, ?, ?, 'user-rejected', ?)`, [entityId, parsed.table, parsed.rowId, now]));
        (await this.bumpEntity(entityId, now));
        return true;
      }
      // remove
      if (status !== 'active') return false;
      if (origin === 'user') {
        (await this.activeBackend.run(`DELETE FROM ${parsed.table} WHERE id = ?`, [parsed.rowId]));
      } else {
        (await this.activeBackend.run(`UPDATE ${parsed.table}
             SET status = 'rejected', updated_at = ?
             WHERE id = ?`, [now, parsed.rowId]));
        (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
               (entity_id, table_name, row_id, reason, created_at)
             VALUES (?, ?, ?, 'user-deleted', ?)`, [entityId, parsed.table, parsed.rowId, now]));
      }
      (await this.bumpEntity(entityId, now));
      return true;
    });
  }

  private async syncPersonNameScalars(
    entityId: string,
    text: string,
    nameType: string | null,
    _now: string,
  ): Promise<void> {
    if (nameType !== 'family' && nameType !== 'given') return;
    if ((await this.getEntity(entityId))?.kind !== 'person') return;
    const column = nameType === 'family' ? 'family_name' : 'given_name';
    (await this.activeBackend.run(`UPDATE people SET ${column} = ? WHERE entity_id = ?`, [text, entityId]));
  }

  private async syncPersonNameScalarsAfterTypeChange(
    entityId: string,
    text: string,
    previousType: string | null,
    nextType: string | null,
    now: string,
  ): Promise<void> {
    if ((await this.getEntity(entityId))?.kind !== 'person') return;
    if (nextType === 'family' || nextType === 'given') {
      (await this.syncPersonNameScalars(entityId, text, nextType, now));
    }
    for (const role of ['family', 'given'] as const) {
      if (previousType !== role || nextType === role) continue;
      const column = role === 'family' ? 'family_name' : 'given_name';
      const current = (await this.activeBackend.get(`SELECT ${column} AS value FROM people WHERE entity_id = ?`, [entityId])) as { value: string | null } | undefined;
      if ((current?.value ?? null) !== text) continue;
      const replacement = (await this.activeBackend.get(`SELECT text FROM entity_names
           WHERE entity_id = ? AND status = 'active'
             AND (name_type IN (?, ?) OR name_role IN (?, ?))
           ORDER BY id LIMIT 1`, [entityId,
          role,
          role === 'family' ? 'familyName' : 'givenName',
          role,
          role === 'family' ? 'familyName' : 'givenName',])) as { text: string } | undefined;
      (await this.activeBackend.run(`UPDATE people SET ${column} = ? WHERE entity_id = ?`, [replacement?.text ?? null, entityId]));
    }
  }

  /**
   * Keep mechanical name artifacts out of normal editing paths as well as the
   * explicit Auto-clean command. This method deliberately does not bump the
   * entity revision: its caller is already completing the enclosing write.
   */
  private async normalizeEntityNameIntegrity(
    entityId: string,
    now: string,
  ): Promise<{ dedupedNames: number; removedNan: number; removedInvalidFamilyGiven: number }> {
    const remove = (row: { id: number; origin: SqliteValueOrigin }, reason: string): void => {
      if (row.origin === 'user') {
        (await this.activeBackend.run('DELETE FROM entity_names WHERE id = ?', [row.id]));
        return;
      }
      (await this.activeBackend.run(`UPDATE entity_names SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, row.id]));
      (await this.activeBackend.run(`INSERT OR IGNORE INTO entity_tombstones
             (entity_id, table_name, row_id, reason, created_at)
           VALUES (?, 'entity_names', ?, ?, ?)`, [entityId, row.id, reason, now]));
    };

    const nanRows = (await this.activeBackend.all(`SELECT id, origin FROM entity_names
         WHERE entity_id = ? AND status = 'active' AND TRIM(text) = 'nan'`, [entityId])) as { id: number; origin: SqliteValueOrigin }[];
    for (const row of nanRows) remove(row, 'auto-clean-nan');

    let dedupedNames = 0;
    const groups = (await this.activeBackend.all(`SELECT text, COALESCE(name_type, '') AS nameTypeKey
         FROM entity_names
         WHERE entity_id = ? AND status = 'active'
         GROUP BY text, COALESCE(name_type, '')
         HAVING COUNT(*) > 1`, [entityId])) as { text: string; nameTypeKey: string }[];
    for (const group of groups) {
      const rows = (await this.activeBackend.all(`SELECT id, origin FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active'
             AND COALESCE(name_type, '') = ?
           ORDER BY is_primary DESC,
                    CASE WHEN name_type IS NULL OR TRIM(name_type) = '' THEN 1 ELSE 0 END,
                    id ASC`, [entityId, group.text, group.nameTypeKey])) as {
        id: number;
        origin: SqliteValueOrigin;
      }[];
      for (const row of rows.slice(1)) {
        remove(row, 'auto-clean-duplicate');
        dedupedNames += 1;
      }
    }

    const person = (await this.activeBackend.get(`SELECT family_name AS familyName, given_name AS givenName
         FROM people WHERE entity_id = ?`, [entityId])) as { familyName: string | null; givenName: string | null } | undefined;
    let removedInvalidFamilyGiven = 0;
    if (person?.familyName?.trim() === 'n' && person.givenName?.trim() === 'an') {
      const invalidRows = (await this.activeBackend.all(`SELECT id, origin FROM entity_names
           WHERE entity_id = ? AND status = 'active'
             AND ((name_type IN ('family', 'familyName') OR name_role IN ('family', 'familyName')) AND TRIM(text) = 'n'
               OR (name_type IN ('given', 'givenName') OR name_role IN ('given', 'givenName')) AND TRIM(text) = 'an')`, [entityId])) as { id: number; origin: SqliteValueOrigin }[];
      for (const row of invalidRows) remove(row, 'auto-clean-invalid-family-given');
      (await this.syncPersonNameScalarsAfterTypeChange(entityId, 'n', 'family', null, now));
      (await this.syncPersonNameScalarsAfterTypeChange(entityId, 'an', 'given', null, now));
      removedInvalidFamilyGiven = 1;
    }

    return { dedupedNames, removedNan: nanRows.length, removedInvalidFamilyGiven };
  }

  private async getName(id: number): Promise<SqliteName | null> {
    const row = (await this.activeBackend.get('SELECT * FROM entity_names WHERE id = ?', [id])) as
      Record<string, unknown> | undefined;
    return row ? rowName(row) : null;
  }

  private async bumpEntity(entityId: string, now: string): Promise<void> {
    (await this.activeBackend.run('UPDATE entities SET revision = revision + 1, updated_at = ? WHERE id = ?', [now, entityId]));
  }
}

export function openEntitySqliteRepository(databasePath: string): EntitySqliteRepository {
  return new EntitySqliteRepository(databasePath);
}
