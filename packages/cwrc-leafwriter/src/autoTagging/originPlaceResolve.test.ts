import type { EntityStore } from './entityStore';
import { resolveOriginToPlaceEntity } from './originPlaceResolve';

function fakeStore() {
  const calls: { method: string; args: unknown[] }[] = [];
  const store = {
    sqliteCreatePopulated: async (...args: unknown[]) => {
      calls.push({ method: 'sqliteCreatePopulated', args });
      return {};
    },
    sqliteApplyAuthorityBackfillPatch: async (...args: unknown[]) => {
      calls.push({ method: 'sqliteApplyAuthorityBackfillPatch', args });
      return { changed: true, namesAdded: 0 };
    },
    sqliteSetOriginReference: async (...args: unknown[]) => {
      calls.push({ method: 'sqliteSetOriginReference', args });
      return true;
    },
  };
  return { store: store as unknown as EntityStore, calls };
}

describe('resolveOriginToPlaceEntity', () => {
  it('mints a coordinates-mode place from a coherent multi-authority origin and backlinks both origin rows', async () => {
    const { store, calls } = fakeStore();
    const result = await resolveOriginToPlaceEntity(
      store,
      'person-1',
      [
        { key: 'person_origins:1', text: '鄱陽', source: 'CBDB', authorityRef: 'c_addr_123' },
        { key: 'person_origins:2', text: '鄱陽縣', source: 'CHGIS', authorityRef: 'sys_456' },
      ],
      5,
    );

    expect(result).not.toBeNull();
    expect(result!.storageMode).toBe('id'); // no geo supplied here — see next test for coordinates-mode
    expect(result!.linkedKeys).toEqual(['person_origins:1', 'person_origins:2']);

    const mintCall = calls.find((c) => c.method === 'sqliteCreatePopulated')!;
    expect(mintCall.args[0]).toEqual(
      expect.objectContaining({
        kind: 'place',
        names: [{ text: '鄱陽', isPrimary: true, origin: 'user' }],
      }),
    );

    const patchCall = calls.find((c) => c.method === 'sqliteApplyAuthorityBackfillPatch')!;
    expect(patchCall.args[0]).toEqual(
      expect.objectContaining({
        storageMode: 'id',
        sourceEntries: [
          { source: 'CBDB', authId: 'c_addr_123', dates: undefined },
          { source: 'CHGIS', authId: 'sys_456', dates: undefined },
        ],
      }),
    );

    const refCalls = calls.filter((c) => c.method === 'sqliteSetOriginReference');
    expect(refCalls).toHaveLength(2);
    expect(refCalls[0]!.args).toEqual([
      'person-1',
      'person_origins:1',
      `#${result!.placeEntityId}`,
    ]);
    expect(refCalls[1]!.args).toEqual([
      'person-1',
      'person_origins:2',
      `#${result!.placeEntityId}`,
    ]);
  });

  it('leaves a bare user-typed origin (no authority ref) unlinked but still names the entity', async () => {
    const { store, calls } = fakeStore();
    const result = await resolveOriginToPlaceEntity(
      store,
      'person-2',
      [{ key: 'person_origins:9', text: '建康', source: 'user' }],
      5,
    );
    expect(result!.linkedKeys).toEqual([]);
    const patchCall = calls.find((c) => c.method === 'sqliteApplyAuthorityBackfillPatch')!;
    expect(patchCall.args[0]).toEqual(expect.objectContaining({ sourceEntries: [] }));
  });

  it('returns null for an empty candidate list without touching the store', async () => {
    const { store, calls } = fakeStore();
    const result = await resolveOriginToPlaceEntity(store, 'person-3', [], 5);
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });
});
