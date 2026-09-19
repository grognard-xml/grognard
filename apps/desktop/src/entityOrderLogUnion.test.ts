import { ORDERS_FILE, unionOrderLogs } from './entityOrderLogUnion';

/**
 * Mirrors `unionOrderLogs`'s tests in
 * packages/cwrc-leafwriter/src/autoTagging/entityOrders.test.ts — this file is
 * a hand-kept copy of that module's pure order-log-union logic (see
 * entityOrderLogUnion.ts's doc comment for why), so its behavior needs the
 * same coverage independently.
 */
describe('unionOrderLogs', () => {
  const line = (id: string, when: string, remap: Record<string, string | null> = { x: 'y' }) =>
    JSON.stringify({ id, when, dbId: 'db1', remap });

  it('unions by order id and sorts chronologically (rollback-survival)', () => {
    const early = line('a', '2026-01-01T00:00:00Z');
    const late = line('b', '2026-02-01T00:00:00Z', { y: null });
    // restored log has only the early order; pre-restore log had both
    const restored = `${early}\n`;
    const preRestore = `${early}\n${late}\n`;
    const merged = unionOrderLogs(preRestore, restored);
    expect(
      merged
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l).id),
    ).toEqual(['a', 'b']);
  });

  it('is idempotent on identical logs', () => {
    const body = `${line('a', '2026-01-01T00:00:00Z')}\n`;
    expect(unionOrderLogs(body, body)).toBe(body);
  });

  it('skips blank and corrupt lines rather than failing', () => {
    const body = `${line('a', '2026-01-01T00:00:00Z')}\n\nnot json\n`;
    expect(unionOrderLogs(body, '')).toBe(`${line('a', '2026-01-01T00:00:00Z')}\n`);
  });

  it('exposes the same filename the canonical module uses', () => {
    expect(ORDERS_FILE).toBe('entity-orders.jsonl');
  });
});
