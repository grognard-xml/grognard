/**
 * SQLite operations the entity-sync engine needs on top of
 * EntitySqliteRepository. Phase 2 of docs/entity-sync-planning.md.
 *
 * `sync_state` is the source of truth for the local ↔ central mapping of
 * *synced* entities: one row per (project_entity_id, central_entity_id) with
 * the central revision/hash we last agreed on. An entity with no row, or with
 * `project_revision` != the live `entities.revision`, is "dirty" and needs a
 * push. `central_mappings` is left to the existing local-file bridge.
 *
 * `sync_conflicts` holds whole-entity snapshots for manual resolution; while a
 * row is open for an entity, that entity is held back from push.
 */
import { EntitySqliteRepository, type SqliteEntityKind } from './repository';
import { computeEntityContentHash, exportEntityElementXml, importEntitiesXml } from './xmlCodec';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const CURSOR_KEY = 'sync_cursor';
const DEVICE_KEY = 'sync_device_id';

/**
 * `org`/`office` and `work`/`thing` share a wrapper tag, distinguished only by
 * the wrapper's `type` attribute (see `ENTITY_KINDS` in xmlCodec.ts) — without
 * it, `kindForList` on the receiving side reads the wrong kind back and
 * `replaceEntityContentFrom`'s kind-match check silently drops the pulled
 * entity.
 */
const ENTITY_LIST_BY_KIND: Record<SqliteEntityKind, { tag: string; type?: string }> = {
  person: { tag: 'listPerson' },
  place: { tag: 'listPlace' },
  org: { tag: 'listOrg' },
  office: { tag: 'listOrg', type: 'offices' },
  work: { tag: 'listBibl' },
  thing: { tag: 'list', type: 'things' },
};

// --- cursor / device --------------------------------------------------------

export const getSyncCursor = async (repo: EntitySqliteRepository): Promise<number> => {
  const raw = await repo.getMetadata(CURSOR_KEY);
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

export const setSyncCursor = async (repo: EntitySqliteRepository, seq: number): Promise<void> => {
  await repo.setMetadata(CURSOR_KEY, String(Math.max(0, Math.floor(seq))));
};

export const getOrCreateDeviceId = async (repo: EntitySqliteRepository): Promise<string> => {
  const existing = await repo.getMetadata(DEVICE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await repo.setMetadata(DEVICE_KEY, id);
  return id;
};

// --- dirty set ------------------------------------------------------------

export interface DirtyEntity {
  localId: string;
  kind: SqliteEntityKind;
  revision: number;
  deleted: boolean;
  /** null until the entity has been synced at least once. */
  centralId: string | null;
  /** Central revision we last agreed on (0 for a never-synced entity). */
  baseRevision: number;
  baseHash: string | null;
}

/**
 * Entities that differ from their last synced state: no `sync_state` row, or a
 * `project_revision` that no longer matches `entities.revision`. Entities with
 * an open conflict are excluded — they can't push until resolved.
 */
export const listDirtyForSync = async (repo: EntitySqliteRepository): Promise<DirtyEntity[]> => {
  const rows = (await repo.backend.all(
    `SELECT e.id                          AS localId,
              e.kind                        AS kind,
              e.revision                    AS revision,
              CASE WHEN e.deleted_at IS NOT NULL THEN 1 ELSE 0 END AS deleted,
              ss.central_entity_id          AS centralId,
              ss.central_revision           AS baseRevision,
              ss.central_hash               AS baseHash
         FROM entities e
         LEFT JOIN sync_state ss ON ss.project_entity_id = e.id
         WHERE (ss.project_entity_id IS NULL OR ss.project_revision <> e.revision)
           AND NOT EXISTS (
             SELECT 1 FROM sync_conflicts c
              WHERE c.status = 'open' AND c.project_entity_id = e.id
           )
         ORDER BY e.id`,
  )) as {
    localId: string;
    kind: SqliteEntityKind;
    revision: number;
    deleted: number;
    centralId: string | null;
    baseRevision: number | null;
    baseHash: string | null;
  }[];

  return rows.map((row) => ({
    localId: row.localId,
    kind: row.kind,
    revision: row.revision,
    deleted: row.deleted === 1,
    centralId: row.centralId,
    baseRevision: row.baseRevision ?? 0,
    baseHash: row.baseHash,
  }));
};

// --- sync_state ---------------------------------------------------------

export interface SyncStateRow {
  projectEntityId: string;
  centralEntityId: string;
  centralRevision: number;
  projectRevision: number;
  centralHash: string;
  projectHash: string;
}

export const getSyncState = async (
  repo: EntitySqliteRepository,
  projectEntityId: string,
): Promise<SyncStateRow | null> => {
  const row = (await repo.backend.get(
    `SELECT project_entity_id, central_entity_id, central_revision,
              project_revision, central_hash, project_hash
         FROM sync_state WHERE project_entity_id = ?`,
    [projectEntityId],
  )) as
    | {
        project_entity_id: string;
        central_entity_id: string;
        central_revision: number;
        project_revision: number;
        central_hash: string;
        project_hash: string;
      }
    | undefined;
  if (!row) return null;
  return {
    projectEntityId: row.project_entity_id,
    centralEntityId: row.central_entity_id,
    centralRevision: row.central_revision,
    projectRevision: row.project_revision,
    centralHash: row.central_hash,
    projectHash: row.project_hash,
  };
};

export const upsertSyncState = async (
  repo: EntitySqliteRepository,
  state: SyncStateRow,
): Promise<void> => {
  await repo.backend.run(
    `INSERT INTO sync_state
         (project_entity_id, central_entity_id, central_revision, project_revision,
          central_hash, project_hash, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_entity_id, central_entity_id) DO UPDATE SET
         central_revision = excluded.central_revision,
         project_revision = excluded.project_revision,
         central_hash     = excluded.central_hash,
         project_hash     = excluded.project_hash,
         synced_at        = excluded.synced_at`,
    [
      state.projectEntityId,
      state.centralEntityId,
      state.centralRevision,
      state.projectRevision,
      state.centralHash,
      state.projectHash,
      new Date().toISOString(),
    ],
  );
};

// --- sync_conflicts ---------------------------------------------------

export interface OpenConflictInput {
  projectEntityId: string;
  centralEntityId: string;
  reason: string;
  projectRevision: number;
  centralRevision: number;
  projectSnapshot: string;
  centralSnapshot: string;
}

export interface SyncConflict extends OpenConflictInput {
  id: number;
  createdAt: string;
}

/** Insert a conflict unless one is already open for the same entity pair. */
export const openConflict = async (
  repo: EntitySqliteRepository,
  input: OpenConflictInput,
): Promise<void> => {
  await repo.backend.run(
    `INSERT INTO sync_conflicts
         (project_entity_id, central_entity_id, reason, project_revision, central_revision,
          project_snapshot, central_snapshot, status, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM sync_conflicts
          WHERE status = 'open' AND project_entity_id = ? AND central_entity_id = ?
       )`,
    [
      input.projectEntityId,
      input.centralEntityId,
      input.reason,
      input.projectRevision,
      input.centralRevision,
      input.projectSnapshot,
      input.centralSnapshot,
      new Date().toISOString(),
      input.projectEntityId,
      input.centralEntityId,
    ],
  );
};

export const listOpenConflicts = async (repo: EntitySqliteRepository): Promise<SyncConflict[]> => {
  const rows = (await repo.backend.all(
    `SELECT id, project_entity_id, central_entity_id, reason, project_revision,
              central_revision, project_snapshot, central_snapshot, created_at
         FROM sync_conflicts WHERE status = 'open' ORDER BY created_at, id`,
  )) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    projectEntityId: String(row.project_entity_id),
    centralEntityId: String(row.central_entity_id),
    reason: String(row.reason),
    projectRevision: Number(row.project_revision),
    centralRevision: Number(row.central_revision),
    projectSnapshot: String(row.project_snapshot),
    centralSnapshot: String(row.central_snapshot),
    createdAt: String(row.created_at),
  }));
};

