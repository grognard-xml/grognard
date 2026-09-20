/** Pre-compiled NDJSON packs under `<entityDbFolder>/authority-packs/`. */

export const AUTHORITY_PACKS_DIRNAME = 'authority-packs';

export type AuthorityPackId =
  | 'cbdb-persons'
  | 'cbdb-concordance'
  | 'cbdb-places'
  | 'cbdb-offices'
  | 'dila-persons'
  | 'dila-places'
  | 'chgis-places'
  /** UI-only: expands to {@link WIKIDATA_PERSON_CHILD_PACK_IDS} at load time. */
  | 'wikidata-persons'
  | 'wikidata-persons-ming'
  | 'wikidata-persons-qing'
  | 'wikidata-persons-pre-ming'
  | 'wikidata-persons-ja'
  | 'wikidata-persons-bo'
  | 'bdrc-persons-bo'
  | 'bdrc-places-bo'
  | 'wikidata-places-zh-hant'
  | 'wikidata-places-ja'
  | 'wikidata-places-bo'
  | 'wikidata-orgs-zh-hant'
  | 'wikidata-orgs-ja'
  | 'wikidata-orgs-bo'
  | 'wikidata-works-zh-hant'
  | 'wikidata-works-ja'
  /** Precompiled VIAF ↔ Wikidata pairs (P214) for live disambiguation merge. */
  | 'wikidata-viaf-concordance'
  /** Precompiled BDRC ↔ Wikidata pairs (P2477) for live lookup badges/merge. */
  | 'wikidata-bdrc-concordance'
  | 'ndl-persons'
  | 'ndl-places'
  | 'ndl-orgs'
  | 'ndl-works'
  | 'norbert-persons'
  | 'norbert-person-wrappers'
  | 'norbert-offices'
  /** Norbert office parentOf edges (sidecar — compound-office procedural gloss input). */
  | 'norbert-office-relations'
  | 'norbert-wiki-nt'
  /** Precompiled Norbert ↔ CBDB/DILA/Wikidata person links. */
  | 'norbert-concordance'
  | 'noble-title-filter'
  /** Gap-fill English office glosses (sidecar — not a tag-bomb seed pack). */
  | 'huckbot5000-translations'
  /** Local Hucker collision archive (sidecar — internal plugin only). */
  | 'huckbot5000-insiders'
  /** French office glosses (sidecar — not a tag-bomb seed pack). */
  | 'maxiricci7000-translations'
  /** Project entity database (PEDB) — read live from entities.xml, not a file pack. */
  | 'pedb-persons'
  | 'pedb-places'
  | 'pedb-orgs'
  | 'pedb-works'
  | 'pedb-things'
  /** Central entity database (CEDB) — read live from the central entities.xml. */
  | 'cedb-persons'
  | 'cedb-places'
  | 'cedb-orgs'
  | 'cedb-works'
  | 'cedb-things'
  /** This project's already-tagged mentions (disambiguated and not), crawled live. */
  | 'project-persons'
  | 'project-places'
  | 'project-orgs'
  | 'project-offices'
  | 'project-works'
  | 'project-things'
  /** User-imported CSV/TSV/xlsx/ODS list(s), parsed live in the tag-bomb panel. */
  | 'list-persons'
  | 'list-places'
  | 'list-orgs'
  | 'list-offices'
  | 'list-works'
  | 'list-things';

/** Dynasty-scoped Wikidata NDJSON packs (installed separately; selected via `wikidata-persons`). */
export const WIKIDATA_PERSON_CHILD_PACK_IDS = [
  'wikidata-persons-pre-ming',
  'wikidata-persons-ming',
  'wikidata-persons-qing',
] as const satisfies readonly AuthorityPackId[];

const WIKIDATA_PERSON_CHILD_SET = new Set<AuthorityPackId>(WIKIDATA_PERSON_CHILD_PACK_IDS);

