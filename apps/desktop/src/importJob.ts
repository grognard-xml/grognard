/**
 * Durable corpus-import job runner in the Electron main process.
 * One job runs at a time; others queue. Per-juan state is persisted to disk.
 *
 * Job records live in the app's user-data folder (`import-jobs/<jobId>.json`), not in the project:
 * a project can be under version control or shared, and a record may name a model and a spending
 * cap. A record never holds the API key or the large texts a job was started with; the texts go
 * to a sidecar file written once, and the key is supplied again when a restored job is resumed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, Notification, powerSaveBlocker, type BrowserWindow } from 'electron';
import type {
  CbetaImportJobOptions,
  DaozangImportJobOptions,
  ImportJobOptions,
  ImportJobProgressEvent,
  ImportJobResumeOptions,
  ImportJobSnapshot,
  ImportJuanRecord,
  KanripoImportJobOptions,
} from '../../commons/src/desktop/importJobTypes';
import {
  uniqueCbetaXmlPath,
  wrapCbetaTeiDocument,
  type CbetaTeiMeta,
} from '../../commons/src/desktop/cbetaImportXml';
import {
  uniqueDaozangXmlPath,
  wrapDaozangTeiDocument,
  type DaozangTeiMeta,
} from '../../commons/src/desktop/daozangImportXml';
import { isLocalAiBaseUrl } from '../../../packages/cwrc-leafwriter/src/autoTagging/llmClientFromSettings';
import { writeFileAtomic } from './atomicWrite';
import {
  cloneKanripoWork,
  flushKanripoWork,
  listKanripoTxtFiles,
  kanripoCacheRoot,
} from './kanripoClone';
import { daozangTextPath } from './daozangCorpus';
import { invokePluginPython } from './pluginPythonBridge';
import {
  ensurePluginBridgeWired,
  ImportJobBlockedError,
  processKanripoJuan,
  stemFromSourcePath,
} from './kanripoImportPipeline';

type EmitFn = (event: ImportJobProgressEvent) => void;

interface RuntimeJob {
  /** What the window sees and what is saved: no API key, no large texts. */
  snapshot: ImportJobSnapshot;
  /** The full options, kept in memory only (plus the sidecar for the large parts). */
  options: ImportJobOptions;
  abort: AbortController;
  pauseRequested: boolean;
  runPromise?: Promise<void>;
  persistChain: Promise<void>;
}

const jobs = new Map<string, RuntimeJob>();
const queue: string[] = [];
let activeJobId: string | null = null;
let emitProgress: EmitFn | null = null;
let getMainWindow: (() => BrowserWindow | null) | null = null;
let powerSaveBlockerId: number | null = null;

const COMPLETED_JOB_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const BROADCAST_MIN_MS = 250;

const nowIso = (): string => new Date().toISOString();

const jobsDir = (): string => path.join(app.getPath('userData'), 'import-jobs');
const jobFile = (jobId: string): string => path.join(jobsDir(), `${jobId}.json`);
const heavyFile = (jobId: string): string => path.join(jobsDir(), `${jobId}.heavy.json`);

/** The parts of a job's options that are large or sensitive; saved once in the sidecar. */
interface HeavyOptions {
  projectConfig?: ImportJobOptions['projectConfig'];
  sources?: KanripoImportJobOptions['sources'];
  alignedJuanSources?: KanripoImportJobOptions['alignedJuanSources'];
  alignedMatches?: KanripoImportJobOptions['alignedMatches'];
  alignedSourcesPayload?: KanripoImportJobOptions['alignedSourcesPayload'];
  gaijiOverrides?: KanripoImportJobOptions['gaijiOverrides'];
}

