import { applyEntityDbMigrations } from './schema';
import { NodeSqliteBackend } from './nodeSqliteBackend';
import {
  migrateLocalEntitiesToTurso,
  MigrationTargetNotEmptyError,
  __testing,
} from './migrateToTurso';

const { topologicalTableOrder } = __testing;

describe('topologicalTableOrder', () => {
  it('orders a table before another table that references it, even against alphabetical order', () => {
    // "works" is referenced by "work_authors" — alphabetically "work_authors"
    // sorts first (an underscore sorts before a letter), which would violate
    // the foreign key if used as insertion order.
    const tables = [
      {
        name: 'work_authors',
        sql: 'CREATE TABLE work_authors (work_id TEXT REFERENCES works(entity_id))',
      },
      { name: 'works', sql: 'CREATE TABLE works (entity_id TEXT PRIMARY KEY)' },
    ];
    const order = topologicalTableOrder(tables);
    expect(order.indexOf('works')).toBeLessThan(order.indexOf('work_authors'));
  });

  it('leaves independent tables in alphabetical order', () => {
    const tables = [
      { name: 'zeta', sql: 'CREATE TABLE zeta (id TEXT PRIMARY KEY)' },
      { name: 'alpha', sql: 'CREATE TABLE alpha (id TEXT PRIMARY KEY)' },
    ];
    expect(topologicalTableOrder(tables)).toEqual(['alpha', 'zeta']);
  });
});

describe('migrateLocalEntitiesToTurso', () => {
  const seedSource = async () => {
    const source = new NodeSqliteBackend(':memory:');
    await applyEntityDbMigrations(source);
    await source.run(
      "INSERT INTO entities (id, kind, created_at, updated_at) VALUES ('p1', 'person', '2026-01-01', '2026-01-01')",
    );
    await source.run("INSERT INTO people (entity_id) VALUES ('p1')");
    await source.run(
      "INSERT INTO entity_names (entity_id, text, is_primary, created_at, updated_at) VALUES ('p1', 'Zhang Heng', 1, '2026-01-01', '2026-01-01')",
    );
    return source;
  };

  it('copies every row into an empty target, respecting foreign keys', async () => {
    const source = await seedSource();
    const target = new NodeSqliteBackend(':memory:');
    await applyEntityDbMigrations(target);

    const stats = await migrateLocalEntitiesToTurso(source, target);
    expect(stats.rows).toBe(3);

    const entity = await target.get<{ id: string }>('SELECT id FROM entities WHERE id = ?', ['p1']);
    expect(entity?.id).toBe('p1');
    const person = await target.get<{ entity_id: string }>(
      'SELECT entity_id FROM people WHERE entity_id = ?',
      ['p1'],
    );
    expect(person?.entity_id).toBe('p1');
    const name = await target.get<{ text: string }>(
      'SELECT text FROM entity_names WHERE entity_id = ?',
      ['p1'],
    );
    expect(name?.text).toBe('Zhang Heng');

    await source.close();
    await target.close();
  });

  it('refuses to migrate into a target that already has data', async () => {
    const source = await seedSource();
    const target = new NodeSqliteBackend(':memory:');
    await applyEntityDbMigrations(target);
    await target.run(
      "INSERT INTO entities (id, kind, created_at, updated_at) VALUES ('existing', 'person', '2026-01-01', '2026-01-01')",
    );

    await expect(migrateLocalEntitiesToTurso(source, target)).rejects.toThrow(
      MigrationTargetNotEmptyError,
    );

    // Nothing from source was written before the refusal.
    const rows = await target.all('SELECT id FROM entities');
    expect(rows).toHaveLength(1);

    await source.close();
    await target.close();
  });
});
