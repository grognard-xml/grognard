/**
 * Entity-database cloud backup — Phase 0 of docs/entity-sync-planning.
 *
 * The live `entities.sqlite` must never sit in a file-sync folder (that
 * corrupts it). This module gives it an off-machine safety net instead: on a
 * timer while the app runs, and once more on quit, it takes a consistent
 * `VACUUM INTO` snapshot, gzips it, and uploads it to Cloudflare R2 together
 * with a paired `achievements.json` sidecar when that file exists locally.
 * Old snapshots are pruned on a keep-recent + keep-daily schedule. Restore
 * pulls the newest (or a chosen) snapshot back down, verifies its integrity,
 * and swaps it in (entities + achievements when the sidecar is present).
 *
 * This is a stop-gap until logical entity sync lands (Phase 2+); it is not a
 * merge mechanism and only ever moves whole-database snapshots.
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';

// esbuild rewrites a static `import ... from 'node:sqlite'` to `require("sqlite")`
// (an uninstalled package) in the packaged bundle, so load it through
// createRequire at runtime — same workaround as entityDbSqlite/repository.ts.
const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};
import {
  isBackupConfigComplete,
  readBackupConfig,
  toR2Config,
  type EntityDbBackupConfig,
} from './entityDbBackupConfig';
import {
  readAchievementsFileRaw,
  resolveAchievementsPrimaryPath,
  writeAchievementsEnvelopeRaw,
} from './achievementsFile';
import { getEntityDbFolder } from './projectPrefs';
import { resolveLiveEntityDbPath } from './ensureDefaultEntityDatabase';
import { R2Client, type R2Object } from './r2Client';
import { createLogicalSnapshot } from './entityDbSqlite/logicalSnapshot';
import { readTursoAuthToken } from './entityDbTursoTokenStore';

const ENTITY_DB_FILENAME = 'entities.sqlite';
const MARKER_FILENAME = 'entity-db-last-backup.json';
const SNAPSHOTS_SEGMENT = 'snapshots/';
const LOGICAL_SNAPSHOTS_SEGMENT = 'snapshots-logical/';

/** A Turso-backed project's pedb, as tracked by `setActiveProjectPedb`. */
interface ActiveTursoPedb {
  backend: 'turso';
  url: string;
}

let activePedb: ActiveTursoPedb | null = null;

/**
 * Tell this module which project is currently open, so `runBackup` (on its
 * timer, on quit, or manual) knows whether to snapshot the local
 * `entities.sqlite` via `VACUUM INTO` (unset, or `{ backend: 'local' }`) or
 * to take a logical export of a remote Turso database instead. Called from
 * `main.ts`'s `activateProjectBundle` — never inferred from renderer input.
 */
export const setActiveProjectPedb = (
  pedb: { backend: 'local' } | { backend: 'turso'; url: string } | null | undefined,
): void => {
  activePedb = pedb?.backend === 'turso' ? { backend: 'turso', url: pedb.url } : null;
};

export type BackupReason = 'timer' | 'quit' | 'manual';

export interface BackupResult {
  ok: boolean;
  reason: BackupReason;
  key?: string;
  uploadedBytes?: number;
  sourceBytes?: number;
  sha256?: string;
  durationMs?: number;
  prunedKeys?: string[];
  skipped?: 'not-configured' | 'disabled' | 'in-progress' | 'no-database';
  error?: string;
}

export interface LastBackupMarker {
  at: string;
  reason: BackupReason;
  key: string;
  uploadedBytes: number;
  sourceBytes: number;
  sha256: string;
  /** Paired achievements sidecar, when the local file existed at backup time. */
  achievementsKey?: string;
}

export interface CloudSnapshot {
  key: string;
  size: number;
  lastModified: string;
  reason: string;
  timestamp: string;
  /**
   * `sqlite` — a local-file `VACUUM INTO` snapshot, restorable in-place via
   * `restoreSnapshot`. `sql` — a Turso logical export; `restoreSnapshot`
   * refuses these (see its doc comment) and the user replays them manually.
   */
  kind: 'sqlite' | 'sql';
}

// --- snapshot ---------------------------------------------------------------

const getMarkerPath = () => path.join(app.getPath('userData'), MARKER_FILENAME);
const getEntityDbPath = async (): Promise<string | null> => resolveLiveEntityDbPath();

/** `20260901T203015Z` — filesystem- and object-key-safe, still sortable. */
const compactTimestamp = (date: Date): string => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

