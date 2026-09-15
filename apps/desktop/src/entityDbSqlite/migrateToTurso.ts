/**
 * One-time copy of an existing local `entities.sqlite`'s rows into a
 * freshly-connected Turso database, for a project switching backends via
 * Settings > Project > "Shared project database". Flipping that switch
 * (`projectFile.ts`'s `pedb` field) never touches the local file or the
 * remote database on its own — this is the explicit, opt-in step that
 * actually moves the data, run once before a project's collaborators start
 * relying on the shared database.
 */
import type { EntityDbBackend } from './backend';

/** Bookkeeping tables that are backend/runtime detail, not project data. */
const EXCLUDED_TABLES = new Set(['schema_version', 'sqlite_sequence']);

interface TableSchema {
  name: string;
  sql: string;
}

/** Every other table this table's `CREATE TABLE` text declares a `REFERENCES` to. */
const referencedTables = (sql: string, knownTables: Set<string>): string[] => {
  const found = new Set<string>();
  const pattern = /REFERENCES\s+"?(\w+)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(sql))) {
    const name = match[1];
    if (name && knownTables.has(name)) found.add(name);
  }
  return [...found];
};

/**
 * Orders tables so that any table referenced by another table's foreign key
 * always comes first — plain alphabetical order gets this wrong for this
 * schema (e.g. `work_authors` sorts before `works`, which it references,
 * because `_` sorts before a letter). A depth-first postorder over each
 * table's own `REFERENCES` gives a correct insertion order without hand-
 * maintaining one as the schema evolves. Falls back to alphabetical among
 * whatever remains if a cycle is ever introduced (none exist today).
 */
const topologicalTableOrder = (tables: TableSchema[]): string[] => {
  const knownTables = new Set(tables.map((t) => t.name));
  const dependsOn = new Map(
    tables.map((t) => [t.name, referencedTables(t.sql, knownTables).filter((n) => n !== t.name)]),
  );

  const ordered: string[] = [];
  const done = new Set<string>();
  const inProgress = new Set<string>();

  const visit = (name: string): void => {
    if (done.has(name) || inProgress.has(name)) return;
    inProgress.add(name);
    for (const dep of dependsOn.get(name) ?? []) visit(dep);
    inProgress.delete(name);
    done.add(name);
    ordered.push(name);
  };

  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    visit(table.name);
  }
  return ordered;
};

export interface MigrationStats {
  tables: number;
  rows: number;
}

/** Thrown instead of overwriting a Turso database that already has project data. */
export class MigrationTargetNotEmptyError extends Error {
  constructor(readonly table: string) {
    super(
      `The target database already has data (table "${table}" is not empty) — refusing to ` +
        'migrate into it. Migrate into a fresh, empty Turso database instead.',
    );
    this.name = 'MigrationTargetNotEmptyError';
  }
}

/**
 * Copies every row of `source` into `target`, table by table in FK-safe
 * order, inside one transaction on `target`. Both must already have the
 * schema migrated (the normal `EntitySqliteRepository.open()` / direct
 * `applyEntityDbMigrations()` path) — this only moves data, it never creates
 * tables. Refuses outright if `target` already holds any rows, so a stale
 * local snapshot can never clobber a database collaborators are already
 * using.
 */
export const migrateLocalEntitiesToTurso = async (
  source: EntityDbBackend,
  target: EntityDbBackend,
): Promise<MigrationStats> => {
  const tableRows = await source.all<TableSchema>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const tables = tableRows.filter((t) => !EXCLUDED_TABLES.has(t.name));
  const order = topologicalTableOrder(tables);

  for (const name of order) {
    const row = await target.get<{ n: number }>(`SELECT COUNT(*) as n FROM "${name}"`);
    if ((row?.n ?? 0) > 0) throw new MigrationTargetNotEmptyError(name);
  }

  let rowCount = 0;
  await target.transaction(async (tx) => {
    for (const name of order) {
      const rows = await source.all<Record<string, unknown>>(
        `SELECT * FROM "${name}" ORDER BY rowid`,
      );
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(', ');
        await tx.run(
          `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          columns.map((c) => row[c]),
        );
        rowCount += 1;
      }
    }
  });

  return { tables: order.length, rows: rowCount };
};

/** Exported for tests. */
export const __testing = { topologicalTableOrder, referencedTables };
