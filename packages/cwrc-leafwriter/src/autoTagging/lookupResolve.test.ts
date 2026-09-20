import { addEntity, findEntity } from './entities';
import {
  attachAuthority,
  addEntityName,
  listEntities,
  listEntityAssertions,
  getFamilyName,
  getGivenName,
  setEntityDescription,
  setFamilyName,
  setGivenName,
  setRomanizedName,
  setUserEntityDate,
} from './entityOps';
import { EntityStore, type EntityFileApi } from './entityStore';
import { resolveEntityStorePaths } from './entityStoreResolve';
import {
  applyLookupResolution,
  appendExtraAuthorityIds,
  crosswalkForRef,
  linkLocalEntityWithoutAuthority,
  linkWithoutEnrichment,
  parseAuthorityUri,
  planLookupResolution,
  type LookupSelectionInput,
} from './lookupResolve';
import type { AuthorityPackId } from './packPaths';
import { SQLITE_REQUIRED_LOOKUP_MESSAGE } from './sqliteRequired';

class FakeFs implements EntityFileApi {
  files = new Map<string, string>();
  dirs = new Set<string>();
  ensureDirectory = async (dir: string) => {
    this.dirs.add(dir);
  };
  pathExists = async (path: string) => this.files.has(path);
  readFile = async (path: string) => {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  };
  writeFile = async (path: string, content: string) => {
    this.files.set(path, content);
  };
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Mark `.sqlite` present and mirror typed SQLite writes into the sibling XML for assertions. */
const wireSqliteLookupWrites = (store: EntityStore, fs: FakeFs) => {
  fs.files.set('/proj/entities.sqlite', 'sqlite-placeholder');
  const g = globalThis as { window?: { electronAPI?: Record<string, unknown> } };
  g.window = g.window ?? { electronAPI: {} };
  g.window.electronAPI = {
    ...(g.window.electronAPI ?? {}),
    entitySqliteCreatePopulated: async () => ({}),
    entitySqliteAttachAuthority: async () => true,
  };

  jest.spyOn(store, 'sqliteCreatePopulated').mockImplementation(async (input) => {
    const doc = await store.loadEntities();
    const primary = input.names?.find((name) => name.isPrimary) ??
      input.names?.[0] ?? { text: 'unnamed' };
    const romanized = input.names?.find((name) => name !== primary && name.text !== primary.text);
    const { element } = addEntity(doc, input.kind, {
      name: primary.text,
      nameLang: primary.language ?? undefined,
      romanizedName: romanized?.text,
      description: input.description ?? undefined,
      authorityIds: (input.authorities ?? []).map((a) => ({ type: a.type, value: a.value })),
    });
    element.setAttributeNS(XML_NS, 'xml:id', input.id);
    if (input.familyName) setFamilyName(doc, input.id, input.familyName);
    if (input.givenName) setGivenName(doc, input.id, input.givenName);
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
    return {};
  });

  jest.spyOn(store, 'sqliteAttachAuthority').mockImplementation(async (entityId, type, value) => {
    const doc = await store.loadEntities();
    const attached = attachAuthority(doc, entityId, { type, value });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
    return attached;
  });

  jest.spyOn(store, 'sqliteSetUserDate').mockImplementation(async ({ entityId, part, year }) => {
    const doc = await store.loadEntities();
    setUserEntityDate(doc, entityId, part, year);
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
  });

  jest.spyOn(store, 'sqliteUpdateDescription').mockImplementation(async (entityId, description) => {
    const doc = await store.loadEntities();
    setEntityDescription(doc, entityId, description ?? '');
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
  });

  jest.spyOn(store, 'sqliteAddNationality').mockImplementation(async () => true);
  jest.spyOn(store, 'sqliteAddOrigin').mockImplementation(async () => true);

  jest
    .spyOn(store, 'sqliteSetRomanizedName')
    .mockImplementation(async (entityId, text, language) => {
      const doc = await store.loadEntities();
      setRomanizedName(doc, entityId, text, language ?? undefined);
      await store.saveEntities(doc, { allowSqliteFullReimport: true });
    });

  jest.spyOn(store, 'sqliteAddName').mockImplementation(async (input) => {
    const doc = await store.loadEntities();
    addEntityName(doc, input.entityId, input.text, {
      type: input.nameType as
        'family' | 'given' | 'variant' | 'courtesy' | 'posthumous' | undefined,
      lang: input.language ?? undefined,
      origin: input.origin,
      source: input.source ?? undefined,
    });
    if (input.nameType === 'family') setFamilyName(doc, input.entityId, input.text);
    if (input.nameType === 'given') setGivenName(doc, input.entityId, input.text);
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
    return true;
  });

  jest.spyOn(store, 'sqliteSearchNames').mockImplementation(async (kind, query) => {
    const doc = await store.loadEntities();
    const surface = query.normalize('NFC');
    return listEntities(doc)
      .filter((row) => row.kind === kind)
      .filter((row) => row.names.some((name) => name.normalize('NFC') === surface))
      .slice(0, 20)
      .map((row) => ({
        id: row.id,
        label: row.names[0] ?? row.id,
        description: row.description ?? undefined,
        idnos: row.authorities,
      }));
  });

  jest.spyOn(store, 'sqliteFindAllByAuthority').mockImplementation(async (kind, type, value) => {
    const doc = await store.loadEntities();
    const wantedType = type.trim().toLowerCase();
    const wantedValue = value.trim();
    return listEntities(doc)
      .filter((row) => row.kind === kind)
      .filter((row) =>
        row.authorities.some(
          (authority) =>
            authority.type.toLowerCase() === wantedType && authority.value.trim() === wantedValue,
        ),
      )
      .map((row) => row.id);
  });

  jest.spyOn(store, 'sqliteEntitySummary').mockImplementation(async (entityId) => {
    const doc = await store.loadEntities();
    const summary = listEntities(doc).find((row) => row.id === entityId);
    if (!summary) return null;
    return {
      id: summary.id,
      kind: summary.kind,
      description: summary.description,
      names: summary.nameEntries.map((entry) => ({
        text: entry.text,
        nameType: entry.type,
        language: entry.lang,
        status: 'active' as const,
      })),
      authorities: summary.authorities,
      familyName: summary.familyName,
      givenName: summary.givenName,
      startYear: summary.startYear,
      endYear: summary.endYear,
      workDate: summary.workDate,
      nationalities: summary.nationalities,
      placesOfOrigin: summary.placesOfOrigin,
      roles: summary.roles,
      origins: summary.origins,
      authors: summary.authors,
      nobleTitles: summary.nobleTitles,
      assertions: summary.assertions ?? [],
    };
  });
};

const makeStore = (opts: { sqlite?: boolean } = { sqlite: true }) => {
  const fs = new FakeFs();
  const store = new EntityStore(fs, resolveEntityStorePaths({ projectRoot: '/proj' }));
  if (opts.sqlite !== false) wireSqliteLookupWrites(store, fs);
  return { fs, store };
};

const input = (over: Partial<LookupSelectionInput> = {}): LookupSelectionInput => ({
  uri: 'https://www.wikidata.org/wiki/Q712570',
  label: '沈攸之',
  entityType: 'person',
  query: '攸之',
  ...over,
});

const ndjsonLine = (row: object) => JSON.stringify(row);

const packRow = ndjsonLine({
  source: 'cbdb',
  authorityId: '31305',
  kind: 'person',
  primaryName: '沈攸之',
  searchStrings: ['沈攸之', '攸之'],
  names: [
    { text: '沈攸之', type: 'primary' },
    { text: '沈', type: 'family' },
    { text: '攸之', type: 'given' },
  ],
  metadata: {
    description: 'Liu-Song general, d. 478',
    startYear: 420,
    endYear: 478,
    crosswalk: { wikidata: ['Q712570'], dila: 'A001492' },
  },
});

const readPackFile = async (_packId: AuthorityPackId) => packRow + '\n';
const packIds: AuthorityPackId[] = ['cbdb-persons'];

const dilaPackRow = ndjsonLine({
  source: 'DILA',
  authorityId: 'A003126',
  kind: 'person',
  primaryName: '徐孝嗣',
  searchStrings: ['徐孝嗣', '徐始昌'],
  metadata: {
    description: '徐孝嗣 (453–499, 南齊, 徐湛之孫，徐聿之子)',
    startYear: 453,
    endYear: 499,
    crosswalk: { wikidata: ['Q11070461'], cbdb: '193924' },
  },
});

const readDilaPackFile = async (_packId: AuthorityPackId) => dilaPackRow + '\n';
const dilaPackIds: AuthorityPackId[] = ['dila-persons'];

describe('parseAuthorityUri', () => {
  it('parses known authority URIs', () => {
    expect(parseAuthorityUri('https://www.wikidata.org/wiki/Q712570')).toEqual({
      idnoType: 'Wikidata',
      crosswalkKey: 'wikidata',
      value: 'Q712570',
    });
    expect(parseAuthorityUri('http://www.wikidata.org/entity/q712570')?.value).toBe('Q712570');
    expect(parseAuthorityUri('https://viaf.org/viaf/12345/')).toMatchObject({
      idnoType: 'VIAF',
      value: '12345',
    });
    expect(
      parseAuthorityUri('https://cbdb.fas.harvard.edu/cbdbapi/person.php?id=31305'),
    ).toMatchObject({
      idnoType: 'CBDB',
      value: '31305',
    });
    // legacy CBDB link format, still parseable
    expect(parseAuthorityUri('https://cbdb.fas.harvard.edu/person?id=31305')).toMatchObject({
      idnoType: 'CBDB',
      value: '31305',
    });
    expect(
      parseAuthorityUri('https://authority.dila.edu.tw/person/?fromInner=A001492'),
    ).toMatchObject({ idnoType: 'DILA', value: 'A001492' });
    expect(
      parseAuthorityUri('https://authority.dila.edu.tw/place/?fromInner=PL000000030584'),
    ).toMatchObject({ idnoType: 'DILA', value: 'PL000000030584' });
    // legacy link formats, still parseable
    expect(
      parseAuthorityUri('https://authority.dila.edu.tw/person/search.php?code=A001492'),
    ).toMatchObject({ idnoType: 'DILA', value: 'A001492' });
    expect(
      parseAuthorityUri('https://authority.dila.edu.tw/person/search.php?aid=A001492'),
    ).toMatchObject({ idnoType: 'DILA', value: 'A001492' });
    expect(parseAuthorityUri('https://id.ndl.go.jp/auth/ndlna/00270123')).toMatchObject({
      idnoType: 'NDL',
      value: '00270123',
    });
    expect(parseAuthorityUri('urn:grognard:authority:norbert:office:4135')).toEqual({
      idnoType: 'NORBERT',
      crosswalkKey: 'norbert',
      value: 'office-4135',
    });
    expect(parseAuthorityUri('urn:grognard:authority:norbert:person:12')).toEqual({
      idnoType: 'NORBERT',
      crosswalkKey: 'norbert',
      value: 'person-12',
    });
    expect(parseAuthorityUri('urn:grognard:authority:cbdb:office:42')).toEqual({
      idnoType: 'CBDB',
      crosswalkKey: 'cbdb',
      value: '42',
    });
    expect(parseAuthorityUri('https://library.bdrc.io/show/bdr:P1KG18539?s=ignored')).toEqual({
      idnoType: 'BDRC',
      crosswalkKey: 'bdrc',
      value: 'P1KG18539',
    });
    expect(parseAuthorityUri('http://purl.bdrc.io/resource/G1234')).toEqual({
      idnoType: 'BDRC',
      crosswalkKey: 'bdrc',
      value: 'G1234',
    });
  });

  it('returns null for unknown URIs', () => {
    expect(parseAuthorityUri('https://example.org/people/42')).toBeNull();
  });
});

describe('crosswalkForRef', () => {
  it('expands a wikidata ref through the pack crosswalk', async () => {
    const result = await crosswalkForRef(
      { idnoType: 'Wikidata', crosswalkKey: 'wikidata', value: 'Q712570' },
      packIds,
      readPackFile,
    );
    expect(result.idnos).toEqual(
      expect.arrayContaining([
        { type: 'Wikidata', value: 'Q712570' },
        { type: 'CBDB', value: '31305' },
        { type: 'DILA', value: 'A001492' },
      ]),
    );
    expect(result.candidate?.primaryName).toBe('沈攸之');
    expect(result.candidate?.typedNames).toEqual([
      { text: '沈', type: 'family' },
      { text: '攸之', type: 'given' },
    ]);
  });

  it('matches a ref by the pack row own id', async () => {
    const result = await crosswalkForRef(
      { idnoType: 'CBDB', crosswalkKey: 'cbdb', value: '31305' },
      packIds,
      readPackFile,
    );
    expect(result.idnos).toEqual(expect.arrayContaining([{ type: 'Wikidata', value: 'Q712570' }]));
  });
});

describe('planLookupResolution / applyLookupResolution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails loud when SQLite is missing', async () => {
    const { store } = makeStore({ sqlite: false });
    await expect(applyLookupResolution(input(), { store, packIds, readPackFile })).rejects.toThrow(
      SQLITE_REQUIRED_LOOKUP_MESSAGE,
    );
  });