export interface AuthorityPackSpec {
  id: AuthorityPackId;
  label: string;
  source:
    | 'cbdb'
    | 'dila'
    | 'chgis'
    | 'wikidata'
    | 'bdrc'
    | 'ndl'
    | 'norbert'
    | 'huckbot5000'
    | 'maxiricci7000'
    | 'pedb'
    | 'cedb'
    | 'project'
    | 'list';
  relativePath: string;
  defaultTag: string;
  /** When true, {@link expandAuthorityPackIds} loads {@link WIKIDATA_PERSON_CHILD_PACK_IDS}. */
  virtual?: boolean;
  /**
   * Where the candidates come from at run time. Omitted (default `'file'`)
   * means the usual NDJSON pack under `authority-packs/`, read via
   * `readPackFile`/`packPath()`. Non-file origins have `relativePath: ''`
   * and are never passed to `packPath()` — the tag-bomb runner routes them
   * to a live source instead (entities.xml for pedb/cedb, a project crawl
   * for project, parsed import files for list).
   */
  origin?: 'file' | 'pedb' | 'cedb' | 'project' | 'list';
}

/** `spec.origin`, defaulting to `'file'` when omitted (existing NDJSON packs). */
export function authorityPackOrigin(
  spec: AuthorityPackSpec,
): NonNullable<AuthorityPackSpec['origin']> {
  return spec.origin ?? 'file';
}