export const splitOptions = (
  options: ImportJobOptions,
): { light: ImportJobOptions; heavy: HeavyOptions } => {
  if (options.kind !== 'kanripo') {
    return {
      light: { ...options, projectConfig: {} },
      heavy: { projectConfig: options.projectConfig },
    };
  }
  return {
    light: {
      ...options,
      projectConfig: {},
      sources: options.sources.map(({ id, label, kind, url }) => ({
        id,
        label,
        kind,
        url,
        text: '',
      })),
      alignedJuanSources: undefined,
      alignedMatches: undefined,
      alignedSourcesPayload: undefined,
      gaijiOverrides: undefined,
      aiSettings: options.aiSettings ? { ...options.aiSettings, apiKey: '' } : options.aiSettings,
    },
    heavy: {
      projectConfig: options.projectConfig,
      sources: options.sources,
      alignedJuanSources: options.alignedJuanSources,
      alignedMatches: options.alignedMatches,
      alignedSourcesPayload: options.alignedSourcesPayload,
      gaijiOverrides: options.gaijiOverrides,
    },
  };
};

const mergeOptions = (light: ImportJobOptions, heavy: HeavyOptions): ImportJobOptions => {
  const merged = { ...light, projectConfig: heavy.projectConfig ?? light.projectConfig };
  if (merged.kind !== 'kanripo') return merged as ImportJobOptions;
  return {
    ...merged,
    sources: heavy.sources ?? merged.sources,
    alignedJuanSources: heavy.alignedJuanSources,
    alignedMatches: heavy.alignedMatches,
    alignedSourcesPayload: heavy.alignedSourcesPayload,
    gaijiOverrides: heavy.gaijiOverrides,
  } as ImportJobOptions;
};

const persistJob = (runtime: RuntimeJob): Promise<void> => {
  runtime.snapshot.updatedAt = nowIso();
  const body = JSON.stringify(runtime.snapshot);
  // Writes for one job are strictly ordered: an older state must never land after a newer one.
  runtime.persistChain = runtime.persistChain
    .then(() => writeFileAtomic(jobFile(runtime.snapshot.jobId), body))
    .catch((error) => {
      console.error('[importJob] could not save job state', error);
    });
  return runtime.persistChain;
};

const setOptions = (runtime: RuntimeJob, options: ImportJobOptions): void => {
  runtime.options = options;
  runtime.snapshot.options = splitOptions(options).light;
};

const buildEvent = (): ImportJobProgressEvent => ({
  jobs: [...jobs.values()].map((runtime) => structuredClone(runtime.snapshot)),
  activeJobId,
});

let lastBroadcastAt = 0;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

/** Sends the state to the window, at most every 250 ms: progress ticks come much faster. */
const broadcast = (): void => {
  if (!emitProgress) return;
  const wait = lastBroadcastAt + BROADCAST_MIN_MS - Date.now();
  if (wait > 0) {
    if (!broadcastTimer) {
      broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        lastBroadcastAt = Date.now();
        emitProgress?.(buildEvent());
      }, wait);
    }
    return;
  }
  lastBroadcastAt = Date.now();
  emitProgress(buildEvent());
};

const notifyOs = (title: string, body: string, onClick?: () => void): void => {
  try {
    const notification = new Notification({ title, body });
    if (onClick) {
      notification.on('click', () => {
        const win = getMainWindow?.();
        win?.show();
        win?.focus();
        onClick();
      });
    }
    notification.show();
  } catch {
    // Notifications may be unavailable in some environments.
  }
};