  it('mints a new entity when nothing matches, carrying crosswalk idnos', async () => {
    const { store } = makeStore();
    const result = await applyLookupResolution(input(), { store, packIds, readPackFile });
    expect(result).toMatchObject({ status: 'linked', wasCreated: true });
    if (result.status !== 'linked') return;

    const doc = await store.loadEntities();
    const person = doc.getElementsByTagName('person')[0]!;
    expect(person.getAttribute('xml:id')).toBe(result.key);
    const idnoTypes = Array.from(person.getElementsByTagName('idno')).map((el) =>
      el.getAttribute('type'),
    );
    expect(idnoTypes).toEqual(expect.arrayContaining(['Wikidata', 'CBDB', 'DILA']));
    // Pack primary name preferred over the clicked label
    expect(person.getElementsByTagName('persName')[0]?.textContent).toBe('沈攸之');
    // Phase B: bare 姓/名 from pack names[] land at mint
    expect(getFamilyName(doc, result.key)).toBe('沈');
    expect(getGivenName(doc, result.key)).toBe('攸之');
    const nameTexts = Array.from(person.getElementsByTagName('persName')).map(
      (el) => el.textContent,
    );
    expect(nameTexts).toEqual(expect.arrayContaining(['沈', '攸之']));
    const assertions = listEntityAssertions(doc, result.key);
    expect(assertions.find((a) => a.element === 'birth')).toMatchObject({
      origin: 'user',
      status: 'active',
    });
    expect(assertions.find((a) => a.element === 'death')).toMatchObject({
      origin: 'user',
      status: 'active',
    });
  });

