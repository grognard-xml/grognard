import type { AuthorityId } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { autoSyncEntitiesToCentral } from '../../../../packages/cwrc-leafwriter/src/autoTagging/autoSync';
import { entityStoreFromDesktop } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entityStore';
import { parseAuthorityUri } from '../../../../packages/cwrc-leafwriter/src/autoTagging/lookupResolve';
import { mintOrLinkEntitySqlite } from '../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteLookupMint';
import { autoRomanizeForKind } from '../../../../packages/cwrc-leafwriter/src/utilities/romanize';
import { findTeiHeader, TEI_NS } from './teiHeaderXml';
import {
  applySourceDescriptionToXml,
  readSourceDescriptionFromXml,
  type SourceAuthor,
  type SourceDescription,
} from './sourceDescription';

/** Map a TEI ``@ref`` (or legacy token) to SQLite authority idnos for mint/link. */
export const authorityIdsFromTeiRef = (ref: string): AuthorityId[] => {
  const trimmed = ref.trim();
  if (!trimmed) return [];

  const parsed = parseAuthorityUri(trimmed);
  if (parsed) return [{ type: parsed.idnoType, value: parsed.value }];

  const norbert = trimmed.match(/^NORBERT:(person|office|place)-(.+)$/i);
  if (norbert) {
    return [{ type: 'NORBERT', value: `${norbert[1]!.toLowerCase()}-${norbert[2]}` }];
  }

  const dila = trimmed.match(/^DILA:([A-Z]\d[\w-]*)$/i);
  if (dila) return [{ type: 'DILA', value: dila[1]!.toUpperCase() }];

  const bdrc = trimmed.match(/purl\.bdrc\.io\/resource\/([^/?#]+)/i);
  if (bdrc) return [{ type: 'BDRC', value: bdrc[1]!.replace(/\.ttl$/i, '') }];

  if (/^https?:\/\//i.test(trimmed)) return [{ type: 'URI', value: trimmed }];

  return [];
};

/** Strip fascicle / split-file suffixes so one work entity covers all parts. */
export const normalizeImportedWorkTitle = (title: string): string => {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  return (
    trimmed
      .replace(/\s*—\s*(?:bam po|བམ་པོ་).*$/iu, '')
      .replace(/\s*—\s*juan\s+\d+.*$/iu, '')
      .trim() || trimmed
  );
};

const readHeaderIdnoRefs = (xml: string): string[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const header = findTeiHeader(doc);
  if (!header) return [];

  const refs: string[] = [];
  for (const idno of Array.from(header.getElementsByTagNameNS(TEI_NS, 'idno'))) {
    const type = (idno.getAttribute('type') ?? '').trim();
    const subtype = (idno.getAttribute('subtype') ?? '').trim();
    const value = idno.textContent?.trim() ?? '';
    if (!value) continue;
    if (subtype === 'edition') continue;

    if (type === 'BDRC-work' || type === 'BDRC') {
      refs.push(/^https?:\/\//i.test(value) ? value : `http://purl.bdrc.io/resource/${value}`);
      continue;
    }
    if (type === 'URI' || type === 'Kanripo' || type === 'CBETA' || type === 'Wikidata') {
      refs.push(value);
    }
  }
  return refs;
};

const projectSourceLanguage = async (): Promise<string | null> => {
  try {
    return (await window.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;
  } catch {
    return null;
  }
};

const parseWorkYear = (source: SourceDescription): number | null | undefined => {
  const when = source.workDate.when?.trim();
  if (!when) return undefined;
  const match = when.match(/^(-?\d{1,4})/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1]!, 10);
  return Number.isFinite(year) ? year : undefined;
};

const resolveExistingByName = async (
  store: NonNullable<ReturnType<typeof entityStoreFromDesktop>>,
  kind: 'person' | 'work',
  name: string,
): Promise<string | null> => {
  const hits = (await store.sqliteSearchNames(kind, name, 20)) ?? [];
  const normalized = name.normalize('NFC');
  const match = hits.find((hit) => hit.label.normalize('NFC') === normalized);
  return match?.id ?? null;
};

const linkAuthor = async (
  store: NonNullable<ReturnType<typeof entityStoreFromDesktop>>,
  author: SourceAuthor,
  projectLang: string | null,
  syncIds: string[],
): Promise<SourceAuthor> => {
  const name = author.name.trim();
  if (!name) return author;
  if (author.key?.trim()) return author;

  const authorityIds = author.ref ? authorityIdsFromTeiRef(author.ref) : [];
  const existingByName =
    authorityIds.length === 0 ? await resolveExistingByName(store, 'person', name) : null;

  const { id } = await mintOrLinkEntitySqlite(store, {
    kind: 'person',
    name,
    nameLang: projectLang ?? undefined,
    romanizedName: autoRomanizeForKind(name, projectLang, 'person') ?? undefined,
    authorityIds,
    localEntityId: existingByName,
  });
  syncIds.push(id);
  return { ...author, key: id };
};

const headerAlreadyLinked = (source: SourceDescription): boolean => {
  if (!source.title.trim()) return false;
  if (!source.titleKey?.trim()) return false;
  if (source.authors.length === 0) return true;
  return source.authors.every((author) => Boolean(author.key?.trim() || !author.name.trim()));
};

/**
 * Ensure the imported file's TEI header work + authors exist in the project
 * entity database, then write ``@key`` attributes back into the XML string.
 *
 * Does not sync to the central store itself -- appends any minted/linked
 * entity id to ``syncIds`` instead, so a caller processing many files (e.g.
 * ``ensureImportHeaderEntitiesForPaths``) can batch them into one central
 * round trip via ``autoSyncEntitiesToCentral`` rather than one per file.
 */
export const linkImportedWorkHeaderToPedb = async (
  xml: string,
  syncIds: string[],
): Promise<{ xml: string; updated: boolean }> => {
  const store = entityStoreFromDesktop();
  if (!store || !(await store.hasSqliteDatabase())) {
    return { xml, updated: false };
  }

  let source = readSourceDescriptionFromXml(xml);
  if (!source.title.trim() && source.authors.length === 0) {
    return { xml, updated: false };
  }
  if (headerAlreadyLinked(source)) {
    return { xml, updated: false };
  }

  const projectLang = await projectSourceLanguage();

  const linkedAuthors: SourceAuthor[] = [];
  for (const author of source.authors) {
    linkedAuthors.push(await linkAuthor(store, author, projectLang, syncIds));
  }

  const workName = normalizeImportedWorkTitle(source.title);
  let workKey = source.titleKey?.trim();
  if (workName && !workKey) {
    const workAuthorityIds = [
      ...(source.titleRef ? authorityIdsFromTeiRef(source.titleRef) : []),
      ...readHeaderIdnoRefs(xml).flatMap((ref) => authorityIdsFromTeiRef(ref)),
    ];
    const dedupedWorkAuthorities = workAuthorityIds.filter(
      (authority, index, all) =>
        all.findIndex(
          (other) =>
            other.type.toLowerCase() === authority.type.toLowerCase() &&
            other.value === authority.value,
        ) === index,
    );
    const existingByName =
      dedupedWorkAuthorities.length === 0
        ? await resolveExistingByName(store, 'work', workName)
        : null;
    const startYear = parseWorkYear(source);

    const { id } = await mintOrLinkEntitySqlite(store, {
      kind: 'work',
      name: workName,
      nameLang: projectLang ?? undefined,
      romanizedName: autoRomanizeForKind(workName, projectLang, 'work') ?? undefined,
      authorityIds: dedupedWorkAuthorities,
      startYear,
      localEntityId: existingByName,
    });
    workKey = id;
    syncIds.push(id);
  }

  if (workKey && linkedAuthors.some((author) => author.name.trim())) {
    await store.sqliteSetUserWorkAuthors(
      workKey,
      linkedAuthors
        .filter((author) => author.name.trim())
        .map((author) => ({
          name: author.name,
          ref: author.ref ?? null,
          key: author.key ?? null,
        })),
    );
  }

  source = {
    ...source,
    titleKey: workKey || source.titleKey,
    authors: linkedAuthors,
  };

  const nextXml = applySourceDescriptionToXml(xml, source);
  return { xml: nextXml, updated: nextXml !== xml };
};

/** Read each imported XML file, link header entities, and write ``@key`` back. */
export const ensureImportHeaderEntitiesForPaths = async (
  filePaths: string[],
): Promise<{ updatedPaths: string[] }> => {
  const api = window.electronAPI;
  if (!api?.readFile || !api?.writeFile || filePaths.length === 0) {
    return { updatedPaths: [] };
  }

  const updatedPaths: string[] = [];
  const syncIds: string[] = [];
  for (const filePath of filePaths) {
    try {
      const xml = await api.readFile(filePath);
      const { xml: nextXml, updated } = await linkImportedWorkHeaderToPedb(xml, syncIds);
      if (!updated) continue;
      await api.writeFile(filePath, nextXml);
      updatedPaths.push(filePath);
    } catch (error) {
      console.warn('[ensureImportHeaderEntities] skipped file:', filePath, error);
    }
  }
  // One central-store round trip for every file's minted/linked entities,
  // instead of one round trip per file (which is what calling the
  // single-entity sync form inside this loop would do -- a real bottleneck
  // for a whole-work import of 100+ files sharing the same work/author).
  const uniqueSyncIds = [...new Set(syncIds)];
  if (uniqueSyncIds.length > 0) {
    await autoSyncEntitiesToCentral(null, uniqueSyncIds);
  }
  return { updatedPaths };
};
