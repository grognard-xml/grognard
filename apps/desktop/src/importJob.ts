/**
 * Durable corpus-import job runner in the Electron main process.
 * One job runs at a time; others queue. Per-juan state is persisted to disk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Notification, powerSaveBlocker, type BrowserWindow } from 'electron';
import type {
  CbetaImportJobOptions,
  DaozangImportJobOptions,
  ImportJobOptions,
  ImportJobProgressEvent,
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
  snapshot: ImportJobSnapshot;
  abort: AbortController;
  pauseRequested: boolean;
  runPromise?: Promise<void>;
}

const jobs = new Map<string, RuntimeJob>();
const queue: string[] = [];
let activeJobId: string | null = null;
let emitProgress: EmitFn | null = null;
let getMainWindow: (() => BrowserWindow | null) | null = null;
let powerSaveBlockerId: number | null = null;

const JOB_FILE_NAME = '.import-job.json';

const nowIso = (): string => new Date().toISOString();

const jobFilePath = (options: ImportJobOptions): string =>
  path.join(options.destDir, JOB_FILE_NAME);

const persistJob = async (snapshot: ImportJobSnapshot): Promise<void> => {
  snapshot.updatedAt = nowIso();
  await fs.mkdir(path.dirname(jobFilePath(snapshot.options)), { recursive: true });
  await fs.writeFile(jobFilePath(snapshot.options), JSON.stringify(snapshot, null, 2), 'utf8');
};

const broadcast = (): void => {
  if (!emitProgress) return;
  emitProgress({
    jobs: [...jobs.values()].map((runtime) => structuredClone(runtime.snapshot)),
    activeJobId,
  });
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
  return [...jobs.values()].map((runtime) => structuredClone(runtime.snapshot));
}

export function getImportJobProgressEvent(): ImportJobProgressEvent {
  return {
    jobs: listImportJobs(),
    activeJobId,
  };
}

export async function startImportJob(options: ImportJobOptions): Promise<string> {
  ensurePluginBridgeWired();
  const jobId = randomUUID();
  const workId =
    options.kind === 'kanripo'
      ? options.krId
      : options.kind === 'cbeta'
        ? options.workId
        : options.workId;

  const snapshot: ImportJobSnapshot = {
    jobId,
    kind: options.kind,
    title: options.title,
    workId,
    status: 'queued',
    options,
    juan: [],
    startedAt: nowIso(),
    updatedAt: nowIso(),
    elapsedMs: 0,
    actualCost: 0,
  };

  jobs.set(jobId, {
    snapshot,
    abort: new AbortController(),
    pauseRequested: false,
  });
  queue.push(jobId);
  await persistJob(snapshot);
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
    void persistJob(runtime.snapshot);
    broadcast();
    return true;
  }
  return false;
}

export function resumeImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  if (
    runtime.snapshot.status !== 'paused' &&
    runtime.snapshot.status !== 'blocked' &&
    runtime.snapshot.status !== 'cancelled'
  ) {
    return false;
  }
  runtime.abort = new AbortController();
  runtime.pauseRequested = false;
  runtime.snapshot.status = 'queued';
  runtime.snapshot.blockReason = undefined;
  if (!queue.includes(jobId)) queue.push(jobId);
  void persistJob(runtime.snapshot);
  broadcast();
  void pumpQueue();
  return true;
}

export function cancelImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  runtime.pauseRequested = false;
  runtime.abort.abort();
  runtime.snapshot.status = 'cancelled';
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  if (activeJobId === jobId) activeJobId = null;
  void persistJob(runtime.snapshot);
  broadcast();
  void pumpQueue();
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
    runtime.abort = new AbortController();
    if (!queue.includes(jobId)) queue.push(jobId);
    void pumpQueue();
  }
  void persistJob(runtime.snapshot);
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
  void persistJob(runtime.snapshot);
  broadcast();
  return true;
}

export function dismissImportJob(jobId: string): boolean {
  const runtime = jobs.get(jobId);
  if (!runtime) return false;
  runtime.snapshot.dismissed = true;
  jobs.delete(jobId);
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  broadcast();
  return true;
}

/** Load unfinished jobs from a project dest dir without auto-resuming. */
export async function restoreImportJobFromDisk(jobPath: string): Promise<ImportJobSnapshot | null> {
  try {
    const raw = await fs.readFile(jobPath, 'utf8');
    const snapshot = JSON.parse(raw) as ImportJobSnapshot;
    if (!snapshot?.jobId || !snapshot.options) return null;
    if (snapshot.status === 'completed' || snapshot.status === 'cancelled') {
      if (snapshot.dismissed) return null;
    }
    if (snapshot.status === 'running' || snapshot.status === 'queued') {
      snapshot.status = 'paused';
    }
    if (jobs.has(snapshot.jobId)) return structuredClone(snapshot);
    jobs.set(snapshot.jobId, {
      snapshot,
      abort: new AbortController(),
      pauseRequested: false,
    });
    broadcast();
    return structuredClone(snapshot);
  } catch {
    return null;
  }
}

