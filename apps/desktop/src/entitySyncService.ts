/**
 * Main-process glue for cross-device entity sync — Phase 2b of
 * docs/entity-sync-planning.md.
 *
 * Ties the Phase 2 engine (`runSync`) to the app: resolves the live
 * `entities.sqlite`, builds an `EntitySyncClient` from the stored config and
 * the cached GitHub token, runs it single-flight, keeps a last-run marker, and
 * drives the auto-sync timer.
 */
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { repositoryFor } from './entityDbSqlite/readService';
import {
  countOpenConflicts,
  getSyncCursor,
  listOpenConflicts,
  type SyncConflict,
} from './entityDbSqlite/entitySyncRepo';
import {
  runSync,
  resolveConflictKeepLocal,
  resolveConflictKeepRemote,
  type SyncProgress,
} from './entitySync';
import { EntitySyncAuthError, EntitySyncClient } from './entitySyncClient';
import { runAchievementsSync } from './achievementsSync';
import {
  isSyncConfigured,
  readSyncConfig,
  writeSyncConfig,
  type EntitySyncConfig,
  type EntitySyncConfigPatch as StoredConfigPatch,
} from './entitySyncConfig';
import { writeSyncBearerToken } from './entitySyncAuthSecret';
import { isSignedInForSync, resolveTokenProvider } from './entitySyncTokenProvider';
import { resolveLiveEntityDbPath, hasLocalEntityDatabase } from './ensureDefaultEntityDatabase';

/** Config patch plus a transient bearer token, peeled off and stored encrypted. */
export type EntitySyncConfigPatch = StoredConfigPatch & { bearerToken?: string };

const MARKER_FILENAME = 'entity-sync-last-run.json';
/** Hard ceiling on one sync run — generous for a first full push, but bounded. */
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

const logProgress = (p: SyncProgress): void => {
  if (p.phase === 'pull') {
    console.log(
      `[entitySync] pull page ${p.page}: applied ${p.applied}, conflicts ${p.conflicts}` +
        (p.more ? ' (more…)' : ''),
    );
  } else {
    console.log(
      `[entitySync] push chunk ${p.chunk}/${p.chunks}: applied ${p.applied}, conflicts ${p.conflicts}`,
    );
  }
};

export type SyncReason = 'manual' | 'timer' | 'launch';

export interface SyncRunSummary {
  ok: boolean;
  reason: SyncReason;
  skipped?: 'disabled' | 'in-progress' | 'no-database' | 'not-signed-in' | 'write-quota';
  /** Set when the push stopped on the server's write quota (partial progress above). */
  stoppedEarly?: 'write-quota';
  error?: string;
  pulledApplied?: number;
  pulledConflicts?: number;
  pushedApplied?: number;
  pushedReconciled?: number;
  pushedConflicts?: number;
  openConflicts?: number;
  cursor?: number;
  achievementsPulled?: boolean;
  achievementsPushed?: boolean;
  achievementsRevision?: number;
  durationMs?: number;
  at?: string;
}

export interface EntitySyncStatus {
  config: EntitySyncConfig;
  signedIn: boolean;
  hasLocalDatabase: boolean;
  cursor: number | null;
  openConflicts: number | null;
  lastRun: SyncRunSummary | null;
}

const getMarkerPath = () => path.join(app.getPath('userData'), MARKER_FILENAME);

const getEntityDbPath = async (): Promise<string | null> => resolveLiveEntityDbPath();

const writeMarker = async (summary: SyncRunSummary): Promise<void> => {
  const markerPath = getMarkerPath();
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(`${markerPath}.tmp`, JSON.stringify(summary, null, 2));
  await fs.rename(`${markerPath}.tmp`, markerPath);
};

export const getLastSyncRun = async (): Promise<SyncRunSummary | null> => {
  try {
    return JSON.parse(await fs.readFile(getMarkerPath(), 'utf-8')) as SyncRunSummary;
  } catch {
    return null;
  }
};

// --- run ----------------------------------------------------------------

/** Single-flight guard: timestamp of the current run, or null when idle. */
let runStartedAt: number | null = null;
/** After a server write-quota stop, skip automatic runs until this time. */
let quotaCooldownUntil = 0;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

