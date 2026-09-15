import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { EntityDbBackend, EntityDbRunResult } from './backend';

const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Wraps the existing local-file `node:sqlite` access behind `EntityDbBackend`.
 * Every call is synchronous under the hood (as it always was); this class
 * only adds the `Promise` wrapper so local-file and network backends share
 * one interface. Behavior for local-file projects is unchanged.
 */
export class NodeSqliteBackend implements EntityDbBackend {
  readonly db: DatabaseSyncType;

  /** Nesting depth so bulk callers can wrap helpers that also use `transaction`. */
  private txDepth = 0;

  /** Pass a path to open a new connection, or an already-open `DatabaseSync` to wrap it. */
  constructor(databasePathOrConnection: string | DatabaseSyncType = ':memory:') {
    this.db =
      typeof databasePathOrConnection === 'string'
        ? new DatabaseSync(databasePathOrConnection)
        : databasePathOrConnection;
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<EntityDbRunResult> {
    const result = this.db.prepare(sql).run(...(params as never[]));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  async transaction<T>(fn: (tx: EntityDbBackend) => Promise<T>): Promise<T> {
    if (this.txDepth > 0) {
      this.txDepth += 1;
      try {
        return await fn(this);
      } finally {
        this.txDepth -= 1;
      }
    }
    this.txDepth = 1;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    } finally {
      this.txDepth = 0;
    }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async getSchemaVersion(): Promise<number> {
    const row = this.db.prepare('PRAGMA user_version').get() as
      { user_version?: number } | undefined;
    return Number(row?.user_version ?? 0);
  }

  async setSchemaVersion(version: number): Promise<void> {
    this.db.exec(`PRAGMA user_version = ${version};`);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
