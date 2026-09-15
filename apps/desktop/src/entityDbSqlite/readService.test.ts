import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EntitySqliteRepository } from './repository';
import { getEntitySqlite, searchEntitySqlite } from './readService';

describe('entity SQLite read service', () => {
  it('opens a SQLite database once and serves typed search/detail reads', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'grognard-entity-read-'));
    const databasePath = path.join(directory, 'entities.sqlite');
    const repository = await EntitySqliteRepository.open(databasePath);
    await repository.createEntity({ id: 'person-read-1', kind: 'person', description: 'Description' });
    await repository.addName({ entityId: 'person-read-1', text: '讀者', isPrimary: true });
    await repository.close();

    await expect(
      searchEntitySqlite({ databasePath, kind: 'person', query: '讀者' }),
    ).resolves.toEqual([expect.objectContaining({ id: 'person-read-1', label: '讀者' })]);
    await expect(getEntitySqlite({ databasePath, entityId: 'person-read-1' })).resolves.toEqual(
      expect.objectContaining({ id: 'person-read-1', description: 'Description' }),
    );
    await expect(
      searchEntitySqlite({ databasePath, kind: 'person', query: 'missing' }),
    ).resolves.toEqual([]);
    await expect(
      searchEntitySqlite({
        databasePath: path.join(directory, 'missing', 'entities.sqlite'),
        kind: 'person',
        query: '讀者',
      }),
    ).resolves.toBeNull();

    rmSync(directory, { recursive: true, force: true });
  });
});