export const AUTHORITY_PACKS: AuthorityPackSpec[] = [
  {
    id: 'cbdb-concordance',
    label: 'CBDB person concordance',
    source: 'cbdb',
    relativePath: 'cbdb/person-concordance.ndjson',
    defaultTag: '',
  },
  {
    id: 'cbdb-persons',
    label: 'CBDB persons',
    source: 'cbdb',
    relativePath: 'cbdb/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'cbdb-places',
    label: 'CBDB places',
    source: 'cbdb',
    relativePath: 'cbdb/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'cbdb-offices',
    label: 'CBDB offices (官名)',
    source: 'cbdb',
    relativePath: 'cbdb/offices.ndjson',
    defaultTag: 'roleName',
  },
  {
    id: 'dila-persons',
    label: 'DILA persons',
    source: 'dila',
    relativePath: 'dila/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'dila-places',
    label: 'DILA places',
    source: 'dila',
    relativePath: 'dila/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'chgis-places',
    label: 'CHGIS historical places',
    source: 'chgis',
    relativePath: 'chgis/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'wikidata-persons',
    label: 'Wikidata persons',
    source: 'wikidata',
    relativePath: '',
    defaultTag: 'persName',
    virtual: true,
  },
  {
    id: 'wikidata-persons-ming',
    label: 'Wikidata persons (Ming, zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/person-zh-hant-ming/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'wikidata-persons-qing',
    label: 'Wikidata persons (Qing, zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/person-zh-hant-qing/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'wikidata-persons-pre-ming',
    label: 'Wikidata persons (pre-Ming, zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/person-zh-hant-pre-ming/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'wikidata-persons-ja',
    label: 'Wikidata persons (Japan, ja)',
    source: 'wikidata',
    relativePath: 'wikidata/person-ja-japan/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'wikidata-persons-bo',
    label: 'Wikidata persons (bo)',
    source: 'wikidata',
    relativePath: 'wikidata/person-bo/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'bdrc-persons-bo',
    label: 'BDRC persons (bo)',
    source: 'bdrc',
    relativePath: 'bdrc/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'bdrc-places-bo',
    label: 'BDRC places (bo)',
    source: 'bdrc',
    relativePath: 'bdrc/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'wikidata-places-zh-hant',
    label: 'Wikidata places (zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/place-zh-hant/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'wikidata-places-ja',
    label: 'Wikidata places (ja)',
    source: 'wikidata',
    relativePath: 'wikidata/place-ja/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'wikidata-places-bo',
    label: 'Wikidata places (bo)',
    source: 'wikidata',
    relativePath: 'wikidata/place-bo/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'wikidata-orgs-zh-hant',
    label: 'Wikidata organizations (zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/org-zh-hant/orgs.ndjson',
    defaultTag: 'orgName',
  },
  {
    id: 'wikidata-orgs-ja',
    label: 'Wikidata organizations (ja)',
    source: 'wikidata',
    relativePath: 'wikidata/org-ja/orgs.ndjson',
    defaultTag: 'orgName',
  },
  {
    id: 'wikidata-orgs-bo',
    label: 'Wikidata organizations (bo)',
    source: 'wikidata',
    relativePath: 'wikidata/org-bo/orgs.ndjson',
    defaultTag: 'orgName',
  },
  {
    id: 'wikidata-works-zh-hant',
    label: 'Wikidata works (zh-hant)',
    source: 'wikidata',
    relativePath: 'wikidata/work-zh-hant/works.ndjson',
    defaultTag: 'title',
  },
  {
    id: 'wikidata-works-ja',
    label: 'Wikidata works (ja)',
    source: 'wikidata',
    relativePath: 'wikidata/work-ja/works.ndjson',
    defaultTag: 'title',
  },
  {
    id: 'wikidata-viaf-concordance',
    label: 'Wikidata ↔ VIAF concordance',
    source: 'wikidata',
    relativePath: 'wikidata/viaf-wikidata-concordance.ndjson',
    defaultTag: '',
  },
  {
    id: 'wikidata-bdrc-concordance',
    label: 'Wikidata ↔ BDRC concordance',
    source: 'wikidata',
    relativePath: 'wikidata/bdrc-wikidata-concordance.ndjson',
    defaultTag: '',
  },
  {
    id: 'ndl-persons',
    label: 'NDL persons',
    source: 'ndl',
    relativePath: 'ndl/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'ndl-places',
    label: 'NDL places',
    source: 'ndl',
    relativePath: 'ndl/places.ndjson',
    defaultTag: 'placeName',
  },
  {
    id: 'ndl-orgs',
    label: 'NDL organizations',
    source: 'ndl',
    relativePath: 'ndl/orgs.ndjson',
    defaultTag: 'orgName',
  },
  {
    id: 'ndl-works',
    label: 'NDL works',
    source: 'ndl',
    relativePath: 'ndl/works.ndjson',
    defaultTag: 'title',
  },
  {
    id: 'norbert-concordance',
    label: 'Norbert person concordance',
    source: 'norbert',
    relativePath: 'norbert/concordance.ndjson',
    // Sidecar only — never a seed pack for tag-bomb matching.
    defaultTag: '',
  },
  {
    id: 'norbert-persons',
    label: 'Norbert persons',
    source: 'norbert',
    relativePath: 'norbert/persons.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'norbert-person-wrappers',
    label: 'Norbert person wrappers',
    source: 'norbert',
    relativePath: 'norbert/person-wrappers.ndjson',
    // Indexed as person candidates; the wrapper candidate itself emits <name>.
    defaultTag: 'persName',
  },
  {
    id: 'norbert-offices',
    label: 'Norbert offices (官名)',
    source: 'norbert',
    relativePath: 'norbert/offices.ndjson',
    defaultTag: 'roleName',
  },
  {
    id: 'norbert-office-relations',
    label: 'Norbert office parentOf edges',
    source: 'norbert',
    relativePath: 'norbert/office-relations.ndjson',
    // Sidecar only — never a seed pack for tag-bomb matching.
    defaultTag: '',
  },
  {
    id: 'huckbot5000-translations',
    label: 'Huckbot5000 office translations',
    source: 'huckbot5000',
    relativePath: 'huckbot5000/translations.ndjson',
    // Gloss sidecar only — never a seed pack for tag-bomb matching.
    defaultTag: '',
  },
  {
    id: 'huckbot5000-insiders',
    label: 'Huckbot5000 insiders (Hucker, local)',
    source: 'huckbot5000',
    relativePath: 'huckbot5000-insiders/translations.ndjson',
    // Gloss sidecar only — never a seed pack; internal plugin install.
    defaultTag: '',
  },
  {
    id: 'maxiricci7000-translations',
    label: 'MaxiRicci7000 French office translations',
    source: 'maxiricci7000',
    relativePath: 'maxiricci7000/translations.ndjson',
    // Gloss sidecar only — never a seed pack for tag-bomb matching.
    defaultTag: '',
  },
  {
    id: 'norbert-wiki-nt',
    label: 'Norbert wiki noble titles',
    source: 'norbert',
    relativePath: 'norbert/wiki-nt-links.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'noble-title-filter',
    label: 'Reviewed noble titles',
    source: 'norbert',
    relativePath: 'noble-title-filter/noble-titles.ndjson',
    defaultTag: 'persName',
  },
  {
    id: 'pedb-persons',
    label: 'PEDB persons',
    source: 'pedb',
    relativePath: '',
    defaultTag: 'persName',
    origin: 'pedb',
  },
  {
    id: 'pedb-places',
    label: 'PEDB places',
    source: 'pedb',
    relativePath: '',
    defaultTag: 'placeName',
    origin: 'pedb',
  },
  {
    id: 'pedb-orgs',
    label: 'PEDB organizations',
    source: 'pedb',
    relativePath: '',
    defaultTag: 'orgName',
    origin: 'pedb',
  },
  {
    id: 'pedb-works',
    label: 'PEDB works',
    source: 'pedb',
    relativePath: '',
    defaultTag: 'title',
    origin: 'pedb',
  },
  {
    id: 'pedb-things',
    label: 'PEDB things',
    source: 'pedb',
    relativePath: '',
    defaultTag: 'rs',
    origin: 'pedb',
  },
  {
    id: 'cedb-persons',
    label: 'CEDB persons',
    source: 'cedb',
    relativePath: '',
    defaultTag: 'persName',
    origin: 'cedb',
  },
  {
    id: 'cedb-places',
    label: 'CEDB places',
    source: 'cedb',
    relativePath: '',
    defaultTag: 'placeName',
    origin: 'cedb',
  },
  {
    id: 'cedb-orgs',
    label: 'CEDB organizations',
    source: 'cedb',
    relativePath: '',
    defaultTag: 'orgName',
    origin: 'cedb',
  },
  {
    id: 'cedb-works',
    label: 'CEDB works',
    source: 'cedb',
    relativePath: '',
    defaultTag: 'title',
    origin: 'cedb',
  },
  {
    id: 'cedb-things',
    label: 'CEDB things',
    source: 'cedb',
    relativePath: '',
    defaultTag: 'rs',
    origin: 'cedb',
  },
  {
    id: 'project-persons',
    label: 'Project tags: persons',
    source: 'project',
    relativePath: '',
    defaultTag: 'persName',
    origin: 'project',
  },
  {
    id: 'project-places',
    label: 'Project tags: places',
    source: 'project',
    relativePath: '',
    defaultTag: 'placeName',
    origin: 'project',
  },
  {
    id: 'project-orgs',
    label: 'Project tags: organizations',
    source: 'project',
    relativePath: '',
    defaultTag: 'orgName',
    origin: 'project',
  },
  {
    id: 'project-offices',
    label: 'Project tags: offices',
    source: 'project',
    relativePath: '',
    defaultTag: 'roleName',
    origin: 'project',
  },
  {
    id: 'project-works',
    label: 'Project tags: works',
    source: 'project',
    relativePath: '',
    defaultTag: 'title',
    origin: 'project',
  },
  {
    id: 'project-things',
    label: 'Project tags: things',
    source: 'project',
    relativePath: '',
    defaultTag: 'rs',
    origin: 'project',
  },
  {
    id: 'list-persons',
    label: 'Imported list: persons',
    source: 'list',
    relativePath: '',
    defaultTag: 'persName',
    origin: 'list',
  },
  {
    id: 'list-places',
    label: 'Imported list: places',
    source: 'list',
    relativePath: '',
    defaultTag: 'placeName',
    origin: 'list',
  },
  {
    id: 'list-orgs',
    label: 'Imported list: organizations',
    source: 'list',
    relativePath: '',
    defaultTag: 'orgName',
    origin: 'list',
  },
  {
    id: 'list-offices',
    label: 'Imported list: offices',
    source: 'list',
    relativePath: '',
    defaultTag: 'roleName',
    origin: 'list',
  },
  {
    id: 'list-works',
    label: 'Imported list: works',
    source: 'list',
    relativePath: '',
    defaultTag: 'title',
    origin: 'list',
  },
  {
    id: 'list-things',
    label: 'Imported list: things',
    source: 'list',
    relativePath: '',
    defaultTag: 'rs',
    origin: 'list',
  },
];

