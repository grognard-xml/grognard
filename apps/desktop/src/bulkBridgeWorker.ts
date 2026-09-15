import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  BulkBridgeJobEvent,
  BulkBridgeJobRequest,
} from '../../commons/src/desktop/bulkBridgeTypes';
import { bulkBridgeImportSqlite } from './bulkBridgeImportSqlite';
import { EntitySqliteRepository } from './entityDbSqlite/repository';

const cancelled = new Set<string>();

const send = (event: BulkBridgeJobEvent): void => {
  process.send?.(event);
};

/**
 * Mirrors `EntityStore.saveEntities`'s arm/ignore pair (see
 * `desktopEntityFileApi`), which this worker can't call directly — a forked
 * child process has no `window.electronAPI`. Without this, every checkpoint
 * and final write here looks like an external edit to the main process's
 * file watcher and pops the "entity database changed externally" prompt,
 * even though it's this same sync writing the file.
 */
const atomicWrite = async (filePath: string, content: string, jobId: string): Promise<void> => {
  process.send?.({ kind: 'arm-write', filePath });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${jobId}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);
  const { mtimeMs } = await fs.stat(filePath);
  process.send?.({ kind: 'ignore-write', filePath, mtimeMs });
};

const sqlitePathFor = (entitiesPath: string): string =>
  entitiesPath.replace(/entities\.xml$/i, 'entities.sqlite');

const requireSqlitePath = async (entitiesPath: string, label: string): Promise<string> => {
  const sqlitePath = sqlitePathFor(entitiesPath);
  try {
    await fs.access(sqlitePath);
  } catch {
    throw new Error(
      `${label} SQLite entity database is missing (expected ${sqlitePath}). Catch-up sync requires migrated entities.sqlite files.`,
    );
  }
  return sqlitePath;
};

/** Tell the main-process file watcher to ignore our in-place SQLite mutations. */
const ignoreSqliteWrite = async (sqlitePath: string): Promise<void> => {
  const { mtimeMs } = await fs.stat(sqlitePath);
  process.send?.({ kind: 'ignore-write', filePath: sqlitePath, mtimeMs });
};

process.on(
  'message',
  async (message: { type: 'run' | 'cancel'; jobId: string; request?: BulkBridgeJobRequest }) => {
    if (message.type === 'cancel') {
      cancelled.add(message.jobId);
      return;
    }
    const request = message.request;
    if (!request) return;
    const jobId = message.jobId;
    let sourceRepo: EntitySqliteRepository | null = null;
    let centralRepo: EntitySqliteRepository | null = null;
    try {
      const sourceSqlitePath = await requireSqlitePath(request.sourceEntitiesPath, 'Project');
      const centralSqlitePath = await requireSqlitePath(request.centralEntitiesPath, 'Central');
      sourceRepo = await EntitySqliteRepository.open(sourceSqlitePath);
      centralRepo = await EntitySqliteRepository.open(centralSqlitePath);

      const result = await bulkBridgeImportSqlite({
        source: sourceRepo,
        central: centralRepo,
        userStableId: request.userStableId,
        chunkSize: request.chunkSize,
        shouldCancel: () => cancelled.has(jobId),
        onProgress: (progress) => send({ jobId, status: 'progress', progress }),
        onCheckpoint: async () => {
          await ignoreSqliteWrite(sourceSqlitePath);
          await ignoreSqliteWrite(centralSqlitePath);
        },
      });

      const proposalPath = path.join(request.centralGrognardDir, 'bulk-import-proposals.jsonl');
      const proposalText = result.proposals.map((proposal) => JSON.stringify(proposal)).join('\n');
      await atomicWrite(proposalPath, proposalText ? `${proposalText}\n` : '', jobId);

      await sourceRepo.close();
      sourceRepo = null;
      await centralRepo.close();
      centralRepo = null;

      if (!cancelled.has(jobId)) {
        await ignoreSqliteWrite(sourceSqlitePath);
        await ignoreSqliteWrite(centralSqlitePath);
      }

      send({ jobId, status: cancelled.has(jobId) ? 'cancelled' : 'complete', result });
    } catch (error) {
      send({
        jobId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        await sourceRepo?.close();
      } catch {
        // already closed
      }
      try {
        await centralRepo?.close();
      } catch {
        // already closed
      }
      cancelled.delete(jobId);
    }
  },
);
