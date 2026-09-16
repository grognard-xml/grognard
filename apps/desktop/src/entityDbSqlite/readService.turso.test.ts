import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.mock('../entityDbTursoTokenStore', () => ({
  readTursoAuthToken: jest.fn(async () => 'fake-token-not-needed-for-local-file-url'),
}));

import { tursoConnectionRef } from '../entityDbConnectionRef';
import { getEntitySqlite, listEntitySqliteAuthorityDuplicates, searchEntitySqlite } from './readService';
import { EntitySqliteRepository } from './repository';

describe('readService with a Turso connection reference', () => {
  it('resolves the grognard-turso: sentinel and serves reads through it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'grognard-readservice-turso-'));
    const url = `file:${path.join(directory, 'entities.sqlite')}`;

    // Seed data through the real repository, same connection the sentinel resolves to.
    const repository = await EntitySqliteRepository.open({ backend: 'turso', url });
    await repository.createEntity({ id: 'person-turso-read-1', kind: 'person' });
    await repository.addName({ entityId: 'person-turso-read-1', text: '讀者', isPrimary: true });
    await repository.close();

    const ref = tursoConnectionRef(url);

    await expect(
      searchEntitySqlite({ databasePath: ref, kind: 'person', query: '讀者' }),
    ).resolves.toEqual([expect.objectContaining({ id: 'person-turso-read-1', label: '讀者' })]);
    await expect(
      getEntitySqlite({ databasePath: ref, entityId: 'person-turso-read-1' }),
    ).resolves.toEqual(expect.objectContaining({ id: 'person-turso-read-1' }));

    rmSync(directory, { recursive: true, force: true });
  });

  it('accepts a Turso connection reference for authority-duplicate lookups', async () => {
    // Regression test: `listEntitySqliteAuthorityDuplicates` used to bypass
    // the shared, sentinel-aware `validDatabasePath` check with its own
    // literal `path.basename(...) === 'entities.sqlite'` test, which a
    // `grognard-turso:` reference can never satisfy — it always threw
    // "Invalid entity SQLite database path." before even trying to open the
    // database (found via live two-machine testing, database-viewer panel).
    const directory = mkdtempSync(path.join(tmpdir(), 'grognard-readservice-turso-authdup-'));
    const url = `file:${path.join(directory, 'entities.sqlite')}`;
    const ref = tursoConnectionRef(url);

    await expect(listEntitySqliteAuthorityDuplicates(ref)).resolves.toEqual([]);

    rmSync(directory, { recursive: true, force: true });
  });

  it('throws a clear error when no token is stored for a Turso reference', async () => {
    const { readTursoAuthToken } = jest.requireMock('../entityDbTursoTokenStore') as {
      readTursoAuthToken: jest.Mock;
    };
    readTursoAuthToken.mockResolvedValueOnce(null);

    await expect(
      searchEntitySqlite({
        databasePath: tursoConnectionRef('libsql://no-token-configured.turso.io'),
        kind: 'person',
        query: 'x',
      }),
    ).rejects.toThrow(/no turso auth token stored/i);
  });
});
