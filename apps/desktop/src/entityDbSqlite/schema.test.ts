import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyEntityDbMigrations, migrations, ENTITY_DB_SCHEMA_VERSION } from './schema';
import { NodeSqliteBackend } from './nodeSqliteBackend';

const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** Runs migrations 1..version only, leaving the DB at that schema version. */
function seedAtVersion(db: InstanceType<typeof DatabaseSync>, version: number): void {
  db.exec('PRAGMA foreign_keys = ON;');
  for (let v = 1; v <= version; v += 1) {
    db.exec('BEGIN IMMEDIATE;');
    db.exec(migrations[v]!);
    db.exec(`PRAGMA user_version = ${v};`);
    db.exec('COMMIT;');
  }
}

describe('migration 11 (widen entities.kind to include "thing")', () => {
  it('preserves every existing row across every FK-referencing table', async () => {
    const db = new DatabaseSync(':memory:');
    seedAtVersion(db, 10);

    const now = '2026-01-01T00:00:00Z';
    db.prepare(
      `INSERT INTO entities (id, kind, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('person-1', 'person', 'A person', now, now);
    db.prepare(`INSERT INTO people (entity_id) VALUES (?)`).run('person-1');
    db.prepare(
      `INSERT INTO entity_names
         (entity_id, text, name_type, name_role, is_primary, origin, status, created_at, updated_at)
       VALUES (?, ?, NULL, 'primary', 1, 'user', 'active', ?, ?)`,
    ).run('person-1', 'Zhang Heng', now, now);

    db.prepare(
      `INSERT INTO entities (id, kind, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('work-1', 'work', 'A work', now, now);
    db.prepare(`INSERT INTO works (entity_id) VALUES (?)`).run('work-1');

    db.prepare(
      `INSERT INTO entity_relations
         (relation_type, subject_entity_id, object_entity_id, active, passive, symmetric, status, created_at, updated_at)
       VALUES ('discussion', ?, ?, '#person-1', '#work-1', 0, 'active', ?, ?)`,
    ).run('person-1', 'work-1', now, now);

    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);

    await applyEntityDbMigrations(new NodeSqliteBackend(db));

    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(ENTITY_DB_SCHEMA_VERSION);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    expect(db.prepare('SELECT * FROM entities WHERE id = ?').get('person-1')).toMatchObject({
      id: 'person-1',
      kind: 'person',
      description: 'A person',
    });
    expect(db.prepare('SELECT 1 FROM people WHERE entity_id = ?').get('person-1')).toEqual({
      1: 1,
    });
    expect(db.prepare('SELECT text FROM entity_names WHERE entity_id = ?').get('person-1')).toEqual(
      { text: 'Zhang Heng' },
    );
    expect(
      db
        .prepare('SELECT relation_type, subject_entity_id, object_entity_id FROM entity_relations')
        .get(),
    ).toEqual({
      relation_type: 'discussion',
      subject_entity_id: 'person-1',
      object_entity_id: 'work-1',
    });

    db.close();
  });

  it('accepts kind = "thing" and creates the things table', async () => {
    const db = new DatabaseSync(':memory:');
    await applyEntityDbMigrations(new NodeSqliteBackend(db));

    const now = '2026-01-01T00:00:00Z';
    expect(() =>
      db
        .prepare(
          `INSERT INTO entities (id, kind, created_at, updated_at) VALUES (?, 'thing', ?, ?)`,
        )
        .run('thing-1', now, now),
    ).not.toThrow();
    expect(() =>
      db.prepare(`INSERT INTO things (entity_id) VALUES (?)`).run('thing-1'),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          `INSERT INTO entities (id, kind, created_at, updated_at) VALUES (?, 'bogus', ?, ?)`,
        )
        .run('bogus-1', now, now),
    ).toThrow();

    db.close();
  });
});
