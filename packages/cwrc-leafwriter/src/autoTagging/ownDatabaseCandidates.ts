import type { AuthorityCandidate } from './authority';
import { cleanEntityName } from './titleMarks';
import { ENTITY_KINDS, entityElements, parseIsoYear, type EntityKind } from './entities';
import {
  phase1SearchStringsFromCandidate,
  resolveNameTypeTaggingPolicy,
  type NameTypeTaggingPolicy,
} from './nameTypeTaggingPolicy';
import { buildNobleTitleSearchStrings } from './norbertWikiNt';

/**
 * Confirmed noble-title search strings for one person entity: fief+rank(+
 * posthumous-name) forms, and the same forms suffixed with each of the
 * person's own names (e.g. "魏武帝", "魏武帝曹操"). Without this, only the raw
 * `<persName>` text would be searchable, and a decomposed title like Cao
 * Cao's 魏武帝 would never be recognized as a mention of him in new documents
 * — storing the structured parts is correct for the entity record, but the
 * tag-bomb matcher needs the concatenated forms Norbert's own expander uses.
 */
function nobleTitleSearchStringsForEntity(
  el: Element,
  personNames: readonly string[],
  familyName?: string,
): string[] {
  const strings: string[] = [];
  for (const child of Array.from(el.children)) {
    if (child.localName !== 'nobleTitle') continue;
    const textOf = (name: string, predicate?: (part: Element) => boolean) =>
      Array.from(child.children)
        .find((part) => part.localName === name && (!predicate || predicate(part)))
        ?.textContent?.trim() || undefined;
    const { titleSearchStrings, wrapperSearchStrings } = buildNobleTitleSearchStrings({
      fief: textOf('placeName'),
      roleName: textOf('roleName'),
      posthumousName: textOf('persName', (part) => part.getAttribute('type') === 'posthumous'),
      dynasty: child.getAttribute('dynasty'),
      personNames,
      familyName,
    });
    for (const value of [...titleSearchStrings, ...wrapperSearchStrings]) {
      if (!strings.includes(value)) strings.push(value);
    }
  }
  return strings;
}

/** Parse the `<note type="dates">` written by `addEntity` for non-person kinds. */
function datesFromNote(note: Element): { startYear?: number; endYear?: number } {
  const when = note.getAttribute('when');
  if (when) {
    const startYear = parseIsoYear(when);
    return startYear != null ? { startYear } : {};
  }
  const textParts = (note.textContent ?? '').trim().split('/');
  const startRaw =
    note.getAttribute('from') ?? note.getAttribute('notBefore') ?? textParts[0] ?? textParts[1];
  const endRaw = note.getAttribute('to') ?? note.getAttribute('notAfter') ?? textParts[1];
  const startYear = parseIsoYear(startRaw);
  const endYear = parseIsoYear(endRaw);
  const meta: { startYear?: number; endYear?: number } = {};
  if (startYear != null) meta.startYear = startYear;
  if (endYear != null) meta.endYear = endYear;
  return meta;
}