export interface AuthorityPackSelection {
  packs: AuthorityPackId[];
  yearRange?: { start: number; end: number };
  hideUndated?: boolean;
}

/** Date range supplied to the desktop pack reader for range-aware chunk selection. */
export interface AuthorityPackDateFilter {
  mode: 'none' | 'limit' | 'exclude';
  start: number;
  end: number;
}

export interface AuthorityPackStatus {
  id: AuthorityPackId;
  label: string;
  installed: boolean;
  bytes?: number;
  entityCount?: number;
  source?: AuthorityPackSpec['source'];
  attribution?: string;
}

/** Runtime packs registered by enabled plugins (see plugins/registry.ts). */
let dynamicAuthorityPackSpecs: AuthorityPackSpec[] = [];

export function setDynamicAuthorityPackSpecs(specs: AuthorityPackSpec[]): void {
  dynamicAuthorityPackSpecs = specs;
}

export function getAuthorityPackSpec(
  packId: AuthorityPackId | string,
): AuthorityPackSpec | undefined {
  return (
    dynamicAuthorityPackSpecs.find((p) => p.id === packId) ??
    AUTHORITY_PACKS.find((p) => p.id === packId)
  );
}

export function packPath(baseFolder: string, packId: AuthorityPackId | string): string {
  const spec = getAuthorityPackSpec(packId);
  if (!spec) throw new Error(`Unknown pack: ${packId}`);
  if (spec.virtual) {
    throw new Error(`Pack ${packId} is a UI grouping — expand with expandAuthorityPackIds() first`);
  }
  if (authorityPackOrigin(spec) !== 'file') {
    throw new Error(`Pack ${packId} has no NDJSON file — origin is ${authorityPackOrigin(spec)}`);
  }
  const sep = baseFolder.includes('\\') ? '\\' : '/';
  return `${baseFolder.replace(/[/\\]+$/, '')}${sep}${AUTHORITY_PACKS_DIRNAME}${sep}${spec.relativePath.replace(/\//g, sep)}`;
}

