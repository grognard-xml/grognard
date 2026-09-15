import type { EntityDbBackend, EntityDbConnection } from './backend';
import { NodeSqliteBackend } from './nodeSqliteBackend';
import { TursoBackend } from './tursoBackend';

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

export function openBackendForConnection(input: EntityDbConnectionInput): EntityDbBackend {
  const connection = normalizeEntityDbConnection(input);
  return connection.backend === 'local'
    ? new NodeSqliteBackend(connection.path)
    : new TursoBackend({ url: connection.url, authToken: connection.authToken });
}
