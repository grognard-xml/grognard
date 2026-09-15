import {
  createClient,
  type Client,
  type InArgs,
  type InStatement,
  type ResultSet,
} from '@libsql/client/web';
import type { EntityDbBackend, EntityDbRunResult } from './backend';

export interface TursoConnectionConfig {
  /**
   * `libsql://…` (Turso), or `http(s)://…`/`ws(s)://…` directly. Always a
   * remote database — see the module doc comment for why.
   */
  url: string;
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
 * Storage-tuning PRAGMAs a hosted, multi-tenant Turso database manages
 * itself and rejects outright from a client — confirmed against a real
 * Turso database: `SQL_PARSE_ERROR: SQL not allowed statement: PRAGMA
 * journal_mode = WAL`. Silently skipped by `exec()`, remote only; a local
 * `file:` connection (real SQLite underneath) still honors them, and
 * NodeSqliteBackend always did. `PRAGMA foreign_keys` and `PRAGMA
 * user_version` are not in this set — they affect query/constraint
 * semantics and our own schema-version bookkeeping, not storage engine
 * internals, and are expected to work remotely (unconfirmed further than
 * that; revisit if a future run says otherwise).
 */
const REMOTE_UNSUPPORTED_PRAGMAS = /^PRAGMA\s+(journal_mode|synchronous)\s*=/i;

/**
 * EntityDbBackend implementation over a Turso/libSQL database — the shared,
 * network-accessible Project Entity Database for real-time multi-collaborator
 * projects. The repository layer talks to this exactly as it talks to
 * NodeSqliteBackend; it doesn't know or care which one it has.
 *
 * Built on `@libsql/client/web`, not the default `@libsql/client` — the
 * default build's Node entry point statically pulls in `libsql`, a native
 * addon shipped as a separate prebuilt binary per OS/arch, purely so it can
 * also support local `file:` databases. There is no `win32-arm64` build of
 * that binary at all, and this backend only ever talks to a remote database
 * in production anyway (see `TursoConnectionConfig`). The `/web` build talks
 * WebSocket/HTTPS only, through `ws` (pure JS), so it runs identically on
 * every platform Electron does. A local `file:` client for testing is built
 * directly against `@libsql/client`'s Node build and passed in via the
 * `{ client, executor }` constructor form instead (see the conformance
 * suite) — dev/test-only, never part of the packaged app.
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
    const isRemote = this.client.protocol !== 'file';
    for (const statement of splitStatements(sql)) {
      if (isRemote && REMOTE_UNSUPPORTED_PRAGMAS.test(statement)) continue;
      await this.executor.execute(statement);
    }
  }

  /**
   * `PRAGMA user_version = N` is rejected outright by a real Turso database
   * (`SQL_PARSE_ERROR: SQL not allowed statement`), so schema version is
   * tracked in an ordinary single-row table instead. Safe because Turso
   * support is new — there's no existing remote database whose version
   * bookkeeping this would need to stay compatible with.
   */
  async getSchemaVersion(): Promise<number> {
    await this.executor.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
    );
    const result = await this.executor.execute('SELECT version FROM schema_version WHERE id = 1');
    return result.rows.length > 0 ? Number(result.rows[0]![0]) : 0;
  }

  async setSchemaVersion(version: number): Promise<void> {
    await this.executor.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
    );
    await this.executor.execute({
      sql: 'INSERT INTO schema_version (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version',
      args: [version],
    });
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
