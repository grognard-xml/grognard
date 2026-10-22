import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ImportJobProgressEvent,
  ImportJobSnapshot,
  KanripoImportJobOptions,
} from '../../commons/src/desktop/importJobTypes';

const mockUserData = path.join(os.tmpdir(), `grognard-import-job-test-${process.pid}`);

jest.mock('electron', () => ({
  app: { getPath: () => mockUserData },
  Notification: class {
    on() {}
    show() {}
  },
  powerSaveBlocker: { start: () => 1, stop: () => undefined },
}));

const mockInvokePython = jest.fn();
jest.mock('./pluginPythonBridge', () => ({
  invokePluginPython: (...args: unknown[]) => mockInvokePython(...args),
}));

// Delegates to the real atomic write; a test can wrap it to act while a job state is being saved.
const mockWriteAtomic = jest.fn();
jest.mock('./atomicWrite', () => {
  const actual = jest.requireActual('./atomicWrite');
  return {
    ...actual,
    writeFileAtomic: (...args: unknown[]) => mockWriteAtomic(...args),
  };
});

const mockProcessJuan = jest.fn();
jest.mock('./kanripoImportPipeline', () => {
  class ImportJobBlockedError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
      this.name = 'ImportJobBlockedError';
    }
  }
  return {
    ImportJobBlockedError,
    ensurePluginBridgeWired: () => undefined,
    processKanripoJuan: (...args: unknown[]) => mockProcessJuan(...args),
    stemFromSourcePath: (p: string) =>
      p
        .split('/')
        .pop()!
        .replace(/\.txt$/, ''),
  };
});

const mockFiles: Record<string, string[]> = {};
jest.mock('./kanripoClone', () => ({
  cloneKanripoWork: async (krId: string) => ({ cachePath: `/cache/${krId}` }),
  listKanripoTxtFiles: async (cachePath: string) => mockFiles[cachePath.split('/').pop()!] ?? [],
  flushKanripoWork: async () => undefined,
  kanripoCacheRoot: () => '/cache',
}));
jest.mock('./daozangCorpus', () => ({ daozangTextPath: (rel: string) => rel }));

type JobModule = typeof import('./importJob');

let mod: JobModule;
let tmpProject: string;
let events: ImportJobProgressEvent[];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (condition: () => boolean, label: string, timeoutMs = 4000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await wait(10);
  }
};

const abortError = () => new DOMException('Aborted', 'AbortError');

const kanripoOptions = (
  overrides: Partial<KanripoImportJobOptions> = {},
): KanripoImportJobOptions => ({
  kind: 'kanripo',
  krId: 'KR9z0001',
  title: 'Test work',
  projectRoot: tmpProject,
  destDir: path.join(tmpProject, 'imported', 'kanripo', 'KR9z0001'),
  importScope: 'work',
  normalize: 'dpm',
  punctMode: 'as-is',
  alignMode: 'tape',
  sources: [{ id: 's1', label: 'Wikisource', text: 'X'.repeat(50_000), kind: 'wikisource' }],
  projectConfig: { schema: { catalogId: 'teiAll' } },
  gaijiOverrides: { KR1: 'x' },
  ...overrides,
});

/** A juan that finishes at once with the given output path. */
const finishes =
  (stem: string, extra: Record<string, unknown> = {}) =>
  async (params: { usedPaths: Set<string> }) => {
    const outputPath = `${tmpProject}/imported/kanripo/KR9z0001/${stem}.xml`;
    params.usedPaths.add(outputPath);
    return { stem, outputPath, ...extra };
  };

const snapshotOf = (jobId: string): ImportJobSnapshot =>
  mod.listImportJobs().find((j) => j.jobId === jobId)!;