const holdPowerSave = (hold: boolean): void => {
  if (hold && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!hold && powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
};

export function configureImportJobEmitter(
  emit: EmitFn,
  mainWindowGetter: () => BrowserWindow | null,
): void {
  emitProgress = emit;
  getMainWindow = mainWindowGetter;
}

export function listImportJobs(): ImportJobSnapshot[] {
  return buildEvent().jobs;
}

export function getImportJobProgressEvent(): ImportJobProgressEvent {
  return buildEvent();
}

const UNFINISHED: ImportJobSnapshot['status'][] = ['queued', 'running', 'paused', 'blocked'];

const workIdOf = (options: ImportJobOptions): string =>
  options.kind === 'kanripo' ? options.krId : options.workId;

export async function startImportJob(options: ImportJobOptions): Promise<string> {
  ensurePluginBridgeWired();
  const workId = workIdOf(options);
  for (const runtime of jobs.values()) {
    const other = runtime.snapshot;
    if (
      other.kind === options.kind &&
      other.workId === workId &&
      other.options.projectRoot === options.projectRoot &&
      UNFINISHED.includes(other.status)
    ) {
      throw new Error(
        `${other.title} already has an unfinished import. Resume or cancel it in the import panel first.`,
      );
    }
  }

  const jobId = randomUUID();
  const { light, heavy } = splitOptions(options);
  const snapshot: ImportJobSnapshot = {
    jobId,
    kind: options.kind,
    title: options.title,
    workId,
    status: 'queued',
    options: light,
    juan: [],
    startedAt: nowIso(),
    updatedAt: nowIso(),
    elapsedMs: 0,
    actualCost: 0,
  };

  const runtime: RuntimeJob = {
    snapshot,
    options,
    abort: new AbortController(),
    pauseRequested: false,
    persistChain: Promise.resolve(),
  };
  jobs.set(jobId, runtime);
  queue.push(jobId);
  await writeFileAtomic(heavyFile(jobId), JSON.stringify(heavy));
  await persistJob(runtime);
  broadcast();
  void pumpQueue();
  return jobId;
}

export function pauseImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  if (runtime.snapshot.status === 'running') {
    runtime.pauseRequested = true;
    runtime.abort.abort();
    return true;
  }
  if (runtime.snapshot.status === 'queued') {
    runtime.snapshot.status = 'paused';
    const idx = queue.indexOf(jobId);
    if (idx >= 0) queue.splice(idx, 1);
    void persistJob(runtime);
    broadcast();
    return true;
  }
  return false;
}

export function resumeImportJob(jobId: string, resume?: ImportJobResumeOptions): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  if (
    runtime.snapshot.status !== 'paused' &&
    runtime.snapshot.status !== 'blocked' &&
    runtime.snapshot.status !== 'cancelled'
  ) {
    return false;
  }

  const options = runtime.options;
  if (options.kind === 'kanripo' && options.punctMode === 'ai') {
    // The API key is not saved with a job; take the one the app has now.
    const settings = resume?.aiSettings?.baseUrl ? resume.aiSettings : options.aiSettings;
    const usable =
      settings && (isLocalAiBaseUrl(settings.baseUrl) || Boolean(settings.apiKey?.trim()));
    if (!usable) {
      runtime.snapshot.status = 'blocked';
      runtime.snapshot.blockReason =
        'AI API settings are needed to continue. Configure them in App Settings, then resume.';
      void persistJob(runtime);
      broadcast();
      return true;
    }
    setOptions(runtime, { ...options, aiSettings: settings });
  }

  runtime.abort = new AbortController();
  runtime.pauseRequested = false;
  runtime.snapshot.status = 'queued';
  runtime.snapshot.blockReason = undefined;
  runtime.snapshot.pauseReason = undefined;
  if (!queue.includes(jobId)) queue.push(jobId);
  void persistJob(runtime);
  broadcast();
  void pumpQueue();
  return true;
}

export function cancelImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  const wasRunning = runtime.snapshot.status === 'running';
  runtime.pauseRequested = false;
  runtime.abort.abort();
  runtime.snapshot.status = 'cancelled';
  runtime.snapshot.pauseReason = undefined;
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  // A job that is running is still unwinding (its Python call is being killed): the next job
  // starts when it has finished, from pumpQueue's `finally`, not now.
  if (!wasRunning) void pumpQueue();
  void persistJob(runtime);
  broadcast();
  return true;
}

export function retryImportJuan(jobId: string, stem: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  const juan = runtime.snapshot.juan.find((j) => j.stem === stem);
  if (!juan) return false;
  juan.state = 'pending';
  juan.reason = undefined;
  juan.warnings = undefined;
  if (
    runtime.snapshot.status === 'completed' ||
    runtime.snapshot.status === 'paused' ||
    runtime.snapshot.status === 'blocked'
  ) {
    runtime.snapshot.status = 'queued';
    runtime.snapshot.pauseReason = undefined;
    runtime.abort = new AbortController();
    runtime.pauseRequested = false;
    if (!queue.includes(jobId)) queue.push(jobId);
    void pumpQueue();
  }
  void persistJob(runtime);
  broadcast();
  return true;
}

export function acceptImportJuan(jobId: string, stem: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  const juan = runtime.snapshot.juan.find((j) => j.stem === stem);
  if (!juan) return false;
  juan.state = 'done';
  juan.reason = undefined;
  void persistJob(runtime);
  broadcast();
  return true;
}

