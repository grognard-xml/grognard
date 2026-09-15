/**
 * Storage-backend abstraction for the entity database repository.
 *
 * `EntitySqliteRepository` talks to this interface instead of `node:sqlite`
 * directly, so the same repository logic can run against a local file
 * (`NodeSqliteBackend`) or a network database such as Turso (`TursoBackend`,
 * added separately) without a second conversion pass.
 */
export interface EntityDbRunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface EntityDbBackend {
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<EntityDbRunResult>;
  /**
   * Runs `fn` inside a transaction. Nestable: an inner call reuses the
   * outer transaction rather than starting a second one (matches the
   * existing `BEGIN IMMEDIATE` nesting behavior in `repository.ts`).
   */
  transaction<T>(fn: (tx: EntityDbBackend) => Promise<T>): Promise<T>;
  /**
   * Runs a raw, possibly multi-statement SQL script with no parameter
   * binding and no result — for schema migrations and SQLite-specific
   * PRAGMAs. Local-file-specific in spirit; a network backend may only
   * support a subset (see `TursoBackend`, added separately).
   */
  exec(sql: string): Promise<void>;
  /**
   * The schema/migration version this database is currently at (0 for a
   * fresh database). NodeSqliteBackend uses SQLite's built-in
   * `PRAGMA user_version` (unchanged from before the backend abstraction —
   * every existing local `entities.sqlite` already carries a version there,
   * so this must never be reassigned to a different mechanism for local
   * databases). A network backend may not be able to write PRAGMAs at all
   * (confirmed on a real Turso database: `PRAGMA user_version = N` is
   * rejected outright) and must track this some other way — see
   * `TursoBackend`, which uses an ordinary table.
   */
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;
  close(): Promise<void>;
}

/** Which storage a repository should open, and how. */
export type EntityDbConnection =
  { backend: 'local'; path: string } | { backend: 'turso'; url: string; authToken?: string };