export const runEntitySync = async (reason: SyncReason): Promise<SyncRunSummary> => {
  // Normally single-flight; but if a run has outlived its watchdog (process
  // was suspended, an await never settled) let a fresh one through rather than
  // locking sync out forever.
  if (runStartedAt !== null && Date.now() - runStartedAt < RUN_TIMEOUT_MS + 60_000) {
    return { ok: false, reason, skipped: 'in-progress' };
  }
  // Don't hammer a server that's told us it's out of write quota; a manual
  // "Sync now" still tries (the cap may have reset, or a pull-only run helps).
  if (reason !== 'manual' && Date.now() < quotaCooldownUntil) {
    return { ok: false, reason, skipped: 'write-quota' };
  }

  const config = await readSyncConfig();
  if (!isSyncConfigured(config)) return { ok: false, reason, skipped: 'disabled' };
  if (!(await isSignedInForSync(config))) {
    return { ok: false, reason, skipped: 'not-signed-in' };
  }
  const dbPath = await getEntityDbPath();
  if (!dbPath) return { ok: false, reason, skipped: 'no-database' };

  const startedAt = Date.now();
  runStartedAt = startedAt;
  const abort = new AbortController();
  const watchdog = setTimeout(() => abort.abort(), RUN_TIMEOUT_MS);
  try {
    const repo = await repositoryFor(dbPath);
    const client = new EntitySyncClient({
      endpoint: config.endpoint,
      getToken: resolveTokenProvider(config),
    });
    console.log(`[entitySync] run (${reason}) started`);
    const result = await runSync({ repo, client, signal: abort.signal, onProgress: logProgress });
    let achievements = { pulled: false, pushed: false, revision: 0 };
    try {
      achievements = await runAchievementsSync(client);
      console.log(
        `[entitySync] achievements sync: pulled=${achievements.pulled} pushed=${achievements.pushed} revision=${achievements.revision}`,
      );
    } catch (achievementsError) {
      console.error(
        '[entitySync] achievements sync failed:',
        achievementsError instanceof Error ? achievementsError.message : achievementsError,
      );
    }
    if (result.stoppedEarly === 'write-quota') {
      quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    }
    const summary: SyncRunSummary = {
      ok: result.stoppedEarly ? false : true,
      reason,
      skipped: result.stoppedEarly === 'write-quota' ? 'write-quota' : undefined,
      stoppedEarly: result.stoppedEarly,
      pulledApplied: result.pulledApplied,
      pulledConflicts: result.pulledConflicts,
      pushedApplied: result.pushedApplied,
      pushedReconciled: result.pushedReconciled,
      pushedConflicts: result.pushedConflicts,
      openConflicts: result.openConflicts,
      cursor: result.cursor,
      achievementsPulled: achievements.pulled,
      achievementsPushed: achievements.pushed,
      achievementsRevision: achievements.revision,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    };
    await writeMarker(summary);
    console.log(
      `[entitySync] run (${reason}) ${result.stoppedEarly ? 'stopped (write quota)' : 'done'} in ${summary.durationMs}ms: ` +
        `pulled ${summary.pulledApplied}/${summary.pulledConflicts}, ` +
        `pushed ${summary.pushedApplied}/${summary.pushedReconciled}/${summary.pushedConflicts}, ` +
        `cursor ${summary.cursor}, open conflicts ${summary.openConflicts}`,
    );
    return summary;
  } catch (error) {
    const timedOut = abort.signal.aborted;
    const message = timedOut
      ? `sync run exceeded ${RUN_TIMEOUT_MS / 60000} min and was aborted`
      : error instanceof EntitySyncAuthError
        ? `sign-in rejected by the sync server: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error('[entitySync] run failed:', message);
    const summary: SyncRunSummary = {
      ok: false,
      reason,
      error: message,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    };
    await writeMarker(summary);
    return summary;
  } finally {
    clearTimeout(watchdog);
    // Only clear if we're still the current run (a forced-through later run
    // may have taken over after we outlived the watchdog).
    if (runStartedAt === startedAt) runStartedAt = null;
  }
};

// --- status + conflicts ----------------------------------------------

export const getEntitySyncStatus = async (): Promise<EntitySyncStatus> => {
  const config = await readSyncConfig();
  const [signedIn, hasLocalDatabase, dbPath, lastRun] = await Promise.all([
    isSignedInForSync(config),
    hasLocalEntityDatabase(),
    getEntityDbPath(),
    getLastSyncRun(),
  ]);
  let cursor: number | null = null;
  let openConflicts: number | null = null;
  if (dbPath) {
    try {
      const repo = await repositoryFor(dbPath);
      cursor = await getSyncCursor(repo);
      openConflicts = await countOpenConflicts(repo);
    } catch {
      // status is best-effort
    }
  }
  return { config, signedIn, hasLocalDatabase, cursor, openConflicts, lastRun };
};

export const setEntitySyncConfig = async (
  patch: EntitySyncConfigPatch,
): Promise<EntitySyncConfig> => {
  const { bearerToken, ...configPatch } = patch;
  if (bearerToken !== undefined) await writeSyncBearerToken(bearerToken || null);
  const config = await writeSyncConfig(configPatch);
  await restartSyncTimer();
  return config;
};

export const listEntitySyncConflicts = async (): Promise<SyncConflict[]> => {
  const dbPath = await getEntityDbPath();
  if (!dbPath) return [];
  return listOpenConflicts(await repositoryFor(dbPath));
};

export const resolveEntitySyncConflict = async (
  id: number,
  keep: 'local' | 'remote',
): Promise<{ ok: boolean }> => {
  const dbPath = await getEntityDbPath();
  if (!dbPath) return { ok: false };
  const repo = await repositoryFor(dbPath);
  const ok =
    keep === 'local'
      ? await resolveConflictKeepLocal(repo, id)
      : await resolveConflictKeepRemote(repo, id);
  return { ok };
};

// --- auto-sync timer -----------------------------------------------

let timer: NodeJS.Timeout | null = null;

export const startSyncTimer = async (): Promise<void> => {
  stopSyncTimer();
  const config = await readSyncConfig();
  if (!isSyncConfigured(config)) return;
  timer = setInterval(
    () => {
      void runEntitySync('timer');
    },
    config.intervalMinutes * 60 * 1000,
  );
  timer.unref?.();
};

export const restartSyncTimer = startSyncTimer;

export const stopSyncTimer = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

/** One run shortly after launch, then hand off to the timer. */
export const scheduleLaunchSync = (delayMs = 8_000): void => {
  setTimeout(() => {
    void runEntitySync('launch');
  }, delayMs).unref?.();
};
