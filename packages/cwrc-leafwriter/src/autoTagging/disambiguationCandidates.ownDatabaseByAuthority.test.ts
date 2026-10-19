import {
  loadSqliteCandidatesByAuthority,
  mergeCandidates,
  type DisambiguationCandidate,
} from './disambiguationCandidates';

const entity = {
  id: 'person-bdf7f9ca',
  description: '疇人',
  names: [
    { text: '郭璞', language: null, status: 'active' },
    { text: '郭景純', language: null, status: 'rejected' },
  ],
  authorities: [
    { type: 'DILA', value: 'A013851' },
    { type: 'NORBERT', value: 'person-51' },
    { type: 'Wikidata', value: 'Q765572' },
  ],
  startYear: 276,
  endYear: 324,
};

const storeWith = (byAuthority: Record<string, string[]>) => {
  const lookups: string[] = [];
  const store = {
    sqliteFindAllByAuthority: async (_kind: string, type: string, value: string) => {
      lookups.push(`${type}:${value}`);
      return byAuthority[`${type.toLowerCase()}:${value}`] ?? [];
    },
    sqliteEntitySummary: async (id: string) => (id === entity.id ? { ...entity, id } : null),
  };
  return { store: store as never, lookups };
};

const packRow: DisambiguationCandidate = {
  id: 'norbert-person-51',
  label: '郭璞',
  description: '郭璞 (276-324, 東晉)',
  sources: ['Norbert'],
  authorityIds: [{ type: 'NORBERT', value: 'person-51' }],
  startYear: 276,
  endYear: 324,
};

describe('own database matched by authority id', () => {
  it('finds the entity from a pack row even though the searched name is rejected on it', async () => {
    const { store } = storeWith({ 'norbert:person-51': [entity.id] });
    const found = await loadSqliteCandidatesByAuthority(
      store,
      'name',
      packRow.authorityIds!,
      'cedb',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ centralEntityId: entity.id, sources: ['central-database'] });
  });

  it('collapses into one row that is marked as coming from the own database', async () => {
    const { store } = storeWith({ 'norbert:person-51': [entity.id] });
    const own = await loadSqliteCandidatesByAuthority(store, 'name', packRow.authorityIds!, 'cedb');
    const rows = mergeCandidates([own, [packRow]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.centralEntityId).toBe(entity.id);
    expect(rows[0]!.sources).toEqual(expect.arrayContaining(['central-database', 'Norbert']));
  });

  it('looks up bare Norbert ids in their typed form, and skips entities already listed', async () => {
    const { store, lookups } = storeWith({ 'norbert:person-51': [entity.id] });
    const bare = [{ type: 'NORBERT', value: '51' }];
    expect(await loadSqliteCandidatesByAuthority(store, 'name', bare, 'pedb')).toHaveLength(1);
    expect(lookups).toEqual(expect.arrayContaining(['NORBERT:51', 'NORBERT:person-51']));
    expect(
      await loadSqliteCandidatesByAuthority(store, 'name', bare, 'pedb', new Set([entity.id])),
    ).toEqual([]);
  });

  it('returns nothing when no entity carries the ids', async () => {
    const { store } = storeWith({});
    expect(
      await loadSqliteCandidatesByAuthority(store, 'name', packRow.authorityIds!, 'pedb'),
    ).toEqual([]);
  });
});
