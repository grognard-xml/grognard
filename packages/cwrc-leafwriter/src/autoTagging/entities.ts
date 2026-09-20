/**
 * Model for the entity database `entities.xml` (Phase 3): a TEI standoff
 * personography/placeography that holds disambiguated entities with typed local
 * ids and authority `<idno>`s. Mentions point in with a bare `@key`.
 */

import { latnLangFor } from '../utilities/languageCodes';
import type { NameTypeId } from './nameTypes';
import type { OriginAssertion } from './authority';
import {
  readEntityValueProvenance,
  writeEntityValueProvenance,
  type EntityValueOrigin,
} from './entityProvenance';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export const DATABASE_IDNO_TYPE = 'grognard-entity-database';
export const GROGNARD_AUTOTAG_RESP = '#grognard-autotag';
export const GROGNARD_RESP = 'grognard';

/** `<note type>` that records an entity's last-modified timestamp (for CEDB↔PEDB sync). */
export const CHANGED_NOTE_TYPE = 'grognard-changed';

/** @deprecated Use GROGNARD_AUTOTAG_RESP */
export const LEAFWRITER_AUTOTAG_RESP = GROGNARD_AUTOTAG_RESP;

export type EntityKind = 'person' | 'place' | 'org' | 'work' | 'office' | 'thing';

interface KindConfig {
  /** Containing TEI list element. */
  list: string;
  /** Entity item element. */
  item: string;
  /** Name element written from the surface form. */
  name: string;
  /** xml:id prefix and the id-scan pattern. */
  idPrefix: string;
  /** Distinguishes multiple TEI lists with the same element name. */
  listType?: string;
  /** Distinguishes application kinds sharing the same TEI item element. */
  itemType?: string;
}

export const ENTITY_KINDS: Record<EntityKind, KindConfig> = {
  person: { list: 'listPerson', item: 'person', name: 'persName', idPrefix: 'person' },
  place: { list: 'listPlace', item: 'place', name: 'placeName', idPrefix: 'place' },
  org: { list: 'listOrg', item: 'org', name: 'orgName', idPrefix: 'org' },
  work: { list: 'listBibl', item: 'bibl', name: 'title', idPrefix: 'work' },
  office: {
    list: 'listOrg',
    listType: 'offices',
    item: 'org',
    itemType: 'office',
    name: 'orgName',
    idPrefix: 'office',
  },
  thing: {
    list: 'list',
    listType: 'things',
    item: 'item',
    name: 'name',
    idPrefix: 'thing',
  },
};

/** Mention tag name → entity kind. */
export const TAG_TO_KIND: Record<string, EntityKind> = {
  persName: 'person',
  placeName: 'place',
  orgName: 'org',
  title: 'work',
  bibl: 'work',
  roleName: 'office',
  rs: 'thing',
};

const ID_WIDTH = 6;

export interface AuthorityId {
  /** Canonical type, e.g. CBDB, Wikidata, VIAF, DILA, CHGIS, GeoNames. */
  type: string;
  value: string;
}

export interface TitlePart {
  text: string;
  ref?: string;
}

export interface NobleTitleRecord {
  /** Dynasty or court affiliation for the title. */
  dynasty?: string;
  /** Authority id for the confirmed title combination, when available. */
  ref?: string;
  /** Provenance for the stored relation (e.g. source doc or auto-tag pass). */
  resp?: string;
  /** Optional source label / document id for the stored relation. */
  source?: string;
  /** Optional assertion timestamp. */
  when?: string;
  /** Field provenance. Legacy records infer this from resp/source. */
  origin?: EntityValueOrigin;
  placeName: TitlePart;
  roleName: TitlePart;
  posthumousName?: TitlePart;
}

export interface NewEntity {
  /** Surface/display name for the entity. */
  name: string;
  /** xml:lang for the primary name (e.g. "zh-Hant"); omitted = no attribute (legacy behavior). */
  nameLang?: string;
  /** Latin-script name, written as a second name element with xml:lang "<primary>-Latn". */
  romanizedName?: string;
  /** Extra alternative names (e.g. the document surface form), deduped against name/romanizedName. */
  altNames?: { text: string; type?: NameTypeId; lang?: string }[];
  authorityIds?: AuthorityId[];
  /** Stable authority source attached to imported field values. */
  authoritySource?: string;
  /** Optional compact authority-cache payload, stored as a JSON note. */
  cache?: { source: string; data: unknown; when?: string };
  /** Force the provenance used for imported scalar/repeatable fields. */
  importedOrigin?: EntityValueOrigin;
  /** One-line human-written description, stored as `<note type="description">` for later disambiguation. */
  description?: string;
  /** Birth/founding year (signed; negative = BCE). Persons: `<birth when>`; others: `<note type="dates">`. */
  startYear?: number;
  /** Death/dissolution year (signed; negative = BCE). Persons: `<death when>`; others: `<note type="dates">`. */
  endYear?: number;
  /** Historical dynasties/states associated with a person. */
  nationality?: { id: string; canonicalId: string; label: string; sourceIds?: string[] }[];
  /** Repeatable noble-title relations attached to a person entity. */
  nobleTitles?: NobleTitleRecord[];
  /** Source-preserving place-of-origin assertions attached to a person entity. */
  origin?: OriginAssertion[];
  /** Source-scoped CBDB office classification nodes retained by reference. */
  officeTypeIds?: string[];
  /**
   * Per-authority raw values, kept distinct through write instead of collapsed
   * into the single scalar fields above. When present, this supersedes
   * startYear/endYear/nationality/origin/description for person entities so
   * that two authorities asserting different (or the same) values each keep
   * their own provenance-bearing element.
   */
  authorityAssertions?: AuthoritySourcedFields[];
}