/** Forget a finished, cancelled or paused job and delete its saved record. */
export function dismissImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime || runtime.snapshot.status === 'running') return false;
  jobs.delete(jobId);
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  void runtime.persistChain.then(() =>
    Promise.all([
      fs.rm(jobFile(jobId), { force: true }),
      fs.rm(heavyFile(jobId), { force: true }),
    ]).catch(() => undefined),
  );
  broadcast();
  return true;
}

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

/**
 * Load the saved jobs of a project, as paused: nothing starts by itself after a restart.
 * Returns how many were newly loaded.
 */
export async function discoverAndRestoreImportJobs(projectRoot: string): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(jobsDir());
  } catch {
    return 0;
  }
  let restored = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.heavy.json')) continue;
    const jobId = name.slice(0, -'.json'.length);
    if (jobs.has(jobId)) continue;
    const snapshot = await readJson<ImportJobSnapshot>(path.join(jobsDir(), name));
    if (!snapshot?.jobId || !snapshot.options || snapshot.options.projectRoot !== projectRoot) {
      continue;
    }
    const finishedAt = snapshot.finishedAt ? Date.parse(snapshot.finishedAt) : NaN;
    const staleDone =
      snapshot.status === 'completed' &&
      Number.isFinite(finishedAt) &&
      Date.now() - finishedAt > COMPLETED_JOB_KEEP_MS;
    if (snapshot.dismissed || staleDone) {
      await fs.rm(jobFile(jobId), { force: true }).catch(() => undefined);
      await fs.rm(heavyFile(jobId), { force: true }).catch(() => undefined);
      continue;
    }
    if (snapshot.status === 'running' || snapshot.status === 'queued') snapshot.status = 'paused';
    // A juan that was in flight when the app stopped has to be done again.
    for (const juan of snapshot.juan) {
      if (juan.state === 'running') juan.state = 'pending';
      juan.detail = undefined;
    }
    const heavy = (await readJson<HeavyOptions>(heavyFile(jobId))) ?? {};
    jobs.set(jobId, {
      snapshot,
      options: mergeOptions(snapshot.options, heavy),
      abort: new AbortController(),
      pauseRequested: false,
      persistChain: Promise.resolve(),
    });
    restored += 1;
  }
  if (restored > 0) broadcast();
  return restored;
}

export function hasRunningImportJob(): boolean {
  return [...jobs.values()].some((j) => j.snapshot.status === 'running');
}

/** Stop everything and save it as paused. Resolves once the state is on disk. */
export async function killAllImportJobs(): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const runtime of jobs.values()) {
    runtime.abort.abort();
    if (runtime.snapshot.status === 'running' || runtime.snapshot.status === 'queued') {
      runtime.snapshot.status = 'paused';
      for (const juan of runtime.snapshot.juan) {
        if (juan.state === 'running') juan.state = 'pending';
      }
      writes.push(persistJob(runtime));
    }
  }
  queue.length = 0;
  activeJobId = null;
  holdPowerSave(false);
  broadcast();
  await Promise.allSettled(writes);
}

const pumpQueue = async (): Promise<void> => {
  if (activeJobId) return;
  const nextId = queue.shift();
  if (!nextId) {
    holdPowerSave(false);
    return;
  }
  const runtime = jobs.get(nextId);
  if (!runtime || runtime.snapshot.status === 'cancelled') {
    void pumpQueue();
    return;
  }
  activeJobId = nextId;
  runtime.snapshot.status = 'running';
  runtime.pauseRequested = false;
  runtime.abort = new AbortController();
  await persistJob(runtime);
  broadcast();

  const needsAwake = runtime.options.kind === 'kanripo' && runtime.options.punctMode === 'ai';
  holdPowerSave(needsAwake);

  runtime.runPromise = runJob(runtime)
    .catch((error) => {
      console.error('[importJob]', error);
    })
    .finally(() => {
      if (activeJobId === nextId) activeJobId = null;
      holdPowerSave(false);
      broadcast();
      void pumpQueue();
    });
};