export async function discoverAndRestoreImportJobs(projectRoot: string): Promise<number> {
  const roots = [
    path.join(projectRoot, 'imported', 'kanripo'),
    path.join(projectRoot, 'imported', 'cbeta'),
    path.join(projectRoot, 'imported', 'daozang'),
  ];
  let restored = 0;
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(root, entry.name, JOB_FILE_NAME);
        // CBETA nests deeper: imported/cbeta/canon/vol/
        try {
          const nested = await fs.readdir(path.join(root, entry.name), { withFileTypes: true });
          for (const child of nested) {
            if (child.isDirectory()) {
              const deep = path.join(root, entry.name, child.name, JOB_FILE_NAME);
              if (await restoreImportJobFromDisk(deep)) restored += 1;
            }
          }
        } catch {
          // ignore
        }
        if (await restoreImportJobFromDisk(candidate)) restored += 1;
      }
      // Daozang writes job next to files in imported/daozang/
      if (root.endsWith('daozang')) {
        if (await restoreImportJobFromDisk(path.join(root, JOB_FILE_NAME))) restored += 1;
      }
    } catch {
      // directory missing
    }
  }
  return restored;
}

export function hasRunningImportJob(): boolean {
  return [...jobs.values()].some((j) => j.snapshot.status === 'running');
}