/** One authority's raw values for a set of fields, kept distinct through merge/write. */
export interface AuthoritySourcedFields {
  /** Normalized upper-case authority label, e.g. "CBDB", "DILA", "WIKIDATA". */
  source: string;
  startYear?: number;
  endYear?: number;
  /**
   * When true, start/end are real floruit earliest/latest — store as a `dates`
   * row with `start_precision: 'fl.'`, not as birth/death.
   */
  asFloruit?: boolean;
  nationality?: { canonicalId: string; label: string }[];
  origin?: OriginAssertion[];
  description?: string;
}

/** One authority's date fragment, e.g. "260–504", "704–", "fl. 1120". */
function periodFragment(assertion: AuthoritySourcedFields): string | undefined {
  const { startYear, endYear, asFloruit } = assertion;
  if (startYear == null && endYear == null) return undefined;
  const range =
    startYear != null && endYear != null && startYear !== endYear
      ? `${startYear}–${endYear}`
      : startYear != null && endYear != null
        ? `${startYear}`
        : startYear != null
          ? `${startYear}–`
          : `–${endYear}`;
  return asFloruit ? `fl. ${range}` : range;
}

/**
 * Derive a "SOURCE: period; SOURCE: period" display line from per-authority
 * assertions (§4 of docs/placename-geo-disambiguation-planning.md) — each
 * source's own period fragment is kept verbatim and tagged by source, never
 * unioned into one fact. Purely presentational: never written back as
 * `startYear`/`endYear`, only ever offered as a fallback `description`.
 */
export function mergedPeriodDisplay(
  assertions: AuthoritySourcedFields[] | undefined,
): string | undefined {
  if (!assertions?.length) return undefined;
  const parts = assertions
    .map((assertion) => {
      const fragment = periodFragment(assertion);
      return fragment ? `${assertion.source}: ${fragment}` : undefined;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join('; ') : undefined;
}

/** Format a signed year as an ISO/W3C `@when` year, e.g. -155 -> "-0155", 1990 -> "1990". */
export function isoYearString(year: number): string {
  const abs = String(Math.abs(year)).padStart(4, '0');
  return year < 0 ? `-${abs}` : abs;
}

/** Parse an ISO `@when` year back to a signed number, tolerating full dates ("1990-01-01"). */
export function parseIsoYear(when: string | null | undefined): number | null {
  if (!when) return null;
  const match = when.trim().match(/^(-?\d{1,4})(?:-|$)/);
  return match ? parseInt(match[1]!, 10) : null;
}

/** A random UUID (v4 when available), used for database fingerprints and entity ids. */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}`;
}

/** Mint a new database fingerprint id. */
export function newDatabaseId(): string {
  return randomUuid();
}

/**
 * Mint a fresh, collision-safe entity id: kind prefix + UUID
 * (e.g. `person-a1b2c3d4-…`). Kind-prefixing keeps the id a legal `xml:id`
 * (an NCName must not start with a digit) and human-debuggable. Used for both
 * central and project databases so two machines never mint the same id for
 * different people. Sequential ids minted by earlier versions are grandfathered
 * (see `nextEntityId`), not rewritten.
 */
export function mintEntityId(kind: EntityKind): string {
  return `${ENTITY_KINDS[kind].idPrefix}-${randomUuid()}`;
}

/** An empty entity file: TEI standoff with the four core lists. */
export function createEntitiesScaffold(databaseId: string = newDatabaseId()): string {
  const lists = Object.values(ENTITY_KINDS)
    .map((k) => `<${k.list}${k.listType ? ` type="${k.listType}"` : ''}/>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="${TEI_NS}">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Entity database</title></titleStmt>
      <publicationStmt>
        <p>Generated by Grognard.</p>
        <idno type="${DATABASE_IDNO_TYPE}">${databaseId}</idno>
      </publicationStmt>
      <sourceDesc><p>Entity authority file.</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <standOff>
      ${lists}
  </standOff>
</TEI>`;
}

const parser = () => new DOMParser();

export function parseEntities(xml: string): Document {
  return parser().parseFromString(xml, 'application/xml');
}

export function serializeEntities(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

/** Read the database fingerprint from the TEI header. */
export function getDatabaseId(doc: Document): string | null {
  const idnos = doc.getElementsByTagName('idno');
  for (let i = 0; i < idnos.length; i++) {
    const el = idnos.item(i);
    if (el?.getAttribute('type') === DATABASE_IDNO_TYPE) {
      return el.textContent?.trim() || null;
    }
  }
  return null;
}

/** True when the document is a valid Grognard entity database file. */
export function isEntityDatabase(doc: Document): boolean {
  if (!doc.documentElement || doc.documentElement.localName !== 'TEI') return false;
  if (!doc.getElementsByTagName('standOff')[0]) return false;
  return Boolean(getDatabaseId(doc));
}

/** Every xml:id currently in the document. */
function allIds(doc: Document): Set<string> {
  const ids = new Set<string>();
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  for (
    let node = walker.currentNode as Element | null;
    node;
    node = walker.nextNode() as Element | null
  ) {
    const id = node.getAttribute('xml:id');
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Next unused id for a kind: scan existing ids of that type, take the highest
 * suffix + 1, and skip any id already present (collision-safe). Ids are never
 * derived from names.
 */
export function nextEntityId(doc: Document, kind: EntityKind): string {
  const { idPrefix } = ENTITY_KINDS[kind];
  const ids = allIds(doc);
  const re = new RegExp(`^${idPrefix}-(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const match = re.exec(id);
    if (match) max = Math.max(max, parseInt(match[1]!, 10));
  }
  let next = max + 1;
  let candidate = `${idPrefix}-${String(next).padStart(ID_WIDTH, '0')}`;
  while (ids.has(candidate)) {
    next += 1;
    candidate = `${idPrefix}-${String(next).padStart(ID_WIDTH, '0')}`;
  }
  return candidate;
}

