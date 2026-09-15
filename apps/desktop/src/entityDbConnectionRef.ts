/**
 * A renderer-safe reference to an entity database: either a real local
 * filesystem path (today's default, unchanged), or a sentinel string
 * identifying a shared Turso-backed project database by its (non-secret)
 * connection URL. Deliberately kept as a plain `string` rather than a
 * union/object type so every existing `databasePath: string` field, and
 * every renderer caller that already holds one, keeps working with zero
 * type changes — this file is the one place that knows the sentinel exists.
 *
 * The auth token is never part of this reference. It's resolved
 * main-process-side, from encrypted storage keyed by the url
 * (entityDbTursoTokenStore.ts) — the renderer never sees it.
 */
import type { EntityDbConnectionInput } from './entityDbSqlite/openBackend';
import { readTursoAuthToken } from './entityDbTursoTokenStore';

const TURSO_REF_PREFIX = 'grognard-turso:';

export type EntityDbConnectionRef = string;

export type ParsedConnectionRef =
  | { backend: 'local'; path: string }
  | { backend: 'turso'; url: string };

export function tursoConnectionRef(url: string): EntityDbConnectionRef {
  return `${TURSO_REF_PREFIX}${url}`;
}

export function parseConnectionRef(ref: EntityDbConnectionRef): ParsedConnectionRef {
  if (ref.startsWith(TURSO_REF_PREFIX)) {
    return { backend: 'turso', url: ref.slice(TURSO_REF_PREFIX.length) };
  }
  return { backend: 'local', path: ref };
}

/**
 * Fills in the auth token (from encrypted storage) for a Turso reference, or
 * passes a local path through unchanged. Throws if a Turso project's token
 * isn't configured on this machine yet — a collaborator opening a shared
 * project needs their own token stored first (see entityDbTursoTokenStore.ts).
 */
export async function resolveConnectionRef(
  ref: EntityDbConnectionRef,
): Promise<EntityDbConnectionInput> {
  const parsed = parseConnectionRef(ref);
  if (parsed.backend === 'local') return parsed.path;
  const authToken = await readTursoAuthToken(parsed.url);
  if (!authToken) {
    throw new Error(
      `No Turso auth token stored for ${parsed.url}. Configure it in Settings before opening this project.`,
    );
  }
  return { backend: 'turso', url: parsed.url, authToken };
}
