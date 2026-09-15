import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EntitySqliteRepository } from './repository';
import { entityDbConnectionKey } from './openBackend';

describe('EntitySqliteRepository.open() with a connection descriptor', () => {
  it('still accepts a bare path string, unchanged (local-file default)', async () => {
    const repository = await EntitySqliteRepository.open(':memory:');
    await repository.createEntity({ id: 'person-bare-path', kind: 'person' });
    expect(await repository.getEntity('person-bare-path')).not.toBeNull();
    await repository.close();
  });

  it('opens and migrates a fresh Turso-backed repository (schema created on first connect)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'grognard-turso-open-'));
    const url = `file:${path.join(directory, 'entities.sqlite')}`;

    const repository = await EntitySqliteRepository.open({ backend: 'turso', url });
    // If migrations didn't run, this insert (which depends on the full schema
    // — entities + people + entity_names, all created by the migration chain)
    // would fail outright rather than just returning wrong data.
    await repository.createEntity({ id: 'person-turso-1', kind: 'person' });
    await repository.addName({ entityId: 'person-turso-1', text: '張衡', isPrimary: true });

    const entity = await repository.getEntity('person-turso-1');
    expect(entity?.kind).toBe('person');
    expect(await repository.listNames('person-turso-1')).toEqual([
      expect.objectContaining({ text: '張衡' }),
    ]);
    expect(await repository.integrityCheck()).toEqual(['ok']);

    await repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe('entityDbConnectionKey', () => {
  it('gives a bare path the same identity as its explicit local-connection form', () => {
    expect(entityDbConnectionKey('/tmp/entities.sqlite')).toBe(
      entityDbConnectionKey({ backend: 'local', path: '/tmp/entities.sqlite' }),
    );
  });

  it('distinguishes local paths from turso urls, and different urls from each other', () => {
    const a = entityDbConnectionKey({ backend: 'local', path: '/tmp/entities.sqlite' });
    const b = entityDbConnectionKey({ backend: 'turso', url: 'libsql://a.turso.io' });
    const c = entityDbConnectionKey({ backend: 'turso', url: 'libsql://b.turso.io' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
