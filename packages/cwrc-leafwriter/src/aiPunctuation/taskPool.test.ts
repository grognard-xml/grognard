import { runPool } from './taskPool';

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    });
  });

describe('runPool', () => {
  it('returns results in task order whatever order they finish in', async () => {
    const tasks = [30, 5, 15, 1].map((ms, i) => async () => {
      await delay(ms);
      return i;
    });
    expect(await runPool(tasks, 4)).toEqual([0, 1, 2, 3]);
  });

  it('never has more than `concurrency` tasks in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(3);
      inFlight--;
    });
    await runPool(tasks, 3);
    expect(peak).toBe(3);
  });

  it('runs one at a time when concurrency is 1 or invalid', async () => {
    for (const concurrency of [1, 0, Number.NaN]) {
      let inFlight = 0;
      let peak = 0;
      const tasks = Array.from({ length: 4 }, () => async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(1);
        inFlight--;
      });
      await runPool(tasks, concurrency);
      expect(peak).toBe(1);
    }
  });

  it('handles an empty task list', async () => {
    expect(await runPool([], 4)).toEqual([]);
  });

  it('on a failure cancels in-flight tasks, starts no more, and rejects with that error', async () => {
    const started: number[] = [];
    let cancelled = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async (signal: AbortSignal) => {
      started.push(i);
      if (i === 1) {
        await delay(2);
        throw new Error('boom');
      }
      try {
        await delay(200, signal);
      } catch (error) {
        cancelled++;
        throw error;
      }
    });
    await expect(runPool(tasks, 3)).rejects.toThrow('boom');
    expect(started.length).toBeLessThanOrEqual(4);
    expect(cancelled).toBeGreaterThan(0);
  });

  it('rejects with the abort reason when the caller aborts', async () => {
    const controller = new AbortController();
    const tasks = Array.from(
      { length: 5 },
      () => async (signal: AbortSignal) => delay(200, signal),
    );
    const run = runPool(tasks, 2, controller.signal);
    setTimeout(() => controller.abort(new DOMException('stopped', 'AbortError')), 5);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start anything when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('stopped', 'AbortError'));
    let started = 0;
    await expect(runPool([async () => void started++], 2, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(started).toBe(0);
  });
});