  it('falls back to the search label when the pack primaryName is blank, instead of minting a nameless entity', async () => {
    const { store } = makeStore();
    const blankNamePackRow = ndjsonLine({
      source: 'cbdb',
      authorityId: '31305',
      kind: 'person',
      primaryName: '',
      searchStrings: ['沈攸之', '攸之'],
      metadata: {
        description: 'Liu-Song general, d. 478',
        crosswalk: { wikidata: ['Q712570'] },
      },
    });
    const result = await applyLookupResolution(input(), {
      store,
      packIds,
      readPackFile: async () => blankNamePackRow + '\n',
    });
    expect(result).toMatchObject({ status: 'linked', wasCreated: true, entityName: '沈攸之' });
    if (result.status !== 'linked') return;

    const doc = await store.loadEntities();
    const person = doc.getElementsByTagName('person')[0]!;
    expect(person.getAttribute('xml:id')).toBe(result.key);
    expect(person.getElementsByTagName('persName')[0]?.textContent).toBe('沈攸之');
  });

  it('links to an existing entity on a direct idno hit and enriches it', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      authorityIds: [{ type: 'Wikidata', value: 'Q712570' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const plan = await planLookupResolution(input(), { store, packIds, readPackFile });
    expect(plan).toMatchObject({ action: 'link', key: id, matchedBy: 'direct' });

    const result = await applyLookupResolution(input(), { store, packIds, readPackFile });
    expect(result).toMatchObject({ status: 'linked', key: id, wasCreated: false });

    const after = await store.loadEntities();
    const idnos = Array.from(after.getElementsByTagName('idno')).map((el) => [
      el.getAttribute('type'),
      el.textContent,
    ]);
    expect(idnos).toEqual(
      expect.arrayContaining([
        ['CBDB', '31305'],
        ['DILA', 'A001492'],
      ]),
    );
    // Phase B: linking an existing person also pulls pack short forms
    expect(getFamilyName(after, id)).toBe('沈');
    expect(getGivenName(after, id)).toBe('攸之');
    // Phase 4: no description existed, so the merged per-authority period
    // line (§4 of the geo-disambiguation plan) seeds it non-destructively.
    const summary = await store.sqliteEntitySummary(id);
    expect(summary?.description).toBe('CBDB: 420–478');
  });

  it('never overwrites an existing description with the merged period line', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      description: "curator's own note",
      authorityIds: [{ type: 'Wikidata', value: 'Q712570' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    await applyLookupResolution(input(), { store, packIds, readPackFile });

    const summary = await store.sqliteEntitySummary(id);
    expect(summary?.description).toBe("curator's own note");
  });

  it('hydrates authority dates when linking an existing DILA entity', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '徐孝嗣',
      authorityIds: [{ type: 'DILA', value: 'A003126' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const result = await applyLookupResolution(
      input({
        uri: 'https://authority.dila.edu.tw/person/search.php?code=A003126',
        label: '徐孝嗣',
        query: '徐孝嗣',
      }),
      { store, packIds: dilaPackIds, readPackFile: readDilaPackFile },
    );
    expect(result).toMatchObject({ status: 'linked', key: id, wasCreated: false });

    const after = await store.loadEntities();
    const assertions = listEntityAssertions(after, id);
    expect(assertions.find((a) => a.element === 'birth')).toMatchObject({
      origin: 'user',
      status: 'active',
      value: '0453',
    });
    expect(assertions.find((a) => a.element === 'death')).toMatchObject({
      origin: 'user',
      status: 'active',
      value: '0499',
    });
  });

  it('writes birth/death years from authority assertions via SQLite (single user date each)', async () => {
    const { store } = makeStore();
    const combinedReadPackFile = async (packId: AuthorityPackId) =>
      packId === 'cbdb-persons' ? packRow + '\n' : dilaPackRow + '\n';

    const result = await applyLookupResolution(
      input({
        uri: 'https://cbdb.fas.harvard.edu/cbdbapi/person.php?id=31305',
        extraUris: ['https://authority.dila.edu.tw/person/?fromInner=A003126'],
      }),
      { store, packIds: ['cbdb-persons', 'dila-persons'], readPackFile: combinedReadPackFile },
    );
    expect(result).toMatchObject({ status: 'linked', wasCreated: true });
    if (result.status !== 'linked') return;

    const doc = await store.loadEntities();
    const assertions = listEntityAssertions(doc, result.key);
    // SQLite typed dates keep one user birth/death (last assertion wins), not
    // the multi-element authority provenance DOM writer used to produce.
    expect(assertions.filter((a) => a.element === 'birth')).toHaveLength(1);
    expect(assertions.filter((a) => a.element === 'death')).toHaveLength(1);
    expect(assertions.find((a) => a.element === 'birth')?.origin).toBe('user');
  });

  it('links via crosswalk when the entity only carries a CBDB idno', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      authorityIds: [{ type: 'CBDB', value: '31305' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const plan = await planLookupResolution(input(), { store, packIds, readPackFile });
    expect(plan).toMatchObject({ action: 'link', key: id, matchedBy: 'crosswalk' });
  });

  it('reports a conflict when two entities carry the same idno, without writing', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    addEntity(doc, 'person', { name: 'A', authorityIds: [{ type: 'Wikidata', value: 'Q712570' }] });
    addEntity(doc, 'person', { name: 'B', authorityIds: [{ type: 'Wikidata', value: 'Q712570' }] });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
    const before = await store.loadEntities().then((d) => d.getElementsByTagName('idno').length);

    const result = await applyLookupResolution(input(), { store, packIds, readPackFile });
    expect(result.status).toBe('conflict');
    if (result.status !== 'conflict') return;
    expect(result.candidates).toHaveLength(2);

    const after = await store.loadEntities().then((d) => d.getElementsByTagName('idno').length);
    expect(after).toBe(before);
  });

  it('reports a conflict when crosswalk ids land on two different entities', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    addEntity(doc, 'person', { name: 'A', authorityIds: [{ type: 'CBDB', value: '31305' }] });
    addEntity(doc, 'person', { name: 'B', authorityIds: [{ type: 'DILA', value: 'A001492' }] });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const plan = await planLookupResolution(input(), { store, packIds, readPackFile });
    expect(plan.action).toBe('conflict');
  });

  it('never overwrites a same-type idno with a different value; files a warning', async () => {
    const { fs, store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      authorityIds: [
        { type: 'Wikidata', value: 'Q712570' },
        { type: 'CBDB', value: '99999' },
      ],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const result = await applyLookupResolution(input(), { store, packIds, readPackFile });
    expect(result).toMatchObject({ status: 'linked', key: id });

    const after = await store.loadEntities();
    const cbdbValues = Array.from(after.getElementsByTagName('idno'))
      .filter((el) => el.getAttribute('type') === 'CBDB')
      .map((el) => el.textContent);
    expect(cbdbValues).toEqual(['99999']);

    const warnings = fs.files.get('/proj/.grognard/entity-warnings.jsonl') ?? '';
    expect(warnings).toContain('idno-conflict');
    expect(warnings).toContain('31305');
  });

  it('dedupes a pasted plain URI instead of minting twice', async () => {
    const { store } = makeStore();
    const uri = 'https://example.org/people/42';
    const first = await applyLookupResolution(input({ uri, label: 'Someone' }), { store });
    const second = await applyLookupResolution(input({ uri, label: 'Someone' }), { store });
    expect(first).toMatchObject({ status: 'linked', wasCreated: true });
    if (first.status !== 'linked') return;
    expect(second).toMatchObject({ status: 'linked', wasCreated: false, key: first.key });
  });

  it('passes through entity types outside the database', async () => {
    const { store } = makeStore();
    const result = await applyLookupResolution(input({ entityType: 'concept' }), { store });
    expect(result.status).toBe('passthrough');
  });

  it('logs a manual-lookup decision', async () => {
    const { fs, store } = makeStore();
    await applyLookupResolution(input(), { store, packIds, readPackFile });
    const log = fs.files.get('/proj/.grognard/entity-decisions.jsonl') ?? '';
    expect(log).toContain('"source":"manual-lookup"');
    expect(log).toContain('"surface":"攸之"');
  });

  it('mints one entity carrying idnos from every checked candidate (extraUris)', async () => {
    const { store } = makeStore();
    const result = await applyLookupResolution(
      input({ extraUris: ['https://viaf.org/viaf/12345/'] }),
      { store, packIds, readPackFile },
    );
    expect(result).toMatchObject({ status: 'linked', wasCreated: true });
    if (result.status !== 'linked') return;

    const doc = await store.loadEntities();
    const person = doc.getElementsByTagName('person')[0]!;
    expect(person.getAttribute('xml:id')).toBe(result.key);
    const idnos = Array.from(person.getElementsByTagName('idno')).map((el) => [
      el.getAttribute('type'),
      el.textContent,
    ]);
    expect(idnos).toEqual(
      expect.arrayContaining([
        ['Wikidata', 'Q712570'],
        ['CBDB', '31305'],
        ['DILA', 'A001492'],
        ['VIAF', '12345'],
      ]),
    );
  });

  it('links an existing entity found via an extra checked candidate, enriching with both idno sets', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      authorityIds: [{ type: 'VIAF', value: '12345' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const result = await applyLookupResolution(
      input({ extraUris: ['https://viaf.org/viaf/12345/'] }),
      { store, packIds, readPackFile },
    );
    expect(result).toMatchObject({ status: 'linked', key: id, wasCreated: false });

    const after = await store.loadEntities();
    const idnos = Array.from(after.getElementsByTagName('idno')).map((el) => [
      el.getAttribute('type'),
      el.textContent,
    ]);
    expect(idnos).toEqual(
      expect.arrayContaining([
        ['VIAF', '12345'],
        ['Wikidata', 'Q712570'],
        ['CBDB', '31305'],
      ]),
    );
  });
});

describe('appendExtraAuthorityIds', () => {
  it('attaches parsed authority ids from extra uris onto an already-linked entity', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', { name: '沈攸之' });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    await appendExtraAuthorityIds(
      id,
      ['https://www.wikidata.org/wiki/Q712570', 'https://viaf.org/viaf/12345/'],
      { store },
    );

    const after = await store.loadEntities();
    const element = findEntity(after, id)!;
    const idnos = Array.from(element.getElementsByTagName('idno')).map((el) => [
      el.getAttribute('type'),
      el.textContent,
    ]);
    expect(idnos).toEqual(
      expect.arrayContaining([
        ['Wikidata', 'Q712570'],
        ['VIAF', '12345'],
      ]),
    );
  });

  it('does not duplicate an idno the entity already carries', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', {
      name: '沈攸之',
      authorityIds: [{ type: 'Wikidata', value: 'Q712570' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    await appendExtraAuthorityIds(id, ['https://www.wikidata.org/wiki/Q712570'], { store });

    const after = await store.loadEntities();
    const element = findEntity(after, id)!;
    const wikidataIdnos = Array.from(element.getElementsByTagName('idno')).filter(
      (el) => el.getAttribute('type') === 'Wikidata',
    );
    expect(wikidataIdnos).toHaveLength(1);
  });

  it('is a no-op when no extra uris parse to a known authority', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', { name: '沈攸之' });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    await appendExtraAuthorityIds(id, ['https://example.org/people/42'], { store });

    const after = await store.loadEntities();
    const element = findEntity(after, id)!;
    expect(element.getElementsByTagName('idno')).toHaveLength(0);
  });
});

describe('linkLocalEntityWithoutAuthority', () => {
  it('mints a local-only entity and returns its key', async () => {
    const { store } = makeStore();
    const result = await linkLocalEntityWithoutAuthority('person', '江祀', { store });
    expect(result).toMatchObject({
      status: 'linked',
      entityName: '江祀',
      wasCreated: true,
    });
    expect(result.key).toMatch(/^person-[0-9a-f-]{36}$/);

    const doc = await store.loadEntities();
    const person = findEntity(doc, result.key!);
    expect(person?.getElementsByTagName('idno').length).toBe(0);
    expect(person?.getElementsByTagName('persName')[0]?.textContent).toBe('江祀');
  });

  it('reuses an existing entity when the surface matches a stored name exactly', async () => {
    const { store } = makeStore();
    const doc = await store.loadEntities();
    const { id } = addEntity(doc, 'person', { name: '江祀' });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });

    const result = await linkLocalEntityWithoutAuthority('person', '江祀', { store });
    expect(result).toMatchObject({
      status: 'linked',
      key: id,
      entityName: '江祀',
      wasCreated: false,
    });
  });