export interface EntityDatabaseCandidateRecord {
  id: string;
  kind: EntityKind;
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

/** Generate tag-bomb candidates directly from typed SQLite rows. */
export function candidatesFromEntityDatabaseRecords(
  records: readonly EntityDatabaseCandidateRecord[],
  source: 'PEDB' | 'CEDB',
  policy?: NameTypeTaggingPolicy,
): AuthorityCandidate[] {
  const namePolicy = policy ?? resolveNameTypeTaggingPolicy(undefined, null);
  return records.flatMap((record) => {
    const searchStrings = record.names.map((name) => cleanEntityName(name.text)).filter(Boolean);
    if (record.kind === 'person') {
      const familyName = record.names.find((name) => name.type === 'family')?.text;
      for (const title of record.nobleTitles) {
        const expanded = buildNobleTitleSearchStrings({
          fief: title.fief,
          roleName: title.roleName,
          posthumousName: title.posthumousName,
          dynasty: title.dynasty,
          personNames: record.names.map((name) => name.text),
          familyName,
        });
        searchStrings.push(...expanded.titleSearchStrings, ...expanded.wrapperSearchStrings);
      }
    }
    const uniqueSearchStrings = [...new Set(searchStrings)];
    const filteredSearchStrings = phase1SearchStringsFromCandidate(
      { searchStrings: uniqueSearchStrings, names: record.names },
      namePolicy,
    );
    if (filteredSearchStrings.length === 0) return [];
    return [
      {
        source,
        authorityId: record.id,
        kind: record.kind,
        primaryName: filteredSearchStrings[0]!,
        searchStrings: filteredSearchStrings,
        ...(record.kind === 'person' && record.names.length > 0 ? { names: record.names } : {}),
        ...(record.description ||
        record.startYear != null ||
        record.endYear != null ||
        record.subtype
          ? {
              metadata: {
                ...(record.description ? { description: record.description } : {}),
                ...(record.startYear != null ? { startYear: record.startYear } : {}),
                ...(record.endYear != null ? { endYear: record.endYear } : {}),
                ...(record.subtype ? { subtype: record.subtype } : {}),
              },
            }
          : {}),
      },
    ];
  });
}

/**
 * Bulk-convert one entity kind's items in a PEDB/CEDB `entities.xml` document
 * into {@link AuthorityCandidate}s, so the project/central databases can feed
 * the same seed-index tag bomb as NDJSON authority packs. Mirrors the read
 * side of `searchEntityDocument` (`services/entity-database-lookup.ts`), but
 * bulk (no query filter) — dates parsed the way `addEntity` writes them
 * (`entities.ts`): `<birth>`/`<death>` for persons, `<note type="dates">`
 * for place/org/work/office.
 */
export function candidatesFromEntityDatabase(
  doc: Document,
  kind: EntityKind,
  source: 'PEDB' | 'CEDB',
  policy?: NameTypeTaggingPolicy,
): AuthorityCandidate[] {
  const namePolicy = policy ?? resolveNameTypeTaggingPolicy(undefined, null);
  const { name: nameTag } = ENTITY_KINDS[kind];
  const candidates: AuthorityCandidate[] = [];

  const items = entityElements(doc, kind);
  for (const el of items) {
    const id = el.getAttribute('xml:id');
    if (!id) continue;

    const searchStrings: string[] = [];
    const names: { text: string; type?: string }[] = [];
    const nameEls = el.getElementsByTagName(nameTag);
    for (let j = 0; j < nameEls.length; j++) {
      const nameEl = nameEls.item(j);
      // A nobleTitle's posthumous-name component (e.g. "武" alone) is a title
      // part, not a standalone name of the person — skip it here so it's
      // never tagged as a bare one-character mention; it still participates
      // in the concatenated noble-title strings built below.
      if (nameEl?.parentElement?.localName === 'nobleTitle') continue;
      const text = nameEl?.textContent?.trim();
      if (!text) continue;
      const type = nameEl?.getAttribute('type') ?? undefined;
      names.push(type ? { text, type } : { text });
      if (!searchStrings.includes(text)) searchStrings.push(text);
    }
    if (kind === 'person') {
      const familyName = names.find((name) => name.type === 'family')?.text;
      for (const value of nobleTitleSearchStringsForEntity(
        el,
        names.map((name) => name.text),
        familyName,
      )) {
        if (!searchStrings.includes(value)) searchStrings.push(value);
      }
    }
    const filteredSearchStrings = phase1SearchStringsFromCandidate(
      { searchStrings, names },
      namePolicy,
    );
    if (filteredSearchStrings.length === 0) continue;

    let description: string | undefined;
    let dates: { startYear?: number; endYear?: number } = {};
    const noteEls = el.getElementsByTagName('note');
    for (let j = 0; j < noteEls.length; j++) {
      const noteEl = noteEls.item(j)!;
      const type = noteEl.getAttribute('type');
      if (type === 'description' && description == null) {
        description = noteEl.textContent?.trim() || undefined;
      } else if (type === 'dates') {
        dates = datesFromNote(noteEl);
      }
    }

    if (kind === 'person') {
      const birth = el.getElementsByTagName('birth')[0]?.getAttribute('when');
      const death = el.getElementsByTagName('death')[0]?.getAttribute('when');
      const startYear = parseIsoYear(birth);
      const endYear = parseIsoYear(death);
      if (startYear != null) dates.startYear = startYear;
      if (endYear != null) dates.endYear = endYear;
    }

    const metadata: AuthorityCandidate['metadata'] = {};
    if (description) metadata.description = description;
    if (dates.startYear != null) metadata.startYear = dates.startYear;
    if (dates.endYear != null) metadata.endYear = dates.endYear;

    candidates.push({
      source,
      authorityId: id,
      kind,
      primaryName: filteredSearchStrings[0]!,
      searchStrings: filteredSearchStrings,
      ...(kind === 'person' && names.length > 0 ? { names } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }

  return candidates;
}