const runJob = async (runtime: RuntimeJob): Promise<void> => {
  const started = Date.now() - runtime.snapshot.elapsedMs;
  const tickElapsed = () => {
    runtime.snapshot.elapsedMs = Date.now() - started;
  };

  try {
    if (runtime.options.kind === 'kanripo') {
      await runKanripoJob(runtime, tickElapsed);
    } else if (runtime.options.kind === 'cbeta') {
      await runCbetaJob(runtime, tickElapsed);
    } else {
      await runDaozangJob(runtime, tickElapsed);
    }

    if (runtime.snapshot.status === 'cancelled') {
      // Cancelled while it was winding down: stays cancelled.
    } else if (runtime.pauseRequested || runtime.abort.signal.aborted) {
      if (runtime.snapshot.status !== 'blocked') runtime.snapshot.status = 'paused';
    } else if (runtime.snapshot.status === 'running') {
      runtime.snapshot.status = 'completed';
      runtime.snapshot.finishedAt = nowIso();
      const attention = runtime.snapshot.juan.filter((j) => j.state === 'needs_attention').length;
      const ok = runtime.snapshot.juan.filter((j) => j.state === 'done').length;
      notifyOs(
        `${runtime.snapshot.title} done`,
        attention > 0
          ? `${ok} ok, ${attention} need attention`
          : `${ok} juan imported successfully`,
      );
    }
  } catch (error) {
    if (runtime.snapshot.status === 'cancelled') {
      // Cancelled: whatever stopped the run, it stays cancelled.
    } else if (error instanceof ImportJobBlockedError) {
      runtime.snapshot.status = 'blocked';
      runtime.snapshot.blockReason = error.message;
      notifyOs(`${runtime.snapshot.title} paused`, error.message);
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      runtime.snapshot.status = 'paused';
    } else if (runtime.pauseRequested || runtime.abort.signal.aborted) {
      runtime.snapshot.status = 'paused';
    } else {
      runtime.snapshot.status = 'blocked';
      runtime.snapshot.blockReason = error instanceof Error ? error.message : String(error);
      notifyOs(`${runtime.snapshot.title} failed`, runtime.snapshot.blockReason);
    }
  }

  // Whatever stopped the run, a juan still marked running was cut short: it starts again.
  for (const juan of runtime.snapshot.juan) {
    if (juan.state === 'running') juan.state = 'pending';
    juan.detail = undefined;
  }
  tickElapsed();
  await persistJob(runtime);
  broadcast();
};

const ensureJuanList = (
  snapshot: ImportJobSnapshot,
  sources: { stem: string; sourceKey: string }[],
  skipStems?: string[],
): void => {
  if (snapshot.juan.length > 0) return;
  const skip = new Set(skipStems ?? []);
  snapshot.juan = sources.map(({ stem, sourceKey }) => ({
    stem,
    sourceKey,
    state: skip.has(stem) ? ('skipped' as const) : ('pending' as const),
  }));
};

const updateAvg = (snapshot: ImportJobSnapshot, juanMs: number): void => {
  const finished = snapshot.juan.filter(
    (j) => j.state === 'done' || j.state === 'needs_attention' || j.state === 'failed',
  ).length;
  if (finished <= 1) {
    snapshot.avgMsPerJuan = juanMs;
    return;
  }
  const prev = snapshot.avgMsPerJuan ?? juanMs;
  snapshot.avgMsPerJuan = prev * 0.7 + juanMs * 0.3;
};

const normalisePath = (p: string): string => p.replace(/\\/g, '/');

const readUsedXmlPaths = async (destDir: string): Promise<Set<string>> => {
  const used = new Set<string>();
  try {
    for (const name of await fs.readdir(destDir)) {
      if (name.toLowerCase().endsWith('.xml')) used.add(normalisePath(path.join(destDir, name)));
    }
  } catch {
    // empty
  }
  return used;
};

