import type { EntityDbBackend, EntityDbConnection } from './backend';
import { NodeSqliteBackend } from './nodeSqliteBackend';

/** A bare string is shorthand for `{ backend: 'local', path }` — today's default. */
export type EntityDbConnectionInput = EntityDbConnection | string;

export function normalizeEntityDbConnection(input: EntityDbConnectionInput): EntityDbConnection {
  return typeof input === 'string' ? { backend: 'local', path: input } : input;
}

/** A stable string identity for a connection, for caching one open repository per target. */
export function entityDbConnectionKey(input: EntityDbConnectionInput): string {
  const connection = normalizeEntityDbConnection(input);
  return connection.backend === 'local' ? `local:${connection.path}` : `turso:${connection.url}`;
}

/**
 * A static top-level import of `tursoBackend.ts` would load `@libsql/client`
 * at process startup for every install, local-only projects included.
 * Importing it only when a Turso connection is actually opened keeps the
 * overwhelmingly common local-only path unaffected.
 */
export async function openBackendForConnection(
  input: EntityDbConnectionInput,
): Promise<EntityDbBackend> {
  const connection = normalizeEntityDbConnection(input);
  if (connection.backend === 'local') return new NodeSqliteBackend(connection.path);
  const { TursoBackend } = await import('./tursoBackend');
  if (connection.url.startsWith('file:')) {
    // A local-file Turso url is a dev/test convenience, never real production
    // usage (see tursoBackend.ts's doc comment) — build it from the Node
    // build of @libsql/client, which still carries the native SQLite engine
    // that a `file:` url needs. This import never runs for a real user.
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: connection.url });
    return new TursoBackend({ client, executor: client });
  }
  return new TursoBackend({ url: connection.url, authToken: connection.authToken });
}
