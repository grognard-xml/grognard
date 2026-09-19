import { EntitySqliteRepository } from './entityDbSqlite/repository';
import {
  countOpenConflicts,
  exportLocalEntityXml,
  getSyncCursor,
  listDirtyForSync,
  listOpenConflicts,
  localEntityHash,
  setSyncCursor,
} from './entityDbSqlite/entitySyncRepo';
import { CONTENT_HASH_VERSION } from './entityDbSqlite/xmlCodec';
import { runSync, resolveConflictKeepLocal, resolveConflictKeepRemote } from './entitySync';
import { EntitySyncQuotaError } from './entitySyncClient';
import type {
  SyncPullChange,
  SyncPullResult,
  SyncPushEntity,
  SyncPushResult,
} from './entitySyncClient';

/**
 * In-memory stand-in for the deployed Worker, implementing the exact
 * push/pull contract of workers/entity-sync/src/index.ts so the orchestrator
 * can be exercised without HTTP.
 */
class FakeCentral {
  private rows = new Map<
    string,
    {
      kind: SyncPullChange['kind'];
      revision: number;
      contentXml: string;
      contentHash: string;
      deleted: boolean;
      seq: number;
    }
  >();

  private lastSeq = 0;

  /** When set, `push` throws a quota error once it has accepted this many entities. */
  quotaAfter = Infinity;
  private acceptedTotal = 0;

  /** Seed a central row directly (out-of-band, like the seed script). */
  seed(
    centralId: string,
    row: Omit<SyncPushEntity, 'localId' | 'baseRevision'> & { seq?: number },
  ) {
    this.lastSeq += 1;
    this.rows.set(centralId, {
      kind: row.kind,
      revision: 1,
      contentXml: row.contentXml,
      contentHash: row.contentHash,
      deleted: row.deleted ?? false,
      seq: row.seq ?? this.lastSeq,
    });
  }

  pull = async (since: number, limit = 500): Promise<SyncPullResult> => {
    const changes = [...this.rows.entries()]
      .filter(([, r]) => r.seq > since)
      .sort((a, b) => a[1].seq - b[1].seq)
      .slice(0, limit)
      .map(([centralId, r]) => ({
        centralId,
        kind: r.kind,
        revision: r.revision,
        contentXml: r.contentXml,
        contentHash: r.contentHash,
        deleted: r.deleted,
        seq: r.seq,
      }));
    return {
      changes,
      highSeq: changes.length > 0 ? changes[changes.length - 1]!.seq : since,
      hasMore: changes.length === limit,
    };
  };

  push = async (entities: SyncPushEntity[]): Promise<SyncPushResult> => {
    if (this.acceptedTotal >= this.quotaAfter) {
      throw new EntitySyncQuotaError('write quota reached');
    }
    const applied: SyncPushResult['applied'] = [];
    const reconciled: SyncPushResult['reconciled'] = [];
    const conflicts: SyncPushResult['conflicts'] = [];

    for (const e of entities) {
      const centralId = e.centralId ?? e.localId;
      const existing = this.rows.get(centralId);

      if (!existing) {
        this.lastSeq += 1;
        const revision = Math.max(e.baseRevision, 0) + 1;
        this.rows.set(centralId, {
          kind: e.kind,
          revision,
          contentXml: e.contentXml,
          contentHash: e.contentHash,
          deleted: e.deleted ?? false,
          seq: this.lastSeq,
        });
        applied.push({ localId: e.localId, centralId, revision, seq: this.lastSeq });
        continue;
      }
      if (existing.revision === e.baseRevision) {
        this.lastSeq += 1;
        existing.revision = e.baseRevision + 1;
        existing.contentXml = e.contentXml;
        existing.contentHash = e.contentHash;
        existing.deleted = e.deleted ?? false;
        existing.seq = this.lastSeq;
        applied.push({
          localId: e.localId,
          centralId,
          revision: existing.revision,
          seq: this.lastSeq,
        });
        continue;
      }
      if (existing.contentHash === e.contentHash && existing.deleted === (e.deleted ?? false)) {
        reconciled.push({
          localId: e.localId,
          centralId,
          revision: existing.revision,
          seq: existing.seq,
        });
        continue;
      }
      conflicts.push({
        localId: e.localId,
        centralId,
        serverRevision: existing.revision,
        serverHash: existing.contentHash,
        serverXml: existing.contentXml,
        serverDeleted: existing.deleted,
      });
    }
    this.acceptedTotal += applied.length + reconciled.length;
    return { applied, reconciled, conflicts, highSeq: this.lastSeq };
  };