const runKanripoJob = async (runtime: RuntimeJob, tickElapsed: () => void): Promise<void> => {
  const options = runtime.options as KanripoImportJobOptions;
  const snapshot = runtime.snapshot;
  const signal = runtime.abort.signal;

  let files: string[];
  if (options.importScope === 'juan') {
    const result = (await invokePluginPython(
      'kanripo-import',
      {
        op: 'fetch_juan',
        kr_id: options.krId,
        juan: String(options.juanInput ?? ''),
        cache_root: kanripoCacheRoot(),
      },
      undefined,
      { signal },
    )) as { files?: string[]; path?: string };
    files = result.files ?? (result.path ? [result.path] : []);
  } else {
    const { cachePath } = await cloneKanripoWork(options.krId);
    files = await listKanripoTxtFiles(cachePath);
  }
  if (files.length === 0) throw new Error('No source .txt files found.');

  await fs.mkdir(options.destDir, { recursive: true });
  const usedPaths = await readUsedXmlPaths(options.destDir);

  ensureJuanList(
    snapshot,
    files.map((filePath) => ({ stem: stemFromSourcePath(filePath), sourceKey: filePath })),
    options.skipStems,
  );

  const usedChapterIds: string[] = [];
  const juanConcurrency = Math.max(1, options.juanConcurrency ?? 1);

  const processOne = async (juan: ImportJuanRecord): Promise<void> => {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (juan.state !== 'pending') return;

    juan.state = 'running';
    juan.detail = undefined;
    // A retried juan is written over its earlier file instead of getting a "-2" name.
    if (juan.outputPath) usedPaths.delete(normalisePath(juan.outputPath));
    tickElapsed();
    broadcast();
    await persistJob(runtime);

    const t0 = Date.now();
    try {
      const result = await processKanripoJuan({
        options,
        sourcePath: juan.sourceKey,
        stem: juan.stem,
        usedPaths,
        usedChapterIds,
        signal,
        currentCost: snapshot.actualCost,
        onStatus: (message) => {
          juan.detail = message;
          tickElapsed();
          broadcast();
        },
        onUsage: (usage, cost) => {
          const total = snapshot.actualTokens ?? { input: 0, output: 0 };
          snapshot.actualTokens = {
            input: total.input + usage.inputTokens,
            output: total.output + usage.outputTokens,
          };
          snapshot.actualCost += cost;
          juan.tokens = { input: usage.inputTokens, output: usage.outputTokens };
          juan.cost = cost;
        },
      });
      juan.stem = result.stem;
      juan.outputPath = result.outputPath;
      juan.coverage = result.coverage;
      juan.warnings = result.warnings;
      if (result.matchedChapterIds) {
        for (const id of result.matchedChapterIds) {
          if (!usedChapterIds.includes(id)) usedChapterIds.push(id);
        }
      }
      if (result.needsAttention) {
        juan.state = 'needs_attention';
        juan.reason = result.attentionReason;
      } else {
        juan.state = 'done';
        juan.reason = undefined;
      }
      juan.detail = undefined;
      updateAvg(snapshot, Date.now() - t0);
    } catch (error) {
      if (error instanceof ImportJobBlockedError) {
        juan.state = 'pending'; // not its fault: it is done again after Resume
        juan.detail = undefined;
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        juan.state = 'pending'; // paused or cancelled mid-way: done again after Resume
        juan.detail = undefined;
        throw error;
      }
      juan.state = 'needs_attention';
      juan.reason = error instanceof Error ? error.message : String(error);
      juan.detail = undefined;
      updateAvg(snapshot, Date.now() - t0);
    }
    tickElapsed();
    await persistJob(runtime);
    broadcast();

    // The result is recorded first, so the money already spent is not lost when the cap stops the job.
    if (options.spendCap != null && snapshot.actualCost >= options.spendCap) {
      throw new ImportJobBlockedError(
        `Spending cap of $${options.spendCap.toFixed(2)} reached.`,
        'spend_cap',
      );
    }
  };

  while (true) {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const batch = snapshot.juan
      .filter((j) => j.state === 'pending')
      .slice(0, options.punctMode === 'ai' ? juanConcurrency : 1);
    if (batch.length === 0) break;
    if (batch.length === 1) {
      await processOne(batch[0]);
    } else {
      await Promise.all(batch.map((juan) => processOne(juan)));
    }

    // The AI "trial": stop after the first juan so it can be checked before the rest.
    const trial = (runtime.options as KanripoImportJobOptions).pauseAfterFirst;
    if (trial && snapshot.juan.some((j) => j.state === 'pending')) {
      const first = snapshot.juan.find((j) => j.state === 'done' || j.state === 'needs_attention');
      if (first) {
        snapshot.pauseReason = 'trial';
        snapshot.trialStem = first.stem;
        setOptions(runtime, { ...options, pauseAfterFirst: false });
        runtime.pauseRequested = true;
      }
    }
  }

  const failedOrAttention = snapshot.juan.some(
    (j) => j.state === 'needs_attention' || j.state === 'failed',
  );
  if (!failedOrAttention && options.importScope === 'work') {
    try {
      await flushKanripoWork(options.krId);
    } catch {
      // keep cache
    }
  }
};

