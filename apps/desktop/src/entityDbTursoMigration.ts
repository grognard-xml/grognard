/**
 * Orchestrates the one-time local-to-Turso data migration (see
 * `entityDbSqlite/migrateToTurso.ts` for the actual row-copy logic) for a
 * project that has just switched its `pedb` to Turso via Settings > Project.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { openBackendForConnection } from './entityDbSqlite/openBackend';
import { applyEntityDbMigrations } from './entityDbSqlite/schema';
import {
  migrateLocalEntitiesToTurso,
  MigrationTargetNotEmptyError,
} from './entityDbSqlite/migrateToTurso';
import { readTursoAuthToken } from './entityDbTursoTokenStore';
import { loadProjectFile } from './projectFile';

const ENTITY_DB_FILENAME = 'entities.sqlite';

export interface MigrateLocalToTursoResult {
  ok: boolean;
  tables?: number;
  rows?: number;
  error?: string;
}

/**
 * Copies `<project root>/entities.sqlite`'s rows into the Turso database the
 * project's own config file currently points at. The url is always re-read
 * from that file here — never trusted from the renderer directly, the same
 * rule `main.ts`'s `sessionTursoUrls` follows for the same reason.
 */
export const migrateProjectLocalEntitiesToTurso = async (
  projectFilePath: string,
): Promise<MigrateLocalToTursoResult> => {
  const bundle = await loadProjectFile(projectFilePath);
  if (!bundle) return { ok: false, error: 'Could not read this project file.' };

  const pedb = bundle.config.pedb;
  if (pedb?.backend !== 'turso') {
    return { ok: false, error: 'This project is not configured for a Turso database.' };
  }

  const localDbPath = path.join(bundle.rootPath, ENTITY_DB_FILENAME);
  try {
    await fs.access(localDbPath);
  } catch {
    return { ok: false, error: 'No local entity database was found for this project.' };
  }

  const authToken = await readTursoAuthToken(pedb.url);
  if (!authToken) {
    return {
      ok: false,
      error: 'No Turso auth token is stored for this project on this machine.',
    };
  }

  const source = openBackendForConnection({ backend: 'local', path: localDbPath });
  const target = openBackendForConnection({ backend: 'turso', url: pedb.url, authToken });
  try {
    // Both sides run the same idempotent migrations first, so the copy only
    // ever has to reckon with one, current schema shape — matches how every
    // other entry point (EntitySqliteRepository.open()) always migrates
    // before touching a database.
    await applyEntityDbMigrations(source);
    await applyEntityDbMigrations(target);
    const stats = await migrateLocalEntitiesToTurso(source, target);
    return { ok: true, tables: stats.tables, rows: stats.rows };
  } catch (error) {
    if (error instanceof MigrationTargetNotEmptyError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await source.close();
    await target.close();
  }
};