beforeEach(async () => {
  jest.resetModules();
  mockInvokePython.mockReset();
  mockProcessJuan.mockReset();
  mockWriteAtomic.mockReset();
  mockWriteAtomic.mockImplementation((...args: unknown[]) =>
    jest.requireActual('./atomicWrite').writeFileAtomic(...args),
  );
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  mockFiles.KR9z0001 = [
    '/cache/KR9z0001/KR9z0001_001.txt',
    '/cache/KR9z0001/KR9z0001_002.txt',
    '/cache/KR9z0001/KR9z0001_003.txt',
  ];
  mockFiles.KR9z0002 = ['/cache/KR9z0002/KR9z0002_001.txt'];
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'grognard-import-project-'));
  await fs.rm(mockUserData, { recursive: true, force: true });
  events = [];
  mod = await import('./importJob');
  mod.configureImportJobEmitter(
    (event) => events.push(event),
    () => null,
  );
});

afterEach(async () => {
  await mod.killAllImportJobs();
  await fs.rm(tmpProject, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(mockUserData, { recursive: true, force: true });
});

describe('a plain job', () => {
  it('writes every juan, completes, and keeps the API key and large texts out of everything it saves or sends', async () => {
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) =>
      finishes(p.stem)(p),
    );
    const jobId = await mod.startImportJob(
      kanripoOptions({
        punctMode: 'ai',
        aiSettings: { baseUrl: 'https://api.example', apiKey: 'SECRET-KEY', model: 'm' },
      }),
    );
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    const done = snapshotOf(jobId);
    expect(done.juan.map((j) => j.state)).toEqual(['done', 'done', 'done']);

    const saved = await fs.readFile(
      path.join(mockUserData, 'import-jobs', `${jobId}.json`),
      'utf8',
    );
    expect(saved).not.toContain('SECRET-KEY');
    expect(saved).not.toContain('XXXXXXXXXX');
    expect(saved.length).toBeLessThan(10_000);
    // The large texts are saved once, in a sidecar the window never receives.
    const heavy = await fs.readFile(
      path.join(mockUserData, 'import-jobs', `${jobId}.heavy.json`),
      'utf8',
    );
    expect(heavy).toContain('XXXXXXXXXX');
    expect(heavy).not.toContain('SECRET-KEY');

    const sent = JSON.stringify(events);
    expect(sent).not.toContain('SECRET-KEY');
    expect(sent).not.toContain('XXXXXXXXXX');
    // ...but the job itself was given them.
    expect(mockProcessJuan.mock.calls[0][0].options.aiSettings.apiKey).toBe('SECRET-KEY');
    expect(mockProcessJuan.mock.calls[0][0].options.sources[0].text.length).toBe(50_000);
  });

  it('refuses a second unfinished import of the same work', async () => {
    mockProcessJuan.mockImplementation(() => new Promise(() => undefined));
    await mod.startImportJob(kanripoOptions());
    await expect(mod.startImportJob(kanripoOptions())).rejects.toThrow(
      /already has an unfinished import/,
    );
    await expect(mod.startImportJob(kanripoOptions({ krId: 'KR9z0002' }))).resolves.toEqual(
      expect.any(String),
    );
  });
});

