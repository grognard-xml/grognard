/**
 * Backend-agnostic logical export of the entity database, for Turso-backed
 * PEDBs — `VACUUM INTO` (the local-file backup path in `entityDbBackup.ts`)
 * needs a local file handle a hosted database doesn't have. This walks every
 * user table via ordinary `SELECT`s (no PRAGMA writes, which a real Turso
 * database rejects) and serializes rows as `INSERT` statements in a
 * deterministic table-name and rowid order, so two exports of an unchanged
 * database are byte-identical.
 *
 * Restore is a manual replay of the resulting script against a database
 * whose schema already exists (opening a project mints the schema via the
 * normal migration path) — see `entityDbBackup.ts`'s `restoreSnapshot`.
 */
import type { EntityDbBackend } from './backend';

/** Bookkeeping tables that are backend/runtime detail, not project data. */
const EXCLUDED_TABLES = new Set(['schema_version', 'sqlite_sequence']);

const sqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

export interface LogicalSnapshotStats {
  tables: number;
  rows: number;
}

export interface LogicalSnapshot {
  sql: string;
  stats: LogicalSnapshotStats;
}

/** Serializes every project table's rows as `INSERT` statements. */
export const createLogicalSnapshot = async (backend: EntityDbBackend): Promise<LogicalSnapshot> => {
  const tableRows = await backend.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const tables = tableRows.map((row) => row.name).filter((name) => !EXCLUDED_TABLES.has(name));

  const lines: string[] = [
    '-- Grognard logical entity-database snapshot',
    `-- generated ${new Date().toISOString()}`,
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
  ];
  let rowCount = 0;
  for (const table of tables) {
    const rows = await backend.all<Record<string, unknown>>(`SELECT * FROM "${table}" ORDER BY rowid`);
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((column) => sqlLiteral(row[column]));
      lines.push(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`,
      );
      rowCount += 1;
    }
  }
  lines.push('COMMIT;');

  return { sql: lines.join('\n'), stats: { tables: tables.length, rows: rowCount } };
};

/** Exported for tests. */
export const __testing = { sqlLiteral, EXCLUDED_TABLES };
