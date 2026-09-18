import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { getDatabaseId } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import type { EntityDbBackend } from './backend';
import {
  EntitySqliteRepository,
  type SqliteEntityKind,
  type DecisionTargetBackfillEntry,
  type DecisionTargetBackfillReport,
} from './repository';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const ENTITY_KINDS: Record<
  SqliteEntityKind,
  { list: string; item: string; name: string; type?: string }
> = {
  person: { list: 'listPerson', item: 'person', name: 'persName' },
  place: { list: 'listPlace', item: 'place', name: 'placeName' },
  org: { list: 'listOrg', item: 'org', name: 'orgName' },
  office: { list: 'listOrg', item: 'org', name: 'orgName', type: 'offices' },
  work: { list: 'listBibl', item: 'bibl', name: 'title' },
  thing: { list: 'list', item: 'item', name: 'name', type: 'things' },
};

export interface XmlImportReport {
  databaseId: string;
  entitiesImported: number;
  namesImported: number;
  authoritiesImported: number;
  fragmentsPreserved: number;
  duplicateEntityIds: string[];
  unresolvedReferences: string[];
  warnings: string[];
}

export interface XmlExportOptions {
  databaseId?: string;
}

interface XmlElement {
  nodeType: number;
  localName?: string;
  nodeName?: string;
  childNodes: { length: number; item(index: number): XmlElement | null };
  textContent: string | null;
  attributes?: { length: number; item(index: number): { name: string; value: string } | null };
  getAttribute(name: string): string;
  getAttributeNS?(namespace: string, localName: string): string;
}

const childElements = (element: XmlElement): XmlElement[] => {
  const out: XmlElement[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) out.push(child);
  }
  return out;
};

const localName = (element: XmlElement): string =>
  element.localName ?? element.nodeName?.split(':').pop() ?? '';

const text = (element: XmlElement | null | undefined): string =>
  (element?.textContent ?? '').trim();

const attr = (element: XmlElement, name: string): string | null => {
  const direct = element.getAttribute(name);
  if (direct) return direct;
  if (name === 'xml:lang' && element.getAttributeNS) {
    return element.getAttributeNS(XML_NS, 'lang') || null;
  }
  return null;
};

const timestamp = (item: XmlElement): string => {
  const changed = childElements(item).find(
    (child) => localName(child) === 'note' && child.getAttribute('type') === 'grognard-changed',
  );
  return changed?.getAttribute('when') || new Date().toISOString();
};

const provenance = (
  element: XmlElement,
  defaultOrigin: 'user' | 'authority' | 'xml',
): {
  origin: 'user' | 'authority' | 'xml';
  source: string | null;
  status: 'active' | 'rejected' | 'withdrawn';
} => ({
  origin: (element.getAttribute('origin') as 'user' | 'authority' | 'xml') || defaultOrigin,
  source: element.getAttribute('source') || element.getAttribute('resp') || null,
  status: (element.getAttribute('status') as 'active' | 'rejected' | 'withdrawn') || 'active',
});

const year = (value: string | null): number | null => {
  const match = value?.match(/^-?\d{1,4}/);
  return match ? Number(match[0]) : null;
};

const booleanAttribute = (element: XmlElement, ...names: string[]): number =>
  names.some((name) =>
    ['true', '1', 'yes', 'ca', 'circa', 'ca.'].includes(element.getAttribute(name).toLowerCase()),
  )
    ? 1
    : 0;

const circaAttribute = (element: XmlElement, side: 'from' | 'to'): number =>
  booleanAttribute(element, `${side}Circa`, 'circa') ||
  ['ca', 'ca.', 'circa'].includes(
    element.getAttribute(side === 'from' ? 'fromPrecision' : 'toPrecision') ||
      element.getAttribute('precision'),
  )
    ? 1
    : 0;

const dateSystem = (element: XmlElement): string =>
  element.getAttribute('dateSystem') || element.getAttribute('calendar') || 'gregorian';