describe('pause and resume', () => {
  it('puts the juan that was running back to pending and does it again after Resume', async () => {
    let started = 0;
    mockProcessJuan.mockImplementation(
      async (p: { stem: string; usedPaths: Set<string>; signal: AbortSignal }) => {
        started += 1;
        if (p.stem === 'KR9z0001_002' && started === 2) {
          await new Promise((_resolve, reject) =>
            p.signal.addEventListener('abort', () => reject(abortError())),
          );
        }
        return finishes(p.stem)(p);
      },
    );
    const jobId = await mod.startImportJob(kanripoOptions());
    await waitFor(
      () => snapshotOf(jobId).juan.some((j) => j.stem === 'KR9z0001_002' && j.state === 'running'),
      'second juan running',
    );

    mod.pauseImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'paused', 'paused');
    expect(snapshotOf(jobId).juan.map((j) => j.state)).toEqual(['done', 'pending', 'pending']);

    mod.resumeImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed after resume');
    expect(snapshotOf(jobId).juan.map((j) => j.state)).toEqual(['done', 'done', 'done']);
  });

  it('a juan stopped by a blocking error is done again after Resume, not left running', async () => {
    const { ImportJobBlockedError } = jest.requireMock('./kanripoImportPipeline');
    let calls = 0;
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) => {
      calls += 1;
      if (calls === 2) throw new ImportJobBlockedError('quota reached', 'quota');
      return finishes(p.stem)(p);
    });
    const jobId = await mod.startImportJob(kanripoOptions());
    await waitFor(() => snapshotOf(jobId).status === 'blocked', 'blocked');
    expect(snapshotOf(jobId).blockReason).toBe('quota reached');
    expect(snapshotOf(jobId).juan.map((j) => j.state)).toEqual(['done', 'pending', 'pending']);

    mod.resumeImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
  });

  it('after a trial the job pauses once, shows which juan it was, and then runs to the end', async () => {
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) =>
      finishes(p.stem)(p),
    );
    const jobId = await mod.startImportJob(kanripoOptions({ pauseAfterFirst: true }));
    await waitFor(() => snapshotOf(jobId).status === 'paused', 'paused after the first juan');
    let snap = snapshotOf(jobId);
    expect(snap.pauseReason).toBe('trial');
    expect(snap.trialStem).toBe('KR9z0001_001');
    expect(snap.juan.map((j) => j.state)).toEqual(['done', 'pending', 'pending']);

    mod.resumeImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    snap = snapshotOf(jobId);
    expect(snap.pauseReason).toBeUndefined();
    expect(snap.juan.map((j) => j.state)).toEqual(['done', 'done', 'done']);
  });
});

describe('cancel', () => {
  it('does not start the next job until the cancelled one has stopped', async () => {
    const order: string[] = [];
    mockProcessJuan.mockImplementation(
      async (p: { stem: string; usedPaths: Set<string>; signal: AbortSignal }) => {
        order.push(`start ${p.stem}`);
        if (p.stem.startsWith('KR9z0001')) {
          await new Promise((_resolve, reject) =>
            p.signal.addEventListener('abort', () => {
              // The Python call takes a moment to die.
              setTimeout(() => {
                order.push('first stopped');
                reject(abortError());
              }, 80);
            }),
          );
        }
        return finishes(p.stem)(p);
      },
    );
    const first = await mod.startImportJob(kanripoOptions());
    const second = await mod.startImportJob(
      kanripoOptions({
        krId: 'KR9z0002',
        destDir: path.join(tmpProject, 'imported', 'kanripo', 'KR9z0002'),
      }),
    );
    await waitFor(() => order.length > 0, 'first job started');

    mod.cancelImportJob(first);
    expect(snapshotOf(first).status).toBe('cancelled');
    await wait(30);
    expect(order).toEqual(['start KR9z0001_001']); // second has not started
    await waitFor(() => snapshotOf(second).status === 'completed', 'second completed');
    expect(order).toEqual(['start KR9z0001_001', 'first stopped', 'start KR9z0002_001']);
    expect(snapshotOf(first).status).toBe('cancelled');
  });
});

describe('retry', () => {
  it('writes the juan over its earlier file instead of a "-2" name', async () => {
    const seenUsed: boolean[] = [];
    let attempt = 0;
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) => {
      const outputPath = `${tmpProject}/imported/kanripo/KR9z0001/${p.stem}.xml`;
      if (p.stem === 'KR9z0001_002') {
        attempt += 1;
        seenUsed.push(p.usedPaths.has(outputPath));
      }
      p.usedPaths.add(outputPath);
      // Like the real pipeline, leave the file on disk: a later run reads the folder to know which
      // names are taken.
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, '<TEI/>');
      return {
        stem: p.stem,
        outputPath,
        needsAttention: p.stem === 'KR9z0001_002' && attempt === 1,
        attentionReason: 'Low coverage (40%)',
      };
    });
    const jobId = await mod.startImportJob(kanripoOptions());
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    expect(snapshotOf(jobId).juan[1].state).toBe('needs_attention');

    mod.retryImportJuan(jobId, 'KR9z0001_002');
    await waitFor(
      () => snapshotOf(jobId).status === 'completed' && snapshotOf(jobId).juan[1].state === 'done',
      'retried',
    );
    // The path was freed before the second attempt, so the pipeline picks the same name again.
    expect(seenUsed).toEqual([false, false]);
  });
});