/** The `<note type="grognard-changed">` child of an entity item, if present. */
function changedNote(item: Element): Element | null {
  for (const child of Array.from(item.children)) {
    if (child.localName === 'note' && child.getAttribute('type') === CHANGED_NOTE_TYPE) {
      return child;
    }
  }
  return null;
}

/** Read an entity element's last-modified ISO timestamp, or null when unstamped. */
export function getEntityChanged(item: Element): string | null {
  return changedNote(item)?.getAttribute('when')?.trim() || null;
}

/**
 * Stamp an entity element's last-modified timestamp (default: now), creating or
 * updating its `<note type="grognard-changed" when="…"/>`. The note is kept last so
 * it never displaces the first description/cache/dates note that other code
 * reads via `getElementsByTagName('note')[0]`.
 */
export function touchEntity(item: Element, when: string = new Date().toISOString()): void {
  const existing = changedNote(item);
  if (existing) {
    existing.setAttribute('when', when);
    return;
  }
  const note = item.ownerDocument.createElementNS(TEI_NS, 'note');
  note.setAttribute('type', CHANGED_NOTE_TYPE);
  note.setAttribute('when', when);
  item.appendChild(note);
}

/** Add or replace the authority-cache payload for an existing entity/source. */
export function setAuthorityCache(
  doc: Document,
  entityId: string,
  source: string,
  data: unknown,
  when: string = new Date().toISOString(),
): void {
  const item = findEntity(doc, entityId);
  if (!item) return;
  const existing = Array.from(item.children).find(
    (child) =>
      child.localName === 'note' &&
      child.getAttribute('type') === 'authority-cache' &&
      child.getAttribute('source') === source,
  );
  const note = existing ?? doc.createElementNS(TEI_NS, 'note');
  note.setAttribute('type', 'authority-cache');
  note.setAttribute('source', source);
  note.setAttribute('resp', GROGNARD_RESP);
  note.setAttribute('when', when);
  note.textContent = JSON.stringify(data);
  if (!existing) item.appendChild(note);
}

/**
 * Stamp every entity that has no `changed` timestamp yet (default: now), so
 * records minted before this feature get a baseline for CEDB↔PEDB sync. Returns
 * how many were stamped.
 */
export function backfillEntityTimestamps(
  doc: Document,
  when: string = new Date().toISOString(),
): number {
  let count = 0;
  for (const kind of Object.keys(ENTITY_KINDS) as EntityKind[]) {
    for (const item of entityElements(doc, kind)) {
      if (!getEntityChanged(item)) {
        touchEntity(item, when);
        count += 1;
      }
    }
  }
  return count;
}

function listMatchesKind(list: Element, kind: EntityKind): boolean {
  const config = ENTITY_KINDS[kind];
  if (list.localName !== config.list) return false;
  const type = list.getAttribute('type');
  return config.listType ? type === config.listType : !type;
}

export function entityElementMatchesKind(item: Element, kind: EntityKind): boolean {
  const config = ENTITY_KINDS[kind];
  if (item.localName !== config.item) return false;
  const type = item.getAttribute('type');
  return config.itemType ? type === config.itemType : type !== 'office';
}