export function killAllImportJobs(): void {
  for (const [jobId, runtime] of jobs) {
    runtime.abort.abort();
    if (runtime.snapshot.status === 'running' || runtime.snapshot.status === 'queued') {
      runtime.snapshot.status = 'paused';
      void persistJob(runtime.snapshot);
    }
    void jobId;
  }
  queue.length = 0;
  activeJobId = null;
  holdPowerSave(false);
  broadcast();
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
  await persistJob(runtime.snapshot);
  broadcast();

  const needsAwake =
    runtime.snapshot.options.kind === 'kanripo' &&
    runtime.snapshot.options.punctMode === 'ai';
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
    if (runtime.snapshot.options.kind === 'kanripo') {
      await runKanripoJob(runtime, tickElapsed);
    } else if (runtime.snapshot.options.kind === 'cbeta') {
      await runCbetaJob(runtime, tickElapsed);
    } else {
      await runDaozangJob(runtime, tickElapsed);
    }

    if (runtime.pauseRequested || runtime.abort.signal.aborted) {
      if (runtime.snapshot.status !== 'blocked' && runtime.snapshot.status !== 'cancelled') {
        runtime.snapshot.status = 'paused';
      }
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
    if (error instanceof ImportJobBlockedError) {
      runtime.snapshot.status = 'blocked';
      runtime.snapshot.blockReason = error.message;
      notifyOs(`${runtime.snapshot.title} paused`, error.message);
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      runtime.snapshot.status = runtime.pauseRequested ? 'paused' : 'cancelled';
    } else if (runtime.pauseRequested || runtime.abort.signal.aborted) {
      runtime.snapshot.status = 'paused';
    } else {
      runtime.snapshot.status = 'blocked';
      runtime.snapshot.blockReason =
        error instanceof Error ? error.message : String(error);
      notifyOs(`${runtime.snapshot.title} failed`, runtime.snapshot.blockReason);
    }
  }

  tickElapsed();
  await persistJob(runtime.snapshot);
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

const runKanripoJob = async (
  runtime: RuntimeJob,
  tickElapsed: () => void,
): Promise<void> => {
  const options = runtime.snapshot.options as KanripoImportJobOptions;
  const signal = runtime.abort.signal;

  let files: string[] = [];
  if (options.importScope === 'juan') {
    const result = (await invokePluginPython('kanripo-import', {
      op: 'fetch_juan',
      kr_id: options.krId,
      juan: String(options.juanInput ?? ''),
      cache_root: kanripoCacheRoot(),
    })) as { files?: string[]; path?: string };
    files = result.files ?? (result.path ? [result.path] : []);
  } else {
    const { cachePath } = await cloneKanripoWork(options.krId);
    files = await listKanripoTxtFiles(cachePath);
  }
  if (files.length === 0) throw new Error('No source .txt files found.');

  await fs.mkdir(options.destDir, { recursive: true });
  const usedPaths = new Set<string>();
  try {
    const existing = await fs.readdir(options.destDir);
    for (const name of existing) {
      if (name.toLowerCase().endsWith('.xml')) {
        usedPaths.add(path.join(options.destDir, name).replace(/\\/g, '/'));
      }
    }
  } catch {
    // empty
  }

  ensureJuanList(
    runtime.snapshot,
    files.map((filePath) => ({
      stem: stemFromSourcePath(filePath),
      sourceKey: filePath,
    })),
    options.skipStems,
  );

  // Mark already-written stems as done on resume.
  for (const juan of runtime.snapshot.juan) {
    if (juan.state === 'done' || juan.state === 'skipped' || juan.state === 'needs_attention') {
      if (juan.outputPath) usedPaths.add(juan.outputPath.replace(/\\/g, '/'));
    }
  }

  const usedChapterIds: string[] = [];
  const convertedCache = new Map<
    string,
    { meta: never; body_xml: string; metadata_xml?: string }
  >();

  // Pre-convert for folder-reference alignment if needed and not already done.
  if (
    options.punctMode === 'parallel' &&
    options.sources.some((s) => s.kind === 'folder-reference') &&
    !options.alignedMatches
  ) {
    // Alignment must be confirmed in the dialog before start; without it, fall back to tape.
  }

  const juanConcurrency = Math.max(1, options.juanConcurrency ?? 1);
  const pending = () =>
    runtime.snapshot.juan.filter(
      (j) => j.state === 'pending' || (j.state === 'running' && !j.outputPath),
    );

  const processOne = async (juan: ImportJuanRecord): Promise<void> => {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (juan.state === 'done' || juan.state === 'skipped' || juan.state === 'needs_attention') {
      return;
    }
    // Retry clears needs_attention/failed back to pending.
    if (juan.state === 'failed') return;

    juan.state = 'running';
    tickElapsed();
    broadcast();
    await persistJob(runtime.snapshot);

    const t0 = Date.now();
    try {
      const result = await processKanripoJuan({
        options,
        sourcePath: juan.sourceKey,
        stem: juan.stem,
        usedPaths,
        usedChapterIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        convertedCache: convertedCache as any,
        signal,
        currentCost: runtime.snapshot.actualCost,
        onStatus: () => {
          tickElapsed();
          broadcast();
        },
      });
      juan.stem = result.stem;
      juan.outputPath = result.outputPath;
      juan.coverage = result.coverage;
      juan.warnings = result.warnings;
      juan.cost = result.cost;
      if (result.cost) runtime.snapshot.actualCost += result.cost;
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
      }
      updateAvg(runtime.snapshot, Date.now() - t0);
    } catch (error) {
      if (error instanceof ImportJobBlockedError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      juan.state = 'needs_attention';
      juan.reason = error instanceof Error ? error.message : String(error);
      updateAvg(runtime.snapshot, Date.now() - t0);
    }
    tickElapsed();
    await persistJob(runtime.snapshot);
    broadcast();
  };

  while (true) {
    if (signal.aborted || runtime.pauseRequested) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const batch = pending()
      .filter((j) => j.state === 'pending')
      .slice(0, options.punctMode === 'ai' ? juanConcurrency : 1);
    if (batch.length === 0) break;
    if (batch.length === 1) {
      await processOne(batch[0]);
    } else {
      await Promise.all(batch.map((juan) => processOne(juan)));
    }
  }

  const failedOrAttention = runtime.snapshot.juan.some(
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
  const options = runtime.snapshot.options as CbetaImportJobOptions;
  const signal = runtime.abort.signal;

  const converted = (await invokePluginPython('cbeta-import', {
    op: 'convert',
    work_id: options.workId,
    cross_family: options.crossFamily,
    clean: options.cleanImport,
    strip_lb: options.stripLineBreaks,
    split_unit: options.splitUnit,
  })) as {
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
  options.destDir = destDir;
  runtime.snapshot.options = options;
  await fs.mkdir(destDir, { recursive: true });
  const used = new Set<string>();
  try {
    for (const name of await fs.readdir(destDir)) {
      if (name.toLowerCase().endsWith('.xml')) {
        used.add(path.join(destDir, name).replace(/\\/g, '/'));
      }
    }
  } catch {
    // empty
  }

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
    if (juanRec.state === 'done' || juanRec.state === 'skipped' || juanRec.state === 'needs_attention') {
      continue;
    }
    juanRec.state = 'running';
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
    await persistJob(runtime.snapshot);
    broadcast();
  }
};

const runDaozangJob = async (runtime: RuntimeJob, tickElapsed: () => void): Promise<void> => {
  const options = runtime.snapshot.options as DaozangImportJobOptions;
  const signal = runtime.abort.signal;
  const sourcePath = daozangTextPath(options.relPath);
  const converted = (await invokePluginPython('daozang-import', {
    path: sourcePath,
    rel_path: options.relPath,
  })) as {
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
  const used = new Set<string>();
  try {
    for (const name of await fs.readdir(options.destDir)) {
      if (name.toLowerCase().endsWith('.xml')) {
        used.add(path.join(options.destDir, name).replace(/\\/g, '/'));
      }
    }
  } catch {
    // empty
  }

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
    if (juanRec.state === 'done' || juanRec.state === 'skipped' || juanRec.state === 'needs_attention') {
      continue;
    }
    juanRec.state = 'running';
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
    } catch (error) {
      juanRec.state = 'needs_attention';
      juanRec.reason = error instanceof Error ? error.message : String(error);
    }
    updateAvg(runtime.snapshot, Date.now() - t0);
    tickElapsed();
    await persistJob(runtime.snapshot);
    broadcast();
  }
};
