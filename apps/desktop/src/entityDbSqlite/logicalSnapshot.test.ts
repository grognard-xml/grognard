import { NodeSqliteBackend } from './nodeSqliteBackend';
import { createLogicalSnapshot } from './logicalSnapshot';

describe('createLogicalSnapshot', () => {
  it('serializes rows as INSERT statements, ordered by table name then rowid', async () => {
    const backend = new NodeSqliteBackend(':memory:');
    await backend.exec(`
      CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT, note TEXT);
      CREATE TABLE apples (id INTEGER PRIMARY KEY, label TEXT);
    `);
    await backend.run('INSERT INTO widgets (id, name, note) VALUES (?, ?, ?)', [
      1,
      "O'Brien",
      null,
    ]);
    await backend.run('INSERT INTO widgets (id, name, note) VALUES (?, ?, ?)', [2, 'plain', 'hi']);
    await backend.run('INSERT INTO apples (id, label) VALUES (?, ?)', [1, 'gala']);

    const { sql, stats } = await createLogicalSnapshot(backend);
    await backend.close();

    expect(stats).toEqual({ tables: 2, rows: 3 });
    // apples (alphabetically first) precedes widgets.
    expect(sql.indexOf('INSERT INTO "apples"')).toBeLessThan(sql.indexOf('INSERT INTO "widgets"'));
    // Rows within a table are in rowid order.
    expect(sql.indexOf('VALUES (1,')).toBeLessThan(sql.indexOf('VALUES (2,'));
    // Interior quotes are doubled; NULL is unquoted.
    expect(sql).toContain(`VALUES (1, 'O''Brien', NULL)`);
    expect(sql).toContain('BEGIN TRANSACTION;');
    expect(sql).toContain('COMMIT;');
  });

  it('excludes the schema_version bookkeeping table used by a network backend', async () => {
    const backend = new NodeSqliteBackend(':memory:');
    await backend.exec('CREATE TABLE things (id INTEGER PRIMARY KEY)');
    // TursoBackend tracks schema version in an ordinary table (see tursoBackend.ts);
    // a snapshot must not treat it as project data even when it exists.
    await backend.exec(
      'CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
    );
    await backend.run('INSERT INTO schema_version (id, version) VALUES (1, 3)');

    const { sql, stats } = await createLogicalSnapshot(backend);
    await backend.close();

    expect(stats).toEqual({ tables: 1, rows: 0 });
    expect(sql).not.toContain('schema_version');
  });
});