export function entityKindOfElement(item: Element): EntityKind | null {
  for (const kind of Object.keys(ENTITY_KINDS) as EntityKind[]) {
    if (entityElementMatchesKind(item, kind)) return kind;
  }
  return null;
}

/** Direct entity children in the kind-specific TEI list. */
export function entityElements(doc: Document, kind: EntityKind): Element[] {
  const config = ENTITY_KINDS[kind];
  const lists = Array.from(doc.getElementsByTagName(config.list)).filter((list) =>
    listMatchesKind(list, kind),
  );
  return lists.flatMap((list) =>
    Array.from(list.children).filter((item) => entityElementMatchesKind(item, kind)),
  );
}

/**
 * Once found or created, a kind's list element never changes identity for the
 * life of the document (it's appended to, never replaced) — cache it instead
 * of re-running `getElementsByTagName` (a full-document scan) on every single
 * `addEntity` call. `addEntity` is the hot path for any bulk add (bulk-bridge
 * import, bulk promote), where this was an O(n²) cost hiding one level below
 * the callers that already build their own id/authority indexes.
 */
const entityListCache = new WeakMap<Document, Map<EntityKind, Element>>();

/** Get (creating if needed) the list element for a kind. */
export function getEntityList(doc: Document, kind: EntityKind): Element {
  let cached = entityListCache.get(doc);
  if (!cached) {
    cached = new Map();
    entityListCache.set(doc, cached);
  }
  const existingCached = cached.get(kind);
  if (existingCached) return existingCached;

  const config = ENTITY_KINDS[kind];
  const existing = Array.from(doc.getElementsByTagName(config.list)).find((list) =>
    listMatchesKind(list, kind),
  );
  if (existing) {
    cached.set(kind, existing);
    return existing;
  }
  const standOff = doc.getElementsByTagName('standOff')[0] ?? doc.documentElement;
  const el = doc.createElementNS(TEI_NS, config.list);
  if (config.listType) el.setAttribute('type', config.listType);
  standOff.appendChild(el);
  cached.set(kind, el);
  return el;
}

/**
 * Add an entity to the file and return its new local id. `resp` marks
 * provenance (e.g. "#grognard-autotag" for machine auto-resolution).
 */