const xmlEscape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const attrEscape = (value: string): string =>
  xmlEscape(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const tagForKind = (kind: SqliteEntityKind): string => ENTITY_KINDS[kind].name;

const kindForList = (list: XmlElement): SqliteEntityKind | null => {
  const name = localName(list);
  if (name === 'listPerson') return 'person';
  if (name === 'listPlace') return 'place';
  if (name === 'listBibl') return 'work';
  if (name === 'listOrg') return list.getAttribute('type') === 'offices' ? 'office' : 'org';
  if (name === 'list') return list.getAttribute('type') === 'things' ? 'thing' : null;
  return null;
};

const serializeChild = (element: XmlElement): string =>
  new XMLSerializer().serializeToString(element as never);

async function insertSubtype(
  db: EntityDbBackend,
  kind: SqliteEntityKind,
  id: string,
): Promise<void> {
  const tableByKind: Record<SqliteEntityKind, string> = {
    person: 'people',
    place: 'places',
    work: 'works',
    office: 'offices',
    org: 'organizations',
    thing: 'things',
  };
  const table = tableByKind[kind];
  await db.run(`INSERT INTO ${table} (entity_id) VALUES (?)`, [id]);
}

async function insertMetadata(
  db: EntityDbBackend,
  entityId: string,
  key: string,
  value: string,
  item: XmlElement,
  now: string,
): Promise<void> {
  if (!value) return;
  const p = provenance(item, 'xml');
  await db.run(
    `INSERT INTO entity_metadata (entity_id, key, value, origin, source, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entityId, key, value, p.origin, p.source, p.status, now, now],
  );
}

/** Import one legacy TEI entity database into an empty or replacement SQLite repository. */
export async function importEntitiesXml(
  repository: EntitySqliteRepository,
  xml: string,
  options: { replace?: boolean } = {},
): Promise<XmlImportReport> {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as XmlElement;
  const root = document as unknown as {
    documentElement: XmlElement;
    getElementsByTagName(name: string): XmlElement[];
  };
  const databaseId = getDatabaseId(document as unknown as Document) ?? '';
  if (localName(root.documentElement) !== 'TEI' || !databaseId) {
    throw new Error('Not a valid Grognard entity database XML document.');
  }

  const report: XmlImportReport = {
    databaseId,
    entitiesImported: 0,
    namesImported: 0,
    authoritiesImported: 0,
    fragmentsPreserved: 0,
    duplicateEntityIds: [],
    unresolvedReferences: [],
    warnings: [],
  };
  const db = repository.backend;
  const importedEntityIds = new Set<string>();
  await repository.transaction(async () => {
    if (options.replace !== false) {
      await db.exec(`
        DELETE FROM sync_conflicts;
        DELETE FROM sync_state;
        DELETE FROM central_mappings;
        DELETE FROM entity_xml_fragments;
        DELETE FROM entity_extensions;
        DELETE FROM entity_attributes;
        DELETE FROM entity_positions;
        DELETE FROM office_classifications;
        DELETE FROM person_offices;
        DELETE FROM entity_relations;
        DELETE FROM entity_decisions;
        DELETE FROM authority_caches;
        DELETE FROM entity_metadata;
        DELETE FROM entity_provenance;
        DELETE FROM entity_tombstones;
        DELETE FROM work_authors;
        DELETE FROM person_titles;
        DELETE FROM person_origins;
        DELETE FROM person_nationalities;
        DELETE FROM entity_dates;
        DELETE FROM place_locations;
        DELETE FROM entity_authorities;
        DELETE FROM entity_names;
        DELETE FROM offices;
        DELETE FROM organizations;
        DELETE FROM works;
        DELETE FROM places;
        DELETE FROM people;
        DELETE FROM entities;
        DELETE FROM database_metadata;
      `);
    }
    await db.run('INSERT OR REPLACE INTO database_metadata (key, value) VALUES (?, ?)', [
      'database_id',
      databaseId,
    ]);
    const header = childElements(root.documentElement).find(
      (child) => localName(child) === 'teiHeader',
    );
    const headerText = (name: string): string => {
      if (!header) return '';
      const walk = (element: XmlElement): string => {
        if (localName(element) === name) return text(element);
        for (const child of childElements(element)) {
          const found = walk(child);
          if (found) return found;
        }
        return '';
      };
      return walk(header);
    };
    for (const [key, value] of [
      ['title', headerText('title')],
      ['source_description', headerText('sourceDesc')],
    ] as const) {
      if (value)
        await db.run('INSERT OR REPLACE INTO database_metadata (key, value) VALUES (?, ?)', [
          key,
          value,
        ]);
    }

    const standOff = childElements(root.documentElement).find(
      (child) => localName(child) === 'standOff',
    );
    if (!standOff) throw new Error('Entity database has no standOff element.');

    for (const list of childElements(standOff)) {
      const kind = kindForList(list);
      if (!kind) continue;
      for (const item of childElements(list)) {
        if (localName(item) !== ENTITY_KINDS[kind].item) continue;
        const id = attr(item, 'xml:id');
        if (!id) {
          report.warnings.push(`Skipped ${kind} without xml:id.`);
          continue;
        }
        if (importedEntityIds.has(id)) {
          report.duplicateEntityIds.push(id);
          report.warnings.push(`Skipped duplicate entity ID ${id}.`);
          continue;
        }
        importedEntityIds.add(id);
        const now = timestamp(item);
        await db.run(
          `INSERT INTO entities (id, kind, created_at, updated_at, revision)
           VALUES (?, ?, ?, ?, 0)`,
          [id, kind, now, now],
        );
        await insertSubtype(db, kind, id);
        const position = childElements(list).indexOf(item);
        await db.run(
          `INSERT OR REPLACE INTO entity_positions (entity_id, list_kind, position) VALUES (?, ?, ?)`,
          [id, kind, position],
        );
        if (item.attributes) {
          for (
            let attributeIndex = 0;
            attributeIndex < item.attributes.length;
            attributeIndex += 1
          ) {
            const attribute = item.attributes.item(attributeIndex);
            if (!attribute || attribute.name === 'xml:id' || attribute.name === 'type') continue;
            await db.run(
              `INSERT OR REPLACE INTO entity_attributes (entity_id, namespace, name, value) VALUES (?, ?, ?, ?)`,
              [
                id,
                attribute.name.includes(':') ? attribute.name.split(':')[0] : null,
                attribute.name,
                attribute.value,
              ],
            );
          }
        }
        report.entitiesImported += 1;

        let fragmentOrdinal = 0;
        let importedNameCount = 0;
        for (const child of childElements(item)) {
          const childName = localName(child);
          const childText = text(child);
          const p = provenance(child, childName === 'idno' ? 'authority' : 'xml');
          const childNow = now;
          const isName = childName === ENTITY_KINDS[kind].name;
          if (isName && childText) {
            const explicitNameType = child.getAttribute('type') || null;
            const normalizedType =
              explicitNameType === 'familyName'
                ? 'family'
                : explicitNameType === 'givenName'
                  ? 'given'
                  : explicitNameType;
            const lang = attr(child, 'xml:lang');
            if (normalizedType === 'translation' && lang && !/(^|-)Latn($|-)/i.test(lang)) {
              await db.run(
                `INSERT INTO entity_translations
                  (entity_id, text, language, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, childText, lang, p.origin, p.source, p.status, childNow, childNow],
              );
              report.namesImported += 1;
              continue;
            }
            const inferredPrimary = !normalizedType && importedNameCount === 0;
            const nameRole =
              normalizedType === 'primary'
                ? 'primary'
                : normalizedType === 'family' || normalizedType === 'given'
                  ? normalizedType
                  : inferredPrimary
                    ? 'primary'
                    : normalizedType || 'variant';
            await db.run(
              `INSERT INTO entity_names
                (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                childText,
                normalizedType,
                nameRole,
                lang,
                nameRole === 'primary' ? 1 : 0,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            if (
              kind === 'person' &&
              p.status === 'active' &&
              (normalizedType === 'family' || normalizedType === 'given')
            ) {
              const column = normalizedType === 'family' ? 'family_name' : 'given_name';
              await db.run(`UPDATE people SET ${column} = ? WHERE entity_id = ?`, [childText, id]);
            }
            report.namesImported += 1;
            importedNameCount += 1;
            continue;
          }
          if (childName === 'idno' && child.getAttribute('type') === 'grognard-central') {
            const userId = child.getAttribute('subtype');
            if (userId && childText) {
              await db.run(
                `INSERT OR REPLACE INTO central_mappings
                  (project_entity_id, central_entity_id, user_stable_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, childText, userId, childNow, childNow],
              );
            }
            continue;
          }
          if (childName === 'idno' && child.getAttribute('type') !== 'grognard-entity-database') {
            await db.run(
              `INSERT INTO entity_authorities
                (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('type') || 'unknown',
                childText,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            report.authoritiesImported += 1;
            continue;
          }
          if (childName === 'note' && child.getAttribute('type') === 'grognard-changed') continue;
          if (childName === 'note' && child.getAttribute('type') === 'authority-cache') {
            await db.run(
              `INSERT OR REPLACE INTO authority_caches
                (entity_id, authority_type, source, payload_json, retrieved_at, status)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('source') || 'unknown',
                child.getAttribute('source') || null,
                childText || '{}',
                child.getAttribute('when') || null,
                p.status,
              ],
            );
            continue;
          }
          if (
            childName === 'note' &&
            ['duplicate-ok', 'concordance-rejected'].includes(child.getAttribute('type'))
          ) {
            await db.run(
              `INSERT INTO entity_decisions
                (entity_id, decision_type, target_entity_id, target_refs, payload_json, origin, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('type'),
                child.getAttribute('ref')?.replace(/^#/, '') || null,
                child.getAttribute('target') || null,
                childText || null,
                p.origin,
                p.source,
                childNow,
              ],
            );
            continue;
          }
          if (
            childName === 'note' &&
            ['familyName', 'givenName'].includes(child.getAttribute('type'))
          ) {
            const noteType = child.getAttribute('type');
            const nameRole = noteType === 'familyName' ? 'family' : 'given';
            await db.run(
              `INSERT INTO entity_names
                (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
              [
                id,
                childText,
                nameRole,
                nameRole,
                attr(child, 'xml:lang'),
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            if (kind === 'person' && childText && p.status === 'active') {
              const column = nameRole === 'family' ? 'family_name' : 'given_name';
              await db.run(`UPDATE people SET ${column} = ? WHERE entity_id = ?`, [childText, id]);
            }
            report.namesImported += 1;
            continue;
          }
          if (childName === 'note' && child.getAttribute('type') === 'description') {
            await insertMetadata(db, id, 'description', childText, child, childNow);
            await db.run('UPDATE entities SET description = ? WHERE id = ?', [
              childText || null,
              id,
            ]);
            continue;
          }
          if (childName === 'note' && child.getAttribute('type') === 'subtype') {
            await insertMetadata(db, id, 'subtype', childText, child, childNow);
            continue;
          }
          if (childName === 'birth' || childName === 'death') {
            await db.run(
              `INSERT INTO entity_dates
                (entity_id, date_kind, start_year, end_year, when_value, not_before, not_after, from_value, to_value, from_circa, to_circa, date_system, calendar_payload, raw_text, start_precision, end_precision, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                childName,
                year(child.getAttribute('when')),
                null,
                child.getAttribute('when') || null,
                child.getAttribute('notBefore') || null,
                child.getAttribute('notAfter') || null,
                child.getAttribute('from') || null,
                child.getAttribute('to') || null,
                circaAttribute(child, 'from'),
                circaAttribute(child, 'to'),
                dateSystem(child),
                child.getAttribute('calendarPayload') || null,
                childText || null,
                child.getAttribute('precision') || null,
                null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (childName === 'geo') {
            const [latRaw, lonRaw] = (childText ?? '').trim().split(/\s+/);
            const lat = Number(latRaw);
            const lon = Number(lonRaw);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              await db.run(
                `INSERT INTO place_locations
                  (entity_id, latitude, longitude, origin, source, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, lat, lon, p.origin, p.source, p.status, childNow, childNow],
              );
              if (kind === 'place' && p.status === 'active') {
                await db.run(
                  `INSERT INTO places (entity_id, latitude, longitude)
                     VALUES (?, ?, ?)
                   ON CONFLICT(entity_id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude`,
                  [id, lat, lon],
                );
              }
            }
            continue;
          }
          if (
            childName === 'note' &&
            ['dates', 'fl.', 'floruit'].includes(child.getAttribute('type'))
          ) {
            await db.run(
              `INSERT INTO entity_dates
                (entity_id, date_kind, start_year, end_year, when_value, not_before, not_after, from_value, to_value, from_circa, to_circa, date_system, calendar_payload, raw_text, start_precision, end_precision, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('type') === 'dates' ? 'dates' : child.getAttribute('type'),
                year(
                  child.getAttribute('when') ||
                    child.getAttribute('from') ||
                    child.getAttribute('notBefore'),
                ),
                year(child.getAttribute('to') || child.getAttribute('notAfter')),
                child.getAttribute('when') || null,
                child.getAttribute('notBefore') || null,
                child.getAttribute('notAfter') || null,
                child.getAttribute('from') || null,
                child.getAttribute('to') || null,
                circaAttribute(child, 'from'),
                circaAttribute(child, 'to'),
                dateSystem(child),
                child.getAttribute('calendarPayload') || null,
                childText || null,
                child.getAttribute('fromPrecision') || child.getAttribute('precision') || null,
                child.getAttribute('toPrecision') || child.getAttribute('precision') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'person' && childName === 'nationality') {
            await db.run(
              `INSERT INTO person_nationalities
                (person_id, label, reference, source_ids_json, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                childText,
                child.getAttribute('ref') || null,
                child.getAttribute('sourceIds') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'person' && childName === 'placeName') {
            await db.run(
              `INSERT INTO person_origins
                (person_id, label, reference, name_type, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                childText,
                child.getAttribute('ref') || null,
                child.getAttribute('type') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'person' && childName === 'nobleTitle') {
            const parts = childElements(child);
            const part = (name: string, type?: string) =>
              parts.find(
                (x) => localName(x) === name && (!type || x.getAttribute('type') === type),
              );
            await db.run(
              `INSERT INTO person_titles
                (person_id, dynasty, place_name, role_name, posthumous_name, reference, place_reference, role_reference, posthumous_reference, when_value, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('dynasty') || null,
                text(part('placeName')),
                text(part('roleName')),
                text(part('persName', 'posthumous')),
                child.getAttribute('ref') || null,
                part('placeName')?.getAttribute('ref') || null,
                part('roleName')?.getAttribute('ref') || null,
                part('persName', 'posthumous')?.getAttribute('ref') || null,
                child.getAttribute('when') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'work' && childName === 'author') {
            const person = childElements(child).find((x) => localName(x) === 'persName');
            await db.run(
              `INSERT INTO work_authors
                (work_id, label, reference, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                text(person || child),
                person?.getAttribute('ref') || child.getAttribute('ref') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'person' && childName === 'affiliation') {
            const officeId = child.getAttribute('ref')?.replace(/^#/, '') || null;
            const officeExists =
              officeId &&
              (await db.get("SELECT 1 FROM entities WHERE id = ? AND kind = 'office'", [officeId]))
                ? officeId
                : null;
            await db.run(
              `INSERT INTO person_offices
                (person_id, office_id, office_label, reference, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                officeExists,
                childText,
                child.getAttribute('ref') || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          if (kind === 'office' && childName === 'state') {
            await db.run(
              `INSERT INTO office_classifications
                (office_id, classification_id, reference, label, origin, source, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                child.getAttribute('ref') || childText,
                child.getAttribute('ref') || null,
                childText || null,
                p.origin,
                p.source,
                p.status,
                childNow,
                childNow,
              ],
            );
            continue;
          }
          await db.run(
            `INSERT INTO entity_extensions (entity_id, ordinal, namespace, element_name, xml) VALUES (?, ?, ?, ?, ?)`,
            [id, fragmentOrdinal, null, childName, serializeChild(child)],
          );
          fragmentOrdinal += 1;
          report.fragmentsPreserved += 1;
        }
      }
    }
    for (const relationList of childElements(standOff).filter(
      (child) => localName(child) === 'listRelation',
    )) {
      for (const relation of childElements(relationList).filter(
        (child) => localName(child) === 'relation',
      )) {
        const active = relation.getAttribute('active').replace(/^#/, '') || null;
        const passive = relation.getAttribute('passive').replace(/^#/, '') || null;
        if (!active) {
          report.warnings.push('Skipped office relation without an active subject.');
          continue;
        }
        const subjectExists = await db.get('SELECT 1 FROM entities WHERE id = ?', [active]);
        if (!subjectExists) {
          report.unresolvedReferences.push(active);
          report.warnings.push(`Skipped relation for missing subject ${active}.`);
          continue;
        }
        const objectExists =
          passive && (await db.get('SELECT 1 FROM entities WHERE id = ?', [passive]))
            ? passive
            : null;
        if (passive && !objectExists) {
          report.unresolvedReferences.push(passive);
        }
        const now = new Date().toISOString();
        await db.run(
          `INSERT INTO entity_relations
            (relation_type, subject_entity_id, object_entity_id, active, passive, symmetric, reference, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            relation.getAttribute('name') || relation.getAttribute('type') || 'relation',
            active,
            objectExists,
            relation.getAttribute('active') || null,
            relation.getAttribute('passive') || null,
            relation.getAttribute('mutual') === 'true' ||
            relation.getAttribute('symmetric') === 'true'
              ? 1
              : 0,
            relation.getAttribute('ref') || null,
            'xml',
            relation.getAttribute('resp') || null,
            'active',
            now,
            now,
          ],
        );
      }
    }
    await db.exec(`
      UPDATE person_offices
      SET office_id = (
        SELECT e.id FROM entities e
        WHERE e.kind = 'office' AND e.id = REPLACE(person_offices.reference, '#', '')
      )
      WHERE office_id IS NULL AND reference IS NOT NULL;
      UPDATE work_authors
      SET person_id = (
        SELECT e.id FROM entities e
        WHERE e.kind = 'person' AND e.id = REPLACE(work_authors.reference, '#', '')
      )
      WHERE person_id IS NULL AND reference IS NOT NULL;
    `);
    // Materialize the audit tables from value-level provenance/status so
    // imported rejected/withdrawn assertions have the same durable lifecycle
    // semantics as values created by the SQLite repository.
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
      ['place_locations', 'entity_id'],
    ] as const) {
      await db.exec(
        `INSERT OR IGNORE INTO entity_tombstones (entity_id, table_name, row_id, reason, created_at)
         SELECT ${entityColumn}, '${table}', id, 'imported-${table}-status', updated_at
         FROM ${table} WHERE status <> 'active'`,
      );
      await db.exec(
        `INSERT OR IGNORE INTO entity_provenance (entity_id, table_name, row_id, origin, source, recorded_at)
         SELECT ${entityColumn}, '${table}', id, origin, source, updated_at
         FROM ${table}`,
      );
    }
  });
  return report;
}

async function rows(
  db: EntityDbBackend,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown>[]> {
  return (await db.all(sql, params)) as Record<string, unknown>[];
}

async function entityXml(db: EntityDbBackend, entity: Record<string, unknown>): Promise<string> {
  const id = String(entity.id);
  const kind = entity.kind as SqliteEntityKind;
  const nameTag = tagForKind(kind);
  const parts: string[] = [];
  const entityAttrs = (
    await rows(
      db,
      `SELECT namespace, name, value FROM entity_attributes WHERE entity_id = ? ORDER BY id`,
      id,
    )
  )
    .map(
      (row) =>
        ` ${row.namespace ? `${String(row.namespace)}:` : ''}${String(row.name)}="${attrEscape(String(row.value))}"`,
    )
    .join('');
  let exportedFamilyNote = false;
  let exportedGivenNote = false;
  for (const row of await rows(
    db,
    `SELECT * FROM entity_names WHERE entity_id = ? ORDER BY is_primary DESC, id`,
    id,
  )) {
    if (row.status !== 'active' && row.status !== 'rejected') continue;
    const nameType = String(row.name_type ?? '');
    const nameRole = String(row.name_role ?? '');
    const isFamily = nameRole === 'family' || nameType === 'family' || nameType === 'familyName';
    const isGiven = nameRole === 'given' || nameType === 'given' || nameType === 'givenName';
    if (isFamily || isGiven) {
      const noteType = isFamily ? 'familyName' : 'givenName';
      const attrs = [
        row.language ? ` xml:lang="${attrEscape(String(row.language))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<note type="${noteType}"${attrs}>${xmlEscape(String(row.text))}</note>`);
      if (isFamily) exportedFamilyNote = true;
      else exportedGivenNote = true;
      continue;
    }
    const attrs = [
      row.language ? ` xml:lang="${attrEscape(String(row.language))}"` : '',
      row.name_type ? ` type="${attrEscape(String(row.name_type))}"` : '',
      row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
      row.source ? ` source="${attrEscape(String(row.source))}"` : '',
      row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
    ].join('');
    parts.push(`<${nameTag}${attrs}>${xmlEscape(String(row.text))}</${nameTag}>`);
  }
  for (const row of await rows(
    db,
    `SELECT * FROM entity_translations WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    if (row.status !== 'active' && row.status !== 'rejected') continue;
    const attrs = [
      ` xml:lang="${attrEscape(String(row.language))}"`,
      ` type="translation"`,
      row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
      row.source ? ` source="${attrEscape(String(row.source))}"` : '',
      row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
    ].join('');
    parts.push(`<${nameTag}${attrs}>${xmlEscape(String(row.text))}</${nameTag}>`);
  }
  if (kind === 'person') {
    const person = (await db.get('SELECT family_name, given_name FROM people WHERE entity_id = ?', [
      id,
    ])) as { family_name: string | null; given_name: string | null } | undefined;
    if (person?.family_name && !exportedFamilyNote) {
      parts.push(`<note type="familyName">${xmlEscape(person.family_name)}</note>`);
    }
    if (person?.given_name && !exportedGivenNote) {
      parts.push(`<note type="givenName">${xmlEscape(person.given_name)}</note>`);
    }
  }
  for (const row of await rows(
    db,
    `SELECT * FROM entity_authorities WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    const attrs = [
      ` type="${attrEscape(String(row.authority_type))}"`,
      row.origin !== 'authority' ? ` origin="${attrEscape(String(row.origin))}"` : '',
      row.source ? ` source="${attrEscape(String(row.source))}"` : '',
      row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
    ].join('');
    parts.push(`<idno${attrs}>${xmlEscape(String(row.authority_value))}</idno>`);
  }
  for (const row of await rows(
    db,
    `SELECT * FROM entity_metadata WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    const attrs =
      ` type="${attrEscape(String(row.key))}"` +
      (row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '');
    parts.push(`<note${attrs}>${xmlEscape(String(row.value))}</note>`);
  }
  for (const row of await rows(
    db,
    `SELECT * FROM authority_caches WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    const attrs = [
      ` type="authority-cache"`,
      row.authority_type ? ` source="${attrEscape(String(row.authority_type))}"` : '',
      row.retrieved_at ? ` when="${attrEscape(String(row.retrieved_at))}"` : '',
      row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
    ].join('');
    parts.push(`<note${attrs}>${xmlEscape(String(row.payload_json))}</note>`);
  }
  for (const row of await rows(
    db,
    `SELECT * FROM entity_decisions WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    const attrs = [
      ` type="${attrEscape(String(row.decision_type))}"`,
      row.target_entity_id ? ` ref="#${attrEscape(String(row.target_entity_id))}"` : '',
      row.target_refs ? ` target="${attrEscape(String(row.target_refs))}"` : '',
      row.source ? ` source="${attrEscape(String(row.source))}"` : '',
    ].join('');
    parts.push(`<note${attrs}>${xmlEscape(String(row.payload_json ?? ''))}</note>`);
  }
  for (const row of await rows(
    db,
    `SELECT * FROM entity_dates WHERE entity_id = ? ORDER BY id`,
    id,
  )) {
    if (row.date_kind === 'birth' || row.date_kind === 'death') {
      const attrs = [
        row.when_value
          ? ` when="${attrEscape(String(row.when_value))}"`
          : row.start_year != null
            ? ` when="${String(row.start_year)}"`
            : '',
        row.not_before ? ` notBefore="${attrEscape(String(row.not_before))}"` : '',
        row.not_after ? ` notAfter="${attrEscape(String(row.not_after))}"` : '',
        row.from_value ? ` from="${attrEscape(String(row.from_value))}"` : '',
        row.to_value ? ` to="${attrEscape(String(row.to_value))}"` : '',
        row.from_circa ? ' fromCirca="true"' : '',
        row.to_circa ? ' toCirca="true"' : '',
        row.date_system && row.date_system !== 'gregorian'
          ? ` dateSystem="${attrEscape(String(row.date_system))}"`
          : '',
        row.calendar_payload
          ? ` calendarPayload="${attrEscape(String(row.calendar_payload))}"`
          : '',
        row.start_precision ? ` precision="${attrEscape(String(row.start_precision))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<${String(row.date_kind)}${attrs}/>`);
    } else {
      const attrs = [
        row.when_value ? ` when="${attrEscape(String(row.when_value))}"` : '',
        row.start_year != null ? ` from="${String(row.start_year)}"` : '',
        row.end_year != null ? ` to="${String(row.end_year)}"` : '',
        row.not_before ? ` notBefore="${attrEscape(String(row.not_before))}"` : '',
        row.not_after ? ` notAfter="${attrEscape(String(row.not_after))}"` : '',
        row.from_value && row.start_year == null
          ? ` from="${attrEscape(String(row.from_value))}"`
          : '',
        row.to_value && row.end_year == null ? ` to="${attrEscape(String(row.to_value))}"` : '',
        row.from_circa ? ' fromCirca="true"' : '',
        row.to_circa ? ' toCirca="true"' : '',
        row.date_system && row.date_system !== 'gregorian'
          ? ` dateSystem="${attrEscape(String(row.date_system))}"`
          : '',
        row.calendar_payload
          ? ` calendarPayload="${attrEscape(String(row.calendar_payload))}"`
          : '',
        row.start_precision ? ` fromPrecision="${attrEscape(String(row.start_precision))}"` : '',
        row.end_precision ? ` toPrecision="${attrEscape(String(row.end_precision))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(
        `<note type="${attrEscape(String(row.date_kind || 'dates'))}"${attrs}${row.raw_text ? `>${xmlEscape(String(row.raw_text))}</note>` : '/>'}`,
      );
    }
  }
  if (kind === 'place') {
    for (const row of await rows(
      db,
      `SELECT * FROM place_locations WHERE entity_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<geo${attrs}>${String(row.latitude)} ${String(row.longitude)}</geo>`);
    }
  }
  if (kind === 'person') {
    for (const row of await rows(
      db,
      `SELECT * FROM person_nationalities WHERE person_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.source_ids_json ? ` sourceIds="${attrEscape(String(row.source_ids_json))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<nationality${attrs}>${xmlEscape(String(row.label))}</nationality>`);
    }
    for (const row of await rows(
      db,
      `SELECT * FROM person_origins WHERE person_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.name_type ? ` type="${attrEscape(String(row.name_type))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<placeName${attrs}>${xmlEscape(String(row.label))}</placeName>`);
    }
    for (const row of await rows(
      db,
      `SELECT * FROM person_titles WHERE person_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.dynasty ? ` dynasty="${attrEscape(String(row.dynasty))}"` : '',
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.when_value ? ` when="${attrEscape(String(row.when_value))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      const posthumous = row.posthumous_name
        ? `<persName type="posthumous"${row.posthumous_reference ? ` ref="${attrEscape(String(row.posthumous_reference))}"` : ''}>${xmlEscape(String(row.posthumous_name))}</persName>`
        : '';
      parts.push(
        `<nobleTitle${attrs}><placeName${row.place_reference ? ` ref="${attrEscape(String(row.place_reference))}"` : ''}>${xmlEscape(String(row.place_name))}</placeName><roleName${row.role_reference ? ` ref="${attrEscape(String(row.role_reference))}"` : ''}>${xmlEscape(String(row.role_name))}</roleName>${posthumous}</nobleTitle>`,
      );
    }
  }
  if (kind === 'work') {
    for (const row of await rows(
      db,
      `SELECT * FROM work_authors WHERE work_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.origin !== 'user' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<author${attrs}>${xmlEscape(String(row.label))}</author>`);
    }
  }
  if (kind === 'person') {
    for (const row of await rows(
      db,
      `SELECT * FROM person_offices WHERE person_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.origin !== 'xml' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<affiliation${attrs}>${xmlEscape(String(row.office_label))}</affiliation>`);
    }
  }
  if (kind === 'office') {
    for (const row of await rows(
      db,
      `SELECT * FROM office_classifications WHERE office_id = ? ORDER BY id`,
      id,
    )) {
      const attrs = [
        ` type="office-classification"`,
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
        row.origin !== 'xml' ? ` origin="${attrEscape(String(row.origin))}"` : '',
        row.source ? ` source="${attrEscape(String(row.source))}"` : '',
        row.status !== 'active' ? ` status="${attrEscape(String(row.status))}"` : '',
      ].join('');
      parts.push(`<state${attrs}>${xmlEscape(String(row.label ?? ''))}</state>`);
    }
  }
  for (const row of await rows(
    db,
    `SELECT central_entity_id, user_stable_id FROM central_mappings WHERE project_entity_id = ? ORDER BY user_stable_id`,
    id,
  )) {
    parts.push(
      `<idno type="grognard-central" subtype="${attrEscape(String(row.user_stable_id))}">${xmlEscape(String(row.central_entity_id))}</idno>`,
    );
  }
  for (const row of await rows(
    db,
    `SELECT xml FROM entity_extensions WHERE entity_id = ? ORDER BY ordinal`,
    id,
  ))
    parts.push(String(row.xml));
  // Keep exporting fragments created by schema v2 databases until they have
  // been re-imported into the v3 extension table.
  for (const row of await rows(
    db,
    `SELECT xml FROM entity_xml_fragments WHERE entity_id = ? ORDER BY ordinal`,
    id,
  ))
    parts.push(String(row.xml));
  const changed = String(entity.updated_at);
  parts.push(`<note type="grognard-changed" when="${attrEscape(changed)}"/>`);
  return `<${ENTITY_KINDS[kind].item} xml:id="${attrEscape(id)}"${entityAttrs}>${parts.join('')}</${ENTITY_KINDS[kind].item}>`;
}

const CENTRAL_MAPPING_TYPE = 'grognard-central';

/** Same FNV-1a change detector used by synchronizedMirror (not a security hash). */
function hashContent(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

/**
 * Strip local ids, `grognard-central` mappings, and volatile `grognard-changed` stamps so
 * PEDB/CEDB content hashes compare the same way as the DOM mirror path.
 */
export function normalizeEntityXmlForContentHash(entityElementXml: string): string {
  const document = new DOMParser().parseFromString(entityElementXml, 'application/xml');
  const root = document.documentElement as unknown as XmlElement & {
    attributes?: { length: number; item(index: number): { name: string; value: string } | null };
    removeAttribute?(name: string): void;
    removeChild?(child: XmlElement): void;
  };
  if (!root) return entityElementXml;

  const elements: (typeof root)[] = [];
  const walk = (element: typeof root) => {
    elements.push(element);
    for (const child of childElements(element)) walk(child as typeof root);
  };
  walk(root);

  for (const element of elements) {
    const attrs = element.attributes;
    if (attrs) {
      const toRemove: string[] = [];
      for (let index = 0; index < attrs.length; index += 1) {
        const attribute = attrs.item(index);
        if (!attribute) continue;
        if (
          attribute.name === 'xml:id' ||
          attribute.name === 'id' ||
          attribute.name.endsWith(':id')
        ) {
          toRemove.push(attribute.name);
        }
      }
      for (const name of toRemove) element.removeAttribute?.(name);
    }
    for (const child of [...childElements(element)]) {
      const childName = localName(child);
      if (childName === 'idno' && child.getAttribute('type') === CENTRAL_MAPPING_TYPE) {
        element.removeChild?.(child);
      } else if (childName === 'note' && child.getAttribute('type') === 'grognard-changed') {
        element.removeChild?.(child);
      }
    }
  }
  return new XMLSerializer().serializeToString(root as unknown as Node);
}

/** Export one entity element (including mapping/changed notes) as TEI XML. */
export async function exportEntityElementXml(
  repository: EntitySqliteRepository,
  entityId: string,
): Promise<string | null> {
  const row = (await repository.backend.get('SELECT * FROM entities WHERE id = ?', [entityId])) as
    Record<string, unknown> | undefined;
  if (!row || row.deleted_at) return null;
  return entityXml(repository.backend, row);
}

/**
 * Bump whenever `hashContent` or `normalizeEntityXmlForContentHash` changes in
 * a way that can change a hash for unchanged content (algorithm tweak, a
 * normalization rule added/removed, …). The version travels as a prefix on
 * the hash string itself, so a stale locally-cached hash from before the bump
 * reads as "different" rather than silently comparing equal or unequal to a
 * freshly computed one of a different shape. `reconcileContentHashVersion` in
 * entitySyncRepo.ts uses this to force a clean re-baseline after a bump.
 */
export const CONTENT_HASH_VERSION = 1;

/**
 * Content hash matching `entityContentHash` in synchronizedMirror.ts for the
 * same SQLite-backed entity export.
 */
export async function computeEntityContentHash(
  repository: EntitySqliteRepository,
  entityId: string,
): Promise<string | null> {
  const xml = await exportEntityElementXml(repository, entityId);
  if (!xml) return null;
  return `v${CONTENT_HASH_VERSION}:${hashContent(normalizeEntityXmlForContentHash(xml))}`;
}

/**
 * Copy one entity's body from source DB into target DB (preserve target id +
 * central mappings). Returns whether the target content hash changed.
 */
export async function replaceEntityContentBetween(
  source: EntitySqliteRepository,
  sourceId: string,
  target: EntitySqliteRepository,
  targetId: string,
): Promise<{ changed: boolean; beforeHash: string | null; afterHash: string | null }> {
  const beforeHash = await computeEntityContentHash(target, targetId);
  const ok = await target.replaceEntityContentFrom(source, sourceId, targetId);
  if (!ok) return { changed: false, beforeHash, afterHash: beforeHash };
  const afterHash = await computeEntityContentHash(target, targetId);
  return {
    changed: beforeHash !== afterHash,
    beforeHash,
    afterHash,
  };
}

/** Export the SQLite database as deterministic TEI entity XML. */
export async function exportEntitiesXml(
  repository: EntitySqliteRepository,
  options: XmlExportOptions = {},
): Promise<string> {
  const db = repository.backend;
  const databaseId =
    options.databaseId ??
    String(
      (
        await db.get<{ value?: string }>('SELECT value FROM database_metadata WHERE key = ?', [
          'database_id',
        ])
      )?.value ?? '',
    );
  if (!databaseId) throw new Error('SQLite entity database has no database_id metadata.');
  const lists = (
    await Promise.all(
      (Object.keys(ENTITY_KINDS) as SqliteEntityKind[]).map(async (kind) => {
        const config = ENTITY_KINDS[kind];
        const entities = await rows(
          db,
          `SELECT e.* FROM entities e
      LEFT JOIN entity_positions p ON p.entity_id = e.id AND p.list_kind = ?
      WHERE e.kind = ? AND e.deleted_at IS NULL
      ORDER BY COALESCE(p.position, 2147483647), e.id`,
          kind,
          kind,
        );
        const entityXmls = await Promise.all(entities.map((entity) => entityXml(db, entity)));
        return `<${config.list}${config.type ? ` type="${config.type}"` : ''}>${entityXmls.join('')}</${config.list}>`;
      }),
    )
  ).join('');
  const relations = (
    await rows(db, `SELECT * FROM entity_relations WHERE status = 'active' ORDER BY id`)
  )
    .map((row) => {
      const attrs = [
        ` name="${attrEscape(String(row.relation_type))}"`,
        row.active ? ` active="${attrEscape(String(row.active))}"` : '',
        row.passive ? ` passive="${attrEscape(String(row.passive))}"` : '',
        row.symmetric ? ' mutual="true"' : '',
        row.reference ? ` ref="${attrEscape(String(row.reference))}"` : '',
      ].join('');
      return `<relation${attrs}/>`;
    })
    .join('');
  const relationList = relations
    ? `<listRelation type="office-hierarchy">${relations}</listRelation>`
    : '';
  const title = String(
    (
      await db.get<{ value?: string }>('SELECT value FROM database_metadata WHERE key = ?', [
        'title',
      ])
    )?.value ?? 'Entity database',
  );
  const sourceDescription = String(
    (
      await db.get<{ value?: string }>('SELECT value FROM database_metadata WHERE key = ?', [
        'source_description',
      ])
    )?.value ?? 'Entity authority file.',
  );
  return `<?xml version="1.0" encoding="UTF-8"?><TEI xmlns="${TEI_NS}"><teiHeader><fileDesc><titleStmt><title>${xmlEscape(title)}</title></titleStmt><publicationStmt><p>Generated by Grognard.</p><idno type="grognard-entity-database">${xmlEscape(databaseId)}</idno></publicationStmt><sourceDesc><p>${xmlEscape(sourceDescription)}</p></sourceDesc></fileDesc></teiHeader><standOff>${lists}${relationList}</standOff></TEI>`;
}

/**
 * Collect `duplicate-ok` / `concordance-rejected` notes that still carry a
 * `@target` from a sibling entities.xml, for one-time SQLite repair.
 */
export function extractDecisionTargetEntriesFromXml(xml: string): DecisionTargetBackfillEntry[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as XmlElement;
  const root = document as unknown as {
    documentElement: XmlElement;
  };
  if (localName(root.documentElement) !== 'TEI') return [];
  const standOff = childElements(root.documentElement).find(
    (child) => localName(child) === 'standOff',
  );
  if (!standOff) return [];
  const entries: DecisionTargetBackfillEntry[] = [];
  for (const list of childElements(standOff)) {
    for (const item of childElements(list)) {
      const entityId =
        item.getAttribute('xml:id') ||
        (item.getAttributeNS ? item.getAttributeNS(XML_NS, 'id') : '') ||
        '';
      if (!entityId) continue;
      for (const child of childElements(item)) {
        if (localName(child) !== 'note') continue;
        const decisionType = child.getAttribute('type');
        if (decisionType !== 'duplicate-ok' && decisionType !== 'concordance-rejected') continue;
        const targetRefs = (child.getAttribute('target') || '').trim();
        if (!targetRefs) continue;
        entries.push({
          entityId,
          decisionType,
          targetRefs,
          source: child.getAttribute('source') || null,
          payloadJson: text(child) || null,
        });
      }
    }
  }
  return entries;
}

/** Apply sibling-XML decision targets into SQLite. Idempotent. */
export async function backfillDecisionTargetsFromXml(
  repository: EntitySqliteRepository,
  xml: string,
): Promise<DecisionTargetBackfillReport> {
  return repository.backfillDecisionTargets(extractDecisionTargetEntriesFromXml(xml));
}