  /** test helper: bump an entity's central revision out of band (simulates another device) */
  bumpOutOfBand(centralId: string, contentXml: string, contentHash: string): void {
    const row = this.rows.get(centralId)!;
    this.lastSeq += 1;
    row.revision += 1;
    row.contentXml = contentXml;
    row.contentHash = contentHash;
    row.seq = this.lastSeq;
  }
}

const freshRepo = async () => {
  const repo = await EntitySqliteRepository.open(':memory:');
  await repo.setMetadata('database_id', 'test-db');
  return repo;
};

const addPerson = async (repo: EntitySqliteRepository, id: string, name: string) => {
  await repo.createEntity({ id, kind: 'person' });
  await repo.addName({ entityId: id, text: name, isPrimary: true });
};

describe('runSync', () => {
  it('pushes new local entities to central and marks them clean', async () => {
    const central = new FakeCentral();
    const repo = await freshRepo();
    await addPerson(repo, 'person-a', '張衡');
    await addPerson(repo, 'person-b', '司馬遷');

    const result = await runSync({ repo, client: central });

    expect(result.pushedApplied).toBe(2);
    expect(result.pushedConflicts).toBe(0);
    expect(await listDirtyForSync(repo)).toHaveLength(0);

    // A second device pulls both.
    const repoB = await freshRepo();
    const resultB = await runSync({ repo: repoB, client: central });
    expect(resultB.pulledApplied).toBe(2);
    expect(await repoB.getEntity('person-a')).not.toBeNull();
    expect((await repoB.listNames('person-b')).some((n) => n.text === '司馬遷')).toBe(true);
    expect(await getSyncCursor(repoB)).toBe(resultB.cursor);
  });

  it('pushes and pulls `thing` entities too (central sync support for thing has shipped)', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    const thing = await repoA.createEntity({ id: 'thing-a', kind: 'thing' });
    await repoA.addName({ entityId: thing.id, text: '氣', isPrimary: true });

    const result = await runSync({ repo: repoA, client: central });
    expect(result.pushedApplied).toBe(1);
    expect(await listDirtyForSync(repoA)).toHaveLength(0);

    const repoB = await freshRepo();
    const resultB = await runSync({ repo: repoB, client: central });
    expect(resultB.pulledApplied).toBe(1);
    expect((await repoB.getEntity('thing-a'))?.kind).toBe('thing');
    expect((await repoB.listNames('thing-a')).some((n) => n.text === '氣')).toBe(true);
  });

  it('propagates an edit from one device to another (fast-forward)', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });

    const repoB = await freshRepo();
    await runSync({ repo: repoB, client: central });

    await repoA.addName({ entityId: 'person-a', text: 'Zhang Heng' });
    const a2 = await runSync({ repo: repoA, client: central });
    expect(a2.pushedApplied).toBe(1);
    expect(a2.pushedConflicts).toBe(0);

    const b2 = await runSync({ repo: repoB, client: central });
    expect(b2.pulledApplied).toBe(1);
    expect((await repoB.listNames('person-a')).map((n) => n.text)).toEqual(
      expect.arrayContaining(['張衡', 'Zhang Heng']),
    );
    expect(await listDirtyForSync(repoB)).toHaveLength(0);
  });

  it('opens a conflict when a pulled change collides with a dirty local edit', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });
    const repoB = await freshRepo();
    await runSync({ repo: repoB, client: central });

    // A edits and syncs; B edits differently and has NOT synced yet.
    await repoA.addName({ entityId: 'person-a', text: 'from A' });
    await runSync({ repo: repoA, client: central });
    await repoB.addName({ entityId: 'person-a', text: 'from B' });

    const b = await runSync({ repo: repoB, client: central });
    expect(b.pulledConflicts).toBe(1);
    expect(b.pushedApplied).toBe(0);
    expect(await countOpenConflicts(repoB)).toBe(1);
    // local copy untouched
    expect((await repoB.listNames('person-a')).some((n) => n.text === 'from B')).toBe(true);
    expect((await repoB.listNames('person-a')).some((n) => n.text === 'from A')).toBe(false);

    const [conflict] = await listOpenConflicts(repoB);
    expect(conflict!.reason).toBe('pull-collision');
    expect(conflict!.centralSnapshot).toContain('from A');
  });

  it('opens a conflict when the server rejects a stale-base push', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });

    // Server moves ahead out of band, but the client's cursor is bumped past
    // that seq so its pull misses it — the push then arrives with a stale base.
    central.bumpOutOfBand('person-a', '<person xml:id="person-a">server</person>', 'server-hash');
    await setSyncCursor(repoA, 999);

    await repoA.addName({ entityId: 'person-a', text: 'client edit' });
    const a = await runSync({ repo: repoA, client: central });

    expect(a.pushedConflicts).toBe(1);
    expect(await countOpenConflicts(repoA)).toBe(1);
    expect((await listOpenConflicts(repoA))[0]!.reason).toBe('push-rejected');
  });

  it('round-trips a delete', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });
    const repoB = await freshRepo();
    await runSync({ repo: repoB, client: central });

    await repoA.softDeleteEntity('person-a');
    const a = await runSync({ repo: repoA, client: central });
    expect(a.pushedApplied).toBe(1);

    const b = await runSync({ repo: repoB, client: central });
    expect(b.pulledApplied).toBe(1);
    expect((await repoB.getEntity('person-a'))!.deletedAt).not.toBeNull();
  });

  it('bails out when the abort signal is already set', async () => {
    const central = new FakeCentral();
    const repo = await freshRepo();
    await addPerson(repo, 'person-a', '張衡');
    const controller = new AbortController();
    controller.abort();
    await expect(runSync({ repo, client: central, signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
  });

  it('reports progress for each pull page and push chunk', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });

    const repoB = await freshRepo();
    const events: string[] = [];
    await runSync({
      repo: repoB,
      client: central,
      onProgress: (p) => events.push(p.phase),
    });
    expect(events).toContain('pull');
  });

  it('is a no-op on the second run when nothing changed', async () => {
    const central = new FakeCentral();
    const repo = await freshRepo();
    await addPerson(repo, 'person-a', '張衡');
    await runSync({ repo, client: central });

    const again = await runSync({ repo, client: central });
    expect(again).toMatchObject({
      pulledApplied: 0,
      pulledConflicts: 0,
      pushedApplied: 0,
      pushedReconciled: 0,
      pushedConflicts: 0,
      openConflicts: 0,
    });
  });

  it('stops cleanly (no throw) when the server is out of write quota', async () => {
    const central = new FakeCentral();
    central.quotaAfter = 0; // refuse every push
    const repo = await freshRepo();
    await addPerson(repo, 'person-a', '甲');

    const result = await runSync({ repo, client: central });
    expect(result.stoppedEarly).toBe('write-quota');
    expect(result.pushedApplied).toBe(0);
    // the entity stays dirty for a later run; nothing was queued as a conflict
    expect((await listDirtyForSync(repo)).map((d) => d.localId)).toEqual(['person-a']);
    expect(await countOpenConflicts(repo)).toBe(0);
  });

  it('keeps an entity dirty if it is edited again while its push is in flight', async () => {
    const central = new FakeCentral();
    const repo = await freshRepo();
    await addPerson(repo, 'person-a', '張衡');
    await runSync({ repo, client: central });

    await repo.addName({ entityId: 'person-a', text: 'V1' });

    // Wraps `central` so that, while the push request is "in flight", another
    // part of the app edits the same entity again — simulating a user save
    // that lands mid-round-trip. The push itself only ever carries V1.
    const raceyClient = {
      pull: central.pull,
      push: async (entities: SyncPushEntity[]) => {
        await repo.addName({ entityId: 'person-a', text: 'V2' });
        return central.push(entities);
      },
    };

    const result = await runSync({ repo, client: raceyClient });
    expect(result.pushedApplied).toBe(1);

    // V2 was never sent, so it must not be marked as synced.
    expect((await listDirtyForSync(repo)).map((d) => d.localId)).toEqual(['person-a']);
    const centralXml = (await central.pull(0)).changes.find(
      (c) => c.centralId === 'person-a',
    )?.contentXml;
    expect(centralXml).toContain('V1');
    expect(centralXml).not.toContain('V2');

    // The next run picks up V2 cleanly.
    const again = await runSync({ repo, client: central });
    expect(again.pushedApplied).toBe(1);
    expect(await listDirtyForSync(repo)).toHaveLength(0);
    const centralXmlAfter = (await central.pull(0)).changes.find(
      (c) => c.centralId === 'person-a',
    )?.contentXml;
    expect(centralXmlAfter).toContain('V2');
  });

  it('re-baselines stale hashes after a content-hash-version bump instead of misreading them', async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });

    const repoB = await freshRepo();
    await runSync({ repo: repoB, client: central });
    expect(await listDirtyForSync(repoB)).toHaveLength(0);

    // Simulate repoB having synced under an older hash algorithm: its cached
    // hashes are in a shape a fresh compute will never produce, and its
    // recorded hash version is behind the current one.
    await repoB.backend.run(
      `UPDATE sync_state SET central_hash = 'stale-pre-version-hash', project_hash = 'stale-pre-version-hash'`,
    );
    await repoB.setMetadata('sync_content_hash_version', '0');

    // Nothing changed on either side; re-syncing repoB must not invent a
    // conflict or mark anything dirty just because the cached hash no longer
    // matches the current algorithm's shape. There's nothing to pull (repoB's
    // cursor is already caught up) or push (it isn't dirty), so the stale
    // hash is blanked rather than misread — not repopulated yet, since
    // nothing here recomputes it.
    const result = await runSync({ repo: repoB, client: central });
    expect(result.pulledConflicts).toBe(0);
    expect(await countOpenConflicts(repoB)).toBe(0);
    expect(await listDirtyForSync(repoB)).toHaveLength(0);
    const blanked = (await repoB.backend.get(
      `SELECT central_hash, project_hash FROM sync_state WHERE project_entity_id = 'person-a'`,
    )) as { central_hash: string; project_hash: string };
    expect(blanked.central_hash).toBe('');
    expect(blanked.project_hash).toBe('');

    // A real edit afterwards still syncs normally, and repopulates the hash
    // in the current format once repoB actually applies the incoming change.
    await repoA.addName({ entityId: 'person-a', text: 'Zhang Heng' });
    await runSync({ repo: repoA, client: central });
    const again = await runSync({ repo: repoB, client: central });
    expect(again.pulledConflicts).toBe(0);
    expect((await repoB.listNames('person-a')).some((n) => n.text === 'Zhang Heng')).toBe(true);
    const refreshed = (await repoB.backend.get(
      `SELECT central_hash, project_hash FROM sync_state WHERE project_entity_id = 'person-a'`,
    )) as { central_hash: string; project_hash: string };
    expect(refreshed.central_hash.startsWith(`v${CONTENT_HASH_VERSION}:`)).toBe(true);
    expect(refreshed.project_hash).toBe(await localEntityHash(repoB, 'person-a'));
  });

  it('adopts a seeded central row without a re-apply when local content already matches', async () => {
    // Emulate the out-of-band seed: the entity exists locally, an identical
    // row is on central at revision 1, and there's no local sync_state yet.
    const source = await freshRepo();
    await addPerson(source, 'person-x', '司馬遷');
    const central = new FakeCentral();
    central.seed('person-x', {
      kind: 'person',
      contentXml: (await exportLocalEntityXml(source, 'person-x'))!,
      contentHash: (await localEntityHash(source, 'person-x'))!,
    });

    const repo = await freshRepo();
    await addPerson(repo, 'person-x', '司馬遷');
    const before = (await repo.getEntity('person-x'))!.revision;

    const result = await runSync({ repo, client: central });
    expect(result.pulledApplied).toBe(1);
    expect(result.pulledConflicts).toBe(0);
    // fast path: the local row's content was not re-imported, so its revision
    // is unchanged
    expect((await repo.getEntity('person-x'))!.revision).toBe(before);
    expect(await listDirtyForSync(repo)).toHaveLength(0);
  });
});