  it('splits family/given and romanizes as one concatenated word for a Chinese person with no authority match', async () => {
    const { store } = makeStore();
    const result = await linkLocalEntityWithoutAuthority('person', '周世雄', {
      store,
      projectLang: 'zh-Hant',
    });
    expect(result.wasCreated).toBe(true);

    const doc = await store.loadEntities();
    const person = findEntity(doc, result.key!);
    const romanized = Array.from(person!.getElementsByTagName('persName')).find(
      (el) => el.getAttribute('xml:lang') === 'zh-Latn',
    );
    // "Zhou Shixiong", not the per-character "Zhou Shi Xiong".
    expect(romanized?.textContent).toBe('Zhou Shixiong');

    const notes = Array.from(person!.getElementsByTagName('note'));
    expect(notes.find((n) => n.getAttribute('type') === 'familyName')?.textContent).toBe('周');
    expect(notes.find((n) => n.getAttribute('type') === 'givenName')?.textContent).toBe('世雄');
  });
});

describe('linkWithoutEnrichment', () => {
  it('links the chosen entity, writes no idnos, files a concordance warning', async () => {
    const { fs, store } = makeStore();
    const doc = await store.loadEntities();
    const a = addEntity(doc, 'person', {
      name: 'A',
      authorityIds: [{ type: 'CBDB', value: '31305' }],
    });
    const b = addEntity(doc, 'person', {
      name: 'B',
      authorityIds: [{ type: 'DILA', value: 'A001492' }],
    });
    await store.saveEntities(doc, { allowSqliteFullReimport: true });
    const before = await store.loadEntities().then((d) => d.getElementsByTagName('idno').length);

    const result = await linkWithoutEnrichment(
      a.id,
      'A',
      [
        { key: a.id, name: 'A' },
        { key: b.id, name: 'B' },
      ],
      input(),
      { store },
    );
    expect(result).toMatchObject({ status: 'linked', key: a.id, wasCreated: false });

    const after = await store.loadEntities().then((d) => d.getElementsByTagName('idno').length);
    expect(after).toBe(before);

    const warnings = fs.files.get('/proj/.grognard/entity-warnings.jsonl') ?? '';
    expect(warnings).toContain('concordance-conflict');
    expect(warnings).toContain(b.id);
  });
});