/** Pack ids shown in the auto-tagging authority dialog (one Wikidata row, not per-dynasty). */
export const UI_AUTHORITY_PACK_IDS: AuthorityPackId[] = [
  'cbdb-persons',
  'cbdb-places',
  'cbdb-offices',
  'dila-persons',
  'dila-places',
  'chgis-places',
  'wikidata-persons',
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
  'norbert-offices',
  'norbert-wiki-nt',
  'noble-title-filter',
  'pedb-persons',
  'pedb-places',
  'pedb-orgs',
  'pedb-works',
  'pedb-things',
  'cedb-persons',
  'cedb-places',
  'cedb-orgs',
  'cedb-works',
  'cedb-things',
  'project-persons',
  'project-places',
  'project-orgs',
  'project-offices',
  'project-works',
  'project-things',
  'list-persons',
  'list-places',
  'list-orgs',
  'list-offices',
  'list-works',
  'list-things',
];

/** Expand virtual selections (e.g. `wikidata-persons` → all installed dynasty packs). */
export function expandAuthorityPackIds(packIds: AuthorityPackId[]): AuthorityPackId[] {
  const out: AuthorityPackId[] = [];
  for (const id of packIds) {
    if (id === 'wikidata-persons') out.push(...WIKIDATA_PERSON_CHILD_PACK_IDS);
    else out.push(id);
  }
  return [...new Set(out)];
}