/** SQLite string literal: wrap in single quotes, double any interior quote. */
const sqlStringLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
};

interface Snapshot {
  gzPath: string;
  uploadedBytes: number;
  sourceBytes: number;
  sha256: string;
}

/**
 * Produce a gzipped, integrity-checked copy of the entity database in the OS
 * temp dir. `VACUUM INTO` reads a consistent view over a read-only connection,
 * so it is safe to run while the app holds its own handle to the same file.
 */
export const createSnapshot = async (sourceDbPath: string): Promise<Snapshot> => {
  await fs.access(sourceDbPath);
  const stem = `grognard-entities-${compactTimestamp(new Date())}-${process.pid}`;
  const rawPath = path.join(app.getPath('temp'), `${stem}.sqlite`);
  const gzPath = path.join(app.getPath('temp'), `${stem}.sqlite.gz`);

  const source = new DatabaseSync(sourceDbPath, { readOnly: true });
  try {
    await fs.rm(rawPath, { force: true });
    source.exec(`VACUUM INTO ${sqlStringLiteral(rawPath)}`);
  } finally {
    source.close();
  }

  try {
    const verify = new DatabaseSync(rawPath, { readOnly: true });
    try {
      const rows = verify.prepare('PRAGMA integrity_check').all() as {
        integrity_check: string;
      }[];
      const problems = rows.map((r) => r.integrity_check).filter((line) => line !== 'ok');
      if (problems.length > 0) {
        throw new Error(`snapshot failed integrity_check: ${problems.slice(0, 3).join('; ')}`);
      }
    } finally {
      verify.close();
    }

    const sourceBytes = (await fs.stat(rawPath)).size;
    await pipeline(createReadStream(rawPath), createGzip({ level: 6 }), createWriteStream(gzPath));
    const uploadedBytes = (await fs.stat(gzPath)).size;
    const sha256 = await sha256File(gzPath);
    return { gzPath, uploadedBytes, sourceBytes, sha256 };
  } finally {
    await fs.rm(rawPath, { force: true });
  }
};

// --- retention ------------------------------------------------------------

const KEEP_RECENT = 24;
const KEEP_DAILY_DAYS = 14;

interface ParsedKey {
  key: string;
  date: Date;
}

/**
 * Matches both the local `VACUUM INTO` snapshot suffix (`.sqlite.gz`) and the
 * Turso-backed logical-export suffix (`.sql.gz`) — the two are otherwise
 * identical key shapes, and pruning/parsing treats them the same way.
 */
const SNAPSHOT_SUFFIX = /\.(sqlite|sql)\.gz$/;

/** Sidecar object key paired with an entity-database snapshot key. */
export const companionAchievementsKey = (entitiesKey: string): string | null => {
  if (!new RegExp(`entities-\\d{8}T\\d{6}Z-[a-z]+${SNAPSHOT_SUFFIX.source}`).test(entitiesKey)) {
    return null;
  }
  return entitiesKey.replace(/entities-/, 'achievements-').replace(SNAPSHOT_SUFFIX, '.json.gz');
};

const parseSnapshotKey = (key: string): ParsedKey | null => {
  // <prefix>snapshots/entities-20260901T203015Z-<reason>.sqlite.gz
  // <prefix>snapshots-logical/entities-20260901T203015Z-<reason>.sql.gz
  const match = key.match(new RegExp(`entities-(\\d{8}T\\d{6}Z)-[a-z]+${SNAPSHOT_SUFFIX.source}`));
  if (!match) return null;
  const [, ts] = match;
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(
    11,
    13,
  )}:${ts.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : { key, date };
};

/**
 * Given every snapshot key, return the ones to delete: keep the newest
 * {@link KEEP_RECENT}, then keep the newest one per UTC day for
 * {@link KEEP_DAILY_DAYS} days, drop the rest (and anything older).
 */
