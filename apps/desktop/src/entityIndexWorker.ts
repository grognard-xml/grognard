import fs from 'fs/promises';
import { type EntitySummary } from '../../../packages/cwrc-leafwriter/src/autoTagging/entityOps';
import type {
  EntityIndexJobEvent,
  EntityIndexJobRequest,
} from '../../commons/src/desktop/entityIndexTypes';
import { EntitySqliteRepository } from './entityDbSqlite/repository';

const summariesFromSqlite = async (
  repository: EntitySqliteRepository,
): Promise<EntitySummary[]> => {
  const ids = await repository.listEntityIds();
  const rawSummaries = await Promise.all(ids.map((id) => repository.getPanelSummary(id)));
  return rawSummaries
    .filter((summary): summary is NonNullable<typeof summary> => summary !== null)
    .map((summary) => {
      const activeNames = summary.names.filter((name) => name.status === 'active');
      const assertions = summary.assertions;
      const activeAssertions = assertions.filter((assertion) => assertion.status === 'active');
      return {
        id: summary.id,
        kind: summary.kind,
        names: activeNames.map((name) => name.text),
        nameEntries: activeNames.map((name) => ({
          text: name.text,
          lang: name.language,
          type: (name.nameType as EntitySummary['nameEntries'][number]['type']) ?? null,
        })),
        romanized: activeNames.find((name) => name.language?.endsWith('-Latn'))?.text ?? null,
        description: summary.description,
        subtype: summary.subtype,
        authorities: summary.authorities,
        familyName: summary.familyName,
        givenName: summary.givenName,
        startYear: summary.startYear,
        endYear: summary.endYear,
        workDate: summary.workDate,
        workType: summary.workType,
        nationalities: summary.nationalities,
        placesOfOrigin: summary.placesOfOrigin,
        authors: summary.authors,
        nobleTitles: summary.nobleTitles,
        roles: summary.roles,
        origins: summary.origins,
        rejectedCount: assertions.filter((assertion) => assertion.status === 'rejected').length,
        rejectedAssertions: assertions
          .filter((assertion) => assertion.status === 'rejected')
          .map((assertion) => ({
            element: assertion.element,
            value: assertion.value,
            source: assertion.source,
          })),
        rejectedConcordances: [],
        assertions: activeAssertions.concat(
          assertions.filter((assertion) => assertion.status === 'rejected'),
        ),
      };
    });
};

const cancelled = new Set<string>();
const send = (event: EntityIndexJobEvent): void => {
  process.send?.(event);
};

interface EntityIndexCache {
  version: 1;
  source: { size: number; mtimeMs: number };
  entities: EntitySummary[];
}

const sendBatches = async (
  jobId: string,
  entities: EntitySummary[],
  phase: 'cache' | 'indexing',
  cancelled: Set<string>,
  chunkSize: number,
): Promise<boolean> => {
  for (let offset = 0; offset < entities.length; offset += chunkSize) {
    if (cancelled.has(jobId)) {
      send({ jobId, status: 'cancelled', done: offset, total: entities.length });
      return false;
    }
    send({
      jobId,
      status: 'progress',
      phase,
      done: Math.min(offset + chunkSize, entities.length),
      total: entities.length,
      batch: entities.slice(offset, offset + chunkSize),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return true;
};

process.on(
  'message',
  async (message: { type: 'run' | 'cancel'; jobId: string; request?: EntityIndexJobRequest }) => {
    if (message.type === 'cancel') {
      cancelled.add(message.jobId);
      return;
    }
    if (!message.request) return;
    const { jobId, request } = message;
    try {
      send({ jobId, status: 'progress', phase: 'parsing', done: 0, total: 0 });
      const sqlitePath = request.entitiesPath.replace(/entities\.xml$/i, 'entities.sqlite');
      let sourceStat: { size: number; mtimeMs: number };
      let sqliteSummaries: EntitySummary[] | null = null;
      try {
        sourceStat = await fs.stat(sqlitePath);
        const repository = await EntitySqliteRepository.open(sqlitePath);
        sqliteSummaries = await summariesFromSqlite(repository);
        await repository.close();
      } catch (error) {
        throw new Error(
          `Entity indexing requires entities.sqlite beside ${request.entitiesPath}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const chunkSize = Math.max(50, request.chunkSize ?? 250);
      if (request.indexCachePath) {
        try {
          const cached = JSON.parse(
            await fs.readFile(request.indexCachePath, 'utf8'),
          ) as EntityIndexCache;
          if (
            cached.version === 1 &&
            cached.source.size === sourceStat.size &&
            cached.source.mtimeMs === sourceStat.mtimeMs &&
            Array.isArray(cached.entities)
          ) {
            const sent = await sendBatches(jobId, cached.entities, 'cache', cancelled, chunkSize);
            if (!sent) return;
            send({
              jobId,
              status: 'complete',
              done: cached.entities.length,
              total: cached.entities.length,
            });
            return;
          }
        } catch {
          // Cache misses and stale/corrupt caches fall through to a fresh index.
        }
      }
      if (sqliteSummaries) {
        const sent = await sendBatches(jobId, sqliteSummaries, 'indexing', cancelled, chunkSize);
        if (!sent) return;
        if (request.indexCachePath) {
          const temporaryPath = `${request.indexCachePath}.${jobId}.tmp`;
          await fs.writeFile(
            temporaryPath,
            JSON.stringify({
              version: 1,
              source: { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs },
              entities: sqliteSummaries,
            }),
            'utf8',
          );
          await fs.rename(temporaryPath, request.indexCachePath);
        }
        send({
          jobId,
          status: 'complete',
          done: sqliteSummaries.length,
          total: sqliteSummaries.length,
        });
        return;
      }
    } catch (error) {
      send({
        jobId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelled.delete(jobId);
    }
  },
);
