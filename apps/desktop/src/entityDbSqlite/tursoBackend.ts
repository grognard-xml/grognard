import { createClient, type Client, type InArgs, type InStatement, type ResultSet } from '@libsql/client';
import type { EntityDbBackend, EntityDbRunResult } from './backend';

export interface TursoConnectionConfig {
  /**
   * `libsql://…` (Turso), `http(s)://…`, or `file:…` for a local libSQL file
   * (used by tests — no network or account needed).
   */
  url: string;
  /** Not needed for a local `file:` URL. */
  authToken?: string;
}

/** The subset of libSQL's `Client`/`Transaction` shape this backend needs — both implement it. */
interface Executor {
  execute(stmt: InStatement): Promise<ResultSet>;
  executeMultiple(sql: string): Promise<void>;
}

type TursoSource = TursoConnectionConfig | { client: Client; executor: Executor };

function rowsToObjects(result: ResultSet): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i += 1) {
      obj[result.columns[i]!] = row[i];
    }
    return obj;
  });
}

/**
 * EntityDbBackend implementation over a Turso/libSQL database — the shared,
 * network-accessible Project Entity Database for real-time multi-collaborator
 * projects. The repository layer talks to this exactly as it talks to
 * NodeSqliteBackend; it doesn't know or care which one it has.
 *
 * PRAGMA-based migration steps (WAL mode, foreign key toggling) are a known
 * local-file-specific soft spot — see docs/entity-sync-planning.md and the
 * Turso backend plan. A `file:` URL (used by tests) runs real SQLite
 * underneath and behaves correctly; a genuine remote Turso connection may
 * not honor every PRAGMA the same way. Not solved here — flagged, not silent.
 */
export class TursoBackend implements EntityDbBackend {
  private readonly client: Client;
  private readonly executor: Executor;

  constructor(source: TursoSource) {
    if ('client' in source) {
      this.client = source.client;
      this.executor = source.executor;
    } else {
      this.client = createClient(source);
      this.executor = this.client;
    }
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.executor.execute({ sql, args: params as InArgs });
    if (result.rows.length === 0) return undefined;
    return rowsToObjects(result)[0] as T;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.executor.execute({ sql, args: params as InArgs });
    return rowsToObjects(result) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<EntityDbRunResult> {
    const result = await this.executor.execute({ sql, args: params as InArgs });
    return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
  }

  async transaction<T>(fn: (tx: EntityDbBackend) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction('write');
    try {
      const scoped = new TursoBackend({ client: this.client, executor: tx });
      const result = await fn(scoped);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        // already closed by a failed commit/rollback above
      }
      throw error;
    } finally {
      tx.close();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.executor.executeMultiple(sql);
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