export function addEntity(
  doc: Document,
  kind: EntityKind,
  entity: NewEntity,
  resp?: string,
): { id: string; element: Element } {
  const config = ENTITY_KINDS[kind];
  const id = mintEntityId(kind);

  const item = doc.createElementNS(TEI_NS, config.item);
  item.setAttributeNS(XML_NS, 'xml:id', id);
  if (config.itemType) item.setAttribute('type', config.itemType);
  if (resp) item.setAttribute('resp', resp);
  const importedOrigin =
    entity.importedOrigin ??
    (entity.authorityIds?.length || entity.cache || entity.authoritySource
      ? 'authority'
      : resp === GROGNARD_AUTOTAG_RESP || resp === LEAFWRITER_AUTOTAG_RESP
        ? 'authority'
        : 'user');
  const importedSource =
    (entity.authoritySource ?? entity.authorityIds?.[0]?.type ?? null)?.toUpperCase() ?? null;

  const name = doc.createElementNS(TEI_NS, config.name);
  name.textContent = entity.name;
  if (entity.nameLang) {
    name.setAttributeNS(XML_NS, 'xml:lang', entity.nameLang);
    name.setAttribute('type', 'primary');
  }
  writeEntityValueProvenance(name, {
    origin: importedOrigin,
    source: importedOrigin === 'authority' ? importedSource : null,
  });
  item.appendChild(name);

  const writtenNames = new Set<string>([entity.name.normalize('NFC').trim()]);

  const romanized = entity.romanizedName?.normalize('NFC').trim();
  if (romanized && !writtenNames.has(romanized)) {
    const el = doc.createElementNS(TEI_NS, config.name);
    el.textContent = romanized;
    el.setAttributeNS(XML_NS, 'xml:lang', latnLangFor(entity.nameLang));
    writeEntityValueProvenance(el, {
      origin: importedOrigin,
      source: importedOrigin === 'authority' ? importedSource : null,
    });
    item.appendChild(el);
    writtenNames.add(romanized);
  }

  for (const alt of entity.altNames ?? []) {
    const text = alt.text.normalize('NFC').trim();
    if (!text || writtenNames.has(text)) continue;
    const el = doc.createElementNS(TEI_NS, config.name);
    el.textContent = text;
    if (alt.type) el.setAttribute('type', alt.type);
    if (alt.lang) el.setAttributeNS(XML_NS, 'xml:lang', alt.lang);
    writeEntityValueProvenance(el, {
      origin: importedOrigin,
      source: importedOrigin === 'authority' ? importedSource : null,
    });
    item.appendChild(el);
    writtenNames.add(text);
  }

  for (const authority of entity.authorityIds ?? []) {
    const idno = doc.createElementNS(TEI_NS, 'idno');
    idno.setAttribute('type', authority.type);
    idno.textContent = authority.value;
    writeEntityValueProvenance(idno, {
      origin: 'authority',
      source: `${authority.type}:${authority.value}`,
    });
    item.appendChild(idno);
  }

  if (entity.cache) {
    const note = doc.createElementNS(TEI_NS, 'note');
    note.setAttribute('type', 'authority-cache');
    note.setAttribute('source', entity.cache.source);
    note.setAttribute('resp', GROGNARD_RESP);
    note.setAttribute('when', entity.cache.when ?? new Date().toISOString());
    note.textContent = JSON.stringify(entity.cache.data);
    writeEntityValueProvenance(note, { origin: 'authority', source: entity.cache.source });
    item.appendChild(note);
  }

  if (entity.description && !entity.authorityAssertions?.length) {
    const note = doc.createElementNS(TEI_NS, 'note');
    note.setAttribute('type', 'description');
    note.textContent = entity.description;
    writeEntityValueProvenance(note, {
      origin: importedOrigin,
      source: importedOrigin === 'authority' ? importedSource : null,
    });
    item.appendChild(note);
  }

  if (kind === 'person' && entity.authorityAssertions?.length) {
    for (const assertion of entity.authorityAssertions) {
      if (assertion.nationality?.length) {
        appendAuthoritySourcedValues(
          doc,
          item,
          'nationality',
          assertion.nationality.map((value) => ({
            text: value.label,
            ref: value.canonicalId,
            source: assertion.source,
          })),
        );
      }
      if (assertion.origin?.length) {
        appendAuthoritySourcedValues(
          doc,
          item,
          'placeName',
          assertion.origin.map((value) => ({
            text: value.placeName,
            ref: value.placeAuthorityId,
            source: value.source ?? assertion.source,
          })),
        );
      }
      if (assertion.description?.trim()) {
        appendAuthoritySourcedValues(doc, item, 'note', [
          {
            text: assertion.description.trim(),
            noteType: 'description',
            source: assertion.source,
          },
        ]);
      }
    }
  } else if (kind === 'person') {
    for (const value of entity.nationality ?? []) {
      const nationality = value.label.trim();
      if (!nationality) continue;
      const el = doc.createElementNS(TEI_NS, 'nationality');
      el.textContent = nationality;
      el.setAttribute('ref', value.canonicalId);
      writeEntityValueProvenance(el, {
        origin: value.sourceIds?.length ? 'authority' : 'user',
        source:
          value.sourceIds?.length || importedOrigin === 'authority'
            ? (value.sourceIds?.[0] ?? importedSource)
            : entity.authoritySource,
      });
      item.appendChild(el);
    }

    for (const origin of entity.origin ?? []) {
      const place = origin.placeName?.trim();
      if (!place) continue;
      const el = doc.createElementNS(TEI_NS, 'placeName');
      if (origin.placeAuthorityId) el.setAttribute('ref', origin.placeAuthorityId);
      el.textContent = place;
      writeEntityValueProvenance(el, {
        origin: importedOrigin,
        source: importedOrigin === 'authority' ? (origin.source ?? importedSource) : origin.source,
      });
      item.appendChild(el);
    }
  }

  if (kind === 'person') {
    const writtenTitles = new Set<string>();
    for (const title of entity.nobleTitles ?? []) {
      const placeText = title.placeName.text.normalize('NFC').trim();
      const roleText = title.roleName.text.normalize('NFC').trim();
      const posthumousText = title.posthumousName?.text.normalize('NFC').trim() || '';
      const hasTitleData =
        Boolean(title.ref || title.resp || title.source || title.when) ||
        Boolean(title.placeName.ref || placeText) ||
        Boolean(title.roleName.ref || roleText) ||
        Boolean(title.posthumousName?.ref || posthumousText);
      if (!hasTitleData) continue;
      const dedupeKey = [
        title.ref ?? '',
        title.resp ?? '',
        title.source ?? '',
        title.when ?? '',
        title.placeName.ref ?? '',
        placeText,
        title.roleName.ref ?? '',
        roleText,
        title.posthumousName?.ref ?? '',
        posthumousText,
      ].join('\u001f');
      if (writtenTitles.has(dedupeKey)) continue;

      const nobleTitle = doc.createElementNS(TEI_NS, 'nobleTitle');
      if (title.dynasty?.trim()) nobleTitle.setAttribute('dynasty', title.dynasty.trim());
      if (title.ref) nobleTitle.setAttribute('ref', title.ref);
      if (title.resp) nobleTitle.setAttribute('resp', title.resp);
      if (title.source) nobleTitle.setAttribute('source', title.source);
      if (title.when) nobleTitle.setAttribute('when', title.when);
      writeEntityValueProvenance(nobleTitle, {
        origin: title.origin ?? (title.source?.startsWith('xml:') ? 'xml' : 'authority'),
        source: title.source,
      });

      const placeName = doc.createElementNS(TEI_NS, 'placeName');
      if (title.placeName.ref) placeName.setAttribute('ref', title.placeName.ref);
      placeName.textContent = placeText;
      nobleTitle.appendChild(placeName);

      const roleName = doc.createElementNS(TEI_NS, 'roleName');
      if (title.roleName.ref) roleName.setAttribute('ref', title.roleName.ref);
      roleName.textContent = roleText;
      nobleTitle.appendChild(roleName);

      if (title.posthumousName) {
        const posthumousName = doc.createElementNS(TEI_NS, 'persName');
        posthumousName.setAttribute('type', 'posthumous');
        if (title.posthumousName.ref) posthumousName.setAttribute('ref', title.posthumousName.ref);
        posthumousName.textContent = posthumousText;
        nobleTitle.appendChild(posthumousName);
      }

      item.appendChild(nobleTitle);
      writtenTitles.add(dedupeKey);
    }
  }

  if (kind === 'office') {
    for (const officeTypeId of entity.officeTypeIds ?? []) {
      const state = doc.createElementNS(TEI_NS, 'state');
      state.setAttribute('type', 'office-classification');
      state.setAttribute('ref', officeTypeId);
      item.appendChild(state);
    }
  }

  const hasAuthorityDates = entity.authorityAssertions?.some(
    (assertion) => assertion.startYear != null || assertion.endYear != null,
  );
  if (kind === 'person' && entity.authorityAssertions?.length) {
    for (const assertion of entity.authorityAssertions) {
      appendAuthorityDates(doc, item, assertion.source, {
        startYear: assertion.startYear,
        endYear: assertion.endYear,
      });
    }
  }
  if (
    (entity.startYear != null || entity.endYear != null) &&
    !(kind === 'person' && hasAuthorityDates)
  ) {
    if (kind === 'person') {
      if (entity.startYear != null) {
        const birth = doc.createElementNS(TEI_NS, 'birth');
        birth.setAttribute('when', isoYearString(entity.startYear));
        writeEntityValueProvenance(birth, {
          origin: importedOrigin,
          source: importedOrigin === 'authority' ? importedSource : null,
        });
        item.appendChild(birth);
      }
      if (entity.endYear != null) {
        const death = doc.createElementNS(TEI_NS, 'death');
        death.setAttribute('when', isoYearString(entity.endYear));
        writeEntityValueProvenance(death, {
          origin: importedOrigin,
          source: importedOrigin === 'authority' ? importedSource : null,
        });
        item.appendChild(death);
      }
    } else {
      // place/org/work have no birth/death in TEI — keep the years queryable in a typed note.
      const note = doc.createElementNS(TEI_NS, 'note');
      note.setAttribute('type', 'dates');
      note.textContent = [
        entity.startYear != null ? isoYearString(entity.startYear) : '',
        entity.endYear != null ? isoYearString(entity.endYear) : '',
      ].join('/');
      writeEntityValueProvenance(note, {
        origin: importedOrigin,
        source: importedOrigin === 'authority' ? importedSource : null,
      });
      item.appendChild(note);
    }
  }

  touchEntity(item);
  getEntityList(doc, kind).appendChild(item);
  return { id, element: item };
}

