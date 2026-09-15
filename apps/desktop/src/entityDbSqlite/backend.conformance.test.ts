/**
 * Shared conformance suite for EntityDbBackend implementations. Run against
 * NodeSqliteBackend (today's local-file store) and TursoBackend pointed at
 * a local libSQL file (`file:` URL — real SQLite underneath, no network or
 * Turso account needed) so the two backends are held to the same contract.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EntityDbBackend } from './backend';
import { NodeSqliteBackend } from './nodeSqliteBackend';
import { TursoBackend } from './tursoBackend';

const backends: { name: string; open: () => EntityDbBackend | Promise<EntityDbBackend> }[] = [
  { name: 'NodeSqliteBackend', open: () => new NodeSqliteBackend(':memory:') },
  {
    name: 'TursoBackend (file:)',
    open: () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'grognard-turso-conformance-'));
      return new TursoBackend({ url: `file:${path.join(directory, 'entities.sqlite')}` });
    },
  },
];

describe.each(backends)('$name conformance', ({ open }) => {
  let backend: EntityDbBackend;

  beforeEach(async () => {
    backend = await open();
    await backend.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER)');
  });

  afterEach(async () => {
    await backend.close();
  });

  it('run() inserts and reports changes + lastInsertRowid', async () => {
    const result = await backend.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['bolt', 10]);
    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  it('get() returns one row or undefined', async () => {
    await backend.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['bolt', 10]);
    const row = await backend.get<{ name: string; qty: number }>(
      'SELECT name, qty FROM widgets WHERE name = ?',
      ['bolt'],
    );
    expect(row).toEqual({ name: 'bolt', qty: 10 });
    expect(await backend.get('SELECT name FROM widgets WHERE name = ?', ['missing'])).toBeUndefined();
  });

  it('all() returns every matching row', async () => {
    await backend.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['bolt', 10]);
    await backend.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['nut', 20]);
    const rows = await backend.all<{ name: string }>('SELECT name FROM widgets ORDER BY name');
    expect(rows).toEqual([{ name: 'bolt' }, { name: 'nut' }]);
  });

  it('run() updates and deletes report the right change count', async () => {
    await backend.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['bolt', 10]);
    const updated = await backend.run('UPDATE widgets SET qty = ? WHERE name = ?', [15, 'bolt']);
    expect(updated.changes).toBe(1);
    const deleted = await backend.run('DELETE FROM widgets WHERE name = ?', ['bolt']);
    expect(deleted.changes).toBe(1);
    expect(await backend.get('SELECT 1 FROM widgets WHERE name = ?', ['bolt'])).toBeUndefined();
  });

  it('transaction() commits on success', async () => {
    await backend.transaction(async (tx) => {
      await tx.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['washer', 5]);
    });
    expect(await backend.get('SELECT qty FROM widgets WHERE name = ?', ['washer'])).toEqual({
      qty: 5,
    });
  });

  it('transaction() rolls back on throw, leaving no trace', async () => {
    await expect(
      backend.transaction(async (tx) => {
        await tx.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['screw', 1]);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await backend.get('SELECT 1 FROM widgets WHERE name = ?', ['screw'])).toBeUndefined();
  });

  it('transaction() return value propagates', async () => {
    const result = await backend.transaction(async (tx) => {
      await tx.run('INSERT INTO widgets (name, qty) VALUES (?, ?)', ['rivet', 3]);
      return (await tx.get<{ qty: number }>('SELECT qty FROM widgets WHERE name = ?', ['rivet']))
        ?.qty;
    });
    expect(result).toBe(3);
  });
});