export const selectSnapshotsToPrune = (keys: string[], now: Date = new Date()): string[] => {
  const parsed = keys
    .map(parseSnapshotKey)
    .filter((entry): entry is ParsedKey => entry !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const keep = new Set<string>();
  parsed.slice(0, KEEP_RECENT).forEach((entry) => keep.add(entry.key));

  const dailyCutoff = now.getTime() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const seenDays = new Set<string>();
  for (const entry of parsed) {
    if (entry.date.getTime() < dailyCutoff) continue;
    const day = entry.date.toISOString().slice(0, 10);
    if (!seenDays.has(day)) {
      seenDays.add(day);
      keep.add(entry.key);
    }
  }

  return parsed.filter((entry) => !keep.has(entry.key)).map((entry) => entry.key);
};

// --- orchestration -------------------------------------------------------

let runInProgress = false;
let timer: NodeJS.Timeout | null = null;

const writeMarker = async (marker: LastBackupMarker): Promise<void> => {
  const markerPath = getMarkerPath();
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(`${markerPath}.tmp`, JSON.stringify(marker, null, 2));
  await fs.rename(`${markerPath}.tmp`, markerPath);
};

export const getLastBackupMarker = async (): Promise<LastBackupMarker | null> => {
  try {
    return JSON.parse(await fs.readFile(getMarkerPath(), 'utf-8')) as LastBackupMarker;
  } catch {
    return null;
  }
};

/** Uploads the achievements sidecar paired with `entityKey`, if one exists locally. */
const uploadAchievementsSidecar = async (
  client: R2Client,
  entityKey: string,
  reason: BackupReason,
): Promise<string | undefined> => {
  const achievementsRaw = await readAchievementsFileRaw();
  const pairedAchievementsKey = companionAchievementsKey(entityKey);
  if (!achievementsRaw || !pairedAchievementsKey) return undefined;
  const achievementsGz = gzipSync(Buffer.from(achievementsRaw, 'utf8'), { level: 6 });
  const achievementsSha = createHash('sha256').update(achievementsGz).digest('hex');
  await client.putObject(pairedAchievementsKey, achievementsGz, {
    contentType: 'application/gzip',
    metadata: {
      sha256: achievementsSha,
      'source-bytes': String(Buffer.byteLength(achievementsRaw, 'utf8')),
      'app-version': app.getVersion(),
      reason,
    },
  });
  return pairedAchievementsKey;
};

/** Deletes every stale snapshot (and its achievements sidecar) under `segmentPrefix`. */
const pruneSnapshotSegment = async (client: R2Client, segmentPrefix: string): Promise<string[]> => {
  try {
    const existing = await client.listObjects(segmentPrefix);
    const prunedKeys = selectSnapshotsToPrune(existing.map((o) => o.key));
    for (const staleKey of prunedKeys) {
      await client.deleteObject(staleKey);
      const staleAchievementsKey = companionAchievementsKey(staleKey);
      if (staleAchievementsKey) {
        await client.deleteObject(staleAchievementsKey).catch(() => undefined);
      }
    }
    return prunedKeys;
  } catch (pruneError) {
    // A failed prune must not fail the backup — the snapshot is already up.
    console.error('[entityDbBackup] prune failed:', pruneError);
    return [];
  }
};

/**
 * Logical-export backup path for a Turso-backed project (see
 * `entityDbSqlite/logicalSnapshot.ts`) — `VACUUM INTO` needs a local file
 * handle a hosted database doesn't have, so this walks the tables over the
 * network instead and uploads a plain SQL script rather than a `.sqlite`
 * copy. Shares upload/retention/marker plumbing with the local-file path;
 * only snapshot *creation* differs.
 */
const runTursoBackup = async (
  reason: BackupReason,
  config: EntityDbBackupConfig,
  pedb: ActiveTursoPedb,
): Promise<BackupResult> => {
  runInProgress = true;
  const startedAt = Date.now();
  try {
    const authToken = await readTursoAuthToken(pedb.url);
    if (!authToken) {
      return {
        ok: false,
        reason,
        error: 'No Turso auth token is stored for this project on this machine.',
        durationMs: Date.now() - startedAt,
      };
    }

    const { TursoBackend } = await import('./entityDbSqlite/tursoBackend');
    const backend = new TursoBackend({ url: pedb.url, authToken });
    let sql: string;
    try {
      ({ sql } = await createLogicalSnapshot(backend));
    } finally {
      await backend.close();
    }

    const gz = gzipSync(Buffer.from(sql, 'utf8'), { level: 6 });
    const sha256 = createHash('sha256').update(gz).digest('hex');
    const sourceBytes = Buffer.byteLength(sql, 'utf8');
    const client = new R2Client(toR2Config(config));
    const timestamp = compactTimestamp(new Date());
    const key = `${config.prefix}${LOGICAL_SNAPSHOTS_SEGMENT}entities-${timestamp}-${reason}.sql.gz`;

    await client.putObject(key, gz, {
      contentType: 'application/gzip',
      metadata: {
        sha256,
        'source-bytes': String(sourceBytes),
        'app-version': app.getVersion(),
        reason,
      },
    });

    const achievementsKey = await uploadAchievementsSidecar(client, key, reason);
    const prunedKeys = await pruneSnapshotSegment(
      client,
      `${config.prefix}${LOGICAL_SNAPSHOTS_SEGMENT}`,
    );

    const marker: LastBackupMarker = {
      at: new Date().toISOString(),
      reason,
      key,
      uploadedBytes: gz.length,
      sourceBytes,
      sha256,
      ...(achievementsKey ? { achievementsKey } : {}),
    };
    await writeMarker(marker);

    return {
      ok: true,
      reason,
      key,
      uploadedBytes: gz.length,
      sourceBytes,
      sha256,
      durationMs: Date.now() - startedAt,
      prunedKeys,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[entityDbBackup] logical backup failed:', message);
    return { ok: false, reason, error: message, durationMs: Date.now() - startedAt };
  } finally {
    runInProgress = false;
  }
};

/**
 * Run one backup cycle. `manual` runs even when `enabled` is false (the user
 * pressed the button); `timer`/`quit` respect the toggle. Branches on the
 * active project's `pedb.backend`: unset/local uses today's `VACUUM INTO`
 * snapshot of `entities.sqlite`; turso uses the logical-export path above.
 */
export const runBackup = async (reason: BackupReason): Promise<BackupResult> => {
  if (runInProgress) return { ok: false, reason, skipped: 'in-progress' };

  const config = await readBackupConfig().catch(() => null);
  if (!isBackupConfigComplete(config)) return { ok: false, reason, skipped: 'not-configured' };
  if (!config.enabled && reason !== 'manual') return { ok: false, reason, skipped: 'disabled' };

  if (activePedb) return runTursoBackup(reason, config, activePedb);

  const dbPath = await getEntityDbPath();
  if (!dbPath) return { ok: false, reason, skipped: 'no-database' };
  try {
    await fs.access(dbPath);
  } catch {
    return { ok: false, reason, skipped: 'no-database' };
  }

  runInProgress = true;
  const startedAt = Date.now();
  let snapshot: Snapshot | null = null;
  try {
    snapshot = await createSnapshot(dbPath);
    const client = new R2Client(toR2Config(config));
    const timestamp = compactTimestamp(new Date());
    const key = `${config.prefix}${SNAPSHOTS_SEGMENT}entities-${timestamp}-${reason}.sqlite.gz`;

    await client.putObject(key, await fs.readFile(snapshot.gzPath), {
      contentType: 'application/gzip',
      metadata: {
        sha256: snapshot.sha256,
        'source-bytes': String(snapshot.sourceBytes),
        'app-version': app.getVersion(),
        reason,
      },
    });

    const achievementsKey = await uploadAchievementsSidecar(client, key, reason);
    const prunedKeys = await pruneSnapshotSegment(client, `${config.prefix}${SNAPSHOTS_SEGMENT}`);

    const marker: LastBackupMarker = {
      at: new Date().toISOString(),
      reason,
      key,
      uploadedBytes: snapshot.uploadedBytes,
      sourceBytes: snapshot.sourceBytes,
      sha256: snapshot.sha256,
      ...(achievementsKey ? { achievementsKey } : {}),
    };
    await writeMarker(marker);

    return {
      ok: true,
      reason,
      key,
      uploadedBytes: snapshot.uploadedBytes,
      sourceBytes: snapshot.sourceBytes,
      sha256: snapshot.sha256,
      durationMs: Date.now() - startedAt,
      prunedKeys,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[entityDbBackup] backup failed:', message);
    return { ok: false, reason, error: message, durationMs: Date.now() - startedAt };
  } finally {
    if (snapshot) await fs.rm(snapshot.gzPath, { force: true }).catch(() => undefined);
    runInProgress = false;
  }
};

// --- timer -------------------------------------------------------------

/** (Re)start the periodic timer from current config. Safe to call repeatedly. */
export const startBackupTimer = async (): Promise<void> => {
  stopBackupTimer();
  const config = await readBackupConfig().catch(() => null);
  if (!isBackupConfigComplete(config) || !config.enabled) return;
  const everyMs = config.intervalMinutes * 60 * 1000;
  timer = setInterval(() => {
    void runBackup('timer');
  }, everyMs);
  timer.unref?.();
};

export const stopBackupTimer = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

/** Best-effort snapshot on quit, bounded so it can't hang shutdown. */
export const runQuitBackup = async (timeoutMs = 12_000): Promise<BackupResult> => {
  const config = await readBackupConfig().catch(() => null);
  if (!isBackupConfigComplete(config) || !config.enabled) {
    return { ok: false, reason: 'quit', skipped: 'disabled' };
  }
  return Promise.race([
    runBackup('quit'),
    new Promise<BackupResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, reason: 'quit', error: 'timed out' }), timeoutMs),
    ),
  ]);
};