describe('conflict resolution', () => {
  const setUpConflict = async () => {
    const central = new FakeCentral();
    const repoA = await freshRepo();
    await addPerson(repoA, 'person-a', '張衡');
    await runSync({ repo: repoA, client: central });
    const repoB = await freshRepo();
    await runSync({ repo: repoB, client: central });

    await repoA.addName({ entityId: 'person-a', text: 'from A' });
    await runSync({ repo: repoA, client: central });
    await repoB.addName({ entityId: 'person-a', text: 'from B' });
    await runSync({ repo: repoB, client: central });

    return { central, repoB, conflictId: (await listOpenConflicts(repoB))[0]!.id };
  };

  it('keep-remote applies the server snapshot and clears the conflict', async () => {
    const { central, repoB, conflictId } = await setUpConflict();
    expect(await resolveConflictKeepRemote(repoB, conflictId)).toBe(true);

    expect(await countOpenConflicts(repoB)).toBe(0);
    expect((await repoB.listNames('person-a')).some((n) => n.text === 'from A')).toBe(true);
    expect((await repoB.listNames('person-a')).some((n) => n.text === 'from B')).toBe(false);

    const after = await runSync({ repo: repoB, client: central });
    expect(after.pushedConflicts).toBe(0);
    expect(await listDirtyForSync(repoB)).toHaveLength(0);
  });

  it('keep-local re-pushes the local version and wins', async () => {
    const { central, repoB, conflictId } = await setUpConflict();
    expect(await resolveConflictKeepLocal(repoB, conflictId)).toBe(true);
    expect(await countOpenConflicts(repoB)).toBe(0);

    const after = await runSync({ repo: repoB, client: central });
    expect(after.pushedApplied).toBe(1);
    expect(after.pushedConflicts).toBe(0);
    expect(await listDirtyForSync(repoB)).toHaveLength(0);

    // central now carries B's version
    const pulled = await central.pull(0);
    const row = pulled.changes.find((c) => c.centralId === 'person-a')!;
    expect(row.contentXml).toContain('from B');
  });
});