const runCbetaJob = async (runtime: RuntimeJob, tickElapsed: () => void): Promise<void> => {
  const options = runtime.options as CbetaImportJobOptions;
  const signal = runtime.abort.signal;

  const converted = (await invokePluginPython(
    'cbeta-import',
    {
      op: 'convert',
      work_id: options.workId,
      cross_family: options.crossFamily,
      clean: options.cleanImport,
      strip_lb: options.stripLineBreaks,
      split_unit: options.splitUnit,
    },
    undefined,
    { signal },
  )) as {
    juan: { n: string; title: string; body_xml: string; straddles?: string[] }[];
    title?: string;
    work_id: string;
    canon: string;
    vol: string;
    taisho_vol?: string;
    taisho_no?: string;
    no?: string;
    dynasty?: string;
    category?: string;
    warnings?: string[];
    data_version?: string;
    git_commit?: string;
    authorship?: CbetaTeiMeta['authorship'];
    work_qid?: string;
  };
  if (!converted?.juan?.length) throw new Error('Python conversion returned no sections.');

  const destDir = path.join(
    options.projectRoot,
    'imported',
    'cbeta',
    converted.canon,
    converted.vol,
  );
  setOptions(runtime, { ...options, destDir });
  await fs.mkdir(destDir, { recursive: true });
  const used = await readUsedXmlPaths(destDir);

  ensureJuanList(
    runtime.snapshot,
    converted.juan.map((juan) => ({
      stem: `${converted.work_id || options.workId}_${juan.n.padStart(3, '0')}`,
      sourceKey: juan.n,
    })),
  );

  const importNotes = [
    options.splitUnit === 'mulu' ? 'Split by CBETA section headings (mulu).' : 'Split by juan.',
    options.cleanImport ? 'Clean reading edition (collation anchors and apparatus omitted).' : '',
    options.stripLineBreaks ? 'Taishō line breaks (<lb>) omitted.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const baseStem = converted.work_id || options.workId;

  for (const juanRec of runtime.snapshot.juan) {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (juanRec.state !== 'pending') continue;
    juanRec.state = 'running';
    if (juanRec.outputPath) used.delete(normalisePath(juanRec.outputPath));
    broadcast();
    const t0 = Date.now();
    const juan = converted.juan.find((j) => j.n === juanRec.sourceKey);
    if (!juan) {
      juanRec.state = 'needs_attention';
      juanRec.reason = 'Section missing from conversion result.';
      continue;
    }
    try {
      const meta: CbetaTeiMeta = {
        title: converted.title ?? options.title,
        work_id: converted.work_id,
        canon: converted.canon,
        taisho_vol: converted.taisho_vol || converted.vol,
        taisho_no: converted.taisho_no || converted.no || '',
        dynasty: converted.dynasty ?? '',
        category: converted.category ?? '',
        split_unit: options.splitUnit,
        section_n: options.splitUnit === 'mulu' ? juan.n : undefined,
        section_title: options.splitUnit === 'mulu' ? juan.title : undefined,
        juan_n: options.splitUnit === 'juan' ? juan.n : undefined,
        juan_title: options.splitUnit === 'juan' ? juan.title : undefined,
        stem: baseStem,
        source: 'CBETA 漢文電子佛典 (cbeta-xml-p5)',
        data_version: converted.data_version,
        git_commit: converted.git_commit,
        authorship: converted.authorship,
        work_qid: converted.work_qid,
        importNotes: importNotes || undefined,
      };
      const xml = wrapCbetaTeiDocument({
        config: options.projectConfig as unknown as Parameters<
          typeof wrapCbetaTeiDocument
        >[0]['config'],
        meta,
        bodyXml: juan.body_xml,
      });
      const outputPath = uniqueCbetaXmlPath(
        destDir,
        `${baseStem}_${juan.n.padStart(3, '0')}`,
        used,
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, xml, 'utf8');
      juanRec.outputPath = outputPath;
      juanRec.state = 'done';
      juanRec.reason = undefined;
      if (juan.straddles?.length) {
        juanRec.warnings = juan.straddles.map((message) => ({
          code: 'straddle',
          severity: 'info' as const,
          message,
        }));
      }
    } catch (error) {
      juanRec.state = 'needs_attention';
      juanRec.reason = error instanceof Error ? error.message : String(error);
    }
    updateAvg(runtime.snapshot, Date.now() - t0);
    tickElapsed();
    await persistJob(runtime);
    broadcast();
  }
};

const runDaozangJob = async (runtime: RuntimeJob, tickElapsed: () => void): Promise<void> => {
  const options = runtime.options as DaozangImportJobOptions;
  const signal = runtime.abort.signal;
  const sourcePath = daozangTextPath(options.relPath);
  const converted = (await invokePluginPython(
    'daozang-import',
    {
      path: sourcePath,
      rel_path: options.relPath,
    },
    undefined,
    { signal },
  )) as {
    body_xml: string;
    metadata_xml?: string;
    meta: DaozangTeiMeta;
    entities?: { authorship?: DaozangTeiMeta['authorship'] };
    split?: boolean;
    juan_files?: { juan_n: string; juan_title: string; body_xml: string }[];
  };
  if (!converted?.body_xml || !converted.meta) {
    throw new Error('Python conversion returned no TEI body.');
  }

  await fs.mkdir(options.destDir, { recursive: true });
  const used = await readUsedXmlPaths(options.destDir);

  const baseStem = converted.meta.stem || options.title || options.workId;
  const juanFiles =
    converted.split && converted.juan_files && converted.juan_files.length >= 2
      ? converted.juan_files
      : [
          {
            juan_n: '',
            juan_title: converted.meta.title,
            body_xml: converted.body_xml,
          },
        ];

  ensureJuanList(
    runtime.snapshot,
    juanFiles.map((juan, index) => ({
      stem: juan.juan_n && juanFiles.length > 1 ? `${baseStem}-卷${juan.juan_n}` : baseStem,
      sourceKey: String(index),
    })),
  );

  for (const juanRec of runtime.snapshot.juan) {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (juanRec.state !== 'pending') continue;
    juanRec.state = 'running';
    if (juanRec.outputPath) used.delete(normalisePath(juanRec.outputPath));
    broadcast();
    const t0 = Date.now();
    const juan = juanFiles[Number(juanRec.sourceKey)];
    if (!juan) {
      juanRec.state = 'needs_attention';
      juanRec.reason = 'Juan missing from conversion.';
      continue;
    }
    try {
      const fileStem =
        juan.juan_n && juanFiles.length > 1 ? `${baseStem}-卷${juan.juan_n}` : baseStem;
      const docTitle =
        juan.juan_n && juanFiles.length > 1
          ? `${converted.meta.title} — 卷${juan.juan_n}`
          : converted.meta.title;
      const meta: DaozangTeiMeta = {
        ...converted.meta,
        title: docTitle,
        authorship: converted.entities?.authorship ?? converted.meta.authorship,
      };
      const xml = wrapDaozangTeiDocument({
        config: options.projectConfig as unknown as Parameters<
          typeof wrapDaozangTeiDocument
        >[0]['config'],
        meta,
        bodyXml: juan.body_xml,
        metadataXml: converted.metadata_xml,
      });
      const outputPath = uniqueDaozangXmlPath(options.destDir, fileStem, used);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, xml, 'utf8');
      juanRec.outputPath = outputPath;
      juanRec.state = 'done';
      juanRec.reason = undefined;
    } catch (error) {
      juanRec.state = 'needs_attention';
      juanRec.reason = error instanceof Error ? error.message : String(error);
    }
    updateAvg(runtime.snapshot, Date.now() - t0);
    tickElapsed();
    await persistJob(runtime);
    broadcast();
  }
};
