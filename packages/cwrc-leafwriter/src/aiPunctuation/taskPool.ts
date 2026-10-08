/**
 * Run async tasks with at most `concurrency` in flight; results come back in task order.
 *
 * Each task gets a signal that aborts when the caller's signal does *or* when any task fails, so
 * one failure cancels the in-flight requests of the others instead of letting them run to
 * completion for a result nobody will use. Tasks not yet started are never started after that.
 * Rejects with the caller's abort reason if it aborted, otherwise with the first failure.
 */
export async function runPool<T>(
  tasks: ((signal: AbortSignal) => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const inner = new AbortController();
  const onParentAbort = () => inner.abort(signal?.reason);
  if (signal?.aborted) onParentAbort();
  else signal?.addEventListener('abort', onParentAbort, { once: true });

  let next = 0;
  let failure: { error: unknown } | null = null;

  const worker = async () => {
    while (!failure && !inner.signal.aborted) {
      const index = next++;
      if (index >= tasks.length) return;
      try {
        results[index] = await tasks[index]!(inner.signal);
      } catch (error) {
        if (!failure && !signal?.aborted) failure = { error };
        inner.abort(error);
        return;
      }
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length));
  try {
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    signal?.removeEventListener('abort', onParentAbort);
  }
  if (failure) throw (failure as { error: unknown }).error;
  signal?.throwIfAborted();
  return results;
}
