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
 * Splits a semicolon-separated SQL script into individual statements, for
 * `exec()`. Respects quoted strings/identifiers so a `;` inside one doesn't
 * split mid-statement. This is only ever fed our own migration SQL (never
 * user-supplied text), so a straightforward quote-aware split is sufficient.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    current += ch;
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          current += sql[++i];
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.slice(0, -1).trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
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
 *
 * `exec()` deliberately does not use libSQL's `executeMultiple` — that
 * method isn't reliably supported over the remote HTTP/Hrana transport
 * (observed: `SERVER_ERROR: Server returned HTTP status 400` on a real
 * Turso database, even for a single PRAGMA statement). It also doesn't use
 * `batch()` — that always wraps the statements in their own transaction,
 * and SQLite forbids `PRAGMA journal_mode` changes inside a transaction
 * (observed: `cannot change into wal mode from within a transaction`).
 * Instead, `exec()` splits the script and runs each statement individually
 * via `execute()`, matching `NodeSqliteBackend`'s actual semantics: neither
 * gives per-statement atomicity on its own — the caller (`applyEntityDbMigrations`)
 * supplies that by wrapping each migration in `db.transaction()`.
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
    for (const statement of splitStatements(sql)) {
      await this.executor.execute(statement);
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
