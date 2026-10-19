import { synchronizeMirroredProject } from './synchronizedMirror';

interface Authority {
  type: string;
  value: string;
}

const fakeSqliteStore = (path: string, seed: Record<string, Authority[]>) => {
  const authorities = new Map(Object.entries(seed).map(([id, list]) => [id, [...list]]));
  const mappings = new Map<string, string>();
  const files = new Map<string, string>();
  const store = {
    sqlitePath: path,
    authorities,
    mappings,
    hasSqliteDatabase: async () => true,
    sqliteDatabaseId: async () => path,
    sqliteEntityIds: async () => [...authorities.keys()],
    sqliteGetCentralId: async (id: string) => mappings.get(id) ?? null,
    sqliteEntitySummary: async (id: string) =>
      authorities.has(id) ? { kind: 'person', authorities: authorities.get(id) } : null,
    sqliteEntityContentHash: async (id: string) =>
      authorities.has(id)
        ? authorities
            .get(id)!
            .map((a) => `${a.type}:${a.value}`)
            .sort()
            .join('|')
        : null,
    sqliteAttachAuthority: async (id: string, type: string, value: string) => {
      authorities.get(id)!.push({ type, value });
      return true;
    },
    readProjectGrognardFile: async (name: string) => files.get(name) ?? null,
    writeProjectGrognardFile: async (name: string, content: string) => {
      files.set(name, content);
    },
    sqliteReplaceEntityContentFrom: async (
      sourcePath: string,
      sourceId: string,
      targetId: string,
    ) => {
      const source = stores[sourcePath]!;
      authorities.set(targetId, [...source.authorities.get(sourceId)!]);
      return true;
    },
  };
  stores[path] = store;
  return store;
};
const stores: Record<string, ReturnType<typeof fakeSqliteStore>> = {};

describe('mirror sync, first pairing of an existing central entity', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      entitySqliteReplaceEntityContent: () => undefined,
      entitySqliteEntityContentHash: () => undefined,
    };
  });
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('keeps authority ids only the project has instead of stripping them', async () => {
    const central = fakeSqliteStore('central', {
      'person-c': [{ type: 'NORBERT', value: 'person-2826' }],
    });
    const project = fakeSqliteStore('project', {
      'person-p': [
        { type: 'NORBERT', value: 'person-2826' },
        { type: 'Wikidata', value: 'Q13579973' },
      ],
    });
    project.mappings.set('person-p', 'person-c');

    await synchronizeMirroredProject(project as never, central as never, 'user-a');

    const expected = ['NORBERT:person-2826', 'Wikidata:Q13579973'];
    const format = (list: Authority[]) => list.map((a) => `${a.type}:${a.value}`).sort();
    expect(format(central.authorities.get('person-c')!)).toEqual(expected);
    expect(format(project.authorities.get('person-p')!)).toEqual(expected);
  });

  it('does not attach an id whose type central already holds with another value', async () => {
    const central = fakeSqliteStore('central2', { 'person-c': [{ type: 'CBDB', value: '1' }] });
    const project = fakeSqliteStore('project2', { 'person-p': [{ type: 'CBDB', value: '2' }] });
    project.mappings.set('person-p', 'person-c');

    await synchronizeMirroredProject(project as never, central as never, 'user-a');

    expect(central.authorities.get('person-c')).toEqual([{ type: 'CBDB', value: '1' }]);
  });
});