export const countOpenConflicts = async (repo: EntitySqliteRepository): Promise<number> => {
  const row = (await repo.backend.get(
    `SELECT COUNT(*) AS n FROM sync_conflicts WHERE status = 'open'`,
  )) as { n: number };
  return row.n;
};

export const resolveConflict = async (repo: EntitySqliteRepository, id: number): Promise<boolean> => {
  const result = await repo.backend.run(
    `UPDATE sync_conflicts SET status = 'resolved', resolved_at = ?
        WHERE id = ? AND status = 'open'`,
    [new Date().toISOString(), id],
  );
  return result.changes > 0;
};

// --- applying a remote entity --------------------------------------

export interface ApplyRemoteResult {
  /** Content hash of the local entity after applying. */
  afterHash: string;
  /** Live `entities.revision` after applying (for `sync_state.project_revision`). */
  projectRevision: number;
}

/**
 * Bring the local entity `centralId` in line with a remote change. The payload
 * is a single TEI entity element (from another client's
 * `exportEntityElementXml`); it's imported into an in-memory repository and
 * then copied over, reusing the tested `replaceEntityContentBetween` path.
 * Creates the local entity if it doesn't exist yet.
 *
 * Caller runs this inside `repo.transaction()`.
 */
export const applyRemoteEntity = async (
  repo: EntitySqliteRepository,
  change: { centralId: string; kind: SqliteEntityKind; contentXml: string; deleted: boolean },
): Promise<ApplyRemoteResult> => {
  const existing = await repo.getEntity(change.centralId);

  if (change.deleted) {
    if (existing && !existing.deletedAt) await repo.softDeleteEntity(change.centralId);
    const after = await repo.getEntity(change.centralId);
    return {
      afterHash: (await computeEntityContentHash(repo, change.centralId)) ?? '',
      projectRevision: after?.revision ?? existing?.revision ?? 0,
    };
  }

  const wrapper = ENTITY_LIST_BY_KIND[change.kind];
  const openTag = wrapper.type ? `<${wrapper.tag} type="${wrapper.type}">` : `<${wrapper.tag}>`;
  const wrapped =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<TEI xmlns="${TEI_NS}"><teiHeader><fileDesc><publicationStmt>` +
    `<idno type="grognard-entity-database">grognard-entity-sync</idno>` +
    `</publicationStmt></fileDesc></teiHeader>` +
    `<standOff>${openTag}${change.contentXml}</${wrapper.tag}></standOff></TEI>`;

  const staging = await EntitySqliteRepository.open(':memory:');
  try {
    await importEntitiesXml(staging, wrapped, { replace: true });
    if (!existing) {
      await repo.createEntity({ id: change.centralId, kind: change.kind });
    } else if (existing.deletedAt) {
      // Central un-deleted it; clear the tombstone before copying content back.
      await repo.backend.run(`UPDATE entities SET deleted_at = NULL WHERE id = ?`, [change.centralId]);
    }
    await repo.replaceEntityContentFrom(staging, change.centralId, change.centralId);
  } finally {
    await staging.close();
  }

  const after = await repo.getEntity(change.centralId);
  return {
    afterHash: (await computeEntityContentHash(repo, change.centralId)) ?? '',
    projectRevision: after?.revision ?? 0,
  };
};

export { CURSOR_KEY, DEVICE_KEY };
export const exportLocalEntityXml = exportEntityElementXml;
export const localEntityHash = computeEntityContentHash;