describe('spending cap', () => {
  it('records the juan that reaches the cap, then blocks', async () => {
    mockProcessJuan.mockImplementation(
      async (p: {
        stem: string;
        usedPaths: Set<string>;
        onUsage: (usage: { inputTokens: number; outputTokens: number }, cost: number) => void;
      }) => {
        p.onUsage({ inputTokens: 1000, outputTokens: 200 }, 0.6);
        return finishes(p.stem, { cost: 0.6, tokens: { input: 1000, output: 200 } })(p);
      },
    );
    const jobId = await mod.startImportJob(kanripoOptions({ spendCap: 1 }));
    await waitFor(() => snapshotOf(jobId).status === 'blocked', 'blocked');
    const snap = snapshotOf(jobId);
    expect(snap.blockReason).toMatch(/Spending cap of \$1\.00 reached/);
    expect(snap.juan.map((j) => j.state)).toEqual(['done', 'done', 'pending']);
    expect(snap.actualCost).toBeCloseTo(1.2);
    expect(snap.actualTokens).toEqual({ input: 2000, output: 400 });
  });
});

describe('saved jobs', () => {
  it('are restored paused, with no key, and a running juan starts over', async () => {
    mockProcessJuan.mockImplementation(() => new Promise(() => undefined));
    const jobId = await mod.startImportJob(
      kanripoOptions({
        punctMode: 'ai',
        aiSettings: { baseUrl: 'https://api.example', apiKey: 'SECRET-KEY', model: 'm' },
      }),
    );
    await waitFor(
      () => snapshotOf(jobId).juan.some((j) => j.state === 'running'),
      'a juan running',
    );
    await mod.killAllImportJobs(); // the app quits

    // A new session: nothing in memory.
    jest.resetModules();
    mod = await import('./importJob');
    mod.configureImportJobEmitter(
      (event) => events.push(event),
      () => null,
    );
    expect(mod.listImportJobs()).toHaveLength(0);

    expect(await mod.discoverAndRestoreImportJobs('/some/other/project')).toBe(0);
    expect(await mod.discoverAndRestoreImportJobs(tmpProject)).toBe(1);
    const restored = snapshotOf(jobId);
    expect(restored.status).toBe('paused');
    expect(restored.juan.map((j) => j.state)).toEqual(['pending', 'pending', 'pending']);
    expect(JSON.stringify(restored)).not.toContain('SECRET-KEY');

    // Without the app's AI settings an AI job cannot continue...
    mod.resumeImportJob(jobId);
    expect(snapshotOf(jobId).status).toBe('blocked');
    expect(snapshotOf(jobId).blockReason).toMatch(/AI API settings are needed/);
    // ...with them it can, and the job receives the key.
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) =>
      finishes(p.stem)(p),
    );
    mod.resumeImportJob(jobId, {
      aiSettings: { baseUrl: 'https://api.example', apiKey: 'NEW-KEY', model: 'm' },
    });
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    expect(mockProcessJuan.mock.calls.at(-1)![0].options.aiSettings.apiKey).toBe('NEW-KEY');
    expect(mockProcessJuan.mock.calls.at(-1)![0].options.sources[0].text.length).toBe(50_000);
  });

  it('a local model needs no key to resume', async () => {
    mockProcessJuan.mockImplementation(
      (p: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          // Like the real call: a signal that is already aborted rejects at once.
          if (p.signal.aborted) reject(abortError());
          p.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );
    const jobId = await mod.startImportJob(
      kanripoOptions({
        punctMode: 'ai',
        aiSettings: { baseUrl: 'http://localhost:11434', apiKey: '', model: 'm' },
      }),
    );
    await waitFor(() => snapshotOf(jobId).juan.some((j) => j.state === 'running'), 'running');
    mod.pauseImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'paused', 'paused');
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) =>
      finishes(p.stem)(p),
    );
    mod.resumeImportJob(jobId);
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
  });

  it('a pause that lands while a juan is being saved does not start that juan', async () => {
    mockProcessJuan.mockImplementation(
      (p: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (p.signal.aborted) reject(abortError());
          p.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );
    let jobId = '';
    let paused = false;
    mockWriteAtomic.mockImplementation(async (file: string, body: string) => {
      // The state write that follows a juan being marked running: pause exactly here.
      if (!paused && jobId && file.includes(jobId) && /"state":"running"/.test(body)) {
        paused = true;
        mod.pauseImportJob(jobId);
      }
      return jest.requireActual('./atomicWrite').writeFileAtomic(file, body);
    });
    jobId = await mod.startImportJob(kanripoOptions());

    await waitFor(() => snapshotOf(jobId).status === 'paused', 'paused');

    expect(paused).toBe(true);
    expect(mockProcessJuan).not.toHaveBeenCalled();
    expect(snapshotOf(jobId).juan.every((j) => j.state === 'pending')).toBe(true);
  });

  it('a dismissed job is deleted and does not come back', async () => {
    mockProcessJuan.mockImplementation(async (p: { stem: string; usedPaths: Set<string> }) =>
      finishes(p.stem)(p),
    );
    const jobId = await mod.startImportJob(kanripoOptions());
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    expect(mod.dismissImportJob(jobId)).toBe(true);
    await wait(50);
    await expect(
      fs.stat(path.join(mockUserData, 'import-jobs', `${jobId}.json`)),
    ).rejects.toThrow();

    jest.resetModules();
    mod = await import('./importJob');
    expect(await mod.discoverAndRestoreImportJobs(tmpProject)).toBe(0);
  });

  it('keeps one record per job, so two works in one CBETA volume or in Daozang do not share a file', async () => {
    mockInvokePython.mockImplementation(async (_plugin: string, payload: { work_id?: string }) => ({
      work_id: payload.work_id,
      canon: 'C',
      vol: '056',
      title: payload.work_id,
      juan: [{ n: '1', title: 't', body_xml: '<p>x</p>' }],
    }));
    const base = {
      kind: 'cbeta' as const,
      title: 'cbeta',
      projectRoot: tmpProject,
      projectConfig: { schema: { catalogId: 'teiAll' } },
      cleanImport: true,
      stripLineBreaks: false,
      splitUnit: 'juan' as const,
      crossFamily: true,
    };
    const a = await mod.startImportJob({
      ...base,
      workId: 'C1163',
      destDir: path.join(tmpProject, 'imported', 'cbeta', 'C1163'),
    });
    const b = await mod.startImportJob({
      ...base,
      workId: 'C1159',
      destDir: path.join(tmpProject, 'imported', 'cbeta', 'C1159'),
    });
    await waitFor(
      () =>
        snapshotOf(a).status !== 'running' &&
        snapshotOf(b).status !== 'running' &&
        snapshotOf(b).status !== 'queued',
      'both finished',
    );
    const files = (await fs.readdir(path.join(mockUserData, 'import-jobs'))).filter(
      (n) => !n.endsWith('.heavy.json'),
    );
    expect(files.sort()).toEqual([`${a}.json`, `${b}.json`].sort());
    // Nothing is written into the project but the XML files.
    const inProject = await fs
      .readdir(path.join(tmpProject, 'imported', 'cbeta', 'C', '056'))
      .catch(() => []);
    expect(inProject.some((n) => n.startsWith('.import-job'))).toBe(false);
  });
});

describe('progress events', () => {
  it('are sent at most a few times a second however fast the job reports', async () => {
    mockProcessJuan.mockImplementation(
      async (p: { stem: string; usedPaths: Set<string>; onStatus: (m: string) => void }) => {
        for (let i = 0; i < 200; i += 1) p.onStatus(`step ${i}`);
        return finishes(p.stem)(p);
      },
    );
    const jobId = await mod.startImportJob(kanripoOptions());
    await waitFor(() => snapshotOf(jobId).status === 'completed', 'completed');
    await wait(300);
    expect(events.length).toBeLessThan(40);
    expect(snapshotOf(jobId).status).toBe('completed');
    expect(events.at(-1)!.jobs[0].status).toBe('completed'); // the last state always arrives
  });
});
