import type {
  ImportJobSnapshot,
  ImportJuanRecord,
} from '../../../../apps/commons/src/desktop/importJobTypes';
import {
  applyImportJobProgress,
  getImportJobUiState,
  jobProgress,
  newlyWrittenFiles,
  trialSummary,
  visibleImportJobs,
  visibleJuan,
} from './importJobProgress';

const juan = (
  stem: string,
  state: ImportJuanRecord['state'],
  extra: Partial<ImportJuanRecord> = {},
) => ({ stem, sourceKey: stem, state, ...extra }) as ImportJuanRecord;

const job = (
  juanList: ImportJuanRecord[],
  extra: Partial<ImportJobSnapshot> = {},
): ImportJobSnapshot =>
  ({
    jobId: 'j1',
    kind: 'kanripo',
    title: 'Work',
    workId: 'KR1',
    status: 'running',
    options: {} as ImportJobSnapshot['options'],
    juan: juanList,
    startedAt: '',
    updatedAt: '',
    elapsedMs: 0,
    actualCost: 0,
    ...extra,
  }) as ImportJobSnapshot;

describe('jobProgress', () => {
  it('counts finished juan of every kind, and skipped ones', () => {
    const p = jobProgress(
      job([
        juan('a', 'done'),
        juan('b', 'needs_attention'),
        juan('c', 'skipped'),
        juan('d', 'running'),
        juan('e', 'pending'),
      ]),
    );
    expect(p).toEqual({ done: 3, total: 5, fraction: 0.6 });
  });

  it('is zero for a job whose juan are not known yet', () => {
    expect(jobProgress(job([]))).toEqual({ done: 0, total: 0, fraction: 0 });
  });
});

describe('trialSummary', () => {
  it('is only there while the job waits after its trial juan', () => {
    expect(trialSummary(job([juan('a', 'done')]))).toBeNull();
    expect(trialSummary(job([juan('a', 'done')], { pauseReason: 'trial' }))).toBeNull(); // no trialStem
  });

  it('projects the tokens and cost of the rest from the trial juan', () => {
    const summary = trialSummary(
      job(
        [
          juan('a', 'done', { tokens: { input: 8000, output: 2000 }, cost: 0.05 }),
          juan('b', 'pending'),
          juan('c', 'pending'),
          juan('d', 'pending'),
        ],
        { pauseReason: 'trial', trialStem: 'a', status: 'paused' },
      ),
    );
    expect(summary).toEqual({
      stem: 'a',
      tokens: 10000,
      cost: 0.05,
      remaining: 3,
      remainingTokens: 30000,
      remainingCost: 0.15000000000000002,
    });
  });

  it('reports tokens only when no prices were given', () => {
    const summary = trialSummary(
      job(
        [juan('a', 'done', { tokens: { input: 100, output: 50 }, cost: 0 }), juan('b', 'pending')],
        {
          pauseReason: 'trial',
          trialStem: 'a',
        },
      ),
    );
    expect(summary?.cost).toBeNull();
    expect(summary?.remainingCost).toBeNull();
    expect(summary?.remainingTokens).toBe(150);
  });
});

describe('newlyWrittenFiles', () => {
  it('lists files that appeared, and separates juan written again', () => {
    const before = [
      job([
        juan('a', 'done', { outputPath: '/p/a.xml' }),
        juan('b', 'running'),
        juan('c', 'needs_attention', { outputPath: '/p/c.xml' }),
        juan('d', 'pending'),
      ]),
    ];
    const after = [
      job([
        juan('a', 'done', { outputPath: '/p/a.xml' }),
        juan('b', 'done', { outputPath: '/p/b.xml' }),
        juan('c', 'running', { outputPath: '/p/c.xml' }), // retried, not finished yet
        juan('d', 'running'),
      ]),
    ];
    expect(newlyWrittenFiles(before, after)).toEqual({ written: ['/p/b.xml'], rewritten: [] });

    const finally_ = [
      job([
        juan('a', 'done', { outputPath: '/p/a.xml' }),
        juan('b', 'done', { outputPath: '/p/b.xml' }),
        juan('c', 'done', { outputPath: '/p/c.xml' }),
        juan('d', 'done', { outputPath: '/p/d.xml' }),
      ]),
    ];
    expect(newlyWrittenFiles(after, finally_)).toEqual({
      written: ['/p/d.xml'],
      rewritten: ['/p/c.xml'],
    });
  });

  it('treats everything as new for a job the window has not seen', () => {
    expect(
      newlyWrittenFiles([], [job([juan('a', 'done', { outputPath: '/p/a.xml' })])]).written,
    ).toEqual(['/p/a.xml']);
  });

  it('reports nothing when nothing changed', () => {
    const state = [job([juan('a', 'done', { outputPath: '/p/a.xml' })])];
    expect(newlyWrittenFiles(state, state)).toEqual({ written: [], rewritten: [] });
  });
});

describe('visibleJuan', () => {
  const many = job(
    Array.from({ length: 100 }, (_, i) =>
      juan(
        `s${i}`,
        i < 60 ? 'done' : i === 60 ? 'running' : i === 61 ? 'needs_attention' : 'pending',
      ),
    ),
  );

  it('shows the running and flagged juan first, then those waiting, and only counts the finished ones', () => {
    const view = visibleJuan(many, false, 10);
    expect(view.shown.map((j) => j.stem).slice(0, 3)).toEqual(['s60', 's61', 's62']);
    expect(view.shown).toHaveLength(10);
    expect(view.hiddenDone).toBe(60);
    expect(view.hiddenOther).toBe(40 - 10);
  });

  it('lists everything on request', () => {
    expect(visibleJuan(many, true).shown).toHaveLength(100);
  });
});

describe('visibleImportJobs', () => {
  it('hides a clean job a day after it finished, but not one that needs attention', () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    applyImportJobProgress({
      jobs: [
        job([juan('a', 'done')], { jobId: 'clean', status: 'completed', finishedAt: old }),
        job([juan('a', 'needs_attention')], {
          jobId: 'flagged',
          status: 'completed',
          finishedAt: old,
        }),
        job([juan('a', 'pending')], { jobId: 'running' }),
      ],
      activeJobId: 'running',
    });
    expect(visibleImportJobs(getImportJobUiState()).map((j) => j.jobId)).toEqual([
      'flagged',
      'running',
    ]);
  });
});