export interface NewOfficeRelation {
  parentId: string;
  childId: string;
  source: string;
  rule: string;
  sourceIds?: string[];
  confidence?: 'asserted' | 'inferred';
}

export interface OfficeRelationRecord extends NewOfficeRelation {
  element: Element;
}

function officeRelationList(doc: Document): Element {
  const existing = Array.from(doc.getElementsByTagName('listRelation')).find(
    (list) => list.getAttribute('type') === 'office-hierarchy',
  );
  if (existing) return existing;
  const standOff = doc.getElementsByTagName('standOff')[0] ?? doc.documentElement;
  const list = doc.createElementNS(TEI_NS, 'listRelation');
  list.setAttribute('type', 'office-hierarchy');
  standOff.appendChild(list);
  return list;
}

const relationTarget = (value: string | null) => value?.replace(/^#/, '') ?? '';

export function readOfficeRelations(doc: Document): OfficeRelationRecord[] {
  const list = Array.from(doc.getElementsByTagName('listRelation')).find(
    (candidate) => candidate.getAttribute('type') === 'office-hierarchy',
  );
  if (!list) return [];
  return Array.from(list.children)
    .filter(
      (element) => element.localName === 'relation' && element.getAttribute('name') === 'parentOf',
    )
    .map((element) => ({
      parentId: relationTarget(element.getAttribute('active')),
      childId: relationTarget(element.getAttribute('passive')),
      source: element.getAttribute('resp')?.replace(/^#/, '') ?? '',
      rule: element.getAttribute('ana') ?? '',
      sourceIds: (element.getAttribute('corresp') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((value) => decodeURIComponent(value.slice(value.lastIndexOf(':') + 1))),
      confidence: element.getAttribute('cert') === 'high' ? 'asserted' : 'inferred',
      element,
    }));
}

/** Add a deduplicated, provenance-bearing office hierarchy assertion. */
export function addOfficeRelation(
  doc: Document,
  relation: NewOfficeRelation,
): { created: boolean; element: Element } {
  const existing = readOfficeRelations(doc).find(
    (row) =>
      row.parentId === relation.parentId &&
      row.childId === relation.childId &&
      row.source === relation.source &&
      row.rule === relation.rule,
  );
  if (existing) return { created: false, element: existing.element };

  const element = doc.createElementNS(TEI_NS, 'relation');
  element.setAttribute('name', 'parentOf');
  element.setAttribute('active', `#${relation.parentId}`);
  element.setAttribute('passive', `#${relation.childId}`);
  element.setAttribute('resp', `#${relation.source}`);
  element.setAttribute('ana', relation.rule);
  element.setAttribute('cert', relation.confidence === 'asserted' ? 'high' : 'low');
  if (relation.sourceIds?.length) {
    element.setAttribute(
      'corresp',
      relation.sourceIds
        .map(
          (id) =>
            `urn:grognard:authority:${encodeURIComponent(relation.source)}:${encodeURIComponent(id)}`,
        )
        .join(' '),
    );
  }
  officeRelationList(doc).appendChild(element);
  return { created: true, element };
}

/** Append authority `<idno>`s to an existing entity element. */
export function appendAuthorityIdnos(doc: Document, element: Element, ids: AuthorityId[]): void {
  if (ids.length === 0) return;
  for (const authority of ids) {
    const idno = doc.createElementNS(TEI_NS, 'idno');
    idno.setAttribute('type', authority.type);
    idno.textContent = authority.value;
    element.appendChild(idno);
  }
  touchEntity(element);
}

/**
 * Append person nationality labels without duplicating a value already
 * asserted by the same source. A second source asserting the same
 * nationality still gets its own element, so its badge isn't lost.
 */
export function appendNationalities(
  doc: Document,
  element: Element,
  values: { id: string; canonicalId: string; label: string; sourceIds?: string[] }[],
): void {
  const nationalityKey = (ref: string | null, source: string | null) =>
    `${source ?? ''}${ref ?? ''}`;
  const existing = new Set(
    Array.from(element.getElementsByTagName('nationality')).map((el) =>
      nationalityKey(
        el.getAttribute('ref') || el.textContent?.trim() || null,
        readEntityValueProvenance(el).source,
      ),
    ),
  );
  for (const value of values) {
    const label = value.label.trim();
    if (!label) continue;
    const source = value.sourceIds?.[0] ?? null;
    const key = nationalityKey(value.canonicalId, source);
    if (existing.has(key)) continue;
    const el = doc.createElementNS(TEI_NS, 'nationality');
    el.textContent = label;
    el.setAttribute('ref', value.canonicalId);
    writeEntityValueProvenance(el, {
      origin: value.sourceIds?.length ? 'authority' : 'user',
      source,
    });
    element.appendChild(el);
    existing.add(key);
  }
}

/** Append or refresh a person's authority-backed birth/death assertions. */
export function appendAuthorityDates(
  doc: Document,
  element: Element,
  source: string,
  dates: { startYear?: number; endYear?: number },
): boolean {
  const normalizedSource = source.trim().toUpperCase();
  let changed = false;
  const write = (tag: 'birth' | 'death', year: number | undefined) => {
    if (year == null) return;
    const existing = Array.from(element.children).filter(
      (child) =>
        child.localName === tag &&
        readEntityValueProvenance(child).origin === 'authority' &&
        readEntityValueProvenance(child).source === normalizedSource,
    );
    const exact = existing.find((child) => parseIsoYear(child.getAttribute('when')) === year);
    if (exact) {
      writeEntityValueProvenance(exact, { origin: 'authority', source: normalizedSource });
      return;
    }
    for (const child of existing) child.remove();
    const el = doc.createElementNS(TEI_NS, tag);
    el.setAttribute('when', isoYearString(year));
    writeEntityValueProvenance(el, { origin: 'authority', source: normalizedSource });
    element.appendChild(el);
    changed = true;
  };
  write('birth', dates.startYear);
  write('death', dates.endYear);
  if (changed) touchEntity(element);
  return changed;
}

/**
 * Append repeatable authority-sourced child elements (nationality, placeName,
 * note[type=description]) without dropping values already asserted by other
 * sources. Dedupes only on (tag, source, ref‖text, noteType) so two
 * authorities can each contribute their own row for the same tag, and
 * refreshing a source doesn't re-duplicate a value it already asserted.
 */
export function appendAuthoritySourcedValues(
  doc: Document,
  element: Element,
  tag: 'nationality' | 'placeName' | 'note' | 'affiliation',
  values: { text: string; ref?: string; source: string; noteType?: string; type?: string }[],
): boolean {
  let changed = false;
  const keyOf = (child: Element) => {
    const provenance = readEntityValueProvenance(child);
    const identity = child.getAttribute('ref') || child.textContent?.trim() || '';
    const noteType = tag === 'note' ? (child.getAttribute('type') ?? '') : '';
    return `${(provenance.source ?? '').trim().toUpperCase()}${identity}${noteType}`;
  };
  const existing = new Set(
    Array.from(element.children)
      .filter((child) => child.localName === tag)
      .map(keyOf),
  );
  for (const value of values) {
    const text = value.text.trim();
    if (!text) continue;
    const normalizedSource = value.source.trim().toUpperCase();
    const identity = value.ref || text;
    const noteType = tag === 'note' ? (value.noteType ?? '') : '';
    const key = `${normalizedSource}${identity}${noteType}`;
    if (existing.has(key)) continue;
    const el = doc.createElementNS(TEI_NS, tag);
    el.textContent = text;
    if (value.ref) el.setAttribute('ref', value.ref);
    if (tag === 'placeName' && value.type) el.setAttribute('type', value.type);
    if (tag === 'note' && value.noteType) el.setAttribute('type', value.noteType);
    writeEntityValueProvenance(el, { origin: 'authority', source: normalizedSource });
    element.appendChild(el);
    existing.add(key);
    changed = true;
  }
  if (changed) touchEntity(element);
  return changed;
}

/**
 * Append confirmed noble-title relations from an authority (e.g. Norbert's
 * `person_nt`) without dropping titles already asserted by another source or
 * user. Dedupes by `ref` when the authority provides a stable id for the
 * title row, else by the (placeName, roleName, posthumousName) text tuple,
 * so re-running a backfill never re-adds the same title twice.
 */
export function appendAuthorityNobleTitles(
  doc: Document,
  item: Element,
  titles: {
    placeName: string;
    roleName: string;
    posthumousName?: string;
    dynasty?: string;
    ref?: string;
    source: string;
  }[],
): boolean {
  let changed = false;
  const textOf = (child: Element, name: string, predicate?: (el: Element) => boolean) =>
    Array.from(child.children)
      .find((part) => part.localName === name && (!predicate || predicate(part)))
      ?.textContent?.trim() ?? '';
  const keyOf = (child: Element) =>
    child.getAttribute('ref') ||
    [
      textOf(child, 'placeName'),
      textOf(child, 'roleName'),
      textOf(child, 'persName', (part) => part.getAttribute('type') === 'posthumous'),
    ].join('');
  const existing = new Set(
    Array.from(item.children)
      .filter((child) => child.localName === 'nobleTitle')
      .map(keyOf),
  );
  for (const title of titles) {
    const place = title.placeName.trim();
    const role = title.roleName.trim();
    if (!place && !role) continue;
    const posthumous = title.posthumousName?.trim() ?? '';
    const key = title.ref || [place, role, posthumous].join('');
    if (existing.has(key)) continue;

    const nobleTitle = doc.createElementNS(TEI_NS, 'nobleTitle');
    if (title.dynasty?.trim()) nobleTitle.setAttribute('dynasty', title.dynasty.trim());
    if (title.ref) nobleTitle.setAttribute('ref', title.ref);
    writeEntityValueProvenance(nobleTitle, { origin: 'authority', source: title.source });

    const placeEl = doc.createElementNS(TEI_NS, 'placeName');
    placeEl.textContent = place;
    nobleTitle.appendChild(placeEl);

    const roleEl = doc.createElementNS(TEI_NS, 'roleName');
    roleEl.textContent = role;
    nobleTitle.appendChild(roleEl);

    if (posthumous) {
      const posthumousEl = doc.createElementNS(TEI_NS, 'persName');
      posthumousEl.setAttribute('type', 'posthumous');
      posthumousEl.textContent = posthumous;
      nobleTitle.appendChild(posthumousEl);
    }

    item.appendChild(nobleTitle);
    existing.add(key);
    changed = true;
  }
  if (changed) touchEntity(item);
  return changed;
}

/**
 * Find an entity element by its local id.
 *
 * `index` lets a caller that's resolving many ids against the same
 * unmutated-in-structure document (e.g. a bulk merge) supply a pre-built
 * `id -> element` map instead of paying for a fresh `TreeWalker` scan of the
 * whole document on every call — the naive per-call scan is O(n) and turns
 * loops over every entity in a large database into O(n²).
 */
export function findEntity(
  doc: Document,
  id: string,
  index?: ReadonlyMap<string, Element>,
): Element | null {
  if (index) return index.get(id) ?? null;
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  for (
    let node = walker.currentNode as Element | null;
    node;
    node = walker.nextNode() as Element | null
  ) {
    if (node.getAttribute('xml:id') === id) return node;
  }
  return null;
}