export function isWikidataPersonChildPackId(id: AuthorityPackId): boolean {
  return WIKIDATA_PERSON_CHILD_SET.has(id);
}

/** Map persisted pack ids (incl. legacy per-dynasty Wikidata) to UI checkbox state. */
export function uiPacksFromPersisted(
  persisted?: AuthorityPackId[],
): Record<AuthorityPackId, boolean> {
  const base = Object.fromEntries(UI_AUTHORITY_PACK_IDS.map((id) => [id, false])) as Record<
    AuthorityPackId,
    boolean
  >;
  if (!persisted?.length) return base;
  for (const id of UI_AUTHORITY_PACK_IDS) {
    if (id === 'wikidata-persons') continue;
    base[id] = persisted.includes(id);
  }
  base['wikidata-persons'] =
    persisted.includes('wikidata-persons') ||
    WIKIDATA_PERSON_CHILD_PACK_IDS.some((id) => persisted.includes(id));
  return base;
}

/** Persist UI checkbox state (stores `wikidata-persons`, not dynasty child ids). */
export function persistedPacksFromUi(packs: Record<AuthorityPackId, boolean>): AuthorityPackId[] {
  return UI_AUTHORITY_PACK_IDS.filter((id) => packs[id]);
}

export function packsRoot(baseFolder: string): string {
  const sep = baseFolder.includes('\\') ? '\\' : '/';
  return `${baseFolder.replace(/[/\\]+$/, '')}${sep}${AUTHORITY_PACKS_DIRNAME}`;
}

/** Display order for authority pack checkboxes (grouped by entity type, not source). */
export const AUTHORITY_TAG_TYPE_GROUP_ORDER = [
  'persName',
  'placeName',
  'orgName',
  'roleName',
  'title',
  'rs',
] as const;

export const AUTHORITY_TAG_TYPE_GROUP_LABELS: Record<
  (typeof AUTHORITY_TAG_TYPE_GROUP_ORDER)[number],
  string
> = {
  persName: 'Persons',
  placeName: 'Places',
  orgName: 'Organizations',
  roleName: 'Offices / roles',
  title: 'Works',
  rs: 'Things',
};

export interface AuthorityPackTypeGroup {
  tag: (typeof AUTHORITY_TAG_TYPE_GROUP_ORDER)[number];
  label: string;
  packs: AuthorityPackSpec[];
}

/** Group visible pack specs by TEI tag type (persName, placeName, …). */
export function groupAuthorityPacksByTagType(packIds: AuthorityPackId[]): AuthorityPackTypeGroup[] {
  const specs = packIds
    .map((id) => AUTHORITY_PACKS.find((p) => p.id === id))
    .filter((p): p is AuthorityPackSpec => !!p);
  const groups: AuthorityPackTypeGroup[] = [];
  for (const tag of AUTHORITY_TAG_TYPE_GROUP_ORDER) {
    const packs = specs.filter((p) => p.defaultTag === tag);
    if (packs.length > 0) {
      groups.push({ tag, label: AUTHORITY_TAG_TYPE_GROUP_LABELS[tag], packs });
    }
  }
  return groups;
}

export const AUTHORITY_SOURCE_ORDER = [
  'pedb',
  'cedb',
  'cbdb',
  'dila',
  'chgis',
  'wikidata',
  'bdrc',
  'ndl',
  'norbert',
  'huckbot5000',
  'maxiricci7000',
  'project',
  'list',
] as const;

export type AuthoritySourceId = (typeof AUTHORITY_SOURCE_ORDER)[number];

