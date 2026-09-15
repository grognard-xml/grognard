import { bulkBridgeImportSqlite } from './bulkBridgeImportSqlite';
import { EntitySqliteRepository } from './entityDbSqlite/repository';

const USER = 'test-user';

async function seedPerson(
  repository: EntitySqliteRepository,
  id: string,
  name: string,
  authorities: { type: string; value: string }[] = [],
): Promise<void> {
  await repository.createEntity({ id, kind: 'person' });
  await repository.addName({
    entityId: id,
    text: name,
    isPrimary: true,
    origin: 'user',
  });
  for (const authority of authorities) {
    await repository.attachAuthority({
      entityId: id,
      type: authority.type,
      value: authority.value,
    });
  }
}

describe('bulkBridgeImportSqlite', () => {
  it('links a unique authority match', async () => {
    const source = await EntitySqliteRepository.open();
    const central = await EntitySqliteRepository.open();
    await seedPerson(central, 'person-central-1', '張衡', [
      { type: 'Wikidata', value: 'http://www.wikidata.org/entity/Q42' },
    ]);
    await seedPerson(source, 'person-source-1', '张衡', [{ type: 'wikidata', value: 'Q42' }]);

    const result = await bulkBridgeImportSqlite({
      source,
      central,
      userStableId: USER,
      chunkSize: 25,
    });

    expect(result.matched).toBe(1);
    expect(result.proposed).toBe(0);
    expect(result.ambiguous).toBe(0);
    expect(result.merged).toBe(0);
    expect(await source.getCentralId('person-source-1', USER)).toBe('person-central-1');
    expect(await central.listEntityIds()).toEqual(['person-central-1']);

    await source.close();
    await central.close();
  });

  it('proposes when two CEDB entities share the same authority', async () => {
    const source = await EntitySqliteRepository.open();
    const central = await EntitySqliteRepository.open();
    await seedPerson(central, 'person-central-a', '甲', [{ type: 'NORBERT', value: '7' }]);
    await seedPerson(central, 'person-central-b', '乙', [{ type: 'NORBERT', value: '7' }]);
    await seedPerson(source, 'person-source-1', '丙', [{ type: 'NORBERT', value: '7' }]);

    const result = await bulkBridgeImportSqlite({
      source,
      central,
      userStableId: USER,
    });

    expect(result.matched).toBe(0);
    expect(result.ambiguous).toBe(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      sourceId: 'person-source-1',
      reason: 'ambiguous-authority-match',
    });
    expect(result.proposals[0]?.candidateCentralIds.sort()).toEqual([
      'person-central-a',
      'person-central-b',
    ]);
    expect(await source.getCentralId('person-source-1', USER)).toBeNull();

    await source.close();
    await central.close();
  });

  it('mints and links unmatched entities when mintUnmatched is true', async () => {
    const source = await EntitySqliteRepository.open();
    const central = await EntitySqliteRepository.open();
    await seedPerson(source, 'person-source-1', '未匹配', [
      { type: 'VIAF', value: 'http://viaf.org/viaf/42920649' },
    ]);

    const result = await bulkBridgeImportSqlite({
      source,
      central,
      userStableId: USER,
      mintUnmatched: true,
    });

    expect(result.matched).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.proposed).toBe(0);
    expect(result.proposals).toHaveLength(0);
    const centralId = await source.getCentralId('person-source-1', USER);
    expect(centralId).toMatch(/^person-/);
    expect(await central.getEntity(centralId!)).not.toBeNull();
    expect((await central.getPanelSummary(centralId!))?.authorities).toEqual([
      { type: 'VIAF', value: '42920649' },
    ]);

    await source.close();
    await central.close();
  });

  it('proposes no-authority-match when mintUnmatched is false', async () => {
    const source = await EntitySqliteRepository.open();
    const central = await EntitySqliteRepository.open();
    await seedPerson(source, 'person-source-1', '未匹配');

    const result = await bulkBridgeImportSqlite({
      source,
      central,
      userStableId: USER,
      mintUnmatched: false,
    });

    expect(result.matched).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.proposed).toBe(1);
    expect(result.proposals[0]).toMatchObject({
      sourceId: 'person-source-1',
      reason: 'no-authority-match',
      candidateCentralIds: [],
    });
    expect(await source.getCentralId('person-source-1', USER)).toBeNull();
    expect(await central.listEntityIds()).toEqual([]);

    await source.close();
    await central.close();
  });

  it('skips already-linked PEDB entities', async () => {
    const source = await EntitySqliteRepository.open();
    const central = await EntitySqliteRepository.open();
    await seedPerson(central, 'person-central-1', '已鏈', [{ type: 'CBDB', value: '1' }]);
    await seedPerson(source, 'person-source-1', '已鏈', [{ type: 'CBDB', value: '1' }]);
    await source.setCentralMapping('person-source-1', USER, 'person-central-1');

    const result = await bulkBridgeImportSqlite({
      source,
      central,
      userStableId: USER,
    });

    expect(result.matched).toBe(0);
    expect(result.proposed).toBe(0);
    expect(result.ambiguous).toBe(0);
    expect(await source.getCentralId('person-source-1', USER)).toBe('person-central-1');

    await source.close();
    await central.close();
  });
});
