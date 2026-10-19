import {
  authorityIdsFromTeiRef,
  normalizeImportedWorkTitle,
  resolveExistingForImport,
} from './ensureImportHeaderEntities';

describe('authorityIdsFromTeiRef', () => {
  it('parses Wikidata URIs', () => {
    expect(authorityIdsFromTeiRef('https://www.wikidata.org/entity/Q535')).toEqual([
      { type: 'Wikidata', value: 'Q535' },
    ]);
  });

  it('parses Norbert and DILA tokens', () => {
    expect(authorityIdsFromTeiRef('NORBERT:person-1421')).toEqual([
      { type: 'NORBERT', value: 'person-1421' },
    ]);
    expect(authorityIdsFromTeiRef('DILA:A001492')).toEqual([{ type: 'DILA', value: 'A001492' }]);
  });

  it('parses BDRC purls', () => {
    expect(authorityIdsFromTeiRef('http://purl.bdrc.io/resource/P1583')).toEqual([
      { type: 'BDRC', value: 'P1583' },
    ]);
  });
});

describe('normalizeImportedWorkTitle', () => {
  it('removes fascicle suffixes', () => {
    expect(normalizeImportedWorkTitle('Kangyur vol. ka — བམ་པོ་ 3')).toBe('Kangyur vol. ka');
    expect(normalizeImportedWorkTitle('Some sūtra — juan 2')).toBe('Some sūtra');
  });
});

describe('resolveExistingForImport', () => {
  const storeWith = (byAuthority: string | null, byName: string | null) =>
    ({
      sqliteFindByAuthority: async () => byAuthority,
      sqliteSearchNames: async () => (byName ? [{ id: byName, label: '郭璞', idnos: [] }] : []),
    }) as unknown as Parameters<typeof resolveExistingForImport>[0];
  const wikidata = [{ type: 'Wikidata', value: 'Q765572' }];

  it('falls back to the name when no entity carries the authority id', async () => {
    expect(
      await resolveExistingForImport(storeWith(null, 'person-a'), 'person', '郭璞', wikidata),
    ).toBe('person-a');
  });

  it('leaves an authority match to the mint step', async () => {
    expect(
      await resolveExistingForImport(storeWith('person-b', 'person-a'), 'person', '郭璞', wikidata),
    ).toBeNull();
  });
});
