import { EntitySqliteRepository } from './repository';
import {
  applyRemoteEntity,
  countOpenConflicts,
  exportLocalEntityXml,
  getOrCreateDeviceId,
  getSyncCursor,
  listDirtyForSync,
  listOpenConflicts,
  localEntityHash,
  openConflict,
  resolveConflict,
  setSyncCursor,
  upsertSyncState,
} from './entitySyncRepo';

const freshRepo = async () => {
  const repo = await EntitySqliteRepository.open(':memory:');
  await repo.setMetadata('database_id', 'test-db');
  return repo;
};

const addPerson = async (repo: EntitySqliteRepository, id: string, name: string) => {
  const entity = await repo.createEntity({ id, kind: 'person' });
  await repo.addName({ entityId: id, text: name, isPrimary: true });
  return entity;
};

describe('cursor + device id', () => {
  it('cursor defaults to 0 and round-trips', async () => {
    const repo = await freshRepo();
    expect(await getSyncCursor(repo)).toBe(0);
    await setSyncCursor(repo, 42);
    expect(await getSyncCursor(repo)).toBe(42);
  });

  it('device id is minted once and stable', async () => {
    const repo = await freshRepo();
    const first = await getOrCreateDeviceId(repo);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getOrCreateDeviceId(repo)).toBe(first);
  });
});

describe('listDirtyForSync', () => {
  it('reports a never-synced entity, then not after its sync_state matches', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-1', '張衡');
    const revision = (await repo.getEntity('person-1'))!.revision;

    const dirty = await listDirtyForSync(repo);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toMatchObject({
      localId: 'person-1',
      kind: 'person',
      centralId: null,
      baseRevision: 0,
    });

    await upsertSyncState(repo, {
      projectEntityId: 'person-1',
      centralEntityId: 'person-1',
      centralRevision: 1,
      projectRevision: revision,
      centralHash: 'h',
      projectHash: 'h',
    });
    expect(await listDirtyForSync(repo)).toHaveLength(0);
  });

  it('goes dirty again after a local edit bumps the revision', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-1', '張衡');
    await upsertSyncState(repo, {
      projectEntityId: 'person-1',
      centralEntityId: 'person-1',
      centralRevision: 1,
      projectRevision: (await repo.getEntity('person-1'))!.revision,
      centralHash: 'h',
      projectHash: 'h',
    });
    expect(await listDirtyForSync(repo)).toHaveLength(0);

    await repo.addName({ entityId: 'person-1', text: 'Zhang Heng' });
    const dirty = await listDirtyForSync(repo);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]!.centralId).toBe('person-1');
    expect(dirty[0]!.baseRevision).toBe(1);
  });

  it('excludes an entity that has an open conflict', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-1', '張衡');
    await openConflict(repo, {
      projectEntityId: 'person-1',
      centralEntityId: 'person-1',
      reason: 'pull-collision',
      projectRevision: 2,
      centralRevision: 3,
      projectSnapshot: '<person/>',
      centralSnapshot: '<person/>',
    });
    expect(await listDirtyForSync(repo)).toHaveLength(0);
  });

  it('marks a soft-deleted entity as deleted', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-1', '張衡');
    await repo.softDeleteEntity('person-1');
    const dirty = await listDirtyForSync(repo);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]!.deleted).toBe(true);
  });
});

describe('conflicts', () => {
  it('opens once per entity pair, lists, counts, and resolves', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-1', '張衡');
    const input = {
      projectEntityId: 'person-1',
      centralEntityId: 'person-1',
      reason: 'pull-collision',
      projectRevision: 2,
      centralRevision: 3,
      projectSnapshot: '<person>mine</person>',
      centralSnapshot: '<person>theirs</person>',
    };
    await openConflict(repo, input);
    await openConflict(repo, { ...input, reason: 'push-rejected' }); // no-op: already open
    expect(await countOpenConflicts(repo)).toBe(1);

    const [conflict] = await listOpenConflicts(repo);
    expect(conflict).toMatchObject({ projectEntityId: 'person-1', reason: 'pull-collision' });

    expect(await resolveConflict(repo, conflict!.id)).toBe(true);
    expect(await countOpenConflicts(repo)).toBe(0);
    expect(await resolveConflict(repo, conflict!.id)).toBe(false); // already resolved
  });
});

describe('applyRemoteEntity', () => {
  it('creates a local entity that did not exist', async () => {
    const source = await freshRepo();
    await addPerson(source, 'person-9', '司馬遷');
    const xml = (await exportLocalEntityXml(source, 'person-9'))!;

    const repo = await freshRepo();
    const { afterHash, projectRevision } = await applyRemoteEntity(repo, {
      centralId: 'person-9',
      kind: 'person',
      contentXml: xml,
      deleted: false,
    });
    expect(await repo.getEntity('person-9')).not.toBeNull();
    expect((await repo.listNames('person-9')).some((n) => n.text === '司馬遷')).toBe(true);
    expect(afterHash).toBe(await localEntityHash(repo, 'person-9'));
    expect(projectRevision).toBe((await repo.getEntity('person-9'))!.revision);
  });

  it('replaces the content of an entity that already exists', async () => {
    const source = await freshRepo();
    await addPerson(source, 'person-9', 'new name');
    const xml = (await exportLocalEntityXml(source, 'person-9'))!;

    const repo = await freshRepo();
    await addPerson(repo, 'person-9', 'old name');
    await applyRemoteEntity(repo, {
      centralId: 'person-9',
      kind: 'person',
      contentXml: xml,
      deleted: false,
    });

    const names = (await repo.listNames('person-9')).map((n) => n.text);
    expect(names).toContain('new name');
    expect(names).not.toContain('old name');
  });

  it('soft-deletes on a delete change', async () => {
    const repo = await freshRepo();
    await addPerson(repo, 'person-9', '張衡');
    const { projectRevision } = await applyRemoteEntity(repo, {
      centralId: 'person-9',
      kind: 'person',
      contentXml: '',
      deleted: true,
    });
    expect((await repo.getEntity('person-9'))!.deletedAt).not.toBeNull();
    expect(projectRevision).toBe((await repo.getEntity('person-9'))!.revision);
  });

  it('creates a remote `office` entity as office, not org (shared listOrg wrapper)', async () => {
    const source = await freshRepo();
    const office = await source.createEntity({ id: 'office-9', kind: 'office' });
    await source.addName({ entityId: office.id, text: 'Grand Secretary', isPrimary: true });
    const xml = (await exportLocalEntityXml(source, 'office-9'))!;

    const repo = await freshRepo();
    await applyRemoteEntity(repo, {
      centralId: 'office-9',
      kind: 'office',
      contentXml: xml,
      deleted: false,
    });

    expect((await repo.getEntity('office-9'))?.kind).toBe('office');
    expect((await repo.listNames('office-9')).some((n) => n.text === 'Grand Secretary')).toBe(true);
  });

  it('creates a remote `thing` entity as thing (shared bare-list wrapper)', async () => {
    const source = await freshRepo();
    const thing = await source.createEntity({ id: 'thing-9', kind: 'thing' });
    await source.addName({ entityId: thing.id, text: '氣', isPrimary: true });
    const xml = (await exportLocalEntityXml(source, 'thing-9'))!;

    const repo = await freshRepo();
    await applyRemoteEntity(repo, {
      centralId: 'thing-9',
      kind: 'thing',
      contentXml: xml,
      deleted: false,
    });

    expect((await repo.getEntity('thing-9'))?.kind).toBe('thing');
    expect((await repo.listNames('thing-9')).some((n) => n.text === '氣')).toBe(true);
  });
});
