/**
 * Entity-lookup service backed by the project's entities.xml (the Grognard entity
 * database). Registered on desktop and pinned above every external authority
 * so the user's own entities always appear first in the lookup dialog.
 */
import { ENTITY_KINDS, entityElements, type EntityKind } from '../autoTagging/entities';
import { entityStoreFromDesktop } from '../autoTagging/entityStore';
import { cleanEntityName } from '../autoTagging/titleMarks';
import { SQLITE_REQUIRED_LOOKUP_MESSAGE } from '../autoTagging/sqliteRequired';
import type {
  AuthorityLookupParams,
  AuthorityLookupResult,
  AuthorityService,
  NamedEntityType,
} from '../types';

export const ENTITY_DATABASE_SERVICE_ID = 'project-entities';
export const ENTITY_DATABASE_SERVICE_NAME = 'Project entities';

/** URI scheme for internal entity results (never written as @ref). */
export const ENTITY_DATABASE_URI_SCHEME = 'grognard-entity';

export function internalEntityUri(id: string): string {
  return `${ENTITY_DATABASE_URI_SCHEME}://${id}`;
}

export function internalEntityIdFromUri(uri: string): string | null {
  const match = uri.match(new RegExp(`^${ENTITY_DATABASE_URI_SCHEME}://(.+)$`));
  return match ? match[1]! : null;
}

/** Lookup entity types that live in the entity database, mapped to standoff kinds. */
export const LOOKUP_TYPE_TO_KIND: Partial<Record<NamedEntityType, EntityKind>> = {
  person: 'person',
  place: 'place',
  organization: 'org',
  work: 'work',
  citation: 'work',
  office: 'office',
  thing: 'thing',
};

const MAX_RESULTS = 20;

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Match a stored name to the lookup text without treating surnames as names. */
function namesMatch(query: string, name: string): boolean {
  if (!query || !name) return false;
  return query === name;
}

export function searchEntityDocument(
  doc: Document,
  kind: EntityKind,
  query: string,
): AuthorityLookupResult[] {
  const { name: nameTag } = ENTITY_KINDS[kind];
  const normalizedQuery = normalize(query);
  const results: AuthorityLookupResult[] = [];

  const items = entityElements(doc, kind);
  for (let i = 0; i < items.length && results.length < MAX_RESULTS; i++) {
    const el = items[i]!;
    const id = el.getAttribute('xml:id');
    if (!id) continue;

    const names: string[] = [];
    const nameEls = el.getElementsByTagName(nameTag);
    for (let j = 0; j < nameEls.length; j++) {
      const text = nameEls.item(j)?.textContent?.trim();
      if (text) names.push(text);
    }
    if (!names.some((name) => namesMatch(normalizedQuery, normalize(name)))) continue;

    const idnos: { type: string; value: string }[] = [];
    const idnoEls = el.getElementsByTagName('idno');
    for (let j = 0; j < idnoEls.length; j++) {
      const idnoEl = idnoEls.item(j)!;
      idnos.push({
        type: idnoEl.getAttribute('type') ?? 'unknown',
        value: idnoEl.textContent?.trim() ?? '',
      });
    }

    let description: string | undefined;
    const noteEls = el.getElementsByTagName('note');
    for (let j = 0; j < noteEls.length; j++) {
      const noteEl = noteEls.item(j)!;
      if (noteEl.getAttribute('type') === 'description') {
        description = noteEl.textContent?.trim() || undefined;
        break;
      }
    }

    results.push({
      label: names[0]!,
      description,
      uri: internalEntityUri(id),
      internal: { id, idnos, description },
    });
  }

  return results;
}

async function search({
  query,
  entityType,
}: AuthorityLookupParams): Promise<AuthorityLookupResult[]> {
  const kind = LOOKUP_TYPE_TO_KIND[entityType];
  if (!kind) return [];

  const store = entityStoreFromDesktop();
  if (!store) return [];

  const sqliteSearch = window.electronAPI?.entitySqliteSearch;
  if (!sqliteSearch || !(await store.hasSqliteDatabase())) {
    throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
  }

  const sqliteResults = await sqliteSearch({
    databasePath: store.sqlitePath,
    kind,
    query: cleanEntityName(query),
  });
  if (sqliteResults === null) {
    throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
  }

  return sqliteResults.map(
    (result: {
      id: string;
      label: string;
      description?: string;
      idnos: { type: string; value: string }[];
    }) => ({
      label: result.label,
      ...(result.description ? { description: result.description } : {}),
      uri: internalEntityUri(result.id),
      internal: {
        id: result.id,
        idnos: result.idnos,
        ...(result.description ? { description: result.description } : {}),
      },
    }),
  );
}

/** The entity-database lookup service, or null when not running on desktop. */
export function entityDatabaseLookupService(): AuthorityService | null {
  // Register whenever the desktop file bridge exists — the project (and thus
  // the EntityStore) may open after service registration, so the store is
  // resolved per-search, not here.
  if (typeof window === 'undefined') return null;
  if (!(window as unknown as { electronAPI?: { readFile?: unknown } }).electronAPI?.readFile) {
    return null;
  }

  const entityTypes = new Map(
    (Object.keys(LOOKUP_TYPE_TO_KIND) as NamedEntityType[]).map((name) => [name, { name }]),
  );

  return {
    id: ENTITY_DATABASE_SERVICE_ID,
    name: ENTITY_DATABASE_SERVICE_NAME,
    description: "This project's own entity database (entities.xml)",
    entityTypes,
    isLocal: true,
    search,
  };
}