// --- restore ---------------------------------------------------------

const describeSnapshot = (object: R2Object): CloudSnapshot => {
  const parsed = parseSnapshotKey(object.key);
  const reason = object.key.match(new RegExp(`-(\\w+)${SNAPSHOT_SUFFIX.source}`))?.[1] ?? 'unknown';
  return {
    key: object.key,
    size: object.size,
    lastModified: object.lastModified.toISOString(),
    reason,
    timestamp: parsed ? parsed.date.toISOString() : object.lastModified.toISOString(),
    kind: object.key.endsWith('.sql.gz') ? 'sql' : 'sqlite',
  };
};

/**
 * Lightweight round-trip against the configured bucket/prefix — a signed LIST.
 * Used by the settings panel's "Test connection" button. `config` may carry a
 * not-yet-saved secret from the form.
 */
export const probeBackupTarget = async (
  config: EntityDbBackupConfig,
): Promise<{ ok: boolean; error?: string; objectCount?: number }> => {
  if (!isBackupConfigComplete(config)) {
    return { ok: false, error: 'Endpoint, access key, secret, and bucket are all required.' };
  }
  try {
    const client = new R2Client(toR2Config(config));
    const objects = await client.listObjects(`${config.prefix}${SNAPSHOTS_SEGMENT}`);
    return { ok: true, objectCount: objects.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * Lists every snapshot for the current bucket/prefix, local `.sqlite.gz`
 * (VACUUM INTO) and Turso `.sql.gz` (logical export) alike — whichever
 * segment(s) a given project has actually written to, newest first.
 */
export const listCloudSnapshots = async (): Promise<CloudSnapshot[]> => {
  const config = await readBackupConfig();
  if (!isBackupConfigComplete(config)) {
    throw new Error('Cloud backup is not configured.');
  }
  const client = new R2Client(toR2Config(config));
  const [local, logical] = await Promise.all([
    client.listObjects(`${config.prefix}${SNAPSHOTS_SEGMENT}`),
    client.listObjects(`${config.prefix}${LOGICAL_SNAPSHOTS_SEGMENT}`),
  ]);
  return [...local, ...logical]
    .map(describeSnapshot)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

export interface RestoreResult {
  ok: boolean;
  restoredFromKey: string;
  restoredBytes: number;
  /** Where the pre-restore database (and sidecars) were moved. */
  previousCopyDir: string;
  /** True when a paired achievements sidecar was restored from R2. */
  achievementsRestored: boolean;
  error?: string;
}

/**
 * Download a snapshot, verify it, and swap it in as the live entity database.
 *
 * The caller MUST have closed every SQLite handle to the entity database
 * first and MUST relaunch (or reopen the store) afterwards — this function
 * moves files, it does not coordinate open connections.
 *
 * Local-file (`.sqlite.gz`) snapshots only. A Turso logical export
 * (`.sql.gz`) is plain SQL text, not a SQLite file — running it through this
 * function's `gunzipSync` + `DatabaseSync` + file-swap logic would silently
 * produce a corrupt "database". Per plan, v1 restore for Turso-backed
 * projects is a manual, guided flow instead: download the object (e.g. via
 * `listCloudSnapshots` + the R2 console, or a small script), gunzip it, and
 * replay the INSERT statements against a database that already has the
 * schema (opening any Turso-backed project mints it via migrations) —
 * for example `turso db shell <database> < snapshot.sql`.
 */
export const restoreSnapshot = async (key: string): Promise<RestoreResult> => {
  if (key.endsWith('.sql.gz')) {
    throw new Error(
      'This is a Turso logical-export snapshot, not a local database file — it must be replayed ' +
        'manually against the target Turso database rather than restored in place. See the doc ' +
        'comment on restoreSnapshot() in entityDbBackup.ts for the replay steps.',
    );
  }
  const config = await readBackupConfig();
  if (!isBackupConfigComplete(config)) throw new Error('Cloud backup is not configured.');
  const folder = await getEntityDbFolder();
  if (!folder) throw new Error('No entity database folder is configured.');

  const client = new R2Client(toR2Config(config));
  const gz = await client.getObject(key);
  const expectedSha = (await client.headObjectMetadata(key).catch(() => null))?.sha256;
  if (expectedSha) {
    const actual = createHash('sha256').update(gz).digest('hex');
    if (actual !== expectedSha) {
      throw new Error(`downloaded snapshot is corrupt (sha256 ${actual} ≠ ${expectedSha})`);
    }
  }

  const stagedPath = path.join(folder, `entities.restore-${compactTimestamp(new Date())}.sqlite`);
  await fs.writeFile(stagedPath, gunzipSync(gz));
  try {
    const verify = new DatabaseSync(stagedPath, { readOnly: true });
    try {
      const rows = verify.prepare('PRAGMA integrity_check').all() as {
        integrity_check: string;
      }[];
      const problems = rows.map((r) => r.integrity_check).filter((line) => line !== 'ok');
      if (problems.length > 0) {
        throw new Error(`restored file failed integrity_check: ${problems.slice(0, 3).join('; ')}`);
      }
    } finally {
      verify.close();
    }

    const previousCopyDir = path.join(folder, `pre-restore-${compactTimestamp(new Date())}`);
    await fs.mkdir(previousCopyDir, { recursive: true });
    for (const sidecar of ['', '-wal', '-shm']) {
      const live = path.join(folder, `${ENTITY_DB_FILENAME}${sidecar}`);
      try {
        await fs.rename(live, path.join(previousCopyDir, `${ENTITY_DB_FILENAME}${sidecar}`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await fs.rename(stagedPath, path.join(folder, ENTITY_DB_FILENAME));

    let achievementsRestored = false;
    const pairedAchievementsKey = companionAchievementsKey(key);
    if (pairedAchievementsKey) {
      try {
        const achievementsGz = await client.getObject(pairedAchievementsKey);
        const expectedAchievementsSha = (
          await client.headObjectMetadata(pairedAchievementsKey).catch(() => null)
        )?.sha256;
        if (expectedAchievementsSha) {
          const actualAchievementsSha = createHash('sha256').update(achievementsGz).digest('hex');
          if (actualAchievementsSha !== expectedAchievementsSha) {
            throw new Error(
              `downloaded achievements snapshot is corrupt (sha256 ${actualAchievementsSha} ≠ ${expectedAchievementsSha})`,
            );
          }
        }
        const achievementsLive = await resolveAchievementsPrimaryPath();
        try {
          await fs.rename(
            achievementsLive,
            path.join(previousCopyDir, path.basename(achievementsLive)),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await writeAchievementsEnvelopeRaw(gunzipSync(achievementsGz).toString('utf8'));
        achievementsRestored = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const missing =
          /not found|NoSuchKey|404|does not exist/i.test(message) ||
          (error as NodeJS.ErrnoException).name === 'NoSuchKey';
        if (!missing) {
          console.warn('[entityDbBackup] achievements restore skipped:', message);
        }
      }
    }

    return {
      ok: true,
      restoredFromKey: key,
      restoredBytes: gz.length,
      previousCopyDir,
      achievementsRestored,
    };
  } catch (error) {
    await fs.rm(stagedPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

// --- startup integrity gate ------------------------------------------

export interface EntityDbIntegrityReport {
  ok: boolean;
  problems: string[];
  checked: boolean;
}

/**
 * Cheap `PRAGMA integrity_check` used at startup to offer a restore. Local
 * `entities.sqlite` corruption only — a Turso-backed project's data lives on
 * the hosted database, not a file this process can corrupt by itself, so
 * there's nothing local to check.
 */
export const checkEntityDbIntegrity = async (): Promise<EntityDbIntegrityReport> => {
  if (activePedb) return { ok: true, problems: [], checked: false };
  const dbPath = await getEntityDbPath();
  if (!dbPath) return { ok: true, problems: [], checked: false };
  try {
    await fs.access(dbPath);
  } catch {
    return { ok: true, problems: [], checked: false };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
      const problems = rows.map((r) => r.integrity_check).filter((line) => line !== 'ok');
      return { ok: problems.length === 0, problems, checked: true };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      problems: [error instanceof Error ? error.message : String(error)],
      checked: true,
    };
  }
};

/** Exported for tests. */
export const __testing = {
  parseSnapshotKey,
  companionAchievementsKey,
  compactTimestamp,
  sqlStringLiteral,
  KEEP_RECENT,
};

export type { EntityDbBackupConfig };