export const AUTHORITY_SOURCE_LABELS: Record<AuthoritySourceId, string> = {
  pedb: 'User database (project)',
  cedb: 'User database (central)',
  cbdb: 'CBDB',
  dila: 'DILA',
  chgis: 'CHGIS',
  wikidata: 'Wikidata',
  bdrc: 'BDRC',
  ndl: 'NDL',
  norbert: 'Norbert',
  huckbot5000: 'Huckbot5000',
  maxiricci7000: 'MaxiRicci7000',
  project: 'Project tags',
  list: 'Imported list',
};

/** Short row label under a source heading (Persons, Places, …). */
export const AUTHORITY_PACK_SHORT_LABELS: Partial<Record<AuthorityPackId, string>> = {
  'cbdb-persons': 'Persons',
  'cbdb-places': 'Places',
  'cbdb-offices': 'Offices',
  'dila-persons': 'Persons',
  'dila-places': 'Places',
  'chgis-places': 'Places',
  'wikidata-persons': 'Persons',
  'wikidata-persons-ja': 'Persons (ja)',
  'wikidata-persons-bo': 'Persons (bo)',
  'bdrc-persons-bo': 'Persons (bo)',
  'wikidata-places-zh-hant': 'Places (zh-hant)',
  'bdrc-places-bo': 'Places (bo)',
  'wikidata-places-ja': 'Places (ja)',
  'wikidata-places-bo': 'Places (bo)',
  'wikidata-orgs-zh-hant': 'Organizations (zh-hant)',
  'wikidata-orgs-ja': 'Organizations (ja)',
  'wikidata-orgs-bo': 'Organizations (bo)',
  'wikidata-works-zh-hant': 'Works (zh-hant)',
  'wikidata-works-ja': 'Works (ja)',
  'ndl-persons': 'Persons',
  'ndl-places': 'Places',
  'ndl-orgs': 'Organizations',
  'ndl-works': 'Works',
  'norbert-persons': 'Persons',
  'norbert-person-wrappers': 'Persons',
  'norbert-offices': 'Offices',
  'norbert-wiki-nt': 'Persons',
  'noble-title-filter': 'Reviewed titles',
  'pedb-persons': 'Persons',
  'pedb-places': 'Places',
  'pedb-orgs': 'Organizations',
  'pedb-works': 'Works',
  'pedb-things': 'Things',
  'cedb-persons': 'Persons',
  'cedb-places': 'Places',
  'cedb-orgs': 'Organizations',
  'cedb-works': 'Works',
  'cedb-things': 'Things',
  'project-persons': 'Persons',
  'project-places': 'Places',
  'project-orgs': 'Organizations',
  'project-offices': 'Offices',
  'project-works': 'Works',
  'project-things': 'Things',
  'list-persons': 'Persons',
  'list-places': 'Places',
  'list-orgs': 'Organizations',
  'list-offices': 'Offices',
  'list-works': 'Works',
  'list-things': 'Things',
};

export interface AuthorityPackSourceGroup {
  source: AuthoritySourceId;
  label: string;
  packs: AuthorityPackSpec[];
}

/** Group visible pack specs by authority source (CBDB, DILA, …). */
export function groupAuthorityPacksBySource(
  packIds: AuthorityPackId[],
): AuthorityPackSourceGroup[] {
  const specs = packIds
    .map((id) => AUTHORITY_PACKS.find((p) => p.id === id))
    .filter((p): p is AuthorityPackSpec => !!p);
  const groups: AuthorityPackSourceGroup[] = [];
  for (const source of AUTHORITY_SOURCE_ORDER) {
    const packs = specs.filter((p) => p.source === source);
    if (packs.length > 0) {
      groups.push({ source, label: AUTHORITY_SOURCE_LABELS[source], packs });
    }
  }
  return groups;
}

export function shortAuthorityPackLabel(packId: AuthorityPackId): string {
  return (
    AUTHORITY_PACK_SHORT_LABELS[packId] ??
    AUTHORITY_PACKS.find((p) => p.id === packId)?.label ??
    packId
  );
}
